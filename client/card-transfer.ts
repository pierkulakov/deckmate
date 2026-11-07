import type { CardKind, CardPriority, CatalogCard, CatalogDeck, CatalogEdit } from '../src/catalog-contracts.ts';
import { deckAcceptsCard } from '../src/catalog-contracts.ts';
import type { DataSource } from '../src/workspace-contracts.ts';

export interface CardTransferBaseline {
  source: DataSource;
  manifestHash: string;
  cards: Array<{ cardId: string; sourceHash: string; kind: CardKind; deckId: string | null; title: string; priority: CardPriority | null }>;
  ownsSelection: boolean;
}

export function captureCardTransfer(
  activeId: string,
  visibleCards: readonly CatalogCard[],
  selectedIds: ReadonlySet<string>,
  manifestHash: string,
  source: DataSource,
): CardTransferBaseline | null {
  if (source !== 'sandbox') return null;
  const active = visibleCards.find(card => card.id === activeId);
  if (!active) return null;
  const ownsSelection = selectedIds.has(activeId);
  const cards = ownsSelection ? visibleCards.filter(card => selectedIds.has(card.id)) : [active];
  if (cards.length > 1000) return null;
  // 2026-11-04: a watcher refresh during drag must not replace the original write revisions.
  return {
    source,
    manifestHash,
    cards: cards.map(card => ({ cardId: card.id, sourceHash: card.sourceHash, kind: card.kind, deckId: card.deckId, title: card.title, priority: card.priority ?? null })),
    ownsSelection,
  };
}

export function cardTransferTargetIssue(
  baseline: CardTransferBaseline,
  deck: CatalogDeck | null,
): 'same-deck' | 'incompatible' | null {
  const targetId = deck?.id ?? null;
  if (baseline.cards.every(card => card.deckId === targetId)) return 'same-deck';
  if (deck && baseline.cards.some(card => !deckAcceptsCard(deck.kind, card.kind))) return 'incompatible';
  return null;
}

export function cardTransferRequest(
  baseline: CardTransferBaseline,
  deck: CatalogDeck | null,
): Extract<CatalogEdit, { action: 'bulk-assign-deck' }> | null {
  if (cardTransferTargetIssue(baseline, deck)) return null;
  return {
    action: 'bulk-assign-deck',
    deckId: deck?.id ?? null,
    manifestHash: baseline.manifestHash,
    cards: baseline.cards.map(({ cardId, sourceHash }) => ({ cardId, sourceHash })),
  };
}
