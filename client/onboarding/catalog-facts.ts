import type { CatalogCard, CatalogMember, CatalogView } from '../../src/catalog-contracts.ts';
import { isOwnedByMember } from '../../src/catalog-hand.ts';
import type { CardState } from '../../src/format-vocabulary.ts';
import { parseSearch } from '../search-query.ts';

// 2026-11-05: helpers for quest checks. A quest compares the catalog before and after an action, so it does not
// matter which button, menu, drag or bulk action did it — only what changed in the project.

export interface CardChange {
  card: CatalogCard;
  /** The card before the change; undefined for a new card. */
  previous: CatalogCard | undefined;
}

const changesByPair = new WeakMap<CatalogView, { before: CatalogView; changes: CardChange[] }>();

/** Cards whose file changed between two catalogs. Computed once per pair: every quest of one signal shares the result. */
export function changedCards(before: CatalogView, after: CatalogView): CardChange[] {
  const cached = changesByPair.get(after);
  if (cached?.before === before) return cached.changes;
  const previousById = new Map(before.cards.map(card => [card.id, card]));
  const changes = after.cards
    .map(card => ({ card, previous: previousById.get(card.id) }))
    .filter(change => change.previous?.sourceHash !== change.card.sourceHash || !sameCardFields(change.previous, change.card));
  changesByPair.set(after, { before, changes });
  return changes;
}

// Hand slots and other options can change without a new source hash when they live outside the card file.
function sameCardFields(previous: CatalogCard | undefined, card: CatalogCard): boolean {
  if (!previous) return false;
  return previous.state === card.state && previous.owner === card.owner && previous.effort === card.effort
    && previous.priority === card.priority && sameList(previous.handMemberIds, card.handMemberIds)
    && sameList(previous.dependsOn, card.dependsOn);
}

function sameList(left: readonly string[] | undefined, right: readonly string[] | undefined): boolean {
  const a = left ?? [];
  const b = right ?? [];
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** A card's state id; the catalog already reads the words of either file language into English ids (2026-11-05). */
export function stateOf(card: Pick<CatalogCard, 'state'> | undefined): CardState | undefined {
  return card?.state ?? undefined;
}

/** The registry member who owns the card, matched by label or alias like the Hand does. */
export function ownerOf(catalog: Pick<CatalogView, 'members'>, card: Pick<CatalogCard, 'owner'> | undefined): CatalogMember | undefined {
  if (!card?.owner) return undefined;
  return (catalog.members ?? []).find(member => isOwnedByMember(card.owner, member));
}

/** True when the query narrows results by a filter (`#tag`, `@owner`, `state:…`, `deck:…` and the like), not only by words. */
export function hasSearchFilter(query: string): boolean {
  return parseSearch(query).some(token => token.kind !== 'word' && token.kind !== 'nav');
}
