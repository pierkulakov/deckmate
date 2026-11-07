// Card transfer contract tests, 2026-11-04.
// Exercise guarded writes (editProjectCatalog / CatalogService) against temporary fixtures:
// transfers preserve IDs, relationships, and source bytes while changing only deck metadata.
import { afterEach, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CatalogService } from '../server/catalog-service.ts';
import * as filesystem from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { CatalogCardSelection, CatalogEdit } from '../src/catalog-contracts.ts';
import { editProjectCatalog, emptyManifest, readProjectCatalog, renderCatalogManifest } from '../server/catalog.ts';
import * as native from '../server/native-cards.ts';
import { expectOnlyDeckOrderChanged } from './manifest-assertions.ts';

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

const execute = promisify(execFile);
const roots: string[] = [];
afterEach(async () => {
  vi.clearAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

const legacyId = 'task:features/match.md#1.0';
const siblingId = 'task:features/match.md#1.1';
const legacyHeroId = 'hero:features/match.md#1';
const docId = 'doc:docs/guide.md';
const nativeIds = {
  task: 'card:5e8f6c92-1d3b-4a77-9c21-0a1b2c3d4e01',
  journey: 'card:5e8f6c92-1d3b-4a77-9c21-0a1b2c3d4e02',
  hero: 'card:5e8f6c92-1d3b-4a77-9c21-0a1b2c3d4e03',
  child: 'card:5e8f6c92-1d3b-4a77-9c21-0a1b2c3d4e04',
};

/** All fixture source files, keyed by root-relative path. */
async function primaryBytes(root: string): Promise<Map<string, Buffer>> {
  const relatives = [
    'tasks/deckmate.md', 'features/match.md', 'docs/guide.md', 'tasks/deckmate-card-options.md',
    ...Object.values(nativeIds).map(id => `cards/${id.slice(5)}.md`),
  ];
  const entries = await Promise.all(relatives.map(async relative => [relative, await readFile(path.join(root, relative))] as const));
  return new Map(entries);
}

async function expectUnchanged(root: string, before: Map<string, Buffer>, ...exceptRelatives: string[]): Promise<void> {
  const after = await primaryBytes(root);
  for (const [relative, bytes] of before) {
    if (exceptRelatives.includes(relative)) continue;
    expect(after.get(relative)).toEqual(bytes);
  }
}

/** Select cards with current sourceHash values from a fresh catalog. */
async function selection(root: string, ids: string[]): Promise<{ manifestHash: string; cards: CatalogCardSelection[] }> {
  const catalog = await readProjectCatalog(root);
  return {
    manifestHash: catalog.manifestHash,
    cards: ids.map(id => {
      const card = catalog.cards.find(candidate => candidate.id === id);
      if (!card) throw new Error(`Фикстура не содержит карточку ${id}`);
      return { cardId: id, sourceHash: card.sourceHash };
    }),
  };
}

async function createNativeCard(root: string, id: string, metadata: Record<string, unknown>, markdown: string): Promise<void> {
  const relative = `cards/${id.slice(5)}.md`;
  await native.createManagedMarkdown(root, relative, metadata, markdown);
  // Match project file encoding with BOM and CRLF, as in the other catalog tests.
  const text = (await readFile(path.join(root, relative))).toString('utf8');
  await writeFile(path.join(root, relative), '\uFEFF' + text.replace(/\n/gu, '\r\n'));
}

async function fixture(legacyParent?: string | null): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'deckmate-transfer-'));
  roots.push(root);
  for (const folder of ['features', 'docs', 'tasks', 'Tools']) await mkdir(path.join(root, folder));
  await writeFile(path.join(root, 'features/match.md'),
    '\uFEFF# Match\r\n## 1 — Sound\r\nВступление эпизода.\r\n### 1.0 Shot (в работе)\r\n**Кто:** Full legacy notes\r\n'
    + '**Ждёт:** 1.1\r\nLegacy body bytes.\r\n### 1.1 Tail (план)\r\nSibling bytes.\r\n');
  await writeFile(path.join(root, 'docs/guide.md'), '# Guide\r\nKeep document bytes.\r\n');
  await writeFile(path.join(root, 'Tools/board.py'), '# Read-only fixture\r\n');
  const manifest = emptyManifest();
  manifest.spaces.push({ id: 'work', title: 'Work' });
  const decks = [
    { id: 'audio', kind: 'task' },
    { id: 'sprint', kind: 'task' },
    { id: 'concepts', kind: 'asset' },
    { id: 'mixed', kind: 'mixed' },
    { id: 'knowledge', kind: 'knowledge' },
  ] as const;
  for (const deck of decks) manifest.decks.push({ ...deck, title: deck.id, spaceId: 'work', description: '', icon: 'box', color: '#123456' });
  manifest.tracks.push({ id: 'release', title: 'Release', description: '' }, { id: 'sound', title: 'Sound', description: '' });
  // Cover an inferred parent, explicit detachment (parentId: null), an untouched peer, and a Hero in its own deck.
  manifest.membership.push(
    { card: legacyId, deck: 'audio', tracks: ['release'], ...(legacyParent !== undefined ? { parentId: legacyParent } : {}) },
    { card: siblingId, deck: 'audio', parentId: null },
    { card: docId, deck: 'knowledge' },
    { card: legacyHeroId, deck: 'concepts' },
  );
  await writeFile(path.join(root, 'tasks/deckmate.md'),
    '\uFEFF' + renderCatalogManifest(manifest).replace(/\n/gu, '\r\n') + '\r\nPersonal text remains.\r\n');
  await native.createManagedMarkdown(root, 'tasks/deckmate-card-options.md', {
    schema: 1,
    cards: {
      [nativeIds.task]: { tags: ['sound-design'], bookmarked: true, run: 'Run 1' },
      [nativeIds.journey]: { tags: ['review'], bookmarked: true, run: 'Run 2' },
    },
  }, '');
  await createNativeCard(root, nativeIds.task, {
    deckmate: 'card', schema: 1, id: nativeIds.task.slice(5), kind: 'task', title: 'Проверить перенос',
    state: 'в работе', owner: 'External human', deckId: 'audio', trackIds: ['release'], parentId: legacyHeroId,
    iteration: 7, dependsOn: [legacyId], effort: 2, priority: 'high', customNote: 'Preserve unknown metadata',
  }, '# Work\nBody **bytes**.\n');
  await createNativeCard(root, nativeIds.journey, {
    deckmate: 'card', schema: 1, id: nativeIds.journey.slice(5), kind: 'task', title: 'Шаг конвейера',
    state: 'план', owner: 'Full legacy notes', deckId: 'audio', trackIds: [], parentId: legacyHeroId,
    dependsOn: [nativeIds.task],
    journey: { journeyId: '7c9e6679-7425-40de-944b-e07fc1f90ae7', version: 1, stepId: 'sound', instanceId: '7c9e6679-7425-40de-944b-e07fc1f90ae8' },
  }, '# Journey step\nInstruction bytes.\n');
  await createNativeCard(root, nativeIds.hero, {
    deckmate: 'card', schema: 1, id: nativeIds.hero.slice(5), kind: 'hero', title: 'Native Hero',
    state: null, owner: null, deckId: 'concepts', trackIds: [], parentId: null,
  }, '# Native Hero\nHero bytes.\n');
  await createNativeCard(root, nativeIds.child, {
    deckmate: 'card', schema: 1, id: nativeIds.child.slice(5), kind: 'task', title: 'Native ребёнок',
    state: 'план', owner: null, deckId: 'audio', trackIds: ['sound'], parentId: nativeIds.hero, dependsOn: [legacyId],
  }, '# Native child\nChild bytes.\n');
  return root;
}

it('transfers a native Task while preserving its ID, links, properties, and body bytes; only deckId and deck order change', async () => {
  const root = await fixture();
  const catalog = await readProjectCatalog(root);
  expect(catalog.warnings).toEqual([]);
  const cardBefore = catalog.cards.find(card => card.id === nativeIds.journey)!;
  const nativeBefore = await native.readNativeCard(root, nativeIds.journey);
  const before = await primaryBytes(root);
  vi.mocked(filesystem.rename).mockClear();

  await editProjectCatalog(root, {
    action: 'assign-deck', cardId: nativeIds.journey, deckId: 'sprint',
    sourceHash: cardBefore.sourceHash, manifestHash: catalog.manifestHash,
  } satisfies CatalogEdit);

  // 2026-11-04: transfers persist Manual Order in the manifest before writing the native card.
  expect(vi.mocked(filesystem.rename).mock.calls.map(([, destination]) => path.relative(root, String(destination)))).toEqual([
    path.join('tasks', 'deckmate.md'), path.join('cards', `${nativeIds.journey.slice(5)}.md`),
  ]);
  const relative = `cards/${nativeIds.journey.slice(5)}.md`;
  const fileAfter = (await primaryBytes(root)).get(relative)!;
  // Only deckId bytes change; guarded writes use a quoted JSON literal.
  expect(fileAfter.toString('utf8')).toEqual(before.get(relative)!.toString('utf8').replace('deckId: audio', 'deckId: "sprint"'));
  const nativeAfter = await native.readNativeCard(root, nativeIds.journey);
  expect(nativeAfter).not.toBeNull();
  expect(nativeAfter!.fileHash).not.toBe(nativeBefore!.fileHash);
  expect(nativeAfter!.bytes.subarray(nativeAfter!.bodyRange.start)).toEqual(nativeBefore!.bytes.subarray(nativeBefore!.bodyRange.start));
  const { deckId, ...metadataBefore } = nativeBefore!.metadata;
  const { deckId: deckAfter, ...metadataAfter } = nativeAfter!.metadata;
  expect(deckAfter).toBe('sprint');
  expect(metadataAfter).toEqual(metadataBefore);
  await expectUnchanged(root, before, relative, 'tasks/deckmate.md');
  expectOnlyDeckOrderChanged(before.get('tasks/deckmate.md')!, await readFile(path.join(root, 'tasks/deckmate.md')),
    { sprint: { flatOrder: [nativeIds.journey] } });

  const cardAfter = (await readProjectCatalog(root)).cards.find(card => card.id === nativeIds.journey)!;
  expect(cardAfter.deckId).toBe('sprint');
  expect([
    cardAfter.id, cardAfter.kind, cardAfter.parentId, cardAfter.dependsOn, cardAfter.journey,
    cardAfter.owner, cardAfter.ownerNote, cardAfter.state, cardAfter.trackIds, cardAfter.effort, cardAfter.priority,
  ]).toEqual([
    nativeIds.journey, 'task', legacyHeroId, [nativeIds.task], cardBefore.journey,
    'Full legacy notes', cardBefore.ownerNote, 'not-started', [], undefined, undefined,
  ]);
  // 2026-11-04: CardOptions survive for both the transferred card and its neighbor.
  expect(cardAfter.tags).toEqual(['review']);
  expect(cardAfter.run).toBe('Run 2');
  expect(cardAfter.bookmarked).toBe(true);
  const taskAfter = (await readProjectCatalog(root)).cards.find(card => card.id === nativeIds.task)!;
  expect(taskAfter.deckId).toBe('audio');
  expect(taskAfter.tags).toEqual(['sound-design']);
  expect(taskAfter.run).toBe('Run 1');
  expect(taskAfter.bookmarked).toBe(true);
});

it.each([undefined, nativeIds.hero, null])('bulk transfer preserves legacy source bytes and parent override %s', async parentId => {
  const root = await fixture(parentId);
  const before = await primaryBytes(root);
  const originalCard = (await readProjectCatalog(root)).cards.find(card => card.id === legacyId)!;
  await editProjectCatalog(root, { action: 'bulk-assign-deck', deckId: 'sprint', ...await selection(root, [legacyId]) });
  const after = await readProjectCatalog(root);
  expect(after.cards.find(card => card.id === legacyId)).toEqual({ ...originalCard, deckId: 'sprint' });
  expect(after.cards.find(card => card.id === legacyId)!.parentId).toBe(parentId === undefined ? legacyHeroId : parentId);
  await expectUnchanged(root, before, 'tasks/deckmate.md');
  expectOnlyDeckOrderChanged(
    Buffer.from(before.get('tasks/deckmate.md')!.toString().replace('deck: audio', 'deck: "sprint"')),
    await readFile(path.join(root, 'tasks/deckmate.md')), { sprint: { flatOrder: [legacyId] } });
  // 2026-11-04: legacy dependency annotations remain source text; this catalog reader does not project them.
  expect(originalCard.markdown).toContain('**Ждёт:** 1.1');
  expect(originalCard.dependsOn).toBeUndefined();
});

it('moves a parent and child independently while retaining their cross-deck family and dependencies', async () => {
  const root = await fixture();
  const beforeParentMove = await primaryBytes(root);
  const childBefore = (await readProjectCatalog(root)).cards.find(card => card.id === nativeIds.child)!;
  await editProjectCatalog(root, { action: 'bulk-assign-deck', deckId: 'mixed', ...await selection(root, [nativeIds.hero]) });
  await expectUnchanged(root, beforeParentMove, `cards/${nativeIds.hero.slice(5)}.md`, 'tasks/deckmate.md');
  expectOnlyDeckOrderChanged(beforeParentMove.get('tasks/deckmate.md')!, await readFile(path.join(root, 'tasks/deckmate.md')),
    { mixed: { flatOrder: [nativeIds.hero] } });
  expect((await readProjectCatalog(root)).cards.find(card => card.id === nativeIds.child)).toEqual(childBefore);
  const beforeChildMove = await primaryBytes(root);
  await editProjectCatalog(root, { action: 'bulk-assign-deck', deckId: 'sprint', ...await selection(root, [nativeIds.child]) });
  await expectUnchanged(root, beforeChildMove, `cards/${nativeIds.child.slice(5)}.md`, 'tasks/deckmate.md');
  expectOnlyDeckOrderChanged(beforeChildMove.get('tasks/deckmate.md')!, await readFile(path.join(root, 'tasks/deckmate.md')),
    { mixed: { flatOrder: [nativeIds.hero] }, sprint: { flatOrder: [nativeIds.child] } });
  const after = await readProjectCatalog(root);
  expect(after.cards.find(card => card.id === nativeIds.hero)).toMatchObject({ deckId: 'mixed', parentId: null });
  expect(after.cards.find(card => card.id === nativeIds.child)).toMatchObject({
    deckId: 'sprint', parentId: nativeIds.hero, dependsOn: [legacyId], owner: childBefore.owner,
    state: childBefore.state, markdown: childBefore.markdown, trackIds: childBefore.trackIds,
  });
});

it('moves a mixed family and Journey selection without changing identity, relations or non-deck metadata', async () => {
  const root = await fixture();
  const before = await readProjectCatalog(root);
  const primaryBefore = await primaryBytes(root);
  const ids = [legacyId, legacyHeroId, nativeIds.task, nativeIds.journey, nativeIds.hero, nativeIds.child, docId];
  const nativeBefore = await Promise.all(Object.values(nativeIds).map(id => native.readNativeCard(root, id)));
  await editProjectCatalog(root, { action: 'bulk-assign-deck', deckId: 'mixed', ...await selection(root, ids) });
  const after = await readProjectCatalog(root);
  expect(after.cards.map(card => card.id).sort()).toEqual(before.cards.map(card => card.id).sort());
  expect(new Set(after.cards.map(card => card.id)).size).toBe(after.cards.length);
  for (const previous of before.cards) {
    const current = after.cards.find(card => card.id === previous.id)!;
    expect(current.deckId).toBe(ids.includes(previous.id) ? 'mixed' : previous.deckId);
    // 2026-11-04: projected dates come from birthtime/mtime and change after atomic file replacement.
    const { deckId: previousDeck, sourceHash: previousHash, range: previousRange, createdAt: previousCreated, updatedAt: previousUpdated, ...previousFacts } = previous;
    const { deckId: currentDeck, sourceHash: currentHash, range: currentRange, createdAt: currentCreated, updatedAt: currentUpdated, ...currentFacts } = current;
    expect(currentFacts).toEqual(previousFacts);
    if (current.parentId) expect(after.cards.some(card => card.id === current.parentId)).toBe(true);
    for (const dependency of current.dependsOn ?? []) expect(after.cards.some(card => card.id === dependency)).toBe(true);
  }
  for (const previous of nativeBefore) {
    const current = await native.readNativeCard(root, previous!.card.id);
    expect(current!.metadata).toEqual({ ...previous!.metadata, deckId: 'mixed' });
    expect(current!.bytes.subarray(current!.bodyRange.start)).toEqual(previous!.bytes.subarray(previous!.bodyRange.start));
  }
  for (const relative of ['features/match.md', 'docs/guide.md', 'tasks/deckmate-card-options.md']) {
    expect(await readFile(path.join(root, relative))).toEqual(primaryBefore.get(relative));
  }
});

it.each(['manifest', 'source', 'incompatible', 'missing'])('rejects %s preflight failure without changing any selected card', async failure => {
  const root = await fixture();
  // The second card would fail compatibility after the first card would otherwise be movable.
  const ids = failure === 'incompatible' ? [nativeIds.task, nativeIds.hero] : [legacyId, nativeIds.task, nativeIds.child];
  const captured = await selection(root, ids);
  const before = await primaryBytes(root);
  const edit: Extract<CatalogEdit, { action: 'bulk-assign-deck' }> = {
    action: 'bulk-assign-deck', deckId: failure === 'missing' ? 'unknown' : 'sprint', ...captured,
  };
  if (failure === 'manifest') edit.manifestHash = '0'.repeat(64);
  if (failure === 'source') edit.cards[edit.cards.length - 1].sourceHash = '0'.repeat(64);
  vi.mocked(filesystem.rename).mockClear();
  await expect(editProjectCatalog(root, edit)).rejects.toThrow(
    failure === 'manifest' ? 'CATALOG_CONFLICT' : failure === 'source' ? 'CARD_CONFLICT' : 'does not accept',
  );
  expect(vi.mocked(filesystem.rename)).not.toHaveBeenCalled();
  await expectUnchanged(root, before);
});

it('returns 409 for a queued stale transfer and creates no activity event for a fresh no-op retry', async () => {
  const root = await fixture();
  await execute('git', ['init', '-b', 'deckmate/sandbox', root], { windowsHide: true });
  const service = new CatalogService({ editMode: 'sandbox', dataRoot: root, writeRoot: root, projectName: 'Test', port: 44319, python: 'python' }, ':memory:');
  try {
    const captured = await selection(root, [nativeIds.journey]);
    const first = service.edit({ action: 'bulk-assign-deck', deckId: 'mixed', ...captured }, 'sandbox');
    const second = service.edit({ action: 'bulk-assign-deck', deckId: 'sprint', ...captured }, 'sandbox');
    const outcomes = await Promise.allSettled([first, second]);
    expect(outcomes[0].status).toBe('fulfilled');
    expect(outcomes[1].status).toBe('rejected');
    if (outcomes[1].status === 'rejected') expect(outcomes[1].reason).toMatchObject({ status: 409 });
    expect((await readProjectCatalog(root)).cards.find(card => card.id === nativeIds.journey)?.deckId).toBe('mixed');
    const before = await primaryBytes(root);
    const activityRoot = path.join(root, 'tasks/deckmate-activity');
    const events = await readdir(activityRoot);
    expect(events).toHaveLength(1);
    const eventBytes = await readFile(path.join(activityRoot, events[0]));
    vi.mocked(filesystem.rename).mockClear();
    const retry = await service.edit({ action: 'bulk-assign-deck', deckId: 'mixed', ...await selection(root, [nativeIds.journey]) }, 'sandbox');
    expect(retry.bulkOutcome).toMatchObject({ applied: [], unchanged: [nativeIds.journey], pending: [] });
    expect(vi.mocked(filesystem.rename)).not.toHaveBeenCalled();
    await expectUnchanged(root, before);
    expect(await readdir(activityRoot)).toEqual(events);
    expect(await readFile(path.join(activityRoot, events[0]))).toEqual(eventBytes);
  } finally { await service.close(); }
});
