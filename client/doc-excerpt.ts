import type { Nodes } from 'mdast';
import type { CatalogCard } from '../src/catalog-contracts.ts';
import { markdownParser } from '../src/markdown-model.ts';
import { cardBody, rememberByRevision } from './card-word-count.ts';

export type DocExcerptBlock = { heading: boolean; text: string };

// 2026-11-09: a Doc tile opens on its own text (the author's choice «Страница»). A face shows about six short lines, so
// only the start of the body is parsed and a few hundred characters are kept.
const sourceLimit = 1600;
const textLimit = 320;
const spacedNodes = new Set<string>(['list', 'listItem', 'table', 'tableRow', 'tableCell', 'blockquote']);
const skippedBlocks = new Set<string>(['yaml', 'code', 'html', 'thematicBreak', 'definition', 'footnoteDefinition']);

function plainText(node: Nodes): string {
  if (node.type === 'text' || node.type === 'inlineCode') return node.value;
  if (node.type === 'image') return node.alt ?? '';
  if (node.type === 'break') return ' ';
  if (!('children' in node)) return '';
  return node.children.map(child => plainText(child)).join(spacedNodes.has(node.type) ? ' ' : '');
}

export function docExcerpt(markdown: string, legacyDocument = false): DocExcerptBlock[] {
  const tree = markdownParser.parse(cardBody(markdown, legacyDocument).slice(0, sourceLimit));
  const blocks: DocExcerptBlock[] = [];
  let length = 0;
  for (const node of tree.children) {
    if (skippedBlocks.has(node.type)) continue;
    const text = plainText(node).replace(/\s+/gu, ' ').trim();
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
