// Smart Node for Vision boards.
// One query (deck + optional state) renders accepted cards out of the total as a progress bar.
// Pure logic without React so the server, agents and tests can reuse the same counting.
import type { BoardSmartQuery } from './board-contracts.ts';
import type { CatalogCard, CatalogView } from './catalog-contracts.ts';
import { defaultLang, defineText, localeOf, type Lang } from './i18n.ts';
import { readCardState } from './format-vocabulary.ts';

const text = defineText({ missingDeck: 'Deck not found' },
  { missingDeck: 'Колода не найдена' });

// A query may count at most this many cards; the bar stays honest by marking itself capped.
export const SMART_NODE_CARD_LIMIT = 500;
// The accepted workflow state supplies the Done portion of the bar.
export const SMART_DONE_STATE = 'done';

function matchesQuery(card: CatalogCard, query: BoardSmartQuery): boolean {
  const state = query.state ? readCardState(query.state) ?? query.state : null;
  return card.deckId === query.deckId && (!state || card.state === state);
}

export interface SmartNodeData {
  deckTitle: string | null;
  stateFilter: string | null;
  total: number;
  done: number;
  capped: boolean;
  /** Generated from the filter and shown above the bar. */
  label: string;
}

export function smartNodeData(catalog: CatalogView | null, query: BoardSmartQuery, lang: Lang = defaultLang,
  stateLabel?: (state: string) => string): SmartNodeData {
  const deck = catalog?.decks.find(candidate => candidate.id === query.deckId) ?? null;
  const all = catalog ? catalog.cards.filter(card => matchesQuery(card, query)) : [];
  const capped = all.length > SMART_NODE_CARD_LIMIT;
  const counted = capped ? all.slice(0, SMART_NODE_CARD_LIMIT) : all;
  const total = counted.length;
  const done = counted.filter(card => card.state === SMART_DONE_STATE).length;
  const number = new Intl.NumberFormat(localeOf(lang));
  const stateFilter = query.state ? readCardState(query.state) ?? query.state : null;
  const stateFilterLabel = stateFilter ? stateLabel?.(stateFilter) ?? stateFilter : '';
  const doneLabel = stateLabel?.(SMART_DONE_STATE) ?? SMART_DONE_STATE;
  const label = `${deck?.title ?? text[lang].missingDeck}${stateFilter ? ` · ${stateFilterLabel}` : ''} · ${doneLabel} ${number.format(done)}/${number.format(total)}${capped ? '+' : ''}`;
  return { deckTitle: deck?.title ?? null, stateFilter, total, done, capped, label };
}
