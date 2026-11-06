import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { packagePath } from './package-path.ts';

/** 2026-11-05: demos and project templates share the source/packaged artwork lookup. */
export async function bundledDeckArt(name: string): Promise<string> {
  if (!/^[a-z0-9-]{1,40}$/u.test(name)) throw new Error(`Invalid artwork name: ${name}`);
  const original = packagePath('assets', 'deck-art', `${name}.webp`);
  try { if ((await lstat(original)).isFile()) return original; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const directory = packagePath('dist', 'client', 'assets');
  const files = await readdir(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const filename = files.sort().find(candidate => candidate.startsWith(name + '-') && candidate.endsWith('.webp'));
  if (!filename) throw new Error(`Missing bundled artwork: ${name}.webp. Build Deckmate first.`);
  return path.join(directory, filename);
}
