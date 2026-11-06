// Global search syntax (2026-11-05):
// words, #tags (`#a|#b` — OR), @owners (+ `@none`), !exclusions, deck:/kind:/state: filters,
// property filters effort:/priority:/run:/milestone:/hand:/due:, content scopes t:/sub:, and navigation tokens $ID / gd: / gc:.
// Pure matching lives here; overlay UI, filter pills and keyboard handling stay in GlobalSearch.tsx.
import { resolveReference } from '../src/references.ts';
import { boardColumns, type CardKind, type CardPriority, type CatalogCard, type CatalogDeck, type CatalogMember, type CatalogView, type MilestoneRecord, type RunRecord } from '../src/catalog-contracts.ts';
import type { SliceStatus } from '../src/workspace-contracts.ts';
import { defineText, textNow } from './i18n.ts';
import { cardStateWords, readCardState } from '../src/format-vocabulary.ts';

const text = defineText({
  ambiguousReference: 'The short reference is ambiguous. Use the full ID.',
}, {
  ambiguousReference: 'Короткая ссылка неоднозначна. Используйте полный ID.',
});

export const RESULT_LIMIT = 50;
// Limit navigation suggestions at the top to five so they remain shortcuts rather than a second result list.
const NAVIGATION_LIMIT = 5;

const searchKinds: CardKind[] = ['hero', 'task', 'doc'];
// Six card states match the board columns except Inbox, as accepted by set-card-state.
const cardStates = boardColumns.filter(column => column.id !== 'inbox').map(column => column.id) as readonly SliceStatus[];
// The `archived` state includes archived cards; `deleted` includes Trash.
// Since 2026-11-04 search replaces the deck's Archive/Trash switch as the entry point for both.
const shelfStates = ['archived', 'deleted'] as const;
// Numeric priority ranks support ranges such as priority:high+ and priority:low-.
const priorityRank: Record<CardPriority, number> = { high: 3, medium: 2, low: 1 };

interface CachedText {
  sourceHash: string;
  title: string;
  markdown: string;
  normalized: string;
}

// 2026-11-05: card objects scope the cache to a snapshot/project and let removed revisions be collected.
// Check the content too: an optimistic title edit can retain the source file's hash.
const textByCard = new WeakMap<CatalogCard, CachedText>();

function searchText(card: CatalogCard): string {
  const cached = textByCard.get(card);
  if (cached && cached.sourceHash === card.sourceHash && cached.title === card.title && cached.markdown === card.markdown) {
    return cached.normalized;
  }
  const normalized = (card.title + ' ' + card.markdown).toLocaleLowerCase('ru');
  textByCard.set(card, { sourceHash: card.sourceHash, title: card.title, markdown: card.markdown, normalized });
  return normalized;
}

function shelfOf(card: CatalogCard): string | null {
  if (card.deleted) return 'deleted';
  return card.archived ? 'archived' : null;
}

function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function plusDays(iso: string, days: number): string {
  const date = new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)) + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Match an owner by the stored label or by a member ID/alias that resolves to that label. */
function ownerMatches(owner: string | null, term: string, members: CatalogMember[]): boolean {
  if (!owner) return false;
  if (owner.toLocaleLowerCase('ru').includes(term)) return true;
  return members.some(member => member.label === owner
    && [member.id, member.label, ...member.aliases].some(alias => alias.toLocaleLowerCase('ru').includes(term)));
}

/** Search navigation target: an exact card, a deck title prefix, or an ambiguous short reference. */
export type NavigationTarget =
  | { kind: 'card'; card: CatalogCard }
  | { kind: 'deck'; deck: CatalogDeck }
  | { kind: 'ambiguous'; message: string };

export interface SearchOutcome {
  navigation: NavigationTarget[];
  cards: CatalogCard[];
  total: number;
}

type NavKind = 'card-ref' | 'deck' | 'card-title';
type FilterKind = 'word' | 'title' | 'tag' | 'owner' | 'deck' | 'kind' | 'state' | 'effort' | 'priority' | 'run' | 'milestone' | 'hand' | 'due' | 'sub';

/** Source position lets a filter pill remove the whole token, including its '!'. */
interface TokenSpan {
  start: number;
  end: number;
  /** Preserve the typed token for pills and query reconstruction. */
  raw: string;
}

export interface NavToken extends TokenSpan {
  kind: 'nav';
  navKind: NavKind;
  term: string;
}

/** One query filter; `value` is the lowercase text after its prefix. */
export interface FilterToken extends TokenSpan {
  kind: FilterKind;
  value: string;
  /** `#a|#b` groups alternatives into one token for the tag OR toggle. */
  alternatives?: string[];
  /** `@none` matches cards with no owner. */
  none?: boolean;
  /** A leading `!` negates the filter. */
  negated: boolean;
}

export type SearchToken = NavToken | FilterToken;

const valueFilters = new Map<string, FilterKind>([
  ['deck', 'deck'], ['kind', 'kind'], ['state', 'state'], ['effort', 'effort'], ['priority', 'priority'],
  ['run', 'run'], ['milestone', 'milestone'], ['hand', 'hand'], ['due', 'due'], ['sub', 'sub'], ['t', 'title'],
]);

/**
 * Parse tokens with source positions. `$`, `gd:`, and `gc:` navigate; `#`, `@`, `t:`, and `<filter>:` filter.
 * A leading `!` negates any filter. Prefixes with empty values (`#`, `deck:`) do not become tokens.
 */
export function parseSearch(raw: string): SearchToken[] {
  const tokens: SearchToken[] = [];
  for (const match of raw.matchAll(/\S+/gu)) {
    const rawToken = match[0];
    const start = match.index;
    const span: TokenSpan = { start, end: start + rawToken.length, raw: rawToken };
    const value = rawToken.toLocaleLowerCase('ru');
    const negated = value.startsWith('!') && value.length > 1;
    const body = negated ? value.slice(1) : value;
    if (!body) continue;
    if (!negated && body.length > 1 && body.startsWith('$')) {
      tokens.push({ ...span, kind: 'nav', navKind: 'card-ref', term: body.slice(1) });
      continue;
    }
    if (!negated && body.startsWith('gd:') && body.length > 3) {
      tokens.push({ ...span, kind: 'nav', navKind: 'deck', term: body.slice(3) });
      continue;
    }
    if (!negated && body.startsWith('gc:') && body.length > 3) {
      tokens.push({ ...span, kind: 'nav', navKind: 'card-title', term: body.slice(3) });
      continue;
    }
    if (body.startsWith('#') && body.length > 1) {
      // Each alternative after '|' can have its own '#'; strip it consistently.
      const alternatives = body.slice(1).split('|').map(part => part.replace(/^#/u, '')).filter(Boolean);
      if (!alternatives.length) continue;
      tokens.push({ ...span, kind: 'tag', value: body.slice(1), ...(alternatives.length > 1 ? { alternatives } : {}), negated });
      continue;
    }
    if (body.startsWith('@') && body.length > 1) {
      const ownerValue = body.slice(1);
      tokens.push({ ...span, kind: 'owner', value: ownerValue, ...(ownerValue === 'none' ? { none: true } : {}), negated });
      continue;
    }
    const prefix = body.slice(0, body.indexOf(':') + 1);
    const filterKind = prefix ? valueFilters.get(prefix.slice(0, -1)) : undefined;
    if (filterKind && body.length > prefix.length) {
      tokens.push({ ...span, kind: filterKind, value: body.slice(prefix.length), negated });
      continue;
    }
    tokens.push({ ...span, kind: 'word', value: body, negated });
  }
  return tokens;
}

/** Clicking a filter pill removes its token by source position. */
export function withoutToken(raw: string, token: SearchToken): string {
  return (raw.slice(0, token.start) + ' ' + raw.slice(token.end)).replace(/\s+/gu, ' ').trim();
}

/**
 * Toggle tag OR: separate `#a #b` (AND) tokens become one `#a|#b` (OR) token and back.
 * Leave navigation and excluded tags unchanged.
 */
export function toggleTagOr(raw: string): string {
  const tokens = parseSearch(raw);
  const tagTokens = tokens.filter((token): token is FilterToken => token.kind === 'tag' && !token.negated);
  // Keep tag spelling without '!' or the leading '#'; toggling must preserve query case.
  const rawParts = (token: FilterToken) => token.raw.replace(/^!?#/u, '').split('|').map(part => part.replace(/^#/u, '')).filter(Boolean);
  const values = tagTokens.flatMap(rawParts);
  if (values.length < 2) return raw;
  const orActive = tagTokens.some(token => (token.alternatives?.length ?? 0) > 1);
  const pieces: string[] = [];
  let joinedPlaced = false;
  for (const token of tokens) {
    if (token.kind !== 'tag' || token.negated) { pieces.push(token.raw); continue; }
    if (orActive) pieces.push(...rawParts(token).map(part => '#' + part));
    else if (!joinedPlaced) { pieces.push('#' + values.join('|#')); joinedPlaced = true; }
  }
  return pieces.join(' ');
}

/** `sub:` resolves a parent by short/full reference or title prefix; ambiguous references match nothing. */
function subParents(reachable: CatalogCard[], term: string): Set<string> {
  try {
    const resolved = resolveReference(reachable, 'c', term);
    if (resolved) return new Set([resolved.id]);
  } catch { /* An ambiguous short reference matches nothing, just like an unknown deck. */ }
  const parents = new Set<string>();
  for (const card of reachable) if (card.title.toLocaleLowerCase('ru').startsWith(term)) parents.add(card.id);
  return parents;
}

/** Match CardIndicators: an ended Run is past, one not yet started is future, and all others are current. */
function runPhase(run: RunRecord, today: string): 'past' | 'current' | 'future' {
  if (run.end < today) return 'past';
  if (run.start > today) return 'future';
  return 'current';
}

interface SearchContext {
  members: CatalogMember[];
  decks: CatalogDeck[];
  runs: RunRecord[];
  milestones: MilestoneRecord[];
  runById: Map<string, RunRecord>;
  reachable: CatalogCard[];
  today: string;
  soonLimit: string;
  /** The member whose Hand is "mine" for hand:in/not, also used by "Q — my cards". */
  handMemberId: string | null;
}

/**
 * A single filter predicate. null means a positive filter cannot match (unknown deck, kind, state, or Run).
 * Negated filters never return null: "not in a nonexistent deck" is true for every card.
 */
function matcherFor(token: FilterToken, context: SearchContext): ((card: CatalogCard) => boolean) | null {
  switch (token.kind) {
    case 'word': {
      const word = token.value;
      return card => searchText(card).includes(word) !== token.negated;
    }
    case 'title': {
      const term = token.value;
      const includes = (card: CatalogCard) => card.title.toLocaleLowerCase('ru').includes(term);
      return (card) => includes(card) !== token.negated;
    }
    case 'tag': {
      // Separate # tokens use AND (the card has every tag); #a|#b uses OR.
      const alternatives = token.alternatives ?? [token.value];
      const has = (card: CatalogCard) => {
        const tags = (card.tags ?? []).map(tag => tag.toLocaleLowerCase('ru'));
        return alternatives.some(tag => tags.includes(tag));
      };
      return (card) => has(card) !== token.negated;
    }
    case 'owner': {
      if (token.none) return (card) => (card.owner == null) !== token.negated;
      const has = (card: CatalogCard) => ownerMatches(card.owner, token.value, context.members);
      return (card) => has(card) !== token.negated;
    }
    case 'deck': {
      const deckIds = new Set(context.decks.filter(deck => deck.title.toLocaleLowerCase('ru').startsWith(token.value)).map(deck => deck.id));
      if (deckIds.size === 0 && !token.negated) return null;
      return (card) => deckIds.has(card.deckId ?? '') !== token.negated;
    }
    case 'kind': {
      const kinds = searchKinds.filter(kind => kind.startsWith(token.value));
      if (kinds.length === 0 && !token.negated) return null;
      return (card) => kinds.includes(card.kind) !== token.negated;
    }
    case 'state': {
      const requested = readCardState(token.value);
      const matchingIds = cardStates.filter(state => cardStateWords(state).some(word => word.startsWith(token.value)));
      const shelves = shelfStates.filter(state => state.startsWith(token.value));
      const states: readonly string[] = requested ? [requested] : shelves.length ? shelves : matchingIds;
      if (states.length === 0 && !token.negated) return null;
      return (card) => states.includes(shelfOf(card) ?? card.state ?? '') !== token.negated;
    }
    case 'effort': {
      // effort:3 is exact; effort:3+ means at least 3; effort:3- means at most 3.
      const match = /^(\d+)([+-]?)$/u.exec(token.value);
      // Unknown values match nothing in a positive filter and everything in a negated filter.
      if (!match) return token.negated ? () => true : () => false;
      const target = Number(match[1]);
      const pass = (card: CatalogCard) => {
        if (card.effort == null) return false;
        return match[2] === '+' ? card.effort >= target : match[2] === '-' ? card.effort <= target : card.effort === target;
      };
      return (card) => pass(card) !== token.negated;
    }
    case 'priority': {
      // priority:high is exact; priority:medium+ includes higher priorities; priority:low- includes lower ones.
      const match = /^([a-z]+)([+-]?)$/u.exec(token.value);
      const anchor = match && (Object.keys(priorityRank) as CardPriority[]).find(priority => priority.startsWith(match[1]));
      if (!anchor || !match) return token.negated ? () => true : () => false;
      const rank = priorityRank[anchor];
      const direction = match[2];
      const pass = (card: CatalogCard) => {
        if (card.priority == null) return false;
        const cardRank = priorityRank[card.priority];
        return direction === '+' ? cardRank >= rank : direction === '-' ? cardRank <= rank : cardRank === rank;
      };
      return (card) => pass(card) !== token.negated;
    }
    case 'run': {
      // run:current|future|past|none, or a specific Run's number or goal prefix.
      if (token.value === 'none') return (card) => (card.run == null) !== token.negated;
      if (token.value === 'current' || token.value === 'future' || token.value === 'past') {
        const phase = token.value;
        const pass = (card: CatalogCard) => {
          const run = card.run ? context.runById.get(card.run) : undefined;
          return run !== undefined && runPhase(run, context.today) === phase;
        };
        return (card) => pass(card) !== token.negated;
      }
      const runIds = new Set(context.runs.filter(run => String(run.number) === token.value || run.goal.toLocaleLowerCase('ru').startsWith(token.value)).map(run => run.id));
      if (runIds.size === 0 && !token.negated) return null;
      return (card) => runIds.has(card.run ?? '') !== token.negated;
    }
    case 'milestone': {
      if (token.value === 'none') return (card) => (card.milestone == null) !== token.negated;
      const milestoneIds = new Set(context.milestones.filter(milestone => milestone.title.toLocaleLowerCase('ru').startsWith(token.value) || milestone.date === token.value).map(milestone => milestone.id));
      if (milestoneIds.size === 0 && !token.negated) return null;
      return (card) => milestoneIds.has(card.milestone ?? '') !== token.negated;
    }
    case 'hand': {
      // hand:in / hand:not means currently in my Hand / outside my Hand.
      if (token.value !== 'in' && token.value !== 'not') return token.negated ? () => true : () => false;
      const inHand = (card: CatalogCard) => (card.handMemberIds ?? []).includes(context.handMemberId ?? '');
      const pass = token.value === 'in' ? inHand : (card: CatalogCard) => !inHand(card);
      return (card) => pass(card) !== token.negated;
    }
    case 'due': {
      // due:today includes overdue cards; due:soon covers the next 7 days; due:any requires a due date.
      const pass = (card: CatalogCard) => {
        const due = card.dueDate;
        if (!due) return false;
        if (token.value === 'any') return true;
        if (token.value === 'today') return due <= context.today;
        if (token.value === 'soon') return due > context.today && due <= context.soonLimit;
        return false;
      };
      return (card) => pass(card) !== token.negated;
    }
    case 'sub': {
      const parents = subParents(context.reachable, token.value);
      if (parents.size === 0 && !token.negated) return null;
      return (card) => parents.has(card.parentId ?? '') !== token.negated;
    }
  }
}

/**
 * $ID is an exact short/full reference; gd:/gc: match title prefixes.
 * Ambiguous short references show the resolveReference error. Unmatched navigation tokens are removed,
 * leaving plain text search. Deleted cards cannot open; archived cards can open by explicit reference.
 */
function resolveNavigation(catalog: CatalogView, navTokens: NavToken[]): NavigationTarget[] {
  const targets: NavigationTarget[] = [];
  if (!navTokens.length) return targets;
  const reachable = catalog.cards.filter(card => !card.deleted);
  const titled = catalog.cards.filter(card => !card.archived && !card.deleted);
  for (const { navKind, term } of navTokens) {
    if (targets.length >= NAVIGATION_LIMIT) break;
    if (navKind === 'card-ref') {
      try {
        const resolved = resolveReference(reachable, 'c', term);
        if (resolved) targets.push({ kind: 'card', card: resolved });
      } catch (error) {
        targets.push({ kind: 'ambiguous', message: error instanceof Error ? error.message : textNow(text).ambiguousReference });
      }
      continue;
    }
    if (navKind === 'deck') {
      for (const deck of catalog.decks) {
        if (targets.length >= NAVIGATION_LIMIT) break;
        if (deck.title.toLocaleLowerCase('ru').startsWith(term)) targets.push({ kind: 'deck', deck });
      }
    } else {
      for (const card of titled) {
        if (targets.length >= NAVIGATION_LIMIT) break;
        if (card.title.toLocaleLowerCase('ru').startsWith(term)) targets.push({ kind: 'card', card });
      }
    }
  }
  return targets;
}

/** `handMemberId` identifies whose Hand counts as "mine" for hand:in/not. */
export function runSearch(catalog: CatalogView, rawQuery: string, handMemberId: string | null = null): SearchOutcome {
  const tokens = parseSearch(rawQuery);
  const navigation = resolveNavigation(catalog, tokens.filter((token): token is NavToken => token.kind === 'nav'));
  const filters = tokens.filter((token): token is FilterToken => token.kind !== 'nav');
  // An unmatched navigation token with no remaining query must not become "show all".
  if (!filters.length) return { navigation, cards: [], total: 0 };
  const context: SearchContext = {
    members: catalog.members ?? [],
    decks: catalog.decks,
    runs: catalog.runs ?? [],
    milestones: catalog.milestones ?? [],
    runById: new Map((catalog.runs ?? []).map(run => [run.id, run])),
    // 2026-11-05: only sub: resolves parents; ordinary filters need no extra catalog pass.
    reachable: filters.some(token => token.kind === 'sub') ? catalog.cards.filter(card => !card.deleted) : [],
    today: localToday(),
    soonLimit: plusDays(localToday(), 7),
    handMemberId,
  };
  const matchers: Array<(card: CatalogCard) => boolean> = [];
  for (const token of filters) {
    const matcher = matcherFor(token, context);
    if (!matcher) return { navigation, cards: [], total: 0 };
    matchers.push(matcher);
  }
  // Archive and Trash stay hidden until a positive state:archived/deleted filter explicitly includes them.
  const shelves = new Set(filters.flatMap(token => {
    if (token.kind !== 'state' || token.negated) return [] as string[];
    const allStates: readonly string[] = [...cardStates, ...shelfStates];
    return allStates.filter(state => state.startsWith(token.value) && (shelfStates as readonly string[]).includes(state));
  }));
  const cards: CatalogCard[] = [];
  let total = 0;
  for (const card of catalog.cards) {
    const shelf = shelfOf(card);
    if (shelf !== null && !shelves.has(shelf)) continue;
    if (!matchers.every(matcher => matcher(card))) continue;
    total += 1;
    if (cards.length < RESULT_LIMIT) cards.push(card);
  }
  return { navigation, cards, total };
}
