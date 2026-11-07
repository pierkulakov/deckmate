import { describe, expect, it } from 'vitest';
import type { CatalogCard, CatalogDeck, DeckKind } from '../src/catalog-contracts.ts';
import { captureCardTransfer, cardTransferRequest, cardTransferTargetIssue } from '../client/card-transfer.ts';

function card(id: string, overrides: Partial<CatalogCard> = {}): CatalogCard {
  return { id, kind: 'task', path: `cards/${id}.md`, version: null, title: id, state: 'not-started', owner: null,
    markdown: 'Keep content', sourceHash: `revision-${id}`, range: null, deckId: 'source', trackIds: [], parentId: null, ...overrides };
}

function deck(id: string, kind: DeckKind = 'task'): CatalogDeck {
  return { id, kind, title: id, spaceId: 'space', description: '', color: '#123456', icon: 'box' };
}

function capture(cards: CatalogCard[], selectedIds = new Set(cards.map(entry => entry.id)), activeId = cards[0].id) {
  return captureCardTransfer(activeId, cards, selectedIds, 'manifest-before-drag', 'sandbox')!;
}

describe('card transfer payload', () => {
  it('moves only visible selected cards, keeping their displayed order and excluding hidden selections', () => {
    const cards = [card('second'), card('unselected'), card('first')];
    const selection = new Set(['first', 'hidden', 'second']);
    const baseline = capture(cards, selection, 'first');
    expect(baseline.ownsSelection).toBe(true);
    expect(baseline.cards.map(entry => entry.cardId)).toEqual(['second', 'first']);
    expect(selection).toEqual(new Set(['first', 'hidden', 'second']));
  });

  it('dragging an unselected card captures only that card and leaves ownership of the existing selection unchanged', () => {
    const selection = new Set(['selected', 'hidden']);
    const baseline = capture([card('selected'), card('active')], selection, 'active');
    expect(baseline.ownsSelection).toBe(false);
    expect(baseline.cards.map(entry => entry.cardId)).toEqual(['active']);
    expect(selection).toEqual(new Set(['selected', 'hidden']));
  });

  it('rejects an active card absent from the visible view and rejects read-only live data', () => {
    const cards = [card('visible')];
    expect(captureCardTransfer('hidden', cards, new Set(['hidden']), 'revision', 'sandbox')).toBeNull();
    expect(captureCardTransfer('visible', cards, new Set(), 'revision', 'live')).toBeNull();
    expect(captureCardTransfer('visible', [], new Set(), 'revision', 'sandbox')).toBeNull();
  });

  it('keeps original revisions and compatibility after source objects change during drag', () => {
    const active = card('active', { title: 'Before', parentId: 'hero', dependsOn: ['dependency'] });
    const cards = [active];
    const baseline = capture(cards);
    active.sourceHash = 'refreshed-source';
    active.kind = 'doc';
    active.deckId = 'target';
    active.title = 'After';
    active.priority = 'high';
    cards.length = 0;
    expect(baseline.cards).toEqual([{ cardId: 'active', sourceHash: 'revision-active', kind: 'task', deckId: 'source', title: 'Before', priority: null }]);
    expect(cardTransferRequest(baseline, deck('target'))).toEqual({
      action: 'bulk-assign-deck', deckId: 'target', manifestHash: 'manifest-before-drag',
      cards: [{ cardId: 'active', sourceHash: 'revision-active' }],
    });
  });

  it('accepts 1000 visible selections and rejects 1001 without preventing a separate unselected-card drag', () => {
    const cards = Array.from({ length: 1002 }, (_, index) => card(`card-${index}`));
    const thousand = new Set(cards.slice(0, 1000).map(entry => entry.id));
    expect(capture(cards, thousand).cards).toHaveLength(1000);
    const tooMany = new Set(cards.slice(0, 1001).map(entry => entry.id));
    expect(captureCardTransfer(cards[0].id, cards, tooMany, 'revision', 'sandbox')).toBeNull();
    const single = capture(cards, tooMany, cards[1001].id);
    expect(single.cards).toHaveLength(1);
    expect(single.ownsSelection).toBe(false);
  });

  it('rejects a target unless every selected card is compatible, while Mixed accepts a whole family', () => {
    const baseline = capture([card('task'), card('hero', { kind: 'hero' }), card('doc', { kind: 'doc' })]);
    for (const kind of ['task', 'asset', 'knowledge'] as const) {
      expect(cardTransferTargetIssue(baseline, deck('target', kind))).toBe('incompatible');
      expect(cardTransferRequest(baseline, deck('target', kind))).toBeNull();
    }
    expect(cardTransferTargetIssue(baseline, deck('target', 'mixed'))).toBeNull();
    expect(cardTransferRequest(baseline, deck('target', 'mixed'))?.cards).toHaveLength(3);
  });

  it.each([
    ['task', 'task'], ['hero', 'asset'], ['doc', 'knowledge'],
  ] as const)('accepts a %s card in its compatible %s deck', (kind, deckKind) => {
    const baseline = capture([card('active', { kind })]);
    expect(cardTransferTargetIssue(baseline, deck('target', deckKind))).toBeNull();
    expect(cardTransferRequest(baseline, deck('target', deckKind))?.deckId).toBe('target');
  });

  it('treats a target as a no-op only when every payload card already belongs to it', () => {
    const same = capture([card('first'), card('second')]);
    expect(cardTransferTargetIssue(same, deck('source'))).toBe('same-deck');
    expect(cardTransferRequest(same, deck('source'))).toBeNull();
    const partlyAssigned = capture([card('first'), card('second', { deckId: 'elsewhere' })]);
    expect(cardTransferTargetIssue(partlyAssigned, deck('source'))).toBeNull();
    expect(cardTransferRequest(partlyAssigned, deck('source'))?.cards.map(entry => entry.cardId)).toEqual(['first', 'second']);
  });

  it('allows Without Deck for mixed kinds, but sends no request when all are already unassigned', () => {
    const mixed = capture([card('task'), card('hero', { kind: 'hero', deckId: null })]);
    expect(cardTransferTargetIssue(mixed, null)).toBeNull();
    expect(cardTransferRequest(mixed, null)?.deckId).toBeNull();
    const unassigned = capture([card('task', { deckId: null }), card('doc', { kind: 'doc', deckId: null })]);
    expect(cardTransferTargetIssue(unassigned, null)).toBe('same-deck');
    expect(cardTransferRequest(unassigned, null)).toBeNull();
  });

  it('creates independent guarded request selections without leaking content, family or UI metadata', () => {
    const baseline = capture([card('active', { parentId: 'hero', dependsOn: ['dependency'], trackIds: ['track'], owner: 'Owner' })]);
    const request = cardTransferRequest(baseline, deck('target'))!;
    expect(Object.keys(request.cards[0]).sort()).toEqual(['cardId', 'sourceHash']);
    expect(Object.keys(request).sort()).toEqual(['action', 'cards', 'deckId', 'manifestHash']);
    request.cards[0].sourceHash = 'mutated-request';
    expect(cardTransferRequest(baseline, deck('target'))!.cards[0].sourceHash).toBe('revision-active');
  });
});
