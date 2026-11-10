import { afterEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import type { CatalogEdit } from '../src/catalog-contracts.ts';
import type { BulkEditRequest } from '../src/bulk-contracts.ts';
import { editProjectCatalog, emptyManifest, readProjectCatalog, renderCatalogManifest } from '../server/catalog.ts';
import { editCatalogBulk } from '../server/catalog-bulk.ts';
import { validateOwner, validateEffort, validatePriority } from '../server/card-property-validation.ts';
import { registerRequestLang } from '../server/i18n.ts';
import { langCookie } from '../src/i18n.ts';

const roots: string[] = [];
const cardId = 'task:features/sound.md#1.0';
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'deckmate-property-validation-'));
  roots.push(root);
  await mkdir(path.join(root, 'features'));
  await mkdir(path.join(root, 'tasks'));
  await writeFile(path.join(root, 'features/sound.md'), '# Sound\n## 1 — Sound\n### 1.0 Task\nBody\n');
  await writeFile(path.join(root, 'tasks/deckmate.md'), renderCatalogManifest(emptyManifest()));
  return root;
}

const invalid = {
  owner: ['', '   ', 'x'.repeat(121), 'a\nb', 'a\rb', 'a\0b', 1, undefined],
  effort: [-1, Infinity, -Infinity, NaN, '1', undefined],
  priority: ['urgent', '', 1, undefined],
};

it.each(['owner', 'effort', 'priority'] as const)('keeps single and bulk presence, null and invalid %s behavior', async key => {
  const root = await fixture();
  async function edits(value: Record<string, unknown>, bulk: boolean) {
    const catalog = await readProjectCatalog(root);
    const card = catalog.cards.find(item => item.id === cardId)!;
    if (bulk) return editCatalogBulk(root, { manifestHash: catalog.manifestHash, optionsHash: catalog.optionsHash,
      cards: [{ cardId, sourceHash: card.sourceHash }], change: { kind: 'properties', ...value } } as BulkEditRequest);
    return editProjectCatalog(root, { action: 'set-card-properties', cardId, sourceHash: card.sourceHash,
      manifestHash: catalog.manifestHash, owner: 'Kim', effort: 2, priority: 'high', ...value } as CatalogEdit);
  }
  for (const bulk of [false, true]) {
    for (const value of invalid[key]) {
      const before = await readFile(path.join(root, 'tasks/deckmate.md'));
      await expect(edits({ [key]: value }, bulk)).rejects.toThrow();
      expect(await readFile(path.join(root, 'tasks/deckmate.md'))).toEqual(before);
    }
    const valid = { owner: 'Kim', effort: 2, priority: 'high' };
    await edits({ [key]: valid[key] }, bulk);
    await expect(edits({ [key]: null }, bulk)).resolves.toBeDefined();
    const card = (await readProjectCatalog(root)).cards.find(item => item.id === cardId)!;
    expect(card[key] ?? null).toBeNull();
  }
  const single = { owner: 'Kim', effort: 2, priority: 'high' } as Record<string, unknown>;
  delete single[key];
  const catalog = await readProjectCatalog(root);
  const card = catalog.cards.find(item => item.id === cardId)!;
  await expect(editProjectCatalog(root, { action: 'set-card-properties', cardId, sourceHash: card.sourceHash,
    manifestHash: catalog.manifestHash, ...single } as CatalogEdit)).rejects.toThrow();
  const other = key === 'effort' ? { owner: 'Kim' } : { effort: 2 };
  await expect(edits(other, true)).resolves.toBeDefined();
  expect((await readProjectCatalog(root)).cards.find(item => item.id === cardId)![key] ?? null).toBeNull();
});

it('uses the request language for each caller-specific message', async () => {
  const app = Fastify();
  registerRequestLang(app);
  app.get('/:context/:field', async request => {
    const { context, field } = request.params as { context: 'single' | 'bulk' | 'create'; field: string };
    if (field === 'owner') validateOwner('');
    if (field === 'effort') validateEffort(-1, context);
    if (field === 'priority') validatePriority('bad', context);
  });
  try {
    for (const [context, field, message] of [
      ['single', 'owner', 'Исполнитель — одна строка до 120 символов или null.'],
      ['single', 'effort', 'Цена карточки — конечное число не меньше нуля или null.'],
      ['bulk', 'effort', 'Оценка — конечное число не меньше нуля или null.'],
      ['bulk', 'priority', 'Недопустимый приоритет.'],
      ['create', 'priority', 'Приоритет карточки — high, medium или low.'],
    ]) {
      const response = await app.inject({ url: `/${context}/${field}`, headers: { cookie: `${langCookie}=ru` } });
      expect(response.json().message).toBe(message);
    }
  } finally {
    await app.close();
  }
});

it('checks boundary values without normalizing them', () => {
  for (const value of [null, 'x'.repeat(120), ' Kim ']) expect(() => validateOwner(value)).not.toThrow();
  for (const value of [null, 0, 2.5]) expect(() => validateEffort(value)).not.toThrow();
  for (const value of [null, 'high', 'medium', 'low']) expect(() => validatePriority(value)).not.toThrow();
});

it('retains caller-specific messages', () => {
  expect(() => validateEffort(-1)).toThrow('Card Effort must be a finite nonnegative number or null.');
  expect(() => validateEffort(-1, 'bulk')).toThrow('Effort must be a finite nonnegative number or null.');
  expect(() => validateEffort(-1, 'create')).toThrow('Card Effort must be a nonnegative number.');
  expect(() => validatePriority('bad', 'bulk')).toThrow('Invalid Priority.');
  expect(() => validatePriority('bad', 'create')).toThrow('Card Priority must be high, medium or low.');
});
