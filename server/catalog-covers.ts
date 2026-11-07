import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { BigIntStats } from 'node:fs';
import { containedFile } from './config.ts';
import { resolveDataPath } from './data-paths.ts';
import { defineText, serverText } from './i18n.ts';

const coverText = defineText({
  sizeLimit: "The cover must be no larger than 5 MB.",
  dataUrl: "A valid PNG, JPEG or WebP base64 Data URL is required.",
  canonicalBase64: "Noncanonical base64 encoding.",
  contentType: "The cover contents do not match the PNG, JPEG or WebP Data URL.",
  rootChanged: "The project root changed while saving the cover.",
  pathChanged: "The cover path changed or contains a symbolic link.",
  invalidDirectory: "Invalid cover directory.",
  invalidRoot: "The project root is invalid or has been replaced.",
  directoryLink: "The cover directory contains a symbolic link or an external path.",
  outsideDirectory: "The cover is outside the verified directory.",
  regularFile: "The cover must be a regular file inside the cover directory.",
  invalidPath: "Invalid cover path.",
  replacedCover: "The created cover was replaced by another file; deletion was cancelled.",
  changedBeforeWrite: "The cover file changed before saving.",
  changedDuringWrite: "The cover file changed while saving.",
  cleanupFailed: "Cover saving was cancelled; the created file could not be safely removed.",
}, {
  sizeLimit: "Обложка должна быть не больше 5 МБ.",
  dataUrl: "Нужен корректный base64 Data URL PNG, JPEG или WebP.",
  canonicalBase64: "Неканоническая запись base64.",
  contentType: "Содержимое обложки не соответствует PNG, JPEG или WebP из Data URL.",
  rootChanged: "Корень проекта изменился во время записи обложки.",
  pathChanged: "Путь обложки изменился или содержит символическую ссылку.",
  invalidDirectory: "Недопустимый каталог обложек.",
  invalidRoot: "Некорректный или подменённый корень проекта.",
  directoryLink: "Каталог обложек содержит символическую ссылку или посторонний путь.",
  outsideDirectory: "Обложка вне проверенного каталога.",
  regularFile: "Обложка должна быть обычным файлом внутри каталога обложек.",
  invalidPath: "Недопустимый путь обложки.",
  replacedCover: "Созданная обложка заменена другим файлом; удаление отменено.",
  changedBeforeWrite: "Файл обложки изменился перед записью.",
  changedDuringWrite: "Файл обложки изменился при записи.",
  cleanupFailed: "Запись обложки отменена; безопасное удаление созданного файла не удалось.",
});


export const catalogCoverDirectory = 'tasks/deckmate-assets/covers';
const maximumCoverBytes = 5 * 1024 * 1024;
const maximumEncodedLength = Math.ceil(maximumCoverBytes / 3) * 4;

interface DirectoryIdentity { filename: string; stat: BigIntStats }
interface DirectoryGuard { originalRoot: string; root: string; relativeDirectory: string; directories: DirectoryIdentity[] }
export interface StoredCatalogCover { relativePath: string; remove: () => Promise<void> }

function sameIdentity(first: BigIntStats, second: BigIntStats): boolean {
  return first.dev === second.dev && first.ino === second.ino;
}

function samePath(first: string, second: string): boolean {
  return path.relative(first, second) === '';
}

export function isCatalogCoverPath(value: unknown): value is string {
  return typeof value === 'string'
    && /^tasks\/(?:deckmate|freetion)-assets\/covers\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}\.(?:png|jpe?g|webp)$/u.test(value)
    && !value.includes('..');
}

export function decodeCatalogCover(dataUrl: string): { bytes: Buffer; extension: string } {
  if (typeof dataUrl !== 'string' || dataUrl.length > maximumEncodedLength + 32) throw new Error(serverText(coverText).sizeLimit);
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/u.exec(dataUrl);
  if (!match || match[2].length % 4 !== 0 || match[2].length > maximumEncodedLength) throw new Error(serverText(coverText).dataUrl);
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length === 0 || bytes.length > maximumCoverBytes) throw new Error(serverText(coverText).sizeLimit);
  if (bytes.toString('base64') !== match[2]) throw new Error(serverText(coverText).canonicalBase64);
  const png = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp = bytes.length >= 20 && bytes.toString('latin1', 0, 4) === 'RIFF'
    && bytes.toString('latin1', 8, 12) === 'WEBP' && bytes.readUInt32LE(4) + 8 === bytes.length
    && ['VP8 ', 'VP8L', 'VP8X'].includes(bytes.toString('latin1', 12, 16));
  if (match[1] === 'image/png' && png) return { bytes, extension: 'png' };
  if (match[1] === 'image/jpeg' && jpeg) return { bytes, extension: 'jpg' };
  if (match[1] === 'image/webp' && webp) return { bytes, extension: 'webp' };
  throw new Error(serverText(coverText).contentType);
}

async function checkDirectories(guard: DirectoryGuard): Promise<void> {
  if (!samePath(await realpath(guard.originalRoot), guard.root)) throw new Error(serverText(coverText).rootChanged);
  for (const directory of guard.directories) {
    const current = await lstat(directory.filename, { bigint: true });
    if (!current.isDirectory() || current.isSymbolicLink() || !sameIdentity(current, directory.stat)
      || !samePath(await realpath(directory.filename), directory.filename)) {
      throw new Error(serverText(coverText).pathChanged);
    }
  }
}

async function coverDirectory(root: string, create: boolean, relativeDirectory: string): Promise<DirectoryGuard> {
  if (!/^tasks\/(?:deckmate|freetion)-assets\/covers$/u.test(relativeDirectory)) throw new Error(serverText(coverText).invalidDirectory);
  const originalRoot = path.resolve(root);
  const rootStat = await lstat(originalRoot, { bigint: true });
  const canonicalRoot = await realpath(originalRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || !samePath(originalRoot, canonicalRoot)) throw new Error(serverText(coverText).invalidRoot);
  const guard: DirectoryGuard = { originalRoot: root, root: canonicalRoot, relativeDirectory, directories: [{ filename: canonicalRoot, stat: rootStat }] };
  let directory = canonicalRoot;
  for (const part of relativeDirectory.split('/')) {
    await checkDirectories(guard);
    directory = path.join(directory, part);
    let current: BigIntStats;
    try { current = await lstat(directory, { bigint: true }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || !create) throw error;
      // 2026-11-03: never use recursive mkdir through an unchecked project-owned ancestor.
      await checkDirectories(guard);
      try { await mkdir(directory); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      current = await lstat(directory, { bigint: true });
    }
    if (!current.isDirectory() || current.isSymbolicLink()
      || !samePath(await realpath(directory), directory)) throw new Error(serverText(coverText).directoryLink);
    guard.directories.push({ filename: directory, stat: current });
    await checkDirectories(guard);
  }
  return guard;
}

async function checkedCoverFile(guard: DirectoryGuard, relativePath: string): Promise<{ filename: string; stat: BigIntStats }> {
  await checkDirectories(guard);
  if (path.posix.dirname(relativePath) !== guard.relativeDirectory) throw new Error(serverText(coverText).outsideDirectory);
  const filename = path.join(guard.root, relativePath);
  const stat = await lstat(filename, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink()
    || !samePath(await containedFile(guard.root, relativePath), filename)) throw new Error(serverText(coverText).regularFile);
  await checkDirectories(guard);
  return { filename, stat };
}

export async function assertCatalogCoverFile(root: string, relativePath: string): Promise<void> {
  if (!isCatalogCoverPath(relativePath)) throw new Error(serverText(coverText).invalidPath);
  // 2026-11-05: validate the referenced directory itself, including legacy assets when both names exist.
  await checkedCoverFile(await coverDirectory(root, false, path.posix.dirname(relativePath)), relativePath);
}

export async function storeCatalogCover(root: string, dataUrl: string): Promise<StoredCatalogCover> {
  const { bytes, extension } = decodeCatalogCover(dataUrl);
  const directory = await resolveDataPath(root, catalogCoverDirectory);
  const guard = await coverDirectory(root, true, directory);
  const relativePath = `${directory}/${randomUUID()}.${extension}`;
  const filename = path.join(guard.root, relativePath);
  await checkDirectories(guard);
  const handle = await open(filename, 'wx');
  let created: BigIntStats | null = null;
  let closed = false;
  const remove = async () => {
    if (!created) return;
    // 2026-11-03: refusal is safer than deleting a replacement file or following changed ancestors.
    const current = await checkedCoverFile(guard, relativePath);
    if (!sameIdentity(current.stat, created)) throw new Error(serverText(coverText).replacedCover);
    await unlink(current.filename);
  };
  try {
    created = await handle.stat({ bigint: true });
    const opened = await checkedCoverFile(guard, relativePath);
    if (!sameIdentity(opened.stat, created)) throw new Error(serverText(coverText).changedBeforeWrite);
    await handle.writeFile(bytes);
    await handle.close();
    closed = true;
    const written = await checkedCoverFile(guard, relativePath);
    if (!sameIdentity(written.stat, created)) throw new Error(serverText(coverText).changedDuringWrite);
    return { relativePath, remove };
  } catch (error) {
    if (!closed) { await handle.close(); closed = true; }
    try { await remove(); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], serverText(coverText).cleanupFailed); }
    throw error;
  } finally {
    if (!closed) await handle.close();
  }
}
