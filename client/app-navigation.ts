import type { DataSource } from '../src/workspace-contracts.ts';

export type View = 'deck' | 'hand' | 'timeline' | 'vision';

export function viewNavigation(href: string, current: View, next: View, source: DataSource) {
  const url = new URL(href);
  url.searchParams.set('view', next);
  url.searchParams.set('catalogSource', source);
  return { url, changed: current !== next };
}
