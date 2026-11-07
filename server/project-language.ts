import { parse } from 'yaml';
import { projectFormatLanguage, type FormatLanguage } from '../src/format-vocabulary.ts';
import { readProjectMarkdown } from './native-cards.ts';

/**
 * The project's format language for writers that hold no catalog view (2026-11-06): registry headers, board
 * journal records and attachment names are project files, so they follow the manifest, never the interface
 * language of the request. Writers that already hold a CatalogView use its formatLanguage instead.
 *
 * Only the formatLanguage field is read here. Full manifest validation stays with readManifest in catalog.ts,
 * which card-options.ts and project-tags.ts cannot import: catalog.ts imports them and reads their constants at
 * module load, so the cycle would break. A manifest whose YAML cannot be read still belongs to an existing
 * project without the field and follows the legacy rule; the catalog read reports the broken manifest itself.
 */
export async function projectLanguage(root: string): Promise<FormatLanguage> {
  let bytes: Buffer;
  try { bytes = await readProjectMarkdown(root, 'tasks/deckmate.md'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return projectFormatLanguage(undefined);
    throw error;
  }
  const yaml = /^(?:﻿)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(bytes.toString('utf8'))?.[1];
  let manifest: unknown;
  try { manifest = yaml === undefined ? undefined : parse(yaml); }
  catch { manifest = undefined; }
  return projectFormatLanguage(manifest !== null && typeof manifest === 'object' ? manifest : {});
}
