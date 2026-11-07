import { defineText, serverText, serverLang } from './i18n.ts';
import { createHash, randomUUID } from 'node:crypto';
import { link, lstat, mkdir, open, readFile, readdir, realpath, rename, unlink } from 'node:fs/promises';
import type { BigIntStats } from 'node:fs';
import path from 'node:path';
import { catalogFileChanged } from './catalog-snapshot.ts';
import { isDeepStrictEqual } from 'node:util';
import { isMap, isScalar, isSeq, parse, parseDocument, stringify } from 'yaml';
import { parseCached } from './parse-cache.ts';
import type { ByteRange } from '../src/contracts.ts';
import type { CardKind, CardPriority, CatalogCard, CatalogDocument } from '../src/catalog-contracts.ts';
import { canonicalDataPath } from '../src/brand-compat.ts';
import { resolveDataPath } from './data-paths.ts';
import { cardStates, cardStateWords, readCardState, writeCardState, type CardState, type FormatLanguage } from '../src/format-vocabulary.ts';

const messages = defineText({
  explicitYamlRequired: (field: string) => `The ${field} field must have an explicit YAML value.`,
  yamlFieldsChanged: (field: string) => `Editing ${field} would change other YAML frontmatter fields.`,
  invalidProjectRoot: "The project root is invalid or has been replaced.",
  cardNotFound: "Card not found.",
  cardFileNotFound: "Card file not found.",
  journeyParentMove: "A Journey card cannot move to another Hero separately from its Journey.",
  invalidManagedPath: "Invalid managed Markdown file path.",
  reservedStepName: "The step name is reserved by Windows.",
  markdownDirectoryChanged: "The Markdown directory changed or contains a symbolic link.",
  invalidDirectory: "Invalid directory.",
  invalidDirectoryPath: "Invalid directory path.",
  markdownDirectoryLink: "The Markdown directory contains a symbolic link.",
  fileOutsideManagedDirectory: "The file is outside the managed directory.",
  markdownFileChanged: "The Markdown file changed or contains a symbolic link.",
  markdownChangedOnOpen: "The Markdown file changed while opening it.",
  managedHeaderMissing: "The managed Markdown file has no YAML frontmatter.",
  headerObjectRequired: "YAML frontmatter must contain an object.",
  markdownCleanupFailed: "Could not safely remove the temporary Markdown file.",
  invalidCardMetadata: "Invalid card metadata or UUID.",
  invalidCardHeader: "Invalid card YAML frontmatter or the ID does not match the filename.",
  heroCannotBeChild: "A Hero cannot be a Sub Card.",
  nonTaskState: "Docs and Heroes do not have a task state.",
  invalidCardIteration: "Invalid card iteration number.",
  invalidCardDependencies: "Invalid card dependency list.",
  invalidEffort: "Invalid card Effort.",
  invalidPriority: "Invalid card Priority.",
  invalidJourneyLink: "Invalid card Journey link.",
  notRegularFile: ": not a regular file (possibly a symbolic link); skipped.",
  fileDisappeared: ": the file disappeared while reading.",
  invalidMarkdownContent: "Invalid Markdown file content.",
  temporaryCleanupFailed: "Could not remove the temporary file.",
  cardHashRequired: "Editing the card needs its current version. Refresh the catalog and try again.",
  invalidCardEditFields: "Invalid card edit fields.",
  invalidMarkdownPath: "Invalid Markdown document path.",
  cardHeaderParseFailed: "Invalid card YAML frontmatter.",
  invalidCardField: "Invalid card field.",
  parentKindUneditable: "Only Tasks and Docs can change parents.",
  invalidCardProperties: "Invalid card properties.",
  invalidTaskState: `Invalid Task state. Use one of: ${cardStates.flatMap(cardStateWords).join(', ')}.`,
  invalidOwner: "Owner must be a single line of up to 120 characters.",
  explicitPropertyValueRequired: "A card property must have an explicit value or null.",
  invalidContentFields: "Invalid content edit fields.",
}, {
  explicitYamlRequired: (field: string) => `Поле ${field} должно быть явным YAML-значением.`,
  yamlFieldsChanged: (field: string) => `Правка ${field} изменила бы другие поля YAML-шапки.`,
  invalidProjectRoot: "Некорректный или подменённый корень проекта.",
  cardNotFound: "Карточка не найдена.",
  cardFileNotFound: "Файл карточки не найден.",
  journeyParentMove: "Карточку Journey нельзя переносить к другому Hero отдельно от конвейера.",
  invalidManagedPath: "Недопустимый путь управляемого Markdown-файла.",
  reservedStepName: "Зарезервированное Windows имя шага.",
  markdownDirectoryChanged: "Каталог Markdown-файла изменился или содержит символическую ссылку.",
  invalidDirectory: "Недопустимый каталог.",
  invalidDirectoryPath: "Недопустимый путь каталога.",
  markdownDirectoryLink: "Каталог Markdown-файла содержит символическую ссылку.",
  fileOutsideManagedDirectory: "Файл за пределами управляемого каталога.",
  markdownFileChanged: "Markdown-файл изменился или содержит символическую ссылку.",
  markdownChangedOnOpen: "Markdown-файл изменился при открытии.",
  managedHeaderMissing: "Отсутствует YAML-шапка управляемого Markdown-файла.",
  headerObjectRequired: "YAML-шапка должна содержать объект.",
  markdownCleanupFailed: "Не удалось безопасно убрать временный Markdown-файл.",
  invalidCardMetadata: "Некорректные метаданные или UUID карточки.",
  invalidCardHeader: "Некорректная YAML-шапка карточки или ID не совпадает с именем файла.",
  heroCannotBeChild: "Hero не может быть подкарточкой.",
  nonTaskState: "Документ и Hero не имеют состояния задачи.",
  invalidCardIteration: "Некорректный номер итерации карточки.",
  invalidCardDependencies: "Некорректный список зависимостей карточки.",
  invalidEffort: "Некорректная цена карточки.",
  invalidPriority: "Некорректный приоритет карточки.",
  invalidJourneyLink: "Некорректная связь карточки с Journey.",
  notRegularFile: ": не обычный файл (символическая ссылка?) — пропущен.",
  fileDisappeared: ": файл исчез во время чтения.",
  invalidMarkdownContent: "Некорректное содержимое Markdown-файла.",
  temporaryCleanupFailed: "Не удалось очистить временный файл.",
  cardHashRequired: "Для правки нужна актуальная версия карточки. Обновите каталог и повторите действие.",
  invalidCardEditFields: "Недопустимые поля правки карточки.",
  invalidMarkdownPath: "Недопустимый путь Markdown-документа.",
  cardHeaderParseFailed: "Некорректная YAML-шапка карточки.",
  invalidCardField: "Недопустимое поле карточки.",
  parentKindUneditable: "Только Task и Doc могут менять родителя.",
  invalidCardProperties: "Недопустимые свойства карточки.",
  invalidTaskState: `Недопустимое состояние Task. Допустимо: ${cardStates.flatMap(cardStateWords).join(', ')}.`,
  invalidOwner: "Исполнитель — одна строка до 120 символов.",
  explicitPropertyValueRequired: "Свойство карточки должно иметь явное значение или null.",
  invalidContentFields: "Недопустимые поля правки содержимого.",
});


const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const nativePath = new RegExp('^cards/(' + uuid + ')\\.md$', 'i');
const journeyPath = new RegExp('^tasks/(?:journeys|journey-templates)/(' + uuid + ')/(index\\.md|steps/[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}\\.md)$', 'i');
const journeyDirectory = new RegExp('^tasks/(?:journeys|journey-templates)/(' + uuid + ')(/steps)?$', 'i');
const activityPath = new RegExp('^tasks/(?:deckmate|freetion)-activity/([0-9]{8}T[0-9]{9}Z)-(' + uuid + ')\\.md$', 'i');
const nativeId = new RegExp('^card:(' + uuid + ')$', 'iu');
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export interface NativeCardMetadata extends Record<string, unknown> {
  deckmate?: 'card';
  freetion?: 'card';
  schema: 1;
  id: string;
  kind: CardKind;
  title: string;
  state: CardState | (string & {}) | null;
  owner: string | null;
  deckId: string | null;
  trackIds: string[];
  parentId: string | null;
  iteration?: number | null;
  dependsOn?: string[];
  effort?: number | null;
  priority?: CardPriority | null;
  journey?: { journeyId: string; version: number; stepId: string; instanceId: string };
}

export interface ManagedMarkdownFile {
  bytes: Buffer;
  metadata: Record<string, unknown>;
  markdown: string;
  bodyRange: ByteRange;
  fileHash: string;
}

export interface NativeCardFile extends ManagedMarkdownFile {
  metadata: NativeCardMetadata;
  card: CatalogCard;
  document: CatalogDocument;
}

interface DirectoryIdentity { filename: string; stat: BigIntStats }
interface DirectoryGuard { root: string; directory: string; parents: DirectoryIdentity[] }
interface TemporaryFile { filename: string; stat: BigIntStats }

function sameIdentity(first: BigIntStats, second: BigIntStats): boolean {
  return first.dev === second.dev && first.ino === second.ino;
}
function samePath(first: string, second: string): boolean { return path.relative(first, second) === ''; }
function missing(error: unknown): boolean { return (error as NodeJS.ErrnoException).code === 'ENOENT'; }

function checkedPath(relativePath: string): { directory: string; id: string } {
  const actualDirectory = path.posix.dirname(relativePath);
  relativePath = canonicalDataPath(relativePath);
  if (relativePath === 'tasks/deckmate.md') return { directory: 'tasks', id: 'manifest' };
  if (relativePath === 'tasks/deckmate-tags.md') return { directory: 'tasks', id: 'project-tags' };
  if (relativePath === 'tasks/deckmate-runs.md') return { directory: 'tasks', id: 'runs' };
  if (relativePath === 'tasks/deckmate-milestones.md') return { directory: 'tasks', id: 'milestones' };
    if (relativePath === 'tasks/deckmate-planning-history.md') return { directory: 'tasks', id: 'planning-history' };
  if (relativePath === 'tasks/deckmate-card-options.md') return { directory: 'tasks', id: 'card-options' };
  if (relativePath === 'tasks/deckmate-notifications.md') return { directory: 'tasks', id: 'notifications' };
  const activity = activityPath.exec(relativePath);
  if (activity) return { directory: actualDirectory, id: activity[2] };
  const card = nativePath.exec(relativePath);
  if (card) return { directory: 'cards', id: card[1] };
  const journey = journeyPath.exec(relativePath);
  if (!journey) throw new Error(serverText(messages).invalidManagedPath);
  const basename = path.posix.basename(relativePath).replace(/\.md$/iu, '');
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu.test(basename)) throw new Error(serverText(messages).reservedStepName);
  return { directory: path.posix.dirname(relativePath), id: journey[1] };
}

async function checkGuard(guard: DirectoryGuard): Promise<void> {
  for (const parent of guard.parents) {
    const current = await lstat(parent.filename, { bigint: true });
    if (!current.isDirectory() || current.isSymbolicLink() || !sameIdentity(current, parent.stat)
      || !samePath(await realpath(parent.filename), parent.filename)) {
      throw new Error(serverText(messages).markdownDirectoryChanged);
    }
  }
}

async function managedDirectory(root: string, relative: string, create: boolean): Promise<DirectoryGuard | null> {
  if (!['cards', 'tasks', 'tasks/journeys', 'tasks/deckmate-activity'].includes(canonicalDataPath(relative)) && !journeyDirectory.test(relative)) throw new Error(serverText(messages).invalidDirectory);
  return guardedDirectory(root, relative, create);
}

function canonicalRelativePath(relative: string): boolean {
  return relative.length > 0 && !/[\\:\u0000]/u.test(relative)
    && relative.split('/').every(part => part.length > 0 && part !== '.' && part !== '..' && !/[. ]$/u.test(part));
}

async function guardedDirectory(root: string, relative: string, create: boolean): Promise<DirectoryGuard | null> {
  if (!canonicalRelativePath(relative)) throw new Error(serverText(messages).invalidDirectoryPath);
  const absoluteRoot = path.resolve(root);
  const rootStat = await lstat(absoluteRoot, { bigint: true });
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || !samePath(await realpath(absoluteRoot), absoluteRoot)) {
    throw new Error(serverText(messages).invalidProjectRoot);
  }
  const guard: DirectoryGuard = { root: absoluteRoot, directory: absoluteRoot, parents: [{ filename: absoluteRoot, stat: rootStat }] };
  for (const part of relative.split('/')) {
    await checkGuard(guard);
    const directory = path.join(guard.directory, part);
    let stat: BigIntStats;
    try { stat = await lstat(directory, { bigint: true }); }
    catch (error) {
      if (!missing(error)) throw error;
      if (!create) return null;
      // 2026-11-03: each ancestor is checked before mkdir; recursive mkdir could follow a junction.
      await checkGuard(guard);
      try { await mkdir(directory); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      stat = await lstat(directory, { bigint: true });
    }
    if (!stat.isDirectory() || stat.isSymbolicLink() || !samePath(await realpath(directory), directory)) {
      throw new Error(serverText(messages).markdownDirectoryLink);
    }
    guard.parents.push({ filename: directory, stat });
    guard.directory = directory;
    await checkGuard(guard);
  }
  return guard;
}

async function checkFile(guard: DirectoryGuard, filename: string, expected?: BigIntStats): Promise<BigIntStats> {
  await checkGuard(guard);
  if (!samePath(path.dirname(filename), guard.directory)) throw new Error(serverText(messages).fileOutsideManagedDirectory);
  const stat = await lstat(filename, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink() || !samePath(await realpath(filename), filename)
    || (expected && !sameIdentity(stat, expected))) throw new Error(serverText(messages).markdownFileChanged);
  await checkGuard(guard);
  return stat;
}

async function readBytes(guard: DirectoryGuard, filename: string): Promise<Buffer> {
  const expected = await checkFile(guard, filename);
  const handle = await open(filename, 'r');
  try {
    const opened = await handle.stat({ bigint: true });
    if (!sameIdentity(expected, opened)) throw new Error(serverText(messages).markdownChangedOnOpen);
    const bytes = await handle.readFile();
    await checkFile(guard, filename, opened);
    return bytes;
  } finally { await handle.close(); }
}

// 2026-11-04: reading each file checks every ancestor with lstat and realpath.
// Cache guards by root and directory, comparing parent identities with their creation-time values.
// Rebuild the guard when a parent directory changes
// to preserve the checks performed by a fresh guard on every call.
const readGuards = new Map<string, DirectoryGuard>();

async function readingGuard(root: string, relative: string): Promise<DirectoryGuard | null> {
  const key = JSON.stringify([root, relative]);
  const memoized = readGuards.get(key);
  if (memoized !== undefined) {
    try { await checkGuard(memoized); return memoized; }
    catch { readGuards.delete(key); }
  }
  const fresh = await guardedDirectory(root, relative, false);
  if (fresh !== null) readGuards.set(key, fresh);
  return fresh;
}

/**
 * 2026-11-04: scans and preliminary reads use readBytes checks without repeating guard walks after reading.
 * Bytes come from the open descriptor; publishing rechecks the file before writing (publishBytes -> readBytes).
 */
async function readBytesOnce(guard: DirectoryGuard, filename: string): Promise<Buffer> {
  await checkGuard(guard);
  if (!samePath(path.dirname(filename), guard.directory)) throw new Error(serverText(messages).fileOutsideManagedDirectory);
  const expected = await lstat(filename, { bigint: true });
  if (!expected.isFile() || expected.isSymbolicLink() || !samePath(await realpath(filename), filename)) {
    throw new Error(serverText(messages).markdownFileChanged);
  }
  const handle = await open(filename, 'r');
  try {
    const opened = await handle.stat({ bigint: true });
    if (!sameIdentity(expected, opened)) throw new Error(serverText(messages).markdownChangedOnOpen);
    return await handle.readFile();
  } finally { await handle.close(); }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseManaged(bytes: Buffer): ManagedMarkdownFile & { yamlRange: ByteRange; newline: string } {
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  const match = /^(?:\uFEFF)?---(\r?\n)([\s\S]*?)^---[ \t]*(?:\r?\n|$)/mu.exec(text);
  if (!match || match.index !== 0) throw new Error(serverText(messages).managedHeaderMissing);
  const metadata: unknown = parse(match[2]);
  if (!record(metadata)) throw new Error(serverText(messages).headerObjectRequired);
  const yamlStart = text.indexOf('\n') + 1;
  const bodyStart = Buffer.byteLength(match[0]);
  return {
    bytes, metadata, markdown: text.slice(match[0].length),
    bodyRange: { start: bodyStart, end: bytes.length }, fileHash: digest(bytes),
    yamlRange: { start: Buffer.byteLength(text.slice(0, yamlStart)), end: Buffer.byteLength(text.slice(0, yamlStart + match[2].length)) },
    newline: match[1],
  };
}

/** 2026-11-05: create a new project's managed-data directory with the same junction-safe walk as card folders. */
export async function ensureManagedDirectory(root: string, relative: 'tasks'): Promise<void> {
  await managedDirectory(root, relative, true);
}

export async function readManagedMarkdown(root: string, relativePath: string): Promise<ManagedMarkdownFile | null> {
  relativePath = await resolveDataPath(root, relativePath);
  const target = checkedPath(relativePath);
  const guard = await readingGuard(root, target.directory);
  if (!guard) return null;
  try { return parseManaged(await readBytesOnce(guard, path.join(guard.root, relativePath))); }
  catch (error) { if (missing(error)) return null; throw error; }
}

/**
 * 2026-11-06: scans read a file named by listManagedMarkdown the way card scans read cards/ (readNativeCards):
 * as an ordinary document beneath the resolved project root, symlinks rejected, parsed once per path and content
 * hash. readManagedMarkdown re-walks every ancestor with lstat and realpath twice per file, about 1.5 ms on Windows,
 * so a deck feed over a 475-entry journal took 0.7-1.7 s. Writes keep the guarded primitives.
 * `interpret` must be a pure function of the file; its result is shared between callers and must not be edited.
 */
export async function scanManagedMarkdown<T>(rootDirectory: string, relativePath: string, namespace: string,
  interpret: (file: ManagedMarkdownFile) => T): Promise<T | null> {
  checkedPath(relativePath);
  const filename = path.join(rootDirectory, relativePath);
  let bytes: Buffer;
  try {
    if (!(await lstat(filename)).isFile()) throw new Error(relativePath + serverText(messages).notRegularFile);
    bytes = await readFile(filename);
  } catch (error) { if (missing(error)) return null; throw error; }
  return parseCached(namespace, JSON.stringify([relativePath, digest(bytes)]), bytes.length, () => interpret(parseManaged(bytes)));
}

export async function listManagedMarkdown(root: string, requestedDirectory: 'cards' | 'tasks/journeys' | 'tasks/deckmate-activity'): Promise<string[]> {
  const directory = await resolveDataPath(root, requestedDirectory);
  const guard = await managedDirectory(root, directory, false);
  if (!guard) return [];
  await checkGuard(guard);
  const names = await readdir(guard.directory);
  await checkGuard(guard);
  // 2026-11-03: index.md is the Journey publication marker; orphan steps are not visible Journeys.
  if (directory === 'tasks/journeys') {
    const paths: string[] = [];
    for (const name of names.sort()) {
      if (!nativeId.test('card:' + name)) continue;
      await checkGuard(guard);
      const child = await managedDirectory(root, directory + '/' + name, false);
      if (!child) continue;
      try {
        await lstat(path.join(child.directory, 'index.md'));
        paths.push(directory + '/' + name + '/index.md');
      } catch (error) { if (!missing(error)) throw error; }
      await checkGuard(child);
    }
    await checkGuard(guard);
    return paths;
  }
  // 2026-11-03: invalid .md names are returned too, so callers report them instead of silently omitting data.
  return names.filter(name => /\.md$/iu.test(name)).sort().map(name => directory + '/' + name);
}

async function removeTemporary(guard: DirectoryGuard, temporary: TemporaryFile): Promise<void> {
  try { await checkFile(guard, temporary.filename, temporary.stat); }
  catch (error) { if (missing(error)) { await checkGuard(guard); return; } throw error; }
  await unlink(temporary.filename);
}

async function writeTemporary(guard: DirectoryGuard, bytes: Buffer): Promise<TemporaryFile> {
  await checkGuard(guard);
  const filename = path.join(guard.directory, '.' + randomUUID() + '.tmp');
  const handle = await open(filename, 'wx');
  let temporary: TemporaryFile | undefined;
  try {
    temporary = { filename, stat: await handle.stat({ bigint: true }) };
    await checkFile(guard, filename, temporary.stat);
    await handle.writeFile(bytes);
    await checkFile(guard, filename, temporary.stat);
    return temporary;
  } catch (error) {
    await handle.close();
    if (temporary) {
      try { await removeTemporary(guard, temporary); }
      catch (cleanupError) { throw new AggregateError([error, cleanupError], serverText(messages).markdownCleanupFailed); }
    }
    throw error;
  } finally { await handle.close(); }
}

function savedError(error: unknown, saved: boolean): Error {
  const failure = error instanceof Error ? error : new Error(String(error));
  if (saved) Object.assign(failure, { saved: true });
  return failure;
}

function stringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string' && item.length > 0) && new Set(value).size === value.length;
}

export function validateNativeCardMetadata(value: unknown, id: string): NativeCardMetadata {
  if (!record(value) || !nativeId.test('card:' + id)) throw new Error(serverText(messages).invalidCardMetadata);
  if ((value.deckmate ?? value.freetion) !== 'card' || value.schema !== 1 || value.id !== id
    || typeof value.kind !== 'string' || !['task', 'hero', 'doc'].includes(value.kind) || typeof value.title !== 'string' || !value.title.trim()
    || !['state', 'owner', 'deckId', 'parentId'].every(key => value[key] === null || typeof value[key] === 'string')
    || !stringList(value.trackIds)) throw new Error(serverText(messages).invalidCardHeader);
  if (value.kind === 'hero' && value.parentId !== null) throw new Error(serverText(messages).heroCannotBeChild);
  if (value.kind !== 'task' && value.state !== null) throw new Error(serverText(messages).nonTaskState);
  if (typeof value.state === 'string' && readCardState(value.state) === undefined) throw new Error(serverText(messages).invalidTaskState);
  if (value.iteration !== undefined && value.iteration !== null && (!Number.isInteger(value.iteration) || Number(value.iteration) < 0)) {
    throw new Error(serverText(messages).invalidCardIteration);
  }
  if (value.dependsOn !== undefined && !stringList(value.dependsOn)) throw new Error(serverText(messages).invalidCardDependencies);
  if (value.effort !== undefined && value.effort !== null
    && (typeof value.effort !== 'number' || !Number.isFinite(value.effort) || value.effort < 0)) throw new Error(serverText(messages).invalidEffort);
  if (value.priority !== undefined && value.priority !== null && !['high', 'medium', 'low'].includes(value.priority as string)) {
    throw new Error(serverText(messages).invalidPriority);
  }
  if (value.journey !== undefined) {
    const journey = value.journey;
    if (!record(journey) || !['journeyId', 'stepId', 'instanceId'].every(key => typeof journey[key] === 'string' && journey[key].length > 0)
      || !Number.isInteger(journey.version) || Number(journey.version) < 1) throw new Error(serverText(messages).invalidJourneyLink);
  }
  return value as NativeCardMetadata;
}

function nativeFile(relativePath: string, managed: ManagedMarkdownFile): NativeCardFile {
  const metadata = validateNativeCardMetadata(managed.metadata, checkedPath(relativePath).id);
  const card: CatalogCard = {
    id: 'card:' + metadata.id, kind: metadata.kind, path: relativePath, version: null,
    title: metadata.title, state: metadata.state === null ? null : readCardState(metadata.state)!, owner: metadata.owner, markdown: managed.markdown,
    sourceHash: managed.fileHash, range: metadata.kind === 'task' ? managed.bodyRange : null,
    deckId: metadata.deckId, trackIds: metadata.trackIds, parentId: metadata.parentId,
  };
  if (metadata.iteration !== undefined) card.iteration = metadata.iteration;
  if (metadata.dependsOn !== undefined) card.dependsOn = metadata.dependsOn;
  if (metadata.effort !== undefined) card.effort = metadata.effort;
  if (metadata.priority !== undefined) card.priority = metadata.priority;
  if (metadata.journey !== undefined) card.journey = metadata.journey;
  return { ...managed, metadata, card, document: { path: relativePath, title: metadata.title, hash: managed.fileHash } };
}

export async function readNativeCard(root: string, cardId: string): Promise<NativeCardFile | null> {
  const relativePath = nativeCardPath(cardId);
  if (!relativePath) return null;
  const managed = await readManagedMarkdown(root, relativePath);
  return managed ? nativeFile(relativePath, managed) : null;
}

/** Map card:<uuid> to cards/<uuid>.md; return null for other identifier formats. */
export function nativeCardPath(cardId: string): string | null {
  const match = nativeId.exec(cardId);
  return match ? 'cards/' + match[1] + '.md' : null;
}

export interface NativeCardsSnapshot {
  rootDirectory: string;
  language: ReturnType<typeof serverLang>;
  files: NativeCardFile[];
  warnings: string[];
}

export async function readNativeCards(root: string, selectedPaths?: readonly string[], previous?: NativeCardsSnapshot): Promise<NativeCardsSnapshot> {
  const files: NativeCardFile[] = [];
  const warnings: string[] = [];
  let rootDirectory = path.resolve(root);
  const language = serverLang();
  let selectedGuard: DirectoryGuard | null = null;
  let paths: string[];
  try {
    rootDirectory = await realpath(root);
    if (selectedPaths === undefined) paths = await listManagedMarkdown(root, 'cards');
    else {
      // 2026-11-05: named refreshes avoid listing cards/ while retaining its directory identity checks.
      selectedGuard = await managedDirectory(root, 'cards', false);
      if (!selectedGuard) return { rootDirectory, language, files, warnings };
      paths = [...new Set(selectedPaths)].filter(relative => /^cards\/[^/]+\.md$/iu.test(relative)).sort();
    }
  }
  catch (error) { return { rootDirectory, language, files, warnings: ['cards: ' + (error instanceof Error ? error.message : String(error))] }; }
  // 2026-11-04: scans read cards as ordinary documents beneath the resolved project root.
  // Edits still use guarded publication primitives; parsing is cached by content hash.
  const directory = path.join(rootDirectory, 'cards');
  const previousFiles = new Map(previous?.rootDirectory === rootDirectory && previous.language === language
    ? previous.files.map(file => [file.card.path, file]) : []);
  type ScanResult = { file: NativeCardFile; warning?: never } | { file?: never; warning: string };
  const results = await Promise.all(paths.map(async (relativePath): Promise<ScanResult | null> => {
    try {
      const filename = path.join(directory, path.posix.basename(relativePath));
      // Symlinks in cards/ could escape the project; skip them with a warning.
      if (!(await lstat(filename)).isFile()) return { warning: relativePath + serverText(messages).notRegularFile };
      const bytes = selectedGuard ? await readBytesOnce(selectedGuard, filename) : await readFile(filename);
      const fileHash = digest(bytes);
      // 2026-11-05: reuse only after filesystem checks and hashing fresh bytes;
      // mtime cannot detect an external edit that restores the original timestamp.
      const prior = previousFiles.get(relativePath);
      const file = prior?.fileHash === fileHash ? prior
        : parseCached('native-card', JSON.stringify([relativePath, fileHash]), bytes.length,
          () => nativeFile(relativePath, parseManaged(bytes)));
      return { file };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return selectedPaths === undefined
        ? { warning: relativePath + serverText(messages).fileDisappeared } : null;
      return { warning: relativePath + ': ' + (error instanceof Error ? error.message : String(error)) };
    }
  }));
  for (const result of results) {
    if (result === null) continue;
    if (result.warning !== undefined) warnings.push(result.warning);
    else files.push(result.file);
  }
  return { rootDirectory, language, files, warnings };
}

export async function createManagedMarkdown(root: string, relativePath: string, metadata: unknown, markdown: string, beforePublish?: () => Promise<void>): Promise<boolean> {
  relativePath = await resolveDataPath(root, relativePath);
  const target = checkedPath(relativePath);
  if (!record(metadata) || typeof markdown !== 'string') throw new Error(serverText(messages).invalidMarkdownContent);
  // Only the first manifest in a folder defaults to English; parsed legacy manifests never pass through this path.
  if (target.id === 'manifest' && metadata.formatLanguage === undefined) metadata = { ...metadata, formatLanguage: 'en' };
  if (target.directory === 'cards') validateNativeCardMetadata(metadata, target.id);
  const bytes = Buffer.from('---\n' + stringify(metadata, { lineWidth: 0 }) + '---\n' + markdown);
  const guard = (await managedDirectory(root, target.directory, true))!;
  const temporary = await writeTemporary(guard, bytes);
  const filename = path.join(guard.root, relativePath);
  let published = false;
  let failure: unknown;
  try {
    await beforePublish?.();
    await checkGuard(guard);
    await checkFile(guard, temporary.filename, temporary.stat);
    try {
      await link(temporary.filename, filename);
      published = true;
      catalogFileChanged(root, relativePath);
    }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    if (published) await checkFile(guard, filename, temporary.stat);
  } catch (error) { failure = error; }
  try { await removeTemporary(guard, temporary); }
  catch (error) { failure = failure ? new AggregateError([failure, error], serverText(messages).temporaryCleanupFailed) : error; }
  // 2026-11-03: publication never rolls back a final file; callers can rescan it after partial I/O failure.
  if (failure) throw savedError(failure, published);
  return published;
}

export async function editNativeCard(root: string, cardId: string, sourceHash: string, changes: { deckId?: string | null; trackIds?: string[] }, beforePublish?: () => Promise<void>): Promise<void> {
  if (typeof sourceHash !== 'string' || !sourceHash) throw new Error(serverText(messages).cardHashRequired);
  const existing = await readNativeCard(root, cardId);
  if (!existing) throw new Error(serverText(messages).cardNotFound);
  if (existing.fileHash !== sourceHash) throw new Error('CARD_CONFLICT');
  if (!record(changes) || Object.keys(changes).some(key => key !== 'deckId' && key !== 'trackIds')) throw new Error(serverText(messages).invalidCardEditFields);
  const bytes = patchNativeCardFields(existing, changes);
  if (bytes.equals(existing.bytes)) return;
  await publishManagedBytes(root, existing.card.path, sourceHash, bytes, beforePublish);
}

/**
 * Publish native-card bytes through a temporary file in a guarded directory,
 * rechecking the hash before an atomic rename. Mark partial success as saved.
 */
async function publishManagedBytes(root: string, relativePath: string, sourceHash: string, bytes: Buffer, beforePublish?: () => Promise<void>): Promise<void> {
  const guard = await managedDirectory(root, 'cards', false);
  if (!guard) throw new Error(serverText(messages).cardNotFound);
  const filename = path.join(guard.root, relativePath);
  await publishBytes(guard, filename, sourceHash, bytes, beforePublish);
}

function checkedProjectMarkdownPath(relativePath: string): string {
  if (!canonicalRelativePath(relativePath) || (!/^(features|docs|tasks)\/.+\.md$/u.test(relativePath) && !nativePath.test(relativePath))) {
    // 2026-11-07: the code lets /api/file answer a ranged read of a non-card file with a client error.
    throw Object.assign(new Error(serverText(messages).invalidMarkdownPath), { code: 'INVALID_MARKDOWN_PATH' });
  }
  return path.posix.dirname(relativePath);
}

/** 2026-11-03: legacy documents use the same ancestor/file identity checks as native cards. */
export async function readProjectMarkdown(root: string, relativePath: string): Promise<Buffer> {
  relativePath = await resolveDataPath(root, relativePath);
  const guard = await readingGuard(root, checkedProjectMarkdownPath(relativePath));
  if (!guard) throw Object.assign(new Error(serverText(messages).cardFileNotFound), { code: 'ENOENT' });
  return readBytesOnce(guard, path.join(guard.root, relativePath));
}

export async function replaceProjectMarkdown(root: string, relativePath: string, sourceHash: string, bytes: Buffer, beforePublish?: () => Promise<void>): Promise<void> {
  relativePath = await resolveDataPath(root, relativePath);
  const guard = await guardedDirectory(root, checkedProjectMarkdownPath(relativePath), false);
  if (!guard) throw new Error(serverText(messages).cardFileNotFound);
  await publishBytes(guard, path.join(guard.root, relativePath), sourceHash, bytes, beforePublish);
}

async function publishBytes(guard: DirectoryGuard, filename: string, sourceHash: string, bytes: Buffer, beforePublish?: () => Promise<void>): Promise<void> {
  const temporary = await writeTemporary(guard, bytes);
  let saved = false;
  let failure: unknown;
  try {
    await beforePublish?.();
    if (digest(await readBytes(guard, filename)) !== sourceHash) throw new Error('CARD_CONFLICT');
    await checkFile(guard, temporary.filename, temporary.stat);
    await rename(temporary.filename, filename);
    saved = true;
    catalogFileChanged(guard.root, path.relative(guard.root, filename));
    await checkFile(guard, filename, temporary.stat);
  } catch (error) { failure = error; }
  if (!saved) {
    try { await removeTemporary(guard, temporary); }
    catch (error) { failure = failure ? new AggregateError([failure, error], serverText(messages).temporaryCleanupFailed) : error; }
  }
  if (failure) throw savedError(failure, saved);
}

/** Replace one YAML-header scalar while preserving other keys, comments, and bytes. */
function patchNativeScalar(parsed: ManagedMarkdownFile & { yamlRange: ByteRange; newline: string }, key: string, value: string | number | string[] | null): Buffer {
  const yamlText = parsed.bytes.subarray(parsed.yamlRange.start, parsed.yamlRange.end).toString('utf8');
  const document = parseDocument(yamlText);
  if (document.errors.length > 0 || !isMap(document.contents) || !document.contents.range) throw new Error(serverText(messages).cardHeaderParseFailed);
  const scalar = document.get(key, true);
  const serialized = JSON.stringify(value);
  let start: number;
  let end: number;
  let replacement: string;
  if (document.has(key)) {
    if ((!isScalar(scalar) && !(Array.isArray(value) && isSeq(scalar))) || !scalar.range) throw new Error(serverText(messages).explicitYamlRequired(key));
    [start, end] = scalar.range;
    const scalarEnding = yamlText.slice(start, end).match(/\r?\n$/u)?.[0] ?? '';
    const separator = start === end && yamlText[start - 1] === ':' ? ' ' : '';
    replacement = separator + serialized + scalarEnding;
  } else {
    start = end = document.contents.range[0] + (document.contents.flow ? 1 : 0);
    replacement = document.contents.flow ? `${key}: ${serialized}, ` : `${key}: ${serialized}${parsed.newline}`;
  }
  const scalarStart = parsed.yamlRange.start + Buffer.byteLength(yamlText.slice(0, start), 'utf8');
  const scalarEnd = parsed.yamlRange.start + Buffer.byteLength(yamlText.slice(0, end), 'utf8');
  const yamlBytes = Buffer.concat([
    parsed.bytes.subarray(parsed.yamlRange.start, scalarStart), Buffer.from(replacement), parsed.bytes.subarray(scalarEnd, parsed.yamlRange.end),
  ]);
  const roundtrip = parseDocument(yamlBytes.toString('utf8'));
  if (roundtrip.errors.length > 0 || !isDeepStrictEqual(roundtrip.toJS(), { ...parsed.metadata, [key]: value })) {
    throw new Error(serverText(messages).yamlFieldsChanged(key));
  }
  return Buffer.concat([parsed.bytes.subarray(0, parsed.yamlRange.start), yamlBytes, parsed.bytes.subarray(parsed.yamlRange.end)]);
}

/** 2026-11-03: Plan all fields before publishing; only their YAML value spans change. dependsOn — 2026-11-04. */
export function patchNativeCardFields(existing: NativeCardFile, changes: Partial<Pick<NativeCardMetadata, 'kind' | 'state' | 'parentId' | 'deckId' | 'trackIds' | 'owner' | 'effort' | 'priority' | 'dependsOn'>>,
  formatLanguage: FormatLanguage = 'ru'): Buffer {
  let bytes = existing.bytes;
  for (const [key, change] of Object.entries(changes)) {
    const value = key === 'state' && typeof change === 'string' ? writeCardState(readCardState(change)!, formatLanguage) : change;
    if (!['kind', 'state', 'parentId', 'deckId', 'trackIds', 'owner', 'effort', 'priority', 'dependsOn'].includes(key) || value === undefined) throw new Error(serverText(messages).invalidCardField);
    if (isDeepStrictEqual(existing.metadata[key] ?? null, value)) continue;
    bytes = patchNativeScalar(parseManaged(bytes), key, value);
  }
  validateNativeCardMetadata(parseManaged(bytes).metadata, existing.metadata.id);
  return bytes;
}

/** Parent-only patch: no YAML reserialization or unrelated body/link changes. */
export async function editNativeCardParent(root: string, cardId: string, sourceHash: string, parentId: string | null, beforePublish?: () => Promise<void>): Promise<boolean> {
  const existing = await readNativeCard(root, cardId);
  if (!existing) throw new Error(serverText(messages).cardNotFound);
  if (existing.fileHash !== sourceHash) throw new Error('CARD_CONFLICT');
  if (!['task', 'doc'].includes(existing.card.kind)) throw new Error(serverText(messages).parentKindUneditable);
  if (existing.metadata.parentId === parentId) return false;
  if (existing.metadata.journey) throw new Error(serverText(messages).journeyParentMove);
  const bytes = patchNativeScalar(parseManaged(existing.bytes), 'parentId', parentId);
  validateNativeCardMetadata(parseManaged(bytes).metadata, existing.metadata.id);
  await publishManagedBytes(root, existing.card.path, sourceHash, bytes, beforePublish);
  return true;
}

/** Properties/state changes are scalar-only and publish once with the original file hash. */
export async function editNativeCardProperties(root: string, cardId: string, sourceHash: string,
  changes: Partial<Pick<NativeCardMetadata, 'state' | 'owner' | 'effort' | 'priority'>>, beforePublish?: () => Promise<void>,
  formatLanguage: FormatLanguage = 'ru'): Promise<boolean> {
  const existing = await readNativeCard(root, cardId);
  if (!existing) throw new Error(serverText(messages).cardNotFound);
  if (existing.fileHash !== sourceHash) throw new Error('CARD_CONFLICT');
  if (Object.keys(changes).some(key => !['state', 'owner', 'effort', 'priority'].includes(key))) throw new Error(serverText(messages).invalidCardProperties);
  if (Object.hasOwn(changes, 'state') && (existing.card.kind !== 'task'
    || typeof changes.state !== 'string' || readCardState(changes.state) === undefined)) throw new Error(serverText(messages).invalidTaskState);
  if (Object.hasOwn(changes, 'owner') && changes.owner !== null
    && (typeof changes.owner !== 'string' || !changes.owner.trim() || changes.owner.length > 120 || /[\r\n\u0000]/u.test(changes.owner))) throw new Error(serverText(messages).invalidOwner);
  if (Object.hasOwn(changes, 'effort') && changes.effort !== null
    && (typeof changes.effort !== 'number' || !Number.isFinite(changes.effort) || changes.effort < 0)) throw new Error(serverText(messages).invalidEffort);
  if (Object.hasOwn(changes, 'priority') && changes.priority !== null && !['high', 'medium', 'low'].includes(changes.priority ?? '')) throw new Error(serverText(messages).invalidPriority);
  let bytes = existing.bytes;
  for (const key of ['state', 'owner', 'effort', 'priority'] as const) {
    if (!Object.hasOwn(changes, key)) continue;
    const change = changes[key];
    if (change === undefined) throw new Error(serverText(messages).explicitPropertyValueRequired);
    const value = key === 'state' && typeof change === 'string' ? writeCardState(readCardState(change)!, formatLanguage) : change;
    if ((existing.metadata[key] ?? null) === value) continue;
    bytes = patchNativeScalar(parseManaged(bytes), key, value);
  }
  validateNativeCardMetadata(parseManaged(bytes).metadata, existing.metadata.id);
  if (bytes.equals(existing.bytes)) return false;
  await publishManagedBytes(root, existing.card.path, sourceHash, bytes, beforePublish);
  return true;
}

/**
 * Replace a native card's title scalar in YAML and only bodyRange for its body.
 * Return true if the file was rewritten.
 */
export async function editNativeCardContent(root: string, cardId: string, sourceHash: string, changes: { title?: string; markdown?: string }, beforePublish?: () => Promise<void>): Promise<boolean> {
  if (typeof sourceHash !== 'string' || !sourceHash) throw new Error(serverText(messages).cardHashRequired);
  if (!record(changes) || Object.keys(changes).some(key => key !== 'title' && key !== 'markdown')) throw new Error(serverText(messages).invalidContentFields);
  const existing = await readNativeCard(root, cardId);
  if (!existing) throw new Error(serverText(messages).cardNotFound);
  if (existing.fileHash !== sourceHash) throw new Error('CARD_CONFLICT');
  const parsed = parseManaged(existing.bytes);
  let bytes = existing.bytes;
  if (changes.title !== undefined && changes.title !== existing.metadata.title) {
    bytes = patchNativeScalar(parsed, 'title', changes.title);
  }
  if (changes.markdown !== undefined && changes.markdown !== existing.markdown) {
    const bodyNewline = existing.markdown.includes('\r\n') ? '\r\n' : parsed.newline;
    const body = changes.markdown.replace(/\r\n|\r|\n/gu, bodyNewline);
    const bodyBytes = Buffer.from(body);
    if (!bodyBytes.equals(existing.bytes.subarray(parsed.bodyRange.start))) {
      // 2026-11-03: a title replacement changes the UTF-8 length of the YAML header.
      const currentBodyStart = parseManaged(bytes).bodyRange.start;
      bytes = Buffer.concat([bytes.subarray(0, currentBodyStart), bodyBytes]);
    }
  }
  if (bytes.equals(existing.bytes)) return false;
  validateNativeCardMetadata(parseManaged(bytes).metadata, existing.metadata.id);
  await publishManagedBytes(root, existing.card.path, sourceHash, bytes, beforePublish);
  return true;
}
