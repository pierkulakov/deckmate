// One shortcut registry and one guard against intercepting input (2026-11-04).
// Both matchShortcut and the Available Shortcuts dialog (ShortcutsHelp) read this registry; do not add a second UI list.
// Each shortcut has a screen scope so the dialog only shows shortcuts available on the current screen (2026-11-05).

import type { CatalogCard, CardPriority } from '../src/catalog-contracts.ts';
import { defineText, textNow } from './i18n.ts';
import { priorityLabel, stateLabel } from './locales/common.ts';
import { resolveCardStateAction, type CardStateAction, type CardStateActionContext, type CardStateTrigger } from './card-state-actions.ts';

const text = defineText({
  general: 'General',
  cardOverview: 'Card overview',
  miniCard: 'Mini Card · pointer over a card',
  bulkSelection: 'Bulk selection',
  card: 'Card',
  search: 'Search',
  searchCards: 'Search cards',
  toggleOverview: 'Open or close this overview',
  closeStepwise: 'Clear the selection, return to Hero, close the card, then the deck',
  goHand: 'Go to Hand',
  goDecks: 'Go to Decks',
  goTimeline: 'Go to Timeline',
  goVision: 'Go to Vision',
  toggleCardView: 'Switch between Cards and Table',
  nextCard: 'Open the next card',
  previousCard: 'Open the previous card',
  moveGridFocus: 'Move focus across the card grid',
  openFocusedCard: 'Open the focused card',
  addCard: 'Add a card',
  selectFocusedCard: 'Select or deselect the focused card',
  toggleOrder: 'Open or close the Order panel',
  toggleTags: 'Open or close the Tags panel',
  openMetrics: 'Open Metrics',
  openActivity: 'Open Recent Activity',
  toggleSubCards: 'Show or hide the Sub Cards of the open card',
  openHero: 'Open the Hero Card of the open Sub Card',
  createSubCard: 'Create a Sub Card for the open Hero Card',
  toggleWork: 'Assign to me or start work; stop Started; in Review, open the menu without selecting a decision',
  quickOwner: 'Open Quick Settings · Owner',
  quickTags: 'Open quick tag assignment',
  toggleHand: 'Add to or remove from Hand',
  quickDeck: 'Open Quick Settings · Deck',
  quickEffort: 'Open Quick Settings · Effort',
  quickPriority: 'Open Quick Settings · Priority',
  quickRun: 'Open Quick Settings · Run',
  quickMilestone: 'Open Quick Settings · Milestone',
  pickHero: 'Open the Hero Card picker',
  toggleArchive: 'Archive or unarchive the card',
  trashCard: 'Move the card to the Trash',
  toggleBookmark: 'Bookmark or unbookmark the card',
  toggleSelection: 'Select or deselect the card',
  effortNumber: 'Pointer over Effort: set 0–9',
  priorityNumber: (low: string, medium: string, high: string) => `Pointer over Priority: 0 = None, 1 = ${low}, 2 = ${medium}, 3 = ${high}`,
  selectAll: 'Select all shown cards',
  invertSelection: 'Invert the selection',
  assignSelection: 'Assign the selection to me',
  chooseOwner: 'Choose a new Owner',
  changeTags: 'Change Tags',
  openHand: 'Open the Hand dialog',
  moveToDeck: 'Move the selection to a Deck',
  setEffort: 'Set Effort',
  setPriority: 'Set Priority',
  assignRun: 'Assign a Run',
  assignMilestone: 'Assign a Milestone',
  openHeroDialog: 'Open the Hero Card dialog',
  archiveConfirmed: 'Archive after confirmation',
  markStateConfirmed: (state: string) => `Mark ${state} after confirmation`,
  bookmarkSelection: 'Bookmark the selection',
  trashSelection: 'Move the selection to the Trash',
  openAttachments: 'Open Attachments; again opens the first image',
  openProperties: 'Open the Properties panel',
  openCardTags: 'Tags for the open card',
  openFocusMode: 'Open the card in Focus Mode',
  changeTaskState: 'Mark done or reopen; in Review, focus Accept review',
  trashCardConfirmed: 'Move the card to the Trash, after a confirmation',
  searchMyCards: 'Search my cards; press again to reset',
  arrows: 'Arrows',
  space: 'Space',
}, {
  general: 'Общие',
  cardOverview: 'Карточки',
  miniCard: 'Мини-карточка · наведение на карточку',
  bulkSelection: 'Массовый выбор',
  card: 'Карточка',
  search: 'Поиск',
  searchCards: 'Поиск карточек',
  toggleOverview: 'Открыть или закрыть этот список',
  closeStepwise: 'Снять выбор, вернуться к Hero, закрыть карточку, затем колоду',
  goHand: 'Перейти в Hand',
  goDecks: 'Перейти в Decks',
  goTimeline: 'Перейти в Timeline',
  goVision: 'Перейти в Vision',
  toggleCardView: 'Переключение между карточками и таблицей',
  nextCard: 'Открыть следующую карточку',
  previousCard: 'Открыть предыдущую карточку',
  moveGridFocus: 'Перемещать фокус по сетке карточек',
  openFocusedCard: 'Открыть карточку в фокусе',
  addCard: 'Добавить карточку',
  selectFocusedCard: 'Выбрать или снять выбор с карточки в фокусе',
  toggleOrder: 'Открыть или закрыть панель порядка',
  toggleTags: 'Открыть или закрыть панель тегов',
  openMetrics: 'Открыть метрики',
  openActivity: 'Открыть последние события',
  toggleSubCards: 'Показать или скрыть Sub Cards открытой карточки',
  openHero: 'Открыть Hero Card этой Sub Card',
  createSubCard: 'Создать Sub Card для открытой Hero Card',
  toggleWork: 'Взять на себя или начать работу; остановить начатую; на приёмке — открыть меню без выбора решения',
  quickOwner: 'Быстрые настройки · исполнитель',
  quickTags: 'Быстрая установка тегов',
  toggleHand: 'Добавить в Hand или убрать из неё',
  quickDeck: 'Быстрые настройки · колода',
  quickEffort: 'Быстрые настройки · оценка',
  quickPriority: 'Быстрые настройки · приоритет',
  quickRun: 'Быстрые настройки · Run',
  quickMilestone: 'Быстрые настройки · Milestone',
  pickHero: 'Открыть выбор Hero Card',
  toggleArchive: 'Архивировать карточку или вернуть из архива',
  trashCard: 'Переместить карточку в корзину',
  toggleBookmark: 'Поставить или снять закладку',
  toggleSelection: 'Выбрать или снять выбор с карточки',
  effortNumber: 'Наведение на оценку: задать 0–9',
  priorityNumber: (low: string, medium: string, high: string) => `Наведение на приоритет: 0 = нет, 1 = ${low}, 2 = ${medium}, 3 = ${high}`,
  selectAll: 'Выбрать все показанные карточки',
  invertSelection: 'Инвертировать выбор',
  assignSelection: 'Взять выбранные карточки на себя',
  chooseOwner: 'Выбрать нового исполнителя',
  changeTags: 'Изменить теги',
  openHand: 'Открыть диалог Hand',
  moveToDeck: 'Переместить выбранное в колоду',
  setEffort: 'Задать оценку',
  setPriority: 'Задать приоритет',
  assignRun: 'Назначить Run',
  assignMilestone: 'Назначить Milestone',
  openHeroDialog: 'Открыть диалог Hero Card',
  archiveConfirmed: 'Архивировать после подтверждения',
  markStateConfirmed: (state: string) => `Отметить «${state}» после подтверждения`,
  bookmarkSelection: 'Поставить закладки на выбранное',
  trashSelection: 'Переместить выбранное в корзину',
  openAttachments: 'Открыть вложения; повторно — первое изображение',
  openProperties: 'Открыть панель свойств',
  openCardTags: 'Теги открытой карточки',
  openFocusMode: 'Открыть карточку в фокус-режиме',
  changeTaskState: 'Принять или открыть снова; на приёмке — фокус на «Принять результат»',
  trashCardConfirmed: 'Переместить карточку в корзину после подтверждения',
  searchMyCards: 'Поиск моих карточек; повторное нажатие сбрасывает',
  arrows: 'Стрелки',
  space: 'Пробел',
});

/** Dialog group; open-card also routes shortcuts to the open card instead of the deck. */
export type ShortcutGroupId = 'general' | 'search' | 'deck' | 'mini-card' | 'bulk' | 'open-card';
export type CardQuickSettingsTab = 'deck' | 'owner' | 'run' | 'milestone' | 'priority' | 'effort';

/**
 * Shortcut scope: app covers screens with the shortcuts button (Decks, Hand); cards covers Decks card lists
 * (an open deck, all cards, or a track); deck covers an open deck only; card covers the open card in the left panel.
 */
export type ShortcutScreen = 'app' | 'cards' | 'deck' | 'card';

export interface ShortcutDefinition {
  id: string;
  label: string;
  /** Dialog label: one chip per combination, such as "Shift+V". */
  keys: string;
  group: ShortcutGroupId;
  screen: ShortcutScreen;
  /** Mutates data: disabled and hidden from the dialog for read-only sources. */
  edits?: true;
  /** Physical key (event.code), independent of keyboard layout. */
  code?: string;
  /** Multiple physical keys, such as arrows or digits. */
  codes?: readonly string[];
  /** Character or named key (event.key): '?', 'Escape', 'Enter'. */
  key?: string;
  /** Whether an event.code shortcut requires Shift. */
  shift?: boolean;
  /** Ctrl on Windows/Linux or Cmd on macOS. */
  command?: boolean;
  /** Quick Settings tab; handlers reuse this mapping instead of duplicating it. */
  quickTab?: CardQuickSettingsTab;
  /** Individual-card state keys share the Play resolver; bulk commands deliberately do not. */
  stateTrigger?: CardStateTrigger;
}

export interface ShortcutGroup {
  id: ShortcutGroupId;
  title: string;
  items: readonly ShortcutDefinition[];
}

const digitCodes = ['Digit0', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9'] as const;

// Group order is General, screen-specific groups, then Search. Labels describe Deckmate behavior;
// key combinations and contexts follow common board-tool shortcuts (2026-11-05).
export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    id: 'general',
    get title() { return textNow(text).general; },
    items: [
      { id: 'focus-search', get label() { return textNow(text).searchCards; }, keys: '/', key: '/', group: 'general', screen: 'app' },
      { id: 'shortcuts-overview', get label() { return textNow(text).toggleOverview; }, keys: '?', key: '?', group: 'general', screen: 'app' },
      { id: 'close-stepwise', get label() { return textNow(text).closeStepwise; }, keys: 'Esc', key: 'Escape', group: 'general', screen: 'cards' },
      { id: 'view-hand', get label() { return textNow(text).goHand; }, keys: 'Shift+1', code: 'Digit1', shift: true, group: 'general', screen: 'app' },
      { id: 'view-deck', get label() { return textNow(text).goDecks; }, keys: 'Shift+2', code: 'Digit2', shift: true, group: 'general', screen: 'app' },
      { id: 'view-timeline', get label() { return textNow(text).goTimeline; }, keys: 'Shift+3', code: 'Digit3', shift: true, group: 'general', screen: 'app' },
      { id: 'view-vision', get label() { return textNow(text).goVision; }, keys: 'Shift+4', code: 'Digit4', shift: true, group: 'general', screen: 'app' },
    ],
  },
  {
    id: 'deck',
    get title() { return textNow(text).cardOverview; },
    items: [
      { id: 'toggle-card-view', get label() { return textNow(text).toggleCardView; }, keys: 'Shift+V', code: 'KeyV', shift: true, group: 'deck', screen: 'cards' },
      { id: 'next-card', get label() { return textNow(text).nextCard; }, keys: 'J', code: 'KeyJ', group: 'deck', screen: 'cards' },
      { id: 'previous-card', get label() { return textNow(text).previousCard; }, keys: 'K', code: 'KeyK', group: 'deck', screen: 'cards' },
      { id: 'move-grid-focus', get label() { return textNow(text).moveGridFocus; }, get keys() { return textNow(text).arrows; }, codes: ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'], group: 'deck', screen: 'cards' },
      // O opens owner settings; Enter opens the card (2026-11-05).
      { id: 'open-focused-card-enter', get label() { return textNow(text).openFocusedCard; }, keys: 'Enter', key: 'Enter', group: 'deck', screen: 'cards' },
      { id: 'new-card', get label() { return textNow(text).addCard; }, keys: 'N', code: 'KeyN', group: 'deck', screen: 'cards', edits: true },
      { id: 'toggle-select-focused', get label() { return textNow(text).selectFocusedCard; }, keys: 'X', code: 'KeyX', group: 'deck', screen: 'cards' },
      { id: 'open-order-panel', get label() { return textNow(text).toggleOrder; }, keys: 'Shift+O', code: 'KeyO', shift: true, group: 'deck', screen: 'cards' },
      { id: 'open-tags-panel', get label() { return textNow(text).toggleTags; }, keys: 'Shift+T', code: 'KeyT', shift: true, group: 'deck', screen: 'deck' },
      { id: 'open-metrics', get label() { return textNow(text).openMetrics; }, keys: 'Shift+M', code: 'KeyM', shift: true, group: 'deck', screen: 'deck' },
      { id: 'open-recent-activity', get label() { return textNow(text).openActivity; }, keys: 'Shift+I', code: 'KeyI', shift: true, group: 'deck', screen: 'deck' },
      // Deck.tsx handles S, Shift+S, and Shift+C, so they belong to the deck group even though they require an open card.
      { id: 'toggle-subcards', get label() { return textNow(text).toggleSubCards; }, keys: 'S', code: 'KeyS', group: 'deck', screen: 'card' },
      { id: 'open-hero', get label() { return textNow(text).openHero; }, keys: 'Shift+S', code: 'KeyS', shift: true, group: 'deck', screen: 'card' },
      { id: 'new-sub-card', get label() { return textNow(text).createSubCard; }, keys: 'Shift+C', code: 'KeyC', shift: true, group: 'deck', screen: 'card', edits: true },
    ],
  },
  {
    id: 'mini-card',
    get title() { return textNow(text).miniCard; },
    items: [
      { id: 'hover-work', get label() { return textNow(text).toggleWork; }, get keys() { return textNow(text).space; }, code: 'Space', group: 'mini-card', screen: 'cards', edits: true, stateTrigger: 'space' },
      { id: 'hover-owner', get label() { return textNow(text).quickOwner; }, keys: 'O', code: 'KeyO', group: 'mini-card', screen: 'cards', edits: true, quickTab: 'owner' },
      { id: 'hover-tags', get label() { return textNow(text).quickTags; }, keys: 'T', code: 'KeyT', group: 'mini-card', screen: 'cards', edits: true },
      { id: 'hover-hand', get label() { return textNow(text).toggleHand; }, keys: 'H', code: 'KeyH', group: 'mini-card', screen: 'cards', edits: true },
      { id: 'hover-deck', get label() { return textNow(text).quickDeck; }, keys: 'D', code: 'KeyD', group: 'mini-card', screen: 'cards', edits: true, quickTab: 'deck' },
      { id: 'hover-effort', get label() { return textNow(text).quickEffort; }, keys: 'E', code: 'KeyE', group: 'mini-card', screen: 'cards', edits: true, quickTab: 'effort' },
      { id: 'hover-priority', get label() { return textNow(text).quickPriority; }, keys: 'P', code: 'KeyP', group: 'mini-card', screen: 'cards', edits: true, quickTab: 'priority' },
      { id: 'hover-run', get label() { return textNow(text).quickRun; }, keys: ',', code: 'Comma', group: 'mini-card', screen: 'cards', edits: true, quickTab: 'run' },
      { id: 'hover-milestone', get label() { return textNow(text).quickMilestone; }, keys: 'M', code: 'KeyM', group: 'mini-card', screen: 'cards', edits: true, quickTab: 'milestone' },
      { id: 'hover-hero', get label() { return textNow(text).pickHero; }, keys: 'Shift+S', code: 'KeyS', shift: true, group: 'mini-card', screen: 'cards', edits: true },
      { id: 'hover-archive', get label() { return textNow(text).toggleArchive; }, keys: 'R', code: 'KeyR', group: 'mini-card', screen: 'cards', edits: true },
      { id: 'hover-delete', get label() { return textNow(text).trashCard; }, keys: 'Backspace', code: 'Backspace', group: 'mini-card', screen: 'cards', edits: true },
      { id: 'hover-done', get label() { return textNow(text).changeTaskState; }, keys: 'W', code: 'KeyW', group: 'mini-card', screen: 'cards', edits: true, stateTrigger: 'done' },
      { id: 'hover-bookmark', get label() { return textNow(text).toggleBookmark; }, keys: '.', code: 'Period', group: 'mini-card', screen: 'cards', edits: true },
      { id: 'hover-select', get label() { return textNow(text).toggleSelection; }, keys: 'X', code: 'KeyX', group: 'mini-card', screen: 'cards' },
      { id: 'hover-effort-number', get label() { return textNow(text).effortNumber; }, keys: '0–9', codes: digitCodes, group: 'mini-card', screen: 'cards', edits: true },
      { id: 'hover-priority-number', get label() { return textNow(text).priorityNumber(priorityLabel('low'), priorityLabel('medium'), priorityLabel('high')); }, keys: '0–3', codes: digitCodes.slice(0, 4), group: 'mini-card', screen: 'cards', edits: true },
    ],
  },
  {
    id: 'bulk',
    get title() { return textNow(text).bulkSelection; },
    items: [
      { id: 'bulk-select-all', get label() { return textNow(text).selectAll; }, keys: 'Ctrl/Cmd+A', code: 'KeyA', command: true, group: 'bulk', screen: 'cards' },
      { id: 'bulk-invert', get label() { return textNow(text).invertSelection; }, keys: 'I', code: 'KeyI', group: 'bulk', screen: 'cards' },
      { id: 'bulk-assign-me', get label() { return textNow(text).assignSelection; }, get keys() { return textNow(text).space; }, code: 'Space', group: 'bulk', screen: 'cards', edits: true },
      { id: 'bulk-owner', get label() { return textNow(text).chooseOwner; }, keys: 'O', code: 'KeyO', group: 'bulk', screen: 'cards', edits: true },
      { id: 'bulk-tags', get label() { return textNow(text).changeTags; }, keys: 'T', code: 'KeyT', group: 'bulk', screen: 'cards', edits: true },
      { id: 'bulk-hand', get label() { return textNow(text).openHand; }, keys: 'H', code: 'KeyH', group: 'bulk', screen: 'cards', edits: true },
      { id: 'bulk-deck', get label() { return textNow(text).moveToDeck; }, keys: 'D', code: 'KeyD', group: 'bulk', screen: 'cards', edits: true },
      { id: 'bulk-effort', get label() { return textNow(text).setEffort; }, keys: 'E', code: 'KeyE', group: 'bulk', screen: 'cards', edits: true },
      { id: 'bulk-priority', get label() { return textNow(text).setPriority; }, keys: 'P', code: 'KeyP', group: 'bulk', screen: 'cards', edits: true },
      { id: 'bulk-run', get label() { return textNow(text).assignRun; }, keys: ',', code: 'Comma', group: 'bulk', screen: 'cards', edits: true },
      { id: 'bulk-milestone', get label() { return textNow(text).assignMilestone; }, keys: 'M', code: 'KeyM', group: 'bulk', screen: 'cards', edits: true },
      { id: 'bulk-parent', get label() { return textNow(text).openHeroDialog; }, keys: 'Shift+S', code: 'KeyS', shift: true, group: 'bulk', screen: 'cards', edits: true },
      { id: 'bulk-archive', get label() { return textNow(text).archiveConfirmed; }, keys: 'R', code: 'KeyR', group: 'bulk', screen: 'cards', edits: true },
      { id: 'bulk-done', get label() { return textNow(text).markStateConfirmed(stateLabel("done")); }, keys: 'W', code: 'KeyW', group: 'bulk', screen: 'cards', edits: true },
      { id: 'bulk-bookmark', get label() { return textNow(text).bookmarkSelection; }, keys: '.', code: 'Period', group: 'bulk', screen: 'cards', edits: true },
      { id: 'bulk-delete', get label() { return textNow(text).trashSelection; }, keys: 'Backspace', code: 'Backspace', group: 'bulk', screen: 'cards', edits: true },
    ],
  },
  {
    id: 'open-card',
    get title() { return textNow(text).card; },
    items: [
      { id: 'open-card-work', get label() { return textNow(text).toggleWork; }, get keys() { return textNow(text).space; }, code: 'Space', group: 'open-card', screen: 'card', edits: true, stateTrigger: 'space' },
      { id: 'open-card-owner', get label() { return textNow(text).quickOwner; }, keys: 'O', code: 'KeyO', group: 'open-card', screen: 'card', edits: true, quickTab: 'owner' },
      { id: 'open-card-effort', get label() { return textNow(text).quickEffort; }, keys: 'E', code: 'KeyE', group: 'open-card', screen: 'card', edits: true, quickTab: 'effort' },
      { id: 'open-card-priority', get label() { return textNow(text).quickPriority; }, keys: 'P', code: 'KeyP', group: 'open-card', screen: 'card', edits: true, quickTab: 'priority' },
      { id: 'open-card-run', get label() { return textNow(text).quickRun; }, keys: ',', code: 'Comma', group: 'open-card', screen: 'card', edits: true, quickTab: 'run' },
      { id: 'open-card-milestone', get label() { return textNow(text).quickMilestone; }, keys: 'M', code: 'KeyM', group: 'open-card', screen: 'card', edits: true, quickTab: 'milestone' },
      { id: 'open-card-effort-number', get label() { return textNow(text).effortNumber; }, keys: '0–9', codes: digitCodes, group: 'open-card', screen: 'card', edits: true },
      { id: 'open-card-priority-number', get label() { return textNow(text).priorityNumber(priorityLabel('low'), priorityLabel('medium'), priorityLabel('high')); }, keys: '0–3', codes: digitCodes.slice(0, 4), group: 'open-card', screen: 'card', edits: true },
      { id: 'open-card-attachments', get label() { return textNow(text).openAttachments; }, keys: 'A', code: 'KeyA', group: 'open-card', screen: 'card' },
      { id: 'open-card-properties', get label() { return textNow(text).openProperties; }, keys: 'Z', code: 'KeyZ', group: 'open-card', screen: 'card' },
      { id: 'open-card-tags', get label() { return textNow(text).openCardTags; }, keys: 'T', code: 'KeyT', group: 'open-card', screen: 'card' },
      { id: 'open-card-focus', get label() { return textNow(text).openFocusMode; }, keys: 'F', code: 'KeyF', group: 'open-card', screen: 'card' },
      { id: 'open-card-done', get label() { return textNow(text).changeTaskState; }, keys: 'W', code: 'KeyW', group: 'open-card', screen: 'card', edits: true, stateTrigger: 'done' },
      { id: 'open-card-archive', get label() { return textNow(text).toggleArchive; }, keys: 'R', code: 'KeyR', group: 'open-card', screen: 'card', edits: true },
      { id: 'open-card-delete', get label() { return textNow(text).trashCardConfirmed; }, keys: 'Backspace', code: 'Backspace', group: 'open-card', screen: 'card', edits: true },
      { id: 'open-card-bookmark', get label() { return textNow(text).toggleBookmark; }, keys: '.', code: 'Period', group: 'open-card', screen: 'card', edits: true },
    ],
  },
  {
    id: 'search',
    get title() { return textNow(text).search; },
    items: [
      { id: 'search-my-cards', get label() { return textNow(text).searchMyCards; }, keys: 'Q', code: 'KeyQ', group: 'search', screen: 'app' },
    ],
  },
];

export const ALL_SHORTCUTS: readonly ShortcutDefinition[] = SHORTCUT_GROUPS.flatMap(group => group.items);
export const OPEN_CARD_SHORTCUTS = ALL_SHORTCUTS.filter(shortcut => shortcut.group === 'open-card');
export const HOVER_CARD_SHORTCUTS = ALL_SHORTCUTS.filter(shortcut => shortcut.group === 'mini-card');
export const BULK_SHORTCUTS = ALL_SHORTCUTS.filter(shortcut => shortcut.group === 'bulk');

export function resolveCardShortcutAction(shortcut: ShortcutDefinition, card: CatalogCard | undefined, context: CardStateActionContext = {}): CardStateAction | null {
  return shortcut.stateTrigger ? resolveCardStateAction(card, shortcut.stateTrigger, context) : null;
}

/** Available Shortcuts groups include only shortcuts supported by `screens` (2026-11-05). */
export function shortcutGroupsFor(screens: readonly ShortcutScreen[], writable: boolean): ShortcutGroup[] {
  return SHORTCUT_GROUPS
    .map(group => ({ ...group, items: group.items.filter(item => screens.includes(item.screen) && (writable || !item.edits)) }))
    .filter(group => group.items.length > 0);
}

export function matchShortcut(event: KeyboardEvent, shortcuts: readonly ShortcutDefinition[] = ALL_SHORTCUTS): ShortcutDefinition | null {
  if (event.altKey) return null;
  for (const shortcut of shortcuts) {
    const command = event.ctrlKey || event.metaKey;
    if (command !== (shortcut.command ?? false)) continue;
    const matched = shortcut.codes ? shortcut.codes.includes(event.code) : shortcut.code ? event.code === shortcut.code : event.key === shortcut.key;
    if (!matched) continue;
    // Character shortcuts ('?') already carry the final character in event.key, so shiftKey is irrelevant.
    const matchedByCharacter = !shortcut.codes && !shortcut.code;
    if (!matchedByCharacter && (shortcut.shift ?? false) !== event.shiftKey) continue;
    return shortcut;
  }
  return null;
}

const textEntrySelector = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]';
const floatingLayerSelector = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], dialog[open]';
let openCardTargets = 0;
const hoverShortcutRoots = new Set<ParentNode>();

// 2026-11-04: an opened card owns its shortcuts even when a tile's older capture listener runs first.
export function claimOpenCardShortcuts(): () => void {
  openCardTargets += 1;
  return () => { openCardTargets -= 1; };
}

function selectionIsActive(): boolean {
  return [...document.querySelectorAll<HTMLElement>('.card-selection-toolbar, .planning-selection')].some(toolbar => toolbar.getClientRects().length > 0);
}

// One app-wide guard disables global shortcuts during text input, editing, or an open dialog.
// Portaled layers may remain in the DOM, so rectangles determine visibility.
export function shortcutTargetBlocked(event: KeyboardEvent, scope?: 'open-card' | 'hover' | 'bulk' | 'selection'): boolean {
  if (event.defaultPrevented || event.repeat || event.isComposing) return true;
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest(textEntrySelector)) return true;
  // 2026-11-10: a card panel owns Escape before the deck's older capture listener can close the whole card.
  if (!scope && event.key === 'Escape' && document.querySelector('[data-card-panel-open="true"]')) return true;
  // Hover and bulk actions have their own targets even with another card open; selection takes precedence over both open and hovered cards.
  if (scope !== 'open-card' && scope !== 'hover' && scope !== 'bulk' && openCardTargets > 0 && matchShortcut(event, OPEN_CARD_SHORTCUTS)) return true;
  if (scope !== 'bulk' && scope !== 'selection' && selectionIsActive() && matchShortcut(event, BULK_SHORTCUTS)) return true;
  // 2026-11-05: mini-card wins over the open card and the old focused-card handler, regardless of listener order.
  const hoveredShortcut = matchShortcut(event, HOVER_CARD_SHORTCUTS);
  const hoveredCard = hoveredCardElement(document);
  if (hoveredShortcut && hoveredCard) {
    if (scope === 'open-card') return true;
    if (!scope && (hoveredShortcut.id !== 'hover-work' || [...hoverShortcutRoots].some(root => root.contains(hoveredCard)))) return true;
  }
  return [...document.querySelectorAll<HTMLElement>(floatingLayerSelector)].some(layer => layer.getClientRects().length > 0);
}

export type HoveredCardAction = 'work' | 'tags' | 'hand' | 'hero' | 'archive' | 'delete' | 'done' | 'bookmark' | 'select';
interface HoveredShortcutBase { cardId: string; anchor: HTMLElement; shortcut: ShortcutDefinition }
export type HoveredCardShortcut = HoveredShortcutBase & (
  | { kind: 'quick-settings'; tab: CardQuickSettingsTab }
  | { kind: 'action'; action: HoveredCardAction }
  | { kind: 'effort'; value: number }
  | { kind: 'priority'; value: CardPriority | null }
);

export function markShortcutPropertyHover(target: HTMLElement | SVGElement, active: boolean): void {
  if (active) target.dataset.shortcutHover = 'true';
  else delete target.dataset.shortcutHover;
}

function visibleHovered(elements: Iterable<HTMLElement>): HTMLElement | null {
  // 2026-11-05: pointer state also covers card transforms; :hover covers table rows without pointer handlers.
  return [...elements].find(element => element.getClientRects().length > 0
    && (element.matches(':hover') || element.dataset.cardHovered === 'true' || element.dataset.shortcutHover === 'true')) ?? null;
}

function hoveredCardElement(root: ParentNode): HTMLElement | null {
  return visibleHovered(root.querySelectorAll<HTMLElement>('.deck-card-space[data-card-id], .deck-table-row[data-card-id]'));
}

function propertyCardId(element: HTMLElement): string {
  return element.dataset.shortcutCardId ?? element.closest<HTMLElement>('[data-card-id]')?.dataset.cardId ?? '';
}

/**
 * The open deck's keydown handler uses this to resolve context and target only:
 * a hovered card, Quick Settings tab, action, or numeric property. The handler calls
 * preventDefault/stopImmediatePropagation on a match and performs the existing Deck action.
 */
export function resolveHoveredCardShortcut(event: KeyboardEvent, root: ParentNode = document): HoveredCardShortcut | null {
  if (shortcutTargetBlocked(event, 'hover')) return null;
  const property = visibleHovered(root.querySelectorAll<HTMLElement>('[data-shortcut-property]'));
  let numericProperty: string | null = null;
  if (property && /^Digit[0-9]$/u.test(event.code)) {
    numericProperty = property.dataset.shortcutProperty === 'effort' ? 'hover-effort-number' : 'hover-priority-number';
  }
  // Effort 0–9 includes Priority 0–3, so choose the list by the hovered icon first.
  const shortcut = matchShortcut(event, numericProperty
    ? HOVER_CARD_SHORTCUTS.filter(candidate => candidate.id === numericProperty)
    : HOVER_CARD_SHORTCUTS);
  if (!shortcut) return null;
  if (property && (shortcut.id === 'hover-effort-number' || shortcut.id === 'hover-priority-number')) {
    const expectedProperty = shortcut.id === 'hover-effort-number' ? 'effort' : 'priority';
    if (property.dataset.shortcutProperty !== expectedProperty) return null;
    const cardId = propertyCardId(property);
    if (!cardId) return null;
    const value = Number(event.code.slice(-1));
    if (expectedProperty === 'effort') return { kind: 'effort', cardId, anchor: property, shortcut, value };
    const priorities: (CardPriority | null)[] = [null, 'low', 'medium', 'high'];
    return { kind: 'priority', cardId, anchor: property, shortcut, value: priorities[value] };
  }
  const cardElement = hoveredCardElement(root);
  const cardId = cardElement?.dataset.cardId ?? '';
  if (!cardElement || !cardId) return null;
  const anchor = cardElement.querySelector<HTMLElement>('.deck-card-open, .catalog-table-title') ?? cardElement;
  if (shortcut.quickTab) return { kind: 'quick-settings', cardId, anchor, shortcut, tab: shortcut.quickTab };
  const actions: Partial<Record<string, HoveredCardAction>> = {
    'hover-work': 'work', 'hover-tags': 'tags', 'hover-hand': 'hand', 'hover-hero': 'hero',
    'hover-archive': 'archive', 'hover-delete': 'delete', 'hover-done': 'done', 'hover-bookmark': 'bookmark', 'hover-select': 'select',
  };
  const action = actions[shortcut.id];
  return action ? { kind: 'action', cardId, anchor, shortcut, action } : null;
}

/**
 * 2026-11-05: Deck owns the keydown listener. Pass its results container and current write permission.
 * The callback checks card availability/pending state and returns true only after accepting the action.
 * Mutations still use the existing catalog API with hashes and its confirmation flows.
 */
export function dispatchHoveredCardShortcut(event: KeyboardEvent, options: {
  root: ParentNode; writable: boolean; onShortcut: (shortcut: HoveredCardShortcut) => boolean;
}): boolean {
  const shortcut = resolveHoveredCardShortcut(event, options.root);
  if (!shortcut || (shortcut.shortcut.edits && !options.writable)) return false;
  if (!options.onShortcut(shortcut)) return false;
  event.preventDefault();
  event.stopImmediatePropagation();
  return true;
}

/** 2026-11-05: use from a Deck effect; cleanup also releases the tile's existing Space fallback (Hand). */
export function listenForHoveredCardShortcuts(options: Parameters<typeof dispatchHoveredCardShortcut>[1]): () => void {
  hoverShortcutRoots.add(options.root);
  const listener = (event: KeyboardEvent) => { dispatchHoveredCardShortcut(event, options); };
  window.addEventListener('keydown', listener, true);
  return () => {
    window.removeEventListener('keydown', listener, true);
    hoverShortcutRoots.delete(options.root);
  };
}
