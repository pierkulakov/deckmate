import { defineText, locale, textNow, useLang, useText } from '../i18n.ts';
import { stateLabel } from '../locales/common.ts';
import { readStoredValue } from '../storage.ts';
import { navigateTabs } from '../tab-navigation.ts';
import { useEscapeToClose } from '../useEscapeToClose.ts';
import { Fragment, useCallback, useDeferredValue, useEffect, useEffectEvent, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ComponentProps, CSSProperties, FormEvent, PointerEvent, ReactElement, ReactNode, RefObject } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Tooltip from '@radix-ui/react-tooltip';
import { DndContext, DragOverlay, KeyboardSensor, MeasuringStrategy, PointerSensor, closestCenter, pointerWithin, useDndContext, useDraggable, useDroppable, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import type { AutoScrollOptions, CollisionDetection, DragStartEvent, DragEndEvent, DragOverEvent, KeyboardCoordinateGetter } from '@dnd-kit/core';
import { Activity, Archive, ArrowDown, ArrowUp, BookOpen, Bot, Box, Braces, Bug, ChevronDown, ChevronRight, CircleCheck, Eye, Flag, FoldHorizontal, Gamepad2, Gauge, GripVertical, Hourglass, Image, Inbox, Layers, LayersArrowDown, LayersArrowUp, LayoutGrid, ListChecks, LoaderCircle, Palette, Pencil, Plus, Route, ScrollText, Search, Shield, Swords, Table2, Tag, Trash2, UsersRound, Volume2, X } from 'lucide-react';
import type { CatalogCard, CatalogDeck, CatalogDeckZone, CatalogSpace, CatalogView, CardKind, CardPriority, DeckKind, DeckStyle, SpaceKind } from '../../src/catalog-contracts.ts';
import { defaultDeckKind, deckCanBeInbox } from '../../src/catalog-contracts.ts';
import type { WorkspaceSnapshot } from '../../src/workspace-contracts.ts';
import { useCatalog } from '../useCatalog.ts';
import type { BulkChange } from '../../src/bulk-contracts.ts';
import type { CatalogAction } from '../useCatalog.ts';
import { JourneyTemplatePanel } from './JourneyPanel.tsx';
import { StatusBadge, statusClass } from './StatusMenu.tsx';
import { Button } from './ui/button.tsx';
import { SelectionToolbar, useCardSelection } from './CardSelection.tsx';
import { CardPreview } from './CardPreview.tsx';
import { CardComposer } from './CardComposer.tsx';
import { CardParentPicker, type ParentPromotionRequest } from './CardParentPicker.tsx';
import { CardFamilyPanel, CardFamilyPopover, SubCardProgress } from './CardFamily.tsx';
import { buildCatalogLookups, familyChildren } from '../catalog-lookups.ts';
import type { CatalogLookups } from '../catalog-lookups.ts';
import { cardTileData } from '../card-tile-equality.ts';
import { defaultCardOrdering, groupAndSortCards, laneOrderOf, readOrdering, sameOrdering, serializeOrdering, writeOrdering, type CardGroup, type CardOrderKey, type CardOrdering as CardOrderingValue, type OrderingContext } from '../catalog-ordering.ts';
import { CardOrdering } from './CardOrdering.tsx';
import { DeckTagsPanel, cardsMatchingTagPick, emptyTagPick, tagPickSize, type TagPick } from './DeckTagsPanel.tsx';
import { AttachSubCards, type AttachSubCardsRequest } from '../AttachSubCards.tsx';
import { DeckActivity } from './DeckActivity.tsx';
import { DeckSummary } from './DeckSummary.tsx';
import { DeckTypePicker } from './DeckTypePicker.tsx';
import { DeckAutomation, type DeckAutomationSettings } from './DeckAutomation.tsx';
import { DeckGuardians } from './DeckGuardians.tsx';
import { useCardLayoutMotion } from '../useCardLayoutMotion.ts';
import { VirtualCardGrid, virtualCardNavigationEntries } from './VirtualCardGrid.tsx';
import { ArrowDownUp, Hash, History, Info, Sparkles } from 'lucide-react';
import { CardOwnerAvatar, CardQuickSettings } from './CardQuickSettings.tsx';
import { QuickSettingsPopover } from './QuickSettingsList.tsx';
import { TagSelectionList } from './TagPicker.tsx';
import { collectProjectTags } from '../../src/project-tags.ts';
import { currentMember } from '../current-member.ts';
import { emitSignal } from '../onboarding/signals.ts';
import { JourneyReturnPrompt, isJourneyReturn, journeyLessonAction, type JourneyReturnAnswer } from './JourneyReturnPrompt.tsx';
import { CardTags, TagBadge, TagTitlePrefix } from './CardTags.tsx';
import { cardHeroEffort } from './CardPropertiesPanel.tsx';
import { JourneyPriorityIcon } from './JourneyMiniCard.tsx';
import { CardIndicators } from './CardIndicators.tsx';
import { CardAttachmentRefreshContext, CardTransferContext, CatalogCardTile, OpenQuestionsBadge, cardIcons, cardKinds, emptyCards, taskStateIcons, useCardTransferDrag } from './CatalogCardTile.tsx';
import { DependencyStateWarning, dependencyConflicts, type DependencyConflict } from './DependencyWarning.tsx';
import { ConfirmStrip } from './ConfirmStrip.tsx';
import type { CatalogMember } from '../../src/catalog-contracts.ts';
import '../deck-workbench.css';
import '../deck-cover.css';
import '../deck-gallery.css';
import '../card-transfer.css';
import '../deck-settings.css';
import '../deck-zones.css';
import '../deck-table.css';
import { deckArt, type DeckArt } from '../deck-art.ts';
import { captureCardTransfer, cardTransferRequest, cardTransferTargetIssue, type CardTransferBaseline } from '../card-transfer.ts';
import { CardDragFace, CardDragTabs, CardDropDeckPicker, CardGroupDropSurface, CardHeroPromotionConfirmation, captureCardDragPreview, cardDragText, type CardDragPreview } from './CardDragPresentation.tsx';
import { useText as useCardDragText } from '../i18n.ts';
import { BULK_SHORTCUTS, listenForHoveredCardShortcuts, matchShortcut, shortcutTargetBlocked, type HoveredCardShortcut, type CardQuickSettingsTab, type ShortcutScreen } from '../keyboard-shortcuts.ts';
import { ShortcutsHelp } from './ShortcutsHelp.tsx';
import { contrastRatio, rgbOf, type Rgb } from '../color-contrast.ts';
import '../deck-panels.css';
import { useDeckTransition } from '../useDeckTransition.ts';
import { shelfAndPile } from '../deck-shelf.ts';
import { ProjectPulseStrip } from './ProjectPulse.tsx';
import { navigateToPlanning } from '../planning-navigation.ts';

const number = (value: number) => new Intl.NumberFormat(locale(), { maximumFractionDigits: 2 }).format(value);

const text = defineText({
  iconDeck: "Deck",
  iconCode: "Code",
  iconArt: "Art",
  iconDesign: "Game design",
  iconSound: "Audio",
  iconBugs: "Bugs",
  iconKnowledge: "Knowledge",
  iconImages: "Images",
  iconTasks: "Tasks",
  iconMembers: "Members",
  iconObjects: "Objects",
  iconMotion: "Motion",
  iconCombat: "Combat",
  iconMilestone: "Milestone",
  alreadyHere: "All selected cards are already here",
  incompatibleDeck: "This deck does not accept all selected card types",
  zoneName: "Zone name",
  newZoneName: "New zone name",
  add: "Add",
  cancel: "Cancel",
  targetDeck: "Target deck",
  transferHelp: "Family and dependencies stay linked · Esc to cancel",
  transferChoose: "drop on a deck below",
  transferHere: "Here",
  unassigned: "Unassigned",
  selection: "Selection",
  card: "Card",
  properties: "Properties",
  open: "Open",
  deselect: "Deselect",
  select: "Select",
  noEffort: "No effort set",
  checklistDone: "Completed checklist items",
  changeUnconfirmed: "Change not confirmed. Check the catalog message and try again.",
  saveFailed: "Could not save the change. Try again.",
  lessonFailed: "State saved, but the step lesson was not saved. The reason is in the card activity log.",
  cardTags: "Card tags",
  staleCard: "The card or catalog changed. Close this window and try again.",
  changeState: "Change state",
  keepFiles: "Files are kept.",
  trashSubCards: " Sub Cards, including archived ones, will also move to Trash.",
  partialLinks: "Some links were not saved. Check the source changes and refresh the remaining selection.",
  deleteFailed: "Deck was not deleted. Check the catalog message above the deck list.",
  unwatch: "Unwatch deck",
  watch: "Watch deck",
  decks: "Decks",
  allCards: "All cards",
  foundCards: "Matching cards",
  allDecks: "All decks",
  cards: "Cards",
  tracks: "Tracks",
  crossDeckCards: "Cards across decks",
  chooseTrack: "Choose track",
  createTrack: "Create track",
  dragInstructions: "Press Space to pick up a card. Use the arrow keys to choose a deck, Space to drop, and Escape to cancel.",
  dragStart: "Moving cards. Use the arrow keys to choose a compatible deck.",
  noDropTarget: "No compatible target.",
  dragCancelled: "Move cancelled.",
  dragCancelledUnchanged: "Move cancelled. Cards are unchanged.",
  projectCatalog: "Project catalog",
  spaceDecks: "Space decks",
  closeDeck: "Close deck",
  deckSettings: "Deck settings",
  deckWatch: "Deck subscription",
  importDeckCsv: "Import CSV into this deck",
  importCsv: "Import CSV",
  deleteDeck: "Delete deck",
  delete: "Delete",
  showAllCards: "Show all cards",
  showMyCards: "Show only my cards",
  searchDeck: "Search…",
  includeShelved: "Include Archive and Trash",
  updating: "Updating",
  deckSearchLabel: "Search decks by title, description, or space",
  searchDecks: "Search decks…",
  clearDeckSearch: "Clear deck search",
  clearSearch: "Clear search",
  refresh: "Refresh",
  dismissSaveNotice: "Dismiss save message",
  loadingCatalog: "Loading decks and cards…",
  catalogNotLoaded: "Decks and cards did not load. Refresh to try again.",
  leaveTrack: "Leave track",
  notConfigured: "Decks are not configured yet. Markdown cards are available under “All cards”.",
  startTemplate: "Start from template",
  startTemplateTitle: "Give your project a starting structure",
  startTemplateHelp: "A starter adds ready spaces, decks and Journeys — for a game or a software project.",
  deckActions: "Deck actions",
  customOrderHint: "Order differs from the deck order",
  leftPanelWidth: "Left panel width",
  resetFilters: "Clear search and filters",
  laneFilters: "Lane filters",
  noMatches: "No matches. Clear search or change the filters.",
  noCardsProject: "No cards yet.",
  noCardsDeck: "No cards in this deck yet. Add the first one with “New card”.",
  noCards: "No cards in this area yet.",
  zone: "Zone",
  noSpaces: "No spaces yet.",
  createSpaceHelp: " Create the first space with +, then add decks to it.",
  sandboxSpaceHelp: " Open the test copy to create a space.",
  noDeckMatches: "No decks found. Change the query or clear search.",
  emptySpace: "This space has no decks.",
  deckTitle: "Deck title",
  spaceToMove: ". Space to move",
  inPile: "in pile",
  inPileNote: ", in the pile",
  showPile: (count: number) => `${number(count)} ${new Intl.PluralRules(locale('en')).select(count) === 'one' ? 'deck' : 'decks'} in the pile. Show`,
  collapsePile: "Collapse pile",
  pileOf: (space: string) => `Pile of ${space}`,
  moveToPile: "Move to pile",
  backToShelf: "Back to shelf",
  pileHelp: "A piled deck leaves the shelf for the pile at the end of its space; its cards and settings stay. Saves immediately.",
  movedToPile: "The deck is in the pile at the end of its space.",
  movedToShelf: "The deck is back on the shelf.",
  closeForm: "Close form",
  newTrack: "New track",
  title: "Title",
  description: "Description",
  trackHelp: "A track connects cards across spaces and decks. A card can belong to several tracks.",
  create: "Create",
  imageType: "Choose a PNG, JPEG, or WEBP image.",
  imageSize: "The image must be no larger than 5 MB.",
  imageReadFailed: "Could not read the image. Choose the file again.",
  artFailed: "Could not load the library cover. Try again.",
  coverSaveFailed: "Settings saved, but the image was not. The file and fields are still in the form. Try saving again.",
  inboxAssigned: "This deck is now the Inbox for new cards with no deck selected.",
  inboxRemoved: "Inbox assignment removed.",
  newDeck: "New deck",
  space: "Space",
  deckType: "Deck type",
  icon: "Icon",
  appearance: "Appearance",
  color: "Color",
  inboxDeck: "Inbox deck",
  inboxHelp: "Cards with no deck selected go here. This setting saves immediately.",
  inboxBadgeHint: "Inbox: cards with no deck chosen go here",
  inboxTasksOnly: "Inbox must take Tasks: Task or Mixed decks only",
  customImage: "Custom image",
  removeImage: "Remove image",
  preview: "Preview",
  imagePosition: "Image position",
  dragImage: "Drag the image up or down",
  moveDeck: "Move deck",
  position: "Position",
  moveSpaceUp: "Move space up",
  moveSpaceDown: "Move space down",
  beforeSpace: (title: string) => `Before “${title}”`,
  atEnd: "At the end",
  move: "Move",
  saveBeforeMove: "Save the appearance before moving.",
  save: "Save",
  labelAddZone: "Add zone",
  labelPriority: "Priority",
  labelEffort: "Effort",
  labelTags: "Tags",
  labelArchiveCard: "Archive card",
  labelUnarchiveCard: "Unarchive card",
  labelMovetoTrash: "Move to Trash",
  labelPrepareJourney: "Prepare Journey",
  labelJourney: "Journey",
  labelDeleteDeck: "Delete deck",
  labelMyCards: "My cards",
  labelArchiveTrash: "Archive/Trash",
  labelCreateSpace: "Create space",
  labelAddCard: "Add card",
  labelNewCard: "New card",
  showInfoSidebar: "Show info sidebar",
  labelOpenOrderPanel: "Open order panel",
  labelOrdering: "Ordering",
  showTags: "Display and select by tags",
  labelInfo: "Info",
  labelActivity: "Activity",
  labelCardview: "Card view",
  labelCards: "Cards",
  labelTable: "Table",
  labelAddDeck: "Add deck",
  labelUpdateSpace: "Update space",
  labelSpacetype: "Space type",
  labelIcon: "Icon",
  labelCustomname: "Custom name",
  labelCancel: "Cancel",
  labelUpdate: "Update",
  labelAdd: "Add",
  labelSymbol: "Symbol",
  labelArtwork: "Artwork",
  labelMinimal: "Minimal",
  deckCounts: (open: number, accepted: number) => `Open tasks and other cards: ${number(open)}; done tasks: ${number(accepted)}`,
  deckProgress: (accepted: number, tasks: number) => `${number(accepted)} of ${number(tasks)} tasks accepted`,
  openCount: (count: number) => `Open tasks and other cards: ${number(count)}`,
  acceptedCount: (count: number) => `Done tasks: ${number(count)}`,
  effortProgress: (done: string, total: string, missing: number) => `Effort: ${done} of ${total} done; ${number(missing)} unestimated`,
  selectGroup: (title: string) => `Select group: ${title}`,
  selectAll: (title: string) => `Select all: ${title}`,
  zoneTitle: (title: string) => `Zone name: ${title}`,
  filter: (title: string) => `Filter: ${title}`,
  renameZone: (title: string) => `Rename zone: ${title}`,
  deleteZone: (title: string) => `Delete empty zone: ${title}`,
  deleteZoneButton: "Delete zone",
  reorderZone: (title: string) => `Reorder zone: ${title}`,
  reorderZoneHint: (title: string) => `Reorder zone · ${title}`,
  newGroupCard: (title: string) => `New card · ${title}`,
  selectCard: (title: string) => `Select: ${title}`,
  owner: (title: string) => `Owner: ${title}`,
  searchCards: (title: string) => `Search cards: ${title}`,
  search: (title: string) => `Search: ${title}`,
  removeFilter: (title: string) => `Remove filter: ${title}`,
  cover: (title: string) => `Cover: ${title}`,
  deleteZoneConfirm: (title: string) => `Delete empty zone “${title}”?`,
  watchers: (names: string) => ` · Watching: ${names}`,
  searchScope: (title: string) => `Deck “${title}”`,
  dropTarget: (title: string) => `Target: ${title}`,
  dropEnd: (title: string) => `Drag ended at “${title}”.`,
  moveToSpace: (title: string) => `Move to space ${title}`,
  configureSpace: (title: string) => `Configure space ${title}`,
  configureDeck: (title: string) => `Configure deck ${title}`,
  beforeDeck: (title: string) => `Before “${title}”`,
  cardsCount: (count: number) => `${number(count)} ${new Intl.PluralRules(locale('en')).select(count) === 'one' ? 'card' : 'cards'}`,
  cardsCountLong: (count: number) => `${number(count)} ${new Intl.PluralRules(locale('en')).select(count) === 'one' ? 'card' : 'cards'}`,
  deckResults: (shown: number, total: number) => `${number(shown)} of ${number(total)} ${new Intl.PluralRules(locale('en')).select(total) === 'one' ? 'deck' : 'decks'}`,
  foundDecks: (shown: number, total: number) => `Found ${number(shown)} of ${number(total)} ${new Intl.PluralRules(locale('en')).select(total) === 'one' ? 'deck' : 'decks'}`,
  trackProgress: (done: number, total: number) => `${number(done)} of ${number(total)} ${new Intl.PluralRules(locale('en')).select(total) === 'one' ? 'task' : 'tasks'} done · a track connects cards across decks`,
  cardResults: (scope: string, shown: number, total: number) => `${scope} · ${number(shown)} of ${number(total)} ${new Intl.PluralRules(locale('en')).select(total) === 'one' ? 'card' : 'cards'}`,
  sourceWarnings: (count: number) => `Source warnings: ${number(count)}`,
  // 2026-11-09: the inventory under the project name sets each number apart in Geist Mono, so the nouns are separate keys.
  sourceDocuments: (count: number) => `Markdown ${new Intl.PluralRules(locale('en')).select(count) === 'one' ? 'document' : 'documents'}`,
  sourceTasks: 'Task',
  sourceHeroes: 'Hero',
  sourceDocs: 'Doc Cards',
  transferCount: (count: number) => count === 1 ? 'Move the card to' : `Move ${number(count)} cards to`,
  defaultDeckType: (kind: string) => `Default deck type: ${kind}`,
  deleteDeckConfirm: (title: string, count: number) => {
    let consequence = '';
    if (count > 0) {
      const cards = new Intl.PluralRules(locale('en')).select(count) === 'one' ? 'card' : `${number(count)} cards`;
      consequence = ` Its ${cards} will move to “Unassigned”.`;
    }
    return `Delete deck “${title}”?${consequence} Deck Journeys prevent deletion.`;
  },
}, {
  iconDeck: "Колода",
  iconCode: "Код",
  iconArt: "Графика",
  iconDesign: "Геймдизайн",
  iconSound: "Звук",
  iconBugs: "Ошибки",
  iconKnowledge: "Знания",
  iconImages: "Изображения",
  iconTasks: "Задачи",
  iconMembers: "Участники",
  iconObjects: "Объекты",
  iconMotion: "Движение",
  iconCombat: "Боевая система",
  iconMilestone: "Milestone",
  alreadyHere: "Все выбранные карточки уже здесь",
  incompatibleDeck: "Колода не принимает все выбранные типы карточек",
  zoneName: "Название зоны",
  newZoneName: "Название новой зоны",
  add: "Добавить",
  cancel: "Отмена",
  targetDeck: "Целевая колода",
  transferHelp: "Семья и зависимости сохраняются · Esc — отмена",
  transferChoose: "отпустите над колодой внизу",
  transferHere: "Здесь",
  unassigned: "Без колоды",
  selection: "Выбор",
  card: "Карточка",
  properties: "Свойства",
  open: "Открыть",
  deselect: "Снять выбор",
  select: "Выбрать",
  noEffort: "Оценка не задана",
  checklistDone: "Выполненные пункты чеклиста",
  changeUnconfirmed: "Изменение не подтверждено. Проверьте сообщение каталога и повторите действие.",
  saveFailed: "Не удалось сохранить изменение. Повторите действие.",
  lessonFailed: "Состояние сохранено, но грабли шага не записаны. Причина сохранена в журнале карточки.",
  cardTags: "Теги карточки",
  staleCard: "Карточка или каталог изменились. Закройте окно и повторите действие.",
  changeState: "Изменить состояние",
  keepFiles: "Файлы сохраняются.",
  trashSubCards: " В корзину также попадут Sub Cards, включая архивные.",
  partialLinks: "Не все связи сохранены. Проверьте изменения источника и обновите оставшийся выбор.",
  deleteFailed: "Колода не удалена. Причина — в сообщении каталога над списком колод.",
  unwatch: "Не наблюдать за колодой",
  watch: "Наблюдать за колодой",
  decks: "Колоды",
  allCards: "Все карточки",
  foundCards: "Найденные карточки",
  allDecks: "Все колоды",
  cards: "Карточки",
  tracks: "Треки",
  crossDeckCards: "Карточки из разных колод",
  chooseTrack: "Выбрать трек",
  createTrack: "Создать трек",
  dragInstructions: "Нажмите пробел, чтобы поднять карточку. Стрелками выберите колоду, пробел завершает перенос, Escape отменяет.",
  dragStart: "Перенос карточек. Стрелками выберите совместимую колоду.",
  noDropTarget: "Нет совместимой цели.",
  dragCancelled: "Перенос отменён.",
  dragCancelledUnchanged: "Перенос отменён. Карточки не изменены.",
  projectCatalog: "Каталог проекта",
  spaceDecks: "Колоды пространства",
  closeDeck: "Закрыть колоду",
  deckSettings: "Настройки колоды",
  deckWatch: "Наблюдение за колодой",
  importDeckCsv: "Импорт CSV в эту колоду",
  importCsv: "Импорт CSV",
  deleteDeck: "Удалить колоду",
  delete: "Удалить",
  showAllCards: "Показать все карточки",
  showMyCards: "Показать только мои карточки",
  searchDeck: "Поиск…",
  includeShelved: "Включая архив и корзину",
  updating: "Обновление",
  deckSearchLabel: "Поиск колод по названию, описанию или пространству",
  searchDecks: "Поиск колод…",
  clearDeckSearch: "Сбросить поиск колод",
  clearSearch: "Сбросить поиск",
  refresh: "Обновить",
  dismissSaveNotice: "Скрыть сообщение о сохранении",
  loadingCatalog: "Загружаем колоды и карточки…",
  catalogNotLoaded: "Колоды и карточки не загрузились. Обновите, чтобы повторить.",
  leaveTrack: "Выйти из трека",
  notConfigured: "Колоды ещё не настроены. Markdown-карточки доступны в «Все карточки».",
  startTemplate: "Начать с шаблона",
  startTemplateTitle: "Создайте начальную структуру проекта",
  startTemplateHelp: "Заготовка добавит готовые пространства, колоды и Journeys — для игры или софтверного проекта.",
  deckActions: "Действия колоды",
  customOrderHint: "Порядок отличается от порядка колоды",
  leftPanelWidth: "Ширина левой панели",
  resetFilters: "Сбросить поиск и фильтры",
  laneFilters: "Фильтры дорожек",
  noMatches: "Совпадений нет. Сбросьте поиск или измените фильтры.",
  noCardsProject: "Карточек пока нет.",
  noCardsDeck: "В этой колоде пока нет карточек. Добавьте первую кнопкой «Новая карточка».",
  noCards: "В этой области пока нет карточек.",
  zone: "Зона",
  noSpaces: "Пространств пока нет.",
  createSpaceHelp: " Создайте первое пространство кнопкой + и добавьте в него колоды.",
  sandboxSpaceHelp: " Откройте тестовую копию для создания пространства.",
  noDeckMatches: "Колоды не найдены. Измените запрос или сбросьте поиск.",
  emptySpace: "В пространстве нет колод.",
  deckTitle: "Название колоды",
  spaceToMove: ". Пробел — перенести",
  inPile: "в стопке",
  inPileNote: ", в стопке",
  showPile: (count: number) => {
    const rule = new Intl.PluralRules(locale('ru')).select(count);
    let form = 'колод';
    if (rule === 'one') form = 'колода';
    else if (rule === 'few') form = 'колоды';
    return `В стопке ${number(count)} ${form}. Показать`;
  },
  collapsePile: "Свернуть стопку",
  pileOf: (space: string) => `Стопка пространства ${space}`,
  moveToPile: "Убрать в стопку",
  backToShelf: "Вернуть на полку",
  pileHelp: "Колода уходит с полки в стопку в конце своего пространства; карточки и настройки остаются. Сохраняется сразу.",
  movedToPile: "Колода лежит в стопке в конце своего пространства.",
  movedToShelf: "Колода снова на полке.",
  closeForm: "Закрыть форму",
  newTrack: "Новый трек",
  title: "Название",
  description: "Описание",
  trackHelp: "Трек объединяет карточки из разных пространств и колод. Карточка может входить в несколько треков.",
  create: "Создать",
  imageType: "Выберите PNG, JPEG или WEBP.",
  imageSize: "Изображение должно быть не больше 5 МБ.",
  imageReadFailed: "Не удалось прочитать изображение. Выберите файл ещё раз.",
  artFailed: "Не удалось взять обложку из библиотеки. Попробуйте ещё раз.",
  coverSaveFailed: "Настройки сохранены. Изображение не сохранено; файл и поля оставлены в форме. Повторите сохранение.",
  inboxAssigned: "Эта колода назначена Inbox для новых карточек без явного выбора.",
  inboxRemoved: "Назначение Inbox снято.",
  newDeck: "Новая колода",
  space: "Пространство",
  deckType: "Тип колоды",
  icon: "Значок",
  appearance: "Оформление",
  color: "Цвет",
  inboxDeck: "Колода-приёмник Inbox",
  inboxHelp: "Карточки без явно выбранной колоды попадают сюда. Настройка сохраняется сразу.",
  inboxBadgeHint: "Inbox: сюда попадают карточки без выбранной колоды",
  inboxTasksOnly: "Inbox принимает задачи: только колоды Task и Mixed",
  customImage: "Собственное изображение",
  removeImage: "Убрать изображение",
  preview: "Предпросмотр",
  imagePosition: "Положение изображения",
  dragImage: "Потяните картинку вверх или вниз",
  moveDeck: "Переместить колоду",
  position: "Позиция",
  moveSpaceUp: "Переместить space выше",
  moveSpaceDown: "Переместить space ниже",
  beforeSpace: (title: string) => `Перед «${title}»`,
  atEnd: "В конец",
  move: "Переместить",
  saveBeforeMove: "Сохраните оформление перед перемещением.",
  save: "Сохранить",
  labelAddZone: "Добавить зону",
  labelPriority: "Приоритет",
  labelEffort: "Оценка",
  labelTags: "Теги",
  labelArchiveCard: "Архивировать карточку",
  labelUnarchiveCard: "Вернуть из архива",
  labelMovetoTrash: "Переместить в корзину",
  labelPrepareJourney: "Подготовить Journey",
  labelJourney: "Journey",
  labelDeleteDeck: "Удалить колоду",
  labelMyCards: "Мои карточки",
  labelArchiveTrash: "Архив/корзина",
  labelCreateSpace: "Создать пространство",
  labelAddCard: "Добавить карточку",
  labelNewCard: "Новая карточка",
  showInfoSidebar: "Показать панель информации",
  labelOpenOrderPanel: "Открыть панель порядка",
  labelOrdering: "Порядок",
  showTags: "Показ и выбор по тегам",
  labelInfo: "Инфо",
  labelActivity: "Активность",
  labelCardview: "Режим просмотра",
  labelCards: "Карточки",
  labelTable: "Таблица",
  labelAddDeck: "Добавить колоду",
  labelUpdateSpace: "Изменить пространство",
  labelSpacetype: "Тип пространства",
  labelIcon: "Значок",
  labelCustomname: "Своё название",
  labelCancel: "Отмена",
  labelUpdate: "Изменить",
  labelAdd: "Добавить",
  labelSymbol: "Символ",
  labelArtwork: "Арт",
  labelMinimal: "Минимум",
  deckCounts: (open: number, accepted: number) => `Открытые задачи и обычные карточки: ${number(open)}; принятые задачи: ${number(accepted)}`,
  deckProgress: (accepted: number, tasks: number) => `Принято задач: ${number(accepted)} из ${number(tasks)}`,
  openCount: (count: number) => `Открытые задачи и обычные карточки: ${number(count)}`,
  acceptedCount: (count: number) => `Принятые задачи: ${number(count)}`,
  effortProgress: (done: string, total: string, missing: number) => `Оценка: принято ${done} из ${total}; без оценки ${number(missing)}`,
  selectGroup: (title: string) => `Выбрать группу: ${title}`,
  selectAll: (title: string) => `Выбрать все: ${title}`,
  zoneTitle: (title: string) => `Название зоны: ${title}`,
  filter: (title: string) => `Фильтр: ${title}`,
  renameZone: (title: string) => `Переименовать зону: ${title}`,
  deleteZone: (title: string) => `Удалить пустую зону: ${title}`,
  deleteZoneButton: "Удалить зону",
  reorderZone: (title: string) => `Переставить зону: ${title}`,
  reorderZoneHint: (title: string) => `Переставить зону · ${title}`,
  newGroupCard: (title: string) => `Новая карточка · ${title}`,
  selectCard: (title: string) => `Выбрать: ${title}`,
  owner: (title: string) => `Исполнитель: ${title}`,
  searchCards: (title: string) => `Поиск карточек: ${title}`,
  search: (title: string) => `Поиск: ${title}`,
  removeFilter: (title: string) => `Убрать фильтр: ${title}`,
  cover: (title: string) => `Обложка: ${title}`,
  deleteZoneConfirm: (title: string) => `Удалить пустую зону «${title}»?`,
  watchers: (names: string) => ` · Наблюдают: ${names}`,
  searchScope: (title: string) => `Колода «${title}»`,
  dropTarget: (title: string) => `Цель: ${title}`,
  dropEnd: (title: string) => `Перетаскивание завершено у «${title}».`,
  moveToSpace: (title: string) => `Переместить в пространство ${title}`,
  configureSpace: (title: string) => `Настроить пространство ${title}`,
  configureDeck: (title: string) => `Настроить колоду ${title}`,
  beforeDeck: (title: string) => `Перед «${title}»`,
  cardsCount: (count: number) => `Карточек: ${number(count)}`,
  cardsCountLong: (count: number) => `${number(count)} карточек`,
  deckResults: (shown: number, total: number) => `${number(shown)} из ${number(total)} колод`,
  foundDecks: (shown: number, total: number) => `Найдено ${number(shown)} из ${number(total)} колод`,
  trackProgress: (done: number, total: number) => `${number(done)} из ${number(total)} задач принято · трек объединяет карточки из разных колод`,
  cardResults: (scope: string, shown: number, total: number) => `${scope} · ${number(shown)} из ${number(total)} карточек`,
  sourceWarnings: (count: number) => `Замечания к источникам: ${number(count)}`,
  // 2026-11-06: Russian counts need the plural form, not a fixed genitive ("1 Markdown-документ", not "1 …документов").
  sourceDocuments: (count: number) => {
    const rule = new Intl.PluralRules(locale('ru')).select(count);
    if (rule === 'one') return 'Markdown-документ';
    return rule === 'few' ? 'Markdown-документа' : 'Markdown-документов';
  },
  sourceTasks: 'Task',
  sourceHeroes: 'Hero',
  sourceDocs: 'Doc Cards',
  transferCount: (count: number) => count === 1 ? 'Перенести карточку в' : `Перенести карточки (${number(count)}) в`,
  defaultDeckType: (kind: string) => `Тип колоды по умолчанию: ${kind}`,
  deleteDeckConfirm: (title: string, count: number) => {
    let consequence = '';
    if (count === 1) consequence = ' Её карточка уйдёт в «Без колоды».';
    else if (count > 1) consequence = ` Её карточки (${number(count)}) уйдут в «Без колоды».`;
    return `Удалить колоду «${title}»?${consequence} Journey колоды блокируют удаление.`;
  },
});

interface DeckProps {
  snapshot: WorkspaceSnapshot;
  refreshKey: number;
  onEditing?: (editing: boolean) => void;
/** Deck header tray opens CSV import directly into this deck. */
  onImportCsv?: (deckId: string) => void;
  onStartFromTemplate?: () => void;
}

type CatalogScope = { kind: 'catalog' | 'all' | 'unassigned' } | { kind: 'deck'; id: string };
type Creation = { kind: 'space' | 'deck' | 'track'; spaceId?: string; deckId?: string; editing?: boolean };
type CatalogEditor = (action: CatalogAction) => Promise<boolean>;
type LaneSearchEntry = { key: string; title: string; ordering: CardOrderingValue };
// 2026-11-05: useSensor memoizes by options identity; new options invalidate every draggable's context.
const cardPointerOptions = { activationConstraint: { distance: 6 } };

// 2026-11-08: by default dnd-kit autoscrolls any scrollable ancestor within 20% of its edge, so a pointer resting at the
// window edge raced the page away under the fixed transfer targets. Every transfer target is pinned to the viewport
// (deck dock, tabs, lanes panel) or lives inside one of those fixed surfaces; only a Manual order insertion point can
// sit outside the viewport, in the workspace card list. So autoscroll runs inside a fixed transfer surface (the dock,
// lanes panel or deck menu scrolling their own lists) and, in Manual order, the workspace card list — never the page
// itself. The zone is 5% of the container's height (~48px on the workspace), x: 0 disables the horizontal axis, and
// dnd-kit checks the remaining scroll range in a direction before scrolling it and stops the moment the drag ends.
const transferAutoScrollThreshold = { x: 0, y: 0.05 };
function transferAutoScrollOptions(manualOrdering: boolean): AutoScrollOptions {
  return {
    threshold: transferAutoScrollThreshold,
    canScroll: element => {
      if (element === document.scrollingElement) return false;
      if (element instanceof HTMLElement && getComputedStyle(element).position === 'fixed') return true;
      return manualOrdering && element.classList.contains('workspace-main');
    },
  };
}

function readLaneSearch(query: URLSearchParams): LaneSearchEntry[] {
  return query.getAll('lane').flatMap(value => {
    try {
      const entry = JSON.parse(value) as Record<string, unknown>;
      if (typeof entry.key !== 'string' || typeof entry.title !== 'string' || typeof entry.order !== 'string') return [];
      return [{ key: entry.key, title: entry.title, ordering: readOrdering(new URLSearchParams(entry.order)) }];
    } catch { return []; }
  });
}

interface DeckCardCounts { open: number; accepted: number; tasks: number }
const emptyDeckCounts: DeckCardCounts = { open: 0, accepted: 0, tasks: 0 };

function countDeckCards(cards: readonly CatalogCard[]): DeckCardCounts {
  // Hero progress belongs to its children; only a Task has its own accepted state (2026-11-03).
  const tasks = cards.filter(card => card.kind === 'task');
  const accepted = tasks.filter(card => card.state === 'done').length;
  return { open: cards.length - accepted, accepted, tasks: tasks.length };
}

function deckCountLabel(counts: DeckCardCounts) {
  const t = textNow(text);
  const label = t.deckCounts(counts.open, counts.accepted);
  return counts.tasks > 0 ? `${label}; ${t.deckProgress(counts.accepted, counts.tasks)}` : label;
}

// All deck header buttons share a green tooltip with an arrow below the button.
/** A header tooltip; a shortcut goes in `keys` and is drawn as key chips (Ctrl+Enter style of the card editor), never as text. */
export function DeckHeaderHint({ label, keys, note, side = 'bottom', children }: { label: string; keys?: readonly string[]; note?: string; side?: 'bottom' | 'right'; children: ReactElement }) {
  return <Tooltip.Root>
    <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
    <Tooltip.Portal>
      <Tooltip.Content className="deck-header-hint" side={side} sideOffset={6}>
        {label}
        {keys && <span className="deck-header-hint-keys">{keys.map((key, index) => <Fragment key={key}>{index > 0 && '+'}<kbd>{key}</kbd></Fragment>)}</span>}
        {note && <span className="deck-header-hint-note">{note}</span>}
        <Tooltip.Arrow />
      </Tooltip.Content>
    </Tooltip.Portal>
  </Tooltip.Root>;
}

/** 2026-11-09: the project's file inventory reads as a caption under its name on the home screen, replacing the footer line
 * under the covers (the author's choice); the same line opens the source warnings, which list under the header. */
function CatalogSourceLine({ documents, kinds, warnings, warningsOpen, onToggleWarnings }: { documents: number; kinds: Record<CardKind, number>; warnings: number; warningsOpen: boolean; onToggleWarnings: () => void }) {
  const t = useText(text);
  const parts: [number, string][] = [[documents, t.sourceDocuments(documents)], [kinds.task, t.sourceTasks], [kinds.hero, t.sourceHeroes], [kinds.doc, t.sourceDocs]];
  return <p className="catalog-source">
    {parts.map(([count, label], index) => <Fragment key={index}>{index > 0 && <span className="dot-separator">·</span>}<span className="catalog-source-part"><span className="catalog-source-count">{number(count)}</span> {label}</span></Fragment>)}
    {warnings > 0 && <><span className="dot-separator">·</span><button type="button" className="catalog-source-warnings" aria-expanded={warningsOpen} aria-controls="catalog-source-warnings" onClick={onToggleWarnings}>{t.sourceWarnings(warnings)}</button></>}
  </p>;
}

function DeckCounts({ counts }: { counts: DeckCardCounts }) {
  const t = useText(text);
  return <span className="catalog-cover-counts" role="group" aria-label={deckCountLabel(counts)}>
    {(counts.open > 0 || counts.accepted === 0) && <span className="catalog-cover-count" title={t.openCount(counts.open)} aria-hidden="true">{number(counts.open)}</span>}
    {counts.accepted > 0 && <span className="catalog-cover-count is-accepted" title={t.acceptedCount(counts.accepted)} aria-hidden="true">{number(counts.accepted)}</span>}
  </span>;
}

const deckKindText = defineText({ asset: 'Asset · Hero Cards', task: 'Task · Tasks', knowledge: 'Knowledge · Doc Cards', mixed: 'Mixed' },
  { asset: 'Asset · Hero Cards', task: 'Task · задачи', knowledge: 'Knowledge · Doc Cards', mixed: 'Mixed' });
const spaceDescriptionText = defineText({
  gdd: 'For decks containing Hero Cards', tasks: 'For decks representing work areas',
  knowledge: 'For decks containing Doc Cards', qa: 'For decks containing bugs and issues', custom: '',
}, {
  gdd: 'Для колод с Hero Cards', tasks: 'Для колод рабочих направлений',
  knowledge: 'Для колод с Doc Cards', qa: 'Для колод с багами и задачами', custom: '',
});
// Same names as the deck icon tooltips in `text`, so an icon reads identically on a deck and a space.
const spaceIconText = defineText({
  layers: 'Layers', code: 'Code', palette: 'Palette', gamepad: 'Gamepad', audio: 'Audio', bug: 'Bug', book: 'Book',
  image: 'Image', tasks: 'Tasks', users: 'Users', box: 'Box', activity: 'Activity', swords: 'Swords', flag: 'Flag',
}, {
  layers: 'Колода', code: 'Код', palette: 'Графика', gamepad: 'Геймдизайн', audio: 'Звук', bug: 'Ошибки', book: 'Знания',
  image: 'Изображения', tasks: 'Задачи', users: 'Участники', box: 'Объекты', activity: 'Движение', swords: 'Боевая система', flag: 'Milestone',
});
const spacePresets: Record<SpaceKind, { title: string; icon: string }> = {
  gdd: { title: 'GDD', icon: 'book' },
  tasks: { title: 'Tasks', icon: 'tasks' },
  knowledge: { title: 'Knowledge', icon: 'book' },
  qa: { title: 'QA', icon: 'bug' },
  custom: { title: 'Custom', icon: 'layers' },
};
// Round badges on the cover seam show the card kinds accepted by the deck.
const deckKindBadges: Record<DeckKind, CardKind[]> = { asset: ['hero'], task: ['task'], knowledge: ['doc'], mixed: ['hero', 'task'] };
const deckIcons = { layers: Layers, code: Braces, palette: Palette, gamepad: Gamepad2, audio: Volume2, bug: Bug, book: BookOpen, image: Image, tasks: ListChecks, users: UsersRound, box: Box, activity: Activity, swords: Swords, flag: Flag };
function deckIconNames(): Record<keyof typeof deckIcons, string> {
  const t = textNow(text);
  return { layers: t.iconDeck, code: t.iconCode, palette: t.iconArt, gamepad: t.iconDesign, audio: t.iconSound, bug: t.iconBugs, book: t.iconKnowledge, image: t.iconImages, tasks: t.iconTasks, users: t.iconMembers, box: t.iconObjects, activity: t.iconMotion, swords: t.iconCombat, flag: t.iconMilestone };
}

function DeckIcon({ name, size = 24 }: { name: string; size?: number }) {
  const aliases: Record<string, keyof typeof deckIcons> = { coding: 'code', braces: 'code', 'code-xml': 'code', art: 'palette', paintbrush: 'palette', headphones: 'audio', 'volume-2': 'audio', 'gamepad-2': 'gamepad', 'book-open': 'book', 'file-text': 'book', 'list-checks': 'tasks' };
  const normalized = name.toLowerCase();
  const Icon = deckIcons[aliases[normalized] ?? normalized as keyof typeof deckIcons] ?? Layers;
  return <Icon size={size} aria-hidden="true" />;
}

function readCatalogLocation(source: string) {
  const query = new URLSearchParams(location.search);
  if (query.has('catalogSource') && query.get('catalogSource') !== source) return new URLSearchParams();
  return query;
}

function initialScope(query: URLSearchParams): CatalogScope {
  const deckId = query.get('deck');
  if (deckId) return { kind: 'deck', id: deckId };
  if (query.get('scope') === 'unassigned') return { kind: 'unassigned' };
  if (query.get('scope') === 'all' || ['card', 'track', 'q', 'kind', 'state', 'owner', 'tag'].some(key => query.has(key))) return { kind: 'all' };
  return { kind: 'catalog' };
}

function storedPanelWidth(key: string, fallback: number, minimum: number, maximum: number): number {
  try {
    const stored = readStoredValue(localStorage, key);
    if (stored === null) return fallback;
    const value = Number(stored);
    return Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, value)) : fallback;
  } catch { return fallback; }
}

function useCatalogStickyLayout(hasDeck: boolean, hasSelection: boolean) {
  const root = useRef<HTMLElement>(null);
  const toolbar = useRef<HTMLElement>(null);
  const selection = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = root.current;
    const scrollport = element?.closest<HTMLElement>('.workspace-main');
    if (!element || !scrollport) return;
    const measure = () => {
      const viewportHeight = scrollport.clientHeight;
      const toolbarHeight = toolbar.current?.getBoundingClientRect().height ?? 0;
      const selectionHeight = selection.current?.getBoundingClientRect().height ?? 0;
      // Wrapping changes pinned heights; reserve the measured space, not a guessed offset (2026-11-03).
      const toolbarPinned = toolbarHeight > 0 && toolbarHeight < viewportHeight * .3;
      const toolbarOffset = toolbarPinned ? toolbarHeight + 8 : 0;
      const selectionPinned = window.innerWidth > 900 && selectionHeight > 0 && toolbarOffset + selectionHeight < viewportHeight * .4;
      const selectionOffset = selectionPinned ? selectionHeight + 8 : 0;
      element.dataset.toolbarSticky = String(toolbarPinned);
      element.dataset.selectionSticky = String(selectionPinned);
      element.style.setProperty('--catalog-scroll-height', viewportHeight + 'px');
      element.style.setProperty('--deck-sticky-offset', toolbarOffset + 'px');
      element.style.setProperty('--catalog-content-offset', toolbarOffset + selectionOffset + 'px');
    };
    const observer = new ResizeObserver(measure);
    [scrollport, toolbar.current, selection.current].forEach(node => { if (node) observer.observe(node); });
    measure();
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, [hasDeck, hasSelection]);
  return { root, toolbar, selection };
}

// The left column is 503 px on desktop and shrinks for narrow windows.
function defaultPreviewWidth() {
  // Below roughly 1000 px, shrink the 503 px column while keeping a readable 420 px minimum.
  return Math.max(420, Math.min(503, Math.round((window.innerWidth - 32) * .5)));
}

function useCatalogPanels() {
  const [leftPanelWidth, setLeftPanelWidth] = useState(() => storedPanelWidth('deckmate-left-panel-width-v5', defaultPreviewWidth(), 420, 800));
  const [summaryCollapsed, setSummaryCollapsed] = useState(() => {
    if (window.matchMedia('(max-width: 760px)').matches) return true;
    try { return readStoredValue(localStorage, 'deckmate-summary-collapsed') === 'true'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('deckmate-left-panel-width-v5', String(leftPanelWidth)); localStorage.setItem('deckmate-summary-collapsed', String(summaryCollapsed)); }
    catch { /* Storage may be unavailable in private contexts; resizing still works (2026-11-03). */ }
  }, [leftPanelWidth, summaryCollapsed]);
  return { leftPanelWidth, summaryCollapsed, setLeftPanelWidth, setSummaryCollapsed };
}

function PanelResize({ label, value, minimum, maximum, direction, onChange }: { label: string; value: number; minimum: number; maximum: number; direction: number; onChange: (value: number) => void }) {
  const start = useRef<{ pointer: number; value: number } | null>(null);
  const bounded = (next: number) => Math.max(minimum, Math.min(maximum, next));
  return <div className="catalog-resize-handle" role="separator" aria-orientation="vertical" aria-label={label} aria-valuemin={minimum} aria-valuemax={maximum} aria-valuenow={Math.round(value)} tabIndex={0}
    onPointerDown={event => { event.preventDefault(); start.current = { pointer: event.clientX, value }; event.currentTarget.setPointerCapture(event.pointerId); }}
    onPointerMove={event => { if (start.current) onChange(bounded(start.current.value + (event.clientX - start.current.pointer) * direction)); }}
    onPointerUp={event => { start.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
    onPointerCancel={() => { start.current = null; }}
    onKeyDown={event => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); if (event.key === 'Home') onChange(minimum); else if (event.key === 'End') onChange(maximum); else onChange(bounded(value + (event.key === 'ArrowRight' ? 16 : -16) * direction)); }}><span /></div>;
}

function groupEffort(group: CardGroup, lookups: CatalogLookups) {
  const t = textNow(text);
  // 2026-11-05: count a Hero's live work once, even when its children are also shown in this lane.
  const work = new Map<string, CatalogCard>();
  for (const card of group.cards) {
    if (card.archived || card.deleted || card.kind === 'doc') continue;
    const children = familyChildren(lookups, card.id).filter(child => child.kind === 'task');
    if (card.kind === 'task' || card.effort != null || !children.length) work.set(card.id, card);
    for (const child of children) work.set(child.id, child);
  }
  const cards = [...work.values()];
  if (!cards.some(card => card.effort != null)) return null;
  const total = cards.reduce((sum, card) => sum + (card.effort ?? 1), 0);
  const done = cards.reduce((sum, card) => sum + (card.state === 'done' ? card.effort ?? 1 : 0), 0);
  const missing = cards.filter(card => card.effort == null).length;
  const format = (value: number) => value.toLocaleString(locale(), { maximumFractionDigits: 2 });
  return { label: (done ? format(done) + ' / ' : '') + format(total) + (missing ? ' (' + number(missing) + ')' : ''),
    description: t.effortProgress(format(done), format(total), missing) };
}

function CardGroupHeading({ group, tagDefinitions, lookups, selectedIds, disabled, onToggleGroup, onFilter, onCreate, zone }: {
  group: CardGroup; tagDefinitions?: CatalogView['projectTags']; selectedIds: Set<string>; disabled: boolean; onToggleGroup: (ids: readonly string[]) => void;
  lookups: CatalogLookups; onFilter: (group: CardGroup) => void;
  onCreate?: () => void;
/** Manual zone controls: rename, delete when empty, and drag to reorder. */
  zone?: { writable: boolean; dragHandle: ReactNode; onRename: (title: string) => void; onDelete: () => void;
    /** The delete button turned into its confirmation strip until the answer comes (2026-11-05). */
    deleteConfirm?: { onKeep: () => void; onConfirm: () => void } | null };
}) {
  const t = useText(text);
  const ids = group.cards.map(card => card.id);
  const selectedCount = ids.filter(id => selectedIds.has(id)).length;
  const effort = groupEffort(group, lookups);
  const [renaming, setRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState(group.title);
  function commitRename() {
    const title = draftTitle.trim();
    setRenaming(false);
    if (title && title !== group.title) zone?.onRename(title);
    else setDraftTitle(group.title);
  }
  const tagName = group.key.startsWith('tags:') && group.key !== 'tags:none' ? group.key.slice(5) : null;
  const groupLabel = tagName ? <TagBadge name={tagName} definition={tagDefinitions?.find(tag => tag.name === tagName)} /> : group.title;
  const laneIcon = group.key.startsWith('deck:') || group.key.startsWith('priority:') ? <Layers size={13} /> : null;
  return <div className={'catalog-card-group-heading' + (zone ? ' catalog-zone-heading' : '')} data-layout-follow={'heading:' + group.key} data-selecting={selectedIds.size > 0 || undefined}>
    {zone && zone.dragHandle}
    <div className="catalog-group-label">
    <label className="catalog-group-select" title={t.selectAll(group.title)}>
    <input type="checkbox" aria-label={t.selectGroup(group.title)} checked={ids.length > 0 && selectedCount === ids.length}
      ref={input => { if (input) input.indeterminate = selectedCount > 0 && selectedCount < ids.length; }}
      disabled={disabled || ids.length === 0} onChange={() => onToggleGroup(ids)} />
    </label>
    {renaming
      ? <input className="catalog-zone-title-input" value={draftTitle} autoFocus disabled={disabled} aria-label={t.zoneTitle(group.title)}
          onChange={event => setDraftTitle(event.target.value)} onBlur={commitRename}
          onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commitRename(); } if (event.key === 'Escape') { event.preventDefault(); setRenaming(false); setDraftTitle(group.title); } }} />
      : <button type="button" className="catalog-group-filter" disabled={disabled} onClick={() => onFilter(group)} title={t.filter(group.title)}>{group.state ? <StatusBadge state={group.state} /> : <>{laneIcon}{groupLabel}</>}</button>}
    <span className="catalog-group-count">{number(group.cards.length)}</span>
  </div><span className="catalog-group-rule" aria-hidden="true" />
    {onCreate && <Button type="button" variant="ghost" size="icon" className="catalog-group-add" disabled={disabled} title={t.newGroupCard(group.title)} aria-label={t.newGroupCard(group.title)} onClick={onCreate}><Plus size={14} /></Button>}
    {zone && <span className="catalog-zone-tools">
      {zone.writable && <Button type="button" variant="ghost" size="icon" disabled={disabled} title={t.renameZone(group.title)} aria-label={t.renameZone(group.title)} onClick={() => { setDraftTitle(group.title); setRenaming(true); }}><Pencil size={13} /></Button>}
      {zone.writable && group.cards.length === 0 && (zone.deleteConfirm
        ? <ConfirmStrip question={t.deleteZoneConfirm(group.title)} keepLabel={t.cancel} confirmLabel={t.deleteZoneButton} danger
            onEscape={zone.deleteConfirm.onKeep} onKeep={zone.deleteConfirm.onKeep} onConfirm={zone.deleteConfirm.onConfirm} />
        : <Button type="button" variant="ghost" size="icon" className="is-danger" disabled={disabled} title={t.deleteZone(group.title)} aria-label={t.deleteZone(group.title)} onClick={zone.onDelete}><Trash2 size={13} /></Button>)}
    </span>}
    {effort && <span className="catalog-group-effort" title={effort.description} aria-label={effort.description}><Gauge size={14} />{effort.label}</span>}
  </div>;
}




// Dropping a card onto another priority lane sets its priority. Only Task cards belong to priority lanes.
const groupPriorities: Record<string, CardPriority | null> = { 'priority:high': 'high', 'priority:medium': 'medium', 'priority:low': 'low', 'priority:none': null };

/** The active grouping determines which property a drop changes. */
type GroupLane =
  | { kind: 'priority'; priority: CardPriority | null }
  | { kind: 'tags'; tag: string | null }
  | { kind: 'deck'; deck: CatalogDeck | null }
  | { kind: 'zone'; deckId: string; zoneId: string | null };

function laneForGroup(group: CardGroup, lanes: CardOrderKey | null, deckById: ReadonlyMap<string, CatalogDeck>, deckId: string | null): GroupLane | null {
  if (lanes === 'priority' && group.key in groupPriorities) return { kind: 'priority', priority: groupPriorities[group.key] };
  if (lanes === 'tags') return { kind: 'tags', tag: group.key === 'tags:none' ? null : group.key.slice('tags:'.length) };
  if (lanes === 'deck') return { kind: 'deck', deck: group.key === 'deck:none' ? null : deckById.get(group.key.slice('deck:'.length)) ?? null };
  if (lanes === 'manual' && deckId) return { kind: 'zone', deckId, zoneId: group.key === 'all' ? null : group.key.slice('zone:'.length) };
  return null;
}

// The browser remembers one ordering choice per deck.
const deckOrderingKey = (deckId: string) => 'deckmate-deck-ordering:' + deckId;
function storedDeckOrdering(deckId: string): CardOrderingValue | null {
  try {
    const stored = readStoredValue(localStorage, deckOrderingKey(deckId));
    return stored === null ? null : readOrdering(new URLSearchParams(stored));
  } catch { return null; }
}
function rememberDeckOrdering(deckId: string, ordering: CardOrderingValue | null) {
  try {
    if (ordering) localStorage.setItem(deckOrderingKey(deckId), serializeOrdering(ordering));
    else localStorage.removeItem(deckOrderingKey(deckId));
  } catch { /* The choice still applies for this visit; only the memory is lost (2026-11-04). */ }
}

function useGroupDrop(group: CardGroup, baseline: CardTransferBaseline | null, lane: GroupLane | null, zoneDrag: string | null, catalogCards: CatalogView['cards'], target = 'lane') {
  const { over } = useDndContext();
  let accepts = false;
  let data: Record<string, unknown> = { label: group.title };
  if (baseline && lane) {
    if (lane.kind === 'priority') {
      accepts = baseline.cards.every(card => card.kind === 'task') && baseline.cards.some(card => card.priority !== lane.priority);
      data = { operation: 'card-priority', priority: lane.priority, label: group.title };
    } else if (lane.kind === 'tags') {
      // A tag lane adds its tag; the no-tag lane removes tags.
      accepts = true;
      data = { operation: 'card-tags', tag: lane.tag, label: group.title };
    } else if (lane.kind === 'deck') {
      const issue = cardTransferTargetIssue(baseline, lane.deck, catalogCards);
      accepts = issue === null || issue === 'confirm-promotion';
      data = { operation: 'card-transfer', deckId: lane.deck?.id ?? null, spaceId: lane.deck?.spaceId ?? '', label: group.title };
    } else {
      accepts = baseline.cards.every(card => card.deckId === lane.deckId);
      data = { operation: 'card-zone', deckId: lane.deckId, zoneId: lane.zoneId, beforeCardId: null, label: group.title };
    }
  }
  // While a zone heading is dragged, the same sections are the reorder targets.
  const enabled = accepts || (zoneDrag !== null && lane?.kind === 'zone');
  if (target === 'panel') data = { ...data, surface: 'card-group-panel' };
  const drop = useDroppable({ id: (target === 'lane' ? 'card-group-target:' : 'card-group-panel:') + group.key, disabled: !enabled,
    data: zoneDrag !== null && lane?.kind === 'zone' ? { ...data, zoneId: lane.zoneId } : data });
  const insertion = over?.data.current;
  const isOver = drop.isOver || Boolean(target === 'lane' && lane?.kind === 'zone' && insertion?.operation === 'card-zone'
    && insertion.beforeCardId && insertion.deckId === lane.deckId && insertion.zoneId === lane.zoneId);
  const className = zoneDrag !== null && lane?.kind === 'zone'
    ? (drop.isOver ? ' is-zone-over' : '')
    : accepts ? (isOver ? ' is-drop-target is-drop-over' : ' is-drop-target') : '';
  return { ref: drop.setNodeRef, className, accepts, isOver };
}

function CardGroupDropTarget({ group, baseline, lane, catalogCards }: { group: CardGroup; baseline: CardTransferBaseline; lane: GroupLane; catalogCards: CatalogView['cards'] }) {
  const drop = useGroupDrop(group, baseline, lane, null, catalogCards, 'panel');
  const current = baseline.cards.every(card => group.cards.some(member => member.id === card.cardId));
  return <button type="button" ref={drop.ref} tabIndex={-1} disabled={!drop.accepts} title={group.title}
    className={'card-group-drop-target' + (current ? ' is-current' : '') + (drop.isOver ? ' is-over' : '')}>{group.title}</button>;
}

function CardGroupDropPanel({ groups, baseline, laneOf, catalogCards }: { groups: CardGroup[]; baseline: CardTransferBaseline; laneOf: (group: CardGroup) => GroupLane | null; catalogCards: CatalogView['cards'] }) {
  const text = useCardDragText(cardDragText);
  const blocker = useDroppable({ id: 'card-group-panel-background', data: { operation: 'card-drop-blocker', surface: 'card-group-panel' } });
  const panel = useRef<HTMLElement>(null);
  const [bounds, setBounds] = useState({ top: 0, bottom: 0 });
  useLayoutEffect(() => {
    const workbench = panel.current?.closest('.catalog-workbench');
    if (!workbench) return;
    const dock = document.querySelector<HTMLElement>('.card-transfer-targets');
    // 2026-11-08: the dock wraps by viewport/language; its layout height excludes the entrance animation's translate.
    const measure = () => {
      const top = Math.max(document.querySelector('.global-topbar')?.getBoundingClientRect().bottom ?? 0, workbench.getBoundingClientRect().top);
      const bottom = dock ? Math.ceil(dock.getBoundingClientRect().height + parseFloat(getComputedStyle(dock).bottom) + 8) : 0;
      setBounds(current => current.top === top && current.bottom === bottom ? current : { top, bottom });
    };
    const observer = new ResizeObserver(measure);
    if (dock) observer.observe(dock);
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); };
  }, []);
  const targets = groups.flatMap(group => { const lane = laneOf(group); return lane ? [{ group, lane }] : []; });
  if (!targets.length) return null;
  return <aside ref={node => { panel.current = node; blocker.setNodeRef(node); }} className="card-group-drop-panel" style={bounds} aria-label={text.groups}>{targets.map(({ group, lane }) =>
    <CardGroupDropTarget key={group.key} group={group} baseline={baseline} lane={lane} catalogCards={catalogCards} />)}</aside>;
}

/** In Manual order, a tile is an insertion point: dropped cards land before it. */
function ManualCardDrop({ cardId, enabled, deckId, zoneId, children }: { cardId: string; enabled: boolean; deckId: string; zoneId: string | null; children: ReactNode }) {
  const drop = useDroppable({ id: 'card-order-target:' + cardId, disabled: !enabled,
    data: { operation: 'card-zone', deckId, zoneId, beforeCardId: cardId, label: cardId } });
  const slot = useRef<HTMLDivElement | null>(null);
  // The marked row opens a gap where the cards will land: tiles before it step left, this one and the rest step right.
  // Only the row moves; the droppable slots stay put, so the target under the pointer does not shift with them (2026-11-05).
  useLayoutEffect(() => {
    const target = slot.current;
    const grid = target?.closest('.deck-grid');
    if (!drop.isOver || !target || !grid) return;
    // Slots are grid children, or sit one per cell in a virtualized grid: look up from the grid, not the parent.
    const top = target.getBoundingClientRect().top;
    const row = [...grid.querySelectorAll<HTMLElement>(':scope > .deck-card-order-slot, :scope > [data-virtual-card-cell] > .deck-card-order-slot')]
      .filter(element => Math.abs(element.getBoundingClientRect().top - top) < 1);
    const index = row.indexOf(target);
    row.forEach((element, position) => { element.dataset.orderShift = position < index ? 'before' : 'after'; });
    return () => { for (const element of row) delete element.dataset.orderShift; };
  }, [drop.isOver]);
  return <div ref={node => { slot.current = node; drop.setNodeRef(node); }} className={drop.isOver ? 'deck-card-order-slot is-card-order-target' : 'deck-card-order-slot'}>{children}</div>;
}

function CatalogTableGroup({ group, baseline, lane, zoneDrag, children, pointerDrag, catalogCards }: { group: CardGroup; baseline: CardTransferBaseline | null; lane: GroupLane | null; zoneDrag: string | null; children: ReactNode; pointerDrag?: boolean; catalogCards: CatalogView['cards'] }) {
  const drop = useGroupDrop(group, baseline, lane, zoneDrag, catalogCards);
  return <tbody ref={drop.ref} className={drop.className.trim() || undefined}>{children}
    {pointerDrag && drop.accepts && <tr className="card-table-drop-layer"><td colSpan={6}><CardGroupDropSurface title={group.title} groupKey={group.key} /></td></tr>}
  </tbody>;
}

function CatalogCardGroupSection({ group, baseline, lane, zoneDrag, children, pointerDrag, catalogCards }: { group: CardGroup; baseline: CardTransferBaseline | null; lane: GroupLane | null; zoneDrag: string | null; children: ReactNode; pointerDrag?: boolean; catalogCards: CatalogView['cards'] }) {
  const drop = useGroupDrop(group, baseline, lane, zoneDrag, catalogCards);
  return <section ref={drop.ref} className={'catalog-card-group' + (drop.className ? ' ' + drop.className : '')} aria-label={group.title}>{children}
    {pointerDrag && drop.accepts && <CardGroupDropSurface title={group.title} groupKey={group.key} />}</section>;
}

/** One deck in the drag dock: the deck's own cover in miniature, so the destination is recognized at a glance. */
function CardTransferTarget({ baseline, deck, label, source, catalogCards }: { baseline: CardTransferBaseline; deck: CatalogDeck | null; label: string; source: WorkspaceSnapshot['source']; catalogCards: CatalogView['cards'] }) {
  const t = useText(text);
  const dragText = useCardDragText(cardDragText);
  const issue = cardTransferTargetIssue(baseline, deck, catalogCards);
  const blocked = issue === 'same-deck' || issue === 'incompatible';
  const { setNodeRef, isOver } = useDroppable({ id: deck ? 'card-deck-target:deck:' + deck.id : 'card-deck-target:none', disabled: blocked,
    data: { kind: 'deck', operation: 'card-transfer', deckId: deck?.id ?? null, spaceId: deck?.spaceId ?? '', label } });
  let hint = label;
  if (issue === 'same-deck') hint = t.alreadyHere;
  else if (issue === 'incompatible') hint = t.incompatibleDeck;
  else if (issue === 'confirm-promotion') hint = dragText.promoteHeroTitle;
  const imageUrl = deck?.style === 'artwork' && deck.cover ? `/api/file?source=${source}&path=${encodeURIComponent(deck.cover)}` : null;
  return <button ref={setNodeRef} type="button" className={'card-transfer-target' + (deck ? '' : ' is-none') + (isOver ? ' is-over' : '') + (issue === 'same-deck' ? ' is-here' : '')}
    disabled={blocked} tabIndex={-1} title={hint} aria-label={label}>
    <span className="card-transfer-thumb" style={deck ? coverStyle(deck) : undefined} aria-hidden="true">
      {imageUrl ? <img src={imageUrl} alt="" style={{ objectPosition: `center ${deck?.coverPosition ?? 50}%` }} />
        : deck ? <DeckIcon name={deck.icon} size={22} /> : <Box size={20} />}
      {issue === 'same-deck' && <span className="card-transfer-here">{t.transferHere}</span>}
    </span>
    <span className="card-transfer-name">{label}</span>
  </button>;
}

/** Zone headings reorder zones through the deck's existing drag-and-drop flow. */
function ZoneDragHandle({ zoneId, title, disabled }: { zoneId: string; title: string; disabled: boolean }) {
  const t = useText(text);
  const drag = useDraggable({ id: 'zone-drag:' + zoneId, disabled, data: { kind: 'zone-drag', zoneId, label: title } });
  return <button type="button" className="ui-button button-ghost button-size-icon catalog-zone-handle" disabled={disabled}
    ref={node => { drag.setNodeRef(node); drag.setActivatorNodeRef(node); }} {...(disabled ? {} : { ...drag.attributes, ...drag.listeners, role: undefined })}
    aria-label={t.reorderZone(title)} title={t.reorderZoneHint(title)}><GripVertical size={14} /></button>;
}

/** Add Zone appears below the last zone, with inline name entry. */
function AddZoneControl({ disabled, onAdd }: { disabled: boolean; onAdd: (title: string) => void }) {
  const t = useText(text);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const drop = useDroppable({ id: 'zone-end-target', disabled, data: { operation: 'zone-end' } });
  function submit() {
    const name = title.trim();
    if (!name) { setOpen(false); return; }
    onAdd(name);
    setTitle('');
    setOpen(false);
  }
  if (!open) return <button ref={drop.setNodeRef} type="button" className="catalog-add-zone" data-layout-follow="add-zone" disabled={disabled} onClick={() => setOpen(true)}>
    <Plus size={14} aria-hidden="true" />{t.labelAddZone}
  </button>;
  return <div className="catalog-add-zone-form" data-layout-follow="add-zone">
    <input value={title} autoFocus maxLength={120} disabled={disabled} placeholder={t.zoneName} aria-label={t.newZoneName}
      onChange={event => setTitle(event.target.value)}
      onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); submit(); } if (event.key === 'Escape') { event.preventDefault(); setOpen(false); setTitle(''); } }} />
    <Button type="button" size="sm" disabled={disabled || !title.trim()} onClick={submit}>{t.add}</Button>
    <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => { setOpen(false); setTitle(''); }}>{t.cancel}</Button>
  </div>;
}

/**
 * The deck dock (2026-11-06): it rises from the bottom while a card is dragged, lists every deck as a small cover grouped
 * by space, and names the deck under the pointer in its heading, so the destination is never a guess.
 */
function CardTransferTargets({ baseline, catalog, source }: { baseline: CardTransferBaseline; catalog: CatalogView; source: WorkspaceSnapshot['source'] }) {
  const t = useText(text);
  const { over } = useDndContext();
  const target = over?.data.current?.operation === 'card-transfer' ? over.data.current as { deckId: string | null; spaceId: string; label: string } : null;
  const targetSpace = target?.deckId ? catalog.spaces.find(space => space.id === target.spaceId)?.title : undefined;
  // Over a deck the dragged tile shrinks toward the pointer, so the lifted cover underneath stays visible.
  const overDeck = Boolean(target);
  useEffect(() => {
    document.documentElement.classList.toggle('is-transfer-target-over', overDeck);
    return () => document.documentElement.classList.remove('is-transfer-target-over');
  }, [overDeck]);
  return <aside className={'card-transfer-targets' + (target ? ' has-target' : '')} aria-label={t.targetDeck}>
    <header className="card-transfer-targets-heading">
      <p className="card-transfer-destination" aria-live="polite">
        <span>{t.transferCount(baseline.cards.length)}</span>
        {target ? <><strong key={target.label}>{target.label}</strong>{targetSpace && <span className="card-transfer-destination-space">{targetSpace}</span>}</>
          : <em>{t.transferChoose}</em>}
      </p>
      <span className="card-transfer-help">{t.transferHelp}</span>
    </header>
    <div className="card-transfer-target-groups">
      <div className="card-transfer-target-group"><span className="card-transfer-space">{t.unassigned}</span>
        <div className="card-transfer-target-row"><CardTransferTarget baseline={baseline} deck={null} label={t.unassigned} source={source} catalogCards={catalog.cards} /></div></div>
      {catalog.spaces.map(space => {
        const decks = catalog.decks.filter(deck => deck.spaceId === space.id);
        if (!decks.length) return null;
        return <div className="card-transfer-target-group" key={space.id} role="group" aria-label={space.title}>
          <span className="card-transfer-space">{space.title}</span>
          <div className="card-transfer-target-row">{decks.map(deck => <CardTransferTarget key={deck.id} baseline={baseline} deck={deck} label={deck.title} source={source} catalogCards={catalog.cards} />)}</div>
        </div>;
      })}
    </div>
  </aside>;
}

function DeckNeighborCover({ deck, counts, source, current, disabled, baseline, catalogCards, onOpen }: {
  deck: CatalogDeck; counts: DeckCardCounts; source: WorkspaceSnapshot['source']; current: boolean; disabled: boolean;
  baseline: CardTransferBaseline | null; catalogCards: CatalogView['cards']; onOpen: () => void;
}) {
  const issue = baseline ? cardTransferTargetIssue(baseline, deck, catalogCards) : null;
  const blocked = issue === 'same-deck' || issue === 'incompatible';
  const { setNodeRef, isOver } = useDroppable({ id: 'card-neighbor-target:' + deck.id,
    disabled: !baseline || disabled || blocked, data: { kind: 'deck', operation: 'card-transfer', deckId: deck.id, spaceId: deck.spaceId, label: deck.title } });
  // Reuse the home-screen deck tile, clipped to its lower half above the open deck.
  return <button ref={setNodeRef} className={'catalog-deck-cover catalog-cover-' + (deck.style ?? 'symbol') + (baseline && !blocked ? ' is-transfer-compatible' : '') + (isOver ? ' is-transfer-over' : '')}
    style={coverStyle(deck)} type="button" data-deck-cover={deck.id} title={`${deck.title} · ${deckCountLabel(counts)}`}
    aria-label={`${deck.title}, ${deckCountLabel(counts)}`} aria-current={current ? 'page' : undefined}
    disabled={disabled || Boolean(baseline && blocked)} onClick={onOpen}>
    <span className="deck-neighbor-window"><span className={'catalog-deck-cover catalog-cover-' + (deck.style ?? 'symbol')}>
      <CoverFace deck={deck} counts={counts} source={source} />
    </span></span>
  </button>;
}

// Table View uses lanes of 34 px card rows without a visible column header.
// Selecting everything shown stays on Ctrl+A and the selection toolbar; the column names remain for screen readers.
function CatalogTable({ groups, transfer, lookups, members, tagDefinitions, catalog, currentMemberId, openedId, selectedIds, disabled, onOpen, onFamilyOpen, onToggle, onToggleGroup, onFilterGroup, onCreateGroup, laneOf, zoneOf, zoneDrag, manualDrop, pointerDrag }: {
  groups: CardGroup[]; transfer: CardTransferBaseline | null; lookups: CatalogLookups; members: CatalogMember[]; tagDefinitions?: CatalogView['projectTags']; catalog: CatalogView; currentMemberId?: string; openedId?: string; selectedIds: Set<string>; disabled: boolean;
  onOpen: (card: CatalogCard, button?: HTMLButtonElement, shift?: boolean) => void; onFamilyOpen: (card: CatalogCard, button?: HTMLButtonElement) => void;
  onToggle: (id: string, shift: boolean) => void;
  onToggleGroup: (ids: readonly string[]) => void;
  onFilterGroup: (group: CardGroup) => void;
  onCreateGroup?: (group: CardGroup) => void;
  laneOf: (group: CardGroup) => GroupLane | null;
  zoneOf: (group: CardGroup) => ComponentProps<typeof CardGroupHeading>['zone'];
  zoneDrag: string | null;
  manualDrop: boolean;
  pointerDrag?: boolean;
}) {
  const t = useText(text);
  return <div className="deck-table-scroll"><table className="deck-table">
    <thead className="visually-hidden"><tr><th scope="col">{t.selection}</th><th scope="col">{t.labelPriority}</th><th scope="col">{t.labelEffort}</th><th scope="col">{t.card}</th><th scope="col">{t.labelTags}</th><th scope="col">{t.properties}</th></tr></thead>
    {groups.map(group => {
      const lane = laneOf(group);
      const manualTarget = lane?.kind === 'zone' ? { deckId: lane.deckId, zoneId: lane.zoneId } : undefined;
      return <CatalogTableGroup key={group.key} group={group} baseline={transfer} lane={lane} zoneDrag={zoneDrag} pointerDrag={pointerDrag} catalogCards={catalog.cards}>
        {group.key !== 'all' && <tr className="catalog-table-group"><th colSpan={6} scope="colgroup"><CardGroupHeading group={group} tagDefinitions={catalog.projectTags} lookups={lookups} selectedIds={selectedIds} disabled={disabled} onToggleGroup={onToggleGroup} onFilter={onFilterGroup} onCreate={onCreateGroup ? () => onCreateGroup(group) : undefined} zone={zoneOf(group)} /></th></tr>}
        {group.cards.map(card => <CatalogTableRow key={card.id} card={card} lookups={lookups} members={members} tagDefinitions={tagDefinitions} catalog={catalog} currentMemberId={currentMemberId} openedId={openedId} selectedIds={selectedIds} disabled={disabled} onOpen={onOpen} onFamilyOpen={onFamilyOpen} onToggle={onToggle} manualTarget={manualTarget} manualDrop={manualDrop} />)}
      </CatalogTableGroup>;
    })}
  </table></div>;
}

/**
 * Card row: status strip · Priority 32 · Effort 50 · title 14/400 · tags 162 · status and owner on the right.
 * The title button stretches over the row, so a click anywhere opens the card and a press anywhere drags it, as on the tile.
 */
function CatalogTableRow({ card, lookups, members, tagDefinitions, catalog, currentMemberId, openedId, selectedIds, disabled, onOpen, onFamilyOpen, onToggle, manualTarget, manualDrop }: {
  card: CatalogCard; lookups: CatalogLookups; members: CatalogMember[]; tagDefinitions?: CatalogView['projectTags']; catalog: CatalogView; currentMemberId?: string; openedId?: string; selectedIds: Set<string>; disabled: boolean;
  onOpen: (card: CatalogCard, button?: HTMLButtonElement, shift?: boolean) => void; onFamilyOpen: (card: CatalogCard, button?: HTMLButtonElement) => void;
  onToggle: (id: string, shift: boolean) => void;
  manualTarget?: { deckId: string; zoneId: string | null };
  manualDrop: boolean;
}) {
  const t = useText(text);
  const lang = useLang();
  const transfer = useCardTransferDrag(card);
  const orderDrop = useDroppable({ id: 'card-order-target:' + card.id, disabled: !manualDrop || !manualTarget,
    data: { operation: 'card-zone', deckId: manualTarget?.deckId ?? '', zoneId: manualTarget?.zoneId ?? null, beforeCardId: card.id, label: card.title } });
  const parent = card.parentId ? lookups.cardById.get(card.parentId) : undefined;
  const checklist = lookups.checklistByCard.get(card.id);
  const heroChildren = card.kind === 'hero' ? familyChildren(lookups, card.id).filter(child => child.kind === 'task') : emptyCards;
  // A Hero's effort includes its own and its Sub Cards' effort, matching the properties panel.
  const effort = card.kind === 'hero' ? cardHeroEffort(card, { cards: heroChildren }) : card.effort ?? null;
  const StateIcon = card.kind === 'task' ? taskStateIcons[card.state ?? ''] ?? Hourglass : null;
  const stateName = stateLabel(card.state ?? 'not-started', lang);
  const KindIcon = card.kind === 'doc' ? cardIcons.doc : null;
  const checked = selectedIds.has(card.id);
  let actionLabel = t.open;
  if (selectedIds.size > 0) actionLabel = checked ? t.deselect : t.select;
  // Keep the slice number in the hover title so the row remains readable.
  const titleButton = <button type="button" disabled={disabled} className="catalog-table-title" title={card.version ? card.version + ' · ' + card.title : card.title} aria-label={`${actionLabel}: ${card.title}`} aria-pressed={selectedIds.size > 0 ? checked : openedId === card.id} onClick={event => onOpen(card, event.currentTarget, event.shiftKey)}>{KindIcon && <KindIcon size={14} aria-hidden="true" />}<span><TagTitlePrefix tags={card.tags} definitions={tagDefinitions} />{card.title}</span></button>;
  return <tr ref={node => { transfer.setNodeRef(node); orderDrop.setNodeRef(node); }} onPointerDown={transfer.onPointerDown} data-card-transfer-enabled={transfer.enabled || undefined} data-card-transfer-source={transfer.isDragging || undefined} data-card-id={card.id}
    data-kind={card.kind} data-state={card.kind === 'task' ? statusClass(card.state ?? '') : undefined}
    className={'deck-table-row' + (checked ? ' is-multi-selected' : '') + (openedId === card.id ? ' is-opened' : '') + (orderDrop.isOver ? ' is-card-order-target' : '')}>
    <td className="deck-table-select"><input type="checkbox" checked={checked} disabled={disabled} aria-label={t.selectCard(card.title)} onChange={event => onToggle(card.id, Boolean((event.nativeEvent as MouseEvent).shiftKey))} /></td>
    <td className={'deck-table-priority' + (card.priority ? '' : ' is-empty')}><span data-shortcut-property="priority"><JourneyPriorityIcon priority={card.priority} size={16} /></span></td>
    <td className={'deck-table-effort' + (effort == null ? ' is-empty' : '')}><span data-shortcut-property="effort"><Gauge size={16} aria-hidden="true" />{effort == null ? <span className="visually-hidden">{t.noEffort}</span> : <span>{effort.toLocaleString(locale(lang), { maximumFractionDigits: 2 })}</span>}</span></td>
    <td className="deck-table-card">{parent && <CardFamilyPopover projectTags={tagDefinitions} members={members} hero={parent} children={familyChildren(lookups, parent.id)} disabled={disabled} onOpen={onFamilyOpen} />}
      {heroChildren.length > 0 ? <span className="deck-table-hero">{titleButton}<SubCardProgress cards={heroChildren} cardsById={lookups.cardById} /></span> : titleButton}
      </td>
    <td className="deck-table-tags"><CardTags tags={card.tags} definitions={tagDefinitions} compact maxVisible={2} /></td>
    <td className="deck-table-details"><CardIndicators card={card} lookups={lookups} members={members} catalog={catalog} currentMemberId={currentMemberId} variant="table" />
      <OpenQuestionsBadge card={card} />
      {checklist && checklist.total > 0 && <span className="deck-table-checklist" title={t.checklistDone}><CircleCheck size={12} aria-hidden="true" />{number(checklist.done)}/{number(checklist.total)}</span>}
      {StateIcon && <span className="deck-table-state" title={stateName}><StateIcon size={12} aria-hidden="true" /><span className="visually-hidden">{stateName}</span></span>}
      {card.owner && <span className="deck-table-owner" title={t.owner(card.owner)}><CardOwnerAvatar owner={card.owner} members={members} /><span className="visually-hidden">{t.owner(card.owner)}</span></span>}
      {transfer.handle}</td>
  </tr>;
}

interface HoverCardTarget { card: CatalogCard; anchor: HTMLElement; manifestHash: string; optionsHash: string }
type HoverCardPanel = HoverCardTarget & (
  | { kind: 'quick'; tab: CardQuickSettingsTab }
  | { kind: 'tags' | 'hero' }
  | { kind: 'removal'; action: 'archive' | 'unarchive' | 'delete' }
  | { kind: 'state'; state: 'not-started' | 'started' | 'done'; conflicts: DependencyConflict[]; confirmed: boolean }
);

/** The shortcut registry owns keys and event arbitration; this adapter connects commands to catalog actions. */
interface DeckHoveredCardActionsHandle {
  openQuickSettings: (cardId: string, tab: CardQuickSettingsTab, anchor: HTMLElement) => boolean;
}

function DeckHoveredCardActions({ ref, root, catalog, lookups, snapshot, writable, locked, onEdit, onSelect }: {
  ref: RefObject<DeckHoveredCardActionsHandle | null>;
  root: RefObject<HTMLDivElement | null>; catalog: CatalogView; lookups: CatalogLookups; snapshot: WorkspaceSnapshot;
  writable: boolean; locked: boolean; onEdit: CatalogEditor; onSelect: (id: string) => void;
}) {
  const t = useText(text);
  const [panel, setPanel] = useState<HoverCardPanel | null>(null);
  const [tagQuery, setTagQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<'changeUnconfirmed' | 'saveFailed' | 'lessonFailed' | 'coverSaveFailed' | 'inboxAssigned' | 'inboxRemoved' | ''>('');
  const inFlight = useRef(false);
  const busy = locked || saving;
  const stale = Boolean(panel && (lookups.cardById.get(panel.card.id)?.sourceHash !== panel.card.sourceHash
    || panel.manifestHash !== catalog.manifestHash || panel.optionsHash !== (catalog.optionsHash ?? '')));
  const unavailable = Boolean(panel && (!writable || !lookups.cardById.has(panel.card.id) || lookups.cardById.get(panel.card.id)?.deleted));
  function close() { if (!busy) { setPanel(null); setNotice(''); } }
  function bulk(target: HoverCardTarget, change: BulkChange): CatalogAction {
    return { action: 'bulk-edit-cards', manifestHash: target.manifestHash, optionsHash: target.optionsHash,
      cards: [{ cardId: target.card.id, sourceHash: target.card.sourceHash }], change };
  }
  async function save(action: CatalogAction) {
    if (!writable || locked || inFlight.current) return false;
    inFlight.current = true; setSaving(true); setNotice('');
    try {
      const saved = await onEdit(action);
      if (saved) setPanel(null);
      else setNotice('changeUnconfirmed');
      return saved;
    } catch { setNotice('saveFailed'); return false; }
    finally { inFlight.current = false; setSaving(false); }
  }
  async function changeState(target: HoverCardTarget, state: 'not-started' | 'started' | 'done', confirmed = false, answer?: JourneyReturnAnswer) {
    if (busy || inFlight.current || !writable || target.card.kind !== 'task' || target.card.archived || target.card.deleted) return;
    const conflicts = confirmed ? [] : dependencyConflicts([target.card], lookups.cardById, state);
    if (conflicts.length || (!answer && isJourneyReturn(target.card, state))) {
      setPanel({ ...target, kind: 'state', state, conflicts, confirmed: !conflicts.length });
      return;
    }
    const saved = await save({ action: 'set-card-state', cardId: target.card.id, sourceHash: target.card.sourceHash,
      manifestHash: target.manifestHash, state, ...(answer?.reason ? { returnReason: answer.reason } : {}) });
    const lesson = saved && answer ? journeyLessonAction(target.card, catalog, answer) : null;
    if (lesson && !await save(lesson)) setNotice('lessonFailed');
  }
  function openQuickSettings(cardId: string, tab: CardQuickSettingsTab, anchor: HTMLElement): boolean {
    if (busy || inFlight.current || panel || !writable) return false;
    const card = lookups.cardById.get(cardId);
    if (!card || card.deleted) return false;
    setNotice('');
    setPanel({ card, anchor, manifestHash: catalog.manifestHash, optionsHash: catalog.optionsHash ?? '', kind: 'quick', tab });
    return true;
  }
  // 2026-11-05: tile clicks and hover keys share the same guards, revision capture and settings panel.
  useImperativeHandle(ref, () => ({ openQuickSettings }));
  const handleHover = useEffectEvent((command: HoveredCardShortcut): boolean => {
    if (command.kind === 'quick-settings') return openQuickSettings(command.cardId, command.tab, command.anchor);
    // 2026-11-05: Space on a focused indicator keeps its native click even while the pointer hovers this tile.
    if (command.kind === 'action' && command.action === 'work' && document.activeElement?.matches('.card-indicator-button')) return false;
    if (busy || inFlight.current || panel) return false;
    const card = lookups.cardById.get(command.cardId);
    if (!card) return false;
    if (command.kind === 'action' && command.action === 'select') { onSelect(card.id); return true; }
    if (!writable || card.deleted) return false;
    const target: HoverCardTarget = { card, anchor: command.anchor, manifestHash: catalog.manifestHash, optionsHash: catalog.optionsHash ?? '' };
    setNotice('');
    if (command.kind === 'effort' || command.kind === 'priority') {
      if (card.kind === 'doc' || (command.kind === 'priority' && card.kind !== 'task')) return false;
      void save(bulk(target, { kind: 'properties', [command.kind]: command.value }));
      return true;
    }
    const member = currentMember(catalog.members ?? []);
    switch (command.action) {
      case 'tags': setTagQuery(''); setPanel({ ...target, kind: 'tags' }); return true;
      case 'hero':
        // Inactive children count too: the server rejects a card with archived Sub Cards as a Sub Card.
        if (card.archived || card.kind === 'hero' || card.journey || lookups.childrenByParent.get(card.id)?.length) return false;
        setPanel({ ...target, kind: 'hero' }); return true;
      case 'archive': setPanel({ ...target, kind: 'removal', action: card.archived ? 'unarchive' : 'archive' }); return true;
      case 'delete': setPanel({ ...target, kind: 'removal', action: 'delete' }); return true;
      case 'bookmark': void save(bulk(target, { kind: 'options', patch: { bookmarked: !card.bookmarked } })); return true;
      case 'hand':
        if (!member || card.archived) return false;
        void save(bulk(target, { kind: 'hand', memberId: member.id, mode: card.handMemberIds?.includes(member.id) ? 'remove' : 'add' })); return true;
      case 'work':
        if (!member || card.archived) return false;
        if (card.owner !== member.label && !member.aliases.includes(card.owner ?? '')) {
          void save(bulk(target, { kind: 'properties', owner: member.label })); return true;
        }
        if (card.kind !== 'task') return false;
        void changeState(target, card.state === 'started' ? 'not-started' : 'started'); return true;
      case 'done':
        if (card.kind !== 'task' || card.archived) return false;
        void changeState(target, card.state === 'done' ? 'not-started' : 'done'); return true;
    }
    return false;
  });
  useEffect(() => {
    if (!root.current) return;
    return listenForHoveredCardShortcuts({ root: root.current, writable, onShortcut: handleHover });
  }, [root, writable]);

  const removalLabel = panel?.kind === 'removal' ? { archive: t.labelArchiveCard, unarchive: t.labelUnarchiveCard, delete: t.labelMovetoTrash }[panel.action] : '';
  return <>
    {notice && !panel && <p role="alert">{t[notice]}</p>}
    {panel?.kind === 'quick' && <CardQuickSettings card={panel.card} catalog={catalog} source={snapshot.source} projectName={snapshot.projectName}
      tab={panel.tab} onTabChange={tab => setPanel({ ...panel, tab })} anchor={panel.anchor} disabled={locked || unavailable}
      onEdit={onEdit} onClose={() => { setPanel(null); setSaving(false); }} />}
    {panel?.kind === 'tags' && <QuickSettingsPopover anchor={panel.anchor} busy={busy} onClose={close}>
      <Dialog.Title className="deck-choice-title">{t.cardTags}</Dialog.Title>
      <TagSelectionList definitions={catalog.projectTags} tags={collectProjectTags(catalog.cards, catalog.projectTags)} selected={panel.card.tags ?? []} query={tagQuery} onQueryChange={setTagQuery}
        disabled={busy || stale || unavailable} onToggle={name => void save(bulk(panel, { kind: 'tags', tags: [name], mode: panel.card.tags?.includes(name) ? 'remove' : 'add' }))} />
      {stale && <p role="alert">{t.staleCard}</p>}
      {notice && <p role="alert">{t[notice]}</p>}
    </QuickSettingsPopover>}
    {panel?.kind === 'hero' && <CardParentPicker card={panel.card} catalog={catalog} pending={busy} onClose={close}
      onChoose={parent => save({ action: 'set-card-parent', cardId: panel.card.id, sourceHash: panel.card.sourceHash,
        manifestHash: panel.manifestHash, expectedParentId: panel.card.parentId, parentId: parent?.id ?? null, parentSourceHash: parent?.sourceHash ?? null })}
      onPromote={request => save({ action: 'bulk-edit-cards', manifestHash: request.manifestHash, optionsHash: request.optionsHash,
        cards: [request.child], change: { kind: 'promote-parent', ...request.candidate, deckId: request.deckId } })} />}
    {(panel?.kind === 'removal' || panel?.kind === 'state') && <Dialog.Root open onOpenChange={open => { if (!open) close(); }}><Dialog.Portal>
      <Dialog.Overlay className="card-journey-overlay" />
      <Dialog.Content className="card-removal-dialog" aria-busy={busy} onCloseAutoFocus={event => { event.preventDefault(); if (panel.anchor.isConnected) panel.anchor.focus({ preventScroll: true }); }}
        onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onPointerDownOutside={event => { if (busy) event.preventDefault(); }}>
        <Dialog.Title>{panel.kind === 'removal' ? removalLabel : t.changeState}</Dialog.Title>
        <Dialog.Description>{panel.card.title}</Dialog.Description>
        {stale && <p role="alert">{t.staleCard}</p>}
        {notice && <p role="alert">{t[notice]}</p>}
        {panel.kind === 'removal' && <>
          <p>{t.keepFiles}{panel.action === 'delete' && (lookups.childrenByParent.get(panel.card.id) ?? []).some(card => !card.deleted) && t.trashSubCards}</p>
          <footer><Button type="button" variant="ghost" disabled={busy} onClick={close}>{t.cancel}</Button>
            <Button type="button" disabled={busy || stale || unavailable} onClick={() => void save(bulk(panel, { kind: 'options', patch: panel.action === 'delete' ? { deleted: true } : { archived: panel.action === 'archive' } }))}>{removalLabel}</Button></footer>
        </>}
        {panel.kind === 'state' && panel.confirmed && <JourneyReturnPrompt card={panel.card} catalog={catalog} busy={busy || stale || unavailable}
          onAnswer={answer => void changeState(panel, panel.state, true, answer)} />}
        {panel.kind === 'state' && !panel.confirmed && <DependencyStateWarning conflicts={panel.conflicts} busy={busy || stale || unavailable}
          onConfirm={() => void changeState(panel, panel.state, true)} onCancel={close} />}
      </Dialog.Content>
    </Dialog.Portal></Dialog.Root>}
  </>;
}

interface HeroReturn {
  heroId: string;
  subCardId: string;
  origin: 'journey' | 'family';
  scrollTop: number;
  familyVisible: boolean;
  context: string;
}

export function Deck({ snapshot, refreshKey, onEditing, onImportCsv, onStartFromTemplate }: DeckProps) {
  const t = useText(text);
  const lang = useLang();
  const deckKinds = useText(deckKindText);
  const { catalog, loading, pending, error, warning, dismissWarning, edit, refresh } = useCatalog(snapshot, refreshKey);
  const [initialQuery] = useState(() => readCatalogLocation(snapshot.source));
  const [navigationSource, setNavigationSource] = useState(snapshot.source);
  const [scope, setScope] = useState<CatalogScope>(() => initialScope(initialQuery));
  const [collapsedSpaces, setCollapsedSpaces] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState(initialQuery.get('q') ?? '');
  const [includeShelved, setIncludeShelved] = useState(initialQuery.get('archive') === '1');
  const [sourceWarningsOpen, setSourceWarningsOpen] = useState(false);
  const [laneSearch, setLaneSearch] = useState(() => readLaneSearch(initialQuery));
  const resultsRoot = useRef<HTMLDivElement | null>(null);
  const hoveredCardActions = useRef<DeckHoveredCardActionsHandle | null>(null);
  const openTileQuickSettings = useCallback((cardId: string, tab: CardQuickSettingsTab, anchor: HTMLElement) => {
    hoveredCardActions.current?.openQuickSettings(cardId, tab, anchor);
  }, []);
  const [deckSearch, setDeckSearch] = useState(initialQuery.get('deckQ') ?? '');
  const deckSearchText = useDeferredValue(deckSearch.trim().toLocaleLowerCase('ru'));
  const searchText = useDeferredValue(search.trim().toLocaleLowerCase('ru'));
  const [trackId, setTrackId] = useState(initialQuery.get('track') ?? '');
  // null uses the deck's Default Order, falling back to the global default; otherwise use the viewer's own order.
  const [orderingChoice, setOrderingChoice] = useState<CardOrderingValue | null>(() => {
    if (initialQuery.has('order')) return readOrdering(initialQuery);
    const deckId = initialQuery.get('deck');
    return deckId ? storedDeckOrdering(deckId) : null;
  });
  const [orderingOpen, setOrderingOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [tagPick, setTagPick] = useState<TagPick>(emptyTagPick);
  const [activityOpen, setActivityOpen] = useState(false);
  const [creation, setCreation] = useState<Creation | null>(null);
  const [creationDirty, setCreationDirty] = useState(false);
  const [openedCard, setOpenedCard] = useState<CatalogCard | null>(null);
  const [openedCardId, setOpenedCardId] = useState(initialQuery.get('card') ?? '');
  const [heroReturn, setHeroReturn] = useState<HeroReturn | null>(null);
  const restoreHeroView = useRef<HeroReturn | null>(null);
  const [membershipDirty, setMembershipDirty] = useState(false);
  const [familyDirty, setFamilyDirty] = useState(false);
  const [familyDraftParentId, setFamilyDraftParentId] = useState<string | null>(null);
  const familyCreationSequence = useRef(0);
  const [familyCreationRequest, setFamilyCreationRequest] = useState<{ parentId: string; sequence: number } | null>(null);
  const [composer, setComposer] = useState<{ deckId: string; parentId: string | null; priority?: CardPriority | null; zoneId?: string } | null>(null);
  const [familyVisible, setFamilyVisible] = useState(false);
  const [parentPicker, setParentPicker] = useState<{ card: CatalogCard; manifestHash: string } | null>(null);
  const [mineOnly, setMineOnly] = useState(() => initialQuery.get('mine') === '1');
  // A tag link on an open card shows every card with that tag.
  const [tagFilter, setTagFilter] = useState(initialQuery.get('tag') ?? '');
  const [attachmentHeroId, setAttachmentHeroId] = useState<string | null>(null);
  const [cardView, setCardView] = useState<'cards' | 'table' | null>(() => {
    const saved = initialQuery.get('layout');
    return saved === 'cards' || saved === 'table' ? saved : null;
  });
  const [bulkFocusPending, setBulkFocusPending] = useState(false);
  const [cardTransfer, setCardTransfer] = useState<CardTransferBaseline | null>(null);
  const [cardDragPreview, setCardDragPreview] = useState<CardDragPreview | null>(null);
  const [dropDeckPicker, setDropDeckPicker] = useState<CardTransferBaseline | null>(null);
  const [dropHeroPromotion, setDropHeroPromotion] = useState<{ baseline: CardTransferBaseline; deck: CatalogDeck } | null>(null);
  const dragText = useCardDragText(cardDragText);
  const [draggedCardId, setDraggedCardId] = useState<string | null>(null);
  // Track the dragged zone heading and the browser's saved "Hide empty zones" preference.
  const [zoneDrag, setZoneDrag] = useState<string | null>(null);
  // The zone whose delete button turned into its confirmation strip (2026-11-05).
  const [zoneDeletion, setZoneDeletion] = useState<string | null>(null);
  const [hideEmptyZones, setHideEmptyZones] = useState(() => {
    try { return readStoredValue(localStorage, 'deckmate-hide-empty-zones') === 'true'; } catch { return false; }
  });
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deletingDeck, setDeletingDeck] = useState(false);
  const [deleteError, setDeleteError] = useState(false);
  const transferBaseline = useRef<CardTransferBaseline | null>(null);
  const suppressTransferClickUntil = useRef(0);
  const cardKeyboardOptions = useMemo(() => ({ coordinateGetter: coverKeyboardCoordinates }), []);
  const transferSensors = useSensors(useSensor(PointerSensor, cardPointerOptions), useSensor(KeyboardSensor, cardKeyboardOptions));
  const [journeyDeckId, setJourneyDeckId] = useState<string | null>(null);
  const [requestedJourneyId, setRequestedJourneyId] = useState(initialQuery.get('journey'));
  const panels = useCatalogPanels();
  const lastOpenedButton = useRef<HTMLButtonElement | null>(null);
  const creationOpener = useRef<HTMLElement | null>(null);
  const [requestedCardFocus, setRequestedCardFocus] = useState<string | null>(null);
  const searchField = useRef<HTMLInputElement>(null);
  const journeyReturnFocus = useRef<HTMLElement | null>(null);
  const writable = snapshot.writable && snapshot.source === 'sandbox';
  const selectedDeck = scope.kind === 'deck' ? catalog?.decks.find(deck => deck.id === scope.id) : null;
  const selectedTrack = catalog?.tracks.find(track => track.id === trackId);
  const resolvedView = cardView ?? 'cards';
  const cards = catalog?.cards ?? emptyCards;
  const lookups = useMemo(() => buildCatalogLookups(cards, catalog?.subCardOrder), [cards, catalog?.subCardOrder]);
  const tileDataById = useMemo(() => new Map(catalog ? cards.map(card => [card.id, cardTileData(card, lookups, catalog)]) : []), [cards, lookups, catalog]);
  const activeLookups = useMemo(() => buildCatalogLookups(cards.filter(card => !card.archived && !card.deleted), catalog?.subCardOrder), [cards, catalog?.subCardOrder]);
  const deckCounts = useMemo(() => new Map([...activeLookups.cardsByDeck].map(([deckId, deckCards]) => [deckId, countDeckCards(deckCards)])), [activeLookups]);
  const selectedCard = lookups.cardById.get(openedCardId) ?? (openedCard?.id === openedCardId ? openedCard : null);
  const heroReturnContext = JSON.stringify([snapshot.source, scope, trackId, search, tagFilter, mineOnly, laneSearch]);
  const returnHero = heroReturn?.context === heroReturnContext && heroReturn.subCardId === selectedCard?.id
    && selectedCard.parentId === heroReturn.heroId ? activeLookups.cardById.get(heroReturn.heroId) : undefined;
  useEffect(() => { if (heroReturn && !returnHero) setHeroReturn(null); }, [heroReturn, returnHero]);
  // 2026-11-05: empty inline forms and parent pickers allow navigation; drafts and pending writes guard it.
  // Journey and Attach Sub Cards use modal dialogs, which provide their own navigation barrier.
  const draftLocked = creationDirty || Boolean(journeyDeckId) || Boolean(attachmentHeroId) || membershipDirty || familyDirty || Boolean(dropDeckPicker) || Boolean(dropHeroPromotion);
  const navigationLocked = draftLocked || pending;
  const familyId = composer?.parentId ?? (selectedCard?.parentId ?? (selectedCard?.kind === 'hero' ? selectedCard.id : null));
  const familyHero = lookups.cardById.get(familyId ?? '');
  // 2026-11-04: pin the draft family identity while catalog updates refresh its data and source hash.
  const familyDraftParent = lookups.cardById.get(familyDraftParentId ?? '');
  const familyRoot = familyDraftParent ?? familyHero ?? selectedCard;
  const familyCards = familyRoot ? familyChildren(lookups, familyRoot.id) : emptyCards;
  const showFamily = Boolean((selectedCard || familyHero) && (familyVisible || composer?.parentId));
  const hasPreview = Boolean(selectedCard || composer);
  let activeDeckPanel: 'info' | 'ordering' | 'tags' | 'activity' | null = null;
  if (selectedDeck && !panels.summaryCollapsed && !hasPreview) {
    activeDeckPanel = 'info';
    if (orderingOpen) activeDeckPanel = 'ordering';
    else if (tagsOpen) activeDeckPanel = 'tags';
    else if (activityOpen) activeDeckPanel = 'activity';
  }
  const showCards = scope.kind !== 'catalog';
  // My Cards uses the member selected in Your Hand via ?handMember= (Hand.tsx).
  // Without a selection, use the first human in the registry, falling back to its first member.
  const currentMember = useMemo(() => {
    const members = catalog?.members ?? [];
    if (!members.length) return null;
    const requested = new URLSearchParams(location.search).get('handMember');
    const chosen = requested ? members.find(member => member.id === requested) : undefined;
    return chosen ?? members.find(member => member.kind === 'human') ?? members[0];
  }, [catalog?.members]);
  const visibleDecks = useMemo(() => (catalog?.decks ?? []).filter(deck => !deckSearchText || [deck.title, deck.description, deckKinds[deck.kind], catalog?.spaces.find(space => space.id === deck.spaceId)?.title].join(' ').toLocaleLowerCase('ru').includes(deckSearchText)), [catalog, deckSearchText, deckKinds]);
  // 2026-11-05: Archive/Trash is a view preference; the source cards and cover counts stay intact.
  const scopedCards = useMemo(() => cards.filter(card => {
    if (!includeShelved && (card.archived || card.deleted)) return false;
    if (scope.kind === 'deck' && card.deckId !== scope.id) return false;
    if (scope.kind === 'unassigned' && card.deckId !== null) return false;
    if (trackId && !card.trackIds.includes(trackId)) return false;
    return true;
  }), [cards, scope, trackId, includeShelved]);
  const searchedCards = useMemo(() => scopedCards.filter(card => {
    if (mineOnly && card.owner !== currentMember?.label) return false;
    if (tagFilter && !card.tags?.includes(tagFilter)) return false;
    return !searchText || lookups.normalizedSearch.get(card.id)!.includes(searchText);
  }), [scopedCards, mineOnly, currentMember, tagFilter, searchText, lookups]);
  // Ordering uses the viewer's choice, then the deck's Default Order, then Priority. Manual exists only inside a deck.
  const deckDefaultOrdering = useMemo(() => selectedDeck?.defaultOrder ? readOrdering(new URLSearchParams(selectedDeck.defaultOrder)) : defaultCardOrdering,
    [selectedDeck?.defaultOrder]);
  const ordering = orderingChoice && (orderingChoice.order !== 'manual' || scope.kind === 'deck') ? orderingChoice : deckDefaultOrdering;
  const orderDiffersFromDefault = !sameOrdering(ordering, deckDefaultOrdering);
  // Ordering lookups for the Tags/Deck/Run/Milestone/Manual orders (2026-11-04): names, the deck's zones, the deck scope itself.
  const deckById = useMemo(() => new Map((catalog?.decks ?? []).map(deck => [deck.id, deck])), [catalog?.decks]);
  const projectTagNames = useMemo(() => new Set((catalog?.projectTags ?? []).map(tag => tag.name)), [catalog?.projectTags]);
  const orderingContext = useMemo<OrderingContext>(() => ({ deckById, deckOrder: catalog?.deckOrder, deckId: scope.kind === 'deck' ? scope.id : null,
    runs: catalog?.runs, milestones: catalog?.milestones, projectTagNames }), [deckById, catalog?.deckOrder, catalog?.runs, catalog?.milestones, projectTagNames, scope]);
  const visibleCards = useMemo(() => {
    // 2026-11-05: reuse the grouping rules for search entries, including None and names with spaces.
    const memberships = laneSearch.map(entry => {
      if (entry.ordering.order === 'tags') {
        // 2026-11-05: a tag filter matches every tag, even if grouping displays only the first one.
        return new Set(scopedCards.filter(card => {
          const tags = (card.tags ?? []).filter(tag => entry.ordering.tagScope === 'both'
            || projectTagNames.has(tag) === (entry.ordering.tagScope === 'project'));
          return entry.key === 'tags:none' ? tags.length === 0 : tags.includes(entry.key.slice('tags:'.length));
        }).map(card => card.id));
      }
      return new Set(groupAndSortCards(scopedCards, lookups.cardById, entry.ordering, orderingContext)
        .find(group => group.key === entry.key)?.cards.map(card => card.id) ?? []);
    });
    return searchedCards.filter(card => memberships.every(ids => ids.has(card.id)));
  }, [searchedCards, scopedCards, lookups.cardById, orderingContext, laneSearch, projectTagNames]);
  const tableGroups = useMemo(() => groupAndSortCards(visibleCards, lookups.cardById, ordering, orderingContext), [visibleCards, lookups.cardById, ordering, orderingContext, lang]);
  const labeledLaneSearch = useMemo(() => laneSearch.map(entry => ({ ...entry,
    title: groupAndSortCards(scopedCards, lookups.cardById, entry.ordering, orderingContext)
      .find(group => group.key === entry.key)?.title ?? entry.title,
  })), [laneSearch, scopedCards, lookups.cardById, orderingContext, lang]);
  // Empty zones stay in storage; "Hide empty" only filters the view.
  const shownGroups = useMemo(() => hideEmptyZones && ordering.order === 'manual' ? tableGroups.filter(group => group.key === 'all' || group.cards.length > 0) : tableGroups,
    [tableGroups, hideEmptyZones, ordering.order]);
  // 2026-11-05: the side rail also offers empty priorities; creating a target must not reflow the source grid.
  const dragGroups = useMemo(() => {
    if (laneOrderOf(ordering) !== 'priority') return tableGroups;
    const priorities = [{ key: 'priority:high', title: dragText.high }, { key: 'priority:medium', title: dragText.medium },
      { key: 'priority:low', title: dragText.low }, { key: 'priority:none', title: dragText.noPriority }];
    return priorities.map(group => ({ ...group, state: null, cards: tableGroups.find(current => current.key === group.key)?.cards ?? [] }));
  }, [ordering, tableGroups, dragText]);
  // Selection and bulk actions include each card once, even if groups repeat its presentation (2026-11-04).
  const orderedCards = useMemo(() => [...new Map(tableGroups.flatMap(group => group.cards).map(card => [card.id, card])).values()], [tableGroups]);
  // Manual Order is scoped to one deck: its zones and only its cards can be reordered.
  const deckScopeId = scope.kind === 'deck' ? scope.id : null;
  const manualOrdering = ordering.order === 'manual' && deckScopeId !== null;
  const manualDrop = manualOrdering && Boolean(cardTransfer);
  const transferAutoScroll = useMemo(() => transferAutoScrollOptions(manualOrdering), [manualOrdering]);
  const cardMotion = useCardLayoutMotion<HTMLDivElement>({
    layoutKey: JSON.stringify(tableGroups.map(group => [group.key, group.cards.map(card => card.id)])),
    resetKey: JSON.stringify([snapshot.source, scope, resolvedView, showFamily, hasPreview]),
    dragging: Boolean(cardTransfer),
  });
  const attachResults = useCallback((element: HTMLDivElement | null) => {
    resultsRoot.current = element;
    return cardMotion(element);
  }, [cardMotion]);
  const selectionKey = JSON.stringify([snapshot.source, scope, trackId, showFamily ? familyHero?.id : null]);
  // Family replaces the selectable deck results; hidden deck cards must never remain bulk targets.
  const selection = useCardSelection(showFamily ? [] : orderedCards.map(card => card.id), selectionKey, navigationLocked || Boolean(cardTransfer));
  const expandedSingleLane = useRef<string | null>(null);
  useEffect(() => { expandedSingleLane.current = null; }, [selectionKey, selection.selectedIds]);
  const selectedCards = orderedCards.filter(card => selection.selectedIds.has(card.id));
  // A tag pick stays active only while the selection is exactly its cards; any other selection change ends it.
  const tagPickIds = useMemo(() => cardsMatchingTagPick(orderedCards, tagPick), [orderedCards, tagPick]);
  const tagPickActive = tagPickSize(tagPick) > 0 && tagPickIds.length === selection.selectedIds.size && tagPickIds.every(id => selection.selectedIds.has(id));
  const sticky = useCatalogStickyLayout(Boolean(selectedDeck), showCards && selectedCards.length > 0);
  const deckTransition = useDeckTransition(sticky.root, selectedDeck?.id ?? null);
  const members = useMemo(() => catalog?.members ?? [], [catalog?.members]);
  const unassignedCount = activeLookups.deckCounts.get(null) ?? 0;
  const trackProgress = activeLookups.trackProgress.get(trackId);
  const calendarDay = new Date().toDateString();
  const pinnedTileIds = useMemo(() => [openedCardId, requestedCardFocus, draggedCardId]
    .filter((id): id is string => Boolean(id)), [openedCardId, requestedCardFocus, draggedCardId]);
  useLayoutEffect(() => {
    if (!requestedCardFocus) return;
    const button = cardOpenButton(requestedCardFocus);
    if (button) {
      button.focus();
      lastOpenedButton.current = button;
      setRequestedCardFocus(null);
    }
  }, [requestedCardFocus, selectedCard?.id, shownGroups]);
  useEffect(() => {
    const saved = restoreHeroView.current;
    if (!saved || selectedCard?.id !== saved.heroId) return;
    // 2026-11-08: run after the preview's heading focus and its scrollport measurement, without scrolling the opener into view.
    let frame = requestAnimationFrame(() => {
      if (restoreHeroView.current !== saved) return;
      restoreHeroView.current = null;
      const root = sticky.root.current;
      // 2026-11-09: the returning Hero can still be growing (file text, Journey section) on a slow machine; re-apply the
      // saved scroll for up to 30 frames until the panel can reach it, instead of landing higher than the user left.
      let attempts = 0;
      const applyScroll = () => {
        const panels = root?.querySelector<HTMLElement>('.card-preview-panels');
        if (!panels) return;
        panels.scrollTop = saved.scrollTop;
        if (Math.abs(panels.scrollTop - saved.scrollTop) > 1 && ++attempts < 30) frame = requestAnimationFrame(applyScroll);
      };
      applyScroll();
      const id = CSS.escape(saved.subCardId);
      const selector = saved.origin === 'journey' ? `[data-journey-card-id="${id}"]` : `.card-family-list [data-card-id="${id}"] .card-family-row-open`;
      root?.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedCard?.id, sticky.root]);
  // 2026-11-05: event identities stay stable; actions still read the latest locks, selection and hashes.
  const tileActions = useRef({ activateCard, openCard, toggle: selection.toggle, lookups });
  useLayoutEffect(() => { tileActions.current = { activateCard, openCard, toggle: selection.toggle, lookups }; });
  const activateTile = useCallback((card: CatalogCard, button: HTMLButtonElement, shift: boolean) => {
    const actions = tileActions.current;
    const current = actions.lookups.cardById.get(card.id);
    if (current) actions.activateCard(current, button, shift);
  }, []);
  const openTileFamily = useCallback((card: CatalogCard, button?: HTMLButtonElement) => {
    const actions = tileActions.current;
    const current = actions.lookups.cardById.get(card.id);
    if (current) actions.openCard(current, button);
  }, []);
  const toggleTile = useCallback((id: string, shift: boolean) => tileActions.current.toggle(id, shift), []);
  const blockedDragIds = selectedCards.length > 1000 ? selection.selectedIds : null;
  const canDragTile = useCallback((id: string) => !blockedDragIds?.has(id), [blockedDragIds]);
  const transferContext = useMemo(() => ({ enabled: writable && !navigationLocked && !showFamily,
    active: Boolean(cardTransfer), canDrag: canDragTile,
    sourceIds: cardDragPreview ? new Set(cardTransfer?.cards.map(card => card.cardId)) : undefined,
  }), [writable, navigationLocked, showFamily, cardTransfer, canDragTile, cardDragPreview]);

  useEffect(() => {
    if (!bulkFocusPending || navigationLocked || selectedCards.length > 0) return;
    // Wait for the selection toolbar and its popup to unmount before returning focus (2026-11-03).
    const frame = requestAnimationFrame(() => {
      const results = sticky.root.current?.querySelector<HTMLElement>('.catalog-results');
      const firstCard = results && [...results.querySelectorAll<HTMLButtonElement>('.deck-card-open:not(:disabled), .catalog-table-title:not(:disabled)')]
        .find(button => button.getClientRects().length > 0);
      if (firstCard) firstCard.focus({ preventScroll: true });
      else if (results?.getClientRects().length) results.focus({ preventScroll: true });
      else searchField.current?.focus({ preventScroll: true });
      setBulkFocusPending(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [bulkFocusPending, navigationLocked, selectedCards.length, sticky.root]);

  useEffect(() => {
    try { localStorage.setItem('deckmate-hide-empty-zones', String(hideEmptyZones)); } catch { /* View preference only; hiding still works (2026-11-04). */ }
  }, [hideEmptyZones]);

  useEffect(() => {
    if (!catalog || !requestedJourneyId) return;
    const journey = catalog.journeys?.find(candidate => candidate.id === requestedJourneyId);
    if (scope.kind === 'deck' && journey?.deckId === scope.id) setJourneyDeckId(scope.id);
    else setRequestedJourneyId(null);
  }, [catalog, scope, requestedJourneyId]);

  useEffect(() => {
    onEditing?.(navigationLocked || Boolean(cardTransfer));
  }, [navigationLocked, cardTransfer, onEditing]);
  function focusedCardId(): string | null {
    const active = document.activeElement instanceof Element ? document.activeElement : null;
    const id = active?.closest('[data-card-id]')?.getAttribute('data-card-id') ?? null;
    return id && lookups.cardById.has(id) ? id : null;
  }
  function cardOpenButton(cardId: string): HTMLButtonElement | null {
    const scope = sticky.root.current ?? document;
    const wrapper = scope.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(cardId)}"]`);
    const button = wrapper?.querySelector<HTMLButtonElement>('.deck-card-open, .catalog-table-title');
    return button && button.getClientRects().length > 0 ? button : null;
  }
  // j/k move through visible cards and immediately open the card in the left panel.
  function navigateCards(step: 1 | -1) {
    if (!showCards || navigationLocked || showFamily || cardTransfer || transferBaseline.current || orderedCards.length === 0) return;
    const focused = focusedCardId();
    const currentId = focused ?? (lookups.cardById.has(openedCardId) ? openedCardId : null);
    const currentIndex = currentId ? orderedCards.findIndex(card => card.id === currentId) : -1;
    const nextIndex = currentIndex < 0 ? (step === 1 ? 0 : orderedCards.length - 1)
      : Math.max(0, Math.min(orderedCards.length - 1, currentIndex + step));
    const target = orderedCards[nextIndex];
    if (!target || target.id === currentId) return;
    const button = cardOpenButton(target.id);
    button?.focus();
    if (!button) setRequestedCardFocus(target.id);
    openCard(target, button ?? undefined);
  }
  function openFocusedCard() {
    if (!showCards || navigationLocked || showFamily || cardTransfer || transferBaseline.current) return;
    const cardId = focusedCardId();
    if (!cardId || cardId === openedCardId) return;
    const card = lookups.cardById.get(cardId);
    if (!card) return;
    const button = cardOpenButton(cardId);
    button?.focus();
    openCard(card, button ?? undefined);
  }
  // Arrow keys work only when the grid has focus, choosing cards by tile geometry.
  function moveGridFocus(event: KeyboardEvent, code: string) {
    if (!showCards || navigationLocked || showFamily || cardTransfer || transferBaseline.current) return;
    const results = sticky.root.current?.querySelector<HTMLElement>('.catalog-results');
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!results || !active || !results.contains(active)) return;
    const mountedEntries = [...results.querySelectorAll<HTMLButtonElement>('.deck-card-open, .catalog-table-title')]
      .map(button => ({ button: button as HTMLButtonElement | null,
        cardId: button.closest('[data-card-id]')?.getAttribute('data-card-id') ?? '', rectangle: button.getBoundingClientRect() }))
      .filter(entry => entry.rectangle.width > 0 && entry.rectangle.height > 0);
    const mountedIds = new Set(mountedEntries.map(entry => entry.cardId));
    const entries = [...mountedEntries, ...virtualCardNavigationEntries(results)
      .filter(entry => !mountedIds.has(entry.cardId)).map(entry => ({ ...entry, button: null }))];
    const current = entries.find(entry => entry.button === active)
      ?? entries.find(entry => entry.button?.closest('[data-card-id]')?.contains(active));
    if (!current) return;
    const horizontal = code === 'ArrowLeft' || code === 'ArrowRight';
    const forward = code === 'ArrowRight' || code === 'ArrowDown';
    const centerX = current.rectangle.left + current.rectangle.width / 2;
    const centerY = current.rectangle.top + current.rectangle.height / 2;
    const weight = (entry: (typeof entries)[number]) => {
      const targetX = entry.rectangle.left + entry.rectangle.width / 2;
      const targetY = entry.rectangle.top + entry.rectangle.height / 2;
      const towards = (horizontal ? targetX - centerX : targetY - centerY) * (forward ? 1 : -1);
      if (towards <= 1) return Number.POSITIVE_INFINITY;
      return towards + (horizontal ? Math.abs(targetY - centerY) * 3 : Math.abs(targetX - centerX) * 3);
    };
    const next = entries.map(entry => ({ entry, weight: weight(entry) }))
      .filter(candidate => Number.isFinite(candidate.weight))
      .sort((first, second) => first.weight - second.weight)[0]?.entry;
    if (!next || next.button === current.button) return;
    event.preventDefault();
    next.button?.focus();
    if (!next.button) setRequestedCardFocus(next.cardId);
    const cardId = next.cardId;
    const card = lookups.cardById.get(cardId);
    if (card) openCard(card, next.button ?? undefined);
  }
  // Escape clears selection, returns to Hero when remembered, then closes the card and the deck.
  function closeStepwise(event: KeyboardEvent) {
    if (creation || navigationLocked || cardTransfer) return;
    event.preventDefault();
    // A zone delete strip owns Escape first: it is the safe answer, not a step towards leaving the deck (2026-11-05).
    if (zoneDeletion) { setZoneDeletion(null); return; }
    if (selection.selectedIds.size > 0) { selection.clear(); return; }
    if (returnToHero()) return;
    if (selectedCard) { closeCard(); return; }
    if (scope.kind !== 'catalog') returnToCatalog();
  }
  function toggleFocusedSelection(event: KeyboardEvent) {
    // CardSelection handles x for the hovered card; this handles the focused card.
    if (!showCards || navigationLocked || showFamily || cardTransfer || transferBaseline.current) return;
    if (document.querySelector('[data-card-id]:hover')) return;
    const cardId = focusedCardId() ?? (lookups.cardById.has(openedCardId) ? openedCardId : null);
    if (!cardId) return;
    event.preventDefault();
    selection.toggle(cardId);
  }
  // One handler dispatches shortcuts from keyboard-shortcuts.ts.
  // Use capture because card selection also listens for keydown and consumes Escape with preventDefault.
  // useEffectEvent: the listener always sees the current render without re-subscribing on every render.
  const handleShortcut = useEffectEvent((event: KeyboardEvent) => {
      const selectionShortcut = matchShortcut(event, BULK_SHORTCUTS);
      if (selectionShortcut?.id === 'bulk-select-all' && !shortcutTargetBlocked(event, 'selection')
        && !navigationLocked && !showFamily && !cardTransfer && selection.selectedIds.size === 1) {
        const selectedId = [...selection.selectedIds][0];
        const group = shownGroups.find(candidate => candidate.cards.some(card => card.id === selectedId));
        const expansionKey = selectionKey + ':' + selectedId;
        if (group && group.cards.length < orderedCards.length && expandedSingleLane.current !== expansionKey) {
          event.preventDefault(); event.stopImmediatePropagation();
          if (group.cards.length > 1) selection.retain(group.cards.map(card => card.id));
          expandedSingleLane.current = expansionKey;
          return;
        }
      }
      const shortcut = matchShortcut(event);
      if (!shortcut || shortcutTargetBlocked(event)) return;
      switch (shortcut.id) {
        case 'close-stepwise': closeStepwise(event); return;
        case 'toggle-card-view': {
          if (!catalog || !showCards || showFamily || navigationLocked || cardTransfer || transferBaseline.current) return;
          // The left-panel guard preserves Shift+V behavior when the panel contains an editor; it is not another input check.
          if (event.target instanceof Element && event.target.closest('.catalog-preview-slot')) return;
          event.preventDefault();
          setCardView(current => current === 'table' ? 'cards' : 'table');
          return;
        }
        case 'next-card': navigateCards(1); return;
        case 'previous-card': navigateCards(-1); return;
        case 'move-grid-focus': moveGridFocus(event, event.code); return;
        case 'open-focused-card-enter': {
          const active = document.activeElement;
          if (active instanceof HTMLElement
            && active.closest('button, a, input, select, textarea, [role="button"], [contenteditable]:not([contenteditable="false"])')) return;
          openFocusedCard();
          return;
        }
        case 'toggle-subcards': {
          if (navigationLocked || cardTransfer || transferBaseline.current || !selectedCard) return;
          event.preventDefault();
          if (showFamily) resetFamilyContext(); else { setFamilyVisible(true); }
          return;
        }
        case 'open-hero': {
          const hero = selectedCard?.parentId ? lookups.cardById.get(selectedCard.parentId) : null;
          if (navigationLocked || cardTransfer || !hero) return;
          event.preventDefault();
          openCard(hero);
          return;
        }
        case 'new-sub-card': {
          if (navigationLocked || cardTransfer || transferBaseline.current || !writable || !familyRoot) return;
          event.preventDefault();
          newCard(familyRoot.id);
          return;
        }
        case 'new-card': {
          // New Card renders only in card views, so the shortcut does nothing in the deck gallery.
          if (!showCards || navigationLocked || cardTransfer || transferBaseline.current || !writable) return;
          event.preventDefault();
          newCard();
          return;
        }
        case 'toggle-select-focused': toggleFocusedSelection(event); return;
        case 'open-order-panel':
        case 'open-tags-panel': {
          if (!showCards || navigationLocked || cardTransfer || transferBaseline.current) return;
          event.preventDefault();
          if (selectedDeck) showDeckPanel(shortcut.id === 'open-order-panel' ? 'ordering' : 'tags');
          else if (shortcut.id === 'open-order-panel') setOrderingOpen(open => !open);
          return;
        }
      }
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => handleShortcut(event);
    window.addEventListener('keydown', listener, true);
    return () => window.removeEventListener('keydown', listener, true);
  }, []);
  useEffect(() => () => onEditing?.(false), [onEditing]);
  useEffect(() => {
    if (!navigationLocked) return;
    const protectDraft = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', protectDraft);
    return () => window.removeEventListener('beforeunload', protectDraft);
  }, [navigationLocked]);
  useEffect(() => {
    if (navigationSource === snapshot.source) return;
    setOpenedCard(null); setOpenedCardId(''); setCreation(null); setCreationDirty(false); setComposer(null); setParentPicker(null); setAttachmentHeroId(null); resetFamilyContext(); setMembershipDirty(false); setJourneyDeckId(null); setRequestedJourneyId(null);
    setScope({ kind: 'catalog' }); setTrackId(''); setSearch(''); setDeckSearch(''); setTagFilter(''); setMineOnly(false); setOrderingOpen(false); setTagsOpen(false); setTagPick(emptyTagPick);
    setIncludeShelved(false); setLaneSearch([]);
    setNavigationSource(snapshot.source);
  }, [snapshot.source, navigationSource]);
  useEffect(() => {
    if (navigationSource !== snapshot.source) return;
    const url = new URL(location.href);
    const view = url.searchParams.get('view');
    if (view && view !== 'deck') return;
    url.searchParams.set('view', 'deck');
    for (const name of ['deck', 'scope', 'track', 'card', 'q', 'deckQ', 'layout', 'journey', 'tag', 'mine', 'archive', 'lane']) url.searchParams.delete(name);
    url.searchParams.set('catalogSource', snapshot.source);
    if (scope.kind === 'deck') url.searchParams.set('deck', scope.id);
    else if (scope.kind !== 'catalog') url.searchParams.set('scope', scope.kind);
    if (trackId) url.searchParams.set('track', trackId);
    if (openedCardId) url.searchParams.set('card', openedCardId);
    if (search.trim()) url.searchParams.set('q', search.trim());
    if (scope.kind === 'catalog' && deckSearch.trim()) url.searchParams.set('deckQ', deckSearch.trim());
    if (cardView) url.searchParams.set('layout', cardView);
    if (requestedJourneyId) url.searchParams.set('journey', requestedJourneyId);
    if (tagFilter) url.searchParams.set('tag', tagFilter);
    if (mineOnly) url.searchParams.set('mine', '1');
    if (includeShelved) url.searchParams.set('archive', '1');
    for (const entry of laneSearch) url.searchParams.append('lane', JSON.stringify({ key: entry.key, title: entry.title, order: serializeOrdering(entry.ordering) }));
    // Only the viewer's own choice goes into the link; without it the deck shows its Default Order.
    url.search = writeOrdering(url.searchParams, orderingChoice ? ordering : defaultCardOrdering).toString();
    history.replaceState(history.state, '', url);
  }, [scope, trackId, openedCardId, search, deckSearch, snapshot.source, navigationSource, cardView, requestedJourneyId, tagFilter, mineOnly, ordering, orderingChoice, includeShelved, laneSearch]);

  function resetFamilyContext() {
    setFamilyVisible(false); setFamilyDraftParentId(null); setFamilyCreationRequest(null); setFamilyDirty(false); setParentPicker(null);
  }
  function returnToCatalog() {
    if (navigationLocked) return;
    if (selectedDeck) deckTransition('close', selectedDeck.id);
    closeInlinePanels();
    setCardView(null); resetFamilyContext(); setLaneSearch([]); setIncludeShelved(false);
    setScope({ kind: 'catalog' }); setSearch(''); setTrackId(''); setTagFilter(''); setOpenedCard(null); setOpenedCardId('');
  }
  function openDeck(deck: CatalogDeck) {
    if (navigationLocked) return;
    if (scope.kind === 'catalog') deckTransition('open', deck.id);
    emitSignal({ type: 'deck-opened', deckId: deck.id });
    closeInlinePanels();
    setCardView(null); setOrderingOpen(false); setTagsOpen(false); setTagPick(emptyTagPick); resetFamilyContext();
    setOrderingChoice(storedDeckOrdering(deck.id)); setLaneSearch([]); setIncludeShelved(false);
    setScope({ kind: 'deck', id: deck.id }); setSearch(''); setTrackId(''); setOpenedCard(null); setOpenedCardId('');
  }
  function openCard(card: CatalogCard, button?: HTMLButtonElement) {
    if (navigationLocked) return;
    closeInlinePanels();
    if (button) lastOpenedButton.current = button;
    if (familyRoot && card.id !== familyRoot.id && card.parentId !== familyRoot.id) resetFamilyContext();
    setOpenedCard(card); setOpenedCardId(card.id);
  }
  function openHeroSubCard(card: CatalogCard, origin: HeroReturn['origin']) {
    if (navigationLocked) return;
    const hero = selectedCard;
    const scrollTop = sticky.root.current?.querySelector<HTMLElement>('.card-preview-panels')?.scrollTop ?? 0;
    openCard(card);
    // 2026-11-09 (author): a Journey step — mini-card, Next or a step in the Journey menu — opens its Sub Card inside the
    // Sub Cards tab, so the family list stays in view; Escape back to the Hero restores the tab's previous state.
    if (origin === 'journey') setFamilyVisible(true);
    if (hero?.kind !== 'hero' || hero.archived || hero.deleted || card.parentId !== hero.id) return;
    setHeroReturn({ heroId: hero.id, subCardId: card.id, origin, scrollTop, familyVisible: showFamily, context: heroReturnContext });
  }
  function returnToHero(): boolean {
    if (navigationLocked || !heroReturn || !returnHero) return false;
    const saved = heroReturn;
    openCard(returnHero);
    setFamilyVisible(saved.familyVisible);
    restoreHeroView.current = saved;
    lastOpenedButton.current = cardOpenButton(returnHero.id);
    return true;
  }
  function activateCard(card: CatalogCard, button?: HTMLButtonElement, shift = false) {
    if (navigationLocked) return;
    if (selection.selectedIds.size > 0) selection.toggle(card.id, shift);
    else openCard(card, button);
  }
  function newCard(parentId: string | null = null, priority?: CardPriority | null, zoneId?: string) {
    if (navigationLocked || !writable || !catalog) return;
    // Outside a deck, the composer starts without a deck choice and saves into the default Inbox.
    const inbox = catalog.inboxDeckId ?? null;
    let target: CatalogDeck | undefined = selectedDeck ?? (inbox ? undefined : catalog.decks.find(deck => deck.kind === 'task') ?? catalog.decks[0]);
    if (parentId) {
      const parent = catalog.cards.find(card => card.id === parentId);
      if (!parent || (parent.kind !== 'hero' && parent.kind !== 'doc') || parent.parentId || parent.journey || parent.archived || parent.deleted) return;
      setFamilyCreationRequest({ parentId, sequence: ++familyCreationSequence.current });
      setFamilyVisible(true); selection.clear();
      return;
    }
    // 2026-11-08: no deck and no Inbox no longer blocks New Card — the composer opens on the automatic
    // choice and saves with deckId null (the server leaves the card without a deck).
    closeInlinePanels();
    resetFamilyContext();
    setComposer({ deckId: target?.id ?? '', parentId, priority, zoneId }); selection.clear();
  }
  function createGroupCard(group: CardGroup) {
    if (group.key.startsWith('zone:')) {
      // The "+" at the end of a zone places the new card in that zone.
      newCard(null, undefined, group.key.slice('zone:'.length));
      return;
    }
    const value = group.key.slice('priority:'.length);
    const priority = value === 'high' || value === 'medium' || value === 'low' ? value : null;
    newCard(null, group.key.startsWith('priority:') ? priority : undefined);
  }
  function laneOfGroup(group: CardGroup): GroupLane | null {
    return laneForGroup(group, laneOrderOf(ordering), deckById, deckScopeId);
  }
  function zoneIdOfGroup(group: CardGroup): string | null {
    return group.key.startsWith('zone:') ? group.key.slice('zone:'.length) : null;
  }
  function zoneControlsOf(group: CardGroup) {
    const zoneId = zoneIdOfGroup(group);
    if (!manualOrdering || !zoneId) return undefined;
    return {
      writable: writable && !pending,
      dragHandle: <ZoneDragHandle zoneId={zoneId} title={group.title} disabled={navigationLocked || !writable} />,
      onRename: (title: string) => renameZone(zoneId, title),
      onDelete: () => setZoneDeletion(zoneId),
      deleteConfirm: zoneDeletion === zoneId
        ? { onKeep: () => setZoneDeletion(null), onConfirm: () => deleteZone(group) }
        : null,
    };
  }
  function currentZones(): CatalogDeckZone[] {
    return deckScopeId ? catalog?.deckOrder?.[deckScopeId]?.zones ?? [] : [];
  }
  async function applyDeckZones(zones: CatalogDeckZone[]) {
    if (!selectedDeck || navigationLocked || !writable) return;
    await edit({ action: 'set-deck-zones', deckId: selectedDeck.id, zones });
  }
  function addZone(title: string) {
    void applyDeckZones([...currentZones(), { id: crypto.randomUUID(), title }]);
  }
  function renameZone(zoneId: string, title: string) {
    void applyDeckZones(currentZones().map(zone => zone.id === zoneId ? { ...zone, title } : zone));
  }
  function deleteZone(group: CardGroup) {
    // Only empty zones show the delete button; its strip in the heading row asked first (2026-11-05).
    setZoneDeletion(null);
    void applyDeckZones(currentZones().filter(zone => zone.id !== zoneIdOfGroup(group)));
  }
  function closeComposer() { setComposer(null); setMembershipDirty(false); }
  function closeCreation() { setCreation(null); setCreationDirty(false); }
  function closeInlinePanels() {
    setHeroReturn(null);
    restoreHeroView.current = null;
    closeComposer();
    closeCreation();
    setParentPicker(null);
  }
  async function attachCards(request: AttachSubCardsRequest) {
    const attachedIds: string[] = [];
    for (const child of request.cards) {
      const saved = await edit({ action: 'set-card-parent', ...child, parentId: request.heroId, parentSourceHash: request.heroSourceHash,
        ...(attachedIds.length === 0 ? { manifestHash: request.manifestHash } : {}) });
      if (!saved) return { attachedIds, error: t.partialLinks };
      attachedIds.push(child.cardId);
    }
    return { attachedIds };
  }
  async function detachCard(card: CatalogCard) {
    await edit({ action: 'set-card-parent', cardId: card.id, sourceHash: card.sourceHash,
      expectedParentId: card.parentId, parentId: null, parentSourceHash: null });
  }
  async function reorderSubCards(cardIds: string[]) {
    if (!familyRoot || !catalog || navigationLocked || !writable) return false;
    return edit({ action: 'reorder-subcards', cardId: familyRoot.id, sourceHash: familyRoot.sourceHash, manifestHash: catalog.manifestHash, cardIds });
  }
  function chooseParent() {
    if (navigationLocked || !selectedCard || !catalog) return;
    closeInlinePanels();
    setParentPicker({ card: selectedCard, manifestHash: catalog.manifestHash });
  }
  async function saveParent(parent: CatalogCard | null) {
    if (!parentPicker) return false;
    const card = parentPicker.card;
    const saved = await edit({ action: 'set-card-parent', cardId: card.id, sourceHash: card.sourceHash,
      manifestHash: parentPicker.manifestHash, expectedParentId: card.parentId,
      parentId: parent?.id ?? null, parentSourceHash: parent?.sourceHash ?? null });
    if (saved) { setParentPicker(null); setFamilyVisible(true); }
    return saved;
  }
  async function promoteParent(request: ParentPromotionRequest) {
    const saved = await edit({ action: 'bulk-edit-cards', manifestHash: request.manifestHash, optionsHash: request.optionsHash,
      cards: [request.child], change: { kind: 'promote-parent', ...request.candidate, deckId: request.deckId } });
    if (saved) { setParentPicker(null); setFamilyVisible(true); }
    return saved;
  }
  async function promoteDroppedCard() {
    if (!dropHeroPromotion || !catalog || pending || !writable) return false;
    const card = dropHeroPromotion.baseline.cards[0];
    if (!card) return false;
    const saved = await edit({ action: 'bulk-edit-cards', manifestHash: dropHeroPromotion.baseline.manifestHash, optionsHash: catalog.optionsHash ?? '',
      cards: [], change: { kind: 'promote-parent', cardId: card.cardId, sourceHash: card.sourceHash, expectedParentId: null, deckId: dropHeroPromotion.deck.id } });
    if (saved) setDropHeroPromotion(null);
    return saved;
  }
  function showDeckPanel(panel: 'info' | 'ordering' | 'tags' | 'activity') {
    if (navigationLocked) return;
    const collapse = activeDeckPanel === panel;
    closeCard(false);
    panels.setSummaryCollapsed(collapse);
    setOrderingOpen(!collapse && panel === 'ordering');
    setTagsOpen(!collapse && panel === 'tags');
    setActivityOpen(!collapse && panel === 'activity');
  }
  function changeOrdering(next: CardOrderingValue) {
    setOrderingChoice(next);
    if (deckScopeId) rememberDeckOrdering(deckScopeId, next);
  }
  function resetOrdering() {
    setOrderingChoice(null);
    if (deckScopeId) rememberDeckOrdering(deckScopeId, null);
  }
  // Editors set the first order shown to new viewers; the default order needs no stored override.
  async function saveDefaultOrdering() {
    if (!selectedDeck || !catalog || navigationLocked || !writable) return;
    await edit({ action: 'set-deck-default-order', deckId: selectedDeck.id, defaultOrder: serializeOrdering(ordering) || null, manifestHash: catalog.manifestHash });
  }
  function pickTags(next: TagPick) {
    if (navigationLocked || cardTransfer) return;
    setTagPick(next);
    selection.retain(cardsMatchingTagPick(orderedCards, next));
  }
  function familyCardCreated(cardId: string) {
    setFamilyDirty(false); 
    setOpenedCard(null); setOpenedCardId(cardId); setFamilyVisible(true);
  }
  function cardCreated(cardId: string, deckId: string) {
    setComposer(null); setMembershipDirty(false);
    // create-card writes the chosen/default Zone in the same server action; no stale-hash follow-up is needed.
    showCardInDeck(cardId, deckId);
  }
  function showCardInDeck(cardId: string, deckId: string) {
    closeInlinePanels();
    if (deckId !== deckScopeId) setOrderingChoice(storedDeckOrdering(deckId));
    setOpenedCard(null); setOpenedCardId(cardId); setScope({ kind: 'deck', id: deckId });
    setTrackId(''); resetCardFilters(); resetFamilyContext();
  }
  function restoreJourneyFocus() {
    const target = journeyReturnFocus.current;
    journeyReturnFocus.current = null;
    if (target?.isConnected) target.focus({ preventScroll: true });
    else searchField.current?.focus({ preventScroll: true });
  }
  function resetCardFilters() { setSearch(''); setMineOnly(false); setTagFilter(''); setLaneSearch([]); }
  function filterGroup(group: CardGroup) {
    if (navigationLocked || group.key === 'all') return;
    setLaneSearch(entries => entries.some(entry => entry.key === group.key && entry.ordering.order === ordering.order) ? entries
      : [...entries, { key: group.key, title: group.title, ordering: { ...ordering, then: [], compact: false } }]);
  }
  function openCardView(next: 'all' | 'unassigned', nextTrack = '') {
    if (navigationLocked) return;
    closeInlinePanels();
    resetFamilyContext();
    setScope({ kind: next }); setTrackId(nextTrack); resetCardFilters(); setOpenedCard(null); setOpenedCardId(''); 
  }
  function openPulseCards(state: 'started' | 'review', deckId: string | null = null) {
    if (navigationLocked) return;
    const deck = catalog?.decks.find(candidate => candidate.id === deckId);
    if (deck) openDeck(deck);
    else openCardView('all');
    resetCardFilters();
    setIncludeShelved(false);
    setLaneSearch([{ key: `state:${state}`, title: stateLabel(state), ordering: { ...defaultCardOrdering, order: 'state' } }]);
  }
  function clearCardTransfer() {
    transferBaseline.current = null;
    setCardTransfer(null);
    setCardDragPreview(null);
    setDraggedCardId(null);
    setZoneDrag(null);
    suppressTransferClickUntil.current = Date.now() + 250;
  }
  function startCardTransfer(event: DragStartEvent) {
    if (event.active.data.current?.kind === 'zone-drag') {
      if (!catalog || !writable || navigationLocked) return;
      setZoneDrag(event.active.data.current.zoneId as string);
      return;
    }
    if (!catalog || !writable || navigationLocked || showFamily || event.active.data.current?.kind !== 'card-transfer') return;
    const captured = captureCardTransfer(event.active.data.current.cardId, orderedCards, selection.selectedIds, catalog.manifestHash, snapshot.source);
    transferBaseline.current = captured;
    setCardDragPreview(captured ? captureCardDragPreview(event) : null);
    setCardTransfer(captured);
    setDraggedCardId(captured ? event.active.data.current.cardId as string : null);
  }
  async function finishCardTransfer(event: DragEndEvent) {
    const captured = transferBaseline.current;
    clearCardTransfer();
    const target = event.over?.data.current;
    // Zone heading drag: drop on another zone moves the dragged zone before it, on the Add Zone strip — to the end.
    if (zoneDrag && catalog && writable && !navigationLocked && !captured) {
      const draggedZone = zoneDrag;
      setZoneDrag(null);
      if (scope.kind !== 'deck' || !selectedDeck) return;
      const zones = catalog.deckOrder?.[selectedDeck.id]?.zones ?? [];
      const from = zones.findIndex(zone => zone.id === draggedZone);
      if (from < 0) return;
      let next = zones.filter(zone => zone.id !== draggedZone);
      if (target?.operation === 'zone-end') next = [...next, zones[from]];
      else if (target?.zoneId && target.zoneId !== draggedZone) {
        const to = next.findIndex(zone => zone.id === target.zoneId);
        if (to < 0) return;
        next = [...next.slice(0, to), zones[from], ...next.slice(to)];
      } else return;
      if (next.every((zone, index) => zone.id === zones[index].id)) return;
      await edit({ action: 'set-deck-zones', deckId: selectedDeck.id, zones: next });
      return;
    }
    setZoneDrag(null);
    if (captured && catalog && writable && !navigationLocked && !showFamily && captured.source === snapshot.source && target?.operation === 'card-deck-picker') {
      setDropDeckPicker(captured);
      return;
    }
    if (captured && catalog && writable && !navigationLocked && !showFamily && captured.source === snapshot.source && target?.operation === 'card-hand' && currentMember) {
      const saved = await edit({ action: 'bulk-edit-cards', manifestHash: captured.manifestHash, optionsHash: catalog.optionsHash ?? '',
        cards: captured.cards.map(({ cardId, sourceHash }) => ({ cardId, sourceHash })),
        change: { kind: 'hand', memberId: currentMember.id, mode: 'add' } },
      outcome => { if (captured.ownsSelection && outcome.pending.length) selection.retain(outcome.pending); });
      if (saved && captured.ownsSelection) { selection.retain([]); setBulkFocusPending(true); }
      return;
    }
    if (captured && catalog && writable && !navigationLocked && !showFamily && captured.source === snapshot.source && target?.operation === 'card-priority') {
      const priority = target.priority as CardPriority | null;
      const cards = captured.cards.filter(card => card.priority !== priority);
      if (!cards.length) return;
      const saved = await edit({ action: 'bulk-edit-cards', optionsHash: catalog.optionsHash ?? '', cards: cards.map(({ cardId, sourceHash }) => ({ cardId, sourceHash })), change: { kind: 'properties', priority } },
        outcome => { if (captured.ownsSelection && outcome.pending.length) selection.retain(outcome.pending); });
      if (saved && captured.ownsSelection) { selection.retain([]); setBulkFocusPending(true); }
      return;
    }
    // Manual order drop: into a zone (section) or before a card (tile) of this deck.
    if (captured && catalog && writable && !navigationLocked && !showFamily && captured.source === snapshot.source && target?.operation === 'card-zone') {
      const deckId = target.deckId as string;
      const zoneId = (target.zoneId ?? null) as string | null;
      const beforeCardId = (target.beforeCardId ?? null) as string | null;
      const moving = captured.cards.filter(card => card.deckId === deckId);
      if (!moving.length) return;
      const saved = await edit({ action: 'move-cards-in-deck', deckId, cards: moving.map(({ cardId, sourceHash }) => ({ cardId, sourceHash })), zoneId, beforeCardId },
        outcome => { if (captured.ownsSelection && outcome.pending.length) selection.retain(outcome.pending); });
      if (saved && captured.ownsSelection) { selection.retain([]); setBulkFocusPending(true); }
      return;
    }
    // One tag edit preserves other tags and avoids a second write with the old options hash (2026-11-04).
    if (captured && catalog && writable && !navigationLocked && !showFamily && captured.source === snapshot.source && target?.operation === 'card-tags') {
      const tag = (target.tag ?? null) as string | null;
      const changing = captured.cards.map(({ cardId }) => lookups.cardById.get(cardId)).filter((card): card is CatalogCard => Boolean(card))
        .filter(card => tag === null ? Boolean(card.tags?.length) : !card.tags?.includes(tag));
      if (!changing.length) return;
      const tags = tag === null ? [...new Set(changing.flatMap(card => card.tags ?? []))] : [tag];
      const saved = await edit({ action: 'bulk-edit-cards', optionsHash: catalog.optionsHash ?? '',
        cards: changing.map(card => ({ cardId: card.id, sourceHash: card.sourceHash })),
        change: { kind: 'tags', tags, mode: tag === null ? 'remove' : 'add' } },
        outcome => { if (captured.ownsSelection && outcome.pending.length) selection.retain(outcome.pending); });
      if (saved && captured.ownsSelection) { selection.retain([]); setBulkFocusPending(true); }
      return;
    }
    if (!captured || !catalog || !writable || navigationLocked || showFamily || captured.source !== snapshot.source || target?.operation !== 'card-transfer') return;
    const deck = target.deckId === null ? null : catalog.decks.find(candidate => candidate.id === target.deckId);
    if (deck === undefined) return;
    if (deck && cardTransferTargetIssue(captured, deck, cards) === 'confirm-promotion') {
      setDropHeroPromotion({ baseline: captured, deck });
      return;
    }
    const request = cardTransferRequest(captured, deck, cards);
    if (!request) return;
    await moveCardsToDeck(request, captured.ownsSelection);
  }
  useEffect(() => {
    if (cardTransfer && (navigationLocked || !writable || showFamily || cardTransfer.source !== snapshot.source)) clearCardTransfer();
  }, [navigationLocked, writable, showFamily, snapshot.source, cardTransfer]);

  async function moveCardsToDeck(request: Extract<CatalogAction, { action: 'bulk-assign-deck' }>, ownsSelection: boolean) {
    const saved = await edit(request, outcome => { if (ownsSelection && outcome.pending.length) selection.retain(outcome.pending); });
    // 2026-11-04: the drag render locks selection; retain avoids capturing its disabled clear callback.
    if (saved && ownsSelection) { selection.retain([]); setBulkFocusPending(true); }
    if (saved) requestAnimationFrame(() => {
      if (document.activeElement === document.body) sticky.root.current?.querySelector<HTMLElement>('.catalog-results')?.focus({ preventScroll: true });
    });
    return saved;
  }
  async function bulkMove(deckId: string | null) {
    if (navigationLocked || !selectedCards.length) return false;
    return moveCardsToDeck({ action: 'bulk-assign-deck', cards: selectedCards.map(card => ({ cardId: card.id, sourceHash: card.sourceHash })), deckId }, true);
  }
  async function bulkTrack(nextTrackId: string) {
    if (navigationLocked || !selectedCards.length) return false;
    const saved = await edit({ action: 'bulk-add-track', cards: selectedCards.map(card => ({ cardId: card.id, sourceHash: card.sourceHash })), trackId: nextTrackId }, outcome => { if (outcome.pending.length) selection.retain(outcome.pending); });
    if (saved) { selection.clear(); setBulkFocusPending(true); }
    return saved;
  }
  async function bulkAction(change: BulkChange) {
    if (navigationLocked || !selectedCards.length || !catalog) return false;
    const saved = await edit({ action: 'bulk-edit-cards', optionsHash: catalog.optionsHash ?? '',
      cards: selectedCards.map(card => ({ cardId: card.id, sourceHash: card.sourceHash })), change },
      outcome => { if (outcome.pending.length) selection.retain(outcome.pending); });
    if (saved) { selection.clear(); setBulkFocusPending(true); }
    return saved;
  }
  function closeCard(restoreFocus = true) {
    if (navigationLocked) return;
    closeInlinePanels();
    resetFamilyContext();
    setOpenedCard(null); setOpenedCardId('');
    if (restoreFocus) {
      if (selectedCard?.kind === 'hero' && orderedCards.some(card => card.id === selectedCard.id)) setRequestedCardFocus(selectedCard.id);
      else if (lastOpenedButton.current?.isConnected) lastOpenedButton.current.focus();
      else searchField.current?.focus();
    }
  }
  function toggleSpace(spaceId: string) {
    setCollapsedSpaces(previous => {
      const next = new Set(previous);
      if (next.has(spaceId)) next.delete(spaceId); else next.add(spaceId);
      return next;
    });
  }
  // Deck header actions: watch, import, automation, guardians, and deletion.
  async function toggleDeckWatch() {
    if (!selectedDeck || !currentMember || !catalog || navigationLocked || !writable) return;
    const current = selectedDeck.watcherIds ?? [];
    const next = current.includes(currentMember.id) ? current.filter(id => id !== currentMember.id) : [...current, currentMember.id];
    await edit({ action: 'set-deck-watchers', deckId: selectedDeck.id, watcherIds: next, manifestHash: catalog.manifestHash });
  }
  function saveDeckGuardians(deckId: string, guardianIds: string[], manifestHash: string) {
    return edit({ action: 'set-deck-guardians', deckId, guardianIds, manifestHash });
  }
  function saveDeckAutomation(deckId: string, settings: DeckAutomationSettings, manifestHash: string) {
    return edit({ action: 'set-deck-automation', deckId, ...settings, manifestHash });
  }
  async function confirmDeckDelete() {
    if (!selectedDeck || !catalog || navigationLocked || !writable || deletingDeck) return;
    setDeletingDeck(true);
    setDeleteError(false);
    const saved = await edit({ action: 'delete-deck', deckId: selectedDeck.id, manifestHash: catalog.manifestHash });
    setDeletingDeck(false);
    if (saved) { setDeleteConfirmOpen(false); returnToCatalog(); }
    else setDeleteError(true);
  }

  // The watch control uses the member selected in Your Hand; its tooltip lists all watchers.
  const watcherNames = (selectedDeck?.watcherIds ?? []).map(id => members.find(member => member.id === id)?.label ?? id);
  const watchingDeck = Boolean(selectedDeck && currentMember && selectedDeck.watcherIds?.includes(currentMember.id));
  const watchHint = (watchingDeck ? t.unwatch : t.watch)
    + (watcherNames.length ? t.watchers(watcherNames.join(', ')) : '');
  const openDeckCardCount = selectedDeck ? activeLookups.deckCounts.get(selectedDeck.id) ?? 0 : 0;

  let title = t.decks;
  if (selectedDeck) title = selectedDeck.title;
  else if (selectedTrack) title = selectedTrack.title;
  else if (scope.kind === 'unassigned') title = t.unassigned;
  else if (scope.kind === 'all') title = t.allCards;
  else if (showCards) title = t.foundCards;
  const searchScope = selectedDeck ? t.searchScope(selectedDeck.title) : title;
  const hasFilters = Boolean(search.trim() || tagFilter || laneSearch.length);
  // 2026-11-06: an empty deck invites the first card, an empty project stays quiet, other scopes keep the area wording;
  // cards hidden by search, filters or My cards are "no matches", never "no cards yet".
  let cardsEmptyText = t.noCards;
  if (hasFilters || scopedCards.length > 0) cardsEmptyText = t.noMatches;
  else if (selectedDeck) cardsEmptyText = writable ? t.noCardsDeck : t.noCardsProject;
  else if (catalog && catalog.cards.length === 0) cardsEmptyText = t.noCardsProject;
  const showSummary = activeDeckPanel !== null;
  // Ordering and Tags use narrow columns beside the rail; Info and Activity use the wide, resizable left slot.
  const narrowPanel = activeDeckPanel === 'ordering' || activeDeckPanel === 'tags';
  // Available Shortcuts shows only what works here: card lists, the open deck, the open card (CardPreview is not shown under New Card).
  const shortcutScreens: ShortcutScreen[] = ['app'];
  if (showCards) shortcutScreens.push('cards');
  if (selectedDeck) shortcutScreens.push('deck');
  if (selectedCard && !composer) shortcutScreens.push('card');

  const selectionToolbar = catalog && showCards && selectedCards.length > 0
    ? <SelectionToolbar selectedCards={selectedCards} source={snapshot.source} catalog={catalog} totalShown={orderedCards.length} pending={navigationLocked} writable={writable} onClear={selection.clear} onSelectAll={selection.selectAllShown} onMove={bulkMove} onAddTrack={bulkTrack} onAction={bulkAction} />
    : null;

  // Gallery filters sit in the project row; card views give them a separate row.
  const browserNavigation = catalog ? <fieldset className="catalog-browser-navigation" disabled={navigationLocked}>
        <nav className="catalog-nav-section" aria-label={t.decks}><span className="catalog-nav-label">{t.decks}</span><button type="button" aria-current={!showCards ? 'page' : undefined} onClick={returnToCatalog}><Layers size={14} />{t.allDecks}<span>{number(catalog.decks.length)}</span></button></nav>
        <nav className="catalog-nav-section" aria-label={t.cards}><span className="catalog-nav-label">{t.cards}</span><div><button type="button" aria-current={scope.kind === 'all' && !trackId ? 'page' : undefined} onClick={() => openCardView('all')}>{t.allCards}<span>{number(cards.length)}</span></button><button type="button" aria-current={scope.kind === 'unassigned' ? 'page' : undefined} onClick={() => openCardView('unassigned')}>{t.unassigned}<span>{number(unassignedCount)}</span></button></div></nav>
        <div className="catalog-track-picker"><label htmlFor="catalog-track-view" className="catalog-nav-label">{t.tracks} <span>{t.crossDeckCards}</span></label><div><select id="catalog-track-view" value={trackId} onChange={event => openCardView('all', event.target.value)}><option value="">{t.chooseTrack}</option>{catalog.tracks.map(track => <option key={track.id} value={track.id}>{track.title + ' · ' + number(lookups.trackCounts.get(track.id) ?? 0)}</option>)}</select>{writable && <Button variant="ghost" size="icon" onClick={event => { creationOpener.current = event.currentTarget; setCreation({ kind: 'track' }); }} aria-label={t.createTrack}><Plus size={14} /></Button>}</div></div>
      </fieldset> : null;
  return <DndContext key={snapshot.source} sensors={transferSensors} collisionDetection={coverCollisions} autoScroll={transferAutoScroll}
    onDragStart={startCardTransfer} onDragEnd={event => void finishCardTransfer(event)} onDragCancel={clearCardTransfer}
    accessibility={{ screenReaderInstructions: { draggable: t.dragInstructions }, announcements: {
      onDragStart: () => t.dragStart,
      onDragOver: ({ over }) => over ? t.dropTarget(String(over.data.current?.label ?? '')) : t.noDropTarget,
      onDragEnd: ({ over }) => over ? t.dropEnd(String(over.data.current?.label ?? '')) : t.dragCancelled,
      onDragCancel: () => t.dragCancelledUnchanged,
    } }}>
    <CardTransferContext.Provider value={transferContext}>
    <CardAttachmentRefreshContext.Provider value={catalog?.indexedAt}>
    <section ref={sticky.root} onClickCapture={event => { if (transferBaseline.current || Date.now() < suppressTransferClickUntil.current) { event.preventDefault(); event.stopPropagation(); } }} className={'deck-view catalog-view' + (cardTransfer ? ' is-card-transfer-active' : '') + (cardDragPreview ? ' is-card-pointer-transfer' : '') + (selectedDeck ? ' is-deck-open' : '') + (!selectedDeck && !showCards ? ' deck-gallery' : '')} style={{ '--left-panel-width': panels.leftPanelWidth + 'px' } as CSSProperties} aria-label={t.projectCatalog}>
    {selectedDeck && catalog && <nav className="deck-neighbor-rail" aria-label={t.spaceDecks}>{catalog.decks.filter(deck => deck.spaceId === selectedDeck.spaceId).map(deck => {
      const counts = deckCounts.get(deck.id) ?? emptyDeckCounts;
      return <DeckNeighborCover key={deck.id} deck={deck} counts={counts} source={snapshot.source} current={deck.id === selectedDeck.id} disabled={navigationLocked} baseline={cardTransfer} catalogCards={cards} onOpen={() => openDeck(deck)} />;
    })}</nav>}
    {selectedDeck && catalog ? <header ref={sticky.toolbar} className={'deck-open-toolbar' + (selectionToolbar ? ' is-selection' : '')}>
      {selectionToolbar ?? <Tooltip.Provider delayDuration={200}>
      <DeckHeaderHint label={t.closeDeck}>
        <Button variant="ghost" size="icon" disabled={navigationLocked} onClick={returnToCatalog} aria-label={t.closeDeck}><X size={17} /></Button>
      </DeckHeaderHint>
      <DeckTypePicker key={selectedDeck.id} deck={selectedDeck} cards={catalog.cards} journeys={catalog.journeys ?? []} pending={navigationLocked} writable={writable} manifestHash={catalog.manifestHash} onChange={(kind, manifestHash) => edit({ action: 'set-deck-kind', deckId: selectedDeck.id, kind, manifestHash })} /><h1 title={selectedDeck.title}>{selectedDeck.title}</h1><span>{t.cardsCount(scopedCards.length)}</span>
      <div className="deck-open-tools">{(selectedDeck.kind === 'asset' || selectedDeck.kind === 'mixed') && <DeckHeaderHint label={t.labelPrepareJourney}>
        <Button variant="ghost" size="sm" className="deck-journey-button" disabled={navigationLocked} onClick={event => { closeInlinePanels(); journeyReturnFocus.current = event.currentTarget; setJourneyDeckId(selectedDeck.id); }}><ScrollText size={14} />{t.labelJourney}</Button>
      </DeckHeaderHint>}
        {writable && <DeckHeaderHint label={t.deckSettings}>
          <Button variant="ghost" size="icon" disabled={navigationLocked} onClick={() => { closeInlinePanels(); setCreation({ kind: 'deck', deckId: selectedDeck.id, editing: true }); }} aria-label={t.deckSettings}><Pencil size={14} /></Button>
        </DeckHeaderHint>}
        <DeckHeaderHint label={watchHint}>
          <Button variant="ghost" size="icon" className={'deck-watch-toggle' + (watchingDeck ? ' is-watching' : '')} aria-pressed={watchingDeck}
            disabled={!writable || navigationLocked} onClick={() => void toggleDeckWatch()} aria-label={t.deckWatch}><Eye size={14} /></Button>
        </DeckHeaderHint>
        <DeckHeaderHint label={t.importDeckCsv}>
          <Button variant="ghost" size="icon" disabled={navigationLocked || !onImportCsv || !selectedDeck} onClick={() => selectedDeck && onImportCsv?.(selectedDeck.id)} aria-label={t.importCsv}><Inbox size={14} /></Button>
        </DeckHeaderHint>
        <DeckAutomation deck={selectedDeck} members={members} tagNames={(catalog.projectTags ?? []).map(tag => tag.name)}
          manifestHash={catalog.manifestHash} pending={navigationLocked} writable={writable} onSave={saveDeckAutomation} />
        <DeckGuardians deck={selectedDeck} members={members} manifestHash={catalog.manifestHash}
          pending={navigationLocked} writable={writable} onSave={saveDeckGuardians} />
        <DeckHeaderHint label={t.deleteDeck}>
          <DropdownMenu.Root open={deleteConfirmOpen} onOpenChange={next => { if (!deletingDeck) setDeleteConfirmOpen(next); }}>
            <DropdownMenu.Trigger asChild>
              <Button variant="ghost" size="icon" className="deck-delete-toggle" disabled={!writable || navigationLocked} aria-label={t.deleteDeck}><Trash2 size={14} /></Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="deck-settings-menu deck-delete-menu" align="start" sideOffset={8} collisionPadding={12}>
                <DropdownMenu.Label className="deck-settings-heading">{t.labelDeleteDeck}</DropdownMenu.Label>
                <p className="deck-settings-note">{t.deleteDeckConfirm(selectedDeck.title, openDeckCardCount)}</p>
                {deleteError && <p className="deck-settings-error" role="alert">{t.deleteFailed}</p>}
                <div className="deck-settings-actions">
                  <Button type="button" size="sm" variant="ghost" disabled={deletingDeck} onClick={() => setDeleteConfirmOpen(false)}>{t.cancel}</Button>
                  <Button type="button" size="sm" disabled={deletingDeck} onClick={() => void confirmDeckDelete()}>{deletingDeck && <LoaderCircle size={13} className="spin" />}{t.delete}</Button>
                </div>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </DeckHeaderHint>
        <DeckHeaderHint label={mineOnly ? t.showAllCards : t.showMyCards}>
          <Button variant="ghost" size="sm" className="deck-mine-toggle" aria-pressed={mineOnly} disabled={navigationLocked} onClick={() => setMineOnly(value => !value)}>{t.labelMyCards}</Button>
        </DeckHeaderHint>
        <label className="catalog-search deck-toolbar-search"><Search size={14} /><span className="visually-hidden">{t.searchCards(searchScope)}</span><input ref={searchField} type="search" value={search} disabled={navigationLocked} onChange={event => setSearch(event.target.value)} placeholder={t.searchDeck} /></label>
        <DeckHeaderHint label={t.includeShelved}>
          <Button type="button" variant="ghost" size="sm" className="deck-archive-toggle" aria-pressed={includeShelved} disabled={navigationLocked} onClick={() => setIncludeShelved(value => !value)}><Archive size={14} />{t.labelArchiveTrash}</Button>
        </DeckHeaderHint>
      </div>
      </Tooltip.Provider>}
    </header> : <header className={'deck-heading catalog-heading' + (!showCards ? ' deck-gallery-header' : '')}>{!showCards ? <div className="deck-gallery-project">{writable && <Button variant="outline" size="icon" className="deck-gallery-add" onClick={event => { creationOpener.current = event.currentTarget; setCreation({ kind: 'space' }); }} disabled={navigationLocked || !catalog} aria-label={t.labelCreateSpace} title={t.labelCreateSpace}><Plus size={22} /></Button>}<div className="deck-gallery-title"><h1>{snapshot.projectName}</h1>
      {/* 2026-11-06: a first-run folder has nothing to count; the template prompt below already says what to do. */}
      {catalog && (catalog.documents.length > 0 || catalog.cards.length > 0) && <CatalogSourceLine documents={catalog.documents.length} kinds={lookups.kindCounts} warnings={catalog.warnings.length} warningsOpen={sourceWarningsOpen} onToggleWarnings={() => setSourceWarningsOpen(open => !open)} />}</div></div> :<div><h1>{title}</h1><p>{snapshot.projectName}{catalog && <><span className="dot-separator">·</span>{t.cardsCountLong(scopedCards.length)}</>}</p></div>}<div className="catalog-heading-actions">{loading && catalog && <span className="catalog-updating" role="status"><LoaderCircle size={14} className="spin" />{t.updating}</span>}
      {!showCards && catalog && <div className="deck-gallery-search"><label className="catalog-search"><Search size={20} /><span className="visually-hidden">{t.deckSearchLabel}</span><input type="search" value={deckSearch} disabled={navigationLocked} onChange={event => setDeckSearch(event.target.value)} placeholder={t.searchDecks} />{deckSearch && <button type="button" disabled={navigationLocked} onClick={() => setDeckSearch('')} aria-label={t.clearDeckSearch} title={t.clearSearch}><X size={14} /></button>}</label><span role="status" className="visually-hidden">{t.deckResults(visibleDecks.length, catalog.decks.length)}</span></div>}
      {!showCards && browserNavigation}</div></header>}

    {error && <div className="catalog-error" role="alert"><span>{error}</span><Button variant="outline" size="sm" disabled={loading || pending} onClick={() => void refresh()}>{t.refresh}</Button></div>}
    {warning && <div className="catalog-notice catalog-saved-warning" role="status"><span>{warning}</span><Button variant="outline" size="sm" disabled={loading || pending} onClick={() => void refresh()}>{t.refresh}</Button><Button variant="ghost" size="icon" aria-label={t.dismissSaveNotice} onClick={dismissWarning}><X size={15} /></Button></div>}
    {!catalog && <p className="catalog-empty" role="status">{loading ? t.loadingCatalog : t.catalogNotLoaded}</p>}
    {catalog && <>
      {!selectedDeck && showCards && browserNavigation}
      {!showCards && catalog.warnings.length > 0 && <ul id="catalog-source-warnings" className="catalog-warnings" aria-label={t.sourceWarnings(catalog.warnings.length)} hidden={!sourceWarningsOpen}>{catalog.warnings.map((item, index) => <li key={index}>{item}</li>)}</ul>}

      {!showCards && catalog.decks.length === 0 && onStartFromTemplate && <section className="project-template-start"><div><h2>{t.startTemplateTitle}</h2><p>{t.startTemplateHelp}</p></div><Button disabled={navigationLocked} onClick={onStartFromTemplate}><Layers size={16} />{t.startTemplate}</Button></section>}
      {!showCards && <ProjectPulseStrip source={snapshot.source} refreshKey={`${refreshKey}:${catalog.indexedAt}`} members={catalog.members ?? []} disabled={navigationLocked}
        onInProgress={() => openPulseCards('started')} onReview={deckId => openPulseCards('review', deckId)}
        onWithoutDeck={() => { openCardView('unassigned'); setIncludeShelved(false); }}
        onRun={id => { if (!navigationLocked) navigateToPlanning(snapshot.source, catalog.rootIdentity, { kind: 'run', id }); }} />}

      {!showCards && deckSearchText && <p className="deck-gallery-search-status">{t.foundDecks(visibleDecks.length, catalog.decks.length)}</p>}
      {selectedTrack && !selectedDeck && <div className="catalog-track-context"><Route size={16} /><div><strong>{selectedTrack.title}</strong>{selectedTrack.description && <p>{selectedTrack.description}</p>}<span>{t.trackProgress(trackProgress?.accepted ?? 0, trackProgress?.total ?? 0)}</span></div><Button variant="ghost" size="sm" disabled={navigationLocked} onClick={() => openCardView('all')}>{t.leaveTrack}</Button></div>}
      {showCards && !selectedDeck && <div className="catalog-card-search-row"><label className="catalog-search"><Search size={16} /><span className="visually-hidden">{t.searchCards(searchScope)}</span><input ref={searchField} type="search" value={search} disabled={navigationLocked} onChange={event => setSearch(event.target.value)} placeholder={t.search(searchScope)} /></label></div>}

      {creation && <CatalogForm key={creation.kind + ':' + (creation.spaceId ?? '') + ':' + (creation.deckId ?? '')} creation={creation} catalog={catalog} source={snapshot.source} disabled={!writable || pending} pending={pending} onCancel={closeCreation} onSaved={closeCreation} onSubmit={edit} onDirtyChange={setCreationDirty} dirty={creationDirty} opener={creationOpener} />}
      {journeyDeckId && catalog.decks.some(deck => deck.id === journeyDeckId) && <JourneyTemplatePanel key={journeyDeckId} catalog={catalog} deck={catalog.decks.find(deck => deck.id === journeyDeckId)!} source={snapshot.source} initialJourneyId={requestedJourneyId} writable={writable} pending={pending} onEdit={edit} onClose={() => { setJourneyDeckId(null); setRequestedJourneyId(null); }} onRestoreFocus={restoreJourneyFocus} />}
      {/* 2026-11-06: the notice serves files that exist without a catalog; a first-run folder has nothing to report. */}
      {!catalog.configured && catalog.documents.length > 0 && <p className="catalog-notice">{t.notConfigured}</p>}
      {!showCards && <CatalogSpaces key={`${snapshot.source}:${catalog.rootIdentity}`} catalog={catalog} deckCounts={deckCounts} visibleDecks={visibleDecks} filtering={Boolean(deckSearchText)} source={snapshot.source} writable={writable} disabled={navigationLocked} collapsed={collapsedSpaces} onToggle={toggleSpace} onOpen={openDeck} onForm={(form, opener) => { creationOpener.current = opener ?? null; setCreation(form); }} onEdit={edit} />}

      {!selectedDeck && selectionToolbar && <div ref={sticky.selection} className="catalog-selection-dock">{selectionToolbar}</div>}
      {showCards && <div className={'catalog-workbench' + (selectedDeck ? ' has-action-rail' : '')}>
        {selectedDeck && <Tooltip.Provider delayDuration={200}><nav className="deck-action-rail" aria-label={t.deckActions}>
          {writable && <DeckHeaderHint side="right" label={t.labelAddCard} keys={["N"]}><Button variant="ghost" size="icon" aria-label={t.labelNewCard} disabled={navigationLocked} onClick={() => newCard()}><Plus size={20} /></Button></DeckHeaderHint>}
          <DeckHeaderHint side="right" label={t.showInfoSidebar}><Button variant="ghost" size="icon" aria-label={t.labelInfo} aria-pressed={activeDeckPanel === 'info'} disabled={navigationLocked} onClick={() => showDeckPanel('info')}><Info size={20} /></Button></DeckHeaderHint>
          <DeckHeaderHint side="right" label={t.labelOpenOrderPanel} keys={['Shift', 'O']} note={orderDiffersFromDefault ? t.customOrderHint : undefined}><Button variant="ghost" size="icon" aria-label={t.labelOrdering} aria-pressed={activeDeckPanel === 'ordering'} disabled={navigationLocked} onClick={() => showDeckPanel('ordering')}><ArrowDownUp size={20} /></Button></DeckHeaderHint>
          <DeckHeaderHint side="right" label={t.showTags} keys={['Shift', 'T']}><Button variant="ghost" size="icon" aria-label={t.labelTags} aria-pressed={activeDeckPanel === 'tags'} disabled={navigationLocked} onClick={() => showDeckPanel('tags')}><Hash size={20} /></Button></DeckHeaderHint>
          <DeckHeaderHint side="right" label={t.labelActivity}><Button variant="ghost" size="icon" aria-label={t.labelActivity} aria-pressed={activeDeckPanel === 'activity'} disabled={navigationLocked} onClick={() => showDeckPanel('activity')}><History size={20} /></Button></DeckHeaderHint>
        </nav></Tooltip.Provider>}
        <div className={'catalog-content-layout' + (hasPreview ? ' has-preview' : '') + (showSummary ? (narrowPanel ? ' has-narrow-panel' : ' has-summary') : '')}>
        {hasPreview ? <><div className="catalog-preview-slot">{composer ? <CardComposer key={snapshot.source + ':new:' + composer.deckId + ':' + composer.parentId + ':' + composer.zoneId} catalog={catalog} snapshot={snapshot} initialDeckId={composer.deckId} initialParentId={composer.parentId} initialPriority={composer.priority} initialZoneId={composer.zoneId} pending={pending} onEdit={edit} onClose={closeComposer} onCreated={cardCreated} onDirtyChange={setMembershipDirty} /> : selectedCard && <CardPreview key={snapshot.source + ':' + selectedCard.id} card={selectedCard} catalog={catalog} snapshot={snapshot} writable={writable && lookups.cardById.has(selectedCard.id)} pending={pending || familyDirty} onClose={() => closeCard()} onSelect={openCard}
          onOpenSubCard={card => openHeroSubCard(card, 'journey')} onReturnToHero={returnHero ? () => { returnToHero(); } : undefined}
          onEdit={edit} onDirtyChange={setMembershipDirty} onShowTagCards={name => { openCardView('all'); setTagFilter(name); }} onOpenDeck={selectedCard.deckId && selectedCard.deckId !== deckScopeId ? () => showCardInDeck(selectedCard.id, selectedCard.deckId!) : undefined} onManageJourney={selectedCard.deckId ? opener => { journeyReturnFocus.current = opener ?? null; closeInlinePanels(); setJourneyDeckId(selectedCard.deckId); } : undefined} familyVisible={showFamily} onShowFamily={() => { if (navigationLocked) return; setFamilyVisible(true); }} onToggleFamily={() => { if (navigationLocked) return; if (showFamily) resetFamilyContext(); else setFamilyVisible(true); }} />}</div><PanelResize label={t.leftPanelWidth} value={panels.leftPanelWidth} minimum={420} maximum={800} direction={1} onChange={panels.setLeftPanelWidth} /></> : <>{showSummary && selectedDeck && (narrowPanel ? <aside className="deck-summary deck-narrow-panel">{activeDeckPanel === 'ordering'
          ? <CardOrdering value={ordering} onChange={changeOrdering} disabled={navigationLocked} inDeck hideEmpty={hideEmptyZones} onHideEmpty={setHideEmptyZones} view={resolvedView} onViewChange={setCardView}
            defaultView={{ canReset: orderingChoice !== null && orderDiffersFromDefault, canSave: writable && orderDiffersFromDefault, onReset: resetOrdering, onSave: () => void saveDefaultOrdering() }} />
          : <DeckTagsPanel cards={visibleCards} projectTags={catalog.projectTags} pick={tagPick} active={tagPickActive} disabled={navigationLocked} onPick={pickTags} />}</aside>
          : <><>{activityOpen ? <aside className="deck-summary deck-activity-sidebar"><DeckActivity deckId={selectedDeck.id} source={snapshot.source} refreshKey={refreshKey + ":" + catalog.indexedAt} disabled={navigationLocked} onOpen={id => { const card = lookups.cardById.get(id); if (card) openCard(card); }} /></aside> : <DeckSummary deck={selectedDeck} cards={lookups.cardsByDeck.get(selectedDeck.id) ?? emptyCards} catalog={catalog} source={snapshot.source} refreshKey={refreshKey + ":" + catalog.indexedAt} onOpen={id => { const card = lookups.cardById.get(id); if (card) openCard(card); }} disabled={navigationLocked} onCollapse={() => panels.setSummaryCollapsed(true)} onTrack={id => openCardView('all', id)} />}</><PanelResize label={t.leftPanelWidth} value={panels.leftPanelWidth} minimum={420} maximum={800} direction={1} onChange={panels.setLeftPanelWidth} /></>)}</>}
        <div className="catalog-results" ref={attachResults} role="region" aria-label={t.cards} tabIndex={-1}>
          {showFamily && selectedCard && familyRoot ? <CardFamilyPanel key={familyRoot.id} source={snapshot.source} createRequest={familyCreationRequest?.parentId === familyRoot.id ? familyCreationRequest.sequence : 0} card={selectedCard} hero={familyDraftParent ?? familyHero} children={familyCards} openedId={selectedCard.id} catalog={catalog} disabled={navigationLocked} writable={writable} onOpen={openCard} onOpenSubCard={card => openHeroSubCard(card, 'family')}
            onCreate={newCard} onAttach={() => { closeInlinePanels(); setAttachmentHeroId(familyRoot.id); }} onChooseParent={chooseParent} onDetach={detachCard} onReorder={reorderSubCards} onRefresh={refresh} pending={pending} onCreateCard={edit} onCreated={familyCardCreated} onCreateDirtyChange={setFamilyDirty} onCreateSessionChange={setFamilyDraftParentId} onCreateRequestHandled={sequence => setFamilyCreationRequest(request => request?.sequence === sequence ? null : request)} onEdit={edit} onCancelParentPicker={() => setParentPicker(null)} parentPicker={parentPicker ? <CardParentPicker embedded card={parentPicker.card} catalog={catalog} pending={pending} onChoose={saveParent} onPromote={promoteParent} onClose={() => setParentPicker(null)} /> : undefined} /> : <>
          {!selectedDeck && <div className="catalog-results-toolbar">
            <div className="catalog-view-toggle" aria-label={t.labelCardview}><Button variant="ghost" size="sm" aria-pressed={resolvedView === 'cards'} onClick={() => setCardView('cards')}><LayoutGrid size={13} />{t.labelCards}</Button><Button variant="ghost" size="sm" aria-pressed={resolvedView === 'table'} onClick={() => setCardView('table')}><Table2 size={13} />{t.labelTable}</Button></div>
            <div className="catalog-panel-controls">
              <Button variant="ghost" size="sm" disabled={navigationLocked} aria-expanded={orderingOpen} aria-controls="catalog-ordering-panel" onClick={() => setOrderingOpen(!orderingOpen)}>{t.labelOrdering}</Button>
            </div>
          </div>}
          <div id="catalog-ordering-panel" className="catalog-ordering-panel" hidden={!orderingOpen || Boolean(selectedDeck)}><CardOrdering value={ordering} onChange={changeOrdering} disabled={navigationLocked} /></div>
          <div className={hasFilters || !selectedDeck ? "catalog-result-summary" : "visually-hidden"}><span role="status">{t.cardResults(searchScope, visibleCards.length, scopedCards.length)}</span>{hasFilters && <Button variant="ghost" size="sm" disabled={navigationLocked} onClick={resetCardFilters}>{t.resetFilters}</Button>}</div>
          {labeledLaneSearch.length > 0 && <div className="deck-lane-search" aria-label={t.laneFilters}>{labeledLaneSearch.map((entry, index) => <button type="button" key={entry.ordering.order + ':' + entry.key} className="deck-panel-button" disabled={navigationLocked} aria-label={t.removeFilter(entry.title)} onClick={() => setLaneSearch(entries => entries.filter((_, position) => position !== index))}>{entry.title}<X size={12} aria-hidden="true" /></button>)}</div>}
          {visibleCards.length === 0 && !manualOrdering && <p className="catalog-empty">{cardsEmptyText}</p>}
          {resolvedView === 'table'
            ? <CatalogTable groups={shownGroups} transfer={cardTransfer} pointerDrag={Boolean(cardDragPreview)} lookups={lookups} members={members} tagDefinitions={catalog.projectTags} catalog={catalog} currentMemberId={currentMember?.id} openedId={selectedCard?.id} selectedIds={selection.selectedIds} disabled={draftLocked} onOpen={activateCard} onFamilyOpen={openCard} onToggle={selection.toggle} onToggleGroup={selection.toggleGroup} onFilterGroup={filterGroup} onCreateGroup={writable ? createGroupCard : undefined} laneOf={laneOfGroup} zoneOf={zoneControlsOf} zoneDrag={zoneDrag} manualDrop={manualDrop} />
            : <>
              {shownGroups.map(group => <CatalogCardGroupSection key={group.key} group={group} pointerDrag={Boolean(cardDragPreview)} baseline={cardTransfer} lane={laneOfGroup(group)} zoneDrag={zoneDrag} catalogCards={cards}>
                {group.key !== 'all' && <CardGroupHeading group={group} tagDefinitions={catalog.projectTags} lookups={lookups} selectedIds={selection.selectedIds} disabled={navigationLocked} onToggleGroup={selection.toggleGroup} onFilter={filterGroup} onCreate={writable ? () => createGroupCard(group) : undefined} zone={zoneControlsOf(group)} />}
                <VirtualCardGrid cards={group.cards} enabled={orderedCards.length >= 50} pinnedIds={pinnedTileIds}>{card => <ManualCardDrop key={card.id} cardId={card.id} enabled={manualDrop} deckId={scope.kind === 'deck' ? scope.id : ''} zoneId={zoneIdOfGroup(group)}>
                  <CatalogCardTile card={card} {...tileDataById.get(card.id)!} members={members} tagDefinitions={catalog.projectTags} currentMemberId={currentMember?.id} calendarDay={calendarDay} selected={selectedCard?.id === card.id} checked={selection.selectedIds.has(card.id)} selectionActive={selection.selectedIds.size > 0} disabled={draftLocked} onToggle={toggleTile} onOpen={activateTile} onFamilyOpen={openTileFamily}
                    onQuickSettings={writable && !navigationLocked && !cardTransfer && !showFamily ? openTileQuickSettings : undefined} />
                </ManualCardDrop>}</VirtualCardGrid>
              </CatalogCardGroupSection>)}
            </>}
          {manualOrdering && writable && <AddZoneControl disabled={navigationLocked || pending} onAdd={title => addZone(title)} />}
          </>}
        </div>
        {!showFamily && <DeckHoveredCardActions ref={hoveredCardActions} key={selectionKey} root={resultsRoot} catalog={catalog} lookups={lookups} snapshot={snapshot} writable={writable} locked={navigationLocked || Boolean(cardTransfer)} onEdit={edit} onSelect={selection.toggle} />}
      </div>{cardTransfer && cardDragPreview && <CardGroupDropPanel groups={dragGroups} baseline={cardTransfer} laneOf={laneOfGroup} catalogCards={cards} />}</div>}
      {attachmentHeroId && lookups.cardById.get(attachmentHeroId) && <AttachSubCards key={attachmentHeroId} hero={lookups.cardById.get(attachmentHeroId)!} catalog={catalog} writable={writable} pending={pending} onAttach={attachCards} onClose={() => setAttachmentHeroId(null)} />}
    </>}
    {cardTransfer && catalog && <CardTransferTargets baseline={cardTransfer} catalog={catalog} source={snapshot.source} />}
    {cardTransfer && cardDragPreview && catalog && <CardDragTabs baseline={cardTransfer} catalog={catalog} memberLabel={currentMember?.label} />}
    {dropDeckPicker && catalog && <CardDropDeckPicker baseline={dropDeckPicker} catalog={catalog} onClose={() => setDropDeckPicker(null)} onChoose={deck => {
      if (deck && cardTransferTargetIssue(dropDeckPicker, deck, cards) === 'confirm-promotion') {
        setDropDeckPicker(null);
        setDropHeroPromotion({ baseline: dropDeckPicker, deck });
        return;
      }
      const request = cardTransferRequest(dropDeckPicker, deck, cards);
      if (request) { const ownsSelection = dropDeckPicker.ownsSelection; setDropDeckPicker(null); void moveCardsToDeck(request, ownsSelection); }
    }} />}
    {dropHeroPromotion && <CardHeroPromotionConfirmation deckTitle={dropHeroPromotion.deck.title} busy={pending}
      onConfirm={() => { void promoteDroppedCard(); }} onCancel={() => setDropHeroPromotion(null)} />}
    <ShortcutsHelp screens={shortcutScreens} writable={writable} />
  </section>
  <DragOverlay dropAnimation={null} adjustScale={false} style={{ pointerEvents: 'none' }}>{cardTransfer && cardDragPreview && <CardDragFace preview={cardDragPreview} count={cardTransfer.cards.length} />}{cardTransfer && !cardDragPreview && <div className="card-transfer-overlay"><Layers size={14} /><strong>{cardTransfer.cards[0].title}</strong>{cardTransfer.cards.length > 1 && <span className="card-transfer-overlay-count">+{cardTransfer.cards.length - 1}</span>}</div>}{zoneDrag && <div className="card-transfer-overlay zone-transfer-overlay"><GripVertical size={14} /><strong>{currentZones().find(zone => zone.id === zoneDrag)?.title ?? t.zone}</strong></div>}</DragOverlay>
  </CardAttachmentRefreshContext.Provider></CardTransferContext.Provider></DndContext>;
}

const coverCollisions: CollisionDetection = arguments_ => {
  // A pointer outside a drop zone has no target; overlay overlap must not choose a neighbor (2026-11-03).
  const coordinates = arguments_.pointerCoordinates ?? { x: arguments_.collisionRect.left + arguments_.collisionRect.width / 2, y: arguments_.collisionRect.top + arguments_.collisionRect.height / 2 };
  let candidates = pointerWithin({ ...arguments_, pointerCoordinates: coordinates });
  const dataOf = (id: unknown) => arguments_.droppableContainers.find(container => container.id === id)?.data.current;
  if (arguments_.pointerCoordinates) candidates = candidates.filter(hit => {
    const container = arguments_.droppableContainers.find(candidate => candidate.id === hit.id);
    const rail = container?.node.current?.closest('.deck-neighbor-rail');
    if (!rail) return true;
    const rectangle = rail.getBoundingClientRect();
    return coordinates.x >= rectangle.left && coordinates.x <= rectangle.right && coordinates.y >= rectangle.top && coordinates.y <= rectangle.bottom;
  });
  // 2026-11-05: clipped rows keep full DnD rectangles; only the visible menu/panel viewport can accept them.
  for (const surface of ['card-deck-menu', 'card-group-panel']) {
    if (candidates.some(hit => dataOf(hit.id)?.surface === surface && dataOf(hit.id)?.operation === 'card-drop-blocker')) continue;
    candidates = candidates.filter(hit => dataOf(hit.id)?.surface !== surface);
  }
  // 2026-11-05: opaque panels intercept drops even on disabled rows and padding; the cards behind them are not targets.
  for (const surface of ['card-navigation', 'card-deck-menu', 'card-group-panel']) {
    const hits = candidates.filter(hit => dataOf(hit.id)?.surface === surface);
    if (!hits.length) continue;
    const targets = hits.filter(hit => dataOf(hit.id)?.operation !== 'card-drop-blocker');
    return targets.length ? targets : hits;
  }
  // The card/row under the pointer is a more precise Manual Order target than its surrounding Zone.
  const insertions = candidates.filter(hit => dataOf(hit.id)?.operation === 'card-zone' && dataOf(hit.id)?.beforeCardId);
  if (insertions.length) return insertions;
  const kindOf = (id: unknown) => dataOf(id)?.kind;
  // Most specific first: a deck tile, then the end-of-space tile, then the space itself.
  for (const kind of ['deck', 'end']) { const hits = candidates.filter(hit => kindOf(hit.id) === kind); if (hits.length) return hits; }
  return candidates;
};

const coverKeyboardCoordinates: KeyboardCoordinateGetter = (event, { currentCoordinates, context }) => {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.code) || !context.collisionRect) return;
  event.preventDefault();
  const rectangle = context.collisionRect;
  const center = { x: rectangle.left + rectangle.width / 2, y: rectangle.top + rectangle.height / 2 };
  const containers = context.droppableContainers.getEnabled().filter(container => { const rect = context.droppableRects.get(container.id); return rect && rect.width > 0 && rect.height > 0; });
  const candidates = containers.filter(container => container.id !== context.over?.id && (container.data.current?.kind === 'deck' || !containers.some(other => other.data.current?.kind === 'deck' && other.data.current?.spaceId === container.data.current?.spaceId))).map(container => {
    const rect = context.droppableRects.get(container.id)!;
    const position = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    return { position, horizontal: position.x - center.x, vertical: position.y - center.y };
  }).filter(candidate => {
    if (event.code === 'ArrowRight') return candidate.horizontal > 1;
    if (event.code === 'ArrowLeft') return candidate.horizontal < -1;
    if (event.code === 'ArrowDown') return candidate.vertical > 1;
    return candidate.vertical < -1;
  });
  const horizontal = event.code === 'ArrowLeft' || event.code === 'ArrowRight';
  candidates.sort((first, second) => {
    const score = (candidate: typeof first) => horizontal ? Math.abs(candidate.horizontal) + Math.abs(candidate.vertical) * 3 : Math.abs(candidate.vertical) + Math.abs(candidate.horizontal) * 3;
    return score(first) - score(second);
  });
  const target = candidates[0]?.position;
  return target ? { x: currentCoordinates.x + target.x - center.x, y: currentCoordinates.y + target.y - center.y } : undefined;
};

// Deck order on the main screen: spaceId -> deck ids, in the order the tiles are shown.
type DeckLayout = Record<string, string[]>;

function deckLayoutOf(spaces: CatalogSpace[], decks: CatalogDeck[]): DeckLayout {
  const layout: DeckLayout = Object.fromEntries(spaces.map(space => [space.id, [] as string[]]));
  for (const deck of decks) (layout[deck.spaceId] ??= []).push(deck.id);
  return layout;
}

function spaceOfDeck(layout: DeckLayout, deckId: string): string | undefined {
  return Object.keys(layout).find(spaceId => layout[spaceId].includes(deckId));
}

// 2026-11-04: hit-testing shifted tiles made the insertion gap jump between targets. @dnd-kit/sortable uses transforms,
// while targeting uses the nearest resting tile center within the space under the pointer to keep the gap stable.
const deckSortCollisions: CollisionDetection = arguments_ => {
  const pointer = arguments_.pointerCoordinates;
  const kindOf = (container: { data: { current?: { kind?: unknown } } }) => container.data.current?.kind;
  // 2026-11-06: the keyboard sensor moves the collision rectangle without a pointer; a surrounding space is not a tile.
  if (!pointer) return closestCenter({ ...arguments_, droppableContainers: arguments_.droppableContainers.filter(container => kindOf(container) === 'deck' || kindOf(container) === 'end') });
  const under = pointerWithin({ ...arguments_, droppableContainers: arguments_.droppableContainers.filter(container => kindOf(container) === 'space' || kindOf(container) === 'end') });
  const end = under.find(hit => arguments_.droppableContainers.find(container => container.id === hit.id)?.data.current?.kind === 'end');
  if (end) return [end];
  const space = under[0] ? arguments_.droppableContainers.find(container => container.id === under[0].id)?.data.current?.spaceId : undefined;
  if (space === undefined) return [];
  const scored = arguments_.droppableContainers.flatMap(container => {
    if (kindOf(container) !== 'deck' || container.data.current?.spaceId !== space) return [];
    const rect = arguments_.droppableRects.get(container.id);
    if (!rect) return [];
    const value = Math.hypot(rect.left + rect.width / 2 - pointer.x, rect.top + rect.height / 2 - pointer.y);
    return [{ id: container.id, data: { droppableContainer: container, value } }];
  }).sort((first, second) => first.data.value - second.data.value);
  return scored.length ? [scored[0]] : under.slice(0, 1);
};

function CatalogSpaces({ catalog, deckCounts, visibleDecks, filtering, source, writable, disabled, collapsed, onToggle, onOpen, onForm, onEdit }: { catalog: CatalogView; deckCounts: Map<string | null, DeckCardCounts>; visibleDecks: CatalogDeck[]; filtering: boolean; source: WorkspaceSnapshot['source']; writable: boolean; disabled: boolean; collapsed: ReadonlySet<string>; onToggle: (id: string) => void; onOpen: (deck: CatalogDeck) => void; onForm: (form: Creation, opener?: HTMLElement) => void; onEdit: CatalogEditor }) {
  const t = useText(text);
  const [dragged, setDragged] = useState<CatalogDeck | null>(null);
  // The order on screen while dragging, and after a drop until the server catalog brings the same order back.
  const [dragLayout, setDragLayout] = useState<DeckLayout | null>(null);
  // 2026-11-06: only the shelf is sorted by dragging; the pile keeps the catalog order after it. A drop at the end of a shelf
  // sends beforeDeckId null (the end of the space), so a piled deck between two shelf decks never blocks the move.
  const shelves = useMemo(() => shelfAndPile(visibleDecks), [visibleDecks]);
  const baseLayout = useMemo(() => deckLayoutOf(catalog.spaces, shelves.shelf), [catalog.spaces, shelves.shelf]);
  const piles = useMemo(() => deckLayoutOf(catalog.spaces, shelves.pile), [catalog.spaces, shelves.pile]);
  // Piles opened during this visit; a deck search opens every pile, so a match is never hidden in one.
  const [openPiles, setOpenPiles] = useState<ReadonlySet<string>>(() => new Set());
  const layout = dragLayout ?? baseLayout;
  const decksById = useMemo(() => new Map(catalog.decks.map(deck => [deck.id, deck])), [catalog.decks]);
  // A fresh catalog is the truth: it ends the optimistic order of the last drop (or reverts a refused move).
  useEffect(() => { if (!dragged) setDragLayout(null); }, [baseLayout]);
  // A drag ends with a pointerup over the tile; the click that follows must not open the deck.
  const clickBlockedUntil = useRef(0);
  // Layout motion only animates server-driven reorders; while a drag or its optimistic result is on screen, sortable owns motion.
  const coverMotion = useCardLayoutMotion<HTMLDivElement>({ layoutKey: JSON.stringify([baseLayout, piles, [...openPiles]]), resetKey: source, dragging: Boolean(dragged) || dragLayout !== null });
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates, keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] } }));
  function start(event: DragStartEvent) {
    clickBlockedUntil.current = Number.POSITIVE_INFINITY;
    setDragLayout(baseLayout);
    setDragged(decksById.get(String(event.active.id)) ?? null);
  }
  // Only a move into another space changes the lists while dragging; inside one space sortable slides the tiles itself.
  function over({ active, over: target }: DragOverEvent) {
    if (!target) return;
    const activeId = String(active.id);
    setDragLayout(current => {
      const lists = current ?? baseLayout;
      const from = spaceOfDeck(lists, activeId);
      const kind = target.data.current?.kind;
      const to = kind === 'deck' ? spaceOfDeck(lists, String(target.id)) : String(target.data.current?.spaceId ?? '');
      if (!from || !to || from === to || !(to in lists)) return current;
      const items = lists[to].filter(id => id !== activeId);
      let index = items.length;
      if (kind === 'deck') {
        const moving = active.rect.current.translated;
        const after = moving ? moving.left + moving.width / 2 > target.rect.left + target.rect.width / 2 : false;
        index = items.indexOf(String(target.id)) + (after ? 1 : 0);
      }
      return { ...lists, [from]: lists[from].filter(id => id !== activeId), [to]: [...items.slice(0, index), activeId, ...items.slice(index)] };
    });
  }
  function cancel() { setDragged(null); setDragLayout(null); clickBlockedUntil.current = Date.now() + 300; }
  function finish({ active, over: target }: DragEndEvent) {
    const activeId = String(active.id);
    let next = dragLayout ?? baseLayout;
    const space = spaceOfDeck(next, activeId);
    if (target && space) {
      const items = next[space];
      const kind = target.data.current?.kind;
      if (kind === 'deck' && spaceOfDeck(next, String(target.id)) === space && target.id !== active.id) next = { ...next, [space]: arrayMove(items, items.indexOf(activeId), items.indexOf(String(target.id))) };
      if (kind === 'end' && target.data.current?.spaceId === space) next = { ...next, [space]: [...items.filter(id => id !== activeId), activeId] };
    }
    setDragged(null);
    clickBlockedUntil.current = Date.now() + 300;
    const deck = decksById.get(activeId);
    const spaceId = spaceOfDeck(next, activeId);
    if (!deck || !spaceId || !target || disabled || !writable) { setDragLayout(null); return; }
    const beforeDeckId = next[spaceId][next[spaceId].indexOf(activeId) + 1] ?? null;
    const original = baseLayout[deck.spaceId] ?? [];
    if (spaceId === deck.spaceId && beforeDeckId === (original[original.indexOf(deck.id) + 1] ?? null)) { setDragLayout(null); return; }
    setDragLayout(next);
    void onEdit({ action: 'move-deck', deckId: deck.id, spaceId, beforeDeckId }).then(saved => { if (!saved) setDragLayout(null); });
  }
  const canOpen = () => !dragged && Date.now() > clickBlockedUntil.current;
  function togglePile(spaceId: string) {
    setOpenPiles(previous => {
      const next = new Set(previous);
      if (!next.delete(spaceId)) next.add(spaceId);
      return next;
    });
  }
  const decksOf = (ids: readonly string[]) => ids.map(id => decksById.get(id)).filter((deck): deck is CatalogDeck => Boolean(deck));
  const spaceTitle = dragged ? catalog.spaces.find(space => space.id === spaceOfDeck(layout, dragged.id))?.title ?? '' : '';
  return <DndContext sensors={sensors} collisionDetection={deckSortCollisions} measuring={{ droppable: { strategy: MeasuringStrategy.Always } }} onDragStart={start} onDragOver={over} onDragEnd={finish} onDragCancel={cancel}>
    <div ref={coverMotion} className={'catalog-spaces' + (dragged ? ' is-dragging' : '')}>
      <p className="visually-hidden" role="status">{dragged ? t.moveToSpace(spaceTitle) : ''}</p>
      {catalog.spaces.length === 0 && <p className="catalog-empty">{t.noSpaces}{writable ? t.createSpaceHelp : t.sandboxSpaceHelp}</p>}
      {filtering && visibleDecks.length === 0 && <p className="catalog-empty">{t.noDeckMatches}</p>}
      {catalog.spaces.filter(space => !filtering || visibleDecks.some(deck => deck.spaceId === space.id)).map(space => {
        const spaceIndex = catalog.spaces.indexOf(space);
        const ids = layout[space.id] ?? [];
        const pile = decksOf(piles[space.id] ?? []);
        const pileOpen = filtering || openPiles.has(space.id);
        const spaceCollapsed = !filtering && collapsed.has(space.id);
        const tileProps = (deck: CatalogDeck) => ({ deck, source, counts: deckCounts.get(deck.id) ?? emptyDeckCounts, disabled, writable, inbox: deck.id === (catalog.inboxDeckId ?? null), canOpen, onOpen: () => onOpen(deck), onSettings: () => onForm({ kind: 'deck', deckId: deck.id, editing: true }) });
        return <SpaceDrop key={space.id} space={space} disabled={disabled || !writable}>
          <header className="catalog-space-heading"><h2><button type="button" disabled={filtering} aria-expanded={!spaceCollapsed} aria-controls={`space-${space.id}`} onClick={() => onToggle(space.id)}>{spaceCollapsed ? <ChevronRight size={17} /> : <ChevronDown size={17} />}<DeckIcon name={space.icon ?? spacePresets[space.kind ?? 'custom'].icon} size={17} /><span>{space.title}</span></button></h2>
            {writable && <div className="catalog-space-actions">
              <Button variant="ghost" size="icon" disabled={disabled} onClick={event => onForm({ kind: 'space', spaceId: space.id, editing: true }, event.currentTarget)} aria-label={t.configureSpace(space.title)}><Pencil size={14} /></Button>
              <Button variant="ghost" size="icon" disabled={disabled || spaceIndex === 0} aria-label={t.moveSpaceUp} title={t.moveSpaceUp} onClick={() => void onEdit({ action: 'move-space', spaceId: space.id, beforeSpaceId: catalog.spaces[spaceIndex - 1].id })}><ArrowUp size={14} /></Button>
              <Button variant="ghost" size="icon" disabled={disabled || spaceIndex === catalog.spaces.length - 1} aria-label={t.moveSpaceDown} title={t.moveSpaceDown} onClick={() => void onEdit({ action: 'move-space', spaceId: space.id, beforeSpaceId: catalog.spaces[spaceIndex + 2]?.id ?? null })}><ArrowDown size={14} /></Button>
            </div>}
          </header>
          <div id={`space-${space.id}`} hidden={spaceCollapsed}><SortableContext items={ids} strategy={rectSortingStrategy}><div className="catalog-deck-grid">
            {decksOf(ids).map(deck => <DeckCover key={deck.id} spaceId={space.id} {...tileProps(deck)} />)}
            {writable && !filtering && <AddDeckTile spaceId={space.id} disabled={disabled} onCreate={() => { if (canOpen()) onForm({ kind: 'deck', spaceId: space.id }); }} />}
            {pile.length > 0 && !filtering && <DeckPileToggle spaceId={space.id} decks={pile} open={pileOpen} disabled={disabled} onToggle={() => { if (canOpen()) togglePile(space.id); }} />}
            {pile.length > 0 && pileOpen && <div id={`pile-${space.id}`} className="catalog-pile-decks" role="group" aria-label={t.pileOf(space.title)}>
              {pile.map(deck => <DeckCoverTile key={deck.id} {...tileProps(deck)} />)}
            </div>}
          </div></SortableContext>{ids.length === 0 && pile.length === 0 && !writable && <p className="catalog-space-empty">{t.emptySpace}</p>}</div>
        </SpaceDrop>;
      })}
    </div>
    <DragOverlay dropAnimation={null} adjustScale={false} style={{ pointerEvents: 'none' }}>{dragged && <div className={`catalog-deck-cover catalog-cover-${dragged.style ?? 'symbol'} cover-drag-overlay`} style={coverStyle(dragged)}><CoverFace deck={dragged} source={source} counts={deckCounts.get(dragged.id) ?? emptyDeckCounts} inbox={dragged.id === (catalog.inboxDeckId ?? null)} /></div>}</DragOverlay>
  </DndContext>;
}

/** The pile at the end of a space: a fan of the piled decks that opens them in place and stays put as the Collapse control. */
function DeckPileToggle({ spaceId, decks, open, disabled, onToggle }: { spaceId: string; decks: CatalogDeck[]; open: boolean; disabled: boolean; onToggle: () => void }) {
  const t = useText(text);
  const fan = decks.slice(0, 3).reverse();
  const spread = fan.length > 1 ? 10 / (fan.length - 1) : 0;
  return <button type="button" className="catalog-pile" disabled={disabled} aria-expanded={open} aria-controls={open ? `pile-${spaceId}` : undefined} aria-label={open ? t.collapsePile : t.showPile(decks.length)} onClick={onToggle}>
    <span className="catalog-pile-fan" aria-hidden="true">{fan.map((deck, index) => <span key={deck.id} style={{ '--deck-color': deckColor(deck), '--fan': `${(fan.length > 1 ? -5 : 0) + index * spread}deg` } as CSSProperties} />)}</span>
    <span className="catalog-pile-label" aria-hidden="true">{open
      ? <><FoldHorizontal size={20} /><span>{t.collapsePile}</span></>
      : <><strong>{number(decks.length)}</strong><span>{t.inPile}</span></>}</span>
  </button>;
}

function AddDeckTile({ spaceId, disabled, onCreate }: { spaceId: string; disabled: boolean; onCreate: () => void }) {
  const t = useText(text);
  // Also the "end of space" drop target, so a deck can be dropped after the last one.
  const drop = useDroppable({ id: `end:${spaceId}`, disabled, data: { kind: 'end', spaceId } });
  return <button ref={drop.setNodeRef} type="button" className="catalog-add-deck" disabled={disabled} onClick={onCreate}>{t.labelAddDeck}</button>;
}

function SpaceDrop({ space, disabled, children }: { space: CatalogSpace; disabled: boolean; children: ReactNode }) {
  const { setNodeRef } = useDroppable({ id: `space:${space.id}`, disabled, data: { kind: 'space', spaceId: space.id } });
  return <section ref={setNodeRef} className="catalog-space">{children}</section>;
}

/** The deck color when it is a plain #rrggbb, else the neutral gray the catalog uses for a missing color. */
function deckColor(deck: Pick<CatalogDeck, 'color'>) {
  return /^#[\da-f]{6}$/iu.test(deck.color) ? deck.color : '#878787';
}

function coverStyle(deck: CatalogDeck): CSSProperties {
  const color = deckColor(deck);
  // 2026-11-06: the title sits on the band, and the band shows the deck color itself (--deck-face), so the ink is measured
  // against that color; measured against the retired #263348-mixed label gradient, mid tones fell to 3.76:1.
  let band = rgbOf(color);
  const light = [240, 239, 245];
  const dark = [27, 34, 48];
  let ink = contrastRatio(light, band) >= contrastRatio(dark, band) ? light : dark;
  // Mid-tone custom colors may fit neither text color: darken only the band, preserving the hue, the frame and the artwork.
  if (contrastRatio(ink, band) < 4.5) {
    ink = light;
    while (contrastRatio(ink, band) < 4.5) band = band.map(channel => Math.floor(channel * .94));
  }
  const hex = (values: Rgb) => '#' + values.map(channel => channel.toString(16).padStart(2, '0')).join('');
  return { '--deck-color': color, '--deck-band': hex(band), '--deck-ink': hex(ink) } as CSSProperties;
}

/** imageUrl replaces the deck's stored cover, as the settings preview does with a picked image; null shows the symbol. */
function CoverFace({ deck, counts, source, imageUrl, inbox = false }: { deck: CatalogDeck; counts: DeckCardCounts; source: WorkspaceSnapshot['source']; imageUrl?: string | null; inbox?: boolean }) {
  const t = useText(text);
  const style = deck.style ?? 'symbol';
  const storedImage = deck.cover ? `/api/file?source=${source}&path=${encodeURIComponent(deck.cover)}` : null;
  const image = style === 'artwork' ? (imageUrl === undefined ? storedImage : imageUrl) : null;
  const fallbackIcon = { asset: 'box', task: 'layers', knowledge: 'book', mixed: 'layers' }[deck.kind];
  // 2026-11-06: the lip shows accepted Tasks of all Tasks; a Hero's progress lives in its Sub Cards, so decks without Tasks have none.
  const progress = counts.tasks > 0 ? Math.round(counts.accepted / counts.tasks * 100) : null;
  // Cover layers: the sunken art window with the kinds in its corner, the title on the deck color, raised counters, the progress lip.
  return <>
    <span className={'catalog-cover-art' + (image ? '' : ' is-symbol')}>
      {image ? <img src={image} alt="" draggable={false} style={{ objectPosition: `center ${deck.coverPosition ?? 50}%` }} /> : <DeckIcon name={deck.icon || fallbackIcon} size={style === 'minimal' ? 22 : 38} />}
      <span className="catalog-cover-kinds">
        {/* The tray marks the Inbox deck next to its kinds; the kind dots themselves stay decorative. */}
        {inbox && <span className="catalog-cover-kind-badge is-inbox" title={t.inboxBadgeHint} role="img" aria-label={t.inboxBadgeHint}><Inbox size={11} /></span>}
        {deckKindBadges[deck.kind].map(kind => { const Icon = cardIcons[kind]; return <span key={kind} className={'catalog-cover-kind-badge is-' + kind} aria-hidden="true"><Icon size={11} /></span>; })}
      </span>
    </span>
    <strong className="catalog-cover-title">{deck.title || t.deckTitle}</strong>
    <span className="catalog-cover-foot"><DeckCounts counts={counts} /></span>
    {progress !== null && <span className="catalog-cover-progress" aria-hidden="true"><span style={{ width: `${progress}%` }} /></span>}
  </>;
}

interface DeckCoverProps { deck: CatalogDeck; counts: DeckCardCounts; source: WorkspaceSnapshot['source']; disabled: boolean; writable: boolean; inbox: boolean; canOpen: () => boolean; onOpen: () => void; onSettings: () => void }

/** A shelf deck: the whole tile is a drag handle; movement under 6 px remains a click that opens the deck. */
function DeckCover({ spaceId, ...props }: DeckCoverProps & { spaceId: string }) {
  // spaceId is where the tile is shown now — during a drag into another space it differs from deck.spaceId.
  const drag = useSortable({ id: props.deck.id, disabled: props.disabled || !props.writable, data: { kind: 'deck', deckId: props.deck.id, spaceId } });
  return <DeckCoverTile {...props} drag={drag} />;
}

/** A tile without drag is a piled deck shown in its opened pile: it opens and has settings, but is not sorted. */
export function DeckCoverTile({ deck, counts, source, disabled, writable, inbox, canOpen, onOpen, onSettings, drag }: DeckCoverProps & { drag?: ReturnType<typeof useSortable> }) {
  const t = useText(text);
  const deckKinds = useText(deckKindText);
  const cover = useRef<HTMLButtonElement>(null);
  const [titleClipped, setTitleClipped] = useState(false);
  const [titleHintOpen, setTitleHintOpen] = useState(false);
  useLayoutEffect(() => {
    const title = cover.current?.querySelector<HTMLElement>('.catalog-cover-title');
    if (!title) return;
    let active = true;
    const measure = () => { if (active) setTitleClipped(title.scrollHeight > title.clientHeight); };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(title);
    // Font loading can change the number of clipped lines without changing the two-line box's size.
    void document.fonts.ready.then(measure);
    return () => { active = false; observer.disconnect(); };
  }, [deck.title, deck.style]);
  const handle = drag && writable ? drag : null;
  // Deck covers stay level because tilt looks like a position shift in the overview.
  const motion: CSSProperties | undefined = drag ? { transform: drag.transform ? `translate3d(${Math.round(drag.transform.x)}px, ${Math.round(drag.transform.y)}px, 0)` : undefined, transition: drag.transition } : undefined;
  const label = `${deck.title}, ${deckKinds[deck.kind]}, ${deckCountLabel(counts)}${deck.piled ? t.inPileNote : ''}${handle ? t.spaceToMove : ''}`;
  return <article data-card-id={deck.id} ref={drag?.setNodeRef} style={motion} className={'catalog-cover-item' + (drag?.isDragging ? ' is-dragging' : '') + (deck.piled ? ' is-piled' : '')}>
    <Tooltip.Provider delayDuration={300} disableHoverableContent><Tooltip.Root open={titleHintOpen && titleClipped && !disabled && !drag?.isDragging} onOpenChange={open => setTitleHintOpen(open && canOpen())}>
      <Tooltip.Trigger asChild><button ref={cover} type="button" className={`catalog-deck-cover catalog-cover-${deck.style ?? 'symbol'}`} style={coverStyle(deck)} data-deck-cover={deck.id} {...(handle ? { ...handle.attributes, ...handle.listeners, role: undefined } : {})} onClick={() => { if (canOpen()) onOpen(); }} disabled={disabled} aria-label={label}><CoverFace deck={deck} counts={counts} source={source} inbox={inbox} /></button></Tooltip.Trigger>
      <Tooltip.Portal><Tooltip.Content className="deck-header-hint catalog-cover-title-tip" side="top" sideOffset={6} collisionPadding={12}>{deck.title}<Tooltip.Arrow /></Tooltip.Content></Tooltip.Portal>
    </Tooltip.Root></Tooltip.Provider>
    {writable && <button type="button" className="catalog-cover-settings" onClick={() => { if (canOpen()) onSettings(); }} disabled={disabled} aria-label={t.configureDeck(deck.title)}><Pencil size={14} /></button>}
  </article>;
}


interface CatalogFormProps {
  opener: RefObject<HTMLElement | null>;
  /** True once the form differs from what it opened with; Escape then keeps it open so input is not lost. */
  dirty: boolean;
  creation: Creation;
  catalog: CatalogView;
  source: WorkspaceSnapshot['source'];
  disabled: boolean;
  pending: boolean;
  onCancel: () => void;
  onSaved: () => void;
  onSubmit: CatalogEditor;
  onDirtyChange: (dirty: boolean) => void;
}

function CatalogForm(props: CatalogFormProps) {
  useEscapeToClose(props.creation.kind !== 'deck' && !props.pending && !props.dirty, props.onCancel, props.opener);
  if (props.creation.kind === 'space') return <SpaceForm {...props} />;
  if (props.creation.kind === 'deck') return <DeckSettingsForm {...props} />;
  return <TrackForm {...props} />;
}

function FormHeading({ title, pending, onCancel }: { title: string; pending: boolean; onCancel: () => void }) {
  const t = useText(text);
  return <header><h2>{title}</h2><Button type="button" size="icon" variant="ghost" disabled={pending} aria-label={t.closeForm} onClick={onCancel}><X size={17} /></Button></header>;
}

function SpaceForm({ creation, catalog, disabled, pending, onCancel, onSaved, onSubmit, onDirtyChange }: CatalogFormProps) {
  const t = useText(text);
  const form = useRef<HTMLFormElement>(null);
  useLayoutEffect(() => {
    form.current?.scrollIntoView({ block: 'start', inline: 'nearest' });
    form.current?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
  }, []);
  const deckKinds = useText(deckKindText);
  const descriptions = useText(spaceDescriptionText);
  const icons = useText(spaceIconText);
  const original = catalog.spaces.find(space => space.id === creation.spaceId);
  const [kind, setKind] = useState<SpaceKind>(original ? original.kind ?? 'custom' : 'gdd');
  const [customName, setCustomName] = useState(original?.title ?? '');
  const [icon, setIcon] = useState(original?.icon ?? spacePresets[kind].icon);
  const initialBeforeSpaceId = original ? catalog.spaces[catalog.spaces.indexOf(original) + 1]?.id ?? '' : '';
  const [beforeSpaceId, setBeforeSpaceId] = useState(initialBeforeSpaceId);
  const title = kind === 'custom' ? customName.trim() : spacePresets[kind].title;
  const dirty = original
    ? kind !== (original.kind ?? 'custom') || customName !== original.title || icon !== original.icon || beforeSpaceId !== initialBeforeSpaceId
    : kind !== 'gdd' || Boolean(customName) || icon !== spacePresets.gdd.icon;
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || !title) return;
    const action: CatalogAction = original
      ? { action: 'update-space', spaceId: original.id, title, kind, icon }
      : { action: 'create-space', title, kind, icon };
    if (!await onSubmit(action)) return;
    if (original && beforeSpaceId !== initialBeforeSpaceId
      && !await onSubmit({ action: 'move-space', spaceId: original.id, beforeSpaceId: beforeSpaceId || null })) return;
    onSaved();
  }
  return <form ref={form} className="catalog-create-form space-preset-form" onSubmit={event => void submit(event)}>
    <FormHeading title={original ? t.labelUpdateSpace : t.labelCreateSpace} pending={pending} onCancel={onCancel} />
    <fieldset disabled={disabled} className="space-preset-options">
      <legend className="visually-hidden">{t.labelSpacetype}</legend>
      {Object.entries(spacePresets).map(([value, preset]) => <label className="space-preset-option" key={value}>
        <input type="radio" name="space-kind" value={value} checked={kind === value} onChange={() => { setKind(value as SpaceKind); setIcon(preset.icon); }} />
        <DeckIcon name={preset.icon} size={19} /><span><strong>{preset.title}</strong>{descriptions[value as SpaceKind] && <span>{descriptions[value as SpaceKind]}</span>}</span>
      </label>)}
    </fieldset>
    <fieldset disabled={disabled} className="space-custom-fields">
      <label className="catalog-field">{t.labelIcon}<select value={icon} onChange={event => setIcon(event.target.value)}>{Object.entries(icons).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {kind === 'custom' && <label className="catalog-field">{t.labelCustomname}<input value={customName} onChange={event => setCustomName(event.target.value)} maxLength={120} required /></label>}
      {original && <label className="catalog-field">{t.position}<select value={beforeSpaceId} onChange={event => setBeforeSpaceId(event.target.value)}><option value="">{t.atEnd}</option>{catalog.spaces.filter(space => space.id !== original.id).map(space => <option key={space.id} value={space.id}>{t.beforeSpace(space.title)}</option>)}</select></label>}
    </fieldset>
    <p className="catalog-form-help">{t.defaultDeckType(deckKinds[defaultDeckKind(kind)])}</p>
    <div className="catalog-form-actions"><Button type="button" variant="ghost" disabled={pending} onClick={onCancel}>{t.labelCancel}</Button><Button type="submit" disabled={disabled || !title}>{pending && <LoaderCircle className="spin" size={14} />}{original ? t.labelUpdate : t.labelAdd}</Button></div>
  </form>;
}

function TrackForm({ disabled, pending, onCancel, onSaved, onSubmit, onDirtyChange }: CatalogFormProps) {
  const t = useText(text);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const dirty = Boolean(title || description);
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!disabled && title.trim() && await onSubmit({ action: 'create-track', title: title.trim(), description: description.trim() })) onSaved();
  }
  return <form className="catalog-create-form" onSubmit={event => void submit(event)}>
    <FormHeading title={t.newTrack} pending={pending} onCancel={onCancel} />
    <fieldset disabled={disabled}><label className="catalog-field">{t.title}<input value={title} onChange={event => setTitle(event.target.value)} required maxLength={120} autoFocus /></label><label className="catalog-field catalog-field-wide">{t.description}<textarea value={description} onChange={event => setDescription(event.target.value)} rows={2} maxLength={2000} /></label></fieldset>
    <p className="catalog-form-help">{t.trackHelp}</p>
    <div className="catalog-form-actions"><Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>{t.cancel}</Button><Button type="submit" disabled={disabled || !title.trim()}>{pending && <LoaderCircle size={14} className="spin" />}{t.create}</Button></div>
  </form>;
}

const deckSettingsText = defineText({
  editDeck: 'Edit Deck', deckName: 'Deck name', coverImage: 'Cover image', pickCover: 'Pick cover image',
  browse: 'Browse', upload: 'Upload', icon: 'Icon', customColor: 'Custom Cover Color', more: 'More settings',
  chooseFile: 'Choose image', uploadHint: 'PNG, JPEG or WEBP · up to 5 MB',
  uploadTiming: 'The image uploads when you save.', emptyLibrary: 'No covers in the library.', artCredit: 'Powered by ',
  artEngine: 'Image Gen',
  positionHelp: 'Drag to reposition · ↑\u00a0↓',
}, {
  editDeck: 'Настройки колоды', deckName: 'Название колоды', coverImage: 'Обложка', pickCover: 'Обложка',
  browse: 'Библиотека', upload: 'Загрузить', icon: 'Значок', customColor: 'Свой цвет обложки', more: 'Дополнительно',
  chooseFile: 'Выбрать изображение', uploadHint: 'PNG, JPEG или WEBP · до 5 МБ',
  uploadTiming: 'Изображение загрузится при сохранении.', emptyLibrary: 'В библиотеке нет обложек.', artCredit: 'Создано с ',
  artEngine: 'Image Gen',
  positionHelp: 'Перетащите для сдвига · ↑\u00a0↓',
});

type DeckCoverTab = 'browse' | 'upload' | 'icon';

export function DeckSettingsForm({ creation, catalog, source, disabled, pending, onCancel, onSaved, onSubmit, onDirtyChange }: CatalogFormProps) {
  const t = useText(text);
  const settings = useText(deckSettingsText);
  const deckKinds = useText(deckKindText);
  const original = catalog.decks.find(deck => deck.id === creation.deckId);
  const editedFields = useRef(new Set<string>());
  const initialSpaceId = original?.spaceId ?? creation.spaceId ?? catalog.spaces[0]?.id ?? '';
  const initialSpace = catalog.spaces.find(space => space.id === initialSpaceId);
  const [title, setTitle] = useState(original?.title ?? '');
  const [description, setDescription] = useState(original?.description ?? '');
  const [spaceId, setSpaceId] = useState(initialSpaceId);
  const [kind, setKind] = useState<DeckKind>(original?.kind ?? defaultDeckKind(initialSpace?.kind ?? 'custom'));
  const [icon, setIcon] = useState(original?.icon ?? initialSpace?.icon ?? 'layers');
  const [color, setColor] = useState(original?.color ?? '#878787');
  const [style, setStyle] = useState<DeckStyle>(original?.style ?? 'symbol');
  const [cover, setCover] = useState<string | null>(original?.cover ?? null);
  const [coverPosition, setCoverPosition] = useState(original?.coverPosition ?? 50);
  const [imageData, setImageData] = useState<string | null>(null);
  const [imageName, setImageName] = useState('');
  const [imageError, setImageError] = useState<'imageType' | 'imageSize' | 'imageReadFailed' | 'artFailed' | ''>('');
  const [reading, setReading] = useState(false);
  const [loadingArt, setLoadingArt] = useState(false);
  const [saving, setSaving] = useState(false);
  const [coverTab, setCoverTab] = useState<DeckCoverTab>('browse');
  // New Deck names the deck up front: a cover picked before creation uploads to it right after (2026-11-06).
  const [newDeckId] = useState(() => crypto.randomUUID());
  const [showColor, setShowColor] = useState(false);
  const [notice, setNotice] = useState<'changeUnconfirmed' | 'saveFailed' | 'lessonFailed' | 'coverSaveFailed' | 'inboxAssigned' | 'inboxRemoved' | 'movedToPile' | 'movedToShelf' | ''>('');
  const [moveSpaceId, setMoveSpaceId] = useState(initialSpaceId);
  const [beforeDeckId, setBeforeDeckId] = useState('');
  const reader = useRef<FileReader | null>(null);
  const artRequest = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // Position artwork by dragging the preview vertically or using arrow keys while focused.
  const coverDrag = useRef<{ y: number; position: number; height: number } | null>(null);
  function moveCover(next: number) { editedFields.current.add('coverPosition'); setCoverPosition(Math.round(Math.min(100, Math.max(0, next)))); }
  const busy = useRef(false);
  const unavailable = disabled || saving || reading || loadingArt;
  const closeDisabled = pending || saving || reading || loadingArt;
  const canMoveCover = !unavailable && style === 'artwork' && Boolean(cover || imageData);
  const previewImage = imageData || (cover ? `/api/file?source=${source}&path=${encodeURIComponent(cover)}` : null);
  const previewDeck: CatalogDeck = { id: original?.id ?? newDeckId, title, description, spaceId, kind, icon, color, style, cover, coverPosition };
  const previewCounts = original ? countDeckCards(catalog.cards.filter(card => card.deckId === original.id && !card.archived && !card.deleted)) : emptyDeckCounts;
  const metadataChanged = Boolean(original && (title !== original.title || description !== original.description || icon !== original.icon || color !== original.color || style !== (original.style ?? 'symbol') || cover !== (original.cover ?? null) || coverPosition !== (original.coverPosition ?? 50)));
  const dirty = original
    ? metadataChanged || imageData !== null || moveSpaceId !== initialSpaceId || beforeDeckId !== ''
    : Boolean(title || description) || imageData !== null || spaceId !== initialSpaceId || kind !== defaultDeckKind(initialSpace?.kind ?? 'custom')
      || icon !== (initialSpace?.icon ?? 'layers') || color !== '#878787' || style !== 'symbol';
  useEffect(() => {
    onDirtyChange(dirty || saving || reading || loadingArt);
    return () => onDirtyChange(false);
  }, [dirty, saving, reading, loadingArt, onDirtyChange]);
  useEffect(() => { if (unavailable) coverDrag.current = null; }, [unavailable]);
  useEffect(() => () => reader.current?.abort(), []);
  useEffect(() => () => artRequest.current?.abort(), []);
  useEffect(() => {
    if (!original) return;
    if (!editedFields.current.has('title')) setTitle(original.title);
    if (!editedFields.current.has('description')) setDescription(original.description);
    if (!editedFields.current.has('icon')) setIcon(original.icon);
    if (!editedFields.current.has('color')) setColor(original.color);
    if (!editedFields.current.has('style')) setStyle(original.style ?? 'symbol');
    if (!editedFields.current.has('cover')) setCover(original.cover ?? null);
    if (!editedFields.current.has('coverPosition')) setCoverPosition(original.coverPosition ?? 50);
  }, [original]);

  function selectImage(file: File | undefined) {
    if (!file) return;
    reader.current?.abort();
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { setImageError('imageType'); setReading(false); return; }
    if (file.size > 5 * 1024 * 1024) { setImageError('imageSize'); setReading(false); return; }
    const nextReader = new FileReader();
    reader.current = nextReader;
    setReading(true); setImageError(''); setNotice('');
    nextReader.onload = () => {
      if (reader.current !== nextReader) return;
      editedFields.current.add('style');
      setImageData(String(nextReader.result)); setImageName(file.name); setStyle('artwork'); setReading(false);
    };
    nextReader.onerror = () => { if (reader.current === nextReader) { setImageError('imageReadFailed'); setReading(false); } };
    nextReader.readAsDataURL(file);
  }
  // A library cover goes through the same upload as a user file; its tone becomes the band color.
  async function pickArt(art: DeckArt) {
    if (unavailable) return;
    artRequest.current?.abort();
    const active = new AbortController();
    artRequest.current = active;
    setLoadingArt(true); setImageError('');
    try {
      const response = await fetch(art.url, { signal: active.signal });
      if (!response.ok) throw new Error('Cover unavailable');
      const blob = await response.blob();
      if (active.signal.aborted) return;
      editedFields.current.add('color'); setColor(art.tone.toLowerCase());
      selectImage(new File([blob], art.id + '.webp', { type: 'image/webp' }));
    } catch { if (!active.signal.aborted) setImageError('artFailed'); }
    finally { if (artRequest.current === active) setLoadingArt(false); }
  }
  function removeImage() {
    editedFields.current.add('cover');
    reader.current?.abort(); reader.current = null;
    setImageData(null); setImageName(''); setImageError(''); setCover(null); setReading(false);
    if (fileInput.current) fileInput.current.value = '';
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (unavailable || busy.current || !title.trim() || imageError) return;
    busy.current = true; setSaving(true); setNotice('');
    try {
      if (!original) {
        // The deck starts as a symbol; the cover upload switches it to artwork, so a failed upload leaves a clean deck.
        const pendingCover = imageData && style === 'artwork' ? imageData : null;
        if (!await onSubmit({ action: 'create-deck', deckId: newDeckId, title: title.trim(), spaceId, kind, icon, color, description: description.trim(), style: pendingCover ? 'symbol' : style, coverPosition })) { setNotice('changeUnconfirmed'); return; }
        if (pendingCover && !await onSubmit({ action: 'upload-cover', deckId: newDeckId, dataUrl: pendingCover })) { setNotice('coverSaveFailed'); return; }
        onSaved();
        return;
      }
      // Save metadata before upload: a later update must never restore the old cover path (2026-11-03).
      if (!await onSubmit({ action: 'update-deck', deckId: original.id, title: title.trim(), icon, color, description: description.trim(), style, cover, coverPosition })) { setNotice('changeUnconfirmed'); return; }
      if (imageData && style === 'artwork' && !await onSubmit({ action: 'upload-cover', deckId: original.id, dataUrl: imageData })) {
        setNotice('coverSaveFailed');
        return;
      }
      onSaved();
    } finally { busy.current = false; setSaving(false); }
  }
  async function changeInbox(assigned: boolean) {
    if (!original || unavailable || busy.current) return;
    busy.current = true; setSaving(true); setNotice('');
    try {
      if (await onSubmit({ action: 'set-inbox-deck', deckId: assigned ? original.id : null })) {
        setNotice(assigned ? 'inboxAssigned' : 'inboxRemoved');
      } else setNotice('changeUnconfirmed');
    } finally { busy.current = false; setSaving(false); }
  }
  async function changePile() {
    if (!original || unavailable || busy.current) return;
    const piled = !original.piled;
    busy.current = true; setSaving(true); setNotice('');
    try {
      const saved = await onSubmit({ action: 'set-deck-pile', deckId: original.id, piled, manifestHash: catalog.manifestHash });
      if (saved) setNotice(piled ? 'movedToPile' : 'movedToShelf');
      else setNotice('changeUnconfirmed');
    } finally { busy.current = false; setSaving(false); }
  }
  async function move() {
    if (!original || unavailable || metadataChanged || imageData || busy.current) return;
    busy.current = true; setSaving(true);
    try { if (await onSubmit({ action: 'move-deck', deckId: original.id, spaceId: moveSpaceId, beforeDeckId: beforeDeckId || null })) onSaved(); else setNotice('changeUnconfirmed'); }
    finally { busy.current = false; setSaving(false); }
  }
  return <Dialog.Root open onOpenChange={open => { if (!open && !closeDisabled) onCancel(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="deck-settings-overlay" />
      <Dialog.Content className="deck-settings-dialog" aria-describedby={undefined}
        onPointerDownOutside={event => event.preventDefault()}
        onEscapeKeyDown={event => { event.preventDefault(); event.stopPropagation(); if (!unavailable && !dirty) onCancel(); }}
        onCloseAutoFocus={event => event.preventDefault()}>
        <form className="deck-settings-form" onSubmit={event => void submit(event)} aria-busy={closeDisabled}>
          <header className="deck-settings-modal-heading">
            <Dialog.Title>{original ? settings.editDeck : t.newDeck}</Dialog.Title>
            <Button type="button" size="icon" variant="ghost" disabled={closeDisabled} aria-label={t.closeForm} onClick={onCancel}><X size={20} /></Button>
          </header>
          <div className="deck-settings-layout">
            <div className="deck-settings-main">
              <div className="deck-settings-fields">
                <fieldset disabled={unavailable}>
                  <label className="deck-settings-modal-name catalog-field"><span className="deck-settings-label">{settings.deckName}</span><input value={title} onChange={event => { editedFields.current.add('title'); setTitle(event.target.value); }} maxLength={120} required autoFocus /></label>
                  <div className="deck-settings-cover">
                    <span className="deck-settings-label">{settings.coverImage}</span>
                    <div className={`deck-settings-preview catalog-deck-cover catalog-cover-${style}` + (canMoveCover ? ' is-cover-draggable' : '')}
                      style={coverStyle(previewDeck)}
                      role={canMoveCover ? 'slider' : 'img'} aria-label={canMoveCover ? t.imagePosition : t.preview}
                      tabIndex={canMoveCover ? 0 : undefined} aria-valuemin={canMoveCover ? 0 : undefined} aria-valuemax={canMoveCover ? 100 : undefined}
                      aria-valuenow={canMoveCover ? coverPosition : undefined} aria-orientation={canMoveCover ? 'vertical' : undefined} title={canMoveCover ? t.dragImage : undefined}
                      onPointerDown={canMoveCover ? event => { if (event.button !== 0) return; event.currentTarget.focus(); coverDrag.current = { y: event.clientY, position: coverPosition, height: event.currentTarget.getBoundingClientRect().height || 1 }; event.currentTarget.setPointerCapture(event.pointerId); } : undefined}
                      onPointerMove={canMoveCover ? event => { const drag = coverDrag.current; if (drag) moveCover(drag.position - (event.clientY - drag.y) / drag.height * 100); } : undefined}
                      onPointerUp={() => { coverDrag.current = null; }} onPointerCancel={() => { coverDrag.current = null; }} onLostPointerCapture={() => { coverDrag.current = null; }}
                      onKeyDown={canMoveCover ? event => {
                        const step = event.shiftKey ? 10 : 2;
                        if (event.key === 'ArrowUp') { event.preventDefault(); moveCover(coverPosition + step); }
                        else if (event.key === 'ArrowDown') { event.preventDefault(); moveCover(coverPosition - step); }
                        else if (event.key === 'Home') { event.preventDefault(); moveCover(0); }
                        else if (event.key === 'End') { event.preventDefault(); moveCover(100); }
                      } : undefined}>
                      <CoverFace deck={previewDeck} counts={previewCounts} source={source} imageUrl={previewImage} inbox={Boolean(original && catalog.inboxDeckId === original.id)} />
                    </div>
                    {canMoveCover && <span className="deck-settings-position-help">{settings.positionHelp}</span>}
                  </div>
                  <div className="deck-settings-color">
                    <label className="deck-settings-color-toggle"><input type="checkbox" role="switch" checked={showColor} aria-expanded={showColor} aria-controls="deck-settings-color-picker" onChange={event => setShowColor(event.target.checked)} /><span>{settings.customColor}</span></label>
                    {showColor && <label id="deck-settings-color-picker" className="deck-settings-color-picker"><span className="visually-hidden">{t.color}</span><input type="color" value={color} onChange={event => { editedFields.current.add('color'); setColor(event.target.value); }} /><span>{color.toUpperCase()}</span></label>}
                  </div>
                  {/* 2026-11-08: Inbox sits in the main form — it is the deck's role, not an extra. Decks without Tasks cannot take it. */}
                  {original && <label className="deck-settings-inbox"><input type="checkbox" checked={catalog.inboxDeckId === original.id} disabled={!deckCanBeInbox(original.kind)} onChange={event => void changeInbox(event.target.checked)} /><Inbox size={15} /><strong>{t.inboxDeck}</strong><span>{deckCanBeInbox(original.kind) ? t.inboxHelp : t.inboxTasksOnly}</span></label>}
                </fieldset>
                <details className="deck-settings-more" open={!original || undefined}>
                  <summary>{settings.more}</summary>
                  <fieldset disabled={unavailable}>
                    {!original && <>
                      <label className="catalog-field"><span className="deck-settings-label">{t.space}</span><select value={spaceId} onChange={event => { const selected = catalog.spaces.find(space => space.id === event.target.value); setSpaceId(event.target.value); setKind(defaultDeckKind(selected?.kind ?? 'custom')); }} required>{catalog.spaces.map(space => <option key={space.id} value={space.id}>{space.title}</option>)}</select></label>
                      <label className="catalog-field"><span className="deck-settings-label">{t.deckType}</span><select value={kind} onChange={event => setKind(event.target.value as DeckKind)}>{Object.entries(deckKinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                    </>}
                    <label className="catalog-field"><span className="deck-settings-label">{t.description}</span><textarea value={description} onChange={event => { editedFields.current.add('description'); setDescription(event.target.value); }} rows={2} maxLength={2000} /></label>
                    {original && <div className="deck-pile-settings"><Button type="button" variant="outline" size="sm" onClick={() => void changePile()}>{original.piled ? <LayersArrowUp size={15} /> : <LayersArrowDown size={15} />}{original.piled ? t.backToShelf : t.moveToPile}</Button><p className="catalog-form-help">{t.pileHelp}</p></div>}
                  </fieldset>
                  {original && <details className="deck-move-settings">
                    <summary>{t.moveDeck}</summary>
                    <fieldset disabled={unavailable || metadataChanged || Boolean(imageData)}>
                      <label className="catalog-field"><span className="deck-settings-label">{t.space}</span><select value={moveSpaceId} onChange={event => { setMoveSpaceId(event.target.value); setBeforeDeckId(''); }}>{catalog.spaces.map(space => <option key={space.id} value={space.id}>{space.title}</option>)}</select></label>
                      <label className="catalog-field"><span className="deck-settings-label">{t.position}</span><select value={beforeDeckId} onChange={event => setBeforeDeckId(event.target.value)}><option value="">{t.atEnd}</option>{catalog.decks.filter(deck => deck.spaceId === moveSpaceId && deck.id !== original.id).map(deck => <option key={deck.id} value={deck.id}>{t.beforeDeck(deck.title)}</option>)}</select></label>
                      <Button type="button" variant="outline" size="sm" onClick={() => void move()}>{t.move}</Button>
                    </fieldset>
                    {(metadataChanged || imageData) && <p className="catalog-form-help">{t.saveBeforeMove}</p>}
                  </details>}
                </details>
              </div>
              <footer className="deck-settings-modal-actions">
                {(notice || imageError) && <p className={imageError ? 'inline-error' : 'catalog-notice'} role={imageError ? 'alert' : 'status'}>{imageError ? t[imageError] : notice && t[notice]}</p>}
                <div><Button type="submit" disabled={unavailable || !title.trim() || !spaceId || Boolean(imageError)}>{closeDisabled && <LoaderCircle size={14} className="spin" />}{original ? t.save : t.create}</Button><Button type="button" variant="ghost" disabled={closeDisabled} onClick={onCancel}>{t.cancel}</Button></div>
              </footer>
            </div>
            <section className="deck-settings-picker" aria-label={settings.pickCover}>
              <div className="deck-settings-picker-heading">
                <h3>{settings.pickCover}</h3>
                <div role="tablist" aria-label={settings.pickCover} onKeyDown={navigateTabs}>
                  {(['browse', 'upload', 'icon'] as const).map(tab => <button key={tab} type="button" role="tab" id={`deck-cover-tab-${tab}`} aria-controls={`deck-cover-panel-${tab}`} aria-selected={coverTab === tab} tabIndex={coverTab === tab ? 0 : -1} disabled={unavailable} onClick={() => setCoverTab(tab)}>{settings[tab]}</button>)}
                </div>
              </div>
              <div className="deck-settings-picker-content">
                <div role="tabpanel" id="deck-cover-panel-browse" aria-labelledby="deck-cover-tab-browse" hidden={coverTab !== 'browse'} tabIndex={0}>
                  {deckArt.length > 0 ? <div className="deck-art-library">{deckArt.map(art => <button key={art.id} type="button" className="deck-art-option" disabled={unavailable} onClick={() => void pickArt(art)} aria-label={t.cover(art.title)} title={art.title} aria-pressed={imageName === art.id + '.webp'}><img src={art.url} alt="" loading="lazy" /></button>)}</div> : <p className="catalog-form-help">{settings.emptyLibrary}</p>}
                </div>
                <div role="tabpanel" id="deck-cover-panel-upload" aria-labelledby="deck-cover-tab-upload" hidden={coverTab !== 'upload'} tabIndex={0}>
                  <fieldset disabled={unavailable} className="deck-settings-upload">
                    <input ref={fileInput} id="deck-cover-file" type="file" className="visually-hidden" tabIndex={-1} aria-label={t.customImage} accept="image/png,image/jpeg,image/webp" onChange={event => selectImage(event.target.files?.[0])} />
                    <Image size={32} aria-hidden="true" />
                    <Button type="button" variant="outline" onClick={() => fileInput.current?.click()}>{settings.chooseFile}</Button>
                    <p>{settings.uploadHint}</p><p>{settings.uploadTiming}</p>
                    {imageName && <span className="deck-settings-file-name">{imageName}</span>}
                  </fieldset>
                </div>
                <div role="tabpanel" id="deck-cover-panel-icon" aria-labelledby="deck-cover-tab-icon" hidden={coverTab !== 'icon'} tabIndex={0}>
                  <fieldset disabled={unavailable} className="deck-settings-icon-fields">
                    <label className="catalog-field"><span className="deck-settings-label">{t.appearance}</span><select value={style} onChange={event => { editedFields.current.add('style'); setStyle(event.target.value as DeckStyle); }}><option value="symbol">{t.labelSymbol}</option><option value="artwork">{t.labelArtwork}</option><option value="minimal">{t.labelMinimal}</option></select></label>
                    <label className="catalog-field"><span className="deck-settings-label">{t.icon}</span><select value={icon} onChange={event => { editedFields.current.add('icon'); setIcon(event.target.value); }}>{Object.entries(deckIconNames()).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                  </fieldset>
                </div>
              </div>
              <div className="deck-settings-picker-footer">
                {original && (cover || imageData || imageError) && <Button className="deck-settings-remove" type="button" size="sm" variant="ghost" disabled={unavailable} onClick={removeImage}>{t.removeImage}</Button>}
                {coverTab === 'browse' && deckArt.length > 0 && <p className="deck-art-credit"><Sparkles size={16} aria-hidden="true" /><span>{settings.artCredit}<strong>{settings.artEngine}</strong></span></p>}
              </div>
            </section>
          </div>
        </form>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
