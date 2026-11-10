import { expect, it } from 'vitest';
import type { CatalogCard, CatalogView } from '../src/catalog-contracts.ts';
import { dependencyConflicts, openDependencies } from '../src/dependency-contracts.ts';
import { summarizeCatalog } from '../server/catalog-summary.ts';
import { describeUnlockedCards } from '../server/activity.ts';

function card(id: string, extra: Partial<CatalogCard> = {}): CatalogCard {
  return { id, kind: 'task', title: id, path: `cards/${id}.md`, version: null, state: 'not-started', owner: null,
    markdown: '', sourceHash: 'hash', range: null, deckId: 'work', parentId: null, trackIds: [], ...extra };
}

function catalog(cards: CatalogCard[]): CatalogView {
  return { rootIdentity: 'root', configured: true, formatLanguage: 'en', manifestHash: 'hash', indexedAt: '2026-11-09',
    spaces: [], decks: [], tracks: [], documents: [], warnings: [], cards };
}

it.each([
  { name: 'active unfinished', prerequisite: card('prerequisite'), blocks: true },
  { name: 'accepted', prerequisite: card('prerequisite', { state: 'done' }), blocks: false },
  { name: 'Archive', prerequisite: card('prerequisite', { archived: true }), blocks: false },
  { name: 'Trash', prerequisite: card('prerequisite', { deleted: true }), blocks: false },
  { name: 'missing', prerequisite: undefined, blocks: false },
])('uses the same $name rule for client warnings, summary and unlock history', ({ prerequisite, blocks }) => {
  const dependent = card('dependent', { state: 'in-iteration', iteration: 1, dependsOn: ['prerequisite'] });
  const before = catalog([dependent, card('prerequisite')]);
  const after = catalog(prerequisite ? [dependent, prerequisite] : [dependent]);
  const byId = new Map(after.cards.map(entry => [entry.id, entry]));
  expect(openDependencies(dependent.dependsOn, byId)).toHaveLength(blocks ? 1 : 0);
  expect(dependencyConflicts([dependent], byId, 'started')).toHaveLength(blocks ? 1 : 0);
  const summary = summarizeCatalog(after);
  expect(summary.groups.blocked.cards.map(entry => entry.id)).toEqual(blocks ? ['dependent'] : []);
  expect(summary.groups.ready.cards.map(entry => entry.id)).toEqual(blocks ? [] : ['dependent']);
  const events = describeUnlockedCards(before, after);
  expect(events).toHaveLength(blocks ? 0 : 1);
  if (!blocks) expect(events[0]).toMatchObject({ action: 'card-unlocked', cards: [{ id: dependent.id, title: dependent.title }] });
  if (prerequisite?.archived || prerequisite?.deleted || !prerequisite) {
    expect(summary.dependencies.cards).toContainEqual(expect.objectContaining({ id: 'prerequisite',
      missing: !prerequisite, ...(prerequisite?.archived ? { archived: true } : {}), ...(prerequisite?.deleted ? { deleted: true } : {}) }));
  }
});

it('does not emit an unlock while another active prerequisite remains, or after restoring one', () => {
  const dependent = card('dependent', { dependsOn: ['first', 'second'] });
  const before = catalog([dependent, card('first'), card('second')]);
  const after = catalog([dependent, card('first', { archived: true }), card('second')]);
  expect(describeUnlockedCards(before, after)).toEqual([]);
  const hidden = catalog([dependent, card('first', { deleted: true }), card('second', { state: 'done' })]);
  expect(describeUnlockedCards(hidden, before)).toEqual([]);
  expect(summarizeCatalog(before).groups.blocked.cards.map(entry => entry.id)).toContain('dependent');
});
