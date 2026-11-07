import type { CardState } from './format-vocabulary.ts';

export interface ActivityReference {
  id: string;
  title: string;
}

/** 2026-11-03: Journal records actions performed by Deckmate, not inferred authorship. */
export interface DeckActivityEvent {
  schema: 1;
  id: string;
  at: string;
  action: string;
  actor: 'Deckmate';
  /**
   * 2026-11-04: member who made the change (header x-deckmate-actor); null — an API call without identity.
   * Absent only in records written before 2026-11-04: notifications skip them, their author is unknown.
   */
  actorMemberId?: string | null;
  summary: string;
  cards: ActivityReference[];
  deckIds: string[];
  details: string[];
  /**
   * 2026-11-04: structured state changes of this event, so Journey metrics never parse `details`.
   * Absent in records written before 2026-11-04 and in events without a state change: metrics ignore those records.
   */
  transitions?: ActivityStateTransition[];
}

/** One card's state change; reason explains why it left review. */
export interface ActivityStateTransition {
  cardId: string;
  from: CardState | null;
  to: CardState | null;
  reason?: string;
}

export interface DeckActivityPage {
  events: DeckActivityEvent[];
  nextCursor: string | null;
  warnings: string[];
}
