import type { DataSource } from '../src/workspace-contracts.ts';

export type View = 'deck' | 'hand' | 'timeline' | 'vision';

export function cardNavigation(href: string, cardId: string, source: DataSource): URL {
  const url = new URL(href);
  const query = new URLSearchParams({ view: 'deck', catalogSource: source, scope: 'all', card: cardId });
  for (const key of ['handMember', 'hands', 'handTab']) {
    const value = url.searchParams.get(key);
    if (value !== null) query.set(key, value);
  }
  url.search = query.toString();
  url.hash = '';
  return url;
}

export function viewNavigation(href: string, current: View, next: View, source: DataSource) {
  const url = new URL(href);
  url.searchParams.set('view', next);
  url.searchParams.set('catalogSource', source);
  return { url, changed: current !== next };
}
