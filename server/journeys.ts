import { defineText, serverLang, serverText } from './i18n.ts';
import { createHash, randomUUID } from 'node:crypto';
import { resolveDataPath } from './data-paths.ts';
import { catalogFileChanged } from './catalog-snapshot.ts';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { stringify } from 'yaml';
import type { CatalogDocument, CatalogEdit, CatalogJourney, CatalogJourneyStep, CatalogJourneyZone, CatalogView } from '../src/catalog-contracts.ts';
import { containedFile } from './config.ts';
import { rebaseMarkdownLinks } from './markdown-links.ts';
import { readCardOptions } from './card-options.ts';
import { appendJourneyLesson } from '../src/journey-lessons.ts';
import { writeCardState, type FormatLanguage } from '../src/format-vocabulary.ts';
import { markdownParser } from '../src/markdown-model.ts';
import { throwJourneyPublicationError } from './journey-publication.ts';
import {
  createManagedMarkdown, listManagedMarkdown, readManagedMarkdown, readNativeCard, replaceProjectMarkdown, validateNativeCardMetadata,
  createManagedBytes, readManagedBytes, removeManagedFile, parseManagedMarkdown, patchManagedMarkdown,
  type NativeCardMetadata, type NativeCardFile, type ManagedMarkdownFile,
} from './native-cards.ts';

const messages = defineText({
  pendingOperation: 'Journey changes were saved, but not fully. The next write will finish the pending operation before checking its own source hashes.',
  invalidOperation: 'The Journey operation journal cannot be read. Abandon the operation using its current journal hash to keep the working files as they are.',
  operationConflict: (file: string) => `The Journey file changed: ${file}. Reconcile it or abandon the pending operation; working files will not be rolled back.`,
  resumeSave: (reason: string) => `Journey changes were saved, but not fully. ${reason}`,
  publicationFailed: (file: string) => `Could not finish publishing ${file}. Retry a write to resume the operation.`,
  unknownDependency: (id: string) => `Unknown Journey dependency: ${id}`,
  unknownStepZone: (zone: string) => `Unknown Journey step zone: ${zone}`,
  stepNotFound: (reference: string) => `Journey step not found or its ID does not match: ${reference}`,
  taskDeckRequired: (deck: string) => `A Journey step requires an existing Task/Mixed Deck: ${deck}`,
  stepContentOccupied: (step: string) => `The Journey step address already has different content: ${step}`,
  missingLessonStep: (step: string) => `Step “${step}” is no longer in the Journey; its lesson cannot be saved.`,
  stepAlreadyOccupied: (step: string) => `The step address is already used by another card: ${step}`,
  includeDependency: (dependency: string, step: string) => `Include dependency “${dependency}” of step “${step}”, or create it first.`,
  stepTextTooLong: (step: string) => `The step text is too long after substitution: ${step}`,
  dependencyChanged: (dependency: string) => `A dependency changed before the step was created: ${dependency}`,
  stepOccupied: (step: string) => `The step address is used by another card: ${step}`,
  partialApply: (present: number, missing: number, reason: string) => `Journey partly applied: ${present} saved, ${missing} missing. Retry to create missing steps without overwriting existing ones. ${reason}`,
  journeyCycle: "Journey dependencies contain a cycle.",
  invalidStepCount: "A Journey must contain 1 to 100 steps.",
  invalidStep: "Invalid or duplicate Journey step.",
  invalidZoneCount: "Journey zones must be a list of up to 20 items.",
  invalidZone: "Invalid or duplicate Journey zone.",
  invalidJourneyHeader: "Invalid Journey frontmatter.",
  ambiguousIndex: 'The generated Journey step list cannot be identified uniquely. Restore its version, reading note and step list before saving; no files were changed.',
  invalidJourneyIdentity: "Invalid Journey identity, version or step list.",
  invalidJourneyDescription: "Invalid Journey description.",
  invalidJourneyId: "Invalid Journey ID.",
  invalidJourneyDeck: "A Journey with a Hero requires an Asset or Mixed Deck.",
  journeyAddressOccupied: "The Journey address is already in use.",
  invalidJourneyTitle: "The Journey title must contain 1 to 120 characters.",
  journeyDescriptionTooLong: "The Journey description must be a string of up to 2000 characters.",
  journeyNotFound: "Journey not found.",
  lessonAuthorRequired: "Lesson author unknown: send the x-deckmate-actor header with a registered member ID.",
  lessonTaskRequired: "A lesson must refer to a Task created by this Journey step.",
  lessonTooLong: "Adding the lesson would exceed the step's 200000-character limit.",
  journeySourceHashRequired: "Applying a Journey needs the Hero's current version. Refresh the catalog and try again.",
  journeyRootHeroRequired: "A Journey can only be applied to an existing Hero with no parent.",
  journeyRestoreHero: "A Journey cannot be applied to an archived or deleted card. Restore the Hero first.",
  journeyHeroDeckMismatch: "The Hero must be in this Journey's Deck.",
  journeyUniqueStepsRequired: "Select existing, unique Journey steps.",
  invalidStepDeckMap: "Invalid step-to-Deck map.",
  unknownMappedStep: "Unknown step in the Deck map.",
}, {
  pendingOperation: 'Изменения Journey сохранены не полностью. Следующая запись сначала завершит операцию, затем проверит собственные исходные хэши.',
  invalidOperation: 'Журнал операции Journey не читается. Бросьте операцию с текущим хэшем журнала, чтобы оставить рабочие файлы как есть.',
  operationConflict: (file: string) => `Файл Journey изменён: ${file}. Согласуйте его или бросьте незавершённую операцию; рабочие файлы не откатываются.`,
  resumeSave: (reason: string) => `Изменения Journey сохранены не полностью. ${reason}`,
  publicationFailed: (file: string) => `Не удалось завершить запись ${file}. Повторите пишущее действие для продолжения операции.`,
  unknownDependency: (id: string) => `Неизвестная зависимость Journey: ${id}`,
  unknownStepZone: (zone: string) => `Неизвестная зона шага Journey: ${zone}`,
  stepNotFound: (reference: string) => `Не найден шаг Journey или не совпадает ID: ${reference}`,
  taskDeckRequired: (deck: string) => `Шагу Journey нужна существующая Task/Mixed колода: ${deck}`,
  stepContentOccupied: (step: string) => `Адрес шага Journey уже занят другим содержимым: ${step}`,
  missingLessonStep: (step: string) => `Шага «${step}» больше нет в Journey — грабли записать некуда.`,
  stepAlreadyOccupied: (step: string) => `Адрес шага уже занят другой карточкой: ${step}`,
  includeDependency: (dependency: string, step: string) => `Включите зависимость «${dependency}» шага «${step}» или сначала создайте её.`,
  stepTextTooLong: (step: string) => `После подстановки слишком большой текст шага: ${step}`,
  dependencyChanged: (dependency: string) => `Зависимость изменилась до создания шага: ${dependency}`,
  stepOccupied: (step: string) => `Адрес шага занят другой карточкой: ${step}`,
  partialApply: (present: number, missing: number, reason: string) => `Journey применён не полностью: сохранено ${present}, отсутствует ${missing}. Повтор достроит недостающие шаги без перезаписи существующих. ${reason}`,
  journeyCycle: "Зависимости Journey содержат цикл.",
  invalidStepCount: "Journey должен содержать от 1 до 100 шагов.",
  invalidStep: "Некорректный или повторяющийся шаг Journey.",
  invalidZoneCount: "Зоны Journey — список до 20 элементов.",
  invalidZone: "Некорректная или повторяющаяся зона Journey.",
  invalidJourneyHeader: "Некорректная шапка Journey.",
  ambiguousIndex: 'Нельзя однозначно определить служебный список шагов Journey. Восстановите его строку версии, памятку чтения и список шагов перед сохранением; файлы не изменены.',
  invalidJourneyIdentity: "Некорректная идентичность, версия или список шагов Journey.",
  invalidJourneyDescription: "Некорректное описание Journey.",
  invalidJourneyId: "Некорректный ID Journey.",
  invalidJourneyDeck: "Journey с Hero требует колоду Asset или Mixed.",
  journeyAddressOccupied: "Адрес Journey уже занят.",
  invalidJourneyTitle: "Название Journey должно содержать от 1 до 120 символов.",
  journeyDescriptionTooLong: "Описание Journey — строка до 2000 символов.",
  journeyNotFound: "Journey не найден.",
  lessonAuthorRequired: "Автор грабель неизвестен: передайте заголовок x-deckmate-actor с ID участника из реестра.",
  lessonTaskRequired: "Грабли пишутся по Task, созданной этим шагом Journey.",
  lessonTooLong: "С граблями текст шага превысит 200 000 символов.",
  journeySourceHashRequired: "Для применения Journey нужна актуальная версия Hero. Обновите каталог и повторите действие.",
  journeyRootHeroRequired: "Journey применяется только к существующему Hero без родителя.",
  journeyRestoreHero: "Нельзя применить Journey к архивной или удалённой карточке. Сначала восстановите Hero.",
  journeyHeroDeckMismatch: "Hero должен находиться в колоде этого Journey.",
  journeyUniqueStepsRequired: "Выберите существующие уникальные шаги Journey.",
  invalidStepDeckMap: "Некорректная карта колод для шагов.",
  unknownMappedStep: "Неизвестный шаг в карте колод.",
});


const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
type CreateJourneyEdit = Extract<CatalogEdit, { action: 'create-journey' }>;
type ApplyJourneyEdit = Extract<CatalogEdit, { action: 'apply-journey' }>;
type UpdateJourneyEdit = Extract<CatalogEdit, { action: 'update-journey' }>;
type AddJourneyStepLessonEdit = Extract<CatalogEdit, { action: 'add-journey-step-lesson' }>;
interface JourneyMetadata { deckmate?: 'journey'; freetion?: 'journey'; schema: 1; id: string; title: string; version: number; deckId: string; steps: string[];
  // 2026-11-04: added optional fields so existing files remain valid.
  description?: string; zones?: CatalogJourneyZone[] }

export interface JourneyApplyResult { created: string[]; existing: string[]; missing: string[] }
export class JourneyPartialError extends Error {
  readonly saved: boolean;
  readonly created: string[];
  readonly missing: string[];
  constructor(message: string, created: string[], missing: string[], saved = created.length > 0) {
    super(message);
    this.saved = saved;
    this.created = created;
    this.missing = missing;
  }
}

export function validText(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;
}

/** Topologically sort dependsOn links, requiring unique IDs, existing dependencies, and no cycles. */
export function orderedDependencies<T extends { id: string; dependsOn: string[] }>(steps: T[]): T[] {
  const byId = new Map<string, T>();
  for (const step of steps) byId.set(step.id, step);
  const complete = new Set<string>();
  const active = new Set<string>();
  const result: T[] = [];
  function visit(id: string) {
    if (complete.has(id)) return;
    if (active.has(id)) throw new Error(serverText(messages).journeyCycle);
    const step = byId.get(id);
    if (!step) throw new Error(serverText(messages).unknownDependency(id));
    active.add(id);
    for (const dependency of step.dependsOn) visit(dependency);
    active.delete(id);
    complete.add(id);
    result.push(step);
  }
  for (const step of steps) visit(step.id);
  return result;
}

function orderedSteps(steps: CatalogJourneyStep[]): CatalogJourneyStep[] {
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > 100) throw new Error(serverText(messages).invalidStepCount);
  const filenames = new Set<string>();
  for (const step of steps) {
    if (!step || typeof step.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/u.test(step.id) || filenames.has(step.id.toLowerCase())
      || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/iu.test(step.id)
      || !validText(step.title, 300) || typeof step.markdown !== 'string' || step.markdown.length > 200000
      || !validText(step.deckId, 80) || (step.owner !== null && step.owner !== undefined && !validText(step.owner, 200))
      || !Array.isArray(step.dependsOn) || step.dependsOn.some(value => typeof value !== 'string')
      || new Set(step.dependsOn).size !== step.dependsOn.length
      || (step.effort !== null && step.effort !== undefined && (typeof step.effort !== 'number' || !Number.isFinite(step.effort) || step.effort < 0))
      || (step.priority !== null && step.priority !== undefined && !['high', 'medium', 'low'].includes(step.priority as string))) throw new Error(serverText(messages).invalidStep);
    filenames.add(step.id.toLowerCase());
  }
  return orderedDependencies(steps);
}

const zoneIdPattern = /^[a-z0-9][a-z0-9-]{0,59}$/u;

/** Zones group editor steps: up to 20 unique IDs; an empty list implies one default Zone. */
export function validateJourneyZones(value: unknown): CatalogJourneyZone[] {
  if (!Array.isArray(value) || value.length > 20) throw new Error(serverText(messages).invalidZoneCount);
  const zones: CatalogJourneyZone[] = [];
  const identifiers = new Set<string>();
  for (const zone of value) {
    if (!zone || typeof zone !== 'object' || typeof (zone as CatalogJourneyZone).id !== 'string' || !zoneIdPattern.test((zone as CatalogJourneyZone).id)
      || identifiers.has((zone as CatalogJourneyZone).id) || !validText((zone as CatalogJourneyZone).title, 120)) {
      throw new Error(serverText(messages).invalidZone);
    }
    identifiers.add((zone as CatalogJourneyZone).id);
    zones.push({ id: (zone as CatalogJourneyZone).id, title: (zone as CatalogJourneyZone).title.trim() });
  }
  return zones;
}

/** Steps without zoneId use default; explicit Zones must exist, with only default allowed for empty zones. */
export function validateStepZones<T extends { zoneId?: string }>(steps: T[], zones: CatalogJourneyZone[]): void {
  const identifiers = new Set(zones.map(zone => zone.id));
  for (const step of steps) {
    const zoneId = step.zoneId ?? 'default';
    if (identifiers.has(zoneId)) continue;
    if (identifiers.size === 0 && zoneId === 'default') continue;
    throw new Error(serverText(messages).unknownStepZone(zoneId));
  }
}

function validateJourney(value: unknown, expectedId: string): JourneyMetadata {
  if (!value || typeof value !== 'object') throw new Error(serverText(messages).invalidJourneyHeader);
  const metadata = value as JourneyMetadata;
  if ((metadata.deckmate ?? metadata.freetion) !== 'journey' || metadata.schema !== 1 || metadata.id !== expectedId || !uuidPattern.test(metadata.id)
    || !validText(metadata.title, 120) || !Number.isInteger(metadata.version) || metadata.version < 1
    || !validText(metadata.deckId, 80) || !Array.isArray(metadata.steps) || metadata.steps.length < 1 || metadata.steps.length > 100
    || metadata.steps.some(reference => typeof reference !== 'string' || !/^steps\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}\.md$/u.test(reference))
    || new Set(metadata.steps).size !== metadata.steps.length) throw new Error(serverText(messages).invalidJourneyIdentity);
  if (metadata.description !== undefined && (typeof metadata.description !== 'string' || metadata.description.length > 2000)) throw new Error(serverText(messages).invalidJourneyDescription);
  if (metadata.zones !== undefined) validateJourneyZones(metadata.zones);
  return metadata;
}

export async function readJourney(root: string, journeyId: string): Promise<{ journey: CatalogJourney; documents: CatalogDocument[] } | null> {
  if (!uuidPattern.test(journeyId)) throw new Error(serverText(messages).invalidJourneyId);
  const revision = localOperationRevision;
  const active = activeOperations.get(operationKey(root, journeyId));
  if (active) return operationSnapshot(active);
  const pending = await readOperation(root, journeyId);
  if (pending) {
    const publishing = activeOperations.get(operationKey(root, journeyId));
    if (publishing) return operationSnapshot(publishing);
    const { operation, hash } = pending;
    const conflictFile = operation ? await operationConflictFile(root, operation) : undefined;
    const snapshot = operation && !conflictFile ? await operationSnapshot(operation)
      : await readJourneyFiles(journeyId, relative => readManagedMarkdown(root, relative), true);
    if (revision !== localOperationRevision) return readJourney(root, journeyId);
    if (!snapshot) return null;
    const state = operation ? 'pending' : 'invalid';
    snapshot.journey.pendingOperation = { id: operation?.id ?? null, journalHash: hash,
      state: conflictFile ? 'conflict' : state, ...(conflictFile ? { file: conflictFile } : {}) };
    return snapshot;
  }
  // 2026-11-09: one absent-journal probe keeps ordinary reads cheap; local writes supply a coherent in-memory snapshot.
  try {
    const result = await readJourneyFiles(journeyId, filename => readManagedMarkdown(root, filename));
    const started = activeOperations.get(operationKey(root, journeyId));
    if (started) return operationSnapshot(started);
    if (revision !== localOperationRevision) return readJourney(root, journeyId);
    return result;
  } catch (error) {
    const started = activeOperations.get(operationKey(root, journeyId));
    if (started) return operationSnapshot(started);
    if (revision !== localOperationRevision) return readJourney(root, journeyId);
    throw error;
  }
}

async function readJourneyFiles(journeyId: string, read: (relative: string) => Promise<ManagedMarkdownFile | null>, toleratePartial = false): Promise<{ journey: CatalogJourney; documents: CatalogDocument[] } | null> {
  const directory = `tasks/journeys/${journeyId}`;
  const relativePath = `${directory}/index.md`;
  const file = await read(relativePath);
  if (!file) return null;
  const metadata = validateJourney(file.metadata, journeyId);
  const indexBlock = journeyIndexBlock(file.markdown, metadata);
  const references = indexBlock?.references ?? metadata.steps;
  const zones = metadata.zones ?? [];
  const documents: CatalogDocument[] = [{ path: relativePath, title: metadata.title, hash: file.fileHash }];
  const steps: CatalogJourneyStep[] = [];
  // 2026-11-06: each guarded read waits on a dozen filesystem checks; reading the steps one by one made Journeys
  // half of every full catalog read. Read them together, then accept or fail them in index order as before.
  const stepReads = await Promise.allSettled(references.map(reference => read(`${directory}/${reference}`)));
  for (const [index, reference] of references.entries()) {
    const stepPath = `${directory}/${reference}`;
    const read = stepReads[index];
    if (read.status === 'rejected') throw read.reason;
    const stepFile = read.value;
    const stepId = path.posix.basename(reference, '.md');
    if (!stepFile || stepFile.metadata.id !== stepId) {
      if (toleratePartial) continue;
      throw new Error(serverText(messages).stepNotFound(reference));
    }
    const raw = stepFile.metadata as Partial<CatalogJourneyStep>;
    // 2026-11-04: absent effort/priority become null; absent zoneId selects the default Zone.
    const step: CatalogJourneyStep = { id: stepId, title: raw.title as string, markdown: stepFile.markdown,
      deckId: raw.deckId as string, owner: raw.owner ?? null, dependsOn: Array.isArray(raw.dependsOn) ? raw.dependsOn : [],
      effort: raw.effort ?? null, priority: raw.priority ?? null };
    if (typeof raw.zoneId === 'string') step.zoneId = raw.zoneId;
    steps.push(step);
    documents.push({ path: stepPath, title: step.title, hash: stepFile.fileHash });
  }
  if (!toleratePartial) {
    orderedSteps(steps);
    validateStepZones(steps, zones);
  }
  // The aggregate revision covers the index, its order, and every referenced instruction.
  const fileHash = digest(Buffer.from(JSON.stringify(documents.map(document => [document.path, document.hash]))));
  return { journey: { id: metadata.id, title: metadata.title, version: metadata.version, deckId: metadata.deckId,
    description: metadata.description ?? '', zones, steps, path: relativePath, fileHash }, documents };
}

export async function readJourneys(root: string): Promise<{ journeys: CatalogJourney[]; documents: CatalogDocument[]; warnings: string[] }> {
  const journeys: CatalogJourney[] = [];
  const documents: CatalogDocument[] = [];
  const warnings: string[] = [];
  const relativePaths = await listManagedMarkdown(root, 'tasks/journeys');
  // 2026-11-06: Journeys are independent files; read them in parallel and report them in listing order.
  const reads = await Promise.allSettled(relativePaths.map(relativePath => readJourney(root, path.posix.basename(path.posix.dirname(relativePath)))));
  for (const [index, relativePath] of relativePaths.entries()) {
    const read = reads[index];
    if (read.status === 'rejected') {
      warnings.push(`${relativePath}: ${read.reason instanceof Error ? read.reason.message : String(read.reason)}`);
      continue;
    }
    if (!read.value) continue;
    journeys.push(read.value.journey);
    const pending = read.value.journey.pendingOperation;
    if (pending) {
      let warning = serverText(messages).pendingOperation;
      if (pending.state === 'invalid') warning = serverText(messages).invalidOperation;
      if (pending.state === 'conflict') warning = serverText(messages).resumeSave(serverText(messages).operationConflict(pending.file!));
      warnings.push(`${relativePath}: ${warning}`);
    }
    documents.push(...read.value.documents);
  }
  return { journeys, documents, warnings };
}

export function requireSourceDeck(catalog: CatalogView, deckId: string) {
  const deck = catalog.decks.find(candidate => candidate.id === deckId);
  if (!deck || (deck.kind !== 'asset' && deck.kind !== 'mixed')) throw new Error(serverText(messages).invalidJourneyDeck);
  return deck;
}

export function requireTaskDeck(catalog: CatalogView, deckId: string): void {
  const deck = catalog.decks.find(candidate => candidate.id === deckId);
  if (!deck || (deck.kind !== 'task' && deck.kind !== 'mixed')) throw new Error(serverText(messages).taskDeckRequired(deckId));
}

async function manifestHash(root: string): Promise<string> {
  const current = await readFile(await containedFile(root, await resolveDataPath(root, 'tasks/deckmate.md')));
  return digest(current);
}

export async function assertManifestHash(root: string, catalog: CatalogView): Promise<void> {
  if (await manifestHash(root) !== catalog.manifestHash) throw new Error('CATALOG_CONFLICT');
}

/** Omit null/undefined step-header fields so existing files retain their format. */
function stepFileMetadata(step: CatalogJourneyStep): Record<string, unknown> {
  const metadata: Record<string, unknown> = { id: step.id, title: step.title, deckId: step.deckId, owner: step.owner, dependsOn: step.dependsOn };
  if (step.effort !== null && step.effort !== undefined) metadata.effort = step.effort;
  if (step.priority !== null && step.priority !== undefined) metadata.priority = step.priority;
  if (step.zoneId !== undefined) metadata.zoneId = step.zoneId;
  return metadata;
}

/** Read file hashes from Journey documents: index first, followed by steps in reference order. */
export function stepFileHashes(documents: CatalogDocument[]): Map<string, string> {
  const hashes = new Map<string, string>();
  for (const document of documents.slice(1)) hashes.set(path.posix.basename(document.path, '.md'), document.hash);
  return hashes;
}

function canonicalRecord(value: Record<string, unknown>): string {
  return JSON.stringify(Object.keys(value).sort().map(key => [key, value[key]]));
}

// The index body lands in project files, so it follows the project's format language, not the interface language.
const journeyIndexText = defineText({
  versionLine: (version: number, deckId: string) => `Version: ${version} · Source deck: \`${deckId}\``,
  note: 'Read only the step file needed for the current task; follow its dependencies first.',
  dependsOn: 'depends on',
  noDependencies: 'none',
}, {
  versionLine: (version: number, deckId: string) => `Версия: ${version} · Исходная колода: \`${deckId}\``,
  note: 'Читайте только файл шага, нужного для текущей задачи; сначала пройдите его зависимости.',
  dependsOn: 'зависимости',
  noDependencies: 'нет',
});

function journeyIndexBody(metadata: JourneyMetadata, steps: CatalogJourneyStep[], formatLanguage: FormatLanguage): string {
  const words = journeyIndexText[formatLanguage];
  return `# ${metadata.title}\n\n${words.versionLine(metadata.version, metadata.deckId)}\n\n${words.note}\n\n`
    + steps.map((step, index) => `${index + 1}. [${step.id}](steps/${step.id}.md) — ${step.title}; ${words.dependsOn}: ${step.dependsOn.join(', ') || words.noDependencies}`).join('\n') + '\n';
}

export interface JourneyPublication {
  id: string;
  version: number;
  title: string;
  deckId: string;
  description: string;
  zones: CatalogJourneyZone[];
  steps: CatalogJourneyStep[];
  /** Read current disk state; only a new Journey may be absent. */
  existing?: { steps: CatalogJourneyStep[]; hashes: Map<string, string>; indexHash: string };
}

interface OperationBytes { hash: string; text: string }
interface OperationFile { path: string; before: OperationBytes | null; after: OperationBytes | null }
interface JourneyOperation {
  deckmate: 'journey-operation'; schema: 1; id: string; journeyId: string;
  files: OperationFile[];
}

const activeOperations = new Map<string, JourneyOperation>();
// 2026-11-09: detect a local save that both started and finished during an awaited disk read, without probing files again on ordinary reads.
let localOperationRevision = 0;

function operationKey(root: string, id: string): string {
  const key = path.resolve(root, servicePath(id));
  return process.platform === 'win32' ? key.toLowerCase() : key;
}

function servicePath(id: string): string {
  if (!uuidPattern.test(id)) throw new Error(serverText(messages).invalidJourneyId);
  return `tasks/journeys/${id}/.deckmate-operation.json`;
}

function operationBytes(bytes: Buffer): OperationBytes {
  return { hash: digest(bytes), text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) };
}

function normalizedJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)));
  });
}

function validOperationPath(relative: unknown): relative is string {
  return typeof relative === 'string' && (relative === 'index.md' || /^steps\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}\.md$/u.test(relative));
}

function validOperationBytes(value: OperationBytes | null): boolean {
  return value === null || (!!value && typeof value.text === 'string' && digest(Buffer.from(value.text)) === value.hash);
}

async function readOperation(root: string, id: string): Promise<{ operation: JourneyOperation | null; hash: string } | null> {
  const relative = servicePath(id);
  try { await lstat(path.join(root, relative)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  const bytes = await readManagedBytes(root, relative);
  if (!bytes) return null;
  try {
    const operation = JSON.parse(bytes.toString('utf8')) as JourneyOperation;
    if (operation.deckmate !== 'journey-operation' || operation.schema !== 1 || operation.journeyId !== id
      || !uuidPattern.test(operation.id)
      || !Array.isArray(operation.files) || operation.files.length < 2 || operation.files.length > 201
      || operation.files.some(file => !file || !validOperationPath(file.path) || !validOperationBytes(file.before)
        || !validOperationBytes(file.after) || (!file.before && !file.after))
      || new Set(operation.files.map(file => file.path.toLowerCase())).size !== operation.files.length
      || !operation.files.some(file => file.path === 'index.md' && file.before && file.after)) throw new Error();
    // 2026-11-09: validate both saved graphs before trusting a manually editable recovery plan.
    await operationSnapshot(operation);
    const target = await readJourneyFiles(id, async relative => {
      const file = operation.files.find(file => relative === `tasks/journeys/${id}/${file.path}`);
      return file?.after ? parseManagedMarkdown(Buffer.from(file.after.text)) : null;
    });
    if (!target || operation.files.filter(file => file.after).length !== target.documents.length) throw new Error();
    return { operation, hash: digest(bytes) };
  } catch { return { operation: null, hash: digest(bytes) }; }
}

async function operationSnapshot(operation: JourneyOperation) {
  const snapshot = await readJourneyFiles(operation.journeyId, async relative => {
    const file = operation.files.find(file => relative === `tasks/journeys/${operation.journeyId}/${file.path}`);
    return file?.before ? parseManagedMarkdown(Buffer.from(file.before.text)) : null;
  });
  if (!snapshot || operation.files.filter(file => file.before).length !== snapshot.documents.length) {
    throw new Error(serverText(messages).invalidOperation);
  }
  return snapshot;
}

async function assertJourneyReady(root: string, id: string): Promise<void> {
  if (await readOperation(root, id)) throw new Error('JOURNEY_CONFLICT');
}

export async function recoverJourneyOperation(root: string, id: string): Promise<boolean> {
  const pending = await readOperation(root, id);
  if (!pending) return false;
  if (!pending.operation) throw new Error(serverText(messages).invalidOperation);
  await runActiveOperation(root, pending.operation, () => resumeOperation(root, pending.operation!, pending.hash));
  return true;
}

export async function abandonJourneyOperation(root: string, id: string, journalHash: string): Promise<string[]> {
  const relative = servicePath(id);
  const bytes = await readManagedBytes(root, relative);
  if (!bytes || digest(bytes) !== journalHash) throw new Error('JOURNEY_CONFLICT');
  await removeManagedFile(root, relative, journalHash);
  return [relative];
}

interface IndexRange { start: number; end: number }
const indexStepLine = /^\d+\. \[([a-zA-Z0-9][a-zA-Z0-9_-]{0,79})\]\(steps\/\1\.md\)[^\r\n]*(?:\r?\n|$)/u;

function indexLine(markdown: string, start: number): IndexRange {
  const end = markdown.indexOf('\n', start);
  const lineEnd = end < 0 ? markdown.length : end;
  return { start, end: markdown[lineEnd - 1] === '\r' ? lineEnd - 1 : lineEnd };
}

function journeyIndexBlock(markdown: string, metadata: JourneyMetadata) {
  // 2026-11-10: only the create-format version/note/list group matching the read graph is a safe write target.
  const nodes = markdownParser.parse(markdown).children;
  const headingIndex = nodes.findIndex(node => node.type === 'heading' && node.depth === 1);
  const heading = nodes[headingIndex];
  if (!heading) return undefined;
  const candidates = [];
  for (let index = headingIndex + 1; index < nodes.length - 2; index += 1) {
    const [version, note, list] = nodes.slice(index, index + 3);
    if (version.type !== 'paragraph' || note.type !== 'paragraph' || list.type !== 'list' || !list.ordered) continue;
    const versionRange = indexLine(markdown, version.position!.start.offset!);
    const versionText = markdown.slice(versionRange.start, versionRange.end);
    const words = Object.values(journeyIndexText).find(words => words.versionLine(metadata.version, metadata.deckId) === versionText);
    if (!words || markdown.slice(note.position!.start.offset!, note.position!.end.offset!) !== words.note) continue;
    const listStart = list.position!.start.offset!;
    let listEnd = listStart;
    const endings: string[] = [];
    const references: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = indexStepLine.exec(markdown.slice(listEnd))) && match[0].length) {
      listEnd += match[0].length;
      references.push(`steps/${match[1]}.md`);
      endings.push(match[0].match(/\r?\n$/u)?.[0] ?? '');
    }
    if (listEnd < list.position!.end.offset! || JSON.stringify(references) !== JSON.stringify(metadata.steps)) continue;
    candidates.push({ heading: indexLine(markdown, heading.position!.start.offset!), version: versionRange,
      list: { start: listStart, end: listEnd }, endings, references });
  }
  return candidates.length === 1 ? candidates[0] : undefined;
}

function updatedIndexBody(file: ManagedMarkdownFile, metadata: JourneyMetadata, publication: JourneyPublication): string {
  const previous = validateJourney(file.metadata, publication.id);
  const markdown = file.markdown;
  const block = journeyIndexBlock(markdown, previous);
  if (!block) throw new Error(serverText(messages).ambiguousIndex);
  const newline = block.endings.find(ending => ending) ?? (markdown.includes('\r\n') ? '\r\n' : '\n');
  const version = markdown.slice(block.version.start, block.version.end);
  const language = version.startsWith('Версия:') ? 'ru' : 'en';
  const generated = journeyIndexBody(metadata, publication.steps, language).split('\n\n');
  const replacements: Array<IndexRange & { value: string }> = [];
  if (metadata.title !== previous.title) replacements.push({ ...block.heading, value: `# ${metadata.title}` });
  replacements.push({ ...block.version, value: generated[1] });
  const rows = generated[3].trimEnd().split('\n');
  const value = rows.map((row, index) => {
    const ending = index === rows.length - 1 ? block.endings.at(-1)! : block.endings[index] || newline;
    return row + ending;
  }).join('');
  replacements.push({ ...block.list, value });
  let body = markdown;
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    body = body.slice(0, replacement.start) + replacement.value + body.slice(replacement.end);
  }
  return body;
}

function updatedStepBytes(file: ManagedMarkdownFile, previous: CatalogJourneyStep, step: CatalogJourneyStep): Buffer {
  const metadata = stepFileMetadata(step);
  for (const key of ['effort', 'priority', 'zoneId'] as const) {
    if (file.metadata[key] === undefined || metadata[key] !== undefined) continue;
    metadata[key] = key === 'zoneId' ? 'default' : null;
  }
  const before = stepFileMetadata(previous);
  for (const key of Object.keys(metadata)) {
    if (normalizedJson(before[key]) === normalizedJson(metadata[key])) delete metadata[key];
  }
  return patchManagedMarkdown(file, metadata, step.markdown);
}

async function prepareJourneyOperation(root: string, publication: JourneyPublication, metadata: JourneyMetadata): Promise<JourneyOperation> {
  const directory = `tasks/journeys/${publication.id}`;
  const existing = publication.existing!;
  const files: OperationFile[] = [];
  for (const step of orderedSteps(publication.steps)) {
    const relative = `steps/${step.id}.md`;
    const file = await readManagedMarkdown(root, `${directory}/${relative}`);
    const expected = existing.hashes.get(step.id);
    if ((file?.fileHash ?? undefined) !== expected) throw new Error('JOURNEY_CONFLICT');
    let bytes: Buffer = Buffer.from(`---\n${stringify(stepFileMetadata(step), { lineWidth: 0 })}---\n${step.markdown}`);
    if (file) bytes = updatedStepBytes(file, existing.steps.find(previous => previous.id === step.id)!, step);
    files.push({ path: relative, before: file ? operationBytes(file.bytes) : null, after: operationBytes(bytes) });
  }
  const index = await readManagedMarkdown(root, `${directory}/index.md`);
  if (!index || index.fileHash !== existing.indexHash) throw new Error('JOURNEY_CONFLICT');
  const changes: Record<string, unknown> = { ...metadata };
  if (index.metadata.description !== undefined && metadata.description === undefined) changes.description = '';
  if (index.metadata.zones !== undefined && metadata.zones === undefined) changes.zones = [];
  const rename = index.metadata.deckmate === undefined && index.metadata.freetion === 'journey';
  const bytes = patchManagedMarkdown(index, changes, updatedIndexBody(index, metadata, publication),
    rename ? { from: 'freetion', to: 'deckmate' } : undefined);
  files.push({ path: 'index.md', before: operationBytes(index.bytes), after: operationBytes(bytes) });
  for (const step of existing.steps) {
    if (publication.steps.some(next => next.id === step.id)) continue;
    const relative = `steps/${step.id}.md`;
    const file = await readManagedMarkdown(root, `${directory}/${relative}`);
    if (!file || file.fileHash !== existing.hashes.get(step.id)) throw new Error('JOURNEY_CONFLICT');
    files.push({ path: relative, before: operationBytes(file.bytes), after: null });
  }
  return { deckmate: 'journey-operation', schema: 1, id: randomUUID(), journeyId: publication.id, files };
}

async function operationHashes(root: string, operation: JourneyOperation): Promise<Map<string, string | null>> {
  return new Map(await Promise.all(operation.files.map(async file => {
    const bytes = await readManagedBytes(root, `tasks/journeys/${operation.journeyId}/${file.path}`);
    return [file.path, bytes ? digest(bytes) : null] as const;
  })));
}

function operationConflict(file: string): Error {
  return Object.assign(new Error(serverText(messages).operationConflict(file)), { code: 'JOURNEY_CONFLICT', file });
}

async function operationConflictFile(root: string, operation: JourneyOperation): Promise<string | undefined> {
  const hashes = await operationHashes(root, operation);
  return operation.files.find(file => hashes.get(file.path) !== (file.before?.hash ?? null)
    && hashes.get(file.path) !== (file.after?.hash ?? null))?.path;
}

async function verifyOperationFiles(root: string, operation: JourneyOperation, phase: 'source' | 'resume' | 'index' | 'complete'): Promise<void> {
  const hashes = await operationHashes(root, operation);
  const committed = hashes.get('index.md') === operation.files.find(file => file.path === 'index.md')!.after!.hash;
  for (const file of operation.files) {
    const hash = hashes.get(file.path);
    const before = file.before?.hash ?? null;
    const after = file.after?.hash ?? null;
    let allowed = hash === before || hash === after;
    if (!file.after && hash === null && !committed) allowed = false;
    if (phase === 'source') allowed = hash === before;
    if (phase === 'index' && file.path !== 'index.md' && file.after) allowed = hash === after;
    if (phase === 'complete') allowed = hash === after;
    if (!allowed) throw operationConflict(file.path);
  }
}

async function publishOperationFile(root: string, operation: JourneyOperation, file: OperationFile, verify: () => Promise<void>): Promise<void> {
  const relative = `tasks/journeys/${operation.journeyId}/${file.path}`;
  const bytes = await readManagedBytes(root, relative);
  const hash = bytes ? digest(bytes) : null;
  if (hash === file.after?.hash) return;
  if (hash !== (file.before?.hash ?? null) || !file.after) throw operationConflict(file.path);
  if (file.before) {
    await replaceProjectMarkdown(root, relative, file.before.hash, Buffer.from(file.after.text), verify, { conflict: 'JOURNEY_CONFLICT', retryWindowsRename: true });
  } else if (!await createManagedBytes(root, relative, Buffer.from(file.after.text), verify)) throw operationConflict(file.path);
}

function operationWritten(operation: JourneyOperation): string[] {
  return operation.files.filter(file => file.before?.hash !== file.after?.hash)
    .map(file => `tasks/journeys/${operation.journeyId}/${file.path}`);
}

async function resumeOperation(root: string, operation: JourneyOperation, operationHash: string): Promise<string[]> {
  const relative = servicePath(operation.journeyId);
  let currentFile = '.deckmate-operation.json';
  const verify = async () => {
    const bytes = await readManagedBytes(root, relative);
    if (!bytes || digest(bytes) !== operationHash) throw operationConflict('.deckmate-operation.json');
  };
  try {
    await verify();
    await verifyOperationFiles(root, operation, 'resume');
    for (const file of operation.files.filter(file => file.after && file.path !== 'index.md')) {
      currentFile = file.path;
      await publishOperationFile(root, operation, file, verify);
    }
    currentFile = 'index.md';
    await publishOperationFile(root, operation, operation.files.find(file => file.path === 'index.md')!, async () => {
      await verify();
      await verifyOperationFiles(root, operation, 'index');
    });
    for (const file of operation.files.filter(file => !file.after)) {
      currentFile = file.path;
      await removeManagedFile(root, `tasks/journeys/${operation.journeyId}/${file.path}`, file.before!.hash, verify);
    }
    const complete = async () => { await verify(); await verifyOperationFiles(root, operation, 'complete'); };
    await complete();
    currentFile = '.deckmate-operation.json';
    await removeManagedFile(root, relative, operationHash, complete);
    return operationWritten(operation);
  } catch (error) {
    // 2026-11-09: an OS publication can land before its caller observes success or invalidates the snapshot.
    catalogFileChanged(root, relative);
    let reason = serverText(messages).publicationFailed(currentFile);
    if ((error as { code?: string }).code === 'JOURNEY_CONFLICT') reason = (error as Error).message;
    if (error instanceof Error && error.message === 'JOURNEY_CONFLICT') reason = serverText(messages).operationConflict(currentFile);
    throw Object.assign(new Error(serverText(messages).resumeSave(reason)), { saved: true });
  }
}

async function runActiveOperation<T>(root: string, operation: JourneyOperation, run: () => Promise<T>): Promise<T> {
  const key = operationKey(root, operation.journeyId);
  activeOperations.set(key, operation);
  localOperationRevision += 1;
  try { return await run(); }
  finally {
    if (activeOperations.get(key) === operation) activeOperations.delete(key);
    localOperationRevision += 1;
    // 2026-11-09: GETs may have cached the original snapshot while this process was publishing.
    catalogFileChanged(root, servicePath(operation.journeyId));
  }
}

async function publishJourneyUpdate(root: string, verifySources: () => Promise<void>, publication: JourneyPublication, metadata: JourneyMetadata): Promise<string[]> {
  await recoverJourneyOperation(root, publication.id);
  const operation = await prepareJourneyOperation(root, publication, metadata);
  const bytes = Buffer.from(JSON.stringify(operation, null, 2) + '\n');
  const relative = servicePath(publication.id);
  return runActiveOperation(root, operation, async () => {
    try {
      if (!await createManagedBytes(root, relative, bytes, async () => {
        await verifySources();
        await verifyOperationFiles(root, operation, 'source');
      })) throw new Error('JOURNEY_CONFLICT');
    } catch (error) {
      catalogFileChanged(root, relative);
      const saved = await readManagedBytes(root, relative);
      if (saved?.equals(bytes)) throw Object.assign(new Error(serverText(messages).resumeSave(serverText(messages).publicationFailed(relative))), { saved: true });
      throw error;
    }
    return resumeOperation(root, operation, digest(bytes));
  });
}

/**
 * Publish new and changed step files, leaving unchanged files untouched.
 * Write index.md last to mark readiness, then delete removed steps so orphaned files do not break the catalog.
 * The index body is written in the project's format language; the default covers demo projects, which are English.
 */
export async function publishJourney(root: string, verifySources: () => Promise<void>, publication: JourneyPublication,
  formatLanguage: FormatLanguage = 'en'): Promise<string[]> {
  const directory = `tasks/journeys/${publication.id}`;
  const metadata: JourneyMetadata = { deckmate: 'journey', schema: 1, id: publication.id, title: publication.title,
    version: publication.version, deckId: publication.deckId, steps: publication.steps.map(step => `steps/${step.id}.md`) };
  if (publication.description) metadata.description = publication.description;
  if (publication.zones.length > 0) metadata.zones = publication.zones;
  validateJourney(metadata, publication.id);
  if (publication.existing) return publishJourneyUpdate(root, verifySources, publication, metadata);
  const written: string[] = [];
  try {
    for (const step of orderedSteps(publication.steps)) {
      const relativePath = `${directory}/steps/${step.id}.md`;
      const stepMetadata = stepFileMetadata(step);
      // 2026-11-09: retries of a new publication must not overwrite another file at the same address.
      if (!await createManagedMarkdown(root, relativePath, stepMetadata, step.markdown, verifySources)) {
        const existingStep = await readManagedMarkdown(root, relativePath);
        if (!existingStep || canonicalRecord(existingStep.metadata) !== canonicalRecord(stepMetadata) || existingStep.markdown !== step.markdown) {
          throw new Error(serverText(messages).stepContentOccupied(step.id));
        }
      }
      written.push(relativePath);
    }
    await verifySources();
    if (!await createManagedMarkdown(root, `${directory}/index.md`, metadata, journeyIndexBody(metadata, publication.steps, formatLanguage), verifySources)) {
      throw new Error(serverText(messages).journeyAddressOccupied);
    }
    written.push(`${directory}/index.md`);
  } catch (error) {
    throwJourneyPublicationError(error, written, directory, 'journey');
  }
  return written;
}

export async function createJourney(root: string, catalog: CatalogView, edit: CreateJourneyEdit): Promise<void> {
  if (!validText(edit.title, 120)) throw new Error(serverText(messages).invalidJourneyTitle);
  requireSourceDeck(catalog, edit.deckId);
  orderedSteps(edit.steps);
  for (const step of edit.steps) requireTaskDeck(catalog, step.deckId);
  await assertManifestHash(root, catalog);
  await publishJourney(root, () => assertManifestHash(root, catalog), { id: randomUUID(), version: 1, title: edit.title.trim(),
    deckId: edit.deckId, description: '', zones: [], steps: edit.steps }, catalog.formatLanguage);
}

/** Save the editor's template with version +1; remove deleted steps and leave unchanged files untouched. */
export async function updateJourney(root: string, catalog: CatalogView, edit: UpdateJourneyEdit): Promise<string[]> {
  await recoverJourneyOperation(root, edit.journeyId);
  if (!validText(edit.title, 120)) throw new Error(serverText(messages).invalidJourneyTitle);
  if (typeof edit.description !== 'string' || edit.description.length > 2000) throw new Error(serverText(messages).journeyDescriptionTooLong);
  const zones = validateJourneyZones(edit.zones);
  orderedSteps(edit.steps);
  validateStepZones(edit.steps, zones);
  for (const step of edit.steps) requireTaskDeck(catalog, step.deckId);
  const verifySources = () => assertManifestHash(root, { ...catalog, manifestHash: edit.manifestHash });
  const current = await readJourney(root, edit.journeyId);
  if (!current) throw new Error(serverText(messages).journeyNotFound);
  if (current.journey.fileHash !== edit.journeyHash) throw new Error('JOURNEY_CONFLICT');
  await assertManifestHash(root, catalog);
  await verifySources();
  return publishJourney(root, () => assertManifestHash(root, catalog), { id: current.journey.id, version: current.journey.version + 1,
    title: edit.title.trim(), deckId: current.journey.deckId, description: edit.description, zones, steps: edit.steps,
    existing: { steps: current.journey.steps, hashes: stepFileHashes(current.documents), indexHash: current.documents[0].hash } }, catalog.formatLanguage);
}

/**
 * 2026-11-04: append a lesson to the step's lessons section, preserving its YAML header byte for byte.
 * Keep the Journey version: step membership and Task addresses are unchanged, and bumping the version
 * would create duplicate cards when reapplying it to the same Hero.
 */
export async function addJourneyStepLesson(root: string, catalog: CatalogView, edit: AddJourneyStepLessonEdit, actorMemberId: string | null, date: string): Promise<string[]> {
  await recoverJourneyOperation(root, edit.journeyId);
  const author = catalog.members?.find(member => member.id === actorMemberId)?.label;
  if (!author) throw new Error(serverText(messages).lessonAuthorRequired);
  const card = catalog.cards.find(candidate => candidate.id === edit.cardId);
  if (!card?.journey || card.journey.journeyId !== edit.journeyId || card.journey.stepId !== edit.stepId) {
    throw new Error(serverText(messages).lessonTaskRequired);
  }
  const current = await readJourney(root, edit.journeyId);
  if (!current) throw new Error(serverText(messages).journeyNotFound);
  if (current.journey.fileHash !== edit.journeyHash) throw new Error('JOURNEY_CONFLICT');
  if (!current.journey.steps.some(step => step.id === edit.stepId)) throw new Error(serverText(messages).missingLessonStep(edit.stepId));
  const relativePath = `tasks/journeys/${edit.journeyId}/steps/${edit.stepId}.md`;
  const file = await readManagedMarkdown(root, relativePath);
  if (!file) throw new Error('JOURNEY_CONFLICT');
  const markdown = appendJourneyLesson(file.markdown, edit.text, author, date, card.id, serverLang(), catalog.formatLanguage);
  if (markdown === file.markdown) return [];
  if (markdown.length > 200000) throw new Error(serverText(messages).lessonTooLong);
  const bytes = Buffer.concat([file.bytes.subarray(0, file.bodyRange.start), Buffer.from(markdown)]);
  await replaceProjectMarkdown(root, relativePath, file.fileHash, bytes, async () => {
    await assertJourneyReady(root, edit.journeyId);
    const fresh = await readJourney(root, edit.journeyId);
    if (!fresh || fresh.journey.fileHash !== edit.journeyHash) throw new Error('JOURNEY_CONFLICT');
  });
  return [relativePath];
}

function stableUuid(values: (string | number)[]): string {
  const hexadecimal = createHash('sha256').update(JSON.stringify(values)).digest('hex').slice(0, 32).split('');
  hexadecimal[12] = '8';
  hexadecimal[16] = ((Number.parseInt(hexadecimal[16], 16) & 3) | 8).toString(16);
  const value = hexadecimal.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

/** Instance of a Journey on one parent; shared with the starter-template plan so both check the same identity (2026-11-05). */
export function journeyInstanceId(parentId: string, journeyId: string, version: number): string {
  return stableUuid([parentId, journeyId, version]);
}

export function journeyCardId(parentId: string, journeyId: string, version: number, stepId: string): string {
  return `card:${stableUuid([parentId, journeyId, version, stepId])}`;
}

function matchingInstance(file: NativeCardFile, parentId: string, journey: CatalogJourney, stepId: string, instanceId: string): boolean {
  const metadata = file.metadata;
  return metadata.kind === 'task' && metadata.parentId === parentId && metadata.journey?.journeyId === journey.id
    && metadata.journey.version === journey.version && metadata.journey.stepId === stepId && metadata.journey.instanceId === instanceId;
}

async function assertApplySources(root: string, catalog: CatalogView, parentPath: string, sourceHash: string, journey: CatalogJourney): Promise<void> {
  await assertJourneyReady(root, journey.id);
  await assertManifestHash(root, catalog);
  if ((await readCardOptions(root)).hash !== (catalog.optionsHash ?? '')) throw new Error('CARD_OPTIONS_CONFLICT');
  if (digest(await readFile(await containedFile(root, parentPath))) !== sourceHash) throw new Error('CARD_CONFLICT');
  const current = await readJourney(root, journey.id);
  if (!current || current.journey.fileHash !== journey.fileHash) throw new Error('JOURNEY_CONFLICT');
}

export async function applyJourney(root: string, catalog: CatalogView, edit: ApplyJourneyEdit): Promise<JourneyApplyResult> {
  await recoverJourneyOperation(root, edit.journeyId);
  if (!edit.sourceHash || !/^[0-9a-f]{64}$/u.test(edit.sourceHash)) throw new Error(serverText(messages).journeySourceHashRequired);
  const sourceHash = edit.sourceHash;
  const parent = catalog.cards.find(card => card.id === edit.cardId);
  if (!parent || parent.kind !== 'hero' || parent.parentId !== null) throw new Error(serverText(messages).journeyRootHeroRequired);
  if (parent.archived || parent.deleted) throw new Error(serverText(messages).journeyRestoreHero);
  const result = await readJourney(root, edit.journeyId);
  if (!result || result.journey.fileHash !== edit.journeyHash) throw new Error('JOURNEY_CONFLICT');
  const journey = result.journey;
  if (parent.deckId !== journey.deckId) throw new Error(serverText(messages).journeyHeroDeckMismatch);
  requireSourceDeck(catalog, journey.deckId);
  if (parent.sourceHash !== sourceHash) throw new Error('CARD_CONFLICT');
  const steps = orderedSteps(journey.steps);
  if (!Array.isArray(edit.stepIds) || edit.stepIds.length < 1 || new Set(edit.stepIds).size !== edit.stepIds.length
    || edit.stepIds.some(id => !steps.some(step => step.id === id))) throw new Error(serverText(messages).journeyUniqueStepsRequired);
  if (!edit.deckAssignments || typeof edit.deckAssignments !== 'object' || Array.isArray(edit.deckAssignments)) throw new Error(serverText(messages).invalidStepDeckMap);
  for (const [stepId, deckId] of Object.entries(edit.deckAssignments)) {
    if (!steps.some(step => step.id === stepId) || typeof deckId !== 'string') throw new Error(serverText(messages).unknownMappedStep);
    requireTaskDeck(catalog, deckId);
  }
  const selected = steps.filter(step => edit.stepIds.includes(step.id));
  const targetDeck = (step: CatalogJourneyStep) => Object.hasOwn(edit.deckAssignments, step.id) ? edit.deckAssignments[step.id] : step.deckId;
  for (const step of selected) requireTaskDeck(catalog, targetDeck(step));
  const instanceId = journeyInstanceId(parent.id, journey.id, journey.version);
  const existing = new Map<string, NativeCardFile>();
  for (const step of steps) {
    const cardId = journeyCardId(parent.id, journey.id, journey.version, step.id);
    const file = await readNativeCard(root, cardId);
    if (!file) continue;
    if (!matchingInstance(file, parent.id, journey, step.id, instanceId)) throw new Error(serverText(messages).stepAlreadyOccupied(step.id));
    existing.set(step.id, file);
  }
  for (const step of selected) {
    for (const dependency of step.dependsOn) {
      if (!edit.stepIds.includes(dependency) && !existing.has(dependency)) throw new Error(serverText(messages).includeDependency(dependency, step.id));
    }
  }
  const prepared = new Map<string, { metadata: NativeCardMetadata; markdown: string }>();
  for (const step of selected) {
    const title = step.title.replaceAll('%PARENT_TITLE%', parent.title);
    const instruction = rebaseMarkdownLinks(step.markdown.replaceAll('%PARENT_TITLE%', parent.title),
      `tasks/journeys/${journey.id}/steps/${step.id}.md`, `cards/${journeyCardId(parent.id, journey.id, journey.version, step.id).slice(5)}.md`);
    const markdown = `${instruction}\n\n---\n\nJourney step: [${step.id}](../tasks/journeys/${journey.id}/steps/${step.id}.md)\n`;
    if (!validText(title, 300) || markdown.length > 200000) throw new Error(serverText(messages).stepTextTooLong(step.id));
    const metadata: NativeCardMetadata = { deckmate: 'card', schema: 1,
      id: journeyCardId(parent.id, journey.id, journey.version, step.id).slice('card:'.length), kind: 'task',
      title, state: writeCardState('not-started', catalog.formatLanguage), owner: step.owner, deckId: targetDeck(step), trackIds: [...parent.trackIds], parentId: parent.id, iteration: null,
      dependsOn: step.dependsOn.map(dependency => journeyCardId(parent.id, journey.id, journey.version, dependency)),
      journey: { journeyId: journey.id, version: journey.version, stepId: step.id, instanceId } };
    // 2026-11-04: copy the step's effort and priority to the new Sub Card.
    if (step.effort !== null && step.effort !== undefined) metadata.effort = step.effort;
    if (step.priority !== null && step.priority !== undefined) metadata.priority = step.priority;
    validateNativeCardMetadata(metadata, metadata.id);
    prepared.set(step.id, { metadata, markdown });
  }
  await assertApplySources(root, catalog, parent.path, sourceHash, journey);
  const created: string[] = [];
  try {
    for (const step of selected) {
      if (existing.has(step.id)) continue;
      await assertApplySources(root, catalog, parent.path, sourceHash, journey);
      const cardId = journeyCardId(parent.id, journey.id, journey.version, step.id);
      for (const dependency of step.dependsOn) {
        const prerequisite = await readNativeCard(root, journeyCardId(parent.id, journey.id, journey.version, dependency));
        if (!prerequisite || !matchingInstance(prerequisite, parent.id, journey, dependency, instanceId)) throw new Error(serverText(messages).dependencyChanged(dependency));
      }
      const { metadata, markdown } = prepared.get(step.id)!;
      const written = await createManagedMarkdown(root, `cards/${metadata.id}.md`, metadata, markdown,
        () => assertApplySources(root, catalog, parent.path, sourceHash, journey));
      if (written) created.push(cardId);
      else {
        const concurrent = await readNativeCard(root, cardId);
        if (!concurrent || !matchingInstance(concurrent, parent.id, journey, step.id, instanceId)) throw new Error(serverText(messages).stepOccupied(step.id));
        existing.set(step.id, concurrent);
      }
    }
    return { created, existing: selected.filter(step => existing.has(step.id)).map(step => existing.get(step.id)!.card.id), missing: [] };
  } catch (error) {
    const present: string[] = [];
    const missing: string[] = [];
    for (const step of selected) {
      const cardId = journeyCardId(parent.id, journey.id, journey.version, step.id);
      try {
        const file = await readNativeCard(root, cardId);
        if (file && matchingInstance(file, parent.id, journey, step.id, instanceId)) { if (!present.includes(cardId)) present.push(cardId); }
        else missing.push(cardId);
      } catch { missing.push(cardId); }
    }
    throw new JourneyPartialError(serverText(messages).partialApply(present.length, missing.length, error instanceof Error ? error.message : String(error)), present, missing, present.length > 0 || created.length > 0 || (error as { saved?: boolean }).saved === true);
  }
}
