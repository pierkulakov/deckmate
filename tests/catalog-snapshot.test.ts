import { afterEach, expect, it, vi } from 'vitest';
import * as filesystem from 'node:fs/promises';
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { stringify } from 'yaml';
import { emptyManifest, readProjectCatalog, refreshProjectCatalog, renderCatalogManifest } from '../server/catalog.ts';
import { CatalogService } from '../server/catalog-service.ts';
import { ProjectIndex } from '../server/project-index.ts';
import { prepareCardOptionsPatch } from '../server/card-options.ts';
import { createManagedMarkdown, type NativeCardMetadata } from '../server/native-cards.ts';
import type { ServerConfig } from '../server/config.ts';

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, readFile: vi.fn(actual.readFile), open: vi.fn(actual.open), writeFile: vi.fn(actual.writeFile) };
});

const execute = promisify(execFile);
const roots: string[] = [];
const services: CatalogService[] = [];
const legacyId = 'task:features/audio.md#1.0';
const optionsPath = 'tasks/deckmate-card-options.md';

afterEach(async () => {
  const actual = await vi.importActual<typeof filesystem>('node:fs/promises');
  vi.mocked(filesystem.open).mockReset().mockImplementation(actual.open);
  vi.mocked(filesystem.readFile).mockReset().mockImplementation(actual.readFile);
  vi.mocked(filesystem.writeFile).mockReset().mockImplementation(actual.writeFile);
  for (const service of services.splice(0)) await service.close();
  for (const root of roots.splice(0)) {
    if (path.dirname(root) !== path.resolve(tmpdir()) || !path.basename(root).startsWith('deckmate-snapshot-')) throw new Error('Unsafe fixture cleanup');
    await rm(root, { recursive: true, force: true });
  }
});

async function native(root: string, kind: NativeCardMetadata['kind'], overrides: Partial<NativeCardMetadata> = {}) {
  const id = randomUUID();
  const relative = `cards/${id}.md`;
  const metadata: NativeCardMetadata = { deckmate: 'card', schema: 1, id, kind, title: 'Original native',
    state: kind === 'task' ? 'план' : null, owner: null, parentId: null, deckId: kind === 'hero' ? 'concepts' : 'audio', trackIds: [], ...overrides };
  await createManagedMarkdown(root, relative, metadata, 'Original body.\n');
  return { id: `card:${id}`, relative, filename: path.join(root, relative), metadata };
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'deckmate-snapshot-'));
  roots.push(root);
  for (const directory of ['features', 'docs', 'tasks']) await mkdir(path.join(root, directory));
  await writeFile(path.join(root, 'features/audio.md'), '# Audio\n## 1 — Sounds\n### 1.0 Original legacy (план)\nLegacy body.\n');
  await writeFile(path.join(root, 'docs/unrelated.md'), '# Unrelated\nUntouched document.\n');
  await writeFile(path.join(root, 'tasks/iterations.md'), '## Итерация 1 — Проверка\n');
  const manifest = emptyManifest();
  manifest.spaces = [{ id: 'work', title: 'Work' }];
  manifest.decks = ['audio', 'concepts'].map(id => ({ id, spaceId: 'work', title: id, kind: 'mixed' as const, description: '', icon: 'box', color: '#123456' }));
  manifest.members = [{ id: 'reviewer', label: 'Reviewer', aliases: ['Review'], kind: 'human' }];
  manifest.membership = [{ card: legacyId, deck: 'audio' }];
  await writeFile(path.join(root, 'tasks/deckmate.md'), renderCatalogManifest(manifest));
  const parent = await native(root, 'hero');
  const child = await native(root, 'task', { parentId: parent.id, dependsOn: [parent.id] });
  return { root, manifest, parent, child };
}

function clearReads() {
  vi.mocked(filesystem.readFile).mockClear();
  vi.mocked(filesystem.open).mockClear();
}

function readsOf(root: string, relative: string): number {
  const filename = path.resolve(root, relative).toLowerCase();
  const matches = (target: unknown) => typeof target === 'string' && path.resolve(target).toLowerCase() === filename;
  return vi.mocked(filesystem.readFile).mock.calls.filter(([target]) => matches(target)).length
    + vi.mocked(filesystem.open).mock.calls.filter(([target, flags]) => matches(target) && flags !== 'wx').length;
}

async function serviceFixture() {
  const result = await fixture();
  await execute('git', ['init', '-b', 'deckmate/sandbox', result.root], { windowsHide: true });
  const config: ServerConfig = { editMode: 'sandbox', dataRoot: result.root, writeRoot: result.root, projectName: 'Snapshot test', port: 44319, python: 'python' };
  const service = new CatalogService(config, ':memory:');
  services.push(service);
  return { ...result, service };
}

it('refreshes legacy changes, additions and removals without rereading unrelated sources or mutating the old view', async () => {
  const { root, child } = await fixture();
  const before = await readProjectCatalog(root);
  const frozenBefore = structuredClone(before);
  await writeFile(path.join(root, 'features/audio.md'), '# Audio changed\n## 1 — Sounds\n### 1.0 Replacement legacy (в работе)\nNew body.\n');
  await writeFile(path.join(root, 'docs/added.md'), '# Added document\nNew text.\n');
  clearReads();
  const changed = await refreshProjectCatalog(root, before, ['features/audio.md', 'docs/added.md']);
  expect(readsOf(root, 'docs/unrelated.md')).toBe(0);
  expect(readsOf(root, child.relative)).toBe(0);
  expect(readsOf(root, 'features/audio.md')).toBe(1);
  expect(changed).toEqual(await readProjectCatalog(root));
  expect(changed.cards.find(card => card.id === legacyId)).toMatchObject({ title: 'Replacement legacy', state: 'started' });
  expect(before).toEqual(frozenBefore);

  await unlink(path.join(root, 'features/audio.md'));
  await unlink(path.join(root, 'docs/added.md'));
  clearReads();
  const removed = await refreshProjectCatalog(root, changed, ['features/audio.md', 'docs/added.md']);
  expect(readsOf(root, 'docs/unrelated.md')).toBe(0);
  expect(removed).toEqual(await readProjectCatalog(root));
  expect(removed.cards.some(card => card.id === legacyId)).toBe(false);
  expect(removed.warnings.join(' ')).toContain(legacyId);
});

it('refreshes native sources and recomputes warnings on untouched dependent cards after removal', async () => {
  const { root, parent, child } = await fixture();
  const before = await readProjectCatalog(root);
  const frozenBefore = structuredClone(before);
  await writeFile(child.filename, (await readFile(child.filename, 'utf8')).replace('Original native', 'Replacement native'));
  const added = await native(root, 'task', { title: 'Added native' });
  clearReads();
  const changed = await refreshProjectCatalog(root, before, [child.relative, added.relative]);
  expect(readsOf(root, parent.relative)).toBe(0);
  expect(readsOf(root, 'features/audio.md')).toBe(0);
  expect(changed).toEqual(await readProjectCatalog(root));
  expect(changed.cards.find(card => card.id === child.id)?.title).toBe('Replacement native');
  expect(before).toEqual(frozenBefore);

  await unlink(parent.filename);
  await unlink(added.filename);
  clearReads();
  const removed = await refreshProjectCatalog(root, changed, [parent.relative, added.relative]);
  expect(readsOf(root, child.relative)).toBe(0);
  expect(removed).toEqual(await readProjectCatalog(root));
  expect(removed.warnings.filter(warning => warning.includes(parent.id))).toHaveLength(2);
  expect(removed.cards.find(card => card.id === child.id)?.sourceHash).toBe(changed.cards.find(card => card.id === child.id)?.sourceHash);
});

it('applies manifest and options changes to cached raw cards without retaining old derived properties', async () => {
  const { root, manifest, child } = await fixture();
  const before = await readProjectCatalog(root);
  manifest.membership = [{ card: legacyId, deck: 'concepts', owner: 'Review', priority: 'high' }];
  await writeFile(path.join(root, 'tasks/deckmate.md'), renderCatalogManifest(manifest));
  await (await prepareCardOptionsPatch(root, before.optionsHash ?? '', { [child.id]: { archived: true } })).publish();
  clearReads();
  const changed = await refreshProjectCatalog(root, before, ['tasks/deckmate.md', optionsPath]);
  expect(readsOf(root, child.relative)).toBe(0);
  expect(readsOf(root, 'features/audio.md')).toBe(0);
  expect(changed).toEqual(await readProjectCatalog(root));
  expect(changed.cards.find(card => card.id === legacyId)).toMatchObject({ deckId: 'concepts', owner: 'Reviewer', priority: 'high' });
  expect(changed.cards.find(card => card.id === child.id)?.archived).toBe(true);

  await unlink(path.join(root, optionsPath));
  const reset = await refreshProjectCatalog(root, changed, [optionsPath]);
  expect(reset.cards.find(card => card.id === child.id)?.archived).toBeUndefined();
  expect(changed.cards.find(card => card.id === child.id)?.archived).toBe(true);
  expect(reset).toEqual(await readProjectCatalog(root));
});

it('uses one project read for a service edit and returns matching response, search and activity snapshots', async () => {
  const { root, child, service } = await serviceFixture();
  const before = await service.get('sandbox');
  const frozenBefore = structuredClone(before);
  const card = before.cards.find(candidate => candidate.id === child.id)!;
  clearReads();
  const after = await service.edit({ action: 'set-card-properties', cardId: card.id, sourceHash: card.sourceHash,
    manifestHash: before.manifestHash, owner: 'Review', effort: 4, priority: 'high' }, 'sandbox');
  expect(readsOf(root, 'docs/unrelated.md')).toBe(1);
  expect(readsOf(root, 'features/audio.md')).toBe(1);
  expect(after.cards.find(candidate => candidate.id === card.id)).toMatchObject({ owner: 'Reviewer', effort: 4, priority: 'high' });
  expect((await service.search('sandbox', { owner: 'Reviewer' })).map(candidate => candidate.id)).toEqual([card.id]);
  expect((await service.activity('sandbox', 'audio')).events.some(event => event.action === 'set-card-properties'
    && event.cards.some(reference => reference.id === card.id))).toBe(true);
  expect(before).toEqual(frozenBefore);

  await writeFile(child.filename, (await readFile(child.filename, 'utf8')).replace('Original native', 'External searchable'));
  service.invalidate('sandbox', child.relative);
  clearReads();
  expect((await service.search('sandbox', { text: 'External searchable' })).map(candidate => candidate.id)).toEqual([card.id]);
  expect(readsOf(root, 'docs/unrelated.md')).toBe(0);
  await unlink(child.filename);
  service.invalidate('sandbox', child.relative);
  expect(await service.search('sandbox', { text: 'External searchable' })).toEqual([]);
});

it('retains an external invalidation when indexing fails after incremental source refresh', async () => {
  const { child, service } = await serviceFixture();
  await service.get('sandbox');
  await writeFile(child.filename, (await readFile(child.filename, 'utf8')).replace('Original native', 'Recovered searchable'));
  service.invalidate('sandbox', child.relative);
  const replace = vi.spyOn(ProjectIndex.prototype, 'replace').mockImplementationOnce(() => { throw new Error('Transient index failure'); });
  try {
    await expect(service.get('sandbox')).rejects.toThrow('Transient index failure');
    expect((await service.search('sandbox', { text: 'Recovered searchable' })).map(card => card.id)).toEqual([child.id]);
    expect((await service.get('sandbox')).cards.find(card => card.id === child.id)?.title).toBe('Recovered searchable');
  } finally { replace.mockRestore(); }
});

it('joins a refresh that started while another get was awaiting housekeeping', async () => {
  const { root, child, service } = await serviceFixture();
  await service.get('sandbox');
  await writeFile(child.filename, (await readFile(child.filename, 'utf8')).replace('Original native', 'Concurrent searchable'));
  service.invalidate('sandbox', child.relative);
  let releaseHousekeeping!: () => void;
  const housekeepingGate = new Promise<void>(resolve => { releaseHousekeeping = resolve; });
  let releaseRead!: () => void;
  const readGate = new Promise<void>(resolve => { releaseRead = resolve; });
  let readStarted!: () => void;
  const readEntered = new Promise<void>(resolve => { readStarted = resolve; });
  // 2026-11-05: hold exactly the await boundary where two readers could both claim the pending paths.
  const housekeeping = vi.spyOn(service as unknown as { checkHousekeeping(): Promise<void> }, 'checkHousekeeping')
    .mockImplementationOnce(() => housekeepingGate);
  const actual = await vi.importActual<typeof filesystem>('node:fs/promises');
  let held = false;
  vi.mocked(filesystem.open).mockImplementation(async (filename, flags, mode) => {
    if (!held && path.resolve(String(filename)).toLowerCase() === child.filename.toLowerCase() && flags === 'r') {
      held = true;
      readStarted();
      await readGate;
    }
    return actual.open(filename, flags, mode);
  });
  clearReads();
  const first = service.get('sandbox');
  const second = service.get('sandbox');
  try {
    await readEntered;
    releaseHousekeeping();
    await Promise.resolve();
    releaseRead();
    const results = await Promise.all([first, second]);
    for (const result of results) expect(result.cards.find(card => card.id === child.id)?.title).toBe('Concurrent searchable');
    expect(readsOf(root, child.relative)).toBe(1);
    expect((await service.search('sandbox', { text: 'Concurrent searchable' })).map(card => card.id)).toEqual([child.id]);
  } finally {
    releaseHousekeeping();
    releaseRead();
    housekeeping.mockRestore();
    await Promise.allSettled([first, second]);
  }
});

it('keeps an external change consumed by a concurrent GET while a POST is staging its own file', async () => {
  const { root, child, service } = await serviceFixture();
  const before = await service.get('sandbox');
  const card = before.cards.find(candidate => candidate.id === child.id)!;
  const actual = await vi.importActual<typeof filesystem>('node:fs/promises');
  let releaseWrite!: () => void;
  const writeGate = new Promise<void>(resolve => { releaseWrite = resolve; });
  let staged!: () => void;
  const stageEntered = new Promise<void>(resolve => { staged = resolve; });
  let held = false;
  vi.mocked(filesystem.open).mockImplementation(async (filename, flags, mode) => {
    if (!held && flags === 'wx') {
      held = true;
      staged();
      await writeGate;
    }
    return actual.open(filename, flags, mode);
  });
  const editing = service.edit({ action: 'set-card-properties', cardId: card.id, sourceHash: card.sourceHash,
    manifestHash: before.manifestHash, owner: 'Review', effort: 2, priority: null }, 'sandbox');
  try {
    await stageEntered;
    await actual.writeFile(path.join(root, 'docs/unrelated.md'), '# External retained\nAn independent edit.\n');
    service.invalidate('sandbox', 'docs/unrelated.md');
    expect((await service.get('sandbox')).cards.find(candidate => candidate.id === 'doc:docs/unrelated.md')?.title).toBe('External retained');
    releaseWrite();
    const after = await editing;
    expect(after.cards.find(candidate => candidate.id === 'doc:docs/unrelated.md')?.title).toBe('External retained');
    expect((await service.search('sandbox', { text: 'External retained' })).map(candidate => candidate.id)).toEqual(['doc:docs/unrelated.md']);
  } finally {
    releaseWrite();
    await Promise.allSettled([editing]);
  }
});

it.each(['source', 'manifest', 'options'] as const)('returns 409 for an external %s edit after the request snapshot and before publication', async target => {
  const { root, child, service } = await serviceFixture();
  await (await prepareCardOptionsPatch(root, '', { [child.id]: { bookmarked: true } })).publish();
  const before = await service.get('sandbox');
  const card = before.cards.find(candidate => candidate.id === child.id)!;
  const filenames = { source: child.filename, manifest: path.join(root, 'tasks/deckmate.md'), options: path.join(root, optionsPath) };
  const original = await readFile(filenames[target]);
  const external = Buffer.concat([original, Buffer.from('\nExternal edit survives.\n')]);
  const actual = await vi.importActual<typeof filesystem>('node:fs/promises');
  let injected = false;
  vi.mocked(filesystem.open).mockImplementation(async (filename, flags, mode) => {
    if (flags === 'wx' && !injected) {
      injected = true;
      await actual.writeFile(filenames[target], external);
    }
    return actual.open(filename, flags, mode);
  });
  await expect(service.edit({ action: 'bulk-edit-cards', manifestHash: before.manifestHash, optionsHash: before.optionsHash ?? '',
    cards: [{ cardId: card.id, sourceHash: card.sourceHash }], change: { kind: 'options', patch: { bookmarked: false } } }, 'sandbox'))
    .rejects.toMatchObject({ status: 409 });
  expect(injected).toBe(true);
  expect(await readFile(filenames[target])).toEqual(external);
  expect((await readProjectCatalog(root)).cards.find(candidate => candidate.id === card.id)?.bookmarked).toBe(true);
  expect((await service.activity('sandbox', 'audio')).events).toEqual([]);
});

it('keeps the deck-kind guard fresh when an external card is added after snapshot capture', async () => {
  const { root, service } = await serviceFixture();
  const before = await service.get('sandbox');
  const externalId = randomUUID();
  const relative = `cards/${externalId}.md`;
  const metadata: NativeCardMetadata = { deckmate: 'card', schema: 1, id: externalId, kind: 'doc', title: 'External document',
    state: null, owner: null, parentId: null, deckId: 'audio', trackIds: [] };
  const bytes = Buffer.from('---\n' + stringify(metadata) + '---\nExternal body.\n');
  const actual = await vi.importActual<typeof filesystem>('node:fs/promises');
  let injected = false;
  vi.mocked(filesystem.writeFile).mockImplementation(async (...arguments_) => {
    const result = await actual.writeFile(...arguments_);
    if (String(arguments_[0]).includes('deckmate.md.') && String(arguments_[0]).endsWith('.tmp') && !injected) {
      injected = true;
      await actual.writeFile(path.join(root, relative), bytes);
    }
    return result;
  });
  await expect(service.edit({ action: 'set-deck-kind', deckId: 'audio', kind: 'task', manifestHash: before.manifestHash }, 'sandbox'))
    .rejects.toMatchObject({ status: 409 });
  expect(injected).toBe(true);
  expect(await readFile(path.join(root, relative))).toEqual(bytes);
  expect((await readProjectCatalog(root)).decks.find(deck => deck.id === 'audio')?.kind).toBe('mixed');
});
