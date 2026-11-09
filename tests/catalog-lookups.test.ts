import { describe, expect, it } from 'vitest';
import type { CatalogCard } from '../src/catalog-contracts.ts';
import { buildCatalogLookups, familyChildren } from '../client/catalog-lookups.ts';
import { familyFinished } from '../client/done-impact.ts';

function card(id: string, overrides: Partial<CatalogCard> = {}): CatalogCard {
  return { id, kind: 'task', path: 'features/sound.md', version: null, title: id, state: 'not-started', owner: null,
    markdown: '', sourceHash: 'fixture', range: null, deckId: null, trackIds: [], parentId: null, ...overrides };
}

describe('catalog lookups', () => {
  it('preserves dependency and milestone indicators across catalog revisions', () => {
    const cards = [
      card('target', { dependsOn: ['target'], milestone: 'release' }),
      card('accepted', { dependsOn: ['target', 'target', 'missing'], milestone: 'release', state: 'done' }),
      card('archived', { dependsOn: ['target'], milestone: 'release', archived: true, state: 'done' }),
      card('deleted', { dependsOn: ['target'], milestone: 'release', deleted: true }),
      card('doc', { kind: 'doc', milestone: 'release' }),
      card('hero', { kind: 'hero', milestone: 'release' }),
    ];
    const before = buildCatalogLookups(cards);
    expect(before.outgoingByCard.get('target')).toEqual(['accepted', 'archived', 'deleted']);
    expect(before.outgoingByCard.get('missing')).toEqual(['accepted']);
    expect(before.milestoneProgress.get('release')).toEqual({ total: 2, accepted: 1 });
    const after = buildCatalogLookups([cards[0]!, { ...cards[1]!, dependsOn: [], state: 'not-started', milestone: 'next' }]);
    expect(after.outgoingByCard.size).toBe(0);
    expect(after.milestoneProgress.get('release')).toEqual({ total: 1, accepted: 0 });
    expect(after.milestoneProgress.get('next')).toEqual({ total: 1, accepted: 0 });
    expect(before.outgoingByCard.get('target')).toEqual(['accepted', 'archived', 'deleted']);
    expect(before.milestoneProgress.get('release')).toEqual({ total: 2, accepted: 1 });
  });

  it('counts nested Markdown checklist items without counting fenced examples or Hero progress', () => {
    const markdown = '- [x] First\n  - [ ] Nested\n- [ ] Last\n\n```md\n- [x] Example, not a task\n```\n';
    const before = buildCatalogLookups([card('checklist', { markdown }), card('hero', { kind: 'hero', markdown })]);
    expect(before.checklistByCard.get('checklist')).toEqual({ done: 1, total: 3 });
    expect(before.checklistByCard.has('hero')).toBe(false);
    const after = buildCatalogLookups([card('checklist', { markdown: '- [x] Updated\n' })]);
    expect(after.checklistByCard.get('checklist')).toEqual({ done: 1, total: 1 });
    expect(before.checklistByCard.get('checklist')).toEqual({ done: 1, total: 3 });
  });
  it('counts Task progress separately from Hero and Doc cards across decks', () => {
    const cards = [
      card('hero', { kind: 'hero', deckId: 'assets', state: null, trackIds: ['sound'] }),
      card('accepted', { parentId: 'hero', deckId: 'tasks', state: 'done', trackIds: ['sound', 'sound', 'release'] }),
      card('planned', { parentId: 'hero', deckId: 'tasks', trackIds: ['sound'] }),
      card('doc', { kind: 'doc', parentId: 'hero', state: 'done', trackIds: ['sound'] }),
    ];
    const lookup = buildCatalogLookups(cards);
    expect(lookup.childrenByParent.get('hero')?.map(child => child.id)).toEqual(['accepted', 'planned', 'doc']);
    expect(lookup.acceptedChildrenByParent.get('hero')).toBe(1);
    expect(lookup.trackCounts.get('sound')).toBe(4);
    expect(lookup.trackProgress.get('sound')).toEqual({ total: 2, accepted: 1 });
    expect(lookup.trackProgress.get('release')).toEqual({ total: 1, accepted: 1 });
    expect(lookup.deckCounts.get('tasks')).toBe(2);
    expect(lookup.deckCounts.get(null)).toBe(1);
    expect(lookup.kindCounts).toEqual({ task: 2, hero: 1, doc: 1 });
  });

  it('keeps live Task and Doc children in family order without archived or deleted cards', () => {
    const cards = [
      card('hero', { kind: 'hero', state: null }),
      card('doc', { kind: 'doc', parentId: 'hero', state: null }),
      card('task', { parentId: 'hero' }),
      card('archived', { kind: 'doc', parentId: 'hero', state: null, archived: true }),
      card('deleted', { parentId: 'hero', deleted: true }),
    ];
    const lookup = buildCatalogLookups(cards, { hero: ['task', 'doc'] });
    expect(lookup.childrenByParent.get('hero')?.map(child => child.id)).toEqual(['task', 'doc', 'archived', 'deleted']);
    expect(familyChildren(lookup, 'hero').map(child => child.id)).toEqual(['task', 'doc']);
  });

  it('finishes a family from Task children only, ignoring Doc cards', () => {
    const done = card('done', { state: 'done' });
    const started = card('started', { state: 'started' });
    const doc = card('doc', { kind: 'doc', state: 'done' });
    expect(familyFinished([doc])).toBe(false);
    expect(familyFinished([done, doc])).toBe(true);
    expect(familyFinished([started, doc])).toBe(false);
  });

  it('preserves literal substring search, Russian casing and adjacent fields', () => {
    const lookup = buildCatalogLookups([card('task', { title: 'ГОЛОС', path: 'features/Voice.md', version: '2.1', owner: 'Kimi', markdown: '## РезеРвИстан\n%PARENT_TITLE% OR звук' })]);
    const text = lookup.normalizedSearch.get('task')!;
    for (const query of ['голос features/voice.md', '2.1 kimi', 'kimi ## резерв', 'ервистан', '%parent_title% or звук']) expect(text.includes(query)).toBe(true);
    expect(text.includes('голос звук')).toBe(false);
  });

  it('rebuilds membership, search and canonical owners after an external revision', () => {
    const original = card('card:native', { deckId: 'old', parentId: 'hero', owner: 'Kimi', trackIds: ['sound'], markdown: 'old text' });
    const previous = buildCatalogLookups([original, card('legacy', { owner: 'историческая пометка' })]);
    const changed = { ...original, deckId: 'new', parentId: null, owner: 'GLM', trackIds: [], markdown: 'new text' };
    const current = buildCatalogLookups([changed]);
    expect(current.cardById.get(changed.id)).toBe(changed);
    expect(current.deckCounts.has('old')).toBe(false);
    expect(current.cardsByDeck.get('new')).toEqual([changed]);
    expect(current.childrenByParent.size).toBe(0);
    expect(current.trackProgress.size).toBe(0);
    expect(current.normalizedSearch.get(changed.id)).toContain('new text');
    expect(current.nativeOwners).toEqual(['GLM']);
    expect(previous.nativeOwners).toEqual(['Kimi']);
    expect(previous.deckCounts.get('old')).toBe(1);
  });

  it('does not count repeated task IDs twice in track progress', () => {
    const lookup = buildCatalogLookups([card('task', { trackIds: ['track'] }), card('task', { state: 'done', trackIds: ['track'] })]);
    expect(lookup.trackProgress.get('track')).toEqual({ total: 1, accepted: 1 });
  });
});
