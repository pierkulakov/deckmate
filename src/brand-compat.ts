/** Persisted project paths retain their spelling until an explicit data migration (2026-11-05). */
export function canonicalDataPath(relative: string): string {
  return relative.replace(/^tasks\/freetion(?=(?:-(?:card-options|tags|runs|milestones|notifications))?\.md$|-(?:activity|assets)(?:\/|$))/u, 'tasks/deckmate');
}

export function legacyDataPath(relative: string): string {
  return relative.replace(/^tasks\/deckmate(?=(?:-(?:card-options|tags|runs|milestones|notifications))?\.md$|-(?:activity|assets)(?:\/|$))/u, 'tasks/freetion');
}
