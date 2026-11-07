import { expect, it } from 'vitest';
import { deckTypeChangeIssue } from '../src/deck-type-policy.ts';
import type { CardKind, CatalogCard, CatalogJourney, DeckKind } from '../src/catalog-contracts.ts';

const card = (kind: CardKind, extra: Partial<CatalogCard> = {}): CatalogCard => ({ id: 'card:test', kind, path: 'cards/test.md', version: null, title: 'Card', state: kind === 'task' ? 'not-started' : null, owner: null, markdown: '', sourceHash: 'hash', range: null, deckId: 'target', trackIds: [], parentId: null, ...extra });
const journey: CatalogJourney = { id: 'journey:test', title: 'Pipeline', version: 1, deckId: 'source', path: 'tasks/journeys/test/index.md', fileHash: 'hash', steps: [{ id: 'step', title: 'Step', markdown: '', deckId: 'target', owner: null, dependsOn: [] }] };
const matrix: [DeckKind, CardKind, boolean][] = [
  ['asset', 'hero', true], ['asset', 'task', false], ['asset', 'doc', false],
  ['task', 'hero', false], ['task', 'task', true], ['task', 'doc', false],
  ['knowledge', 'hero', false], ['knowledge', 'task', false], ['knowledge', 'doc', true],
  ['mixed', 'hero', true], ['mixed', 'task', true], ['mixed', 'doc', true],
];
it.each(matrix)('%s accepts %s: %s', (kind, cardKind, accepted) => {
  expect(deckTypeChangeIssue('target', kind, [card(cardKind)], []) === null).toBe(accepted);
});
it.each(['archived', 'deleted'] as const)('does not ignore %s incompatible cards', key => {
  expect(deckTypeChangeIssue('target', 'knowledge', [card('task', { [key]: true })], [])).not.toBeNull();
});
it.each(['asset', 'task', 'knowledge', 'mixed'] as DeckKind[])('checks Journey source and destination constraints for %s', kind => {
  expect(deckTypeChangeIssue('source', kind, [], [journey]) === null).toBe(['asset', 'mixed'].includes(kind));
  expect(deckTypeChangeIssue('target', kind, [], [journey]) === null).toBe(['task', 'mixed'].includes(kind));
});
it('ignores unrelated decks and requires Mixed if one deck is both Journey source and destination', () => {
  expect(deckTypeChangeIssue('unrelated', 'knowledge', [card('task')], [journey])).toBeNull();
  const circularDestination = { ...journey, deckId: 'target' };
  for (const kind of ['asset', 'task', 'knowledge'] as DeckKind[]) expect(deckTypeChangeIssue('target', kind, [], [circularDestination])).not.toBeNull();
  expect(deckTypeChangeIssue('target', 'mixed', [], [circularDestination])).toBeNull();
});
