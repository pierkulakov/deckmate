import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import * as filesystem from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CatalogError, CatalogService } from '../server/catalog-service.ts';
import { emptyManifest, readProjectCatalog, renderCatalogManifest } from '../server/catalog.ts';
import { writeCatalogBatch } from '../server/cli-write.ts';
import { prepareCoordinationDirectory, projectCacheFile } from '../server/project-cache.ts';
import * as projectCache from '../server/project-cache.ts';
import { ownsProjectWriteLock, withProjectWriteLock } from '../server/write-lock.ts';
import type { ServerConfig } from '../server/config.ts';
import type { CatalogEdit } from '../src/catalog-contracts.ts';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../server/app.ts';
import { milestonesPath, runsPath } from '../src/planning-files.ts';
import * as runs from '../server/runs.ts';
import { readCardAttachments } from '../server/attachments.ts';

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, open: vi.fn(actual.open), lstat: vi.fn(actual.lstat), link: vi.fn(actual.link), unlink: vi.fn(actual.unlink) };
});

let directory: string;
let root: string;
let config: ServerConfig;
const seedId = 'task:features/work.md#1.0';
const cardIds = ['card:11111111-1111-4111-8111-111111111111', 'card:22222222-2222-4222-8222-222222222222'];
const services: CatalogService[] = [];
const apps: FastifyInstance[] = [];
const children: Array<{ child: ChildProcess; closed: Promise<number | null> }> = [];

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'deckmate-write-lock-'));
  vi.stubEnv('DECKMATE_INDEX', path.join(directory, 'cache'));
  vi.stubEnv('DECKMATE_COORDINATION', path.join(directory, 'coordination'));
  root = path.join(directory, 'project');
  await mkdir(path.join(root, 'tasks'), { recursive: true });
  await mkdir(path.join(root, 'features'));
  await writeFile(path.join(root, 'features/work.md'), '# Work\n## 1 — Work\n### 1.0 Existing (not-started)\n');
  const manifest = emptyManifest();
  manifest.formatLanguage = 'en';
  manifest.spaces.push({ id: 'work', title: 'Work' });
  manifest.decks.push({ id: 'work', spaceId: 'work', title: 'Work', kind: 'task', description: '', icon: 'box', color: '#123456' });
  manifest.membership.push({ card: seedId, deck: 'work' });
  manifest.deckOrder = { work: { flatOrder: [seedId] } };
  await writeFile(path.join(root, 'tasks/deckmate.md'), renderCatalogManifest(manifest));
  config = { dataRoot: root, writeRoot: root, editMode: 'direct', port: 4395, projectName: 'Lock test', python: 'python' };
});
afterEach(async () => {
  for (const { child, closed } of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await closed;
  }
  vi.restoreAllMocks();
  vi.mocked(filesystem.open).mockReset();
  vi.mocked(filesystem.lstat).mockReset();
  vi.mocked(filesystem.link).mockReset();
  vi.mocked(filesystem.unlink).mockReset();
  for (const app of apps.splice(0)) await app.close();
  for (const service of services.splice(0)) await service.close();
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

function service() {
  const value = new CatalogService(config, ':memory:');
  services.push(value);
  return value;
}

function createCard(cardId: string, manifestHash: string): CatalogEdit {
  return { action: 'create-card', cardId, manifestHash, kind: 'task', title: cardId, markdown: '', deckId: 'work',
    parentId: null, trackIds: [], owner: null, effort: null, priority: null };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function lockOwner(pid: number, startedAt = Date.now()) {
  const filename = await projectCacheFile(root, 'write');
  await prepareCoordinationDirectory();
  const bytes = JSON.stringify({ pid, startedAt, token: 'fixture' });
  await writeFile(filename, bytes);
  return { filename, bytes };
}

it('keeps both cards and their manual-order positions when two offline batches race', async () => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(Object.assign(new TypeError('No server'), { cause: { code: 'ECONNREFUSED' } }));
  const builds = cardIds.map(cardId => vi.fn((hash: string) => createCard(cardId, hash)));
  const outcomes = await Promise.all(builds.map(build => writeCatalogBatch(config, 'sandbox', null, [build])));
  expect(outcomes).toEqual([[{ ok: true, via: 'files', warnings: [] }], [{ ok: true, via: 'files', warnings: [] }]]);
  const catalog = await readProjectCatalog(root);
  expect(catalog.cards.map(card => card.id)).toEqual(expect.arrayContaining(cardIds));
  expect(catalog.deckOrder?.work.flatOrder).toHaveLength(3);
  expect(catalog.deckOrder?.work.flatOrder).toEqual(expect.arrayContaining([seedId, ...cardIds]));
});

// 2026-11-12: the 200-card stress case publishes guarded card, manifest and journal files on disk.
it.each([{ via: 'files' as const, count: 100 }, { via: 'server' as const, count: 10 }])('serializes $count creations per writer with a batch-lock barrier via $via', async ({ via, count }) => {
  if (via === 'server') {
    const app = await createApp(config);
    apps.push(app);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      const response = await app.inject({ url: url.pathname + url.search, method: init?.method === 'POST' ? 'POST' : 'GET',
        headers: { host: `127.0.0.1:${config.port}`, ...Object.fromEntries(new Headers(init?.headers)) }, payload: init?.body as string | undefined });
      return new Response(response.body, { status: response.statusCode });
    });
  } else {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(Object.assign(new TypeError('Offline'), { cause: { code: 'ECONNREFUSED' } }));
  }
  const before = await readFile(path.join(root, 'features/work.md'));
  const entered = deferred();
  const release = deferred();
  const waiting = deferred();
  const filename = await projectCacheFile(root, 'write');
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  let locks = 0;
  vi.mocked(filesystem.link).mockImplementation(async (...args) => {
    try {
      await actual.link(...args);
      if (args[1] === filename) locks += 1;
    } catch (error) {
      if (args[1] === filename && (error as NodeJS.ErrnoException).code === 'EEXIST') waiting.resolve();
      throw error;
    }
  });
  const held = withProjectWriteLock(root, async () => { entered.resolve(); await release.promise; });
  await entered.promise;
  const ids = Array.from({ length: count * 2 }, (_, index) => `card:33333333-3333-4333-8333-${String(index).padStart(12, '0')}`);
  const write = (worker: number, batch: number) => writeCatalogBatch(config, 'sandbox', null,
    ids.slice(worker * count + batch * 10, worker * count + batch * 10 + 10).map(id => hash => createCard(id, hash)));
  const first = Promise.all([write(0, 0), write(1, 0)]);
  try { await waiting.promise; }
  finally { release.resolve(); }
  await held;
  const results = [await first];
  for (let batch = 1; batch < count / 10; batch += 1) results.push(await Promise.all([write(0, batch), write(1, batch)]));
  expect(results.flat(2)).toEqual(ids.map(() => ({ ok: true, via, warnings: [] })));
  if (via === 'files') expect(locks).toBeGreaterThanOrEqual(1 + count / 10 * 2);
  const view = await readProjectCatalog(root);
  expect(view.cards.filter(card => ids.includes(card.id))).toHaveLength(count * 2);
  const order = view.deckOrder?.work.flatOrder ?? [];
  expect(order).toHaveLength(count * 2 + 1);
  expect(new Set(order).size).toBe(count * 2 + 1);
  expect(order).toEqual(expect.arrayContaining([seedId, ...ids]));
  expect(await readFile(path.join(root, 'features/work.md'))).toEqual(before);
}, 60_000);

it('preserves both creations and manual-order positions across two independent Node processes', async () => {
  const order = path.join(directory, 'order.txt');
  const script = `
    import filesystem from 'node:fs/promises';
    import { syncBuiltinESMExports } from 'node:module';
    import { writeCatalogBatch } from ${JSON.stringify(new URL('../server/cli-write.ts', import.meta.url).href)};
    import { projectCacheFile } from ${JSON.stringify(new URL('../server/project-cache.ts', import.meta.url).href)};
    import { withProjectWriteLock } from ${JSON.stringify(new URL('../server/write-lock.ts', import.meta.url).href)};
    globalThis.fetch = async () => { throw Object.assign(new TypeError('Offline'), { cause: { code: 'ECONNREFUSED' } }); };
    const config = JSON.parse(process.argv[1]);
    const edit = JSON.parse(process.argv[2]);
    const index = Number(process.argv[3]);
    const order = process.argv[4];
    if (index === 1) {
      const filename = await projectCacheFile(config.dataRoot, 'write');
      const link = filesystem.link;
      let waiting = false;
      let entered = false;
      filesystem.link = async (...args) => {
        try { await link(...args); }
        catch (error) {
          if (args[1] === filename && error.code === 'EEXIST' && !waiting) {
            waiting = true;
            process.send('waiting');
          }
          throw error;
        }
        if (args[1] === filename && !entered) {
          entered = true;
          await filesystem.appendFile(order, '1:entered\\n');
        }
      };
      syncBuiltinESMExports();
    }
    const write = async () => {
      const result = await writeCatalogBatch(config, 'sandbox', null, [hash => ({ ...edit, manifestHash: hash })]);
      await filesystem.appendFile(order, index + ':written\\n');
      console.log(JSON.stringify(result));
    };
    if (index === 0) {
      await withProjectWriteLock(config.dataRoot, async () => {
        await filesystem.appendFile(order, '0:entered\\n');
        const released = new Promise(resolve => process.once('message', resolve));
        process.send('held');
        await released;
        await write();
      });
    } else {
      await write();
    }
    process.disconnect();
  `;
  function start(index: number) {
    const child = spawn(process.execPath,
      ['--input-type=module', '-e', script, JSON.stringify(config), JSON.stringify(createCard(cardIds[index], '')), String(index), order],
      { windowsHide: true, timeout: 10_000, killSignal: 'SIGKILL', stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    const closed = new Promise<number | null>(resolve => child.once('close', resolve));
    children.push({ child, closed });
    let stdout = '';
    let stderr = '';
    child.stdout!.on('data', chunk => { stdout += String(chunk); });
    child.stderr!.on('data', chunk => { stderr += String(chunk); });
    const ready = new Promise<void>((resolve, reject) => {
      child.on('message', message => { if (message === (index === 0 ? 'held' : 'waiting')) resolve(); });
      child.once('error', reject);
      child.once('close', code => reject(new Error(`Writer ${index} exited before its barrier (${code}): ${stderr}`)));
    });
    return { child, closed, ready, output: () => ({ stdout, stderr }) };
  }
  const first = start(0);
  await first.ready;
  const second = start(1);
  await second.ready;
  expect(await readFile(order, 'utf8')).toBe('0:entered\n');
  first.child.send('release');
  for (const worker of [first, second]) {
    expect(await worker.closed, worker.output().stderr).toBe(0);
    expect(JSON.parse(worker.output().stdout)).toEqual([{ ok: true, via: 'files', warnings: [] }]);
  }
  expect(await readFile(order, 'utf8')).toBe('0:entered\n0:written\n1:entered\n1:written\n');
  const catalog = await readProjectCatalog(root);
  expect(catalog.cards.map(card => card.id)).toEqual(expect.arrayContaining(cardIds));
  expect(catalog.deckOrder?.work.flatOrder).toHaveLength(3);
  expect(catalog.deckOrder?.work.flatOrder).toEqual(expect.arrayContaining([seedId, ...cardIds]));
});

it('still rejects stale manifest hashes rather than silently rebasing an individual edit', async () => {
  const hash = (await readProjectCatalog(root)).manifestHash;
  const results = await Promise.allSettled(cardIds.map(cardId => service().edit(createCard(cardId, hash), 'sandbox')));
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter(result => result.status === 'rejected').map(result => result.reason)).toEqual([
    expect.objectContaining({ status: 409, saved: false }),
  ]);
  const catalog = await readProjectCatalog(root);
  expect(catalog.cards.filter(card => cardIds.includes(card.id))).toHaveLength(1);
  expect(catalog.deckOrder?.work.flatOrder).toHaveLength(2);
});

it('serializes recordMutation and edit across independent services, even in the same process', async () => {
  const first = service();
  const second = service();
  const entered = deferred();
  const release = deferred();
  const mutation = first.recordMutation('held', async () => { entered.resolve(); await release.promise; return {}; });
  await entered.promise;
  const before = await readProjectCatalog(root);
  const edit = second.edit(createCard(cardIds[0], before.manifestHash), 'sandbox');
  const settled = vi.fn();
  void edit.then(settled);
  try {
    await expect(withProjectWriteLock(root, async () => {}, { timeoutMs: 40, retryMs: 5 }))
      .rejects.toMatchObject({ status: 503, saved: false });
    expect(settled).not.toHaveBeenCalled();
    expect((await readProjectCatalog(root)).cards.map(card => card.id)).toEqual(before.cards.map(card => card.id));
  } finally { release.resolve(); }
  await mutation;
  await edit;
  expect((await readProjectCatalog(root)).cards.map(card => card.id)).toContain(cardIds[0]);
});

it('allows nested edits in the owning async context and releases the lock after exceptions', async () => {
  const catalog = service();
  await catalog.recordMutation('nested', async () => {
    const hash = (await readProjectCatalog(root)).manifestHash;
    return catalog.edit(createCard(cardIds[0], hash), 'sandbox');
  });
  const failure = new Error('Failure');
  await expect(withProjectWriteLock(root, async () => { throw failure; })).rejects.toBe(failure);
  await expect(readFile(await projectCacheFile(root, 'write'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await withProjectWriteLock(root, async () => 'released')).toBe('released');
});

it('does not block a read or deadlock a nested edit while housekeeping skips a held lock', async () => {
  const catalog = service();
  const entered = deferred();
  const release = deferred();
  const mutation = catalog.recordMutation('held', async () => {
    entered.resolve();
    await release.promise;
    return catalog.edit(createCard(cardIds[0], (await readProjectCatalog(root)).manifestHash), 'sandbox');
  });
  await entered.promise;
  expect((await catalog.get('sandbox')).cards.map(card => card.id)).not.toContain(cardIds[0]);
  release.resolve();
  await mutation;
  expect((await catalog.get('sandbox')).cards.map(card => card.id)).toContain(cardIds[0]);
});

it('shares lock identity and nested ownership with another realpath alias', async () => {
  const alias = path.join(directory, 'alias');
  await symlink(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
  expect(await projectCacheFile(alias, 'write')).toBe(await projectCacheFile(root, 'write'));
  const catalog = service();
  await withProjectWriteLock(alias, async () => {
    expect(await ownsProjectWriteLock(root)).toBe(true);
    return catalog.recordMutation('nested', async () => {
      return catalog.edit(createCard(cardIds[0], (await readProjectCatalog(root)).manifestHash), 'sandbox');
    });
  });
  expect((await readProjectCatalog(root)).cards.map(card => card.id)).toContain(cardIds[0]);
});

it('never makes a possibly saved mutation retryable when lock cleanup fails', async () => {
  const filename = await projectCacheFile(root, 'write');
  await expect(withProjectWriteLock(root, async () => { await rm(filename); }))
    .rejects.toMatchObject({ status: 503, saved: true });
});

it('preserves unsaved lock refusals as 503 across catalog, planning and import HTTP routes', async () => {
  const app = await createApp(config);
  apps.push(app);
  const headers = { host: `127.0.0.1:${config.port}` };
  const token = (await app.inject({ url: '/api/snapshot', headers })).json().token;
  const before = await readProjectCatalog(root);
  const { filename, bytes } = await lockOwner(process.pid, Date.now() - 121_000);
  const requests = [
    { url: '/api/catalog', payload: { ...createCard(cardIds[0], before.manifestHash), source: 'sandbox' } },
    { url: '/api/planning', payload: { source: 'sandbox', action: 'create-milestone', milestonesHash: '',
      milestone: { id: 'release', title: 'Release', date: '2026-12-01', color: '#123456' } } },
    { url: '/api/catalog-import', payload: { source: 'sandbox', manifestHash: before.manifestHash, optionsHash: '', deckId: 'work',
      cards: [{ cardId: null, kind: 'task', title: 'Import', markdown: '', owner: null, effort: null, priority: null, state: null, tags: [] }] } },
  ];
  for (const request of requests) {
    const response = await app.inject({ ...request, method: 'POST', headers: { ...headers, 'x-deckmate-token': token } });
    expect(response.statusCode, response.body).toBe(503);
    expect(response.json()).toMatchObject({ saved: false });
  }
  expect((await readProjectCatalog(root)).manifestHash).toBe(before.manifestHash);
  expect(await readFile(filename, 'utf8')).toBe(bytes);
});

it('keeps saved:true if a planning write succeeds but the subsequent catalog load hits a lock refusal', async () => {
  const app = await createApp(config);
  apps.push(app);
  const headers = { host: `127.0.0.1:${config.port}` };
  const token = (await app.inject({ url: '/api/snapshot', headers })).json().token;
  vi.spyOn(CatalogService.prototype, 'get').mockRejectedValueOnce(new CatalogError(503, 'Lock refused'));
  const response = await app.inject({ url: '/api/planning', method: 'POST', headers: { ...headers, 'x-deckmate-token': token },
    payload: { source: 'sandbox', action: 'create-milestone', milestonesHash: '',
      milestone: { id: 'release', title: 'Release', date: '2026-12-01', color: '#123456' } } });
  expect(response.statusCode, response.body).toBe(503);
  expect(response.json()).toMatchObject({ saved: true });
  expect(await readFile(path.join(root, milestonesPath), 'utf8')).toContain('Release');
});

it('removes a dead owner and lets competing reapers acquire in sequence', async () => {
  const child = spawnSync(process.execPath, ['-e', ''], { windowsHide: true });
  expect(child.status).toBe(0);
  const { filename } = await lockOwner(child.pid);
  let active = 0;
  const visits: number[] = [];
  await Promise.all([1, 2, 3].map(value => withProjectWriteLock(root, async () => {
    expect(active++).toBe(0);
    visits.push(value);
    expect(JSON.parse(await readFile(filename, 'utf8')).pid).toBe(process.pid);
    active -= 1;
  })));
  expect(visits.sort()).toEqual([1, 2, 3]);
  await expect(readFile(filename)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('retries an owner that becomes delete-pending during the initial file check', async () => {
  const { filename } = await lockOwner(process.pid);
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  let released = false;
  vi.mocked(filesystem.lstat).mockImplementation(async (...args) => {
    const stat = await actual.lstat(...args);
    if (String(args[0]) === filename && !released) {
      released = true;
      await rm(filename);
      // 2026-11-12: Windows may expose a delete-pending inode with no regular-file type bits before ENOENT.
      return Object.assign(stat, { mode: 0n });
    }
    return stat;
  });
  const mutate = vi.fn(async () => 'written');
  expect(await withProjectWriteLock(root, mutate, { timeoutMs: 200, retryMs: 2 })).toBe('written');
  expect(released).toBe(true);
  expect(mutate).toHaveBeenCalledTimes(1);
});

it('times out with an unsaved 503 for a live owner and never removes its lock', async () => {
  const { filename, bytes } = await lockOwner(process.pid);
  const mutate = vi.fn();
  const start = Date.now();
  const error = await withProjectWriteLock(root, mutate, { timeoutMs: 40, retryMs: 5 }).catch(error => error);
  expect(error).toBeInstanceOf(CatalogError);
  expect(error).toMatchObject({ status: 503, saved: false, message: expect.stringContaining('retry') });
  expect(Date.now() - start).toBeGreaterThanOrEqual(35);
  expect(mutate).not.toHaveBeenCalled();
  expect(await readFile(filename, 'utf8')).toBe(bytes);
});

it('refuses a live owner older than two minutes without silently stealing the lock', async () => {
  const { filename, bytes } = await lockOwner(process.pid, Date.now() - 121_000);
  await expect(withProjectWriteLock(root, async () => {}, { timeoutMs: 10 }))
    .rejects.toMatchObject({ status: 503, saved: false, message: expect.stringContaining(filename) });
  expect(await readFile(filename, 'utf8')).toBe(bytes);
});

it('does not treat an incomplete owner record as a dead process', async () => {
  const { filename } = await lockOwner(process.pid);
  await writeFile(filename, '{');
  await expect(withProjectWriteLock(root, async () => {}, { timeoutMs: 10, retryMs: 2 }))
    .rejects.toMatchObject({ status: 503, saved: false });
  expect(await readFile(filename, 'utf8')).toBe('{');
});

it('fails closed if another reaper has not completed instead of unlinking a successor', async () => {
  const child = spawnSync(process.execPath, ['-e', ''], { windowsHide: true });
  expect(child.status).toBe(0);
  const { filename, bytes } = await lockOwner(child.pid);
  await writeFile(`${filename}.reap`, JSON.stringify({ pid: child.pid }));
  await expect(withProjectWriteLock(root, async () => {}, { timeoutMs: 10, retryMs: 2 }))
    .rejects.toMatchObject({ status: 503, saved: false, message: expect.stringContaining(`${filename}.reap`) });
  expect(await readFile(filename, 'utf8')).toBe(bytes);
});

it('serves GET under a held lock and retries skipped housekeeping on the next unchanged revision', async () => {
  await writeFile(path.join(root, runsPath), '---\nschema: 1\nruns:\n  - id: legacy\n    number: 1\n    start: "2026-11-01"\n    end: "2026-11-02"\n    goal: Legacy work\n---\n');
  const app = await createApp(config);
  apps.push(app);
  const housekeeping = vi.spyOn(runs, 'carryOverExpiredRuns');
  const { filename, bytes } = await lockOwner(process.pid, Date.now() - 121_000);
  const request = { url: '/api/catalog', headers: { host: `127.0.0.1:${config.port}` } };
  const response = await app.inject(request);
  expect(response.statusCode, response.body).toBe(200);
  expect(housekeeping).not.toHaveBeenCalled();
  expect(await readFile(filename, 'utf8')).toBe(bytes);
  await rm(filename);
  expect((await app.inject(request)).statusCode).toBe(200);
  expect(housekeeping).toHaveBeenCalledTimes(1);
  expect((await app.inject(request)).statusCode).toBe(200);
  expect(housekeeping).toHaveBeenCalledTimes(1);
});

it('returns a saved attachment successfully when catalog housekeeping cannot acquire the lock', async () => {
  const app = await createApp(config);
  apps.push(app);
  const headers = { host: `127.0.0.1:${config.port}` };
  const token = (await app.inject({ url: '/api/snapshot', headers })).json().token;
  const { filename } = await lockOwner(process.pid, Date.now() - 121_000);
  const response = await app.inject({ url: '/api/catalog', method: 'POST',
    headers: { ...headers, 'x-deckmate-token': token }, payload: {
      action: 'upload-attachment', source: 'sandbox', cardId: seedId, attachmentsHash: '', manifestHash: '',
      dataUrl: `data:application/pdf;base64,${Buffer.from('%PDF-1.7\n%%EOF\n').toString('base64')}`,
      fileName: 'hello.pdf', addedBy: null,
    } });
  expect(response.statusCode, response.body).toBe(200);
  expect((await readCardAttachments(root, seedId)).files).toHaveLength(1);
  await rm(filename);
});

it.each(['', '{'])('recovers an abandoned incomplete owner %j by its mtime', async bytes => {
  const { filename } = await lockOwner(process.pid);
  await writeFile(filename, bytes);
  const old = new Date(Date.now() - 1000);
  await utimes(filename, old, old);
  const mutate = vi.fn(async () => 'recovered');
  expect(await withProjectWriteLock(root, mutate, { timeoutMs: 200, retryMs: 2, staleMs: 100 })).toBe('recovered');
  expect(mutate).toHaveBeenCalledTimes(1);
  await expect(readFile(filename)).rejects.toMatchObject({ code: 'ENOENT' });
});

it.each(['dead', 'empty', 'invalid'])('recovers an abandoned %s reaper after a crash with competing writers', async contents => {
  const child = spawnSync(process.execPath, ['-e', ''], { windowsHide: true });
  const { filename } = await lockOwner(child.pid);
  const reaper = `${filename}.reap`;
  let bytes = '';
  if (contents === 'dead') bytes = JSON.stringify({ pid: child.pid, startedAt: Date.now() - 1000 });
  if (contents === 'invalid') bytes = '{';
  await writeFile(reaper, bytes);
  const old = new Date(Date.now() - 1000);
  await utimes(reaper, old, old);
  let active = 0;
  // 2026-11-13: this case checks recovery and mutual exclusion, not speed; three serialized atomic publications with
  // the Windows ACL check did not fit a 200 ms acquisition budget on CI runners.
  await Promise.all([1, 2, 3].map(() => withProjectWriteLock(root, async () => {
    expect(active++).toBe(0);
    expect(JSON.parse(await readFile(filename, 'utf8')).pid).toBe(process.pid);
    active -= 1;
  }, { timeoutMs: 2_000, retryMs: 2, staleMs: 100 })));
  await expect(readFile(reaper)).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(readFile(`${reaper}.reap`)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('does not steal a live recovery guard even when its mtime is old', async () => {
  const child = spawnSync(process.execPath, ['-e', ''], { windowsHide: true });
  const { filename } = await lockOwner(child.pid);
  const reaper = `${filename}.reap`;
  const bytes = JSON.stringify({ pid: process.pid, startedAt: Date.now() - 1000 });
  await writeFile(reaper, bytes);
  const old = new Date(Date.now() - 1000);
  await utimes(reaper, old, old);
  await expect(withProjectWriteLock(root, async () => {}, { timeoutMs: 10, retryMs: 2, staleMs: 100 }))
    .rejects.toMatchObject({ status: 503, saved: false });
  expect(await readFile(reaper, 'utf8')).toBe(bytes);
});

it('never overlaps writers when a reaper pauses past staleMs before publishing its owner', async () => {
  const child = spawnSync(process.execPath, ['-e', ''], { windowsHide: true });
  expect(child.status).toBe(0);
  const { filename } = await lockOwner(child.pid);
  const reaper = `${filename}.reap`;
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  const created = deferred();
  const resume = deferred();
  const recoveryChecked = deferred();
  const finishRecovery = deferred();
  const ownerChecked = deferred();
  const finishRemoval = deferred();
  const writerEntered = deferred();
  const releaseWriter = deferred();
  let now = Date.now();
  let paused = false;
  let removing = false;
  let writerActive = false;
  let overlap = false;
  const pause = async (target: string) => {
    if (target !== reaper || paused) return;
    paused = true;
    created.resolve();
    await resume.promise;
  };
  vi.mocked(filesystem.open).mockImplementation(async (...args) => {
    const handle = await actual.open(...args);
    if (args[1] === 'wx') await pause(String(args[0]));
    return handle;
  });
  vi.mocked(filesystem.link).mockImplementation(async (...args) => {
    await actual.link(...args);
    await pause(String(args[1]));
  });
  vi.mocked(filesystem.unlink).mockImplementation(async target => {
    if (String(target) === reaper && !removing) {
      recoveryChecked.resolve();
      await finishRecovery.promise;
    }
    if (String(target) === filename && !removing) {
      removing = true;
      ownerChecked.resolve();
      await finishRemoval.promise;
    }
    return actual.unlink(target);
  });
  const first = withProjectWriteLock(root, async () => { overlap ||= writerActive; }, { now: () => now })
    .then(() => null, error => error);
  await Promise.race([created.promise, first.then(error => { throw error ?? new Error('Reaper did not pause'); })]);
  now += 31_000;
  const second = withProjectWriteLock(root, async () => {
    writerActive = true;
    writerEntered.resolve();
    await releaseWriter.promise;
    writerActive = false;
  }, { timeoutMs: 200, retryMs: 2, now: () => now }).then(() => null, error => error);
  try {
    const recovered = await Promise.race([recoveryChecked.promise.then(() => true), second.then(() => false)]);
    if (recovered) {
      // 2026-11-12: stop both removals after validation to expose a late unlink of the next writer's lock.
      resume.resolve();
      await ownerChecked.promise;
      finishRecovery.resolve();
      await writerEntered.promise;
      finishRemoval.resolve();
      await first;
    } else {
      expect(await second).toMatchObject({ status: 503, saved: false });
      expect(JSON.parse(await readFile(reaper, 'utf8')).pid).toBe(process.pid);
    }
  } finally {
    resume.resolve();
    finishRecovery.resolve();
    finishRemoval.resolve();
    releaseWriter.resolve();
    await Promise.all([first, second]);
  }
  expect(overlap).toBe(false);
  expect(await first).toBeNull();
  expect(await withProjectWriteLock(root, async () => 'next writer')).toBe('next writer');
});

it('keeps an unpublished owner private while another writer acquires the lock', async () => {
  await prepareCoordinationDirectory();
  const filename = await projectCacheFile(root, 'write');
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  const created = deferred();
  const resume = deferred();
  const entered = deferred();
  const release = deferred();
  let paused = false;
  let now = Date.now();
  vi.mocked(filesystem.open).mockImplementation(async (...args) => {
    const handle = await actual.open(...args);
    if (String(args[0]).startsWith(`${filename}.`) && args[1] === 'wx' && !paused) {
      paused = true;
      created.resolve();
      await resume.promise;
    }
    return handle;
  });
  const mutate = vi.fn(async () => {});
  const first = withProjectWriteLock(root, mutate, { timeoutMs: 0, now: () => now }).catch(error => error);
  await created.promise;
  now += 31_000;
  const second = withProjectWriteLock(root, async () => { entered.resolve(); await release.promise; }, { now: () => now });
  try {
    await entered.promise;
    const successor = await readFile(filename);
    resume.resolve();
    expect(await first).toMatchObject({ status: 503, saved: false });
    expect(mutate).not.toHaveBeenCalled();
    expect(await readFile(filename)).toEqual(successor);
  } finally {
    resume.resolve();
    release.resolve();
    await Promise.all([first, second]);
  }
  expect(await filesystem.readdir(path.dirname(filename))).toEqual([]);
});

it.each(['', '.reap', '.reap.reap'])('recovers after the publisher of write%s dies between link and temporary cleanup', async suffix => {
  const dead = spawnSync(process.execPath, ['-e', ''], { windowsHide: true });
  expect(dead.status).toBe(0);
  const { filename, bytes } = await lockOwner(dead.pid);
  if (!suffix) await rm(filename);
  if (suffix === '.reap.reap') await writeFile(`${filename}.reap`, bytes, { mode: 0o600 });
  const target = `${filename}${suffix}`;
  const script = `
    import filesystem from 'node:fs/promises';
    import { syncBuiltinESMExports } from 'node:module';
    import { withProjectWriteLock } from ${JSON.stringify(new URL('../server/write-lock.ts', import.meta.url).href)};
    const link = filesystem.link;
    filesystem.link = async (...args) => {
      await link(...args);
      if (args[1] === process.argv[2]) {
        const resumed = new Promise(resolve => process.once('message', resolve));
        process.send('published');
        await resumed;
      }
    };
    syncBuiltinESMExports();
    await withProjectWriteLock(process.argv[1], async () => {}, { staleMs: 0 });
    process.disconnect();
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script, root, target],
    { windowsHide: true, timeout: 10_000, killSignal: 'SIGKILL', stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  const closed = new Promise<number | null>(resolve => child.once('close', resolve));
  children.push({ child, closed });
  let stderr = '';
  child.stderr!.on('data', chunk => { stderr += String(chunk); });
  await new Promise<void>((resolve, reject) => {
    child.on('message', message => { if (message === 'published') resolve(); });
    child.once('error', reject);
    child.once('close', code => reject(new Error(`Publisher exited before its barrier (${code}): ${stderr}`)));
  });
  const published = await projectCache.readCoordinationFile(target, { volatile: true });
  expect(published!.stat.nlink).toBe(2n);
  expect(JSON.parse(published!.bytes.toString('utf8')).pid).toBe(child.pid);
  child.kill('SIGKILL');
  await closed;
  expect(await withProjectWriteLock(root, async () => 'recovered', { staleMs: 0 })).toBe('recovered');
  for (const name of [filename, `${filename}.reap`, `${filename}.reap.reap`]) {
    await expect(readFile(name)).rejects.toMatchObject({ code: 'ENOENT' });
  }
});

it.each(['bytes', 'mtime'])('rechecks incomplete owner %s after acquiring the recovery guard', async changed => {
  const now = Date.UTC(2026, 10, 12);
  const { filename } = await lockOwner(process.pid);
  await writeFile(filename, '');
  const old = new Date(now - 1000);
  await utimes(filename, old, old);
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  let injected = false;
  vi.mocked(filesystem.link).mockImplementation(async (...args) => {
    if (String(args[1]) === `${filename}.reap` && !injected) {
      injected = true;
      if (changed === 'bytes') {
        await writeFile(filename, JSON.stringify({ pid: process.pid, startedAt: now, token: 'successor' }));
        await utimes(filename, old, old);
      } else {
        await utimes(filename, new Date(now), new Date(now));
      }
    }
    return actual.link(...args);
  });
  const mutate = vi.fn();
  await expect(withProjectWriteLock(root, mutate, { timeoutMs: 20, retryMs: 2, staleMs: 100, now: () => now }))
    .rejects.toMatchObject({ status: 503, saved: false });
  expect(mutate).not.toHaveBeenCalled();
  expect(injected).toBe(true);
  expect(await readFile(filename, 'utf8')).toEqual(changed === 'bytes'
    ? expect.stringContaining('successor') : '');
});

it.each(['EPERM', 'EACCES', 'EBUSY'])('retries %s from exclusive publication and owner reads instead of failing', async code => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  const { filename } = await lockOwner(process.pid);
  let attempts = 0;
  let released = false;
  let readFailed = false;
  vi.mocked(filesystem.open).mockImplementation(async (...args) => {
    if (String(args[0]) === filename && !readFailed) {
      readFailed = true;
      throw Object.assign(new Error('Busy'), { code });
    }
    return actual.open(...args);
  });
  vi.mocked(filesystem.link).mockImplementation(async (...args) => {
    if (String(args[1]) === filename && attempts++ < 2) throw Object.assign(new Error('Busy'), { code });
    if (!released) { released = true; await rm(filename); }
    return actual.link(...args);
  });
  const mutate = vi.fn(async () => 'written');
  expect(await withProjectWriteLock(root, mutate, { timeoutMs: 200, retryMs: 2 })).toBe('written');
  expect(mutate).toHaveBeenCalledTimes(1);
  expect(attempts).toBeGreaterThanOrEqual(3);
  expect(readFailed).toBe(true);
});

it('turns persistent permission contention into an unsaved 503 at the deadline', async () => {
  vi.mocked(filesystem.open).mockRejectedValue(Object.assign(new Error('Busy'), { code: 'EPERM' }));
  try {
    await expect(withProjectWriteLock(root, async () => {}, { timeoutMs: 10, retryMs: 2 }))
      .rejects.toMatchObject({ status: 503, saved: false });
  } finally { vi.mocked(filesystem.open).mockReset(); }
});

it.runIf(process.platform === 'win32').each(['EPERM', 'EACCES', 'EBUSY'])('retries temporary cleanup after %s without stranding a published owner', async code => {
  const filename = await projectCacheFile(root, 'write');
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  let failed = false;
  vi.mocked(filesystem.unlink).mockImplementation(async target => {
    if (String(target).endsWith('.tmp') && !failed) {
      failed = true;
      expect(JSON.parse(await readFile(filename, 'utf8')).pid).toBe(process.pid);
      throw Object.assign(new Error('Busy'), { code });
    }
    return actual.unlink(target);
  });
  const mutate = vi.fn(async () => 'written');
  expect(await withProjectWriteLock(root, mutate, { timeoutMs: 0 })).toBe('written');
  expect(failed).toBe(true);
  expect(mutate).toHaveBeenCalledOnce();
  expect(await filesystem.readdir(path.dirname(filename))).toEqual([]);
});

it('does not enter or remove a successor if the published owner was replaced', async () => {
  await prepareCoordinationDirectory();
  const filename = await projectCacheFile(root, 'write');
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  const successor = JSON.stringify({ pid: process.pid, startedAt: Date.now(), token: 'successor' });
  let replaced = false;
  vi.mocked(filesystem.link).mockImplementation(async (...args) => {
    await actual.link(...args);
    if (String(args[1]) === filename && !replaced) {
      replaced = true;
      await actual.unlink(filename);
      await actual.writeFile(filename, successor, { mode: 0o600 });
    }
  });
  const mutate = vi.fn(async () => {});
  await expect(withProjectWriteLock(root, mutate)).rejects.toMatchObject({ status: 503, saved: false });
  expect(mutate).not.toHaveBeenCalled();
  expect(await readFile(filename, 'utf8')).toBe(successor);
});

it('keeps a successor lock when ownership changes during a saved operation', async () => {
  const filename = await projectCacheFile(root, 'write');
  const successor = JSON.stringify({ pid: process.pid, startedAt: Date.now(), token: 'successor' });
  await expect(withProjectWriteLock(root, async () => {
    await rm(filename);
    await writeFile(filename, successor, { mode: 0o600 });
  })).rejects.toMatchObject({ status: 503, saved: true });
  expect(await readFile(filename, 'utf8')).toBe(successor);
});

it('does not let a reaper paused after removal unlink a published successor', async () => {
  const child = spawnSync(process.execPath, ['-e', ''], { windowsHide: true });
  expect(child.status).toBe(0);
  const { filename } = await lockOwner(child.pid);
  const reaper = `${filename}.reap`;
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  const removed = deferred();
  const resume = deferred();
  const entered = deferred();
  const release = deferred();
  const waiting = deferred();
  let paused = false;
  let writerActive = false;
  vi.mocked(filesystem.unlink).mockImplementation(async target => {
    await actual.unlink(target);
    if (String(target) === filename && !paused) {
      paused = true;
      removed.resolve();
      await resume.promise;
    }
  });
  vi.mocked(filesystem.link).mockImplementation(async (...args) => {
    try { await actual.link(...args); }
    catch (error) {
      if (args[1] === filename && writerActive) waiting.resolve();
      throw error;
    }
  });
  const first = withProjectWriteLock(root, async () => { expect(writerActive).toBe(false); });
  await removed.promise;
  const second = withProjectWriteLock(root, async () => {
    writerActive = true;
    entered.resolve();
    await release.promise;
    writerActive = false;
  });
  try {
    await entered.promise;
    const successor = await readFile(filename);
    expect(JSON.parse(await readFile(reaper, 'utf8')).pid).toBe(process.pid);
    resume.resolve();
    await waiting.promise;
    expect(await readFile(filename)).toEqual(successor);
  } finally {
    resume.resolve();
    release.resolve();
    await Promise.all([first, second]);
  }
});

it('closes an exclusively opened owner handle if its initial metadata read fails', async () => {
  const filename = await projectCacheFile(root, 'write');
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  const closed = vi.fn();
  vi.mocked(filesystem.open).mockImplementation(async (...args) => {
    const handle = await actual.open(...args);
    if (String(args[0]).startsWith(`${filename}.`) && args[1] === 'wx') {
      vi.spyOn(handle, 'stat').mockRejectedValueOnce(Object.assign(new Error('Metadata read failed'), { code: 'EIO' }));
      const close = handle.close.bind(handle);
      vi.spyOn(handle, 'close').mockImplementation(async () => { await close(); closed(); });
    }
    return handle;
  });
  const mutate = vi.fn(async () => {});
  await expect(withProjectWriteLock(root, mutate)).rejects.toMatchObject({ saved: false });
  expect(mutate).not.toHaveBeenCalled();
  expect(closed).toHaveBeenCalledOnce();
  expect(await filesystem.readdir(path.dirname(filename))).toEqual([]);
});
