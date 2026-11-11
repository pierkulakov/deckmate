import { expect, it } from 'vitest';
import type { CatalogCard, CatalogView } from '../src/catalog-contracts.ts';
import { SMART_NODE_CARD_LIMIT, smartNodeData } from '../src/board-smart.ts';

function card(id: string, overrides: Partial<CatalogCard> = {}): CatalogCard {
  return { id, title: id, kind: 'task', path: `cards/${id}.md`, version: null, state: 'not-started',
    owner: null, markdown: '', sourceHash: '', range: null, deckId: 'deck', trackIds: [], parentId: null, ...overrides };
}

function catalog(cards: CatalogCard[]): CatalogView {
  return { rootIdentity: '', formatLanguage: 'en', configured: true, manifestHash: '', indexedAt: '',
    documents: [], spaces: [], tracks: [], warnings: [], cards, members: [],
    decks: [{ id: 'deck', spaceId: 'space', title: 'Deck', kind: 'mixed', description: '', color: '', icon: '' }] };
}

const query = { deckId: 'deck', state: null };

it('counts only active Tasks and never counts wont-do as accepted', () => {
  const cards = [card('done', { state: 'done' }), card('started', { state: 'started' }), card('cancelled', { state: 'wont-do' }),
    card('hero', { kind: 'hero', state: 'done' }), card('doc', { kind: 'doc', state: 'done' }),
    card('archived', { state: 'done', archived: true }), card('deleted', { state: 'done', deleted: true }),
    card('other-deck', { state: 'done', deckId: 'other' })];
  expect(smartNodeData(catalog(cards), query)).toMatchObject({ deckTitle: 'Deck', total: 3, done: 1, capped: false });
  expect(smartNodeData(catalog(cards), { ...query, state: 'done' })).toMatchObject({ total: 1, done: 1, stateFilter: 'done' });
  expect(smartNodeData(catalog(cards), { ...query, state: 'wont-do' })).toMatchObject({ total: 1, done: 0, stateFilter: 'wont-do' });
});

it('keeps zero progress and a missing deck explicit', () => {
  const empty = catalog([card('doc', { kind: 'doc', state: null })]);
  expect(smartNodeData(empty, query)).toMatchObject({ total: 0, done: 0, capped: false });
  expect(smartNodeData(empty, { deckId: 'missing', state: null })).toMatchObject({
    deckTitle: null, total: 0, done: 0, label: 'Deck not found · done 0/0',
  });
});

it('applies the cap after excluding non-Tasks', () => {
  const documents = Array.from({ length: 600 }, (_, index) => card(`doc-${index}`, { kind: 'doc', state: null }));
  const tasks = Array.from({ length: SMART_NODE_CARD_LIMIT + 1 }, (_, index) => card(`task-${index}`, { state: 'done' }));
  const result = smartNodeData(catalog([...documents, ...tasks]), query);
  expect(result).toMatchObject({ total: SMART_NODE_CARD_LIMIT, done: SMART_NODE_CARD_LIMIT, capped: true });
  expect(result.label).toBe('Deck · done 500/500+');
});
