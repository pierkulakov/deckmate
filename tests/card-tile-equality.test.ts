import { describe, expect, it } from 'vitest';
import type { CatalogCard, CatalogView } from '../src/catalog-contracts.ts';
import { buildCatalogLookups } from '../client/catalog-lookups.ts';
import { cardTileData, sameCardTileData, type TileData } from '../client/card-tile-equality.ts';

function card(id: string, overrides: Partial<CatalogCard> = {}): CatalogCard {
  return { id, kind: 'task', path: `cards/${id}.md`, version: null, title: id, state: 'not-started', owner: null,
    markdown: '', sourceHash: 'fixture', range: null, deckId: null, trackIds: [], parentId: null, ...overrides };
}

function tile(cards: CatalogCard[], id = cards[0].id, overrides: Partial<CatalogView> = {}): TileData {
  const catalog: CatalogView = { rootIdentity: 'fixture', formatLanguage: 'ru', documents: [], cards, spaces: [], decks: [], tracks: [], warnings: [],
    manifestHash: 'manifest', configured: true, indexedAt: '2026-11-05T00:00:00Z',
    members: [{ id: 'human', label: 'Owner', kind: 'human', aliases: [] }], projectTags: [{ name: 'tag', color: '#123456' }],
    runs: [{ id: 'run', number: 1, start: '2026-11-01', end: '2026-11-30', goal: 'Goal' }],
    milestones: [{ id: 'milestone', title: 'Release', date: '2026-11-30', color: '#123456' }], ...overrides };
  return { card: cards.find(candidate => candidate.id === id)!, lookups: buildCatalogLookups(cards, catalog.subCardOrder),
    members: catalog.members!, tagDefinitions: catalog.projectTags, catalog };
}

describe('card tile catalog equality', () => {
  it('accepts cloned snapshots and unrelated edits, ignoring index timestamps and unrelated registries', () => {
    const cards = [card('shown', { run: 'run', milestone: 'milestone' }), card('unrelated')];
    const previous = tile(cards);
    const cloned = tile(structuredClone(cards), 'shown', structuredClone(previous.catalog));
    expect(sameCardTileData(previous, cloned)).toBe(true);
    const next = tile([cards[0], { ...cards[1], title: 'Changed', effort: 8, state: 'done' }], 'shown', {
      indexedAt: '2026-11-05T01:00:00Z', manifestHash: 'next',
      runs: [...previous.catalog!.runs!, { id: 'other', number: 2, start: '2026-12-01', end: '2026-12-31', goal: 'Other' }],
      milestones: [...previous.catalog!.milestones!, { id: 'other', title: 'Other', date: '2026-12-31', color: '#654321' }],
    });
    expect(sameCardTileData(previous, next)).toBe(true);
  });

  it('detects optimistic properties and metadata despite an unchanged source hash', () => {
    const shown = card('shown');
    const previous = tile([shown]);
    const patches: Partial<CatalogCard>[] = [{ effort: 3 }, { state: 'started' }, { handMemberIds: ['human'] }, { tags: ['tag'] }];
    for (const patch of patches) {
      const next = tile([{ ...shown, ...patch }]);
      expect(next.card.sourceHash).toBe(previous.card.sourceHash);
      expect(sameCardTileData(previous, next)).toBe(false);
    }
  });

  it('retains only this tile’s checklist and refreshes for its progress, not unrelated progress', () => {
    const cards = [card('shown', { markdown: '- [x] First\n- [ ] Second' }), card('other', { markdown: '- [ ] Other' })];
    const previous = tile(cards);
    const catalog = { ...previous.catalog, cards } as CatalogView;
    const compact = cardTileData(cards[0], buildCatalogLookups(cards), catalog);
    expect([...compact.lookups.checklistByCard]).toEqual([['shown', { done: 1, total: 2 }]]);
    expect(sameCardTileData(previous, { ...previous, ...compact })).toBe(true);
    const clone = { ...compact, lookups: structuredClone(compact.lookups) };
    expect(sameCardTileData({ ...previous, ...compact }, { ...previous, ...clone })).toBe(true);
    clone.lookups.checklistByCard.set('shown', { done: 2, total: 2 });
    expect(sameCardTileData({ ...previous, ...compact }, { ...previous, ...clone })).toBe(false);
    clone.lookups.checklistByCard.set('shown', { done: 1, total: 3 });
    expect(sameCardTileData({ ...previous, ...compact }, { ...previous, ...clone })).toBe(false);
    const unrelated = tile([cards[0], { ...cards[1], markdown: '- [x] Other' }]);
    expect(sameCardTileData(previous, unrelated)).toBe(true);
    const toggled = tile([{ ...cards[0], markdown: '- [x] First\n- [x] Second' }, cards[1]]);
    expect(sameCardTileData(previous, toggled)).toBe(false);
  });

  it('tracks incoming/outgoing acceptance and newly added outgoing dependencies', () => {
    const shown = card('shown', { dependsOn: ['incoming'] });
    const incoming = card('incoming');
    const outgoing = card('outgoing', { dependsOn: ['shown'] });
    const previous = tile([shown, incoming, outgoing]);
    expect(sameCardTileData(previous, tile([shown, { ...incoming, state: 'done' }, outgoing]))).toBe(false);
    expect(sameCardTileData(previous, tile([shown, incoming, { ...outgoing, state: 'done' }]))).toBe(false);
    expect(sameCardTileData(previous, tile([shown, incoming, { ...outgoing, dependsOn: [] }]))).toBe(false);
    expect(sameCardTileData(previous, tile([shown, incoming, outgoing, card('another', { dependsOn: ['shown'] })]))).toBe(false);
    expect(sameCardTileData(previous, tile([shown, { ...incoming, title: 'Renamed', state: 'started' }, outgoing]))).toBe(true);
  });

  it('refreshes parent and ordered siblings in an open family popup', () => {
    const parent = card('parent', { kind: 'hero' });
    const shown = card('shown', { parentId: 'parent' });
    const sibling = card('sibling', { parentId: 'parent' });
    const previous = tile([shown, parent, sibling]);
    expect(sameCardTileData(previous, tile([shown, { ...parent, title: 'Renamed' }, sibling]))).toBe(false);
    expect(sameCardTileData(previous, tile([shown, parent, { ...sibling, effort: 5 }]))).toBe(false);
    expect(sameCardTileData(previous, tile([shown, parent, { ...sibling, archived: true }]))).toBe(false);
    expect(sameCardTileData(previous, tile([shown, parent, sibling], 'shown', { subCardOrder: { parent: ['sibling', 'shown'] } }))).toBe(false);
  });

  it('refreshes hero effort and dependency-sensitive child progress', () => {
    const hero = card('hero', { kind: 'hero' });
    const child = card('child', { parentId: 'hero', dependsOn: ['dependency'] });
    const dependency = card('dependency');
    const previous = tile([hero, child, dependency]);
    expect(sameCardTileData(previous, tile([hero, { ...child, effort: 5 }, dependency]))).toBe(false);
    expect(sameCardTileData(previous, tile([hero, child, { ...dependency, state: 'done' }]))).toBe(false);
    expect(sameCardTileData(previous, tile([hero, child, { ...dependency, state: 'started' }]))).toBe(true);
  });

  it('detects relevant run/milestone registry changes and milestone progress', () => {
    const shown = card('shown', { run: 'run', milestone: 'milestone' });
    const related = card('related', { milestone: 'milestone' });
    const previous = tile([shown, related]);
    expect(sameCardTileData(previous, tile([shown, related], 'shown', { runs: [{ ...previous.catalog!.runs![0], goal: 'Changed' }] }))).toBe(false);
    expect(sameCardTileData(previous, tile([shown, related], 'shown', { milestones: [{ ...previous.catalog!.milestones![0], color: '#654321' }] }))).toBe(false);
    expect(sameCardTileData(previous, tile([shown, { ...related, state: 'done' }]))).toBe(false);
    expect(sameCardTileData(previous, tile([shown, { ...related, archived: true }]))).toBe(false);
    expect(sameCardTileData(previous, tile([shown, related], 'shown', { runs: [], milestones: [] }))).toBe(false);
  });

  it('distinguishes absent catalog from a missing planning record', () => {
    const previous = tile([card('shown', { run: 'missing', milestone: 'missing' })]);
    expect(sameCardTileData({ ...previous, catalog: undefined }, previous)).toBe(false);
    expect(sameCardTileData(previous, { ...previous, catalog: undefined })).toBe(false);
  });

  it('refreshes member labels and tag appearance', () => {
    const previous = tile([card('shown', { owner: 'Owner', tags: ['tag'] })]);
    expect(sameCardTileData(previous, { ...previous, members: [{ ...previous.members[0], label: 'Renamed' }] })).toBe(false);
    expect(sameCardTileData(previous, { ...previous, tagDefinitions: [{ name: 'tag', color: '#654321' }] })).toBe(false);
  });
});
