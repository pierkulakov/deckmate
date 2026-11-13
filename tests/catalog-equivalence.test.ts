import { afterEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readFreshProjectCatalog, readProjectCatalog, refreshProjectCatalog } from '../server/catalog.ts';
import { initializeDemo } from '../server/demo.ts';
import { clearParseCache } from '../server/parse-cache.ts';
import type { CatalogView } from '../src/catalog-contracts.ts';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (path.dirname(root) !== path.resolve(tmpdir()) || !path.basename(root).startsWith('deckmate-catalog-equivalence-')) {
      throw new Error('Unsafe catalog equivalence fixture cleanup');
    }
    await rm(root, { recursive: true, force: true });
  }
  clearParseCache();
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'deckmate-catalog-equivalence-'));
  roots.push(root);
  return root;
}

const catalogBytes = (view: CatalogView) => Buffer.from(JSON.stringify(view));

async function expectEquivalentReads(root: string, paths: string[]) {
  clearParseCache();
  const cold = await readProjectCatalog(root);
  const expected = catalogBytes(cold);
  expect(catalogBytes(await readFreshProjectCatalog(root)).equals(expected)).toBe(true);
  expect(catalogBytes(await refreshProjectCatalog(root, cold, [...paths].reverse())).equals(expected)).toBe(true);
  expect(catalogBytes(await refreshProjectCatalog(root, structuredClone(cold), paths)).equals(expected)).toBe(true);
  expect(catalogBytes(cold).equals(expected)).toBe(true);
  return cold;
}

it('serializes the demo identically after full, warm and incremental reads', async () => {
  const root = await fixture();
  await initializeDemo(root);
  const first = await readProjectCatalog(root);
  const paths = first.documents.map(document => document.path);
  const catalog = await expectEquivalentReads(root, paths);
  expect(catalog.cards).toHaveLength(30);
  expect(catalog.warnings).toEqual([]);
});

it.each([2000, 10000])('preserves catalog bytes and invalidates restored timestamps on a %i-card board', async count => {
  const root = await fixture();
  await mkdir(path.join(root, 'features'));
  const paths: string[] = [];
  let markdown = '';
  const timestamp = new Date('2026-11-12T12:00:00.000Z');
  const cardsPerFile = 1000;
  for (let group = 0; group < count / cardsPerFile; group++) {
    const relative = `features/dense-${group}.md`;
    let text = '\uFEFF# Механика 😀\r\n\r\n## Открыто\r\n- Вопрос документа\r\n\r\n## 1 — Герой\r\nВведение.\r\n';
    for (let index = 0; index < cardsPerFile - 2; index++) {
      text += `\r\n### 1.${index} Original задача ${index} (план)\r\nТекст 😀.\r\n\r\n#### Открыто\r\n- Вопрос ${index}\r\n`;
    }
    await writeFile(path.join(root, relative), text);
    await utimes(path.join(root, relative), timestamp, timestamp);
    if (group === 0) markdown = text;
    paths.push(relative);
  }
  const relative = paths[0];
  const filename = path.join(root, relative);
  const before = await expectEquivalentReads(root, paths);
  const expectedBefore = catalogBytes(before);
  expect(before.cards).toHaveLength(count);
  expect(before.cards[0].openQuestions?.map(question => question.text)).toEqual(['Вопрос документа']);
  expect(before.cards.at(-1)?.openQuestions?.map(question => question.text)).toEqual([`Вопрос ${cardsPerFile - 3}`]);
  const originalStat = await stat(filename);
  await writeFile(filename, markdown.replace('Original', 'External'));
  await utimes(filename, timestamp, timestamp);
  const changedStat = await stat(filename);
  expect([changedStat.mtimeMs, changedStat.size]).toEqual([originalStat.mtimeMs, originalStat.size]);
  const changed = await refreshProjectCatalog(root, before, [relative]);
  expect(changed.cards.find(card => card.kind === 'task')?.title).toBe('External задача 0 (план)');
  expect(changed.cards[0].sourceHash).not.toBe(before.cards[0].sourceHash);
  expect(catalogBytes(await readFreshProjectCatalog(root)).equals(catalogBytes(changed))).toBe(true);
  expect(catalogBytes(before).equals(expectedBefore)).toBe(true);
  expect(await readFile(filename, 'utf8')).toBe(markdown.replace('Original', 'External'));
});
