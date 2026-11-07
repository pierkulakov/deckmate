import type { CatalogCard, CatalogDeckManualOrder } from './catalog-contracts.ts';
import { defaultLang, defineText, type Lang } from './i18n.ts';

const text = defineText({ duplicateCards: 'Duplicate Cards in the manual order.', zoneNotFound: 'Zone not found in this Deck.' },
  { duplicateCards: 'Повторяющиеся карточки в ручном порядке.', zoneNotFound: 'Зона не найдена в этой колоде.' });

const titleCollator = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });
const priorityValues = { low: 1, medium: 2, high: 3 } as const;

function creationValue(card: CatalogCard): number | null {
  if (!card.createdAt) return null;
  const value = Date.parse(card.createdAt);
  return Number.isFinite(value) ? value : null;
}

function effortValue(card: CatalogCard): number | null {
  return typeof card.effort === 'number' && Number.isFinite(card.effort) && card.effort >= 0 ? card.effort : null;
}

/** Break ties by priority, effort, then creation date; the title keeps the result deterministic. */
export function compareManualFallback(first: CatalogCard, second: CatalogCard): number {
  const firstPriority = first.priority ? priorityValues[first.priority] : null;
  const secondPriority = second.priority ? priorityValues[second.priority] : null;
  if (firstPriority !== secondPriority) {
    if (firstPriority === null) return 1;
    if (secondPriority === null) return -1;
    return secondPriority - firstPriority;
  }
  const firstEffort = effortValue(first);
  const secondEffort = effortValue(second);
  if (firstEffort !== secondEffort) {
    if (firstEffort === null) return 1;
    if (secondEffort === null) return -1;
    return firstEffort - secondEffort;
  }
  const firstCreated = creationValue(first);
  const secondCreated = creationValue(second);
  if (firstCreated !== secondCreated) {
    if (firstCreated === null) return 1;
    if (secondCreated === null) return -1;
    return firstCreated - secondCreated;
  }
  return titleCollator.compare(first.title, second.title) || (first.id < second.id ? -1 : first.id > second.id ? 1 : 0);
}

/**
 * Materializes the visible Manual Order without changing stored lanes. Unknown IDs disappear; cards absent from the
 * stored lists join the topmost Zone (or the flat list) in the same fallback order on the client and server.
 */
export function completeDeckManualOrder(cards: readonly CatalogCard[], order: CatalogDeckManualOrder): CatalogDeckManualOrder {
  const cardById = new Map(cards.map(card => [card.id, card]));
  const listed = new Set<string>();
  function existingIds(cardIds: readonly string[]): string[] {
    const result: string[] = [];
    for (const cardId of cardIds) {
      if (listed.has(cardId) || !cardById.has(cardId)) continue;
      listed.add(cardId);
      result.push(cardId);
    }
    return result;
  }
  // Existing IDs must be marked before computing the unlisted tail.
  const zones = order.zones ?? [];
  if (zones.length > 0) {
    const zoneOrder: Record<string, string[]> = {};
    for (const zone of zones) zoneOrder[zone.id] = existingIds(order.zoneOrder?.[zone.id] ?? []);
    const remainder = cards.filter(card => !listed.has(card.id)).sort(compareManualFallback).map(card => card.id);
    zoneOrder[zones[0].id].push(...remainder);
    return { zones: zones.map(zone => ({ ...zone })), zoneOrder };
  }
  const flatOrder = existingIds(order.flatOrder ?? []);
  const remainder = cards.filter(card => !listed.has(card.id)).sort(compareManualFallback).map(card => card.id);
  return { flatOrder: [...flatOrder, ...remainder] };
}

/** Appends cards to the chosen Zone, or to the topmost Zone when none was chosen. */
export function appendCardsToDeckOrder(cards: readonly CatalogCard[], order: CatalogDeckManualOrder, cardIds: readonly string[], zoneId?: string | null, lang: Lang = defaultLang): CatalogDeckManualOrder {
  const next = completeDeckManualOrder(cards, order);
  const moving = new Set(cardIds);
  if (moving.size !== cardIds.length) throw new Error(text[lang].duplicateCards);
  const zones = next.zones ?? [];
  if (zones.length === 0) {
    if (zoneId) throw new Error(text[lang].zoneNotFound);
    next.flatOrder = [...(next.flatOrder ?? []).filter(cardId => !moving.has(cardId)), ...cardIds];
    return next;
  }
  const targetZoneId = zoneId ?? zones[0].id;
  if (!zones.some(zone => zone.id === targetZoneId)) throw new Error(text[lang].zoneNotFound);
  const zoneOrder = Object.fromEntries(Object.entries(next.zoneOrder ?? {}).map(([id, ids]) => [id, ids.filter(cardId => !moving.has(cardId))]));
  zoneOrder[targetZoneId].push(...cardIds);
  return { zones, zoneOrder };
}
