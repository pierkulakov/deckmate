import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { CatalogImportEdit, CatalogImportRow } from '../src/catalog-contracts.ts';
import { emptyManifest, readProjectCatalog, renderCatalogManifest } from '../server/catalog.ts';
import { derivedCardId, importCards } from '../server/catalog-import.ts';
import { readCardOptions } from '../server/card-options.ts';

const batches = vi.hoisted(() => ({ calls: [] as { hash: string; count: number; nextHash: string }[], failAt: 0, failures: 0 }));
vi.mock('../server/card-options.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../server/card-options.ts')>();
  return { ...actual, prepareCardOptionsPatch: async (...args: Parameters<typeof actual.prepareCardOptionsPatch>) => {
    const plan = await actual.prepareCardOptionsPatch(...args);
    batches.calls.push({ hash: args[1], count: Object.keys(args[2]).length, nextHash: plan.nextHash });
    if (batches.calls.length !== batches.failAt) return plan;
    return { ...plan, publish: async () => { batches.failures++; throw new Error('Injected tag publication failure'); } };
  } };
});

const roots: string[] = [];
afterEach(async () => {
  batches.calls = [];
  batches.failAt = 0;
  batches.failures = 0;
  for (const root of roots.splice(0)) {
    expect(path.dirname(root)).toBe(path.resolve(tmpdir()));
    expect(path.basename(root)).toMatch(/^deckmate-import-tags-/u);
    await rm(root, { recursive: true, force: true });
  }
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'deckmate-import-tags-'));
  roots.push(root);
  await mkdir(path.join(root, 'tasks'));
  const manifest = emptyManifest();
  manifest.spaces.push({ id: 'work', title: 'Work' });
  manifest.decks.push({ id: 'board', spaceId: 'work', title: 'Board', kind: 'mixed', description: '', icon: 'box', color: '#123456' });
  await writeFile(path.join(root, 'tasks/deckmate.md'), renderCatalogManifest(manifest));
  return root;
}

function rows(count: number): CatalogImportRow[] {
  return Array.from({ length: count }, (_, index) => ({ cardId: null, kind: 'task', title: `Row ${index}`,
    markdown: `Body ${index}.\n`, owner: null, effort: null, priority: null, state: null, tags: ['imported', `tag-${index}`] }));
}

async function request(root: string, cards: CatalogImportRow[]): Promise<CatalogImportEdit> {
  const catalog = await readProjectCatalog(root);
  return { source: 'sandbox', manifestHash: catalog.manifestHash, optionsHash: catalog.optionsHash ?? '', deckId: 'board', cards };
}

async function expectAllTags(root: string, cards: CatalogImportRow[]) {
  const options = await readCardOptions(root);
  expect(Object.keys(options.options)).toHaveLength(cards.length);
  for (const row of cards) expect(options.options[row.cardId ?? derivedCardId(row)].tags).toEqual(row.tags);
}

it('imports 1001 tagged rows in bounded batches chained by the published hash', async () => {
  const root = await fixture();
  const cards = rows(1001);
  const result = await importCards(root, await request(root, cards));
  expect(result.created).toHaveLength(1001);
  expect(result.skipped).toEqual([]);
  expect(result.warnings).toEqual([]);
  expect(batches.calls.map(call => call.count)).toEqual([1000, 1]);
  expect(batches.calls[1].hash).toBe(batches.calls[0].nextHash);
  expect(result.changedPaths.filter(relative => relative === 'tasks/deckmate-card-options.md')).toHaveLength(1);
  await expectAllTags(root, cards);
}, 120_000);

it('retries after a failure between tag batches without recreating or rewriting cards', async () => {
  const root = await fixture();
  const cards = rows(1001);
  cards[1000].cardId = `card:${randomUUID()}`;
  batches.failAt = 2;
  const first = await importCards(root, await request(root, cards));
  expect(batches.failures).toBe(1);
  expect(first.created).toHaveLength(1001);
  expect(first.warnings).toEqual([expect.stringContaining('Injected tag publication failure')]);
  expect(Object.keys((await readCardOptions(root)).options)).toHaveLength(1000);
  const files = await readdir(path.join(root, 'cards'));
  const bytes = await Promise.all(files.map(file => readFile(path.join(root, 'cards', file))));
  batches.failAt = 0;
  batches.calls = [];
  const retry = await importCards(root, await request(root, cards));
  expect(retry.created).toEqual([]);
  expect(retry.unchanged).toHaveLength(1001);
  expect(retry.skipped).toEqual([]);
  expect(retry.warnings).toEqual([]);
  expect(retry.changedPaths).toEqual(['tasks/deckmate-card-options.md']);
  expect(batches.calls.map(call => call.count)).toEqual([1]);
  await expectAllTags(root, cards);
  expect(await readdir(path.join(root, 'cards'))).toEqual(files);
  expect(await Promise.all(files.map(file => readFile(path.join(root, 'cards', file))))).toEqual(bytes);
}, 120_000);

it('recovers tags when the first tag publication failed after creating all cards', async () => {
  const root = await fixture();
  const cards = rows(3);
  batches.failAt = 1;
  const first = await importCards(root, await request(root, cards));
  expect(batches.failures).toBe(1);
  expect(first.created).toHaveLength(3);
  expect(first.warnings).toHaveLength(1);
  expect((await readCardOptions(root)).options).toEqual({});
  batches.failAt = 0;
  const retry = await importCards(root, await request(root, cards));
  expect(retry.created).toEqual([]);
  expect(retry.skipped).toEqual([]);
  expect(retry.warnings).toEqual([]);
  await expectAllTags(root, cards);
});
