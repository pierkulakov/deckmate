import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { CatalogEdit, CatalogJourneyStep } from '../src/catalog-contracts.ts';
import { emptyManifest, readProjectCatalog, renderCatalogManifest } from '../server/catalog.ts';
import { registerRequestLang } from '../server/i18n.ts';
import { throwJourneyPublicationError } from '../server/journey-publication.ts';
import { saveJourneyTemplate } from '../server/journey-templates.ts';
import { publishJourney } from '../server/journeys.ts';
import * as nativeFiles from '../server/native-cards.ts';

vi.mock('../server/native-cards.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../server/native-cards.ts')>();
  return { ...actual, createManagedMarkdown: vi.fn(actual.createManagedMarkdown) };
});

const roots: string[] = [];
const writer = vi.mocked(nativeFiles.createManagedMarkdown);
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

const journeyId = '11111111-2222-4333-8444-555555555555';
const steps: CatalogJourneyStep[] = [
  { id: 'first', title: 'First', markdown: 'First instruction.\n', deckId: 'work', owner: null, dependsOn: [] },
  { id: 'second', title: 'Second', markdown: 'Second instruction.\n', deckId: 'work', owner: null, dependsOn: ['first'] },
];
const filenames = ['steps/first.md', 'steps/second.md', 'index.md'];

async function fixture(subject: 'journey' | 'template') {
  const root = await mkdtemp(path.join(tmpdir(), 'deckmate-publication-errors-'));
  roots.push(root);
  await mkdir(path.join(root, 'tasks'));
  const manifest = emptyManifest();
  manifest.spaces.push({ id: 'project', title: 'Project' });
  for (const [id, kind] of [['assets', 'asset'], ['work', 'task']] as const) {
    manifest.decks.push({ id, kind, title: id, spaceId: 'project', icon: 'box', color: '#123456', description: '' });
  }
  await writeFile(path.join(root, 'tasks/deckmate.md'), renderCatalogManifest(manifest));
  const publication = { id: journeyId, version: 1, title: 'Journey', deckId: 'assets', description: '', zones: [], steps };
  if (subject === 'template') await publishJourney(root, async () => {}, publication);
  const catalog = await readProjectCatalog(root);
  const edit: Extract<CatalogEdit, { action: 'save-journey-template' }> = {
    action: 'save-journey-template', manifestHash: catalog.manifestHash, journeyId,
    journeyHash: catalog.journeys?.[0]?.fileHash ?? '', title: 'Template', description: '', category: 'Project', tags: [],
  };
  const foreignPath = path.join(root, 'tasks/human.md');
  const foreignBytes = Buffer.from('\uFEFF# Human notes\r\nKeep these bytes.  \r\n');
  await writeFile(foreignPath, foreignBytes);
  const manifestBefore = await readFile(path.join(root, 'tasks/deckmate.md'));
  writer.mockClear();
  return { root, foreignPath, foreignBytes, manifestBefore,
    run: () => subject === 'journey'
      ? publishJourney(root, async () => {}, publication)
      : saveJourneyTemplate(root, catalog, edit) };
}

describe.each(['journey', 'template'] as const)('%s publication errors', subject => {
  it.each([
    { stage: 'before the first write', failAt: 0, afterWrite: false, incomingSaved: false, completed: 0 },
    { stage: 'after a step', failAt: 1, afterWrite: false, incomingSaved: false, completed: 1 },
    { stage: 'after the index lands', failAt: 2, afterWrite: true, incomingSaved: true, completed: 3 },
    { stage: 'incoming saved:true before any confirmed write', failAt: 0, afterWrite: false, incomingSaved: true, completed: 0 },
  ])('preserves saved state $stage', async ({ failAt, afterWrite, incomingSaved, completed }) => {
    const { root, run, foreignPath, foreignBytes, manifestBefore } = await fixture(subject);
    const original = writer.getMockImplementation()!;
    const failure = Object.assign(new Error('Injected publication failure'), { saved: incomingSaved });
    const attempts: string[] = [];
    writer.mockImplementation(async (...args) => {
      const position = attempts.length;
      attempts.push(args[1]);
      if (position === failAt && !afterWrite) throw failure;
      const result = await original(...args);
      if (position === failAt) throw failure;
      return result;
    });
    const result = await run().catch((error: unknown) => error);
    expect(attempts).toHaveLength(failAt + 1);
    const directory = attempts[0].slice(0, -'/steps/first.md'.length);
    const paths = filenames.map(filename => `${directory}/${filename}`);
    expect(attempts).toEqual(paths.slice(0, failAt + 1));
    if (failAt === 0 && !incomingSaved) {
      expect(result).toBe(failure);
    } else {
      const written = paths.slice(0, failAt).join(', ');
      const listed = subject === 'journey' ? written || 'none' : written;
      expect(result).toMatchObject({ saved: true,
        message: expect.stringContaining(`Written: ${listed};`) });
      expect((result as Error).message).toContain(directory);
      expect((result as Error).message).toContain(failure.message);
      expect((result as Error).message).toMatch(subject === 'journey' ? /^Journey partly saved/ : /^Template partly saved/);
      expect(result).not.toBe(failure);
    }
    expect(failure.saved).toBe(incomingSaved);
    for (const [index, relative] of paths.entries()) {
      if (index < completed) expect((await readFile(path.join(root, relative), 'utf8')).length).toBeGreaterThan(0);
      else await expect(readFile(path.join(root, relative))).rejects.toMatchObject({ code: 'ENOENT' });
    }
    expect(await readFile(foreignPath)).toEqual(foreignBytes);
    expect(await readFile(path.join(root, 'tasks/deckmate.md'))).toEqual(manifestBefore);
  });

  it('returns the unchanged written-path list with the index last', async () => {
    const { root, run } = await fixture(subject);
    const written = await run();
    expect(written).toEqual(writer.mock.calls.map(args => args[1]));
    const directory = path.posix.dirname(written[2]);
    expect(written).toEqual(filenames.map(filename => `${directory}/${filename}`));
    for (const relative of written) expect((await readFile(path.join(root, relative))).length).toBeGreaterThan(0);
  });
});

it.each([new Error('Before publication'), { saved: false }, 'failure', null, undefined])
('rethrows an unsaved failure unchanged: %s', error => {
  let caught: unknown = Symbol('not thrown');
  try { throwJourneyPublicationError(error, [], 'tasks/journeys/example', 'journey'); }
  catch (failure) { caught = failure; }
  expect(caught).toBe(error);
});

it.each(['journey', 'template'] as const)('preserves written paths and non-Error reasons for %s', subject => {
  const written = Object.freeze(['steps/second.md', 'steps/first.md', 'index.md']);
  expect(() => throwJourneyPublicationError('I/O failure', written, 'directory', subject))
    .toThrow('Written: steps/second.md, steps/first.md, index.md;');
  expect(() => throwJourneyPublicationError('I/O failure', written, 'directory', subject)).toThrow('I/O failure');
  expect(written).toEqual(['steps/second.md', 'steps/first.md', 'index.md']);
});

it('uses the current request language and preserves both subject-specific messages', async () => {
  const app = Fastify();
  registerRequestLang(app);
  app.get<{ Params: { subject: 'journey' | 'template' } }>('/:subject', async request => {
    try { throwJourneyPublicationError(Object.assign(new Error('I/O failure'), { saved: true }), [], 'directory', request.params.subject); }
    catch (error) {
      const failure = error as Error & { saved: boolean };
      return { message: failure.message, saved: failure.saved };
    }
  });
  try {
    for (const [language, subject, message] of [
      ['en', 'journey', 'Journey partly saved. Written: none; retry with the current catalog to finish saving in directory. I/O failure'],
      ['en', 'template', 'Template partly saved. Written: ; check directory and retry. I/O failure'],
      ['ru', 'journey', 'Сохранение Journey завершено не полностью. Записаны: нет; повтор с актуальным каталогом достроит остальное в directory. I/O failure'],
      ['ru', 'template', 'Сохранение шаблона завершено не полностью. Записаны: ; проверьте directory и повторите. I/O failure'],
    ]) {
      const response = await app.inject({ url: `/${subject}`, headers: { cookie: `deckmate-lang=${language}` } });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ message, saved: true });
    }
  } finally { await app.close(); }
});
