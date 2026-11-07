// CSV import rules (2026-11-06): reimporting the same rows must not create duplicates,
// occupied IDs are never overwritten, and a stale manifest hash rejects the whole import.
import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { CatalogImportEdit, CatalogImportRow } from '../src/catalog-contracts.ts';
import { emptyManifest, readProjectCatalog, renderCatalogManifest } from '../server/catalog.ts';
import { importCards } from '../server/catalog-import.ts';
import { prepareCardOptionsPatch, readCardOptions } from '../server/card-options.ts';
import { createManagedMarkdown, type NativeCardMetadata } from '../server/native-cards.ts';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (path.dirname(path.resolve(root)) !== path.resolve(tmpdir()) || !path.basename(root).startsWith('deckmate-import-')) {
      throw new Error('Unsafe import fixture cleanup');
    }
    await rm(root, { recursive: true, force: true });
  }
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'deckmate-import-'));
  roots.push(root);
  await mkdir(path.join(root, 'tasks'));
  const manifest = emptyManifest();
  manifest.spaces.push({ id: 'work', title: 'Work' });
  manifest.decks.push({ id: 'board', spaceId: 'work', title: 'Board', kind: 'mixed', description: '', icon: 'box', color: '#123456' });
  manifest.members = [{ id: 'kimi', label: 'Kimi', kind: 'agent', aliases: [] }];
  await writeFile(path.join(root, 'tasks/deckmate.md'), renderCatalogManifest(manifest));
  return root;
}

function row(overrides: Partial<CatalogImportRow> = {}): CatalogImportRow {
  return { cardId: null, kind: 'task', title: 'Импорт', markdown: '', owner: null,
    effort: null, priority: null, state: null, tags: [], ...overrides };
}

async function edit(root: string, cards: CatalogImportRow[], manifestHash?: string): Promise<CatalogImportEdit> {
  const catalog = await readProjectCatalog(root);
  return { source: 'sandbox', deckId: 'board', manifestHash: manifestHash ?? catalog.manifestHash,
    optionsHash: catalog.optionsHash ?? '', cards };
}

it('reimporting the same rows creates no duplicates, by derived and explicit IDs alike', async () => {
  const root = await fixture();
  const explicitId = 'card:' + randomUUID();
  const rows = [
    row({ kind: 'task', title: 'Звук выстрела', markdown: 'Сделать выстрел.\n', owner: 'Kimi',
      effort: 3, priority: 'high', state: 'в работе', tags: ['sfx', 'audio'] }),
    row({ kind: 'doc', title: 'Гайд по звуку', markdown: 'Читать всем.\n' }),
    row({ kind: 'hero', title: 'Отряд', markdown: 'Главный герой.\n', tags: ['core'], cardId: explicitId }),
  ];
  const first = await importCards(root, await edit(root, rows));
  expect(first.skipped).toEqual([]);
  expect(first.warnings).toEqual([]);
  expect(first.created).toHaveLength(3);
  expect(first.created).toContain(explicitId);
  expect(first.changedPaths).toEqual(expect.arrayContaining([
    `cards/${first.created[0].slice(5)}.md`, `cards/${first.created[1].slice(5)}.md`,
    `cards/${explicitId.slice(5)}.md`, 'tasks/deckmate-card-options.md',
  ]));
  const created = await readProjectCatalog(root);
  expect(created.cards.find(card => card.id === first.created[0])).toMatchObject({ owner: 'Kimi', effort: 3, tags: ['sfx', 'audio'] });
  expect((await readCardOptions(root)).options[first.created[2]]).toEqual({ tags: ['core'] });

  // The same file imported again: every row is recognized as its own earlier card.
  const before = await Promise.all(['tasks/deckmate.md', 'tasks/deckmate-card-options.md'].map(
    relative => readFile(path.join(root, relative))));
  const second = await importCards(root, await edit(root, rows));
  expect(second.created).toEqual([]);
  expect(second.skipped).toEqual([]);
  expect(second.warnings).toEqual([]);
  expect([...second.unchanged].sort()).toEqual([...first.created].sort());
  expect(await readdir(path.join(root, 'cards'))).toHaveLength(3);
  expect(await Promise.all(['tasks/deckmate.md', 'tasks/deckmate-card-options.md'].map(
    relative => readFile(path.join(root, relative))))).toEqual(before);
});

it('never overwrites an occupied card ID and reports duplicate rows within one file', async () => {
  const root = await fixture();
  const id = randomUUID();
  const metadata: NativeCardMetadata = { deckmate: 'card', schema: 1, id, kind: 'task', title: 'Существующая',
    state: 'план', owner: null, deckId: 'board', trackIds: [], parentId: null };
  await createManagedMarkdown(root, `cards/${id}.md`, metadata, 'Оригинальное тело.\n');
  const original = await readFile(path.join(root, `cards/${id}.md`));
  const occupied = row({ title: 'Существующая', markdown: 'Другой текст.\n', cardId: 'card:' + id });
  const repeated = row({ title: 'Повтор строки', markdown: 'Одинаковый текст.\n' });
  const result = await importCards(root, await edit(root, [occupied, repeated, { ...repeated }]));
  expect(result.unchanged).toEqual([]);
  expect(result.created).toHaveLength(1);
  expect(result.skipped).toEqual([
    { title: 'Существующая', reason: expect.stringMatching(/already used.*left unchanged/ui) },
    { title: 'Повтор строки', reason: expect.stringMatching(/identical row appears earlier/ui) },
  ]);
  expect(await readFile(path.join(root, `cards/${id}.md`))).toEqual(original);
  expect((await readProjectCatalog(root)).cards.find(card => card.id === 'card:' + id)?.markdown).toBe('Оригинальное тело.\n');
  expect(await readdir(path.join(root, 'cards'))).toEqual([`${id}.md`, `${result.created[0].slice(5)}.md`].sort());
});

it('rejects a stale manifest hash before creating any card', async () => {
  const root = await fixture();
  const before = await readFile(path.join(root, 'tasks/deckmate.md'));
  await expect(importCards(root, await edit(root, [row()], '0'.repeat(64)))).rejects.toThrow('CATALOG_CONFLICT');
  expect(await readFile(path.join(root, 'tasks/deckmate.md'))).toEqual(before);
  expect((await readProjectCatalog(root)).cards).toEqual([]);
});

it.each([{ tags: [] }, { tags: ['audio'] }])('rejects stale options before creating cards with tags $tags', async ({ tags }) => {
  const root = await fixture();
  const request = await edit(root, [row({ tags })]);
  const options = await prepareCardOptionsPatch(root, request.optionsHash, {
    ['card:' + randomUUID()]: { tags: ['external'] },
  });
  await options.publish();
  const paths = ['tasks/deckmate.md', 'tasks/deckmate-card-options.md'];
  const before = await Promise.all(paths.map(relative => readFile(path.join(root, relative))));
  await expect(importCards(root, request)).rejects.toThrow('CARD_OPTIONS_CONFLICT');
  expect(await Promise.all(paths.map(relative => readFile(path.join(root, relative))))).toEqual(before);
  await expect(readdir(path.join(root, 'cards'))).rejects.toMatchObject({ code: 'ENOENT' });
});
