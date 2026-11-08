// One visual state per Sub Card, shared by the family rows, the progress strip and the Journey track (2026-11-08).
// A second mapping of card states to visual states would be a defect; keep this module the only source.
import type { CatalogCard } from '../src/catalog-contracts.ts';
import { defineText, type Lang } from './i18n.ts';
import { stateLabel } from './locales/common.ts';

const subCardStates = { accepted: 'done', working: 'started', review: 'review', planned: 'not-started' } as const;
export type SubCardVisualState = keyof typeof subCardStates | 'blocked';

const text = defineText({
  blocked: 'Blocked by dependency',
}, {
  blocked: 'заблокировано зависимостью',
});

/** The state a Sub Card shows in progress views: accepted, or blocked while any dependency is not done. */
export function subCardVisualState(card: CatalogCard, cardsById: ReadonlyMap<string, CatalogCard>): SubCardVisualState {
  if (card.state === 'done') return 'accepted';
  if ((card.dependsOn ?? []).some(id => cardsById.get(id)?.state !== 'done')) return 'blocked';
  if (card.state === 'started') return 'working';
  if (card.state === 'review') return 'review';
  return 'planned';
}

/** The visual state's own label in the interface language. */
export function subCardStateLabel(state: SubCardVisualState, lang: Lang): string {
  return state === 'blocked' ? text[lang].blocked : stateLabel(subCardStates[state], lang);
}
