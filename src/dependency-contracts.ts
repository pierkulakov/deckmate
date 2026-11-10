import type { DeckActivityPage } from './activity-contracts.ts';
import type { CatalogCard, CatalogEdit } from './catalog-contracts.ts';
import type { CardState } from './format-vocabulary.ts';

/** Dependencies can connect any cards. */
export type SetCardDependenciesEdit = Extract<CatalogEdit, { action: 'set-card-dependencies' }>;

/** 2026-11-09: only existing, active, unaccepted prerequisites block; hidden links remain context. */
export function openDependencies(dependencyIds: readonly string[] | undefined, cardsById: ReadonlyMap<string, CatalogCard>): CatalogCard[] {
  const open: CatalogCard[] = [];
  for (const id of dependencyIds ?? []) {
    const dependency = cardsById.get(id);
    if (dependency && dependency.state !== 'done' && !dependency.archived && !dependency.deleted) open.push(dependency);
  }
  return open;
}

/** Find cards waiting on this one by reversing dependsOn across the catalog. */
export function waitingCards(cardId: string, cards: readonly CatalogCard[]): CatalogCard[] {
  return cards.filter(other => (other.dependsOn ?? []).includes(cardId));
}

/**
 * Check the catalog for cycles with the card's proposed dependencies substituted.
 * The client warns before submission and the server rechecks. Returns an ID path or null.
 */
export function dependencyCycle(cards: readonly CatalogCard[], cardId: string, dependsOn: readonly string[]): string[] | null {
  const graph = new Map<string, readonly string[]>();
  for (const card of cards) graph.set(card.id, card.id === cardId ? dependsOn : card.dependsOn ?? []);
  const complete = new Set<string>();
  const active: string[] = [];
  function visit(id: string): string[] | null {
    if (complete.has(id)) return null;
    if (active.includes(id)) return [...active.slice(active.indexOf(id)), id];
    const edges = graph.get(id);
    if (!edges) return null;
    active.push(id);
    for (const dependency of edges) {
      const cycle = visit(dependency);
      if (cycle) return cycle;
    }
    active.pop();
    complete.add(id);
    return null;
  }
  return visit(cardId);
}

/** Starting or accepting a card requires confirmation when incoming dependencies remain open. */
export function stateNeedsDependencyWarning(state: CardState): boolean {
  return state === 'started' || state === 'done';
}

export interface DependencyConflict {
  card: CatalogCard;
  /** Open incoming dependencies at the time of the check. */
  waiting: CatalogCard[];
}

/**
 * Find open incoming dependencies for a proposed state change. An empty list means no warning is needed.
 * Marking an already accepted card as done does not require confirmation.
 */
export function dependencyConflicts(cards: readonly CatalogCard[], cardsById: ReadonlyMap<string, CatalogCard>, nextState: CardState): DependencyConflict[] {
  if (!stateNeedsDependencyWarning(nextState)) return [];
  const conflicts: DependencyConflict[] = [];
  for (const card of cards) {
    if (card.state === 'done' && nextState === 'done') continue;
    const waiting = openDependencies(card.dependsOn, cardsById);
    if (waiting.length) conflicts.push({ card, waiting });
  }
  return conflicts;
}

/** Card History combines a journal page with the Created entry, the card's first record. */
export interface CardHistoryCreated {
  at: string;
  actor: string;
}

export interface CardHistoryPage extends DeckActivityPage {
  created: CardHistoryCreated | null;
}
