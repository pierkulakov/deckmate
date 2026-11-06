import type { CatalogCard, CardKind } from '../src/catalog-contracts.ts';
import { markdownParser } from '../src/markdown-model.ts';

export interface ChecklistProgress { done: number; total: number }
const checklistCache = new Map<string, { markdown: string; progress: ChecklistProgress }>();

function checklistProgress(card: CatalogCard): ChecklistProgress {
  const cached = checklistCache.get(card.id);
  if (cached?.markdown === card.markdown) return cached.progress;
  const progress = { done: 0, total: 0 };
  // Parse only bodies that can contain checkboxes; fenced examples are not actual tasks.
  if (/\[[ xX]\]/u.test(card.markdown)) {
    const visit = (node: { type: string; checked?: boolean | null; children?: unknown[] }) => {
      if (node.type === 'listItem' && typeof node.checked === 'boolean') {
        progress.total += 1;
        if (node.checked) progress.done += 1;
      }
      for (const child of node.children ?? []) visit(child as Parameters<typeof visit>[0]);
    };
    visit(markdownParser.parse(card.markdown));
  }
  checklistCache.set(card.id, { markdown: card.markdown, progress });
  return progress;
}

export function orderSubCards(cards: readonly CatalogCard[], savedOrder: readonly string[] = []): CatalogCard[] {
  const ranks = new Map<string, number>();
  for (const id of savedOrder) if (!ranks.has(id)) ranks.set(id, ranks.size);
  // Missing/stale IDs have no effect; newly attached cards retain their source order at the end.
  return cards.map((card, index) => ({ card, index })).sort((first, second) =>
    (ranks.get(first.card.id) ?? Number.MAX_SAFE_INTEGER) - (ranks.get(second.card.id) ?? Number.MAX_SAFE_INTEGER)
      || first.index - second.index).map(entry => entry.card);
}

// Build once per catalog revision so selection and search do not rescan Markdown (2026-11-03).
export function buildCatalogLookups(cards: readonly CatalogCard[], subCardOrder?: Record<string, string[]>) {
  const cardById = new Map<string, CatalogCard>();
  const childrenByParent = new Map<string, CatalogCard[]>();
  const acceptedChildrenByParent = new Map<string, number>();
  const cardsByDeck = new Map<string | null, CatalogCard[]>();
  const deckCounts = new Map<string | null, number>();
  const trackCounts = new Map<string, number>();
  const trackTasks = new Map<string, Map<string, CatalogCard>>();
  const normalizedSearch = new Map<string, string>();
  const kindCounts: Record<CardKind, number> = { task: 0, hero: 0, doc: 0 };
  const checklistByCard = new Map<string, ChecklistProgress>();
  const outgoingByCard = new Map<string, string[]>();
  const milestoneProgress = new Map<string, { total: number; accepted: number }>();
  const states = new Set<string>();
  const nativeOwners = new Set<string>();
  for (const card of cards) {
    cardById.set(card.id, card);
    // 2026-11-05: index once per revision instead of scanning the catalog from every tile.
    for (const dependencyId of new Set(card.dependsOn ?? [])) {
      if (dependencyId === card.id) continue;
      if (!outgoingByCard.has(dependencyId)) outgoingByCard.set(dependencyId, []);
      outgoingByCard.get(dependencyId)!.push(card.id);
    }
    if (card.kind === 'task' && card.milestone && !card.archived && !card.deleted) {
      const progress = milestoneProgress.get(card.milestone) ?? { total: 0, accepted: 0 };
      progress.total += 1;
      if (card.state === 'done') progress.accepted += 1;
      milestoneProgress.set(card.milestone, progress);
    }
    normalizedSearch.set(card.id, [card.title, card.path, card.version, card.owner, card.markdown].join(' ').toLocaleLowerCase('ru'));
    kindCounts[card.kind] += 1;
    if (!cardsByDeck.has(card.deckId)) cardsByDeck.set(card.deckId, []);
    cardsByDeck.get(card.deckId)!.push(card);
    deckCounts.set(card.deckId, (deckCounts.get(card.deckId) ?? 0) + 1);
    if (card.id.startsWith('card:') && card.owner) nativeOwners.add(card.owner);
    if (card.kind === 'task') {
      checklistByCard.set(card.id, checklistProgress(card));
      if (card.state) states.add(card.state);
      if (card.parentId) {
        // Parents can be Hero or Doc cards; the outer kind check counts only Tasks toward family progress.
        if (!childrenByParent.has(card.parentId)) childrenByParent.set(card.parentId, []);
        childrenByParent.get(card.parentId)!.push(card);
        if (card.state === 'done') acceptedChildrenByParent.set(card.parentId, (acceptedChildrenByParent.get(card.parentId) ?? 0) + 1);
      }
    }
    for (const trackId of new Set(card.trackIds)) {
      trackCounts.set(trackId, (trackCounts.get(trackId) ?? 0) + 1);
      if (card.kind !== 'task') continue;
      if (!trackTasks.has(trackId)) trackTasks.set(trackId, new Map());
      trackTasks.get(trackId)!.set(card.id, card);
    }
  }
  for (const [parentId, children] of childrenByParent) childrenByParent.set(parentId, orderSubCards(children, subCardOrder?.[parentId]));
  const trackProgress = new Map([...trackTasks].map(([trackId, tasks]) => [trackId, {
    total: tasks.size,
    accepted: [...tasks.values()].filter(card => card.state === 'done').length,
  }]));
  for (const id of checklistCache.keys()) if (!cardById.has(id)) checklistCache.delete(id);
  return { cardById, childrenByParent, acceptedChildrenByParent, cardsByDeck, deckCounts, trackCounts, trackProgress,
    normalizedSearch, kindCounts, checklistByCard, outgoingByCard, milestoneProgress,
    states: [...states], nativeOwners: [...nativeOwners].sort((first, second) => first.localeCompare(second, 'ru')) };
}

export type CatalogLookups = ReturnType<typeof buildCatalogLookups>;
