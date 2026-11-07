import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { CatalogEdit } from '../src/catalog-contracts.ts';
import { editProjectCatalog, emptyManifest, readProjectCatalog, renderCatalogManifest } from '../server/catalog.ts';
import { readCardContent } from '../server/card-content.ts';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'deckmate-create-card-'));
  roots.push(root);
  await mkdir(path.join(root, 'tasks'));
  const manifest = emptyManifest();
  manifest.spaces.push({ id: 'work', title: 'Work' });
  for (const [id, kind] of [['concepts', 'asset'], ['audio', 'task'], ['notes', 'knowledge']] as const) {
    manifest.decks.push({ id, title: id, kind, spaceId: 'work', description: '', icon: 'box', color: '#123456' });
  }
  manifest.members = [{ id: 'kimi', label: 'Kimi', kind: 'agent', aliases: ['Kim'] }];
  manifest.tracks = [{ id: 'sound', title: 'Sound', description: '' }];
  await writeFile(path.join(root, 'tasks/deckmate.md'), renderCatalogManifest(manifest));
  const manifestHash = (await readProjectCatalog(root)).manifestHash;
  const edit: Extract<CatalogEdit, { action: 'create-card' }> = {
    action: 'create-card', cardId: 'card:' + randomUUID(), kind: 'task', title: 'Prepare sound', markdown: '- [ ] Normalize\n',
    deckId: 'audio', parentId: null, trackIds: ['sound'], owner: 'kimi', effort: 2.5, priority: 'medium', manifestHash,
  };
  return { root, edit };
}

it('creates a Hero, Sub Card and Doc with actual links and canonical owner, then retries without duplicates', async () => {
  const { root, edit } = await fixture();
  const heroId = 'card:' + randomUUID();
  await editProjectCatalog(root, { ...edit, cardId: heroId, kind: 'hero', title: 'Sound event', deckId: 'concepts', owner: null, effort: null });
  await editProjectCatalog(root, { ...edit, parentId: heroId });
  const filename = path.join(root, 'cards', edit.cardId.slice(5) + '.md');
  const before = await readFile(filename);
  expect(await editProjectCatalog(root, { ...edit, parentId: heroId })).toEqual([]);
  expect(await readFile(filename)).toEqual(before);
  const docId = 'card:' + randomUUID();
  await editProjectCatalog(root, { ...edit, cardId: docId, kind: 'doc', title: 'Brief', deckId: 'notes', owner: null, effort: null, priority: null });
  const catalog = await readProjectCatalog(root);
  expect(catalog.cards).toHaveLength(3);
  expect(catalog.cards.find(card => card.id === edit.cardId)).toMatchObject({ owner: 'Kimi', parentId: heroId, deckId: 'audio', effort: 2.5, priority: 'medium', trackIds: ['sound'], state: 'not-started' });
  expect((await readCardContent(root, docId)).markdown).toBe(edit.markdown);
});

it('rejects incompatible kinds, unknown links, invalid values and duplicate IDs without modifying a card', async () => {
  const { root, edit } = await fixture();
  await editProjectCatalog(root, edit);
  const filename = path.join(root, 'cards', edit.cardId.slice(5) + '.md');
  const before = await readFile(filename);
  await expect(editProjectCatalog(root, { ...edit, title: 'Different' })).rejects.toThrow('CARD_ID_CONFLICT');
  const fresh = { ...edit, cardId: 'card:' + randomUUID() };
  const invalid = [
    { deckId: 'concepts' }, { deckId: 'missing' }, { owner: 'x'.repeat(121) }, { parentId: edit.cardId },
    { parentId: 'card:' + randomUUID() }, { trackIds: ['missing'] }, { trackIds: ['sound', 'sound'] },
    { effort: -1 }, { effort: Number.POSITIVE_INFINITY }, { title: ' ' }, { title: 'Line\nBreak' },
    { title: 'x'.repeat(1001) }, { markdown: 'x'.repeat(200001) }, { cardId: 'card:../escape' },
    { kind: 'hero' as const, deckId: 'concepts', owner: 'Line\nBreak' },
  ];
  for (const patch of invalid) await expect(editProjectCatalog(root, { ...fresh, ...patch })).rejects.toThrow();
  expect(await readFile(filename)).toEqual(before);
  expect(await readdir(path.join(root, 'cards'))).toEqual([edit.cardId.slice(5) + '.md']);
});

it('rejects stale catalog revisions and a linked cards directory without publishing outside the project', async () => {
  const { root, edit } = await fixture();
  await expect(editProjectCatalog(root, { ...edit, manifestHash: '0'.repeat(64) })).rejects.toThrow('CATALOG_CONFLICT');
  const outside = await mkdtemp(path.join(tmpdir(), 'deckmate-create-outside-'));
  roots.push(outside);
  await symlink(outside, path.join(root, 'cards'), 'junction');
  await expect(editProjectCatalog(root, edit)).rejects.toThrow('symbolic link');
  expect(await readdir(outside)).toEqual([]);
});
