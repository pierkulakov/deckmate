import { useEffect, useId, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import type { RootContent } from 'mdast';
import { Archive, ArchiveRestore, Bookmark, Check, Copy, Crown, Eye, Gauge, Layers, LoaderCircle, MoreHorizontal, Paperclip, Pause, Play, RotateCcw, Route, Scan, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { deckAcceptsCard, type CardContent, type CatalogCard, type CatalogView } from '../../src/catalog-contracts.ts';
import type { BulkChange } from '../../src/bulk-contracts.ts';
import type { NotificationsView } from '../../src/notification-contracts.ts';
import type { SliceStatus, WorkspaceSnapshot } from '../../src/workspace-contracts.ts';
import type { CatalogAction } from '../useCatalog.ts';
import { CardTags, TagBadge } from './CardTags.tsx';
import { CardIndicators } from './CardIndicators.tsx';
import { CardPropertiesPanel, cardHeroEffort, type CardPropertiesPanelHandle } from './CardPropertiesPanel.tsx';
import { shortReference } from '../../src/references.ts';
import { markdownParser } from '../../src/markdown-model.ts';
import { CardContentEditor } from './CardContentEditor.tsx';
import { OpenQuestions } from './OpenQuestions.tsx';
import { CardOwnerAvatar, type CardQuickSettingsTab } from './CardQuickSettings.tsx';
import { DeckPicker } from './DeckPicker.tsx';
import { ApplyJourneyPanel } from './JourneyPanel.tsx';
import { SubCardProgress } from './CardFamily.tsx';
import { DependencyStateWarning, dependencyConflicts, type DependencyConflict } from './DependencyWarning.tsx';
import { AttachmentsPanel } from './AttachmentsPanel.tsx';
import { JourneyReturnPrompt, isJourneyReturn, journeyLessonAction, type JourneyReturnAnswer } from './JourneyReturnPrompt.tsx';
import { buildCatalogLookups, orderSubCards } from '../catalog-lookups.ts';
import { familyFinished, useJustFinished } from '../done-impact.ts';
import { OPEN_CARD_SHORTCUTS, claimOpenCardShortcuts, markShortcutPropertyHover, matchShortcut, resolveHoveredCardShortcut, shortcutTargetBlocked } from '../keyboard-shortcuts.ts';
import { currentMember, onMemberChange } from '../current-member.ts';
import { countCatalogCardWords } from '../card-word-count.ts';
import { Button } from './ui/button.tsx';
import { defineText, locale, textNow, useLang, useText } from '../i18n.ts';
import { priorityLabel } from '../locales/common.ts';
import '../card-preview.css';

const text = defineText({
  copyId: 'Copy card ID',
  copyReference: (reference: string) => `Copy ID ${reference}`,
  copied: 'Copied',
  copyFailed: 'Could not copy',
  tagCards: (count: number) => `${count} ${new Intl.PluralRules('en-US').select(count) === 'one' ? 'card' : 'cards'}`,
  watchLoadFailed: 'Could not read the watch list.',
  watchUnavailable: 'The watch list is unavailable. Check the notifications file and reopen the menu.',
  watchOpenFailed: 'Could not read the watch list. Reopen the menu.',
  watchSaveFailed: 'Could not save the watch setting. Reopen the menu.',
  stale: 'The card or catalog changed. Close the menu and try again with current data.',
  notConfirmed: 'Change not confirmed. Check the catalog message and try again.',
  saveFailed: 'Could not save the change. Try again.',
  moveNotConfirmed: 'Move not confirmed. You can choose the deck again after checking the data.',
  moveFailed: 'Could not move the card. Try again.',
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
  sandboxDeck: 'Open sandbox to change the deck',
  closeCard: 'Close card',
  openFamily: 'Open Hero and Sub Cards',
  parentProgress: (done: number, total: number) => `Hero: ${done} of ${total} done`,
  cardState: 'Card state',
  start: 'Start work',
  review: 'Send to review',
  accept: 'Accept card',
  plan: 'Return to planned',
  applyJourney: 'Apply pipeline to Hero Card',
  tagCardsLabel: (name: string) => `All cards with tag “${name}”`,
  tagLabel: 'Tag',
  journeyProgress: 'Journey progress',
  journeyDone: (done: number, total: number) => `${done} of ${total} done`,
  missingSource: 'This card’s source disappeared from the index. Showing the last version; changing links and applying Journey are unavailable.',
  backlinks: 'Links to this card',
  more: (count: number) => `and ${count} more`,
  notSet: 'not set',
  effortLabel: (value: string) => `Effort: ${value}`,
  editEffort: 'Edit Effort',
  priorityLabel: (value: string) => `Priority: ${value}`,
  editPriority: 'Edit Priority',
  wordCount: (count: number) => `Word count: ${count}`,
  panels: 'Card panels',
  contentPanel: 'Content',
  propertiesPanel: 'Properties',
  attachmentsPanel: 'Attachments',
  focusMode: 'Focus Mode',
  moreOptions: 'More Options',
  ownerLabel: (owner: string) => `Owner: ${owner}`,
  unassigned: 'Unassigned',
  family: 'Hero and Sub Cards',
  trashChildren: 'This card’s Sub Cards, including archived ones, will also move to Trash. They can be restored with the parent.',
  removalConflict: 'The card or catalog changed. Close this window and try again with current data.',
  cancel: 'Cancel',
  archiveQuestion: (title: string) => `Archive “${title}”? Files are preserved.`,
  unarchiveQuestion: (title: string) => `Restore “${title}” from the archive? Files are preserved.`,
  deleteQuestion: (title: string) => `Move “${title}” to Trash? Files are preserved.`,
}, {
  copyId: 'Скопировать ID карты',
  copyReference: (reference: string) => `Скопировать ID ${reference}`,
  copied: 'Скопировано',
  copyFailed: 'Не удалось скопировать',
  tagCards: (count: number) => {
    const rule = new Intl.PluralRules('ru-RU').select(count);
    if (rule === 'one') return `${count} карта`;
    if (rule === 'few') return `${count} карты`;
    return `${count} карт`;
  },
  watchLoadFailed: 'Не удалось прочитать список наблюдения.',
  watchUnavailable: 'Список наблюдения недоступен. Проверьте файл уведомлений и откройте меню заново.',
  watchOpenFailed: 'Не удалось прочитать список наблюдения. Откройте меню заново.',
  watchSaveFailed: 'Не удалось сохранить наблюдение. Откройте меню заново.',
  stale: 'Карточка или каталог изменились. Закройте меню и повторите действие с актуальными данными.',
  notConfirmed: 'Изменение не подтверждено. Проверьте сообщение каталога и повторите действие.',
  saveFailed: 'Не удалось сохранить изменение. Повторите действие.',
  moveNotConfirmed: 'Перемещение не подтверждено. Выбор колоды можно повторить после проверки данных.',
  moveFailed: 'Не удалось переместить карточку. Повторите действие.',
  loadMarkdown: 'Не удалось загрузить Markdown карты.',
  changedDuringCopy: 'Карточка изменилась во время копирования. Откройте меню заново.',
  invalidMarkdown: 'Сервер не вернул полный Markdown карты.',
  copiedLegacy: 'Markdown скопирован. Это документ проекта: скопировано его содержимое без служебной YAML-шапки.',
  copiedMarkdown: 'Markdown карты скопирован.',
  copyMarkdownFailed: 'Не удалось скопировать Markdown. Проверьте доступ к буферу обмена.',
  noMember: 'Добавьте участника в состав команды, чтобы назначить карту себе.',
  stateNotConfirmed: 'Изменение состояния не подтверждено. Проверьте актуальные данные и повторите действие.',
  lessonFailed: 'Карта возвращена, но грабли шага не записаны. Причина есть в журнале карты; допишите грабли в шаг Journey вручную.',
  stateFailed: 'Не удалось изменить состояние. Повторите действие.',
  moreActions: 'Действия открытой карты',
  legacyHelp: 'Документ проекта: копируется Markdown без служебной YAML-шапки.',
  sandboxChanges: 'Изменения доступны в тестовой копии.',
  menuConflict: 'Карточка или каталог изменились. Откройте меню заново.',
  card: (title: string) => `Карта: ${title}`,
  noDeck: 'Без колоды',
  moveDeck: 'Переместить в другую колоду',
  sandboxDeck: 'Для изменения колоды откройте sandbox',
  closeCard: 'Закрыть карту',
  openFamily: 'Открыть Hero и Sub Cards',
  parentProgress: (done: number, total: number) => `Hero: принято ${done} из ${total}`,
  cardState: 'Состояние карточки',
  start: 'Взять в работу',
  review: 'Отправить на приёмку',
  accept: 'Принять карточку',
  plan: 'Вернуть в план',
  applyJourney: 'Применить pipeline к Hero Card',
  tagCardsLabel: (name: string) => `Все карты с тегом «${name}»`,
  tagLabel: 'Тег',
  journeyProgress: 'Исполнение Journey',
  journeyDone: (done: number, total: number) => `${done} из ${total} принято`,
  missingSource: 'Источник этой карты исчез из индекса. Показана последняя версия; изменение связей и применение Journey недоступны.',
  backlinks: 'Ссылается сюда',
  more: (count: number) => `и ещё ${count}`,
  notSet: 'не задан',
  effortLabel: (value: string) => `Effort: ${value}`,
  editEffort: 'Изменить Effort',
  priorityLabel: (value: string) => `Priority: ${value}`,
  editPriority: 'Изменить Priority',
  wordCount: (count: number) => `Число слов: ${count}`,
  panels: 'Панели карточки',
  contentPanel: 'Содержимое',
  propertiesPanel: 'Свойства',
  attachmentsPanel: 'Вложения',
  focusMode: 'Фокус-режим',
  moreOptions: 'Ещё действия',
  ownerLabel: (owner: string) => `Владелец: ${owner}`,
  unassigned: 'Unassigned',
  family: 'Hero и Sub Cards',
  trashChildren: 'В Trash также попадут Sub Cards этой карты, включая архивные. Их можно восстановить вместе с родителем.',
  removalConflict: 'Карточка или каталог изменились. Закройте это окно и повторите действие с актуальными данными.',
  cancel: 'Отмена',
  archiveQuestion: (title: string) => `Архивировать «${title}»? Файлы сохраняются.`,
  unarchiveQuestion: (title: string) => `Вернуть из архива «${title}»? Файлы сохраняются.`,
  deleteQuestion: (title: string) => `Переместить в Trash «${title}»? Файлы сохраняются.`,
});

interface CardPreviewProps {
  card: CatalogCard;
  catalog: CatalogView;
  snapshot: WorkspaceSnapshot;
  writable: boolean;
  pending: boolean;
  onClose: () => void;
  onSelect: (card: CatalogCard) => void;
  onEdit: (action: CatalogAction) => Promise<boolean>;
  onDirtyChange: (dirty: boolean) => void;
  onShowFamily?: () => void;
  onToggleFamily?: () => void;
  onManageJourney?: (opener?: HTMLElement | null) => void;
  onShowTagCards?: (tag: string) => void;
  /** Open is available only when the card is shown outside its own deck. */
  onOpenDeck?: () => void;
  familyVisible?: boolean;
}
type CardPanel = 'content' | 'properties' | 'attachments';
type CardRemoval = 'archive' | 'unarchive' | 'delete';
const removalLabels: Record<CardRemoval, string> = { archive: 'Archive Card', unarchive: 'Unarchive Card', delete: 'Move to Trash' };
const openCardShortcuts = OPEN_CARD_SHORTCUTS;
function shortcutKeys(id: string): string | undefined { return openCardShortcuts.find(shortcut => shortcut.id === id)?.keys; }

function CardIdChip({ cardId }: { cardId: string }) {
  const [feedback, setFeedback] = useState<'' | 'copied' | 'failed'>('');
  const t = useText(text);
  const reference = shortReference('c', cardId);
  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(''), 1400);
    return () => window.clearTimeout(timer);
  }, [feedback]);
  async function copyId() {
    try { await navigator.clipboard.writeText(reference); setFeedback('copied'); }
    catch { setFeedback('failed'); }
  }
  return <span className="card-id-control"><button type="button" className="card-id-chip" data-copied={feedback === 'copied' || undefined} title={t.copyId} aria-label={t.copyReference(reference)} onClick={() => void copyId()}>{reference}</button>
    {/* Same bubble as the header hints: mint, arrow, a short rise; the status text stays for screen readers. */}
    <span className="card-id-feedback" role="status" data-state={feedback || undefined}>{feedback === 'copied' && <><Check size={12} aria-hidden="true" />{t.copied}</>}{feedback === 'failed' && t.copyFailed}</span></span>;
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

export function CardPreview({ card, catalog, snapshot, writable, pending, onClose, onSelect, onEdit, onDirtyChange, onShowFamily, onToggleFamily, onManageJourney, onShowTagCards, onOpenDeck, familyVisible }: CardPreviewProps) {
  const [saving, setSaving] = useState(false);
  const t = useText(text);
  const lang = useLang();
  const languageTag = locale(lang);
  const [focusMode, setFocusMode] = useState(false);
  const [journeyOpen, setJourneyOpen] = useState(false);
  const [journeySaving, setJourneySaving] = useState(false);
  const [contentEditing, setContentEditing] = useState(false);
  const [propertiesActive, setPropertiesActive] = useState(false);
  const [activePanel, setActivePanel] = useState<CardPanel>('content');
  const [stateNotice, setStateNotice] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);
  const [moreRevision, setMoreRevision] = useState('');
  const [selectedMemberId, setSelectedMemberId] = useState(() => currentMember(catalog.members ?? [])?.id ?? '');
  const [watchView, setWatchView] = useState<{ context: string; view: NotificationsView } | null>(null);
  const [watchError, setWatchError] = useState('');
  const [removal, setRemoval] = useState<{ action: CardRemoval; revision: string } | null>(null);
  const copyRequest = useRef<AbortController | null>(null);
  // Starting or accepting a card with unfinished prerequisites requires confirmation.
  const [stateQuestion, setStateQuestion] = useState<{ state: SliceStatus; conflicts: DependencyConflict[] } | null>(null);
  // Returning a Journey card from review first asks for a reason to record as a pitfall.
  const [returnState, setReturnState] = useState<SliceStatus | null>(null);
  const [openQuestionsActive, setOpenQuestionsActive] = useState(false);
  const stateInFlight = useRef(false);
  const journeyInFlight = useRef(false);
  const journeyOpener = useRef<HTMLElement | null>(null);
  const journeyManaging = useRef(false);
  const preview = useRef<HTMLElement>(null);
  const propertiesContainer = useRef<HTMLDivElement>(null);
  const propertiesPanel = useRef<CardPropertiesPanelHandle>(null);
  const panelId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const currentCard = catalog.cards.find(candidate => candidate.id === card.id);
  const revision = JSON.stringify([snapshot.source, card.id, currentCard?.sourceHash, catalog.manifestHash, catalog.optionsHash]);
  const latestRevision = useRef(revision);
  latestRevision.current = revision;
  const exists = Boolean(currentCard);
  const parent = catalog.cards.find(candidate => candidate.id === card.parentId && !candidate.deleted && !candidate.archived);
  const siblings = parent ? catalog.cards.filter(candidate => candidate.parentId === parent.id && candidate.kind === 'task' && !candidate.deleted && !candidate.archived) : [];
  const parentAccepted = siblings.filter(candidate => candidate.state === 'done').length;
  const deck = catalog.decks.find(candidate => candidate.id === card.deckId);
  const supportsChildren = (card.kind === 'hero' || card.kind === 'doc') && !card.parentId;
  const children = supportsChildren ? catalog.cards.filter(candidate => candidate.parentId === card.id && !candidate.deleted && !candidate.archived) : [];
  const familyDone = card.kind === 'hero' && familyFinished(children);
  const justDone = useJustFinished(card.state === 'done' || familyDone, card.id);
  const orderedChildren = orderSubCards(children, catalog.subCardOrder?.[card.id]);
  const journeyChild = orderedChildren.find(child => child.journey);
  const journeyReference = journeyChild?.journey;
  const journeyDefinition = journeyReference ? catalog.journeys?.find(journey => journey.id === journeyReference.journeyId) : undefined;
  const journeyChildren = journeyReference ? orderedChildren.filter(child => child.journey?.journeyId === journeyReference.journeyId
    && child.journey.version === journeyReference.version && child.journey.instanceId === journeyReference.instanceId) : [];
  const journeyAccepted = journeyChildren.filter(child => child.state === 'done').length;
  const indicatorLookups = useMemo(() => buildCatalogLookups(catalog.cards, catalog.subCardOrder), [catalog.cards, catalog.subCardOrder]);
  const cardsById = indicatorLookups.cardById;
  const backlinks = useMemo(() => card.kind === 'doc' ? catalog.cards.filter(candidate => candidate.id !== card.id && !candidate.deleted && !candidate.archived
    && cardLinksTo(candidate, shortReference('c', card.id), snapshot.source)) : [], [catalog.cards, card.id, card.kind, snapshot.source]);
  // Tags described by this card, such as a faction tag linked to its card in a Factions deck.
  const boundTags = useMemo(() => (catalog.projectTags ?? []).filter(tag => tag.cardId === card.id), [catalog.projectTags, card.id]);
  const tagCardCounts = useMemo(() => new Map(boundTags.map(tag => [tag.name,
    catalog.cards.filter(item => !item.deleted && !item.archived && item.tags?.includes(tag.name)).length])), [boundTags, catalog.cards]);
  const displayedEffort = card.kind === 'hero' ? cardHeroEffort(card, catalog) : card.effort;
  const disabled = !exists || !writable || pending || saving || journeySaving || contentEditing || openQuestionsActive;
  const questionsDisabled = !exists || pending || saving || journeySaving || contentEditing || propertiesActive;
  const navigationLocked = saving || pending || journeySaving || contentEditing || propertiesActive || openQuestionsActive;
  const quickDisabled = !exists || !writable || navigationLocked;
  const panelSwitchDisabled = pending || saving || journeySaving || openQuestionsActive;
  const journeyDisabled = panelSwitchDisabled || !exists || contentEditing;
  const journeyBusy = pending || saving || journeySaving;
  // An open content edit may move into Focus Mode with its draft; other open drafts and dialogs keep the card in place.
  const focusDisabled = saving || pending || journeySaving || propertiesActive || openQuestionsActive;
  const actionDisabled = quickDisabled || snapshot.source !== 'sandbox' || Boolean(currentCard?.deleted);
  const stateDisabled = actionDisabled || Boolean(currentCard?.archived);
  const moreConflict = moreOpen && moreRevision !== revision;
  const removalConflict = Boolean(removal && removal.revision !== revision);
  const docWords = useMemo(() => card.kind === 'doc' ? countCatalogCardWords(card) : 0, [card.id, card.kind, card.sourceHash, card.markdown]);
  const legacyDocument = card.kind === 'doc' && !card.id.startsWith('card:');
  const watchMember = (catalog.members ?? []).find(member => member.id === selectedMemberId) ?? currentMember(catalog.members ?? []);
  const watchMemberId = watchMember?.id;
  const watchContext = JSON.stringify([snapshot.source, watchMemberId, card.id]);
  const latestWatchContext = useRef(watchContext);
  latestWatchContext.current = watchContext;
  const watchState = watchView?.context === watchContext ? watchView.view : null;
  const explicitlyWatching = watchState?.watching.includes(card.id) ?? false;
  const token = (snapshot as WorkspaceSnapshot & { token?: string }).token;

  useEffect(() => { heading.current?.focus(); }, [card.id]);
  useEffect(() => {
    if (activePanel === 'properties') propertiesContainer.current?.focus({ preventScroll: true });
  }, [activePanel]);
  useEffect(() => { onDirtyChange(saving || journeySaving || contentEditing || propertiesActive || openQuestionsActive); }, [saving, journeySaving, contentEditing, propertiesActive, openQuestionsActive, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  useEffect(() => { setStateQuestion(null); setReturnState(null); }, [card.id]);
  useEffect(() => () => copyRequest.current?.abort(), []);
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
        if (!controller.signal.aborted) setWatchError(failure instanceof Error ? failure.message : textNow(text).watchOpenFailed);
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
      if (latestWatchContext.current === watchContext) setStateNotice(failure instanceof Error ? failure.message : textNow(text).watchSaveFailed);
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

  // The deck picker moves the card at once (assign-deck keeps parent Hero and Tracks); drafts disable it through quickDisabled.
  async function moveToDeck(deckId: string | null) {
    if (quickDisabled || !currentCard || stateInFlight.current || deckId === currentCard.deckId) return;
    stateInFlight.current = true;
    setSaving(true);
    setStateNotice('');
    try {
      const saved = await onEdit({ action: 'assign-deck', cardId: currentCard.id, deckId, sourceHash: currentCard.sourceHash, manifestHash: catalog.manifestHash });
      if (!saved) setStateNotice(t.moveNotConfirmed);
    } catch { setStateNotice(t.moveFailed); }
    finally { stateInFlight.current = false; setSaving(false); }
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
      if (!controller.signal.aborted) setStateNotice(failure instanceof Error ? failure.message : t.copyMarkdownFailed);
    } finally {
      copyRequest.current = null;
      stateInFlight.current = false;
      if (!controller.signal.aborted) setSaving(false);
    }
  }

  function requestRemoval(action: CardRemoval, expectedRevision = revision) {
    if (actionDisabled || expectedRevision !== revision) return;
    setStateNotice('');
    setRemoval({ action, revision: expectedRevision });
  }

  function workOnCard() {
    if (actionDisabled || !currentCard) return;
    const member = currentMember(catalog.members ?? []);
    if (!member) { setStateNotice(t.noMember); return; }
    const owned = currentCard.owner === member.label || member.aliases.includes(currentCard.owner ?? '');
    if (!owned) { void changeCard({ kind: 'properties', owner: member.label }); return; }
    if (currentCard.kind === 'task' && !currentCard.archived) void changeState(currentCard.state === 'started' ? 'not-started' : 'started');
  }

  useEffect(() => {
    function handleCardShortcut(event: KeyboardEvent) {
      if (shortcutTargetBlocked(event, 'open-card') || removal || stateQuestion) return;
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
      // Reading panels remain available for read-only sources; mutation shortcuts are guarded below.
      if (shortcut.id === 'open-card-attachments' || shortcut.id === 'open-card-properties') {
        if (panelSwitchDisabled || !exists) return;
        event.preventDefault(); event.stopImmediatePropagation();
        if (shortcut.id === 'open-card-properties') showPanel('properties');
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
      switch (shortcut.id) {
        case 'open-card-done': if (!card.archived) void changeState(card.state === 'done' ? 'not-started' : 'done'); break;
        case 'open-card-archive': requestRemoval(card.archived ? 'unarchive' : 'archive'); break;
        case 'open-card-delete': requestRemoval('delete'); break;
        case 'open-card-bookmark': void changeCard({ kind: 'options', patch: { bookmarked: !card.bookmarked } }); break;
        case 'open-card-work': workOnCard(); break;
      }
    }
    window.addEventListener('keydown', handleCardShortcut, true);
    return () => window.removeEventListener('keydown', handleCardShortcut, true);
  });

  async function changeState(state: SliceStatus, confirmed = false, returnAnswer?: JourneyReturnAnswer) {
    if (actionDisabled || !currentCard || currentCard.archived || currentCard.kind !== 'task' || currentCard.state === state || stateInFlight.current) return;
    const conflicts = confirmed ? [] : dependencyConflicts([currentCard], cardsById, state);
    setStateQuestion(conflicts.length ? { state, conflicts } : null);
    if (conflicts.length) return;
    if (!returnAnswer && isJourneyReturn(currentCard, state)) { setReturnState(state); return; }
    setReturnState(null);
    stateInFlight.current = true;
    setSaving(true);
    setStateNotice('');
    try {
      const saved = await onEdit({ action: 'set-card-state', cardId: currentCard.id, state,
        sourceHash: currentCard.sourceHash, manifestHash: catalog.manifestHash, ...(returnAnswer?.reason ? { returnReason: returnAnswer.reason } : {}) });
      if (!saved) setStateNotice(t.stateNotConfirmed);
      // The status journal already includes the reason; step pitfalls are a separate Journey write. Status changes leave the Journey hash unchanged.
      const lesson = saved && returnAnswer ? journeyLessonAction(currentCard, catalog, returnAnswer) : null;
      if (lesson && !await onEdit(lesson)) setStateNotice(t.lessonFailed);
    } catch { setStateNotice(t.stateFailed); }
    finally { stateInFlight.current = false; setSaving(false); }
  }

  function showPanel(panel: CardPanel) {
    if (panelSwitchDisabled) return;
    closeJourney();
    if (panel !== 'content' && familyVisible) onToggleFamily?.();
    setActivePanel(panel);
  }

  function toggleFamily() {
    if (navigationLocked) return;
    closeJourney();
    setActivePanel('content');
    (onToggleFamily ?? onShowFamily)?.();
  }

  function openQuickSettings(tab: CardQuickSettingsTab) {
    if (quickDisabled) return;
    showPanel('properties');
    requestAnimationFrame(() => propertiesPanel.current?.openQuickSettings(tab));
  }

  function openAttachments() {
    if (panelSwitchDisabled || !exists) return;
    if (activePanel !== 'attachments') { showPanel('attachments'); return; }
    // Pressing A again opens the first image in the visible attachment list.
    preview.current?.parentElement?.querySelector<HTMLButtonElement>('.attachments-preview')?.click();
  }

  function openProperty(name: 'owner' | 'priority' | 'effort') {
    if (quickDisabled) return;
    showPanel('properties');
    requestAnimationFrame(() => {
      const section = propertiesContainer.current?.querySelector<HTMLElement>('[data-property="' + name + '"]');
      section?.scrollIntoView({ block: 'nearest' });
      section?.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled)')?.focus({ preventScroll: true });
    });
  }

  function openParentFamily() {
    if (navigationLocked || !parent) return;
    selectCard(parent);
    onShowFamily?.();
  }

  // A tag linked to a card opens that card in the current catalog view.
  function openTagCard(cardId: string) {
    if (navigationLocked) return;
    const target = cardsById.get(cardId);
    if (target) selectCard(target);
  }

  function selectCard(next: CatalogCard) {
    if (navigationLocked) return;
    closeJourney();
    onSelect(next);
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
  const focusAction = <Button type="button" variant="ghost" size="icon" className="card-preview-focus" disabled={focusDisabled} onClick={() => { closeJourney(); setFocusMode(true); }} aria-label={t.focusMode} title={t.focusMode}><Scan size={17} aria-hidden="true" /></Button>;
  const moreAction = <DropdownMenu.Root open={moreOpen} onOpenChange={open => {
    if (open) setMoreRevision(revision);
    setMoreOpen(open);
  }}><DropdownMenu.Trigger asChild>
    <Button type="button" variant="ghost" size="icon" className="card-preview-more" disabled={!exists || navigationLocked} aria-label={t.moreOptions} title={t.moreOptions}><MoreHorizontal size={18} /></Button>
  </DropdownMenu.Trigger><DropdownMenu.Portal>
    <DropdownMenu.Content className="card-more-menu" align="end" sideOffset={6} collisionPadding={8} aria-label={t.moreActions}
      onCloseAutoFocus={event => { if (removal) event.preventDefault(); }}>
      <DropdownMenu.Item disabled={moreConflict} onSelect={() => void copyContent()}><Copy size={15} /><span>Copy Card Content</span></DropdownMenu.Item>
      {legacyDocument && <p className="card-more-help">{t.legacyHelp}</p>}
      <DropdownMenu.Separator />
      <DropdownMenu.Item disabled={actionDisabled || moreConflict} onSelect={() => void changeCard({ kind: 'options', patch: { bookmarked: !card.bookmarked } }, moreRevision)}><Bookmark size={15} fill={card.bookmarked ? 'currentColor' : 'none'} /><span>{card.bookmarked ? 'Unbookmark Card' : 'Bookmark Card'}</span><kbd>{shortcutKeys('open-card-bookmark')}</kbd></DropdownMenu.Item>
      <DropdownMenu.Item disabled={actionDisabled || moreConflict || !watchState?.watchHash || !token} onSelect={() => void toggleWatch()}><Eye size={15} /><span>{explicitlyWatching ? 'Unwatch Card' : 'Watch Card'}</span></DropdownMenu.Item>
      {watchError && <p className="card-more-help" role="alert">{watchError}</p>}
      {/* Unstart returns a card from in progress to planned. */}
      {card.kind === 'task' && !card.archived && card.state === 'started' && <DropdownMenu.Item disabled={actionDisabled || moreConflict} onSelect={() => void changeState('not-started')}><Pause size={15} /><span>Unstart this Card</span></DropdownMenu.Item>}
      <DropdownMenu.Item disabled={actionDisabled || moreConflict} onSelect={() => requestRemoval(card.archived ? 'unarchive' : 'archive', moreRevision)}>{card.archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}<span>{card.archived ? 'Unarchive Card' : 'Archive Card'}</span><kbd>{shortcutKeys('open-card-archive')}</kbd></DropdownMenu.Item>
      {/* Restore returns a card from Trash while preserving its archive state. */}
      {card.deleted && <DropdownMenu.Item disabled={quickDisabled || snapshot.source !== 'sandbox' || moreConflict} onSelect={() => void changeCard({ kind: 'options', patch: { deleted: false } }, moreRevision, true)}><RotateCcw size={15} /><span>Restore Card</span></DropdownMenu.Item>}
      <DropdownMenu.Separator />
      <DropdownMenu.Item className="card-more-delete" disabled={actionDisabled || moreConflict} onSelect={() => requestRemoval('delete', moreRevision)}><Trash2 size={15} /><span>Move to Trash</span><kbd>{shortcutKeys('open-card-delete')}</kbd></DropdownMenu.Item>
      {snapshot.source !== 'sandbox' && <p className="card-more-help">{t.sandboxChanges}</p>}
      {moreConflict && <p className="card-more-help" role="alert">{t.menuConflict}</p>}
    </DropdownMenu.Content>
  </DropdownMenu.Portal></DropdownMenu.Root>;

  return <div className={'card-preview-layout' + (activePanel !== 'content' ? ' has-properties' : '')}><aside ref={preview} className={'card-preview has-action-rail card-preview-' + card.kind} aria-label={t.card(card.title)}>
    <div className="card-preview-main">
      <header className="card-preview-header">
        <div className="card-preview-context"><DeckPicker catalog={catalog} projectName={snapshot.projectName} source={snapshot.source} card={currentCard ?? card} onEdit={onEdit}
          decks={catalog.decks.filter(candidate => deckAcceptsCard(candidate.kind, card.kind))} current={card.deckId} noneLabel={t.noDeck}
          shown={deck} text={deck?.title ?? t.noDeck} disabled={quickDisabled} hint={writable ? t.moveDeck : t.sandboxDeck}
          onOpen={onOpenDeck ? openDeck : undefined} openDisabled={navigationLocked} onChoose={deckId => void moveToDeck(deckId)} /></div>
        <div className="card-preview-tools">
          <Button type="button" variant="ghost" size="icon" onClick={closePreview} disabled={navigationLocked} aria-label={t.closeCard}><X size={19} /></Button>
        </div>
      </header>
    {parent && <button type="button" className="card-preview-parent" disabled={navigationLocked} onClick={openParentFamily} title={t.openFamily}>
      <Crown size={18} /><span>{parent.title}</span><progress value={parentAccepted} max={Math.max(siblings.length, 1)} aria-label={t.parentProgress(parentAccepted, siblings.length)} />
    </button>}
    <div className={'card-preview-sheet' + (justDone ? ' is-just-done' : '')} data-state={card.state ?? undefined} data-family-done={familyDone || undefined}>
      {supportsChildren && onShowFamily && <div className="card-preview-subcards-bar">
        <Button type="button" variant="ghost" size="sm" className="card-preview-subcards-toggle" disabled={navigationLocked} aria-pressed={familyVisible} onClick={toggleFamily}><Crown size={20} /><span>{children.length} Sub Cards</span></Button>
        <div className="card-preview-subcards-actions">{focusAction}{moreAction}</div>
      </div>}
      {/* 2026-11-05: the state row stays while text is edited or a checklist item saves; its buttons are disabled then, so the sheet never jumps. */}
      {card.kind === 'task' && <div className="card-preview-state-actions" aria-label={t.cardState}>
        <Button type="button" variant="ghost" size="icon" disabled={stateDisabled || card.state === 'started'} aria-pressed={card.state === 'started'} aria-label={t.start} title={t.start} onClick={() => void changeState('started')}><Play size={17} /></Button>
        <Button type="button" variant="ghost" size="icon" disabled={stateDisabled || card.state === 'review'} aria-pressed={card.state === 'review'} aria-label={t.review} title={t.review} onClick={() => void changeState('review')}><Eye size={17} /></Button>
        <Button type="button" variant="ghost" size="icon" disabled={stateDisabled || card.state === 'done'} aria-pressed={card.state === 'done'} aria-label={t.accept} title={t.accept} onClick={() => void changeState('done')}><Check size={18} /></Button>
        <Button type="button" variant="ghost" size="icon" disabled={stateDisabled || card.state === 'not-started'} aria-pressed={card.state === 'not-started'} aria-label={t.plan} title={t.plan} onClick={() => void changeState('not-started')}>{card.state === 'done' ? <RotateCcw size={16} /> : <Pause size={16} />}</Button>
        {saving && <LoaderCircle size={14} className="spin" />}
      </div>}
      {stateNotice && <p className="card-preview-state-notice" role="alert">{stateNotice}</p>}
      {stateQuestion && <DependencyStateWarning conflicts={stateQuestion.conflicts} busy={saving}
        onConfirm={() => void changeState(stateQuestion.state, true)} onCancel={() => setStateQuestion(null)} />}
      {returnState && currentCard && <JourneyReturnPrompt key={returnState} card={currentCard} catalog={catalog} busy={saving}
        onAnswer={answer => void changeState(returnState, true, answer)} />}
      <div className="card-preview-panels">
      <section id={panelId + '-content'} data-panel="content" className="card-preview-panel" tabIndex={-1} aria-label={t.contentPanel}>
      <CardContentEditor card={card} catalog={catalog} snapshot={snapshot} writable={writable && exists} pending={pending}
        blocked={saving || journeySaving || propertiesActive || openQuestionsActive} headingRef={heading} onEdit={onEdit} onEditingChange={setContentEditing} onOpenCard={selectCard}
        focusMode={focusMode} onFocusModeExit={() => setFocusMode(false)}
        footerActions={<><CardIdChip cardId={card.id} />{card.kind === 'hero' && card.deckId && <Button type="button" variant="outline" size="sm" className="card-preview-journey-action" disabled={journeyDisabled || propertiesActive} onClick={openJourney} title={t.applyJourney}><Route size={15} />Journey</Button>}</>}
        titleActions={supportsChildren && onShowFamily ? undefined : <div className="card-preview-subcards-actions">{focusAction}{moreAction}</div>}
        bodyAfter={<>{boundTags.length > 0 && <div className="card-tag-links">
        {boundTags.map(tag => <button key={tag.name} type="button" className="card-tag-link" disabled={!onShowTagCards || navigationLocked}
          title={t.tagCardsLabel(tag.name)} aria-label={t.tagCardsLabel(tag.name)}
          onClick={() => showTagCards(tag.name)}>
          <span>{t.tagLabel}</span><TagBadge name={tag.name} definition={tag} /><span>· {t.tagCards(tagCardCounts.get(tag.name) ?? 0)}</span>
        </button>)}
      </div>}</>} />
      <OpenQuestions card={card} catalog={catalog} writable={writable && exists} disabled={questionsDisabled} onEdit={onEdit} onSelect={selectCard} onActiveChange={setOpenQuestionsActive} />
      {journeyReference && journeyChildren.length > 0 && <section className="card-preview-journey-progress" aria-label={t.journeyProgress}>
        <header><Route size={14} aria-hidden="true" /><h3>Journey: {journeyDefinition?.title ?? journeyReference.journeyId} v{journeyReference.version}</h3><span>{t.journeyDone(journeyAccepted, journeyChildren.length)}</span></header>
        <SubCardProgress cards={journeyChildren} cardsById={cardsById} disabled={navigationLocked} onOpen={selectCard} />
      </section>}
      {!exists && <p className="card-preview-notice" role="status">{t.missingSource}</p>}
      {backlinks.length > 0 && <section className="card-preview-backlinks" aria-label={t.backlinks}><h3>{t.backlinks}</h3><ul>{backlinks.slice(0, 50).map(candidate => <li key={candidate.id}><button type="button" disabled={navigationLocked} onClick={() => selectCard(candidate)}>{candidate.title}</button></li>)}</ul>{backlinks.length > 50 && <p>{t.more(backlinks.length - 50)}</p>}</section>}
      </section>

      </div>
      {!!card.tags?.length && <div className="card-preview-tags-area"><CardTags tags={card.tags} definitions={catalog.projectTags} cardsById={cardsById} onOpenCard={navigationLocked ? undefined : openTagCard} /></div>}
      <CardIndicators card={card} lookups={indicatorLookups} members={catalog.members ?? []} catalog={catalog} currentMemberId={selectedMemberId} variant="preview"
        onQuickSettings={actionDisabled ? undefined : openQuickSettings} />
      <footer className="card-preview-material-band">
        {card.kind !== 'doc' && <Button type="button" variant="ghost" size="sm" className="card-preview-property-shortcut" disabled={quickDisabled} data-shortcut-property="effort" data-shortcut-card-id={card.id} onPointerEnter={event => markShortcutPropertyHover(event.currentTarget, true)} onPointerLeave={event => markShortcutPropertyHover(event.currentTarget, false)} aria-label={t.effortLabel(String(displayedEffort ?? t.notSet))} title={t.editEffort} onClick={() => openProperty('effort')}><span>Effort</span><Gauge size={19} /><strong>{displayedEffort ?? '—'}</strong></Button>}
        <Button type="button" variant="ghost" size="sm" className="card-preview-owner-shortcut" disabled={quickDisabled} aria-label={t.ownerLabel(card.owner ?? t.unassigned)} title={t.ownerLabel(card.owner ?? t.unassigned)} onClick={() => openProperty('owner')}><CardOwnerAvatar owner={card.owner} members={catalog.members ?? []} /></Button>
        {card.kind !== 'doc' && <Button type="button" variant="ghost" size="sm" className="card-preview-property-shortcut" disabled={quickDisabled} data-shortcut-property="priority" data-shortcut-card-id={card.id} onPointerEnter={event => markShortcutPropertyHover(event.currentTarget, true)} onPointerLeave={event => markShortcutPropertyHover(event.currentTarget, false)} aria-label={t.priorityLabel(card.priority ? priorityLabel(card.priority, lang) : t.notSet)} title={t.editPriority} onClick={() => openProperty('priority')}><span>Priority</span><Layers size={18} /><strong>{card.priority ? priorityLabel(card.priority, lang) : '—'}</strong></Button>}
        {card.kind === 'doc' && <span className="card-preview-word-count">Markdown{docWords > 0 && <span title={t.wordCount(docWords)} aria-label={t.wordCount(docWords)}> · {new Intl.NumberFormat(languageTag).format(docWords)}</span>}</span>}
      </footer>
    </div>
    </div>
    <nav className="card-preview-action-rail" aria-label={t.panels}>
      <Button type="button" variant="ghost" size="icon" disabled={panelSwitchDisabled} aria-label={t.propertiesPanel} title={t.propertiesPanel} aria-pressed={activePanel === 'properties'} aria-controls={panelId + '-properties'} className={propertiesActive ? 'has-draft' : ''} onClick={() => showPanel(activePanel === 'properties' ? 'content' : 'properties')}><SlidersHorizontal size={17} /></Button>
      {onShowFamily && <Button type="button" variant="ghost" size="icon" disabled={navigationLocked} data-card-family aria-label={t.family} title={t.family} aria-pressed={familyVisible} onClick={toggleFamily}><Crown size={18} /></Button>}
      <Button type="button" variant="ghost" size="icon" disabled={panelSwitchDisabled || !exists} aria-label={t.attachmentsPanel} title={t.attachmentsPanel} aria-pressed={activePanel === 'attachments'} onClick={() => showPanel(activePanel === 'attachments' ? 'content' : 'attachments')}><Paperclip size={18} /></Button>
    </nav>
    {journeyOpen && <Dialog.Root open onOpenChange={open => { if (!open) closeJourney(); }}><Dialog.Portal>
      <Dialog.Overlay className="card-journey-overlay" />
      <Dialog.Content className="card-journey-dialog" aria-busy={journeyBusy} aria-describedby={undefined}
        onEscapeKeyDown={event => { if (journeyBusy || journeyInFlight.current) event.preventDefault(); }}
        onPointerDownOutside={event => { if (journeyBusy || journeyInFlight.current) event.preventDefault(); }}
        onCloseAutoFocus={event => {
          event.preventDefault();
          if (journeyManaging.current) return;
          if (journeyOpener.current?.isConnected) journeyOpener.current.focus({ preventScroll: true });
          else heading.current?.focus({ preventScroll: true });
        }}>
        <Dialog.Title className="visually-hidden">Start Journey</Dialog.Title>
        <ApplyJourneyPanel catalog={catalog} card={card} source={snapshot.source} writable={exists && writable} pending={journeyBusy}
          onEdit={applyJourney} onClose={closeJourney}
          onManageJourney={onManageJourney ? () => { if (closeJourney()) { journeyManaging.current = true; onManageJourney(journeyOpener.current); } } : undefined} />
      </Dialog.Content>
    </Dialog.Portal></Dialog.Root>}
    {removal && <Dialog.Root open onOpenChange={open => { if (!open && !saving && !pending) setRemoval(null); }}><Dialog.Portal>
      <Dialog.Overlay className="card-journey-overlay" />
      <Dialog.Content className="card-removal-dialog" aria-busy={saving || pending}
        onCloseAutoFocus={event => { event.preventDefault(); heading.current?.focus({ preventScroll: true }); }}
        onEscapeKeyDown={event => { if (saving || pending) event.preventDefault(); }}
        onPointerDownOutside={event => { if (saving || pending) event.preventDefault(); }}>
        <Dialog.Title>{removalLabels[removal.action]}</Dialog.Title>
        <Dialog.Description>{removalQuestions[removal.action](card.title)}</Dialog.Description>
        {removal.action === 'delete' && catalog.cards.some(child => child.parentId === card.id && !child.deleted) && <p>{t.trashChildren}</p>}
        {removalConflict && <p role="alert">{t.removalConflict}</p>}
        {stateNotice && <p role="alert">{stateNotice}</p>}
        <footer><Button type="button" variant="ghost" disabled={saving || pending} onClick={() => setRemoval(null)}>{t.cancel}</Button><Button type="button" disabled={actionDisabled || removalConflict} onClick={() => void changeCard({ kind: 'options', patch: removal.action === 'delete' ? { deleted: true } : { archived: removal.action === 'archive' } }, removal.revision)}>{saving && <LoaderCircle size={14} className="spin" />}{removalLabels[removal.action]}</Button></footer>
      </Dialog.Content>
    </Dialog.Portal></Dialog.Root>}
  </aside>
    <div ref={propertiesContainer} className="card-properties-slot" hidden={activePanel !== 'properties'} tabIndex={-1} aria-label={t.propertiesPanel}>
      <CardPropertiesPanel ref={propertiesPanel} id={panelId + '-properties'} card={currentCard ?? card} catalog={catalog} source={snapshot.source} disabled={disabled} visible={activePanel === 'properties'} onEdit={onEdit} onActiveChange={setPropertiesActive} />
    </div>
    {activePanel === 'attachments' && <div className="card-properties-slot" aria-label={t.attachmentsPanel}>
      <AttachmentsPanel key={card.id} card={currentCard ?? card} catalog={catalog} writable={exists && writable && !navigationLocked} onEdit={onEdit} />
    </div>}
  </div>;
}
