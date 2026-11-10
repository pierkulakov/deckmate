import { afterEach, expect, it, vi } from 'vitest';
import * as filesystem from 'node:fs/promises';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { applyAttachmentEdit, attachmentKey, readCardAttachments } from '../server/attachments.ts';

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename), lstat: vi.fn(actual.lstat) };
});

const roots: string[] = [];
const cardId = 'card:ca1d0000-0000-4000-8000-000000000001';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhVEAAAAASUVORK5CYII=', 'base64');
const upload = { action: 'upload-attachment' as const, cardId, manifestHash: '',
  dataUrl: `data:image/png;base64,${png.toString('base64')}`, fileName: 'cover.png', addedBy: null };
const registryPath = `tasks/deckmate-assets/cards/${attachmentKey(cardId)}/attachments.md`;

afterEach(async () => {
  const actual = await vi.importActual<typeof filesystem>('node:fs/promises');
  vi.mocked(filesystem.rename).mockReset().mockImplementation(actual.rename);
  vi.mocked(filesystem.lstat).mockReset().mockImplementation(actual.lstat);
  for (const root of roots.splice(0)) {
    if (path.dirname(root) !== path.resolve(tmpdir()) || !path.basename(root).startsWith('deckmate-publish-failure-')) throw new Error('Unexpected fixture cleanup target');
    await rm(root, { recursive: true, force: true });
  }
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'deckmate-publish-failure-'));
  roots.push(root);
  return { root, filename: path.join(root, registryPath) };
}

async function failRegistryPublication(filename: string, stage: 'before' | 'after') {
  const actual = await vi.importActual<typeof filesystem>('node:fs/promises');
  const failure = Object.assign(new Error('Injected registry publication failure'), { injected: false });
  vi.mocked(filesystem.rename).mockImplementation(async (source, destination) => {
    if (String(destination) !== filename) return actual.rename(source, destination);
    if (stage === 'before') { failure.injected = true; throw failure; }
    await actual.rename(source, destination);
    // 2026-11-09: arm the check only after the real rename, so the registry is already durable when it fails.
    vi.mocked(filesystem.lstat).mockImplementation((target, options) => {
      if (String(target) === filename) {
        failure.injected = true;
        vi.mocked(filesystem.lstat).mockImplementation(actual.lstat);
        return Promise.reject(failure);
      }
      return actual.lstat(target, options);
    });
  });
  return failure;
}

it.each([false, true])('keeps the uploaded file when the published registry check fails (existing registry: %s)', async existing => {
  const { root, filename } = await fixture();
  if (existing) await applyAttachmentEdit(root, { ...upload, attachmentsHash: '' });
  const before = await readCardAttachments(root, cardId);
  const failure = await failRegistryPublication(filename, 'after');

  await expect(applyAttachmentEdit(root, { ...upload, attachmentsHash: before.hash }))
    .rejects.toMatchObject({ message: failure.message, saved: true });
  expect(failure.injected).toBe(true);

  const after = await readCardAttachments(root, cardId);
  expect(after.files).toHaveLength(before.files.length + 1);
  expect(after.hash).not.toBe(before.hash);
  expect(after.warnings).toEqual([]);
  const registry = await readFile(filename, 'utf8');
  for (const entry of after.files) {
    expect(registry).toContain(entry.file);
    expect(await readFile(path.join(root, entry.file))).toEqual(png);
  }
  expect((await readdir(path.dirname(filename))).some(name => name.endsWith('.tmp'))).toBe(false);
});

it('removes only the new upload when registry publication fails before rename', async () => {
  const { root, filename } = await fixture();
  await applyAttachmentEdit(root, { ...upload, attachmentsHash: '' });
  const before = await readCardAttachments(root, cardId);
  const registry = await readFile(filename);
  const failure = await failRegistryPublication(filename, 'before');

  await expect(applyAttachmentEdit(root, { ...upload, attachmentsHash: before.hash })).rejects.toBe(failure);
  expect(failure.injected).toBe(true);

  expect(failure).not.toHaveProperty('saved');
  expect(await readFile(filename)).toEqual(registry);
  expect(await readFile(path.join(root, before.files[0].file))).toEqual(png);
  expect((await readdir(path.dirname(filename))).sort()).toEqual(['attachments.md', path.basename(before.files[0].file)].sort());
});

it.each(['before', 'after'] as const)('does not delete an attachment when registry removal fails %s rename', async stage => {
  const { root, filename } = await fixture();
  await applyAttachmentEdit(root, { ...upload, attachmentsHash: '' });
  const before = await readCardAttachments(root, cardId);
  const registry = await readFile(filename);
  const failure = await failRegistryPublication(filename, stage);
  const entry = before.files[0];

  await expect(applyAttachmentEdit(root, { action: 'remove-attachment', manifestHash: '', cardId,
    attachmentsHash: before.hash, file: entry.file })).rejects.toBe(failure);
  expect(failure.injected).toBe(true);

  expect(await readFile(path.join(root, entry.file))).toEqual(png);
  const after = await readCardAttachments(root, cardId);
  expect(after.warnings).toEqual([]);
  if (stage === 'before') {
    expect(failure).not.toHaveProperty('saved');
    expect(await readFile(filename)).toEqual(registry);
    expect(after.files).toEqual(before.files);
  } else {
    expect(failure).toHaveProperty('saved', true);
    expect(after.files).toEqual([]);
    expect(await readFile(filename, 'utf8')).not.toContain(entry.file);
  }
});
