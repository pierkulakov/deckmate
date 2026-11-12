import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { CatalogEdit } from '../src/catalog-contracts.ts';
import { editProjectCatalog, emptyManifest, readProjectCatalog, renderCatalogManifest } from '../server/catalog.ts';
import { CatalogService } from '../server/catalog-service.ts';
import { createManagedMarkdown } from '../server/native-cards.ts';
import { readWholeActivity } from '../server/activity.ts';
import { localIsoDate } from '../src/catalog-hand.ts';

const roots: string[] = [];
const services: CatalogService[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) await service.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture(owner: string | null, markdown: string, guarded = false, legacy = false) {
  const root = await mkdtemp(path.join(tmpdir(), 'deckmate-self-acceptance-'));
  roots.push(root);
  await mkdir(path.join(root, 'tasks'));
  const manifest = emptyManifest();
  manifest.formatLanguage = 'en';
  manifest.members = [{ id: 'builder', label: 'Builder', kind: 'agent', aliases: ['Build alias'] },
    { id: 'reviewer', label: 'Reviewer', kind: 'agent', aliases: [] },
    { id: 'human', label: 'Human', kind: 'human', aliases: [] }];
  if (guarded) {
    manifest.spaces = [{ id: 'work', title: 'Work' }];
    manifest.decks = [{ id: 'work', title: 'Work', spaceId: 'work', kind: 'task', description: '', icon: 'box', color: '#123456',
      guardianIds: ['builder', 'reviewer', 'human'] }];
  }
  await writeFile(path.join(root, 'tasks/deckmate.md'), renderCatalogManifest(manifest));
  let cardId: string;
  let relative: string;
  if (legacy) {
    await mkdir(path.join(root, 'features'));
    relative = 'features/work.md';
    cardId = 'task:features/work.md#1.0';
    const ownerLine = owner === null ? '' : `**Кто:** ${owner}\r\n`;
    await writeFile(path.join(root, relative), `\uFEFF# Work\r\n## 1 — Work\r\n### 1.0 Work (review)\r\n${ownerLine}${markdown}`);
  } else {
    const id = randomUUID();
    relative = `cards/${id}.md`;
    cardId = `card:${id}`;
    await createManagedMarkdown(root, relative, { deckmate: 'card', schema: 1, id, kind: 'task', title: 'Work',
      state: 'review', owner, parentId: null, deckId: guarded ? 'work' : null, trackIds: [] }, markdown);
  }
  const service = new CatalogService({ editMode: 'direct', dataRoot: root, writeRoot: root,
    projectName: 'Acceptance', port: 4397, python: 'python' }, ':memory:');
  services.push(service);
  const catalog = await readProjectCatalog(root);
  const card = catalog.cards.find(card => card.id === cardId)!;
  return { root, service, catalog, card, filename: path.join(root, relative) };
}

const report = '#### Report 2026-11-11 · builder\n\nCompleted.\n';
for (const guarded of [false, true]) {
  it.each(['set-card-state', 'bulk-edit-cards', 'add-card-report'] as const)(`refuses self-acceptance via %s after reassignment (guarded=${guarded})`, async action => {
    const { root, service, catalog, card, filename } = await fixture('Reviewer', report, guarded);
    const before = await readFile(filename);
    const shared = { cardId: card.id, sourceHash: card.sourceHash, manifestHash: catalog.manifestHash };
    let edit: CatalogEdit;
    if (action === 'bulk-edit-cards') edit = { action, manifestHash: catalog.manifestHash, optionsHash: catalog.optionsHash ?? '',
      cards: [{ cardId: card.id, sourceHash: card.sourceHash }], change: { kind: 'state', state: 'done' } };
    else if (action === 'add-card-report') edit = { action, ...shared, markdown: 'Accepting my result.', state: 'done' };
    else edit = { action, ...shared, state: 'done', acceptedBy: 'Human' };
    await expect(service.edit(edit, 'sandbox', 'builder')).rejects.toMatchObject({ status: 422 });
    expect(await readFile(filename)).toEqual(before);
    expect((await readProjectCatalog(root)).optionsHash).toBe(catalog.optionsHash);
    expect((await readWholeActivity(root)).events).toEqual([]);
  });
}

it.each([false, true])('refuses the report author on a legacy=%s Task and acceptedBy fallback', async legacy => {
  const { service, catalog, card, filename } = await fixture('Reviewer', report, false, legacy);
  const before = await readFile(filename);
  await expect(service.edit({ action: 'set-card-state', cardId: card.id, sourceHash: card.sourceHash,
    manifestHash: catalog.manifestHash, state: 'done', acceptedBy: 'Builder' }, 'sandbox')).rejects.toMatchObject({ status: 422 });
  expect(await readFile(filename)).toEqual(before);
});

it('retains the actor in direct bulk catalog edits', async () => {
  const { root, catalog, card, filename } = await fixture('Reviewer', report);
  const before = await readFile(filename);
  await expect(editProjectCatalog(root, { action: 'bulk-edit-cards', manifestHash: catalog.manifestHash,
    optionsHash: catalog.optionsHash ?? '', cards: [{ cardId: card.id, sourceHash: card.sourceHash }],
    change: { kind: 'state', state: 'done' } }, 'builder')).rejects.toThrow();
  expect(await readFile(filename)).toEqual(before);
});

it.each(['Builder', 'Build alias'])('refuses an agent Owner %s without a report before publication', async owner => {
  const { root, service, catalog, card, filename } = await fixture(owner, 'No reports yet.\n');
  const before = await readFile(filename);
  const shared = { cardId: card.id, sourceHash: card.sourceHash, manifestHash: catalog.manifestHash };
  await expect(service.edit({ action: 'set-card-state', ...shared, state: 'done' }, 'sandbox', 'builder')).rejects.toMatchObject({ status: 422 });
  await expect(service.edit({ action: 'add-card-report', ...shared, markdown: 'New work.', state: 'done' }, 'sandbox', 'builder')).rejects.toMatchObject({ status: 422 });
  expect(await readFile(filename)).toEqual(before);
  expect((await readProjectCatalog(root)).optionsHash).toBe(catalog.optionsHash);
  expect((await readWholeActivity(root)).events).toEqual([]);
});

for (const legacy of [false, true]) {
  it.each([
    { evidence: 'owner and report', owner: 'Builder', markdown: report },
    { evidence: 'owner only', owner: 'Builder', markdown: 'No reports yet.\n' },
    { evidence: 'report only', owner: null, markdown: report },
  ])(`allows an independent reviewer to report and accept with $evidence (legacy=${legacy})`, async ({ owner, markdown }) => {
    const newline = legacy ? '\r\n' : '\n';
    const { root, service, catalog, card, filename } = await fixture(owner, markdown.replaceAll('\n', newline), true, legacy);
    const before = await readFile(filename);
    const result = await service.edit({ action: 'add-card-report', cardId: card.id, sourceHash: card.sourceHash,
      manifestHash: catalog.manifestHash, markdown: 'Independent review passed.', state: 'done' }, 'sandbox', 'reviewer');
    expect(result.cards.find(candidate => candidate.id === card.id)?.state).toBe('done');
    const saved = (await readProjectCatalog(root)).cards.find(candidate => candidate.id === card.id)!;
    expect(saved.state).toBe('done');
    const addition = Buffer.from(`${newline}#### Report ${localIsoDate()} · reviewer${newline}${newline}Independent review passed.${newline}${newline}`);
    expect(saved.markdown.endsWith(addition.toString('utf8'))).toBe(true);
    const after = await readFile(filename);
    const offset = after.indexOf(addition);
    expect(offset).toBeGreaterThan(0);
    const doneDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(new Date());
    const expected = legacy
      ? before.toString('utf8').replace('### 1.0 Work (review)', `### ✅ 1.0 Work (done ${doneDate})`)
      : before.toString('utf8').replace('state: review', 'state: "done"');
    expect(Buffer.concat([after.subarray(0, offset), after.subarray(offset + addition.length)])).toEqual(Buffer.from(expected));
  });

  it.each([
    { evidence: 'no reports', markdown: 'No reports yet.\n' },
    { evidence: 'a fenced report', markdown: '```md\n' + report + '```\n' },
    { evidence: 'a quoted report', markdown: '> #### Report 2026-11-11 · builder\n' },
  ])(`refuses a new self-accepted report without an owner and with $evidence (legacy=${legacy})`, async ({ markdown }) => {
    const { root, service, catalog, card, filename } = await fixture(null, markdown, false, legacy);
    expect(card.owner).toBeNull();
    const before = await readFile(filename);
    await expect(service.edit({ action: 'add-card-report', cardId: card.id, sourceHash: card.sourceHash,
      manifestHash: catalog.manifestHash, markdown: 'New work.', state: 'done' }, 'sandbox', 'builder')).rejects.toMatchObject({ status: 422 });
    expect(await readFile(filename)).toEqual(before);
    expect((await readProjectCatalog(root)).optionsHash).toBe(catalog.optionsHash);
    expect((await readWholeActivity(root)).events).toEqual([]);
  });
}

it.each(['reviewer', 'human'])('allows independent acceptance by %s and ignores a fenced report example', async actor => {
  const markdown = report + '\n```md\n#### Report 2026-11-11 · reviewer\n```\n';
  const { service, catalog, card } = await fixture('Builder', markdown, true);
  const result = await service.edit({ action: 'set-card-state', cardId: card.id, sourceHash: card.sourceHash,
    manifestHash: catalog.manifestHash, state: 'done' }, 'sandbox', actor);
  expect(result.cards.find(candidate => candidate.id === card.id)?.state).toBe('done');
});

it.each(['set-card-state', 'add-card-report'] as const)('keeps human self-acceptance available via %s', async action => {
  const { service, catalog, card } = await fixture('Human', '#### Report 2026-11-11 · human\n\nDecision.\n');
  const shared = { cardId: card.id, sourceHash: card.sourceHash, manifestHash: catalog.manifestHash, state: 'done' };
  const edit: CatalogEdit = action === 'add-card-report' ? { action, ...shared, markdown: 'Decision accepted.' } : { action, ...shared };
  const result = await service.edit(edit, 'sandbox', 'human');
  expect(result.cards.find(candidate => candidate.id === card.id)?.state).toBe('done');
});

for (const legacy of [false, true]) {
  it.each(['set-card-properties', 'bulk-edit-cards'] as const)(`remembers the previous owner without a Report after %s (legacy=${legacy})`, async action => {
    const { root, service, catalog, card } = await fixture('Builder', 'No reports yet.\n', false, legacy);
    const edit: CatalogEdit = action === 'set-card-properties'
      ? { action, cardId: card.id, sourceHash: card.sourceHash, manifestHash: catalog.manifestHash, owner: null, effort: null, priority: null }
      : { action, manifestHash: catalog.manifestHash, optionsHash: catalog.optionsHash ?? '',
        cards: [{ cardId: card.id, sourceHash: card.sourceHash }], change: { kind: 'properties', owner: 'Human' } };
    await service.edit(edit, 'sandbox', 'builder');
    const fresh = await readProjectCatalog(root);
    const current = fresh.cards.find(candidate => candidate.id === card.id)!;
    const before = await readFile(path.join(root, current.path));
    await expect(service.edit({ action: 'set-card-state', cardId: card.id, sourceHash: current.sourceHash,
      manifestHash: fresh.manifestHash, state: 'done' }, 'sandbox', 'builder')).rejects.toMatchObject({ status: 422, saved: false });
    expect(await readFile(path.join(root, current.path))).toEqual(before);
    const accepted = await service.edit({ action: 'set-card-state', cardId: card.id, sourceHash: current.sourceHash,
      manifestHash: fresh.manifestHash, state: 'done' }, 'sandbox', 'reviewer');
    expect(accepted.cards.find(candidate => candidate.id === card.id)?.state).toBe('done');
  });
}
