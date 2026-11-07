import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../server/app.ts';
import { assertWritable, loadConfig, type ServerConfig } from '../server/config.ts';
import { emptyManifest, readProjectCatalog, renderCatalogManifest } from '../server/catalog.ts';
import * as fileEvents from '../server/file-events.ts';

const executeFile = promisify(execFile);
const temporaryRoots: string[] = [];
const applications: FastifyInstance[] = [];
const headers = { host: '127.0.0.1:4382' };
const scene = { type: 'excalidraw', version: 2, elements: [], appState: {}, files: {} };

beforeEach(() => {
  for (const prefix of ['DECKMATE_', 'FREETION_']) {
    for (const suffix of ['DATA', 'WRITE', 'READ_ONLY', 'PORT', 'HOST', 'INDEX', 'PROJECT_NAME', 'PYTHON']) {
      vi.stubEnv(prefix + suffix, undefined);
    }
  }
});

afterEach(async () => {
  for (const application of applications.splice(0)) await application.close();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const directory of temporaryRoots.splice(0)) {
    const resolved = path.resolve(directory);
    if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith('deckmate-edit-modes-')) {
      throw new Error('Unsafe edit-mode fixture cleanup target.');
    }
    await rm(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

async function fixture() {
  const temporary = await mkdtemp(path.join(tmpdir(), 'deckmate-edit-modes-'));
  temporaryRoots.push(temporary);
  const project = path.join(temporary, 'project');
  await mkdir(path.join(project, 'tasks'), { recursive: true });
  const manifest = emptyManifest();
  manifest.spaces = [{ id: 'work', title: 'Work' }];
  manifest.decks = [{ id: 'tasks', spaceId: 'work', title: 'Tasks', kind: 'task', icon: 'box', color: '#123456', description: '' }];
  manifest.members = [{ id: 'reviewer', label: 'Reviewer', kind: 'human', aliases: [] }];
  await writeFile(path.join(project, 'tasks/deckmate.md'), renderCatalogManifest(manifest));
  vi.stubEnv('DECKMATE_DATA', project);
  vi.stubEnv('DECKMATE_PORT', '4382');
  vi.stubEnv('DECKMATE_INDEX', path.join(temporary, 'index'));
  return { temporary, project: await realpath(project) };
}

async function open(config: ServerConfig) {
  const application = await createApp(config);
  applications.push(application);
  const snapshot = (await application.inject({ url: '/api/snapshot', headers })).json();
  return { application, snapshot, authorized: { ...headers, 'x-deckmate-token': snapshot.token } };
}

function newCard(manifestHash: string) {
  return { source: 'sandbox', action: 'create-card', manifestHash, cardId: 'card:' + randomUUID(), kind: 'task',
    title: 'Direct edit', markdown: 'Written in the project folder.\n', deckId: 'tasks', trackIds: [], parentId: null,
    owner: null, effort: null, priority: null };
}

async function projectBytes(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  async function visit(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(filename);
      else result[path.relative(root, filename)] = (await readFile(filename)).toString('base64');
    }
  }
  await visit(root);
  return result;
}

it('defaults to direct without git and lets read-only override even an invalid write path', async () => {
  const { temporary, project } = await fixture();
  const config = await loadConfig();
  expect(config).toMatchObject({ editMode: 'direct', dataRoot: project, writeRoot: project });
  expect(await assertWritable(config)).toBe(project);
  expect(await readdir(project)).not.toContain('.git');
  await expect(assertWritable(config, 'live')).rejects.toMatchObject({ status: 403 });
  vi.stubEnv('DECKMATE_READ_ONLY', '1');
  vi.stubEnv('DECKMATE_WRITE', path.join(temporary, 'does-not-exist'));
  const readOnly = await loadConfig();
  expect(readOnly).toMatchObject({ editMode: 'read-only', dataRoot: project, writeRoot: null });
  await expect(assertWritable(readOnly)).rejects.toMatchObject({ status: 403 });
});

it('rejects sandbox roots inside the project and rechecks the branch before writing', async () => {
  const { temporary, project } = await fixture();
  const nested = path.join(project, 'nested');
  await mkdir(nested);
  for (const invalidRoot of [project, nested]) {
    vi.stubEnv('DECKMATE_WRITE', invalidRoot);
    await expect(loadConfig()).rejects.toThrow('separate copy');
  }
  const sandbox = path.join(temporary, 'sandbox');
  await mkdir(sandbox);
  await executeFile('git', ['init', '-b', 'deckmate/sandbox', sandbox], { windowsHide: true });
  vi.stubEnv('DECKMATE_WRITE', sandbox);
  const config = await loadConfig();
  expect(config.editMode).toBe('sandbox');
  expect(await assertWritable(config)).toBe(await realpath(sandbox));
  await executeFile('git', ['-C', sandbox, 'symbolic-ref', 'HEAD', 'refs/heads/main'], { windowsHide: true });
  await expect(assertWritable(config)).rejects.toMatchObject({ status: 403 });
});

it('loads legacy FREETION variables from a real .env.local as sandbox mode', async () => {
  const { temporary, project } = await fixture();
  const sandbox = path.join(temporary, 'legacy-sandbox');
  await mkdir(sandbox);
  await executeFile('git', ['init', '-b', 'freetion/sandbox', sandbox], { windowsHide: true });
  const envFile = path.join(temporary, '.env.local');
  const quoted = (value: string) => JSON.stringify(value.replaceAll('\\', '/'));
  await writeFile(envFile, `FREETION_DATA=${quoted(project)}\nFREETION_WRITE=${quoted(sandbox)}\nFREETION_PORT=4382\n`);
  const entry = path.join(temporary, 'load-config.mjs');
  await writeFile(entry, `import { loadConfig } from ${JSON.stringify(new URL('../server/config.ts', import.meta.url).href)};\nconsole.log(JSON.stringify(await loadConfig()));\n`);
  const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(?:DECKMATE|FREETION)_/u.test(name)));
  const result = await executeFile(process.execPath, ['--env-file=' + envFile, entry], { cwd: temporary, env: environment, windowsHide: true });
  expect(JSON.parse(result.stdout)).toMatchObject({ editMode: 'sandbox', dataRoot: project, writeRoot: await realpath(sandbox), port: 4382 });
});

it('creates and deletes a native card in the direct project without git or a sandbox', async () => {
  const { project } = await fixture();
  const { application, snapshot, authorized } = await open(await loadConfig());
  expect(snapshot).toMatchObject({ source: 'sandbox', writable: true, editMode: 'direct' });
  expect(snapshot).not.toHaveProperty('sandboxAvailable');
  expect((await application.inject({ url: '/api/snapshot?source=live', headers })).json()).toMatchObject({ source: 'sandbox', writable: true, editMode: 'direct' });
  const catalog = await readProjectCatalog(project);
  const payload = newCard(catalog.manifestHash);
  const created = await application.inject({ method: 'POST', url: '/api/catalog', headers: authorized, payload });
  expect(created.statusCode, created.body).toBe(200);
  const card = created.json().cards.find((candidate: { id: string }) => candidate.id === payload.cardId);
  expect(card).toBeDefined();
  expect(await readFile(path.join(project, 'cards', payload.cardId.slice(5) + '.md'), 'utf8')).toContain(payload.markdown);
  const deleted = await application.inject({ method: 'POST', url: '/api/catalog', headers: authorized, payload: {
    source: 'sandbox', action: 'bulk-edit-cards', manifestHash: created.json().manifestHash, optionsHash: created.json().optionsHash ?? '',
    cards: [{ cardId: card.id, sourceHash: card.sourceHash }], change: { kind: 'options', patch: { deleted: true } },
  } });
  expect(deleted.statusCode, deleted.body).toBe(200);
  expect((await readProjectCatalog(project)).cards.find(candidate => candidate.id === payload.cardId)?.deleted).toBe(true);
  expect(await readdir(project)).not.toContain('.git');
});

it('allows direct planning, boards and notification writes without branch checks', async () => {
  const { project } = await fixture();
  const { application, authorized } = await open(await loadConfig());
  const planning = await application.inject({ method: 'POST', url: '/api/planning', headers: authorized, payload: {
    source: 'sandbox', action: 'create-milestone', milestonesHash: '',
    milestone: { id: 'release', title: 'Release', date: '2030-12-31', color: '#123456' },
  } });
  expect(planning.statusCode, planning.body).toBe(200);
  expect(await readFile(path.join(project, 'tasks/deckmate-milestones.md'), 'utf8')).toContain('Release');
  const board = await application.inject({ method: 'POST', url: '/api/boards', headers: authorized,
    payload: { source: 'sandbox', title: 'Direct board', hash: '', scene } });
  expect(board.statusCode, board.body).toBe(200);
  expect(await readFile(path.join(project, 'boards', board.json().id + '.excalidraw'), 'utf8')).toContain('Direct board');
  const dismiss = await application.inject({ method: 'POST', url: '/api/notifications/dismiss', headers: authorized,
    payload: { source: 'sandbox', memberId: 'reviewer', stack: 'owned', at: '2026-11-05T12:00:00.000Z' } });
  expect(dismiss.statusCode, dismiss.body).toBe(200);
  expect(await readFile(path.join(project, 'tasks/deckmate-notifications.md'), 'utf8')).toContain('reviewer');
});

it('rejects every write route in read-only mode with 403 and preserves project bytes', async () => {
  const { project } = await fixture();
  vi.stubEnv('DECKMATE_READ_ONLY', '1');
  const before = await projectBytes(project);
  const { application, snapshot, authorized } = await open(await loadConfig());
  expect(snapshot).toMatchObject({ source: 'live', writable: false, editMode: 'read-only' });
  const card = newCard((await readProjectCatalog(project)).manifestHash);
  const requests = [
    { url: '/api/catalog', payload: card },
    { url: '/api/catalog', payload: { source: 'sandbox', action: 'upload-attachment', manifestHash: card.manifestHash,
      cardId: card.cardId, attachmentsHash: '', dataUrl: 'data:image/png;base64,aGVsbG8=' } },
    { url: '/api/planning', payload: { source: 'sandbox', action: 'create-milestone', milestonesHash: '',
      milestone: { id: 'release', title: 'Release', date: '2030-12-31', color: '#123456' } } },
    { url: '/api/boards', payload: { source: 'sandbox', title: 'Forbidden board', hash: '', scene } },
    { url: '/api/notifications/dismiss', payload: { source: 'sandbox', memberId: 'reviewer', stack: 'owned', at: '2026-11-05T12:00:00.000Z' } },
    { url: '/api/notifications/watch', payload: { source: 'sandbox', memberId: 'reviewer', cardId: card.cardId, watching: true, watchHash: '0'.repeat(64) } },
    { url: '/api/catalog-import', payload: { source: 'sandbox', manifestHash: card.manifestHash, optionsHash: '', deckId: 'tasks',
      cards: [{ cardId: null, kind: 'task', title: 'Forbidden import', markdown: '', owner: null, effort: null, priority: null, state: null, tags: [] }] } },
  ];
  for (const request of requests) {
    const response = await application.inject({ method: 'POST', headers: authorized, ...request });
    expect(response.statusCode, request.url + ': ' + response.body).toBe(403);
    expect(response.json().message).toMatch(/read.only/iu);
  }
  expect(await projectBytes(project)).toEqual(before);
});

it('keeps sandbox writes out of the original project and rejects live-source edits', async () => {
  const { temporary, project } = await fixture();
  const sandbox = path.join(temporary, 'sandbox');
  await mkdir(path.join(sandbox, 'tasks'), { recursive: true });
  await writeFile(path.join(sandbox, 'tasks/deckmate.md'), await readFile(path.join(project, 'tasks/deckmate.md')));
  await executeFile('git', ['init', '-b', 'deckmate/sandbox', sandbox], { windowsHide: true });
  vi.stubEnv('DECKMATE_WRITE', sandbox);
  const before = await projectBytes(project);
  const { application, snapshot, authorized } = await open(await loadConfig());
  expect(snapshot).toMatchObject({ editMode: 'sandbox', source: 'sandbox', writable: true });
  expect((await application.inject({ url: '/api/snapshot?source=live', headers })).json()).toMatchObject({ source: 'live', writable: false, editMode: 'sandbox' });
  const payload = newCard((await readProjectCatalog(sandbox)).manifestHash);
  const rejected = await application.inject({ method: 'POST', url: '/api/catalog', headers: authorized, payload: { ...payload, source: 'live' } });
  expect(rejected.statusCode, rejected.body).toBe(403);
  const created = await application.inject({ method: 'POST', url: '/api/catalog', headers: authorized, payload });
  expect(created.statusCode, created.body).toBe(200);
  expect(await readFile(path.join(sandbox, 'cards', payload.cardId.slice(5) + '.md'), 'utf8')).toContain(payload.title);
  expect(await projectBytes(project)).toEqual(before);
});

it('watches the direct root once and refreshes externally edited Markdown', async () => {
  const { project } = await fixture();
  await mkdir(path.join(project, 'features'));
  const watcher = vi.spyOn(fileEvents, 'watchProjectFiles');
  const { application } = await open(await loadConfig());
  expect(watcher).toHaveBeenCalledTimes(1);
  expect(watcher.mock.calls[0][0]).toBe(project);
  await application.inject({ url: '/api/catalog', headers });
  await writeFile(path.join(project, 'features/new.md'), '# New feature\n### 1.0 External edit\nExternal body.\n');
  await vi.waitFor(async () => {
    const catalog = (await application.inject({ url: '/api/catalog', headers })).json();
    expect(catalog.cards.some((card: { title: string }) => card.title === 'External edit')).toBe(true);
  }, { timeout: 3000, interval: 100 });
});
