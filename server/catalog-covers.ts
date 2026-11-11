import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { BigIntStats } from 'node:fs';
import { containedFile } from './config.ts';
import { resolveDataPath } from './data-paths.ts';
import { defineText, serverText } from './i18n.ts';
import { decodeAssetDataUrl } from './asset-data-url.ts';
import { checkDirectories, checkGuardedFile, guardedDirectory, writeGuardedNewFile, type DirectoryGuard } from './guarded-files.ts';

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


const catalogCoverDirectory = 'tasks/deckmate-assets/covers';
const maximumCoverBytes = 5 * 1024 * 1024;
export interface StoredCatalogCover { relativePath: string; remove: () => Promise<void> }

export function isCatalogCoverPath(value: unknown): value is string {
  return typeof value === 'string'
    && /^tasks\/(?:deckmate|freetion)-assets\/covers\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}\.(?:png|jpe?g|webp)$/u.test(value)
    && !value.includes('..');
}

export function decodeCatalogCover(dataUrl: string): { bytes: Buffer; extension: string } {
  const { bytes, extension } = decodeAssetDataUrl(dataUrl, {
    allowed: ['image/png', 'image/jpeg', 'image/webp'], maximumBytes: maximumCoverBytes, headerAllowance: 32,
    error: failure => new Error(serverText(coverText)[failure]),
  });
  return { bytes, extension };
}

async function coverDirectory(root: string, create: boolean, relativeDirectory: string): Promise<DirectoryGuard> {
  if (!/^tasks\/(?:deckmate|freetion)-assets\/covers$/u.test(relativeDirectory)) throw new Error(serverText(coverText).invalidDirectory);
  return (await guardedDirectory(root, relativeDirectory, {
    create, missing: 'throw', rootReference: 'provided',
    messages: () => serverText(coverText),
  }))!;
}

async function checkedCoverFile(guard: DirectoryGuard, relativePath: string): Promise<BigIntStats> {
  await checkDirectories(guard);
  if (path.posix.dirname(relativePath) !== guard.relativeDirectory) throw new Error(serverText(coverText).outsideDirectory);
  return checkGuardedFile(guard, path.join(guard.root, relativePath), {
    checkBefore: false,
    invalidFile: () => serverText(coverText).regularFile,
    resolvePath: () => containedFile(guard.root, relativePath),
  });
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
  const { remove } = await writeGuardedNewFile(guard, relativePath, bytes, {
    checkFile: () => checkedCoverFile(guard, relativePath),
    missing: 'throw', close: 'propagate-secondary',
    replaced: () => serverText(coverText).replacedCover,
    beforeWrite: () => serverText(coverText).changedBeforeWrite,
    afterWrite: () => serverText(coverText).changedDuringWrite,
    cleanupFailed: () => serverText(coverText).cleanupFailed,
  });
  return { relativePath, remove };
}
