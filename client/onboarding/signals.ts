import type { CatalogView } from '../../src/catalog-contracts.ts';
import type { OnboardingFacts } from '../../src/onboarding-contracts.ts';
import type { CatalogAction } from '../catalog-store.ts';

// 2026-11-05: the app reports what a person did; onboarding quests listen. An emitter is one line at the place where the
// action is confirmed, never waits and never reads quest progress, so the quests can change without touching the app.

export type AppView = 'deck' | 'hand' | 'timeline' | 'vision';
export type OnboardingPanel = 'activity' | 'shortcuts' | 'members';

export type OnboardingSignal =
  /** A save from this browser was confirmed: the catalog before it and the server's answer. */
  | { type: 'catalog-edit'; action: CatalogAction; before: CatalogView; after: CatalogView }
  /** A newer catalog was read after the files changed: another person, an agent or an editor wrote them. */
  | { type: 'catalog-observed'; before: CatalogView; after: CatalogView }
  /** A top-bar tab was chosen. */
  | { type: 'view'; view: AppView }
  /** A deck was opened from the deck list. */
  | { type: 'deck-opened'; deckId: string }
  /** A panel or dialog became visible. */
  | { type: 'panel-opened'; panel: OnboardingPanel }
  /** A global search query settled (typed and left unchanged); the raw text, filters included. */
  | { type: 'search'; query: string }
  /** A personal preference changed. */
  | { type: 'preference'; name: 'theme' | 'language' }
  /** A card appeared on a Vision board where it was not before. */
  | { type: 'vision-card-added'; cardId: string }
  /** Fresh facts about the project folder from GET /api/onboarding-facts. */
  | { type: 'facts'; facts: OnboardingFacts };

type Listener = (signal: OnboardingSignal) => void;
const listeners = new Set<Listener>();

/** Report an action. Listeners run after the current task, so a quest can never slow down or break the action itself. */
export function emitSignal(signal: OnboardingSignal): void {
  if (listeners.size === 0) return;
  queueMicrotask(() => {
    for (const listener of listeners) {
      try { listener(signal); } catch (error) { console.error('Onboarding quest check failed', error); }
    }
  });
}

export function onSignal(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
