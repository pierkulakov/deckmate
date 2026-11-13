import type { CatalogCard } from '../src/catalog-contracts.ts';
import { markdownParser } from '../src/markdown-model.ts';
import { cardBody, markdownText, rememberByRevision, unreadableBlocks } from './card-word-count.ts';

export type DocExcerptBlock = { heading: boolean; text: string };

// 2026-11-09: a Doc tile opens on its own text. A face shows about six short lines, so
// only the start of the body is parsed and a few hundred characters are kept.
const sourceLimit = 1600;
const textLimit = 320;

export function docExcerpt(markdown: string, legacyDocument = false): DocExcerptBlock[] {
  const tree = markdownParser.parse(cardBody(markdown, legacyDocument).slice(0, sourceLimit));
  const blocks: DocExcerptBlock[] = [];
  let length = 0;
  for (const node of tree.children) {
    if (unreadableBlocks.has(node.type)) continue;
    const text = markdownText(node).replace(/\s+/gu, ' ').trim();
    if (!text) continue;
    blocks.push({ heading: node.type === 'heading', text: text.slice(0, textLimit - length) });
    length += text.length;
    if (length >= textLimit) break;
  }
  return blocks;
}

const excerpts = new Map<string, { hash: string; value: DocExcerptBlock[] }>();

export function catalogDocExcerpt(card: Pick<CatalogCard, 'id' | 'sourceHash' | 'markdown'>): DocExcerptBlock[] {
  return rememberByRevision(excerpts, card, () => docExcerpt(card.markdown, card.id.startsWith('doc:')));
}
