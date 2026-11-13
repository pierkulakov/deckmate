import { afterEach, expect, it, vi } from 'vitest';
import * as filesystem from 'node:fs/promises';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { applyAttachmentEdit, attachmentKey, decodeAttachment, maximumAttachmentBytes, readCardAttachments } from '../server/attachments.ts';
import { assertCatalogCoverFile, decodeCatalogCover, storeCatalogCover } from '../server/catalog-covers.ts';
import { createManagedBytes, readManagedMarkdown } from '../server/native-cards.ts';
import { checkDirectories, checkGuardedFile, guardedDirectory, removeGuardedFile, renameChecked, type DirectoryGuard } from '../server/guarded-files.ts';

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof filesystem>();
  return { ...actual, open: vi.fn(actual.open), unlink: vi.fn(actual.unlink), lstat: vi.fn(actual.lstat), mkdir: vi.fn(actual.mkdir), rename: vi.fn(actual.rename) };
});

const roots: string[] = [];
const cardId = 'card:ca1d0000-0000-4000-8000-000000000001';
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
const writeFailure = new Error('Injected write failure');
const closeFailure = new Error('Injected close failure');
const cleanupFailure = new Error('Injected cleanup failure');

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'deckmate-guarded-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  const actual = await vi.importActual<typeof filesystem>('node:fs/promises');
  vi.mocked(filesystem.open).mockReset().mockImplementation(actual.open);
  vi.mocked(filesystem.unlink).mockReset().mockImplementation(actual.unlink);
  vi.mocked(filesystem.lstat).mockReset().mockImplementation(actual.lstat);
  vi.mocked(filesystem.mkdir).mockReset().mockImplementation(actual.mkdir);
  vi.mocked(filesystem.rename).mockReset().mockImplementation(actual.rename);
  for (const root of roots.splice(0)) {
    if (path.dirname(root) !== path.resolve(tmpdir()) || !path.basename(root).startsWith('deckmate-guarded-')) throw new Error('Unexpected fixture cleanup target');
    await rm(root, { recursive: true, force: true });
  }
});

it('runs caller checks before atomic replacement and leaves the temporary file untouched on conflict', async () => {
  const root = await fixture();
  const target = path.join(root, 'target');
  const temporary = path.join(root, 'temporary');
  await writeFile(target, 'Original');
  await writeFile(temporary, 'Replacement');
  const conflict = new Error('Changed source');
  const beforeRename = vi.fn().mockRejectedValueOnce(conflict).mockResolvedValue(undefined);
  const attempts = vi.mocked(filesystem.rename);
  await expect(renameChecked(temporary, target, { beforeRename })).rejects.toBe(conflict);
  expect(attempts).not.toHaveBeenCalled();
  expect(await readFile(target, 'utf8')).toBe('Original');
  expect(await readFile(temporary, 'utf8')).toBe('Replacement');
  await renameChecked(temporary, target, { beforeRename });
  expect(beforeRename).toHaveBeenCalledTimes(2);
  expect(attempts).toHaveBeenCalledExactlyOnceWith(temporary, target);
  expect(await readFile(target, 'utf8')).toBe('Replacement');
  await expect(readFile(temporary)).rejects.toMatchObject({ code: 'ENOENT' });
});

it.each([
  { code: 'EPERM', retry: false }, { code: 'EIO', retry: true },
  { code: 'EPERM', retry: true }, { code: 'EBUSY', retry: true }, { code: 'EACCES', retry: true },
])('keeps rename retries bounded and opt-in for $code, retry=$retry', async ({ code, retry }) => {
  const failure = Object.assign(new Error(code), { code });
  const attempts = vi.mocked(filesystem.rename).mockRejectedValue(failure);
  const beforeRename = vi.fn().mockResolvedValue(undefined);
  await expect(renameChecked('temporary', 'target', { beforeRename, retryWindowsRename: retry })).rejects.toBe(failure);
  const count = retry && process.platform === 'win32' && code !== 'EIO' ? 5 : 1;
  expect(attempts).toHaveBeenCalledTimes(count);
  expect(beforeRename).toHaveBeenCalledTimes(count);
});

it('does not retry a conflict discovered after a transient rename failure', async () => {
  const sharing = Object.assign(new Error('Sharing violation'), { code: 'EPERM' });
  const conflict = new Error('Changed source');
  const attempts = vi.mocked(filesystem.rename).mockRejectedValue(sharing);
  const beforeRename = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValue(conflict);
  await expect(renameChecked('temporary', 'target', { beforeRename, retryWindowsRename: true }))
    .rejects.toBe(process.platform === 'win32' ? conflict : sharing);
  expect(attempts).toHaveBeenCalledTimes(1);
  expect(beforeRename).toHaveBeenCalledTimes(process.platform === 'win32' ? 2 : 1);
});

type Writer = 'attachment' | 'cover' | 'native';
function write(root: string, writer: Writer) {
  if (writer === 'cover') return storeCatalogCover(root, dataUrl);
  if (writer === 'native') return createManagedBytes(root, `cards/${cardId.slice(5)}.md`, png);
  return applyAttachmentEdit(root, { action: 'upload-attachment', cardId, manifestHash: '', attachmentsHash: '', dataUrl,
    fileName: null, addedBy: null });
}

function directory(root: string, writer: Writer) {
  if (writer === 'cover') return path.join(root, 'tasks/deckmate-assets/covers');
  if (writer === 'native') return path.join(root, 'cards');
  return path.join(root, `tasks/deckmate-assets/cards/${attachmentKey(cardId)}`);
}

async function failWrite(failClose: boolean) {
  const actual = await vi.importActual<typeof filesystem>('node:fs/promises');
  const close = vi.fn();
  vi.mocked(filesystem.open).mockImplementation(async (filename, flags, mode) => {
    const handle = await actual.open(filename, flags, mode);
    if (flags !== 'wx') return handle;
    const originalClose = handle.close.bind(handle);
    close.mockImplementation(async () => {
      await originalClose();
      if (failClose) throw closeFailure;
    });
    handle.close = close;
    handle.writeFile = vi.fn().mockRejectedValue(writeFailure);
    return handle;
  });
  return close;
}

// 2026-11-10: these deliberately different failure policies must not change during extraction.
it.each(['attachment', 'cover', 'native'] as const)('pins %s secondary close failure and cleanup', async writer => {
  const root = await fixture();
  const close = await failWrite(true);
  const expected = writer === 'attachment' ? writeFailure : closeFailure;
  await expect(write(root, writer)).rejects.toBe(expected);
  expect(close).toHaveBeenCalledTimes(writer === 'attachment' ? 1 : 2);
  const files = await readdir(directory(root, writer));
  expect(files).toHaveLength(writer === 'attachment' ? 0 : 1);
  expect(filesystem.unlink).toHaveBeenCalledTimes(writer === 'attachment' ? 1 : 0);
});

it.each(['attachment', 'cover', 'native'] as const)('pins %s cleanup failure aggregation', async writer => {
  const root = await fixture();
  const close = await failWrite(false);
  vi.mocked(filesystem.unlink).mockRejectedValue(cleanupFailure);
  const failure = await write(root, writer).catch(error => error);
  expect(failure).toBeInstanceOf(AggregateError);
  expect(failure.errors).toEqual([writeFailure, cleanupFailure]);
  expect(close).toHaveBeenCalledTimes(writer === 'native' ? 2 : 1);
  expect(await readdir(directory(root, writer))).toHaveLength(1);
});

it.each(['attachment', 'cover', 'native'] as const)('removes only its new %s file after a write failure', async writer => {
  const root = await fixture();
  const close = await failWrite(false);
  await expect(write(root, writer)).rejects.toBe(writeFailure);
  expect(close).toHaveBeenCalledTimes(writer === 'native' ? 2 : 1);
  expect(await readdir(directory(root, writer))).toEqual([]);
});

it.each(['attachment', 'cover', 'native'] as const)('pins %s failure on the first close after a successful write', async writer => {
  const root = await fixture();
  const actual = await vi.importActual<typeof filesystem>('node:fs/promises');
  const close = vi.fn();
  vi.mocked(filesystem.open).mockImplementation(async (filename, flags, mode) => {
    const handle = await actual.open(filename, flags, mode);
    const originalClose = handle.close.bind(handle);
    close.mockImplementation(async () => {
      await originalClose();
      if (close.mock.calls.length === 1) throw closeFailure;
    });
    handle.close = close;
    return handle;
  });
  await expect(write(root, writer)).rejects.toBe(closeFailure);
  expect(close).toHaveBeenCalledTimes(writer === 'native' ? 1 : 2);
  const files = await readdir(directory(root, writer));
  expect(files).toHaveLength(writer === 'native' ? 1 : 0);
  if (writer === 'native') expect(await readFile(path.join(directory(root, writer), files[0]))).toEqual(png);
});

const assetCases = [
  { mime: 'image/png', extension: 'png', bytes: png },
  { mime: 'image/jpeg', extension: 'jpg', bytes: Buffer.from([255, 216, 255]) },
  ...['VP8 ', 'VP8L', 'VP8X'].map(chunk => {
    const bytes = Buffer.alloc(20);
    bytes.write('RIFF', 0);
    bytes.writeUInt32LE(12, 4);
    bytes.write('WEBP' + chunk, 8);
    return { mime: 'image/webp', extension: 'webp', bytes };
  }),
  { mime: 'image/gif', extension: 'gif', bytes: Buffer.from('GIF87a') },
  { mime: 'image/gif', extension: 'gif', bytes: Buffer.from('GIF89a') },
  { mime: 'application/pdf', extension: 'pdf', bytes: Buffer.from('%PDF-1.7\n') },
];
const url = (mime: string, bytes: Buffer) => `data:${mime};base64,${bytes.toString('base64')}`;

it.each(assetCases)('decodes $mime ($extension), preserving caller allowlists and return shapes', ({ mime, extension, bytes }) => {
  const kind = extension === 'pdf' ? 'pdf' : 'image';
  expect(decodeAttachment(url(mime, bytes))).toEqual({ bytes, extension, mime, kind });
  if (extension === 'gif' || extension === 'pdf') expect(() => decodeCatalogCover(url(mime, bytes))).toThrow('Data URL is required');
  else expect(decodeCatalogCover(url(mime, bytes))).toEqual({ bytes, extension });
  const invalid = Buffer.from(bytes);
  invalid[0] ^= 128;
  expect(() => decodeAttachment(url(mime, invalid))).toThrow('content does not match');
  if (extension !== 'gif' && extension !== 'pdf') expect(() => decodeCatalogCover(url(mime, invalid))).toThrow('contents do not match');
});

it.each([
  { decode: decodeAttachment, maximum: maximumAttachmentBytes, size: '10 MB' },
  { decode: decodeCatalogCover, maximum: 5 * 1024 * 1024, size: '5 MB' },
])('preserves $size decoded and encoded boundaries and canonical base64', ({ decode, maximum, size }) => {
  for (const length of [maximum - 1, maximum]) {
    const bytes = Buffer.alloc(length);
    png.copy(bytes);
    expect(decode(url('image/png', bytes)).bytes).toEqual(bytes);
  }
  expect(() => decode(url('image/png', Buffer.alloc(maximum + 1)))).toThrow(size);
  expect(() => decode(url('image/png', Buffer.alloc(maximum + 3)))).toThrow(/Data URL/u);
  expect(() => decode(url('image/png', Buffer.alloc(maximum + 100)))).toThrow(size);
  expect(() => decode(dataUrl.replace(/o=$/u, 'p='))).toThrow('Noncanonical base64 encoding.');
  for (const invalid of [dataUrl + '\n', dataUrl.replace('base64,', 'base64, '), dataUrl.slice(0, -1),
    'data:image/png;base64,', 'data:image/png;base64,AAAA===', url('image/svg+xml', png), url('image/jpeg', png)]) {
    expect(() => decode(invalid)).toThrow();
  }
  expect(() => decode(null as never)).toThrow(size);
});

const guardMessages = () => ({ invalidRoot: 'invalid root', rootChanged: 'root changed', pathChanged: 'path changed', directoryLink: 'directory link' });
async function guard(root: string, relative = 'tasks/assets'): Promise<DirectoryGuard> {
  return (await guardedDirectory(root, relative, { create: true, missing: 'null', rootReference: 'absolute', messages: guardMessages }))!;
}

it('keeps missing-directory policies and creates each ancestor without recursive mkdir', async () => {
  const root = await fixture();
  const options = { create: false, missing: 'null' as const, rootReference: 'absolute' as const, messages: guardMessages };
  expect(await guardedDirectory(root, 'tasks/assets', options)).toBeNull();
  await expect(guardedDirectory(root, 'tasks/assets', { ...options, missing: 'throw' })).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await readCardAttachments(root, cardId)).toEqual({ hash: '', files: [], warnings: [] });
  expect(await readManagedMarkdown(root, `cards/${cardId.slice(5)}.md`)).toBeNull();
  await expect(assertCatalogCoverFile(root, 'tasks/deckmate-assets/covers/missing.png')).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await readdir(root)).toEqual([]);
  vi.mocked(filesystem.mkdir).mockClear();
  const created = await guard(root);
  expect(created.directory).toBe(path.join(root, 'tasks/assets'));
  expect(vi.mocked(filesystem.mkdir).mock.calls).toEqual([[path.join(root, 'tasks')], [path.join(root, 'tasks/assets')]]);
});

it.each(['tasks', 'tasks/assets', 'root'] as const)('rejects a replaced %s identity even if its realpath is unchanged', async relative => {
  const root = await fixture();
  const checked = await guard(root);
  const target = relative === 'root' ? root : path.join(root, relative);
  const kept = target + '-kept';
  await rename(target, kept);
  if (relative === 'root') roots.push(kept);
  await mkdir(target);
  await expect(checkDirectories(checked)).rejects.toThrow('path changed');
});

it('rejects a root redirected by a junction before checking descendant files', async () => {
  const root = await fixture();
  const checked = await guard(root);
  const outside = await fixture();
  const kept = root + '-kept';
  await rename(root, kept);
  roots.push(kept);
  await symlink(outside, root, 'junction');
  await expect(checkDirectories(checked)).rejects.toThrow('root changed');
  expect(await readdir(outside)).toEqual([]);
});

it('rejects a replacement inode and a directory passed as a regular file', async () => {
  const root = await fixture();
  const checked = await guard(root);
  const filename = path.join(checked.directory, 'asset.png');
  await writeFile(filename, png);
  const options = { invalidFile: () => 'file changed', outsideDirectory: () => 'outside directory' };
  const expected = await checkGuardedFile(checked, filename, options);
  await rename(filename, filename + '.original');
  await writeFile(filename, 'foreign bytes');
  await expect(checkGuardedFile(checked, filename, { ...options, expected })).rejects.toThrow('file changed');
  await expect(checkGuardedFile(checked, checked.directory, { invalidFile: options.invalidFile })).rejects.toThrow('file changed');
  await expect(checkGuardedFile(checked, path.join(root, 'foreign.png'), options)).rejects.toThrow('outside directory');
  expect(await readFile(filename, 'utf8')).toBe('foreign bytes');
  expect(await readFile(filename + '.original')).toEqual(png);
});

it('keeps the caller policy for an already missing file without overlooking changed ancestors', async () => {
  const root = await fixture();
  const checked = await guard(root);
  const filename = path.join(checked.directory, 'asset.png');
  await writeFile(filename, png);
  const invalidFile = () => 'file changed';
  const expected = await checkGuardedFile(checked, filename, { invalidFile });
  const options = { checkFile: () => checkGuardedFile(checked, filename, { expected, invalidFile }),
    replaced: invalidFile, missing: 'ignore' as const };
  await removeGuardedFile(checked, filename, expected, options);
  await removeGuardedFile(checked, filename, expected, options);
  await expect(removeGuardedFile(checked, filename, expected, { ...options, missing: 'throw' })).rejects.toMatchObject({ code: 'ENOENT' });
  await rename(checked.directory, checked.directory + '-kept');
  await mkdir(checked.directory);
  await expect(removeGuardedFile(checked, filename, expected, options)).rejects.toThrow('path changed');
});

it.each(['absolute', 'provided', 'none'] as const)('preserves the %s root-reference policy', async rootReference => {
  const root = await fixture();
  const relativeRoot = path.relative(process.cwd(), root);
  const checked = (await guardedDirectory(relativeRoot, 'tasks', {
    create: true, missing: 'null', rootReference, messages: guardMessages,
  }))!;
  if (rootReference === 'absolute') expect(checked.originalRoot).toBe(path.resolve(relativeRoot));
  if (rootReference === 'provided') expect(checked.originalRoot).toBe(relativeRoot);
  if (rootReference === 'none') expect(checked.originalRoot).toBeUndefined();
  await checkDirectories(checked);
});

it.each(['attachment', 'cover', 'native'] as const)('never deletes a substituted %s file before or after writing', async writer => {
  for (const stage of ['before', 'after'] as const) {
    const root = await fixture();
    const actual = await vi.importActual<typeof filesystem>('node:fs/promises');
    let target = '';
    vi.mocked(filesystem.open).mockImplementation(async (filename, flags, mode) => {
      const handle = await actual.open(filename, flags, mode);
      if (flags !== 'wx') return handle;
      target = String(filename);
      const replace = async () => {
        await rename(target, target + '.original');
        await writeFile(target, 'foreign bytes');
      };
      if (stage === 'before') {
        const stat = handle.stat.bind(handle);
        handle.stat = (async (...args: Parameters<typeof stat>) => {
          const result = await stat(...args);
          await replace();
          return result;
        }) as typeof handle.stat;
      } else {
        const writeFile = handle.writeFile.bind(handle);
        handle.writeFile = async (...args) => { await writeFile(...args); await replace(); };
      }
      return handle;
    });
    const failure = await write(root, writer).catch(error => error);
    expect(target).not.toBe('');
    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure.errors).toHaveLength(2);
    expect(await readFile(target, 'utf8')).toBe('foreign bytes');
    expect(await readFile(target + '.original')).toEqual(stage === 'before' ? Buffer.alloc(0) : png);
  }
});

it.each(['attachment', 'cover', 'native'] as const)('refuses %s cleanup through a substituted ancestor after writing', async writer => {
  const root = await fixture();
  const actual = await vi.importActual<typeof filesystem>('node:fs/promises');
  let target = '';
  vi.mocked(filesystem.open).mockImplementation(async (filename, flags, mode) => {
    const handle = await actual.open(filename, flags, mode);
    if (flags !== 'wx') return handle;
    target = String(filename);
    const originalWrite = handle.writeFile.bind(handle);
    const originalClose = handle.close.bind(handle);
    handle.writeFile = async (...args) => {
      await originalWrite(...args);
      // 2026-11-10: Windows refuses directory renames while a descendant descriptor is open.
      await originalClose();
      await rename(path.dirname(target), path.dirname(target) + '-kept');
      await mkdir(path.dirname(target));
      await writeFile(target, 'foreign bytes');
    };
    return handle;
  });
  const failure = await write(root, writer).catch(error => error);
  expect(failure).toBeInstanceOf(AggregateError);
  expect(failure.errors).toHaveLength(2);
  expect(await readFile(target, 'utf8')).toBe('foreign bytes');
  expect(await readFile(path.join(path.dirname(target) + '-kept', path.basename(target)))).toEqual(png);
});

it('retains native read guards, rechecks them and rebuilds them after ancestor replacement', async () => {
  const root = await fixture();
  await mkdir(path.join(root, 'tasks'));
  const filename = path.join(root, 'tasks/deckmate.md');
  const first = Buffer.from('\uFEFF---\r\nnote: untouched\r\n---\r\nBody.\n');
  await writeFile(filename, first);
  vi.mocked(filesystem.lstat).mockClear();
  expect((await readManagedMarkdown(root, 'tasks/deckmate.md'))!.bytes).toEqual(first);
  const firstChecks = vi.mocked(filesystem.lstat).mock.calls.length;
  vi.mocked(filesystem.lstat).mockClear();
  expect((await readManagedMarkdown(root, 'tasks/deckmate.md'))!.bytes).toEqual(first);
  expect(vi.mocked(filesystem.lstat).mock.calls.length).toBeLessThan(firstChecks);
  await rename(path.join(root, 'tasks'), path.join(root, 'kept-tasks'));
  await mkdir(path.join(root, 'tasks'));
  const second = Buffer.from('---\nnote: replaced\n---\nForeign body.\r\n');
  await writeFile(filename, second);
  expect((await readManagedMarkdown(root, 'tasks/deckmate.md'))!.bytes).toEqual(second);
  expect(await readFile(path.join(root, 'kept-tasks/deckmate.md'))).toEqual(first);
});
