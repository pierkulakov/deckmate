import { afterEach, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import * as filesystem from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import type { FastifyInstance } from 'fastify';
import type { CatalogCardSelection, CatalogEdit } from '../src/catalog-contracts.ts';
import { editProjectCatalog, emptyManifest, parseManifestBytes, readProjectCatalog, renderCatalogManifest } from '../server/catalog.ts';
import { expectOnlyDeckOrderChanged } from './manifest-assertions.ts';
import { CatalogService } from '../server/catalog-service.ts';
import { ProjectIndex } from '../server/project-index.ts';
import { createApp } from '../server/app.ts';
import * as native from '../server/native-cards.ts';

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename), readFile: vi.fn(actual.readFile), open: vi.fn(actual.open) };
});
vi.mock('../server/native-cards.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../server/native-cards.ts')>();
  return { ...actual, editNativeCard: vi.fn(actual.editNativeCard) };
});
const execute = promisify(execFile);
const roots: string[] = [];
const apps: FastifyInstance[] = [];
afterEach(async () => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
  for (const app of apps.splice(0)) await app.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const legacyId = 'task:features/match.md#1.0';
const secondLegacyId = 'task:features/match.md#1.1';
const docId = 'doc:docs/guide.md';
const nativeIds = ['card:11111111-1111-4111-8111-111111111111', 'card:22222222-2222-4222-8222-222222222222'];
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'deckmate-bulk-'));
  roots.push(root);
  for (const folder of ['features', 'docs', 'tasks', 'Tools']) await mkdir(path.join(root, folder));
  await writeFile(path.join(root, 'features/match.md'), '\uFEFF# Match\r\n## 1 — Sound\r\n### 1.0 Shot (в работе)\r\n**Кто:** Full legacy notes\r\nLegacy bytes.\r\n### 1.1 Tail (план)\r\nMore bytes.\r\n');
  await writeFile(path.join(root, 'docs/guide.md'), '# Guide\nKeep document.\n');
  await writeFile(path.join(root, 'tasks/iterations.md'), '## Итерация 1 — Проверка\nНачало: 2026-11-03\n');
  await writeFile(path.join(root, 'Tools/board.py'), '# Read-only fixture\n');
  const manifest = emptyManifest();
  manifest.spaces.push({ id: 'work', title: 'Work' });
  for (const [id, kind] of [['audio', 'task'], ['mixed', 'mixed'], ['knowledge', 'knowledge']] as const) manifest.decks.push({
    id, kind, title: id, spaceId: 'work', description: '', icon: 'box', color: '#123456',
  });
  manifest.tracks.push({ id: 'release', title: 'Release', description: '' }, { id: 'sound', title: 'Sound', description: '' });
  manifest.membership.push({ card: legacyId, deck: 'audio', tracks: ['release'] }, { card: docId, deck: 'knowledge' });
  await writeFile(path.join(root, 'tasks/deckmate.md'), '\uFEFF' + renderCatalogManifest(manifest).replace(/\n/gu, '\r\n') + '\r\nPersonal text remains.\r\n');
  for (const id of nativeIds) {
    const relative = `cards/${id.slice(5)}.md`;
    await native.createManagedMarkdown(root, relative, { deckmate: 'card', schema: 1, id: id.slice(5), kind: 'task', title: id,
      state: 'в работе', owner: 'External human', deckId: 'audio', trackIds: ['release'], parentId: 'hero:features/match.md#1', iteration: 7,
      dependsOn: [legacyId], customNote: 'Preserve unknown metadata',
    }, '# Work\nBody **bytes**.\n');
    const text = (await readFile(path.join(root, relative))).toString('utf8');
    await writeFile(path.join(root, relative), '\uFEFF' + text.replace(/\n/gu, '\r\n'));
  }
  return root;
}
async function selection(root: string, ids: string[]): Promise<{ cards: CatalogCardSelection[]; manifestHash: string }> {
  const catalog = await readProjectCatalog(root);
  return { manifestHash: catalog.manifestHash, cards: ids.map(id => ({ cardId: id, sourceHash: catalog.cards.find(card => card.id === id)!.sourceHash })) };
}
async function primaryBytes(root: string) {
  return Promise.all(['tasks/deckmate.md', 'features/match.md', 'docs/guide.md', ...nativeIds.map(id => `cards/${id.slice(5)}.md`)].map(relative => readFile(path.join(root, relative))));
}

it('assigns mixed legacy/native cards with one manifest commit and preserves all source bodies and other metadata', async () => {
  const root = await fixture();
  const ids = [legacyId, secondLegacyId, docId, ...nativeIds];
  const before = await primaryBytes(root);
  const nativeBefore = await native.readNativeCard(root, nativeIds[0]);
  vi.mocked(filesystem.rename).mockClear();
  await editProjectCatalog(root, { action: 'bulk-assign-deck', deckId: 'mixed', ...await selection(root, ids) });
  expect(vi.mocked(filesystem.rename).mock.calls.filter(([, destination]) => String(destination).endsWith('deckmate.md'))).toHaveLength(1);
  const catalog = await readProjectCatalog(root);
  for (const id of ids) expect(catalog.cards.find(card => card.id === id)!.deckId).toBe('mixed');
  expect(await readFile(path.join(root, 'features/match.md'))).toEqual(before[1]);
  expect(await readFile(path.join(root, 'docs/guide.md'))).toEqual(before[2]);
  const after = await readFile(path.join(root, 'tasks/deckmate.md'));
  const boundary = Buffer.from('\r\n---\r\n');
  expect(after.subarray(0, 8)).toEqual(before[0].subarray(0, 8));
  expect(after.subarray(after.indexOf(boundary))).toEqual(before[0].subarray(before[0].indexOf(boundary)));
  const manifest = parseManifestBytes(after).manifest;
  expect(manifest.membership.some(entry => nativeIds.includes(entry.card))).toBe(false);
  expect(manifest.deckOrder?.mixed).toEqual({ flatOrder: ids });
  const nativeAfter = await native.readNativeCard(root, nativeIds[0]);
  expect(nativeAfter!.metadata).toEqual({ ...nativeBefore!.metadata, deckId: 'mixed' });
  expect(nativeAfter!.bytes.subarray(nativeAfter!.bodyRange.start)).toEqual(nativeBefore!.bytes.subarray(nativeBefore!.bodyRange.start));
});

it('adds a track as a union and makes a fresh idempotent retry without any writes', async () => {
  const root = await fixture();
  const ids = [legacyId, secondLegacyId, ...nativeIds];
  await editProjectCatalog(root, { action: 'bulk-add-track', trackId: 'sound', ...await selection(root, ids) });
  const catalog = await readProjectCatalog(root);
  for (const id of [legacyId, ...nativeIds]) expect(catalog.cards.find(card => card.id === id)!.trackIds).toEqual(['release', 'sound']);
  expect(catalog.cards.find(card => card.id === secondLegacyId)!.trackIds).toEqual(['sound']);
  const before = await primaryBytes(root);
  vi.mocked(filesystem.rename).mockClear();
  await editProjectCatalog(root, { action: 'bulk-add-track', trackId: 'sound', ...await selection(root, ids) });
  expect(vi.mocked(filesystem.rename)).not.toHaveBeenCalled();
  expect(await primaryBytes(root)).toEqual(before);
});

it('preflights every target, source revision and unique selection before changing any file', async () => {
  const root = await fixture();
  const selected = await selection(root, [legacyId, ...nativeIds]);
  const before = await primaryBytes(root);
  const invalid: CatalogEdit[] = [
    { action: 'bulk-assign-deck', deckId: 'knowledge', ...selected },
    { action: 'bulk-add-track', trackId: 'unknown', ...selected },
    { action: 'bulk-assign-deck', deckId: 'mixed', ...selected, cards: [...selected.cards.slice(0, 2), { ...selected.cards[2], sourceHash: '0'.repeat(64) }] },
    { action: 'bulk-assign-deck', deckId: 'mixed', ...selected, cards: [...selected.cards, selected.cards[0]] },
    { action: 'bulk-assign-deck', deckId: 'mixed', ...selected, cards: [{ cardId: ' ', sourceHash: '0'.repeat(64) }] },
    { action: 'bulk-assign-deck', deckId: 'mixed', ...selected, cards: [{ cardId: 'missing', sourceHash: '0'.repeat(64) }] },
    { action: 'bulk-assign-deck', deckId: 'mixed', ...selected, cards: [] },
    { action: 'bulk-assign-deck', deckId: 'mixed', ...selected, cards: Array.from({ length: 1001 }, () => selected.cards[0]) },
    { action: 'bulk-assign-deck', deckId: 'mixed', ...selected, manifestHash: 'stale' },
  ];
  vi.mocked(filesystem.rename).mockClear();
  for (const edit of invalid) await expect(editProjectCatalog(root, edit)).rejects.toThrow();
  expect(vi.mocked(filesystem.rename)).not.toHaveBeenCalled();
  expect(await primaryBytes(root)).toEqual(before);
});

it.each(['Injected disk failure', 'CARD_CONFLICT'])('reports saved IDs after %s and a fresh retry completes only the remaining native card', async failure => {
  const root = await fixture();
  const original = vi.mocked(native.editNativeCard).getMockImplementation()!;
  let injected = false;
  vi.mocked(native.editNativeCard).mockImplementation(async (...args) => {
    if (args[1] === nativeIds[1]) { injected = true; throw new Error(failure); }
    return original(...args);
  });
  const selected = await selection(root, [legacyId, ...nativeIds]);
  await expect(editProjectCatalog(root, { action: 'bulk-assign-deck', deckId: 'mixed', ...selected })).rejects.toMatchObject({
    saved: true, updated: [legacyId, nativeIds[0]], pending: [nativeIds[1]],
  });
  expect(injected).toBe(true);
  const partial = await readProjectCatalog(root);
  expect(partial.cards.find(card => card.id === legacyId)!.deckId).toBe('mixed');
  expect(partial.cards.find(card => card.id === nativeIds[0])!.deckId).toBe('mixed');
  expect(partial.cards.find(card => card.id === nativeIds[1])!.deckId).toBe('audio');
  vi.mocked(native.editNativeCard).mockImplementation(original);
  vi.mocked(filesystem.rename).mockClear();
  await editProjectCatalog(root, { action: 'bulk-assign-deck', deckId: 'mixed', ...await selection(root, [legacyId, ...nativeIds]) });
  expect(vi.mocked(filesystem.rename).mock.calls.map(([, destination]) => path.relative(root, String(destination)))).toEqual([
    path.join('tasks', 'deckmate.md'), path.join('cards', `${nativeIds[1].slice(5)}.md`),
  ]);
  expect(parseManifestBytes(await readFile(path.join(root, 'tasks/deckmate.md'))).manifest.deckOrder?.mixed)
    .toEqual({ flatOrder: [legacyId, ...nativeIds] });
});

it('keeps partial-success warning and fresh files visible even when rebuilding the index also fails', async () => {
  const root = await fixture();
  await execute('git', ['init', '-b', 'deckmate/sandbox', root], { windowsHide: true });
  const service = new CatalogService({ editMode: 'sandbox', dataRoot: root, writeRoot: root, projectName: 'Test', port: 44319, python: 'python' }, ':memory:');
  const original = vi.mocked(native.editNativeCard).getMockImplementation()!;
  let injected = false;
  try {
    await service.get('sandbox');
    vi.mocked(native.editNativeCard).mockImplementation(async (...args) => {
      if (args[1] === nativeIds[1]) { injected = true; throw new Error('Injected native failure'); }
      return original(...args);
    });
    const indexFailure = vi.spyOn(ProjectIndex.prototype, 'replace').mockImplementationOnce(() => { throw new Error('Injected index failure'); });
    const result = await service.edit({ action: 'bulk-add-track', trackId: 'sound', ...await selection(root, [legacyId, ...nativeIds]) }, 'sandbox');
    expect(injected).toBe(true);
    expect(indexFailure).toHaveBeenCalled();
    expect(result.savedWarning).toContain('Some changes were saved: 2 of 3');
    expect(result.savedWarning).toContain(nativeIds[1]);
    expect(result.savedWarning).toContain('search index was not updated');
    expect(result.cards.find(card => card.id === legacyId)!.trackIds).toEqual(['release', 'sound']);
    expect(result.bulkOutcome).toMatchObject({ applied: [legacyId, nativeIds[0]], unchanged: [], pending: [nativeIds[1]] });
    vi.mocked(native.editNativeCard).mockImplementation(original);
    const retry = await service.edit({ action: 'bulk-add-track', trackId: 'sound', ...await selection(root, [legacyId, ...nativeIds]) }, 'sandbox');
    expect(retry.bulkOutcome).toMatchObject({ applied: [nativeIds[1]], unchanged: [legacyId, nativeIds[0]], pending: [] });
  } finally { await service.close(); }
});

it.each(['move', 'track'] as const)('exposes structured %s partial outcome, including already-satisfied cards', async kind => {
  const root = await fixture();
  await execute('git', ['init', '-b', 'deckmate/sandbox', root], { windowsHide: true });
  const command = kind === 'move' ? { action: 'bulk-assign-deck' as const, deckId: 'mixed' } : { action: 'bulk-add-track' as const, trackId: 'sound' };
  await editProjectCatalog(root, { ...command, ...await selection(root, [legacyId]) });
  const service = new CatalogService({ editMode: 'sandbox', dataRoot: root, writeRoot: root, projectName: 'Test', port: 44319, python: 'python' }, ':memory:');
  const original = vi.mocked(native.editNativeCard).getMockImplementation()!;
  let injected = false;
  vi.mocked(native.editNativeCard).mockImplementation(async (...args) => {
    if (args[1] === nativeIds[1]) { injected = true; throw new Error('Injected partial membership write'); }
    return original(...args);
  });
  try {
    const response = await service.edit({ ...command, ...await selection(root, [legacyId, ...nativeIds]) }, 'sandbox');
    expect(injected).toBe(true);
    expect(response.bulkOutcome).toMatchObject({ applied: [nativeIds[0]], unchanged: [legacyId], pending: [nativeIds[1]] });
    expect(response.bulkOutcome!.warnings.join(' ')).toContain('Injected partial membership write');
  } finally { await service.close(); }
});

it('validates bulk API schema and tokens, rejects live writes and returns fresh state for sandbox success', async () => {
  const root = await fixture();
  await execute('git', ['init', '-b', 'deckmate/sandbox', root], { windowsHide: true });
  const app = await createApp({ editMode: 'sandbox', dataRoot: root, writeRoot: root, projectName: 'Test', port: 44319, python: 'python' });
  apps.push(app);
  const headers = { host: '127.0.0.1:44319' };
  const snapshot = (await app.inject({ url: '/api/snapshot', headers })).json();
  const authorized = { ...headers, 'x-deckmate-token': snapshot.token };
  const payload = { action: 'bulk-add-track', trackId: 'sound', source: 'sandbox', ...await selection(root, [legacyId, ...nativeIds]) };
  expect((await app.inject({ method: 'POST', url: '/api/catalog', headers, payload })).statusCode).toBe(403);
  expect((await app.inject({ method: 'POST', url: '/api/catalog', headers: authorized, payload: { ...payload, source: 'live' } })).statusCode).toBe(403);
  for (const cards of [[], Array.from({ length: 1001 }, () => payload.cards[0]), [{ cardId: legacyId }], [{ cardId: legacyId, sourceHash: 'bad' }]]) {
    expect((await app.inject({ method: 'POST', url: '/api/catalog', headers: authorized, payload: { ...payload, cards } })).statusCode).toBe(400);
  }
  const success = await app.inject({ method: 'POST', url: '/api/catalog', headers: authorized, payload });
  expect(success.statusCode, success.body).toBe(200);
  expect(success.json().cards.find((card: { id: string }) => card.id === legacyId).trackIds).toEqual(['release', 'sound']);
  const unassigned = await app.inject({ method: 'POST', url: '/api/catalog', headers: authorized, payload: {
    action: 'bulk-assign-deck', deckId: null, source: 'sandbox', ...await selection(root, [legacyId, ...nativeIds]),
  } });
  expect(unassigned.statusCode, unassigned.body).toBe(200);
  expect(unassigned.json().cards.find((card: { id: string }) => card.id === legacyId).deckId).toBeNull();
  const base = await selection(root, [nativeIds[0]]);
  const links = { action: 'set-card-links', cardId: nativeIds[0], deckId: 'mixed', trackIds: ['release'], source: 'sandbox', manifestHash: base.manifestHash, sourceHash: base.cards[0].sourceHash };
  expect((await app.inject({ method: 'POST', url: '/api/catalog', headers: authorized, payload: { ...links, sourceHash: undefined } })).statusCode).toBe(400);
  expect((await app.inject({ method: 'POST', url: '/api/catalog', headers: authorized, payload: { ...links, sourceHash: '0'.repeat(64) } })).statusCode).toBe(409);
  const linked = await app.inject({ method: 'POST', url: '/api/catalog', headers: authorized, payload: links });
  expect(linked.statusCode, linked.body).toBe(200);
  expect(linked.json().cards.find((card: { id: string }) => card.id === nativeIds[0])).toMatchObject({ deckId: 'mixed', trackIds: ['release'] });
});


it('rechecks manifest revision after the source precommit scan and preserves a concurrent external edit', async () => {
  const root = await fixture();
  const selected = await selection(root, [legacyId, ...nativeIds]);
  const manifestPath = path.join(root, 'tasks/deckmate.md');
  const external = Buffer.concat([await readFile(manifestPath), Buffer.from('\r\nExternal edit.\r\n')]);
  const nativeBefore = await readFile(path.join(root, `cards/${nativeIds[0].slice(5)}.md`));
  const originalRead = vi.mocked(filesystem.readFile).getMockImplementation()!;
  const originalOpen = vi.mocked(filesystem.open).getMockImplementation()!;
  let sourceReads = 0;
  // 2026-11-07: full scans open guarded descriptors; publication checks still use readFile.
  const beforeSourceRead = async (filename: unknown) => {
    if (String(filename) === path.join(root, 'features/match.md')) {
      sourceReads += 1;
      if (sourceReads === 3) await writeFile(manifestPath, external);
    }
  };
  vi.mocked(filesystem.readFile).mockImplementation(async (...args: Parameters<typeof filesystem.readFile>) => {
    await beforeSourceRead(args[0]);
    return originalRead(...args);
  });
  vi.mocked(filesystem.open).mockImplementation(async (...args: Parameters<typeof filesystem.open>) => {
    await beforeSourceRead(args[0]);
    return originalOpen(...args);
  });
  await expect(editProjectCatalog(root, { action: 'bulk-assign-deck', deckId: 'mixed', ...selected })).rejects.toThrow('CATALOG_CONFLICT');
  expect(sourceReads).toBe(3);
  expect(await readFile(manifestPath)).toEqual(external);
  expect(await readFile(path.join(root, `cards/${nativeIds[0].slice(5)}.md`))).toEqual(nativeBefore);
});


it('counts a native commit when its helper reports an error after publication', async () => {
  const root = await fixture();
  const before = await readFile(path.join(root, 'tasks/deckmate.md'));
  const original = vi.mocked(native.editNativeCard).getMockImplementation()!;
  let injected = false;
  vi.mocked(native.editNativeCard).mockImplementation(async (...args) => {
    await original(...args);
    injected = true;
    throw Object.assign(new Error('Post-save verification failed'), { saved: true });
  });
  await expect(editProjectCatalog(root, { action: 'bulk-assign-deck', deckId: 'mixed', ...await selection(root, nativeIds) })).rejects.toMatchObject({
    saved: true, updated: [nativeIds[0]], pending: [nativeIds[1]],
  });
  expect(injected).toBe(true);
  expect((await native.readNativeCard(root, nativeIds[0]))!.card.deckId).toBe('mixed');
  expect((await native.readNativeCard(root, nativeIds[1]))!.card.deckId).toBe('audio');
  expectOnlyDeckOrderChanged(before, await readFile(path.join(root, 'tasks/deckmate.md')),
    { mixed: { flatOrder: nativeIds } });
});
it.each([legacyId, nativeIds[0]])('saves both card links atomically for %s and preserves unrelated bytes', async cardId => {
  const root = await fixture();
  const selected = await selection(root, [cardId]);
  const before = await primaryBytes(root);
  const nativeBefore = await native.readNativeCard(root, nativeIds[0]);
  vi.mocked(filesystem.rename).mockClear();
  await editProjectCatalog(root, { action: 'set-card-links', cardId, deckId: 'mixed', trackIds: ['sound'], sourceHash: selected.cards[0].sourceHash, manifestHash: selected.manifestHash });
  const destinations = [path.join('tasks', 'deckmate.md')];
  if (cardId.startsWith('card:')) destinations.push(path.join('cards', `${cardId.slice(5)}.md`));
  expect(vi.mocked(filesystem.rename).mock.calls.map(([, destination]) => path.relative(root, String(destination)))).toEqual(destinations);
  expect((await readProjectCatalog(root)).cards.find(card => card.id === cardId)).toMatchObject({ deckId: 'mixed', trackIds: ['sound'] });
  expect(await readFile(path.join(root, 'features/match.md'))).toEqual(before[1]);
  expect(await readFile(path.join(root, 'docs/guide.md'))).toEqual(before[2]);
  if (cardId.startsWith('card:')) {
    expectOnlyDeckOrderChanged(before[0], await readFile(path.join(root, 'tasks/deckmate.md')),
      { mixed: { flatOrder: [cardId] } });
    const changed = await native.readNativeCard(root, cardId);
    expect(changed!.metadata).toEqual({ ...nativeBefore!.metadata, deckId: 'mixed', trackIds: ['sound'] });
    expect(changed!.bytes.subarray(changed!.bodyRange.start)).toEqual(nativeBefore!.bytes.subarray(nativeBefore!.bodyRange.start));
  } else {
    const after = await readFile(path.join(root, 'tasks/deckmate.md'));
    const boundary = Buffer.from('\r\n---\r\n');
    expect(after.subarray(after.indexOf(boundary))).toEqual(before[0].subarray(before[0].indexOf(boundary)));
    expect(await readFile(path.join(root, `cards/${nativeIds[0].slice(5)}.md`))).toEqual(before[3]);
  }
});

it.each([legacyId, nativeIds[0]])('rejects invalid targets and a stale form sourceHash for %s without changing either link', async cardId => {
  const root = await fixture();
  const selected = await selection(root, [cardId]);
  const action = { action: 'set-card-links' as const, cardId, deckId: 'mixed', trackIds: ['sound'], sourceHash: selected.cards[0].sourceHash, manifestHash: selected.manifestHash };
  const before = await primaryBytes(root);
  await expect(editProjectCatalog(root, { ...action, deckId: 'knowledge' })).rejects.toThrow('card type');
  await expect(editProjectCatalog(root, { ...action, trackIds: ['unknown'] })).rejects.toThrow('Tracks');
  await expect(editProjectCatalog(root, { ...action, sourceHash: undefined })).rejects.toThrow('current version');
  expect(await primaryBytes(root)).toEqual(before);
  if (cardId.startsWith('card:')) await native.editNativeCard(root, cardId, action.sourceHash, { trackIds: ['release', 'sound'] });
  else await writeFile(path.join(root, 'features/match.md'), Buffer.concat([before[1], Buffer.from('\r\nExternal source edit.\r\n')]));
  const external = await primaryBytes(root);
  await expect(editProjectCatalog(root, action)).rejects.toThrow('CARD_CONFLICT');
  expect(await primaryBytes(root)).toEqual(external);
});

it('uses the form manifest revision to protect legacy tracks from an external membership edit', async () => {
  const root = await fixture();
  const base = await selection(root, [legacyId]);
  await editProjectCatalog(root, { action: 'set-tracks', cardId: legacyId, trackIds: ['release', 'sound'], manifestHash: base.manifestHash });
  const external = await primaryBytes(root);
  await expect(editProjectCatalog(root, { action: 'set-card-links', cardId: legacyId, deckId: 'mixed', trackIds: [], sourceHash: base.cards[0].sourceHash, manifestHash: base.manifestHash })).rejects.toThrow('CATALOG_CONFLICT');
  expect(await primaryBytes(root)).toEqual(external);
});
