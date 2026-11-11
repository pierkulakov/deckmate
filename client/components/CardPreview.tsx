import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { failureMessage } from '../failure-message.ts';
import * as Dialog from '@radix-ui/react-dialog';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import type { RootContent } from 'mdast';
import { Archive, ArchiveRestore, Bookmark, Check, Copy, Crown, Eye, History, Link2, LoaderCircle, MoreHorizontal, Paperclip, Pause, Play, RotateCcw, Route, Scan, SlidersHorizontal, Trash2, Undo2, X } from 'lucide-react';
import { deckAcceptsCard, type CardContent, type CatalogCard, type CatalogView } from '../../src/catalog-contracts.ts';
import type { BulkChange } from '../../src/bulk-contracts.ts';
import { openDependencies } from '../../src/dependency-contracts.ts';
import type { NotificationsView } from '../../src/notification-contracts.ts';
import type { SliceStatus, WorkspaceSnapshot } from '../../src/workspace-contracts.ts';
import type { CatalogAction } from '../useCatalog.ts';
import { CardTags, TagBadge } from './CardTags.tsx';
import { CardPropertiesPanel, cardHeroEffort } from './CardPropertiesPanel.tsx';
import { shortReference } from '../../src/references.ts';
import { markdownParser } from '../../src/markdown-model.ts';
import { CardContentEditor, cardReadOnlyDescription } from './CardContentEditor.tsx';
import { CardFocusMode } from './CardFocusMode.tsx';
import { CardOwnerAvatar, CardQuickSettings, type CardQuickSettingsTab } from './CardQuickSettings.tsx';
import { EffortIcon } from './EffortIcon.tsx';
import { DeckPicker } from './DeckPicker.tsx';
import { ApplyJourneyPanel } from './JourneyPanel.tsx';
import { JourneyTrack } from './JourneyTrack.tsx';
import { CardDependenciesSection, CardHistorySection, SubCardProgress, subCardsCount, uniqueCardTitles } from './CardFamily.tsx';
import { DependencyStateWarning, dependencyConflicts, type DependencyConflict } from './DependencyWarning.tsx';
import { AttachmentsPanel, useCardAttachments } from './AttachmentsPanel.tsx';
import { catalogHandPositions, getCatalogHands, localIsoDate } from '../../src/catalog-hand.ts';
import { ReviewReturnPrompt, isReviewReturn, journeyLessonAction, type ReviewReturnAnswer } from './ReviewReturnPrompt.tsx';
import { resolveCardStateAction, type CardReviewFocus, type CardReviewRequest, type CardStateAction } from '../card-state-actions.ts';
import { buildCatalogLookups, familyChildren } from '../catalog-lookups.ts';
import { useJustFinished } from '../done-impact.ts';
import { heroFinished, heroTakesManualDone } from '../../src/hero-done.ts';
import { useCardTilt } from '../useCardTilt.ts';
import { OPEN_CARD_SHORTCUTS, claimOpenCardShortcuts, markShortcutPropertyHover, matchShortcut, resolveCardShortcutAction, resolveHoveredCardShortcut, shortcutTargetBlocked } from '../keyboard-shortcuts.ts';
import { currentMember, onMemberChange } from '../current-member.ts';
import { countCatalogCardWords } from '../card-word-count.ts';
import { Button } from './ui/button.tsx';
import { defineText, textNow, useLang, useText } from '../i18n.ts';
import { moveFocus } from '../focus.ts';
import { priorityLabel, stateLabel } from '../locales/common.ts';
import { memberForOwner, ownerInitials, ownerProgressLabel } from './CardOwnerAvatar.tsx';
import { JourneyStepNote } from './JourneyStepNote.tsx';
import { PriorityIcon } from './PriorityIcon.tsx';
import { CardHandHint } from './CardHandHint.tsx';
import { HandIcon } from './HandIcon.tsx';
import { viewNavigation } from '../app-navigation.ts';
import '../card-preview.css';
// 2026-11-10: the preview uses the shared surface classes; importing them here keeps fixtures that mount it alone styled too.
import '../surface.css';
import '../card-state-row.css';
import { prepareEntrance } from '../prepared-motion.ts';

const text = defineText({
  copyLink: 'Copy card link',
  attachmentsUnavailable: 'Attachments could not be checked. Open the panel to retry.',
  overdue: 'Due date overdue',
  copyReference: (reference: string) => `Copy ID ${reference}`,
  copied: 'Copied',
  copyFailed: 'Could not copy',
  tagCards: (count: number) => `${count} ${new Intl.PluralRules('en-US').select(count) === 'one' ? 'card' : 'cards'}`,
  watchLoadFailed: 'Could not read the watch list.',
  watchUnavailable: 'The watch list is unavailable. Check the notifications file and reopen the menu.',
  watchOpenFailed: 'Could not read the watch list. Reopen the menu.',
  watchSaveFailed: 'Could not save the watch setting. Reopen the menu.',
  stale: 'The card or catalog changed. Close the menu and try again with current data.',
  useCurrentReturn: 'Use current data; keep the reason',
  returnStale: 'The card or catalog changed. Use current data to retry; your reason is kept.',
  notConfirmed: 'Change not confirmed. Check the catalog message and try again.',
  saveFailed: 'Could not save the change. Try again.',
  loadMarkdown: 'Could not load card Markdown.',
  changedDuringCopy: 'The card changed while copying. Reopen the menu.',
  invalidMarkdown: 'The server did not return the full card Markdown.',
  copiedLegacy: 'Markdown copied. This is a project document: its content was copied without the YAML metadata block.',
  copiedMarkdown: 'Card Markdown copied.',
  copyMarkdownFailed: 'Could not copy Markdown. Check clipboard access.',
  noMember: 'Add a member to the team to assign the card to yourself.',
  stateNotConfirmed: 'State change not confirmed. Check current data and try again.',
  lessonFailed: 'The card was returned, but the step lesson was not recorded. The reason is in the card journal; add the lesson to the Journey step manually.',
  stateFailed: 'Could not change the state. Try again.',
  moreActions: 'Open card actions',
  legacyHelp: 'Project document: Markdown is copied without the YAML metadata block.',
  sandboxChanges: 'Changes are available in the test copy.',
  menuConflict: 'The card or catalog changed. Reopen the menu.',
  card: (title: string) => `Card: ${title}`,
  noDeck: 'No deck',
  moveDeck: 'Move to another deck',
  closeCard: 'Close card',
  openFamily: 'Open Hero and Sub Cards',
  returnToHero: (title: string) => `Back to Hero: ${title} · Esc`,
  parentProgress: (done: number, total: number) => `Hero: ${done} of ${total} done`,
  cardState: 'Card state',
  stateGroup: (state: string) => `State: ${state}`,
  stateAction: (state: string, action: string) => `${state} — ${action}`,
  start: 'Start work',
  stop: 'Stop work · return to planned',
  reviewInProgress: 'Review in progress · decide with the review button',
  openReview: 'Open review',
  acceptReview: 'Accept review',
  requestChanges: 'Request changes…',
  reopen: 'Reopen · return to planned',
  reopenCard: 'Reopen',
  reopenRequired: 'Reopen the card before starting work.',
  showDependencies: 'Show dependencies',
  blockers: (count: number) => `Dependencies and blockers${count ? ` (${count})` : ''}`,
  review: 'Submit for review',
  accept: 'Accept card',
  heroDone: 'Mark Hero done',
  heroUndone: 'Remove the done mark',
  applyJourney: 'Apply Journey to Hero Card',
  journey: 'Journey',
  tagCardsLabel: (name: string) => `All cards with tag “${name}”`,
  tagLabel: 'Tag',
  missingSource: 'This card’s source disappeared from the index. Showing the last version; changing links and applying Journey are unavailable.',
  backlinks: 'Links to this card',
  notSet: 'not set',
  effort: 'Effort',
  priority: 'Priority',
  effortLabel: (value: string) => `Effort: ${value}`,
  editEffort: 'Edit Effort',
  priorityLabel: (value: string) => `Priority: ${value}`,
  editPriority: 'Edit Priority',
  panels: 'Card panels',
  contentPanel: 'Content',
  propertiesPanel: 'Properties',
  attachmentsPanel: 'Attachments',
  focusMode: 'Focus Mode',
  moreOptions: 'More Options',
  family: 'Hero and Sub Cards',
  trashChildren: 'This card’s Sub Cards, including archived ones, will also move to Trash. They can be restored with the parent.',
  removalConflict: 'The card or catalog changed. Close this window and try again with current data.',
  cancel: 'Cancel',
  archiveQuestion: (title: string) => `Archive “${title}”? Files are preserved.`,
  unarchiveQuestion: (title: string) => `Restore “${title}” from the archive? Files are preserved.`,
  deleteQuestion: (title: string) => `Move “${title}” to Trash? Files are preserved.`,
  copyCardContent: 'Copy Card Content',
  unbookmarkCard: 'Unbookmark Card',
  bookmarkCard: 'Bookmark Card',
  sharedBookmark: 'Bookmarks are shared by everyone in the project.',
  addToHand: 'Add to my Hand',
  openHand: (member: string) => `Open Hand: ${member}`,
  handMemberRequired: 'Add a team member to use Hand.',
  handBusy: 'Finish the current action before changing Hand.',
  unwatchCard: 'Unwatch Card',
  watchCard: 'Watch Card',
  unstartCard: 'Unstart this Card',
  archiveCard: 'Archive Card',
  unarchiveCard: 'Unarchive Card',
  restoreCard: 'Restore Card',
  moveToTrash: 'Move to Trash',
  subCardsCount: subCardsCount.en,
  startJourney: 'Start Journey',
  fullTitle: 'Show full title',
  collapseTitle: 'Collapse title',
  dependenciesPanel: 'Dependencies',
  historyPanel: 'History',
  archived: 'Archived',
  trashed: 'In Trash — file preserved. Restore before editing.',
  staysArchived: 'Restoring keeps this card archived.',
  restore: 'Restore',
  returnReview: 'Request changes',
  returnDescription: 'Describe what needs changing. The reason will be recorded in the card history.',
  words: (count: number) => `${new Intl.NumberFormat('en-US').format(count)} ${new Intl.PluralRules('en-US').select(count) === 'one' ? 'word' : 'words'}`,
}, {
  copyLink: 'Скопировать ссылку на карточку',
  attachmentsUnavailable: 'Не удалось проверить вложения. Откройте панель для повтора.',
  overdue: 'Срок просрочен',
  copyReference: (reference: string) => `Скопировать ID ${reference}`,
  copied: 'Скопировано',
  copyFailed: 'Не удалось скопировать',
  tagCards: (count: number) => {
    const rule = new Intl.PluralRules('ru-RU').select(count);
    if (rule === 'one') return `${count} карточка`;
    if (rule === 'few') return `${count} карточки`;
    return `${count} карточек`;
  },
  watchLoadFailed: 'Не удалось прочитать список наблюдения.',
  watchUnavailable: 'Список наблюдения недоступен. Проверьте файл уведомлений и откройте меню заново.',
  watchOpenFailed: 'Не удалось прочитать список наблюдения. Откройте меню заново.',
  watchSaveFailed: 'Не удалось сохранить наблюдение. Откройте меню заново.',
  stale: 'Карточка или каталог изменились. Закройте меню и повторите действие с актуальными данными.',
  useCurrentReturn: 'Использовать актуальные данные, сохранив причину',
  returnStale: 'Карточка или каталог изменились. Используйте актуальные данные для повтора; причина сохранена.',
  notConfirmed: 'Изменение не подтверждено. Проверьте сообщение каталога и повторите действие.',
  saveFailed: 'Не удалось сохранить изменение. Повторите действие.',
  loadMarkdown: 'Не удалось загрузить Markdown карточки.',
  changedDuringCopy: 'Карточка изменилась во время копирования. Откройте меню заново.',
  invalidMarkdown: 'Сервер не вернул полный Markdown карточки.',
  copiedLegacy: 'Markdown скопирован. Это документ проекта: скопировано его содержимое без служебной YAML-шапки.',
  copiedMarkdown: 'Markdown карточки скопирован.',
  copyMarkdownFailed: 'Не удалось скопировать Markdown. Проверьте доступ к буферу обмена.',
  noMember: 'Добавьте участника в состав команды, чтобы назначить карточку себе.',
  stateNotConfirmed: 'Изменение состояния не подтверждено. Проверьте актуальные данные и повторите действие.',
  lessonFailed: 'Карточка возвращена, но грабли шага не записаны. Причина есть в журнале карточки; допишите грабли в шаг Journey вручную.',
  stateFailed: 'Не удалось изменить состояние. Повторите действие.',
  moreActions: 'Действия открытой карточки',
  legacyHelp: 'Документ проекта: копируется Markdown без служебной YAML-шапки.',
  sandboxChanges: 'Изменения доступны в тестовой копии.',
  menuConflict: 'Карточка или каталог изменились. Откройте меню заново.',
  card: (title: string) => `Карточка: ${title}`,
  noDeck: 'Без колоды',
  moveDeck: 'Переместить в другую колоду',
  closeCard: 'Закрыть карточку',
  openFamily: 'Открыть Hero и Sub Cards',
  returnToHero: (title: string) => `Вернуться к Hero: ${title} · Esc`,
  parentProgress: (done: number, total: number) => `Hero: принято ${done} из ${total}`,
  cardState: 'Состояние карточки',
  stateGroup: (state: string) => `Состояние: ${state}`,
  stateAction: (state: string, action: string) => `${state} — ${action}`,
  start: 'Начать работу',
  stop: 'Остановить работу · вернуть в план',
  reviewInProgress: 'Идёт приёмка · решение — в кнопке приёмки',
  openReview: 'Открыть приёмку',
  acceptReview: 'Принять результат',
  requestChanges: 'Вернуть на доработку…',
  reopen: 'Открыть снова · вернуть в план',
  reopenCard: 'Открыть снова',
  reopenRequired: 'Откройте карточку снова, прежде чем начинать работу.',
  showDependencies: 'Показать зависимости',
  blockers: (count: number) => `Зависимости и препятствия${count ? ` (${count})` : ''}`,
  review: 'Отправить на приёмку',
  accept: 'Принять карточку',
  heroDone: 'Отметить Hero выполненной',
  heroUndone: 'Снять отметку «выполнена»',
  applyJourney: 'Применить Journey к Hero Card',
  journey: 'Journey',
  tagCardsLabel: (name: string) => `Все карточки с тегом «${name}»`,
  tagLabel: 'Тег',
  missingSource: 'Источник этой карточки исчез из индекса. Показана последняя версия; изменение связей и применение Journey недоступны.',
  backlinks: 'Ссылается сюда',
  notSet: 'не задан',
  effort: 'Оценка',
  priority: 'Приоритет',
  effortLabel: (value: string) => `Оценка: ${value}`,
  editEffort: 'Изменить оценку',
  priorityLabel: (value: string) => `Приоритет: ${value}`,
  editPriority: 'Изменить приоритет',
  panels: 'Панели карточки',
  contentPanel: 'Содержимое',
  propertiesPanel: 'Свойства',
  attachmentsPanel: 'Вложения',
  focusMode: 'Фокус-режим',
  moreOptions: 'Ещё действия',
  family: 'Hero и Sub Cards',
  trashChildren: 'В корзину также попадут Sub Cards этой карточки, включая архивные. Их можно восстановить вместе с родителем.',
  removalConflict: 'Карточка или каталог изменились. Закройте это окно и повторите действие с актуальными данными.',
  cancel: 'Отмена',
  archiveQuestion: (title: string) => `Архивировать «${title}»? Файлы сохраняются.`,
  unarchiveQuestion: (title: string) => `Вернуть из архива «${title}»? Файлы сохраняются.`,
  deleteQuestion: (title: string) => `Переместить в корзину «${title}»? Файлы сохраняются.`,
  copyCardContent: 'Скопировать содержимое карточки',
  unbookmarkCard: 'Убрать из закладок',
  bookmarkCard: 'Добавить в закладки',
  sharedBookmark: 'Закладки общие для всех участников проекта.',
  addToHand: 'В мой Hand',
  openHand: (member: string) => `Открыть Hand: ${member}`,
  handMemberRequired: 'Добавьте участника команды, чтобы пользоваться Hand.',
  handBusy: 'Завершите текущее действие, чтобы изменить Hand.',
  unwatchCard: 'Отключить наблюдение',
  watchCard: 'Наблюдать за карточкой',
  unstartCard: 'Вернуть в план',
  archiveCard: 'Архивировать карточку',
  unarchiveCard: 'Вернуть из архива',
  restoreCard: 'Восстановить карточку',
  moveToTrash: 'В корзину',
  subCardsCount: subCardsCount.ru,
  startJourney: 'Запустить Journey',
  fullTitle: 'Название целиком',
  collapseTitle: 'Свернуть название',
  dependenciesPanel: 'Зависимости',
  historyPanel: 'История',
  archived: 'В архиве',
  trashed: 'В корзине — файл сохранён. Для правки восстановите карточку.',
  staysArchived: 'После восстановления карточка останется в архиве.',
  restore: 'Восстановить',
  returnReview: 'Вернуть на доработку',
  returnDescription: 'Укажите, что нужно исправить. Причина останется в истории карточки.',
  words: (count: number) => {
    const rule = new Intl.PluralRules('ru-RU').select(count);
    let unit = 'слов';
    if (rule === 'one') unit = 'слово';
    if (rule === 'few') unit = 'слова';
    return `${new Intl.NumberFormat('ru-RU').format(count)} ${unit}`;
  },
});

interface CardPreviewProps {
  card: CatalogCard;
  catalog: CatalogView;
  snapshot: WorkspaceSnapshot;
  writable: boolean;
  pending: boolean;
  onClose: () => void;
  onCancelEdit?: () => void;
  onSelect: (card: CatalogCard) => void;
  onOpenSubCard?: (card: CatalogCard) => void;
  onReturnToHero?: () => void;
  onEdit: (action: CatalogAction) => Promise<boolean>;
  onDirtyChange: (dirty: boolean) => void;
  onShowFamily?: () => void;
  onToggleFamily?: () => void;
  onManageJourney?: (opener?: HTMLElement | null) => void;
  onShowTagCards?: (tag: string) => void;
  /** Open is available only when the card is shown outside its own deck. */
  onOpenDeck?: () => void;
  familyVisible?: boolean;
  reviewRequest?: CardReviewRequest;
  onReviewRequestHandled?: (sequence: number) => void;
}
type CardPanel = 'content' | 'properties' | 'attachments' | 'dependencies' | 'history';
type CardRemoval = 'archive' | 'unarchive' | 'delete';
const openCardShortcuts = OPEN_CARD_SHORTCUTS;
function shortcutKeys(id: string): string | undefined { return openCardShortcuts.find(shortcut => shortcut.id === id)?.keys; }

function CardIdChip({ cardId, feedback, onCopy }: { cardId: string; feedback?: 'copied' | 'failed'; onCopy: () => void }) {
  const t = useText(text);
  const reference = shortReference('c', cardId);
  return <span className="card-id-control"><button type="button" className="card-id-chip" data-copied={feedback === 'copied' || undefined}
    title={t.copyReference(reference)} aria-label={t.copyReference(reference)} onClick={onCopy}>{reference}</button>
    <span className="card-id-feedback" role="status" data-state={feedback}>{feedback === 'copied' && <><Check size={12} aria-hidden="true" />{t.copied}</>}{feedback === 'failed' && t.copyFailed}</span></span>;
}

// 2026-11-10: bracketed marks distinguish workflow actions from the app's circular help icons.
function StateBracketIcon({ question = false }: { question?: boolean }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M8 3H5v18h14V3h-3" />
    {question ? <path d="M9.5 7a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4v1" /> : <path d="M12 5v7" />}
    <path d="M12 16h.01" />
  </svg>;
}

function cardLinksTo(candidate: CatalogCard, reference: string, source: string): boolean {
  if (!candidate.markdown.includes(reference)) return false;
  const tree = markdownParser.parse(candidate.markdown);
  const definitions = new Map(tree.children.filter(node => node.type === 'definition').map(node => [node.identifier.toLowerCase(), node.url]));
  function matches(url: string): boolean {
    try {
      const target = new URL(url, location.origin + '/' + candidate.path);
      return target.origin === location.origin && target.pathname === '/r/' + reference
        && (!target.searchParams.has('source') || target.searchParams.get('source') === source);
    } catch { return false; }
  }
  function containsLink(node: RootContent): boolean {
    if (node.type === 'link') return matches(node.url);
    if (node.type === 'linkReference') return matches(definitions.get(node.identifier.toLowerCase()) ?? '');
    return 'children' in node && node.children.some(child => containsLink(child as RootContent));
  }
  // 2026-11-04: derive from indexed bodies; YAML and code nodes never become backlinks.
  return tree.children.some(containsLink);
}

export function CardPreview({ card, catalog, snapshot, writable, pending, onClose, onCancelEdit, onSelect, onOpenSubCard, onReturnToHero, onEdit, onDirtyChange, onShowFamily, onToggleFamily, onManageJourney, onShowTagCards, onOpenDeck, familyVisible, reviewRequest, onReviewRequestHandled }: CardPreviewProps) {
  // 2026-11-11: choose the shell on entry; resizing must not remount an editor with an unsaved draft.
  const [mobile] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  const attachments = useCardAttachments(card.id, snapshot.source);
  const [saving, setSaving] = useState(false);
  const t = useText(text);
  const lang = useLang();
  const [focusMode, setFocusMode] = useState(false);
  const [journeyOpen, setJourneyOpen] = useState(false);
  const [journeySaving, setJourneySaving] = useState(false);
  const [contentEditing, setContentEditing] = useState(false);
  const [propertiesActive, setPropertiesActive] = useState(false);
  // 2026-11-10: the pinned dock's action slot, where CardContentEditor portals its reading footer.
  const [dockActions, setDockActions] = useState<HTMLDivElement | null>(null);
  const [quickSettings, setQuickSettings] = useState<{ cardId: string; tab: CardQuickSettingsTab; anchor: HTMLElement } | null>(null);
  const [quickSaving, setQuickSaving] = useState(false);
  const [panelTarget, setPanelTarget] = useState<{ panel: CardPanel; property?: 'tags' }>({ panel: 'content' });
  const activePanel = panelTarget.panel;
  const panelOpen = activePanel !== 'content';
  const layout = useRef<HTMLDivElement>(null);
  const [stateNotice, setStateNotice] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);
  const [moreRevision, setMoreRevision] = useState('');
  const [selectedMemberId, setSelectedMemberId] = useState(() => currentMember(catalog.members ?? [])?.id ?? '');
  const [watchView, setWatchView] = useState<{ context: string; view: NotificationsView } | null>(null);
  const [watchError, setWatchError] = useState('');
  const [removal, setRemoval] = useState<{ action: CardRemoval; revision: string } | null>(null);
  const copyRequest = useRef<AbortController | null>(null);
  const referenceRequest = useRef(0);
  const [referenceFeedback, setReferenceFeedback] = useState<{ request: number; state: 'copied' | 'failed' } | null>(null);
  // Starting or accepting a card with unfinished prerequisites requires confirmation.
  const [stateQuestion, setStateQuestion] = useState<{ state: SliceStatus; conflicts: DependencyConflict[] } | null>(null);
  // 2026-11-10: all returns from review use the same required feedback and retain their opening revision.
  const [returnState, setReturnState] = useState<SliceStatus | null>(null);
  const [returnError, setReturnError] = useState('');
  const [returnRevision, setReturnRevision] = useState('');
  const returnOpener = useRef<HTMLElement | null>(null);
  const returnSaved = useRef(false);
  const panelOpener = useRef<HTMLElement | null>(null);
  const [titleExpanded, setTitleExpanded] = useState(false);
  const [longTitle, setLongTitle] = useState(false);
  const [openQuestionsActive, setOpenQuestionsActive] = useState(false);
  const stateInFlight = useRef(false);
  const journeyInFlight = useRef(false);
  const journeyOpener = useRef<HTMLElement | null>(null);
  const journeyManaging = useRef(false);
  const preview = useRef<HTMLElement>(null);
  const materialGlare = useCardTilt<HTMLElement>(0);
  const finishGlare = useCardTilt<HTMLDivElement>(0);
  // 2026-11-09: the gold parent bar shares the band's soft glow.
  const parentGlare = useCardTilt<HTMLButtonElement>(0);
  const propertiesContainer = useRef<HTMLDivElement>(null);
  const attachmentsContainer = useRef<HTMLDivElement>(null);
  const relatedContainer = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const playButton = useRef<HTMLButtonElement>(null);
  const reviewButton = useRef<HTMLButtonElement>(null);
  const doneButton = useRef<HTMLButtonElement>(null);
  const reviewAccept = useRef<HTMLDivElement>(null);
  const reviewMenu = useRef<HTMLDivElement>(null);
  const [reviewFocus, setReviewFocus] = useState<CardReviewFocus | null>(null);
  const handledReviewRequest = useRef<number | null>(null);
  const stateFocus = useRef<{ cardId: string; state: SliceStatus } | null>(null);
  const focusedCardId = useRef<string | null>(null);
  const stateMenuClosing = useRef(false);
  const latestCardState = useRef(card.state);
  latestCardState.current = card.state;
  const currentCard = catalog.cards.find(candidate => candidate.id === card.id);
  const revision = JSON.stringify([snapshot.source, card.id, currentCard?.sourceHash, catalog.manifestHash, catalog.optionsHash]);
  const latestRevision = useRef(revision);
  latestRevision.current = revision;
  const exists = Boolean(currentCard);
  const indicatorLookups = useMemo(() => buildCatalogLookups(catalog.cards, catalog.subCardOrder), [catalog.cards, catalog.subCardOrder]);
  const parent = catalog.cards.find(candidate => candidate.id === card.parentId && !candidate.deleted && !candidate.archived);
  const siblings = parent ? familyChildren(indicatorLookups, parent.id) : [];
  const siblingTasks = siblings.filter(candidate => candidate.kind === 'task');
  const parentAccepted = siblingTasks.filter(candidate => candidate.state === 'done').length;
  const deck = catalog.decks.find(candidate => candidate.id === card.deckId);
  const supportsChildren = (card.kind === 'hero' || card.kind === 'doc') && !card.parentId;
  const children = supportsChildren ? familyChildren(indicatorLookups, card.id) : [];
  const childTasks = children.filter(child => child.kind === 'task');
  const familyDone = card.kind === 'hero' && heroFinished(card, children);
  // 2026-11-09: a native Hero without counted Task Sub Cards is marked done by hand; legacy Heroes keep no state.
  const heroMarkable = card.kind === 'hero' && card.id.startsWith('card:') && heroTakesManualDone(children);
  const justDone = useJustFinished(card.state === 'done' || familyDone, card.id);
  const orderedChildren = children;
  const journeyChild = orderedChildren.find(child => child.journey);
  const journeyReference = journeyChild?.journey;
  const journeyDefinition = journeyReference ? catalog.journeys?.find(journey => journey.id === journeyReference.journeyId) : undefined;
  const stepJourney = card.journey ? catalog.journeys?.find(journey => journey.id === card.journey?.journeyId) : undefined;
  // 2026-11-09: only the Sub Cards of this very run are its steps; ordinary Sub Cards of the Hero stay in the family list.
  const stepRunCards = card.journey ? siblings.filter(candidate => candidate.journey?.journeyId === card.journey?.journeyId
    && candidate.journey?.version === card.journey?.version && candidate.journey?.instanceId === card.journey?.instanceId) : [];
  // The Markdown step link is hidden only where the step note replaces it.
  const stepNoteShown = Boolean(card.journey && stepRunCards.some(candidate => candidate.id === card.id));
  const journeyChildren = journeyReference ? orderedChildren.filter(child => child.journey?.journeyId === journeyReference.journeyId
    && child.journey.version === journeyReference.version && child.journey.instanceId === journeyReference.instanceId) : [];
  const journeyTrackShown = Boolean(journeyReference && journeyChildren.length > 0);
  const cardsById = indicatorLookups.cardById;
  const blockerCount = openDependencies(card.dependsOn, cardsById).length;
  const backlinks = useMemo(() => catalog.cards.filter(candidate => candidate.id !== card.id && !candidate.deleted && !candidate.archived
    && cardLinksTo(candidate, shortReference('c', card.id), snapshot.source)), [catalog.cards, card.id, snapshot.source]);
  // Tags described by this card, such as a faction tag linked to its card in a Factions deck.
  const boundTags = useMemo(() => (catalog.projectTags ?? []).filter(tag => tag.cardId === card.id), [catalog.projectTags, card.id]);
  const tagCardCounts = useMemo(() => new Map(boundTags.map(tag => [tag.name,
    catalog.cards.filter(item => !item.deleted && !item.archived && item.tags?.includes(tag.name)).length])), [boundTags, catalog.cards]);
  const displayedEffort = card.kind === 'hero' ? cardHeroEffort(card, catalog) : card.effort;
  const disabled = !exists || !writable || pending || saving || quickSaving || journeySaving || contentEditing || openQuestionsActive;
  const questionsDisabled = !exists || pending || saving || quickSaving || journeySaving || contentEditing || propertiesActive;
  const navigationLocked = saving || quickSaving || pending || journeySaving || contentEditing || propertiesActive || openQuestionsActive;
  const quickDisabled = !exists || !writable || navigationLocked;
  const panelSwitchDisabled = pending || saving || quickSaving || journeySaving || openQuestionsActive;
  const journeyDisabled = panelSwitchDisabled || !exists || contentEditing;
  const journeyBusy = pending || saving || journeySaving;
  // An open content edit may move into Focus Mode with its draft; other open drafts and dialogs keep the card in place.
  const focusDisabled = saving || quickSaving || pending || journeySaving || propertiesActive || openQuestionsActive;
  const actionDisabled = quickDisabled || snapshot.source !== 'sandbox' || Boolean(currentCard?.deleted);
  const stateDisabled = actionDisabled || Boolean(currentCard?.archived);
  const terminalState = card.state === 'done' || card.state === 'wont-do';
  let playLabel = t.start;
  if (card.state === 'started') playLabel = t.stop;
  if (card.state === 'review') playLabel = t.reviewInProgress;
  if (terminalState) playLabel = t.reopenRequired;
  const stateName = stateLabel(card.state ?? 'not-started', lang);
  const reviewLabel = card.state === 'review' ? t.openReview : t.review;
  let doneLabel = t.accept;
  if (card.state === 'review') doneLabel = t.acceptReview;
  if (card.state === 'done') doneLabel = t.reopen;
  const moreConflict = moreOpen && moreRevision !== revision;
  const removalConflict = Boolean(removal && removal.revision !== revision);
  const docWords = useMemo(() => card.kind === 'doc' ? countCatalogCardWords(card) : 0, [card.id, card.kind, card.sourceHash, card.markdown]);
  const legacyDocument = card.kind === 'doc' && !card.id.startsWith('card:');
  const tags = [...new Set(card.tags ?? [])];
  const ownerMember = memberForOwner(card.owner, catalog.members ?? []);
  const ownerName = ownerMember?.label ?? card.owner;
  const checklist = indicatorLookups.checklistByCard.get(card.id);
  const ownerLabel = ownerProgressLabel(ownerName, checklist, lang);
  const initials = ownerInitials(ownerName, lang);
  const titlesById = useMemo(() => uniqueCardTitles(catalog.cards), [catalog.cards]);
  const watchMember = (catalog.members ?? []).find(member => member.id === selectedMemberId) ?? currentMember(catalog.members ?? []);
  const watchMemberId = watchMember?.id;
  const inMyHand = Boolean(watchMemberId && currentCard?.handMemberIds?.includes(watchMemberId));
  const handActionDisabled = actionDisabled || !watchMemberId;
  const hands = useMemo(() => getCatalogHands(catalog), [catalog.cards, catalog.members]);
  const handPositions = useMemo(() => catalogHandPositions(catalog), [catalog.cards, catalog.members]);
  const handHolders = [...new Set((currentCard ?? card).handMemberIds ?? [])].map(id => {
    const hand = hands.find(candidate => candidate.member.id === id);
    return { id, label: hand?.member.label ?? id, slot: handPositions.get(card.id)?.[id] };
  });
  const primaryHand = handHolders.find(holder => holder.id === watchMemberId) ?? handHolders[0];
  let handUnavailable: string | undefined;
  if (handActionDisabled) handUnavailable = t.handBusy;
  if (!writable || snapshot.source !== 'sandbox') handUnavailable = cardReadOnlyDescription(snapshot);
  if (currentCard?.deleted) handUnavailable = t.trashed;
  if (!exists) handUnavailable = t.missingSource;
  if (!watchMemberId) handUnavailable = t.handMemberRequired;
  const watchContext = JSON.stringify([snapshot.source, watchMemberId, card.id]);
  const latestWatchContext = useRef(watchContext);
  latestWatchContext.current = watchContext;
  const watchState = watchView?.context === watchContext ? watchView.view : null;
  const explicitlyWatching = watchState?.watching.includes(card.id) ?? false;
  const token = (snapshot as WorkspaceSnapshot & { token?: string }).token;

  useEffect(() => {
    if (focusedCardId.current === card.id) return;
    focusedCardId.current = card.id;
    setReviewFocus(null); moveFocus(heading.current);
  }, [card.id]);
  useEffect(() => {
    // 2026-11-10: consume navigation intent in Deck too, so history/remounts cannot replay a review shortcut.
    if (!reviewRequest || handledReviewRequest.current === reviewRequest.sequence) return;
    handledReviewRequest.current = reviewRequest.sequence;
    onReviewRequestHandled?.(reviewRequest.sequence);
    if (card.state === 'review') setReviewFocus(reviewRequest.focus);
  }, [card.id, reviewRequest, onReviewRequestHandled]);
  useEffect(() => {
    const request = stateFocus.current;
    if (!request || request.cardId !== card.id || navigationLocked || returnState || card.state !== request.state) return;
    stateFocus.current = null;
    focusStateButton();
  });
  useLayoutEffect(() => prepareEntrance(preview.current), [card.id]);
  useEffect(() => { setTitleExpanded(false); }, [card.id]);
  useLayoutEffect(() => {
    const title = heading.current;
    if (!title) return;
    const measure = () => setLongTitle(title.scrollHeight > parseFloat(getComputedStyle(title).lineHeight) * 4 + 1);
    const observer = new ResizeObserver(measure);
    observer.observe(title);
    measure();
    return () => observer.disconnect();
  }, [card.id, card.title, contentEditing, focusMode]);
  const hasParentStrip = Boolean(parent);
  useLayoutEffect(() => {
    // 2026-11-10: the Hero strip sits above the sheet; the icon rail starts level with the sheet, not the strip.
    const shell = preview.current;
    const strip = parentGlare.element.current;
    if (!shell) return;
    if (!strip) { shell.style.removeProperty('--preview-parent-block'); return; }
    const measure = () => shell.style.setProperty('--preview-parent-block', `${strip.offsetHeight + parseFloat(getComputedStyle(strip).marginBottom)}px`);
    const observer = new ResizeObserver(measure);
    observer.observe(strip);
    measure();
    return () => observer.disconnect();
  }, [card.id, hasParentStrip]);
  useEffect(() => {
    let panel: HTMLDivElement | null = null;
    if (activePanel === 'properties') panel = propertiesContainer.current;
    if (activePanel === 'attachments') panel = attachmentsContainer.current;
    if (activePanel === 'dependencies' || activePanel === 'history') panel = relatedContainer.current;
    if (!panel) return;
    const tagTarget = panelTarget.property === 'tags';
    const target = tagTarget ? panel.querySelector<HTMLElement>('section[data-property="tags"]') ?? panel : panel;
    let focusTarget = target;
    if (tagTarget) focusTarget = target.querySelector<HTMLElement>('.card-properties-tag-chip:not(:disabled)')
      ?? target.querySelector<HTMLElement>('.card-tag-open:not(:disabled)') ?? target;
    moveFocus(focusTarget, { preventScroll: true });
    // 2026-11-10: on the desktop the layer scrolls on its own and only a section inside it is brought into view; on a phone
    // the page scrolls, so the layer's top is brought just below the sticky deck toolbar (its scroll margin).
    if (target !== panel || window.matchMedia('(max-width: 760px)').matches) {
      target.scrollIntoView({ block: target === panel ? 'start' : 'center', inline: 'nearest', behavior: 'instant' });
    }
  }, [activePanel, panelTarget]);
  useEffect(() => {
    if (activePanel === 'content') return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented || navigationLocked || document.querySelector('[role="dialog"], [role="menu"]')) return;
      event.preventDefault(); event.stopImmediatePropagation();
      closePanel();
    }
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [activePanel, navigationLocked]);
  // 2026-11-10: on the desktop an open panel lies over the deck's cards beside the open card, gently dimming them instead
  // of pushing them aside. Those cards are dimmed (card-preview.css) and inert while it is open, and
  // a click on them closes it; the open card itself stays live. Pop-ups of the panel are portals outside the deck, so
  // only a press inside the deck's content row, outside the card column and the divider, counts.
  useEffect(() => {
    const host = layout.current?.closest<HTMLElement>('.catalog-content-layout');
    if (!panelOpen || !host || window.matchMedia('(max-width: 760px)').matches) return;
    const results = host.querySelector<HTMLElement>(':scope > .catalog-results');
    results?.setAttribute('inert', '');
    function closeOnDimmedPress(event: PointerEvent) {
      const target = event.target instanceof Element ? event.target : null;
      if (!target || !host?.contains(target) || layout.current?.contains(target) || target.closest('.catalog-resize-handle')) return;
      event.preventDefault();
      closePanel();
    }
    document.addEventListener('pointerdown', closeOnDimmedPress, true);
    return () => {
      results?.removeAttribute('inert');
      document.removeEventListener('pointerdown', closeOnDimmedPress, true);
    };
  }, [panelOpen]);
  useEffect(() => { onDirtyChange(saving || quickSaving || journeySaving || contentEditing || propertiesActive || openQuestionsActive); }, [saving, quickSaving, journeySaving, contentEditing, propertiesActive, openQuestionsActive, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  useEffect(() => { setStateQuestion(null); setReturnState(null); setQuickSettings(null); }, [card.id]);
  useEffect(() => () => copyRequest.current?.abort(), []);
  useEffect(() => {
    setReferenceFeedback(null);
    return () => { referenceRequest.current++; };
  }, [card.id, snapshot.source]);
  useEffect(() => {
    if (!referenceFeedback) return;
    const timer = window.setTimeout(() => setReferenceFeedback(null), 1400);
    return () => window.clearTimeout(timer);
  }, [referenceFeedback]);
  useEffect(claimOpenCardShortcuts, []);
  useEffect(() => onMemberChange(setSelectedMemberId), []);
  useEffect(() => {
    if (!moreOpen || !watchMemberId) return;
    const controller = new AbortController();
    setWatchView(null);
    setWatchError('');
    async function loadWatch() {
      try {
        const response = await fetch(`/api/notifications?source=${snapshot.source}&member=${encodeURIComponent(watchMemberId!)}`, { cache: 'no-store', signal: controller.signal });
        const result = await response.json() as NotificationsView & { message?: string };
        if (!response.ok) throw new Error(result.message ?? textNow(text).watchLoadFailed);
        if (!controller.signal.aborted) {
          setWatchView({ context: watchContext, view: result });
          if (!result.watchHash) setWatchError(textNow(text).watchUnavailable);
        }
      } catch (failure) {
        if (!controller.signal.aborted) setWatchError(failureMessage(failure, textNow(text).watchOpenFailed));
      }
    }
    void loadWatch();
    return () => controller.abort();
  }, [moreOpen, snapshot.source, watchMemberId, watchContext]);

  async function toggleWatch() {
    if (actionDisabled || moreConflict || stateInFlight.current || !token || !watchState?.watchHash || !watchMemberId) return;
    stateInFlight.current = true;
    setSaving(true);
    setStateNotice('');
    try {
      const response = await fetch('/api/notifications/watch', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-deckmate-token': token },
        body: JSON.stringify({ source: snapshot.source, memberId: watchMemberId, cardId: card.id,
          watching: !explicitlyWatching, watchHash: watchState.watchHash }),
      });
      const result = await response.json() as NotificationsView & { message?: string };
      if (!response.ok) throw new Error(result.message ?? textNow(text).watchSaveFailed);
      if (latestWatchContext.current === watchContext) setWatchView({ context: watchContext, view: result });
    } catch (failure) {
      if (latestWatchContext.current === watchContext) setStateNotice(failureMessage(failure, textNow(text).watchSaveFailed));
    } finally { stateInFlight.current = false; setSaving(false); }
  }

  // allowDeleted is the only actionDisabled exception: Restore Card works from Trash.
  async function changeCard(change: BulkChange, expectedRevision = revision, allowDeleted = false) {
    if (!currentCard || stateInFlight.current) return;
    if (actionDisabled && !(allowDeleted && currentCard.deleted)) return;
    if (expectedRevision !== latestRevision.current) {
      setStateNotice(t.stale);
      return;
    }
    stateInFlight.current = true;
    setSaving(true);
    setStateNotice('');
    try {
      const saved = await onEdit({ action: 'bulk-edit-cards', manifestHash: catalog.manifestHash,
        optionsHash: catalog.optionsHash ?? '', cards: [{ cardId: currentCard.id, sourceHash: currentCard.sourceHash }], change });
      if (saved) setRemoval(null);
      else setStateNotice(t.notConfirmed);
    } catch { setStateNotice(t.saveFailed); }
    finally { stateInFlight.current = false; setSaving(false); }
  }

  function toggleHand() {
    if (handActionDisabled || !watchMemberId) return;
    void changeCard({ kind: 'hand', memberId: watchMemberId, mode: inMyHand ? 'remove' : 'add' });
  }

  function openHand() {
    if (!exists || navigationLocked || !primaryHand) return;
    const { url } = viewNavigation(location.href, 'deck', 'hand', snapshot.source);
    url.searchParams.set('handMember', primaryHand.id);
    url.searchParams.delete('hands');
    // 2026-11-11: Hand has a saved All Hands mode; a holder shortcut opens that member's own queue.
    try { localStorage.setItem('deckmate-hand-all', 'false'); } catch { /* The member link still works without storage. */ }
    // 2026-11-11: the destination mounts after the tab's code and catalog load; queued cards need the same focus transfer.
    const observer = new MutationObserver(reveal);
    const cancel = () => { observer.disconnect(); window.clearTimeout(timeout); window.removeEventListener('popstate', cancel); };
    const timeout = window.setTimeout(cancel, 10000);
    function reveal() {
      const target = document.querySelector<HTMLElement>(`.hand-view [data-hand-card="${CSS.escape(card.id)}"]`);
      const opener = target?.querySelector<HTMLElement>('.deck-card-open, .hand-queue-open');
      if (!target || !opener || opener.closest('[inert]')) return;
      target.dataset.cardRevealed = 'true';
      target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      moveFocus(opener, { preventScroll: true });
      opener.addEventListener('blur', () => { delete target.dataset.cardRevealed; }, { once: true });
      cancel();
    }
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['inert'] });
    history.pushState(null, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
    window.addEventListener('popstate', cancel, { once: true });
    reveal();
  }

  async function copyContent() {
    if (!currentCard || navigationLocked || stateInFlight.current || moreConflict) return;
    const controller = new AbortController();
    copyRequest.current = controller;
    const expectedRevision = revision;
    stateInFlight.current = true;
    setSaving(true);
    setStateNotice('');
    try {
      const response = await fetch(`/api/card-content?source=${snapshot.source}&cardId=${encodeURIComponent(card.id)}`, { cache: 'no-store', signal: controller.signal });
      const content = await response.json() as CardContent & { message?: string };
      if (!response.ok) throw new Error(content.message ?? t.loadMarkdown);
      if (content.sourceHash !== currentCard.sourceHash || latestRevision.current !== expectedRevision) throw new Error(t.changedDuringCopy);
      if (typeof content.title !== 'string' || typeof content.markdown !== 'string') throw new Error(t.invalidMarkdown);
      await navigator.clipboard.writeText('# ' + content.title + '\n\n' + content.markdown);
      setStateNotice(legacyDocument ? t.copiedLegacy : t.copiedMarkdown);
    } catch (failure) {
      if (!controller.signal.aborted) setStateNotice(failureMessage(failure, t.copyMarkdownFailed));
    } finally {
      copyRequest.current = null;
      stateInFlight.current = false;
      if (!controller.signal.aborted) setSaving(false);
    }
  }

  async function copyReference(link: boolean) {
    const request = ++referenceRequest.current;
    const reference = shortReference('c', card.id);
    const value = link ? new URL(`/r/${reference}?source=${snapshot.source}`, location.origin).href : reference;
    setReferenceFeedback(null);
    try {
      await navigator.clipboard.writeText(value);
      if (referenceRequest.current === request) setReferenceFeedback({ request, state: 'copied' });
    } catch {
      if (referenceRequest.current === request) setReferenceFeedback({ request, state: 'failed' });
    }
  }

  function requestRemoval(action: CardRemoval, expectedRevision = revision) {
    if (actionDisabled || expectedRevision !== revision) return;
    setStateNotice('');
    setRemoval({ action, revision: expectedRevision });
  }

  function focusStateButton() {
    let target = playButton.current;
    if (latestCardState.current === 'review') target = reviewButton.current;
    if (latestCardState.current === 'done') target = doneButton.current;
    if (!target?.isConnected || target.disabled) { moveFocus(heading.current, { preventScroll: true }); return; }
    moveFocus(target, { preventScroll: true });
  }

  function runStateAction(action: CardStateAction) {
    switch (action.kind) {
      case 'review': setReviewFocus(action.focus); break;
      case 'reopen-required': setStateNotice(t.reopenRequired); break;
      case 'member-required': setStateNotice(t.noMember); break;
      case 'assign': void changeCard({ kind: 'properties', owner: action.owner }); break;
      case 'state': void changeState(action.state); break;
    }
  }

  useEffect(() => {
    function handleCardShortcut(event: KeyboardEvent) {
      if (shortcutTargetBlocked(event, 'open-card') || removal || stateQuestion || returnState) return;
      const hoveredProperty = resolveHoveredCardShortcut(event);
      if (hoveredProperty?.cardId === card.id && (hoveredProperty.kind === 'effort' || hoveredProperty.kind === 'priority')) {
        if (actionDisabled) return;
        event.preventDefault(); event.stopImmediatePropagation();
        const change = hoveredProperty.kind === 'effort' ? { effort: hoveredProperty.value } : { priority: hoveredProperty.value };
        void changeCard({ kind: 'properties', ...change });
        return;
      }
      const shortcut = matchShortcut(event, openCardShortcuts);
      if (!shortcut) return;
      // 2026-11-10: F opens Focus Mode like the button beside the title; reading only, so read-only sources keep it.
      if (shortcut.id === 'open-card-focus') {
        if (focusDisabled || focusMode || !exists) return;
        event.preventDefault(); event.stopImmediatePropagation();
        closeJourney(); setFocusMode(true);
        return;
      }
      // Reading panels remain available for read-only sources; mutation shortcuts are guarded below.
      if (shortcut.id === 'open-card-attachments' || shortcut.id === 'open-card-properties' || shortcut.id === 'open-card-tags') {
        if (panelSwitchDisabled || !exists) return;
        event.preventDefault(); event.stopImmediatePropagation();
        if (shortcut.id === 'open-card-tags') showPanel('properties', 'tags');
        else if (shortcut.id === 'open-card-properties') showPanel('properties');
        else openAttachments();
        return;
      }
      if (actionDisabled) return;
      if (shortcut.quickTab) {
        event.preventDefault(); event.stopImmediatePropagation();
        openQuickSettings(shortcut.quickTab);
        return;
      }
      // 2026-11-05: digits only act over their property icon; elsewhere they remain ordinary input.
      if (shortcut.id === 'open-card-effort-number' || shortcut.id === 'open-card-priority-number') return;
      const target = event.target instanceof Element ? event.target : null;
      // 2026-11-04: Space on a native control retains its click/drag action.
      if (shortcut.id === 'open-card-work' && target?.closest('button, a, [role="button"], [role="checkbox"], [role="switch"]')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const stateAction = resolveCardShortcutAction(shortcut, currentCard, {
        disabled: stateDisabled, member: currentMember(catalog.members ?? []), manualHeroDone: heroMarkable,
      });
      if (stateAction) { runStateAction(stateAction); return; }
      switch (shortcut.id) {
        case 'open-card-archive': requestRemoval(card.archived ? 'unarchive' : 'archive'); break;
        case 'open-card-delete': requestRemoval('delete'); break;
        case 'open-card-bookmark': void changeCard({ kind: 'options', patch: { bookmarked: !card.bookmarked } }); break;
        case 'open-card-hand': toggleHand(); break;
      }
    }
    window.addEventListener('keydown', handleCardShortcut, true);
    return () => window.removeEventListener('keydown', handleCardShortcut, true);
  });

  async function changeState(state: SliceStatus, confirmed = false, returnAnswer?: ReviewReturnAnswer) {
    if (actionDisabled || !currentCard || currentCard.archived || stateInFlight.current) return;
    if (currentCard.kind !== 'task' && !(heroMarkable && (state === 'done' || state === 'not-started'))) return;
    if ((currentCard.state ?? 'not-started') === state) return;
    const conflicts = confirmed ? [] : dependencyConflicts([currentCard], cardsById, state);
    setStateQuestion(conflicts.length ? { state, conflicts } : null);
    if (conflicts.length) return;
    if (isReviewReturn(currentCard, state)) {
      if (!returnAnswer) {
        setStateNotice(''); setReturnError(''); setReviewFocus(null);
        setReturnRevision(revision);
        returnOpener.current = reviewButton.current;
        returnSaved.current = false;
        setReturnState(state); return;
      }
      if (!returnAnswer.reason.trim() || returnRevision !== revision) { setReturnError(t.returnStale); return; }
    }
    stateInFlight.current = true;
    if (moreOpen) stateMenuClosing.current = true;
    setSaving(true);
    setStateNotice('');
    setReturnError('');
    let stateSaved = false;
    try {
      const saved = await onEdit({ action: 'set-card-state', cardId: currentCard.id, state,
        sourceHash: currentCard.sourceHash, manifestHash: catalog.manifestHash, ...(returnAnswer?.reason ? { returnReason: returnAnswer.reason } : {}) });
      if (!saved) {
        if (returnAnswer) setReturnError(t.stateNotConfirmed);
        else setStateNotice(t.stateNotConfirmed);
      } else {
        stateSaved = true;
        stateFocus.current = { cardId: currentCard.id, state };
        returnSaved.current = Boolean(returnAnswer);
        setReviewFocus(null); setReturnState(null);
      }
      // The status journal already includes the reason; step pitfalls are a separate Journey write. Status changes leave the Journey hash unchanged.
      const lesson = saved && returnAnswer ? journeyLessonAction(currentCard, catalog, returnAnswer) : null;
      if (lesson && !await onEdit(lesson)) setStateNotice(t.lessonFailed);
    } catch {
      if (stateSaved) setStateNotice(t.lessonFailed);
      else if (returnAnswer) setReturnError(t.stateFailed);
      else setStateNotice(t.stateFailed);
    }
    finally { stateInFlight.current = false; setSaving(false); }
  }

  function showPanel(panel: CardPanel, property?: 'tags') {
    if (panelSwitchDisabled) return;
    if (panel !== 'content') panelOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuickSettings(null);
    closeJourney();
    if (panel !== 'content' && familyVisible) onToggleFamily?.();
    setPanelTarget({ panel, property });
  }

  /** Closes the open card panel and returns focus to the rail button that opened it (the heading if it is gone). */
  function closePanel() {
    setPanelTarget({ panel: 'content' });
    const restore = () => {
      if (panelOpener.current?.isConnected) moveFocus(panelOpener.current, { preventScroll: true });
      else moveFocus(heading.current, { preventScroll: true });
    };
    if (mobile) requestAnimationFrame(restore);
    else restore();
  }

  function toggleFamily() {
    if (navigationLocked) return;
    closeJourney();
    setPanelTarget({ panel: 'content' });
    (onToggleFamily ?? onShowFamily)?.();
  }

  function openQuickSettings(tab: CardQuickSettingsTab, anchor?: HTMLElement) {
    if (quickDisabled) return;
    if (card.kind === 'doc' && (tab === 'effort' || tab === 'priority')) return;
    const opener = anchor ?? preview.current?.querySelector<HTMLElement>('[data-quick-settings-tab="' + tab + '"]')
      ?? preview.current?.querySelector<HTMLElement>('.card-preview-owner-shortcut');
    if (!opener) return;
    closeJourney();
    setQuickSettings(previous => previous?.anchor === opener ? null : { cardId: card.id, tab, anchor: opener });
  }

  function openAttachments() {
    if (panelSwitchDisabled || !exists) return;
    if (activePanel !== 'attachments') { showPanel('attachments'); return; }
    // Pressing A again opens the first image in the visible attachment list.
    preview.current?.parentElement?.querySelector<HTMLButtonElement>('.attachments-preview')?.click();
  }

  function openParentFamily() {
    if (navigationLocked || !parent) return;
    if (onReturnToHero) { onReturnToHero(); return; }
    selectCard(parent);
    onShowFamily?.();
  }

  // A tag linked to a card opens that card in the current catalog view.
  function openTagCard(cardId: string) {
    if (navigationLocked) return;
    const target = cardsById.get(cardId);
    if (target) selectCard(target);
  }

  function selectCard(next: CatalogCard, open = onSelect) {
    if (navigationLocked) return;
    closeJourney();
    open(next);
  }

  function showTagCards(tag: string) {
    if (navigationLocked) return;
    closeJourney();
    onShowTagCards?.(tag);
  }

  function closePreview() {
    if (navigationLocked) return;
    closeJourney();
    onClose();
  }

  function openDeck() {
    if (navigationLocked) return;
    closeJourney();
    onOpenDeck?.();
  }

  function openJourney() {
    if (journeyDisabled || card.kind !== 'hero' || !card.deckId) return;
    journeyOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    journeyManaging.current = false;
    setJourneyOpen(true);
  }

  function closeJourney() {
    if (journeyInFlight.current || pending || saving) return false;
    setJourneyOpen(false);
    return true;
  }

  async function applyJourney(action: CatalogAction) {
    if (journeyInFlight.current || pending || saving) return false;
    journeyInFlight.current = true;
    setJourneySaving(true);
    try {
      const saved = await onEdit(action);
      // Successful application closes directly; user-initiated close remains guarded while writing.
      if (saved) setJourneyOpen(false);
      return saved;
    } finally {
      journeyInFlight.current = false;
      setJourneySaving(false);
    }
  }

  const removalQuestions: Record<CardRemoval, (title: string) => string> = { archive: t.archiveQuestion, unarchive: t.unarchiveQuestion, delete: t.deleteQuestion };
  const removalTitles: Record<CardRemoval, string> = { archive: t.archiveCard, unarchive: t.unarchiveCard, delete: t.moveToTrash };
  const titleToggle = longTitle && <Button type="button" variant="ghost" size="sm" className="card-preview-title-toggle" aria-expanded={titleExpanded} onClick={() => setTitleExpanded(value => !value)}>{titleExpanded ? t.collapseTitle : t.fullTitle}</Button>;
  const heroMarkActions = card.kind === 'hero' && <span className="card-preview-hero-mark" aria-label={t.cardState}>
    <Button type="button" variant="ghost" size="icon" disabled={stateDisabled || !heroMarkable} aria-pressed={familyDone} aria-label={familyDone ? t.heroUndone : t.heroDone} title={familyDone ? t.heroUndone : t.heroDone} onClick={() => void changeState(familyDone ? 'not-started' : 'done')}><Check size={18} /></Button>
  </span>;
  const focusAction = <Button type="button" variant="ghost" size="icon" className="card-preview-focus" disabled={focusDisabled} onClick={() => { closeJourney(); setFocusMode(true); }} aria-label={t.focusMode} aria-keyshortcuts="F" title={`${t.focusMode} (F)`}><span className="card-preview-focus-glyph" aria-hidden="true"><Scan size={22} strokeWidth={1.75} /><kbd>F</kbd></span></Button>;
  const handAction = <CardHandHint holders={handHolders} members={catalog.members ?? []} inMyHand={inMyHand} shortcut={shortcutKeys('open-card-hand')}
    unavailable={handUnavailable}>
    <Button type="button" variant="ghost" size="icon" className={'card-preview-hand' + (handHolders.length ? ' is-on' : '')}
      aria-label={primaryHand ? t.openHand(primaryHand.label) : t.addToHand} aria-keyshortcuts={shortcutKeys('open-card-hand')}
      aria-disabled={navigationLocked || (primaryHand ? !exists : handActionDisabled)} onClick={event => {
        if (event.ctrlKey || event.metaKey || !primaryHand) toggleHand();
        else openHand();
      }}><HandIcon size={18} mine={inMyHand} /></Button>
  </CardHandHint>;
  const moreAction = <DropdownMenu.Root modal={false} open={moreOpen} onOpenChange={open => {
    if (open) setMoreRevision(revision);
    setMoreOpen(open);
  }}><DropdownMenu.Trigger asChild>
    <Button type="button" variant="ghost" size="icon" className="card-preview-more" disabled={!exists || navigationLocked} aria-label={t.moreOptions} title={t.moreOptions}><MoreHorizontal size={18} /></Button>
  </DropdownMenu.Trigger><DropdownMenu.Portal>
    <DropdownMenu.Content className="card-more-menu" align="end" sideOffset={6} collisionPadding={8} aria-label={t.moreActions}
      onCloseAutoFocus={event => {
        if (removal || journeyOpen) event.preventDefault();
        if (stateMenuClosing.current) {
          event.preventDefault(); stateMenuClosing.current = false;
          if (!stateInFlight.current) focusStateButton();
        }
      }}>
      <DropdownMenu.Item disabled={moreConflict} onSelect={() => void copyContent()}><Copy size={15} /><span>{t.copyCardContent}</span></DropdownMenu.Item>
      <DropdownMenu.Item onSelect={() => void copyReference(false)}><Copy size={15} /><span>{t.copyReference(shortReference('c', card.id))}</span></DropdownMenu.Item>
      <DropdownMenu.Item onSelect={() => void copyReference(true)}><Link2 size={15} /><span>{t.copyLink}</span></DropdownMenu.Item>
      {card.kind === 'doc' && <p className="card-more-help">{t.words(docWords)}</p>}
      {supportsChildren && onShowFamily && <DropdownMenu.Item disabled={navigationLocked} onSelect={toggleFamily}><Crown size={15} /><span>{t.family}</span></DropdownMenu.Item>}
      {legacyDocument && <p className="card-more-help">{t.legacyHelp}</p>}
      <DropdownMenu.Separator />
      <DropdownMenu.Item disabled={actionDisabled || moreConflict} onSelect={() => void changeCard({ kind: 'options', patch: { bookmarked: !card.bookmarked } }, moreRevision)}><Bookmark size={15} fill={card.bookmarked ? 'currentColor' : 'none'} /><span>{card.bookmarked ? t.unbookmarkCard : t.bookmarkCard}</span><kbd>{shortcutKeys('open-card-bookmark')}</kbd></DropdownMenu.Item>
      <p className="card-more-help">{t.sharedBookmark}</p>
      <DropdownMenu.Item disabled={actionDisabled || moreConflict || !watchState?.watchHash || !token} onSelect={() => void toggleWatch()}><Eye size={15} /><span>{explicitlyWatching ? t.unwatchCard : t.watchCard}</span></DropdownMenu.Item>
      {watchError && <p className="card-more-help" role="alert">{watchError}</p>}
      {/* Unstart returns a card from in progress to planned. */}
      {card.kind === 'task' && !card.archived && card.state === 'started' && <DropdownMenu.Item disabled={actionDisabled || moreConflict} onSelect={() => void changeState('not-started')}><Pause size={15} /><span>{t.unstartCard}</span></DropdownMenu.Item>}
      {card.kind === 'task' && card.state === 'wont-do' && <DropdownMenu.Item disabled={stateDisabled || moreConflict} onSelect={() => void changeState('not-started')}><RotateCcw size={15} /><span>{t.reopenCard}</span></DropdownMenu.Item>}
      <DropdownMenu.Item disabled={actionDisabled || moreConflict} onSelect={() => requestRemoval(card.archived ? 'unarchive' : 'archive', moreRevision)}>{card.archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}<span>{card.archived ? t.unarchiveCard : t.archiveCard}</span><kbd>{shortcutKeys('open-card-archive')}</kbd></DropdownMenu.Item>
      {/* Restore returns a card from Trash while preserving its archive state. */}
      {card.deleted && <DropdownMenu.Item disabled={quickDisabled || snapshot.source !== 'sandbox' || moreConflict} onSelect={() => void changeCard({ kind: 'options', patch: { deleted: false } }, moreRevision, true)}><RotateCcw size={15} /><span>{t.restoreCard}</span></DropdownMenu.Item>}
      <DropdownMenu.Separator />
      <DropdownMenu.Item className="card-more-delete" disabled={actionDisabled || moreConflict} onSelect={() => requestRemoval('delete', moreRevision)}><Trash2 size={15} /><span>{t.moveToTrash}</span><kbd>{shortcutKeys('open-card-delete')}</kbd></DropdownMenu.Item>
      {snapshot.source !== 'sandbox' && <p className="card-more-help">{t.sandboxChanges}</p>}
      {moreConflict && <p className="card-more-help" role="alert">{t.menuConflict}</p>}
    </DropdownMenu.Content>
  </DropdownMenu.Portal></DropdownMenu.Root>;

  const reviewControl = <Button ref={reviewButton} type="button" variant="ghost" size="icon" className="card-state-button card-state-review" data-filled={card.state === 'review' || undefined}
    disabled={card.state === 'review' ? panelSwitchDisabled || !exists : stateDisabled} aria-label={t.stateAction(stateName, reviewLabel)} title={reviewLabel}
    aria-haspopup={card.state === 'review' ? 'menu' : undefined} aria-expanded={card.state === 'review' ? reviewFocus !== null : undefined}
    onClick={card.state === 'review' ? undefined : () => runStateAction(resolveCardStateAction(currentCard, 'review', { disabled: stateDisabled }))}><StateBracketIcon question /></Button>;
  const reviewAction = card.state === 'review' ? <DropdownMenu.Root modal={false} open={reviewFocus !== null} onOpenChange={open => setReviewFocus(open ? 'popover' : null)}>
    <DropdownMenu.Trigger asChild>{reviewControl}</DropdownMenu.Trigger><DropdownMenu.Portal>
      <DropdownMenu.Content ref={reviewMenu} className="card-more-menu card-review-menu" align="start" sideOffset={6} collisionPadding={8} aria-label={t.openReview}
        onFocus={event => {
          if (event.target !== event.currentTarget) return;
          // 2026-11-10: Space lands on the menu, never Accept; only W deliberately selects that decision.
          event.preventDefault();
          let target: HTMLElement | null = reviewMenu.current;
          if (reviewFocus === 'accept' && !stateDisabled) target = reviewAccept.current;
          moveFocus(target, { preventScroll: true });
        }}
        onKeyDown={event => {
          if (event.target === event.currentTarget && (event.code === 'Space' || event.key === 'Enter')) { event.preventDefault(); event.stopPropagation(); }
        }}
        onCloseAutoFocus={event => {
          event.preventDefault();
          if (!returnOpener.current && !stateInFlight.current) focusStateButton();
        }}>
        <DropdownMenu.Item ref={reviewAccept} className="card-review-accept" disabled={stateDisabled} onSelect={() => void changeState('done')}><Check size={18} aria-hidden="true" /><span>{t.acceptReview}</span></DropdownMenu.Item>
        <DropdownMenu.Item className="card-review-return" disabled={stateDisabled} onSelect={() => void changeState('not-started')}><Undo2 size={17} aria-hidden="true" /><span>{t.requestChanges}</span></DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Portal></DropdownMenu.Root> : reviewControl;

  const content = <div ref={layout} className="card-preview-layout" data-card-panel-open={panelOpen || undefined}><aside ref={preview} className={'card-preview has-action-rail card-preview-' + card.kind} data-title-expanded={titleExpanded || undefined} aria-label={t.card(card.title)}>
    <div className="card-preview-main">
      <header className="card-preview-header">
        <div className="card-preview-context"><DeckPicker catalog={catalog} projectName={snapshot.projectName} source={snapshot.source} card={currentCard ?? card} onEdit={onEdit}
          decks={catalog.decks.filter(candidate => deckAcceptsCard(candidate.kind, card.kind))} current={card.deckId} noneLabel={t.noDeck}
           shown={deck} text={deck?.title ?? t.noDeck} disabled={quickDisabled} hint={writable ? t.moveDeck : cardReadOnlyDescription(snapshot)}
          onOpen={onOpenDeck ? openDeck : undefined} openDisabled={navigationLocked} onQuickSettings={openQuickSettings} /></div>
        <div className="card-preview-tools">
          <Button type="button" variant="ghost" size="icon" onClick={closePreview} disabled={navigationLocked} aria-label={t.closeCard}><X size={19} /></Button>
        </div>
      </header>
    {parent && <button ref={parentGlare.element} type="button" className="card-preview-parent" disabled={navigationLocked} onClick={openParentFamily}
      title={onReturnToHero ? t.returnToHero(parent.title) : t.openFamily} aria-keyshortcuts={onReturnToHero ? 'Escape' : undefined}
      onPointerEnter={parentGlare.tilt} onPointerMove={parentGlare.tilt} onPointerLeave={parentGlare.reset}>
      <span className="card-material-glare" aria-hidden="true" />
      <Crown size={18} /><span>{parent.title}</span><progress value={parentAccepted} max={Math.max(siblingTasks.length, 1)} aria-label={t.parentProgress(parentAccepted, siblingTasks.length)} />
      {onReturnToHero && <kbd>Esc</kbd>}
    </button>}
    <div ref={finishGlare.element} className={'card-preview-sheet' + (justDone ? ' is-just-done' : '')} inert={mobile && Boolean(panelOpen || familyVisible)} data-state={card.kind === 'task' ? card.state ?? undefined : undefined} data-family-done={familyDone || undefined}
      onPointerEnter={familyDone ? finishGlare.tilt : undefined} onPointerMove={familyDone ? finishGlare.tilt : undefined} onPointerLeave={familyDone ? finishGlare.reset : undefined}>
      {card.kind !== 'task' && <div className="card-preview-subcards-bar">
        {card.kind === 'hero' && <div className="card-preview-family-actions">
          {supportsChildren && onShowFamily && <Button type="button" variant="outline" size="sm" className="card-preview-subcards-toggle" disabled={navigationLocked} aria-pressed={Boolean(familyVisible)} onClick={toggleFamily}><Crown size={20} aria-hidden="true" /><span>{t.subCardsCount(children.length)}</span></Button>}
          {heroMarkActions}
        </div>}
        <div className="card-preview-subcards-actions">{handAction}{focusAction}{moreAction}</div>
      </div>}
      {/* 2026-11-05: the state row stays while text is edited or a checklist item saves; its buttons are disabled then, so the sheet never jumps. */}
      {card.kind === 'task' && <div className="card-preview-state-actions">
        <div className="card-state-buttons" role="group" aria-label={t.stateGroup(stateName)}>
          <Button ref={playButton} type="button" variant="ghost" size="icon" className="card-state-button card-state-play" data-filled={card.state === 'started' || undefined}
            disabled={stateDisabled || card.state === 'review' || terminalState} aria-pressed={card.state !== 'review' && !terminalState ? card.state === 'started' : undefined}
            aria-label={t.stateAction(stateName, playLabel)} title={playLabel} onClick={() => runStateAction(resolveCardStateAction(currentCard, 'play', { disabled: stateDisabled }))}><Play size={20} aria-hidden="true" /></Button>
          <Button type="button" variant="ghost" size="icon" className="card-state-button card-state-blockers" data-filled={blockerCount > 0 || undefined}
            disabled={panelSwitchDisabled || !exists} aria-label={t.stateAction(stateName, t.blockers(blockerCount))} title={t.blockers(blockerCount)}
            aria-controls={activePanel === 'dependencies' ? panelId + '-dependencies' : undefined} onClick={() => showPanel('dependencies')}><StateBracketIcon /></Button>
          {reviewAction}
          <Button ref={doneButton} type="button" variant="ghost" size="icon" className="card-state-button card-state-done" data-filled={card.state === 'done' || undefined}
            disabled={stateDisabled} aria-pressed={card.state !== 'review' && card.state !== 'wont-do' ? card.state === 'done' : undefined}
            aria-label={t.stateAction(stateName, doneLabel)} title={doneLabel} onClick={() => runStateAction(resolveCardStateAction(currentCard, 'check', { disabled: stateDisabled }))}><Check size={20} aria-hidden="true" /></Button>
        </div>
        <div className="card-preview-subcards-actions">{handAction}{focusAction}{moreAction}</div>
      </div>}
      {stateNotice && <p className="card-preview-state-notice" role="alert">{stateNotice}</p>}
      {stateQuestion && <DependencyStateWarning conflicts={stateQuestion.conflicts} busy={saving}
        state={stateQuestion.state}
        onConfirm={() => void changeState(stateQuestion.state, true)} onCancel={() => setStateQuestion(null)} />}
      <div className="card-preview-panels">
      <section id={panelId + '-content'} data-panel="content" className="card-preview-panel" tabIndex={-1} aria-label={t.contentPanel}>
      {(card.deleted || card.archived) && <section className="card-preview-lifecycle" aria-label={card.deleted ? t.trashed : t.archived}>
        <p>{card.deleted ? t.trashed : t.archived}{card.deleted && card.archived && <> {t.staysArchived}</>}</p>
        <Button type="button" variant="outline" size="sm" disabled={quickDisabled || snapshot.source !== 'sandbox'} onClick={() => {
          if (card.deleted) void changeCard({ kind: 'options', patch: { deleted: false } }, revision, true);
          else requestRemoval('unarchive');
        }}>{t.restore}</Button>
      </section>}
      <CardContentEditor card={card} catalog={catalog} snapshot={snapshot} writable={writable && exists && !card.deleted} pending={pending}
        blocked={saving || quickSaving || journeySaving || propertiesActive || openQuestionsActive} headingRef={heading} onEdit={onEdit} onEditingChange={setContentEditing} onOpenCard={selectCard}
        focusMode={focusMode} onFocusModeExit={() => setFocusMode(false)} hideJourneyStepLink={stepNoteShown} onCancelEdit={onCancelEdit} footerTarget={dockActions}
        onQuestionsActiveChange={setOpenQuestionsActive} questionsDisabled={questionsDisabled}
        titleActions={titleToggle ? <div className="card-preview-title-tools">{titleToggle}</div> : undefined}
        footerActions={card.kind === 'hero' && card.deckId ? <Button type="button" variant="outline" size="sm" className="card-preview-journey" disabled={journeyDisabled || propertiesActive} title={t.applyJourney} onClick={openJourney}><Route size={16} aria-hidden="true" />{t.journey}</Button> : undefined}
        bodyAfter={boundTags.length > 0 && <div className="card-tag-links">
        {boundTags.map(tag => <button key={tag.name} type="button" className="card-tag-link" disabled={!onShowTagCards || navigationLocked}
          title={t.tagCardsLabel(tag.name)} aria-label={t.tagCardsLabel(tag.name)}
          onClick={() => showTagCards(tag.name)}>
          <span>{t.tagLabel}</span><TagBadge name={tag.name} definition={tag} /><span>· {t.tagCards(tagCardCounts.get(tag.name) ?? 0)}</span>
        </button>)}
      </div>} />
      {!exists && <p className="card-preview-notice" role="status">{t.missingSource}</p>}
      </section>

      </div>
      {/* 2026-11-11: tags stay visible above the pinned ID and reading actions. */}
      <div className="card-preview-dock">
        {(journeyTrackShown || stepNoteShown) && <div className="card-preview-dock-journey">
          {journeyTrackShown && journeyReference && <JourneyTrack title={journeyDefinition?.title ?? journeyReference.journeyId}
            version={journeyReference.version} steps={journeyDefinition?.steps ?? []} cards={journeyChildren}
            description={journeyDefinition?.description} members={catalog.members} onOpenJourney={() => openJourney()}
            cardsById={cardsById} disabled={navigationLocked} onOpen={next => selectCard(next, onOpenSubCard)} />}
          {/* 2026-11-08: a Journey Sub Card shows its step as the same soft section, in place of the hidden Markdown tail. */}
          {stepNoteShown && card.journey && <JourneyStepNote card={card} cards={stepRunCards} steps={stepJourney?.steps ?? []}
            title={stepJourney?.title ?? card.journey.journeyId} version={card.journey.version} description={stepJourney?.description}
            cardsById={cardsById} members={catalog.members} disabled={navigationLocked} onOpen={next => selectCard(next, onOpenSubCard)}
            source={snapshot.source} journeyPath={stepJourney?.path} />}
        </div>}
        {/* 2026-11-11: the open card shows its tags as they are; adding and removing them belongs to Properties. */}
        {!contentEditing && tags.length > 0 && <div className="card-preview-tags">
          <CardTags tags={tags} definitions={catalog.projectTags} cardsById={cardsById}
            onOpenCard={openTagCard} onEditTags={() => showPanel('properties', 'tags')} disabled={navigationLocked} />
        </div>}
        <div className="card-preview-dock-row">
          {blockerCount > 0 && <button type="button" className="card-preview-blocker-note" disabled={panelSwitchDisabled} onClick={() => showPanel('dependencies')}>{t.blockers(blockerCount)}</button>}
          {card.kind === 'task' && card.dueDate && card.dueDate < localIsoDate() && card.state !== 'done' && <span className="card-preview-due-note">{t.overdue} · {card.dueDate}</span>}
          {!contentEditing && <CardIdChip cardId={card.id} feedback={referenceFeedback?.state} onCopy={() => void copyReference(false)} />}
          <div ref={setDockActions} className="card-preview-dock-actions" />
        </div>
      </div>
      <footer ref={materialGlare.element} className="card-preview-material-band" onPointerEnter={materialGlare.tilt} onPointerMove={materialGlare.tilt} onPointerLeave={materialGlare.reset}>
        <span className="card-material-glare" aria-hidden="true" />
        {card.kind !== 'doc' && <Button type="button" variant="ghost" size="sm" className="card-preview-property-shortcut" disabled={quickDisabled} data-quick-settings-tab="effort" aria-haspopup="dialog" aria-expanded={quickSettings?.cardId === card.id && quickSettings.anchor.dataset.quickSettingsTab === 'effort'} data-shortcut-property="effort" data-shortcut-card-id={card.id} onPointerEnter={event => markShortcutPropertyHover(event.currentTarget, true)} onPointerLeave={event => markShortcutPropertyHover(event.currentTarget, false)} aria-label={t.effortLabel(String(displayedEffort ?? t.notSet))} title={t.editEffort} onClick={event => openQuickSettings('effort', event.currentTarget)}><span className="card-preview-property-label">{t.effort}</span><EffortIcon size={22} /><strong>{displayedEffort ?? '—'}</strong></Button>}
        <Button type="button" variant="ghost" size="sm" className="card-preview-owner-shortcut" disabled={quickDisabled} data-quick-settings-tab="owner" aria-haspopup="dialog" aria-expanded={quickSettings?.cardId === card.id && quickSettings.anchor.dataset.quickSettingsTab === 'owner'} aria-label={ownerLabel} title={ownerLabel} onClick={event => openQuickSettings('owner', event.currentTarget)}>{initials && <span className="card-preview-owner-initials" aria-hidden="true">{initials}</span>}{/* 2026-11-11: the corner badge names an agent; a person is already named by the initials. */}{(!initials || ownerMember?.kind === 'agent') && <CardOwnerAvatar owner={card.owner} members={catalog.members ?? []} />}</Button>
        {card.kind !== 'doc' && <Button type="button" variant="ghost" size="sm" className="card-preview-property-shortcut" disabled={quickDisabled} data-quick-settings-tab="priority" aria-haspopup="dialog" aria-expanded={quickSettings?.cardId === card.id && quickSettings.anchor.dataset.quickSettingsTab === 'priority'} data-shortcut-property="priority" data-shortcut-card-id={card.id} onPointerEnter={event => markShortcutPropertyHover(event.currentTarget, true)} onPointerLeave={event => markShortcutPropertyHover(event.currentTarget, false)} aria-label={t.priorityLabel(card.priority ? priorityLabel(card.priority, lang) : t.notSet)} title={t.editPriority} onClick={event => openQuickSettings('priority', event.currentTarget)}><span className="card-preview-property-label">{t.priority}</span><PriorityIcon priority={card.priority} size={22} /></Button>}
        {card.kind === 'doc' && !contentEditing && <span className="card-preview-word-count">{t.words(docWords)}</span>}
        {card.kind === 'hero' && <SubCardProgress cards={childTasks} cardsById={cardsById} />}
      </footer>
    </div>
    </div>
    <nav className="card-preview-action-rail" aria-label={t.panels}>
      <Button type="button" variant="ghost" size="icon" disabled={panelSwitchDisabled} aria-label={t.propertiesPanel} title={t.propertiesPanel} aria-pressed={activePanel === 'properties'} aria-controls={panelId + '-properties'} className={propertiesActive ? 'has-draft' : ''} onClick={() => showPanel(activePanel === 'properties' ? 'content' : 'properties')}><SlidersHorizontal size={17} /></Button>
      {onShowFamily && <Button type="button" variant="ghost" size="icon" disabled={navigationLocked} data-card-family aria-label={t.family} title={t.family} aria-pressed={familyVisible} onClick={toggleFamily}><Crown size={18} /></Button>}
      <Button type="button" variant="ghost" size="icon" disabled={panelSwitchDisabled || !exists} aria-label={t.attachmentsPanel} title={attachments.listFailure ? t.attachmentsUnavailable : t.attachmentsPanel} aria-pressed={activePanel === 'attachments'} aria-controls={panelId + '-attachments'} onClick={() => showPanel(activePanel === 'attachments' ? 'content' : 'attachments')}><Paperclip size={18} />{attachments.listFailure && <span className="card-panel-error" aria-label={t.attachmentsUnavailable}>!</span>}</Button>
      <Button type="button" variant="ghost" size="icon" disabled={panelSwitchDisabled || !exists} aria-label={t.showDependencies} title={t.showDependencies} aria-expanded={activePanel === 'dependencies'} aria-controls={panelId + '-dependencies'} onClick={() => showPanel(activePanel === 'dependencies' ? 'content' : 'dependencies')}><Link2 size={18} /></Button>
      <Button type="button" variant="ghost" size="icon" disabled={panelSwitchDisabled || !exists} aria-label={t.historyPanel} title={t.historyPanel} aria-pressed={activePanel === 'history'} aria-controls={panelId + '-history'} onClick={() => showPanel(activePanel === 'history' ? 'content' : 'history')}><History size={18} /></Button>
    </nav>
    {returnState && currentCard && <Dialog.Root open onOpenChange={open => { if (!open && !saving) setReturnState(null); }}><Dialog.Portal>
      <Dialog.Overlay ref={prepareEntrance} className="card-journey-overlay" />
      <Dialog.Content className="card-removal-dialog card-review-return-dialog" aria-busy={saving} onCloseAutoFocus={event => {
        event.preventDefault();
        const opener = returnOpener.current;
        returnOpener.current = null;
        // 2026-11-10: deferred dialog cleanup must not steal focus from a Review menu opened by a newer interaction.
        if (reviewMenu.current?.contains(document.activeElement)) return;
        if (returnSaved.current) focusStateButton();
        else if (opener?.isConnected && !opener.matches(':disabled')) moveFocus(opener, { preventScroll: true });
        else moveFocus(heading.current, { preventScroll: true });
      }} onEscapeKeyDown={event => { if (saving) event.preventDefault(); }} onPointerDownOutside={event => { if (saving) event.preventDefault(); }}>
        <Dialog.Title>{t.returnReview}</Dialog.Title><Dialog.Description>{t.returnDescription}</Dialog.Description>
        {returnRevision !== revision && <><p role="alert">{t.returnStale}</p><Button type="button" disabled={saving} onClick={() => {
          setReturnRevision(revision); setReturnError('');
        }}>{t.useCurrentReturn}</Button></>}
        <ReviewReturnPrompt key={returnState} card={currentCard} catalog={catalog} busy={saving} blocked={stateDisabled || currentCard.state !== 'review' || returnRevision !== revision}
          error={returnError}
          onCancel={() => setReturnState(null)} onAnswer={answer => void changeState(returnState, true, answer)} />
      </Dialog.Content>
    </Dialog.Portal></Dialog.Root>}
    {journeyOpen && <Dialog.Root open onOpenChange={open => { if (!open) closeJourney(); }}><Dialog.Portal>
      <Dialog.Overlay ref={prepareEntrance} className="card-journey-overlay" />
      <Dialog.Content ref={prepareEntrance} className="card-journey-dialog" aria-busy={journeyBusy} aria-describedby={undefined}
        onEscapeKeyDown={event => { if (journeyBusy || journeyInFlight.current) event.preventDefault(); }}
        onPointerDownOutside={event => { if (journeyBusy || journeyInFlight.current) event.preventDefault(); }}
        onCloseAutoFocus={event => {
          event.preventDefault();
          if (journeyManaging.current) return;
          if (journeyOpener.current?.isConnected) moveFocus(journeyOpener.current, { preventScroll: true });
          else moveFocus(heading.current, { preventScroll: true });
        }}>
        <Dialog.Title className="visually-hidden">{t.startJourney}</Dialog.Title>
        <ApplyJourneyPanel catalog={catalog} card={card} source={snapshot.source} writable={exists && writable} pending={journeyBusy}
          onEdit={applyJourney} onClose={closeJourney}
          onManageJourney={onManageJourney ? () => { if (closeJourney()) { journeyManaging.current = true; onManageJourney(journeyOpener.current); } } : undefined} />
      </Dialog.Content>
    </Dialog.Portal></Dialog.Root>}
    {removal && <Dialog.Root open onOpenChange={open => { if (!open && !saving && !pending) setRemoval(null); }}><Dialog.Portal>
      <Dialog.Overlay ref={prepareEntrance} className="card-journey-overlay" />
      <Dialog.Content className="card-removal-dialog" aria-busy={saving || pending}
        onCloseAutoFocus={event => { event.preventDefault(); moveFocus(heading.current, { preventScroll: true }); }}
        onEscapeKeyDown={event => { if (saving || pending) event.preventDefault(); }}
        onPointerDownOutside={event => { if (saving || pending) event.preventDefault(); }}>
        <Dialog.Title>{removalTitles[removal.action]}</Dialog.Title>
        <Dialog.Description>{removalQuestions[removal.action](card.title)}</Dialog.Description>
        {removal.action === 'delete' && catalog.cards.some(child => child.parentId === card.id && !child.deleted) && <p>{t.trashChildren}</p>}
        {removalConflict && <p role="alert">{t.removalConflict}</p>}
        {stateNotice && <p role="alert">{stateNotice}</p>}
        <footer><Button type="button" variant="ghost" disabled={saving || pending} onClick={() => setRemoval(null)}>{t.cancel}</Button><Button type="button" disabled={actionDisabled || removalConflict} onClick={() => void changeCard({ kind: 'options', patch: removal.action === 'delete' ? { deleted: true } : { archived: removal.action === 'archive' } }, removal.revision)}>{saving && <LoaderCircle size={14} className="spin" />}{removalTitles[removal.action]}</Button></footer>
      </Dialog.Content>
    </Dialog.Portal></Dialog.Root>}
  </aside>
    {quickSettings?.cardId === card.id && <CardQuickSettings key={card.id} card={currentCard ?? card} catalog={catalog} source={snapshot.source} projectName={snapshot.projectName}
      anchor={quickSettings.anchor} tab={quickSettings.tab} onTabChange={tab => setQuickSettings(previous => previous && { ...previous, tab })}
      disabled={quickDisabled} onEdit={onEdit} onSavingChange={setQuickSaving} onClose={() => setQuickSettings(null)} />}
    <div ref={propertiesContainer} className="card-properties-slot" hidden={activePanel !== 'properties'} tabIndex={-1} aria-label={t.propertiesPanel}>
      {mobile && <Button type="button" variant="ghost" size="sm" className="card-panel-close" disabled={navigationLocked} onClick={closePanel}>{t.contentPanel}</Button>}
      <CardPropertiesPanel id={panelId + '-properties'} card={currentCard ?? card} catalog={catalog} handHolders={handHolders} disabled={disabled} visible={activePanel === 'properties'} onEdit={onEdit} onActiveChange={setPropertiesActive} onQuickSettings={openQuickSettings} />
    </div>
    {activePanel === 'attachments' && <div ref={attachmentsContainer} id={panelId + '-attachments'} className="card-properties-slot" tabIndex={-1} aria-label={t.attachmentsPanel}>
      {mobile && <Button type="button" variant="ghost" size="sm" className="card-panel-close" onClick={closePanel}>{t.contentPanel}</Button>}
      <AttachmentsPanel key={card.id} resource={attachments} card={currentCard ?? card} catalog={catalog} writable={exists && writable && !navigationLocked} onEdit={onEdit} />
    </div>}
    {(activePanel === 'dependencies' || activePanel === 'history') && <div ref={relatedContainer} id={panelId + '-' + activePanel} className="card-properties-slot card-related-slot" tabIndex={-1} aria-label={activePanel === 'history' ? t.historyPanel : t.dependenciesPanel}>
      {activePanel === 'dependencies' && <CardDependenciesSection key={card.id} card={currentCard ?? card} catalog={catalog} cardsById={cardsById} writable={writable} disabled={navigationLocked} onEdit={onEdit} onOpen={selectCard} onClose={closePanel} />}
      {activePanel === 'dependencies' && backlinks.length > 0 && <section className="card-preview-backlinks" aria-label={t.backlinks}><h3>{t.backlinks}</h3><ul>{backlinks.map(candidate => <li key={candidate.id}><button type="button" disabled={navigationLocked} onClick={() => selectCard(candidate)}>{candidate.title}</button></li>)}</ul></section>}
      {activePanel === 'history' && <CardHistorySection key={card.id} card={currentCard ?? card} source={snapshot.source} refreshKey={catalog.indexedAt} disabled={navigationLocked} titlesById={titlesById} onOpenById={id => { const next = cardsById.get(id); if (next) selectCard(next); }} onClose={closePanel} />}
    </div>}
    {mobile && <div className="card-preview-mobile-family-slot" hidden={!familyVisible}>
      <Button type="button" variant="ghost" size="sm" disabled={navigationLocked} className="card-panel-close" onClick={toggleFamily}>{t.contentPanel}</Button>
      <div className="card-preview-mobile-family-content" />
    </div>}
  </div>;
  return mobile ? <CardFocusMode title={card.title} onBack={() => { if (navigationLocked) return; if (panelOpen) closePanel(); else if (familyVisible) toggleFamily(); else closePreview(); }}>{content}</CardFocusMode> : content;
}
