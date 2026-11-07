import { expect, it } from 'vitest';
import { shelfAndPile } from '../client/deck-shelf.ts';

it('keeps catalog order on the shelf and in the pile, with a missing flag meaning the shelf', () => {
  const decks = [{ id: 'a' }, { id: 'p1', piled: true }, { id: 'b', piled: false }, { id: 'p2', piled: true }, { id: 'c' }];
  const { shelf, pile } = shelfAndPile(decks);
  expect(shelf.map(deck => deck.id)).toEqual(['a', 'b', 'c']);
  expect(pile.map(deck => deck.id)).toEqual(['p1', 'p2']);
});
