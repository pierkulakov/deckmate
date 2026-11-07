import { afterEach, expect, it, vi } from 'vitest';
import * as filesystem from 'node:fs/promises';
import * as coverStorage from '../server/catalog-covers.ts';
import { createManagedMarkdown } from '../server/native-cards.ts';
import type { CatalogMember } from '../src/catalog-contracts.ts';
import { mkdtemp, mkdir, readFile, writeFile, rm, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { editProjectCatalog, emptyManifest, readProjectCatalog, renderCatalogManifest } from '../server/catalog.ts';

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename) };
});
const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'deckmate-catalog-'));
  roots.push(root);
  for (const directory of ['features', 'docs', 'tasks']) await mkdir(path.join(root, directory));
  await writeFile(path.join(root, 'features/audio.md'), '\uFEFF# Звук\r\n\r\n## 1 — Оружие\r\n### 1.0 Выстрел (в работе)\r\n**Кто:** Павел\r\nТело.\r\n### 1.1 Хвост (принято)\r\nГотово.\r\n');
  await writeFile(path.join(root, 'docs/guide.md'), '# Руководство\nБез статуса.\n');
  const manifest = emptyManifest();
  manifest.members = [{ id: 'pavel', label: 'Павел', kind: 'human', aliases: ['Паша'] }];
  manifest.spaces.push({ id: 'production', title: 'Производство' });
  manifest.decks.push({ id: 'audio', spaceId: 'production', title: 'Звук', kind: 'task', description: '', icon: 'audio', color: '#ff990a' },
    { id: 'knowledge', spaceId: 'production', title: 'Знания', kind: 'knowledge', description: '', icon: 'book', color: '#9cb8d0' });
  manifest.tracks.push({ id: 'release', title: 'Релиз', description: 'Сквозная работа' });
  manifest.membership.push({ card: 'task:features/audio.md#1.0', deck: 'audio', tracks: ['release'] },
    { card: 'doc:docs/guide.md', deck: 'knowledge', tracks: ['release'] });
  const filename = path.join(root, 'tasks/deckmate.md');
  await writeFile(filename, '\uFEFF' + renderCatalogManifest(manifest).replace(/\n/gu, '\r\n') + '\r\nЛичный текст: **не менять**.\r\n');
  return { root, filename };
}

it('projects task, document and Hero with one source parent and cross-deck track membership', async () => {
  const { root } = await fixture();
  const catalog = await readProjectCatalog(root);
  expect(catalog.documents).toHaveLength(2);
  expect(catalog.cards).toHaveLength(5);
  expect(catalog.cards.find(card => card.id === 'doc:features/audio.md')?.title).toBe('Звук');
  expect(catalog.cards.find(card => card.id === 'task:features/audio.md#1.0')).toMatchObject({ state: 'started', owner: 'Павел',
    deckId: 'audio', trackIds: ['release'], parentId: 'hero:features/audio.md#1' });
  for (const card of catalog.cards.filter(card => card.kind !== 'task')) expect(card).toMatchObject({ state: null, range: null });
  const task = catalog.cards.find(card => card.kind === 'task')!;
  const bytes = await readFile(path.join(root, task.path));
  expect(bytes.subarray(task.range!.start, task.range!.end).toString('utf8')).toBe(task.markdown);
  expect(catalog.cards.filter(card => card.trackIds.includes('release')).map(card => card.deckId)).toEqual(['knowledge', 'audio']);
  expect(catalog.formatLanguage).toBe('ru');
  expect(catalog.warnings).toEqual([]);
});

it('changes only the YAML block, preserving BOM, CRLF, body and all source files byte for byte', async () => {
  const { root, filename } = await fixture();
  const before = await readFile(filename);
  const sourceBefore = await readFile(path.join(root, 'features/audio.md'));
  const catalog = await readProjectCatalog(root);
  await editProjectCatalog(root, { action: 'create-track', title: 'Анимация', description: 'Работа', manifestHash: catalog.manifestHash });
  const after = await readFile(filename);
  expect(after.toString('utf8')).not.toContain('formatLanguage:');
  expect(after.subarray(0, 8)).toEqual(before.subarray(0, 8));
  const body = Buffer.from('\r\n---\r\n');
  expect(after.subarray(after.indexOf(body))).toEqual(before.subarray(before.indexOf(body)));
  expect(after.toString('utf8')).not.toMatch(/(?<!\r)\n/u);
  expect(await readFile(path.join(root, 'features/audio.md'))).toEqual(sourceBefore);
  expect((await readProjectCatalog(root)).tracks).toHaveLength(2);
});

it('rejects stale writes, incompatible deck types and duplicate membership without changing the file', async () => {
  const { root, filename } = await fixture();
  const catalog = await readProjectCatalog(root);
  const before = await readFile(filename);
  await expect(editProjectCatalog(root, { action: 'create-space', title: 'Новый', manifestHash: 'old' })).rejects.toThrow('CATALOG_CONFLICT');
  await expect(editProjectCatalog(root, { action: 'assign-deck', cardId: 'task:features/audio.md#1.0', deckId: 'knowledge', manifestHash: catalog.manifestHash })).rejects.toThrow('card type');
  expect(await readFile(filename)).toEqual(before);
  const manifest = emptyManifest();
  manifest.membership = [{ card: 'same' }, { card: 'same' }];
  expect(() => renderCatalogManifest(manifest)).toThrow('Duplicate card');
});

it.each(['\n', '\r\n'])('preserves existing YAML bytes and comments when appending a deck (%j)', async newline => {
  const { root, filename } = await fixture();
  const original = '\uFEFF' + [
    '---', '# Workspace comment', 'schema: 1  # schema comment',
    "spaces: [ {id: production, title: 'Производство'} ]", '# Decks comment', 'decks:',
    '  - id: audio # Existing deck', "    title: 'Звук'", '    spaceId: production', '    kind: task',
    '    icon: audio', '    color: "#ff990a"', "    description: ''", '# Keep the track section',
    'tracks: [ ] # Track comment', 'membership: []', '---', '', 'Личный текст: **не менять**.', '',
  ].join(newline);
  await writeFile(filename, original);
  const deckId = '6f1c2a40-9b7e-4c1d-8f2a-3b4c5d6e7f80';
  await editProjectCatalog(root, { action: 'create-deck', deckId, spaceId: 'production', title: 'New', kind: 'task',
    icon: 'star', color: '#112233', description: '', manifestHash: (await readProjectCatalog(root)).manifestHash });
  const after = await readFile(filename, 'utf8');
  const boundary = original.indexOf('# Keep the track section');
  expect(after.startsWith(original.slice(0, boundary))).toBe(true);
  expect(after.endsWith(original.slice(boundary))).toBe(true);
  const added = after.slice(boundary, after.indexOf('# Keep the track section'));
  expect(added).toContain(`  - id: ${deckId}${newline}`);
  expect(added).toContain(`    title: New${newline}`);
  expect(added).toContain(`    spaceId: production${newline}`);
  expect(added).not.toMatch(/[{}]|"(?:id|title|spaceId)"/u);
  if (newline === '\r\n') expect(after).not.toMatch(/(?<!\r)\n/u);
  expect((await readProjectCatalog(root)).decks.map(deck => deck.id)).toEqual(['audio', deckId]);
});

it.each([false, true].flatMap(flow => ['', "'", '"'].map(quote => ({ flow, quote }))))('changes only a deck scalar in commented YAML ($flow, $quote)', async ({ flow, quote }) => {
  const { root, filename } = await fixture();
  const original = '\uFEFF' + [
    '---', 'schema: 1 # keep', "spaces: [{id: production, title: 'Work'}]",
    ...(flow ? ['decks: [{id: audio, title: "Audio", spaceId: production, kind: task, icon: audio, color: "#ff990a", description: ""}] # deck']
      : ['decks:', '  - id: audio # deck', '    title: "Audio"', '    spaceId: production', '    kind: task # type',
        '    icon: audio', '    color: "#ff990a"', "    description: ''"]),
    'tracks: [] # track', 'membership: []', '---', 'Body stays.', '',
  ].join('\r\n').replace('kind: task', `kind: ${quote}task${quote}`);
  await writeFile(filename, original);
  await editProjectCatalog(root, { action: 'set-deck-kind', deckId: 'audio', kind: 'mixed', manifestHash: (await readProjectCatalog(root)).manifestHash });
  expect(await readFile(filename)).toEqual(Buffer.from(original.replace(`kind: ${quote}task${quote}`, `kind: ${quote}mixed${quote}`)));
});

it.each([false, true])('preserves neighboring bytes when adding and removing deck properties and records (flow: %s)', async flow => {
  const { root, filename } = await fixture();
  const first = '{id: audio, title: "Audio", spaceId: production, kind: task, icon: audio, color: "#ff990a", description: ""}';
  const second = '{id: other, title: "Other", spaceId: production, kind: task, icon: box, color: "#123456", description: ""}';
  const decks = flow ? `decks: [${first}, # Keep this comment\r\n  ${second}]`
    : `decks:\r\n  - ${first}\r\n# Keep this comment\r\n  - ${second}`;
  const original = '\uFEFF---\r\nschema: 1\r\nspaces: [{id: production, title: Work}]\r\n'
    + decks + '\r\ntracks: [] # Tracks\r\nmembership: []\r\n---\r\nBody.\r\n';
  await writeFile(filename, original);
  for (const defaultOrder of ['order=title', null]) {
    await editProjectCatalog(root, { action: 'set-deck-default-order', deckId: 'audio', defaultOrder,
      manifestHash: (await readProjectCatalog(root)).manifestHash });
    if (defaultOrder) expect(await readFile(filename, 'utf8')).toContain('{defaultOrder: order=title, id: audio');
  }
  expect(await readFile(filename, 'utf8')).toBe(original);
  await editProjectCatalog(root, { action: 'delete-deck', deckId: 'audio', manifestHash: (await readProjectCatalog(root)).manifestHash });
  const after = await readFile(filename, 'utf8');
  expect(after).toContain(second);
  expect(after).toContain('# Keep this comment\r\n');
  expect(after.slice(after.indexOf('\r\ntracks:'))).toBe(original.slice(original.indexOf('\r\ntracks:')));
  expect((await readProjectCatalog(root)).decks.map(deck => deck.id)).toEqual(['other']);
});

it.each([false, true])('inserts nested YAML collections with simple keys and preserves comments (flow: %s)', async flow => {
  const { root, filename } = await fixture();
  const fields = ['schema: 1', 'spaces: []', 'decks: []', 'tracks: []', 'membership: []'];
  const yaml = flow ? `{ ${fields.join(', ')} }` : fields.join('\r\n');
  const original = `\uFEFF---\r\n# Workspace\r\n${yaml}\r\n# Keep\r\n---\r\nBody.\r\n`;
  await writeFile(filename, original);
  const roster: CatalogMember[] = [{ id: 'pavel', label: 'Павел', kind: 'human', aliases: ['Паша', 'Pavel, Jr.'] }];
  await editProjectCatalog(root, { action: 'configure-members', members: roster, manifestHash: (await readProjectCatalog(root)).manifestHash });
  const inserted = flow ? 'members: [ { id: pavel, label: Павел, kind: human, aliases: [ Паша, "Pavel, Jr." ] } ], '
    : ['members:', '  - id: pavel', '    label: Павел', '    kind: human', '    aliases:', '      - Паша', '      - Pavel, Jr.', ''].join('\r\n');
  const expected = flow ? original.replace('{ schema:', `{${inserted} schema:`) : original.replace('schema:', inserted + 'schema:');
  expect(await readFile(filename)).toEqual(Buffer.from(expected));
  expect((await readProjectCatalog(root)).members).toEqual(roster);
});

it('keeps memberships explicit, warns on renamed sources and never guesses replacement identities', async () => {
  const { root } = await fixture();
  await rename(path.join(root, 'features/audio.md'), path.join(root, 'features/renamed.md'));
  const catalog = await readProjectCatalog(root);
  expect(catalog.warnings).toContain('Reference not found: task:features/audio.md#1.0');
  expect(catalog.cards.find(card => card.id === 'task:features/renamed.md#1.0')?.deckId).toBeNull();
});

it('reads without a manifest and creates a catalog without editing existing documents', async () => {
  const { root, filename } = await fixture();
  await rm(filename);
  const catalog = await readProjectCatalog(root);
  expect(catalog.configured).toBe(false);
  expect(catalog.manifestHash).toBe('');
  await editProjectCatalog(root, { action: 'create-space', title: 'Проект', manifestHash: '' });
  expect((await readProjectCatalog(root)).spaces[0].title).toBe('Проект');
  expect(await readFile(filename, 'utf8')).toContain('formatLanguage: en');
  expect(await readFile(filename, 'utf8')).toContain('# Workspace');
});

const coverPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhVEAAAAASUVORK5CYII=', 'base64');
const coverDataUrl = `data:image/png;base64,${coverPng.toString('base64')}`;

// 2026-11-06: New Deck picks a cover before the deck exists; it names the deck, and the same name never makes a twin.
it('creates a deck under the requested id so its cover can upload right after, and ignores a repeated create', async () => {
  const { root } = await fixture();
  const deckId = '6f1c2a40-9b7e-4c1d-8f2a-3b4c5d6e7f80';
  const create = async () => editProjectCatalog(root, { action: 'create-deck', deckId, spaceId: 'production', title: 'Covered', kind: 'task', icon: 'star', color: '#112233', description: '', style: 'symbol', coverPosition: 23.5, manifestHash: (await readProjectCatalog(root)).manifestHash });
  await create();
  await editProjectCatalog(root, { action: 'upload-cover', deckId, dataUrl: coverDataUrl, manifestHash: (await readProjectCatalog(root)).manifestHash });
  await create();
  const decks = (await readProjectCatalog(root)).decks.filter(deck => deck.title === 'Covered');
  expect(decks).toHaveLength(1);
  expect(decks[0]).toMatchObject({ id: deckId, style: 'artwork', coverPosition: 23.5 });
  expect(await readFile(path.join(root, decks[0].cover!))).toEqual(coverPng);
});

it('round-trips space presets and deck artwork styles while preserving source bytes', async () => {
  const { root, filename } = await fixture();
  const before = await readFile(filename);
  const sourceBefore = await readFile(path.join(root, 'features/audio.md'));
  for (const kind of ['gdd', 'tasks', 'knowledge', 'qa', 'custom'] as const) {
    await editProjectCatalog(root, { action: 'create-space', title: kind.toUpperCase(), kind, icon: 'folder', manifestHash: (await readProjectCatalog(root)).manifestHash });
  }
  await editProjectCatalog(root, { action: 'create-space', title: 'Default', manifestHash: (await readProjectCatalog(root)).manifestHash });
  expect((await readProjectCatalog(root)).spaces.at(-1)).toMatchObject({ title: 'Default', kind: 'custom' });
  await editProjectCatalog(root, { action: 'update-space', spaceId: 'production', title: 'Production', kind: 'tasks', icon: 'layers', manifestHash: (await readProjectCatalog(root)).manifestHash });
  await editProjectCatalog(root, { action: 'create-deck', spaceId: 'production', title: 'New', kind: 'task', icon: 'star', color: '#112233', description: '', style: 'minimal', manifestHash: (await readProjectCatalog(root)).manifestHash });
  await editProjectCatalog(root, { action: 'upload-cover', deckId: 'audio', dataUrl: coverDataUrl, manifestHash: (await readProjectCatalog(root)).manifestHash });
  let catalog = await readProjectCatalog(root);
  const image = catalog.decks.find(deck => deck.id === 'audio')!.cover!;
  expect(await readFile(path.join(root, image))).toEqual(coverPng);
  expect(catalog.decks.find(deck => deck.id === 'audio')).toMatchObject({ style: 'artwork', coverPosition: 50, kind: 'task' });
  await editProjectCatalog(root, { action: 'update-deck', deckId: 'audio', title: 'Audio', icon: 'music', color: '#123abc', description: 'Sound work', style: 'minimal', cover: image, coverPosition: 23.5, manifestHash: catalog.manifestHash });
  catalog = await readProjectCatalog(root);
  expect(catalog.spaces[0]).toMatchObject({ title: 'Production', kind: 'tasks', icon: 'layers' });
  expect(catalog.decks.find(deck => deck.id === 'audio')).toMatchObject({ title: 'Audio', kind: 'task', style: 'minimal', cover: image, coverPosition: 23.5 });
  await editProjectCatalog(root, { action: 'update-deck', deckId: 'audio', title: 'Audio', icon: 'music', color: '#123abc', description: 'Sound work', style: 'symbol', cover: null, coverPosition: 100, manifestHash: catalog.manifestHash });
  expect((await readProjectCatalog(root)).decks.find(deck => deck.id === 'audio')).toMatchObject({ cover: null, style: 'symbol', coverPosition: 100 });
  expect(await readFile(path.join(root, image))).toEqual(coverPng);
  const after = await readFile(filename);
  const body = Buffer.from('\r\n---\r\n');
  expect(after.subarray(0, 8)).toEqual(before.subarray(0, 8));
  expect(after.subarray(after.indexOf(body))).toEqual(before.subarray(before.indexOf(body)));
  expect(after.toString('utf8')).not.toMatch(/(?<!\r)\n/u);
  expect(await readFile(path.join(root, 'features/audio.md'))).toEqual(sourceBefore);
});

it('rejects invalid optional metadata, unknown targets and unsafe cover references without writing', async () => {
  const { root, filename } = await fixture();
  const before = await readFile(filename);
  const catalog = await readProjectCatalog(root);
  const edit = { action: 'update-deck' as const, deckId: 'audio', title: 'Audio', icon: 'music', color: '#123abc', description: '', style: 'symbol' as const, cover: null, coverPosition: 50, manifestHash: catalog.manifestHash };
  for (const coverPosition of [-1, 101, Number.NaN, Number.POSITIVE_INFINITY]) await expect(editProjectCatalog(root, { ...edit, coverPosition })).rejects.toThrow('deck');
  for (const coverPosition of [-1, 101, Number.NaN, Number.POSITIVE_INFINITY]) await expect(editProjectCatalog(root, {
    action: 'create-deck', title: 'Invalid crop', spaceId: 'production', kind: 'task', icon: 'star', color: '#112233',
    description: '', coverPosition, manifestHash: catalog.manifestHash,
  })).rejects.toThrow('deck');
  await expect(editProjectCatalog(root, { ...edit, cover: 'tasks/deckmate-assets/covers/../../outside.png' })).rejects.toThrow('path');
  await expect(editProjectCatalog(root, { ...edit, deckId: 'missing' })).rejects.toThrow('not found');
  await expect(editProjectCatalog(root, { action: 'update-space', spaceId: 'missing', title: 'GDD', kind: 'gdd', icon: 'book', manifestHash: catalog.manifestHash })).rejects.toThrow('not found');
  await expect(editProjectCatalog(root, { action: 'upload-cover', deckId: 'missing', dataUrl: coverDataUrl, manifestHash: catalog.manifestHash })).rejects.toThrow('not found');
  const malformed = emptyManifest();
  malformed.spaces.push({ id: 'space', title: 'Space', kind: 'unexpected' as never });
  expect(() => renderCatalogManifest(malformed)).toThrow('Space');
  expect(await readFile(filename)).toEqual(before);
  await expect(filesystem.stat(path.join(root, 'tasks/deckmate-assets'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it.each(['conflict', 'rename failure'])('cleans only the new asset after manifest %s and preserves an old cover', async failure => {
  const { root, filename } = await fixture();
  await editProjectCatalog(root, { action: 'upload-cover', deckId: 'audio', dataUrl: coverDataUrl, manifestHash: (await readProjectCatalog(root)).manifestHash });
  const catalog = await readProjectCatalog(root);
  const oldCover = catalog.decks.find(deck => deck.id === 'audio')!.cover!;
  const before = await readFile(filename);
  if (failure === 'conflict') {
    const originalStore = coverStorage.storeCatalogCover;
    vi.spyOn(coverStorage, 'storeCatalogCover').mockImplementationOnce(async (...argumentsList) => {
      const created = await originalStore(...argumentsList);
      await writeFile(filename, Buffer.concat([before, Buffer.from('\r\nExternal edit.\r\n')]));
      return created;
    });
  } else {
    // ENOSPC is never retried; Windows retries a briefly locked manifest (EACCES/EPERM/EBUSY), so a single EACCES would succeed there.
    vi.mocked(filesystem.rename).mockRejectedValueOnce(Object.assign(new Error('Simulated rename failure'), { code: 'ENOSPC' }));
  }
  await expect(editProjectCatalog(root, { action: 'upload-cover', deckId: 'audio', dataUrl: coverDataUrl, manifestHash: catalog.manifestHash })).rejects.toThrow(failure === 'conflict' ? 'CATALOG_CONFLICT' : 'Simulated rename');
  expect(await filesystem.readdir(path.join(root, 'tasks/deckmate-assets/covers'))).toEqual([path.basename(oldCover)]);
  expect(await readFile(path.join(root, oldCover))).toEqual(coverPng);
  expect((await readProjectCatalog(root)).decks.find(deck => deck.id === 'audio')!.cover).toBe(oldCover);
  const expected = failure === 'conflict' ? Buffer.concat([before, Buffer.from('\r\nExternal edit.\r\n')]) : before;
  expect(await readFile(filename)).toEqual(expected);
});

it('moves decks within and between spaces preserving their types and card memberships', async () => {
  const { root, filename } = await fixture();
  const initial = await readProjectCatalog(root);
  const manifest = emptyManifest();
  manifest.spaces = [...initial.spaces, { id: 'gdd', title: 'GDD', kind: 'gdd' }, { id: 'empty', title: 'Empty', kind: 'custom' }];
  manifest.decks = [...initial.decks, { ...initial.decks[0], id: 'third' }, { ...initial.decks[0], id: 'target-a', spaceId: 'gdd' }, { ...initial.decks[0], id: 'target-b', spaceId: 'gdd' }];
  manifest.tracks = initial.tracks;
  manifest.membership = [{ card: 'task:features/audio.md#1.0', deck: 'audio', tracks: ['release'] }, { card: 'doc:docs/guide.md', deck: 'knowledge', tracks: ['release'] }];
  await writeFile(filename, renderCatalogManifest(manifest));
  const move = async (deckId: string, spaceId: string, beforeDeckId: string | null) => editProjectCatalog(root, { action: 'move-deck', deckId, spaceId, beforeDeckId, manifestHash: (await readProjectCatalog(root)).manifestHash });
  await move('third', 'production', 'audio');
  expect((await readProjectCatalog(root)).decks.filter(deck => deck.spaceId === 'production').map(deck => deck.id)).toEqual(['third', 'audio', 'knowledge']);
  await move('audio', 'gdd', 'target-b');
  expect((await readProjectCatalog(root)).decks.filter(deck => deck.spaceId === 'gdd').map(deck => deck.id)).toEqual(['target-a', 'audio', 'target-b']);
  await move('knowledge', 'gdd', null);
  await move('third', 'empty', null);
  const catalog = await readProjectCatalog(root);
  expect(catalog.decks.map(deck => deck.id)).toEqual(['target-a', 'audio', 'target-b', 'knowledge', 'third']);
  expect(catalog.decks.find(deck => deck.id === 'audio')).toMatchObject({ kind: 'task', spaceId: 'gdd' });
  expect(catalog.cards.find(card => card.id === 'task:features/audio.md#1.0')).toMatchObject({ deckId: 'audio', trackIds: ['release'] });
  const saved = await readFile(filename);
  for (const operation of [{ deckId: 'audio', spaceId: 'missing', beforeDeckId: null }, { deckId: 'audio', spaceId: 'empty', beforeDeckId: 'target-a' }, { deckId: 'audio', spaceId: 'gdd', beforeDeckId: 'audio' }]) {
    await expect(editProjectCatalog(root, { action: 'move-deck', ...operation, manifestHash: catalog.manifestHash })).rejects.toThrow();
  }
  await expect(editProjectCatalog(root, { action: 'move-deck', deckId: 'audio', spaceId: 'empty', beforeDeckId: null, manifestHash: 'stale' })).rejects.toThrow('CATALOG_CONFLICT');
  expect(await readFile(filename)).toEqual(saved);
});

// 2026-11-06: the pile is one key of one deck: piling adds `piled: true`, shelving removes it, every other byte stays.
it('piles and shelves decks by one key, restoring the manifest bytes, and rejects a stale hash', async () => {
  const { root, filename } = await fixture();
  const before = await readFile(filename);
  const pile = async (deckId: string, piled: boolean, manifestHash?: string) => editProjectCatalog(root,
    { action: 'set-deck-pile', deckId, piled, manifestHash: manifestHash ?? (await readProjectCatalog(root)).manifestHash });
  expect(await pile('audio', true)).toEqual(['tasks/deckmate.md']);
  expect(await pile('audio', true)).toEqual([]);
  await pile('knowledge', true);
  const piled = (await readFile(filename, 'utf8')).split('    piled: true\r\n');
  expect(piled).toHaveLength(3);
  expect(piled.join('')).toBe(before.toString('utf8'));
  const catalog = await readProjectCatalog(root);
  expect(catalog.decks.map(deck => [deck.id, deck.piled])).toEqual([['audio', true], ['knowledge', true]]);
  await expect(pile('audio', false, 'stale')).rejects.toThrow('CATALOG_CONFLICT');
  await pile('audio', false);
  await pile('knowledge', false);
  expect(await readFile(filename)).toEqual(before);

  // A hand-written manifest keeps its comments and flow maps when a deck goes back to the shelf.
  const written = [
    '---', 'schema: 1', 'spaces: [{ id: production, title: P }]', 'decks:',
    '  - id: audio # sound', '    spaceId: production', '    piled: true', '    # kept', '    title: Audio', '    kind: task',
    '    description: ""', '    icon: audio', '    color: "#ff990a"',
    '  - { id: notes, piled: true, spaceId: production, title: Notes, kind: knowledge, description: "", icon: book, color: "#9cb8d0" }',
    'tracks: []', 'membership: []', '---', 'Body.', '',
  ].join('\n');
  await writeFile(filename, written);
  await pile('audio', false);
  await pile('notes', false);
  expect(await readFile(filename, 'utf8')).toBe(written.replace('    piled: true\n', '').replace('piled: true, ', ''));
  await writeFile(filename, written.replace('piled: true, ', 'piled: yes, '));
  await expect(readProjectCatalog(root)).rejects.toThrow('Deck notes: piled must be true or false.');
});


it.each([
  ['  - piled: true\n    # keep the deck description\n    id: audio\n    spaceId: production\n    title: Audio\n    kind: task\n    description: ""\n    icon: audio\n    color: "#ff990a"', 'piled: true'],
  ['  - { id: audio, spaceId: production, title: Audio, kind: task, description: "", icon: audio, color: "#ff990a", # keep the color\n      piled: true }', ', # keep the color\n      piled: true'],
  ['  - { piled: true, # keep the ID\n      id: audio, spaceId: production, title: Audio, kind: task, description: "", icon: audio, color: "#ff990a" }', 'piled: true,'],
])('shelves handwritten YAML without consuming neighboring comments (%s)', async (deck, removed) => {
  const { root, filename } = await fixture();
  const written = ['---', 'schema: 1', 'spaces: [{ id: production, title: P }]', 'decks:', deck, 'tracks: []', 'membership: []', '---', 'Body.', ''].join('\n');
  await writeFile(filename, written);
  await editProjectCatalog(root, { action: 'set-deck-pile', deckId: 'audio', piled: false, manifestHash: (await readProjectCatalog(root)).manifestHash });
  const expected = removed.includes('# keep the color')
    ? written.replace(', # keep the color', ' # keep the color').replace('piled: true', '')
    : written.replace(removed, '');
  expect(await readFile(filename, 'utf8')).toBe(expected);
  expect((await readProjectCatalog(root)).decks[0].piled).toBeUndefined();
});

const members: CatalogMember[] = [
  { id: 'kimi', label: 'Kimi', kind: 'agent', aliases: ['KIMI', '@kimi'] },
  { id: 'glm', label: 'GLM', kind: 'agent', aliases: ['@glm'] },
  { id: 'opus', label: 'Opus', kind: 'agent', aliases: ['Opus 5.5'] },
  { id: 'pavel', label: 'Павел', kind: 'human', aliases: ['Паша'] },
];

it('stores the project roster only in manifest YAML and preserves BOM, line endings and source documents', async () => {
  const { root, filename } = await fixture();
  const before = await readFile(filename);
  const sourceBefore = await readFile(path.join(root, 'features/audio.md'));
  await editProjectCatalog(root, { action: 'configure-members', members, manifestHash: (await readProjectCatalog(root)).manifestHash });
  expect((await readProjectCatalog(root)).members).toEqual(members);
  const after = await readFile(filename);
  const boundary = Buffer.from('\r\n---\r\n');
  expect(after.subarray(0, 8)).toEqual(before.subarray(0, 8));
  expect(after.subarray(after.indexOf(boundary))).toEqual(before.subarray(before.indexOf(boundary)));
  expect(after.toString('utf8')).not.toMatch(/(?<!\r)\n/u);
  expect(await readFile(path.join(root, 'features/audio.md'))).toEqual(sourceBefore);
  await editProjectCatalog(root, { action: 'create-track', title: 'New track', description: '', manifestHash: (await readProjectCatalog(root)).manifestHash });
  expect((await readProjectCatalog(root)).members).toEqual(members);
});

it('projects only known leading assignments and preserves full raw notes without guessing agent models', async () => {
  const { root } = await fixture();
  const longNote = 'Kimi — ' + 'Полная инструкция, которую нельзя обрезать. '.repeat(5);
  const notes = ['kImI', longNote.trim(), 'Согласовать с Kimi после GLM', 'Claude', 'Codex', 'GLM — реализация', 'Паша'];
  await writeFile(path.join(root, 'features/audio.md'), '# Звук\n## 1 — Тест\n' + notes.map((note, index) => `### 1.${index} Task (в работе)\n**Кто:** ${note}\nBody.\n`).join('')
    + '### 1.7 Heading owner (в работе, GLM — полное пояснение из заголовка)\nBody.\n');
  await editProjectCatalog(root, { action: 'configure-members', members, manifestHash: (await readProjectCatalog(root)).manifestHash });
  const catalog = await readProjectCatalog(root);
  const tasks = catalog.cards.filter(card => card.kind === 'task');
  expect(tasks.map(card => card.owner)).toEqual(['Kimi', 'Kimi', null, null, null, 'GLM', 'Павел', 'GLM']);
  for (const [index, note] of notes.entries()) expect(tasks[index].ownerNote).toBe(note);
  expect(tasks[7].ownerNote).toBe('GLM — полное пояснение из заголовка');
  expect(catalog.warnings).toEqual([]);
});

it('keeps unknown native explicit owners and normalizes known native aliases without changing their file', async () => {
  const { root } = await fixture();
  await editProjectCatalog(root, { action: 'configure-members', members, manifestHash: (await readProjectCatalog(root)).manifestHash });
  const native = [
    { id: '11111111-1111-4111-8111-111111111111', owner: '@kimi' },
    { id: '22222222-2222-4222-8222-222222222222', owner: 'External human' },
  ];
  for (const item of native) await createManagedMarkdown(root, `cards/${item.id}.md`, {
    deckmate: 'card', schema: 1, id: item.id, kind: 'task', title: 'Task', state: 'план', owner: item.owner,
    deckId: 'audio', trackIds: [], parentId: null,
  }, 'Body.');
  const before = await readFile(path.join(root, `cards/${native[0].id}.md`));
  const cards = (await readProjectCatalog(root)).cards.filter(card => card.id.startsWith('card:'));
  expect(cards.map(card => card.owner)).toEqual(['Kimi', 'External human']);
  expect(cards[0].ownerNote).toBe('@kimi');
  expect(await readFile(path.join(root, `cards/${native[0].id}.md`))).toEqual(before);
});

it('uses an empty generic roster and validates member IDs, kinds and ambiguous aliases before writing', async () => {
  const { root, filename } = await fixture();
  await editProjectCatalog(root, { action: 'configure-members', members: [], manifestHash: (await readProjectCatalog(root)).manifestHash });
  const catalog = await readProjectCatalog(root);
  expect(catalog.members).toEqual([]);
  expect(catalog.cards.find(card => card.id === 'task:features/audio.md#1.0')).toMatchObject({ owner: null, ownerNote: 'Павел' });
  const before = await readFile(filename);
  const invalid = [[members[0], members[0]], [{ ...members[0], kind: 'model' }], [{ ...members[0], id: '../escape' }],
    [{ ...members[0], aliases: [''] }], [members[0], { ...members[1], aliases: ['KIMI'] }],
    [{ ...members[0], label: '' }], [{ ...members[0], aliases: 'Kimi' }]];
  for (const roster of invalid) await expect(editProjectCatalog(root, { action: 'configure-members', members: roster as CatalogMember[], manifestHash: catalog.manifestHash })).rejects.toThrow();
  await expect(editProjectCatalog(root, { action: 'configure-members', members, manifestHash: 'stale' })).rejects.toThrow('CATALOG_CONFLICT');
  expect(await readFile(filename)).toEqual(before);
});
