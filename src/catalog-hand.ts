import type { CardOptions } from './bulk-contracts.ts';
import type { CatalogCard, CatalogMember, MilestoneRecord, ProjectCatalog, RunRecord } from './catalog-contracts.ts';
import { defaultLang, defineText, type Lang } from './i18n.ts';
import type { CardState } from './format-vocabulary.ts';

const text = defineText({
  memberRequired: 'Choose a Hand member.',
  ambiguousMember: (members: string) => `Ambiguous Hand member: ${members}.`,
  memberNotFound: (query: string) => `Hand member “${query}” is not on the team.`,
}, {
  memberRequired: 'Укажите участника Hand.',
  ambiguousMember: (members: string) => `Неоднозначный участник Hand: ${members}.`,
  memberNotFound: (query: string) => `Участник Hand «${query}» не найден в составе команды.`,
});

/** A member's queue: open cards in Hand order and a Done pile selected by Owner. */
export interface CatalogHand { member: CatalogMember; cards: CatalogCard[]; doneCards: CatalogCard[] }

export function isActiveCatalogCard(card: Pick<CatalogCard, 'archived' | 'deleted'>): boolean {
  return !card.archived && !card.deleted;
}

/** Match owners by member label or alias, using the same normalization as the Hand registry. */
export function isOwnedByMember(owner: string | null | undefined, member: CatalogMember): boolean {
  if (!owner) return false;
  const normalized = owner.trim().toLocaleLowerCase('ru-RU');
  return [member.label, ...member.aliases].some(name => name.trim().toLocaleLowerCase('ru-RU') === normalized);
}

/** Cards without a Hand slot sort last, preserving catalog order. */
function handSlot(card: CatalogCard, memberId: string): number {
  const slot = card.handOrder?.[memberId];
  return Number.isInteger(slot) && slot !== undefined && slot >= 0 ? slot : Number.MAX_SAFE_INTEGER;
}

/** 2026-11-03: Hand membership is explicit; Owner never supplies a personal queue. */
export function getCatalogHands(catalog: Pick<ProjectCatalog, 'cards' | 'members'>): CatalogHand[] {
  const hands = (catalog.members ?? []).map(member => ({ member, cards: [] as CatalogCard[], doneCards: [] as CatalogCard[] }));
  const byMember = new Map(hands.map(hand => [hand.member.id, hand]));
  const seen = new Set<string>();
  for (const card of catalog.cards) {
    if (!isActiveCatalogCard(card) || seen.has(card.id)) continue;
    seen.add(card.id);
    for (const memberId of new Set(card.handMemberIds ?? [])) byMember.get(memberId)?.cards.push(card);
    // Completed cards enter their owner's Done pile even when absent from that owner's Hand.
    if (card.state === 'done' && card.owner) {
      for (const hand of hands) if (isOwnedByMember(card.owner, hand.member)) hand.doneCards.push(card);
    }
  }
  for (const hand of hands) hand.cards.sort((left, right) => handSlot(left, hand.member.id) - handSlot(right, hand.member.id));
  return hands;
}

export function selectCatalogHand(hands: CatalogHand[], requested: string, lang: Lang = defaultLang): CatalogHand {
  const query = requested.trim();
  if (!query) throw new Error(text[lang].memberRequired);
  const exact = hands.find(hand => hand.member.id === query);
  if (exact) return exact;
  const normalized = query.toLocaleLowerCase('ru-RU');
  const matches = hands.filter(({ member }) => [member.label, ...member.aliases].some(name => name.trim().toLocaleLowerCase('ru-RU') === normalized));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new Error(text[lang].ambiguousMember(matches.map(hand => hand.member.id).join(', ')));
  throw new Error(text[lang].memberNotFound(query));
}

const formattedDate = (date: Date): string => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** Monday of an ISO week as YYYY-MM-DD; offsetWeeks counts weeks back. */
export function isoWeekStart(offsetWeeks = 0, today = new Date()): string {
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7) - offsetWeeks * 7);
  return formattedDate(monday);
}

/** Local date as YYYY-MM-DD, used as the reference date for Hand sections. */
export function localIsoDate(date = new Date()): string {
  return formattedDate(date);
}

/* Your due cards, Your Runs, and Pinned Milestone help members choose their next task. */

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/u;

/** 2026-11-05: Due soon ends on the fifth workday after the reference date, excluding the following weekend. */
function fifthWorkdayAfter(from: string): string {
  const cursor = new Date(from + 'T00:00:00');
  let count = 0;
  while (count < 5) {
    cursor.setDate(cursor.getDate() + 1);
    const weekday = cursor.getDay();
    if (weekday !== 0 && weekday !== 6) count += 1;
  }
  return formattedDate(cursor);
}

export type DueBucket = 'now' | 'soon' | 'later';
export interface DueCardsSplit { now: CatalogCard[]; soon: CatalogCard[]; later: CatalogCard[] }

/**
 * Red means due on or before the reference date; Yellow covers the next five workdays; the rest are Due later.
 * Exclude completed, archived, and deleted cards; sort by due date ascending.
 * member === null means Show all: include the whole team regardless of owner.
 */
export function splitDueCards(cards: readonly CatalogCard[], member: CatalogMember | null, today: string): DueCardsSplit {
  const split: DueCardsSplit = { now: [], soon: [], later: [] };
  const soonThrough = fifthWorkdayAfter(today);
  for (const card of cards) {
    const due = card.dueDate;
    if (!isActiveCatalogCard(card) || card.state === 'done' || !due || !isoDatePattern.test(due)) continue;
    if (member && !isOwnedByMember(card.owner, member)) continue;
    let bucket: DueBucket = 'later';
    if (due <= today) bucket = 'now';
    else if (due <= soonThrough) bucket = 'soon';
    split[bucket].push(card);
  }
  const byDueThenTitle = (left: CatalogCard, right: CatalogCard) =>
    (left.dueDate ?? '').localeCompare(right.dueDate ?? '') || left.title.localeCompare(right.title, 'ru');
  for (const bucket of ['now', 'soon', 'later'] as const) split[bucket].sort(byDueThenTitle);
  return split;
}

export interface DueBadge { bucket: DueBucket | null; count: number }

/** The tab badge shows the most urgent bucket's color and card count. */
export function dueBadgeOf(split: DueCardsSplit): DueBadge {
  for (const bucket of ['now', 'soon', 'later'] as const) {
    if (split[bucket].length > 0) return { bucket, count: split[bucket].length };
  }
  return { bucket: null, count: 0 };
}

export interface OwnerRunCards { run: RunRecord; cards: CatalogCard[] }

/**
 * Include the owner's cards in Runs whose start/end dates contain the reference date.
 * Runs with the owner's cards form the upper group; the rest form the lower group.
 * Both groups sort by end date ascending, matching Run rollover boundaries in server/runs.ts.
 */
export function currentRunsByOwner(runs: readonly RunRecord[] | undefined, cards: readonly CatalogCard[], member: CatalogMember, today: string): { owned: OwnerRunCards[]; withoutCards: RunRecord[] } {
  const current = (runs ?? []).filter(run => !run.finishedAt && isoDatePattern.test(run.start) && isoDatePattern.test(run.end) && run.start <= today && today <= run.end);
  const owned: OwnerRunCards[] = [];
  const withoutCards: RunRecord[] = [];
  for (const run of current) {
    const runCards = cards.filter(card => card.run === run.id && isActiveCatalogCard(card) && isOwnedByMember(card.owner, member));
    if (runCards.length > 0) owned.push({ run, cards: runCards });
    else withoutCards.push(run);
  }
  const byEnd = (left: RunRecord, right: RunRecord) => left.end.localeCompare(right.end) || left.number - right.number;
  owned.sort((left, right) => byEnd(left.run, right.run));
  withoutCards.sort(byEnd);
  return { owned, withoutCards };
}

/** Read the pin from the manifest; a cleared or stale pin hides the section. */
export function pinnedMilestoneOf(catalog: Pick<ProjectCatalog, 'milestones' | 'pinnedMilestoneId'>): MilestoneRecord | null {
  const id = catalog.pinnedMilestoneId ?? null;
  if (!id) return null;
  return catalog.milestones?.find(milestone => milestone.id === id) ?? null;
}

/** Pinned Milestone includes every card in that milestone assigned to the member. */
export function ownerCardsOfMilestone(cards: readonly CatalogCard[], member: CatalogMember, milestoneId: string): CatalogCard[] {
  return cards.filter(card => card.milestone === milestoneId && isActiveCatalogCard(card) && isOwnedByMember(card.owner, member));
}

export interface CardStateGroup { key: string; cards: CatalogCard[] }

const stateFlowOrder: readonly ('inbox' | CardState)[] = ['inbox', 'not-started', 'discussing', 'in-iteration', 'started', 'review', 'done'];

/**
 * Runs have no zones, so group Run and Milestone cards by workflow state, from planned through accepted.
 * Hero and Doc cards form separate groups, matching state grouping in PlanningScope.
 */
export function groupCardsByStateFlow(cards: readonly CatalogCard[]): CardStateGroup[] {
  const rank = new Map<string, number>();
  stateFlowOrder.forEach((state, index) => rank.set(state, index));
  rank.set('hero', stateFlowOrder.length);
  rank.set('doc', stateFlowOrder.length + 1);
  const groups = new Map<string, CatalogCard[]>();
  for (const card of cards) {
    const key = card.kind === 'task' ? card.state ?? 'not-started' : card.kind;
    groups.set(key, [...groups.get(key) ?? [], card]);
  }
  return [...groups.entries()]
    .map(([key, groupCards]) => ({ key, cards: groupCards, order: rank.get(key) ?? Number.MAX_SAFE_INTEGER }))
    .sort((left, right) => left.order - right.order)
    .map(({ key, cards: groupCards }) => ({ key, cards: groupCards }));
}

function weekEnd(weekStart: string): string {
  const date = new Date(weekStart + 'T00:00:00');
  date.setDate(date.getDate() + 7);
  return formattedDate(date);
}

export interface DoneWeekSummary { count: number; effort: number }

/** Done pile week badge: count cards and sum Effort for doneAt within [weekStart, weekStart + 7 days). */
export function summarizeDoneWeek(cards: readonly CatalogCard[], weekStart: string): DoneWeekSummary {
  const end = weekEnd(weekStart);
  let count = 0;
  let effort = 0;
  for (const card of cards) {
    const doneAt = card.doneAt;
    if (!doneAt || doneAt < weekStart || doneAt >= end) continue;
    count += 1;
    effort += card.effort ?? 0;
  }
  return { count, effort };
}

/** Small, explicit metadata projection for agent summaries; never include the Markdown body. */
export function cardPlanningOptions(card: CardOptions): CardOptions {
  const options: CardOptions = {};
  if (card.handMemberIds?.length) options.handMemberIds = [...card.handMemberIds];
  if (card.tags?.length) options.tags = [...card.tags];
  for (const key of ['bookmarked', 'archived', 'deleted'] as const) if (card[key]) options[key] = true;
  for (const key of ['run', 'milestone', 'dueDate'] as const) if (card[key] != null) options[key] = card[key];
  if (card.kindOverride) options.kindOverride = card.kindOverride;
  return options;
}
