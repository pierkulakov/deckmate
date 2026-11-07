import { afterEach, expect, it, vi } from 'vitest';
import * as filesystem from 'node:fs/promises';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { CatalogEdit } from '../src/catalog-contracts.ts';
import { createApp } from '../server/app.ts';
import { describeActivity, readActivity } from '../server/activity.ts';
import { editProjectCatalog, emptyManifest, readProjectCatalog, renderCatalogManifest } from '../server/catalog.ts';
import { createManagedMarkdown, type NativeCardMetadata } from '../server/native-cards.ts';

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, open: vi.fn(actual.open) };
});
const roots: string[] = [];
const applications: FastifyInstance[] = [];
const execute = promisify(execFile);
const legacyHero = 'hero:features/match.md#1';
const legacyChildren = ['task:features/match.md#1.0', 'task:features/match.md#1.1'];
type Reorder = Extract<CatalogEdit, { action: 'reorder-subcards' }>;

afterEach(async () => {
  const actual = await vi.importActual<typeof filesystem>('node:fs/promises');
  vi.mocked(filesystem.open).mockReset().mockImplementation(actual.open);
  for (const application of applications.splice(0)) await application.close();
  for (const root of roots.splice(0)) {
    const relative = path.relative(path.resolve(tmpdir()), path.resolve(root));
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !path.basename(root).startsWith('deckmate-order-')) throw new Error('Unexpected order fixture cleanup target');
    await rm(root, { recursive: true, force: true });
  }
});

async function native(root: string, kind: NativeCardMetadata['kind'], parentId: string | null = null, dependency?: string) {
  const id = randomUUID();
  const metadata: NativeCardMetadata = { deckmate: 'card', schema: 1, id, kind, title: kind === 'hero' ? 'Звуковой мир' : 'Шаг ' + id.slice(0, 4),
    state: kind === 'task' ? 'план' : null, owner: 'Kimi', parentId, deckId: kind === 'hero' ? 'concepts' : 'audio', trackIds: ['sound'] };
  if (dependency) {
    metadata.dependsOn = [dependency];
    metadata.journey = { journeyId: randomUUID(), version: 1, stepId: 'sound', instanceId: randomUUID() };
  }
  const filename = path.join(root, 'cards', id + '.md');
  await createManagedMarkdown(root, `cards/${id}.md`, metadata, 'Не менять Markdown.\r\nВторая строка.\n');
  return { id: 'card:' + id, filename };
}

async function fixture(orderYaml = '') {
  const root = await mkdtemp(path.join(tmpdir(), 'deckmate-order-'));
  roots.push(root);
  for (const directory of ['features', 'tasks', 'Tools']) await mkdir(path.join(root, directory));
  const mechanic = path.join(root, 'features/match.md');
  await writeFile(mechanic, '\uFEFF# Матч\r\n## 1 — Звуки\r\nОписание.\n### 1.0 Выстрел (план)\r\nНе менять.\n### 1.1 Перезарядка (в работе)\r\n**Кто:** Kimi\r\n');
  await writeFile(path.join(root, 'tasks/iterations.md'), '## Итерация 1 — Проверка\n');
  await writeFile(path.join(root, 'Tools/board.py'), '# Fixture\n');
  const manifest = emptyManifest();
  manifest.spaces = [{ id: 'work', title: 'Work' }];
  manifest.decks = [
    { id: 'audio', spaceId: 'work', title: 'Audio', kind: 'task', description: '', icon: 'audio', color: '#123456' },
    { id: 'concepts', spaceId: 'work', title: 'Concepts', kind: 'asset', description: '', icon: 'box', color: '#123456' },
  ];
  manifest.tracks = [{ id: 'sound', title: 'Звук', description: '' }];
  manifest.membership = [{ card: legacyHero, deck: 'concepts' }, ...legacyChildren.map(card => ({ card, deck: 'audio', tracks: ['sound'] }))];
  const filename = path.join(root, 'tasks/deckmate.md');
  const text = renderCatalogManifest(manifest).replace('schema: 1', '# Не менять комментарий\nschema: 1')
    .replace('\n---\n', '\n' + orderYaml + 'custom: {note: "Кириллица: осталась"} # extension\n---\n');
  await writeFile(filename, '\uFEFF' + text.replace(/\n/gu, '\r\n') + '\nЛичный текст с LF.\n');
  const hero = await native(root, 'hero');
  const first = await native(root, 'task', hero.id);
  const second = await native(root, 'task', hero.id, first.id);
  return { root, filename, mechanic, hero, first, second };
}

async function reorder(root: string, heroId: string, cardIds: string[]): Promise<Reorder> {
  const catalog = await readProjectCatalog(root);
  const hero = catalog.cards.find(card => card.id === heroId)!;
  return { action: 'reorder-subcards', cardId: heroId, sourceHash: hero.sourceHash, manifestHash: catalog.manifestHash, cardIds };
}

it('round-trips legacy and native ordering without changing cards, parents, decks or Journey dependencies', async () => {
  const fixtureData = await fixture();
  const { root, mechanic, hero, first, second } = fixtureData;
  const before = await readProjectCatalog(root);
  const paths = [mechanic, hero.filename, first.filename, second.filename];
  const bytes = await Promise.all(paths.map(filename => readFile(filename)));
  await editProjectCatalog(root, await reorder(root, legacyHero, [...legacyChildren].reverse()));
  await editProjectCatalog(root, await reorder(root, hero.id, [second.id, first.id]));
  const after = await readProjectCatalog(root);
  expect(after.subCardOrder).toEqual({ [legacyHero]: [...legacyChildren].reverse(), [hero.id]: [second.id, first.id] });
  expect(after.cards).toEqual(before.cards);
  expect(await Promise.all(paths.map(filename => readFile(filename)))).toEqual(bytes);
  expect(after.cards.find(card => card.id === second.id)).toMatchObject({ parentId: hero.id, deckId: 'audio', trackIds: ['sound'], dependsOn: [first.id], journey: { stepId: 'sound', version: 1 } });
});

it('inserts the key without rewriting any existing manifest byte', async () => {
  const { root, filename } = await fixture();
  const before = await readFile(filename, 'utf8');
  const order = [...legacyChildren].reverse();
  await editProjectCatalog(root, await reorder(root, legacyHero, order));
  expect(await readFile(filename)).toEqual(Buffer.from(before.replace('schema: 1', `subCardOrder: {${JSON.stringify(legacyHero)}: ${JSON.stringify(order)}}\r\nschema: 1`)));
});

it.each(['block', 'flow'] as const)('reorders %s list values while retaining comments, BOM, mixed EOL and unrelated Hero order', async format => {
  const original = format === 'block'
    ? `subCardOrder:\n  '${legacyHero}': # Hero comment\n    - '${legacyChildren[0]}' # first position\n    - '${legacyChildren[1]}' # second position\n  other: [] # keep other\n`
    : `subCardOrder: {'${legacyHero}': ['${legacyChildren[0]}', '${legacyChildren[1]}'], other: []} # keep flow\n`;
  const { root, filename } = await fixture(original);
  const before = await readFile(filename, 'utf8');
  const expected = before.replace(`'${legacyChildren[0]}'`, JSON.stringify(legacyChildren[1]))
    .replace(`'${legacyChildren[1]}'`, JSON.stringify(legacyChildren[0]));
  await editProjectCatalog(root, await reorder(root, legacyHero, [...legacyChildren].reverse()));
  expect(await readFile(filename)).toEqual(Buffer.from(expected));
});

it.each(['subCardOrder: {} # keep\n', 'subCardOrder:\n  other: [] # keep\n'])('adds a Hero to an existing map without rewriting other entries: %s', async orderYaml => {
  const { root, filename } = await fixture(orderYaml);
  const before = await readFile(filename, 'utf8');
  const order = [...legacyChildren].reverse();
  const entry = `${JSON.stringify(legacyHero)}: ${JSON.stringify(order)}`;
  const expected = orderYaml.includes('{}') ? before.replace('subCardOrder: {}', `subCardOrder: {${entry}}`)
    : before.replace('  other: []', `  ${entry}\r\n  other: []`);
  await editProjectCatalog(root, await reorder(root, legacyHero, order));
  expect(await readFile(filename)).toEqual(Buffer.from(expected));
});

it('replaces only a Hero list when newly attached children change its length', async () => {
  const { root, filename } = await fixture(`subCardOrder:\n  '${legacyHero}': ['${legacyChildren[0]}'] # list comment\n  other: [] # keep\n`);
  const before = await readFile(filename, 'utf8');
  const order = [...legacyChildren].reverse();
  await editProjectCatalog(root, await reorder(root, legacyHero, order));
  expect(await readFile(filename)).toEqual(Buffer.from(before.replace(`['${legacyChildren[0]}']`, JSON.stringify(order))));
});

it('updates an expanded block list after the child set changes while preserving its surrounding bytes', async () => {
  const { root, filename } = await fixture(`subCardOrder:\n  '${legacyHero}':\n    # Keep list introduction\n    - '${legacyChildren[0]}' # replaceable list detail\n  other: [] # keep following Hero\n`);
  const before = await readFile(filename, 'utf8');
  const prefix = before.slice(0, before.indexOf(`    - '${legacyChildren[0]}'`));
  const suffix = before.slice(before.indexOf('  other: []'));
  const order = [...legacyChildren].reverse();
  await editProjectCatalog(root, await reorder(root, legacyHero, order));
  const after = await readFile(filename, 'utf8');
  expect(after.startsWith(prefix)).toBe(true);
  expect(after.endsWith(suffix)).toBe(true);
  expect((await readProjectCatalog(root)).subCardOrder?.[legacyHero]).toEqual(order);
});

it('creates the first manifest for legacy order and does not republish an unchanged order', async () => {
  const { root, filename, mechanic } = await fixture();
  const source = await readFile(mechanic);
  await rm(filename);
  await editProjectCatalog(root, await reorder(root, legacyHero, [...legacyChildren].reverse()));
  expect((await readProjectCatalog(root)).subCardOrder?.[legacyHero]).toEqual([...legacyChildren].reverse());
  expect(await readFile(mechanic)).toEqual(source);
  const before = await stat(filename, { bigint: true });
  expect(await editProjectCatalog(root, await reorder(root, legacyHero, [...legacyChildren].reverse()))).toEqual([]);
  const after = await stat(filename, { bigint: true });
  expect([after.ino, after.mtimeNs]).toEqual([before.ino, before.mtimeNs]);
});

it('rejects duplicate, missing, foreign, non-Hero and stale requests without writing', async () => {
  const { root, filename, first } = await fixture();
  const before = await readFile(filename);
  const edit = await reorder(root, legacyHero, [...legacyChildren].reverse());
  for (const invalid of [
    { cardIds: [legacyChildren[0], legacyChildren[0]] }, { cardIds: [legacyChildren[0]] },
    { cardIds: [legacyChildren[0], first.id] }, { cardId: legacyChildren[0] },
    { sourceHash: '0'.repeat(64) }, { manifestHash: '0'.repeat(64) },
  ]) await expect(editProjectCatalog(root, { ...edit, ...invalid })).rejects.toThrow();
  expect(await readFile(filename)).toEqual(before);
});

it.each(['Hero', 'child', 'new child', 'manifest'] as const)('rechecks %s after staging before publishing the manifest', async changedSource => {
  const { root, filename, hero, first, second } = await fixture();
  const before = await readFile(filename);
  const edit = await reorder(root, hero.id, [second.id, first.id]);
  const actual = await vi.importActual<typeof filesystem>('node:fs/promises');
  let changed = false;
  vi.mocked(filesystem.open).mockImplementation(async (target, flags, mode) => {
    if (flags === 'wx' && !changed) {
      changed = true;
      if (changedSource === 'new child') await native(root, 'task', hero.id);
      else {
        const selected = changedSource === 'Hero' ? hero.filename : changedSource === 'child' ? first.filename : filename;
        await actual.writeFile(selected, Buffer.concat([await actual.readFile(selected), Buffer.from('External edit\n')]));
      }
    }
    return actual.open(target, flags, mode);
  });
  await expect(editProjectCatalog(root, edit)).rejects.toThrow(/CONFLICT/u);
  expect(changed).toBe(true);
  const expected = changedSource === 'manifest' ? Buffer.concat([before, Buffer.from('External edit\n')]) : before;
  expect(await readFile(filename)).toEqual(expected);
});

it('refuses an aliased order whose edit would alter unrelated metadata', async () => {
  const { root, filename } = await fixture(`subCardOrder: &shared {'${legacyHero}': ['${legacyChildren[0]}', '${legacyChildren[1]}']}\ncopy: *shared\n`);
  const before = await readFile(filename);
  await expect(editProjectCatalog(root, await reorder(root, legacyHero, [...legacyChildren].reverse()))).rejects.toThrow('other catalog properties');
  expect(await readFile(filename)).toEqual(before);
});

it('logs meaningful order changes in Hero and child decks while excluding unrelated Hero history and no-ops', async () => {
  const { root, hero, first, second } = await fixture();
  const before = await readProjectCatalog(root);
  await editProjectCatalog(root, await reorder(root, hero.id, [second.id, first.id]));
  const after = await readProjectCatalog(root);
  const event = describeActivity(before, after, 'reorder-subcards', new Set([hero.id]));
  // 2026-11-06: the journal follows the project language; this legacy manifest has no formatLanguage and is Russian.
  expect(event).toMatchObject({ actor: 'Deckmate', summary: 'Изменён порядок Sub Cards' });
  expect(event?.deckIds.sort()).toEqual(['audio', 'concepts']);
  expect(event?.cards.map(card => card.id)).toEqual([hero.id, second.id, first.id]);
  expect(event?.details).toHaveLength(3);
  expect(describeActivity(after, after, 'reorder-subcards', new Set([hero.id]))).toBeNull();
  expect(describeActivity(before, after, 'reorder-subcards', new Set([legacyHero]))).toBeNull();
});

it('validates the HTTP action, sandbox/token guards, stale conflicts and activity with no duplicate event on retry', async () => {
  const { root } = await fixture();
  await execute('git', ['init', '-b', 'deckmate/sandbox', root], { windowsHide: true });
  const application = await createApp({ editMode: 'sandbox', dataRoot: root, writeRoot: root, projectName: 'Order test', port: 44329, python: 'python' });
  applications.push(application);
  const headers = { host: '127.0.0.1:44329' };
  const snapshot = (await application.inject({ url: '/api/snapshot', headers })).json();
  const authorized = { ...headers, 'x-deckmate-token': snapshot.token };
  const edit = await reorder(root, legacyHero, [...legacyChildren].reverse());
  const payload = { ...edit, source: 'sandbox' };
  expect((await application.inject({ method: 'POST', url: '/api/catalog', headers, payload })).statusCode).toBe(403);
  expect((await application.inject({ method: 'POST', url: '/api/catalog', headers: authorized, payload: { ...payload, source: 'live' } })).statusCode).toBe(403);
  expect((await application.inject({ method: 'POST', url: '/api/catalog', headers: authorized, payload: { ...payload, cardIds: [legacyChildren[0], legacyChildren[0]] } })).statusCode).toBe(400);
  expect((await application.inject({ method: 'POST', url: '/api/catalog', headers: authorized, payload: { ...payload, cardIds: [] } })).statusCode).toBe(409);
  const saved = await application.inject({ method: 'POST', url: '/api/catalog', headers: authorized, payload });
  expect(saved.statusCode).toBe(200);
  expect(saved.json().subCardOrder[legacyHero]).toEqual([...legacyChildren].reverse());
  expect((await application.inject({ method: 'POST', url: '/api/catalog', headers: authorized, payload })).statusCode).toBe(409);
  const repeat = await reorder(root, legacyHero, [...legacyChildren].reverse());
  expect((await application.inject({ method: 'POST', url: '/api/catalog', headers: authorized, payload: { ...repeat, source: 'sandbox' } })).statusCode).toBe(200);
  const events = (await readActivity(root, 'audio')).events;
  expect(events).toHaveLength(1);
  expect(events[0].action).toBe('reorder-subcards');
});
