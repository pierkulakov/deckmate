import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { BulkEditRequest, BulkOutcome, CardOptions } from '../src/bulk-contracts.ts';
import type { CatalogCard } from '../src/catalog-contracts.ts';
import { deckAcceptsCard } from '../src/catalog-contracts.ts';
import { resolveMember } from '../src/members.ts';
import { catalogPath, parseManifestBytes, patchLegacyScalar, readManifest, validateCardState, readProjectCatalog, readFreshProjectCatalog } from './catalog.ts';
import { readCardContent } from './card-content.ts';
import { patchLegacyCardStates } from './card-properties.ts';
import { validateOwner, validateEffort, validatePriority } from './card-property-validation.ts';
import { prepareCardOptionsPatch, previousOwnerPatch, readCardOptions } from './card-options.ts';
import { readIteration } from './document.ts';
import { validateCardFamily } from './card-family.ts';
import { createManagedMarkdown, nativeCardPath, patchNativeCardFields, readNativeCard, readProjectMarkdown, replaceProjectMarkdown, validateNativeCardMetadata, type NativeCardMetadata } from './native-cards.ts';
import { defineText, serverText } from './i18n.ts';
import { cardStates, cardStateWords, readCardState, writeCardState } from '../src/format-vocabulary.ts';

const bulkText = defineText({
  invalidFields: "Invalid bulk action fields.",
  chooseProperty: "Choose a property to change.",
  selectionSize: "Select 1 to 1000 cards.",
  currentVersions: "Current catalog and property versions are required.",
  actionRequired: "A bulk action is required.",
  invalidCards: "Invalid or duplicate cards.",
  cascadeLimit: "The cascade includes more than 1000 cards; split the action.",
  restoreDeleted: "Restore deleted cards first.",
  incompatibleDeck: "The target deck does not accept the selected card types.",
  stateTaskOnly: "Only Task cards can change state.",
  invalidState: `Invalid Task state. Use one of: ${cardStates.flatMap(cardStateWords).join(', ')}.`,
  heroRequirements: "A new Hero needs a title and Task or Doc cards outside a Journey.",
  heroId: "A new Hero needs a card UUID.",
  selfParent: "A card cannot be its own parent.",
  restoreHero: "Restore the future Hero from Archive or Trash first.",
  journeyHero: "A Journey card cannot be promoted to a separate Hero.",
  subCardParent: "A card cannot have its own Sub Card as a parent.",
  unsetHeroHash: "To remove the Hero, send no parent version.",
  trackMissing: "Track not found.",
  handMemberMissing: "Hand member not found.",
  invalidTags: "Invalid tags.",
  convertHeroJourney: "Hero and Journey cards cannot be converted.",
  restoreCard: "Restore the card first.",
  docWithSubCards: "A Doc with Sub Cards cannot be converted to a Task.",
  projectDocConversion: "A project document needs a new ID to become a Task. Create a separate Task card.",
  copyMap: "Invalid copy mapping.",
  copyUuid: "Each source card needs a separate new UUID.",
  copyCardUuid: "A copy needs a new card UUID.",
  unknownAction: "Unknown bulk action.",
  workspaceRequired: "Create a workspace first.",
  partiallySaved: (error: unknown) => `Some changes were saved. Refresh the catalog before retrying. ${error instanceof Error ? error.message : String(error)}`,
}, {
  invalidFields: "Недопустимые поля массового действия.",
  chooseProperty: "Выберите свойство для изменения.",
  selectionSize: "Выберите от 1 до 1000 карточек.",
  currentVersions: "Нужны актуальные версии каталога и свойств.",
  actionRequired: "Нужно массовое действие.",
  invalidCards: "Некорректные или повторяющиеся карточки.",
  cascadeLimit: "Каскад включает больше 1000 карточек; разделите действие.",
  restoreDeleted: "Сначала восстановите удалённые карточки.",
  incompatibleDeck: "Целевая колода не принимает выбранные типы карточек.",
  stateTaskOnly: "Состояние меняется только у Task.",
  invalidState: `Недопустимое состояние Task. Допустимо: ${cardStates.flatMap(cardStateWords).join(', ')}.`,
  heroRequirements: "Новый Hero требует названия и Task/Doc-карточек вне Journey.",
  heroId: "Новый Hero требует UUID карточки.",
  selfParent: "Карточка не может стать собственным родителем.",
  restoreHero: "Сначала восстановите будущий Hero из архива или удаления.",
  journeyHero: "Карточку Journey нельзя повысить до отдельного Hero.",
  subCardParent: "Нельзя назначить свою подкарточку родителем.",
  unsetHeroHash: "Чтобы снять Hero, передайте пустую версию родителя.",
  trackMissing: "Трек не найден.",
  handMemberMissing: "Участник Hand не найден.",
  invalidTags: "Некорректные теги.",
  convertHeroJourney: "Hero и карточки Journey нельзя конвертировать.",
  restoreCard: "Сначала восстановите карточку.",
  docWithSubCards: "Doc со своими Sub Cards нельзя превратить в Task.",
  projectDocConversion: "Документ проекта нельзя превратить в Task без нового ID. Создайте отдельную Task-карточку.",
  copyMap: "Некорректная карта копирования.",
  copyUuid: "Каждой исходной карточке нужен отдельный новый UUID.",
  copyCardUuid: "Копия требует нового UUID карточки.",
  unknownAction: "Неизвестное массовое действие.",
  workspaceRequired: "Сначала создайте рабочее пространство.",
  partiallySaved: (error: unknown) => `Сохранена часть изменений. Обновите каталог перед повтором. ${error instanceof Error ? error.message : String(error)}`,
});


const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const optionsPath = 'tasks/deckmate-card-options.md';
const copyProperties = ['owner', 'effort', 'priority', 'tags', 'run', 'milestone', 'dueDate', 'tracks'];
type NativeChanges = Parameters<typeof patchNativeCardFields>[1];
interface Publication { ids: string[]; path: string; nextHash?: string; publish: (guard: () => Promise<void>) => Promise<void>; createdId?: string }
export interface BulkResult { changedPaths: string[]; outcome: BulkOutcome }

function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function checkedKeys(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (!record(value) || Object.keys(value).some(key => !keys.includes(key))) throw new Error(serverText(bulkText).invalidFields);
}
function validateProperties(change: Extract<BulkEditRequest['change'], {kind: 'properties'}>) {
  checkedKeys(change, ['kind', 'owner', 'effort', 'priority']);
  if (Object.keys(change).length < 2) throw new Error(serverText(bulkText).chooseProperty);
  if (Object.hasOwn(change, 'owner')) validateOwner(change.owner);
  if (Object.hasOwn(change, 'effort')) validateEffort(change.effort, 'bulk');
  if (Object.hasOwn(change, 'priority')) validatePriority(change.priority, 'bulk');
}
async function currentHash(root: string, relative: string): Promise<string> {
  try { return digest(await readProjectMarkdown(root, relative)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''; throw error; }
}

/** 2026-11-03: Preflight all cards and build all candidates before publishing any file. */
export async function editCatalogBulk(root: string, edit: BulkEditRequest, actorMemberId: string | null = null): Promise<BulkResult> {
  if (typeof edit.manifestHash !== 'string' || typeof edit.optionsHash !== 'string' || !/^(?:[0-9a-f]{64})?$/u.test(edit.optionsHash)) throw new Error(serverText(bulkText).currentVersions);
  if (!record(edit.change)) throw new Error(serverText(bulkText).actionRequired);
  if (!Array.isArray(edit.cards) || (edit.cards.length < 1 && edit.change.kind !== 'promote-parent') || edit.cards.length > 1000) throw new Error(serverText(bulkText).selectionSize);
  const catalog = await readProjectCatalog(root);
  if (catalog.manifestHash !== edit.manifestHash) throw new Error('CATALOG_CONFLICT');
  if (catalog.optionsHash !== edit.optionsHash) throw new Error('CARD_OPTIONS_CONFLICT');
  const byId = new Map(catalog.cards.map(card => [card.id, card]));
  const ids = new Set<string>();
  const selected = edit.cards.map(selection => {
    if (!selection || typeof selection.cardId !== 'string' || ids.has(selection.cardId) || !/^[0-9a-f]{64}$/u.test(selection.sourceHash)) throw new Error(serverText(bulkText).invalidCards);
    const card = byId.get(selection.cardId);
    if (!card || card.sourceHash !== selection.sourceHash) throw new Error('CARD_CONFLICT');
    ids.add(card.id);
    return card;
  });
  const change = edit.change;
  const familyChecks: Array<(fresh: typeof catalog) => void> = [];
  let cascadeParents: Set<string> | undefined;
  let cascadeChildren: Map<string, string> | undefined;
  // A Hero's recoverable deletion/restoration includes its existing children; no source file is removed.
  if (change.kind === 'options' && record(change.patch) && typeof change.patch.deleted === 'boolean') {
    const heroes = new Set(selected.filter(card => ['hero', 'doc'].includes(card.kind)).map(card => card.id));
    cascadeParents = heroes;
    cascadeChildren = new Map(catalog.cards.filter(card => card.parentId && heroes.has(card.parentId)).map(card => [card.id, card.sourceHash]));
    for (const card of catalog.cards) if (card.parentId && heroes.has(card.parentId) && !ids.has(card.id)) { ids.add(card.id); selected.push(card); }
    if (selected.length > 1000) throw new Error(serverText(bulkText).cascadeLimit);
  }
  if (selected.some(card => card.deleted) && !(change.kind === 'options' && typeof change.patch.deleted === 'boolean')) throw new Error(serverText(bulkText).restoreDeleted);
  const expected = new Map<string, string>([[catalogPath, edit.manifestHash], [optionsPath, edit.optionsHash]]);
  for (const card of selected) expected.set(card.path, card.sourceHash);
  const guard = async () => {
    for (const [relative, hash] of expected) if (await currentHash(root, relative) !== hash) throw new Error(relative === catalogPath ? 'CATALOG_CONFLICT' : relative === optionsPath ? 'CARD_OPTIONS_CONFLICT' : 'CARD_CONFLICT');
    if (cascadeParents?.size && cascadeChildren) {
      const current = (await readFreshProjectCatalog(root)).cards.filter(card => card.parentId && cascadeParents!.has(card.parentId));
      if (current.length !== cascadeChildren.size || current.some(card => cascadeChildren!.get(card.id) !== card.sourceHash)) throw new Error('CARD_CONFLICT');
    }
    if (familyChecks.length) {
      const fresh = await readFreshProjectCatalog(root);
      for (const check of familyChecks) check(fresh);
    }
  };
  const targetDeck = (deckId: string | null, kinds: CatalogCard['kind'][]) => {
    if (deckId === null) return;
    const deck = catalog.decks.find(item => item.id === deckId);
    if (!deck || kinds.some(kind => !deckAcceptsCard(deck.kind, kind))) throw new Error(serverText(bulkText).incompatibleDeck);
  };
  const nativeChanges = new Map<string, NativeChanges>();
  const legacyChanges = new Map<string, Record<string, string | number | string[] | null>>();
  const optionChanges: Record<string, Partial<CardOptions>> = {};
  const optionOwners = new Map<string, string>();
  const publications: Publication[] = [];
  let promotion: CatalogCard | undefined;
  function fields(card: CatalogCard, changes: NativeChanges) {
    if (card.id.startsWith('card:')) { nativeChanges.set(card.id, changes); return; }
    const mapped: Record<string, string | number | string[] | null> = {};
    for (const [key, value] of Object.entries(changes)) {
      if (key === 'kind' || key === 'state') continue;
      if (value !== undefined) mapped[key === 'deckId' ? 'deck' : key === 'trackIds' ? 'tracks' : key] = value;
    }
    legacyChanges.set(card.id, mapped);
  }
  function options(card: CatalogCard, patch: Partial<CardOptions>) { optionChanges[card.id] = patch; optionOwners.set(card.id, card.id); }
  if (change.kind === 'properties') {
    validateProperties(change);
    for (const card of selected) {
      const patch: NativeChanges = {};
      if (Object.hasOwn(change, 'owner')) patch.owner = change.owner === null ? null : resolveMember(change.owner!.trim(), catalog.members ?? []) ?? change.owner!.trim();
      if (Object.hasOwn(change, 'effort')) patch.effort = change.effort;
      if (Object.hasOwn(change, 'priority')) patch.priority = change.priority;
      if (patch.owner !== undefined) {
        const history = previousOwnerPatch(card, catalog.members ?? [], patch.owner);
        if (history) options(card, history);
      }
      fields(card, patch);
    }
  } else if (change.kind === 'state') {
    checkedKeys(change, ['kind', 'state', 'returnReason']);
    const state = readCardState(change.state);
    if (!state) throw new Error(serverText(bulkText).invalidState);
    if (selected.some(card => card.kind !== 'task')) throw new Error(serverText(bulkText).stateTaskOnly);
    const returning = new Set(selected.filter(card => card.state === 'review' && state !== 'review' && state !== 'done').map(card => card.id));
    for (const card of selected) {
      validateCardState(catalog, card, { action: 'set-card-state', cardId: card.id, sourceHash: card.sourceHash,
        manifestHash: edit.manifestHash, state, returnReason: returning.has(card.id) || !returning.size ? change.returnReason : null }, actorMemberId);
    }
    const legacyByPath = new Map<string, CatalogCard[]>();
    for (const card of selected) {
      if (card.id.startsWith('card:')) fields(card, { state });
      else legacyByPath.set(card.path, [...legacyByPath.get(card.path) ?? [], card]);
    }
    let iteration = 0;
    if (state === 'in-iteration' && legacyByPath.size) {
      const bytes = await readProjectMarkdown(root, 'tasks/iterations.md');
      expected.set('tasks/iterations.md', digest(bytes)); iteration = readIteration(bytes.toString('utf8')).number;
    }
    for (const [relative, cards] of legacyByPath) {
      const bytes = await readProjectMarkdown(root, relative);
      const candidate = patchLegacyCardStates(bytes, cards, state, iteration, catalog.formatLanguage);
      if (!candidate.equals(bytes)) publications.push({ ids: cards.filter(card => card.state !== state).map(card => card.id), path: relative, nextHash: digest(candidate),
        publish: before => replaceProjectMarkdown(root, relative, expected.get(relative)!, candidate, before) });
    }
  } else if (change.kind === 'create-parent') {
    checkedKeys(change, ['kind', 'cardId', 'title', 'deckId']);
    if (typeof change.title !== 'string' || !change.title.trim() || change.title.length > 1000 || /[\r\n\u0000]/u.test(change.title)
      || selected.some(card => !['task', 'doc'].includes(card.kind) || card.journey) || ids.has(change.cardId)) throw new Error(serverText(bulkText).heroRequirements);
    targetDeck(change.deckId, ['hero']);
    const relative = nativeCardPath(change.cardId);
    if (!relative) throw new Error(serverText(bulkText).heroId);
    const metadata: NativeCardMetadata = { deckmate: 'card', schema: 1, id: change.cardId.slice(5), kind: 'hero', title: change.title.trim(), state: null,
      owner: null, deckId: change.deckId, trackIds: [], parentId: null, effort: null, priority: null };
    const prospectiveParent: CatalogCard = { ...selected[0], id: change.cardId, kind: 'hero', parentId: null, archived: false, deleted: false, journey: undefined };
    const check = (fresh: typeof catalog) => validateCardFamily({ cards: fresh.cards.some(card => card.id === change.cardId) ? fresh.cards : [...fresh.cards, prospectiveParent] }, selected.map(card => fresh.cards.find(item => item.id === card.id) ?? card), change.cardId);
    check(catalog); familyChecks.push(check);
    const existing = await readNativeCard(root, change.cardId);
    expected.set(relative, existing?.fileHash ?? '');
    if (existing && (!isDeepStrictEqual(existing.metadata, metadata) || existing.markdown !== '')) throw new Error('CARD_ID_CONFLICT');
    if (!existing) publications.push({ ids: selected.map(card => card.id), path: relative, createdId: change.cardId, publish: async before => {
      if (!await createManagedMarkdown(root, relative, metadata, '', before)) throw new Error('CARD_ID_CONFLICT');
    } });
    for (const card of selected) if (card.parentId !== change.cardId) fields(card, { parentId: change.cardId });
  } else if (change.kind === 'promote-parent') {
    checkedKeys(change, ['kind', 'cardId', 'sourceHash', 'expectedParentId', 'deckId']);
    const candidate = byId.get(change.cardId);
    if (!candidate || !/^[0-9a-f]{64}$/u.test(change.sourceHash) || candidate.sourceHash !== change.sourceHash) throw new Error('CARD_CONFLICT');
    if (candidate.parentId !== change.expectedParentId || edit.cards.some(selection => !Object.hasOwn(selection, 'expectedParentId')
      || byId.get(selection.cardId)!.parentId !== selection.expectedParentId)) throw new Error('PARENT_CONFLICT');
    if (ids.has(candidate.id)) throw new Error(serverText(bulkText).selfParent);
    targetDeck(change.deckId, ['hero']);
    const check = (fresh: typeof catalog) => {
      const current = fresh.cards.find(card => card.id === candidate.id);
      if (!current || current.archived || current.deleted) throw new Error(serverText(bulkText).restoreHero);
      if (current.journey) throw new Error(serverText(bulkText).journeyHero);
      const promoted: CatalogCard = { ...current, kind: 'hero', parentId: null };
      validateCardFamily({ cards: fresh.cards.map(card => card.id === candidate.id ? promoted : card) },
        selected.map(card => fresh.cards.find(item => item.id === card.id) ?? card), candidate.id);
      // Detaching a descendant must not silently invert an existing family selected by the caller.
      if (current.parentId && ids.has(current.parentId)) throw new Error(serverText(bulkText).subCardParent);
    };
    check(catalog); familyChecks.push(check);
    expected.set(candidate.path, candidate.sourceHash);
    promotion = candidate;
    fields(candidate, { kind: 'hero', state: null, parentId: null, deckId: change.deckId });
    if (!candidate.id.startsWith('card:') && candidate.kind !== 'hero') options(candidate, { kindOverride: 'hero' });
    for (const card of selected) if (card.parentId !== candidate.id) fields(card, { parentId: candidate.id });
  } else if (change.kind === 'parent') {
    checkedKeys(change, ['kind', 'parentId', 'parentSourceHash']);
    const parent = validateCardFamily(catalog, selected, change.parentId);
    familyChecks.push(fresh => { validateCardFamily(fresh, selected.map(card => fresh.cards.find(item => item.id === card.id) ?? card), change.parentId); });
    if (change.parentId === null) { if (change.parentSourceHash !== null) throw new Error(serverText(bulkText).unsetHeroHash); }
    else {
      if (!parent || parent.sourceHash !== change.parentSourceHash) throw new Error('CARD_CONFLICT');
      expected.set(parent.path, parent.sourceHash);
    }
    for (const card of selected) if (card.parentId !== change.parentId) fields(card, { parentId: change.parentId });
  } else if (change.kind === 'track') {
    checkedKeys(change, ['kind', 'trackId', 'mode']);
    if (!['add', 'remove'].includes(change.mode) || !catalog.tracks.some(track => track.id === change.trackId)) throw new Error(serverText(bulkText).trackMissing);
    for (const card of selected) fields(card, { trackIds: change.mode === 'add' ? [...new Set([...card.trackIds, change.trackId])] : card.trackIds.filter(id => id !== change.trackId) });
  } else if (change.kind === 'options') {
    checkedKeys(change, ['kind', 'patch']); checkedKeys(change.patch, ['bookmarked', 'run', 'milestone', 'dueDate', 'archived', 'deleted']);
    if (!Object.keys(change.patch).length) throw new Error(serverText(bulkText).chooseProperty);
    for (const card of selected) options(card, change.patch);
  } else if (change.kind === 'hand') {
    checkedKeys(change, ['kind', 'memberId', 'mode']);
    if (!['add', 'remove'].includes(change.mode) || !catalog.members?.some(member => member.id === change.memberId)) throw new Error(serverText(bulkText).handMemberMissing);
    for (const card of selected) options(card, { handMemberIds: change.mode === 'add' ? [...new Set([...card.handMemberIds ?? [], change.memberId])] : (card.handMemberIds ?? []).filter(id => id !== change.memberId) });
  } else if (change.kind === 'tags') {
    checkedKeys(change, ['kind', 'tags', 'mode']);
    if (!['add', 'remove'].includes(change.mode) || !Array.isArray(change.tags) || !change.tags.length || change.tags.length > 100 || new Set(change.tags).size !== change.tags.length || change.tags.some(tag => typeof tag !== 'string' || !tag.trim() || tag !== tag.trim() || tag.length > 80 || /[\u0000-\u001f]/u.test(tag))) throw new Error(serverText(bulkText).invalidTags);
    for (const card of selected) options(card, { tags: change.mode === 'add' ? [...new Set([...card.tags ?? [], ...change.tags])] : (card.tags ?? []).filter(tag => !change.tags.includes(tag)) });
  } else if (change.kind === 'convert') {
    checkedKeys(change, ['kind', 'cardKind', 'deckId']);
    if (!['task', 'doc'].includes(change.cardKind) || selected.some(card => card.kind === 'hero' || card.journey)) throw new Error(serverText(bulkText).convertHeroJourney);
    const check = (fresh: typeof catalog) => {
      if (selected.some(card => card.archived || card.deleted)) throw new Error(serverText(bulkText).restoreCard);
      if (change.cardKind === 'task' && fresh.cards.some(card => card.parentId && ids.has(card.parentId))) throw new Error(serverText(bulkText).docWithSubCards);
    };
    check(catalog); familyChecks.push(check);
    targetDeck(change.deckId, [change.cardKind]);
    for (const card of selected) {
      if (!card.id.startsWith('card:') && !card.id.startsWith('task:')) throw new Error(serverText(bulkText).projectDocConversion);
      fields(card, { kind: change.cardKind, deckId: change.deckId, state: change.cardKind === 'doc' ? null : card.state ?? 'not-started' });
      if (!card.id.startsWith('card:')) options(card, { kindOverride: change.cardKind });
    }
  } else if (change.kind === 'duplicate') {
    checkedKeys(change, ['kind', 'deckId', 'properties', 'copies']);
    if (!Array.isArray(change.properties) || new Set(change.properties).size !== change.properties.length || change.properties.some(property => !copyProperties.includes(property))
      || !Array.isArray(change.copies) || change.copies.length !== selected.length || new Set(change.copies.map(copy => copy.cardId)).size !== selected.length || new Set(change.copies.map(copy => copy.newCardId)).size !== selected.length) throw new Error(serverText(bulkText).copyMap);
    targetDeck(change.deckId, selected.map(card => card.kind));
    for (const card of selected) {
      const copy = change.copies.find(item => item.cardId === card.id);
      if (!copy || ids.has(copy.newCardId)) throw new Error(serverText(bulkText).copyUuid);
      const relative = nativeCardPath(copy.newCardId);
      if (!relative) throw new Error(serverText(bulkText).copyCardUuid);
      const content = await readCardContent(root, card.id);
      if (content.sourceHash !== card.sourceHash) throw new Error('CARD_CONFLICT');
      const child = { ...card, id: copy.newCardId, journey: undefined };
      const parent = card.parentId ? validateCardFamily(catalog, [child], card.parentId) : undefined;
      if (parent) familyChecks.push(fresh => { validateCardFamily(fresh, [child], parent.id); });
      if (parent) expected.set(parent.path, parent.sourceHash);
      const metadata: NativeCardMetadata = { deckmate: 'card', schema: 1, id: copy.newCardId.slice(5), kind: card.kind, title: content.title,
        state: card.kind === 'task' ? writeCardState('not-started', catalog.formatLanguage) : null, owner: change.properties.includes('owner') ? card.owner : null,
        effort: change.properties.includes('effort') ? card.effort ?? null : null, priority: change.properties.includes('priority') ? card.priority ?? null : null,
        deckId: change.deckId, trackIds: change.properties.includes('tracks') ? [...card.trackIds] : [], parentId: parent?.id ?? null };
      validateNativeCardMetadata(metadata, metadata.id);
      const existing = await readNativeCard(root, copy.newCardId);
      expected.set(relative, existing?.fileHash ?? '');
      if (existing && (!isDeepStrictEqual(existing.metadata, metadata) || existing.markdown !== content.markdown)) throw new Error('CARD_ID_CONFLICT');
      if (!existing) publications.push({ ids: [card.id], path: relative, createdId: copy.newCardId, publish: async before => {
        if (!await createManagedMarkdown(root, relative, metadata, content.markdown, before)) throw new Error('CARD_ID_CONFLICT');
      } });
      const patch: Partial<CardOptions> = {};
      for (const key of ['tags', 'run', 'milestone', 'dueDate'] as const) if (change.properties.includes(key) && card[key] !== undefined) Object.assign(patch, { [key]: card[key] });
      if (Object.keys(patch).length) { optionChanges[copy.newCardId] = patch; optionOwners.set(copy.newCardId, card.id); }
    }
  } else throw new Error(serverText(bulkText).unknownAction);

  for (const [cardId, changes] of nativeChanges) {
    const existing = await readNativeCard(root, cardId);
    if (!existing || existing.fileHash !== byId.get(cardId)?.sourceHash) throw new Error('CARD_CONFLICT');
    const candidate = patchNativeCardFields(existing, changes, catalog.formatLanguage);
    if (!candidate.equals(existing.bytes)) publications.push({ ids: [cardId], path: existing.card.path, nextHash: digest(candidate),
      publish: before => replaceProjectMarkdown(root, existing.card.path, existing.fileHash, candidate, before) });
  }
  if (legacyChanges.size) {
    let manifest = await readManifest(root);
    if (!manifest.bytes) throw new Error(serverText(bulkText).workspaceRequired);
    const changed: string[] = [];
    for (const [cardId, changes] of legacyChanges) {
      let any = false;
      for (const [key, value] of Object.entries(changes)) {
        const entry = manifest.manifest.membership.find(item => item.card === cardId);
        const card = byId.get(cardId)!;
        const actual = key === 'deck' ? card.deckId : key === 'tracks' ? card.trackIds : card[key as 'owner' | 'effort' | 'priority' | 'parentId'] ?? null;
        // 2026-11-04: a saved Hero role can hide a structural Task parent or stale explicit membership during retry.
        const needsPromotionDetach = promotion?.id === cardId && key === 'parentId'
          && (entry?.parentId != null || (card.id.startsWith('task:') && entry?.parentId === undefined));
        if (!needsPromotionDetach && isDeepStrictEqual(actual, value) && (key === 'deck' || key === 'tracks' || key === 'parentId' || (entry && Object.hasOwn(entry, key)))) continue;
        manifest = parseManifestBytes(patchLegacyScalar(manifest, cardId, key as Parameters<typeof patchLegacyScalar>[2], value)); any = true;
      }
      if (any) changed.push(cardId);
    }
    if (changed.length) {
      const bytes = manifest.bytes!;
      publications.push({ ids: changed, path: catalogPath, nextHash: digest(bytes), publish: before => replaceProjectMarkdown(root, catalogPath, edit.manifestHash, bytes, before) });
    }
  }
  if (Object.keys(optionChanges).length) {
    const current = await readCardOptions(root);
    const plan = await prepareCardOptionsPatch(root, edit.optionsHash, optionChanges);
    if (plan.changed) {
      const changed = Object.keys(optionChanges).filter(id => Object.entries(optionChanges[id]).some(([key, value]) => {
        const old = current.options[id]?.[key as keyof CardOptions];
        const normalized = value === false || value === null || (Array.isArray(value) && !value.length) ? undefined : value;
        return !isDeepStrictEqual(old, normalized);
      })).map(id => optionOwners.get(id)!);
      const publication = { ids: [...new Set(changed)], path: optionsPath, nextHash: plan.nextHash, publish: plan.publish };
      if (change.kind === 'properties') publications.unshift(publication);
      else publications.push(publication);
    }
  }
  if (promotion) {
    const candidateId = promotion.id;
    const candidatePath = promotion.path;
    // Without Sub Cards the promoted card itself is the only card the outcome reports.
    const selectedIds = selected.length ? selected.map(card => card.id) : [candidateId];
    for (const publication of publications) {
      if (publication.ids.includes(candidateId)) publication.ids = [...new Set([...publication.ids.filter(id => id !== candidateId), ...selectedIds])];
    }
    // Publish the Hero role first. Child links may only point to an already valid, detached parent.
    const rank = (publication: Publication) => publication.path === candidatePath || publication.path === optionsPath ? 0 : publication.path === catalogPath ? 1 : 2;
    publications.sort((left, right) => rank(left) - rank(right));
  }
  await guard();
  const tracked: CatalogCard[] = promotion && !selected.length ? [promotion] : selected;
  const required = new Map(tracked.map(card => [card.id, publications.filter(plan => plan.ids.includes(card.id)).length]));
  const completed = new Map<string, number>();
  const changedPaths: string[] = [];
  const created: string[] = [];
  const result = (warnings: string[]): BulkResult => ({ changedPaths, outcome: {
    applied: tracked.filter(card => required.get(card.id)! > 0 && completed.get(card.id) === required.get(card.id)).map(card => card.id),
    unchanged: tracked.filter(card => !required.get(card.id)).map(card => card.id),
    pending: tracked.filter(card => required.get(card.id)! > (completed.get(card.id) ?? 0)).map(card => card.id), created, warnings,
  } });
  for (const publication of publications) {
    let saved = false;
    try { await publication.publish(guard); saved = true; }
    catch (error) {
      saved = Boolean(error && typeof error === 'object' && 'saved' in error && error.saved);
      if (saved) {
        changedPaths.push(publication.path);
        for (const id of publication.ids) completed.set(id, (completed.get(id) ?? 0) + 1);
        if (publication.createdId) created.push(publication.createdId);
      }
      if (!changedPaths.length) throw error;
      return result([serverText(bulkText).partiallySaved(error)]);
    }
    if (saved) {
      changedPaths.push(publication.path);
      for (const id of publication.ids) completed.set(id, (completed.get(id) ?? 0) + 1);
      if (publication.createdId) created.push(publication.createdId);
      expected.set(publication.path, publication.nextHash ?? await currentHash(root, publication.path));
    }
  }
  return result([]);
}
