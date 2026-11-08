import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { CatalogDeck, CatalogEdit, CatalogJourney, CatalogJourneyTemplate, CatalogView, ProjectTemplate, ProjectTemplatePlan, ProjectTemplatePlanItem } from '../src/catalog-contracts.ts';
import { deckCanBeInbox } from '../src/catalog-contracts.ts';
import { parseProjectTemplate } from '../src/project-templates.ts';
import { catalogPath, editProjectCatalog, readProjectCatalog } from './catalog.ts';
import { decodeCatalogCover } from './catalog-covers.ts';
import { bundledJourneyTemplatesDirectory, readJourneyTemplates } from './journey-templates.ts';
import { bundledDeckArt } from './deck-art.ts';
import { packagePath } from './package-path.ts';
import { journeyCardId, journeyInstanceId } from './journeys.ts';
import { defineText, serverLang, serverText } from './i18n.ts';

const messages = defineText({
  missing: (id: string) => `Project template not found: ${id}`,
  filename: (id: string) => `Project template ID must match its filename: ${id}`,
  journeyMissing: (id: string) => `Bundled Journey template is missing or invalid: ${id}`,
  roleMissing: (role: string) => `No Production deck receives Journey role: ${role}`,
  journeyExists: 'This deck already has a Journey; it will be kept.',
  incompatibleDeck: 'The existing deck has an incompatible type; it will be kept.',
  incompatibleRole: 'An existing role deck cannot receive Task cards.',
  sampleExists: 'An example with this name or identity already exists; it will be kept.',
  sampleChanged: 'The example has children from another version or instance, or a moved step; it will be kept.',
  sampleJourneyChanged: 'The existing Journey differs from this template; the example will be kept.',
  sampleHeroOnly: 'Only the Hero will be created; the deck does not use this template’s Journey.',
  sampleResume: 'Only missing steps of this example’s current Journey instance will be added.',
  coverResume: 'The missing template cover will be restored.',
  partial: (reason: string) => `Some changes were saved, but the template was not fully applied. Refresh the plan before retrying. ${reason}`,
  samples: 'The examples option must be a boolean.',
}, {
  missing: (id: string) => `Шаблон проекта не найден: ${id}`,
  filename: (id: string) => `ID шаблона проекта должен совпадать с именем файла: ${id}`,
  journeyMissing: (id: string) => `Шаблон Journey поставки отсутствует или некорректен: ${id}`,
  roleMissing: (role: string) => `Нет колоды Production для роли Journey: ${role}`,
  journeyExists: 'У колоды уже есть Journey; он будет сохранён.',
  incompatibleDeck: 'Тип существующей колоды несовместим; она будет сохранена.',
  incompatibleRole: 'Существующая колода роли не принимает Task-карточки.',
  sampleExists: 'Пример с таким именем или идентификатором уже есть; он будет сохранён.',
  sampleChanged: 'У примера есть дети другой версии или экземпляра, либо перенесённый шаг; он будет сохранён.',
  sampleJourneyChanged: 'Существующий Journey отличается от этого шаблона; пример будет сохранён.',
  sampleHeroOnly: 'Создастся только Hero: колода не использует Journey этого шаблона.',
  sampleResume: 'Добавятся только недостающие шаги текущего экземпляра Journey этого примера.',
  coverResume: 'Отсутствующая обложка шаблона будет восстановлена.',
  partial: (reason: string) => `Часть изменений сохранена: шаблон применён не полностью. Обновите план перед повтором. ${reason}`,
  samples: 'Параметр примеров должен быть логическим значением.',
});

export interface ProjectTemplateOptions { templatesRoot?: string; journeysRoot?: string; artRoot?: string }
export class ProjectTemplateNotFoundError extends Error {
  constructor(id: string) {
    super(serverText(messages).missing(id));
  }
}
type ApplyEdit = Extract<CatalogEdit, { action: 'apply-project-template' }>;
const digest = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const nameKey = (name: string) => name.trim().toLowerCase();
const sameName = (first: string, second: string) => nameKey(first) === nameKey(second);

interface TemplateBundle { template: ProjectTemplate; journeys: Map<string, CatalogJourneyTemplate>; covers: Map<string, string>; hash: string }

async function readTemplates(options: ProjectTemplateOptions): Promise<ProjectTemplate[]> {
  const directory = options.templatesRoot ?? packagePath('assets', 'project-templates');
  const entries = await readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const templates: ProjectTemplate[] = [];
  for (const entry of entries.sort((first, second) => first.name.localeCompare(second.name))) {
    if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.md')) continue;
    const bytes = await readFile(path.join(directory, entry.name));
    const template = parseProjectTemplate(new TextDecoder('utf-8', { fatal: true }).decode(bytes), digest(bytes), serverLang());
    if (entry.name !== `${template.id}.md`) throw new Error(serverText(messages).filename(template.id));
    templates.push(template);
  }
  return templates.sort((first, second) => first.order - second.order || first.id.localeCompare(second.id));
}

async function bundledJourneys(options: ProjectTemplateOptions): Promise<CatalogJourneyTemplate[]> {
  const directory = options.journeysRoot ?? bundledJourneyTemplatesDirectory();
  return (await readJourneyTemplates(directory, options.templatesRoot ?? packagePath('assets', 'project-templates'))).templates;
}

async function templateBundle(template: ProjectTemplate, options: ProjectTemplateOptions,
  available = bundledJourneys(options)): Promise<TemplateBundle> {
  const availableJourneys = await available;
  const journeys = new Map<string, CatalogJourneyTemplate>();
  const covers = new Map<string, string>();
  const revisions: Array<[string, string]> = [['template', template.fileHash]];
  for (const deck of template.decks) {
    if (deck.art && !covers.has(deck.art)) {
      const filename = options.artRoot ? path.join(options.artRoot, `${deck.art}.webp`) : await bundledDeckArt(deck.art);
      const info = await lstat(filename);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Invalid artwork: ${deck.art}`);
      const bytes = await readFile(filename);
      const dataUrl = `data:image/webp;base64,${bytes.toString('base64')}`;
      decodeCatalogCover(dataUrl);
      covers.set(deck.art, dataUrl);
      revisions.push([`art:${deck.art}`, digest(bytes)]);
    }
    if (!deck.journey || journeys.has(deck.journey)) continue;
    const journey = availableJourneys.find(candidate => candidate.source === 'bundled' && candidate.id === deck.journey);
    if (!journey) throw new Error(serverText(messages).journeyMissing(deck.journey));
    for (const role of journey.roles) {
      const receiver = template.decks.find(candidate => candidate.roles?.includes(role.id));
      if (!receiver || receiver.kind !== 'task' || !template.spaces.some(space => space.id === receiver.space && space.kind === 'tasks')) {
        throw new Error(serverText(messages).roleMissing(role.id));
      }
    }
    journeys.set(deck.journey, journey);
    revisions.push([`journey:${deck.journey}`, journey.fileHash]);
  }
  // 2026-11-05: a preview covers Journey instructions and artwork as well as the genre file.
  return { template, journeys, covers, hash: digest(JSON.stringify(revisions)) };
}

export async function listProjectTemplates(options: ProjectTemplateOptions = {}): Promise<ProjectTemplate[]> {
  const templates = await readTemplates(options);
  const journeys = bundledJourneys(options);
  for (const template of templates) await templateBundle(template, options, journeys);
  return templates;
}

async function loadBundle(id: string, options: ProjectTemplateOptions): Promise<TemplateBundle> {
  const template = (await readTemplates(options)).find(candidate => candidate.id === id);
  if (!template) throw new ProjectTemplateNotFoundError(id);
  return templateBundle(template, options);
}

function sampleId(template: ProjectTemplate, sample: ProjectTemplate['samples'][number]): string {
  const hash = digest(`project-template:${template.id}:${sample.deck}:${nameKey(sample.title)}`);
  return `card:${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function deckMatches(template: ProjectTemplate, catalog: CatalogView): Map<string, CatalogDeck | undefined> {
  return new Map(template.decks.map(deck => [deck.id, catalog.decks.find(candidate => sameName(candidate.title, deck.title))]));
}

function journeySkip(deck: ProjectTemplate['decks'][number], bundle: TemplateBundle, catalog: CatalogView,
  matches: Map<string, CatalogDeck | undefined>): string | undefined {
  const existing = matches.get(deck.id);
  if (existing && catalog.journeys?.some(journey => journey.deckId === existing.id)) return serverText(messages).journeyExists;
  if (existing && !['asset', 'mixed'].includes(existing.kind)) return serverText(messages).incompatibleDeck;
  const journey = bundle.journeys.get(deck.journey!)!;
  for (const role of journey.roles) {
    const receiver = bundle.template.decks.find(candidate => candidate.roles?.includes(role.id))!;
    const target = matches.get(receiver.id);
    if (target && !['task', 'mixed'].includes(target.kind)) return serverText(messages).incompatibleRole;
  }
}

function templateJourney(deck: ProjectTemplate['decks'][number], bundle: TemplateBundle, catalog: CatalogView,
  matches: Map<string, CatalogDeck | undefined>): CatalogJourney | undefined {
  const expected = deck.journey && bundle.journeys.get(deck.journey);
  const journey = catalog.journeys?.find(candidate => candidate.deckId === matches.get(deck.id)?.id);
  if (!expected || !journey || journey.title !== expected.title || journey.description !== expected.description
    || JSON.stringify(journey.zones ?? []) !== JSON.stringify(expected.zones) || journey.steps.length !== expected.steps.length) return undefined;
  // 2026-11-05: imported Journeys have no provenance marker; require the full mapped template, not just its title.
  const unchanged = expected.steps.every((step, index) => {
    const current = journey.steps[index];
    const receiver = bundle.template.decks.find(candidate => candidate.roles?.includes(step.roleId));
    return current.id === step.id && current.title === step.title && current.markdown === step.markdown
      && current.deckId === matches.get(receiver!.id)?.id && current.owner === null
      && (current.effort ?? null) === (step.effort ?? null) && (current.priority ?? null) === (step.priority ?? null)
      && current.zoneId === step.zoneId && JSON.stringify(current.dependsOn) === JSON.stringify(step.dependsOn);
  });
  return unchanged ? journey : undefined;
}

function missingTemplateCover(deck: ProjectTemplate['decks'][number], template: ProjectTemplate, catalog: CatalogView,
  existing: CatalogDeck | undefined): boolean {
  const space = template.spaces.find(candidate => candidate.id === deck.space)!;
  return Boolean(deck.art && existing && !existing.cover && existing.style === 'symbol'
    && existing.title === deck.title && existing.kind === deck.kind && existing.icon === deck.icon
    && existing.color === deck.color && existing.description === deck.description
    && catalog.spaces.some(candidate => candidate.id === existing.spaceId && sameName(candidate.title, space.title)));
}

function samplePlan(sample: ProjectTemplate['samples'][number], bundle: TemplateBundle, catalog: CatalogView,
  matches: Map<string, CatalogDeck | undefined>): ProjectTemplatePlanItem {
  const { template } = bundle;
  const item = { kind: 'sample' as const, title: sample.title };
  const deck = matches.get(sample.deck);
  if (deck && !['asset', 'mixed'].includes(deck.kind)) return { ...item, status: 'skip', reason: serverText(messages).incompatibleDeck };
  const definition = template.decks.find(candidate => candidate.id === sample.deck)!;
  const own = catalog.cards.find(card => card.id === sampleId(template, sample));
  const journey = templateJourney(definition, bundle, catalog, matches);
  const willImport = Boolean(definition.journey) && !journeySkip(definition, bundle, catalog, matches);
  if (own?.kind === 'hero' && own.deckId === deck?.id && own.parentId === null && !own.archived && !own.deleted
    && sameName(own.title, sample.title)) {
    const children = catalog.cards.filter(card => card.parentId === own.id);
    // 2026-11-05: a childless example whose template Journey this run imports is resumed after the import; the plan says so.
    if (!journey) return !children.length && willImport
      ? { ...item, status: 'resume', reason: serverText(messages).sampleResume }
      : { ...item, status: 'skip', reason: serverText(messages).sampleJourneyChanged };
    // Validate the instance before apply-journey can generate any new files.
    const instanceId = journeyInstanceId(own.id, journey.id, journey.version);
    const expectedIds = new Set(journey.steps.map(step => journeyCardId(own.id, journey.id, journey.version, step.id)));
    const currentChildren = children.every(card => card.kind === 'task' && card.journey?.journeyId === journey.id
      && card.journey.version === journey.version && card.journey.instanceId === instanceId
      && expectedIds.has(card.id) && card.id === journeyCardId(own.id, journey.id, journey.version, card.journey.stepId));
    const movedStep = catalog.cards.some(card => expectedIds.has(card.id) && card.parentId !== own.id);
    if (!currentChildren || movedStep) return { ...item, status: 'skip', reason: serverText(messages).sampleChanged };
    if (children.length < journey.steps.length) return { ...item, status: 'resume', reason: serverText(messages).sampleResume };
  }
  if (own || catalog.cards.some(card => deck && card.deckId === deck.id && sameName(card.title, sample.title))) {
    return { ...item, status: 'skip', reason: serverText(messages).sampleExists };
  }
  return { ...item, status: 'create', ...(!journey && !willImport ? { reason: serverText(messages).sampleHeroOnly } : {}) };
}

function planBundle(bundle: TemplateBundle, catalog: CatalogView): ProjectTemplatePlan {
  const { template } = bundle;
  const matches = deckMatches(template, catalog);
  const items: ProjectTemplatePlanItem[] = [];
  for (const space of template.spaces) items.push({ kind: 'space', title: space.title,
    status: catalog.spaces.some(candidate => sameName(candidate.title, space.title)) ? 'reuse' : 'create' });
  for (const deck of template.decks) {
    const existing = matches.get(deck.id);
    if (missingTemplateCover(deck, template, catalog, existing)) {
      items.push({ kind: 'deck', title: deck.title, status: 'resume', reason: serverText(messages).coverResume });
    } else items.push({ kind: 'deck', title: deck.title, status: existing ? 'reuse' : 'create' });
  }
  for (const deck of template.decks.filter(candidate => candidate.journey)) {
    const reason = journeySkip(deck, bundle, catalog, matches);
    items.push({ kind: 'journey', title: `${deck.title} · ${bundle.journeys.get(deck.journey!)!.title}`,
      status: reason ? 'skip' : 'create', ...(reason ? { reason } : {}) });
  }
  for (const tag of template.tags) items.push({ kind: 'tag', title: tag.name,
    status: catalog.projectTags?.some(candidate => sameName(candidate.name, tag.name)) ? 'reuse' : 'create' });
  for (const sample of template.samples) items.push(samplePlan(sample, bundle, catalog, matches));
  return { templateId: template.id, templateHash: bundle.hash, manifestHash: catalog.manifestHash, items };
}

export async function planProjectTemplate(source: string | CatalogView, id: string, options: ProjectTemplateOptions = {}): Promise<ProjectTemplatePlan> {
  const bundle = await loadBundle(id, options);
  const catalog = typeof source === 'string' ? await readProjectCatalog(source) : source;
  return planBundle(bundle, catalog);
}

export async function applyProjectTemplate(root: string, edit: ApplyEdit, actor: string | null = null,
  options: ProjectTemplateOptions = {}): Promise<string[]> {
  if (typeof edit.samples !== 'boolean') throw new Error(serverText(messages).samples);
  const bundle = await loadBundle(edit.templateId, options);
  if (bundle.hash !== edit.templateHash) throw new Error('TEMPLATE_CONFLICT');
  let catalog = await readProjectCatalog(root);
  if (catalog.manifestHash !== edit.manifestHash) throw new Error('CATALOG_CONFLICT');
  const { template } = bundle;
  const changed = new Set<string>();
  type NestedEdit = CatalogEdit extends infer Edit ? Edit extends CatalogEdit ? Omit<Edit, 'manifestHash'> : never : never;
  const run = async (action: NestedEdit) => {
    const knownCards = new Set(catalog.cards.map(card => card.id));
    const paths = await editProjectCatalog(root, { ...action, manifestHash: catalog.manifestHash } as CatalogEdit, actor, options);
    paths.forEach(filename => changed.add(filename));
    // 2026-11-05: structural catalog actions return no board paths, but still change the manifest.
    if (['create-space', 'create-deck', 'upload-cover', 'create-card'].includes(action.action)) changed.add(catalogPath);
    catalog = await readProjectCatalog(root);
    for (const card of catalog.cards) if (!knownCards.has(card.id)) changed.add(card.path);
  };
  try {
    for (const space of template.spaces) {
      if (!catalog.spaces.some(candidate => sameName(candidate.title, space.title))) {
        await run({ action: 'create-space', title: space.title, kind: space.kind, icon: space.icon });
      }
    }
    for (const deck of template.decks) {
      const existing = catalog.decks.find(candidate => sameName(candidate.title, deck.title));
      if (!existing) {
        const space = template.spaces.find(candidate => candidate.id === deck.space)!;
        const spaceId = catalog.spaces.find(candidate => sameName(candidate.title, space.title))!.id;
        await run({ action: 'create-deck', spaceId, title: deck.title, kind: deck.kind, icon: deck.icon,
          color: deck.color, description: deck.description });
      }
      if (deck.art && (!existing || missingTemplateCover(deck, template, catalog, existing))) {
        const deckId = catalog.decks.find(candidate => sameName(candidate.title, deck.title))!.id;
        await run({ action: 'upload-cover', deckId, dataUrl: bundle.covers.get(deck.art)! });
        const cover = catalog.decks.find(candidate => candidate.id === deckId)?.cover;
        if (cover) changed.add(cover);
      }
    }
    // 2026-11-08: the first Task deck is the starter's general receiver; never replace a project's chosen Inbox.
    if (!catalog.inboxDeckId) {
      const matches = deckMatches(template, catalog);
      const inbox = template.decks.filter(deck => deck.kind === 'task')
        .map(deck => matches.get(deck.id)).find(deck => deck && deckCanBeInbox(deck.kind));
      if (inbox) await run({ action: 'set-inbox-deck', deckId: inbox.id });
    }
    for (const deck of template.decks.filter(candidate => candidate.journey)) {
      const matches = deckMatches(template, catalog);
      if (journeySkip(deck, bundle, catalog, matches)) continue;
      const journey = bundle.journeys.get(deck.journey!)!;
      const roleMapping = Object.fromEntries(journey.roles.map(role => {
        const receiver = template.decks.find(candidate => candidate.roles?.includes(role.id))!;
        return [role.id, { deckId: matches.get(receiver.id)!.id }];
      }));
      await run({ action: 'import-journey-template', deckId: matches.get(deck.id)!.id, templateId: journey.id,
        templateSource: 'bundled', templateHash: journey.fileHash, mode: 'add', journeyId: null, journeyHash: null, roleMapping });
    }
    for (const tag of template.tags) {
      if (catalog.projectTags?.some(candidate => sameName(candidate.name, tag.name))) continue;
      await run({ action: 'save-project-tag', tagsHash: catalog.tagsHash ?? '', tag });
    }
    if (edit.samples) for (const sample of template.samples) {
      const matches = deckMatches(template, catalog);
      if (samplePlan(sample, bundle, catalog, matches).status === 'skip') continue;
      const deckId = matches.get(sample.deck)!.id;
      const cardId = sampleId(template, sample);
      if (!catalog.cards.some(card => card.id === cardId)) {
        await run({ action: 'create-card', cardId, kind: 'hero', title: sample.title, markdown: sample.markdown,
          deckId, trackIds: [], parentId: null, owner: null, effort: null, priority: null });
      }
      const card = catalog.cards.find(candidate => candidate.id === cardId)!;
      const definition = template.decks.find(candidate => candidate.id === sample.deck)!;
      const journey = templateJourney(definition, bundle, catalog, matches);
      if (journey?.steps.length) {
        await run({ action: 'apply-journey', cardId, sourceHash: card.sourceHash, journeyId: journey.id,
          journeyHash: journey.fileHash, stepIds: journey.steps.map(step => step.id), deckAssignments: {} });
      }
    }
  } catch (error) {
    if (!changed.size && !(error as { saved?: boolean }).saved) throw error;
    throw Object.assign(new Error(serverText(messages).partial(error instanceof Error ? error.message : String(error))), { saved: true });
  }
  return [...changed];
}
