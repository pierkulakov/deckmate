import { afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { editProjectCatalog, readManifest } from '../server/catalog.ts';

const race = vi.hoisted(() => ({
  beforeTemporary: null as null | (() => Promise<void>),
  deniedRenames: 0,
  onDeniedRename: null as null | (() => Promise<void>),
}));
vi.mock('node:fs/promises', async importOriginal => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  async function beforeTemporary(filename: unknown) {
    if (typeof filename !== 'string' || !filename.endsWith('.tmp') || !race.beforeTemporary) return;
    const run = race.beforeTemporary;
    race.beforeTemporary = null;
    await run();
  }
  return {
    ...original,
    async open(...args: Parameters<typeof original.open>) {
      await beforeTemporary(args[0]);
      return original.open(...args);
    },
    async writeFile(...args: Parameters<typeof original.writeFile>) {
      await beforeTemporary(args[0]);
      return original.writeFile(...args);
    },
    async rename(...args: Parameters<typeof original.rename>) {
      if (race.deniedRenames > 0 && String(args[1]).endsWith('deckmate.md')) {
        race.deniedRenames -= 1;
        await race.onDeniedRename?.();
        throw Object.assign(new Error('Injected busy manifest'), { code: 'EPERM' });
      }
      return original.rename(...args);
    },
  };
});

const roots: string[] = [];
afterEach(async () => {
  race.beforeTemporary = null;
  race.deniedRenames = 0;
  race.onDeniedRename = null;
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

const originalText = '\uFEFF' + [
  '---', '# Preserve the header.', 'schema: 1',
  'spaces: [{id: work, title: Work, kind: custom, icon: ""}] # Preserve the space comment.',
  'decks: [] # Preserve decks.', 'tracks: []', 'membership: []',
  '---', '# Тело манифеста', 'Unchanged body.  ', '',
].join('\r\n');

async function fixture(existing = true, legacy = false) {
  const base = await mkdtemp(path.join(tmpdir(), 'deckmate-manifest-guard-'));
  roots.push(base);
  const root = path.join(base, 'project');
  const outside = path.join(base, 'outside');
  await mkdir(root);
  await mkdir(outside);
  const tasks = path.join(root, 'tasks');
  const basename = legacy ? 'freetion.md' : 'deckmate.md';
  const filename = path.join(tasks, basename);
  if (existing) {
    await mkdir(tasks);
    await writeFile(filename, originalText);
  }
  return { base, root, outside, tasks, basename, filename };
}

async function hash(root: string) {
  const { bytes } = await readManifest(root);
  if (!bytes) return '';
  return createHash('sha256').update(bytes).digest('hex');
}

const renameSpace = { action: 'update-space' as const, spaceId: 'work', title: 'Next', kind: 'custom' as const, icon: '' };

it.each([false, true])('patches only the changed scalar, preserving BOM, CRLF and the manifest path (legacy=%s)', async legacy => {
  const { root, filename, tasks, basename } = await fixture(true, legacy);
  await editProjectCatalog(root, {
    ...renameSpace, manifestHash: await hash(root),
  });
  expect(await readFile(filename)).toEqual(Buffer.from(originalText.replace('title: Work', 'title: Next')));
  expect(await readdir(tasks)).toEqual([basename]);
});

it('rejects stale manifest hashes without changing bytes', async () => {
  const { root, filename, tasks } = await fixture();
  const manifestHash = await hash(root);
  const external = Buffer.from(originalText + 'External edit.\r\n');
  await writeFile(filename, external);
  await expect(editProjectCatalog(root, { ...renameSpace, manifestHash }))
    .rejects.toThrow('CATALOG_CONFLICT');
  expect(await readFile(filename)).toEqual(external);
  expect(await readdir(tasks)).toEqual(['deckmate.md']);
});

it('rechecks the hash after preparing the temporary manifest', async () => {
  const { root, filename, tasks } = await fixture();
  const manifestHash = await hash(root);
  const external = Buffer.from(originalText + 'Concurrent edit.\r\n');
  race.beforeTemporary = () => writeFile(filename, external);
  await expect(editProjectCatalog(root, { ...renameSpace, manifestHash }))
    .rejects.toThrow('CATALOG_CONFLICT');
  expect(race.beforeTemporary).toBeNull();
  expect(await readFile(filename)).toEqual(external);
  expect(await readdir(tasks)).toEqual(['deckmate.md']);
});

it('creates the first manifest through guarded publication without overwriting a concurrent creator', async () => {
  const { root, filename, tasks } = await fixture(false);
  race.beforeTemporary = () => writeFile(filename, originalText);
  await expect(editProjectCatalog(root, { action: 'create-space', title: 'Next', manifestHash: '' }))
    .rejects.toThrow('CATALOG_CONFLICT');
  expect(race.beforeTemporary).toBeNull();
  expect(await readFile(filename)).toEqual(Buffer.from(originalText));
  expect(await readdir(tasks)).toEqual(['deckmate.md']);
});

it('rejects deleting a Space with a stale hash and rechecks for concurrent Deck references before publication', async () => {
  const { root, filename, tasks } = await fixture();
  const manifestHash = await hash(root);
  const edit = { action: 'delete-space' as const, spaceId: 'work', manifestHash };
  await expect(editProjectCatalog(root, { ...edit, manifestHash: 'stale' })).rejects.toThrow('CATALOG_CONFLICT');
  expect(await readFile(filename)).toEqual(Buffer.from(originalText));
  const external = originalText.replace('decks: []', 'decks: [{id: concurrent, title: New, spaceId: work, kind: task, icon: layers, color: "#123456", description: ""}]');
  race.beforeTemporary = () => writeFile(filename, external);
  await expect(editProjectCatalog(root, edit)).rejects.toThrow('CATALOG_CONFLICT');
  expect(race.beforeTemporary).toBeNull();
  expect(await readFile(filename)).toEqual(Buffer.from(external));
  expect(await readdir(tasks)).toEqual(['deckmate.md']);
});

it('rechecks a supplied optionsHash while publishing a Space deletion', async () => {
  const { root, filename, tasks } = await fixture();
  race.beforeTemporary = () => writeFile(path.join(tasks, 'deckmate-card-options.md'), '---\r\nschema: 1\r\ncards: {}\r\n---\r\n');
  await expect(editProjectCatalog(root, { action: 'delete-space', spaceId: 'work', optionsHash: '', manifestHash: await hash(root) }))
    .rejects.toThrow('CARD_OPTIONS_CONFLICT');
  expect(race.beforeTemporary).toBeNull();
  expect(await readFile(filename)).toEqual(Buffer.from(originalText));
  expect((await readdir(tasks)).sort()).toEqual(['deckmate-card-options.md', 'deckmate.md']);
});

it('creates tasks and the first English manifest when the project is empty', async () => {
  const { root, tasks } = await fixture(false);
  await editProjectCatalog(root, { action: 'create-space', title: 'Next', manifestHash: '' });
  expect((await readManifest(root)).manifest).toMatchObject({ formatLanguage: 'en', spaces: [{ title: 'Next' }] });
  expect(await readdir(tasks)).toEqual(['deckmate.md']);
});

it.skipIf(process.platform !== 'win32')('retries a busy Windows manifest through the guarded publisher', async () => {
  const { root, filename, tasks } = await fixture();
  race.deniedRenames = 1;
  await editProjectCatalog(root, { ...renameSpace, manifestHash: await hash(root) });
  expect(race.deniedRenames).toBe(0);
  expect(await readFile(filename)).toEqual(Buffer.from(originalText.replace('title: Work', 'title: Next')));
  expect(await readdir(tasks)).toEqual(['deckmate.md']);
});

it.skipIf(process.platform !== 'win32')('rechecks the manifest hash after a Windows rename retry', async () => {
  const { root, filename, tasks } = await fixture();
  const manifestHash = await hash(root);
  const external = Buffer.from(originalText + 'Changed during retry.\r\n');
  race.deniedRenames = 1;
  race.onDeniedRename = () => writeFile(filename, external);
  await expect(editProjectCatalog(root, { ...renameSpace, manifestHash })).rejects.toThrow('CATALOG_CONFLICT');
  expect(race.deniedRenames).toBe(0);
  expect(await readFile(filename)).toEqual(external);
  expect(await readdir(tasks)).toEqual(['deckmate.md']);
});

for (const first of [false, true]) it(`rejects a tasks junction swapped between validation and temporary-file writing (first manifest=${first})`, async context => {
  const { base, root, outside, tasks, filename } = await fixture(!first);
  const prepared = path.join(base, 'prepared-junction');
  try { await symlink(outside, prepared, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!['EPERM', 'EACCES', 'ENOSYS', 'ENOTSUP'].includes(code ?? '')) throw error;
    context.skip(`Directory links are unavailable on ${process.platform}: ${code}`);
    return;
  }
  await writeFile(path.join(outside, 'deckmate.md'), originalText);
  const manifestHash = await hash(root);
  const savedTasks = path.join(root, 'tasks-original');
  race.beforeTemporary = async () => {
    // 2026-11-09: staging the junction avoids exposing a half-created Windows reparse point to readers.
    await rename(tasks, savedTasks);
    await rename(prepared, tasks);
  };
  const edit = first
    ? { action: 'create-space' as const, title: 'Next', manifestHash }
    : { ...renameSpace, manifestHash };
  await expect(editProjectCatalog(root, edit)).rejects.toThrow();
  expect(race.beforeTemporary).toBeNull();
  expect(await readFile(path.join(outside, 'deckmate.md'))).toEqual(Buffer.from(originalText));
  if (!first) expect(await readFile(path.join(savedTasks, path.basename(filename)))).toEqual(Buffer.from(originalText));
  // 2026-11-09: a swap just before open can leave an empty file; guarded cleanup must not follow the junction.
  for (const name of await readdir(outside)) {
    if (name !== 'deckmate.md') expect(await readFile(path.join(outside, name))).toHaveLength(0);
  }
});
