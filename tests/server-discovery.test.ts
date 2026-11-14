import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../server/app.ts';
import { emptyManifest, readProjectCatalog, renderCatalogManifest } from '../server/catalog.ts';
import { writeCatalog } from '../server/cli-write.ts';
import type { ServerConfig } from '../server/config.ts';
import { prepareCoordinationDirectory, projectCacheDirectory, projectCoordinationDirectory, projectCacheFile } from '../server/project-cache.ts';
import { findRunningServer, registerRunningServer } from '../server/server-discovery.ts';
import * as discovery from '../server/server-discovery.ts';
import * as projectCache from '../server/project-cache.ts';
import { installShutdownHandlers } from '../server/shutdown.ts';

let directory: string;
const apps: FastifyInstance[] = [];
const execute = promisify(execFile);
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'deckmate-discovery-'));
  vi.stubEnv('DECKMATE_INDEX', path.join(directory, 'cache'));
  vi.stubEnv('DECKMATE_COORDINATION', path.join(directory, 'coordination'));
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const app of apps.splice(0)) await app.close();
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

async function fixture(name = 'project') {
  const root = path.join(directory, name);
  await mkdir(path.join(root, 'tasks'), { recursive: true });
  await writeFile(path.join(root, 'tasks/deckmate.md'), renderCatalogManifest(emptyManifest()));
  const config: ServerConfig = { dataRoot: root, writeRoot: root, editMode: 'direct', port: 4393, projectName: name, python: 'python' };
  const edit = { action: 'create-space' as const, title: 'Created', manifestHash: (await readProjectCatalog(root)).manifestHash };
  return { root, config, edit };
}

async function listen(config: ServerConfig) {
  const app = await createApp(config);
  apps.push(app);
  let resolveRegistration!: () => void;
  let rejectRegistration!: (error: unknown) => void;
  const registered = new Promise<void>((resolve, reject) => { resolveRegistration = resolve; rejectRegistration = reject; });
  const register = discovery.registerRunningServer;
  const registration = vi.spyOn(discovery, 'registerRunningServer').mockImplementationOnce(async (...args) => {
    try {
      const cleanup = await register(...args);
      resolveRegistration();
      return cleanup;
    } catch (error) { rejectRegistration(error); throw error; }
  });
  try {
    await app.listen({ host: '127.0.0.1', port: 0 });
    await registered;
  } finally { registration.mockRestore(); }
  expect(await findRunningServer(config.writeRoot ?? config.dataRoot)).not.toBeNull();
  return app;
}

it('registers the actual listening port in the coordination directory and removes it through graceful shutdown', async () => {
  const { root, config } = await fixture();
  const app = await listen(config);
  const address = app.server.address();
  expect(address).toMatchObject({ port: expect.any(Number) });
  const registration = await findRunningServer(root);
  expect(registration).toMatchObject({ port: typeof address === 'object' ? address?.port : null,
    pid: process.pid, version: expect.any(String), startedAt: expect.any(String) });
  expect(path.dirname(await projectCacheFile(root, 'server'))).toBe(projectCoordinationDirectory());
  expect(JSON.parse(await readFile(await projectCacheFile(root, 'server'), 'utf8'))).toEqual(registration);
  const exit = vi.fn();
  await installShutdownHandlers(app, { on: vi.fn(), exit })();
  expect(exit).toHaveBeenCalledWith(0);
  expect(await findRunningServer(root)).toBeNull();
  await expect(readFile(await projectCacheFile(root, 'server'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('registers the writable sandbox rather than the original project', async () => {
  const live = await fixture('live');
  const sandbox = await fixture('sandbox');
  const config = { ...live.config, editMode: 'sandbox' as const, writeRoot: sandbox.root };
  await listen(config);
  expect(await findRunningServer(live.root)).toBeNull();
  expect(await findRunningServer(sandbox.root)).toMatchObject({ pid: process.pid });
});

it('releases an acquired write lock when discovery is cancelled without replacing an existing registration', async () => {
  const { root, config } = await fixture();
  const cleanup = await registerRunningServer(config, root, 4393, 'existing');
  const filename = await projectCacheFile(root, 'server');
  const before = await readFile(filename);
  const cancellation = new AbortController();
  const publish = projectCache.publishCoordinationFile;
  vi.spyOn(projectCache, 'publishCoordinationFile').mockImplementationOnce(async (...args) => {
    const identity = await publish(...args);
    cancellation.abort();
    return identity;
  });
  await expect(registerRunningServer(config, root, 4394, 'cancelled', cancellation.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(await readFile(filename)).toEqual(before);
  await expect(readFile(await projectCacheFile(root, 'write'))).rejects.toMatchObject({ code: 'ENOENT' });
  await cleanup();
});

it('deletes a dead PID registration and treats EPERM as a live owner', async () => {
  const { root, config } = await fixture();
  const cleanup = await registerRunningServer(config, root, 4393, 'test');
  const filename = await projectCacheFile(root, 'server');
  const registration = JSON.parse(await readFile(filename, 'utf8'));
  const child = spawnSync(process.execPath, ['-e', ''], { windowsHide: true });
  expect(child.status).toBe(0);
  await writeFile(filename, JSON.stringify({ ...registration, pid: child.pid }));
  expect(await findRunningServer(root)).toBeNull();
  await expect(readFile(filename)).rejects.toMatchObject({ code: 'ENOENT' });
  await writeFile(filename, JSON.stringify(registration));
  vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('Denied'), { code: 'EPERM' }); });
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ app: 'Deckmate', pid: process.pid }));
  expect(await findRunningServer(root)).toEqual(registration);
  await cleanup();
});

it('does not remove a newer registration when the previous server closes', async () => {
  const { root, config } = await fixture();
  const old = await registerRunningServer(config, root, 4393, 'old');
  const current = await registerRunningServer(config, root, 4394, 'current');
  await old();
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ app: 'Deckmate', pid: process.pid }));
  expect(await findRunningServer(root)).toMatchObject({ port: 4394, version: 'current' });
  await current();
});

it('finds its project on another port and writes through HTTP', async () => {
  const { root, config, edit } = await fixture();
  await listen(config);
  const fetch = vi.spyOn(globalThis, 'fetch');
  expect(await writeCatalog(config, 'sandbox', edit, null)).toEqual({ via: 'server', warnings: [] });
  const registration = await findRunningServer(root);
  expect(fetch.mock.calls.every(([url]) => new URL(String(url)).port === String(registration!.port))).toBe(true);
  expect((await readProjectCatalog(root)).spaces).toHaveLength(1);
});

it('falls back to files for another legacy project on config.port', async () => {
  const local = await fixture('local');
  const remote = await fixture('remote');
  await listen(remote.config);
  const registration = (await findRunningServer(remote.root))!;
  await rm(await projectCacheFile(remote.root, 'server'));
  expect(await writeCatalog({ ...local.config, port: registration.port }, 'sandbox', local.edit, null))
    .toEqual({ via: 'files', warnings: [] });
  expect((await readProjectCatalog(local.root)).spaces).toHaveLength(1);
  expect((await readProjectCatalog(remote.root)).spaces).toHaveLength(0);
});

it('rejects a reused registered port by root identity, removes the stale entry and writes files', async () => {
  const local = await fixture('local');
  const remote = await fixture('remote');
  await listen(remote.config);
  const registration = (await findRunningServer(remote.root))!;
  await registerRunningServer(local.config, local.root, registration.port, 'stale');
  expect((await writeCatalog(local.config, 'sandbox', local.edit, null)).via).toBe('files');
  expect(await findRunningServer(local.root)).toBeNull();
  expect((await readProjectCatalog(remote.root)).spaces).toHaveLength(0);
});

it('allows only ECONNREFUSED to bypass a registered port, never a timeout or another network error', async () => {
  const { root, config, edit } = await fixture();
  const cleanup = await registerRunningServer(config, root, 4394, 'test');
  const before = await readFile(path.join(root, 'tasks/deckmate.md'));
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ app: 'Deckmate', pid: process.pid }));
  for (const error of [new DOMException('Timed out', 'TimeoutError'),
    Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } })]) {
    fetch.mockRejectedValueOnce(error);
    await expect(writeCatalog(config, 'sandbox', edit, null)).rejects.toBe(error);
    expect(await readFile(path.join(root, 'tasks/deckmate.md'))).toEqual(before);
    expect(await findRunningServer(root)).not.toBeNull();
  }
  fetch.mockRejectedValueOnce(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }));
  fetch.mockRejectedValueOnce(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }));
  expect((await writeCatalog(config, 'sandbox', edit, null)).via).toBe('files');
  expect(await findRunningServer(root)).toBeNull();
  await cleanup();
});

it.each([
  { app: 'OtherApp', pid: process.pid }, { app: 'Deckmate', pid: process.pid + 1 },
  { app: 'Deckmate', pid: String(process.pid) }, null,
])('rejects a forged endpoint identity %j before sending a token or mutation', async health => {
  const { root, config, edit } = await fixture();
  const cleanup = await registerRunningServer(config, root, config.port, 'forged');
  const before = await readFile(path.join(root, 'tasks/deckmate.md'));
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json(health));
  await expect(writeCatalog(config, 'sandbox', edit, null)).rejects.toMatchObject({ status: 502, saved: false });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toBe(`http://127.0.0.1:${config.port}/api/health`);
  expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: 'error', signal: expect.any(AbortSignal) });
  expect(await readFile(path.join(root, 'tasks/deckmate.md'))).toEqual(before);
  await cleanup();
});

it.each(['bad-json', 'http-error'])('fails closed on a %s health response', async failure => {
  const { root, config, edit } = await fixture();
  const cleanup = await registerRunningServer(config, root, config.port, 'test');
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => failure === 'bad-json'
    ? new Response('{') : Response.json({ app: 'Deckmate', pid: process.pid }, { status: 500 }));
  await expect(writeCatalog(config, 'sandbox', edit, null)).rejects.toMatchObject({ status: 502, saved: false });
  expect(fetch).toHaveBeenCalledTimes(1);
  await cleanup();
});

it('does not replay a registered server write after losing its response', async () => {
  const { root, config, edit } = await fixture();
  await listen(config);
  const originalFetch = globalThis.fetch;
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const response = await originalFetch(url, init);
    if (init?.method === 'POST') throw new Error('Response lost after save');
    return response;
  });
  await expect(writeCatalog(config, 'sandbox', edit, null)).rejects.toMatchObject({ status: 503, saved: true });
  expect(fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  expect((await readProjectCatalog(root)).spaces).toHaveLength(1);
});

it('uses one home-relative coordination directory independently of the SQLite index', async () => {
  const { root } = await fixture();
  vi.stubEnv('DECKMATE_COORDINATION', undefined);
  const filename = await projectCacheFile(root, 'write');
  expect(path.dirname(filename)).toBe(path.join(homedir(), '.cache', 'deckmate', 'coordination'));
  expect(projectCacheDirectory()).toBe(path.join(directory, 'cache'));
  vi.stubEnv('DECKMATE_INDEX', undefined);
  expect(await projectCacheFile(root, 'write')).toBe(filename);
});

it('lets a CLI process without DECKMATE_INDEX discover and write through a server with a private index', async () => {
  const { root, config, edit } = await fixture();
  await listen(config);
  const script = `
    import { writeCatalog } from ${JSON.stringify(new URL('../server/cli-write.ts', import.meta.url).href)};
    import { projectCacheFile } from ${JSON.stringify(new URL('../server/project-cache.ts', import.meta.url).href)};
    const config = JSON.parse(process.argv[1]);
    console.log(JSON.stringify({ lock: await projectCacheFile(config.writeRoot, 'write'),
      result: await writeCatalog(config, 'sandbox', JSON.parse(process.argv[2]), null) }));
  `;
  const env = { ...process.env };
  delete env.DECKMATE_INDEX;
  delete env.FREETION_INDEX;
  const { stdout } = await execute(process.execPath, ['--input-type=module', '-e', script, JSON.stringify(config), JSON.stringify(edit)],
    { env, windowsHide: true, timeout: 10_000 });
  expect(JSON.parse(stdout)).toEqual({ lock: await projectCacheFile(root, 'write'), result: { via: 'server', warnings: [] } });
  expect((await readProjectCatalog(root)).spaces).toHaveLength(1);
});

it.each(['unavailable-cache', 'held-lock'])('keeps listen and close successful when registration fails: %s', async failure => {
  const { root, config } = await fixture();
  const filename = await projectCacheFile(root, 'write');
  if (failure === 'unavailable-cache') {
    await writeFile(projectCoordinationDirectory(), 'not a directory');
  } else {
    await prepareCoordinationDirectory();
    await writeFile(filename, JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
  }
  const app = await createApp(config);
  apps.push(app);
  await app.listen({ host: '127.0.0.1', port: 0 });
  await expect(app.close()).resolves.toBeUndefined();
});

it.each(['broken-registration', 'held-lock'])('finishes graceful shutdown despite failed discovery cleanup: %s', async failure => {
  const { root, config } = await fixture();
  const app = await listen(config);
  if (failure === 'broken-registration') {
    const filename = await projectCacheFile(root, 'server');
    await rm(filename);
    await mkdir(filename);
  } else {
    await writeFile(await projectCacheFile(root, 'write'), JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
  }
  const exit = vi.fn();
  const started = Date.now();
  await installShutdownHandlers(app, { on: vi.fn(), exit })();
  expect(exit).toHaveBeenCalledWith(0);
  expect(Date.now() - started).toBeLessThan(1000);
});

it('does not register a read-only listener or replace a writable registration', async () => {
  const { root, config, edit } = await fixture();
  const app = await createApp({ ...config, editMode: 'read-only', writeRoot: null });
  apps.push(app);
  await app.listen({ host: '127.0.0.1', port: 0 });
  await expect(readFile(await projectCacheFile(root, 'server'))).rejects.toMatchObject({ code: 'ENOENT' });
  const writable = await listen(config);
  const registration = await findRunningServer(root);
  const cleanup = await registerRunningServer({ ...config, editMode: 'read-only' }, root, 4394, 'read-only');
  await cleanup();
  await app.close();
  expect(await findRunningServer(root)).toEqual(registration);
  expect((await writeCatalog(config, 'sandbox', edit, null)).via).toBe('server');
  await writable.close();
});
