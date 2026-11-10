import { afterEach, expect, it, vi } from 'vitest';
import * as filesystem from 'node:fs/promises';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { editProjectCatalog, emptyManifest, readManifest, readProjectCatalog, renderCatalogManifest } from '../server/catalog.ts';
import { applyAttachmentEdit, readCardAttachments } from '../server/attachments.ts';
import { publishJourney, readJourney } from '../server/journeys.ts';
import { importJourneyTemplate, saveJourneyTemplate } from '../server/journey-templates.ts';
import { importCards } from '../server/catalog-import.ts';
import { createManagedMarkdown } from '../server/native-cards.ts';

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename), link: vi.fn(actual.link), lstat: vi.fn(actual.lstat) };
});

const roots: string[] = [];
const cardId = 'card:ca1d0000-0000-4000-8000-000000000001';
const journeyId = '11111111-2222-4333-8444-555555555555';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhVEAAAAASUVORK5CYII=', 'base64');
const dataUrl = `data:image/png;base64,${png.toString('base64')}`;

afterEach(async () => {
  const actual = await vi.importActual<typeof filesystem>('node:fs/promises');
  vi.mocked(filesystem.rename).mockReset().mockImplementation(actual.rename);
  vi.mocked(filesystem.link).mockReset().mockImplementation(actual.link);
  vi.mocked(filesystem.lstat).mockReset().mockImplementation(actual.lstat);
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'deckmate-cover-publication-'));
  roots.push(root);
  await mkdir(path.join(root, 'tasks'));
  const manifest = emptyManifest();
  manifest.formatLanguage = 'en';
  manifest.spaces.push({ id: 'project', title: 'Project' });
  manifest.members = [{ id: 'agent', label: 'Agent', kind: 'agent', aliases: [] }];
  for (const [id, kind] of [['assets', 'asset'], ['work', 'task']] as const) {
    manifest.decks.push({ id, kind, title: id, spaceId: 'project', icon: 'box', color: '#123456', description: '' });
  }
  await writeFile(path.join(root, 'tasks/deckmate.md'), renderCatalogManifest(manifest));
  return root;
}

async function injectFailure(matches: (filename: string) => boolean, stage: 'before' | 'after' = 'after', skip = 0) {
  const actual = await vi.importActual<typeof filesystem>('node:fs/promises');
  const failure = new Error('Injected publication check failure');
  let published = '';
  let hit = false;
  let injected = false;
  const publish = async (source: Parameters<typeof filesystem.rename>[0], destination: Parameters<typeof filesystem.rename>[1], method: 'rename' | 'link') => {
    const filename = String(destination);
    if (hit || !matches(filename.replaceAll('\\', '/')) || skip-- > 0) return actual[method](source, destination);
    hit = true;
    if (stage === 'before') { injected = true; throw failure; }
    await actual[method](source, destination);
    published = filename;
    // 2026-11-10: fail the first destination check after the real OS publication, not rename/link itself.
    vi.mocked(filesystem.lstat).mockImplementation((target, options) => {
      if (String(target) !== filename) return actual.lstat(target, options);
      injected = true;
      vi.mocked(filesystem.lstat).mockImplementation(actual.lstat);
      return Promise.reject(failure);
    });
  };
  vi.mocked(filesystem.rename).mockImplementation((source, destination) => publish(source, destination, 'rename'));
  vi.mocked(filesystem.link).mockImplementation((source, destination) => publish(source, destination, 'link'));
  return { failure, filename: () => published, hit: () => injected };
}

it.each(['before', 'after'] as const)('cleans a new deck cover only if the manifest failed %s rename', async stage => {
  const root = await fixture();
  const catalog = await readProjectCatalog(root);
  const before = await readFile(path.join(root, 'tasks/deckmate.md'));
  const fault = await injectFailure(filename => filename.endsWith('/tasks/deckmate.md'), stage);
  await expect(editProjectCatalog(root, { action: 'upload-cover', deckId: 'work', dataUrl, manifestHash: catalog.manifestHash }))
    .rejects.toBe(fault.failure);
  expect(fault.hit()).toBe(true);
  const files = await readdir(path.join(root, 'tasks/deckmate-assets/covers'));
  if (stage === 'before') {
    expect(fault.failure).not.toHaveProperty('saved');
    expect(files).toEqual([]);
    expect(await readFile(path.join(root, 'tasks/deckmate.md'))).toEqual(before);
  } else {
    expect(fault.failure).toHaveProperty('saved', true);
    const cover = (await readManifest(root)).manifest.decks.find(deck => deck.id === 'work')!.cover!;
    expect(files).toEqual([path.basename(cover)]);
    expect(await readFile(path.join(root, cover))).toEqual(png);
  }
});

it('preserves an uploaded attachment after registry rename and a failed destination check', async () => {
  const root = await fixture();
  const fault = await injectFailure(filename => filename.endsWith('/attachments.md'));
  await expect(applyAttachmentEdit(root, { action: 'upload-attachment', cardId, attachmentsHash: '', manifestHash: '', dataUrl,
    fileName: null, addedBy: null }))
    .rejects.toMatchObject({ saved: true });
  expect(fault.hit()).toBe(true);
  const attachments = await readCardAttachments(root, cardId);
  expect(attachments.files).toHaveLength(1);
  expect(attachments.warnings).toEqual([]);
  expect(await readFile(path.join(root, attachments.files[0].file))).toEqual(png);
});

async function createTask(root: string) {
  await createManagedMarkdown(root, `cards/${cardId.slice(5)}.md`, { deckmate: 'card', schema: 1,
    id: cardId.slice(5), kind: 'task', title: 'Task', state: 'not-started', owner: null, deckId: 'work', trackIds: [], parentId: null }, 'Body.\n');
}

it('does not roll back a card report when its state was published before the check failed', async () => {
  const root = await fixture();
  await createTask(root);
  const catalog = await readProjectCatalog(root);
  const card = catalog.cards.find(card => card.id === cardId)!;
  const fault = await injectFailure(filename => filename.endsWith(`/${card.path}`), 'after', 1);
  await expect(editProjectCatalog(root, { action: 'add-card-report', cardId, sourceHash: card.sourceHash,
    manifestHash: catalog.manifestHash, markdown: 'Published report.\n', state: 'review' }, 'agent'))
    .rejects.toMatchObject({ saved: true });
  expect(fault.hit()).toBe(true);
  const after = (await readProjectCatalog(root)).cards.find(card => card.id === cardId)!;
  expect(after.state).toBe('review');
  expect(after.markdown).toContain('Published report.');
});

it('keeps a newly published card after the link check fails', async () => {
  const root = await fixture();
  const catalog = await readProjectCatalog(root);
  const fault = await injectFailure(filename => filename.endsWith(`/${cardId.slice(5)}.md`));
  await expect(editProjectCatalog(root, { action: 'create-card', manifestHash: catalog.manifestHash, cardId,
    kind: 'task', title: 'New', markdown: 'New body.', deckId: 'work', trackIds: [], parentId: null, owner: null,
    effort: null, priority: null })).rejects.toMatchObject({ saved: true });
  expect(fault.hit()).toBe(true);
  expect((await readProjectCatalog(root)).cards.find(card => card.id === cardId)?.title).toBe('New');
});

async function createPipeline(root: string) {
  await publishJourney(root, async () => {}, { id: journeyId, title: 'Pipeline', version: 1, deckId: 'assets', description: '', zones: [],
    steps: [{ id: 'a', title: 'A', markdown: 'Instruction.', deckId: 'work', owner: null, dependsOn: [] }] });
}

it.each(['step', 'index'] as const)('keeps published Journey template files after the %s check fails', async target => {
  const root = await fixture();
  await createPipeline(root);
  const catalog = await readProjectCatalog(root);
  const fault = await injectFailure(filename => filename.includes('/journey-templates/')
    && filename.endsWith(target === 'step' ? '/steps/a.md' : '/index.md'));
  await expect(saveJourneyTemplate(root, catalog, { action: 'save-journey-template', manifestHash: catalog.manifestHash,
    journeyId, journeyHash: catalog.journeys![0].fileHash, title: 'Saved', description: '', category: 'Project', tags: [] }))
    .rejects.toMatchObject({ saved: true });
  expect(fault.hit()).toBe(true);
  expect(await readFile(fault.filename(), 'utf8')).toContain(target === 'step' ? 'Instruction.' : 'deckmate: journey-template');
  const directory = target === 'step' ? path.dirname(path.dirname(fault.filename())) : path.dirname(fault.filename());
  expect(await readFile(path.join(directory, 'steps/a.md'), 'utf8')).toContain('Instruction.');
});

it('keeps imported cards and reports partial success after the published file check fails', async () => {
  const root = await fixture();
  const catalog = await readProjectCatalog(root);
  const fault = await injectFailure(filename => filename.endsWith(`/${cardId.slice(5)}.md`));
  const result = await importCards(root, { source: 'sandbox', deckId: 'work', manifestHash: catalog.manifestHash,
    optionsHash: catalog.optionsHash!, cards: [{ cardId, kind: 'task', title: 'Imported', markdown: 'Imported body.',
      owner: null, effort: null, priority: null, state: 'not-started', tags: [] }] });
  expect(fault.hit()).toBe(true);
  expect(result.created).toEqual([cardId]);
  expect(result.skipped).toEqual([]);
  expect(result.warnings).toHaveLength(1);
  expect((await readProjectCatalog(root)).cards.find(card => card.id === cardId)?.title).toBe('Imported');
});

it('retains an imported Journey when its index was published before the check failed', async () => {
  const root = await fixture();
  const catalog = await readProjectCatalog(root);
  const template = catalog.journeyTemplates![0];
  const fault = await injectFailure(filename => filename.includes('/journeys/') && filename.endsWith('/index.md'));
  await expect(importJourneyTemplate(root, catalog, { action: 'import-journey-template', manifestHash: catalog.manifestHash,
    deckId: 'assets', templateId: template.id, templateSource: template.source, templateHash: template.fileHash,
    mode: 'add', journeyId: null, journeyHash: null, roleMapping: Object.fromEntries(template.roles.map(role => [role.id, { deckId: 'work' }])) }))
    .rejects.toMatchObject({ saved: true });
  expect(fault.hit()).toBe(true);
  const id = path.basename(path.dirname(fault.filename()));
  expect((await readJourney(root, id))!.journey.steps).toHaveLength(template.steps.length);
});
