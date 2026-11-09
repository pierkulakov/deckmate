import { defineText, serverLang, serverText } from './i18n.ts';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { containedFile } from './config.ts';
import { createManagedMarkdown } from './native-cards.ts';
import { packagePath } from './package-path.ts';
import { parse } from 'yaml';
import type {
  CatalogEdit, CatalogJourneyStep, CatalogJourneyTemplate, CatalogJourneyTemplateRole,
  CatalogJourneyTemplateStep, CatalogJourneyZone, CatalogView, JourneyTemplateSource,
} from '../src/catalog-contracts.ts';
import type { FormatLanguage } from '../src/format-vocabulary.ts';
import { parseTemplateLocales } from '../src/template-locales.ts';
import { templateText } from '../src/template-text.ts';
import {
  assertManifestHash, orderedDependencies, publishJourney, readJourney, requireSourceDeck, requireTaskDeck,
  stepFileHashes, validateJourneyZones, validateStepZones, validText,
} from './journeys.ts';

const messages = defineText({
  invalidStepReference: (reference: string) => `Invalid template step address: ${reference}`,
  stepIdMismatch: (reference: string) => `The step ID does not match its file: ${reference}`,
  invalidTemplateStep: (reference: string) => `Invalid template step: ${reference}`,
  unknownStepRole: (reference: string) => `The step references an unknown role: ${reference}`,
  invalidStepEffort: (reference: string) => `Invalid template step Effort: ${reference}`,
  invalidStepPriority: (reference: string) => `Invalid template step Priority: ${reference}`,
  invalidStepZone: (reference: string) => `Invalid template step zone: ${reference}`,
  partialSave: (written: string, directory: string, reason: string) => `Template partly saved. Written: ${written}; check ${directory} and retry. ${reason}`,
  unknownRole: (role: string) => `Unknown template role: ${role}`,
  invalidRoleTarget: (role: string) => `Invalid role assignment: ${role}`,
  invalidRoleDeck: (role: string) => `Invalid Deck for role: ${role}`,
  invalidNewDeckTitle: (role: string) => `The new Deck title for role “${role}” must be a string of 1 to 120 characters.`,
  newDeckSpaceNotFound: (role: string, space: string) => `Space for the new Deck for role “${role}” not found: ${space}`,
  roleDeckRequired: (role: string) => `Choose a Deck for role “${role}”.`,
  deckCreationFailed: (title: string) => `Could not create Deck “${title}”.`,
  journeyNotFound: "Journey not found.",
  templateHeaderMissing: "The template file has no YAML frontmatter.",
  templateHeaderObjectRequired: "Template YAML frontmatter must contain an object.",
  uniqueStringsRequired: "Expected a list of unique strings.",
  invalidTemplateHeader: "Invalid Journey template frontmatter.",
  invalidTemplateTitle: "Invalid template title.",
  invalidTemplateDescription: "Invalid template description.",
  invalidTemplateCategory: "Invalid template category.",
  invalidTemplateAuthor: "Invalid template author.",
  invalidTemplateDate: "The template update date must use YYYY-MM-DD.",
  invalidTemplateTag: "A template tag must be a string of up to 40 characters.",
  invalidTemplateRoleCount: "Template roles must be a list of 1 to 20 items.",
  invalidTemplateRole: "Invalid or duplicate template role.",
  templateAddressOccupied: "The template address is already in use.",
  templateTitleTooLong: "The template title must contain 1 to 120 characters.",
  templateDescriptionTooLong: "The template description must be a string of up to 2000 characters.",
  templateCategoryTooLong: "The template category must be a string of 1 to 60 characters.",
  invalidRoleMapping: "roleMapping must map each roleId to a Deck or a new Deck definition.",
  journeyHashRequired: "Editing an existing Journey needs its current version. Refresh the catalog and try again.",
  journeyDeckMismatch: "The Journey belongs to another Deck.",
  templateNotFound: "Journey template not found. Refresh the catalog and try again.",
}, {
  invalidStepReference: (reference: string) => `Некорректный адрес шага шаблона: ${reference}`,
  stepIdMismatch: (reference: string) => `ID шага не совпадает с файлом: ${reference}`,
  invalidTemplateStep: (reference: string) => `Некорректный шаг шаблона: ${reference}`,
  unknownStepRole: (reference: string) => `Шаг ссылается на неизвестную роль: ${reference}`,
  invalidStepEffort: (reference: string) => `Некорректная цена шага шаблона: ${reference}`,
  invalidStepPriority: (reference: string) => `Некорректный приоритет шага шаблона: ${reference}`,
  invalidStepZone: (reference: string) => `Некорректная зона шага шаблона: ${reference}`,
  partialSave: (written: string, directory: string, reason: string) => `Сохранение шаблона завершено не полностью. Записаны: ${written}; проверьте ${directory} и повторите. ${reason}`,
  unknownRole: (role: string) => `Неизвестная роль шаблона: ${role}`,
  invalidRoleTarget: (role: string) => `Некорректное назначение роли: ${role}`,
  invalidRoleDeck: (role: string) => `Некорректная колода для роли: ${role}`,
  invalidNewDeckTitle: (role: string) => `Название новой колоды для роли «${role}» — строка от 1 до 120 символов.`,
  newDeckSpaceNotFound: (role: string, space: string) => `Пространство для новой колоды роли «${role}» не найдено: ${space}`,
  roleDeckRequired: (role: string) => `Для роли «${role}» не выбрана колода.`,
  deckCreationFailed: (title: string) => `Не удалось создать колоду «${title}».`,
  journeyNotFound: "Journey не найден.",
  templateHeaderMissing: "Отсутствует YAML-шапка файла шаблона.",
  templateHeaderObjectRequired: "YAML-шапка шаблона должна содержать объект.",
  uniqueStringsRequired: "Ожидается список уникальных строк.",
  invalidTemplateHeader: "Некорректная шапка шаблона Journey.",
  invalidTemplateTitle: "Некорректное название шаблона.",
  invalidTemplateDescription: "Некорректное описание шаблона.",
  invalidTemplateCategory: "Некорректная категория шаблона.",
  invalidTemplateAuthor: "Некорректный автор шаблона.",
  invalidTemplateDate: "Дата обновления шаблона — YYYY-MM-DD.",
  invalidTemplateTag: "Тег шаблона — строка до 40 символов.",
  invalidTemplateRoleCount: "Роли шаблона — список от 1 до 20 элементов.",
  invalidTemplateRole: "Некорректная или повторяющаяся роль шаблона.",
  templateAddressOccupied: "Адрес шаблона уже занят.",
  templateTitleTooLong: "Название шаблона должно содержать от 1 до 120 символов.",
  templateDescriptionTooLong: "Описание шаблона — строка до 2000 символов.",
  templateCategoryTooLong: "Категория шаблона — строка от 1 до 60 символов.",
  invalidRoleMapping: "roleMapping — объект roleId → колода или создание колоды.",
  journeyHashRequired: "Для правки существующего Journey нужна его актуальная версия. Обновите каталог и повторите действие.",
  journeyDeckMismatch: "Journey принадлежит другой колоде.",
  templateNotFound: "Шаблон Journey не найден. Обновите каталог и повторите.",
});


type ImportJourneyTemplateEdit = Extract<CatalogEdit, { action: 'import-journey-template' }>;
type SaveJourneyTemplateEdit = Extract<CatalogEdit, { action: 'save-journey-template' }>;

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const templateIdPattern = /^[a-z0-9][a-z0-9-]{0,59}$/u;
const stepReferencePattern = /^steps\/([a-zA-Z0-9][a-zA-Z0-9_-]{0,79})\.md$/u;
const datePattern = /^\d{4}-\d{2}-\d{2}$/u;
// These words land in project files, so they follow the project's format language, not the interface language.
const formatText = defineText({
  defaultZoneTitle: 'Main steps',
  templateAuthor: 'Project',
}, {
  defaultZoneTitle: 'Основные шаги',
  templateAuthor: 'Проект',
});
// Use a deterministic accent palette for Task decks created during role imports.
const deckPalette = ['#7C5CFF', '#2FA463', '#E5536D', '#3E8FDD', '#E5A13D', '#14B8A6'];

// catalog.ts imports this module to read templates; import manifest writers dynamically
// to avoid a static import cycle, as catalog.ts does for catalog-bulk.
let catalogModule: Promise<typeof import('./catalog.ts')> | null = null;
function loadCatalogModule(): Promise<typeof import('./catalog.ts')> {
  catalogModule ??= import('./catalog.ts');
  return catalogModule;
}

/** Built-in templates belong to the Deckmate package, separate from project data. */
export function bundledJourneyTemplatesDirectory(): string {
  return packagePath('assets', 'journey-templates');
}

interface TemplateFile { metadata: Record<string, unknown>; markdown: string; fileHash: string }

function parseTemplateFile(bytes: Buffer): TemplateFile {
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  const match = /^---(\r?\n)([\s\S]*?)^---[ \t]*(?:\r?\n|$)/mu.exec(text);
  if (!match || match.index !== 0) throw new Error(serverText(messages).templateHeaderMissing);
  const metadata: unknown = parse(match[2]);
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error(serverText(messages).templateHeaderObjectRequired);
  return { metadata: metadata as Record<string, unknown>, markdown: text.slice(match[0].length), fileHash: digest(bytes) };
}

function stringList(value: unknown, maximum: number): string[] {
  if (!Array.isArray(value) || value.length > maximum || value.some(item => typeof item !== 'string' || !item)
    || new Set(value).size !== value.length) throw new Error(serverText(messages).uniqueStringsRequired);
  return value as string[];
}

/**
 * 2026-11-09: template folders as a root and a directory relative to it. Every read resolves through containedFile,
 * so a junction or symlink in a cloned project cannot pull outside files into the catalog or its fingerprint.
 */
export function journeyTemplateDirectories(bundledDirectory: string, projectRoot: string): Array<{
  root: string; directory: string; source: JourneyTemplateSource; label: string;
}> {
  return [
    { root: path.dirname(bundledDirectory), directory: path.basename(bundledDirectory), source: 'bundled', label: 'assets/journey-templates' },
    { root: projectRoot, directory: 'tasks/journey-templates', source: 'project', label: 'tasks/journey-templates' },
  ];
}

async function readTemplateFile(root: string, relative: string): Promise<TemplateFile> {
  return parseTemplateFile(await readFile(await containedFile(root, relative)));
}

async function readTemplate(id: string, root: string, directory: string, source: JourneyTemplateSource): Promise<CatalogJourneyTemplate> {
  const index = await readTemplateFile(root, path.posix.join(directory, 'index.md'));
  const metadata = index.metadata;
  if ((metadata.deckmate ?? metadata.freetion) !== 'journey-template' || metadata.schema !== 1 || metadata.id !== id || !templateIdPattern.test(id)) {
    throw new Error(serverText(messages).invalidTemplateHeader);
  }
  if (!validText(metadata.title, 120)) throw new Error(serverText(messages).invalidTemplateTitle);
  if (metadata.description !== undefined && (typeof metadata.description !== 'string' || metadata.description.length > 2000)) {
    throw new Error(serverText(messages).invalidTemplateDescription);
  }
  const locales = parseTemplateLocales(metadata.locales, serverLang());
  if (!validText(metadata.category, 60)) throw new Error(serverText(messages).invalidTemplateCategory);
  if (!validText(metadata.author, 120)) throw new Error(serverText(messages).invalidTemplateAuthor);
  if (typeof metadata.updated !== 'string' || !datePattern.test(metadata.updated)) throw new Error(serverText(messages).invalidTemplateDate);
  const tags = metadata.tags === undefined ? [] : stringList(metadata.tags, 20);
  for (const tag of tags) if (tag.length > 40) throw new Error(serverText(messages).invalidTemplateTag);
  if (!Array.isArray(metadata.roles) || metadata.roles.length < 1 || metadata.roles.length > 20) throw new Error(serverText(messages).invalidTemplateRoleCount);
  const roles: CatalogJourneyTemplateRole[] = [];
  for (const role of metadata.roles) {
    if (!role || typeof role !== 'object' || !validText((role as CatalogJourneyTemplateRole).id, 60)
      || !templateIdPattern.test((role as CatalogJourneyTemplateRole).id) || !validText((role as CatalogJourneyTemplateRole).title, 120)
      || roles.some(candidate => candidate.id === (role as CatalogJourneyTemplateRole).id)) throw new Error(serverText(messages).invalidTemplateRole);
    roles.push({ id: (role as CatalogJourneyTemplateRole).id, title: (role as CatalogJourneyTemplateRole).title.trim() });
  }
  const zones = metadata.zones === undefined ? [] : validateJourneyZones(metadata.zones);
  const references = stringList(metadata.steps, 100);
  for (const reference of references) if (!stepReferencePattern.test(reference)) throw new Error(serverText(messages).invalidStepReference(reference));
  const steps: CatalogJourneyTemplateStep[] = [];
  const documents: Array<[string, string]> = [['index.md', index.fileHash]];
  for (const reference of references) {
    const stepId = stepReferencePattern.exec(reference)![1];
    const file = await readTemplateFile(root, path.posix.join(directory, reference));
    if (file.metadata.id !== stepId) throw new Error(serverText(messages).stepIdMismatch(reference));
    if (!validText(file.metadata.title, 300) || typeof file.markdown !== 'string' || file.markdown.length > 200000) {
      throw new Error(serverText(messages).invalidTemplateStep(reference));
    }
    if (!validText(file.metadata.roleId, 60) || !roles.some(role => role.id === file.metadata.roleId)) {
      throw new Error(serverText(messages).unknownStepRole(reference));
    }
    const effort = file.metadata.effort ?? null;
    if (effort !== null && (typeof effort !== 'number' || !Number.isFinite(effort) || effort < 0)) {
      throw new Error(serverText(messages).invalidStepEffort(reference));
    }
    const priority = file.metadata.priority ?? null;
    if (priority !== null && !['high', 'medium', 'low'].includes(priority as string)) {
      throw new Error(serverText(messages).invalidStepPriority(reference));
    }
    // Validated values can now be narrowed to the template contract.
    const stepPriority = priority as CatalogJourneyTemplateStep['priority'];
    if (file.metadata.zoneId !== undefined && typeof file.metadata.zoneId !== 'string') {
      throw new Error(serverText(messages).invalidStepZone(reference));
    }
    const step: CatalogJourneyTemplateStep = { id: stepId, title: file.metadata.title as string, markdown: file.markdown,
      roleId: file.metadata.roleId as string, dependsOn: stringList(file.metadata.dependsOn, 30), effort, priority: stepPriority };
    if (typeof file.metadata.zoneId === 'string') step.zoneId = file.metadata.zoneId;
    steps.push(step);
    documents.push([reference, file.fileHash]);
  }
  orderedDependencies(steps);
  validateStepZones(steps, zones);
  // As with Journeys, the aggregate revision covers the index, its order, and all instructions.
  return { id, source, title: (metadata.title as string).trim(), description: (metadata.description as string | undefined) ?? '',
    category: (metadata.category as string).trim(), tags, author: (metadata.author as string).trim(), updated: metadata.updated as string,
    roles, zones, steps, ...(locales ? { locales } : {}), fileHash: digest(Buffer.from(JSON.stringify(documents))) };
}

async function collectTemplates({ root, directory, source, label }: ReturnType<typeof journeyTemplateDirectories>[number],
  templates: CatalogJourneyTemplate[], warnings: string[]): Promise<void> {
  let entries;
  try { entries = await readdir(await containedFile(root, directory), { withFileTypes: true }); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return;
    if (code === 'OUTSIDE_PROJECT') { warnings.push(`${label}: ${(error as Error).message}`); return; }
    throw error;
  }
  for (const entry of entries.sort((first, second) => (first.name < second.name ? -1 : first.name > second.name ? 1 : 0))) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !templateIdPattern.test(entry.name)) continue;
    const templateDirectory = path.posix.join(directory, entry.name);
    // index.md marks a published template; ignore orphaned step files, as with Journeys.
    try {
      const indexStat = await lstat(path.join(root, templateDirectory, 'index.md'));
      if (!indexStat.isFile() || indexStat.isSymbolicLink()) continue;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    try { templates.push(await readTemplate(entry.name, root, templateDirectory, source)); }
    catch (error) { warnings.push(`${label}/${entry.name}/index.md: ${error instanceof Error ? error.message : String(error)}`); }
  }
}

/** Combine built-in and project Journey templates; invalid templates produce warnings without failing the catalog. */
export async function readJourneyTemplates(bundledDirectory: string, projectRoot: string): Promise<{ templates: CatalogJourneyTemplate[]; warnings: string[] }> {
  const templates: CatalogJourneyTemplate[] = [];
  const warnings: string[] = [];
  for (const location of journeyTemplateDirectories(bundledDirectory, projectRoot)) await collectTemplates(location, templates, warnings);
  return { templates, warnings };
}

/** Templates share the Journey writer so linked ancestors cannot redirect publication outside the project. */
async function writeNewTemplateFile(root: string, relativePath: string, metadata: Record<string, unknown>, markdown: string): Promise<void> {
  if (!await createManagedMarkdown(root, relativePath, metadata, markdown)) {
    throw new Error(serverText(messages).templateAddressOccupied);
  }
}

/** Save a deck's Journey as a project template, with one role per distinct step deck. */
export async function saveJourneyTemplate(root: string, catalog: CatalogView, edit: SaveJourneyTemplateEdit): Promise<string[]> {
  if (!validText(edit.title, 120)) throw new Error(serverText(messages).templateTitleTooLong);
  if (typeof edit.description !== 'string' || edit.description.length > 2000) throw new Error(serverText(messages).templateDescriptionTooLong);
  if (!validText(edit.category, 60)) throw new Error(serverText(messages).templateCategoryTooLong);
  const tags = stringList(edit.tags, 20);
  for (const tag of tags) if (tag.length > 40) throw new Error(serverText(messages).invalidTemplateTag);
  const current = await readJourney(root, edit.journeyId);
  if (!current) throw new Error(serverText(messages).journeyNotFound);
  if (current.journey.fileHash !== edit.journeyHash) throw new Error('JOURNEY_CONFLICT');
  await assertManifestHash(root, catalog);
  const roles: CatalogJourneyTemplateRole[] = [];
  for (const step of current.journey.steps) {
    if (roles.some(role => role.id === step.deckId)) continue;
    roles.push({ id: step.deckId, title: catalog.decks.find(deck => deck.id === step.deckId)?.title ?? step.deckId });
  }
  const templateId = randomUUID();
  const directory = `tasks/journey-templates/${templateId}`;
  const title = edit.title.trim();
  const zones = current.journey.zones ?? [];
  const written: string[] = [];
  try {
    for (const step of current.journey.steps) {
      const metadata: Record<string, unknown> = { id: step.id, title: step.title, roleId: step.deckId, dependsOn: step.dependsOn };
      if (step.effort !== null && step.effort !== undefined) metadata.effort = step.effort;
      if (step.priority !== null && step.priority !== undefined) metadata.priority = step.priority;
      if (step.zoneId !== undefined) metadata.zoneId = step.zoneId;
      const relativePath = `${directory}/steps/${step.id}.md`;
      await writeNewTemplateFile(root, relativePath, metadata, step.markdown);
      written.push(relativePath);
    }
    const index: Record<string, unknown> = { deckmate: 'journey-template', schema: 1, id: templateId, title,
      description: edit.description.trim(), category: edit.category.trim(), tags, author: formatText[catalog.formatLanguage].templateAuthor,
      updated: new Date().toISOString().slice(0, 10),
      roles, steps: current.journey.steps.map(step => `steps/${step.id}.md`) };
    if (zones.length > 0) index.zones = zones;
    const body = `# ${title}\n\n${edit.description.trim()}\n\n`
      + current.journey.steps.map((step, position) => `${position + 1}. [${step.id}](steps/${step.id}.md) — ${step.title}; role: ${step.deckId}`).join('\n') + '\n';
    await writeNewTemplateFile(root, `${directory}/index.md`, index, body);
    written.push(`${directory}/index.md`);
  } catch (error) {
    if (written.length > 0 || (error as { saved?: boolean }).saved) {
      const failure = new Error(serverText(messages).partialSave(written.join(', '), directory, error instanceof Error ? error.message : String(error)));
      Object.assign(failure, { saved: true });
      throw failure;
    }
    throw error;
  }
  return written;
}

async function resolveRoleTargets(root: string, catalog: CatalogView, edit: ImportJourneyTemplateEdit,
  template: CatalogJourneyTemplate): Promise<{ deckForRole: Map<string, string>; manifestHash: string }> {
  const roleIds = new Set(template.roles.map(role => role.id));
  const usedRoles = new Set(template.steps.map(step => step.roleId));
  const deckForRole = new Map<string, string>();
  const creations: Array<{ roleId: string; title: string; spaceId: string }> = [];
  if (!edit.roleMapping || typeof edit.roleMapping !== 'object' || Array.isArray(edit.roleMapping)) {
    throw new Error(serverText(messages).invalidRoleMapping);
  }
  for (const [roleId, target] of Object.entries(edit.roleMapping)) {
    if (!roleIds.has(roleId)) throw new Error(serverText(messages).unknownRole(roleId));
    if (!target || typeof target !== 'object' || Array.isArray(target)) throw new Error(serverText(messages).invalidRoleTarget(roleId));
    if ('deckId' in target) {
      const deckId = (target as { deckId: unknown }).deckId;
      if (!validText(deckId, 80)) throw new Error(serverText(messages).invalidRoleDeck(roleId));
      requireTaskDeck(catalog, deckId as string);
      deckForRole.set(roleId, deckId as string);
    } else {
      const creation = (target as { createDeck?: { title?: unknown; spaceId?: unknown } }).createDeck;
      if (!creation || typeof creation !== 'object' || !validText(creation.title, 120)) {
        throw new Error(serverText(messages).invalidNewDeckTitle(roleId));
      }
      if (typeof creation.spaceId !== 'string' || !catalog.spaces.some(space => space.id === creation.spaceId)) {
        throw new Error(serverText(messages).newDeckSpaceNotFound(roleId, String(creation.spaceId)));
      }
      creations.push({ roleId, title: (creation.title as string).trim(), spaceId: creation.spaceId });
    }
  }
  for (const roleId of usedRoles) {
    if (deckForRole.has(roleId) || creations.some(creation => creation.roleId === roleId)) continue;
    throw new Error(serverText(messages).roleDeckRequired(template.roles.find(role => role.id === roleId)!.title));
  }
  // Create Task decks through create-deck so manifest edits use the same validation.
  let manifestHash = catalog.manifestHash;
  if (creations.length > 0) {
    const { editProjectCatalog, readManifest } = await loadCatalogModule();
    for (const creation of creations) {
      const source = await readManifest(root);
      manifestHash = source.bytes ? digest(source.bytes) : '';
      const known = new Set(source.manifest.decks.map(deck => deck.id));
      await editProjectCatalog(root, { action: 'create-deck', title: creation.title, spaceId: creation.spaceId, kind: 'task',
        icon: 'list', color: deckPalette[deckForRole.size % deckPalette.length], description: '', manifestHash });
      const after = await readManifest(root);
      const deck = after.manifest.decks.find(candidate => !known.has(candidate.id));
      if (!deck) throw new Error(serverText(messages).deckCreationFailed(creation.title));
      deckForRole.set(creation.roleId, deck.id);
    }
    const source = await readManifest(root);
    manifestHash = source.bytes ? digest(source.bytes) : '';
  }
  return { deckForRole, manifestHash };
}

function mergedZones(current: CatalogJourneyZone[], template: CatalogJourneyZone[], steps: CatalogJourneyStep[],
  formatLanguage: FormatLanguage): CatalogJourneyZone[] {
  const zones = [...current];
  const identifiers = new Set(current.map(zone => zone.id));
  for (const zone of template) {
    if (identifiers.has(zone.id)) continue;
    zones.push(zone);
    identifiers.add(zone.id);
  }
  if (steps.some(step => (step.zoneId ?? 'default') === 'default') && !identifiers.has('default')) {
    zones.push({ id: 'default', title: formatText[formatLanguage].defaultZoneTitle });
    identifiers.add('default');
  }
  return zones;
}

async function requireImportTarget(root: string, edit: ImportJourneyTemplateEdit) {
  if (!edit.journeyId || !edit.journeyHash) throw new Error(serverText(messages).journeyHashRequired);
  const current = await readJourney(root, edit.journeyId);
  if (!current) throw new Error(serverText(messages).journeyNotFound);
  if (current.journey.fileHash !== edit.journeyHash) throw new Error('JOURNEY_CONFLICT');
  if (current.journey.deckId !== edit.deckId) throw new Error(serverText(messages).journeyDeckMismatch);
  return current;
}

/**
 * Add mode appends steps to an existing or new Journey; replace mode replaces steps and Zones.
 * Resolve step-ID collisions with suffixes -2, -3, and so on.
 */
export async function importJourneyTemplate(root: string, catalog: CatalogView, edit: ImportJourneyTemplateEdit): Promise<string[]> {
  const template = (catalog.journeyTemplates ?? []).find(candidate => candidate.id === edit.templateId && candidate.source === edit.templateSource);
  if (!template) throw new Error(serverText(messages).templateNotFound);
  if (template.fileHash !== edit.templateHash) throw new Error('TEMPLATE_CONFLICT');
  const { deckForRole, manifestHash } = await resolveRoleTargets(root, catalog, edit, template);
  const imported = template.steps.map(step => ({ id: step.id, title: step.title, markdown: step.markdown,
    deckId: deckForRole.get(step.roleId)!, owner: null, dependsOn: step.dependsOn,
    effort: step.effort ?? null, priority: step.priority ?? null, ...(step.zoneId !== undefined ? { zoneId: step.zoneId } : {}) }));
  const verifySources = async () => {
    const { readManifest } = await loadCatalogModule();
    const source = await readManifest(root);
    if ((source.bytes ? digest(source.bytes) : '') !== manifestHash) throw new Error('CATALOG_CONFLICT');
  };
  if (edit.mode === 'add' && edit.journeyId === null) {
    requireSourceDeck(catalog, edit.deckId);
    orderedDependencies(imported);
    validateStepZones(imported, template.zones);
    const localized = templateText(template, catalog.formatLanguage);
    return publishJourney(root, verifySources, { id: randomUUID(), version: 1, title: localized.title,
      deckId: edit.deckId, description: localized.description, zones: template.zones, steps: imported }, catalog.formatLanguage);
  }
  const current = await requireImportTarget(root, edit);
  const existing = { steps: current.journey.steps, hashes: stepFileHashes(current.documents), indexHash: current.documents[0].hash };
  if (edit.mode === 'replace') {
    orderedDependencies(imported);
    validateStepZones(imported, template.zones);
    return publishJourney(root, verifySources, { id: current.journey.id, version: current.journey.version + 1,
      title: current.journey.title, deckId: current.journey.deckId, description: current.journey.description ?? '',
      zones: template.zones, steps: imported, existing }, catalog.formatLanguage);
  }
  const usedIds = new Set(current.journey.steps.map(step => step.id));
  const renames = new Map<string, string>();
  for (const step of template.steps) {
    let candidate = step.id;
    if (usedIds.has(candidate)) {
      let counter = 2;
      while (usedIds.has(`${step.id}-${counter}`)) counter += 1;
      candidate = `${step.id}-${counter}`;
    }
    renames.set(step.id, candidate);
    usedIds.add(candidate);
  }
  const steps: CatalogJourneyStep[] = [...current.journey.steps, ...imported.map(step => ({ ...step,
    id: renames.get(step.id)!, dependsOn: step.dependsOn.map(dependency => renames.get(dependency) ?? dependency) }))];
  const zones = mergedZones(current.journey.zones ?? [], template.zones, steps, catalog.formatLanguage);
  orderedDependencies(steps);
  validateStepZones(steps, zones);
  return publishJourney(root, verifySources, { id: current.journey.id, version: current.journey.version + 1,
    title: current.journey.title, deckId: current.journey.deckId, description: current.journey.description ?? '',
    zones, steps, existing }, catalog.formatLanguage);
}
