import { expect, it } from 'vitest';
import type { CatalogCard, CatalogView } from '../src/catalog-contracts.ts';
import { nextAgentCard } from '../server/agent-queue.ts';
import { summarizeCatalog } from '../server/catalog-summary.ts';

function card(id: string, extra: Partial<CatalogCard> = {}): CatalogCard {
  return { id, title: id, kind: 'task', path: `cards/${id}.md`, version: null, state: 'not-started',
    owner: null, markdown: '', sourceHash: '', range: null, deckId: null, trackIds: [], parentId: null, ...extra };
}

it.each(['archived', 'deleted', 'missing', 'active', 'done'] as const)
('summary and next agree for a %s prerequisite', async state => {
  const target = card('target', { state: 'in-iteration', iteration: 1, dependsOn: ['prerequisite'], handMemberIds: ['agent'] });
  const prerequisite = card('prerequisite', { archived: state === 'archived', deleted: state === 'deleted',
    state: state === 'done' ? 'done' : 'review' });
  const catalog: CatalogView = { rootIdentity: '', formatLanguage: 'en', configured: true, manifestHash: '', indexedAt: '',
    documents: [], spaces: [], decks: [], tracks: [], warnings: [], cards: [target, ...(state === 'missing' ? [] : [prerequisite])],
    members: [{ id: 'agent', label: 'Agent', kind: 'agent', aliases: [] }] };
  const before = JSON.stringify(catalog);
  const summary = summarizeCatalog(catalog);
  const next = await nextAgentCard(catalog, '', 'agent');
  expect(summary.groups.ready.cards.map(card => card.id)).toEqual(state === 'active' ? [] : [target.id]);
  expect(summary.groups.blocked.cards.map(card => card.id)).toEqual(state === 'active' ? [target.id] : []);
  expect(next.card).toBe(state === 'active' ? null : target);
  expect(JSON.stringify(catalog)).toBe(before);
  if (state === 'archived' || state === 'deleted') {
    prerequisite[state] = false;
    expect(summarizeCatalog(catalog).groups.blocked.cards.map(card => card.id)).toEqual([target.id]);
    expect((await nextAgentCard(catalog, '', 'agent')).card).toBeNull();
  }
});
