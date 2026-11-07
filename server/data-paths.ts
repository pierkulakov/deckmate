import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { canonicalDataPath, legacyDataPath } from '../src/brand-compat.ts';

async function exists(root: string, relative: string): Promise<boolean> {
  try { await lstat(path.join(root, relative)); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

/** Select a name only; callers still perform all containment and symlink checks (2026-11-05). */
export async function resolveDataPath(root: string, relative: string): Promise<string> {
  const current = canonicalDataPath(relative);
  const legacy = legacyDataPath(current);
  if (current === legacy) return relative;
  if (await exists(root, current)) return current;
  if (await exists(root, legacy)) return legacy;
  // Journals and assets append into the existing directory, even for a new filename.
  const prefix = /^tasks\/deckmate-(?:activity|assets)(?=\/|$)/u.exec(current)?.[0];
  if (prefix && !await exists(root, prefix) && await exists(root, legacyDataPath(prefix))) {
    return legacy;
  }
  return current;
}
