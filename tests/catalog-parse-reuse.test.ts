import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import * as filesystem from 'node:fs/promises';
import { mkdir, mkdtemp, readFile, rename, rm, stat, symlink, unlink, utimes, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { stringify } from 'yaml';
import { emptyManifest, readFreshProjectCatalog, refreshProjectCatalog, renderCatalogManifest } from '../server/catalog.ts';
import { prepareCardOptionsPatch } from '../server/card-options.ts';
import { clearParseCache } from '../server/parse-cache.ts';
import { registerRequestLang } from '../server/i18n.ts';
import type { NativeCardMetadata } from '../server/native-cards.ts';
import type { CatalogView } from '../src/catalog-contracts.ts';

const parseCounts = vi.hoisted(() => new Map<string, number>());

vi.mock('../server/parse-cache.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../server/parse-cache.ts')>();
  return {
    ...actual,
    parseCached<Result>(namespace: string, identity: string, weight: number, compute: () => Result): Result {
      return actual.parseCached(namespace, identity, weight, () => {
        parseCounts.set(namespace, (parseCounts.get(namespace) ?? 0) + 1);
        return compute();
      });
    },
  };
});

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, readFile: vi.fn(actual.readFile), open: vi.fn(actual.open), readdir: vi.fn(actual.readdir) };
});

const roots: string[] = [];
const apps: FastifyInstance[] = [];
const legacyPath = 'features/audio.md';
const legacyId = 'task:features/audio.md#1.0';

beforeEach(() => {
  clearParseCache();
  parseCounts.clear();
  vi.mocked(filesystem.readFile).mockClear();
  vi.mocked(filesystem.open).mockClear();
});

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const root of roots.splice(0)) {
    if (path.dirname(root) !== path.resolve(tmpdir()) || !path.basename(root).startsWith('deckmate-parse-reuse-')) {
      throw new Error('Unsafe parse reuse fixture cleanup');
    }
    await rm(root, { recursive: true, force: true });
  }
  clearParseCache();
});

async function writeNative(root: string, overrides: Partial<NativeCardMetadata> = {}, markdown = 'Original body.\n') {
  const metadata: NativeCardMetadata = { deckmate: 'card', schema: 1, id: randomUUID(), kind: 'task',
    title: 'Original native', state: 'план', owner: 'Review', parentId: null, deckId: 'audio', trackIds: [], ...overrides };
  const relative = `cards/${metadata.id}.md`;
  const filename = path.join(root, relative);
  await writeFile(filename, `---\n${stringify(metadata)}---\n${markdown}`);
  return { id: `card:${metadata.id}`, relative, filename, metadata };
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'deckmate-parse-reuse-'));
  roots.push(root);
  for (const directory of ['features', 'docs', 'tasks', 'cards']) await mkdir(path.join(root, directory));
  await writeFile(path.join(root, legacyPath), '# Audio\n## 1 — Sounds\n### 1.0 Original legacy (план)\nLegacy body.\n');
  await writeFile(path.join(root, 'docs/unrelated.md'), '# Unrelated\nUntouched document.\n');
  await writeFile(path.join(root, 'tasks/iterations.md'), '## Итерация 1 — Проверка\n');
  const manifest = emptyManifest();
  manifest.spaces = [{ id: 'work', title: 'Work' }];
  manifest.decks = ['audio', 'concepts'].map(id => ({ id, spaceId: 'work', title: id, kind: 'mixed' as const,
    description: '', icon: 'box', color: '#123456' }));
  manifest.members = [{ id: 'reviewer', label: 'Reviewer', aliases: ['Review'], kind: 'human' }];
  manifest.membership = [{ card: legacyId, deck: 'audio' }];
  await writeFile(path.join(root, 'tasks/deckmate.md'), renderCatalogManifest(manifest));
  return { root, manifest, native: await writeNative(root) };
}

function resetMeasurements() {
  // 2026-11-05: the previous view must retain its raw inputs independently of the bounded global LRU.
  clearParseCache();
  parseCounts.clear();
  vi.mocked(filesystem.readFile).mockClear();
  vi.mocked(filesystem.open).mockClear();
}

function readsOf(root: string, relative: string): number {
  const filename = path.resolve(root, relative).toLowerCase();
  return [...vi.mocked(filesystem.readFile).mock.calls, ...vi.mocked(filesystem.open).mock.calls].filter(([target]) =>
    typeof target === 'string' && path.resolve(target).toLowerCase() === filename).length;
}

function cardParses() {
  return { legacy: parseCounts.get('project-file') ?? 0, native: parseCounts.get('native-card') ?? 0 };
}

it('reuses raw legacy and native parses after LRU eviction while full scans still read every source', async () => {
  const { root, native } = await fixture();
  const document = await writeNative(root, { kind: 'doc', state: null, title: 'Native document' }, '## Открыто\n- Native question\n');
  const before = await readFreshProjectCatalog(root);
  const frozenBefore = structuredClone(before);
  expect(before.cards.find(card => card.id === document.id)?.openQuestions).toEqual([{ text: 'Native question', taskRef: null }]);
  expect(parseCounts.get('doc-questions')).toBeGreaterThan(0);
  resetMeasurements();
  const after = await readFreshProjectCatalog(root);
  expect(cardParses()).toEqual({ legacy: 0, native: 0 });
  expect(parseCounts.get('doc-questions') ?? 0).toBe(0);
  for (const relative of [legacyPath, 'docs/unrelated.md', 'tasks/iterations.md', native.relative, document.relative]) {
    expect(readsOf(root, relative)).toBe(1);
  }
  expect(after).toEqual(before);
  expect(before).toEqual(frozenBefore);
});

it('reports a malformed native file on repeated full scans and recovers when valid bytes replace it', async () => {
  const { root, native } = await fixture();
  await writeFile(native.filename, '---\nkind: [\n---\nBroken native.\n');
  const first = await readFreshProjectCatalog(root);
  expect(first.cards.some(card => card.id === native.id)).toBe(false);
  expect(first.warnings.join('\n')).toContain(native.relative);
  expect(cardParses().native).toBe(1);

  // 2026-11-05: leave the error in the LRU to prove a hit still reports the original failure.
  const second = await readFreshProjectCatalog(root);
  expect(second.warnings).toEqual(first.warnings);
  expect(second.cards.some(card => card.id === native.id)).toBe(false);
  expect(cardParses().native).toBe(1);

  await writeNative(root, { ...native.metadata, title: 'Recovered native' });
  const recovered = await readFreshProjectCatalog(root);
  expect(recovered.warnings.some(warning => warning.includes(native.relative))).toBe(false);
  expect(recovered.cards.find(card => card.id === native.id)?.title).toBe('Recovered native');
  expect(cardParses().native).toBe(2);
  expect(first.cards.some(card => card.id === native.id)).toBe(false);
  expect(second.warnings).toEqual(first.warnings);
});

it('detects same-size legacy and native edits even when mtime is restored', async () => {
  const { root, native } = await fixture();
  const filenames = [path.join(root, legacyPath), native.filename];
  const timestamp = new Date('2026-11-05T12:00:00.000Z');
  for (const filename of filenames) await utimes(filename, timestamp, timestamp);
  const before = await readFreshProjectCatalog(root);
  const originalStats = await Promise.all(filenames.map(filename => stat(filename)));
  for (const filename of filenames) {
    await writeFile(filename, (await readFile(filename, 'utf8')).replace('Original', 'External'));
    await utimes(filename, timestamp, timestamp);
  }
  const changedStats = await Promise.all(filenames.map(filename => stat(filename)));
  expect(changedStats.map(info => [info.size, info.mtimeMs])).toEqual(originalStats.map(info => [info.size, info.mtimeMs]));
  resetMeasurements();
  const after = await readFreshProjectCatalog(root);
  expect(cardParses()).toEqual({ legacy: 1, native: 1 });
  for (const [cardId, title] of [[legacyId, 'External legacy (план)'], [native.id, 'External native']]) {
    const changed = after.cards.find(card => card.id === cardId)!;
    expect(changed.title).toBe(title);
    expect(changed.sourceHash).not.toBe(before.cards.find(card => card.id === cardId)!.sourceHash);
  }
  expect(before.cards.find(card => card.id === native.id)?.title).toBe('Original native');
});

it('discovers additions and deletions in a full scan and keys identical Markdown by its new path', async () => {
  const { root, native } = await fixture();
  const before = await readFreshProjectCatalog(root);
  const oldMarkdown = await readFile(path.join(root, 'docs/unrelated.md'));
  await writeFile(path.join(root, 'docs/renamed.md'), oldMarkdown);
  await unlink(path.join(root, 'docs/unrelated.md'));
  await unlink(native.filename);
  const added = await writeNative(root, { title: 'Added native' });
  resetMeasurements();
  const after = await readFreshProjectCatalog(root);
  expect(cardParses()).toEqual({ legacy: 1, native: 1 });
  expect(after.cards.some(card => card.id === 'doc:docs/unrelated.md' || card.id === native.id)).toBe(false);
  expect(after.cards.find(card => card.id === 'doc:docs/renamed.md')).toMatchObject({ path: 'docs/renamed.md', title: 'Unrelated' });
  expect(after.cards.find(card => card.id === added.id)?.title).toBe('Added native');
  expect(before.cards.some(card => card.id === native.id)).toBe(true);
  expect(after.cards).toHaveLength(before.cards.length);
});

it('rejects a directory junction replacing a previously parsed native file', async () => {
  const { root, native } = await fixture();
  const before = await readFreshProjectCatalog(root);
  const outside = path.join(root, 'outside');
  await mkdir(outside);
  await unlink(native.filename);
  await symlink(outside, native.filename, 'junction');
  try {
    resetMeasurements();
    const after = await readFreshProjectCatalog(root);
    expect(after.cards.some(card => card.id === native.id)).toBe(false);
    expect(after.warnings.join('\n')).toContain(native.relative);
    expect(readsOf(root, native.relative)).toBe(0);
    expect(before.cards.some(card => card.id === native.id)).toBe(true);
  } finally { await unlink(native.filename); }
});

it('rejects a legacy scan directory replaced by an outside link after listing', async () => {
  const { root } = await fixture();
  const outside = await mkdtemp(path.join(tmpdir(), 'deckmate-parse-reuse-'));
  roots.push(outside);
  await writeFile(path.join(outside, 'unrelated.md'), '# ExternalSecret\nOutsideContentMustNotLeak\n');
  const directory = path.join(root, 'docs');
  const readdir = vi.mocked(filesystem.readdir).getMockImplementation()!;
  let injected = false;
  const listing = vi.mocked(filesystem.readdir).mockImplementation(async (...args: Parameters<typeof filesystem.readdir>) => {
    const entries = await readdir(...args);
    if (args[0] === directory) {
      injected = true;
      await rename(directory, path.join(root, 'original-docs'));
      await symlink(outside, directory, process.platform === 'win32' ? 'junction' : 'dir');
    }
    return entries;
  });
  try {
    const catalog = await readFreshProjectCatalog(root);
    expect(injected).toBe(true);
    expect(catalog.cards.some(card => card.path === 'docs/unrelated.md')).toBe(false);
    expect(catalog.documents.some(document => document.path === 'docs/unrelated.md')).toBe(false);
    expect(catalog.warnings.join('\n')).toContain('docs/unrelated.md');
    expect(readsOf(root, 'docs/unrelated.md')).toBe(0);
    expect(JSON.stringify(catalog)).not.toContain('OutsideContentMustNotLeak');
  } finally { listing.mockImplementation(readdir); }
});

it('reprojects manifest members and options onto reused raw cards without mutating older views', async () => {
  const { root, manifest, native } = await fixture();
  const before = await readFreshProjectCatalog(root);
  const frozenBefore = structuredClone(before);
  manifest.members![0].label = 'Renamed reviewer';
  manifest.membership = [{ card: legacyId, deck: 'concepts', owner: 'Review', priority: 'high' }];
  await writeFile(path.join(root, 'tasks/deckmate.md'), renderCatalogManifest(manifest));
  await (await prepareCardOptionsPatch(root, before.optionsHash ?? '', { [native.id]: { archived: true } })).publish();
  resetMeasurements();
  const changed = await readFreshProjectCatalog(root);
  expect(cardParses()).toEqual({ legacy: 0, native: 0 });
  expect(changed.cards.find(card => card.id === legacyId)).toMatchObject({ deckId: 'concepts', owner: 'Renamed reviewer', priority: 'high' });
  expect(changed.cards.find(card => card.id === native.id)).toMatchObject({ owner: 'Renamed reviewer', archived: true });
  expect(before).toEqual(frozenBefore);

  await unlink(path.join(root, 'tasks/deckmate-card-options.md'));
  resetMeasurements();
  const reset = await readFreshProjectCatalog(root);
  expect(cardParses()).toEqual({ legacy: 0, native: 0 });
  expect(reset.cards.find(card => card.id === native.id)?.archived).toBeUndefined();
  expect(changed.cards.find(card => card.id === native.id)?.archived).toBe(true);
});

it('does not reuse a previous root when incremental refresh is given another project', async () => {
  const first = await fixture();
  const second = await fixture();
  const before = await readFreshProjectCatalog(first.root);
  await writeFile(path.join(second.root, legacyPath), '# Second project\n### 2.0 Different task (план)\n');
  resetMeasurements();
  const after = await refreshProjectCatalog(second.root, before, []);
  expect(after.rootIdentity).not.toBe(before.rootIdentity);
  expect(after.cards.find(card => card.id === 'task:features/audio.md#2.0')?.title).toBe('Different task (план)');
  expect(after.cards.some(card => card.id === first.native.id)).toBe(false);
  expect(after.cards.some(card => card.id === second.native.id)).toBe(true);
  expect(readsOf(second.root, legacyPath)).toBe(1);
  expect(before.cards.find(card => card.id === legacyId)?.title).toBe('Original legacy (план)');
});

it('rebuilds locale-dependent parsing when a refresh receives a snapshot from another language', async () => {
  const { root } = await fixture();
  await writeFile(path.join(root, 'docs/unrelated.md'), '# Questions\n## Открыто\n- First\n## Открыто\n- Second\n');
  const retained: CatalogView[] = [];
  const app = Fastify();
  apps.push(app);
  registerRequestLang(app);
  app.get('/catalog', async () => {
    const previous = retained.at(-1);
    const view = previous ? await refreshProjectCatalog(root, previous, []) : await readFreshProjectCatalog(root);
    retained.push(view);
    return view;
  });
  const english = await app.inject({ url: '/catalog', headers: { cookie: 'deckmate-lang=en' } });
  expect(english.statusCode).toBe(200);
  expect(retained[0].cards.find(card => card.id === 'doc:docs/unrelated.md')?.openQuestionWarnings)
    .toContain('Multiple “Open questions” sections; only the first is counted.');
  resetMeasurements();
  const russian = await app.inject({ url: '/catalog', headers: { cookie: 'deckmate-lang=ru' } });
  expect(russian.statusCode).toBe(200);
  expect(cardParses().legacy).toBeGreaterThan(0);
  expect(retained[1].cards.find(card => card.id === 'doc:docs/unrelated.md')?.openQuestionWarnings)
    .toContain('Несколько разделов «Открыто» — считается только первый.');
  expect(retained[0].cards.find(card => card.id === 'doc:docs/unrelated.md')?.openQuestionWarnings)
    .toContain('Multiple “Open questions” sections; only the first is counted.');
});
