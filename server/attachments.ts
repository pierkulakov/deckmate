import { defineText, serverText } from './i18n.ts';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { BigIntStats } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { isMap, isScalar, isSeq, parseDocument, stringify, type YAMLSeq } from 'yaml';
import type { CardAttachment, CardAttachments, CatalogEdit } from '../src/catalog-contracts.ts';
import type { FormatLanguage } from '../src/format-vocabulary.ts';
import { containedFile } from './config.ts';
import { projectLanguage } from './project-language.ts';
import { resolveDataPath } from './data-paths.ts';
import { decodeAssetDataUrl } from './asset-data-url.ts';
import { checkDirectories, checkGuardedFile, guardedDirectory, sameIdentity, writeGuardedNewFile, type DirectoryGuard } from './guarded-files.ts';

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
  missingRegistryHeader: "The attachment registry has no YAML frontmatter.",
  registryChangedOnOpen: "The attachment registry changed while opening it.",
  registryRewriteChangesData: "Rewriting the registry would change unrelated data.",
  temporaryRegistryChanged: "The temporary registry file changed while saving.",
  registryCleanupFailed: "Could not remove the temporary registry file.",
  attachmentReplaced: "The new attachment was replaced by another file; removal was cancelled.",
  attachmentChangedBeforeWrite: "The attachment file changed before saving.",
  attachmentChangedOnWrite: "The attachment file changed while saving.",
  attachmentCleanupFailed: "Attachment saving was cancelled; the new file could not be safely removed.",
  invalidAttachmentsHash: "Editing attachments needs the card's current attachment list. Refresh the card and try again.",
  attachmentDirectoryFailed: "Could not prepare the card attachment directory.",
  tooManyAttachments: "A card cannot have more than 500 attachments.",
  registrySaveCleanupFailed: "The attachment registry was not saved; the uploaded file could not be safely removed.",
  invalidAttachmentPath: "Invalid attachment path.",
  attachmentNotFound: "Attachment not found.",
  attachmentNotListed: "Attachment not found in the card list.",
  attachmentFileBusy: "The attachment was removed from the card list, but its file is in use and could not be removed. Delete it manually.",
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
  missingRegistryHeader: "В реестре вложений отсутствует YAML-шапка.",
  registryChangedOnOpen: "Реестр вложений изменился при открытии.",
  registryRewriteChangesData: "Перезапись реестра изменила бы посторонние данные.",
  temporaryRegistryChanged: "Временный файл реестра изменился при записи.",
  registryCleanupFailed: "Не удалось убрать временный файл реестра.",
  attachmentReplaced: "Созданное вложение заменено другим файлом; удаление отменено.",
  attachmentChangedBeforeWrite: "Файл вложения изменился перед записью.",
  attachmentChangedOnWrite: "Файл вложения изменился при записи.",
  attachmentCleanupFailed: "Запись вложения отменена; безопасное удаление созданного файла не удалось.",
  invalidAttachmentsHash: "Для правки вложений нужен актуальный список вложений карточки. Обновите карточку и повторите действие.",
  attachmentDirectoryFailed: "Не удалось подготовить каталог вложений карточки.",
  tooManyAttachments: "У карточки не может быть больше 500 вложений.",
  registrySaveCleanupFailed: "Реестр вложений не сохранён; безопасное удаление загруженного файла не удалось.",
  invalidAttachmentPath: "Недопустимый путь вложения.",
  attachmentNotFound: "Вложение не найдено.",
  attachmentNotListed: "Вложение не найдено в списке карточки.",
  attachmentFileBusy: "Вложение удалено из списка карточки, но файл на диске занят и не удалён. Удалите его вручную.",
});


// 2026-11-04: attachment files live beside the card's assets directory in the data project.
// The managed attachments.md file stores the attachment list.
// Writes target only the configured writable copy,
// using the same directory and file guards as deck covers in catalog-covers.ts.

const cardAttachmentsDirectory = 'tasks/deckmate-assets/cards';
// Limit each attachment to 10 MB to bound storage and request sizes.
export const maximumAttachmentBytes = 10 * 1024 * 1024;
const registryFileName = 'attachments.md';
const maximumRegistryEntries = 500;
const attachmentPathPattern = /^tasks\/(?:deckmate|freetion)-assets\/cards\/([a-z0-9-]{6,80})\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp|gif|pdf)$/u;
const nativeCardIdPattern = /^card:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/iu;
const registryHeadPattern = /^(?:﻿)?---(\r?\n)([\s\S]*?)^---[ \t]*(?:\r?\n|$)/mu;
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

export type AttachmentEditAction = Extract<CatalogEdit, { action: 'upload-attachment' | 'remove-attachment' }>;
// ReadonlySet<string> lets app.ts validate any catalog action against this set.
export const attachmentEditActions: ReadonlySet<string> = new Set<AttachmentEditAction['action']>(['upload-attachment', 'remove-attachment']);

interface RegistryEntry extends Record<string, unknown> {
  file: string;
  name: string;
  kind: 'image' | 'pdf';
  mime: string;
  bytes: number;
  addedAt: string;
  addedBy: string | null;
}
// 2026-11-09: legacy cover and unknown metadata are opaque, preserved data, never part of the public attachment view.
interface RegistryData extends Record<string, unknown> {
  schema: 1;
  card: string;
  files: RegistryEntry[];
}
interface ParsedRegistry {
  data: RegistryData;
  hash: string;
  bytes: Buffer;
  yaml: string;
  yamlStart: number;
  files: YAMLSeq;
  mapFlow: boolean;
  filesIndent: string;
  emptyIndent: string;
  newline: string;
}
type RegistryTextEdit = { start: number; end: number; text: string };
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

/** Thrown for card identifiers that cannot name an attachment directory; app.ts answers 400 (2026-11-06). */
export class InvalidAttachmentIdError extends Error {}

/** Native UUIDs are directory names; legacy IDs contain path separators and punctuation, so hash them. */
export function attachmentKey(cardId: string): string {
  const native = nativeCardIdPattern.exec(cardId);
  if (native) return native[1].toLowerCase();
  if (!boundedText(cardId, 1000) || !/^(card|task|hero|doc):\S/u.test(cardId)) throw new InvalidAttachmentIdError(serverText(messages).invalidAttachmentId);
  return 'legacy-' + createHash('sha256').update(cardId).digest('hex').slice(0, 16);
}

function isCardAttachmentPath(value: string, key: string): boolean {
  const match = attachmentPathPattern.exec(value);
  return match !== null && match[1] === key && !value.includes('..');
}

export function decodeAttachment(dataUrl: string): { bytes: Buffer; extension: string; mime: string; kind: 'image' | 'pdf' } {
  return decodeAssetDataUrl(dataUrl, {
    allowed: ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'],
    maximumBytes: maximumAttachmentBytes, headerAllowance: 48,
    error: failure => {
      const text = serverText(messages);
      return new Error({ sizeLimit: text.attachmentTooLarge, dataUrl: text.invalidAttachmentData,
        canonicalBase64: text.noncanonicalBase64, contentType: text.attachmentTypeMismatch }[failure]);
    },
  });
}

/** Check each ancestor while descending, through the shared guards in guarded-files.ts. */
async function attachmentDirectory(root: string, key: string, create: boolean, exactDirectory?: string): Promise<DirectoryGuard | null> {
  // 2026-11-05: an existing per-card registry wins over the presence of a newer assets root.
  const relativeDirectory = exactDirectory ?? path.posix.dirname(await resolveDataPath(root, `${cardAttachmentsDirectory}/${key}/${registryFileName}`));
  if (!/^tasks\/(?:deckmate|freetion)-assets\/cards\/[a-z0-9-]{6,80}$/u.test(relativeDirectory)
    || path.posix.basename(relativeDirectory) !== key) throw new Error(serverText(messages).invalidAttachmentDirectory);
  return guardedDirectory(root, relativeDirectory, {
    create, missing: 'null', rootReference: 'absolute',
    messages: () => ({ invalidRoot: serverText(messages).invalidProjectRoot,
      rootChanged: serverText(messages).attachmentRootChanged, pathChanged: serverText(messages).attachmentPathChanged,
      directoryLink: serverText(messages).unsafeAttachmentDirectory }),
  });
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
  return checkGuardedFile(guard, filename, {
    checkBefore: false, resolvePath: () => containedFile(guard.root, relativePath),
    invalidFile: () => serverText(messages).attachmentMustBeFile,
  });
}

function validAddedAt(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}

// 2026-11-09: retain the raw parse result for post-write verification; projecting known fields would hide data loss.
function validateRegistry(value: unknown, cardId: string): asserts value is RegistryData {
  const key = attachmentKey(cardId);
  if (!record(value) || value.schema !== 1 || value.card !== cardId) throw new Error(serverText(messages).registryCardMismatch);
  const filesValue = value.files;
  if (!Array.isArray(filesValue) || filesValue.length > maximumRegistryEntries) throw new Error(serverText(messages).invalidAttachmentList);
  const filePaths = filesValue.map(entry => {
    if (!record(entry) || !boundedText(entry.file, 300) || !isCardAttachmentPath(entry.file, key)) throw new Error(serverText(messages).invalidRegistryPath);
    const extension = entry.file.split('.').pop() as keyof typeof mimeByExtension;
    const expected = mimeByExtension[extension];
    const { name, kind, mime, bytes, addedAt, addedBy } = entry;
    if (!expected || !boundedText(name, 200) || kind !== expected.kind || mime !== expected.mime) throw new Error(serverText(messages).registryFileMismatch);
    if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes < 1 || bytes > maximumAttachmentBytes) throw new Error(serverText(messages).invalidRegistrySize);
    if (!validAddedAt(addedAt)) throw new Error(serverText(messages).invalidRegistryDate);
    if (addedBy !== null && (typeof addedBy !== 'string' || !boundedText(addedBy, 80))) throw new Error(serverText(messages).invalidRegistryAuthor);
    return entry.file;
  });
  if (new Set(filePaths).size !== filePaths.length) throw new Error(serverText(messages).duplicateAttachments);
}

function parseRegistry(bytes: Buffer, cardId: string): ParsedRegistry {
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new Error(serverText(messages).invalidAttachmentList); }
  const match = registryHeadPattern.exec(text);
  if (!match || match.index !== 0) throw new Error(serverText(messages).missingRegistryHeader);
  const yaml = match[2];
  const document = parseDocument(yaml, { keepSourceTokens: true });
  if (document.errors.length || !isMap(document.contents)) throw new Error(serverText(messages).invalidAttachmentList);
  let value: unknown;
  try { value = document.toJS({ maxAliasCount: 0 }); }
  catch { throw new Error(serverText(messages).invalidAttachmentList); }
  validateRegistry(value, cardId);
  const files = document.get('files', true);
  const key = document.contents.items.find(pair => isScalar(pair.key) && pair.key.value === 'files')?.key;
  if (!isSeq(files) || !files.range || !files.srcToken || !isScalar(key) || !key.range) throw new Error(serverText(messages).invalidAttachmentList);
  const keyColumn = key.range[0] - (yaml.lastIndexOf('\n', key.range[0] - 1) + 1);
  const emptyIndent = ' '.repeat(keyColumn + 2);
  const filesIndent = files.srcToken.type === 'block-seq' ? ' '.repeat(files.srcToken.indent) : emptyIndent;
  return { data: value, hash: digest(bytes), bytes, yaml, files, filesIndent, emptyIndent, newline: match[1],
    mapFlow: document.contents.flow ?? false, yamlStart: Buffer.byteLength(text.slice(0, text.indexOf('\n') + 1)) };
}

const registryBriefs = {
  en: "\n# Card attachments\n\nA Deckmate-managed file: the card's attachment list.\nThe files sit beside it in the same directory; entries are written by the Deckmate server. Edit through the interface or API, not by hand.\n",
  ru: '\n# Вложения карточки\n\nУправляемый файл Deckmate: список вложений карточки.\nФайлы лежат рядом в этом же каталоге; записи пишет сервер Deckmate. Правьте через интерфейс или API, не руками.\n',
} as const satisfies Record<FormatLanguage, string>;

/** A new registry gets a header in the project's format language; a project without a manifest is new and reads English. */
async function registryBrief(root: string): Promise<string> {
  return registryBriefs[await projectLanguage(root)];
}

function registryLineEnd(yaml: string, offset: number): number {
  const newline = yaml.indexOf('\n', offset);
  return newline < 0 ? yaml.length : newline + 1;
}

function blockItemRange(previous: ParsedRegistry, index: number): [number, number] {
  const token = previous.files.srcToken;
  const item = previous.files.items[index];
  const marker = token?.type === 'block-seq'
    ? token.items.filter(item => item.value)[index]?.start.find(part => part.type === 'seq-item-ind') : undefined;
  if (!marker || !isMap(item) || !item.range) throw new Error(serverText(messages).invalidAttachmentList);
  const start = previous.yaml.lastIndexOf('\n', marker.offset - 1) + 1;
  // 2026-11-09: node-end may include standalone comments and even the next item's indentation; value-end does not.
  const end = item.range[1];
  return [start, previous.yaml[end - 1] === '\n' ? end : registryLineEnd(previous.yaml, end)];
}

function appendRegistryItem(previous: ParsedRegistry, entry: RegistryEntry): RegistryTextEdit[] {
  const { files, yaml, newline, filesIndent } = previous;
  const token = files.srcToken;
  if (!files.range || !token) throw new Error(serverText(messages).invalidAttachmentList);
  if (token.type === 'flow-collection' && (files.items.length || previous.mapFlow)) {
    const last = files.items.at(-1);
    if (last !== undefined && (!isMap(last) || !last.range)) throw new Error(serverText(messages).invalidAttachmentList);
    const start = isMap(last) && last.range ? last.range[1] : files.range[0] + 1;
    const value = stringify(entry, { collectionStyle: 'flow', lineWidth: 0 }).replace(/\n$/u, '');
    return [{ start, end: start, text: (files.items.length ? ', ' : '') + value }];
  }
  const block = filesIndent + stringify([entry], { lineWidth: 0 }).replace(/\n$/u, '').replace(/\n/gu, newline + filesIndent) + newline;
  if (token.type === 'block-seq') {
    const [, end] = blockItemRange(previous, files.items.length - 1);
    return [{ start: end, end, text: block }];
  }
  if (token.type !== 'flow-collection') throw new Error(serverText(messages).invalidAttachmentList);
  const close = token.end.find(part => part.type === 'flow-seq-end');
  if (!close) throw new Error(serverText(messages).invalidAttachmentList);
  const start = token.start.offset;
  const lineStart = yaml.lastIndexOf('\n', start - 1) + 1;
  const lineEnd = registryLineEnd(yaml, close.offset + 1);
  if (/^[ \t]*$/u.test(yaml.slice(lineStart, start)) && /^\s*$/u.test(yaml.slice(start + 1, close.offset))
    && /^\s*$/u.test(yaml.slice(close.offset + 1, lineEnd))) {
    return [{ start: lineStart, end: lineEnd, text: block }];
  }
  // 2026-11-09: removing just the brackets leaves empty-list comments in place, including those on files: itself.
  return [{ start, end: start + 1, text: '' }, { start: close.offset, end: close.offset + 1, text: '' },
    { start: lineEnd, end: lineEnd, text: block }];
}

function removeRegistryItem(previous: ParsedRegistry, index: number): RegistryTextEdit[] {
  const { files } = previous;
  const token = files.srcToken;
  const item = files.items[index];
  if (!isMap(item) || !item.range || !token) throw new Error(serverText(messages).invalidAttachmentList);
  if (token.type === 'block-seq') {
    const [start, end] = blockItemRange(previous, index);
    return [{ start, end, text: files.items.length === 1 ? previous.emptyIndent + '[]' + previous.newline : '' }];
  }
  if (token.type !== 'flow-collection') throw new Error(serverText(messages).invalidAttachmentList);
  const properties = token.items[index].start.filter(part => part.type === 'anchor' || part.type === 'tag');
  const start = Math.min(item.range[0], ...properties.map(part => part.offset));
  const edits: RegistryTextEdit[] = [{ start, end: item.range[1], text: '' }];
  const separatorIndex = index < files.items.length - 1 || files.items.length === 1 ? index + 1 : index;
  const comma = token.items[separatorIndex]?.start.find(part => part.type === 'comma');
  if (comma) edits.push({ start: comma.offset, end: comma.offset + 1, text: '' });
  else if (files.items.length > 1) throw new Error(serverText(messages).invalidAttachmentList);
  return edits;
}

function renderRegistry(data: RegistryData, previous: ParsedRegistry | null, body: string): Buffer {
  if (!previous) return Buffer.from('---\n' + stringify(data, { lineWidth: 0 }) + '---\n' + body, 'utf8');
  let edits: RegistryTextEdit[];
  if (data.files.length === previous.data.files.length + 1) edits = appendRegistryItem(previous, data.files.at(-1)!);
  else if (data.files.length === previous.data.files.length - 1) {
    const removedIndex = previous.data.files.findIndex(entry => !data.files.some(file => file.file === entry.file));
    edits = removeRegistryItem(previous, removedIndex);
  } else throw new Error(serverText(messages).registryRewriteChangesData);
  // 2026-11-09: source offsets are UTF-16 positions; only the changed spans are encoded and spliced into the original bytes.
  let bytes = previous.bytes;
  for (const edit of edits.sort((first, second) => second.start - first.start)) {
    const start = previous.yamlStart + Buffer.byteLength(previous.yaml.slice(0, edit.start));
    const end = previous.yamlStart + Buffer.byteLength(previous.yaml.slice(0, edit.end));
    bytes = Buffer.concat([bytes.subarray(0, start), Buffer.from(edit.text), bytes.subarray(end)]);
  }
  return bytes;
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
  const body = previous ? '' : await registryBrief(guard.root);
  const nextBytes = renderRegistry(data, previous, body);
  const reparsed = parseRegistry(nextBytes, cardId);
  // 2026-11-09: data includes raw opaque fields, not merely the public attachment projection.
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
    if (renamed) {
      // 2026-11-09: publication is irreversible; callers must not roll back files referenced by the new registry.
      if (error && typeof error === 'object') Object.assign(error, { saved: true });
      throw error;
    }
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
  const { remove } = await writeGuardedNewFile(guard, relativePath, decoded.bytes, {
    checkFile: () => checkedAttachmentFile(guard, relativePath), missing: 'throw', close: 'suppress-secondary',
    replaced: () => serverText(messages).attachmentReplaced,
    beforeWrite: () => serverText(messages).attachmentChangedBeforeWrite,
    afterWrite: () => serverText(messages).attachmentChangedOnWrite,
    cleanupFailed: () => serverText(messages).attachmentCleanupFailed,
  });
  return { relativePath, remove };
}

/** Read the card's attachment registry and check that each listed file exists. */
export async function readCardAttachments(root: string, cardId: string): Promise<CardAttachments> {
  const key = attachmentKey(cardId);
  const guard = await attachmentDirectory(root, key, false);
  if (!guard) return { hash: '', files: [], warnings: [] };
  const registry = await readRegistry(guard, cardId);
  if (!registry) return { hash: '', files: [], warnings: [] };
  const files: CardAttachment[] = [];
  const warnings: string[] = [];
  for (const entry of registry.parsed.data.files) {
    let missing = false;
    try { await checkedAttachmentFile(guard, entry.file); }
    catch { missing = true; warnings.push(serverText(messages).missingAttachment(entry.name)); }
    const { file, name, kind, mime, bytes, addedAt, addedBy } = entry;
    files.push({ file, name, kind, mime, bytes, addedAt, addedBy, ...(missing ? { missing: true } : {}) });
  }
  return { hash: registry.parsed.hash, files, warnings };
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
    const previous = registry?.parsed.data ?? { schema: 1 as const, card: edit.cardId, files: [] };
    if (previous.files.length >= maximumRegistryEntries) throw new Error(serverText(messages).tooManyAttachments);
    const entry: RegistryEntry = { file: asset.relativePath, name: await displayFileName(root, edit.fileName, decoded.extension),
      kind: decoded.kind, mime: decoded.mime, bytes: decoded.bytes.length, addedAt: new Date().toISOString(), addedBy };
    const data = { ...previous, files: [...previous.files, entry] };
    await publishRegistry(guard, edit.cardId, edit.attachmentsHash, data, registry?.parsed ?? null);
  } catch (error) {
    if (error && typeof error === 'object' && 'saved' in error && error.saved === true) throw error;
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
  const data = { ...registry.parsed.data, files: registry.parsed.data.files.filter(file => file.file !== edit.file) };
  await publishRegistry(guard, edit.cardId, edit.attachmentsHash, data, registry.parsed);
  // 2026-11-09: only confirmed publication permits deleting the file; leftovers are unused data, not data loss.
  try { await checkedAttachmentFile(guard, edit.file); await unlink(path.join(guard.root, edit.file)); }
  catch {
    throw Object.assign(new Error(serverText(messages).attachmentFileBusy), { saved: true });
  }
}

let queuedWrite: Promise<unknown> = Promise.resolve();

/** Serialize attachment edits through one queue to prevent registry races. */
export function applyAttachmentEdit(root: string, edit: AttachmentEditAction): Promise<void> {
  const operation = queuedWrite.then(async () => {
    if (edit.action === 'upload-attachment') return uploadAttachment(root, edit);
    if (edit.action === 'remove-attachment') return removeAttachment(root, edit);
  });
  queuedWrite = operation.catch(() => {});
  return operation;
}
