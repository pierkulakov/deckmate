import { defineText, serverLang, serverText, type Lang } from './i18n.ts';
import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import type { RunRecord } from '../src/catalog-contracts.ts';
import type { CatalogCard, CatalogView } from '../src/catalog-contracts.ts';
import type { ActivityStateTransition, DeckActivityEvent, DeckActivityPage } from '../src/activity-contracts.ts';
import type { CardHistoryPage } from '../src/dependency-contracts.ts';
import { shortReference } from '../src/references.ts';
import { createManagedMarkdown, listManagedMarkdown, scanManagedMarkdown, type ManagedMarkdownFile } from './native-cards.ts';
import { readCardState, writeCardState, type FormatLanguage } from '../src/format-vocabulary.ts';

const messages = defineText({
  titleChanged: (before: string, after: string) => `Title: ${before} → ${after}`,
  stateChangedDetail: (before: string, after: string, reason: string | undefined) => `State: ${before} → ${after}${reason ? `. Reason: ${reason}` : ''}`,
  deckChangedDetail: (before: string, after: string) => `Deck: ${before} → ${after}`,
  ownerChanged: (before: string, after: string) => `Owner: ${before} → ${after}`,
  tracksChanged: (before: string, after: string) => `Tracks: ${before} → ${after}`,
  kindChanged: (before: string, after: string) => `Type: ${before} → ${after}`,
  dependenciesChangedDetail: (before: string, after: string) => `Dependencies: ${before} → ${after}`,
  runCarryOver: (number: number, end: string, count: number) => `Run ${number} ended on ${end}: cards carried over — ${count}`,
  deckSettings: (title: string) => `Settings updated for Deck “${title}”`,
  newDeck: (title: string) => `Deck “${title}” created`,
  journeySteps: (title: string, count: number) => `Journey “${title}”: ${count} ${new Intl.PluralRules('en-US').select(count) === 'one' ? 'step' : 'steps'}`,
  subcardOrder: (title: string, count: number) => `${title}: order of ${count} Sub Cards`,
  boardTitle: (title: string) => `Board: “${title}”`,
  boardFile: (id: string) => `File: boards/${id}.excalidraw`,
  boardElements: (count: number) => `Elements: ${count}`,
  boardAccess: (access: string) => `Access: ${access}`,
  dependenciesAccepted: (title: string, dependencies: string) => `${title}: all incoming dependencies accepted — ready to start (${dependencies})`,
  cardsUpdated: "Cards updated",
  stateChanged: "State changed",
  propertiesChanged: "Card properties changed",
  cardCreated: "Card created",
  contentChanged: "Card content changed",
  reportAdded: "Card report added",
  heroChanged: "Hero link changed",
  linksChanged: "Card links updated",
  subcardsReordered: "Sub Cards reordered",
  cardMoved: "Card moved",
  cardsMoved: "Cards moved",
  tracksUpdated: "Tracks updated",
  trackAdded: "Cards added to Track",
  journeyApplied: "Journey applied",
  journeyCreated: "Journey created",
  projectTemplateApplied: "Project template applied",
  newSpace: (title: string) => `Space “${title}” created`,
  newTag: (title: string) => `Tag “${title}” created`,
  deckCreated: "Deck created",
  deckChanged: "Deck changed",
  deckTypeChanged: "Deck type changed",
  coverChanged: "Cover changed",
  deckMoved: "Deck moved",
  deckPiled: "Deck moved to the pile",
  deckShelved: "Deck back on the shelf",
  deckPiledDetail: (title: string) => `“${title}” is in the pile at the end of its space`,
  deckShelvedDetail: (title: string) => `“${title}” is back on the shelf of its space`,
  markdownChanged: "Markdown changed",
  boardSaved: "Vision board saved",
  dependenciesChanged: "Dependencies changed",
  cardUnlocked: "Card unlocked",
  handReordered: "Hand reordered",
  noDeck: "No Deck",
  noHero: "No Hero",
  descriptionUpdated: "Description updated",
  tags: "Tags",
  dueDate: "Due date",
  bookmark: "Bookmark",
  archive: "Archive",
  deletion: "Deletion",
  updatedCards: "Cards updated",
  invalidEntry: "Invalid entry",
  idMismatch: "ID does not match the filename",
  invalidCursor: "Invalid journal cursor.",
  unreadable: "Some journal entries could not be read.",
  // Field labels of journal lines; src/activity-groups.ts and server/notifications.ts match them (2026-11-06).
  heroLabel: "Hero",
  effortLabel: "Effort",
  priorityLabel: "Priority",
  handLabel: "Hand",
  runLabel: "Run",
  milestoneLabel: "Milestone",
}, {
  titleChanged: (before: string, after: string) => `Название: ${before} → ${after}`,
  stateChangedDetail: (before: string, after: string, reason: string | undefined) => `Статус: ${before} → ${after}${reason ? `. Причина: ${reason}` : ''}`,
  deckChangedDetail: (before: string, after: string) => `Колода: ${before} → ${after}`,
  ownerChanged: (before: string, after: string) => `Исполнитель: ${before} → ${after}`,
  tracksChanged: (before: string, after: string) => `Треки: ${before} → ${after}`,
  kindChanged: (before: string, after: string) => `Тип: ${before} → ${after}`,
  dependenciesChangedDetail: (before: string, after: string) => `Зависимости: ${before} → ${after}`,
  runCarryOver: (number: number, end: string, count: number) => `Run ${number} завершился ${end}: перенесено карточек — ${count}`,
  deckSettings: (title: string) => `Обновлены настройки колоды «${title}»`,
  newDeck: (title: string) => `Создана колода «${title}»`,
  journeySteps: (title: string, count: number) => `Journey «${title}»: ${count} шагов`,
  subcardOrder: (title: string, count: number) => `${title}: порядок ${count} Sub Cards`,
  boardTitle: (title: string) => `Доска: «${title}»`,
  boardFile: (id: string) => `Файл: boards/${id}.excalidraw`,
  boardElements: (count: number) => `Элементов: ${count}`,
  boardAccess: (access: string) => `Доступ: ${access}`,
  dependenciesAccepted: (title: string, dependencies: string) => `${title}: все входящие зависимости приняты — можно начинать (${dependencies})`,
  cardsUpdated: "Карточки обновлены",
  stateChanged: "Изменён статус",
  propertiesChanged: "Изменены свойства карточки",
  cardCreated: "Создана карточка",
  contentChanged: "Изменено содержимое карточки",
  reportAdded: "Добавлен отчёт на карточке",
  heroChanged: "Изменена связь с Hero",
  linksChanged: "Обновлены связи карточки",
  subcardsReordered: "Изменён порядок Sub Cards",
  cardMoved: "Карточка перемещена",
  cardsMoved: "Карточки перемещены",
  tracksUpdated: "Обновлены треки",
  trackAdded: "Карточки добавлены в трек",
  journeyApplied: "Применён Journey",
  journeyCreated: "Создан Journey",
  projectTemplateApplied: "Применён шаблон проекта",
  newSpace: (title: string) => `Создано пространство «${title}»`,
  newTag: (title: string) => `Создан тег «${title}»`,
  deckCreated: "Создана колода",
  deckChanged: "Изменена колода",
  deckTypeChanged: "Изменён тип колоды",
  coverChanged: "Изменена обложка",
  deckMoved: "Колода перемещена",
  deckPiled: "Колода убрана в стопку",
  deckShelved: "Колода возвращена на полку",
  deckPiledDetail: (title: string) => `«${title}» лежит в стопке в конце своего пространства`,
  deckShelvedDetail: (title: string) => `«${title}» снова на полке своего пространства`,
  markdownChanged: "Изменён Markdown",
  boardSaved: "Сохранена доска Vision",
  dependenciesChanged: "Изменены зависимости",
  cardUnlocked: "Карта разблокирована",
  handReordered: "Изменён порядок руки",
  noDeck: "Без колоды",
  noHero: "Без Hero",
  descriptionUpdated: "Обновлено описание",
  tags: "Теги",
  dueDate: "Срок",
  bookmark: "Закладка",
  archive: "Архив",
  deletion: "Удаление",
  updatedCards: "Обновлены карточки",
  invalidEntry: "Некорректная запись",
  idMismatch: "ID не совпадает с именем файла",
  invalidCursor: "Некорректный курсор журнала.",
  unreadable: "Некоторые записи журнала не удалось прочитать.",
  // Product names keep their Latin spelling in Russian field labels, as in the interface and in older journals (2026-11-06).
  heroLabel: "Hero",
  effortLabel: "Effort",
  priorityLabel: "Priority",
  handLabel: "Hand",
  runLabel: "Run",
  milestoneLabel: "Milestone",
});


const directory = 'tasks/deckmate-activity';
const filenamePattern = /^\d{8}T\d{9}Z-[0-9a-f-]{36}\.md$/u;
// 2026-11-06: journal records are project files, so every summary and detail line follows the project's
// format language — not the interface language of the request that caused the write. Readers accept
// both spellings (src/activity-groups.ts, server/notifications.ts), so old records stay readable.
function journalText(formatLanguage: FormatLanguage) { return messages[formatLanguage]; }

function activityLabels(formatLanguage: FormatLanguage): Record<string, string> {
  const text = journalText(formatLanguage);
  return {
    'bulk-edit-cards': text.cardsUpdated,
    'set-card-state': text.stateChanged, 'set-card-properties': text.propertiesChanged,
    'create-card': text.cardCreated, 'update-card-content': text.contentChanged,
    'add-card-report': text.reportAdded,
    'set-card-parent': text.heroChanged, 'set-card-links': text.linksChanged,
    'reorder-subcards': text.subcardsReordered,
    'assign-deck': text.cardMoved, 'bulk-assign-deck': text.cardsMoved,
    'set-tracks': text.tracksUpdated, 'bulk-add-track': text.trackAdded,
    'apply-journey': text.journeyApplied, 'create-journey': text.journeyCreated,
    'create-deck': text.deckCreated, 'update-deck': text.deckChanged,
    'set-deck-kind': text.deckTypeChanged,
    'upload-cover': text.coverChanged, 'move-deck': text.deckMoved,
    'update-block': text.markdownChanged, 'update-status': text.stateChanged,
    'save-board': text.boardSaved,
    // Record dependency changes and newly unblocked cards (2026-11-04).
    'set-card-dependencies': text.dependenciesChanged, 'card-unlocked': text.cardUnlocked,
    'reorder-hand': text.handReordered,
  };
}

// 2026-11-08: journal wording follows the project language, but its display follows the request language.
// The raw event remains in the shared cache for notifications and metrics.
const displayFields = defineText({
  title: 'Title', state: 'State', deck: 'Deck', owner: 'Owner', tracks: 'Tracks', type: 'Type',
  dependencies: 'Dependencies', effort: 'Effort', priority: 'Priority', tags: 'Tags', due: 'Due date',
  bookmark: 'Bookmark', archive: 'Archive', deletion: 'Deletion', reason: 'Reason',
  low: 'Low', medium: 'Medium', high: 'High',
  unlockedSummary: 'Card unlocked',
  unlocked: (names: string) => `all incoming dependencies accepted — ready to start (${names})`,
}, {
  title: 'Название', state: 'Статус', deck: 'Колода', owner: 'Исполнитель', tracks: 'Треки', type: 'Тип',
  dependencies: 'Зависимости', effort: 'Оценка', priority: 'Приоритет', tags: 'Теги', due: 'Срок',
  bookmark: 'Закладка', archive: 'Архив', deletion: 'Удаление', reason: 'Причина',
  low: 'Низкий', medium: 'Средний', high: 'Высокий',
  unlockedSummary: 'Карточка разблокирована',
  unlocked: (names: string) => `все входящие зависимости приняты — можно начинать (${names})`,
});

/** Localize only known journal syntax, never arbitrary card titles, names or reasons. */
export function displayActivityChange(change: string, lang: Lang): string {
  if (lang !== 'ru') return change;
  if (change === messages.en.cardCreated) return messages.ru.cardCreated;
  if (change === messages.en.descriptionUpdated) return messages.ru.descriptionUpdated;
  const unlocked = /^all incoming dependencies accepted — ready to start \(([\s\S]*)\)$/u.exec(change);
  if (unlocked) return displayFields.ru.unlocked(unlocked[1]);
  const separator = change.indexOf(': ');
  if (separator < 0) return change;
  const field = change.slice(0, separator);
  const keys = ['title', 'state', 'deck', 'owner', 'tracks', 'type', 'dependencies', 'effort', 'priority', 'tags', 'due', 'bookmark', 'archive', 'deletion'] as const;
  const key = keys.find(candidate => field === displayFields.en[candidate] || field === displayFields.ru[candidate]);
  if (!key) return change;
  let value = change.slice(separator + 2);
  if (key === 'state') {
    const match = /^(.*?) → (.*?)(?:\. (?:Reason|Причина): ([\s\S]*))?$/u.exec(value);
    if (match) {
      const label = (word: string) => {
        const state = readCardState(word);
        if (!state) return word;
        const written = writeCardState(state, 'ru');
        return written[0].toLocaleUpperCase('ru-RU') + written.slice(1);
      };
      value = `${label(match[1])} → ${label(match[2])}${match[3] === undefined ? '' : `. ${displayFields.ru.reason}: ${match[3]}`}`;
    }
  } else if (key === 'priority') {
    value = value.split(' → ').map(word => {
      const candidate = word.toLowerCase();
      return candidate === 'low' || candidate === 'medium' || candidate === 'high' ? displayFields.ru[candidate] : word;
    }).join(' → ');
  }
  return `${displayFields.ru[key]}: ${value}`;
}

function displayActivityEvent(event: DeckActivityEvent, lang: Lang): DeckActivityEvent {
  if (lang !== 'ru') return event;
  let summary = event.summary;
  const english = activityLabels('en')[event.action];
  const russian = activityLabels('ru')[event.action];
  if (event.action === 'card-unlocked' && (summary === messages.en.cardUnlocked || summary === messages.ru.cardUnlocked)) summary = displayFields.ru.unlockedSummary;
  else if (english && russian && summary === english) summary = russian;
  else if (summary === messages.en.updatedCards) summary = messages.ru.updatedCards;
  else if (summary === messages.en.projectTemplateApplied) summary = messages.ru.projectTemplateApplied;
  else if (summary === messages.en.deckPiled) summary = messages.ru.deckPiled;
  else if (summary === messages.en.deckShelved) summary = messages.ru.deckShelved;
  const cards = [...event.cards].sort((first, second) => second.title.length - first.title.length);
  const details = event.details.map(detail => {
    const card = cards.find(candidate => detail.startsWith(candidate.title + ': '));
    return card ? `${card.title}: ${displayActivityChange(detail.slice(card.title.length + 2), lang)}` : detail;
  });
  return { ...event, summary, details };
}

function cardChanges(previous: CatalogCard | undefined, current: CatalogCard, before: CatalogView, after: CatalogView, reason: string | undefined): string[] {
  const text = journalText(after.formatLanguage);
  if (!previous) return [text.cardCreated];
  const changes: string[] = [];
  const name = (id: string | null, kind: 'deck' | 'parent', catalog: CatalogView) => {
    if (!id) return kind === 'deck' ? text.noDeck : text.noHero;
    return (kind === 'deck' ? catalog.decks : catalog.cards).find(item => item.id === id)?.title ?? id;
  };
  if (previous.title !== current.title) changes.push(text.titleChanged(previous.title, current.title));
  if (previous.markdown !== current.markdown) changes.push(text.descriptionUpdated);
  if (previous.state !== current.state) {
    const stateWord = (state: CatalogCard['state']) => state === null ? '—' : writeCardState(state, after.formatLanguage);
    changes.push(text.stateChangedDetail(stateWord(previous.state), stateWord(current.state), reason));
  }
  if (previous.parentId !== current.parentId) changes.push(`${text.heroLabel}: ${name(previous.parentId, 'parent', before)} → ${name(current.parentId, 'parent', after)}`);
  if (previous.deckId !== current.deckId) changes.push(text.deckChangedDetail(name(previous.deckId, 'deck', before), name(current.deckId, 'deck', after)));
  if (previous.owner !== current.owner) changes.push(text.ownerChanged(previous.owner ?? '—', current.owner ?? '—'));
  if (JSON.stringify(previous.trackIds) !== JSON.stringify(current.trackIds)) {
    const names = (card: CatalogCard, catalog: CatalogView) => card.trackIds.map(id => catalog.tracks.find(track => track.id === id)?.title ?? id).join(', ') || '—';
    changes.push(text.tracksChanged(names(previous, before), names(current, after)));
  }
  if (previous.effort !== current.effort) changes.push(`${text.effortLabel}: ${previous.effort ?? '—'} → ${current.effort ?? '—'}`);
  if (previous.priority !== current.priority) changes.push(`${text.priorityLabel}: ${previous.priority ?? '—'} → ${current.priority ?? '—'}`);
  if (previous.kind !== current.kind) changes.push(text.kindChanged(previous.kind, current.kind));
  if (JSON.stringify(previous.dependsOn ?? []) !== JSON.stringify(current.dependsOn ?? [])) {
    const names = (ids: string[], catalog: CatalogView) => ids.map(id => catalog.cards.find(card => card.id === id)?.title ?? id).join(', ') || '—';
    changes.push(text.dependenciesChangedDetail(names(previous.dependsOn ?? [], before), names(current.dependsOn ?? [], after)));
  }
  for (const [key, label] of [['handMemberIds', text.handLabel], ['tags', text.tags], ['run', text.runLabel], ['milestone', text.milestoneLabel], ['dueDate', text.dueDate], ['bookmarked', text.bookmark], ['archived', text.archive], ['deleted', text.deletion]] as const) {
    if (JSON.stringify(previous[key]) !== JSON.stringify(current[key])) changes.push(`${label}: ${JSON.stringify(previous[key] ?? null)} → ${JSON.stringify(current[key] ?? null)}`);
  }
  return changes;
}

/**
 * Record unfinished cards carried from an expired Run to the next one (2026-11-04).
 * Events reflect actual run-field changes, including cards without a deck.
 */
export function describeRunCarryOver(before: CatalogView, after: CatalogView, fromRun: RunRecord, toRun: RunRecord): DeckActivityEvent | null {
  const moved = after.cards.filter(card => card.run === toRun.id
    && before.cards.find(previous => previous.id === card.id)?.run === fromRun.id);
  if (!moved.length) return null;
  const deckIds = new Set<string>();
  for (const card of moved) {
    if (card.deckId) deckIds.add(card.deckId);
    const parent = card.parentId ? after.cards.find(candidate => candidate.id === card.parentId) : undefined;
    if (parent?.deckId) deckIds.add(parent.deckId);
  }
  const text = journalText(after.formatLanguage);
  return {
    schema: 1, id: randomUUID(), at: new Date().toISOString(), action: 'carry-over-runs', actor: 'Deckmate',
    summary: text.runCarryOver(fromRun.number, fromRun.end, moved.length),
    cards: moved.map(card => ({ id: card.id, title: card.title })), deckIds: [...deckIds],
    details: moved.map(card => `${card.title}: ${text.runLabel} ${fromRun.number} → ${text.runLabel} ${toRun.number} (${card.state === null ? '—' : writeCardState(card.state, after.formatLanguage)})`),
  };
}

/** returnReasons maps cardId to why the card left review (set-card-state returnReason), recorded in its transition. */
export function describeActivity(before: CatalogView, after: CatalogView, action: string, affectedCardIds?: Set<string>, affectedDeckId?: string, returnReasons?: ReadonlyMap<string, string>): DeckActivityEvent | null {
  const previousCards = new Map(before.cards.map(card => [card.id, card]));
  const text = journalText(after.formatLanguage);
  const cards: DeckActivityEvent['cards'] = [];
  const deckIds = new Set<string>();
  const details: string[] = [];
  const transitions: ActivityStateTransition[] = [];
  function includeDecks(card: CatalogCard | undefined, catalog: CatalogView) {
    if (card?.deckId) deckIds.add(card.deckId);
    const parent = card?.parentId && catalog.cards.find(candidate => candidate.id === card.parentId);
    if (parent && parent.deckId) deckIds.add(parent.deckId);
  }
  for (const card of after.cards) {
    if (affectedCardIds && !affectedCardIds.has(card.id)) continue;
    const previous = previousCards.get(card.id);
    const reason = returnReasons?.get(card.id);
    const changes = cardChanges(previous, card, before, after, reason);
    if (!changes.length) continue;
    cards.push({ id: card.id, title: card.title });
    details.push(...changes.map(change => `${card.title}: ${change}`));
    // A created card has no transition: its first state is not a move, and metrics start from the first real one.
    if (previous && previous.state !== card.state) transitions.push({ cardId: card.id, from: previous.state, to: card.state, ...(reason ? { reason } : {}) });
    includeDecks(previous, before);
    includeDecks(card, after);
  }
  if (['create-deck', 'update-deck', 'set-deck-kind', 'upload-cover', 'move-deck', 'apply-project-template'].includes(action)) {
    for (const deck of after.decks) {
      if (affectedDeckId && deck.id !== affectedDeckId) continue;
      const previous = before.decks.find(candidate => candidate.id === deck.id);
      const moved = action === 'move-deck' && deck.id === affectedDeckId && before.decks.findIndex(candidate => candidate.id === deck.id) !== after.decks.indexOf(deck);
      if (JSON.stringify(previous) === JSON.stringify(deck) && !moved) continue;
      deckIds.add(deck.id);
      details.push(previous ? text.deckSettings(deck.title) : text.newDeck(deck.title));
    }
  }
  // 2026-11-06: the pile has a direction, so its summary says where the deck went instead of one label per action.
  let summary = action === 'apply-project-template' ? text.projectTemplateApplied : activityLabels(after.formatLanguage)[action] ?? text.updatedCards;
  if (action === 'set-deck-pile') {
    const deck = after.decks.find(candidate => candidate.id === affectedDeckId);
    const previous = before.decks.find(candidate => candidate.id === affectedDeckId);
    if (deck && Boolean(deck.piled) !== Boolean(previous?.piled)) {
      deckIds.add(deck.id);
      summary = deck.piled ? text.deckPiled : text.deckShelved;
      details.push(deck.piled ? text.deckPiledDetail(deck.title) : text.deckShelvedDetail(deck.title));
    }
  }
  if (action === 'create-journey' || action === 'apply-project-template') {
    for (const journey of after.journeys ?? []) {
      if (before.journeys?.some(previous => previous.id === journey.id && previous.fileHash === journey.fileHash)) continue;
      deckIds.add(journey.deckId);
      details.push(text.journeySteps(journey.title, journey.steps.length));
    }
  }
  if (action === 'reorder-subcards') {
    const currentCards = new Map(after.cards.map(card => [card.id, card]));
    for (const hero of after.cards.filter(card => ['hero', 'doc'].includes(card.kind))) {
      if (affectedCardIds && !affectedCardIds.has(hero.id)) continue;
      const order = after.subCardOrder?.[hero.id];
      if (!order || JSON.stringify(before.subCardOrder?.[hero.id]) === JSON.stringify(order)) continue;
      cards.push({ id: hero.id, title: hero.title });
      includeDecks(previousCards.get(hero.id), before);
      includeDecks(hero, after);
      details.push(text.subcardOrder(hero.title, order.length));
      order.forEach((id, index) => {
        const child = currentCards.get(id);
        if (!child || child.parentId !== hero.id) return;
        cards.push({ id: child.id, title: child.title });
        details.push(`${index + 1}. ${child.title}`);
        includeDecks(child, after);
      });
    }
  }
  if (action === 'apply-project-template') {
    for (const space of after.spaces) if (!before.spaces.some(previous => previous.id === space.id)) details.push(text.newSpace(space.title));
    for (const tag of after.projectTags ?? []) if (!before.projectTags?.some(previous => previous.name === tag.name)) details.push(text.newTag(tag.name));
  }
  if (!details.length || (!deckIds.size && !['add-card-report', 'apply-project-template'].includes(action))) return null;
  return { schema: 1, id: randomUUID(), at: new Date().toISOString(), action, actor: 'Deckmate', summary, cards, deckIds: [...deckIds], details,
    ...(transitions.length ? { transitions } : {}) };
}

/** 2026-11-04: board saves enter the activity journal alongside catalog actions. */
export function describeBoardSave(board: { id: string; title: string; elementCount: number; access?: string }, formatLanguage: FormatLanguage): DeckActivityEvent {
  const text = journalText(formatLanguage);
  return { schema: 1, id: randomUUID(), at: new Date().toISOString(), action: 'save-board', actor: 'Deckmate',
    summary: activityLabels(formatLanguage)['save-board']!, cards: [], deckIds: [],
    details: [
      text.boardTitle(board.title),
      text.boardFile(board.id),
      text.boardElements(board.elementCount),
      ...(board.access ? [text.boardAccess(board.access)] : []),
    ] };
}

/**
 * Record cards whose last open dependency was accepted (2026-11-04).
 * Compare dependencies before and after the change so owners can be notified from the journal.
 * Archived, deleted, and missing dependencies do not block cards.
 */
export function describeUnlockedCards(before: CatalogView, after: CatalogView): DeckActivityEvent[] {
  const text = journalText(after.formatLanguage);
  const beforeById = new Map(before.cards.map(card => [card.id, card]));
  const afterById = new Map(after.cards.map(card => [card.id, card]));
  const openBefore = (ids: readonly string[] | undefined, byId: ReadonlyMap<string, CatalogCard>) =>
    (ids ?? []).filter(id => {
      const dependency = byId.get(id);
      return dependency && dependency.state !== 'done' && !dependency.archived && !dependency.deleted;
    });
  const events: DeckActivityEvent[] = [];
  for (const card of after.cards) {
    if (!card.dependsOn?.length || card.archived || card.deleted) continue;
    const previous = beforeById.get(card.id);
    if (!previous || openBefore(card.dependsOn, afterById).length) continue;
    const closed = openBefore(previous.dependsOn, beforeById);
    if (!closed.length) continue;
    const deckIds = new Set<string>();
    if (card.deckId) deckIds.add(card.deckId);
    const parent = card.parentId ? afterById.get(card.parentId) : undefined;
    if (parent?.deckId) deckIds.add(parent.deckId);
    if (!deckIds.size) continue; // Events without a deck do not appear in any deck feed.
    const titles = closed.map(id => afterById.get(id)?.title ?? id).join(', ');
    events.push({ schema: 1, id: randomUUID(), at: new Date().toISOString(), action: 'card-unlocked', actor: 'Deckmate',
      summary: text.cardUnlocked, cards: [{ id: card.id, title: card.title }], deckIds: [...deckIds],
      details: [text.dependenciesAccepted(card.title, titles)] });
  }
  return events;
}

/** formatLanguage is the project's: transition states are written in its words, like the summary and details. */
export async function appendActivity(root: string, event: DeckActivityEvent, formatLanguage: FormatLanguage): Promise<void> {
  const timestamp = event.at.replace(/[-:.]/gu, '');
  const filename = `${directory}/${timestamp}-${event.id}.md`;
  const references = event.cards.map(card => `- ${card.title} (${shortReference('c', card.id)})`).join('\n');
  const storedEvent = { ...event, transitions: event.transitions?.map(transition => ({
    ...transition,
    from: transition.from === null ? null : writeCardState(transition.from, formatLanguage),
    to: transition.to === null ? null : writeCardState(transition.to, formatLanguage),
  })) };
  await createManagedMarkdown(root, filename, storedEvent, `# ${event.summary}\n\n${event.at} · ${event.actor}\n\n${references}\n\n${event.details.map(detail => '- ' + detail).join('\n')}\n`);
}

function validEvent(value: unknown): value is DeckActivityEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as DeckActivityEvent;
  return event.schema === 1 && typeof event.id === 'string' && /^[0-9a-f-]{36}$/u.test(event.id)
    && typeof event.at === 'string' && Number.isFinite(Date.parse(event.at)) && ['Deckmate', 'Freetion'].includes(event.actor)
    && typeof event.summary === 'string' && event.summary.length <= 200 && typeof event.action === 'string'
    && Array.isArray(event.deckIds) && event.deckIds.every(id => typeof id === 'string')
    && Array.isArray(event.cards) && event.cards.length <= 2000 && event.cards.every(card => card && typeof card.id === 'string' && typeof card.title === 'string')
    && Array.isArray(event.details) && event.details.length <= 20000 && event.details.every(detail => typeof detail === 'string')
    && (event.transitions === undefined || (Array.isArray(event.transitions) && event.transitions.length <= 2000 && event.transitions.every(validTransition)));
}

function validTransition(value: unknown): value is ActivityStateTransition {
  if (!value || typeof value !== 'object') return false;
  const transition = value as ActivityStateTransition;
  const state = (candidate: unknown) => candidate === null || (typeof candidate === 'string' && readCardState(candidate) !== undefined);
  return typeof transition.cardId === 'string' && state(transition.from) && state(transition.to)
    && (transition.reason === undefined || typeof transition.reason === 'string');
}

function normalizeActivityEvent(event: DeckActivityEvent): DeckActivityEvent {
  return { ...event, actor: 'Deckmate', transitions: event.transitions?.map(transition => ({
    ...transition,
    from: transition.from === null ? null : readCardState(transition.from)!,
    to: transition.to === null ? null : readCardState(transition.to)!,
  })) };
}

/** Validate one parsed journal entry; the cache keeps this result per path and bytes, so it is pure. */
function eventOf(filename: string, file: ManagedMarkdownFile): DeckActivityEvent {
  if (!validEvent(file.metadata)) throw new Error(serverText(messages).invalidEntry);
  const event = file.metadata;
  if (!filename.endsWith(`-${event.id}.md`)) throw new Error(serverText(messages).idMismatch);
  return normalizeActivityEvent(event);
}

/** A journal listing, newest first, with the resolved root that scans read entries beneath. */
export interface JournalListing { rootDirectory: string; files: string[] }

/** 2026-11-06: every journal reader, notifications included, lists here and reads through journalEntries: one format, one validator, one scan. */
export async function listJournal(root: string, cursor?: string): Promise<JournalListing> {
  const rootDirectory = await realpath(root);
  const files = (await listManagedMarkdown(root, directory)).filter(filename => filenamePattern.test(filename.split('/').at(-1)!))
    .sort().reverse().filter(filename => !cursor || filename.split('/').at(-1)! < cursor);
  return { rootDirectory, files };
}

// 2026-11-06: entries are read a chunk at a time, in parallel, only when the consumer reaches the chunk:
// a dense deck fills its page from the first files, a sparse one still scans its window in a few round trips.
const readAhead = 64;

/** Entries of `files` in their order; null marks an unreadable or mismatched entry. Results are shared: never edit them. */
export async function* journalEntries(listing: JournalListing, files: readonly string[]): AsyncGenerator<DeckActivityEvent | null> {
  for (let start = 0; start < files.length; start += readAhead) {
    yield* await Promise.all(files.slice(start, start + readAhead).map(filename =>
      scanManagedMarkdown(listing.rootDirectory, filename, 'activity-event', file => eventOf(filename, file)).catch(() => null)));
  }
}

/**
 * Read the entire journal, oldest first, for Journey step metrics (2026-11-04).
 * Metrics are infrequent, and pagination would undercount returns. Count unreadable entries without failing the read.
 */
export async function readWholeActivity(root: string): Promise<{ events: DeckActivityEvent[]; unreadable: number }> {
  const events: DeckActivityEvent[] = [];
  let unreadable = 0;
  const listing = await listJournal(root);
  for await (const event of journalEntries(listing, [...listing.files].reverse())) {
    if (event) events.push(event);
    else unreadable += 1;
  }
  return { events, unreadable };
}

/** 2026-11-03: Bound file reads independently of page size; sparse deck histories can continue with a cursor. */
const scanLimit = 500;

export async function readActivity(root: string, deckId: string, limit = 10, cursor?: string): Promise<DeckActivityPage> {
  if (cursor && !filenamePattern.test(cursor)) throw new Error(serverText(messages).invalidCursor);
  const pageSize = Math.max(1, Math.min(50, Math.trunc(limit) || 10));
  const listing = await listJournal(root, cursor);
  const { files } = listing;
  const events: DeckActivityEvent[] = [];
  const warnings: string[] = [];
  let scanned = 0;
  for await (const event of journalEntries(listing, files.slice(0, scanLimit))) {
    scanned += 1;
    if (!event) { if (!warnings.length) warnings.push(serverText(messages).unreadable); }
    else if (event.deckIds.includes(deckId)) events.push(displayActivityEvent(event, serverLang()));
    if (events.length >= pageSize) break;
  }
  return { events, nextCursor: scanned < files.length ? files[scanned - 1].split('/').at(-1)! : null, warnings };
}

/**
 * Card history (2026-11-04): events containing this card, newest first, in pages of up to 20.
 * Only the first page names the earliest event of the same 500-file window; one pass over the window serves
 * both (2026-11-06), so loading more does not reread the entire journal.
 */
export async function readCardActivity(root: string, cardId: string, limit = 20, cursor?: string): Promise<CardHistoryPage> {
  if (cursor && !filenamePattern.test(cursor)) throw new Error(serverText(messages).invalidCursor);
  const pageSize = Math.max(1, Math.min(20, Math.trunc(limit) || 20));
  const listing = await listJournal(root, cursor);
  const { files } = listing;
  const mentions = (event: DeckActivityEvent) => event.cards.some(card => card.id === cardId);
  const events: DeckActivityEvent[] = [];
  const warnings: string[] = [];
  let scanned = 0;
  let earliest: DeckActivityEvent | null = null;
  for await (const event of journalEntries(listing, files.slice(0, scanLimit))) {
    if (events.length < pageSize) {
      scanned += 1;
      if (!event) { if (!warnings.length) warnings.push(serverText(messages).unreadable); }
      else if (mentions(event)) events.push(displayActivityEvent(event, serverLang()));
    }
    if (event && mentions(event)) earliest = event;
    if (cursor && events.length >= pageSize) break;
  }
  const created: CardHistoryPage['created'] = !cursor && earliest ? { at: earliest.at, actor: earliest.actor } : null;
  return { events, nextCursor: scanned < files.length ? files[scanned - 1].split('/').at(-1)! : null, warnings, created };
}
