import { readStoredValue } from '../storage.ts';
import { runLabel } from '../run-label.ts';
import { ArrowUpRight, Bookmark, Check, Crown, Gauge, GripVertical, NotebookText, Users, X } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { DndContext, DragEndEvent, DragOverlay, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type CollisionDetection, type UniqueIdentifier } from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable, type SortingStrategy } from '@dnd-kit/sortable';
import { currentRunsByOwner, dueBadgeOf, getCatalogHands, groupCardsByStateFlow, isoWeekStart, localIsoDate, ownerCardsOfMilestone, pinnedMilestoneOf, splitDueCards, summarizeDoneWeek, type CatalogHand, type DueCardsSplit, type OwnerRunCards } from '../../src/catalog-hand.ts';
import { type CatalogCard, type CatalogDeck, type MilestoneRecord, type RunRecord } from '../../src/catalog-contracts.ts';
import type { WorkspaceSnapshot } from '../../src/workspace-contracts.ts';
import type { ProjectTag } from '../../src/project-tags.ts';
import { useCatalog } from '../useCatalog.ts';
import { buildCatalogLookups, type CatalogLookups, type ChecklistProgress } from '../catalog-lookups.ts';
import { formatPlanningDate, metrics, workdaysUntil } from '../planning-metrics.ts';
import { navigateToPlanning } from '../planning-navigation.ts';
import { CardTransferContext, CatalogCardTile } from './CatalogCardTile.tsx';
import { CardDragFace, captureCardDragPreview, type CardDragPreview } from './CardDragPresentation.tsx';
import { CardOwnerAvatar, CardQuickSettings, type CardQuickSettingsTab } from './CardQuickSettings.tsx';
import { StatusBadge } from './StatusMenu.tsx';
import { CardTags } from './CardTags.tsx';
import { storedMemberId } from '../current-member.ts';
import { readMotionTokens } from '../motion.ts';
import { useCardLayoutMotion } from '../useCardLayoutMotion.ts';
import { AgentQueueHint } from './AgentQueueHint.tsx';
import type { ShortcutScreen } from '../keyboard-shortcuts.ts';
import { ShortcutsHelp } from './ShortcutsHelp.tsx';
import { navigateTabs } from '../tab-navigation.ts';
import { Button } from './ui/button.tsx';
import { EmptyState } from './EmptyState.tsx';
import { LoadingState } from './LoadingState.tsx';
import type { PlanningTarget } from './PlanningScope.tsx';
import { defineText, locale, useLang, useText, type Lang } from '../i18n.ts';
import { kindLabel, stateLabel } from '../locales/common.ts';
import '../hand.css';
import '../hand-planning.css';

const text = defineText({
  yourHand: 'Your Hand',
  yourDueCards: 'Your due cards',
  yourRuns: 'Your Runs',
  tabWithCount: (label: string, count: number) => `${label}, ${count.toLocaleString(locale())} ${new Intl.PluralRules('en-US').select(count) === 'one' ? 'card' : 'cards'}`,
  addToHand: 'Add to Hand',
  removeFromHand: 'Remove from Hand',
  pinnedMilestone: 'Pinned Milestone',
  bookmarks: 'Bookmarks',
  teamHands: 'Team Hands',
  showAll: 'Show all',
  doneCards: 'Done Cards',
  dueNow: 'Due now',
  dueSoon: 'Due soon',
  dueLater: 'Due later',
  seeFullMilestone: 'See full Milestone',
  due: 'Due',
  unassigned: 'Unassigned',
  bookmark: 'Bookmark',
  effort: 'Effort',
  agent: 'Agent',
  human: 'Human',
  noBookmarks: 'No bookmarked cards yet. Open a card and choose “Bookmark Card” in its menu.',
  cardCount: (count: number) => `${count.toLocaleString(locale())} ${new Intl.PluralRules('en-US').select(count) === 'one' ? 'card' : 'cards'}`,
  emptyMemberHand: 'There are no cards in Hand. Add them by selecting cards in Decks.',
  emptyHand: 'Select cards in Decks, then choose this member’s Hand.',
  // 2026-11-10: without write access the caption cannot promise an action, so the read-only copy stays observational.
  emptyHandReadOnly: 'No cards in this Hand yet.',
  chooseCards: 'Choose cards in Decks',
  totalEffort: (effort: number) => `Sum of the cards’ own Effort, excluding Sub Card totals: ${effort.toLocaleString(locale())}`,
  showAllTitle: 'Show every member’s Hand',
  allHands: 'All Hands',
  overviewHint: 'To change a Hand, turn off All Hands.',
  whoseHand: 'Whose Hand',
  handOf: (member: string) => `Hand: ${member}`,
  empty: 'Empty',
  loading: 'Loading Hand…',
  noMembersTitle: 'The team has no members yet',
  noMembersDescription: 'Add project members to give people and agents their own Hands.',
  // 2026-11-10: a read-only copy cannot add members, so the action and its promise are writable-only.
  noMembersReadOnly: 'Hands appear here once the project has members.',
  openMembers: 'Members…',
  handSections: 'Hand sections',
  invalidMember: 'The member from the link is not on the team. The default Hand is shown.',
  card: 'Card',
  doneSummary: (count: number, effort: number, lastCount: number, lastEffort: number, total: number) => `This week: ${count.toLocaleString(locale())} ${new Intl.PluralRules(locale('en')).select(count) === 'one' ? 'card' : 'cards'} · Effort ${effort.toLocaleString(locale())}\nLast week: ${lastCount.toLocaleString(locale())} · ${lastEffort.toLocaleString(locale())}\nTotal in the pile: ${total.toLocaleString(locale())}`,
  doneThisWeek: (count: number, effort: number) => `This week: ${count.toLocaleString(locale())} · Effort ${effort.toLocaleString(locale())}`,
  doneLastWeek: (count: number, effort: number) => `Last week: ${count.toLocaleString(locale())} · Effort ${effort.toLocaleString(locale())}`,
  noDoneCards: 'No accepted cards in this pile yet.',
  dragInstructions: 'Press Space to pick up a Hand card. Arrow keys change its position, Space drops it, and Escape cancels the move.',
  dragStart: (card: string) => `Picked up card “${card}”.`,
  dragOver: (card: string, position: number, total: number) => `Card “${card}”, position ${position.toLocaleString(locale())} of ${total.toLocaleString(locale())}.`,
  outsideHand: 'Outside the Hand.',
  dragEnd: (card: string, position: number) => `Card “${card}” moved to position ${position.toLocaleString(locale())}.`,
  dragCancelled: 'Move cancelled.',
  queue: (count: number) => `Queued: ${count.toLocaleString(locale())}`,
  noDeck: 'No deck',
  moveInHand: (title: string) => `Move in Hand: ${title}`,
  reorderTitle: 'Reorder · Space and arrow keys',
  noDueCards: 'You have no cards with a due date.',
  openRunTimeline: (label: string) => `Open ${label} in Timeline`,
  noOwnedMilestone: 'You have no cards in this Milestone.',
  noOwnedRun: 'You have no cards in this Run.',
  openCard: (title: string) => `Open ${title}`,
  removeCard: (title: string) => `Remove from Hand: ${title}`,
  refreshData: 'Refresh data',
  runWorkload: (effort: number, unestimated: number, days: number) => `Active Effort: ${effort.toLocaleString(locale())} · Unestimated: ${unestimated.toLocaleString(locale())} · Workdays left: ${days.toLocaleString(locale())}`,
}, {
  yourHand: 'Ваш Hand',
  yourDueCards: 'Ваши карточки по срокам',
  yourRuns: 'Ваши Run',
  tabWithCount: (label: string, count: number) => {
    const rule = new Intl.PluralRules('ru-RU').select(count);
    return `${label}, ${count.toLocaleString(locale())} ${rule === 'one' ? 'карточка' : rule === 'few' ? 'карточки' : 'карточек'}`;
  },
  addToHand: 'В Hand',
  removeFromHand: 'Убрать из Hand',
  pinnedMilestone: 'Закреплённый Milestone',
  bookmarks: 'Закладки',
  teamHands: 'Hand команды',
  showAll: 'Показать всех',
  doneCards: 'Принятые карточки',
  dueNow: 'Срок наступил',
  dueSoon: 'Срок скоро',
  dueLater: 'Срок позже',
  seeFullMilestone: 'Показать Milestone целиком',
  due: 'Срок',
  unassigned: 'Без исполнителя',
  bookmark: 'Закладка',
  effort: 'Оценка',
  agent: 'Агент',
  human: 'Человек',
  noBookmarks: 'Закладок пока нет. Откройте карточку и добавьте закладку в её меню.',
  cardCount: (count: number) => {
    const rule = new Intl.PluralRules('ru-RU').select(count);
    const word = rule === 'one' ? 'карточка' : rule === 'few' ? 'карточки' : 'карточек';
    return `${count.toLocaleString(locale())} ${word}`;
  },
  emptyMemberHand: 'В Hand нет карточек. Добавьте их через выделение в Decks.',
  emptyHand: 'Выберите карточки в Decks, затем укажите Hand этого участника.',
  emptyHandReadOnly: 'В этой Hand пока нет карточек.',
  chooseCards: 'Выбрать карточки в Decks',
  totalEffort: (effort: number) => `Сумма собственных оценок карточек, без суммы Sub Cards: ${effort.toLocaleString(locale())}`,
  showAllTitle: 'Показать Hand всех участников',
  allHands: 'Все Hand',
  overviewHint: 'Чтобы изменить Hand, выключите обзор всех Hand.',
  whoseHand: 'Чей Hand',
  handOf: (member: string) => `Hand: ${member}`,
  empty: 'Пусто',
  loading: 'Загружаем Hand…',
  noMembersTitle: 'Состав команды ещё не задан',
  noMembersDescription: 'Добавьте участников проекта, чтобы у людей и агентов появились свои Hand.',
  noMembersReadOnly: 'Hand появятся здесь, когда в проекте будут участники.',
  openMembers: 'Участники…',
  handSections: 'Разделы Hand',
  invalidMember: 'Участник из ссылки отсутствует в составе команды. Показан Hand по умолчанию.',
  card: 'Карточка',
  doneSummary: (count: number, effort: number, lastCount: number, lastEffort: number, total: number) => `Неделя: карточек ${count.toLocaleString(locale())} · оценка ${effort.toLocaleString(locale())}\nПрошлая неделя: ${lastCount.toLocaleString(locale())} · ${lastEffort.toLocaleString(locale())}\nВсего в стопке: ${total.toLocaleString(locale())}`,
  doneThisWeek: (count: number, effort: number) => `За неделю: ${count.toLocaleString(locale())} · оценка ${effort.toLocaleString(locale())}`,
  doneLastWeek: (count: number, effort: number) => `За прошлую неделю: ${count.toLocaleString(locale())} · оценка ${effort.toLocaleString(locale())}`,
  noDoneCards: 'В стопке пока нет принятых карточек.',
  dragInstructions: 'Нажмите пробел, чтобы поднять карточку Hand. Стрелки меняют позицию, пробел завершает перенос, Escape отменяет.',
  dragStart: (card: string) => `Поднята карточка «${card}».`,
  dragOver: (card: string, position: number, total: number) => `Карточка «${card}», позиция ${position.toLocaleString(locale())} из ${total.toLocaleString(locale())}.`,
  outsideHand: 'За пределами Hand.',
  dragEnd: (card: string, position: number) => `Карточка «${card}» перемещена на позицию ${position.toLocaleString(locale())}.`,
  dragCancelled: 'Перенос отменён.',
  queue: (count: number) => `В очереди: ${count.toLocaleString(locale())}`,
  noDeck: 'Без колоды',
  moveInHand: (title: string) => `Переместить в Hand: ${title}`,
  reorderTitle: 'Изменить порядок · Пробел и стрелки',
  noDueCards: 'У вас нет карточек со сроком.',
  openRunTimeline: (label: string) => `Открыть ${label} в Timeline`,
  noOwnedMilestone: 'Ваших карточек в этом Milestone нет.',
  noOwnedRun: 'Ваших карточек в этом Run нет.',
  openCard: (title: string) => `Открыть ${title}`,
  removeCard: (title: string) => `Убрать из Hand: ${title}`,
  refreshData: 'Обновить данные',
  runWorkload: (effort: number, unestimated: number, days: number) => `Оценка активных: ${effort.toLocaleString(locale())} · Без оценки: ${unestimated.toLocaleString(locale())} · Рабочих дней осталось: ${days.toLocaleString(locale())}`,
});

const HAND_SLOT_COUNT = 7;
const handPointerOptions = { activationConstraint: { distance: 6 } };
const handKeyboardOptions = { coordinateGetter: sortableKeyboardCoordinates };
const HandMotionContext = createContext<{ duration: number; easing: string } | null>(null);
// 2026-11-10: a 147px tile cannot preview its new position in a 30px queue row; cross-surface drops commit on release.
const handSorting: SortingStrategy = args => {
  if ((args.activeIndex < HAND_SLOT_COUNT) !== (args.overIndex < HAND_SLOT_COUNT)) return null;
  return rectSortingStrategy(args);
};

function createHandCollisions() {
  let previousId: UniqueIdentifier | null = null;
  const detect: CollisionDetection = args => {
    const pointer = args.pointerCoordinates;
    if (!pointer) return closestCenter(args);
    // 2026-11-10: the gaps belong to the row too. Resting rectangles, not animated faces, decide which slot makes room.
    const regions = new Map<Element, boolean>();
    const containers = args.droppableContainers.filter(container => {
      const region = container.node.current?.closest('.hand-slots, .hand-queue ul');
      if (!region) return false;
      if (!regions.has(region)) {
        const rect = region.getBoundingClientRect();
        const done = region.querySelector('.hand-slot-done')?.getBoundingClientRect();
        const inDone = done && pointer.x >= done.left && pointer.x <= done.right && pointer.y >= done.top && pointer.y <= done.bottom;
        regions.set(region, !inDone && pointer.x >= rect.left && pointer.x <= rect.right && pointer.y >= rect.top && pointer.y <= rect.bottom);
      }
      return regions.get(region);
    });
    const hits = closestCenter({ ...args, droppableContainers: containers,
      collisionRect: { ...args.collisionRect, left: pointer.x - args.collisionRect.width / 2, top: pointer.y - args.collisionRect.height / 2 } });
    let target = hits[0];
    const previous = hits.find(hit => hit.id === previousId);
    const from = previous && args.droppableRects.get(previous.id);
    const to = target && args.droppableRects.get(target.id);
    if (previous && from && to && previous.id !== target.id) {
      const dx = to.left + to.width / 2 - from.left - from.width / 2;
      const dy = to.top + to.height / 2 - from.top - from.height / 2;
      const distance = Math.hypot(dx, dy);
      const across = ((pointer.x - from.left - from.width / 2) * dx + (pointer.y - from.top - from.height / 2) * dy) / distance;
      // 2026-11-10: an 8px dead zone on either side of the midpoint prevents a slow hand from reversing a slide.
      if (across < distance / 2 + 8) target = previous;
    }
    previousId = target?.id ?? null;
    return target ? [target] : [];
  };
  return { detect, reset: () => { previousId = null; } };
}
/** Planning tabs collect the selected member's next actions. */
const handTabs = ['due', 'runs', 'milestone', 'bookmarks', 'team'] as const;
type HandTab = typeof handTabs[number];
type HandScroll = { project: string; source: WorkspaceSnapshot['source']; member: string; tab: HandTab; all: boolean; top: number };

function linkedHandTab(): HandTab {
  const linked = new URLSearchParams(location.search).get('handTab');
  return handTabs.find(tab => tab === linked) ?? 'bookmarks';
}

// Hand has no shortcuts of its own: the overview lists the app-wide ones.
const handShortcutScreens: readonly ShortcutScreen[] = ['app'];
// All Hands persists in localStorage and can be shared with ?hands=all.
const ALL_HANDS_STORAGE_KEY = 'deckmate-hand-all';

function linkedAllHands(): boolean {
  if (new URLSearchParams(location.search).get('hands') === 'all') return true;
  try { return readStoredValue(localStorage, ALL_HANDS_STORAGE_KEY) === 'true'; } catch { return false; }
}

export function Hand({ snapshot, refreshKey, onOpenCard: openCard, onOpenMembers }: {
  snapshot: WorkspaceSnapshot;
  refreshKey: number;
  onOpenCard: (id: string) => void;
  /** 2026-11-06: the no-members empty state opens the same registry dialog as the app menu. */
  onOpenMembers: () => void;
}) {
  const { catalog, error, pending, edit, refresh } = useCatalog(snapshot, refreshKey);
  const handMutation = useRef(false);
  const viewRef = useRef<HTMLElement>(null);
  const t = useText(text);
  // Viewing another Hand must not change the acting member used for authorship.
  const [requestedMember, setRequestedMember] = useState(() => new URLSearchParams(location.search).get('handMember') ?? storedMemberId() ?? '');
  // The URL overrides localStorage, so ?hands=all works even with empty storage.
  const [showAllHands, setShowAllHands] = useState(linkedAllHands);
  const [tab, setTab] = useState<HandTab>(linkedHandTab);
  const pendingScroll = useRef<HandScroll | null>(null);
  const tabScrollFrame = useRef<number | null>(null);
  const [historyEntry, setHistoryEntry] = useState(0);
  const [quickSettings, setQuickSettings] = useState<{ card: CatalogCard; tab: CardQuickSettingsTab; anchor: HTMLElement } | null>(null);
  // Show all includes the whole team's due dates, beyond the selected member.
  const [showAllDue, setShowAllDue] = useState(false);
  const hands = useMemo(() => catalog ? getCatalogHands(catalog) : [], [catalog]);
  const { cardsById, decksById } = useMemo(() => ({
    cardsById: new Map(catalog?.cards.map(card => [card.id, card])),
    decksById: new Map(catalog?.decks.map(deck => [deck.id, deck])),
  }), [catalog]);
  // Your Hand defaults to the first human, or the first registered member if there are no humans.
  const defaultMember = hands.find(hand => hand.member.kind === 'human')?.member.id ?? hands[0]?.member.id ?? '';
  const memberFromLinkIsValid = hands.some(hand => hand.member.id === requestedMember);
  const selectedMember = memberFromLinkIsValid ? requestedMember : defaultMember;
  const savedHand = hands.find(hand => hand.member.id === selectedMember) ?? null;
  // Apply drops immediately and save in the background; a failure restores the file's order.
  const [droppedOrder, setDroppedOrder] = useState<{ memberId: string; ids: string[] } | null>(null);
  const activeHand = useMemo(() => {
    if (!savedHand || droppedOrder?.memberId !== savedHand.member.id) return savedHand;
    const rank = new Map(droppedOrder.ids.map((id, index) => [id, index]));
    const place = (card: CatalogCard) => rank.get(card.id) ?? Number.MAX_SAFE_INTEGER;
    return { ...savedHand, cards: [...savedHand.cards].sort((left, right) => place(left) - place(right)) };
  }, [savedHand, droppedOrder]);
  const members = catalog?.members ?? [];
  const lookups = useMemo(() => catalog ? buildCatalogLookups(catalog.cards, catalog.subCardOrder) : null, [catalog]);
  const writable = snapshot.writable && snapshot.source === 'sandbox';
  const openQuickSettings = useCallback((cardId: string, tab: CardQuickSettingsTab, anchor: HTMLElement) => {
    const card = catalog?.cards.find(item => item.id === cardId);
    if (card) setQuickSettings({ card, tab, anchor });
  }, [catalog]);
  // Hand slots reuse the deck's card tile; selection belongs to Decks, so no checkbox here.
  const tile = (card: CatalogCard, memberId = selectedMember) => lookups && <CatalogCardTile key={card.id} card={card} catalog={catalog ?? undefined} currentMemberId={memberId} lookups={lookups} members={members} tagDefinitions={catalog?.projectTags} selected={false} checked={false} selectionActive={false} disabled={pending} selectable={false} onOpen={() => onOpenCard(card.id)} onToggle={() => undefined} onFamilyOpen={family => onOpenCard(family.id)} onQuickSettings={writable ? openQuickSettings : undefined} />;
  const bookmarkedCards = useMemo(() => catalog ? catalog.cards.filter(card => card.bookmarked && !card.archived && !card.deleted) : [], [catalog]);
  // Planning sections use the selected member's due dates, current Runs and pinned Milestone.
  const today = localIsoDate();
  const dueSplit = catalog && activeHand ? splitDueCards(catalog.cards, activeHand.member, today) : null;
  const teamDueSplit = catalog ? splitDueCards(catalog.cards, null, today) : null;
  const shownDueSplit = showAllDue ? teamDueSplit : dueSplit;
  const dueBadge = shownDueSplit ? dueBadgeOf(shownDueSplit) : null;
  const dueCount = shownDueSplit ? shownDueSplit.now.length + shownDueSplit.soon.length + shownDueSplit.later.length : 0;
  const runsByOwner = catalog && activeHand ? currentRunsByOwner(catalog.runs, catalog.cards, activeHand.member, today) : null;
  const runsOwnedCardCount = runsByOwner?.owned.reduce((total, entry) => total + entry.cards.length, 0) ?? 0;
  // The manifest stores the pinned Milestone; do not duplicate that choice locally.
  const pinnedMilestone = catalog ? pinnedMilestoneOf(catalog) : null;
  const milestoneOwnedCards = catalog && activeHand && pinnedMilestone ? ownerCardsOfMilestone(catalog.cards, activeHand.member, pinnedMilestone.id) : [];
  // Show all remains available without personal due dates; hide the section only when entirely empty.
  const dueTabVisible = Boolean(teamDueSplit && dueBadgeOf(teamDueSplit).count > 0);
  const runsTabVisible = Boolean(runsByOwner && (runsByOwner.owned.length > 0 || runsByOwner.withoutCards.length > 0));
  const milestoneTabVisible = Boolean(pinnedMilestone);
  const activeTab = tab === 'due' && !dueTabVisible || tab === 'runs' && !runsTabVisible || tab === 'milestone' && !milestoneTabVisible ? 'bookmarks' : tab;
  useLayoutEffect(() => {
    pendingScroll.current = history.state?.deckmateHandScroll ?? null;
  }, []);
  useEffect(() => {
    function restoreHand() {
      if (tabScrollFrame.current !== null) cancelAnimationFrame(tabScrollFrame.current);
      tabScrollFrame.current = null;
      const params = new URLSearchParams(location.search);
      if (params.get('view') !== 'hand') return;
      pendingScroll.current = history.state?.deckmateHandScroll ?? null;
      setRequestedMember(params.get('handMember') ?? storedMemberId() ?? '');
      setShowAllHands(linkedAllHands());
      setTab(linkedHandTab());
      setHistoryEntry(entry => entry + 1);
    }
    window.addEventListener('popstate', restoreHand);
    return () => {
      window.removeEventListener('popstate', restoreHand);
      if (tabScrollFrame.current !== null) cancelAnimationFrame(tabScrollFrame.current);
    };
  }, []);
  useLayoutEffect(() => {
    const saved = pendingScroll.current;
    if (!catalog || !saved) return;
    if (saved.project !== catalog.rootIdentity || saved.source !== snapshot.source || saved.member !== selectedMember
      || saved.tab !== activeTab || saved.all !== showAllHands || !Number.isFinite(saved.top) || saved.top < 0) {
      pendingScroll.current = null;
      return;
    }
    let cancelled = false;
    let frame = 0;
    // 2026-11-11: the catalog and fonts determine the Hand's height; restoring against the loading view clamps the position.
    void document.fonts.ready.then(() => {
      if (cancelled) return;
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          if (cancelled || pendingScroll.current !== saved) return;
          const scrollport = viewRef.current?.closest<HTMLElement>('.workspace-main') ?? document.scrollingElement;
          scrollport?.scrollTo({ top: saved.top, behavior: 'instant' });
          pendingScroll.current = null;
        });
      });
    });
    return () => { cancelled = true; cancelAnimationFrame(frame); };
  }, [catalog, snapshot.source, selectedMember, activeTab, showAllHands, historyEntry]);
  // Dragging is limited to a single hand in the test copy; All Hands remains an overview.
  const canReorder = writable && !showAllHands && !pending && Boolean(activeHand);
  const handControls: HandMembershipControls | undefined = activeHand ? {
    memberId: activeHand.member.id,
    disabled: !writable || pending || showAllHands,
    onToggle: card => { void toggleHand(card); },
  } : undefined;

  async function toggleHand(card: CatalogCard) {
    if (!catalog || !activeHand || !writable || pending || showAllHands || handMutation.current) return false;
    handMutation.current = true;
    try {
      // 2026-11-05: personal queue membership is independent of Owner and planning assignments.
      return await edit({ action: 'bulk-edit-cards', manifestHash: catalog.manifestHash, optionsHash: catalog.optionsHash ?? '',
        cards: [{ cardId: card.id, sourceHash: card.sourceHash }],
        change: { kind: 'hand', memberId: activeHand.member.id, mode: card.handMemberIds?.includes(activeHand.member.id) ? 'remove' : 'add' } });
    } finally { handMutation.current = false; }
  }

  async function removeHandCard(card: CatalogCard) {
    if (!activeHand) return;
    const memberId = activeHand.member.id;
    const cards = splitHand(activeHand.cards).openCards;
    const index = cards.findIndex(item => item.id === card.id);
    const nextId = cards[index + 1]?.id ?? cards[index - 1]?.id;
    if (!await toggleHand(card)) return;
    requestAnimationFrame(() => {
      const view = viewRef.current;
      if (!view || view.querySelector<HTMLSelectElement>('.hand-member-picker select')?.value !== memberId) return;
      const next = [...view.querySelectorAll<HTMLElement>('[data-hand-card]')].find(element => element.dataset.handCard === nextId);
      (next?.querySelector<HTMLElement>('.hand-slot-handle, .hand-queue-open') ?? view.querySelector<HTMLElement>('.hand-member-picker select'))?.focus();
    });
  }

  function onOpenCard(id: string) {
    const scrollport = viewRef.current?.closest<HTMLElement>('.workspace-main') ?? document.scrollingElement;
    if (catalog && scrollport) {
      const scroll: HandScroll = { project: catalog.rootIdentity, source: snapshot.source, member: selectedMember,
        tab: activeTab, all: showAllHands, top: scrollport.scrollTop };
      history.replaceState({ ...history.state, deckmateHandScroll: scroll }, '', location.href);
    }
    openCard(id);
  }

  function replaceHandParam(name: string, value: string | null) {
    pendingScroll.current = null;
    const url = new URL(location.href);
    if (value === null) url.searchParams.delete(name); else url.searchParams.set(name, value);
    const state = { ...history.state };
    delete state.deckmateHandScroll;
    history.replaceState(state, '', url.pathname + '?' + url.searchParams.toString() + url.hash);
  }

  function selectTab(next: HandTab) {
    setTab(next);
    replaceHandParam('handTab', next);
    if (tabScrollFrame.current !== null) cancelAnimationFrame(tabScrollFrame.current);
    tabScrollFrame.current = null;
    if (window.matchMedia('(max-width: 600px)').matches) {
      tabScrollFrame.current = requestAnimationFrame(() => {
        tabScrollFrame.current = null;
        viewRef.current?.querySelector('#hand-tab-panel')?.scrollIntoView({ block: 'start' });
      });
    }
  }

  function selectMember(memberId: string) {
    setRequestedMember(memberId);
    replaceHandParam('handMember', memberId);
  }

  /** Timeline restores its selection from its existing storage key. */
  function openTimeline(target: PlanningTarget) {
    if (!catalog) return;
    navigateToPlanning(snapshot.source, catalog.rootIdentity, target);
  }

  function toggleAllHands(enabled: boolean) {
    setShowAllHands(enabled);
    try { localStorage.setItem(ALL_HANDS_STORAGE_KEY, enabled ? 'true' : 'false'); } catch { /* Without localStorage the mode lasts until reload. */ }
    replaceHandParam('hands', enabled ? 'all' : null);
  }

  /** Open card order is stored as slots in Card Options. */
  async function finishHandDrag(event: DragEndEvent) {
    if (!catalog || !activeHand || !event.over || event.active.id === event.over.id) return;
    const openCards = splitHand(activeHand.cards).openCards;
    const ids = openCards.map(card => card.id);
    const from = ids.indexOf(String(event.active.id));
    const to = ids.indexOf(String(event.over.id));
    if (from < 0 || to < 0) return;
    const reordered = arrayMove(openCards, from, to);
    setDroppedOrder({ memberId: activeHand.member.id, ids: reordered.map(card => card.id) });
    try {
      await edit({ action: 'reorder-hand', manifestHash: catalog.manifestHash, memberId: activeHand.member.id,
        cards: reordered.map(card => ({ cardId: card.id, sourceHash: card.sourceHash })) });
    } finally { setDroppedOrder(null); }
  }

  /** The active tab shows one of three planning sections, Bookmarks or Team Hands. */
  function renderTabPanel(): ReactNode {
    if (activeTab === 'due' && shownDueSplit) return <div className="hand-tab-panel" role="tabpanel" id="hand-tab-panel" tabIndex={0} aria-labelledby="hand-tab-due">
      <HandDueSection split={shownDueSplit} showAll={showAllDue}
        decksById={decksById} members={members} checklistByCard={lookups?.checklistByCard} projectTags={catalog?.projectTags} onOpenCard={onOpenCard} />
    </div>;
    if (activeTab === 'runs' && runsByOwner) return <div className="hand-tab-panel" role="tabpanel" id="hand-tab-panel" tabIndex={0} aria-labelledby="hand-tab-runs">
      <HandRunsSection owned={runsByOwner.owned} withoutCards={runsByOwner.withoutCards}
        decksById={decksById} projectTags={catalog?.projectTags} onOpenTimeline={openTimeline} onOpenCard={onOpenCard} handControls={handControls} />
    </div>;
    if (activeTab === 'milestone' && pinnedMilestone) return <div className="hand-tab-panel" role="tabpanel" id="hand-tab-panel" tabIndex={0} aria-labelledby="hand-tab-milestone">
      <HandMilestoneSection milestone={pinnedMilestone} cards={milestoneOwnedCards}
        decksById={decksById} projectTags={catalog?.projectTags} onOpenTimeline={openTimeline} onOpenCard={onOpenCard} handControls={handControls} />
    </div>;
    if (activeTab === 'bookmarks') return <div className="hand-tab-panel glass-panel" role="tabpanel" id="hand-tab-panel" tabIndex={0} aria-labelledby="hand-tab-bookmarks">
      {bookmarkedCards.length
        ? <div className="hand-bookmarks">{bookmarkedCards.map(card => tile(card))}</div>
        : <EmptyState message={t.noBookmarks} />}
    </div>;
    return <div className="hand-tab-panel glass-stack" role="tabpanel" id="hand-tab-panel" tabIndex={0} aria-labelledby="hand-tab-team">
      {hands.map(({ member, cards }) => <section className="hand-member glass-panel" key={member.id} aria-labelledby={`hand-${member.id}`}>
        <header className="hand-member-heading panel-head"><CardOwnerAvatar owner={member.label} members={members} /><h2 className="panel-title" id={`hand-${member.id}`}>{member.label}</h2><span className="hand-member-kind">{member.kind === 'agent' ? t.agent : t.human}</span><span className="hand-count panel-count" aria-label={t.cardCount(cards.length)}>{(cards.length).toLocaleString(locale())}</span></header>
        {!cards.length ? <EmptyState message={writable ? t.emptyMemberHand : t.emptyHandReadOnly} /> : <div className="hand-cards">{cards.map(card => <HandMemberCard key={card.id} card={card} cardsById={cardsById} decksById={decksById} members={members} progress={lookups?.checklistByCard.get(card.id)} projectTags={catalog?.projectTags} onOpenCard={onOpenCard} />)}</div>}
      </section>)}
    </div>;
  }

  const activeSplit = activeHand ? splitHand(activeHand.cards) : null;
  const handEffort = (activeSplit?.openCards ?? []).reduce((total, card) => total + (card.effort ?? 0), 0);
  // All Hands follows registry order, humans before agents; stable sorting preserves ties.
  const orderedHands = useMemo(() => [...hands].sort((left, right) => (left.member.kind === 'human' ? 0 : 1) - (right.member.kind === 'human' ? 0 : 1)), [hands]);
  const panelHeader = <header className="hand-panel-header page-head">
    <div className="page-head-main"><div className="page-title-block"><h1 className="page-title">{t.yourHand}</h1>
    </div></div><div className="page-tools">
    {!showAllHands && handEffort > 0 && <span className="hand-panel-effort page-number" role="img" title={t.totalEffort(handEffort)} aria-label={t.totalEffort(handEffort)}><Gauge size={16} aria-hidden="true" />{(handEffort).toLocaleString(locale())}</span>}
    <label className="hand-all-toggle" title={t.showAllTitle}>
      <input type="checkbox" role="switch" checked={showAllHands} onChange={event => toggleAllHands(event.target.checked)} aria-label={t.allHands} />
      <span className="hand-all-track" aria-hidden="true"><span className="hand-all-thumb" /></span>
      <span>{t.allHands}</span>
    </label>
    <label className="hand-member-picker"><span className="visually-hidden">{t.whoseHand}</span>
      <select className="control-field" value={selectedMember} onChange={event => selectMember(event.target.value)} aria-label={t.whoseHand} title={activeHand?.member.label}>{hands.map(({ member }) => <option key={member.id} value={member.id}>{member.label}</option>)}</select>
    </label>
    </div>
    {!showAllHands && activeHand?.member.kind === 'agent' && <div className="hand-agent-hint"><AgentQueueHint assignment="hand" /></div>}
    {showAllHands && writable && <p className="hand-overview-hint">{t.overviewHint}</p>}
  </header>;
  const panelBody = showAllHands
    ? <div className="hand-all-list">
      {orderedHands.map(hand => {
        const { queuedCards } = splitHand(hand.cards);
        return <section className="hand-all-member" key={hand.member.id} aria-label={t.handOf(hand.member.label)}>
          <header className="hand-all-member-heading"><CardOwnerAvatar owner={hand.member.label} members={members} /><h2>{hand.member.label}</h2></header>
          {hand.cards.length || hand.doneCards.length ? <HandSlots key={hand.member.id} hand={hand} tile={card => tile(card, hand.member.id)} canReorder={false} onOpenCard={onOpenCard} /> : <EmptyState message={t.empty} />}
          <HandQueue cards={queuedCards} decksById={decksById} projectTags={catalog?.projectTags} canReorder={false} onOpenCard={onOpenCard} />
        </section>;
      })}
    </div>
    : activeHand && <HandSlots key={activeHand.member.id} hand={activeHand} tile={tile} canReorder={canReorder} reserveActions={writable} onOpenCard={onOpenCard}
      onRemove={canReorder ? removeHandCard : undefined} emptyGuide={<div className="hand-empty-guide"><p>{writable ? t.emptyHand : t.emptyHandReadOnly}</p>{writable && <a className="control" href={`/?view=deck&catalogSource=${encodeURIComponent(snapshot.source)}&scope=all&handMember=${encodeURIComponent(selectedMember)}`}>{t.chooseCards}</a>}</div>} />;

  return <section ref={viewRef} className="hand-view page-light">
    {error && <div className="hand-error error-banner" role="alert"><span>{error}</span><Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => void refresh()}>{t.refreshData}</Button></div>}
    {!catalog && !error && <LoadingState message={t.loading} />}
    {/* 2026-11-10: the no-members state is a large empty area, so it gets the team scene; the Members action exists only
        where members can be added (writable). */}
    {catalog && !hands.length && <div className="glass-panel"><EmptyState variant="first-run" art="team" title={t.noMembersTitle} message={writable ? t.noMembersDescription : t.noMembersReadOnly} action={writable ? { label: t.openMembers, onClick: onOpenMembers } : undefined} /></div>}
    {catalog && hands.length > 0 && <>
      {panelHeader}
      <div className="hand-tabs control-tabs">
        <div className="hand-tab-list" role="tablist" aria-label={t.handSections} onKeyDown={navigateTabs}>
          {dueTabVisible && <button type="button" role="tab" id="hand-tab-due" aria-controls="hand-tab-panel" tabIndex={activeTab === 'due' ? 0 : -1} aria-selected={activeTab === 'due'} aria-label={t.tabWithCount(t.yourDueCards, dueCount)} className={`hand-tab control-tab${activeTab === 'due' ? ' is-active' : ''}`} onClick={() => selectTab('due')}>
            <span className={`hand-tab-count page-number${dueBadge?.bucket ? ` is-due-${dueBadge.bucket}` : ''}`} aria-hidden="true">{dueCount.toLocaleString(locale())}</span>{t.yourDueCards}
          </button>}
          {runsTabVisible && <button type="button" role="tab" id="hand-tab-runs" aria-controls="hand-tab-panel" tabIndex={activeTab === 'runs' ? 0 : -1} aria-selected={activeTab === 'runs'} aria-label={t.tabWithCount(t.yourRuns, runsOwnedCardCount)} className={`hand-tab control-tab${activeTab === 'runs' ? ' is-active' : ''}`} onClick={() => selectTab('runs')}>
            <span className="hand-tab-count page-number" aria-hidden="true">{runsOwnedCardCount.toLocaleString(locale())}</span>{t.yourRuns}
          </button>}
          {milestoneTabVisible && <button type="button" role="tab" id="hand-tab-milestone" aria-controls="hand-tab-panel" tabIndex={activeTab === 'milestone' ? 0 : -1} aria-selected={activeTab === 'milestone'} aria-label={t.tabWithCount(t.pinnedMilestone, milestoneOwnedCards.length)} className={`hand-tab control-tab${activeTab === 'milestone' ? ' is-active' : ''}`} onClick={() => selectTab('milestone')}>
            <span className="hand-tab-count page-number" aria-hidden="true">{milestoneOwnedCards.length.toLocaleString(locale())}</span>{t.pinnedMilestone}
          </button>}
          <button type="button" role="tab" id="hand-tab-bookmarks" aria-controls="hand-tab-panel" tabIndex={activeTab === 'bookmarks' ? 0 : -1} aria-selected={activeTab === 'bookmarks'} aria-label={t.tabWithCount(t.bookmarks, bookmarkedCards.length)} className={`hand-tab control-tab${activeTab === 'bookmarks' ? ' is-active' : ''}`} onClick={() => selectTab('bookmarks')}>
            <span className="hand-tab-count page-number" aria-hidden="true">{bookmarkedCards.length.toLocaleString(locale())}</span>{t.bookmarks}
          </button>
          <button type="button" role="tab" id="hand-tab-team" aria-controls="hand-tab-panel" tabIndex={activeTab === 'team' ? 0 : -1} aria-selected={activeTab === 'team'} className={`hand-tab control-tab${activeTab === 'team' ? ' is-active' : ''}`} onClick={() => selectTab('team')}>
            <Users size={20} aria-hidden="true" />{t.teamHands}
          </button>
        </div>
        {activeTab === 'due' && <button type="button" className="hand-show-all control" aria-pressed={showAllDue} onClick={() => setShowAllDue(enabled => !enabled)}>{t.showAll}</button>}
      </div>
      {!showAllHands && activeHand
        ? <HandBoard hand={activeHand} canReorder={canReorder} decksById={decksById} projectTags={catalog.projectTags} onOpenCard={onOpenCard} onRemove={canReorder ? removeHandCard : undefined} onDragEnd={event => void finishHandDrag(event)}>
          <section className="hand-panel glass-panel" aria-label={t.yourHand}>
            <div className="hand-panel-body">
              {panelBody}
            </div>
          </section>
        </HandBoard>
        : <section className="hand-panel glass-panel" aria-label={t.yourHand}>
            <div className="hand-panel-body">
              {panelBody}
            </div>
          </section>}
      {renderTabPanel()}
      {requestedMember && !memberFromLinkIsValid && <p className="hand-empty" role="status">{t.invalidMember}</p>}
    </>}
    {quickSettings && catalog && <CardQuickSettings card={quickSettings.card} catalog={catalog} source={snapshot.source} projectName={snapshot.projectName}
      tab={quickSettings.tab} onTabChange={tab => setQuickSettings(current => current && { ...current, tab })} anchor={quickSettings.anchor}
      disabled={!writable || pending} onEdit={edit} onClose={() => setQuickSettings(null)} />}
    <ShortcutsHelp screens={handShortcutScreens} writable={writable} />
  </section>;
}

/** Exclude accepted cards while preserving hand order from Card Options slots. */
function splitHand(cards: CatalogCard[]) {
  const openCards = cards.filter(card => card.state !== 'done');
  return { openCards, slotCards: openCards.slice(0, HAND_SLOT_COUNT), queuedCards: openCards.slice(HAND_SLOT_COUNT) };
}

/** The pile keeps its total and exposes the current week without requiring a tooltip. */
function DoneSlot({ doneCards, lastWeek, expanded, controls, onToggle }: { doneCards: CatalogCard[]; lastWeek: ReturnType<typeof summarizeDoneWeek>; expanded: boolean; controls: string; onToggle: () => void }) {
  const t = useText(text);
  const thisWeek = summarizeDoneWeek(doneCards, isoWeekStart());
  const title = t.doneSummary(thisWeek.count, thisWeek.effort, lastWeek.count, lastWeek.effort, doneCards.length);
  return <button type="button" className="hand-slot hand-slot-done" aria-expanded={expanded} aria-controls={controls} title={title} onClick={onToggle}>
    <span className="hand-slot-done-chip"><Check size={24} aria-hidden="true" /></span>
    <span className="hand-slot-done-label">{t.doneCards} <span className="hand-slot-done-count">{doneCards.length.toLocaleString(locale())}</span></span>
    <span className="hand-slot-done-week">{t.doneThisWeek(thisWeek.count, thisWeek.effort)}</span>
  </button>;
}

/** A single hand shares one drag zone across slots and queue; the panel is passed as children. */
function HandBoard({ hand, canReorder, decksById, projectTags, onOpenCard, onRemove, onDragEnd, children }: {
  hand: CatalogHand;
  canReorder: boolean;
  decksById: Map<string, CatalogDeck>;
  projectTags?: readonly ProjectTag[];
  onOpenCard: (id: string) => void;
  onRemove?: (card: CatalogCard) => void;
  onDragEnd: (event: DragEndEvent) => void;
  children: ReactNode;
}) {
  const sensors = useSensors(useSensor(PointerSensor, handPointerOptions), useSensor(KeyboardSensor, handKeyboardOptions));
  const t = useText(text);
  const collisions = useMemo(createHandCollisions, []);
  const motion = useMemo(() => {
    if (typeof getComputedStyle !== 'function') return null;
    return readMotionTokens('--motion-material');
  }, []);
  const openIds = useMemo(() => splitHand(hand.cards).openCards.map(card => card.id), [hand.cards]);
  const cardName = (id: string | number) => hand.cards.find(card => card.id === id)?.title ?? t.card;
  const [drag, setDrag] = useState<{ preview: CardDragPreview | null; queueTitle: string | null } | null>(null);
  const [dropAnimation, setDropAnimation] = useState<typeof motion>(null);
  const dragging = drag !== null;
  const overlayActive = Boolean(drag?.preview || drag?.queueTitle);
  const transfer = useMemo(() => ({ available: false, enabled: false, active: dragging, canDrag: () => false }), [dragging]);
  // 2026-11-10: a tile/queue exchange changes the face's size and parent; only same-surface neighbors can continue a slide.
  const layoutMotion = useCardLayoutMotion({ layoutKey: JSON.stringify(openIds),
    resetKey: JSON.stringify([hand.member.id, openIds.slice(0, HAND_SLOT_COUNT).sort()]), dragging, settleDrag: true });
  return <DndContext sensors={sensors} collisionDetection={collisions.detect}
    onDragStart={({ active, activatorEvent }) => {
      collisions.reset();
      // Keyboard coordinates need the full row geometry; only pointer drags use the compact preview.
      const queueTitle = active.data.current?.surface === 'hand-queue' && activatorEvent.type !== 'keydown' ? cardName(active.id) : null;
      const preview = captureCardDragPreview({ active, activatorEvent }, '.hand-slot');
      setDropAnimation(preview && !window.matchMedia('(prefers-reduced-motion: reduce)').matches ? motion : null);
      setDrag({ preview, queueTitle });
    }}
    onDragCancel={() => { collisions.reset(); setDrag(null); }} onDragEnd={event => {
      collisions.reset();
      if (event.active.data.current?.surface !== event.over?.data.current?.surface) setDropAnimation(null);
      setDrag(null);
      onDragEnd(event);
    }} accessibility={{
    screenReaderInstructions: { draggable: t.dragInstructions },
    announcements: {
      onDragStart: ({ active }) => t.dragStart(cardName(active.id)),
      onDragOver: ({ active, over }) => over ? t.dragOver(cardName(active.id), openIds.indexOf(String(over.id)) + 1, openIds.length) : t.outsideHand,
      onDragEnd: ({ active, over }) => over ? t.dragEnd(cardName(active.id), openIds.indexOf(String(over.id)) + 1) : t.dragCancelled,
      onDragCancel: () => t.dragCancelled,
    },
  }}>
    <CardTransferContext.Provider value={transfer}><HandMotionContext.Provider value={motion}>
      <div ref={layoutMotion} className={'hand-board' + (dragging ? ' is-card-transfer-active' : '') + (overlayActive ? ' has-hand-drag-overlay' : '')}>
        <SortableContext items={openIds} strategy={handSorting}>
          {children}
          <HandQueue cards={splitHand(hand.cards).queuedCards} decksById={decksById} projectTags={projectTags} canReorder={canReorder} overlayActive={Boolean(drag?.queueTitle)} onOpenCard={onOpenCard} onRemove={onRemove} />
        </SortableContext>
      </div>
      <DragOverlay dropAnimation={dropAnimation} adjustScale={false} style={{ pointerEvents: 'none' }}>
        {drag?.preview && <CardDragFace preview={drag.preview} count={1} />}
        {drag?.queueTitle && <div className="card-transfer-overlay" aria-hidden="true"><GripVertical size={14} /><strong>{drag.queueTitle}</strong></div>}
      </DragOverlay>
    </HandMotionContext.Provider></CardTransferContext.Provider>
  </DndContext>;
}

/** The Done pile and seven numbered slots share a layout in single-hand and All Hands views. */
function HandSlots({ hand, tile, canReorder, reserveActions = false, onOpenCard, onRemove, emptyGuide }: { hand: CatalogHand; tile: (card: CatalogCard) => ReactNode; canReorder: boolean; reserveActions?: boolean; onOpenCard: (id: string) => void; onRemove?: (card: CatalogCard) => void; emptyGuide?: ReactNode }) {
  const { slotCards } = splitHand(hand.cards);
  const [expanded, setExpanded] = useState(false);
  const t = useText(text);
  const lastWeek = summarizeDoneWeek(hand.doneCards, isoWeekStart(1));
  const listId = `hand-done-${hand.member.id}`;
  return <>
    <div className={'hand-slots' + (reserveActions && slotCards.length ? ' has-slot-actions' : '')}>
    <DoneSlot doneCards={hand.doneCards} lastWeek={lastWeek} expanded={expanded} controls={listId} onToggle={() => setExpanded(value => !value)} />
    {!slotCards.length && emptyGuide ? emptyGuide : Array.from({ length: HAND_SLOT_COUNT }, (_, index) => {
      const card = slotCards[index];
      return card
        ? <HandSlotTile key={card.id} card={card} tile={tile} canReorder={canReorder} onRemove={onRemove} />
        : <div className="hand-slot" key={`slot-${index + 1}`}><span className="hand-slot-number">{index + 1}</span></div>;
    })}
    </div>
    <div id={listId} className="hand-done-list" hidden={!expanded}>
      <p>{t.doneLastWeek(lastWeek.count, lastWeek.effort)}</p>
      {hand.doneCards.length ? <ul>{hand.doneCards.map(card => <li key={card.id}><button type="button" className="hand-queue-open" onClick={() => onOpenCard(card.id)}>{card.title}</button></li>)}</ul> : <EmptyState message={t.noDoneCards} />}
    </div>
  </>;
}

/** The whole occupied slot is draggable; a click without movement opens the card. */
function HandSlotTile({ card, tile, canReorder, onRemove }: { card: CatalogCard; tile: (card: CatalogCard) => ReactNode; canReorder: boolean; onRemove?: (card: CatalogCard) => void }) {
  const transition = useContext(HandMotionContext);
  const sortable = useSortable({ id: card.id, disabled: !canReorder, transition });
  // 2026-11-10: sorting moves the wrapper, not the face; rebuilding it also replaces the tile's callback props.
  const face = useMemo(() => tile(card), [card, tile]);
  const t = useText(text);
  const transform = sortable.transform ? `translate3d(${sortable.transform.x}px, ${sortable.transform.y}px, 0)` : undefined;
  function startPointerDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (!canReorder || event.defaultPrevented || event.pointerType === 'touch') return;
    // The tile face opens or drags the card; its other buttons keep their own actions.
    const control = (event.target as Element).closest('button, a, input, select, textarea, [role="button"]');
    if (control && !control.matches('.deck-card-open, .hand-slot-handle')) return;
    sortable.listeners?.onPointerDown?.(event);
  }
  return <div ref={sortable.setNodeRef} data-hand-card={card.id} className={'hand-slot is-filled' + (sortable.isDragging ? ' is-drag-source' : '')}
    style={{ transform, transition: sortable.transition }} onPointerDown={startPointerDrag}>
    {face}
    {canReorder && <button type="button" ref={sortable.setActivatorNodeRef} className="hand-slot-handle" {...sortable.attributes}
      {...sortable.listeners} onPointerDown={event => { event.stopPropagation(); sortable.listeners?.onPointerDown?.(event); }} aria-label={t.moveInHand(card.title)} title={t.reorderTitle}><GripVertical size={14} aria-hidden="true" /></button>}
    {onRemove && <button type="button" className="hand-slot-remove" aria-label={t.removeCard(card.title)} title={t.removeCard(card.title)} onClick={() => onRemove(card)}><X size={14} aria-hidden="true" /></button>}
  </div>;
}

/** Cards beyond the seven slots use queue drag handles; start them with the open card's play action or Space on a tile. */
function HandQueue({ cards, decksById, projectTags, canReorder, overlayActive, onOpenCard, onRemove }: {
  cards: CatalogCard[];
  decksById: Map<string, CatalogDeck>;
  projectTags?: readonly ProjectTag[];
  canReorder: boolean;
  overlayActive?: boolean;
  onOpenCard: (id: string) => void;
  onRemove?: (card: CatalogCard) => void;
}) {
  const t = useText(text);
  if (!cards.length) return null;
  return <div className={'hand-queue' + (overlayActive ? ' has-drag-overlay' : '')}>
    <strong>{t.queue(cards.length)}</strong>
    <ul>{cards.map(card => <HandQueueRow key={card.id} card={card} deckTitle={decksById.get(card.deckId ?? '')?.title ?? t.noDeck}
      projectTags={projectTags} canReorder={canReorder} onOpen={() => onOpenCard(card.id)} onRemove={onRemove ? () => onRemove(card) : undefined} />)}</ul>
  </div>;
}

function HandQueueRow({ card, deckTitle, projectTags, canReorder, onOpen, onRemove }: {
  card: CatalogCard;
  deckTitle: string;
  projectTags?: readonly ProjectTag[];
  canReorder: boolean;
  onOpen: () => void;
  onRemove?: () => void;
}) {
  const transition = useContext(HandMotionContext);
  const sortable = useSortable({ id: card.id, disabled: !canReorder, transition, data: { surface: 'hand-queue' } });
  const t = useText(text);
  const transform = sortable.transform ? `translate3d(${sortable.transform.x}px, ${sortable.transform.y}px, 0)` : undefined;
  return <li ref={sortable.setNodeRef} data-hand-card={card.id} className={sortable.isDragging ? 'is-drag-source' : undefined} style={{ transform, transition: sortable.transition }}>
    {canReorder && <button type="button" ref={sortable.setActivatorNodeRef} className="hand-queue-handle" {...sortable.attributes} {...sortable.listeners}
      aria-label={t.moveInHand(card.title)} title={t.reorderTitle}><GripVertical size={14} /></button>}
    <button type="button" className="hand-queue-open" onClick={onOpen}><span title={card.title}>{card.title}</span><CardTags tags={card.tags} definitions={projectTags} compact /><small title={deckTitle}>{deckTitle}</small></button>
    {onRemove && <button type="button" className="hand-queue-remove" aria-label={t.removeCard(card.title)} title={t.removeCard(card.title)} onClick={onRemove}><X size={14} aria-hidden="true" /></button>}
  </li>;
}

/* ——— Planning sections: Your due cards, Your Runs, Pinned Milestone ——— */

/** State groups use catalog column labels; Hero and Doc cards have separate groups, as in PlanningScope. */
function stateGroupLabel(key: string, lang: Lang): string {
  if (key === 'hero' || key === 'doc') return kindLabel(key, lang);
  return stateLabel(key, lang);
}

type HandSectionMembers = Parameters<typeof CardOwnerAvatar>[0]['members'];
interface HandMembershipControls {
  memberId: string;
  disabled: boolean;
  onToggle: (card: CatalogCard) => void;
}

/** A hand section row shows title, due date and deck; clicking opens the card. */
function HandSectionRow({ card, deckTitle, dueBucket, owner, members, progress, projectTags, onOpenCard, handControls }: {
  card: CatalogCard;
  deckTitle: string;
  dueBucket?: 'now' | 'soon' | 'later';
  /** Only Show all needs an owner avatar on each row. */
  owner?: string | null;
  members?: HandSectionMembers;
  progress?: ChecklistProgress;
  projectTags?: readonly ProjectTag[];
  onOpenCard: (id: string) => void;
  handControls?: HandMembershipControls;
}) {
  const lang = useLang();
  const t = useText(text);
  const inHand = Boolean(handControls && card.handMemberIds?.includes(handControls.memberId));
  return <li className={handControls ? 'hand-planning-row' : undefined}>
    <button type="button" className="hand-section-row" onClick={() => onOpenCard(card.id)}>
      {owner !== undefined && members && <span className="hand-row-owner"><CardOwnerAvatar owner={owner} members={members} progress={progress} /></span>}
      <span className="hand-row-title" title={card.title}>{card.title}</span>
      <CardTags tags={card.tags} definitions={projectTags} compact />
      {card.dueDate && <small className={'hand-row-due' + (dueBucket ? ` is-due-${dueBucket}` : '')}>{formatPlanningDate(card.dueDate, lang)}</small>}
      <small title={deckTitle}>{deckTitle}</small>
    </button>
    {handControls && <Button type="button" variant="ghost" size="sm" className="hand-membership-action" disabled={handControls.disabled} onClick={() => handControls.onToggle(card)}>{inHand ? t.removeFromHand : t.addToHand}</Button>}
  </li>;
}

/** Your due cards has up to three groups: Due now, Due soon and Due later; Show all includes the whole team. */
function HandDueSection({ split, showAll, decksById, members, checklistByCard, projectTags, onOpenCard }: {
  split: DueCardsSplit;
  showAll: boolean;
  decksById: Map<string, CatalogDeck>;
  members: HandSectionMembers;
  checklistByCard?: CatalogLookups['checklistByCard'];
  projectTags?: readonly ProjectTag[];
  onOpenCard: (id: string) => void;
}) {
  const t = useText(text);
  const groups: Array<{ key: 'now' | 'soon' | 'later'; label: string }> = [
    { key: 'now', label: t.dueNow },
    { key: 'soon', label: t.dueSoon },
    { key: 'later', label: t.dueLater },
  ];
  return <section className="hand-section glass-panel" aria-label={t.yourDueCards}>
    {dueBadgeOf(split).count === 0 && <EmptyState message={t.noDueCards} />}
    {groups.map(group => split[group.key].length > 0 && (
      <div className="hand-group" key={group.key}>
        <h3 className={`hand-group-title is-due-${group.key}`}>{group.label}</h3>
        <ul className="hand-row-list">
          {split[group.key].map(card => <HandSectionRow key={card.id} card={card} dueBucket={group.key}
            deckTitle={decksById.get(card.deckId ?? '')?.title ?? t.noDeck}
            owner={showAll ? card.owner : undefined} members={members} progress={checklistByCard?.get(card.id)} projectTags={projectTags} onOpenCard={onOpenCard} />)}
        </ul>
      </div>
    ))}
  </section>;
}

/** The Run title links to its full Timeline view. */
function HandRunBlock({ run, cards, decksById, projectTags, onOpenTimeline, onOpenCard, handControls }: {
  run: RunRecord;
  cards: CatalogCard[];
  decksById: Map<string, CatalogDeck>;
  projectTags?: readonly ProjectTag[];
  onOpenTimeline: (target: PlanningTarget) => void;
  onOpenCard: (id: string) => void;
  handControls?: HandMembershipControls;
}) {
  const t = useText(text);
  const lang = useLang();
  const workload = metrics(cards.filter(card => card.state !== 'done'));
  const remaining = Math.max(0, workdaysUntil(localIsoDate(), run.end));
  return <div className="hand-run">
    <header className="hand-run-head panel-head">
      <button type="button" className="hand-run-name panel-title" onClick={() => onOpenTimeline({ kind: 'run', id: run.id })} title={t.openRunTimeline(runLabel(run, lang))}>{runLabel(run, lang)}</button>
      <span className="hand-run-dates">{formatPlanningDate(run.start, lang)} — {formatPlanningDate(run.end, lang)}</span>
      <span className="hand-run-workload">{t.runWorkload(workload.effort, workload.unestimated, remaining)}</span>
    </header>
    {cards.length === 0 && <EmptyState message={t.noOwnedRun} />}
    {groupCardsByStateFlow(cards).map(group => (
      <div className="hand-group" key={group.key}>
        <h4 className="hand-group-title">{stateGroupLabel(group.key, lang)}</h4>
        <ul className="hand-row-list">
          {group.cards.map(card => <HandSectionRow key={card.id} card={card} projectTags={projectTags}
            deckTitle={decksById.get(card.deckId ?? '')?.title ?? t.noDeck} onOpenCard={onOpenCard} handControls={handControls} />)}
        </ul>
      </div>
    ))}
  </div>;
}

/** Your Runs lists personal cards in current Runs; Runs without personal cards form the lower group. Exported for the surface test: the tab starts on Bookmarks, so a static render never reaches this section through Hand. */
export function HandRunsSection({ owned, withoutCards, decksById, projectTags, onOpenTimeline, onOpenCard, handControls }: {
  owned: OwnerRunCards[];
  withoutCards: RunRecord[];
  decksById: Map<string, CatalogDeck>;
  projectTags?: readonly ProjectTag[];
  onOpenTimeline: (target: PlanningTarget) => void;
  onOpenCard: (id: string) => void;
  handControls?: HandMembershipControls;
}) {
  const t = useText(text);
  return <section className="hand-section glass-panel" aria-label={t.yourRuns}>
    {owned.map(({ run, cards }) => <HandRunBlock key={run.id} run={run} cards={cards} projectTags={projectTags}
      decksById={decksById} onOpenTimeline={onOpenTimeline} onOpenCard={onOpenCard} handControls={handControls} />)}
    {withoutCards.map(run => <HandRunBlock key={run.id} run={run} cards={[]} projectTags={projectTags}
      decksById={decksById} onOpenTimeline={onOpenTimeline} onOpenCard={onOpenCard} handControls={handControls} />)}
  </section>;
}

/** Pinned Milestone shows personal cards; See full Milestone opens the complete view. */
function HandMilestoneSection({ milestone, cards, decksById, projectTags, onOpenTimeline, onOpenCard, handControls }: {
  milestone: MilestoneRecord;
  cards: CatalogCard[];
  decksById: Map<string, CatalogDeck>;
  projectTags?: readonly ProjectTag[];
  onOpenTimeline: (target: PlanningTarget) => void;
  onOpenCard: (id: string) => void;
  handControls?: HandMembershipControls;
}) {
  const t = useText(text);
  const lang = useLang();
  return <section className="hand-section glass-panel" aria-label={t.pinnedMilestone}>
    <div className="hand-section-toolbar panel-head">
      <h3 className="hand-milestone-title panel-title"><span>{milestone.title}</span><small>{formatPlanningDate(milestone.date, lang)}</small></h3>
      <button type="button" className="hand-show-all control" onClick={() => onOpenTimeline({ kind: 'milestone', id: milestone.id })}>{t.seeFullMilestone}</button>
    </div>
    {groupCardsByStateFlow(cards).map(group => (
      <div className="hand-group" key={group.key}>
        <h4 className="hand-group-title">{stateGroupLabel(group.key, lang)}</h4>
        <ul className="hand-row-list">
          {group.cards.map(card => <HandSectionRow key={card.id} card={card} projectTags={projectTags}
            deckTitle={decksById.get(card.deckId ?? '')?.title ?? t.noDeck} onOpenCard={onOpenCard} handControls={handControls} />)}
        </ul>
      </div>
    ))}
    {cards.length === 0 && <EmptyState message={t.noOwnedMilestone} />}
  </section>;
}

/** Team Hands keeps the per-member list view of 2026-11-03. */
function HandMemberCard({ card, cardsById, decksById, members, progress, projectTags, onOpenCard }: {
  card: CatalogCard;
  cardsById: Map<string, CatalogCard>;
  decksById: Map<string, CatalogDeck>;
  members: Parameters<typeof CardOwnerAvatar>[0]['members'];
  progress?: ChecklistProgress;
  projectTags?: readonly ProjectTag[];
  onOpenCard: (id: string) => void;
}) {
  const t = useText(text);
  const lang = useLang();
  const parent = card.parentId ? cardsById.get(card.parentId) : undefined;
  const deck = card.deckId ? decksById.get(card.deckId) : undefined;
  return <div className={`sprint-task hand-card kind-${card.kind}`}>
    {parent && <span className="sprint-task-parent"><Crown size={12} /><span>{parent.title}</span></span>}
    <button type="button" className="hand-card-open" onClick={() => onOpenCard(card.id)} aria-label={t.openCard(card.title)}>
      <span className="sprint-task-body"><strong>{card.title}</strong><small>{deck?.title ?? t.noDeck}</small>
        <CardTags tags={card.tags} definitions={projectTags} compact />
        {card.dueDate && <small>{t.due} · {formatPlanningDate(card.dueDate, lang)}</small>}
        <span className="sprint-task-owner"><CardOwnerAvatar owner={card.owner} members={members} progress={progress} /><span>{card.owner ?? t.unassigned}</span>{card.bookmarked && <Bookmark size={12} aria-label={t.bookmark} />}</span>
      </span>
    </button>
    <span className="sprint-task-band">
      {card.kind === 'task' ? <StatusBadge state={card.state ?? 'not-started'} /> : <span className="hand-card-kind">{card.kind === 'hero' ? <Crown size={12} /> : <NotebookText size={12} />}{card.kind === 'hero' ? kindLabel('hero', lang) : kindLabel('doc', lang)}</span>}
      {card.effort != null && <span className="sprint-task-effort" title={t.effort}><Gauge size={13} />{(card.effort).toLocaleString(locale())}</span>}<ArrowUpRight size={14} />
    </span>
  </div>;
}
