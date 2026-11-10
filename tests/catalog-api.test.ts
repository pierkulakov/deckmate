import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../server/app.ts';
import { CatalogService } from '../server/catalog-service.ts';
import { ProjectIndex } from '../server/project-index.ts';
import { emptyManifest, renderCatalogManifest } from '../server/catalog.ts';
import type { ServerConfig } from '../server/config.ts';
import { shortReference } from '../src/references.ts';
import { appendActivity } from '../server/activity.ts';

const execute = promisify(execFile);
const roots: string[] = [];
const apps: FastifyInstance[] = [];
const headers = { host: '127.0.0.1:44318' };
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'deckmate-catalog-api-'));
  roots.push(directory);
  const root = path.join(directory, 'data');
  await mkdir(root);
  for (const name of ['features', 'tasks', 'Tools']) await mkdir(path.join(root, name));
  await writeFile(path.join(root, 'features/match.md'), '# Матч\n## 1 — Бой\n### 1.0 Звук выстрела (план)\nТело.\n');
  await writeFile(path.join(root, 'tasks/iterations.md'), '## Итерация 1 — Проверка\nНачало: 2026-11-03\n');
  await writeFile(path.join(root, 'Tools/board.py'), '# Read-only startup fixture\n');
  const manifest = emptyManifest();
  manifest.spaces.push({ id: 'work', title: 'Работа' });
  manifest.decks.push({ id: 'audio', spaceId: 'work', title: 'Звук', kind: 'task', icon: 'audio', color: '#ff990a', description: '' });
  manifest.membership.push({ card: 'task:features/match.md#1.0', deck: 'audio' });
  await writeFile(path.join(root, 'tasks/deckmate.md'), renderCatalogManifest(manifest));
  await execute('git', ['init', '-b', 'deckmate/sandbox', root], { windowsHide: true });
  const config: ServerConfig = { editMode: 'sandbox', dataRoot: root, writeRoot: root, projectName: 'Тест', port: 44318, python: 'python' };
  return { root, directory, config };
}

it('serves indexed queries, serializes catalog edits, rejects live writes, stale hashes and missing tokens', async () => {
  const { root, config } = await fixture();
  const sourceBefore = await readFile(path.join(root, 'features/match.md'));
  const app = await createApp(config);
  apps.push(app);
  const snapshot = (await app.inject({ url: '/api/snapshot', headers })).json();
  const authorized = { ...headers, 'x-deckmate-token': snapshot.token };
  const catalog = (await app.inject({ url: '/api/catalog', headers })).json();
  const search = await app.inject({ url: '/api/cards?text=' + encodeURIComponent('Звук') + '&deckId=audio&kind=task', headers });
  expect(search.statusCode).toBe(200);
  expect(search.json().map((card: { id: string }) => card.id)).toEqual(['task:features/match.md#1.0']);
  expect((await app.inject({ url: '/api/cards?limit=1001', headers })).statusCode).toBe(400);
  const payload = { action: 'create-track', title: 'Анимация', description: '', manifestHash: catalog.manifestHash, source: 'sandbox' };
  expect((await app.inject({ method: 'POST', url: '/api/catalog', headers, payload })).statusCode).toBe(403);
  expect((await app.inject({ method: 'POST', url: '/api/catalog', headers: authorized, payload: { ...payload, source: 'live' } })).statusCode).toBe(403);
  expect((await app.inject({ method: 'POST', url: '/api/catalog', headers: authorized, payload: { action: 'create-track', manifestHash: '', source: 'sandbox' } })).statusCode).toBe(400);
  const results = await Promise.all([1, 2].map(() => app.inject({ method: 'POST', url: '/api/catalog', headers: authorized, payload })));
  expect(results.map(result => result.statusCode).sort()).toEqual([200, 409]);
  expect((await app.inject({ url: '/api/catalog', headers })).json().tracks).toHaveLength(1);
  expect(await readFile(path.join(root, 'features/match.md'))).toEqual(sourceBefore);
});

it('validates move-space fields and returns the reordered spaces with unchanged decks', async () => {
  const { config } = await fixture();
  const app = await createApp(config);
  apps.push(app);
  const snapshot = (await app.inject({ url: '/api/snapshot', headers })).json();
  const authorized = { ...headers, 'x-deckmate-token': snapshot.token };
  let catalog = (await app.inject({ url: '/api/catalog', headers })).json();
  const post = (edit: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/catalog', headers: authorized,
    payload: { source: 'sandbox', manifestHash: catalog.manifestHash, ...edit } });
  catalog = (await post({ action: 'create-space', title: 'QA' })).json();
  const qa = catalog.spaces[1].id;
  const decks = catalog.decks;
  for (const fields of [{ spaceId: qa }, { beforeSpaceId: null }, { spaceId: qa, beforeSpaceId: {} }]) {
    expect((await post({ action: 'move-space', ...fields })).statusCode).toBe(400);
  }
  const stale = catalog.manifestHash;
  const response = await post({ action: 'move-space', spaceId: qa, beforeSpaceId: 'work' });
  expect(response.statusCode, response.body).toBe(200);
  catalog = response.json();
  expect(catalog.spaces.map((space: { id: string }) => space.id)).toEqual([qa, 'work']);
  expect(catalog.decks).toEqual(decks);
  expect((await post({ action: 'move-space', spaceId: qa, beforeSpaceId: null, manifestHash: stale })).statusCode).toBe(409);
  const end = await post({ action: 'move-space', spaceId: qa, beforeSpaceId: null });
  expect(end.statusCode, end.body).toBe(200);
  expect(end.json().spaces.map((space: { id: string }) => space.id)).toEqual(['work', qa]);
});

it('validates Space deletion, localizes refusals, guards freshness and allows deleting the last Space', async () => {
  const { root, config } = await fixture();
  const app = await createApp(config);
  apps.push(app);
  const snapshot = (await app.inject({ url: '/api/snapshot', headers })).json();
  const authorized = { ...headers, 'x-deckmate-token': snapshot.token };
  let catalog = (await app.inject({ url: '/api/catalog', headers })).json();
  const post = (edit: Record<string, unknown>, lang = 'en') => app.inject({ method: 'POST', url: '/api/catalog',
    headers: { ...authorized, cookie: `deckmate-lang=${lang}` }, payload: { source: 'sandbox', manifestHash: catalog.manifestHash, ...edit } });
  catalog = (await post({ action: 'create-space', title: 'Knowledge' })).json();
  const spaceId = catalog.spaces[1].id;
  const filename = path.join(root, 'tasks/deckmate.md');
  const before = await readFile(filename);
  const files = await readdir(path.join(root, 'tasks'));
  for (const fields of [{}, { spaceId: {} }]) expect((await post({ action: 'delete-space', ...fields })).statusCode).toBe(400);
  for (const lang of ['en', 'ru']) {
    const response = await post({ action: 'delete-space', spaceId: 'work' }, lang);
    expect(response.statusCode, response.body).toBe(422);
    expect(response.json().message).toBe(lang === 'en' ? "Move or delete this space's decks first" : 'Сначала перенесите или удалите колоды этого пространства');
  }
  const missing = await post({ action: 'delete-space', spaceId: 'missing' });
  expect(missing.statusCode).toBe(422);
  expect(missing.json().message).toBe('Space not found.');
  expect((await post({ action: 'delete-space', spaceId, manifestHash: 'stale' })).statusCode).toBe(409);
  expect((await post({ action: 'delete-space', spaceId, optionsHash: 'f'.repeat(64) })).statusCode).toBe(409);
  expect((await post({ action: 'delete-space', spaceId, source: 'live' })).statusCode).toBe(403);
  expect(await readFile(filename)).toEqual(before);
  expect(await readdir(path.join(root, 'tasks'))).toEqual(files);
  const response = await post({ action: 'delete-space', spaceId, optionsHash: catalog.optionsHash });
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json().spaces.map((space: { id: string }) => space.id)).toEqual(['work']);
  expect(response.json().decks).toEqual(catalog.decks);
  catalog = response.json();
  catalog = (await post({ action: 'delete-deck', deckId: 'audio' })).json();
  const last = await post({ action: 'delete-space', spaceId: 'work' });
  expect(last.statusCode, last.body).toBe(200);
  expect(last.json()).toMatchObject({ spaces: [], decks: [], configured: true });
  expect((await app.inject({ url: '/api/catalog', headers })).json().spaces).toEqual([]);
});

it('refuses deleting a Space from a read-only project', async () => {
  const { root, config } = await fixture();
  const app = await createApp({ ...config, editMode: 'read-only', writeRoot: null });
  apps.push(app);
  const snapshot = (await app.inject({ url: '/api/snapshot', headers })).json();
  const catalog = (await app.inject({ url: '/api/catalog', headers })).json();
  const before = await readFile(path.join(root, 'tasks/deckmate.md'));
  const response = await app.inject({ method: 'POST', url: '/api/catalog', headers: { ...headers, 'x-deckmate-token': snapshot.token },
    payload: { action: 'delete-space', spaceId: 'work', manifestHash: catalog.manifestHash, source: 'sandbox' } });
  expect(response.statusCode).toBe(403);
  expect(await readFile(path.join(root, 'tasks/deckmate.md'))).toEqual(before);
});

it('observes external card content and a new Markdown file in the derived index', async () => {
  const { root, config } = await fixture();
  const app = await createApp(config);
  apps.push(app);
  await app.inject({ url: '/api/catalog', headers });
  await writeFile(path.join(root, 'features/match.md'), '# Матч\n## 1 — Бой\n### 1.0 Анимация шага\nНовый текст.\n');
  await writeFile(path.join(root, 'features/new.md'), '# Другая механика\n### 2.0 Новая работа\n');
  await vi.waitFor(async () => {
    const cards = (await app.inject({ url: '/api/cards?kind=task', headers })).json();
    expect(cards.map((card: { title: string }) => card.title).sort()).toEqual(['Анимация шага', 'Новая работа']);
  }, { timeout: 3000, interval: 100 });
});

it('rebuilds a corrupt disposable cache and reads primary files independently of the server', async () => {
  const { directory, root, config } = await fixture();
  const cache = path.join(directory, 'cache');
  const first = new CatalogService(config, cache);
  const original = await first.get('sandbox');
  await first.close();
  const { readdir } = await import('node:fs/promises');
  const filename = (await readdir(cache)).find(name => name.endsWith('.sqlite'))!;
  await writeFile(path.join(cache, filename), 'not sqlite');
  const rebuilt = new CatalogService(config, cache);
  try {
    const current = await rebuilt.get('sandbox');
    expect(current.cards).toEqual(original.cards);
    expect(current.rootIdentity).toBe(original.rootIdentity);
    expect(await readFile(path.join(root, 'features/match.md'), 'utf8')).toContain('Звук выстрела');
  } finally { await rebuilt.close(); }
});

it('reports a successful primary save when the derived index fails after rename', async () => {
  const { directory, root, config } = await fixture();
  const service = new CatalogService(config, path.join(directory, 'cache'));
  try {
    const before = await service.get('sandbox');
    const replace = vi.spyOn(ProjectIndex.prototype, 'replace').mockImplementationOnce(() => { throw new Error('index unavailable'); });
    try {
      const result = await service.edit({ action: 'create-space', title: 'Сохранено один раз', manifestHash: before.manifestHash }, 'sandbox');
      expect(result.spaces.filter(space => space.title === 'Сохранено один раз')).toHaveLength(1);
      expect(result.savedWarning).toContain('Changes were saved');
      expect(result.manifestHash).not.toBe(before.manifestHash);
      expect(await readFile(path.join(root, 'tasks/deckmate.md'), 'utf8')).toContain('Сохранено один раз');
    } finally { replace.mockRestore(); }
    expect((await service.get('sandbox')).warnings).toEqual([]);
  } finally { await service.close(); }
});

it('does not trust a cached snapshot after file watching has failed', async () => {
  const { root, config } = await fixture();
  const service = new CatalogService(config, ':memory:');
  try {
    await service.get('sandbox');
    service.watchFailed('sandbox');
    await writeFile(path.join(root, 'features/match.md'), '# Матч\n### 1.0 Изменение без watcher\n');
    const result = await service.get('sandbox');
    expect(result.cards.find(card => card.kind === 'task')?.title).toBe('Изменение без watcher');
    expect(result.warnings.join(' ')).toContain('File watching has stopped');
  } finally { await service.close(); }
});

it('applies a pipeline through the API and resolves compact card, pipeline and board links', { timeout: 15000 }, async () => {
  const { config } = await fixture();
  const app = await createApp(config);
  apps.push(app);
  const snapshot = (await app.inject({ url: '/api/snapshot', headers })).json();
  const authorized = { ...headers, 'x-deckmate-token': snapshot.token };
  let catalog = (await app.inject({ url: '/api/catalog', headers })).json();
  async function edit(action: Record<string, unknown>) {
    const response = await app.inject({ method: 'POST', url: '/api/catalog', headers: authorized, payload: { ...action, source: 'sandbox', manifestHash: catalog.manifestHash } });
    expect(response.statusCode, response.body).toBe(200);
    catalog = response.json();
  }
  await edit({ action: 'create-deck', title: 'Concept', spaceId: 'work', kind: 'asset', icon: 'box', color: '#a1a1a1', description: 'Hero cards' });
  const deck = catalog.decks.find((item: { title: string }) => item.title === 'Concept');
  const hero = catalog.cards.find((card: { kind: string }) => card.kind === 'hero');
  await edit({ action: 'assign-deck', cardId: hero.id, deckId: deck.id });
  await edit({ action: 'configure-members', members: [{ id: 'pavel', label: 'Павел', kind: 'human', aliases: ['Паша'] }, { id: 'glm', label: 'GLM', kind: 'agent', aliases: [] }] });
  expect(catalog.members.map((member: { label: string }) => member.label)).toEqual(['Павел', 'GLM']);
  await edit({ action: 'create-journey', deckId: deck.id, title: 'Sound pipeline', steps: [
    { id: 'contract', title: '%PARENT_TITLE% — contract', markdown: '## Input\nRead the Hero.', deckId: 'audio', owner: null, dependsOn: [] },
    { id: 'review', title: '%PARENT_TITLE% — review', markdown: '## Check\nHuman acceptance.', deckId: 'audio', owner: 'Павел', dependsOn: ['contract'] },
  ] });
  const journey = catalog.journeys[0];
  const apply = { action: 'apply-journey', cardId: hero.id, sourceHash: hero.sourceHash, journeyId: journey.id, journeyHash: journey.fileHash,
    stepIds: ['contract', 'review'], deckAssignments: { contract: 'audio', review: 'audio' } };
  await edit(apply);
  await edit(apply);
  expect(catalog.cards.filter((card: { journey?: unknown }) => card.journey)).toHaveLength(2);
  const cardLink = await app.inject({ url: `/r/${shortReference('c', hero.id)}?source=live`, headers });
  expect(cardLink.statusCode).toBe(302);
  expect(cardLink.headers.location).toContain('catalogSource=live');
  expect(cardLink.headers.location).toContain(encodeURIComponent(hero.id));
  const pipelineLink = await app.inject({ url: `/r/${shortReference('p', journey.id)}`, headers });
  expect(pipelineLink.headers.location).toContain(`journey=${journey.id}`);
  const board = await app.inject({ method: 'POST', url: '/api/boards', headers: authorized, payload: { source: 'sandbox', title: 'Flow', hash: '',
    scene: { type: 'excalidraw', version: 2, appState: {}, files: {}, elements: [{ id: 'link', type: 'rectangle', customData: { deckmateCardId: hero.id } }] } } });
  expect(board.statusCode, board.body).toBe(200);
  const boardLink = await app.inject({ url: `/r/${shortReference('v', board.json().id)}`, headers });
  expect(boardLink.headers.location).toContain(`board=${board.json().id}`);
  const summary = await app.inject({ url: '/api/summary?limit=2', headers });
  expect(summary.statusCode).toBe(200);
  expect(summary.json().counts.kind.task).toBe(3);
  expect(summary.json().groups.blocked.total).toBe(1);
});

async function contextFiles(root: string): Promise<Record<string, string>> {
  const entries: Record<string, string> = {};
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const filename = path.join(entry.parentPath, entry.name);
    const relative = path.relative(root, filename);
    if (relative.split(path.sep).includes('.git')) continue;
    entries[relative] = createHash('sha256').update(await readFile(filename)).digest('hex');
  }
  return entries;
}

it('serves a budgeted agent brief from fresh files and validates new query parameters', async () => {
  const { root, config } = await fixture();
  const before = await contextFiles(root);
  const app = await createApp({ ...config, editMode: 'read-only' });
  apps.push(app);
  const cardId = 'task:features/match.md#1.0';
  const url = '/api/brief?cardId=' + shortReference('c', cardId);
  const response = await app.inject({ url, headers });
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json().markdown).toContain('Тело.');
  expect(response.json().tokens).toBeGreaterThan(0);
  expect(response.json().tokens).toBeLessThanOrEqual(1500);
  expect(typeof response.json().truncated).toBe('boolean');
  expect(response.json().readNext).toEqual(expect.any(Array));
  expect((await app.inject({ url: url + '&budget=0', headers })).statusCode).toBe(400);
  expect((await app.inject({ url: url + '&source=elsewhere', headers })).statusCode).toBe(400);
  expect((await app.inject({ url: '/api/brief?cardId=missing', headers })).statusCode).toBe(404);
  expect(await contextFiles(root)).toEqual(before);
});

it('returns search hits only in brief fields while retaining legacy card response bytes', async () => {
  const { root, config } = await fixture();
  const before = await contextFiles(root);
  const app = await createApp({ ...config, editMode: 'read-only' });
  apps.push(app);
  const url = '/api/cards?text=' + encodeURIComponent('звук');
  const legacy = await app.inject({ url, headers });
  const compact = await app.inject({ url: url + '&fields=brief', headers });
  expect(compact.statusCode, compact.body).toBe(200);
  const expected = legacy.json().map(({ markdown, ...card }: { markdown: string }) => card);
  expect(compact.json().map(({ hits, ...card }: { hits: unknown }) => card)).toEqual(expected);
  for (const card of compact.json()) {
    expect(card).not.toHaveProperty('markdown');
    expect(card.hits.length).toBeGreaterThan(0);
    expect(card.hits.length).toBeLessThanOrEqual(3);
    for (const hit of card.hits) expect(hit).toMatchObject({ line: 3, text: expect.any(String) });
  }
  expect((await app.inject({ url, headers })).body).toBe(legacy.body);
  expect((await app.inject({ url: url + '&fields=all', headers })).statusCode).toBe(400);
  expect(await contextFiles(root)).toEqual(before);
});

it('serves exact inclusive file lines with CRLF and BOM while leaving full-file responses intact', async () => {
  const { root, config } = await fixture();
  const text = '\uFEFF# Матч\r\n## 1 — Бой\r\n### 1.0 Звук выстрела (план)\r\nТело.\r\n';
  await writeFile(path.join(root, 'features/match.md'), text);
  const app = await createApp({ ...config, editMode: 'read-only' });
  apps.push(app);
  const url = '/api/file?path=features/match.md';
  const whole = await app.inject({ url, headers });
  expect(whole.rawPayload).toEqual(Buffer.from(text));
  const range = await app.inject({ url: url + '&from=2&to=4', headers });
  expect(range.statusCode, range.body).toBe(200);
  expect(range.rawPayload).toEqual(Buffer.from('## 1 — Бой\r\n### 1.0 Звук выстрела (план)\r\nТело.\r\n'));
  expect(range.headers['content-security-policy']).toContain('sandbox');
  expect((await app.inject({ url: url + '&from=1&to=1', headers })).rawPayload).toEqual(Buffer.from('\uFEFF# Матч\r\n'));
  for (const suffix of ['&from=0&to=1', '&from=3&to=1', '&from=1', '&from=1&to=99']) {
    expect((await app.inject({ url: url + suffix, headers })).statusCode).toBe(422);
  }
  expect((await app.inject({ url, headers })).rawPayload).toEqual(whole.rawPayload);
});

it('serves changes after a timestamp or hash without writing notification or task files', async () => {
  const { root, config } = await fixture();
  const cardId = 'task:features/match.md#1.0';
  for (const at of ['2026-10-31T23:59:59.000Z', '2026-11-02T12:00:00.000Z']) {
    await appendActivity(root, { schema: 1, id: randomUUID(), at, action: 'test', actor: 'Deckmate', summary: 'Recorded change',
      cards: [{ id: cardId, title: 'Звук выстрела' }], deckIds: ['audio'], details: [] }, 'en');
  }
  const app = await createApp({ ...config, editMode: 'read-only' });
  apps.push(app);
  const before = await contextFiles(root);
  const hash = createHash('sha256').update(await readFile(path.join(root, 'features/match.md'))).digest('hex');
  const url = '/api/changes?cardId=' + encodeURIComponent(cardId) + '&since=';
  const response = await app.inject({ url: url + '2026-11-01T00:00:00Z', headers });
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json()).toMatchObject({ cardId, sourceHash: hash, eventScope: 'after-timestamp' });
  expect(response.json().events.map((event: { at: string }) => event.at)).toEqual(['2026-11-02T12:00:00.000Z']);
  const unchanged = await app.inject({ url: url + hash, headers });
  expect(unchanged.json()).toMatchObject({ previousSourceHash: hash, changed: false, eventScope: 'all-card-events' });
  expect(unchanged.json().events).toHaveLength(2);
  expect((await app.inject({ url: url + 'not-a-checkpoint', headers })).statusCode).toBe(422);
  expect((await app.inject({ url: '/api/changes?cardId=' + encodeURIComponent(cardId), headers })).statusCode).toBe(400);
  expect(await contextFiles(root)).toEqual(before);
});
