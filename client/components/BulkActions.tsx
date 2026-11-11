import { defineText, locale, textNow, useLang, useText } from '../i18n.ts';
import { priorityLabel, stateLabel } from '../locales/common.ts';
import { collectProjectTags, validTagName } from '../../src/project-tags.ts';
import { TagSelectionList } from './TagPicker.tsx';
import { CardTags } from './CardTags.tsx';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Archive, ArchiveRestore, Bookmark, CalendarDays, Check, CopyPlus, Crown, Download, FileText, Flag, Gauge, Hand, IterationCw, Layers, LoaderCircle, MoreHorizontal, NotebookText, RotateCcw, Route, Search, Tags, Trash2, UserRound, X } from 'lucide-react';
import type { BulkChange, CopyProperty } from '../../src/bulk-contracts.ts';
import { deckAcceptsCard, type CardContent, type CardPriority, type CatalogCard, type CatalogView } from '../../src/catalog-contracts.ts';
import { cardExportColumns, defaultCardExportColumns, exportCardsCsv, type CardExportColumnId } from '../../src/card-export.ts';
import type { DataSource } from '../../src/workspace-contracts.ts';
import { shortReference } from '../../src/references.ts';
import { CardOwnerAvatar } from './CardQuickSettings.tsx';
import { DependencyStateWarning, dependencyConflicts, type DependencyConflict } from './DependencyWarning.tsx';
import { Button } from './ui/button.tsx';
import { BULK_SHORTCUTS, matchShortcut, shortcutTargetBlocked } from '../keyboard-shortcuts.ts';
import { currentMember } from '../current-member.ts';
import { orderedRunChoices, runChoiceLabel } from '../run-label.ts';
import { failureMessage } from '../failure-message.ts';
import { catalogStore } from '../catalog-store.ts';
import { moveFocus } from '../focus.ts';
import { AgentQueueHint } from './AgentQueueHint.tsx';
import '../bulk-actions.css';

const text = defineText({
  selectFirst: "Select cards first",
  wait: "Wait for the current action to finish",
  limit: "Limit: 1,000 cards per action",
  sandbox: "Changes are only available in sandbox",
  restoreFirst: "Restore cards from Trash first",
  tasksOnly: "Select only Task Cards",
  individualReturn: "Open each card to return it from review with a reason.",
  tasksDocs: "Select Task or Doc Cards",
  noNested: "Selected cards have Sub Cards: nested families are not supported",
  unarchiveFirst: "Remove cards from Archive first",
  journeyHero: "The Journey manages its cards’ Hero",
  convertHero: "A Hero Card cannot become a Task or Doc",
  convertJourney: "Journey cards cannot change type",
  separateTask: "Create a separate Task Card for a project document",
  unconfirmed: "Not all changes were confirmed. Check the catalog message and remaining selection.",
  saveFailed: "Could not save changes.",
  requestedCards: "Cards in this request:",
  markdownFailed: (title: string) => `Could not load Markdown: ${title}`,
  exportChanged: (title: string) => `Card changed during export: ${title}. Refresh the selection.`,
  markdownMissing: (title: string) => `The server did not return complete Markdown: ${title}`,
  csvReady: (count: number) => `CSV ready: ${new Intl.NumberFormat(locale("en")).format(count)} ${new Intl.PluralRules(locale("en")).select(count) === "one" ? "card" : "cards"}.`,
  csvFailed: "Could not prepare CSV.",
  differentValues: (count: number) => `${new Intl.NumberFormat(locale("en")).format(count)} different values`,
  noDeck: "No deck",
  noMembers: "No members in this project yet.",
  handHint: "Hand stores a member’s personal queue and does not change Owner.",
  effortHint: (sum: string) => `Total Effort: ${sum}. The new value applies to each selected card.`,
  heroHint: "Selected Task and Doc Cards become Sub Cards of the new Hero.",
  addTag: (tag: string) => `Add “${tag}”`,
  convertHint: "Changes the selected cards’ type and Deck. Content is kept.",
  copyHint: "Title, Markdown and checklist are always copied. Choose extra properties; copies get new IDs.",
  exportHint: "CSV · UTF-8 · “;” delimiter. Full Markdown is loaded only when its column is selected.",
  reopen: (state: string) => `Reopen · ${state}`,
  archiveConfirm: (count: number) => `Archive ${new Intl.NumberFormat(locale("en")).format(count)} ${new Intl.PluralRules(locale("en")).select(count) === "one" ? "card" : "cards"}? Data is kept; use Remove Archive to restore them.`,
  unarchiveConfirm: (count: number) => `Restore ${new Intl.NumberFormat(locale("en")).format(count)} ${new Intl.PluralRules(locale("en")).select(count) === "one" ? "card" : "cards"} from Archive?`,
  deleteConfirm: (count: number) => `Move ${new Intl.NumberFormat(locale("en")).format(count)} ${new Intl.PluralRules(locale("en")).select(count) === "one" ? "card" : "cards"} to Trash? Files are kept and cards can be restored.`,
  restoreConfirm: (count: number) => `Restore ${new Intl.NumberFormat(locale("en")).format(count)} ${new Intl.PluralRules(locale("en")).select(count) === "one" ? "card" : "cards"} from Trash? Their Archive status is kept.`,
  deleteHeroHint: "The Hero’s Sub Cards also move to Trash.",
  restoreHeroHint: "The selected Hero’s Sub Cards are also restored.",
  actions: "Bulk actions",
  close: "Close bulk action",
  conflict: "The selected cards or catalog changed. Your form values were kept.",
  useCurrent: "Use current data",
  invalid: "Check required fields and allowed values.",
  applyCount: (count: number) => `Apply to ${new Intl.NumberFormat(locale("en")).format(count)} ${new Intl.PluralRules(locale("en")).select(count) === "one" ? "card" : "cards"}`,
  copyCount: (count: number) => `Copy ${new Intl.NumberFormat(locale("en")).format(count)} ${new Intl.PluralRules(locale("en")).select(count) === "one" ? "card" : "cards"}`,
  selectedCount: (count: number) => `${new Intl.NumberFormat(locale("en")).format(count)} ${new Intl.PluralRules(locale("en")).select(count) === "one" ? "card" : "cards"} selected`,
  uiHand: "Hand",
  uiBookmark: "Bookmark",
  uiRun: "Run",
  uiMilestone: "Milestone",
  uiDueDate: "Due date",
  uiHeroCard: "Hero Card",
  uiEffort: "Effort",
  uiPriority: "Priority",
  uiOwner: "Owner",
  uiTags: "Tags",
  uiDocCardTask: "Doc Card / Task",
  uiCopyCards: "Copy cards",
  uiExportCSV: "Export CSV",
  uiDone: "Done",
  uiArchive: "Archive",
  uiTracks: "Tracks",
  uiRemoveArchive: "Remove Archive",
  uiMoveToTrash: "Move to Trash",
  uiRestoreFromTrash: "Restore from Trash",
  uiCurrent: "Current",
  uiDeck: "Deck",
  uiAddToHand: "Add to Hand",
  uiRemoveFromHand: "Remove from Hand",
  uiUnassigned: "Unassigned",
  uiFindAHand: "Find a Hand…",
  uiFindAnOwner: "Find an owner…",
  uiBookmarked: "Bookmarked",
  uiNotBookmarked: "Not bookmarked",
  uiBookmarkAll: "Bookmark all",
  uiClearBookmarks: "Clear bookmarks",
  uiNone: "None",
  uiClear: "Clear",
  uiClearDueDate: "Clear due date",
  uiClearEffort: "Clear effort",
  uiFindExisting: "Find existing",
  uiCreateNew: "Create new",
  uiHeroTitle: "Hero title",
  uiCreateCardInDeck: "Create card in Deck",
  uiChooseDeck: "Choose Deck",
  uiFindAHeroDocCard: "Find a Hero / Doc Card…",
  uiRemoveParent: "Remove parent",
  uiHeroCards: "Hero Cards",
  uiDocCards: "Doc Cards",
  uiAddTags: "Add tags",
  uiRemoveTags: "Remove tags",
  uiType: "Type",
  uiDocCard: "Doc Card",
  uiTask: "Task",
  uiCopyProperties: "Copy properties",
  uiColumns: "Columns",
  uiDefaultColumns: "Default columns",
  uiMarkAsDone: "Mark as Done",
  uiCreateHero: "Create Hero",
  uiMoreActions: "More actions",
  organization: "Organization",
  properties: "Properties",
  export: "Export",
  lifecycle: "Lifecycle",
  addToTrack: "Add to Track",
  noTracks: "No Tracks in this project yet",
  trackHint: "Adds the Track without removing existing links.",
  uiCancel: "Cancel"
}, {
  selectFirst: "Сначала выберите карточки",
  wait: "Дождитесь завершения текущей операции",
  limit: "Лимит — 1000 карточек за операцию",
  sandbox: "Изменения доступны только в sandbox",
  restoreFirst: "Сначала восстановите карточки из корзины",
  tasksOnly: "Выберите только Task Cards",
  individualReturn: "Откройте каждую карточку для возврата с приёмки с указанием причины.",
  tasksDocs: "Выберите Task или Doc Cards",
  noNested: "У выбранных карточек есть Sub Cards: вложенные семьи недоступны",
  unarchiveFirst: "Сначала верните карточки из архива",
  journeyHero: "Hero карточек Journey управляется самим Journey",
  convertHero: "Hero Card не преобразуется в Task или Doc",
  convertJourney: "Карточки Journey нельзя преобразовать в другой тип",
  separateTask: "Для документа проекта создайте отдельную Task Card",
  unconfirmed: "Не все изменения подтверждены. Проверьте сообщение каталога и оставшийся выбор.",
  saveFailed: "Не удалось сохранить изменения.",
  requestedCards: "Карточки в этом запросе:",
  markdownFailed: (title: string) => `Не удалось загрузить Markdown: ${title}`,
  exportChanged: (title: string) => `Карточка изменилась во время экспорта: ${title}. Обновите выбор.`,
  markdownMissing: (title: string) => `Сервер не вернул полный Markdown: ${title}`,
  csvReady: (count: number) => `CSV подготовлен: ${new Intl.NumberFormat(locale("ru")).format(count)} карточек.`,
  csvFailed: "Не удалось подготовить CSV.",
  differentValues: (count: number) => `${new Intl.NumberFormat(locale("ru")).format(count)} разных значений`,
  noDeck: "Без колоды",
  noMembers: "В проекте пока нет участников.",
  handHint: "Hand хранит личную очередь участника и не меняет исполнителя.",
  effortHint: (sum: string) => `Суммарная оценка: ${sum}. Новое значение будет задано каждой выбранной карточке.`,
  heroHint: "Выбранные Task и Doc Cards станут Sub Cards новой Hero.",
  addTag: (tag: string) => `Добавить «${tag}»`,
  convertHint: "Изменяется тип выбранных карточек и их колода. Содержимое сохраняется.",
  copyHint: "Название, Markdown и чеклист копируются всегда. Выберите дополнительные свойства; копии получат новые ID.",
  exportHint: "CSV · UTF-8 · разделитель «;». Markdown загружается полностью только при выборе этого столбца.",
  reopen: (state: string) => `Вернуть в план · ${state}`,
  archiveConfirm: (count: number) => `Архивировать ${new Intl.NumberFormat(locale("ru")).format(count)} карточек? Их данные сохранятся; вернуть карточки можно через «Убрать из архива».`,
  unarchiveConfirm: (count: number) => `Вернуть ${new Intl.NumberFormat(locale("ru")).format(count)} карточек из архива?`,
  deleteConfirm: (count: number) => `Переместить ${new Intl.NumberFormat(locale("ru")).format(count)} карточек в корзину? Файлы сохраняются, карточки можно восстановить.`,
  restoreConfirm: (count: number) => `Восстановить ${new Intl.NumberFormat(locale("ru")).format(count)} карточек из корзины? Их состояние архива сохранится.`,
  deleteHeroHint: "Вместе с Hero в корзину попадут её Sub Cards.",
  restoreHeroHint: "Sub Cards выбранной Hero также будут восстановлены.",
  actions: "Массовые действия",
  close: "Закрыть массовое действие",
  conflict: "Выбранные карточки или каталог изменились. Значения формы сохранены.",
  useCurrent: "Использовать актуальные данные",
  invalid: "Проверьте обязательные поля и допустимые значения.",
  applyCount: (count: number) => {
    const rule = new Intl.PluralRules(locale("ru")).select(count);
    const noun = { one: 'карточке', few: 'карточкам', many: 'карточкам', zero: 'карточкам', two: 'карточкам', other: 'карточкам' }[rule]!;
    return `Применить к ${new Intl.NumberFormat(locale("ru")).format(count)} ${noun}`;
  },
  copyCount: (count: number) => {
    const rule = new Intl.PluralRules(locale("ru")).select(count);
    const noun = { one: 'карточку', few: 'карточки', many: 'карточек', zero: 'карточек', two: 'карточки', other: 'карточки' }[rule]!;
    return `Скопировать ${new Intl.NumberFormat(locale("ru")).format(count)} ${noun}`;
  },
  selectedCount: (count: number) => {
    const rule = new Intl.PluralRules(locale("ru")).select(count);
    const noun = { one: 'карточка', few: 'карточки', many: 'карточек', zero: 'карточек', two: 'карточки', other: 'карточки' }[rule]!;
    return `Выбрано ${new Intl.NumberFormat(locale("ru")).format(count)} ${noun}`;
  },
  uiHand: "Hand",
  uiBookmark: "Закладка",
  uiRun: "Run",
  uiMilestone: "Milestone",
  uiDueDate: "Срок",
  uiHeroCard: "Hero Card",
  uiEffort: "Оценка",
  uiPriority: "Приоритет",
  uiOwner: "Исполнитель",
  uiTags: "Теги",
  uiDocCardTask: "Doc Card / Task",
  uiCopyCards: "Скопировать карточки",
  uiExportCSV: "Экспорт CSV",
  uiDone: "Принять",
  uiArchive: "В архив",
  uiTracks: "Треки",
  uiRemoveArchive: "Убрать из архива",
  uiMoveToTrash: "В корзину",
  uiRestoreFromTrash: "Восстановить из корзины",
  uiCurrent: "Сейчас",
  uiDeck: "Колода",
  uiAddToHand: "В Hand",
  uiRemoveFromHand: "Убрать из Hand",
  uiUnassigned: "Без исполнителя",
  uiFindAHand: "Найти Hand…",
  uiFindAnOwner: "Найти исполнителя…",
  uiBookmarked: "С закладкой",
  uiNotBookmarked: "Без закладки",
  uiBookmarkAll: "Закладки всем",
  uiClearBookmarks: "Снять закладки",
  uiNone: "Нет",
  uiClear: "Очистить",
  uiClearDueDate: "Снять срок",
  uiClearEffort: "Снять оценку",
  uiFindExisting: "Найти существующую",
  uiCreateNew: "Создать новую",
  uiHeroTitle: "Название Hero",
  uiCreateCardInDeck: "Создать карточку в колоде",
  uiChooseDeck: "Выбрать колоду",
  uiFindAHeroDocCard: "Найти Hero / Doc Card…",
  uiRemoveParent: "Отвязать родителя",
  uiHeroCards: "Hero Cards",
  uiDocCards: "Doc Cards",
  uiAddTags: "Добавить теги",
  uiRemoveTags: "Убрать теги",
  uiType: "Тип",
  uiDocCard: "Doc Card",
  uiTask: "Task",
  uiCopyProperties: "Копируемые свойства",
  uiColumns: "Столбцы",
  uiDefaultColumns: "Столбцы по умолчанию",
  uiMarkAsDone: "Принять",
  uiCreateHero: "Создать Hero",
  uiMoreActions: "Ещё действия",
  organization: "Организация",
  properties: "Свойства",
  export: "Экспорт",
  lifecycle: "Жизненный цикл",
  addToTrack: "Добавить в трек",
  noTracks: "В проекте ещё нет треков",
  trackHint: "Добавляет трек, сохраняя существующие связи.",
  uiCancel: "Отмена"
});


class LocalizedExportError extends Error {
  constructor(readonly localizedMessage: () => string) {
    super(localizedMessage());
  }
}

type ActionId = 'hand' | 'bookmark' | 'run' | 'milestone' | 'dueDate' | 'parent' | 'track' | 'effort' | 'priority' | 'owner' | 'tags' | 'convert' | 'duplicate' | 'export' | 'done' | 'archive' | 'delete' | 'restore' | 'unarchive';
const actions = [
  { id: 'hand', get label() { return textNow(text).uiHand; }, Icon: Hand }, { id: 'bookmark', get label() { return textNow(text).uiBookmark; }, Icon: Bookmark },
  { id: 'run', get label() { return textNow(text).uiRun; }, Icon: IterationCw }, { id: 'milestone', get label() { return textNow(text).uiMilestone; }, Icon: Flag },
  { id: 'dueDate', get label() { return textNow(text).uiDueDate; }, Icon: CalendarDays }, { id: 'parent', get label() { return textNow(text).uiHeroCard; }, Icon: Crown },
  { id: 'track', get label() { return textNow(text).addToTrack; }, Icon: Route },
  { id: 'effort', get label() { return textNow(text).uiEffort; }, Icon: Gauge }, { id: 'priority', get label() { return textNow(text).uiPriority; }, Icon: Layers },
  { id: 'owner', get label() { return textNow(text).uiOwner; }, Icon: UserRound }, { id: 'tags', get label() { return textNow(text).uiTags; }, Icon: Tags },
  { id: 'convert', get label() { return textNow(text).uiDocCardTask; }, Icon: FileText },
  { id: 'duplicate', get label() { return textNow(text).uiCopyCards; }, Icon: CopyPlus }, { id: 'export', get label() { return textNow(text).uiExportCSV; }, Icon: Download },
  { id: 'done', get label() { return textNow(text).uiDone; }, Icon: Check }, { id: 'archive', get label() { return textNow(text).uiArchive; }, Icon: Archive },
] as const;
const actionGroups: { key: 'organization' | 'properties' | 'export' | 'lifecycle'; ids: ActionId[] }[] = [
  { key: 'organization', ids: ['hand', 'track', 'parent', 'run', 'milestone', 'bookmark', 'duplicate'] },
  { key: 'properties', ids: ['owner', 'tags', 'effort', 'priority', 'dueDate'] },
  { key: 'export', ids: ['export'] },
  { key: 'lifecycle', ids: ['done', 'convert', 'archive', 'unarchive', 'delete', 'restore'] },
];
const copyProperties: { id: CopyProperty; label: string }[] = [
  { id: 'owner', get label() { return textNow(text).uiOwner; } }, { id: 'effort', get label() { return textNow(text).uiEffort; } }, { id: 'priority', get label() { return textNow(text).uiPriority; } },
  { id: 'tags', get label() { return textNow(text).uiTags; } }, { id: 'run', get label() { return textNow(text).uiRun; } }, { id: 'milestone', get label() { return textNow(text).uiMilestone; } },
  { id: 'dueDate', get label() { return textNow(text).uiDueDate; } }, { id: 'tracks', get label() { return textNow(text).uiTracks; } },
];
const extraActions = [{ id: 'unarchive', get label() { return textNow(text).uiRemoveArchive; }, Icon: ArchiveRestore }, { id: 'delete', get label() { return textNow(text).uiMoveToTrash; }, Icon: Trash2 }, { id: 'restore', get label() { return textNow(text).uiRestoreFromTrash; }, Icon: RotateCcw }] as const;
const bulkActionByShortcut: Record<string, ActionId> = {
  'bulk-owner': 'owner', 'bulk-tags': 'tags', 'bulk-hand': 'hand', 'bulk-effort': 'effort',
  'bulk-priority': 'priority', 'bulk-run': 'run', 'bulk-milestone': 'milestone', 'bulk-parent': 'parent',
  'bulk-archive': 'archive', 'bulk-done': 'done', 'bulk-bookmark': 'bookmark', 'bulk-delete': 'delete',
};

function shortcutForBulkAction(action: ActionId) {
  const entry = Object.entries(bulkActionByShortcut).find(([, actionId]) => actionId === action);
  return BULK_SHORTCUTS.find(shortcut => shortcut.id === entry?.[0]);
}

interface Draft {
  query: string; memberId: string; mode: 'add' | 'remove'; name: string; date: string;
  parentId: string; heroMode: 'existing' | 'new'; heroTitle: string; heroDeckId: string;
  effort: string; priority: CardPriority | ''; owner: string; tags: string[];
  cardKind: 'task' | 'doc'; deckId: string; properties: CopyProperty[]; columns: CardExportColumnId[];
}

function commonValue(cards: CatalogCard[], value: (card: CatalogCard) => string): string {
  const first = cards[0] ? value(cards[0]) : '';
  return cards.every(card => value(card) === first) ? first : '';
}
function initialDraft(cards: CatalogCard[], action: ActionId): Draft {
  return { query: '', memberId: '', mode: action === 'bookmark' && cards.every(card => card.bookmarked) ? 'remove' : 'add',
    name: commonValue(cards, card => action === 'run' ? card.run ?? '' : card.milestone ?? ''),
    date: commonValue(cards, card => card.dueDate ?? ''), parentId: commonValue(cards, card => card.parentId ?? ''),
    heroMode: 'existing', heroTitle: '', heroDeckId: '', effort: commonValue(cards, card => card.effort == null ? '' : String(card.effort)),
    priority: commonValue(cards, card => card.priority ?? '') as Draft['priority'], owner: commonValue(cards, card => card.owner ?? ''), tags: [],
    cardKind: cards.every(card => card.kind === 'doc') ? 'task' : 'doc', deckId: commonValue(cards, card => card.deckId ?? ''),
    properties: copyProperties.map(property => property.id), columns: [...defaultCardExportColumns] };
}
function isDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/u.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

export interface BulkActionsProps {
  cards: CatalogCard[];
  catalog: CatalogView;
  pending: boolean;
  onAction: (change: BulkChange) => Promise<boolean>;
  onOpenDeck?: () => void;
  overflowOrganization?: ReactNode;
  overflowExport?: ReactNode;
  source: DataSource;
  writable?: boolean;
}

export function BulkActions({ cards, catalog, pending, onAction, onOpenDeck, overflowOrganization, overflowExport, source, writable = source === 'sandbox' }: BulkActionsProps) {
  const t = useText(text);
  const lang = useLang();
  const amount = (value: number) => new Intl.NumberFormat(locale(lang), { maximumFractionDigits: 2 }).format(value);
  const selected = useMemo(() => [...new Map(cards.map(card => [card.id, card])).values()], [cards]);
  const [menu, setMenu] = useState<ActionId | 'more' | null>(null);
  const [draft, setDraft] = useState<Draft>(() => initialDraft(selected, 'owner'));
  const [baseSignature, setBaseSignature] = useState('');
  const [running, setRunning] = useState(false);
  const [errorMessage, setError] = useState<string | (() => string)>('');
  const [failedStateCards, setFailedStateCards] = useState<CatalogCard[]>([]);
  const error = typeof errorMessage === 'function' ? errorMessage() : errorMessage;
  const [noticeMessage, setNotice] = useState<string | (() => string)>('');
  const notice = typeof noticeMessage === 'function' ? noticeMessage() : noticeMessage;
  // Confirm bulk completion when selected cards have unfinished prerequisites.
  const [confirmingDependencies, setConfirmingDependencies] = useState(false);
  const [dependenciesConfirmed, setDependenciesConfirmed] = useState(false);
  const inFlight = useRef(false);
  const duplicateIds = useRef(new Map<string, string>());
  const newHeroId = useRef<string | null>(null);
  const exportRequest = useRef<AbortController | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const moreButton = useRef<HTMLButtonElement | null>(null);
  const actionBar = useRef<HTMLDivElement | null>(null);
  const [compact, setCompact] = useState(false);
  const openingDialogFromMenu = useRef(false);
  const dialog = useRef<HTMLDivElement | null>(null);
  const currentSelection = useRef('');
  const id = useId();
  const selectionKey = source + ':' + selected.map(card => card.id).sort().join('|');
  currentSelection.current = selectionKey;
  const signature = JSON.stringify([source, catalog.manifestHash, catalog.optionsHash, selected.map(card => [card.id, card.sourceHash])]);
  const busy = pending || running;
  const overLimit = selected.length > 1000;
  const taskOnly = selected.length > 0 && selected.every(card => card.kind === 'task');
  const conflict = Boolean(menu && menu !== 'more' && baseSignature !== signature);
  const mutationDisabled = busy || !writable || source !== 'sandbox' || overLimit || selected.length === 0;
  const dialogOpen = menu !== null && menu !== 'more';
  const actionLabel = actions.find(action => action.id === menu)?.label ?? extraActions.find(action => action.id === menu)?.label ?? '';
  const members = catalog.members ?? [];
  const effortCards = selected.filter(card => typeof card.effort === 'number' && Number.isFinite(card.effort));
  const effortSum = effortCards.reduce((sum, card) => sum + card.effort!, 0);
  const effortLabel = effortCards.length ? amount(effortSum) : '—';
  const query = draft.query.trim().toLocaleLowerCase('ru');
  const knownTags = collectProjectTags(catalog.cards, catalog.projectTags);
  const compatibleDecks = catalog.decks.filter(deck => menu === 'convert' ? deckAcceptsCard(deck.kind, draft.cardKind) : selected.every(card => deckAcceptsCard(deck.kind, card.kind)));
  const parentsWithChildren = new Set(catalog.cards.map(card => card.parentId).filter(Boolean));
  const selectedIds = new Set(selected.map(card => card.id));
  const parentCandidates = catalog.cards.filter(card => (card.kind === 'hero' || card.kind === 'doc')
    && !card.parentId && !card.journey && !card.archived && !card.deleted && !selectedIds.has(card.id));
  const cardsById = useMemo(() => new Map(catalog.cards.map(card => [card.id, card])), [catalog.cards]);
  // Unfinished prerequisites of the cards selected for bulk completion.
  const doneConflicts: DependencyConflict[] = useMemo(() => menu === 'done' && draft.mode === 'add'
    ? dependencyConflicts(selected, cardsById, 'done')
    : [], [menu, draft.mode, selected, cardsById]);
  const directActions: ActionId[] = compact ? [] : ['owner', 'tags'];

  useLayoutEffect(() => {
    const bar = actionBar.current?.closest('.card-selection-bar, .planning-selection') ?? actionBar.current?.parentElement;
    if (!bar) return;
    const measure = () => {
      const style = getComputedStyle(bar);
      const width = bar.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      setCompact(width <= 520);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    exportRequest.current?.abort();
    if (!inFlight.current) { setMenu(null); setError(''); setFailedStateCards([]); setConfirmingDependencies(false); setDependenciesConfirmed(false); }
  }, [selectionKey]);
  useEffect(() => { duplicateIds.current.clear(); newHeroId.current = null; }, [source]);
  useEffect(() => () => exportRequest.current?.abort(), []);
  useEffect(() => {
    function handleBulkShortcut(event: KeyboardEvent) {
      if (shortcutTargetBlocked(event, 'bulk') || !writable || source !== 'sandbox') return;
      const shortcut = matchShortcut(event, BULK_SHORTCUTS);
      if (!shortcut) return;
      const target = event.target instanceof Element ? event.target : null;
      if (shortcut.id === 'bulk-assign-me' && target?.closest('button, a, input, select, textarea, [role="button"], [role="checkbox"]')) return;
      if (shortcut.id === 'bulk-deck') {
        if (!onOpenDeck || mutationDisabled) return;
        event.preventDefault(); event.stopImmediatePropagation();
        onOpenDeck();
        return;
      }
      if (shortcut.id === 'bulk-assign-me') {
        const member = currentMember(members);
        if (!member || reason('owner')) return;
        event.preventDefault(); event.stopImmediatePropagation();
        void mutate({ kind: 'properties', owner: member.label });
        return;
      }
      const action = bulkActionByShortcut[shortcut.id];
      if (!action || reason(action)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      openAction(action, document.activeElement instanceof HTMLElement ? document.activeElement : undefined);
    }
    window.addEventListener('keydown', handleBulkShortcut, true);
    return () => window.removeEventListener('keydown', handleBulkShortcut, true);
  });

  function update<K extends keyof Draft>(key: K, value: Draft[K]) { setDraft(previous => ({ ...previous, [key]: value })); }
  function reason(action: ActionId): string | null {
    if (!selected.length) return t.selectFirst;
    if (busy) return t.wait;
    if (overLimit) return t.limit;
    if (action !== 'export' && (!writable || source !== 'sandbox')) return t.sandbox;
    if (action !== 'export' && action !== 'restore' && selected.some(card => card.deleted)) return t.restoreFirst;
    if (action === 'done' && !taskOnly) return t.tasksOnly;
    if (action === 'track' && !catalog.tracks.length) return t.noTracks;
    if (action === 'parent' && selected.some(card => card.kind !== 'task' && card.kind !== 'doc')) return t.tasksDocs;
    if (action === 'parent' && selected.some(card => parentsWithChildren.has(card.id))) return t.noNested;
    if (action === 'parent' && selected.some(card => card.archived)) return t.unarchiveFirst;
    if (action === 'parent' && selected.some(card => card.journey)) return t.journeyHero;
    if (action === 'convert' && selected.some(card => card.kind === 'hero')) return t.convertHero;
    if (action === 'convert' && selected.some(card => card.journey)) return t.convertJourney;
    if (action === 'convert' && selected.some(card => !card.id.startsWith('card:') && !card.id.startsWith('task:'))) return t.separateTask;
    return null;
  }
  function openAction(action: ActionId, target?: HTMLElement) {
    if (reason(action)) return;
    const nextDraft = initialDraft(selected, action);
    if (action === 'convert') nextDraft.deckId = '';
    if (action === 'track') nextDraft.name = '';
    if (action === 'parent') nextDraft.heroDeckId = catalog.decks.find(deck => deckAcceptsCard(deck.kind, 'hero'))?.id ?? '';
    if (target) opener.current = target;
    setDraft(nextDraft); setBaseSignature(signature); setError(''); setNotice(''); setMenu(action);
    setFailedStateCards([]);
    setConfirmingDependencies(false); setDependenciesConfirmed(false);
  }
  function closeMenu() {
    exportRequest.current?.abort();
    setMenu(null);
    setConfirmingDependencies(false); setDependenciesConfirmed(false);
  }
  async function mutate(change: BulkChange) {
    if (inFlight.current || mutationDisabled || conflict) return;
    const store = catalogStore(source);
    const previousResult = store.getSnapshot();
    inFlight.current = true; setRunning(true); setError(''); setFailedStateCards([]);
    try {
      const saved = await onAction(change);
      if (saved) { duplicateIds.current.clear(); newHeroId.current = null; setMenu(null); }
      else {
        // 2026-11-11: edit returns false rather than throwing on HTTP refusal; keep its reason beside the unchanged form.
        const result = store.getSnapshot();
        const message = result !== previousResult ? result.error || result.warning : null;
        setError(() => message || (() => textNow(text).unconfirmed));
        if (change.kind === 'state') setFailedStateCards(selected);
      }
    } catch (failure) {
      setError(() => failureMessage(failure, textNow(text).saveFailed));
      if (change.kind === 'state') setFailedStateCards(selected);
    }
    finally { inFlight.current = false; setRunning(false); }
  }
  async function downloadCsv() {
    if (busy || inFlight.current || exportRequest.current || overLimit || !selected.length || !draft.columns.length || conflict) return;
    const controller = new AbortController();
    exportRequest.current = controller;
    const selectionAtStart = selectionKey;
    const selectedAtStart = selected;
    const columns = [...draft.columns];
    setRunning(true); setError('');
    try {
      const contentById = new Map<string, string>();
      if (columns.includes('content')) {
        // Four requests at a time avoid flooding the local parser when exporting a large selection.
        for (let offset = 0; offset < selectedAtStart.length; offset += 4) {
          await Promise.all(selectedAtStart.slice(offset, offset + 4).map(async card => {
            const response = await fetch(`/api/card-content?source=${source}&cardId=${encodeURIComponent(card.id)}`, { cache: 'no-store', signal: controller.signal });
            const content = await response.json() as CardContent & { message?: string };
            if (!response.ok) throw content.message ? new Error(content.message) : new LocalizedExportError(() => textNow(text).markdownFailed(card.title));
            if (content.sourceHash !== card.sourceHash) throw new LocalizedExportError(() => textNow(text).exportChanged(card.title));
            if (typeof content.markdown !== 'string') throw new LocalizedExportError(() => textNow(text).markdownMissing(card.title));
            contentById.set(card.id, content.markdown);
          }));
        }
      }
      if (controller.signal.aborted || currentSelection.current !== selectionAtStart) return;
      const csv = exportCardsCsv(selectedAtStart, columns, { catalog, contentById, origin: location.origin, source });
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = 'deckmate-cards-' + new Date().toISOString().slice(0, 10) + '.csv';
      document.body.append(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(() => () => textNow(text).csvReady(selectedAtStart.length)); setMenu(null);
    } catch (failure) {
      if (!controller.signal.aborted) {
        controller.abort();
        setError(() => {
          if (failure instanceof LocalizedExportError) return failure.localizedMessage;
          return failureMessage(failure, textNow(text).csvFailed);
        });
      }
    } finally { if (exportRequest.current === controller) { exportRequest.current = null; setRunning(false); } }
  }

  function changeForAction(): BulkChange | null {
    if (!menu || menu === 'more' || menu === 'export') return null;
    switch (menu) {
      case 'hand': return draft.memberId ? { kind: 'hand', memberId: draft.memberId, mode: draft.mode } : null;
      case 'track': return catalog.tracks.some(track => track.id === draft.name) ? { kind: 'track', trackId: draft.name, mode: 'add' } : null;
      case 'bookmark': return { kind: 'options', patch: { bookmarked: draft.mode === 'add' } };
      case 'run': case 'milestone': return { kind: 'options', patch: { [menu]: draft.name.trim() || null } };
      case 'dueDate': return !draft.date || isDate(draft.date) ? { kind: 'options', patch: { dueDate: draft.date || null } } : null;
      case 'parent': {
        if (draft.heroMode === 'new') {
          if (!draft.heroTitle.trim() || !catalog.decks.some(deck => deck.id === draft.heroDeckId && deckAcceptsCard(deck.kind, 'hero'))) return null;
          newHeroId.current ??= 'card:' + crypto.randomUUID();
          return { kind: 'create-parent', cardId: newHeroId.current, title: draft.heroTitle.trim(), deckId: draft.heroDeckId };
        }
        const hero = parentCandidates.find(card => card.id === draft.parentId);
        return draft.parentId && !hero ? null : { kind: 'parent', parentId: hero?.id ?? null, parentSourceHash: hero?.sourceHash ?? null };
      }
      case 'effort': {
        const effort = draft.effort.trim() ? Number(draft.effort) : null;
        return effort !== null && (!Number.isFinite(effort) || effort < 0) ? null : { kind: 'properties', effort };
      }
      case 'priority': return { kind: 'properties', priority: draft.priority || null };
      case 'owner': return !draft.owner || members.some(member => member.label === draft.owner) ? { kind: 'properties', owner: draft.owner || null } : null;
      case 'tags': {
        const tags = draft.tags;
        if (!tags.length || tags.length > 100 || tags.some(tag => tag.length > 80 || /[\u0000-\u001f]/u.test(tag))) return null;
        return { kind: 'tags', tags, mode: draft.mode };
      }
      case 'convert': return !draft.deckId || compatibleDecks.some(deck => deck.id === draft.deckId) ? { kind: 'convert', cardKind: draft.cardKind, deckId: draft.deckId || null } : null;
      case 'duplicate': {
        if (draft.deckId && !compatibleDecks.some(deck => deck.id === draft.deckId)) return null;
        const copies = selected.map(card => {
          if (!duplicateIds.current.has(card.id)) duplicateIds.current.set(card.id, 'card:' + crypto.randomUUID());
          return { cardId: card.id, newCardId: duplicateIds.current.get(card.id)! };
        });
        return { kind: 'duplicate', deckId: draft.deckId || null, properties: draft.properties, copies };
      }
      case 'done': {
        if (draft.mode === 'remove' && selected.some(card => card.state === 'review')) return null;
        return { kind: 'state', state: draft.mode === 'add' ? 'done' : 'not-started' };
      }
      case 'archive': return { kind: 'options', patch: { archived: true } };
      case 'unarchive': return { kind: 'options', patch: { archived: false } };
      case 'delete': return { kind: 'options', patch: { deleted: true } };
      case 'restore': return { kind: 'options', patch: { deleted: false } };
    }
  }

  function modeControl(addLabel: string, removeLabel: string, blockRemove = false) {
    return <div className="bulk-mode-choice">{(['add', 'remove'] as const).map(mode => <label key={mode}><input type="radio" name={id + '-mode'} value={mode} checked={draft.mode === mode} disabled={mode === 'remove' && blockRemove} onChange={() => update('mode', mode)} />{mode === 'add' ? addLabel : removeLabel}</label>)}</div>;
  }
  function searchInput(placeholder: string) {
    return <label className="bulk-search"><Search size={15} /><span className="visually-hidden">{placeholder}</span><input data-autofocus type="search" value={draft.query} onChange={event => update('query', event.target.value)} placeholder={placeholder} /></label>;
  }
  function currentValues(value: (card: CatalogCard) => string) {
    const values = [...new Set(selected.map(value))];
    return <p className="bulk-current" title={values.join(', ')}>{t.uiCurrent}: {values.length === 1 ? values[0] : t.differentValues(values.length)}</p>;
  }
  function deckPicker() {
    return <label className="bulk-field">{t.uiDeck}<select value={draft.deckId} onChange={event => update('deckId', event.target.value)}><option value="">{t.noDeck}</option>{compatibleDecks.map(deck => <option key={deck.id} value={deck.id}>{deck.title}</option>)}</select></label>;
  }
  function panelContent(): ReactNode {
    switch (menu) {
      case 'hand': case 'owner': return <>
        {menu === 'hand' ? modeControl(t.uiAddToHand, t.uiRemoveFromHand) : currentValues(card => card.owner ?? t.uiUnassigned)}
        {searchInput(menu === 'hand' ? t.uiFindAHand : t.uiFindAnOwner)}
        <div className="bulk-pick-list">
          {menu === 'owner' && <button type="button" className="bulk-pick-option" aria-pressed={!draft.owner} onClick={() => update('owner', '')}><UserRound size={16} /><span>{t.uiUnassigned}</span>{!draft.owner && <Check size={15} />}</button>}
          {members.filter(member => [member.label, member.id, ...member.aliases].join(' ').toLocaleLowerCase('ru').includes(query)).map(member => {
            const checked = menu === 'hand' ? draft.memberId === member.id : draft.owner === member.label;
            return <button key={member.id} type="button" className="bulk-pick-option" aria-pressed={checked} onClick={() => { if (menu === 'hand') update('memberId', member.id); else update('owner', member.label); }}><CardOwnerAvatar owner={member.label} members={members} /><span>{member.label}</span>{menu === 'hand' && <small>{amount(selected.filter(card => card.handMemberIds?.includes(member.id)).length)} / {amount(selected.length)}</small>}{checked && <Check size={15} />}</button>;
          })}
          {!members.length && <p className="bulk-help">{t.noMembers}</p>}
        </div>
        {menu === 'hand' && <p className="bulk-help">{t.handHint}</p>}
        {menu === 'owner' && members.some(member => member.kind === 'agent') && <div className="bulk-agent-hint"><AgentQueueHint /></div>}
        {menu === 'hand' && draft.mode === 'add' && members.find(member => member.id === draft.memberId)?.kind === 'agent' && <div className="bulk-agent-hint"><AgentQueueHint assignment="hand" /></div>}
      </>;
      case 'bookmark': return <>{currentValues(card => card.bookmarked ? t.uiBookmarked : t.uiNotBookmarked)}{modeControl(t.uiBookmarkAll, t.uiClearBookmarks)}</>;
      case 'track': return <><p className="bulk-help">{t.trackHint}</p><div className="bulk-pick-list">{catalog.tracks.map(track => {
        const included = selected.every(card => card.trackIds.includes(track.id));
        return <button key={track.id} type="button" className="bulk-pick-option" aria-pressed={draft.name === track.id} disabled={included}
          onClick={() => update('name', track.id)}><Route size={16} /><span>{track.title}</span>{included && <Check size={15} />}</button>;
      })}</div></>;
      case 'run': case 'milestone': {
        const choices = menu === 'run'
          ? orderedRunChoices(catalog.runs ?? []).map(run => ({ id: run.id, label: runChoiceLabel(run, lang) }))
          : [...catalog.milestones ?? []].sort((first, second) => first.date.localeCompare(second.date)).map(milestone => ({ id: milestone.id, label: milestone.title }));
        const labels = new Map(choices.map(choice => [choice.id, choice.label]));
        // 2026-11-05: preserve a legacy assignment while only offering registered plans for a new one.
        const unknownSelection = draft.name && !labels.has(draft.name);
        return <>{currentValues(card => labels.get(card[menu] ?? '') ?? card[menu] ?? t.uiNone)}<label className="bulk-field">{actionLabel}<select data-autofocus value={draft.name} onChange={event => update('name', event.target.value)}><option value="">{t.uiNone}</option>{unknownSelection && <option value={draft.name}>{draft.name}</option>}{choices.map(choice => <option key={choice.id} value={choice.id}>{choice.label}</option>)}</select></label><Button type="button" variant="ghost" size="sm" onClick={() => update('name', '')}>{t.uiClear} {actionLabel}</Button></>;
      }
      case 'dueDate': return <>{currentValues(card => card.dueDate ? new Intl.DateTimeFormat(locale(lang), { timeZone: 'UTC' }).format(new Date(`${card.dueDate}T00:00:00Z`)) : t.uiNone)}<label className="bulk-field">{t.uiDueDate}<input data-autofocus type="date" value={draft.date} onChange={event => update('date', event.target.value)} /></label><Button type="button" variant="ghost" size="sm" onClick={() => update('date', '')}>{t.uiClearDueDate}</Button></>;
      case 'effort': return <>{currentValues(card => card.effort == null ? t.uiNone : new Intl.NumberFormat(locale(lang), { maximumFractionDigits: 20 }).format(card.effort))}<p className="bulk-help">{t.effortHint(effortLabel)}</p><label className="bulk-field">{t.uiEffort}<input data-autofocus type="number" min="0" step="any" value={draft.effort} placeholder={t.uiNone} onChange={event => update('effort', event.target.value)} /></label><Button type="button" variant="ghost" size="sm" onClick={() => update('effort', '')}>{t.uiClearEffort}</Button></>;
      case 'priority': return <>{currentValues(card => card.priority ? priorityLabel(card.priority, lang) : t.uiNone)}<div className="bulk-pick-list">{([{ value: 'high', label: priorityLabel('high', lang) }, { value: 'medium', label: priorityLabel('medium', lang) }, { value: 'low', label: priorityLabel('low', lang) }, { value: '', get label() { return textNow(text).uiNone; } }] as const).map(priority => <button key={priority.value} type="button" className="bulk-pick-option" aria-pressed={draft.priority === priority.value} onClick={() => update('priority', priority.value)}><Layers size={16} /><span>{priority.label}</span>{draft.priority === priority.value && <Check size={15} />}</button>)}</div></>;
      case 'parent': return <>
        <div className="bulk-tabs" role="group" aria-label={t.uiHeroCard}><Button type="button" variant="ghost" size="sm" aria-pressed={draft.heroMode === 'existing'} onClick={() => update('heroMode', 'existing')}>{t.uiFindExisting}</Button><Button type="button" variant="ghost" size="sm" aria-pressed={draft.heroMode === 'new'} onClick={() => update('heroMode', 'new')}>{t.uiCreateNew}</Button></div>
        {draft.heroMode === 'new' ? <><label className="bulk-field">{t.uiHeroTitle}<input data-autofocus value={draft.heroTitle} maxLength={1000} onChange={event => update('heroTitle', event.target.value)} /></label><label className="bulk-field">{t.uiCreateCardInDeck}<select value={draft.heroDeckId} onChange={event => update('heroDeckId', event.target.value)}><option value="">{t.uiChooseDeck}</option>{catalog.decks.filter(deck => deckAcceptsCard(deck.kind, 'hero')).map(deck => <option key={deck.id} value={deck.id}>{deck.title}</option>)}</select></label><p className="bulk-help">{t.heroHint}</p></> : <>
          {currentValues(card => catalog.cards.find(candidate => candidate.id === card.parentId)?.title ?? t.uiNone)}{searchInput(t.uiFindAHeroDocCard)}
          <div className="bulk-pick-list"><button type="button" className="bulk-pick-option" aria-pressed={!draft.parentId} onClick={() => update('parentId', '')}><X size={16} /><span>{t.uiRemoveParent}</span>{!draft.parentId && <Check size={15} />}</button>
            {(['hero', 'doc'] as const).map(kind => {
              const referenceQuery = query.match(/\bc-[a-z0-9]{10}\b/u)?.[0] ?? query;
              const matches = parentCandidates.filter(card => card.kind === kind && [card.title, card.id, shortReference('c', card.id)].join(' ').toLocaleLowerCase('ru').includes(referenceQuery));
              const Icon = kind === 'hero' ? Crown : NotebookText;
              return matches.length > 0 && <div key={kind}><p className="bulk-help">{kind === 'hero' ? t.uiHeroCards : t.uiDocCards}</p>{matches.map(parent => <button key={parent.id} type="button" className="bulk-pick-option" aria-pressed={draft.parentId === parent.id} onClick={() => update('parentId', parent.id)}><Icon size={16} /><span>{parent.title}</span>{draft.parentId === parent.id && <Check size={15} />}</button>)}</div>;
            })}
          </div>
        </>}
      </>;
      case 'tags': return <>{modeControl(t.uiAddTags, t.uiRemoveTags)}<CardTags tags={draft.tags} definitions={catalog.projectTags} /><TagSelectionList tags={knownTags} definitions={catalog.projectTags} selected={draft.tags} query={draft.query} onQueryChange={value => update('query', value)} onToggle={name => { const tags = draft.tags; update('tags', tags.includes(name) ? tags.filter(value => value !== name) : [...tags, name]); }} disabled={busy} />{validTagName(draft.query.trim()) && !knownTags.some(tag => tag.name === draft.query.trim()) && <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => { update('tags', [...new Set([...draft.tags, draft.query.trim()])]); update('query', ''); }}>{t.addTag(draft.query.trim())}</Button>}</>;
      case 'convert': return <><p className="bulk-help">{t.convertHint}</p><label className="bulk-field">{t.uiType}<select value={draft.cardKind} onChange={event => { update('cardKind', event.target.value as 'task' | 'doc'); update('deckId', ''); }}><option value="doc">{t.uiDocCard}</option><option value="task">{t.uiTask}</option></select></label>{deckPicker()}</>;
      case 'duplicate': return <>{deckPicker()}<p className="bulk-help">{t.copyHint}</p><fieldset className="bulk-checkboxes"><legend>{t.uiCopyProperties}</legend>{copyProperties.map(property => <label key={property.id}><input type="checkbox" checked={draft.properties.includes(property.id)} onChange={event => update('properties', event.target.checked ? [...draft.properties, property.id] : draft.properties.filter(value => value !== property.id))} />{property.label}</label>)}</fieldset></>;
      case 'export': return <><p className="bulk-help">{t.exportHint}</p><fieldset className="bulk-checkboxes"><legend>{t.uiColumns}</legend>{cardExportColumns.map(column => <label key={column.id}><input type="checkbox" checked={draft.columns.includes(column.id)} onChange={event => update('columns', event.target.checked ? [...draft.columns, column.id] : draft.columns.filter(value => value !== column.id))} />{column.label}</label>)}</fieldset><Button type="button" variant="ghost" size="sm" onClick={() => update('columns', [...defaultCardExportColumns])}>{t.uiDefaultColumns}</Button></>;
      case 'done': return <>{currentValues(card => stateLabel(card.state ?? 'not-started', lang))}{modeControl(t.uiMarkAsDone, t.reopen(stateLabel('not-started', lang)), selected.some(card => card.state === 'review'))}{selected.some(card => card.state === 'review') && <p className="bulk-help">{t.individualReturn}</p>}</>;
      case 'archive': return <p>{t.archiveConfirm(selected.length)}</p>;
      case 'unarchive': return <p>{t.unarchiveConfirm(selected.length)}</p>;
      case 'delete': return <><p>{t.deleteConfirm(selected.length)}</p>{selected.some(card => card.kind === 'hero') && <p className="bulk-help">{t.deleteHeroHint}</p>}</>;
      case 'restore': return <><p>{t.restoreConfirm(selected.length)}</p>{selected.some(card => card.kind === 'hero') && <p className="bulk-help">{t.restoreHeroHint}</p>}</>;
      default: return null;
    }
  }
  let submitLabel = t.applyCount(selected.length);
  if (menu === 'export') submitLabel = t.uiExportCSV;
  if (menu === 'parent' && draft.heroMode === 'new') submitLabel = t.uiCreateHero;
  if (menu === 'duplicate') submitLabel = t.copyCount(selected.length);

  return <div ref={actionBar} className="bulk-actions" role="group" aria-label={t.actions} aria-busy={busy}>
    {actions.filter(action => directActions.includes(action.id)).map(action => {
      const disabled = reason(action.id);
      const shortcut = shortcutForBulkAction(action.id);
      return <Button key={action.id} type="button" variant="ghost" size="icon" className="bulk-action-button" disabled={Boolean(disabled)} aria-label={action.label} aria-keyshortcuts={shortcut?.keys} aria-haspopup="dialog" aria-expanded={menu === action.id} aria-controls={menu === action.id ? id + '-dialog' : undefined} title={disabled ?? (action.label + (shortcut ? ' · ' + shortcut.keys : ''))} onClick={event => openAction(action.id, event.currentTarget)}><action.Icon size={16} /></Button>;
    })}
    <DropdownMenu.Root modal={false} open={menu === 'more'} onOpenChange={open => {
      if (open) { openingDialogFromMenu.current = false; setMenu('more'); setError(''); }
      else setMenu(current => current === 'more' ? null : current);
    }}>
      <DropdownMenu.Trigger asChild><Button ref={moreButton} type="button" variant="ghost" size="icon" disabled={busy || !selected.length} aria-label={t.uiMoreActions} title={t.uiMoreActions}><MoreHorizontal size={17} /></Button></DropdownMenu.Trigger>
      <DropdownMenu.Portal><DropdownMenu.Content className="bulk-more-menu dialog-panel" align="end" sideOffset={7} collisionPadding={10} onEscapeKeyDown={event => { event.preventDefault(); closeMenu(); }} onCloseAutoFocus={event => { if (openingDialogFromMenu.current) event.preventDefault(); }}>
        {actionGroups.map(group => <DropdownMenu.Group key={group.key}>
          <DropdownMenu.Label className="bulk-more-heading">{t[group.key]}</DropdownMenu.Label>
          {compact && group.key === 'organization' && overflowOrganization}
          {compact && group.key === 'export' && overflowExport}
          {[...actions, ...extraActions].filter(action => group.ids.includes(action.id) && !directActions.includes(action.id)).map(action =>
            <DropdownMenu.Item key={action.id} className="bulk-more-item" disabled={Boolean(reason(action.id))} title={reason(action.id) ?? undefined}
              onSelect={event => { event.preventDefault(); openingDialogFromMenu.current = true; openAction(action.id, moreButton.current ?? undefined); }}><action.Icon size={16} /><span>{action.label}</span></DropdownMenu.Item>)}
        </DropdownMenu.Group>)}
      </DropdownMenu.Content></DropdownMenu.Portal>
    </DropdownMenu.Root>
    {(notice || error && !dialogOpen) && <span className="bulk-action-feedback" role={error ? 'alert' : 'status'} title={error || notice}>{error || notice}</span>}
    <Dialog.Root modal={false} open={dialogOpen} onOpenChange={open => { if (!open) closeMenu(); }}><Dialog.Portal><Dialog.Content ref={dialog} id={id + '-dialog'} className="bulk-actions-dialog dialog-panel" aria-busy={busy}
      onOpenAutoFocus={event => {
        event.preventDefault();
        const target = dialog.current?.querySelector<HTMLElement>('[data-autofocus]')
          ?? dialog.current?.querySelector<HTMLElement>('.bulk-dialog-body :is(input,select,button):not(:disabled)')
          ?? dialog.current?.querySelector<HTMLElement>('.bulk-dialog-footer button:not(:disabled)');
        moveFocus(target);
      }}
      onCloseAutoFocus={event => {
        event.preventDefault();
        const target = opener.current?.isConnected && opener.current.getClientRects().length ? opener.current : moreButton.current;
        if (target?.isConnected) moveFocus(target, { preventScroll: true });
      }}
      onEscapeKeyDown={event => { event.preventDefault(); closeMenu(); }}>
      <header className="bulk-dialog-header dialog-head"><div><Dialog.Title className="dialog-title">{actionLabel}</Dialog.Title><Dialog.Description className="page-caption">{t.selectedCount(selected.length)}</Dialog.Description></div><Button type="button" variant="ghost" size="icon" aria-label={t.close} onClick={closeMenu}><X size={17} /></Button></header>
      <form onSubmit={event => { event.preventDefault(); if (menu === 'export') void downloadCsv(); else {
        const change = changeForAction();
        if (!change) { setError(() => () => textNow(text).invalid); return; }
        // Warn before writing Done when prerequisites remain unfinished.
        if (doneConflicts.length > 0 && !dependenciesConfirmed) { setConfirmingDependencies(true); return; }
        void mutate(change);
      } }}>
        <div className="bulk-dialog-body dialog-body">
        {conflict && <div className="bulk-action-warning" role="alert">{t.conflict}<Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => { setBaseSignature(signature); setError(''); }}>{t.useCurrent}</Button></div>}
        <fieldset disabled={busy}>{panelContent()}</fieldset>
        {confirmingDependencies && doneConflicts.length > 0 && <DependencyStateWarning conflicts={doneConflicts} busy={busy}
          onConfirm={() => { setDependenciesConfirmed(true); setConfirmingDependencies(false); const change = changeForAction(); if (change) void mutate(change); }}
          onCancel={() => setConfirmingDependencies(false)} />}
        {error && <div className="bulk-action-warning" role="alert"><p>{error}</p>
          {failedStateCards.length > 0 && <><p>{t.requestedCards}</p><ul>{failedStateCards.map(card => <li key={card.id}>{card.title}</li>)}</ul></>}
        </div>}
        </div>
        <footer className="bulk-dialog-footer dialog-foot"><Button type="button" variant="ghost" size="sm" onClick={closeMenu}>{t.uiCancel}</Button><Button type="submit" size="sm" disabled={busy || conflict || overLimit || !selected.length || menu !== 'export' && source !== 'sandbox' || menu === 'export' && draft.columns.length === 0}>{running && <LoaderCircle size={14} className="spin" />}{submitLabel}</Button></footer>
      </form>
    </Dialog.Content></Dialog.Portal></Dialog.Root>
  </div>;
}
