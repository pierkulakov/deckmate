import type { CardKind, CatalogCard, CatalogTrack, CatalogView } from '../src/catalog-contracts.ts';
import type { CardOptions } from '../src/bulk-contracts.ts';
import { cardPlanningOptions, isActiveCatalogCard } from '../src/catalog-hand.ts';
import { openDependencies } from '../src/dependency-contracts.ts';
import { shortReference } from '../src/references.ts';
import { defineText, serverText } from './i18n.ts';

const summaryText = defineText({
  trackRequired: "Enter a nonempty Track name or ID.",
  limit: "The summary limit must be an integer from 0 to 100.",
  ambiguousTrack: (query: string, matches: { title: string; id: string }[]) => `Ambiguous Track “${query}”: ${matches.map(track => `${track.title} (${track.id})`).join(', ')}.`,
  missingTrack: (query: string) => `Track “${query}” not found.`,
}, {
  trackRequired: "Укажите непустое имя или ID трека.",
  limit: "Лимит сводки должен быть целым числом от 0 до 100.",
  ambiguousTrack: (query: string, matches: { title: string; id: string }[]) => `Неоднозначный трек «${query}»: ${matches.map(track => `${track.title} (${track.id})`).join(', ')}.`,
  missingTrack: (query: string) => `Трек «${query}» не найден.`,
});


export interface SummaryCard extends CardOptions {
  id: string;
  ref: string;
  link: string;
  title: string;
  state: string | null;
  owner: string | null;
  deck: { id: string; title: string | null } | null;
  parent: { id: string; title: string | null } | null;
  dependencies: string[];
}
export interface SummaryDependency extends CardOptions {
  id: string;
  ref: string;
  link: string;
  title: string | null;
  state: string | null;
  missing: boolean;
}
export interface SummaryGroup<T> { total: number; truncated: boolean; cards: T[] }
export interface CatalogSummary {
  track: { id: string; title: string } | null;
  limit: number;
  counts: {
    total: number;
    kind: Record<CardKind, number>;
    taskStates: { state: string | null; count: number }[];
    owners: { owner: string | null; count: number }[];
  };
  groups: Record<'doing' | 'review' | 'blocked' | 'ready' | 'planned' | 'stale', SummaryGroup<SummaryCard>>;
  dependencies: SummaryGroup<SummaryDependency>;
}

const fold = (text: string) => text.trim().toLocaleLowerCase('ru-RU');
const accepted = (card: CatalogCard | undefined) => card?.state === 'done';

function selectTrack(tracks: CatalogTrack[], requested: string | undefined): CatalogTrack | null {
  if (requested === undefined) return null;
  const query = requested.trim();
  if (!query) throw new Error(serverText(summaryText).trackRequired);
  const exactId = tracks.find(track => track.id === query);
  if (exactId) return exactId;
  const title = fold(query);
  const exactTitles = tracks.filter(track => fold(track.title) === title);
  const matches = exactTitles.length > 0 ? exactTitles : tracks.filter(track => fold(track.title).includes(title));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new Error(serverText(summaryText).ambiguousTrack(query, matches));
  throw new Error(serverText(summaryText).missingTrack(query));
}

function countValues(values: (string | null)[]): [string | null, number][] {
  const counts = new Map<string | null, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((first, second) => second[1] - first[1] || (first[0] ?? '').localeCompare(second[0] ?? '', 'ru'));
}

function group<T>(cards: T[], limit: number): SummaryGroup<T> {
  return { total: cards.length, truncated: cards.length > limit, cards: cards.slice(0, limit) };
}

export function summarizeCatalog(catalog: CatalogView, track?: string, limit = 5, staleIds: ReadonlySet<string> = new Set()): CatalogSummary {
  if (!Number.isInteger(limit) || limit < 0 || limit > 100) throw new Error(serverText(summaryText).limit);
  const selectedTrack = selectTrack(catalog.tracks, track);
  const selectedCards = catalog.cards.filter(card => isActiveCatalogCard(card) && (!selectedTrack || card.trackIds.includes(selectedTrack.id)));
  const selectedIds = new Set(selectedCards.map(card => card.id));
  const byId = new Map(catalog.cards.map(card => [card.id, card]));
  const decks = new Map(catalog.decks.map(deck => [deck.id, deck.title]));
  const tasks = selectedCards.filter(card => card.kind === 'task');
  const isBlocked = (card: CatalogCard) => !accepted(card) && openDependencies(card.dependsOn, byId).length > 0;
  const compact = (card: CatalogCard): SummaryCard => {
    const ref = shortReference('c', card.id);
    return { id: card.id, ref, link: `/r/${ref}`, title: card.title, state: card.state, owner: card.owner, ...cardPlanningOptions(card),
      deck: card.deckId === null ? null : { id: card.deckId, title: decks.get(card.deckId) ?? null },
      parent: card.parentId === null ? null : { id: card.parentId, title: byId.get(card.parentId)?.title ?? null },
      dependencies: [...(card.dependsOn ?? [])] };
  };
  const filtered = (predicate: (card: CatalogCard) => boolean) => group(tasks.filter(predicate).map(compact), limit);
  const dependencyIds = [...new Set(tasks.flatMap(card => card.dependsOn ?? []))].filter(id => !selectedIds.has(id));
  // External prerequisites need context; the selected track alone cannot explain its blockers.
  dependencyIds.sort((first, second) => Number(accepted(byId.get(first))) - Number(accepted(byId.get(second)))
    || Number(byId.has(first)) - Number(byId.has(second)) || first.localeCompare(second));
  const dependencies = dependencyIds.map(id => {
    const dependency = byId.get(id);
    const ref = shortReference('c', id);
    return { id, ref, link: `/r/${ref}`, title: dependency?.title ?? null, state: dependency?.state ?? null, missing: dependency === undefined,
      ...(dependency ? cardPlanningOptions(dependency) : {}) };
  });
  const kind: Record<CardKind, number> = { task: 0, hero: 0, doc: 0 };
  for (const card of selectedCards) kind[card.kind] += 1;
  return {
    track: selectedTrack ? { id: selectedTrack.id, title: selectedTrack.title } : null,
    limit,
    counts: { total: selectedCards.length, kind,
      taskStates: countValues(tasks.map(card => card.state)).map(([state, count]) => ({ state, count })),
      owners: countValues(tasks.map(card => card.owner)).map(([owner, count]) => ({ owner, count })) },
    groups: {
      doing: filtered(card => card.state === 'started'),
      review: filtered(card => card.state === 'review'),
      blocked: filtered(isBlocked),
      ready: filtered(card => card.state === 'in-iteration' && Number.isInteger(card.iteration) && (card.iteration ?? 0) > 0 && !isBlocked(card)),
      planned: filtered(card => card.state === 'not-started'),
      stale: filtered(card => card.state === 'started' && staleIds.has(card.id)),
    },
    dependencies: group(dependencies, limit),
  };
}
