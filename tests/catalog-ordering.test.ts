import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CatalogCard } from '../src/catalog-contracts.ts';
import { defaultCardOrdering, groupAndSortCards, readOrdering, writeOrdering, type CardOrdering } from '../client/catalog-ordering.ts';
import { formatPlanningDate } from '../client/planning-metrics.ts';

const language = vi.hoisted(() => ({ current: 'en' as 'en' | 'ru' }));
vi.mock('../client/i18n.ts', async () => {
  const shared = await import('../src/i18n.ts');
  return {
    defineText: shared.defineText,
    locale: (lang = language.current) => shared.localeOf(lang),
    textNow: <T,>(messages: Record<'en' | 'ru', T>): T => messages[language.current],
  };
});
afterEach(() => { language.current = 'en'; });

function card(id: string, overrides: Partial<CatalogCard> = {}): CatalogCard {
  return { id, kind: 'task', path: 'cards/example.md', version: null, title: id, state: 'not-started', owner: null,
    markdown: '', sourceHash: 'fixture', range: null, deckId: null, trackIds: [], parentId: null, ...overrides };
}

function groups(cards: readonly CatalogCard[], ordering: Partial<CardOrdering> = {}, lookupCards = cards) {
  return groupAndSortCards(cards, new Map(lookupCards.map(entry => [entry.id, entry])), { ...defaultCardOrdering, ...ordering });
}

describe('card ordering', () => {
  it('updates labels and planning dates after a language switch while preserving data IDs and small effort values', () => {
    const cards = [card('working', { state: 'started', effort: 0.0001 }), card('done', { state: 'done' })];
    const english = groups(cards, { order: 'state', direction: 'asc' });
    expect(english.map(group => group.title)).toEqual(['Started', 'Done']);
    expect(groups(cards, { order: 'effort' })[0].title).toBe('0.0001');
    expect(formatPlanningDate('2026-11-05')).toBe('Nov 5');
    language.current = 'ru';
    const russian = groups(cards, { order: 'state', direction: 'asc' });
    expect(russian.map(group => group.title)).toEqual(['В работе', 'Принято']);
    expect(russian.map(group => [group.key, group.state, group.cards.map(entry => entry.id)]))
      .toEqual(english.map(group => [group.key, group.state, group.cards.map(entry => entry.id)]));
    expect(groups(cards, { order: 'effort' })[0].title).toBe('0,0001');
    expect(formatPlanningDate('2026-11-05')).toBe('5 нояб.');
  });

  it('orders priority lanes by direction while No priority, Hero and Doc lanes stay last', () => {
    const cards = [card('doc', { kind: 'doc', priority: 'high' }), card('none'), card('low', { priority: 'low' }),
      card('hero', { kind: 'hero' }), card('high', { priority: 'high' }), card('medium', { priority: 'medium' })];
    const known = [['High', ['high']], ['Medium', ['medium']], ['Low', ['low']]];
    for (const direction of ['asc', 'desc'] as const) {
      expect(groups(cards, { direction }).map(group => [group.title, group.cards.map(entry => entry.id)]))
        .toEqual([...(direction === 'desc' ? known : [...known].reverse()), ['No priority', ['none']], ['Hero Cards', ['hero']], ['Doc Cards', ['doc']]]);
    }
  });

  it('preserves actual unknown states, keeps null separate, and does not turn Hero or Docs into tasks', () => {
    const cards = [card('hero', { kind: 'hero', state: 'done' }), card('custom', { state: 'На внешней проверке' as CatalogCard['state'] }),
      card('accepted', { state: 'done' }), card('working', { state: 'started' }), card('missing', { state: null }), card('doc', { kind: 'doc' })];
    const result = groups(cards, { order: 'state', direction: 'asc' });
    expect(result.map(group => group.state)).toEqual(['started', 'done', 'На внешней проверке', null, null, null]);
    expect(result.map(group => group.title)).toEqual(['Started', 'Done', 'На внешней проверке', 'No state', 'Hero Cards', 'Doc Cards']);
    expect(result.flatMap(group => group.cards.map(entry => entry.id)).sort()).toEqual(cards.map(entry => entry.id).sort());
  });

  it.each(['asc', 'desc'] as const)('applies a secondary %s title order inside each state without changing its identity', direction => {
    const cards = [card('last', { title: 'Zulu', state: 'started' }), card('done', { state: 'done' }),
      card('first', { title: 'Alpha', state: 'started' })];
    const result = groups(cards, { order: 'state', direction: 'asc', then: [{ order: 'title', direction }] });
    expect(result.map(group => group.state)).toEqual(['started', 'done']);
    expect(result[0].cards.map(entry => entry.id)).toEqual(direction === 'asc' ? ['first', 'last'] : ['last', 'first']);
  });

  it.each(['asc', 'desc'] as const)('keeps unknown effort last in %s order, with zero treated as an estimate and stable title/id ties', direction => {
    const cards = [card('missing'), card('three-b', { title: 'Same', effort: 3 }), card('zero', { effort: 0 }),
      card('three-a', { title: 'Same', effort: 3 }), card('nan', { effort: Number.NaN }), card('negative', { effort: -1 })];
    const ordered = groups(cards, { order: 'effort', compact: true, direction })[0].cards.map(entry => entry.id);
    const known = direction === 'asc' ? ['zero', 'three-a', 'three-b'] : ['three-a', 'three-b', 'zero'];
    expect(ordered).toEqual([...known, 'missing', 'nan', 'negative']);
  });

  it.each(['asc', 'desc'] as const)('sorts actual priorities in %s direction without putting missing priority first', direction => {
    const cards = [card('none'), card('medium', { priority: 'medium' }), card('high', { priority: 'high' }), card('low', { priority: 'low' })];
    expect(groups(cards, { order: 'priority', compact: true, direction })[0].cards.map(entry => entry.id))
      .toEqual(direction === 'asc' ? ['low', 'medium', 'high', 'none'] : ['high', 'medium', 'low', 'none']);
  });

  it('orders owners by name and resolves Hero groups from the full lookup across deck boundaries', () => {
    const hero = card('parent', { kind: 'hero', title: 'Sound world', deckId: 'concepts' });
    const children = [card('second', { owner: 'Kimi', parentId: hero.id, deckId: 'audio' }), card('first', { owner: 'GLM', parentId: hero.id }),
      card('loose'), card('dangling', { parentId: 'missing-parent' })];
    expect(groups(children, { order: 'owner', direction: 'asc' }).map(group => group.title)).toEqual(['GLM', 'Kimi', 'Unassigned']);
    const result = groups(children, { order: 'hero', direction: 'asc' }, [hero, ...children]);
    expect(result.map(group => [group.title, group.cards.map(entry => entry.id)])).toEqual([
      ['Sound world', ['first', 'second']], ['No Hero', ['dangling', 'loose']],
    ]);
    expect(result.flatMap(group => group.cards)).not.toContain(hero);
  });

  it('does not mutate the input or cards and gives stable numeric title order regardless of incoming file order', () => {
    const cards = Object.freeze([Object.freeze(card('b', { title: 'Step 10' })), Object.freeze(card('a', { title: 'Step 2' }))]);
    const before = JSON.stringify(cards);
    expect(groups(cards, { order: 'title', direction: 'asc' })[0].cards.map(entry => entry.id)).toEqual(['a', 'b']);
    expect(groups([...cards].reverse(), { order: 'title', direction: 'desc' })[0].cards.map(entry => entry.id)).toEqual(['b', 'a']);
    expect(JSON.stringify(cards)).toBe(before);
    expect(groups([])).toEqual([]);
  });

  it('rejects invalid URL values and round-trips ordering while preserving unrelated query and original query object', () => {
    expect(readOrdering(new URLSearchParams('order=invalid&then=date.up&direction=sideways'))).toEqual(defaultCardOrdering);
    const query = new URLSearchParams('deck=audio&card=card%3Aexample&q=voice&order=state&direction=desc&then=effort.asc');
    const original = query.toString();
    expect(readOrdering(query)).toEqual({ ...defaultCardOrdering, order: 'state', direction: 'desc', then: [{ order: 'effort', direction: 'asc' }] });
    const hero: CardOrdering = { ...defaultCardOrdering, order: 'hero', direction: 'asc', then: [{ order: 'priority', direction: 'desc' }] };
    const result = writeOrdering(query, hero);
    expect(result.get('deck')).toBe('audio');
    expect(result.get('card')).toBe('card:example');
    expect(result.get('q')).toBe('voice');
    expect(readOrdering(result)).toEqual(hero);
    expect(query.toString()).toBe(original);
    const defaults = writeOrdering(result, { ...defaultCardOrdering });
    expect(['order', 'direction', 'then', 'compact', 'tags'].some(key => defaults.has(key))).toBe(false);
    expect(defaults.get('deck')).toBe('audio');
  });
});
