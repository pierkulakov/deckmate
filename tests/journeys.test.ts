import { afterEach, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import type { CatalogEdit, CatalogJourneyStep, CatalogJourneyZone } from '../src/catalog-contracts.ts';
import { editProjectCatalog, emptyManifest, readProjectCatalog, renderCatalogManifest } from '../server/catalog.ts';
import { journeyCardId, updateJourney } from '../server/journeys.ts';
import { cardOptionsPath, prepareCardOptionsPatch, readCardOptions } from '../server/card-options.ts';
import * as nativeFiles from '../server/native-cards.ts';
import { expectOnlyDeckOrderChanged } from './manifest-assertions.ts';

vi.mock('../server/native-cards.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../server/native-cards.ts')>();
  return { ...actual, createManagedMarkdown: vi.fn(actual.createManagedMarkdown), replaceProjectMarkdown: vi.fn(actual.replaceProjectMarkdown) };
});
const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const parentId = 'hero:features/vehicle.md#1';
const steps: CatalogJourneyStep[] = [
  { id: 'review', title: 'Review %PARENT_TITLE%', markdown: 'Verify %PARENT_TITLE% and record evidence.', deckId: 'code', owner: '@pavel', dependsOn: ['model'] },
  { id: 'model', title: 'Model %PARENT_TITLE%', markdown: '# Input\nRefs\n# Actions\nBuild %PARENT_TITLE%.\n# Output\nMesh\n# Check\nVisual review\n# Improve\nRecord findings', deckId: 'art', owner: '@kimi', dependsOn: ['refs'] },
  { id: 'refs', title: 'Refs %PARENT_TITLE%', markdown: 'Collect references for %PARENT_TITLE%.', deckId: 'art', owner: '@glm', dependsOn: [] },
];
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'deckmate-journeys-'));
  roots.push(root);
  for (const directory of ['features', 'docs', 'tasks']) await mkdir(path.join(root, directory));
  await writeFile(path.join(root, 'features/vehicle.md'), '# Vehicles\n\n## 1 — Tiger\n### 1.0 Legacy task (план)\nExisting content.\n');
  const manifest = emptyManifest();
  manifest.spaces.push({ id: 'production', title: 'Production' });
  for (const [id, kind] of [['assets', 'asset'], ['other', 'asset'], ['code', 'task'], ['art', 'task'], ['mixed', 'mixed'], ['knowledge', 'knowledge']] as const) {
    manifest.decks.push({ id, kind, spaceId: 'production', title: id, icon: 'box', color: '#123456', description: '' });
  }
  manifest.tracks.push({ id: 'release', title: 'Release', description: '' });
  manifest.membership.push({ card: parentId, deck: 'assets' }, { card: 'task:features/vehicle.md#1.0', deck: 'code' });
  await writeFile(path.join(root, 'tasks/deckmate.md'), '\uFEFF' + renderCatalogManifest(manifest).replace(/\n/gu, '\r\n') + '\r\nKeep this body.\r\n');
  return root;
}
async function create(root: string, requestedSteps = steps) {
  await editProjectCatalog(root, { action: 'create-journey', title: 'Vehicle pipeline', deckId: 'assets', steps: requestedSteps, manifestHash: (await readProjectCatalog(root)).manifestHash });
  return (await readProjectCatalog(root)).journeys![0];
}
async function request(root: string, stepIds = steps.map(step => step.id)): Promise<Extract<CatalogEdit, { action: 'apply-journey' }>> {
  const catalog = await readProjectCatalog(root);
  return { action: 'apply-journey', manifestHash: catalog.manifestHash, sourceHash: catalog.cards.find(card => card.id === parentId)!.sourceHash,
    cardId: parentId, journeyId: catalog.journeys![0].id, journeyHash: catalog.journeys![0].fileHash, stepIds, deckAssignments: {} };
}
async function files(root: string) {
  try { return (await readdir(path.join(root, 'cards'))).filter(filename => filename.endsWith('.md')).sort(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}
async function rewriteMetadata(root: string, relativePath: string, change: (metadata: Record<string, unknown>) => void) {
  const source = (await readFile(path.join(root, relativePath))).toString('utf8');
  const match = /^---\n([\s\S]*?)\n---\n/u.exec(source)!;
  const metadata = parse(match[1]) as Record<string, unknown>;
  change(metadata);
  await writeFile(path.join(root, relativePath), `---\n${stringify(metadata).trimEnd()}\n---\n${source.slice(match[0].length)}`);
}

it('stores a navigable pipeline folder, separate instructions and real mapped Sub Cards without rewriting the manifest', async () => {
  const root = await fixture();
  const before = await readFile(path.join(root, 'tasks/deckmate.md'));
  const sourceBefore = await readFile(path.join(root, 'features/vehicle.md'));
  const journey = await create(root);
  expect(journey.path).toBe(`tasks/journeys/${journey.id}/index.md`);
  const index = await nativeFiles.readManagedMarkdown(root, journey.path);
  expect(index!.metadata.steps).toEqual(['steps/review.md', 'steps/model.md', 'steps/refs.md']);
  expect(index!.markdown).toContain('[model](steps/model.md)');
  expect((await nativeFiles.readManagedMarkdown(root, `tasks/journeys/${journey.id}/steps/model.md`))!.markdown).toBe(steps[1].markdown);
  await editProjectCatalog(root, { ...await request(root), deckAssignments: { model: 'code' } });
  const catalog = await readProjectCatalog(root);
  const children = catalog.cards.filter(card => card.id.startsWith('card:'));
  expect(children).toHaveLength(3);
  expect(catalog.cards.filter(card => card.parentId === parentId)).toHaveLength(4);
  const model = children.find(card => card.journey?.stepId === 'model')!;
  expect(model).toMatchObject({ id: journeyCardId(parentId, journey.id, 1, 'model'), title: 'Model Tiger', owner: '@kimi', deckId: 'code', parentId, state: 'not-started', iteration: null,
    dependsOn: [journeyCardId(parentId, journey.id, 1, 'refs')] });
  expect(model.markdown).toContain('Build Tiger.');
  expect(model.markdown).toContain(`../tasks/journeys/${journey.id}/steps/model.md`);
  expect(new Set(children.map(card => card.journey!.instanceId)).size).toBe(1);
  expect(catalog.cards.filter(card => card.path === model.path)).toHaveLength(1);
  expect(catalog.documents.filter(document => document.path.startsWith(`tasks/journeys/${journey.id}/`))).toHaveLength(4);
  expect(catalog.warnings).toEqual([]);
  expect(await readFile(path.join(root, 'tasks/deckmate.md'))).toEqual(before);
  expect(await readFile(path.join(root, 'features/vehicle.md'))).toEqual(sourceBefore);
});

it('repeats idempotently and never overwrites an existing edited card', async () => {
  const root = await fixture();
  await create(root);
  await editProjectCatalog(root, await request(root));
  const child = (await readProjectCatalog(root)).cards.find(card => card.journey?.stepId === 'model')!;
  await rewriteMetadata(root, child.path, metadata => { metadata.state = 'в работе'; metadata.owner = '@human'; metadata.deckId = 'mixed'; });
  await writeFile(path.join(root, child.path), Buffer.concat([await readFile(path.join(root, child.path)), Buffer.from('\nHuman edit.\n')]));
  const before = await Promise.all((await files(root)).map(async filename => [filename, await readFile(path.join(root, 'cards', filename))] as const));
  await editProjectCatalog(root, { ...await request(root), deckAssignments: { model: 'art' } });
  expect(await files(root)).toHaveLength(3);
  for (const [filename, bytes] of before) expect(await readFile(path.join(root, 'cards', filename))).toEqual(bytes);
});

it.each(['archived', 'deleted'] as const)('rejects an %s Hero without creating or rewriting files, and permits an explicit restore', async flag => {
  const root = await fixture();
  const journey = await create(root);
  const options = await prepareCardOptionsPatch(root, '', { [parentId]: { [flag]: true } });
  await options.publish();
  expect((await readProjectCatalog(root)).cards.find(card => card.id === parentId)?.[flag]).toBe(true);
  const protectedPaths = ['features/vehicle.md', 'tasks/deckmate.md', cardOptionsPath, journey.path,
    ...journey.steps.map(step => `tasks/journeys/${journey.id}/steps/${step.id}.md`)];
  const before = await Promise.all(protectedPaths.map(filename => readFile(path.join(root, filename))));
  await expect(editProjectCatalog(root, await request(root))).rejects.toThrow('archived or deleted');
  expect(await files(root)).toEqual([]);
  for (const [index, filename] of protectedPaths.entries()) expect(await readFile(path.join(root, filename))).toEqual(before[index]);

  const restored = await prepareCardOptionsPatch(root, options.nextHash, { [parentId]: { [flag]: false } });
  await restored.publish();
  await editProjectCatalog(root, await request(root));
  expect(await files(root)).toHaveLength(steps.length);
  await editProjectCatalog(root, await request(root));
  expect(await files(root)).toHaveLength(steps.length);
});

it('rechecks archive metadata before publishing a prepared Journey card', async () => {
  const root = await fixture();
  await create(root);
  const edit = await request(root);
  const sourceBefore = await readFile(path.join(root, 'features/vehicle.md'));
  const manifestBefore = await readFile(path.join(root, 'tasks/deckmate.md'));
  const original = vi.mocked(nativeFiles.createManagedMarkdown).getMockImplementation()!;
  let archived = false;
  vi.mocked(nativeFiles.createManagedMarkdown).mockImplementation(async (...args) => {
    if (args[1].startsWith('cards/') && !archived) {
      archived = true;
      const options = await prepareCardOptionsPatch(root, '', { [parentId]: { archived: true } });
      await options.publish();
    }
    return original(...args);
  });
  await expect(editProjectCatalog(root, edit)).rejects.toMatchObject({ saved: false, created: [], message: expect.stringContaining('CARD_OPTIONS_CONFLICT') });
  vi.mocked(nativeFiles.createManagedMarkdown).mockImplementation(original);
  expect((await readCardOptions(root)).options[parentId].archived).toBe(true);
  expect(await readdir(path.join(root, 'cards'))).toEqual([]);
  expect(await readFile(path.join(root, 'features/vehicle.md'))).toEqual(sourceBefore);
  expect(await readFile(path.join(root, 'tasks/deckmate.md'))).toEqual(manifestBefore);
});

it('supports dependency-safe subsets and adds missing steps on retry', async () => {
  const root = await fixture();
  await create(root);
  await expect(editProjectCatalog(root, await request(root, ['review']))).rejects.toThrow('Include dependency');
  expect(await files(root)).toEqual([]);
  await editProjectCatalog(root, await request(root, ['refs']));
  expect(await files(root)).toHaveLength(1);
  await editProjectCatalog(root, await request(root, ['refs', 'model']));
  expect(await files(root)).toHaveLength(2);
  await editProjectCatalog(root, await request(root, ['review']));
  expect(await files(root)).toHaveLength(3);
});

it('hashes every instruction and creates a new version without changing prior instances', async () => {
  const root = await fixture();
  const journey = await create(root);
  const staleRequest = await request(root);
  const stepPath = `tasks/journeys/${journey.id}/steps/model.md`;
  await writeFile(path.join(root, stepPath), Buffer.concat([await readFile(path.join(root, stepPath)), Buffer.from('\nUpdated instruction.\n')]));
  expect((await readProjectCatalog(root)).journeys![0].fileHash).not.toBe(journey.fileHash);
  await expect(editProjectCatalog(root, staleRequest)).rejects.toThrow('JOURNEY_CONFLICT');
  expect(await files(root)).toEqual([]);
  await editProjectCatalog(root, await request(root));
  const oldFiles = await Promise.all((await files(root)).map(async filename => [filename, await readFile(path.join(root, 'cards', filename))] as const));
  await rewriteMetadata(root, journey.path, metadata => { metadata.version = 2; });
  await editProjectCatalog(root, await request(root));
  expect(await files(root)).toHaveLength(6);
  for (const [filename, bytes] of oldFiles) expect(await readFile(path.join(root, 'cards', filename))).toEqual(bytes);
});

it('validates hashes, parent kind, deck targets and selected steps before writing cards', async () => {
  const root = await fixture();
  await create(root);
  const edit = await request(root);
  const cases: Partial<typeof edit>[] = [{ sourceHash: undefined }, { sourceHash: '0'.repeat(64) }, { manifestHash: 'stale' }, { journeyHash: 'stale' },
    { cardId: 'task:features/vehicle.md#1.0' }, { deckAssignments: { model: 'knowledge' } }, { deckAssignments: { unknown: 'code' } }, { stepIds: ['missing'] }, { stepIds: ['refs', 'refs'] }];
  for (const changes of cases) await expect(editProjectCatalog(root, { ...edit, ...changes })).rejects.toThrow();
  expect(await files(root)).toEqual([]);
  await writeFile(path.join(root, 'features/vehicle.md'), Buffer.concat([await readFile(path.join(root, 'features/vehicle.md')), Buffer.from('\nExternal change.\n')]));
  await expect(editProjectCatalog(root, edit)).rejects.toThrow('CARD_CONFLICT');
  expect(await files(root)).toEqual([]);
});

it('rejects cyclic, missing, duplicate and traversal step identities before creating a template', async () => {
  const root = await fixture();
  const invalidSteps = [
    steps.map(step => step.id === 'refs' ? { ...step, dependsOn: ['review'] } : step),
    [{ ...steps[0], dependsOn: ['missing'] }], [steps[2], steps[2]], [{ ...steps[2], id: '../escape' }], [{ ...steps[2], deckId: 'knowledge' }],
    [{ ...steps[2], id: 'CON' }], [{ ...steps[2], id: 'first' }, { ...steps[2], id: 'FIRST' }],
  ];
  for (const invalid of invalidSteps) await expect(create(root, invalid)).rejects.toThrow();
  expect((await readProjectCatalog(root)).journeys).toEqual([]);
  expect(await readdir(path.join(root, 'tasks'))).toEqual(['deckmate.md']);
});

it('requires current source hashes for native metadata and preserves body bytes despite stale central membership', async () => {
  const root = await fixture();
  await create(root);
  await editProjectCatalog(root, await request(root, ['refs']));
  let child = (await readProjectCatalog(root)).cards.find(card => card.id.startsWith('card:'))!;
  const text = (await readFile(path.join(root, child.path))).toString('utf8');
  await writeFile(path.join(root, child.path), '\uFEFF' + text.replace(/\n/gu, '\r\n') + '\r\nHuman notes.\r\n');
  child = (await readProjectCatalog(root)).cards.find(card => card.id === child.id)!;
  const original = await nativeFiles.readNativeCard(root, child.id);
  const centralPath = path.join(root, 'tasks/deckmate.md');
  const centralBefore = await readFile(centralPath);
  const action = { action: 'assign-deck' as const, cardId: child.id, deckId: 'code', manifestHash: (await readProjectCatalog(root)).manifestHash };
  await expect(editProjectCatalog(root, action)).rejects.toThrow('current version');
  await expect(editProjectCatalog(root, { ...action, sourceHash: '0'.repeat(64) })).rejects.toThrow('CARD_CONFLICT');
  await editProjectCatalog(root, { ...action, sourceHash: child.sourceHash });
  const centralAfterMove = await readFile(centralPath);
  expectOnlyDeckOrderChanged(centralBefore, centralAfterMove, { code: { flatOrder: ['task:features/vehicle.md#1.0', child.id] } });
  child = (await readProjectCatalog(root)).cards.find(card => card.id === child.id)!;
  await editProjectCatalog(root, { action: 'set-tracks', cardId: child.id, trackIds: ['release'], sourceHash: child.sourceHash, manifestHash: (await readProjectCatalog(root)).manifestHash });
  const changed = await nativeFiles.readNativeCard(root, child.id);
  expect(changed!.bytes.subarray(changed!.bodyRange.start, changed!.bodyRange.end)).toEqual(original!.bytes.subarray(original!.bodyRange.start, original!.bodyRange.end));
  expect(changed!.bytes.subarray(0, 3)).toEqual(Buffer.from([239, 187, 191]));
  expect(changed!.bytes.toString('utf8')).not.toMatch(/(?<!\r)\n/u);
  expect(changed!.card).toMatchObject({ deckId: 'code', trackIds: ['release'] });
  expect(await readFile(centralPath)).toEqual(centralAfterMove);
  const central = centralAfterMove.toString('utf8').replace(/^\uFEFF/u, '').replace(/\r\n/gu, '\n');
  const yaml = /^---\n([\s\S]*?)\n---/u.exec(central)![1];
  const manifest = parse(yaml);
  manifest.membership.push({ card: child.id, deck: 'unknown-deck', tracks: ['unknown-track'] });
  await writeFile(centralPath, renderCatalogManifest(manifest));
  const catalog = await readProjectCatalog(root);
  expect(catalog.cards.find(card => card.id === child.id)).toMatchObject({ deckId: 'code', trackIds: ['release'] });
  expect(catalog.warnings.some(warning => warning.includes('ignores catalog membership'))).toBe(true);
});

it.each(['before-next', 'after-publish'])('retains partial success after I/O failure (%s), reports it and retry fills only missing cards', async mode => {
  const root = await fixture();
  await create(root);
  const original = vi.mocked(nativeFiles.createManagedMarkdown).getMockImplementation()!;
  let writes = 0;
  vi.mocked(nativeFiles.createManagedMarkdown).mockImplementation(async (...args) => {
    if (!args[1].startsWith('cards/')) return original(...args);
    writes += 1;
    if (mode === 'before-next' && writes === 2) throw new Error('Injected I/O failure');
    const written = await original(...args);
    if (mode === 'after-publish' && writes === 1) throw new Error('Injected failure after publication');
    return written;
  });
  await expect(editProjectCatalog(root, await request(root))).rejects.toMatchObject({ saved: true, created: expect.any(Array), missing: expect.any(Array) });
  expect(await files(root)).toHaveLength(1);
  const filename = (await files(root))[0];
  const bytes = await readFile(path.join(root, 'cards', filename));
  vi.mocked(nativeFiles.createManagedMarkdown).mockImplementation(original);
  await editProjectCatalog(root, await request(root));
  expect(await files(root)).toHaveLength(3);
  expect(await readFile(path.join(root, 'cards', filename))).toEqual(bytes);
});

it('rejects an occupied deterministic address before creating any other selected card', async () => {
  const root = await fixture();
  const journey = await create(root);
  const cardId = journeyCardId(parentId, journey.id, 1, 'review');
  await nativeFiles.createManagedMarkdown(root, `cards/${cardId.slice(5)}.md`, {
    deckmate: 'card', schema: 1, id: cardId.slice(5), kind: 'task', title: 'Unrelated card', state: 'план',
    owner: null, deckId: 'code', trackIds: [], parentId: null,
  }, 'Do not overwrite.');
  const filename = (await files(root))[0];
  const before = await readFile(path.join(root, 'cards', filename));
  await expect(editProjectCatalog(root, await request(root))).rejects.toThrow('used by another card');
  expect(await files(root)).toEqual([filename]);
  expect(await readFile(path.join(root, 'cards', filename))).toEqual(before);
});

it('preflights all expanded instructions before the first card write', async () => {
  const root = await fixture();
  await create(root, [steps[2], { ...steps[1], title: '%PARENT_TITLE%'.repeat(21) }]);
  const source = (await readFile(path.join(root, 'features/vehicle.md'))).toString('utf8');
  await writeFile(path.join(root, 'features/vehicle.md'), source.replace('Tiger', 'Tiger with a long descriptive name'));
  await expect(editProjectCatalog(root, await request(root, ['refs', 'model']))).rejects.toThrow('after substitution');
  expect(await files(root)).toEqual([]);
});

it('rebases inline links, images and reference definitions while preserving code and all other Markdown bytes', async () => {
  const root = await fixture();
  const instruction = [
    '# Instruction',
    '[Contract](../../../../docs/contract.md?mode=agent#gate "Contract title")',
    '![Preview](<../../../../assets/preview image.png> "Preview title")',
    '[Evidence][proof] and ![Evidence image][picture]',
    '',
    '[proof]: ../../../../docs/evidence.md \'Evidence title\'',
    '[picture]: <../../../../assets/picture.png>',
    '[Web](https://example.com/a) [Mail](mailto:test@example.com) [Anchor](#local)',
    '[Root](/docs/contract.md) [Network](//example.com/a)',
    '[Escaped](../../../../docs/a\\(b\\).md?one=1&amp;two=2 \"Keep\")',
    '[Entity](../../../../docs/a&amp;copy;.md)',
    '`[Code](../../../../docs/untouched.md)`',
    '```md',
    '[Fenced](../../../../docs/untouched.md)',
    '```',
    '[Complex ![nested](../../../../assets/nested.png)](../../../../docs/complex.md "title ](not-a-link)")',
    '',
  ].join('\r\n');
  await create(root, [{ ...steps[2], markdown: instruction }]);
  await editProjectCatalog(root, await request(root, ['refs']));
  const materialized = (await readProjectCatalog(root)).cards.find(card => card.id.startsWith('card:'))!.markdown;
  const expected = instruction
    .replace('../../../../docs/contract.md?mode=agent#gate', '../docs/contract.md?mode=agent#gate')
    .replace('../../../../assets/preview image.png', '../assets/preview%20image.png')
    .replace('../../../../docs/evidence.md', '../docs/evidence.md')
    .replace('../../../../assets/picture.png', '../assets/picture.png')
    .replace('../../../../assets/nested.png', '../assets/nested.png')
    .replace('../../../../docs/complex.md', '../docs/complex.md')
    .replace('../../../../docs/a\\(b\\).md', '../docs/a%28b%29.md')
    .replace('../../../../docs/a&amp;copy;.md', '../docs/a&amp;copy;.md');
  expect(materialized.slice(0, expected.length)).toBe(expected);
  expect(materialized.slice(expected.length)).toMatch(/^\n\n---\n\nJourney step:/u);
});

it('copies parent tracks at creation and preserves manually changed child tracks on repeat', async () => {
  const root = await fixture();
  await editProjectCatalog(root, { action: 'create-track', title: 'Sound', description: '', manifestHash: (await readProjectCatalog(root)).manifestHash });
  const soundId = (await readProjectCatalog(root)).tracks.find(track => track.title === 'Sound')!.id;
  await editProjectCatalog(root, { action: 'set-tracks', cardId: parentId, trackIds: [soundId], manifestHash: (await readProjectCatalog(root)).manifestHash });
  await create(root);
  await editProjectCatalog(root, await request(root));
  const children = (await readProjectCatalog(root)).cards.filter(card => card.id.startsWith('card:'));
  expect(children).toHaveLength(3);
  for (const child of children) expect(child.trackIds).toEqual([soundId]);
  const changed = children[0];
  await editProjectCatalog(root, { action: 'set-tracks', cardId: changed.id, trackIds: ['release'], sourceHash: changed.sourceHash, manifestHash: (await readProjectCatalog(root)).manifestHash });
  const before = await readFile(path.join(root, changed.path));
  await editProjectCatalog(root, await request(root));
  const repeated = (await readProjectCatalog(root)).cards.filter(card => card.id.startsWith('card:'));
  expect(repeated.find(card => card.id === changed.id)!.trackIds).toEqual(['release']);
  for (const child of repeated.filter(card => card.id !== changed.id)) expect(child.trackIds).toEqual([soundId]);
  expect(await readFile(path.join(root, changed.path))).toEqual(before);
});

it('reads journeys written before 2026-11-04 without the new fields and keeps applying them', async () => {
  const root = await fixture();
  const journey = await create(root);
  const index = await nativeFiles.readManagedMarkdown(root, journey.path);
  expect(index!.metadata).not.toHaveProperty('description');
  expect(index!.metadata).not.toHaveProperty('zones');
  const stored = (await readProjectCatalog(root)).journeys![0];
  expect(stored.description).toBe('');
  expect(stored.zones).toEqual([]);
  for (const step of stored.steps) {
    expect(step.effort).toBeNull();
    expect(step.priority).toBeNull();
    expect(step.zoneId).toBeUndefined();
  }
  await editProjectCatalog(root, await request(root));
  expect(await files(root)).toHaveLength(3);
  for (const child of (await readProjectCatalog(root)).cards.filter(card => card.id.startsWith('card:'))) {
    expect(child.effort).toBeUndefined();
    expect(child.priority).toBeUndefined();
  }
});

it('copies step effort and priority onto the created Sub Card', async () => {
  const root = await fixture();
  const priced = steps.map(step => step.id === 'model' ? { ...step, effort: 3, priority: 'high' as const } : step);
  await create(root, priced);
  await editProjectCatalog(root, await request(root));
  const catalog = await readProjectCatalog(root);
  expect(catalog.cards.find(card => card.journey?.stepId === 'model')).toMatchObject({ effort: 3, priority: 'high' });
  expect(catalog.cards.find(card => card.journey?.stepId === 'refs')!.effort).toBeUndefined();
  expect(catalog.warnings).toEqual([]);
});

it('keeps a removed step edited externally after the Journey was read', async () => {
  const root = await fixture();
  const journey = await create(root);
  const catalog = await readProjectCatalog(root);
  const filename = path.join(root, `tasks/journeys/${journey.id}/steps/review.md`);
  const external = Buffer.concat([await readFile(filename), Buffer.from('\nExternal instruction.\n')]);
  const original = vi.mocked(nativeFiles.replaceProjectMarkdown).getMockImplementation()!;
  vi.mocked(nativeFiles.replaceProjectMarkdown).mockImplementationOnce(async (...args) => {
    await original(...args);
    await writeFile(filename, external);
  });
  await expect(updateJourney(root, catalog, { action: 'update-journey', journeyId: journey.id, journeyHash: journey.fileHash,
    title: journey.title, description: '', zones: [], steps: journey.steps.filter(step => step.id !== 'review'),
    manifestHash: catalog.manifestHash })).rejects.toMatchObject({ saved: true, message: expect.stringContaining('JOURNEY_CONFLICT') });
  expect(await readFile(filename)).toEqual(external);
});

it('update-journey bumps the version, rewrites only changed steps and deletes removed ones', async () => {
  const root = await fixture();
  const journey = await create(root);
  const directory = `tasks/journeys/${journey.id}`;
  const refsBytes = await readFile(path.join(root, `${directory}/steps/refs.md`));
  const catalog = await readProjectCatalog(root);
  const current = catalog.journeys![0];
  const nextSteps: CatalogJourneyStep[] = [
    { ...steps[1], effort: 3, priority: 'high' },
    { ...steps[2] },
    { id: 'polish', title: 'Polish %PARENT_TITLE%', markdown: 'Polish %PARENT_TITLE%.', deckId: 'art', owner: null, dependsOn: ['model'], effort: 1, priority: 'low' },
  ];
  const written = await updateJourney(root, catalog, { action: 'update-journey', journeyId: journey.id, journeyHash: current.fileHash,
    title: 'Vehicle pipeline v2', description: 'Новый конвейер.', zones: [], steps: nextSteps, manifestHash: catalog.manifestHash });
  expect(written).toEqual([`${directory}/steps/model.md`, `${directory}/steps/polish.md`, `${directory}/index.md`, `${directory}/steps/review.md`]);
  const after = await readProjectCatalog(root);
  const updated = after.journeys![0];
  expect(updated).toMatchObject({ version: 2, title: 'Vehicle pipeline v2', description: 'Новый конвейер.' });
  expect(updated.zones).toEqual([]);
  expect(updated.steps.map(step => step.id)).toEqual(['model', 'refs', 'polish']);
  expect(updated.steps.find(step => step.id === 'model')).toMatchObject({ effort: 3, priority: 'high' });
  expect(await readFile(path.join(root, `${directory}/steps/refs.md`))).toEqual(refsBytes);
  const modelFile = await nativeFiles.readManagedMarkdown(root, `${directory}/steps/model.md`);
  expect(modelFile!.markdown).toBe(steps[1].markdown);
  expect(modelFile!.metadata).toMatchObject({ id: 'model', effort: 3, priority: 'high' });
  await expect(readFile(path.join(root, `${directory}/steps/review.md`))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(after.warnings).toEqual([]);
});

it('update-journey rejects a stale journey or manifest hash without writing', async () => {
  const root = await fixture();
  const journey = await create(root);
  const catalog = await readProjectCatalog(root);
  const current = catalog.journeys![0];
  const edit = { action: 'update-journey' as const, journeyId: journey.id, journeyHash: current.fileHash,
    title: 'Renamed', description: '', zones: [] as CatalogJourneyZone[], steps, manifestHash: catalog.manifestHash };
  await expect(updateJourney(root, catalog, { ...edit, journeyHash: '0'.repeat(64) })).rejects.toThrow('JOURNEY_CONFLICT');
  await expect(updateJourney(root, { ...catalog, manifestHash: 'stale' }, edit)).rejects.toThrow('CATALOG_CONFLICT');
  const stepPath = path.join(root, `tasks/journeys/${journey.id}/steps/model.md`);
  await writeFile(stepPath, Buffer.concat([await readFile(stepPath), Buffer.from('\nExternal edit.\n')]));
  await expect(updateJourney(root, catalog, edit)).rejects.toThrow('JOURNEY_CONFLICT');
  const after = await readProjectCatalog(root);
  expect(after.journeys![0].version).toBe(1);
  expect((await readdir(path.join(root, `tasks/journeys/${journey.id}/steps`))).sort()).toEqual(['model.md', 'refs.md', 'review.md']);
});

it('validates step zones on update-journey', async () => {
  const root = await fixture();
  const journey = await create(root);
  const catalog = await readProjectCatalog(root);
  const current = catalog.journeys![0];
  const edit = (zones: CatalogJourneyZone[], requestedSteps: CatalogJourneyStep[]) => ({ action: 'update-journey' as const,
    journeyId: journey.id, journeyHash: current.fileHash, title: current.title, description: '', zones, steps: requestedSteps,
    manifestHash: catalog.manifestHash });
  await expect(updateJourney(root, catalog, edit([{ id: 'main', title: 'Основные' }], [{ ...steps[2], zoneId: 'ghost' }])))
    .rejects.toThrow('Unknown Journey step zone: ghost');
  await expect(updateJourney(root, catalog, edit([{ id: 'main', title: 'Основные' }], [steps[2]])))
    .rejects.toThrow('Unknown Journey step zone: default');
  await updateJourney(root, catalog, edit([], [{ ...steps[2], zoneId: 'default' }]));
  const updated = (await readProjectCatalog(root)).journeys![0];
  expect(updated.version).toBe(2);
  expect(updated.steps[0]).toMatchObject({ id: 'refs', zoneId: 'default', effort: null, priority: null });
});
