import { readStoredValue } from './storage.ts';
import type { CardContent, CardKind, CardPriority } from '../src/catalog-contracts.ts';
import type { DataSource } from '../src/workspace-contracts.ts';

/**
 * Unsaved card text kept after Cancel (2026-11-05): instead of a confirmation dialog the card shows
 * "unsaved changes" with Continue editing and Discard changes. The draft keeps the revision it was based on, so a file
 * changed meanwhile opens as the usual content conflict, never as a silent overwrite. Stored per browser, per card.
 */
interface StashedCardDraft { draft: string; baseline: CardContent & { manifestHash: string } }

const keyOf = (source: DataSource, cardId: string) => `deckmate:card-draft:${source}:${cardId}`;

export function readCardDraft(source: DataSource, cardId: string): StashedCardDraft | null {
  try {
    const stored = readStoredValue(localStorage, keyOf(source, cardId));
    if (!stored) return null;
    const value = JSON.parse(stored) as Partial<StashedCardDraft>;
    if (typeof value.draft !== 'string' || !value.baseline || typeof value.baseline.sourceHash !== 'string') return null;
    return value as StashedCardDraft;
  } catch { return null; }
}

export function writeCardDraft(source: DataSource, cardId: string, value: StashedCardDraft): boolean {
  try { localStorage.setItem(keyOf(source, cardId), JSON.stringify(value)); return true; } catch { return false; }
}

export function removeCardDraft(source: DataSource, cardId: string): void {
  try { localStorage.removeItem(keyOf(source, cardId)); } catch { /* Nothing stored, or storage is unavailable. */ }
}

/**
 * An unsaved New Card kept when the composer closes (2026-11-05): no confirmation dialog; the next New Card opened for the
 * same deck and parent brings it back with a «Discard draft» banner. Stored per browser.
 */
export interface NewCardDraft { deckId: string; kind: CardKind; draft: string; owner: string | null; trackIds: string[]; effort: string; priority: CardPriority | '' }

const newCardKeyOf = (source: DataSource, place: string) => `deckmate:new-card-draft:${source}:${place}`;

export function readNewCardDraft(source: DataSource, place: string): NewCardDraft | null {
  try {
    const stored = readStoredValue(localStorage, newCardKeyOf(source, place));
    if (!stored) return null;
    const value = JSON.parse(stored) as Partial<NewCardDraft>;
    if (typeof value.draft !== 'string' || typeof value.deckId !== 'string' || typeof value.kind !== 'string' || !Array.isArray(value.trackIds)
      || typeof value.effort !== 'string' || typeof value.priority !== 'string') return null;
    return { deckId: value.deckId, kind: value.kind, draft: value.draft, owner: typeof value.owner === 'string' ? value.owner : null,
      trackIds: value.trackIds.filter((id): id is string => typeof id === 'string'), effort: value.effort, priority: value.priority };
  } catch { return null; }
}

export function writeNewCardDraft(source: DataSource, place: string, value: NewCardDraft): void {
  try { localStorage.setItem(newCardKeyOf(source, place), JSON.stringify(value)); } catch { /* Storage is full or unavailable: the draft is lost, as before. */ }
}

export function removeNewCardDraft(source: DataSource, place: string): void {
  try { localStorage.removeItem(newCardKeyOf(source, place)); } catch { /* Nothing stored, or storage is unavailable. */ }
}
