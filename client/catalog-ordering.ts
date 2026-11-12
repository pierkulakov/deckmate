import { boardColumns, type CatalogCard, type CatalogDeckManualOrder, type CardPriority, type MilestoneRecord, type RunRecord } from '../src/catalog-contracts.ts';
import { compareManualFallback, completeDeckManualOrder, effortValue } from '../src/catalog-manual-order.ts';
import { defineText, locale, textNow } from './i18n.ts';
import { priorityLabel, stateLabel } from './locales/common.ts';
import { runChoiceLabel } from './run-label.ts';

const text = defineText({
  heroes: 'Hero Cards', docs: 'Doc Cards', noPriority: 'No priority', noEffort: 'No effort',
  noState: 'No state', noRun: 'Not in Run', noMilestone: 'No milestone', noTags: 'Not tagged',
  noOwner: 'Unassigned', noHero: 'No Hero', noDeck: 'No deck', allCards: 'All Cards',
}, {
  heroes: 'Hero Cards', docs: 'Doc Cards', noPriority: 'Без приоритета', noEffort: 'Без оценки',
  noState: 'Без состояния', noRun: 'Без Run', noMilestone: 'Без Milestone', noTags: 'Без тегов',
  noOwner: 'Без исполнителя', noHero: 'Без Hero', noDeck: 'Без колоды', allCards: 'Все карточки',
});

/**
 * An order forms the swim lanes and its direction orders them;
 * Compact folds the lanes into one sorted lane; Multi Sort adds secondary orders that sort the cards inside a lane.
 * Remaining ties fall back to priority → effort → creation date (compareManualFallback).
 */
export type CardOrderKey = 'priority' | 'effort' | 'state' | 'run' | 'milestone' | 'tags' | 'owner' | 'hero' | 'deck' | 'updated' | 'created' | 'title' | 'manual';
export type SortDirection = 'asc' | 'desc';
/** Order by Tags reads project tags, user tags, or both. */
export type TagScope = 'project' | 'both' | 'personal';
export interface CardSortStep { order: CardOrderKey; direction: SortDirection }
export interface CardOrdering extends CardSortStep {
  /** Multi Sort: secondary orders by rank 2, 3…; empty while Multi Sort is off. */
  then: CardSortStep[];
  compact: boolean;
  tagScope: TagScope;
}

export interface CardGroup {
  key: string;
  title: string;
  state: string | null;
  cards: CatalogCard[];
}

/** Lookups the Tags/Deck/Run/Milestone/Manual orders need; optional so plain callers keep the short signature. */
export interface OrderingContext {
  deckById?: ReadonlyMap<string, { title: string }>;
  deckOrder?: Record<string, CatalogDeckManualOrder>;
  deckId?: string | null;
  runs?: readonly RunRecord[];
  milestones?: readonly MilestoneRecord[];
  projectTagNames?: ReadonlySet<string>;
}

const cardOrderKeys: readonly CardOrderKey[] = ['priority', 'effort', 'state', 'run', 'milestone', 'tags', 'owner', 'hero', 'deck', 'updated', 'created', 'title', 'manual'];
// Orders with lanes; Last updated, Creation date and Title only sort one lane.
const laneOrders: ReadonlySet<CardOrderKey> = new Set(['priority', 'effort', 'state', 'run', 'milestone', 'tags', 'owner', 'hero', 'deck']);
export const defaultCardOrdering: Readonly<CardOrdering> = Object.freeze({ order: 'priority', direction: 'desc', then: [], compact: false, tagScope: 'both' });

export function cardOrdering(order: CardOrderKey, direction: SortDirection): CardOrdering {
  return { ...defaultCardOrdering, then: [], order, direction };
}

function orderHasLanes(order: CardOrderKey): boolean {
  return laneOrders.has(order);
}

/** Multi Sort never combines Manual with other orders; Tags and Hero Card cannot be secondary. */
export function canBeSecondary(order: CardOrderKey): boolean {
  return order !== 'manual' && order !== 'tags' && order !== 'hero';
}

/** Compact has no effect on Manual zones, Tags, or orders without lanes. */
export function canCompact(order: CardOrderKey): boolean {
  return orderHasLanes(order) && order !== 'tags';
}

/** The lanes on screen: drops into them change this property; null — one lane. */
export function laneOrderOf(ordering: CardOrdering): CardOrderKey | null {
  if (ordering.order === 'manual') return 'manual';
  if (!orderHasLanes(ordering.order) || (ordering.compact && canCompact(ordering.order))) return null;
  return ordering.order;
}

const priorityValues: Record<CardPriority, number> = { low: 1, medium: 2, high: 3 };
const titleCollator = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });
const stateOrder = new Map<string, number>(boardColumns.map((column, index) => [column.id, index]));

function compareIdentifiers(first: string, second: string): number {
  if (first === second) return 0;
  return first < second ? -1 : 1;
}

/** The first tag in the chosen scope is the sort/lane key; a card appears in only one tag lane. */
function firstCardTag(card: CatalogCard, scope: TagScope = 'both', projectTagNames?: ReadonlySet<string>): string | null {
  const tags = (card.tags ?? []).filter(tag => tag.trim() && (scope === 'both' || (projectTagNames?.has(tag) ?? false) === (scope === 'project')));
  if (tags.length === 0) return null;
  return tags.slice().sort((first, second) => titleCollator.compare(first, second) || compareIdentifiers(first, second))[0];
}

function dateValue(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Where one card stands in one order: its lane identity and the value the direction compares; null value — always last. */
interface OrderPosition { key: string; title: string; state: string | null; value: number | string | null; tail: number }

interface SortLookups {
  cardById: ReadonlyMap<string, CatalogCard>;
  context: OrderingContext | undefined;
  runById: ReadonlyMap<string, RunRecord>;
  milestoneById: ReadonlyMap<string, MilestoneRecord>;
  tagScope: TagScope;
}

// Hero and Doc cards have no priority or state, so they get lanes of their own in both directions. 2026-11-09: Hero
// Cards lead the deck — they are what the Task lanes below work towards; Doc Cards stay after "No …".
function nonTaskPosition(card: CatalogCard): OrderPosition {
  if (card.kind === 'hero') return { key: 'kind:hero', title: textNow(text).heroes, state: null, value: null, tail: -1 };
  return { key: 'kind:doc', title: textNow(text).docs, state: null, value: null, tail: 2 };
}

function missing(key: string, title: string): OrderPosition {
  return { key, title, state: null, value: null, tail: 0 };
}

function positionOf(card: CatalogCard, order: CardOrderKey, lookups: SortLookups): OrderPosition {
  const t = textNow(text);
  switch (order) {
    case 'priority': {
      if (card.kind !== 'task') return nonTaskPosition(card);
      if (!card.priority || !(card.priority in priorityValues)) return missing('priority:none', t.noPriority);
      return { key: 'priority:' + card.priority, title: priorityLabel(card.priority), state: null, value: priorityValues[card.priority], tail: 0 };
    }
    case 'effort': {
      const effort = effortValue(card);
      return effort === null ? missing('effort:none', t.noEffort) : { key: 'effort:' + effort, title: new Intl.NumberFormat(locale(), { maximumFractionDigits: 20 }).format(effort), state: null, value: effort, tail: 0 };
    }
    case 'state': {
      if (card.kind !== 'task') return nonTaskPosition(card);
      if (!card.state) return missing('state:none', t.noState);
      // States outside the board keep their own lane after the known ones; their titles break the tie.
      return { key: 'state:' + card.state, title: stateLabel(card.state), state: card.state, value: stateOrder.get(card.state) ?? boardColumns.length, tail: 0 };
    }
    case 'run': {
      if (!card.run) return missing('run:none', t.noRun);
      const run = lookups.runById.get(card.run);
      return { key: 'run:' + card.run, title: run ? runChoiceLabel(run) : 'Run ' + card.run, state: null, value: run?.number ?? null, tail: 0 };
    }
    case 'milestone': {
      if (!card.milestone) return missing('milestone:none', t.noMilestone);
      const milestone = lookups.milestoneById.get(card.milestone);
      return { key: 'milestone:' + card.milestone, title: milestone?.title ?? card.milestone, state: null, value: dateValue(milestone?.date), tail: 0 };
    }
    case 'tags': {
      const tag = firstCardTag(card, lookups.tagScope, lookups.context?.projectTagNames);
      return tag === null ? missing('tags:none', t.noTags) : { key: 'tags:' + tag, title: tag, state: null, value: tag, tail: 0 };
    }
    case 'owner':
      return card.owner?.trim() ? { key: 'owner:' + card.owner, title: card.owner, state: null, value: card.owner, tail: 0 } : missing('owner:none', t.noOwner);
    case 'hero': {
      const hero = card.kind === 'hero' ? card : lookups.cardById.get(card.parentId ?? '');
      return hero?.kind === 'hero' ? { key: 'hero:' + hero.id, title: hero.title, state: null, value: hero.title, tail: 0 } : missing('hero:none', t.noHero);
    }
    case 'deck': {
      if (!card.deckId) return missing('deck:none', t.noDeck);
      const title = lookups.context?.deckById?.get(card.deckId)?.title ?? card.deckId;
      return { key: 'deck:' + card.deckId, title, state: null, value: title, tail: 0 };
    }
    case 'updated': return { key: 'all', title: t.allCards, state: null, value: dateValue(card.updatedAt), tail: 0 };
    case 'created': return { key: 'all', title: t.allCards, state: null, value: dateValue(card.createdAt), tail: 0 };
    case 'title': return { key: 'all', title: t.allCards, state: null, value: card.title, tail: 0 };
    case 'manual': return missing('all', t.allCards);
  }
}

// 2026-11-03: reversing an order must not make missing estimates or priorities look most important — no value stays last.
function comparePositions(first: OrderPosition, second: OrderPosition, direction: SortDirection): number {
  if (first.tail !== second.tail) return first.tail - second.tail;
  if (first.value === null || second.value === null) {
    if (first.value === second.value) return 0;
    return first.value === null ? 1 : -1;
  }
  const sign = direction === 'asc' ? 1 : -1;
  if (typeof first.value === 'number' && typeof second.value === 'number') return (first.value - second.value) * sign;
  return titleCollator.compare(String(first.value), String(second.value)) * sign;
}

function compareCards(first: CatalogCard, second: CatalogCard, steps: readonly CardSortStep[], lookups: SortLookups): number {
  for (const step of steps) {
    const result = comparePositions(positionOf(first, step.order, lookups), positionOf(second, step.order, lookups), step.direction);
    if (result !== 0) return result;
  }
  return compareManualFallback(first, second);
}

/** Zones of the context deck become the lanes; cards without a stored position join the first zone's tail. */
function manualGroupAndSort(cards: readonly CatalogCard[], context: OrderingContext | undefined): CardGroup[] {
  const stored = context?.deckId ? context.deckOrder?.[context.deckId] : undefined;
  const order = completeDeckManualOrder(cards, stored ?? { flatOrder: [] });
  const zones = order.zones ?? [];
  if (zones.length === 0) {
    const position = new Map((order.flatOrder ?? []).map((cardId, index) => [cardId, index]));
    return [{ key: 'all', title: textNow(text).allCards, state: null,
      cards: [...cards].sort((first, second) => (position.get(first.id) ?? 0) - (position.get(second.id) ?? 0)) }];
  }
  // Every zone renders, even empty ones; "Hide empty" changes the view without changing storage.
  const groups: CardGroup[] = zones.map(zone => ({ key: 'zone:' + zone.id, title: zone.title, state: null, cards: [] }));
  const byKey = new Map(groups.map(group => [group.key, group]));
  const cardById = new Map(cards.map(card => [card.id, card]));
  for (const zone of zones) {
    const group = byKey.get('zone:' + zone.id)!;
    for (const cardId of order.zoneOrder?.[zone.id] ?? []) {
      const card = cardById.get(cardId);
      if (card) group.cards.push(card);
    }
  }
  return groups;
}

/** Groups only the supplied visible cards; the complete lookup resolves cross-deck Hero names. */
export function groupAndSortCards(cards: readonly CatalogCard[], cardById: ReadonlyMap<string, CatalogCard>, ordering: CardOrdering, context?: OrderingContext): CardGroup[] {
  if (ordering.order === 'manual') return manualGroupAndSort(cards, context);
  const lookups: SortLookups = { cardById, context, tagScope: ordering.tagScope,
    runById: new Map((context?.runs ?? []).map(run => [run.id, run])),
    milestoneById: new Map((context?.milestones ?? []).map(milestone => [milestone.id, milestone])) };
  const secondary = ordering.then.filter(step => canBeSecondary(step.order) && step.order !== ordering.order);
  const lanes = laneOrderOf(ordering);
  if (lanes === null) {
    if (cards.length === 0) return [];
    const steps = [{ order: ordering.order, direction: ordering.direction }, ...secondary];
    return [{ key: 'all', title: textNow(text).allCards, state: null, cards: [...cards].sort((first, second) => compareCards(first, second, steps, lookups)) }];
  }
  const groups = new Map<string, { position: OrderPosition; cards: CatalogCard[] }>();
  for (const card of cards) {
    const position = positionOf(card, lanes, lookups);
    let group = groups.get(position.key);
    if (!group) {
      group = { position, cards: [] };
      groups.set(position.key, group);
    }
    group.cards.push(card);
  }
  return [...groups.values()].sort((first, second) => comparePositions(first.position, second.position, ordering.direction)
    || titleCollator.compare(first.position.title, second.position.title)
    || compareIdentifiers(first.position.key, second.position.key))
    .map(({ position, cards: laneCards }) => ({ key: position.key, title: position.title, state: position.state,
      cards: laneCards.sort((first, second) => compareCards(first, second, secondary, lookups)) }));
}

function isOrderKey(value: string | null | undefined): value is CardOrderKey {
  return cardOrderKeys.includes(value as CardOrderKey);
}

function readDirection(value: string | null | undefined): SortDirection | null {
  return value === 'asc' || value === 'desc' ? value : null;
}

/** URL and Default Order share one form: order=state&direction=asc&then=effort.desc&compact=1&tags=project. */
export function readOrdering(query: URLSearchParams): CardOrdering {
  const order = query.get('order');
  if (!isOrderKey(order)) return { ...defaultCardOrdering, then: [] };
  const then: CardSortStep[] = [];
  for (const entry of (query.get('then') ?? '').split(',')) {
    const [stepOrder, stepDirection] = entry.split('.');
    const direction = readDirection(stepDirection);
    if (isOrderKey(stepOrder) && direction && canBeSecondary(stepOrder) && stepOrder !== order && !then.some(step => step.order === stepOrder)) then.push({ order: stepOrder, direction });
  }
  const tags = query.get('tags');
  return {
    order,
    direction: readDirection(query.get('direction')) ?? defaultCardOrdering.direction,
    then: order === 'manual' ? [] : then,
    // The switch keeps its state across orders; orders that cannot fold simply ignore it (laneOrderOf).
    compact: query.get('compact') === '1',
    tagScope: tags === 'project' || tags === 'personal' ? tags : 'both',
  };
}

/** Returns a copy so callers can update routing without mutating their previous location snapshot. */
export function writeOrdering(query: URLSearchParams, ordering: CardOrdering): URLSearchParams {
  const result = new URLSearchParams(query);
  for (const key of ['order', 'direction', 'then', 'compact', 'tags']) result.delete(key);
  if (sameOrdering(ordering, defaultCardOrdering)) return result;
  result.set('order', ordering.order);
  result.set('direction', ordering.direction);
  if (ordering.then.length) result.set('then', ordering.then.map(step => step.order + '.' + step.direction).join(','));
  if (ordering.compact) result.set('compact', '1');
  if (ordering.order === 'tags' && ordering.tagScope !== 'both') result.set('tags', ordering.tagScope);
  return result;
}

/** One text form for storage (Default Order, browser memory); the default ordering is the empty string. */
export function serializeOrdering(ordering: CardOrdering): string {
  return writeOrdering(new URLSearchParams(), ordering).toString();
}

export function sameOrdering(first: CardOrdering, second: CardOrdering): boolean {
  return first.order === second.order && first.direction === second.direction && first.compact === second.compact
    && (first.order !== 'tags' || first.tagScope === second.tagScope)
    && first.then.length === second.then.length && first.then.every((step, index) => step.order === second.then[index].order && step.direction === second.then[index].direction);
}
