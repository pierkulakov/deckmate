import { readStoredValue } from '../storage.ts';
import { runLabel } from '../run-label.ts';
import { ArrowUpRight, Bookmark, Check, Crown, FileText, Gauge, GripVertical, Hand as HandIcon, Users } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { DndContext, DragEndEvent, DragOverlay, KeyboardSensor, PointerSensor, closestCenter, pointerWithin, useSensor, useSensors, type CollisionDetection } from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable, type SortingStrategy } from '@dnd-kit/sortable';
import { currentRunsByOwner, dueBadgeOf, getCatalogHands, groupCardsByStateFlow, isoWeekStart, localIsoDate, ownerCardsOfMilestone, pinnedMilestoneOf, splitDueCards, summarizeDoneWeek, type CatalogHand, type DueCardsSplit, type OwnerRunCards } from '../../src/catalog-hand.ts';
import { type CatalogCard, type CatalogDeck, type MilestoneRecord, type RunRecord } from '../../src/catalog-contracts.ts';
import type { WorkspaceSnapshot } from '../../src/workspace-contracts.ts';
import type { ProjectTag } from '../../src/project-tags.ts';
import { useCatalog } from '../useCatalog.ts';
import { buildCatalogLookups } from '../catalog-lookups.ts';
import { formatPlanningDate } from '../planning-metrics.ts';
import { navigateToPlanning } from '../planning-navigation.ts';
import { CatalogCardTile } from './CatalogCardTile.tsx';
import { CardOwnerAvatar } from './CardQuickSettings.tsx';
import { StatusBadge } from './StatusMenu.tsx';
import { CardTags, TagTitlePrefix } from './CardTags.tsx';
import { rememberMember, storedMemberId } from '../current-member.ts';
import type { ShortcutScreen } from '../keyboard-shortcuts.ts';
import { ShortcutsHelp } from './ShortcutsHelp.tsx';
import { navigateTabs } from '../tab-navigation.ts';
import { Button } from './ui/button.tsx';
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
  emptyHand: 'Empty. In Decks, drag a card onto the Hand tab or press H over a card.',
  totalEffort: 'Total Hand Effort',
  showAllTitle: 'Show every member’s Hand',
  allHands: 'All Hands',
  whoseHand: 'Whose Hand',
  handOf: (member: string) => `Hand: ${member}`,
  empty: 'Empty',
  loading: 'Loading Hand…',
  noMembersTitle: 'The team has no members yet',
  noMembersDescription: 'Add project members to give people and agents their own Hands.',
  openMembers: 'Members…',
  handSections: 'Hand sections',
  invalidMember: 'The member from the link is not on the team. The default Hand is shown.',
  card: 'Card',
  doneSummary: (count: number, effort: number, lastCount: number, lastEffort: number, total: number) => `This week: ${count.toLocaleString(locale())} ${new Intl.PluralRules(locale('en')).select(count) === 'one' ? 'card' : 'cards'} · Effort ${effort.toLocaleString(locale())}\nLast week: ${lastCount.toLocaleString(locale())} · ${lastEffort.toLocaleString(locale())}\nTotal in the pile: ${total.toLocaleString(locale())}`,
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
  openCard: (title: string) => `Open ${title}`,
}, {
  yourHand: 'Ваша рука',
  yourDueCards: 'Ваши карточки по срокам',
  yourRuns: 'Ваши Run',
  tabWithCount: (label: string, count: number) => {
    const rule = new Intl.PluralRules('ru-RU').select(count);
    return `${label}, ${count.toLocaleString(locale())} ${rule === 'one' ? 'карточка' : rule === 'few' ? 'карточки' : 'карточек'}`;
  },
  addToHand: 'В руку',
  removeFromHand: 'Убрать из руки',
  pinnedMilestone: 'Закреплённый Milestone',
  bookmarks: 'Закладки',
  teamHands: 'Руки команды',
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
  emptyHand: 'Пусто. В Decks перетащите карточку на вкладку Hand или нажмите H, наведя на карточку.',
  totalEffort: 'Суммарная оценка руки',
  showAllTitle: 'Показать руки всех участников',
  allHands: 'Все руки',
  whoseHand: 'Чья рука',
  handOf: (member: string) => `Рука: ${member}`,
  empty: 'Пусто',
  loading: 'Загружаем Hand…',
  noMembersTitle: 'Состав команды ещё не задан',
  noMembersDescription: 'Добавьте участников проекта, чтобы у людей и агентов появились свои Hand.',
  openMembers: 'Участники…',
  handSections: 'Разделы руки',
  invalidMember: 'Участник из ссылки отсутствует в составе команды. Показана рука по умолчанию.',
  card: 'Карточка',
  doneSummary: (count: number, effort: number, lastCount: number, lastEffort: number, total: number) => `Неделя: карточек ${count.toLocaleString(locale())} · оценка ${effort.toLocaleString(locale())}\nПрошлая неделя: ${lastCount.toLocaleString(locale())} · ${lastEffort.toLocaleString(locale())}\nВсего в стопке: ${total.toLocaleString(locale())}`,
  dragInstructions: 'Нажмите пробел, чтобы поднять карточку руки. Стрелки меняют позицию, пробел завершает перенос, Escape отменяет.',
  dragStart: (card: string) => `Поднята карточка «${card}».`,
  dragOver: (card: string, position: number, total: number) => `Карточка «${card}», позиция ${position.toLocaleString(locale())} из ${total.toLocaleString(locale())}.`,
  outsideHand: 'За пределами руки.',
  dragEnd: (card: string, position: number) => `Карточка «${card}» перемещена на позицию ${position.toLocaleString(locale())}.`,
  dragCancelled: 'Перенос отменён.',
  queue: (count: number) => `В очереди: ${count.toLocaleString(locale())}`,
  noDeck: 'Без колоды',
  moveInHand: (title: string) => `Переместить в руке: ${title}`,
  reorderTitle: 'Изменить порядок · Пробел и стрелки',
  noDueCards: 'У вас нет карточек со сроком.',
  openRunTimeline: (label: string) => `Открыть ${label} в Timeline`,
  noOwnedMilestone: 'Ваших карточек в этом Milestone нет.',
  openCard: (title: string) => `Открыть ${title}`,
});

const HAND_SLOT_COUNT = 7;
// 2026-11-06: a queue row's centre sits far from its handle; pointer drops must follow the slot under the handle.
const handCollisions: CollisionDetection = args => args.pointerCoordinates ? pointerWithin(args) : closestCenter(args);
// A 147px tile cannot preview its new position in a 30px queue row; across that boundary the target highlights in place.
const handSorting: SortingStrategy = args => {
  if ((args.activeIndex < HAND_SLOT_COUNT) !== (args.overIndex < HAND_SLOT_COUNT)) return null;
  return rectSortingStrategy(args);
};
/** Planning tabs collect the selected member's next actions. */
type HandTab = 'due' | 'runs' | 'milestone' | 'bookmarks' | 'team';
// Hand has no shortcuts of its own: the overview lists the app-wide ones.
const handShortcutScreens: readonly ShortcutScreen[] = ['app'];
// All Hands persists in localStorage and can be shared with ?hands=all.
const ALL_HANDS_STORAGE_KEY = 'deckmate-hand-all';

export function Hand({ snapshot, refreshKey, onOpenCard, onOpenMembers }: {
  snapshot: WorkspaceSnapshot;
  refreshKey: number;
  onOpenCard: (id: string) => void;
  /** 2026-11-06: the no-members empty state opens the same registry dialog as the app menu. */
  onOpenMembers: () => void;
}) {
  const { catalog, error, pending, edit } = useCatalog(snapshot, refreshKey);
  const handMutation = useRef(false);
  const t = useText(text);
  // The chosen hand is «me» for notifications and authorship (2026-11-04); a link with ?handMember= shows a hand without choosing it.
  const [requestedMember, setRequestedMember] = useState(() => new URLSearchParams(location.search).get('handMember') ?? storedMemberId() ?? '');
  // The URL overrides localStorage, so ?hands=all works even with empty storage.
  const [showAllHands, setShowAllHands] = useState(() => {
    if (new URLSearchParams(location.search).get('hands') === 'all') return true;
    try { return readStoredValue(localStorage, ALL_HANDS_STORAGE_KEY) === 'true'; } catch { return false; }
  });
  const [tab, setTab] = useState<HandTab>('bookmarks');
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
  // Hand slots reuse the deck's card tile; selection belongs to Decks, so no checkbox here.
  const tile = (card: CatalogCard) => lookups && <CatalogCardTile key={card.id} card={card} catalog={catalog ?? undefined} currentMemberId={selectedMember} lookups={lookups} members={members} tagDefinitions={catalog?.projectTags} selected={false} checked={false} selectionActive={false} disabled={pending} selectable={false} onOpen={() => onOpenCard(card.id)} onToggle={() => undefined} onFamilyOpen={family => onOpenCard(family.id)} />;
  const bookmarkedCards = useMemo(() => catalog ? catalog.cards.filter(card => card.bookmarked && !card.archived && !card.deleted) : [], [catalog]);
  // Planning sections use the selected member's due dates, current Runs and pinned Milestone.
  const today = localIsoDate();
  const dueSplit = catalog && activeHand ? splitDueCards(catalog.cards, activeHand.member, today) : null;
  const dueBadge = dueSplit ? dueBadgeOf(dueSplit) : null;
  const teamDueSplit = catalog ? splitDueCards(catalog.cards, null, today) : null;
  const shownDueSplit = showAllDue ? teamDueSplit : dueSplit;
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
  // Dragging is limited to a single hand in the test copy; All Hands remains an overview.
  const canReorder = writable && !showAllHands && !pending && Boolean(activeHand);
  const handControls: HandMembershipControls | undefined = activeHand ? {
    memberId: activeHand.member.id,
    disabled: !writable || pending || showAllHands,
    onToggle: card => void toggleHand(card),
  } : undefined;

  async function toggleHand(card: CatalogCard) {
    if (!catalog || !activeHand || !writable || pending || showAllHands || handMutation.current) return;
    handMutation.current = true;
    try {
      // 2026-11-05: personal queue membership is independent of Owner and planning assignments.
      await edit({ action: 'bulk-edit-cards', manifestHash: catalog.manifestHash, optionsHash: catalog.optionsHash ?? '',
        cards: [{ cardId: card.id, sourceHash: card.sourceHash }],
        change: { kind: 'hand', memberId: activeHand.member.id, mode: card.handMemberIds?.includes(activeHand.member.id) ? 'remove' : 'add' } });
    } finally { handMutation.current = false; }
  }

  function selectMember(memberId: string) {
    setRequestedMember(memberId);
    rememberMember(memberId);
    const url = new URL(location.href);
    url.searchParams.set('handMember', memberId);
    history.replaceState(null, '', url.pathname + '?' + url.searchParams.toString() + url.hash);
  }

  /** Timeline restores its selection from its existing storage key. */
  function openTimeline(target: PlanningTarget) {
    if (!catalog) return;
    navigateToPlanning(snapshot.source, catalog.rootIdentity, target);
  }

  function toggleAllHands(enabled: boolean) {
    setShowAllHands(enabled);
    try { localStorage.setItem(ALL_HANDS_STORAGE_KEY, enabled ? 'true' : 'false'); } catch { /* Without localStorage the mode lasts until reload. */ }
    const url = new URL(location.href);
    if (enabled) url.searchParams.set('hands', 'all'); else url.searchParams.delete('hands');
    history.replaceState(null, '', url.pathname + '?' + url.searchParams.toString() + url.hash);
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
        decksById={decksById} members={members} projectTags={catalog?.projectTags} onOpenCard={onOpenCard} />
    </div>;
    if (activeTab === 'runs' && runsByOwner) return <div className="hand-tab-panel" role="tabpanel" id="hand-tab-panel" tabIndex={0} aria-labelledby="hand-tab-runs">
      <HandRunsSection owned={runsByOwner.owned} withoutCards={runsByOwner.withoutCards}
        decksById={decksById} projectTags={catalog?.projectTags} onOpenTimeline={openTimeline} onOpenCard={onOpenCard} handControls={handControls} />
    </div>;
    if (activeTab === 'milestone' && pinnedMilestone) return <div className="hand-tab-panel" role="tabpanel" id="hand-tab-panel" tabIndex={0} aria-labelledby="hand-tab-milestone">
      <HandMilestoneSection milestone={pinnedMilestone} cards={milestoneOwnedCards}
        decksById={decksById} projectTags={catalog?.projectTags} onOpenTimeline={openTimeline} onOpenCard={onOpenCard} handControls={handControls} />
    </div>;
    if (activeTab === 'bookmarks') return <div className="hand-tab-panel" role="tabpanel" id="hand-tab-panel" tabIndex={0} aria-labelledby="hand-tab-bookmarks">
      {bookmarkedCards.length
        ? <div className="hand-bookmarks">{bookmarkedCards.map(tile)}</div>
        : <aside className="hand-tab-empty"><Bookmark size={20} aria-hidden="true" /><p>{t.noBookmarks}</p></aside>}
    </div>;
    return <div className="hand-tab-panel" role="tabpanel" id="hand-tab-panel" tabIndex={0} aria-labelledby="hand-tab-team">
      {hands.map(({ member, cards }) => <section className="hand-member" key={member.id} aria-labelledby={`hand-${member.id}`}>
        <header className="hand-member-heading"><CardOwnerAvatar owner={member.label} members={members} /><h2 id={`hand-${member.id}`}>{member.label}</h2><span className="hand-member-kind">{member.kind === 'agent' ? t.agent : t.human}</span><span className="hand-count" aria-label={t.cardCount(cards.length)}>{(cards.length).toLocaleString(locale())}</span></header>
        {!cards.length ? <p className="hand-empty">{t.emptyMemberHand}</p> : <div className="hand-cards">{cards.map(card => <HandMemberCard key={card.id} card={card} cardsById={cardsById} decksById={decksById} members={members} projectTags={catalog?.projectTags} onOpenCard={onOpenCard} />)}</div>}
      </section>)}
    </div>;
  }

  const activeSplit = activeHand ? splitHand(activeHand.cards) : null;
  const handEffort = (activeSplit?.openCards ?? []).reduce((total, card) => total + (card.effort ?? 0), 0);
  // All Hands follows registry order, humans before agents; stable sorting preserves ties.
  const orderedHands = useMemo(() => [...hands].sort((left, right) => (left.member.kind === 'human' ? 0 : 1) - (right.member.kind === 'human' ? 0 : 1)), [hands]);
  const panelHeader = <header className="hand-panel-header">
    <h1 className="hand-panel-title">{t.yourHand}</h1>
    {/* 2026-11-06: seven numbered slots alone do not say how a card gets here; the hint sits in the header row, so the slots
        do not jump when the first card arrives. */}
    {!showAllHands && writable && activeHand && !activeHand.cards.length && <p className="hand-empty">{t.emptyHand}</p>}
    {!showAllHands && handEffort > 0 && <span className="hand-panel-effort" title={t.totalEffort}><Gauge size={16} />{(handEffort).toLocaleString(locale())}</span>}
    <label className="hand-all-toggle" title={t.showAllTitle}>
      <input type="checkbox" role="switch" checked={showAllHands} onChange={event => toggleAllHands(event.target.checked)} aria-label={t.allHands} />
      <span className="hand-all-track" aria-hidden="true"><span className="hand-all-thumb" /></span>
      <span>{t.allHands}</span>
    </label>
    {!showAllHands && <label className="hand-member-picker"><span className="visually-hidden">{t.whoseHand}</span>
      <select value={selectedMember} onChange={event => selectMember(event.target.value)} aria-label={t.whoseHand} title={activeHand?.member.label}>{hands.map(({ member }) => <option key={member.id} value={member.id}>{member.label}</option>)}</select>
    </label>}
  </header>;
  const panelBody = showAllHands
    ? <div className="hand-all-list">
      {orderedHands.map(hand => {
        const { queuedCards } = splitHand(hand.cards);
        return <section className="hand-all-member" key={hand.member.id} aria-label={t.handOf(hand.member.label)}>
          <header className="hand-all-member-heading"><CardOwnerAvatar owner={hand.member.label} members={members} /><h2>{hand.member.label}</h2></header>
          {hand.cards.length ? <HandSlots hand={hand} tile={tile} canReorder={false} /> : <p className="hand-empty">{t.empty}</p>}
          <HandQueue cards={queuedCards} decksById={decksById} projectTags={catalog?.projectTags} canReorder={false} onOpenCard={onOpenCard} />
        </section>;
      })}
    </div>
    : activeHand && <HandSlots hand={activeHand} tile={tile} canReorder={canReorder} />;

  return <section className="hand-view">
    {error && <div className="error-banner" role="alert">{error}</div>}
    {!catalog && !error && <p className="hand-empty" role="status">{t.loading}</p>}
    {catalog && !hands.length && <div className="empty-state"><HandIcon size={26} /><h2>{t.noMembersTitle}</h2><p>{t.noMembersDescription}</p><Button variant="outline" onClick={onOpenMembers}><Users size={16} aria-hidden="true" />{t.openMembers}</Button></div>}
    {catalog && hands.length > 0 && <>
      {!showAllHands && activeHand
        ? <HandBoard hand={activeHand} canReorder={canReorder} decksById={decksById} projectTags={catalog.projectTags} onOpenCard={onOpenCard} onDragEnd={event => void finishHandDrag(event)}>
          <section className="hand-panel" aria-label={t.yourHand}>
            <HandPanelCorners />
            <div className="hand-panel-body">
              {panelHeader}
              {panelBody}
            </div>
          </section>
        </HandBoard>
        : <section className="hand-panel" aria-label={t.yourHand}>
            <HandPanelCorners />
            <div className="hand-panel-body">
              {panelHeader}
              {panelBody}
            </div>
          </section>}
      <div className="hand-tabs">
        <div className="hand-tab-list" role="tablist" aria-label={t.handSections} onKeyDown={navigateTabs}>
          {dueTabVisible && <button type="button" role="tab" id="hand-tab-due" aria-controls="hand-tab-panel" tabIndex={activeTab === 'due' ? 0 : -1} aria-selected={activeTab === 'due'} aria-label={t.tabWithCount(t.yourDueCards, dueBadge?.count ?? 0)} className={`hand-tab${activeTab === 'due' ? ' is-active' : ''}`} onClick={() => setTab('due')}>
            <span className={`hand-tab-count${dueBadge?.bucket ? ` is-due-${dueBadge.bucket}` : ''}`} aria-hidden="true">{(dueBadge?.count ?? 0).toLocaleString(locale())}</span>{t.yourDueCards}
          </button>}
          {runsTabVisible && <button type="button" role="tab" id="hand-tab-runs" aria-controls="hand-tab-panel" tabIndex={activeTab === 'runs' ? 0 : -1} aria-selected={activeTab === 'runs'} aria-label={t.tabWithCount(t.yourRuns, runsOwnedCardCount)} className={`hand-tab${activeTab === 'runs' ? ' is-active' : ''}`} onClick={() => setTab('runs')}>
            <span className="hand-tab-count" aria-hidden="true">{(runsOwnedCardCount).toLocaleString(locale())}</span>{t.yourRuns}
          </button>}
          {milestoneTabVisible && <button type="button" role="tab" id="hand-tab-milestone" aria-controls="hand-tab-panel" tabIndex={activeTab === 'milestone' ? 0 : -1} aria-selected={activeTab === 'milestone'} aria-label={t.tabWithCount(t.pinnedMilestone, milestoneOwnedCards.length)} className={`hand-tab${activeTab === 'milestone' ? ' is-active' : ''}`} onClick={() => setTab('milestone')}>
            <span className="hand-tab-count" aria-hidden="true">{(milestoneOwnedCards.length).toLocaleString(locale())}</span>{t.pinnedMilestone}
          </button>}
          <button type="button" role="tab" id="hand-tab-bookmarks" aria-controls="hand-tab-panel" tabIndex={activeTab === 'bookmarks' ? 0 : -1} aria-selected={activeTab === 'bookmarks'} aria-label={t.tabWithCount(t.bookmarks, bookmarkedCards.length)} className={`hand-tab${activeTab === 'bookmarks' ? ' is-active' : ''}`} onClick={() => setTab('bookmarks')}>
            <span className="hand-tab-count" aria-hidden="true">{(bookmarkedCards.length).toLocaleString(locale())}</span>{t.bookmarks}
          </button>
          <button type="button" role="tab" id="hand-tab-team" aria-controls="hand-tab-panel" tabIndex={activeTab === 'team' ? 0 : -1} aria-selected={activeTab === 'team'} className={`hand-tab${activeTab === 'team' ? ' is-active' : ''}`} onClick={() => setTab('team')}>
            <Users size={24} aria-hidden="true" />{t.teamHands}
          </button>
        </div>
        {activeTab === 'due' && <button type="button" className="hand-show-all" aria-pressed={showAllDue} onClick={() => setShowAllDue(enabled => !enabled)}>{t.showAll}</button>}
      </div>
      {renderTabPanel()}
      {requestedMember && !memberFromLinkIsValid && <p className="hand-empty" role="status">{t.invalidMember}</p>}
    </>}
    <ShortcutsHelp screens={handShortcutScreens} writable={writable} />
  </section>;
}

/** Exclude accepted cards while preserving hand order from Card Options slots. */
function splitHand(cards: CatalogCard[]) {
  const openCards = cards.filter(card => card.state !== 'done');
  return { openCards, slotCards: openCards.slice(0, HAND_SLOT_COUNT), queuedCards: openCards.slice(HAND_SLOT_COUNT) };
}

/** Decorative corner brackets frame the hand panel. */
function HandPanelCorners() {
  return <>{[['top', 'left'], ['top', 'right'], ['bottom', 'left'], ['bottom', 'right']].map(([side, edge]) => <svg key={side + edge} className={`hand-panel-corner hand-panel-corner-${side}-${edge}`} viewBox="0 0 16 16" aria-hidden="true"><path d={side === 'top' ? 'M1 15V7Q1 1 7 1H15' : 'M1 1V9Q1 15 7 15H15'} transform={edge === 'right' ? 'translate(16 0) scale(-1 1)' : undefined} fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>)}</>;
}

/** Show the whole pile's count beside Done Cards; the tooltip retains both ISO-week totals. */
function DoneSlot({ doneCards }: { doneCards: CatalogCard[] }) {
  const t = useText(text);
  const thisWeek = summarizeDoneWeek(doneCards, isoWeekStart());
  const lastWeek = summarizeDoneWeek(doneCards, isoWeekStart(-1));
  const title = t.doneSummary(thisWeek.count, thisWeek.effort, lastWeek.count, lastWeek.effort, doneCards.length);
  return <div className="hand-slot hand-slot-done" title={title}>
    <span className="hand-slot-done-chip"><Check size={24} aria-hidden="true" /></span>
    <span className="hand-slot-done-label">{t.doneCards}<span className="hand-slot-done-count">{(doneCards.length).toLocaleString(locale())}</span></span>
  </div>;
}

/** A single hand shares one drag zone across slots and queue; the panel is passed as children. */
function HandBoard({ hand, canReorder, decksById, projectTags, onOpenCard, onDragEnd, children }: {
  hand: CatalogHand;
  canReorder: boolean;
  decksById: Map<string, CatalogDeck>;
  projectTags?: readonly ProjectTag[];
  onOpenCard: (id: string) => void;
  onDragEnd: (event: DragEndEvent) => void;
  children: ReactNode;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const t = useText(text);
  const openIds = useMemo(() => splitHand(hand.cards).openCards.map(card => card.id), [hand.cards]);
  const cardName = (id: string | number) => hand.cards.find(card => card.id === id)?.title ?? t.card;
  const [queueDragTitle, setQueueDragTitle] = useState<string | null>(null);
  return <DndContext sensors={sensors} collisionDetection={handCollisions}
    onDragStart={({ active, activatorEvent }) => {
      // Keyboard coordinates need the full row geometry; only pointer drags use the compact preview.
      if (active.data.current?.surface === 'hand-queue' && activatorEvent.type !== 'keydown') setQueueDragTitle(cardName(active.id));
    }}
    onDragCancel={() => setQueueDragTitle(null)} onDragEnd={event => { setQueueDragTitle(null); onDragEnd(event); }} accessibility={{
    screenReaderInstructions: { draggable: t.dragInstructions },
    announcements: {
      onDragStart: ({ active }) => t.dragStart(cardName(active.id)),
      onDragOver: ({ active, over }) => over ? t.dragOver(cardName(active.id), openIds.indexOf(String(over.id)) + 1, openIds.length) : t.outsideHand,
      onDragEnd: ({ active, over }) => over ? t.dragEnd(cardName(active.id), openIds.indexOf(String(over.id)) + 1) : t.dragCancelled,
      onDragCancel: () => t.dragCancelled,
    },
  }}>
    <SortableContext items={openIds} strategy={handSorting}>
      {children}
      <HandQueue cards={splitHand(hand.cards).queuedCards} decksById={decksById} projectTags={projectTags} canReorder={canReorder} overlayActive={Boolean(queueDragTitle)} onOpenCard={onOpenCard} />
    </SortableContext>
    {queueDragTitle && <DragOverlay dropAnimation={null} adjustScale={false} style={{ pointerEvents: 'none', width: 'max-content', maxWidth: 'calc(100vw - 32px)' }}>
      <div className="card-transfer-overlay" aria-hidden="true"><GripVertical size={14} /><strong>{queueDragTitle}</strong></div>
    </DragOverlay>}
  </DndContext>;
}

/** The Done pile and seven numbered slots share a layout in single-hand and All Hands views. */
function HandSlots({ hand, tile, canReorder }: { hand: CatalogHand; tile: (card: CatalogCard) => ReactNode; canReorder: boolean }) {
  const { slotCards } = splitHand(hand.cards);
  return <div className="hand-slots">
    <DoneSlot doneCards={hand.doneCards} />
    {Array.from({ length: HAND_SLOT_COUNT }, (_, index) => {
      const card = slotCards[index];
      return card
        ? <HandSlotTile key={card.id} card={card} tile={tile} canReorder={canReorder} />
        : <div className="hand-slot" key={`slot-${index + 1}`}><span className="hand-slot-number">{index + 1}</span></div>;
    })}
  </div>;
}

/** The whole occupied slot is draggable; a click without movement opens the card. */
function HandSlotTile({ card, tile, canReorder }: { card: CatalogCard; tile: (card: CatalogCard) => ReactNode; canReorder: boolean }) {
  const sortable = useSortable({ id: card.id, disabled: !canReorder });
  const transform = sortable.transform ? `translate3d(${sortable.transform.x}px, ${sortable.transform.y}px, 0)` : undefined;
  function startPointerDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (!canReorder || event.defaultPrevented) return;
    // The tile face opens or drags the card; its other buttons keep their own actions.
    const control = (event.target as Element).closest('button, a, input, select, textarea, [role="button"]');
    if (control && !control.matches('.deck-card-open')) return;
    sortable.listeners?.onPointerDown?.(event);
  }
  return <div ref={sortable.setNodeRef} className={'hand-slot is-filled' + (sortable.isDragging ? ' is-drag-source' : '') + (sortable.isOver && !sortable.isDragging ? ' is-drop-target' : '')}
    style={{ transform, transition: sortable.transition }} onPointerDown={startPointerDrag}
    onKeyDown={canReorder ? event => sortable.listeners?.onKeyDown?.(event) : undefined}
    {...(canReorder ? sortable.attributes : {})}>{tile(card)}</div>;
}

/** Cards beyond the seven slots use queue drag handles; start them with the open card's play action or Space on a tile. */
function HandQueue({ cards, decksById, projectTags, canReorder, overlayActive, onOpenCard }: {
  cards: CatalogCard[];
  decksById: Map<string, CatalogDeck>;
  projectTags?: readonly ProjectTag[];
  canReorder: boolean;
  overlayActive?: boolean;
  onOpenCard: (id: string) => void;
}) {
  const t = useText(text);
  if (!cards.length) return null;
  return <div className={'hand-queue' + (overlayActive ? ' has-drag-overlay' : '')}>
    <strong>{t.queue(cards.length)}</strong>
    <ul>{cards.map(card => <HandQueueRow key={card.id} card={card} deckTitle={decksById.get(card.deckId ?? '')?.title ?? t.noDeck}
      projectTags={projectTags} canReorder={canReorder} onOpen={() => onOpenCard(card.id)} />)}</ul>
  </div>;
}

function HandQueueRow({ card, deckTitle, projectTags, canReorder, onOpen }: {
  card: CatalogCard;
  deckTitle: string;
  projectTags?: readonly ProjectTag[];
  canReorder: boolean;
  onOpen: () => void;
}) {
  const sortable = useSortable({ id: card.id, disabled: !canReorder, data: { surface: 'hand-queue' } });
  const t = useText(text);
  const transform = sortable.transform ? `translate3d(${sortable.transform.x}px, ${sortable.transform.y}px, 0)` : undefined;
  return <li ref={sortable.setNodeRef} className={(sortable.isDragging ? 'is-drag-source' : '') + (sortable.isOver && !sortable.isDragging ? ' is-drop-target' : '')} style={{ transform, transition: sortable.transition }}>
    {canReorder && <button type="button" ref={sortable.setActivatorNodeRef} className="hand-queue-handle" {...sortable.attributes} {...sortable.listeners}
      aria-label={t.moveInHand(card.title)} title={t.reorderTitle}><GripVertical size={14} /></button>}
    <button type="button" className="hand-queue-open" onClick={onOpen}><span title={card.title}><TagTitlePrefix tags={card.tags} definitions={projectTags} />{card.title}</span><CardTags tags={card.tags} definitions={projectTags} compact /><small title={deckTitle}>{deckTitle}</small></button>
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
function HandSectionRow({ card, deckTitle, dueBucket, owner, members, projectTags, onOpenCard, handControls }: {
  card: CatalogCard;
  deckTitle: string;
  dueBucket?: 'now' | 'soon' | 'later';
  /** Only Show all needs an owner avatar on each row. */
  owner?: string | null;
  members?: HandSectionMembers;
  projectTags?: readonly ProjectTag[];
  onOpenCard: (id: string) => void;
  handControls?: HandMembershipControls;
}) {
  const lang = useLang();
  const t = useText(text);
  const inHand = Boolean(handControls && card.handMemberIds?.includes(handControls.memberId));
  return <li className={handControls ? 'hand-planning-row' : undefined}>
    <button type="button" className="hand-section-row" onClick={() => onOpenCard(card.id)}>
      {owner !== undefined && members && <span className="hand-row-owner"><CardOwnerAvatar owner={owner} members={members} /></span>}
      <span className="hand-row-title" title={card.title}><TagTitlePrefix tags={card.tags} definitions={projectTags} />{card.title}</span>
      <CardTags tags={card.tags} definitions={projectTags} compact />
      {card.dueDate && <small className={'hand-row-due' + (dueBucket ? ` is-due-${dueBucket}` : '')}>{formatPlanningDate(card.dueDate, lang)}</small>}
      <small title={deckTitle}>{deckTitle}</small>
    </button>
    {handControls && <Button type="button" variant="ghost" size="sm" className="hand-membership-action" disabled={handControls.disabled} onClick={() => handControls.onToggle(card)}>{inHand ? t.removeFromHand : t.addToHand}</Button>}
  </li>;
}

/** Your due cards has up to three groups: Due now, Due soon and Due later; Show all includes the whole team. */
function HandDueSection({ split, showAll, decksById, members, projectTags, onOpenCard }: {
  split: DueCardsSplit;
  showAll: boolean;
  decksById: Map<string, CatalogDeck>;
  members: HandSectionMembers;
  projectTags?: readonly ProjectTag[];
  onOpenCard: (id: string) => void;
}) {
  const t = useText(text);
  const groups: Array<{ key: 'now' | 'soon' | 'later'; label: string }> = [
    { key: 'now', label: t.dueNow },
    { key: 'soon', label: t.dueSoon },
    { key: 'later', label: t.dueLater },
  ];
  return <section className="hand-section" aria-label={t.yourDueCards}>
    {dueBadgeOf(split).count === 0 && <p className="hand-empty">{t.noDueCards}</p>}
    {groups.map(group => split[group.key].length > 0 && (
      <div className="hand-group" key={group.key}>
        <h3 className={`hand-group-title is-due-${group.key}`}>{group.label}</h3>
        <ul className="hand-row-list">
          {split[group.key].map(card => <HandSectionRow key={card.id} card={card} dueBucket={group.key}
            deckTitle={decksById.get(card.deckId ?? '')?.title ?? t.noDeck}
            owner={showAll ? card.owner : undefined} members={members} projectTags={projectTags} onOpenCard={onOpenCard} />)}
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
  return <div className="hand-run">
    <header className="hand-run-head">
      <button type="button" className="hand-run-name" onClick={() => onOpenTimeline({ kind: 'run', id: run.id })} title={t.openRunTimeline(runLabel(run, lang))}>{runLabel(run, lang)}</button>
      <span className="hand-run-dates">{formatPlanningDate(run.start, lang)} — {formatPlanningDate(run.end, lang)}</span>
    </header>
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

/** Your Runs lists personal cards in current Runs; Runs without personal cards form the lower group. */
function HandRunsSection({ owned, withoutCards, decksById, projectTags, onOpenTimeline, onOpenCard, handControls }: {
  owned: OwnerRunCards[];
  withoutCards: RunRecord[];
  decksById: Map<string, CatalogDeck>;
  projectTags?: readonly ProjectTag[];
  onOpenTimeline: (target: PlanningTarget) => void;
  onOpenCard: (id: string) => void;
  handControls?: HandMembershipControls;
}) {
  const t = useText(text);
  return <section className="hand-section" aria-label={t.yourRuns}>
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
  return <section className="hand-section" aria-label={t.pinnedMilestone}>
    <div className="hand-section-toolbar">
      <h3 className="hand-milestone-title"><span>{milestone.title}</span><small>{formatPlanningDate(milestone.date, lang)}</small></h3>
      <button type="button" className="hand-show-all" onClick={() => onOpenTimeline({ kind: 'milestone', id: milestone.id })}>{t.seeFullMilestone}</button>
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
    {cards.length === 0 && <p className="hand-empty">{t.noOwnedMilestone}</p>}
  </section>;
}

/** Team Hands keeps the per-member list view of 2026-11-03. */
function HandMemberCard({ card, cardsById, decksById, members, projectTags, onOpenCard }: {
  card: CatalogCard;
  cardsById: Map<string, CatalogCard>;
  decksById: Map<string, CatalogDeck>;
  members: Parameters<typeof CardOwnerAvatar>[0]['members'];
  projectTags?: readonly ProjectTag[];
  onOpenCard: (id: string) => void;
}) {
  const t = useText(text);
  const lang = useLang();
  const parent = card.parentId ? cardsById.get(card.parentId) : undefined;
  const deck = card.deckId ? decksById.get(card.deckId) : undefined;
  return <div className={`sprint-task hand-card kind-${card.kind}`}>
    <button type="button" className="hand-card-open" onClick={() => onOpenCard(card.id)} aria-label={t.openCard(card.title)}>
      {parent && <span className="sprint-task-parent"><Crown size={12} /><span>{parent.title}</span></span>}
      <span className="sprint-task-body"><strong><TagTitlePrefix tags={card.tags} definitions={projectTags} />{card.title}</strong><small>{deck?.title ?? t.noDeck}</small>
        <CardTags tags={card.tags} definitions={projectTags} compact />
        {card.dueDate && <small>{t.due} · {formatPlanningDate(card.dueDate, lang)}</small>}
        <span className="sprint-task-owner"><CardOwnerAvatar owner={card.owner} members={members} /><span>{card.owner ?? t.unassigned}</span>{card.bookmarked && <Bookmark size={12} aria-label={t.bookmark} />}</span>
      </span>
    </button>
    <span className="sprint-task-band">
      {card.kind === 'task' ? <StatusBadge state={card.state ?? 'not-started'} /> : <span className="hand-card-kind">{card.kind === 'hero' ? <Crown size={12} /> : <FileText size={12} />}{card.kind === 'hero' ? kindLabel('hero', lang) : kindLabel('doc', lang)}</span>}
      {card.effort != null && <span className="sprint-task-effort" title={t.effort}><Gauge size={13} />{(card.effort).toLocaleString(locale())}</span>}<ArrowUpRight size={14} />
    </span>
  </div>;
}
