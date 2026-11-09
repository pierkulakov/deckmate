import type { CatalogCard, CatalogMember, CatalogView } from '../src/catalog-contracts.ts';
import { familyChildren, type CatalogLookups } from './catalog-lookups.ts';

export type CardTileLookups = Pick<CatalogLookups, 'cardById' | 'childrenByParent' | 'outgoingByCard' | 'milestoneProgress'>;
export type CardTileCatalog = Pick<CatalogView, 'runs' | 'milestones' | 'indexedAt'>;

export interface TileData {
  card: CatalogCard;
  lookups: CardTileLookups;
  members: CatalogMember[];
  tagDefinitions?: CatalogView['projectTags'];
  catalog?: CardTileCatalog;
}

const noIds: readonly string[] = [];

function sameData(previous: unknown, next: unknown): boolean {
  return previous === next || JSON.stringify(previous) === JSON.stringify(next);
}

function sameAcceptance(ids: readonly string[], previous: CardTileLookups, next: CardTileLookups): boolean {
  return ids.every(id => (previous.cardById.get(id)?.state === 'done') === (next.cardById.get(id)?.state === 'done'));
}

/** 2026-11-05: memoized tiles must not retain an entire old catalog revision for each edited card. */
export function cardTileData(card: CatalogCard, lookups: CatalogLookups, catalog: CatalogView) {
  const childrenByParent: CardTileLookups['childrenByParent'] = new Map();
  const relatedIds = new Set([card.id, ...card.dependsOn ?? [], ...lookups.outgoingByCard.get(card.id) ?? []]);
  for (const parentId of [card.parentId, card.kind === 'hero' ? card.id : null]) {
    if (!parentId) continue;
    relatedIds.add(parentId);
    const children = familyChildren(lookups, parentId);
    if (!children.length) continue;
    childrenByParent.set(parentId, children);
    for (const child of children) {
      relatedIds.add(child.id);
      for (const dependencyId of child.dependsOn ?? []) relatedIds.add(dependencyId);
    }
  }
  const cardById: CardTileLookups['cardById'] = new Map();
  for (const id of relatedIds) {
    const related = lookups.cardById.get(id);
    if (related) cardById.set(id, related);
  }
  const outgoingByCard: CardTileLookups['outgoingByCard'] = new Map();
  const outgoing = lookups.outgoingByCard.get(card.id);
  if (outgoing) outgoingByCard.set(card.id, outgoing);
  const milestoneProgress: CardTileLookups['milestoneProgress'] = new Map();
  const progress = card.milestone ? lookups.milestoneProgress.get(card.milestone) : undefined;
  if (card.milestone && progress) milestoneProgress.set(card.milestone, progress);
  return { lookups: { cardById, childrenByParent, outgoingByCard, milestoneProgress },
    catalog: { indexedAt: catalog.indexedAt, runs: catalog.runs?.filter(run => run.id === card.run),
      milestones: catalog.milestones?.filter(milestone => milestone.id === card.milestone) } };
}

function sameFamily(previous: TileData, next: TileData): boolean {
  const parentId = next.card.parentId;
  if (parentId && (!sameData(previous.lookups.cardById.get(parentId), next.lookups.cardById.get(parentId))
    || !sameData(familyChildren(previous.lookups, parentId), familyChildren(next.lookups, parentId)))) return false;
  if (next.card.kind !== 'hero') return true;
  const previousChildren = familyChildren(previous.lookups, next.card.id);
  const nextChildren = familyChildren(next.lookups, next.card.id);
  if (!sameData(previousChildren, nextChildren)) return false;
  // 2026-11-05: a child's segment also changes when its dependency is accepted outside this family.
  return nextChildren.every(child => sameAcceptance(child.dependsOn ?? noIds, previous.lookups, next.lookups));
}

function samePlanning(previous: TileData, next: TileData): boolean {
  const { run, milestone } = next.card;
  if ((run || milestone) && Boolean(previous.catalog) !== Boolean(next.catalog)) return false;
  if (run && !sameData(previous.catalog?.runs?.find(candidate => candidate.id === run), next.catalog?.runs?.find(candidate => candidate.id === run))) return false;
  if (!milestone) return true;
  return sameData(previous.catalog?.milestones?.find(candidate => candidate.id === milestone), next.catalog?.milestones?.find(candidate => candidate.id === milestone))
    && sameData(previous.lookups.milestoneProgress.get(milestone), next.lookups.milestoneProgress.get(milestone));
}

/** 2026-11-05: compare only the catalog data the tile presents; attachment refresh has its own subscription. */
export function sameCardTileData(previous: TileData, next: TileData): boolean {
  // sourceHash alone misses optimistic properties and options/manifest fields projected onto the card.
  if (!sameData(previous.card, next.card) || !sameData(previous.members, next.members)
    || !sameData(previous.tagDefinitions, next.tagDefinitions)) return false;
  if (previous.lookups !== next.lookups) {
    const previousOutgoing = previous.lookups.outgoingByCard.get(next.card.id) ?? noIds;
    const nextOutgoing = next.lookups.outgoingByCard.get(next.card.id) ?? noIds;
    if (!sameData(previousOutgoing, nextOutgoing)
      || !sameAcceptance(next.card.dependsOn ?? noIds, previous.lookups, next.lookups)
      || !sameAcceptance(nextOutgoing, previous.lookups, next.lookups)
      || !sameFamily(previous, next)) return false;
  }
  return samePlanning(previous, next);
}
