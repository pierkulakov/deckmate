import type { CatalogDeck } from '../src/catalog-contracts.ts';

// 2026-11-06: a space on the Decks home screen is a shelf of covers followed by one pile. A deck goes to the pile only by
// hand (set-deck-pile); both parts keep the catalog order, so the pile never reshuffles the shelf around it.

export interface ShelfAndPile<Deck> { shelf: Deck[]; pile: Deck[] }

export function shelfAndPile<Deck extends Pick<CatalogDeck, 'piled'>>(decks: readonly Deck[]): ShelfAndPile<Deck> {
  const shelf: Deck[] = [];
  const pile: Deck[] = [];
  for (const deck of decks) (deck.piled ? pile : shelf).push(deck);
  return { shelf, pile };
}
