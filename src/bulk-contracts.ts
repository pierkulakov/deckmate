import type { CardPriority, CatalogCardSelection } from './catalog-contracts.ts';
import type { CardState } from './format-vocabulary.ts';

/** 2026-11-03: Project-local planning metadata; MD is primary, never SQLite. */
export interface CardOptions {
  handMemberIds?: string[];
  bookmarked?: boolean;
  tags?: string[];
  run?: string | null;
  milestone?: string | null;
  dueDate?: string | null;
  archived?: boolean;
  deleted?: boolean;
  /** Legacy headings retain their ID and source grammar when their card role changes. */
  kindOverride?: 'task' | 'doc' | 'hero';
  /** Hand slots, 2026-11-04: member ID → slot number of the card in that member's hand. */
  handOrder?: Record<string, number>;
  /** Acceptance date YYYY-MM-DD, written on completion; feeds the Done pile and auto-archive. */
  doneAt?: string | null;
}

export interface BulkOutcome {
  applied: string[];
  unchanged: string[];
  pending: string[];
  created?: string[];
  warnings: string[];
}

export type CopyProperty = 'owner' | 'effort' | 'priority' | 'tags' | 'run' | 'milestone' | 'dueDate' | 'tracks';
export type BulkChange =
  | { kind: 'properties'; owner?: string | null; effort?: number | null; priority?: CardPriority | null }
  | { kind: 'state'; state: CardState | (string & {}); returnReason?: string | null }
  | { kind: 'create-parent'; cardId: string; title: string; deckId: string | null }
  | { kind: 'promote-parent'; cardId: string; sourceHash: string; expectedParentId: string | null; deckId: string | null }
  | { kind: 'parent'; parentId: string | null; parentSourceHash: string | null }
  | { kind: 'options'; patch: Omit<CardOptions, 'kindOverride' | 'handMemberIds' | 'tags'> }
  | { kind: 'hand'; memberId: string; mode: 'add' | 'remove' }
  | { kind: 'tags'; tags: string[]; mode: 'add' | 'remove' }
  | { kind: 'convert'; cardKind: 'task' | 'doc'; deckId: string | null }
  | { kind: 'duplicate'; deckId: string | null; properties: CopyProperty[]; copies: { cardId: string; newCardId: string }[] }
  | { kind: 'track'; trackId: string; mode: 'add' | 'remove' };

export interface BulkEditRequest {
  action: 'bulk-edit-cards';
  manifestHash: string;
  optionsHash: string;
  cards: CatalogCardSelection[];
  change: BulkChange;
}
