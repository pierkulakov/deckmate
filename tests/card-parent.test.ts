import { afterEach, expect, it, vi } from 'vitest';
import * as filesystem from 'node:fs/promises';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { CatalogEdit } from '../src/catalog-contracts.ts';
import { editProjectCatalog, emptyManifest, readProjectCatalog, renderCatalogManifest } from '../server/catalog.ts';
import { createManagedMarkdown, listManagedMarkdown, readManagedMarkdown, type NativeCardMetadata } from '../server/native-cards.ts';

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, open: vi.fn(actual.open) };
});
const roots: string[] = [];
const taskId = 'task:features/audio.md#1.0';
const structuralHero = 'hero:features/audio.md#1';
type ParentEdit = Extract<CatalogEdit, { action: 'set-card-parent' }>;
afterEach(async () => {
  const actual = await vi.importActual<typeof filesystem>('node:fs/promises');
  vi.mocked(filesystem.open).mockReset().mockImplementation(actual.open);
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function native(root: string, kind: NativeCardMetadata['kind'], parentId: string | null = null, journey = false) {
  const id = randomUUID();
  const metadata: NativeCardMetadata = { deckmate: 'card', schema: 1, id, kind, title: 'Звуковой объект',
    state: kind === 'task' ? 'план' : null, owner: null, parentId, deckId: kind === 'hero' ? 'concepts' : 'audio', trackIds: ['release'] };
  if (journey) metadata.journey = { journeyId: randomUUID(), version: 1, stepId: 'sound', instanceId: randomUUID() };
  const relative = `cards/${id}.md`;
  await createManagedMarkdown(root, relative, metadata, 'Не трогать тело.\r\nВторая строка.\n');
  return { id: 'card:' + id, filename: path.join(root, relative) };
}

async function fixture(membership = `membership:\n  - card: '${taskId}' # child ref\n    deck: audio # deck stays\n    tracks: [release]\n`) {
  const root = await mkdtemp(path.join(tmpdir(), 'deckmate-card-parent-'));
  roots.push(root);
  await mkdir(path.join(root, 'features'));
  await mkdir(path.join(root, 'tasks'));
  const mechanic = path.join(root, 'features/audio.md');
  await writeFile(mechanic, '\uFEFF# Звук\r\n\r\n## 1 — Оружие\r\nОписание.\n### 1.0 Выстрел (в работе)\r\n**Кто:** Kimi\r\nНе менять.\n');
  const manifest = emptyManifest();
  manifest.spaces = [{ id: 'work', title: 'Work' }];
  manifest.decks = [
    { id: 'audio', spaceId: 'work', title: 'Audio', kind: 'task', description: '', icon: 'audio', color: '#123456' },
    { id: 'concepts', spaceId: 'work', title: 'Concepts', kind: 'asset', description: '', icon: 'box', color: '#123456' },
  ];
  manifest.tracks = [{ id: 'release', title: 'Release', description: '' }];
  const filename = path.join(root, 'tasks/deckmate.md');
  const text = renderCatalogManifest(manifest).replace('membership: []\n', membership);
  await writeFile(filename, '\uFEFF' + text.replace(/\n/gu, '\r\n') + '\nЛичный текст с LF.\n');
  const hero = await native(root, 'hero');
  return { root, filename, mechanic, hero };
}

async function parentEdit(root: string, cardId: string, parentId: string | null): Promise<ParentEdit> {
  const catalog = await readProjectCatalog(root);
  const card = catalog.cards.find(candidate => candidate.id === cardId)!;
  const parent = catalog.cards.find(candidate => candidate.id === parentId);
  return { action: 'set-card-parent', cardId, sourceHash: card.sourceHash, expectedParentId: card.parentId,
    parentId, parentSourceHash: parent?.sourceHash ?? null, manifestHash: catalog.manifestHash };
}

it('overrides a structural legacy parent across decks, then detaches explicitly without changing the mechanic', async () => {
  const { root, filename, mechanic, hero } = await fixture();
  const beforeMechanic = await readFile(mechanic);
  expect((await parentEdit(root, taskId, hero.id)).expectedParentId).toBe(structuralHero);
  await editProjectCatalog(root, await parentEdit(root, taskId, hero.id));
  let card = (await readProjectCatalog(root)).cards.find(candidate => candidate.id === taskId)!;
  expect(card).toMatchObject({ parentId: hero.id, deckId: 'audio', trackIds: ['release'], state: 'started' });
  await editProjectCatalog(root, await parentEdit(root, taskId, null));
  expect((await readProjectCatalog(root)).cards.find(candidate => candidate.id === taskId)?.parentId).toBeNull();
  expect((await readFile(filename, 'utf8'))).toContain('parentId: null');
  await editProjectCatalog(root, await parentEdit(root, taskId, structuralHero));
  card = (await readProjectCatalog(root)).cards.find(candidate => candidate.id === taskId)!;
  expect(card.parentId).toBe(structuralHero);
  expect(await readFile(mechanic)).toEqual(beforeMechanic);
});

it.each([
  { name: 'block map insertion', yaml: `membership:\n  - card: '${taskId}' # child ref\n    deck: audio # deck stays\n    tracks: [release]\n`,
    from: `card: '${taskId}'`, to: (parent: string) => `parentId: "${parent}"\r\n    card: '${taskId}'` },
  { name: 'flow map insertion', yaml: `membership: [{card: '${taskId}', deck: audio, tracks: [release]}] # keep\n`,
    from: `{card: '${taskId}'`, to: (parent: string) => `{parentId: "${parent}", card: '${taskId}'` },
  { name: 'scalar replacement', yaml: `membership:\n- card: '${taskId}'\n  parentId: '${structuralHero}' # retain comment\n  deck: audio\n`,
    from: `parentId: '${structuralHero}'`, to: (parent: string) => `parentId: "${parent}"` },
  { name: 'empty sequence', yaml: 'membership: [] # keep empty comment\n',
    from: 'membership: []', to: (parent: string) => `membership: [{ card: "${taskId}", parentId: "${parent}" }]` },
  { name: 'new entry in block sequence', yaml: 'membership:\n  - card: "doc:features/audio.md" # keep other entry\n',
    from: '  - card: "doc:features/audio.md"', to: (parent: string) => `  - { card: "${taskId}", parentId: "${parent}" }\r\n  - card: "doc:features/audio.md"` },
  { name: 'implicit null scalar', yaml: `membership:\n- card: '${taskId}'\n  parentId:\n`,
    from: '  parentId:\r\n', to: (parent: string) => `  parentId: "${parent}"\r\n` },
])('preserves every other manifest byte for $name', async ({ yaml, from, to }) => {
  const { root, filename, mechanic, hero } = await fixture(yaml);
  const before = await readFile(filename);
  const source = await readFile(mechanic);
  const expected = Buffer.from(before.toString('utf8').replace(from, to(hero.id)));
  await editProjectCatalog(root, await parentEdit(root, taskId, hero.id));
  expect(await readFile(filename)).toEqual(expected);
  expect(await readFile(mechanic)).toEqual(source);
  expect((await readProjectCatalog(root)).cards.find(card => card.id === taskId)?.parentId).toBe(hero.id);
});

it('creates the first manifest for an explicit detach without altering source cards', async () => {
  const { root, filename, mechanic } = await fixture();
  const before = await readFile(mechanic);
  await rm(filename);
  await editProjectCatalog(root, await parentEdit(root, taskId, null));
  expect((await readProjectCatalog(root)).cards.find(card => card.id === taskId)?.parentId).toBeNull();
  expect(await readFile(mechanic)).toEqual(before);
});

it.each(['null # keep this comment', '', '>+\r\n  ' + structuralHero])('changes only native parent scalar (%s), then no-ops without publication', async scalar => {
  const { root, filename, hero } = await fixture();
  const child = await native(root, 'task');
  const original = (await readFile(child.filename, 'utf8')).replace(/\r?\n/gu, '\r\n')
    .replace('parentId: null', `parentId:${scalar ? ' ' + scalar : ''}`);
  const before = Buffer.from('\uFEFF' + original.replace('---\r\nНе трогать', 'custom: "value: untouched" # extension\r\n---\r\nНе трогать'));
  await writeFile(child.filename, before);
  const manifestBefore = await readFile(filename);
  const edit = await parentEdit(root, child.id, hero.id);
  await editProjectCatalog(root, edit);
  const replacedScalar = scalar.startsWith('null #') ? 'null' : scalar;
  const expected = before.toString('utf8').replace(`parentId:${replacedScalar ? ' ' + replacedScalar : ''}`, `parentId: "${hero.id}"`);
  expect(await readFile(child.filename)).toEqual(Buffer.from(expected));
  expect(await readFile(filename)).toEqual(manifestBefore);
  const identity = await stat(child.filename, { bigint: true });
  expect(await editProjectCatalog(root, await parentEdit(root, child.id, hero.id))).toEqual([]);
  const after = await stat(child.filename, { bigint: true });
  expect([after.ino, after.mtimeNs]).toEqual([identity.ino, identity.mtimeNs]);
  await editProjectCatalog(root, await parentEdit(root, child.id, null));
  expect((await readProjectCatalog(root)).cards.find(card => card.id === child.id)).toMatchObject({ parentId: null, deckId: 'audio', trackIds: ['release'] });
});

it('rejects stale child, target, manifest and expected-parent baselines without writes, including no-op requests', async () => {
  const { root, filename, hero } = await fixture();
  const child = await native(root, 'task');
  const edit = await parentEdit(root, child.id, hero.id);
  const before = await readFile(child.filename);
  const manifest = await readFile(filename);
  for (const invalid of [
    { sourceHash: '0'.repeat(64) }, { parentSourceHash: '0'.repeat(64) }, { manifestHash: '0'.repeat(64) },
    { expectedParentId: structuralHero }, { parentId: null, parentSourceHash: null, sourceHash: '0'.repeat(64) },
  ]) await expect(editProjectCatalog(root, { ...edit, ...invalid })).rejects.toThrow(/CONFLICT/u);
  expect(await readFile(child.filename)).toEqual(before);
  expect(await readFile(filename)).toEqual(manifest);
});

it('rejects Hero children, missing/non-family targets and independent Journey reparenting', async () => {
  const { root, filename, hero } = await fixture();
  const child = await native(root, 'task');
  const journeyChild = await native(root, 'task', structuralHero, true);
  const manifest = await readFile(filename);
  for (const [cardId, target] of [[hero.id, structuralHero], [child.id, taskId], [journeyChild.id, hero.id], [journeyChild.id, null]] as const) {
    await expect(editProjectCatalog(root, await parentEdit(root, cardId, target))).rejects.toThrow();
  }
  const edit = await parentEdit(root, child.id, hero.id);
  await expect(editProjectCatalog(root, { ...edit, parentId: 'card:' + randomUUID() })).rejects.toThrow('existing Hero');
  expect(await readFile(filename)).toEqual(manifest);
  expect((await readProjectCatalog(root)).cards.find(card => card.id === journeyChild.id)?.parentId).toBe(structuralHero);
  expect(await editProjectCatalog(root, await parentEdit(root, journeyChild.id, structuralHero))).toEqual([]);
});

it.each(['native', 'legacy'] as const)('rechecks Hero bytes after staging a %s parent update', async kind => {
  const { root, filename, hero } = await fixture();
  const child = kind === 'native' ? await native(root, 'task') : { id: taskId, filename };
  const before = await readFile(child.filename);
  const edit = await parentEdit(root, child.id, hero.id);
  const actual = await vi.importActual<typeof filesystem>('node:fs/promises');
  let changed = false;
  vi.mocked(filesystem.open).mockImplementation(async (target, flags, mode) => {
    if (flags === 'wx' && !changed) {
      changed = true;
      await actual.writeFile(hero.filename, Buffer.concat([await actual.readFile(hero.filename), Buffer.from('External Hero edit\n')]));
    }
    return actual.open(target, flags, mode);
  });
  await expect(editProjectCatalog(root, edit)).rejects.toThrow('CARD_CONFLICT');
  expect(changed).toBe(true);
  expect(await readFile(child.filename)).toEqual(before);
});

it('rechecks the manifest before publishing a native parent and refuses aliased membership updates', async () => {
  const { root, filename, hero } = await fixture();
  const child = await native(root, 'task');
  const before = await readFile(child.filename);
  const edit = await parentEdit(root, child.id, hero.id);
  const actual = await vi.importActual<typeof filesystem>('node:fs/promises');
  let changed = false;
  vi.mocked(filesystem.open).mockImplementation(async (target, flags, mode) => {
    if (flags === 'wx' && !changed) {
      changed = true;
      await actual.writeFile(filename, Buffer.concat([await actual.readFile(filename), Buffer.from('External manifest edit\n')]));
    }
    return actual.open(target, flags, mode);
  });
  await expect(editProjectCatalog(root, edit)).rejects.toThrow('CATALOG_CONFLICT');
  expect(changed).toBe(true);
  expect(await readFile(child.filename)).toEqual(before);
  vi.mocked(filesystem.open).mockImplementation(actual.open);
  const alias = await fixture(`membership: [&child { card: '${taskId}' }]\ncustom: *child\n`);
  const manifest = await readFile(alias.filename);
  await expect(editProjectCatalog(alias.root, await parentEdit(alias.root, taskId, alias.hero.id))).rejects.toThrow('other catalog properties');
  expect(await readFile(alias.filename)).toEqual(manifest);
});

it('allows guarded activity Markdown paths and rejects malformed/traversing names', async () => {
  const { root } = await fixture();
  const relative = `tasks/deckmate-activity/20261103T203012123Z-${randomUUID()}.md`;
  expect(await createManagedMarkdown(root, relative, { schema: 1, action: 'set-card-parent' }, 'Attached task.\n')).toBe(true);
  expect(await listManagedMarkdown(root, 'tasks/deckmate-activity')).toEqual([relative]);
  expect((await readManagedMarkdown(root, relative))?.markdown).toBe('Attached task.\n');
  for (const invalid of ['tasks/deckmate-activity/../event.md', `tasks/deckmate-activity/wrong-${randomUUID()}.md`, 'tasks/other.md']) {
    await expect(createManagedMarkdown(root, invalid, { schema: 1 }, '')).rejects.toThrow('Invalid managed Markdown file path');
  }
});
