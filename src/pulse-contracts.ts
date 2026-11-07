// Decks home pulse (2026-11-06): what is moving in the project right now, one strip above the spaces.
// The server computes it from the cards, the runs and the activity journal: GET /api/project-pulse?source=<source>.

export interface ProjectPulse {
  /** Tasks in the started state; ownerIds are their owners' member IDs, most frequent first, at most six. */
  inProgress: { count: number; ownerIds: string[] };
  /** Tasks in review; the oldest one's deck and the moment it entered review (ISO), when the journal knows it. */
  review: { count: number; oldestSince: string | null; deckId: string | null };
  /** Tasks accepted per day over the last 14 project-local days, oldest first; the last entry is today. */
  accepted: { days: number[]; total: number };
  /** The current Run of the first schedule: accepted and all Tasks in it, and its last day (YYYY-MM-DD). */
  run: { id: string; title: string; done: number; total: number; end: string } | null;
  /** Cards that belong to no deck. */
  withoutDeck: number;
}
