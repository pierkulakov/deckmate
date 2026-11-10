import { afterEach, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { stringify } from 'yaml';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../server/app.ts';
import { assertSandboxBranch } from '../server/config.ts';
import { resolveDataPath } from '../server/data-paths.ts';
import { canonicalDataPath, legacyDataPath } from '../src/brand-compat.ts';
import { createManagedMarkdown, editNativeCardContent, readManagedMarkdown, readNativeCard, readProjectMarkdown, replaceProjectMarkdown } from '../server/native-cards.ts';
import { emptyManifest, readProjectCatalog, refreshProjectCatalog, renderCatalogManifest } from '../server/catalog.ts';
import { appendActivity, readActivity, readCardActivity } from '../server/activity.ts';
import type { DeckActivityEvent } from '../src/activity-contracts.ts';

const execute = promisify(execFile);
const temporaryRoots: string[] = [];
const applications: FastifyInstance[] = [];
const registryNames = ['deckmate.md', 'deckmate-card-options.md', 'deckmate-tags.md', 'deckmate-runs.md', 'deckmate-milestones.md', 'deckmate-notifications.md'];
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const markdown = (metadata: unknown, body = '# Registry\n') => Buffer.from('---\n' + stringify(metadata) + '---\n' + body);

afterEach(async () => {
  for (const application of applications.splice(0)) await application.close();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const directory of temporaryRoots.splice(0)) {
    const target = path.resolve(directory);
    if (path.dirname(target) !== path.resolve(tmpdir()) || !path.basename(target).startsWith('deckmate-rename-')) {
      throw new Error('Unsafe rename fixture cleanup target');
    }
    await rm(target, { recursive: true, force: true });
  }
});

async function fixture() {
  const base = await mkdtemp(path.join(tmpdir(), 'deckmate-rename-'));
  temporaryRoots.push(base);
  const root = path.join(base, 'project');
  const outside = path.join(base, 'outside');
  await mkdir(root);
  await mkdir(outside);
  await mkdir(path.join(root, 'tasks'));
  return { base, root, outside };
}

async function catalogFixture() {
  const context = await fixture();
  await mkdir(path.join(context.root, 'features'));
  await writeFile(path.join(context.root, 'features/audio.md'), '# Audio\n## 1 — Sound\n### 1.0 First sound (план)\nOriginal body.\n');
  const manifest = emptyManifest();
  manifest.spaces = [{ id: 'work', title: 'Work' }];
  manifest.decks = [{ id: 'audio', spaceId: 'work', title: 'Audio', kind: 'task', description: '', icon: 'box', color: '#123456' }];
  manifest.members = [{ id: 'reviewer', label: 'Reviewer', kind: 'human', aliases: [] }];
  manifest.membership = [{ card: 'task:features/audio.md#1.0', deck: 'audio' }];
  await writeFile(path.join(context.root, 'tasks/freetion.md'), renderCatalogManifest(manifest));
  return { ...context, manifest };
}

function stubLegacyEnvironment(values: Record<string, string>): void {
  // 2026-11-10: tool flags also disable the legacy set; track both names so launcher adoption is undone after each test.
  const names = new Set(Object.keys(process.env).filter(name => /^(?:DECKMATE|FREETION)_/u.test(name)));
  for (const suffix of Object.keys(values)) {
    names.add('DECKMATE_' + suffix);
    names.add('FREETION_' + suffix);
  }
  for (const name of names) vi.stubEnv(name, undefined);
  for (const [suffix, value] of Object.entries(values)) vi.stubEnv('FREETION_' + suffix, value);
}

it('loads old environment names with one warning per process and gives all new names priority', async () => {
  const { root, outside } = await fixture();
  await execute('git', ['init', '-b', 'freetion/sandbox', root], { windowsHide: true });
  stubLegacyEnvironment({ DATA: outside, WRITE: root, PORT: '4373', PROJECT_NAME: 'Old project', PYTHON: 'old-python' });
  vi.resetModules();
  const { loadConfig } = await import('../server/config.ts');
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  expect(await loadConfig()).toMatchObject({ editMode: 'sandbox', dataRoot: outside, writeRoot: root, port: 4373, projectName: 'Old project', python: 'old-python' });
  await loadConfig();
  expect(warning).toHaveBeenCalledTimes(1);
  expect(warning.mock.calls[0][0]).toContain('FREETION_*');
  vi.stubEnv('DECKMATE_DATA', root);
  vi.stubEnv('DECKMATE_WRITE', '');
  vi.stubEnv('DECKMATE_PORT', '4374');
  vi.stubEnv('DECKMATE_PROJECT_NAME', 'New project');
  vi.stubEnv('DECKMATE_PYTHON', 'new-python');
  expect(await loadConfig()).toMatchObject({ editMode: 'direct', dataRoot: root, writeRoot: root, port: 4374, projectName: 'New project', python: 'new-python' });
  // 2026-11-05: a lone new name switches the old set off, so DECKMATE_DATA never pairs with an old FREETION_WRITE.
  for (const suffix of ['WRITE', 'PORT', 'PROJECT_NAME', 'PYTHON']) vi.stubEnv('DECKMATE_' + suffix, undefined);
  vi.stubEnv('DECKMATE_DATA', outside);
  expect(await loadConfig()).toMatchObject({ editMode: 'direct', dataRoot: outside, writeRoot: outside });
  expect(warning).toHaveBeenCalledTimes(2);
  expect(warning.mock.calls[1][0]).toContain('ignored');
});

// 2026-11-06: the launcher writes DECKMATE_DATA itself; a legacy FREETION_DATA/FREETION_WRITE pair must still open the
// sandbox, and an explicit --data for another folder must not inherit the old sandbox.
it('keeps a legacy sandbox pair when the launcher writes DECKMATE_DATA, but never pairs it with another folder', async () => {
  const { root, outside } = await fixture();
  await execute('git', ['init', '-b', 'freetion/sandbox', root], { windowsHide: true });
  const reset = () => stubLegacyEnvironment({ DATA: outside, WRITE: root });
  reset();
  vi.resetModules();
  const { loadConfig } = await import('../server/config.ts');
  const { adoptLegacyEnvironment } = await import('../server/environment.ts');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  adoptLegacyEnvironment(undefined);
  process.env.DECKMATE_DATA = outside;
  expect(await loadConfig()).toMatchObject({ editMode: 'sandbox', dataRoot: outside, writeRoot: root });
  reset();
  adoptLegacyEnvironment(outside);
  process.env.DECKMATE_DATA = outside;
  expect(await loadConfig()).toMatchObject({ editMode: 'sandbox', writeRoot: root });
  reset();
  adoptLegacyEnvironment(root + '-elsewhere');
  expect(process.env.DECKMATE_WRITE).toBeUndefined();
  process.env.DECKMATE_DATA = outside;
  expect(await loadConfig()).toMatchObject({ editMode: 'direct', writeRoot: outside });
});

it('accepts both sandbox branch names and rejects unrelated branches', async () => {
  const { root } = await fixture();
  await execute('git', ['init', '-b', 'freetion/sandbox', root], { windowsHide: true });
  await expect(assertSandboxBranch(root)).resolves.toBeUndefined();
  await execute('git', ['-C', root, 'symbolic-ref', 'HEAD', 'refs/heads/deckmate/sandbox'], { windowsHide: true });
  await expect(assertSandboxBranch(root)).resolves.toBeUndefined();
  await execute('git', ['-C', root, 'symbolic-ref', 'HEAD', 'refs/heads/main'], { windowsHide: true });
  await expect(assertSandboxBranch(root)).rejects.toThrow('sandbox');
});

it.each(registryNames)('reads and updates the existing old %s, then prefers its new counterpart', async name => {
  const { root } = await fixture();
  const current = 'tasks/' + name;
  const legacy = legacyDataPath(current);
  const original = markdown({ schema: 1, preserved: 'old' });
  await writeFile(path.join(root, legacy), original);
  expect(await resolveDataPath(root, current)).toBe(legacy);
  expect(await readProjectMarkdown(root, current)).toEqual(original);
  expect((await readManagedMarkdown(root, current))?.metadata.preserved).toBe('old');
  const changed = markdown({ schema: 1, preserved: 'changed' });
  await replaceProjectMarkdown(root, current, hash(original), changed);
  expect(await readFile(path.join(root, legacy))).toEqual(changed);
  expect(await readdir(path.join(root, 'tasks'))).toEqual([path.basename(legacy)]);
  expect(await createManagedMarkdown(root, current, { schema: 1 }, 'duplicate')).toBe(false);

  const modern = markdown({ schema: 1, preserved: 'new' });
  await writeFile(path.join(root, current), modern);
  expect(await resolveDataPath(root, legacy)).toBe(current);
  expect(await readProjectMarkdown(root, legacy)).toEqual(modern);
  const modernChanged = markdown({ schema: 1, preserved: 'new changed' });
  await replaceProjectMarkdown(root, current, hash(modern), modernChanged);
  expect(await readFile(path.join(root, current))).toEqual(modernChanged);
  expect(await readFile(path.join(root, legacy))).toEqual(changed);
});

it('creates all six registry types under new names in an empty project', async () => {
  const { root } = await fixture();
  for (const name of registryNames) {
    const current = 'tasks/' + name;
    expect(await resolveDataPath(root, current)).toBe(current);
    expect(await createManagedMarkdown(root, current, { schema: 1, registry: name }, '# New\n')).toBe(true);
    expect((await readManagedMarkdown(root, current))?.metadata.registry).toBe(name);
  }
  expect((await readdir(path.join(root, 'tasks'))).sort()).toEqual([...registryNames].sort());
});

it('edits a legacy native card while preserving its marker, comments, BOM, CRLF and body', async () => {
  const { root } = await fixture();
  await mkdir(path.join(root, 'cards'));
  const id = randomUUID();
  const metadata = { freetion: 'card', schema: 1, id, kind: 'task', title: 'Original', state: 'план', owner: null, deckId: null, trackIds: [], parentId: null };
  const original = Buffer.from('\uFEFF---\r\n# Keep this comment\r\n' + stringify(metadata).replaceAll('\n', '\r\n') + '---\r\nBody stays exactly the same.\r\n');
  const filename = path.join(root, 'cards', id + '.md');
  await writeFile(filename, original);
  const before = (await readNativeCard(root, 'card:' + id))!;
  expect(before.metadata.freetion).toBe('card');
  expect(before.metadata.deckmate).toBeUndefined();
  await editNativeCardContent(root, before.card.id, before.fileHash, { title: 'Changed' });
  const actual = await readFile(filename);
  expect(actual).toEqual(Buffer.from(original.toString('utf8').replace('title: Original', 'title: "Changed"')));
  expect((await readNativeCard(root, before.card.id))?.metadata).toEqual({ ...metadata, title: 'Changed' });
});

function eventAt(second: number): DeckActivityEvent {
  return { schema: 1, id: randomUUID(), at: new Date(Date.UTC(2026, 10, 5, 12, 0, second)).toISOString(),
    actor: 'Deckmate', action: 'update-card-content', summary: 'Changed card', cards: [{ id: 'card:sample', title: 'Sample' }], deckIds: ['audio'], details: ['Body changed'] };
}

it('normalizes old actors without rewriting journals and appends to the existing directory with stable pagination', async () => {
  const { root } = await fixture();
  const legacyDirectory = path.join(root, 'tasks/freetion-activity');
  await mkdir(legacyDirectory);
  const originals = new Map<string, Buffer>();
  for (const second of [1, 2]) {
    const event = { ...eventAt(second), actor: 'Freetion' };
    const filename = path.join(legacyDirectory, event.at.replace(/[-:.]/gu, '') + '-' + event.id + '.md');
    const bytes = markdown(event, 'Historical author: Freetion\n');
    originals.set(filename, bytes);
    await writeFile(filename, bytes);
  }
  const first = await readActivity(root, 'audio', 1);
  expect(first.events[0]).toMatchObject({ actor: 'Deckmate', at: '2026-11-05T12:00:02.000Z' });
  expect(first.nextCursor).toBeTruthy();
  const next = await readActivity(root, 'audio', 1, first.nextCursor!);
  expect(next.events[0]).toMatchObject({ actor: 'Deckmate', at: '2026-11-05T12:00:01.000Z' });
  expect(next.nextCursor).toBeNull();
  expect((await readCardActivity(root, 'card:sample')).created?.actor).toBe('Deckmate');
  const appended = eventAt(3);
  await appendActivity(root, appended, 'en');
  expect((await readActivity(root, 'audio')).events.map(event => event.actor)).toEqual(['Deckmate', 'Deckmate', 'Deckmate']);
  expect(await readdir(legacyDirectory)).toHaveLength(3);
  expect(await readdir(path.join(root, 'tasks'))).toEqual(['freetion-activity']);
  for (const [filename, bytes] of originals) expect(await readFile(filename)).toEqual(bytes);
  const fresh = await fixture();
  await appendActivity(fresh.root, eventAt(4), 'en');
  expect(await readdir(path.join(fresh.root, 'tasks'))).toEqual(['deckmate-activity']);
});

it('refreshes old manifest, options and tag paths and notices a new manifest appearing or disappearing', async () => {
  const { root, manifest } = await catalogFixture();
  const before = await readProjectCatalog(root);
  manifest.decks[0].title = 'Changed audio';
  await writeFile(path.join(root, 'tasks/freetion.md'), renderCatalogManifest(manifest));
  await writeFile(path.join(root, 'tasks/freetion-card-options.md'), markdown({ schema: 1, cards: { 'task:features/audio.md#1.0': { archived: true } } }));
  await writeFile(path.join(root, 'tasks/freetion-tags.md'), markdown({ schema: 1, tags: { sound: { color: '#123456' } } }));
  const changed = await refreshProjectCatalog(root, before, ['tasks/freetion.md', 'tasks/freetion-card-options.md', 'tasks/freetion-tags.md']);
  expect(changed.decks[0].title).toBe('Changed audio');
  expect(changed.cards.find(card => card.id === 'task:features/audio.md#1.0')?.archived).toBe(true);
  expect(changed.projectTags?.map(tag => tag.name)).toEqual(['sound']);
  expect(changed.documents.some(document => document.path.startsWith('tasks/freetion'))).toBe(false);
  expect(changed).toEqual(await readProjectCatalog(root));
  manifest.decks[0].title = 'New manifest wins';
  await writeFile(path.join(root, 'tasks/deckmate.md'), renderCatalogManifest(manifest));
  const modern = await refreshProjectCatalog(root, changed, ['tasks/deckmate.md']);
  expect(modern.decks[0].title).toBe('New manifest wins');
  await unlink(path.join(root, 'tasks/deckmate.md'));
  expect((await refreshProjectCatalog(root, modern, ['tasks/deckmate.md'])).decks[0].title).toBe('Changed audio');
});

it('never aliases ordinary documents whose names contain the old brand during reads or cache refreshes', async () => {
  const { root } = await fixture();
  const oldDocument = 'tasks/freetion-notes.md';
  const newDocument = 'tasks/deckmate-notes.md';
  await writeFile(path.join(root, oldDocument), '# Old notes\n');
  await writeFile(path.join(root, newDocument), '# New notes\n');
  expect(canonicalDataPath(oldDocument)).toBe(oldDocument);
  expect(legacyDataPath(newDocument)).toBe(newDocument);
  expect((await readProjectMarkdown(root, oldDocument)).toString()).toBe('# Old notes\n');
  const before = await readProjectCatalog(root);
  await writeFile(path.join(root, oldDocument), '# Changed old notes\n');
  const changed = await refreshProjectCatalog(root, before, [oldDocument]);
  expect(changed.cards.find(card => card.id === 'doc:' + oldDocument)?.title).toBe('Changed old notes');
  expect(changed.cards.find(card => card.id === 'doc:' + newDocument)?.title).toBe('New notes');
  await unlink(path.join(root, oldDocument));
  const removed = await refreshProjectCatalog(root, changed, [oldDocument]);
  expect(removed.cards.some(card => card.id === 'doc:' + oldDocument)).toBe(false);
  expect(removed.cards.some(card => card.id === 'doc:' + newDocument)).toBe(true);
});

it('rejects linked new registries instead of falling back and refuses a linked legacy activity directory', async () => {
  const { root, outside } = await fixture();
  const sentinel = path.join(outside, 'sentinel.md');
  await writeFile(sentinel, 'untouched');
  const original = markdown({ schema: 1, cards: {} });
  await writeFile(path.join(root, 'tasks/freetion-card-options.md'), original);
  // 2026-11-05: a junction at a file path tests refusal without Windows file-symlink privileges.
  await symlink(outside, path.join(root, 'tasks/deckmate-card-options.md'), 'junction');
  await expect(readProjectMarkdown(root, 'tasks/deckmate-card-options.md')).rejects.toThrow();
  await expect(replaceProjectMarkdown(root, 'tasks/deckmate-card-options.md', hash(original), markdown({ schema: 1, cards: { changed: {} } }))).rejects.toThrow();
  expect(await readFile(path.join(root, 'tasks/freetion-card-options.md'))).toEqual(original);
  await symlink(outside, path.join(root, 'tasks/freetion-activity'), 'junction');
  await expect(appendActivity(root, eventAt(5), 'en')).rejects.toThrow();
  await expect(readActivity(root, 'audio')).rejects.toThrow();
  expect(await readFile(sentinel, 'utf8')).toBe('untouched');
  expect(await readdir(outside)).toEqual(['sentinel.md']);
});

it('uses new HTTP token and actor headers to create a card over an old manifest and sandbox branch', async () => {
  const { root } = await catalogFixture();
  await mkdir(path.join(root, 'Tools'));
  await writeFile(path.join(root, 'Tools/board.py'), '# Startup fixture: no writes.\n');
  await writeFile(path.join(root, 'tasks/iterations.md'), '## Итерация 1 — Rename check\n');
  await execute('git', ['init', '-b', 'freetion/sandbox', root], { windowsHide: true });
  const port = 44329;
  const application = await createApp({ editMode: 'sandbox', dataRoot: root, writeRoot: root, projectName: 'Rename test', port, python: 'python' });
  applications.push(application);
  const headers = { host: '127.0.0.1:' + port };
  expect((await application.inject({ url: '/api/health', headers })).json().app).toBe('Deckmate');
  const snapshot = (await application.inject({ url: '/api/snapshot?source=sandbox', headers })).json();
  const catalog = (await application.inject({ url: '/api/catalog?source=sandbox', headers })).json();
  expect(catalog.cards.some((card: { id: string }) => card.id === 'task:features/audio.md#1.0')).toBe(true);
  const cardId = 'card:' + randomUUID();
  const payload = { source: 'sandbox', action: 'create-card', manifestHash: catalog.manifestHash, cardId, kind: 'task', title: 'Rename compatibility', markdown: 'Created through new headers.\n', deckId: 'audio', parentId: null, trackIds: [], owner: null, effort: null, priority: null };
  expect((await application.inject({ method: 'POST', url: '/api/catalog', headers: { ...headers, 'x-freetion-token': snapshot.token }, payload })).statusCode).toBe(403);
  const created = await application.inject({ method: 'POST', url: '/api/catalog', headers: { ...headers, 'x-deckmate-token': snapshot.token, 'x-deckmate-actor': 'reviewer' }, payload });
  expect(created.statusCode).toBe(200);
  expect(created.json().cards.some((card: { id: string }) => card.id === cardId)).toBe(true);
  expect((await readNativeCard(root, cardId))?.metadata.deckmate).toBe('card');
  expect((await readActivity(root, 'audio')).events[0]).toMatchObject({ actor: 'Deckmate', actorMemberId: 'reviewer' });
  expect(await readdir(path.join(root, 'tasks'))).not.toContain('deckmate.md');
}, 15000);
