import { expect, it } from 'vitest';
import type { CatalogCard, CatalogMember } from '../src/catalog-contracts.ts';
import { cardPlanningOptions, getCatalogHands, selectCatalogHand } from '../src/catalog-hand.ts';

const members: CatalogMember[] = [
  { id: 'kimi', label: 'Kimi', kind: 'agent', aliases: ['Кими'] },
  { id: 'pavel', label: 'Павел', kind: 'human', aliases: ['Paul'] },
];
function card(id: string, options: Partial<CatalogCard> = {}): CatalogCard {
  return { id, kind: 'task', title: id, path: `cards/${id}.md`, version: null, state: 'not-started', owner: null,
    markdown: 'Full instructions', sourceHash: 'hash', range: null, deckId: null, trackIds: [], parentId: null, ...options };
}

it('uses explicit registry Hand IDs independently of Owner and never infers a queue from assignments', () => {
  const hands = getCatalogHands({ members, cards: [
    card('owner-only', { owner: 'Kimi' }),
    card('someone-elses-work', { owner: 'Павел', handMemberIds: ['kimi'] }),
    card('shared', { owner: null, handMemberIds: ['kimi', 'pavel'] }),
    card('label-is-not-id', { handMemberIds: ['Kimi'] }),
  ] });
  expect(hands.map(hand => [hand.member.id, hand.cards.map(item => item.id)])).toEqual([
    ['kimi', ['someone-elses-work', 'shared']], ['pavel', ['shared']],
  ]);
});

it('excludes archived and deleted cards across every kind without hiding accepted active cards', () => {
  const cards = (['task', 'hero', 'doc'] as const).flatMap(kind => [
    card(`${kind}-active`, { kind, state: 'done', handMemberIds: ['kimi'], archived: false, deleted: false }),
    card(`${kind}-archived`, { kind, handMemberIds: ['kimi'], archived: true }),
    card(`${kind}-deleted`, { kind, handMemberIds: ['kimi'], deleted: true }),
  ]);
  expect(getCatalogHands({ cards, members })[0].cards.map(item => item.id)).toEqual(['task-active', 'hero-active', 'doc-active']);
});

it('preserves source order, exposes empty hands and deduplicates card and member IDs without mutating input', () => {
  const first = card('first', { handMemberIds: ['kimi', 'kimi', 'unknown'] });
  const catalog = { cards: [first, card('second', { handMemberIds: ['kimi'] }), first], members };
  const before = JSON.stringify(catalog);
  const hands = getCatalogHands(catalog);
  expect(hands[0].cards.map(item => item.id)).toEqual(['first', 'second']);
  expect(hands[1].cards).toEqual([]);
  expect(JSON.stringify(catalog)).toBe(before);
});

it('does not invent members when the registry is absent or empty', () => {
  const cards = [card('assigned', { owner: 'Kimi', handMemberIds: ['kimi'] })];
  expect(getCatalogHands({ cards })).toEqual([]);
  expect(getCatalogHands({ cards, members: [] })).toEqual([]);
});

it('selects a canonical member ID or an exact case-insensitive label/alias, not an Owner note or prefix', () => {
  const hands = getCatalogHands({ cards: [], members });
  for (const query of ['kimi', 'KIMI', ' кИмИ ']) expect(selectCatalogHand(hands, query).member.id).toBe('kimi');
  expect(selectCatalogHand(hands, 'pAuL').member.id).toBe('pavel');
  for (const query of ['', 'Kim', 'Kimi — implement sound', 'missing']) expect(() => selectCatalogHand(hands, query)).toThrow();
});

it('rejects ambiguous aliases and prioritizes a canonical ID over an alias collision', () => {
  const hands = getCatalogHands({ cards: [], members: [...members, { id: 'other', label: 'Other', kind: 'agent', aliases: ['Кими', 'kimi'] }] });
  expect(selectCatalogHand(hands, 'kimi').member.id).toBe('kimi');
  expect(() => selectCatalogHand(hands, 'Кими')).toThrow('Ambiguous');
});

it('exposes planning metadata in compact agent data without Markdown or aliased mutable arrays', () => {
  const source = card('metadata', { handMemberIds: ['kimi'], tags: ['sound'], bookmarked: true, run: 'r2', milestone: 'Demo', dueDate: '2026-11-20', archived: true, deleted: true, kindOverride: 'doc' });
  const options = cardPlanningOptions(source);
  expect(options).toEqual({ handMemberIds: ['kimi'], tags: ['sound'], bookmarked: true, run: 'r2', milestone: 'Demo', dueDate: '2026-11-20', archived: true, deleted: true, kindOverride: 'doc' });
  options.tags!.push('other'); options.handMemberIds!.push('pavel');
  expect(source.tags).toEqual(['sound']); expect(source.handMemberIds).toEqual(['kimi']);
  expect(cardPlanningOptions({ archived: false, deleted: false, bookmarked: false, handMemberIds: [], tags: [], run: null, milestone: null, dueDate: null })).toEqual({});
});
