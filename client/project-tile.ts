// 2026-11-08: a mirror of tilePalette/tileColor from desktop/launcher/launcher.js. The launcher is a separate build,
// so the client cannot import it; when the palette or the hash changes there, change it here in the same commit —
// tests/recent-projects.test.tsx reads the launcher source as text and fails while the two are apart.

export const tilePalette = ['#7a52d6', '#3f8f7c', '#b2742a', '#4d6fb8', '#a84a6e', '#5f8a3a', '#8a5bb0', '#2f7f99'];

/** A stable deck color per project name, so one project gets the same tile in the launcher and in the menu. */
export function tileColor(name: string): string {
  let hash = 0;
  // for-of yields whole code points, so the ?? 0 branch never runs; it only satisfies strict null checks.
  for (const char of String(name ?? '')) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return tilePalette[hash % tilePalette.length];
}

/** The two first letters shown in the tile window — the paired function is the tile.dataset.initials expression in
 *  desktop/launcher/launcher.js (renderRecentItem). Like tileColor above, it is mirrored by hand because the launcher
 *  is a separate build the client cannot import; tests/recent-projects.test.tsx fails while the two are apart. */
export function tileInitials(name: string): string {
  return String(name ?? '').trim().split(/[^\p{L}\p{N}]+/u).filter(Boolean).slice(0, 2)
    .map(word => Array.from(word)[0]).join('').toLocaleUpperCase();
}
