import { afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { appendFile, mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { FastifyInstance } from 'fastify';
import { writeCatalog } from '../server/cli-write.ts';
import { createApp } from '../server/app.ts';
import { emptyManifest, readProjectCatalog, renderCatalogManifest } from '../server/catalog.ts';
import { localIsoDate } from '../src/catalog-hand.ts';
import { readCardContent } from '../server/card-content.ts';
import { readWholeActivity } from '../server/activity.ts';
import type { ServerConfig } from '../server/config.ts';
import { createManagedMarkdown } from '../server/native-cards.ts';
import * as cardProperties from '../server/card-properties.ts';
import type { CatalogEdit } from '../src/catalog-contracts.ts';
import { shortReference } from '../src/references.ts';
import { run as runReport } from '../tools/commands/report.ts';
import { run as runState } from '../tools/commands/state.ts';
import { tempProjects } from './helpers/temp-projects.ts';

const python = vi.hoisted(() => ({ calls: [] as string[][], fail: false }));
vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const { promisify } = await import('node:util');
  const execute = promisify(actual.execFile);
  const execFile = Object.assign(vi.fn(actual.execFile), {
    [promisify.custom]: async (...args: Parameters<typeof execute>) => {
      if (args[0] !== 'fixture-python') return execute(...args);
      python.calls.push([...(args[1] as string[])]);
      if (python.fail) throw Object.assign(new Error('Rebuild failed'), { stdout: 'private-stdout', stderr: 'private-stderr' });
      return { stdout: '', stderr: '' };
    },
  });
  return { ...actual, execFile };
});

const execute = promisify(execFile);
const temps = tempProjects('deckmate-cli-write-');
const apps: Array<{ app: FastifyInstance; closed: Promise<void> }> = [];
const port = 4392;
const taskId = 'task:features/example.md#1.1';
const headers = { host: `127.0.0.1:${port}` };

afterEach(async () => {
  python.calls = [];
  python.fail = false;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const { app, closed } of apps.splice(0)) {
    const snapshot = (await app.inject({ url: '/api/snapshot', headers })).json();
    const response = await app.inject({ method: 'POST', url: '/api/shutdown', headers: { ...headers, 'x-deckmate-token': snapshot.token } });
    expect(response.statusCode).toBe(200);
    await closed;
    await app.close();
  }
  vi.unstubAllEnvs();
  await temps.removeAll();
});

async function fixture() {
  const root = await temps.create();
  vi.stubEnv('DECKMATE_COORDINATION', path.join(root, '.coordination'));
  await mkdir(path.join(root, 'features'));
  await mkdir(path.join(root, 'tasks'));
  await writeFile(path.join(root, 'features/example.md'), '\uFEFF# Example\r\n## 1 — Work\r\nIntro.\r\n'
    + '### 1.1 First (план)\r\nOriginal body.\r\n\r\n### 1.2 Neighbour (приёмка)\r\nKeep these bytes.\r\n');
  const manifest = emptyManifest();
  manifest.spaces.push({ id: 'work', title: 'Work' });
  manifest.decks.push({ id: 'work', spaceId: 'work', title: 'Work', kind: 'mixed', description: '', icon: 'box', color: '#123456' });
  manifest.members = [{ id: 'codex', label: 'Codex', kind: 'agent', aliases: [] }];
  manifest.membership.push({ card: taskId, deck: 'work' });
  await writeFile(path.join(root, 'tasks/deckmate.md'), renderCatalogManifest(manifest));
  const config: ServerConfig = { editMode: 'direct', dataRoot: root, writeRoot: root, projectName: 'CLI test', port, python: 'python' };
  const catalog = await readProjectCatalog(root);
  const content = await readCardContent(root, taskId);
  const edit = { action: 'update-card-content' as const, ...content, markdown: content.markdown + 'Added report text.\r\n\r\n', manifestHash: catalog.manifestHash };
  return { root, config, edit };
}

function offline() {
  return vi.spyOn(globalThis, 'fetch').mockRejectedValue(Object.assign(new TypeError('fetch failed'), {
    cause: Object.assign(new Error('No listener'), { code: 'ECONNREFUSED' }),
  }));
}

async function connect(config: ServerConfig) {
  const app = await createApp(config);
  const closed = new Promise<void>(resolve => { app.addHook('onClose', async () => { resolve(); }); });
  apps.push({ app, closed });
  const requests: Array<{ url: string; method: string; headers: Headers }> = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    const requestHeaders = new Headers(init?.headers);
    requests.push({ url: url.pathname, method: init?.method ?? 'GET', headers: requestHeaders });
    const response = await app.inject({ url: url.pathname + url.search, method: init?.method === 'POST' ? 'POST' : 'GET',
      headers: { ...headers, ...Object.fromEntries(requestHeaders) }, payload: init?.body as string | undefined });
    return new Response(response.body, { status: response.statusCode });
  });
  return requests;
}

it('reuses the offline service, preserves neighbouring bytes and records one attributed event', async () => {
  const { root, config, edit } = await fixture();
  offline();
  const filename = path.join(root, 'features/example.md');
  const before = await readFile(filename);
  const result = await writeCatalog(config, 'sandbox', edit, 'codex');
  expect(result).toEqual({ warnings: [], via: 'files' });
  const after = await readFile(filename);
  const addition = Buffer.from('Added report text.\r\n\r\n');
  const offset = after.indexOf(addition);
  expect(offset).toBeGreaterThan(0);
  expect(Buffer.concat([after.subarray(0, offset), after.subarray(offset + addition.length)])).toEqual(before);
  expect((await readProjectCatalog(root)).cards.find(card => card.id === taskId)?.state).toBe('not-started');
  const activity = await readWholeActivity(root);
  expect(activity.events).toHaveLength(1);
  expect(activity.events[0].actorMemberId).toBe('codex');
});

it.each(['files', 'server'] as const)('runs project Python only through the application HTTP service, not offline (%s)', async via => {
  const { root, config, edit } = await fixture();
  await mkdir(path.join(root, 'Tools'));
  await writeFile(path.join(root, 'Tools/board.py'), '# Project code must not run offline\n');
  config.python = 'fixture-python';
  if (via === 'server') await connect(config); else offline();
  python.calls = [];
  const result = await writeCatalog(config, 'sandbox', edit, 'codex');
  if (via === 'files') {
    expect(python.calls).toEqual([]);
    expect(result.warnings.join(' ')).toContain('board rebuild skipped; open the project in Deckmate to rebuild');
  } else {
    expect(python.calls).toEqual([
      ['-B', expect.stringContaining('rebuild-board.py'), root],
      ['-B', path.join(root, 'Tools/board.py'), '--check'],
    ]);
    expect(result.warnings).toEqual([]);
  }
  expect(await readFile(path.join(root, 'features/example.md'), 'utf8')).toContain('Added report text.');
});

it('keeps failed rebuild stdout/stderr in the process log, not in the HTTP warning', async () => {
  const { root, config, edit } = await fixture();
  await mkdir(path.join(root, 'Tools'));
  await writeFile(path.join(root, 'Tools/board.py'), '# fixture\n');
  config.python = 'fixture-python';
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  await connect(config);
  python.fail = true;
  const result = await writeCatalog(config, 'sandbox', edit, 'codex');
  expect(result.warnings.join(' ')).toContain('board was not rebuilt');
  expect(JSON.stringify(result)).not.toContain('private-');
  expect(log).toHaveBeenCalledWith('Deckmate: board rebuild failed', expect.objectContaining({ stdout: 'private-stdout', stderr: 'private-stderr' }));
});

it.each(['files', 'server'] as const)('does not report an unsaved failure after encountering an external Tools junction via %s', async via => {
  const { root, config, edit } = await fixture();
  const outside = await temps.create();
  await writeFile(path.join(outside, 'board.py'), '# Must not execute\n');
  if (via === 'server') await connect(config); else offline();
  await symlink(outside, path.join(root, 'Tools'), process.platform === 'win32' ? 'junction' : 'dir');
  config.python = 'fixture-python';
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const result = await writeCatalog(config, 'sandbox', edit, 'codex');
  expect(result.warnings.join(' ')).toContain(via === 'files' ? 'board rebuild skipped' : 'board was not rebuilt');
  expect(python.calls).toEqual([]);
  expect(await readFile(path.join(root, 'features/example.md'), 'utf8')).toContain('Added report text.');
});

it('sends the session token and actor through the real API and matches offline bytes and events', async () => {
  const local = await fixture();
  offline();
  await writeCatalog(local.config, 'sandbox', local.edit, 'codex');
  vi.restoreAllMocks();
  const remote = await fixture();
  const requests = await connect(remote.config);
  expect((await writeCatalog(remote.config, 'sandbox', remote.edit, 'codex')).via).toBe('server');
  expect(await readFile(path.join(remote.root, 'features/example.md'))).toEqual(await readFile(path.join(local.root, 'features/example.md')));
  const writes = requests.filter(request => request.method === 'POST');
  expect(writes).toHaveLength(1);
  expect(writes[0].headers.get('x-deckmate-token')).toMatch(/^[0-9a-f]{64}$/u);
  expect(writes[0].headers.get('x-deckmate-actor')).toBe('codex');
  const events = (await readWholeActivity(remote.root)).events;
  expect(events).toHaveLength(1);
  expect(events[0].actorMemberId).toBe('codex');
});

it.each(['files', 'server'] as const)('creates an Unassigned card without a deck through the shared CLI service via %s', async via => {
  const { root, config } = await fixture();
  if (via === 'server') await connect(config); else offline();
  const catalog = await readProjectCatalog(root);
  const cardId = 'card:33333333-3333-4333-8333-333333333333';
  const manifest = await readFile(path.join(root, 'tasks/deckmate.md'));
  const result = await writeCatalog(config, 'sandbox', { action: 'create-card', manifestHash: catalog.manifestHash,
    cardId, kind: 'task', title: 'Captured', markdown: '', deckId: null, parentId: null, trackIds: [], owner: null, effort: null, priority: null }, 'codex');
  expect(result).toEqual({ warnings: [], via });
  expect((await readProjectCatalog(root)).cards.find(card => card.id === cardId)).toMatchObject({ deckId: null });
  expect(await readFile(path.join(root, 'tasks/deckmate.md'))).toEqual(manifest);
});

it.each(['files', 'server'] as const)('rejects a stale sourceHash with 409 and no writes via %s', async via => {
  const { root, config, edit } = await fixture();
  if (via === 'server') await connect(config); else offline();
  const filename = path.join(root, 'features/example.md');
  const changed = Buffer.concat([await readFile(filename), Buffer.from('\r\nExternal edit.\r\n')]);
  await writeFile(filename, changed);
  await expect(writeCatalog(config, 'sandbox', edit, 'codex')).rejects.toMatchObject({ status: 409 });
  expect(await readFile(filename)).toEqual(changed);
  expect((await readWholeActivity(root)).events).toHaveLength(0);
});

it('enforces read-only, live and sandbox branch guards before contacting a server', async () => {
  const { root, config, edit } = await fixture();
  const fetch = offline();
  await expect(writeCatalog({ ...config, editMode: 'read-only' }, 'sandbox', edit, null)).rejects.toMatchObject({ status: 403 });
  await expect(writeCatalog(config, 'live', edit, null)).rejects.toMatchObject({ status: 403 });
  await expect(writeCatalog({ ...config, editMode: 'sandbox' }, 'sandbox', edit, null)).rejects.toMatchObject({ status: 403 });
  expect(fetch).not.toHaveBeenCalled();
  await execute('git', ['init', '-b', 'freetion/sandbox', root], { windowsHide: true });
  expect((await writeCatalog({ ...config, editMode: 'sandbox' }, 'sandbox', edit, null)).via).toBe('files');
});

it('writes files when a legacy server on the configured port has a different project, without a POST', async () => {
  const { root, config, edit } = await fixture();
  const before = await readFile(path.join(root, 'features/example.md'));
  const fetch = vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(Response.json({ token: 'token' }))
    .mockResolvedValueOnce(Response.json({ rootIdentity: 'another-project' }));
  await expect(writeCatalog(config, 'sandbox', edit, null)).resolves.toEqual({ via: 'files', warnings: [] });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(await readFile(path.join(root, 'features/example.md'))).not.toEqual(before);
});

it.each([403, 409, 422, 503])('keeps HTTP %s errors and never falls back to files', async status => {
  const { root, config, edit } = await fixture();
  const before = await readFile(path.join(root, 'features/example.md'));
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ message: 'Server refused' }, { status }));
  await expect(writeCatalog(config, 'sandbox', edit, null)).rejects.toMatchObject({ status });
  expect(await readFile(path.join(root, 'features/example.md'))).toEqual(before);
});

it('does not retry an ambiguous POST failure or a probe timeout', async () => {
  const { root, config, edit } = await fixture();
  const before = await readFile(path.join(root, 'features/example.md'));
  const fetch = vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(Response.json({ token: 'token' }))
    .mockResolvedValueOnce(Response.json({ rootIdentity: createHash('sha256').update(await realpath(root)).digest('hex') }))
    .mockRejectedValueOnce(new Error('Connection lost after POST'));
  await expect(writeCatalog(config, 'sandbox', edit, null)).rejects.toMatchObject({ status: 503, saved: true });
  expect(fetch).toHaveBeenCalledTimes(3);
  fetch.mockRejectedValueOnce(new DOMException('Timed out', 'TimeoutError'));
  await expect(writeCatalog(config, 'sandbox', edit, null)).rejects.toMatchObject({ name: 'TimeoutError' });
  expect(await readFile(path.join(root, 'features/example.md'))).toEqual(before);
});

const heroId = 'hero:features/example.md#1';
const nativeId = 'card:8fea53d7-8366-4f0c-9ff9-88456399ca7b';
type ReportEdit = Extract<CatalogEdit, { action: 'add-card-report' }>;

async function reportFixture() {
  const fixtureData = await fixture();
  await createManagedMarkdown(fixtureData.root, `cards/${nativeId.slice(5)}.md`, {
    deckmate: 'card', schema: 1, id: nativeId.slice(5), kind: 'task', title: 'Native', state: 'план',
    owner: null, deckId: 'work', trackIds: [], parentId: null,
  }, 'Native body.\n');
  return fixtureData;
}

async function reportEdit(root: string, cardId = taskId, state?: ReportEdit['state']): Promise<ReportEdit> {
  const catalog = await readProjectCatalog(root);
  const card = catalog.cards.find(candidate => candidate.id === cardId)!;
  return { action: 'add-card-report', manifestHash: catalog.manifestHash, cardId,
    sourceHash: card.sourceHash, markdown: 'Report text.\n- Verified: 3/3.\n', ...(state === undefined ? {} : { state }) };
}

it.each(['files', 'server'] as const)('appends H4 reports on legacy Task, Hero and native via %s with one event each', async via => {
  const { root, config } = await reportFixture();
  if (via === 'server') await connect(config); else offline();
  for (const cardId of [taskId, heroId, nativeId]) {
    const catalog = await readProjectCatalog(root);
    const card = catalog.cards.find(candidate => candidate.id === cardId)!;
    const before = await readFile(path.join(root, card.path));
    const content = await readCardContent(root, cardId);
    const eventsBefore = (await readWholeActivity(root)).events.length;
    expect((await writeCatalog(config, 'sandbox', await reportEdit(root, cardId), 'codex')).via).toBe(via);
    const after = await readFile(path.join(root, card.path));
    const next = await readCardContent(root, cardId);
    expect(next.markdown.startsWith(content.markdown)).toBe(true);
    expect(next.markdown).toContain(`#### Report ${localIsoDate()} · codex`);
    const addedBytes = Buffer.from(next.markdown.slice(content.markdown.length));
    const offset = after.indexOf(addedBytes);
    expect(offset).toBeGreaterThan(0);
    expect(Buffer.concat([after.subarray(0, offset), after.subarray(offset + addedBytes.length)])).toEqual(before);
    expect((await readProjectCatalog(root)).cards.find(candidate => candidate.id === cardId)?.state).toBe(card.state);
    const events = (await readWholeActivity(root)).events;
    expect(events.length - eventsBefore).toBe(1);
    expect(events.at(-1)).toMatchObject({ action: 'add-card-report', actorMemberId: 'codex', cards: [{ id: cardId }] });
  }
});

it.each(['files', 'server'] as const)('reports and changes Task state in one mutation/event via %s', async via => {
  const { root, config } = await reportFixture();
  if (via === 'server') await connect(config); else offline();
  for (const cardId of [taskId, nativeId]) {
    const eventsBefore = (await readWholeActivity(root)).events.length;
    await writeCatalog(config, 'sandbox', await reportEdit(root, cardId, 'приёмка'), 'codex');
    expect((await readProjectCatalog(root)).cards.find(card => card.id === cardId)?.state).toBe('review');
    const events = (await readWholeActivity(root)).events;
    expect(events.length - eventsBefore).toBe(1);
    expect(events.at(-1)?.transitions).toEqual([{ cardId, from: 'not-started', to: 'review' }]);
  }
});

it.each(['files', 'server'] as const)('rejects stale report hashes with 409 and zero changed bytes/events via %s', async via => {
  const { root, config } = await fixture();
  const edit = await reportEdit(root);
  if (via === 'server') await connect(config); else offline();
  const filename = path.join(root, 'features/example.md');
  await appendFile(filename, '\r\nForeign edit.\r\n');
  const before = await readFile(filename);
  await expect(writeCatalog(config, 'sandbox', edit, 'codex')).rejects.toMatchObject({ status: 409 });
  expect(await readFile(filename)).toEqual(before);
  expect((await readWholeActivity(root)).events).toHaveLength(0);
});

it.each(['files', 'server'] as const)('restores exact original card bytes if the state cannot be written via %s', async via => {
  const { root, config } = await fixture();
  const edit = await reportEdit(root, taskId, 'итерация');
  const filename = path.join(root, 'features/example.md');
  const before = await readFile(filename);
  if (via === 'server') await connect(config); else offline();
  // 2026-11-05: no iterations.md; this fails after appending the report and before publishing the state.
  await expect(writeCatalog(config, 'sandbox', edit, 'codex')).rejects.toMatchObject({ status: 422 });
  expect(await readFile(filename)).toEqual(before);
  expect((await readWholeActivity(root)).events).toHaveLength(0);
});

it('does not overwrite an external edit when guarded rollback cannot restore the card', async () => {
  const { root, config } = await fixture();
  const filename = path.join(root, 'features/example.md');
  offline();
  vi.spyOn(cardProperties, 'updateLegacyCardState').mockImplementationOnce(async () => {
    await appendFile(filename, '\r\nForeign edit after report.\r\n');
    throw new Error('CARD_CONFLICT');
  });
  const result = await writeCatalog(config, 'sandbox', await reportEdit(root, taskId, 'приёмка'), 'codex');
  expect(result.warnings.join(' ')).toContain('Read the card before retrying');
  expect(await readFile(filename, 'utf8')).toContain('Foreign edit after report.');
  expect((await readCardContent(root, taskId)).markdown).toContain('#### Report');
  expect((await readWholeActivity(root)).events).toHaveLength(1);
});

it.each([null, 'missing'])('rejects unregistered report actor %s before any write', async actor => {
  const { root, config } = await fixture();
  const before = await readFile(path.join(root, 'features/example.md'));
  offline();
  await expect(writeCatalog(config, 'sandbox', await reportEdit(root), actor)).rejects.toMatchObject({ status: 422 });
  expect(await readFile(path.join(root, 'features/example.md'))).toEqual(before);
  expect((await readWholeActivity(root)).events).toHaveLength(0);
});

it('rejects Hero state and denied guardian acceptance without leaving a report', async () => {
  const { root, config } = await fixture();
  offline();
  const filename = path.join(root, 'features/example.md');
  const before = await readFile(filename);
  await expect(writeCatalog(config, 'sandbox', await reportEdit(root, heroId, 'приёмка'), 'codex')).rejects.toMatchObject({ status: 422 });
  // 2026-11-05: use a different registered member from the deck guardian.
  const current = await readProjectCatalog(root);
  await writeCatalog(config, 'sandbox', { action: 'configure-members', manifestHash: current.manifestHash,
    members: [...current.members!, { id: 'other', label: 'Other', kind: 'agent', aliases: [] }] }, 'codex');
  const guarded = await readProjectCatalog(root);
  await writeCatalog(config, 'sandbox', { action: 'set-deck-guardians', manifestHash: guarded.manifestHash,
    deckId: 'work', guardianIds: ['codex'] }, 'codex');
  const eventsBefore = (await readWholeActivity(root)).events.length;
  await expect(writeCatalog(config, 'sandbox', await reportEdit(root, taskId, 'принято'), 'other')).rejects.toMatchObject({ status: 422 });
  expect(await readFile(filename)).toEqual(before);
  expect((await readWholeActivity(root)).events).toHaveLength(eventsBefore);
});

it.each(['# Outside card\nText', 'Title\n=====\nText', '```md\nUnclosed fence'])('rejects a report that would cross legacy boundaries: %s', async markdown => {
  const { root, config } = await fixture();
  const before = await readFile(path.join(root, 'features/example.md'));
  offline();
  await expect(writeCatalog(config, 'sandbox', { ...await reportEdit(root), markdown }, 'codex')).rejects.toMatchObject({ status: 422 });
  expect(await readFile(path.join(root, 'features/example.md'))).toEqual(before);
  expect((await readWholeActivity(root)).events).toHaveLength(0);
});

it('keeps fenced heading examples, repeated reports and same-state reports inside the legacy body', async () => {
  const { root, config } = await fixture();
  offline();
  for (const report of ['First report.\n```md\n# An example, not a section\n```', 'Second report.']) {
    await writeCatalog(config, 'sandbox', { ...await reportEdit(root, taskId, 'план'), markdown: report }, 'codex');
  }
  const content = await readCardContent(root, taskId);
  expect(content.markdown.match(/^#### Report /gmu)).toHaveLength(2);
  expect(content.markdown).toContain('# An example, not a section');
  expect(content.markdown.indexOf('First report.')).toBeLessThan(content.markdown.indexOf('Second report.'));
  expect((await readWholeActivity(root)).events).toHaveLength(2);
});

it('runs report --file --member --state through one write with a c-ref', async () => {
  const { root, config } = await reportFixture();
  const reportPath = path.join(root, 'input-report.md');
  await writeFile(reportPath, '\uFEFFПроверено: 3/3.\n');
  const requests = await connect(config);
  const output = vi.spyOn(console, 'log').mockImplementation(() => {});
  await runReport({ root, config, source: 'sandbox', catalog: await readProjectCatalog(root) }, [shortReference('c', nativeId)],
    new Map([['file', reportPath], ['member', 'codex'], ['state', 'приёмка']]));
  expect(requests.filter(request => request.method === 'POST')).toHaveLength(1);
  expect(JSON.parse(output.mock.calls[0][0])).toMatchObject({ id: nativeId, via: 'server', requestedState: 'review' });
  expect((await readCardContent(root, nativeId)).markdown).toContain('Проверено: 3/3.');
  expect((await readWholeActivity(root)).events).toHaveLength(1);
});

it('keeps report writes behind read-only, live and sandbox guards', async () => {
  const { root, config } = await fixture();
  const edit = await reportEdit(root);
  const fetch = offline();
  await expect(writeCatalog({ ...config, editMode: 'read-only' }, 'sandbox', edit, 'codex')).rejects.toMatchObject({ status: 403 });
  await expect(writeCatalog(config, 'live', edit, 'codex')).rejects.toMatchObject({ status: 403 });
  await expect(writeCatalog({ ...config, editMode: 'sandbox' }, 'sandbox', edit, 'codex')).rejects.toMatchObject({ status: 403 });
  expect(fetch).not.toHaveBeenCalled();
  await execute('git', ['init', '-b', 'freetion/sandbox', root], { windowsHide: true });
  await writeCatalog({ ...config, editMode: 'sandbox' }, 'sandbox', edit, 'codex');
  expect((await readWholeActivity(root)).events).toHaveLength(1);
});

it('preserves existing mixed line endings when appending a legacy report', async () => {
  const { root, config } = await fixture();
  const filename = path.join(root, 'features/example.md');
  await writeFile(filename, (await readFile(filename, 'utf8')).replace('Original body.\r\n', 'Original body.\n'));
  const before = await readFile(filename);
  offline();
  await writeCatalog(config, 'sandbox', await reportEdit(root), 'codex');
  const after = await readFile(filename);
  const split = before.indexOf(Buffer.from('### 1.2'));
  expect(after.subarray(0, split)).toEqual(before.subarray(0, split));
  expect(after.subarray(after.indexOf(Buffer.from('### 1.2')))).toEqual(before.subarray(split));
  expect((await readWholeActivity(root)).events).toHaveLength(1);
});

it('uses the native YAML opening newline for the report hash despite mixed header line endings', async () => {
  const { root, config } = await reportFixture();
  const filename = path.join(root, `cards/${nativeId.slice(5)}.md`);
  const text = await readFile(filename, 'utf8');
  const secondNewline = text.indexOf('\n', text.indexOf('\n') + 1);
  await writeFile(filename, text.slice(0, secondNewline) + '\r' + text.slice(secondNewline));
  offline();
  const result = await writeCatalog(config, 'sandbox', await reportEdit(root, nativeId, 'приёмка'), 'codex');
  expect(result.warnings).toEqual([]);
  expect((await readProjectCatalog(root)).cards.find(card => card.id === nativeId)?.state).toBe('review');
  expect((await readCardContent(root, nativeId)).markdown).toContain('#### Report');
  expect((await readWholeActivity(root)).events).toHaveLength(1);
});

async function runCommand(command: typeof runReport, root: string, config: ServerConfig, positionals: string[], options: Record<string, string>) {
  const output = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    await command({ root, config, source: 'sandbox', catalog: await readProjectCatalog(root) }, positionals, new Map(Object.entries(options)));
    return JSON.parse(output.mock.calls.at(-1)![0] as string);
  } finally { output.mockRestore(); }
}

// 2026-11-06: brief reads a report up to the next heading of level 1–4; a native card would accept such a heading
// silently and leave the rest of the report as loose card text.
it('report --file refuses headings that would leave the #### Report block and keeps deeper ones inside it', async () => {
  const { root, config } = await reportFixture();
  offline();
  const ref = shortReference('c', nativeId);
  const filename = path.join(root, `cards/${nativeId.slice(5)}.md`);
  const reportPath = path.join(root, 'input-report.md');
  const before = await readFile(filename);
  for (const heading of ['# Summary', '## Not checked', 'Summary\n=======', '#### Report 2026-11-06 · codex']) {
    await writeFile(reportPath, `${heading}\nText.\n`);
    await expect(runCommand(runReport, root, config, [ref], { file: reportPath, member: 'codex' })).rejects.toThrow('use ##### or deeper');
  }
  expect(await readFile(filename)).toEqual(before);
  expect((await readWholeActivity(root)).events).toHaveLength(0);
  await writeFile(reportPath, '##### Summary\nChecked: 3/3.\n\n##### Not checked\n- none.\n');
  await runCommand(runReport, root, config, [ref], { file: reportPath, member: 'Codex', state: 'review' });
  const markdown = (await readCardContent(root, nativeId)).markdown;
  expect(markdown.slice(markdown.indexOf('#### Report '))).toContain('##### Not checked\n- none.');
  expect((await readProjectCatalog(root)).cards.find(card => card.id === nativeId)?.state).toBe('review');
});

it('state returns a reviewed card only with a reason and lets another member accept it', async () => {
  const { root, config } = await reportFixture();
  offline();
  const current = await readProjectCatalog(root);
  await writeCatalog(config, 'sandbox', { action: 'configure-members', manifestHash: current.manifestHash,
    members: [...current.members!, { id: 'maya', label: 'Maya', kind: 'human', aliases: [] }] }, 'codex');
  await writeCatalog(config, 'sandbox', await reportEdit(root, nativeId, 'review'), 'codex');
  const ref = shortReference('c', nativeId);
  const filename = path.join(root, `cards/${nativeId.slice(5)}.md`);
  const before = await readFile(filename);
  const eventsBefore = (await readWholeActivity(root)).events.length;
  await expect(runCommand(runState, root, config, [ref, 'started'], { member: 'maya' })).rejects.toThrow('--reason');
  await expect(runCommand(runState, root, config, [ref, 'done'], { member: 'nobody' })).rejects.toThrow('Members: codex, maya.');
  expect(await readFile(filename)).toEqual(before);
  expect((await readWholeActivity(root)).events).toHaveLength(eventsBefore);
  const reason = 'Exit code: required nonzero, actual 0; fix the scene check; verify npm test.';
  expect(await runCommand(runState, root, config, [ref, 'started'], { member: 'maya', reason }))
    .toMatchObject({ id: nativeId, from: 'review', state: 'started', via: 'files' });
  expect((await readWholeActivity(root)).events.at(-1)).toMatchObject({ actorMemberId: 'maya',
    transitions: [{ cardId: nativeId, from: 'review', to: 'started', reason }] });
  await writeCatalog(config, 'sandbox', await reportEdit(root, nativeId, 'review'), 'codex');
  await runCommand(runState, root, config, [ref, 'принято'], { member: 'Maya' });
  expect((await readProjectCatalog(root)).cards.find(card => card.id === nativeId)?.state).toBe('done');
  expect((await readWholeActivity(root)).events.at(-1)).toMatchObject({ actorMemberId: 'maya',
    transitions: [{ cardId: nativeId, from: 'review', to: 'done' }] });
});
