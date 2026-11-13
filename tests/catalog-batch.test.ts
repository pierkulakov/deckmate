import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../server/app.ts';
import { callAgentTool, type AgentProject } from '../server/agent-ops.ts';
import { writeCatalogBatch } from '../server/cli-write.ts';
import { CatalogError, CatalogService } from '../server/catalog-service.ts';
import { emptyManifest, readProjectCatalog, renderCatalogManifest } from '../server/catalog.ts';
import * as nativeCards from '../server/native-cards.ts';
import { ProjectIndex } from '../server/project-index.ts';
import * as catalogModule from '../server/catalog.ts';
import * as timers from 'node:timers/promises';
import { readWholeActivity } from '../server/activity.ts';
import type { CatalogEdit } from '../src/catalog-contracts.ts';
import { prepareCardOptionsPatch, readCardOptions } from '../server/card-options.ts';
import { withProjectWriteLock } from '../server/write-lock.ts';
import { tempProjects } from './helpers/temp-projects.ts';

vi.mock('node:timers/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:timers/promises')>();
  return { ...actual, setTimeout: vi.fn(actual.setTimeout) };
});

let directory: string;
let project: AgentProject;
const projects = tempProjects('deckmate-catalog-batch-');
const apps: FastifyInstance[] = [];
const seedId = 'card:11111111-1111-4111-8111-111111111111';

beforeEach(async () => {
  directory = await projects.create();
  const root = path.join(directory, 'project');
  await mkdir(path.join(root, 'tasks'), { recursive: true });
  vi.stubEnv('DECKMATE_COORDINATION', path.join(directory, 'coordination'));
  vi.stubEnv('DECKMATE_INDEX', path.join(directory, 'index'));
  const manifest = emptyManifest();
  manifest.formatLanguage = 'en';
  manifest.members = [{ id: 'agent', label: 'Agent', kind: 'agent', aliases: [] }];
  manifest.spaces = [{ id: 'work', title: 'Work' }];
  manifest.decks = [{ id: 'inbox', title: 'Inbox', spaceId: 'work', kind: 'mixed', description: '', color: '#123456', icon: 'box' }];
  manifest.inboxDeckId = 'inbox';
  manifest.deckOrder = { inbox: { flatOrder: [seedId] } };
  await writeFile(path.join(root, 'tasks/deckmate.md'), renderCatalogManifest(manifest));
  await nativeCards.createManagedMarkdown(root, `cards/${seedId.slice(5)}.md`, {
    deckmate: 'card', schema: 1, id: seedId.slice(5), kind: 'task', title: 'Seed', state: 'not-started',
    deckId: 'inbox', parentId: null, trackIds: [], owner: null,
  }, 'Unchanged bytes.\n');
  project = { root, source: 'sandbox', config: { dataRoot: root, writeRoot: root, editMode: 'direct',
    projectName: 'Batch', port: 4396, python: 'python' } };
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(Object.assign(new TypeError('Offline'), { cause: { code: 'ECONNREFUSED' } }));
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const app of apps.splice(0)) await app.close();
  vi.unstubAllEnvs();
  await projects.removeAll();
});

async function connect() {
  const app = await createApp(project.config);
  apps.push(app);
  const requests: string[] = [];
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    requests.push(`${init?.method ?? 'GET'} ${url.pathname}`);
    const response = await app.inject({ url: url.pathname + url.search, method: init?.method === 'POST' ? 'POST' : 'GET',
      headers: { host: `127.0.0.1:${project.config.port}`, ...Object.fromEntries(new Headers(init?.headers)) },
      payload: init?.body as string | undefined });
    return new Response(response.body, { status: response.statusCode });
  });
  return { app, requests };
}

function create(index: number, manifestHash: string): Extract<CatalogEdit, { action: 'create-card' }> {
  return { action: 'create-card', cardId: `card:22222222-2222-4222-8222-${String(index).padStart(12, '0')}`,
    manifestHash, kind: 'task', title: `Карточка ${index}`, markdown: `Тело ${index}.\n`, deckId: 'inbox',
    parentId: null, trackIds: [], owner: null, effort: null, priority: null };
}

it('reads native files once for planning and once per locked chunk, and reuses one index', async () => {
  const read = vi.spyOn(nativeCards, 'readNativeCards');
  const sessions = vi.spyOn(CatalogService.prototype, 'withWriteSession');
  const index = vi.spyOn(ProjectIndex.prototype, 'replace');
  const close = vi.spyOn(CatalogService.prototype, 'close');
  const before = await readFile(path.join(project.root, `cards/${seedId.slice(5)}.md`));
  const result = await callAgentTool(project, 'create_cards', { member: 'agent', cards: Array.from({ length: 10 }, (_, i) => ({
    title: `Новая ${i}`, body: `Содержимое ${i}.\n`, key: `batch-${i}`,
  })) });
  expect(result.failed).toEqual([]);
  expect(result.created).toHaveLength(10);
  expect(read.mock.calls.filter(([, paths]) => paths === undefined)).toHaveLength(sessions.mock.calls.length + 1);
  expect(index).toHaveBeenCalledTimes(1);
  expect(new Set(index.mock.contexts).size).toBe(1);
  expect(close).toHaveBeenCalledTimes(1);
  expect(await readFile(path.join(project.root, `cards/${seedId.slice(5)}.md`))).toEqual(before);
  const view = await readProjectCatalog(project.root);
  expect(view.deckOrder?.inbox.flatOrder).toHaveLength(11);
  expect(new Set(view.deckOrder?.inbox.flatOrder).size).toBe(11);
  expect((await readWholeActivity(project.root)).events).toHaveLength(10);
});

it('uses one HTTP session and one POST for the whole batch', async () => {
  const { requests } = await connect();
  const result = await writeCatalogBatch(project.config, project.source, 'agent', [1, 2, 3].map(i => hash => create(i, hash)));
  expect(result).toEqual([1, 2, 3].map(() => ({ ok: true, via: 'server', warnings: [] })));
  expect(requests).toEqual(['GET /api/snapshot', 'GET /api/catalog', 'POST /api/catalog-batch']);
  expect((await readProjectCatalog(project.root)).deckOrder?.inbox.flatOrder).toHaveLength(4);
});

it.each(['files', 'server'] as const)('keeps validation failures per item and continues the batch via %s', async via => {
  if (via === 'server') await connect();
  const result = await writeCatalogBatch(project.config, project.source, 'agent', [
    hash => create(1, hash), hash => ({ ...create(2, hash), title: '' }), hash => create(3, hash),
  ]);
  expect(result.map(outcome => outcome.ok)).toEqual([true, false, true]);
  const view = await readProjectCatalog(project.root);
  expect(view.cards.map(card => card.title)).toEqual(expect.arrayContaining(['Карточка 1', 'Карточка 3']));
  expect(view.cards).toHaveLength(3);
  expect((await readWholeActivity(project.root)).events).toHaveLength(2);
});

it('handles duplicate keys without another write or losing the first outcome position', async () => {
  const result = await callAgentTool(project, 'create_cards', { member: 'agent', cards: [
    { title: 'Invalid', deck: 'missing' }, { title: 'One', key: 'one' }, { title: 'Two', key: 'two' },
    { title: 'Duplicate', key: 'two' }, { title: 'Duplicate again', key: 'one' },
  ] });
  expect(result.created.map(card => card.title)).toEqual(['One', 'Two']);
  expect(result.existing.map(card => card.title)).toEqual(['Two', 'One']);
  expect(result.failed.map(failure => failure.index)).toEqual([0]);
  expect((await readWholeActivity(project.root)).events).toHaveLength(2);
});

it.each(['files', 'server'] as const)('retries more than three unsaved manifest conflicts with exponential jitter via %s', async via => {
  if (via === 'server') await connect();
  const edit = vi.spyOn(catalogModule, 'editProjectCatalog');
  for (let i = 0; i < 4; i += 1) edit.mockImplementationOnce(async () => {
    const filename = path.join(project.root, 'tasks/deckmate.md');
    await writeFile(filename, await readFile(filename, 'utf8') + `\nExternal ${i}.\n`);
    throw new Error('CATALOG_CONFLICT');
  });
  vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0.25).mockReturnValueOnce(0.5).mockReturnValueOnce(0.75);
  const delay = vi.spyOn(timers, 'setTimeout').mockResolvedValue(undefined);
  const result = await writeCatalogBatch(project.config, project.source, 'agent', [hash => create(1, hash)]);
  expect(result).toEqual([{ ok: true, via, warnings: [] }]);
  expect(edit).toHaveBeenCalledTimes(5);
  expect(new Set(edit.mock.calls.map(([, item]) => item.manifestHash)).size).toBe(5);
  expect(delay.mock.calls.map(([ms]) => ms)).toEqual([10, 30, 80, 200]);
  expect((await readWholeActivity(project.root)).events).toHaveLength(1);
  expect(await readFile(path.join(project.root, 'tasks/deckmate.md'), 'utf8')).toContain('External 3.');
});

it('stops conflict retries at the lock budget without starting another attempt after the deadline', async () => {
  let now = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  vi.spyOn(Math, 'random').mockReturnValue(0.99);
  const edit = vi.spyOn(CatalogService.prototype, 'edit').mockImplementation(async () => {
    now += 2400;
    throw Object.assign(new CatalogError(409, 'Manifest moved'), { cause: new Error('CATALOG_CONFLICT') });
  });
  const delay = vi.spyOn(timers, 'setTimeout').mockImplementation(async ms => { now += Number(ms); });
  const result = await writeCatalogBatch(project.config, project.source, 'agent', [hash => create(1, hash)]);
  expect(result).toMatchObject([{ ok: false, error: { status: 409, saved: false } }]);
  expect(edit).toHaveBeenCalledTimes(4);
  expect(delay.mock.calls.reduce((total, [ms]) => total + Number(ms), 0)).toBeLessThanOrEqual(400);
  expect((await readProjectCatalog(project.root)).cards).toHaveLength(1);
});

it.each(['files', 'server'] as const)('does not retry I/O or saved failures, and refreshes partially saved cards via %s', async via => {
  if (via === 'server') await connect();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const original = catalogModule.editProjectCatalog;
  const edit = vi.spyOn(catalogModule, 'editProjectCatalog')
    .mockRejectedValueOnce(Object.assign(new Error('private path'), { code: 'EACCES' }))
    .mockImplementationOnce(async (...args) => {
      await original(...args);
      throw Object.assign(new Error('CATALOG_CONFLICT'), { saved: true });
    });
  const result = await writeCatalogBatch(project.config, project.source, 'agent', [1, 2, 3].map(i => hash => create(i, hash)));
  expect(result.map(outcome => outcome.ok)).toEqual([false, true, true]);
  expect(result[1]).toMatchObject({ warnings: [expect.stringContaining('Some changes were saved')] });
  expect(edit).toHaveBeenCalledTimes(3);
  const view = await readProjectCatalog(project.root);
  expect(view.cards).toHaveLength(3);
  expect(view.deckOrder?.inbox.flatOrder).toHaveLength(3);
  expect((await readWholeActivity(project.root)).events).toHaveLength(2);
});

it('never retries an ambiguous HTTP batch or replays it against the files', async () => {
  const { requests } = await connect();
  const original = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    const response = await original(url, init);
    if (init?.method === 'POST') throw new Error('Response lost after saving');
    return response;
  });
  await expect(writeCatalogBatch(project.config, project.source, 'agent', [hash => create(1, hash)]))
    .rejects.toMatchObject({ status: 503, saved: true });
  expect(requests.filter(request => request.startsWith('POST'))).toEqual(['POST /api/catalog-batch']);
  expect((await readProjectCatalog(project.root)).cards).toHaveLength(2);
  expect((await readWholeActivity(project.root)).events).toHaveLength(1);
});

it.each(['files', 'server'] as const)('keeps sourceHash conflicts guarded while later items continue via %s', async via => {
  if (via === 'server') await connect();
  const initial = await readProjectCatalog(project.root);
  const sourceHash = initial.cards.find(card => card.id === seedId)!.sourceHash;
  const stale = vi.fn((manifestHash: string): CatalogEdit => ({ action: 'set-card-properties', cardId: seedId, sourceHash,
    manifestHash, owner: null, effort: 2, priority: 'low' }));
  const result = await writeCatalogBatch(project.config, project.source, 'agent', [
    manifestHash => ({ action: 'set-card-properties', cardId: seedId, sourceHash, manifestHash, owner: null, effort: 1, priority: 'high' }),
    stale, hash => create(1, hash),
  ]);
  expect(result.map(outcome => outcome.ok)).toEqual([true, false, true]);
  expect(stale).toHaveBeenCalledTimes(1);
  expect((await readProjectCatalog(project.root)).cards.find(card => card.id === seedId)).toMatchObject({ effort: 1, priority: 'high' });
});

it.each(['files', 'server'] as const)('returns saved cards and a warning if the batch index update fails via %s', async via => {
  if (via === 'server') {
    const { app } = await connect();
    await app.inject({ url: '/api/catalog', headers: { host: `127.0.0.1:${project.config.port}` } });
  }
  vi.spyOn(ProjectIndex.prototype, 'replace').mockImplementationOnce(() => { throw new Error('FTS unavailable'); });
  const result = await writeCatalogBatch(project.config, project.source, 'agent', [hash => create(1, hash)]);
  expect(result).toMatchObject([{ ok: true, via, warnings: [expect.stringContaining('search index was not updated')] }]);
  expect((await readProjectCatalog(project.root)).cards).toHaveLength(2);
  expect((await readWholeActivity(project.root)).events).toHaveLength(1);
});

it('keeps the batch route behind token, source and per-item content validation', async () => {
  const { app } = await connect();
  const headers = { host: `127.0.0.1:${project.config.port}` };
  const token = (await app.inject({ url: '/api/snapshot', headers })).json().token;
  const payload = { source: 'sandbox', edits: [create(1, '')] };
  expect((await app.inject({ method: 'POST', url: '/api/catalog-batch', headers, payload })).statusCode).toBe(403);
  const authenticated = { ...headers, 'x-deckmate-token': token };
  expect((await app.inject({ method: 'POST', url: '/api/catalog-batch', headers: authenticated,
    payload: { ...payload, source: 'live' } })).statusCode).toBe(403);
  const response = await app.inject({ method: 'POST', url: '/api/catalog-batch', headers: authenticated,
    payload: { ...payload, edits: [{ ...create(1, ''), title: 42 }] } });
  expect(response.statusCode).toBe(200);
  expect(response.json().outcomes).toEqual([{ ok: false, status: 400, saved: false, message: expect.any(String) }]);
  expect((await readProjectCatalog(project.root)).cards).toHaveLength(1);
  expect((await readWholeActivity(project.root)).events).toHaveLength(0);
});

it('rejects read-only and live batches before contacting a server', async () => {
  const builds = [vi.fn((hash: string) => create(1, hash))];
  await expect(writeCatalogBatch({ ...project.config, editMode: 'read-only' }, 'sandbox', 'agent', builds)).rejects.toMatchObject({ status: 403 });
  await expect(writeCatalogBatch(project.config, 'live', 'agent', builds)).rejects.toMatchObject({ status: 403 });
  expect(fetch).not.toHaveBeenCalled();
  expect(builds[0]).not.toHaveBeenCalled();
});

it.each(['files', 'server'] as const)('preserves an external Hand edit between batch items via %s', async via => {
  const manifest = emptyManifest();
  manifest.formatLanguage = 'en';
  manifest.members = ['agent', 'other'].map(id => ({ id, label: id, kind: 'agent' as const, aliases: [] }));
  manifest.spaces = [{ id: 'work', title: 'Work' }];
  manifest.decks = [{ id: 'inbox', title: 'Inbox', spaceId: 'work', kind: 'mixed', description: '', color: '#123456', icon: 'box' }];
  await writeFile(path.join(project.root, 'tasks/deckmate.md'), renderCatalogManifest(manifest));
  if (via === 'server') await connect();
  const original = catalogModule.editProjectCatalog;
  let inserted = false;
  vi.spyOn(catalogModule, 'editProjectCatalog').mockImplementation(async (...args) => {
    const paths = await original(...args);
    if (!inserted) {
      inserted = true;
      const options = await readCardOptions(project.root);
      await (await prepareCardOptionsPatch(project.root, options.hash, { [seedId]: { handMemberIds: ['other'] } })).publish();
    }
    return paths;
  });
  const sourceHash = (await readProjectCatalog(project.root)).cards.find(card => card.id === seedId)!.sourceHash;
  const result = await writeCatalogBatch(project.config, project.source, 'agent', [
    hash => create(1, hash), manifestHash => ({ action: 'set-card-state', cardId: seedId, sourceHash, manifestHash, state: 'started' }),
  ]);
  expect(result.every(item => item.ok)).toBe(true);
  expect((await readCardOptions(project.root)).options[seedId].handMemberIds).toEqual(['other', 'agent']);
});

it.each(['files', 'server'] as const)('yields a long batch to a waiting independent writer via %s', async via => {
  if (via === 'server') await connect();
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  let notify!: () => void;
  const firstSaved = new Promise<void>(resolve => { notify = resolve; });
  const visits: string[] = [];
  const other = new CatalogService(project.config, ':memory:');
  const competitor = firstSaved.then(() => withProjectWriteLock(project.root, async () => {
    await other.edit(create(99, (await readProjectCatalog(project.root)).manifestHash), project.source, 'agent');
    visits.push('independent');
  }));
  const original = CatalogService.prototype.edit;
  vi.spyOn(CatalogService.prototype, 'edit').mockImplementation(async function (this: CatalogService, ...args) {
    const result = await original.apply(this, args);
    if (this !== other) {
      now += 600;
      visits.push('batch');
      notify();
    }
    return result;
  });
  try {
    const result = await writeCatalogBatch(project.config, project.source, 'agent', Array.from({ length: 8 }, (_, i) => hash => create(i, hash)));
    expect(result.every(item => item.ok)).toBe(true);
    await competitor;
    // 2026-11-13: the waiting writer must get the lock before the batch ends; which chunk lets it in depends on
    // timer scheduling between the two writers, and on Linux CI that was once the fifth edit rather than the fourth.
    expect(visits.indexOf('independent')).toBeGreaterThan(0);
    expect(visits.indexOf('independent')).toBeLessThan(visits.length - 1);
    expect((await readProjectCatalog(project.root)).cards).toHaveLength(10);
    expect((await readWholeActivity(project.root)).events).toHaveLength(9);
  } finally { await competitor; await other.close(); }
});

it('yields the local mutation queue to a UI write between timed batch chunks', async () => {
  const service = new CatalogService(project.config, ':memory:');
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  let notify!: () => void;
  const firstSaved = new Promise<void>(resolve => { notify = resolve; });
  const visits: string[] = [];
  const ui = firstSaved.then(() => service.recordMutation('ui', async () => {
    visits.push('ui');
    return service.edit(create(99, (await readProjectCatalog(project.root)).manifestHash), project.source);
  }));
  const original = service.edit.bind(service);
  vi.spyOn(service, 'edit').mockImplementation(async (...args) => {
    const result = await original(...args);
    if ('cardId' in args[0] && args[0].cardId !== create(99, '').cardId) {
      now += 600;
      visits.push('batch');
      notify();
    }
    return result;
  });
  try {
    const result = await service.editBatch(Array.from({ length: 8 }, (_, i) => hash => create(i, hash)), project.source);
    await ui;
    expect(result.outcomes.every(item => item.ok)).toBe(true);
    expect(visits.indexOf('ui')).toBeLessThanOrEqual(3);
    expect((await readProjectCatalog(project.root)).deckOrder?.inbox.flatOrder).toHaveLength(10);
  } finally { await ui; await service.close(); }
});

it('keeps saved:true when a later batch chunk cannot acquire its lock', async () => {
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const original = CatalogService.prototype.edit;
  vi.spyOn(CatalogService.prototype, 'edit').mockImplementation(async function (this: CatalogService, ...args) {
    const result = await original.apply(this, args);
    now += 1100;
    return result;
  });
  const session = CatalogService.prototype.withWriteSession;
  vi.spyOn(CatalogService.prototype, 'withWriteSession')
    .mockImplementationOnce(session).mockRejectedValueOnce(new CatalogError(503, 'Lock refused'));
  await expect(writeCatalogBatch(project.config, project.source, 'agent', [1, 2].map(i => hash => create(i, hash))))
    .rejects.toMatchObject({ status: 503, saved: true });
  expect((await readProjectCatalog(project.root)).cards).toHaveLength(2);
  expect((await readWholeActivity(project.root)).events).toHaveLength(1);
});
