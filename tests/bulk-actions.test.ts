import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { BulkChange, BulkEditRequest } from '../src/bulk-contracts.ts';
import { editProjectCatalog, emptyManifest, readProjectCatalog, renderCatalogManifest } from '../server/catalog.ts';
import { editCatalogBulk } from '../server/catalog-bulk.ts';
import * as native from '../server/native-cards.ts';
import { createApp } from '../server/app.ts';
import type { FastifyInstance } from 'fastify';

vi.mock('../server/native-cards.ts', async original => {
  const actual = await original<typeof import('../server/native-cards.ts')>();
  return { ...actual, replaceProjectMarkdown: vi.fn(actual.replaceProjectMarkdown) };
});
const roots: string[] = [];
const apps: FastifyInstance[] = [];
const execute = promisify(execFile);
const taskA = 'task:features/match.md#1.1';
const taskB = 'task:features/match.md#1.2';
const hero = 'hero:features/match.md#1';
const nativeA = 'card:11111111-1111-4111-8111-111111111111';
const nativeB = 'card:22222222-2222-4222-8222-222222222222';
const copyA = 'card:33333333-3333-4333-8333-333333333333';
const copyB = 'card:44444444-4444-4444-8444-444444444444';
afterEach(async () => {
  vi.resetAllMocks(); vi.restoreAllMocks();
  for (const app of apps.splice(0)) await app.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture(newline = '\r\n') {
  const root = await mkdtemp(path.join(tmpdir(), 'deckmate-actions-')); roots.push(root);
  for (const folder of ['features', 'tasks', 'docs', 'Tools']) await mkdir(path.join(root, folder));
  await writeFile(path.join(root, 'features/match.md'), '\uFEFF' + ['# Game', '## 1 — Hero', 'Hero **full description**.', '### 1.1 One (в работе)', 'First **body**.', '### 1.2 Two (обсуждаем)', 'Second `body`.', '### 1.3 Unselected (принято 2026-10-31)', 'Keep status and body.', ''].join(newline));
  await writeFile(path.join(root, 'docs/guide.md'), '# Guide\nFull document.\n');
  await writeFile(path.join(root, 'tasks/iterations.md'), '## Итерация 7 — Test\n');
  await writeFile(path.join(root, 'Tools/board.py'), '# test fixture\n');
  const manifest = emptyManifest();
  manifest.spaces.push({ id: 'work', title: 'Work' });
  for (const [id, kind] of [['tasks', 'task'], ['mixed', 'mixed'], ['docs', 'knowledge'], ['heroes', 'asset']] as const) manifest.decks.push({ id, kind, title: id, spaceId: 'work', description: '', color: '#445566', icon: 'box' });
  manifest.tracks.push({ id: 'sound', title: 'Sound', description: '' });
  manifest.members = [{ id: 'kimi', label: 'Kimi', kind: 'agent', aliases: ['Kimi'] }];
  manifest.membership = [{ card: taskA, deck: 'tasks' }, { card: taskB, deck: 'tasks' }, { card: hero, deck: 'heroes' }];
  await writeFile(path.join(root, 'tasks/deckmate.md'), renderCatalogManifest(manifest).replace('membership:', '# Keep manifest comment\nmembership:') + '\nUnrelated body.\n');
  for (const id of [nativeA, nativeB]) {
    const relative = `cards/${id.slice(5)}.md`;
    await native.createManagedMarkdown(root, relative, { deckmate: 'card', schema: 1, id: id.slice(5), kind: 'task', title: 'Native', state: 'в работе', owner: 'Custom person', effort: 5, priority: 'low', deckId: 'tasks', trackIds: [], parentId: hero, custom: 'unknown field' }, 'Full **body**.\n\n- [ ] Todo\n');
    const bytes = await readFile(path.join(root, relative));
    await writeFile(path.join(root, relative), '\uFEFF' + bytes.toString('utf8').replace('owner:', '# Keep native comment\nowner:').replaceAll('\n', '\r\n'));
  }
  return root;
}
async function request(root: string, ids: string[], change: BulkChange): Promise<BulkEditRequest> {
  const catalog = await readProjectCatalog(root);
  return { action: 'bulk-edit-cards', manifestHash: catalog.manifestHash, optionsHash: catalog.optionsHash ?? '', change, cards: ids.map(id => ({ cardId: id, sourceHash: catalog.cards.find(card => card.id === id)!.sourceHash })) };
}
async function promotionRequest(root: string, childIds: string[], candidateId: string, deckId: string | null = 'heroes'): Promise<BulkEditRequest> {
  const catalog = await readProjectCatalog(root);
  const candidate = catalog.cards.find(card => card.id === candidateId)!;
  return { action: 'bulk-edit-cards', manifestHash: catalog.manifestHash, optionsHash: catalog.optionsHash ?? '',
    change: { kind: 'promote-parent', cardId: candidateId, sourceHash: candidate.sourceHash, expectedParentId: candidate.parentId, deckId },
    cards: childIds.map(id => { const card = catalog.cards.find(card => card.id === id)!; return { cardId: id, sourceHash: card.sourceHash, expectedParentId: card.parentId }; }) };
}
async function snapshots(root: string) {
  return Promise.all(['features/match.md', 'tasks/deckmate.md', `cards/${nativeA.slice(5)}.md`, `cards/${nativeB.slice(5)}.md`].map(file => readFile(path.join(root, file))));
}

async function createDoc(root: string, id: string, parentId: string | null = null) {
  const catalog = await readProjectCatalog(root);
  await editProjectCatalog(root, { action: 'create-card', manifestHash: catalog.manifestHash, cardId: id, kind: 'doc', title: 'Knowledge', markdown: 'Doc **body**.\r\n', deckId: 'docs', trackIds: [], parentId, owner: null, effort: null, priority: null });
}

async function attach(root: string, cardId: string, parentId: string | null) {
  const catalog = await readProjectCatalog(root);
  const card = catalog.cards.find(item => item.id === cardId)!;
  const parent = catalog.cards.find(item => item.id === parentId);
  return editProjectCatalog(root, { action: 'set-card-parent', manifestHash: catalog.manifestHash, cardId, sourceHash: card.sourceHash,
    expectedParentId: card.parentId, parentId, parentSourceHash: parent?.sourceHash ?? null });
}

it('supports legacy/native Doc children and a Knowledge Doc parent with exact-byte source preservation and ordering', async () => {
  const root = await fixture();
  const legacyDoc = 'doc:docs/guide.md';
  const originalDoc = await readFile(path.join(root, 'docs/guide.md'));
  await attach(root, legacyDoc, hero);
  expect((await readProjectCatalog(root)).cards.find(card => card.id === legacyDoc)).toMatchObject({ kind: 'doc', parentId: hero });
  expect(await readFile(path.join(root, 'docs/guide.md'))).toEqual(originalDoc);
  await createDoc(root, copyA);
  await createDoc(root, copyB, copyA);
  let catalog = await readProjectCatalog(root);
  const parent = catalog.cards.find(card => card.id === copyA)!;
  const nativeBefore = await native.readNativeCard(root, nativeA);
  await editCatalogBulk(root, await request(root, [taskA, nativeA, legacyDoc], { kind: 'parent', parentId: copyA, parentSourceHash: parent.sourceHash }));
  catalog = await readProjectCatalog(root);
  expect(catalog.cards.find(card => card.id === copyA)).toMatchObject({ kind: 'doc', deckId: 'docs', parentId: null });
  expect(catalog.cards.find(card => card.id === copyB)).toMatchObject({ kind: 'doc', deckId: 'docs', parentId: copyA });
  expect((await native.readNativeCard(root, nativeA))!.bytes.toString()).toBe(nativeBefore!.bytes.toString().replace(`parentId: ${hero}`, `parentId: "${copyA}"`));
  const children = catalog.cards.filter(card => card.parentId === copyA).map(card => card.id).reverse();
  await editProjectCatalog(root, { action: 'reorder-subcards', manifestHash: catalog.manifestHash, cardId: copyA, sourceHash: parent.sourceHash, cardIds: children });
  expect((await readProjectCatalog(root)).subCardOrder?.[copyA]).toEqual(children);
  await attach(root, copyB, null);
  expect((await readProjectCatalog(root)).cards.find(card => card.id === copyB)?.parentId).toBeNull();
});

it('rejects nested/cyclic/inactive Doc families and conversion of a Doc parent while preserving files', async () => {
  const root = await fixture();
  await createDoc(root, copyA); await createDoc(root, copyB, copyA);
  const before = await snapshots(root);
  await expect(attach(root, copyA, hero)).rejects.toThrow('Sub Cards');
  await expect(attach(root, taskA, copyB)).rejects.toThrow('Nested families');
  await expect(attach(root, copyB, copyB)).rejects.toThrow('cycles');
  await expect(editCatalogBulk(root, await request(root, [copyA], { kind: 'convert', cardKind: 'task', deckId: 'tasks' }))).rejects.toThrow('Sub Cards');
  await expect(createDoc(root, 'card:55555555-5555-4555-8555-555555555555', copyB)).rejects.toThrow('Nested families');
  expect(await snapshots(root)).toEqual(before);
  await editCatalogBulk(root, await request(root, [copyA], { kind: 'options', patch: { archived: true } }));
  await expect(attach(root, taskA, copyA)).rejects.toThrow('Archive');
  await editCatalogBulk(root, await request(root, [nativeA], { kind: 'options', patch: { archived: true } }));
  await expect(attach(root, nativeA, hero)).rejects.toThrow('Archive');
});

it('guards stale Doc target hashes and cascades recoverable deletion/restoration through Doc children', async () => {
  const root = await fixture();
  await createDoc(root, copyA); await createDoc(root, copyB, copyA);
  const catalog = await readProjectCatalog(root);
  const parent = catalog.cards.find(card => card.id === copyA)!;
  const edit = await request(root, [taskA], { kind: 'parent', parentId: copyA, parentSourceHash: parent.sourceHash });
  await writeFile(path.join(root, parent.path), Buffer.concat([await readFile(path.join(root, parent.path)), Buffer.from('\nExternal Doc edit\n')]));
  await expect(editCatalogBulk(root, edit)).rejects.toThrow('CARD_CONFLICT');
  const before = await readFile(path.join(root, parent.path));
  const deleted = await editCatalogBulk(root, await request(root, [copyA], { kind: 'options', patch: { deleted: true } }));
  expect(new Set(deleted.outcome.applied)).toEqual(new Set([copyA, copyB]));
  expect(await readFile(path.join(root, parent.path))).toEqual(before);
  await editCatalogBulk(root, await request(root, [copyA], { kind: 'options', patch: { deleted: false } }));
  expect((await readProjectCatalog(root)).cards.filter(card => [copyA, copyB].includes(card.id)).every(card => !card.deleted)).toBe(true);
});

it.each(['\r\n', '\r', '\n'])('batches sibling headings once and preserves every other byte (%j)', async newline => {
  const root = await fixture(newline);
  const before = await readFile(path.join(root, 'features/match.md'));
  const result = await editCatalogBulk(root, await request(root, [taskA, taskB], { kind: 'state', state: 'план' }));
  const expected = before.toString('utf8').replace('1.1 One (в работе)', '1.1 One').replace('1.2 Two (обсуждаем)', '1.2 Two');
  expect(await readFile(path.join(root, 'features/match.md'))).toEqual(Buffer.from(expected));
  expect(vi.mocked(native.replaceProjectMarkdown).mock.calls.filter(call => call[1] === 'features/match.md')).toHaveLength(1);
  expect(result.outcome).toMatchObject({ applied: [taskA, taskB], unchanged: [], pending: [] });
  vi.mocked(native.replaceProjectMarkdown).mockClear();
  expect((await editCatalogBulk(root, await request(root, [taskA, taskB], { kind: 'state', state: 'план' }))).outcome.unchanged).toEqual([taskA, taskB]);
  expect(native.replaceProjectMarkdown).not.toHaveBeenCalled();
});

it('patches mixed properties without clearing omitted fields, YAML comments or bodies', async () => {
  const root = await fixture();
  const before = await snapshots(root);
  await editCatalogBulk(root, await request(root, [taskA, taskB, nativeA, nativeB], { kind: 'properties', owner: 'Kimi' }));
  const after = await snapshots(root);
  expect(after[0]).toEqual(before[0]);
  expect(after[1].toString()).toContain('# Keep manifest comment');
  expect(after[2].toString()).toBe(before[2].toString().replace('owner: Custom person', 'owner: "Kimi"'));
  const card = (await readProjectCatalog(root)).cards.find(card => card.id === nativeA)!;
  expect(card).toMatchObject({ owner: 'Kimi', effort: 5, priority: 'low', parentId: hero });
  await editCatalogBulk(root, await request(root, [nativeA], { kind: 'properties', effort: null }));
  expect((await readProjectCatalog(root)).cards.find(card => card.id === nativeA)).toMatchObject({ owner: 'Kimi', effort: null, priority: 'low' });
});

it('preflights every revision and rejects incompatible actions before any writes', async () => {
  const root = await fixture(); const before = await snapshots(root);
  const edit = await request(root, [nativeA, nativeB], { kind: 'properties', effort: 9 });
  edit.cards[1].sourceHash = '0'.repeat(64);
  await expect(editCatalogBulk(root, edit)).rejects.toThrow('CARD_CONFLICT');
  await expect(editCatalogBulk(root, { ...await request(root, [nativeA], { kind: 'properties', effort: 9 }), optionsHash: '0'.repeat(64) })).rejects.toThrow('CARD_OPTIONS_CONFLICT');
  await expect(editCatalogBulk(root, await request(root, [hero, nativeA], { kind: 'state', state: 'принято' }))).rejects.toThrow('Task');
  await expect(editCatalogBulk(root, await request(root, [hero], { kind: 'convert', cardKind: 'doc', deckId: 'docs' }))).rejects.toThrow('Hero');
  await expect(editCatalogBulk(root, await request(root, [nativeA], { kind: 'properties' }))).rejects.toThrow();
  expect(await snapshots(root)).toEqual(before);
  expect(native.replaceProjectMarkdown).not.toHaveBeenCalled();
});

it('returns precise partial outcome and retries remaining cards with fresh hashes', async () => {
  const root = await fixture();
  const original = vi.mocked(native.replaceProjectMarkdown).getMockImplementation()!;
  let injected = false;
  vi.mocked(native.replaceProjectMarkdown).mockImplementation(async (...args) => {
    if (args[1].includes(nativeB.slice(5))) { injected = true; throw new Error('Injected IO failure'); }
    return original(...args);
  });
  const result = await editCatalogBulk(root, await request(root, [nativeA, nativeB], { kind: 'properties', effort: 8 }));
  expect(injected).toBe(true);
  expect(result.outcome).toMatchObject({ applied: [nativeA], pending: [nativeB] });
  expect(result.outcome.warnings[0]).toContain('Injected IO failure');
  vi.mocked(native.replaceProjectMarkdown).mockImplementation(original);
  const retry = await editCatalogBulk(root, await request(root, [nativeA, nativeB], { kind: 'properties', effort: 8 }));
  expect(retry.outcome).toMatchObject({ applied: [nativeB], unchanged: [nativeA], pending: [] });
});

it('guards external edits before publication without overwriting them', async () => {
  const root = await fixture(); const before = await snapshots(root);
  const original = vi.mocked(native.replaceProjectMarkdown).getMockImplementation()!;
  let injected = false;
  vi.mocked(native.replaceProjectMarkdown).mockImplementationOnce(async (...args) => {
    injected = true;
    await writeFile(path.join(root, 'tasks/deckmate.md'), Buffer.concat([before[1], Buffer.from('\nExternal edit\n')]));
    return original(...args);
  });
  await expect(editCatalogBulk(root, await request(root, [nativeA], { kind: 'properties', effort: 7 }))).rejects.toThrow('CATALOG_CONFLICT');
  expect(injected).toBe(true);
  expect((await snapshots(root))[2]).toEqual(before[2]);
  expect((await snapshots(root))[1].toString()).toContain('External edit');
});

it('creates a Hero, links cross-deck tasks, detaches and makes new-Hero retries idempotent', async () => {
  const root = await fixture();
  const change = { kind: 'create-parent', cardId: copyA, title: 'New Hero', deckId: 'heroes' } as const;
  const result = await editCatalogBulk(root, await request(root, [taskA, nativeA], change));
  expect(result.outcome).toMatchObject({ applied: [taskA, nativeA], created: [copyA], pending: [] });
  let catalog = await readProjectCatalog(root);
  expect(catalog.cards.filter(card => [taskA, nativeA].includes(card.id)).every(card => card.parentId === copyA)).toBe(true);
  expect((await editCatalogBulk(root, await request(root, [taskA, nativeA], change))).outcome.unchanged).toEqual([taskA, nativeA]);
  await editCatalogBulk(root, await request(root, [taskA, nativeA], { kind: 'parent', parentId: null, parentSourceHash: null }));
  catalog = await readProjectCatalog(root);
  expect(catalog.cards.filter(card => [taskA, nativeA].includes(card.id)).every(card => card.parentId === null)).toBe(true);
});

it('leaves an existing legacy Hero and its children unchanged without redundant membership or role writes', async () => {
  const root = await fixture();
  const before = await snapshots(root);
  const catalog = await readProjectCatalog(root);
  vi.mocked(native.replaceProjectMarkdown).mockClear();
  const result = await editCatalogBulk(root, await promotionRequest(root, [taskA, nativeB], hero));
  expect(result).toMatchObject({ changedPaths: [], outcome: { applied: [], unchanged: [taskA, nativeB], pending: [] } });
  expect(await snapshots(root)).toEqual(before);
  expect((await readProjectCatalog(root)).optionsHash).toBe(catalog.optionsHash);
  expect(native.replaceProjectMarkdown).not.toHaveBeenCalled();
});

it.each([
  [nativeA, 'heroes'],
  [taskA, 'mixed'],
  [copyA, 'heroes'],
  ['doc:docs/guide.md', 'mixed'],
])('promotes top-level %s without children into %s and preserves source bytes on retry', async (candidateId, deckId) => {
  const root = await fixture();
  if (candidateId === copyA) await createDoc(root, candidateId);
  else await attach(root, candidateId, null);
  const before = await readProjectCatalog(root);
  const candidate = before.cards.find(card => card.id === candidateId)!;
  expect(candidate.parentId).toBeNull();
  expect(before.cards.filter(card => card.parentId === candidateId)).toEqual([]);
  const sourceBefore = await readFile(path.join(root, candidate.path));
  const result = await editCatalogBulk(root, await promotionRequest(root, [], candidateId, deckId));
  expect(result.changedPaths.length).toBeGreaterThan(0);
  expect(result.outcome).toEqual({ applied: [candidateId], unchanged: [], pending: [], created: [], warnings: [] });
  const after = await readProjectCatalog(root);
  expect(after.cards.find(card => card.id === candidateId)).toMatchObject({ kind: 'hero', state: null, parentId: null, deckId });
  expect(after.cards.filter(card => card.parentId === candidateId)).toEqual([]);
  expect(after.warnings).toEqual([]);
  const sourceAfter = await readFile(path.join(root, candidate.path));
  if (candidateId === nativeA) {
    expect(sourceAfter.toString()).toBe(sourceBefore.toString().replace('kind: task', 'kind: "hero"').replace('state: в работе', 'state: null').replace('deckId: tasks', `deckId: "${deckId}"`));
  } else if (!candidateId.startsWith('card:')) {
    expect(sourceAfter).toEqual(sourceBefore);
  } else {
    expect((await native.readNativeCard(root, candidateId))!.markdown).toBe('Doc **body**.\r\n');
  }
  vi.mocked(native.replaceProjectMarkdown).mockClear();
  const retry = await editCatalogBulk(root, await promotionRequest(root, [], candidateId, deckId));
  expect(retry).toMatchObject({ changedPaths: [], outcome: { applied: [], unchanged: [candidateId], pending: [], warnings: [] } });
  expect(native.replaceProjectMarkdown).not.toHaveBeenCalled();
  expect(await readFile(path.join(root, candidate.path))).toEqual(sourceAfter);
});

it('rejects empty selections for every bulk change other than promote-parent', async () => {
  const root = await fixture();
  const before = await snapshots(root);
  const changes: BulkChange[] = [
    { kind: 'properties', effort: 9 },
    { kind: 'state', state: 'started' },
    { kind: 'parent', parentId: null, parentSourceHash: null },
    { kind: 'create-parent', cardId: copyA, title: 'Empty Hero', deckId: 'heroes' },
    { kind: 'options', patch: { bookmarked: true } },
    { kind: 'hand', memberId: 'kimi', mode: 'add' },
    { kind: 'tags', tags: ['sound'], mode: 'add' },
    { kind: 'convert', cardKind: 'doc', deckId: 'docs' },
    { kind: 'duplicate', deckId: 'mixed', properties: [], copies: [] },
    { kind: 'track', trackId: 'sound', mode: 'add' },
  ];
  for (const change of changes) {
    await expect(editCatalogBulk(root, await request(root, [], change))).rejects.toThrow('Select 1 to 1000 cards.');
  }
  expect(await snapshots(root)).toEqual(before);
  expect(native.replaceProjectMarkdown).not.toHaveBeenCalled();
});

it('preflights empty promotion deck compatibility, hashes and parent baselines without writing', async () => {
  const root = await fixture();
  await attach(root, nativeA, null);
  const before = await snapshots(root);
  const valid = await promotionRequest(root, [], nativeA);
  if (valid.change.kind !== 'promote-parent') throw new Error('Invalid fixture');
  vi.mocked(native.replaceProjectMarkdown).mockClear();
  await expect(editCatalogBulk(root, { ...valid, change: { ...valid.change, deckId: 'tasks' } })).rejects.toThrow('The target deck');
  await expect(editCatalogBulk(root, { ...valid, change: { ...valid.change, sourceHash: '0'.repeat(64) } })).rejects.toThrow('CARD_CONFLICT');
  await expect(editCatalogBulk(root, { ...valid, change: { ...valid.change, expectedParentId: hero } })).rejects.toThrow('PARENT_CONFLICT');
  await expect(editCatalogBulk(root, { ...valid, change: null as unknown as BulkChange })).rejects.toThrow('A bulk action is required.');
  expect(await snapshots(root)).toEqual(before);
  expect(native.replaceProjectMarkdown).not.toHaveBeenCalled();
});

it('rejects promote-parent with a non-array cards list before reading the catalog', async () => {
  const root = await fixture();
  const before = await snapshots(root);
  const valid = await promotionRequest(root, [], nativeA);
  await expect(editCatalogBulk(root, { ...valid, cards: null as unknown as BulkEditRequest['cards'] })).rejects.toThrow('Select 1 to 1000 cards.');
  expect(await snapshots(root)).toEqual(before);
});

it('promotes a native Sub Card in place, preserves body/custom metadata, and attaches cross-deck children idempotently', async () => {
  const root = await fixture();
  const before = await snapshots(root);
  const candidateBefore = (await native.readNativeCard(root, nativeA))!;
  const result = await editCatalogBulk(root, await promotionRequest(root, [taskA, nativeB], nativeA));
  expect(result.outcome).toMatchObject({ applied: [taskA, nativeB], pending: [], created: [] });
  const after = await readProjectCatalog(root);
  expect(after.cards.find(card => card.id === nativeA)).toMatchObject({ kind: 'hero', parentId: null, deckId: 'heroes', state: null, owner: 'Custom person', effort: 5, priority: 'low' });
  expect(after.cards.find(card => card.id === taskA)).toMatchObject({ parentId: nativeA, deckId: 'tasks' });
  expect(after.cards.find(card => card.id === nativeB)).toMatchObject({ parentId: nativeA, deckId: 'tasks' });
  const candidateAfter = (await native.readNativeCard(root, nativeA))!;
  expect(candidateAfter.markdown).toBe(candidateBefore.markdown);
  expect(candidateAfter.bytes.toString()).toBe(candidateBefore.bytes.toString().replace('kind: task', 'kind: "hero"').replace('state: в работе', 'state: null').replace('deckId: tasks', 'deckId: "heroes"').replace(`parentId: ${hero}`, 'parentId: null'));
  expect(await readFile(path.join(root, 'features/match.md'))).toEqual(before[0]);
  const saved = await snapshots(root);
  expect((await editCatalogBulk(root, await promotionRequest(root, [taskA, nativeB], nativeA))).outcome).toMatchObject({ unchanged: [taskA, nativeB], applied: [], pending: [] });
  expect(await snapshots(root)).toEqual(saved);
});

it('promotes a Sub Card without children, detaches it from the old Hero and leaves the old Hero family untouched', async () => {
  const root = await fixture();
  const before = await snapshots(root);
  const result = await editCatalogBulk(root, await promotionRequest(root, [], nativeA));
  expect(result.outcome).toEqual({ applied: [nativeA], unchanged: [], pending: [], created: [], warnings: [] });
  expect(result.changedPaths).toEqual([`cards/${nativeA.slice(5)}.md`]);
  expect(await readFile(path.join(root, 'features/match.md'))).toEqual(before[0]);
  expect(await readFile(path.join(root, `cards/${nativeB.slice(5)}.md`))).toEqual(before[3]);
  const catalog = await readProjectCatalog(root);
  expect(catalog.cards.find(card => card.id === nativeA)).toMatchObject({ kind: 'hero', state: null, parentId: null, deckId: 'heroes' });
  for (const id of [taskA, taskB, nativeB]) expect(catalog.cards.find(card => card.id === id)).toMatchObject({ parentId: hero });
  const retry = await editCatalogBulk(root, await promotionRequest(root, [], nativeA));
  expect(retry).toMatchObject({ changedPaths: [], outcome: { applied: [], unchanged: [nativeA], pending: [] } });
  expect(await readFile(path.join(root, 'features/match.md'))).toEqual(before[0]);
});

it.each([taskA, 'doc:docs/guide.md'])('promotes legacy %s with the same ID and source bytes', async candidateId => {
  const root = await fixture();
  const before = await snapshots(root);
  const docBefore = await readFile(path.join(root, 'docs/guide.md'));
  await editCatalogBulk(root, await promotionRequest(root, [taskB, nativeA], candidateId, null));
  const catalog = await readProjectCatalog(root);
  expect(catalog.cards.find(card => card.id === candidateId)).toMatchObject({ kind: 'hero', kindOverride: 'hero', parentId: null, deckId: null, state: null });
  expect(catalog.cards.find(card => card.id === taskB)?.parentId).toBe(candidateId);
  expect(catalog.cards.find(card => card.id === nativeA)?.parentId).toBe(candidateId);
  expect(catalog.warnings).toEqual([]);
  expect(await readFile(path.join(root, 'features/match.md'))).toEqual(before[0]);
  expect(await readFile(path.join(root, 'docs/guide.md'))).toEqual(docBefore);
  expect((await editCatalogBulk(root, await promotionRequest(root, [taskB, nativeA], candidateId, null))).outcome.unchanged).toEqual([taskB, nativeA]);
});

it.each([nativeA, taskA])('keeps unfinished promotion children pending and resumes after partial IO for %s', async candidateId => {
  const root = await fixture();
  const original = vi.mocked(native.replaceProjectMarkdown).getMockImplementation()!;
  let injected = false;
  vi.mocked(native.replaceProjectMarkdown).mockImplementation(async (...args) => {
    if (args[1].includes(nativeB.slice(5))) { injected = true; throw new Error('Promotion child IO failure'); }
    return original(...args);
  });
  const result = await editCatalogBulk(root, await promotionRequest(root, [nativeB], candidateId));
  expect(injected).toBe(true);
  expect(result.outcome).toMatchObject({ applied: [], pending: [nativeB], created: [] });
  expect(result.outcome.warnings[0]).toContain('Promotion child IO failure');
  const catalog = await readProjectCatalog(root);
  expect(catalog.cards.find(card => card.id === candidateId)).toMatchObject({ kind: 'hero', parentId: null, deckId: 'heroes' });
  expect(catalog.cards.find(card => card.id === nativeB)?.parentId).toBe(hero);
  const promotedBytes = await readFile(path.join(root, catalog.cards.find(card => card.id === candidateId)!.path));
  vi.mocked(native.replaceProjectMarkdown).mockImplementation(original);
  const retried = await editCatalogBulk(root, await promotionRequest(root, [nativeB], candidateId));
  expect(retried.outcome).toMatchObject({ applied: [nativeB], pending: [] });
  expect(await readFile(path.join(root, catalog.cards.find(card => card.id === candidateId)!.path))).toEqual(promotedBytes);
});

it.each([nativeA, taskA, 'doc:docs/guide.md'])('resumes %s promotion with legacy and native children after membership fails', async candidateId => {
  const root = await fixture();
  if (candidateId.startsWith('doc:')) await attach(root, candidateId, hero);
  const sourceBefore = await readFile(path.join(root, 'features/match.md'));
  const docBefore = await readFile(path.join(root, 'docs/guide.md'));
  const original = vi.mocked(native.replaceProjectMarkdown).getMockImplementation()!;
  let injected = false;
  vi.mocked(native.replaceProjectMarkdown).mockImplementation(async (...args) => {
    if (args[1] === 'tasks/deckmate.md') { injected = true; throw new Error('Membership publication failed'); }
    return original(...args);
  });
  const partial = await editCatalogBulk(root, await promotionRequest(root, [taskB, nativeB], candidateId, 'mixed'));
  expect(injected).toBe(true);
  expect(partial.outcome).toMatchObject({ applied: [], pending: [taskB, nativeB] });
  const interrupted = await readProjectCatalog(root);
  expect(interrupted.cards.find(card => card.id === candidateId)?.kind).toBe('hero');
  expect(interrupted.cards.find(card => card.id === taskB)?.parentId).toBe(hero);
  expect(interrupted.cards.find(card => card.id === nativeB)?.parentId).toBe(hero);
  vi.mocked(native.replaceProjectMarkdown).mockImplementation(original);
  vi.mocked(native.replaceProjectMarkdown).mockClear();
  const retried = await editCatalogBulk(root, await promotionRequest(root, [taskB, nativeB], candidateId, 'mixed'));
  expect(retried.outcome).toMatchObject({ applied: [taskB, nativeB], pending: [] });
  expect(vi.mocked(native.replaceProjectMarkdown).mock.calls.map(call => call[1])).toEqual(['tasks/deckmate.md', `cards/${nativeB.slice(5)}.md`]);
  const catalog = await readProjectCatalog(root);
  expect(catalog.cards.find(card => card.id === candidateId)).toMatchObject({ kind: 'hero', deckId: 'mixed', parentId: null });
  expect(catalog.cards.find(card => card.id === taskB)?.parentId).toBe(candidateId);
  expect(catalog.cards.find(card => card.id === nativeB)?.parentId).toBe(candidateId);
  expect(catalog.warnings).toEqual([]);
  expect(await readFile(path.join(root, 'features/match.md'))).toEqual(sourceBefore);
  expect(await readFile(path.join(root, 'docs/guide.md'))).toEqual(docBefore);
  expect((await editCatalogBulk(root, await promotionRequest(root, [taskB, nativeB], candidateId, 'mixed'))).outcome)
    .toMatchObject({ applied: [], unchanged: [taskB, nativeB], pending: [] });
});

it('preserves a concurrent child edit and reports only published child links after partial promotion', async () => {
  const root = await fixture();
  const child = (await native.readNativeCard(root, nativeB))!;
  const concurrentBytes = Buffer.concat([child.bytes, Buffer.from('\r\nConcurrent child edit.\r\n')]);
  const original = vi.mocked(native.replaceProjectMarkdown).getMockImplementation()!;
  let injected = false;
  vi.mocked(native.replaceProjectMarkdown).mockImplementation(async (...args) => {
    if (args[1] === child.card.path) { injected = true; await writeFile(path.join(root, child.card.path), concurrentBytes); }
    return original(...args);
  });
  const partial = await editCatalogBulk(root, await promotionRequest(root, [taskB, nativeB], nativeA));
  expect(injected).toBe(true);
  expect(partial.outcome).toMatchObject({ applied: [taskB], pending: [nativeB] });
  expect(partial.outcome.warnings[0]).toContain('CARD_CONFLICT');
  expect(await readFile(path.join(root, child.card.path))).toEqual(concurrentBytes);
  const catalog = await readProjectCatalog(root);
  expect(catalog.cards.find(card => card.id === nativeA)).toMatchObject({ kind: 'hero', parentId: null });
  expect(catalog.cards.find(card => card.id === taskB)?.parentId).toBe(nativeA);
  expect(catalog.cards.find(card => card.id === nativeB)?.parentId).toBe(hero);
  vi.mocked(native.replaceProjectMarkdown).mockImplementation(original);
  const retried = await editCatalogBulk(root, await promotionRequest(root, [taskB, nativeB], nativeA));
  expect(retried.outcome).toMatchObject({ applied: [nativeB], unchanged: [taskB], pending: [] });
  expect((await native.readNativeCard(root, nativeB))!.markdown).toContain('Concurrent child edit.');
});

it('preflights promotion hashes, explicit parent baselines, deck types and cycles before any write', async () => {
  const root = await fixture();
  const before = await snapshots(root);
  const valid = await promotionRequest(root, [nativeB], nativeA);
  if (valid.change.kind !== 'promote-parent') throw new Error('Invalid fixture');
  await expect(editCatalogBulk(root, { ...valid, change: { ...valid.change, sourceHash: '0'.repeat(64) } })).rejects.toThrow('CARD_CONFLICT');
  await expect(editCatalogBulk(root, { ...valid, change: { ...valid.change, expectedParentId: null } })).rejects.toThrow('PARENT_CONFLICT');
  await expect(editCatalogBulk(root, { ...valid, cards: valid.cards.map(card => ({ ...card, expectedParentId: null })) })).rejects.toThrow('PARENT_CONFLICT');
  await expect(editCatalogBulk(root, { ...valid, cards: valid.cards.map(({ expectedParentId: _parent, ...card }) => card) })).rejects.toThrow('PARENT_CONFLICT');
  await expect(editCatalogBulk(root, { ...valid, change: { ...valid.change, deckId: 'tasks' } })).rejects.toThrow('The target deck');
  await expect(editCatalogBulk(root, await promotionRequest(root, [nativeA], nativeA))).rejects.toThrow('own parent');
  expect(await snapshots(root)).toEqual(before);

  await createDoc(root, copyA);
  await attach(root, nativeA, copyA);
  const nestedBefore = await snapshots(root);
  await expect(editCatalogBulk(root, await promotionRequest(root, [copyA], nativeA))).rejects.toThrow('own Sub Card as a parent');
  expect(await snapshots(root)).toEqual(nestedBefore);
});

it('resumes legacy promotion after the role sidecar was saved but membership publication failed', async () => {
  const root = await fixture();
  const sourceBefore = await readFile(path.join(root, 'features/match.md'));
  const original = vi.mocked(native.replaceProjectMarkdown).getMockImplementation()!;
  let injected = false;
  vi.mocked(native.replaceProjectMarkdown).mockImplementation(async (...args) => {
    if (args[1] === 'tasks/deckmate.md') { injected = true; throw new Error('Membership publication failed'); }
    return original(...args);
  });
  const partial = await editCatalogBulk(root, await promotionRequest(root, [nativeB], taskA));
  expect(injected).toBe(true);
  expect(partial.outcome).toMatchObject({ applied: [], pending: [nativeB] });
  expect((await readProjectCatalog(root)).cards.find(card => card.id === taskA)).toMatchObject({ kind: 'hero', parentId: null, range: null });
  vi.mocked(native.replaceProjectMarkdown).mockImplementation(original);
  const retried = await editCatalogBulk(root, await promotionRequest(root, [nativeB], taskA));
  expect(retried.outcome).toMatchObject({ applied: [nativeB], pending: [] });
  const catalog = await readProjectCatalog(root);
  expect(catalog.warnings).toEqual([]);
  expect(catalog.cards.find(card => card.id === taskA)).toMatchObject({ deckId: 'heroes', parentId: null });
  expect(catalog.cards.find(card => card.id === nativeB)?.parentId).toBe(taskA);
  expect(await readFile(path.join(root, 'features/match.md'))).toEqual(sourceBefore);
  expect((await editCatalogBulk(root, await promotionRequest(root, [nativeB], taskA))).outcome.unchanged).toEqual([nativeB]);
});

it.each(['archived', 'deleted'] as const)('rejects %s promotion candidates without modifying source bytes', async flag => {
  const root = await fixture();
  await editCatalogBulk(root, await request(root, [nativeA], { kind: 'options', patch: { [flag]: true } }));
  const before = await snapshots(root);
  await expect(editCatalogBulk(root, await promotionRequest(root, [nativeB], nativeA))).rejects.toThrow('Restore');
  expect(await snapshots(root)).toEqual(before);
});

it.each(['archived', 'deleted'] as const)('rejects an empty promotion of an %s candidate with the restoreHero message and no writes', async flag => {
  const root = await fixture();
  await editCatalogBulk(root, await request(root, [nativeA], { kind: 'options', patch: { [flag]: true } }));
  const before = await snapshots(root);
  await expect(editCatalogBulk(root, await promotionRequest(root, [], nativeA))).rejects.toThrow('Restore the future Hero from Archive or Trash first.');
  expect(await snapshots(root)).toEqual(before);
});

it('rejects an empty promotion of a Journey card with the journeyHero message and no writes', async () => {
  const root = await fixture();
  const candidate = (await native.readNativeCard(root, nativeA))!;
  await native.createManagedMarkdown(root, `cards/${copyA.slice(5)}.md`, { ...candidate.metadata, id: copyA.slice(5), journey: { journeyId: 'pipeline', version: 1, stepId: 'step', instanceId: 'instance' } }, 'Journey body.');
  const before = await snapshots(root);
  await expect(editCatalogBulk(root, await promotionRequest(root, [], copyA))).rejects.toThrow('A Journey card cannot be promoted to a separate Hero.');
  expect(await snapshots(root)).toEqual(before);
});

it('rejects promotion or reparenting of Journey steps and does not overwrite concurrent candidate edits', async () => {
  const root = await fixture();
  const candidate = (await native.readNativeCard(root, nativeA))!;
  await native.createManagedMarkdown(root, `cards/${copyA.slice(5)}.md`, { ...candidate.metadata, id: copyA.slice(5), journey: { journeyId: 'pipeline', version: 1, stepId: 'step', instanceId: 'instance' } }, 'Journey body.');
  const before = await snapshots(root);
  await expect(editCatalogBulk(root, await promotionRequest(root, [nativeB], copyA))).rejects.toThrow('Journey');
  await expect(editCatalogBulk(root, await promotionRequest(root, [copyA], nativeA))).rejects.toThrow('Journey');
  expect(await snapshots(root)).toEqual(before);
  const original = vi.mocked(native.replaceProjectMarkdown).getMockImplementation()!;
  let injected = false;
  vi.mocked(native.replaceProjectMarkdown).mockImplementationOnce(async (...args) => {
    injected = true;
    await writeFile(path.join(root, candidate.card.path), Buffer.concat([candidate.bytes, Buffer.from('\r\nExternal candidate edit.\r\n')]));
    return original(...args);
  });
  await expect(editCatalogBulk(root, await promotionRequest(root, [nativeB], nativeA))).rejects.toThrow('CARD_CONFLICT');
  expect(injected).toBe(true);
  expect((await native.readNativeCard(root, nativeA))!.markdown).toContain('External candidate edit.');
  expect((await readProjectCatalog(root)).cards.find(card => card.id === nativeB)?.parentId).toBe(hero);
});

it('duplicates full content with selected properties, stable new IDs and no Journey provenance or Hero children', async () => {
  const root = await fixture();
  const change = { kind: 'duplicate' as const, deckId: 'mixed', properties: ['owner', 'effort'] as const, copies: [{ cardId: nativeA, newCardId: copyA }, { cardId: hero, newCardId: copyB }] };
  const result = await editCatalogBulk(root, await request(root, [nativeA, hero], { ...change, properties: [...change.properties] }));
  expect(result.outcome.created).toEqual([copyA, copyB]);
  const original = await native.readNativeCard(root, nativeA);
  const copy = await native.readNativeCard(root, copyA);
  expect(copy!.markdown).toBe(original!.markdown);
  expect(copy!.metadata).toMatchObject({ state: 'план', owner: 'Custom person', effort: 5, priority: null, parentId: hero });
  expect(copy!.metadata.journey).toBeUndefined();
  expect((await native.readNativeCard(root, copyB))!.markdown).toBe('Hero **full description**.\r\n');
  expect((await readProjectCatalog(root)).cards.filter(card => card.parentId === copyB)).toHaveLength(0);
  expect((await editCatalogBulk(root, await request(root, [nativeA, hero], { ...change, properties: [...change.properties] }))).outcome.unchanged).toEqual([nativeA, hero]);
});

it('converts eligible cards while preserving source text and supports Hand/tags/options plus recoverable Hero cascade', async () => {
  const root = await fixture(); const before = await snapshots(root);
  await editCatalogBulk(root, await request(root, [taskA, nativeA], { kind: 'convert', cardKind: 'doc', deckId: 'docs' }));
  let catalog = await readProjectCatalog(root);
  for (const id of [taskA, nativeA]) expect(catalog.cards.find(card => card.id === id)).toMatchObject({ kind: 'doc', state: null, deckId: 'docs', parentId: hero });
  expect((await snapshots(root))[0]).toEqual(before[0]);
  await editCatalogBulk(root, await request(root, [taskA, nativeA], { kind: 'convert', cardKind: 'task', deckId: 'tasks' }));
  await editCatalogBulk(root, await request(root, [taskA, nativeA], { kind: 'hand', memberId: 'kimi', mode: 'add' }));
  await editCatalogBulk(root, await request(root, [taskA, nativeA], { kind: 'tags', tags: ['sound'], mode: 'add' }));
  await editCatalogBulk(root, await request(root, [taskA, nativeA], { kind: 'options', patch: { bookmarked: true, run: 'Sprint 2', milestone: 'Demo', dueDate: '2026-12-01' } }));
  catalog = await readProjectCatalog(root);
  expect(catalog.cards.find(card => card.id === taskA)).toMatchObject({ kind: 'task', handMemberIds: ['kimi'], tags: ['sound'], run: 'Sprint 2', milestone: 'Demo', bookmarked: true });
  expect(catalog.cards.some(card => card.path === 'tasks/deckmate-card-options.md')).toBe(false);
  const cascade = catalog.cards.filter(card => card.parentId === hero).map(card => card.id);
  const deleted = await editCatalogBulk(root, await request(root, [hero], { kind: 'options', patch: { deleted: true } }));
  expect(new Set(deleted.outcome.applied)).toEqual(new Set([hero, ...cascade]));
  expect((await snapshots(root))[0]).toEqual(before[0]);
  expect(new Set((await editCatalogBulk(root, await request(root, [hero], { kind: 'options', patch: { deleted: true } }))).outcome.unchanged)).toEqual(new Set([hero, ...cascade]));
  await editCatalogBulk(root, await request(root, [hero], { kind: 'options', patch: { deleted: false } }));
  expect((await readProjectCatalog(root)).cards.filter(card => [hero, ...cascade].includes(card.id)).every(card => !card.deleted)).toBe(true);
});

it('API enforces sandbox and auth, returns outcome/options hash, and writes one durable activity event only for changes', async () => {
  const root = await fixture();
  await execute('git', ['init', '-b', 'deckmate/sandbox', root], { windowsHide: true });
  const app = await createApp({ editMode: 'sandbox', dataRoot: root, writeRoot: root, projectName: 'Test', port: 44319, python: 'python' }); apps.push(app);
  const headers = { host: '127.0.0.1:44319' };
  const token = (await app.inject({ url: '/api/snapshot', headers })).json().token;
  const authorized = { ...headers, 'x-deckmate-token': token };
  const payload = { ...await request(root, [nativeA, nativeB], { kind: 'options', patch: { bookmarked: true } }), source: 'sandbox' };
  expect((await app.inject({ method: 'POST', url: '/api/catalog', headers, payload })).statusCode).toBe(403);
  expect((await app.inject({ method: 'POST', url: '/api/catalog', headers: authorized, payload: { ...payload, source: 'live' } })).statusCode).toBe(403);
  const response = await app.inject({ method: 'POST', url: '/api/catalog', headers: authorized, payload });
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json().bulkOutcome).toMatchObject({ applied: [nativeA, nativeB], pending: [] });
  expect(response.json().optionsHash).toMatch(/^[0-9a-f]{64}$/u);
  const events = await native.listManagedMarkdown(root, 'tasks/deckmate-activity'); expect(events).toHaveLength(1);
  const retry = await app.inject({ method: 'POST', url: '/api/catalog', headers: authorized, payload: { ...await request(root, [nativeA, nativeB], { kind: 'options', patch: { bookmarked: true } }), source: 'sandbox' } });
  expect(retry.statusCode, retry.body).toBe(200);
  expect(retry.json().bulkOutcome.unchanged).toEqual([nativeA, nativeB]);
  expect(await native.listManagedMarkdown(root, 'tasks/deckmate-activity')).toEqual(events);
  const promoted = await app.inject({ method: 'POST', url: '/api/catalog', headers: authorized,
    payload: { ...await promotionRequest(root, [nativeB], nativeA), source: 'sandbox' } });
  expect(promoted.statusCode, promoted.body).toBe(200);
  expect(promoted.json().bulkOutcome).toMatchObject({ applied: [nativeB], pending: [] });
  const promotionEventPath = (await native.listManagedMarkdown(root, 'tasks/deckmate-activity')).find(filename => !events.includes(filename))!;
  const promotionEvent = await native.readManagedMarkdown(root, promotionEventPath);
  expect(promotionEvent?.metadata.cards).toEqual(expect.arrayContaining([expect.objectContaining({ id: nativeA }), expect.objectContaining({ id: nativeB })]));
});

it('API promotes without children, journals the Hero despite an empty outcome and rejects other empty actions', async () => {
  const root = await fixture();
  await attach(root, nativeA, null);
  await execute('git', ['init', '-b', 'deckmate/sandbox', root], { windowsHide: true });
  const app = await createApp({ editMode: 'sandbox', dataRoot: root, writeRoot: root, projectName: 'Test', port: 44319, python: 'python' }); apps.push(app);
  const headers = { host: '127.0.0.1:44319' };
  const token = (await app.inject({ url: '/api/snapshot', headers })).json().token;
  const authorized = { ...headers, 'x-deckmate-token': token };
  const wrongDeck = await app.inject({ method: 'POST', url: '/api/catalog', headers: authorized,
    payload: { ...await promotionRequest(root, [], nativeA, 'tasks'), source: 'sandbox' } });
  expect(wrongDeck.statusCode, wrongDeck.body).toBe(422);
  expect(wrongDeck.json().message).toContain('The target deck');
  const emptyState = await app.inject({ method: 'POST', url: '/api/catalog', headers: authorized,
    payload: { ...await request(root, [], { kind: 'state', state: 'started' }), source: 'sandbox' } });
  expect(emptyState.statusCode, emptyState.body).toBe(400);
  expect(await native.listManagedMarkdown(root, 'tasks/deckmate-activity')).toEqual([]);
  const promoted = await app.inject({ method: 'POST', url: '/api/catalog', headers: authorized,
    payload: { ...await promotionRequest(root, [], nativeA), source: 'sandbox' } });
  expect(promoted.statusCode, promoted.body).toBe(200);
  expect(promoted.json().bulkOutcome).toEqual({ applied: [nativeA], unchanged: [], pending: [], created: [], warnings: [] });
  expect(promoted.json().cards).toEqual(expect.arrayContaining([expect.objectContaining({ id: nativeA, kind: 'hero', state: null, parentId: null, deckId: 'heroes' })]));
  const events = await native.listManagedMarkdown(root, 'tasks/deckmate-activity');
  expect(events).toHaveLength(1);
  const event = await native.readManagedMarkdown(root, events[0]);
  expect(event?.metadata.cards).toEqual([expect.objectContaining({ id: nativeA })]);
  expect(event?.metadata.action).toBe('bulk-edit-cards');
  const retry = await app.inject({ method: 'POST', url: '/api/catalog', headers: authorized,
    payload: { ...await promotionRequest(root, [], nativeA), source: 'sandbox' } });
  expect(retry.statusCode, retry.body).toBe(200);
  expect(await native.listManagedMarkdown(root, 'tasks/deckmate-activity')).toEqual(events);
});

it('API rejects bulk-assign-deck and reorder-hand with an empty card list', async () => {
  const root = await fixture();
  await execute('git', ['init', '-b', 'deckmate/sandbox', root], { windowsHide: true });
  const app = await createApp({ editMode: 'sandbox', dataRoot: root, writeRoot: root, projectName: 'Test', port: 44319, python: 'python' }); apps.push(app);
  const headers = { host: '127.0.0.1:44319' };
  const token = (await app.inject({ url: '/api/snapshot', headers })).json().token;
  const authorized = { ...headers, 'x-deckmate-token': token };
  const catalog = await readProjectCatalog(root);
  const assign = await app.inject({ method: 'POST', url: '/api/catalog', headers: authorized,
    payload: { action: 'bulk-assign-deck', manifestHash: catalog.manifestHash, deckId: 'mixed', cards: [], source: 'sandbox' } });
  expect(assign.statusCode, assign.body).toBe(400);
  const reorder = await app.inject({ method: 'POST', url: '/api/catalog', headers: authorized,
    payload: { action: 'reorder-hand', manifestHash: catalog.manifestHash, memberId: 'kimi', cards: [], source: 'sandbox' } });
  expect(reorder.statusCode, reorder.body).toBe(400);
  expect(await native.listManagedMarkdown(root, 'tasks/deckmate-activity')).toEqual([]);
});
