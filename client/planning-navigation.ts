import type { DataSource } from '../src/workspace-contracts.ts';
import type { PlanningTarget } from './components/PlanningScope.tsx';

/** Timeline restores its selection using the same project/source key for Hand and the Decks pulse. */
export function navigateToPlanning(source: DataSource, rootIdentity: string, target: PlanningTarget): void {
  try {
    localStorage.setItem(`deckmate-timeline:${source}:${rootIdentity}`, JSON.stringify(target));
  } catch { /* The overview remains available when storage is blocked. */ }
  location.href = `/?view=timeline&catalogSource=${encodeURIComponent(source)}`;
}
