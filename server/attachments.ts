import { defineText, serverText } from './i18n.ts';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { BigIntStats } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { parse, stringify } from 'yaml';
import type { CardAttachment, CardAttachments, CatalogEdit } from '../src/catalog-contracts.ts';
import type { FormatLanguage } from '../src/format-vocabulary.ts';
import { containedFile } from './config.ts';
import { projectLanguage } from './project-language.ts';
import { resolveDataPath } from './data-paths.ts';

const messages = defineText({
  missingAttachment: (filename: string) => `Attachment file not found: ${filename}`,
  invalidAttachmentId: "Invalid card ID for attachments.",
  attachmentTooLarge: "Attachments must be no larger than 10 MB.",
  invalidAttachmentData: "Provide a valid base64 Data URL for PNG, JPEG, WebP, GIF or PDF.",
  noncanonicalBase64: "Noncanonical base64 encoding.",
  attachmentTypeMismatch: "Attachment content does not match the PNG, JPEG, WebP, GIF or PDF Data URL.",
  attachmentRootChanged: "The project root changed while saving the attachment.",
  attachmentPathChanged: "The attachment path changed or contains a symbolic link.",
  invalidAttachmentDirectory: "Invalid attachment directory.",
  invalidProjectRoot: "The project root is invalid or has been replaced.",
  unsafeAttachmentDirectory: "The attachment directory contains a symbolic link or an external path.",
  missingAttachmentDirectory: "The attachment directory was not found.",
  attachmentMustBeFile: "An attachment must be a regular file inside the card directory.",
  registryCardMismatch: "The attachment registry does not match the card.",
  invalidAttachmentList: "The attachment list is damaged.",
  invalidRegistryPath: "Invalid attachment path in the registry.",
  registryFileMismatch: "The attachment entry does not match its file.",
  invalidRegistrySize: "Invalid attachment size in the registry.",
  invalidRegistryDate: "Invalid attachment date in the registry.",
  invalidRegistryAuthor: "Invalid attachment author in the registry.",
  duplicateAttachments: "The attachment registry contains duplicates.",
  invalidCardCover: "Invalid card cover.",
  coverMustBeAttachment: "A card cover must be an image from its attachments.",
  invalidCoverPosition: "Cover position must be a number from 0 to 100.",
  invalidCoverSettings: "Invalid card cover settings.",
  missingRegistryHeader: "The attachment registry has no YAML frontmatter.",
  registryChangedOnOpen: "The attachment registry changed while opening it.",
  registryRewriteChangesData: "Rewriting the registry would change unrelated data.",
  temporaryRegistryChanged: "The temporary registry file changed while saving.",
  registryCleanupFailed: "Could not remove the temporary registry file.",
  attachmentReplaced: "The new attachment was replaced by another file; removal was cancelled.",
  attachmentChangedBeforeWrite: "The attachment file changed before saving.",
  attachmentChangedOnWrite: "The attachment file changed while saving.",
  attachmentCleanupFailed: "Attachment saving was cancelled; the new file could not be safely removed.",
  missingCoverFile: "The card cover file was not found.",
  invalidAttachmentsHash: "Editing attachments needs the card's current attachment list. Refresh the card and try again.",
  attachmentDirectoryFailed: "Could not prepare the card attachment directory.",
  tooManyAttachments: "A card cannot have more than 500 attachments.",
  registrySaveCleanupFailed: "The attachment registry was not saved; the uploaded file could not be safely removed.",
  invalidAttachmentPath: "Invalid attachment path.",
  attachmentNotFound: "Attachment not found.",
  attachmentNotListed: "Attachment not found in the card list.",
  attachmentFileBusy: "The attachment was removed from the card list, but its file is in use and could not be removed. Delete it manually.",
  noAttachments: "The card has no attachments yet.",
  invalidCoverPath: "Invalid cover path.",
  invalidCoverTitleMode: "Cover title color must be light or dark.",
  invalidCoverBlur: "Cover blur must be a boolean.",
}, {
  missingAttachment: (filename: string) => `Файл вложения не найден: ${filename}`,
  invalidAttachmentId: "Недопустимый ID карточки для вложений.",
  attachmentTooLarge: "Вложение должно быть не больше 10 МБ.",
  invalidAttachmentData: "Нужен корректный base64 Data URL PNG, JPEG, WebP, GIF или PDF.",
  noncanonicalBase64: "Неканоническая запись base64.",
  attachmentTypeMismatch: "Содержимое вложения не соответствует PNG, JPEG, WebP, GIF или PDF из Data URL.",
  attachmentRootChanged: "Корень проекта изменился во время записи вложения.",
  attachmentPathChanged: "Путь вложения изменился или содержит символическую ссылку.",
  invalidAttachmentDirectory: "Недопустимый каталог вложений.",
  invalidProjectRoot: "Некорректный или подменённый корень проекта.",
  unsafeAttachmentDirectory: "Каталог вложений содержит символическую ссылку или посторонний путь.",
  missingAttachmentDirectory: "Каталог вложения не найден.",
  attachmentMustBeFile: "Вложение должно быть обычным файлом внутри каталога карточки.",
  registryCardMismatch: "Реестр вложений не соответствует карточке.",
  invalidAttachmentList: "Список вложений повреждён.",
  invalidRegistryPath: "Недопустимый путь вложения в реестре.",
  registryFileMismatch: "Запись вложения не соответствует своему файлу.",
  invalidRegistrySize: "Некорректный размер вложения в реестре.",
  invalidRegistryDate: "Некорректная дата вложения в реестре.",
  invalidRegistryAuthor: "Некорректный автор вложения в реестре.",
  duplicateAttachments: "Реестр вложений содержит дубликаты.",
  invalidCardCover: "Некорректная обложка карточки.",
  coverMustBeAttachment: "Обложкой карточки может быть только изображение из её вложений.",
  invalidCoverPosition: "Позиция обложки должна быть числом от 0 до 100.",
  invalidCoverSettings: "Некорректные настройки обложки карточки.",
  missingRegistryHeader: "В реестре вложений отсутствует YAML-шапка.",
  registryChangedOnOpen: "Реестр вложений изменился при открытии.",
  registryRewriteChangesData: "Перезапись реестра изменила бы посторонние данные.",
  temporaryRegistryChanged: "Временный файл реестра изменился при записи.",
  registryCleanupFailed: "Не удалось убрать временный файл реестра.",
  attachmentReplaced: "Созданное вложение заменено другим файлом; удаление отменено.",
  attachmentChangedBeforeWrite: "Файл вложения изменился перед записью.",
  attachmentChangedOnWrite: "Файл вложения изменился при записи.",
  attachmentCleanupFailed: "Запись вложения отменена; безопасное удаление созданного файла не удалось.",
  missingCoverFile: "Файл обложки карточки не найден.",
  invalidAttachmentsHash: "Для правки вложений нужен актуальный список вложений карточки. Обновите карточку и повторите действие.",
  attachmentDirectoryFailed: "Не удалось подготовить каталог вложений карточки.",
  tooManyAttachments: "У карточки не может быть больше 500 вложений.",
  registrySaveCleanupFailed: "Реестр вложений не сохранён; безопасное удаление загруженного файла не удалось.",
  invalidAttachmentPath: "Недопустимый путь вложения.",
  attachmentNotFound: "Вложение не найдено.",
  attachmentNotListed: "Вложение не найдено в списке карточки.",
  attachmentFileBusy: "Вложение удалено из списка карточки, но файл на диске занят и не удалён. Удалите его вручную.",
  noAttachments: "У карточки ещё нет вложений.",
  invalidCoverPath: "Недопустимый путь обложки.",
  invalidCoverTitleMode: "Цвет заголовка обложки — light или dark.",
  invalidCoverBlur: "Размытие обложки должно быть boolean.",
});


// 2026-11-04: attachment files live beside the card's assets directory in the data project.
// The managed attachments.md file stores the attachment list and cover.
// Writes target only the configured writable copy,
// using the same directory and file guards as deck covers in catalog-covers.ts.

export const cardAttachmentsDirectory = 'tasks/deckmate-assets/cards';
// Limit each attachment to 10 MB to bound storage and request sizes.
export const maximumAttachmentBytes = 10 * 1024 * 1024;
const maximumEncodedLength = Math.ceil(maximumAttachmentBytes / 3) * 4;
const registryFileName = 'attachments.md';
const maximumRegistryEntries = 500;
const attachmentPathPattern = /^tasks\/(?:deckmate|freetion)-assets\/cards\/([a-z0-9-]{6,80})\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp|gif|pdf)$/u;
const nativeCardIdPattern = /^card:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/iu;
const registryHeadPattern = /^(?:﻿)?---(\r?\n)([\s\S]*?)^---[ \t]*(?:\r?\n|$)/mu;
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

export type AttachmentEditAction = Extract<CatalogEdit, { action: 'upload-attachment' | 'remove-attachment' | 'set-card-cover' }>;
// ReadonlySet<string> lets app.ts validate any catalog action against this set.
export const attachmentEditActions: ReadonlySet<string> = new Set<AttachmentEditAction['action']>(['upload-attachment', 'remove-attachment', 'set-card-cover']);

interface RegistryEntry {
  file: string;
  name: string;
  kind: 'image' | 'pdf';
  mime: string;
  bytes: number;
  addedAt: string;
  addedBy: string | null;
}
interface RegistryCover {
  file: string;
  position: number;
  titleMode: 'light' | 'dark';
  blur: boolean;
}
interface RegistryData {
  schema: 1;
  card: string;
  files: RegistryEntry[];
  cover: RegistryCover | null;
}
interface ParsedRegistry { data: RegistryData; hash: string; body: string; newline: string }
interface DirectoryIdentity { filename: string; stat: BigIntStats }
interface DirectoryGuard { originalRoot: string; root: string; relativeDirectory: string; directories: DirectoryIdentity[] }
export interface StoredAttachment { relativePath: string; remove: () => Promise<void> }

const mimeByExtension: Record<string, { mime: string; kind: 'image' | 'pdf' }> = {
  png: { mime: 'image/png', kind: 'image' },
  jpg: { mime: 'image/jpeg', kind: 'image' },
  webp: { mime: 'image/webp', kind: 'image' },
  gif: { mime: 'image/gif', kind: 'image' },
  pdf: { mime: 'application/pdf', kind: 'pdf' },
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function boundedText(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= limit
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

function sameIdentity(first: BigIntStats, second: BigIntStats): boolean {
  return first.dev === second.dev && first.ino === second.ino;
}

function samePath(first: string, second: string): boolean {
  return path.relative(first, second) === '';
}

/** Thrown for card identifiers that cannot name an attachment directory; app.ts answers 400 (2026-11-06). */
export class InvalidAttachmentIdError extends Error {}

/** Native UUIDs are directory names; legacy IDs contain path separators and punctuation, so hash them. */
export function attachmentKey(cardId: string): string {
  const native = nativeCardIdPattern.exec(cardId);
  if (native) return native[1].toLowerCase();
  if (!boundedText(cardId, 1000) || !/^(card|task|hero|doc):\S/u.test(cardId)) throw new InvalidAttachmentIdError(serverText(messages).invalidAttachmentId);
  return 'legacy-' + createHash('sha256').update(cardId).digest('hex').slice(0, 16);
}

export function isCardAttachmentPath(value: string, key: string): boolean {
  const match = attachmentPathPattern.exec(value);
  return match !== null && match[1] === key && !value.includes('..');
}

export function decodeAttachment(dataUrl: string): { bytes: Buffer; extension: string; mime: string; kind: 'image' | 'pdf' } {
  if (typeof dataUrl !== 'string' || dataUrl.length > maximumEncodedLength + 48) throw new Error(serverText(messages).attachmentTooLarge);
  const match = /^data:(image\/(?:png|jpeg|webp|gif)|application\/pdf);base64,([A-Za-z0-9+/]+={0,2})$/u.exec(dataUrl);
  if (!match || match[2].length % 4 !== 0 || match[2].length > maximumEncodedLength) throw new Error(serverText(messages).invalidAttachmentData);
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length === 0 || bytes.length > maximumAttachmentBytes) throw new Error(serverText(messages).attachmentTooLarge);
  if (bytes.toString('base64') !== match[2]) throw new Error(serverText(messages).noncanonicalBase64);
  const latin = (start: number, end: number) => bytes.toString('latin1', start, end);
  const png = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp = bytes.length >= 20 && latin(0, 4) === 'RIFF' && latin(8, 12) === 'WEBP'
    && bytes.readUInt32LE(4) + 8 === bytes.length && ['VP8 ', 'VP8L', 'VP8X'].includes(latin(12, 16));
  const gif = bytes.length >= 6 && (latin(0, 6) === 'GIF87a' || latin(0, 6) === 'GIF89a');
  const pdf = bytes.length >= 5 && latin(0, 5) === '%PDF-';
  const declared = match[1];
  if (declared === 'image/png' && png) return { bytes, extension: 'png', mime: declared, kind: 'image' };
  if (declared === 'image/jpeg' && jpeg) return { bytes, extension: 'jpg', mime: declared, kind: 'image' };
  if (declared === 'image/webp' && webp) return { bytes, extension: 'webp', mime: declared, kind: 'image' };
  if (declared === 'image/gif' && gif) return { bytes, extension: 'gif', mime: declared, kind: 'image' };
  if (declared === 'application/pdf' && pdf) return { bytes, extension: 'pdf', mime: declared, kind: 'pdf' };
  throw new Error(serverText(messages).attachmentTypeMismatch);
}

async function checkDirectories(guard: DirectoryGuard): Promise<void> {
  if (!samePath(await realpath(guard.originalRoot), guard.root)) throw new Error(serverText(messages).attachmentRootChanged);
  for (const directory of guard.directories) {
    const current = await lstat(directory.filename, { bigint: true });
    if (!current.isDirectory() || current.isSymbolicLink() || !sameIdentity(current, directory.stat)
      || !samePath(await realpath(directory.filename), directory.filename)) {
      throw new Error(serverText(messages).attachmentPathChanged);
    }
  }
}

/** Check each ancestor while descending, as deck covers do in catalog-covers.ts. */
async function attachmentDirectory(root: string, key: string, create: boolean, exactDirectory?: string): Promise<DirectoryGuard | null> {
  // 2026-11-05: an existing per-card registry wins over the presence of a newer assets root.
  const relativeDirectory = exactDirectory ?? path.posix.dirname(await resolveDataPath(root, `${cardAttachmentsDirectory}/${key}/${registryFileName}`));
  if (!/^tasks\/(?:deckmate|freetion)-assets\/cards\/[a-z0-9-]{6,80}$/u.test(relativeDirectory)
    || path.posix.basename(relativeDirectory) !== key) throw new Error(serverText(messages).invalidAttachmentDirectory);
  const originalRoot = path.resolve(root);
  const rootStat = await lstat(originalRoot, { bigint: true });
  const canonicalRoot = await realpath(originalRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || !samePath(originalRoot, canonicalRoot)) throw new Error(serverText(messages).invalidProjectRoot);
  const guard: DirectoryGuard = { originalRoot, root: canonicalRoot, relativeDirectory, directories: [{ filename: canonicalRoot, stat: rootStat }] };
  let directory = canonicalRoot;
  for (const part of relativeDirectory.split('/')) {
    await checkDirectories(guard);
    directory = path.join(directory, part);
    let current: BigIntStats;
    try { current = await lstat(directory, { bigint: true }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || !create) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
      // 2026-11-04: avoid recursive mkdir so every ancestor is checked before creation.
      await checkDirectories(guard);
      try { await mkdir(directory); }
      catch (mkdirError) { if ((mkdirError as NodeJS.ErrnoException).code !== 'EEXIST') throw mkdirError; }
      current = await lstat(directory, { bigint: true });
    }
    if (!current.isDirectory() || current.isSymbolicLink()
      || !samePath(await realpath(directory), directory)) throw new Error(serverText(messages).unsafeAttachmentDirectory);
    guard.directories.push({ filename: directory, stat: current });
    await checkDirectories(guard);
  }
  return guard;
}

async function checkedAttachmentFile(guard: DirectoryGuard, relativePath: string): Promise<BigIntStats> {
  await checkDirectories(guard);
  const directory = path.posix.dirname(relativePath);
  if (directory !== guard.relativeDirectory) {
    // 2026-11-05: a registry can reference both names; never validate an old asset through the new directory's guard.
    const exactGuard = await attachmentDirectory(guard.root, path.posix.basename(guard.relativeDirectory), false, directory);
    if (!exactGuard) throw new Error(serverText(messages).missingAttachmentDirectory);
    guard = exactGuard;
  }
  const filename = path.join(guard.root, relativePath);
  const stat = await lstat(filename, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink()
    || !samePath(await containedFile(guard.root, relativePath), filename)) throw new Error(serverText(messages).attachmentMustBeFile);
  await checkDirectories(guard);
  return stat;
}

function validAddedAt(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}

function validateRegistry(value: unknown, cardId: string): RegistryData {
  const key = attachmentKey(cardId);
  if (!record(value) || value.schema !== 1 || value.card !== cardId) throw new Error(serverText(messages).registryCardMismatch);
  const filesValue = value.files;
  if (!Array.isArray(filesValue) || filesValue.length > maximumRegistryEntries) throw new Error(serverText(messages).invalidAttachmentList);
  const files: RegistryEntry[] = filesValue.map(entry => {
    if (!record(entry) || !boundedText(entry.file, 300) || !isCardAttachmentPath(entry.file, key)) throw new Error(serverText(messages).invalidRegistryPath);
    const extension = entry.file.split('.').pop() as keyof typeof mimeByExtension;
    const expected = mimeByExtension[extension];
    const { name, kind, mime, bytes, addedAt, addedBy } = entry;
    if (!expected || !boundedText(name, 200) || kind !== expected.kind || mime !== expected.mime) throw new Error(serverText(messages).registryFileMismatch);
    if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes < 1 || bytes > maximumAttachmentBytes) throw new Error(serverText(messages).invalidRegistrySize);
    if (!validAddedAt(addedAt)) throw new Error(serverText(messages).invalidRegistryDate);
    if (addedBy !== null && (typeof addedBy !== 'string' || !boundedText(addedBy, 80))) throw new Error(serverText(messages).invalidRegistryAuthor);
    return { file: entry.file, name, kind: expected.kind, mime: expected.mime, bytes, addedAt, addedBy };
  });
  if (new Set(files.map(file => file.file)).size !== files.length) throw new Error(serverText(messages).duplicateAttachments);
  let cover: RegistryCover | null = null;
  if (value.cover !== null && value.cover !== undefined) {
    const raw = value.cover;
    if (!record(raw) || !boundedText(raw.file, 300)) throw new Error(serverText(messages).invalidCardCover);
    const entry = files.find(file => file.file === raw.file);
    if (!entry || entry.kind !== 'image') throw new Error(serverText(messages).coverMustBeAttachment);
    if (typeof raw.position !== 'number' || !Number.isFinite(raw.position) || raw.position < 0 || raw.position > 100) throw new Error(serverText(messages).invalidCoverPosition);
    if ((raw.titleMode !== 'light' && raw.titleMode !== 'dark') || typeof raw.blur !== 'boolean') throw new Error(serverText(messages).invalidCoverSettings);
    cover = { file: raw.file, position: raw.position, titleMode: raw.titleMode, blur: raw.blur };
  }
  return { schema: 1, card: cardId, files, cover };
}

function parseRegistry(bytes: Buffer, cardId: string): ParsedRegistry {
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  const match = registryHeadPattern.exec(text);
  if (!match || match.index !== 0) throw new Error(serverText(messages).missingRegistryHeader);
  const data = validateRegistry(parse(match[2], { maxAliasCount: 0 }), cardId);
  return { data, hash: digest(bytes), body: text.slice(match[0].length), newline: match[1] };
}

const registryBriefs = {
  en: "\n# Card attachments\n\nA Deckmate-managed file: the card's attachment list and cover.\nThe files sit beside it in the same directory; entries are written by the Deckmate server. Edit through the interface or API, not by hand.\n",
  ru: '\n# Вложения карточки\n\nУправляемый файл Deckmate: список вложений карточки и её обложка.\nФайлы лежат рядом в этом же каталоге; записи пишет сервер Deckmate. Правьте через интерфейс или API, не руками.\n',
} as const satisfies Record<FormatLanguage, string>;

/** A new registry gets a header in the project's format language; a project without a manifest is new and reads English. */
async function registryBrief(root: string): Promise<string> {
  return registryBriefs[await projectLanguage(root)];
}

function renderRegistry(data: RegistryData, previous: ParsedRegistry | null, body: string): Buffer {
  const yaml = stringify(data, { lineWidth: 0 }).trimEnd();
  const newline = previous?.newline ?? '\n';
  return Buffer.from('---' + newline + yaml + newline + '---' + newline + body, 'utf8');
}

async function readRegistry(guard: DirectoryGuard, cardId: string): Promise<{ bytes: Buffer; parsed: ParsedRegistry } | null> {
  const relativePath = `${guard.relativeDirectory}/${registryFileName}`;
  try {
    const stat = await checkedAttachmentFile(guard, relativePath);
    const handle = await open(path.join(guard.root, relativePath), 'r');
    try {
      if (!sameIdentity(stat, await handle.stat({ bigint: true }))) throw new Error(serverText(messages).registryChangedOnOpen);
      const bytes = await handle.readFile();
      return { bytes, parsed: parseRegistry(bytes, cardId) };
    } finally { await handle.close(); }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Publish through a temporary file and rename after rechecking the hash, as for project Markdown. */
async function publishRegistry(guard: DirectoryGuard, cardId: string, expectedHash: string, data: RegistryData, previous: ParsedRegistry | null): Promise<void> {
  const relativePath = `${guard.relativeDirectory}/${registryFileName}`;
  const body = previous?.body ?? await registryBrief(guard.root);
  const nextBytes = renderRegistry(data, previous, body);
  const reparsed = parseRegistry(nextBytes, cardId);
  if (!isDeepStrictEqual(reparsed.data, data)) throw new Error(serverText(messages).registryRewriteChangesData);
  await checkDirectories(guard);
  const temporaryPath = path.join(guard.root, `${guard.relativeDirectory}/.${randomUUID()}.tmp`);
  const handle = await open(temporaryPath, 'wx');
  let temporaryStat: BigIntStats | null = null;
  let renamed = false;
  try {
    temporaryStat = await handle.stat({ bigint: true });
    await handle.writeFile(nextBytes);
    await handle.close();
    const current = await readRegistry(guard, cardId);
    if ((current ? digest(current.bytes) : '') !== expectedHash) throw new Error('ATTACHMENTS_CONFLICT');
    if (!temporaryStat || !sameIdentity(temporaryStat, (await lstat(temporaryPath, { bigint: true })))) throw new Error(serverText(messages).temporaryRegistryChanged);
    await rename(temporaryPath, path.join(guard.root, relativePath));
    renamed = true;
    await checkedAttachmentFile(guard, relativePath);
  } catch (error) {
    if (renamed) throw error;
    try { await handle.close(); } catch { /* The handle is already closed. */ }
    try { temporaryStat && await unlink(temporaryPath); } catch (cleanupError) {
      if ((cleanupError as NodeJS.ErrnoException).code !== 'ENOENT') throw new AggregateError([error, cleanupError], serverText(messages).registryCleanupFailed);
    }
    throw error;
  } finally {
    if (!renamed) try { await handle.close(); } catch { /* A cleanup failure must not mask the original error. */ }
  }
}

async function storeAttachmentFile(guard: DirectoryGuard, decoded: { bytes: Buffer; extension: string }): Promise<StoredAttachment> {
  const relativePath = `${guard.relativeDirectory}/${randomUUID()}.${decoded.extension}`;
  const filename = path.join(guard.root, relativePath);
  await checkDirectories(guard);
  const handle = await open(filename, 'wx');
  let created: BigIntStats | null = null;
  let closed = false;
  const remove = async () => {
    if (!created) return;
    // 2026-11-04: rejecting the operation is safer than deleting a replaced file.
    const current = await checkedAttachmentFile(guard, relativePath);
    if (!sameIdentity(current, created)) throw new Error(serverText(messages).attachmentReplaced);
    await unlink(path.join(guard.root, relativePath));
  };
  try {
    created = await handle.stat({ bigint: true });
    const opened = await checkedAttachmentFile(guard, relativePath);
    if (!sameIdentity(opened, created)) throw new Error(serverText(messages).attachmentChangedBeforeWrite);
    await handle.writeFile(decoded.bytes);
    await handle.close();
    closed = true;
    const written = await checkedAttachmentFile(guard, relativePath);
    if (!sameIdentity(written, created)) throw new Error(serverText(messages).attachmentChangedOnWrite);
    return { relativePath, remove };
  } catch (error) {
    if (!closed) { await handle.close().catch(() => {}); closed = true; }
    try { await remove(); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], serverText(messages).attachmentCleanupFailed); }
    throw error;
  } finally {
    if (!closed) await handle.close().catch(() => {});
  }
}

/** Read the card's attachment registry and check that each listed file exists. */
export async function readCardAttachments(root: string, cardId: string): Promise<CardAttachments> {
  const key = attachmentKey(cardId);
  const guard = await attachmentDirectory(root, key, false);
  if (!guard) return { hash: '', files: [], cover: null, warnings: [] };
  const registry = await readRegistry(guard, cardId);
  if (!registry) return { hash: '', files: [], cover: null, warnings: [] };
  const files: CardAttachment[] = [];
  const warnings: string[] = [];
  for (const entry of registry.parsed.data.files) {
    let missing = false;
    try { await checkedAttachmentFile(guard, entry.file); }
    catch { missing = true; warnings.push(serverText(messages).missingAttachment(entry.name)); }
    files.push({ ...entry, ...(missing ? { missing: true } : {}) });
  }
  const cover = registry.parsed.data.cover;
  if (cover) {
    try { await checkedAttachmentFile(guard, cover.file); }
    catch { warnings.push(serverText(messages).missingCoverFile); }
  }
  return { hash: registry.parsed.hash, files, cover, warnings };
}

function requireRegistryHash(edit: AttachmentEditAction): void {
  if (typeof edit.attachmentsHash !== 'string' || !/^(?:[0-9a-f]{64})?$/u.test(edit.attachmentsHash)) throw new Error(serverText(messages).invalidAttachmentsHash);
}

// 2026-11-05: the default name is written into the registry, so it follows the project's format language, not the interface language.
const defaultAttachmentNames = {
  en: 'attachment',
  ru: 'вложение',
} as const satisfies Record<FormatLanguage, string>;

async function displayFileName(root: string, requested: string | null | undefined, extension: string): Promise<string> {
  if (typeof requested === 'string' && boundedText(requested.trim().replace(/[\u0000-\u001f\u007f]+/gu, ' ').trim(), 200)) return requested.trim().replace(/[\u0000-\u001f\u007f]+/gu, ' ').trim();
  return defaultAttachmentNames[await projectLanguage(root)] + '.' + extension;
}

async function uploadAttachment(root: string, edit: Extract<AttachmentEditAction, { action: 'upload-attachment' }>): Promise<void> {
  requireRegistryHash(edit);
  const decoded = decodeAttachment(edit.dataUrl);
  const addedBy = edit.addedBy === null || edit.addedBy === undefined ? null : edit.addedBy.trim().slice(0, 80) || null;
  const key = attachmentKey(edit.cardId);
  const guard = await attachmentDirectory(root, key, true);
  if (!guard) throw new Error(serverText(messages).attachmentDirectoryFailed);
  const asset = await storeAttachmentFile(guard, decoded);
  try {
    const registry = await readRegistry(guard, edit.cardId);
    const data = registry?.parsed.data ?? { schema: 1 as const, card: edit.cardId, files: [], cover: null };
    if (data.files.length >= maximumRegistryEntries) throw new Error(serverText(messages).tooManyAttachments);
    data.files.push({ file: asset.relativePath, name: await displayFileName(root, edit.fileName, decoded.extension),
      kind: decoded.kind, mime: decoded.mime, bytes: decoded.bytes.length, addedAt: new Date().toISOString(), addedBy });
    await publishRegistry(guard, edit.cardId, edit.attachmentsHash, data, registry?.parsed ?? null);
  } catch (error) {
    try { await asset.remove(); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], serverText(messages).registrySaveCleanupFailed); }
    throw error;
  }
}

async function removeAttachment(root: string, edit: Extract<AttachmentEditAction, { action: 'remove-attachment' }>): Promise<void> {
  requireRegistryHash(edit);
  const key = attachmentKey(edit.cardId);
  if (typeof edit.file !== 'string' || !isCardAttachmentPath(edit.file, key)) throw new Error(serverText(messages).invalidAttachmentPath);
  const guard = await attachmentDirectory(root, key, false);
  if (!guard) throw new Error(serverText(messages).attachmentNotFound);
  const registry = await readRegistry(guard, edit.cardId);
  if (!registry || digest(registry.bytes) !== edit.attachmentsHash) throw new Error('ATTACHMENTS_CONFLICT');
  const entry = registry.parsed.data.files.find(file => file.file === edit.file);
  if (!entry) throw new Error(serverText(messages).attachmentNotListed);
  const data = registry.parsed.data;
  data.files = data.files.filter(file => file.file !== edit.file);
  if (data.cover?.file === edit.file) data.cover = null;
  await publishRegistry(guard, edit.cardId, edit.attachmentsHash, data, registry.parsed);
  // The registry is published; a leftover file is unused data, not data loss, so mark the error saved.
  try { await checkedAttachmentFile(guard, edit.file); await unlink(path.join(guard.root, edit.file)); }
  catch {
    throw Object.assign(new Error(serverText(messages).attachmentFileBusy), { saved: true });
  }
}

async function setCardCover(root: string, edit: Extract<AttachmentEditAction, { action: 'set-card-cover' }>): Promise<void> {
  requireRegistryHash(edit);
  const key = attachmentKey(edit.cardId);
  const guard = await attachmentDirectory(root, key, false);
  if (!guard) throw new Error(serverText(messages).noAttachments);
  const registry = await readRegistry(guard, edit.cardId);
  if (!registry || digest(registry.bytes) !== edit.attachmentsHash) throw new Error('ATTACHMENTS_CONFLICT');
  const data = registry.parsed.data;
  if (edit.coverFile === null) {
    data.cover = null;
  } else {
    if (typeof edit.coverFile !== 'string' || !isCardAttachmentPath(edit.coverFile, key)) throw new Error(serverText(messages).invalidCoverPath);
    const entry = data.files.find(file => file.file === edit.coverFile);
    if (!entry || entry.kind !== 'image') throw new Error(serverText(messages).coverMustBeAttachment);
    if (typeof edit.coverPosition !== 'number' || !Number.isFinite(edit.coverPosition) || edit.coverPosition < 0 || edit.coverPosition > 100) throw new Error(serverText(messages).invalidCoverPosition);
    if (edit.coverTitleMode !== 'light' && edit.coverTitleMode !== 'dark') throw new Error(serverText(messages).invalidCoverTitleMode);
    if (typeof edit.coverBlur !== 'boolean') throw new Error(serverText(messages).invalidCoverBlur);
    data.cover = { file: edit.coverFile, position: edit.coverPosition, titleMode: edit.coverTitleMode, blur: edit.coverBlur };
  }
  await publishRegistry(guard, edit.cardId, edit.attachmentsHash, data, registry.parsed);
}

let queuedWrite: Promise<unknown> = Promise.resolve();

/** Serialize attachment edits through one queue to prevent registry races. */
export function applyAttachmentEdit(root: string, edit: AttachmentEditAction): Promise<void> {
  const operation = queuedWrite.then(async () => {
    if (edit.action === 'upload-attachment') return uploadAttachment(root, edit);
    if (edit.action === 'remove-attachment') return removeAttachment(root, edit);
    return setCardCover(root, edit);
  });
  queuedWrite = operation.catch(() => {});
  return operation;
}
