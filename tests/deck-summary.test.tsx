import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CatalogCard, CatalogDeck, CatalogView } from '../src/catalog-contracts.ts';
import { DeckSummary } from '../client/components/DeckSummary.tsx';
import { setLang } from '../client/i18n.ts';

vi.hoisted(() => {
  vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
});

beforeEach(() => {
  vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
  setLang('en');
});
afterEach(() => vi.unstubAllGlobals());

function card(id: string, overrides: Partial<CatalogCard> = {}): CatalogCard {
  return { id, title: id, kind: 'task', path: `cards/${id}.md`, version: null, state: 'started', owner: 'Active Owner',
    markdown: '', sourceHash: 'hash', range: null, deckId: 'deck', trackIds: ['active'], parentId: null, effort: 3, priority: 'medium', ...overrides };
}

function renderSummary(kind: CatalogDeck['kind'], cards: CatalogCard[], allCards = cards): string {
  const deck: CatalogDeck = { id: 'deck', title: 'Deck', kind, color: '#123456', icon: 'box', description: '', spaceId: 'space' };
  const catalog: CatalogView = { rootIdentity: 'root', configured: true, formatLanguage: 'en', manifestHash: 'hash', indexedAt: '',
    documents: [], spaces: [], decks: [deck], tracks: [{ id: 'active', title: 'Active Track', description: '' }, { id: 'hidden', title: 'Hidden Track', description: '' }],
    cards: allCards, warnings: [] };
  const noop = () => {};
  return renderToStaticMarkup(<DeckSummary deck={deck} cards={cards} catalog={catalog} source="sandbox" refreshKey="revision"
    disabled={false} onOpen={noop} onTrack={noop} onCollapse={noop} />);
}

function expectActiveMetrics(html: string) {
  expect(html).toContain('title="Effort set for 2 of 2');
  expect(html).toContain('<strong>11</strong>');
  expect(html).toContain('<strong>50%</strong>');
  expect(html).toContain('aria-label="Done: 1"');
  expect(html).toContain('aria-label="Started: 1"');
  expect(html).toContain('aria-label="Review: 0"');
  expect(html).toContain('aria-label="Active Owner: 2"');
  expect(html).toContain('Active Track');
  expect(html).not.toContain('Hidden Owner');
  expect(html).not.toContain('Hidden Track');
  expect(html).not.toContain('cards/hidden');
}

it('counts only unique active cards and tasks in a Mixed deck, including Hero children', () => {
  const active = card('done', { state: 'done', effort: 8, priority: 'high', parentId: 'hero' });
  const cards = [card('hero', { kind: 'hero', state: null }), card('doc', { kind: 'doc', state: null }), active, active,
    card('started', { parentId: 'hero' }),
    card('hidden-archived', { archived: true, parentId: 'hero', state: 'review', effort: 100, owner: 'Hidden Owner', trackIds: ['hidden'] }),
    card('hidden-deleted', { deleted: true, parentId: 'hero', state: 'done', effort: 100, owner: 'Hidden Owner', trackIds: ['hidden'] }),
    card('hidden-hero', { kind: 'hero', archived: true }), card('hidden-doc', { kind: 'doc', deleted: true })];
  const before = structuredClone(cards);
  const html = renderSummary('mixed', cards);
  expect(html).toContain('<strong>4 Cards</strong>');
  expectActiveMetrics(html);
  expect(cards).toEqual(before);
});

it('counts only active children of active Heroes in Asset decks, even when children live in other decks', () => {
  const hero = card('hero', { kind: 'hero', state: null });
  const cards = [hero, hero, card('hidden-hero-archive', { kind: 'hero', archived: true }), card('hidden-hero-trash', { kind: 'hero', deleted: true })];
  const done = card('done', { deckId: 'other-deck', parentId: hero.id, state: 'done', effort: 8, priority: 'high' });
  const allCards = [...cards, done, done, card('started', { deckId: 'other-deck', parentId: hero.id }),
    ...[{ archived: true }, { deleted: true }, { parentId: 'hidden-hero-archive' }, { parentId: 'hidden-hero-trash' }].map((flags, index) =>
      card('hidden-child-' + index, { deckId: 'other-deck', parentId: hero.id, state: 'review', effort: 100, owner: 'Hidden Owner', trackIds: ['hidden'], ...flags }))];
  const before = structuredClone(allCards);
  const html = renderSummary('asset', cards, allCards);
  expect(html).toContain('<strong>1 Cards</strong>');
  expect(html).toContain('· 2 Sub Cards');
  expectActiveMetrics(html);
  expect(allCards).toEqual(before);
});

it('excludes shelved documents from the Knowledge count and handles an empty active deck', () => {
  const active = card('doc', { kind: 'doc', state: null });
  const hidden = [card('hidden-archive', { kind: 'doc', archived: true }), card('hidden-trash', { kind: 'doc', deleted: true })];
  expect(renderSummary('knowledge', [active, ...hidden])).toContain('<strong>1 document</strong>');
  const html = renderSummary('knowledge', hidden);
  expect(html).toContain('Statistics appear after the first card.');
  expect(html).not.toContain('deck-overview-stats');
  expect(html).not.toContain('Source files');
});
