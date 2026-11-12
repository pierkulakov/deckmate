import type { Nodes } from 'mdast';
import type { CatalogCard } from '../src/catalog-contracts.ts';
import { markdownParser } from '../src/markdown-model.ts';

/** Where a legacy document's reading body starts: its projection carries YAML and an H1 that readDocLayout leaves out. */
function legacyBodyStart(children: readonly Nodes[]): number {
  const frontmatterEnd = children[0]?.type === 'yaml' ? children[0].position?.end.offset ?? 0 : 0;
  const heading = children.find(node => node.type === 'heading' && node.depth === 1
    && (node.position?.start.offset ?? 0) >= frontmatterEnd);
  return heading?.position?.end.offset ?? frontmatterEnd;
}

// The body a tile reads: legacy projections also carry YAML and the H1, which readDocLayout leaves out.
export function cardBody(markdown: string, legacyDocument = false): string {
  if (!legacyDocument) return markdown;
  const text = markdown.replace(/^\uFEFF/u, '');
  const headerEnd = legacyBodyStart(markdownParser.parse(text).children);
  if (headerEnd <= 0) return text;
  const newline = text.indexOf('\n', headerEnd);
  return text.slice(newline < 0 ? text.length : newline + 1);
}

/** Blocks that carry structure rather than reading text: markup, raw data and code stay out of excerpts and word counts. */
export const unreadableBlocks = new Set<string>(['yaml', 'code', 'html', 'thematicBreak', 'definition', 'footnoteDefinition']);
const spacedBlocks = new Set<string>(['list', 'listItem', 'table', 'tableRow', 'tableCell', 'blockquote']);

/** The reading text of a Markdown node: emphasis, links and other markup dissolve; image alt text survives. */
export function markdownText(node: Nodes): string {
  if (node.type === 'text' || node.type === 'inlineCode') return node.value;
  if (node.type === 'image') return node.alt ?? '';
  if (node.type === 'break') return ' ';
  if (!('children' in node)) return '';
  return node.children.map(child => markdownText(child)).join(spacedBlocks.has(node.type) ? ' ' : '');
}

// A word carries a letter or a digit, so markup left between words and stray punctuation never count; Cyrillic and Latin both qualify.
const wordShape = /[\p{L}\p{N}]/u;

/** Words of a card's reading text: no front matter, no Markdown markup, once per revision (see countCatalogCardWords). */
export function countCardWords(markdown: string, legacyDocument = false): number {
  const text = legacyDocument ? markdown.replace(/^\uFEFF/u, '') : markdown;
  const children = markdownParser.parse(text).children;
  const bodyStart = legacyDocument ? legacyBodyStart(children) : 0;
  let count = 0;
  for (const block of children) {
    if ((block.position?.start.offset ?? 0) < bodyStart) continue;
    if (unreadableBlocks.has(block.type)) continue;
    for (const token of markdownText(block).split(/\s+/u)) {
      if (wordShape.test(token)) count += 1;
    }
  }
  return count;
}

const revisionLimit = 512;

// 2026-11-05: keep what a tile derives from a card's text across remounts, without retaining Markdown or old revisions.
export function rememberByRevision<T>(cache: Map<string, { hash: string; value: T }>, card: Pick<CatalogCard, 'id' | 'sourceHash'>, compute: () => T): T {
  const cached = cache.get(card.id);
  if (card.sourceHash && cached?.hash === card.sourceHash) {
    cache.delete(card.id);
    cache.set(card.id, cached);
    return cached.value;
  }
  const value = compute();
  cache.delete(card.id);
  if (card.sourceHash) {
    cache.set(card.id, { hash: card.sourceHash, value });
    if (cache.size > revisionLimit) cache.delete(cache.keys().next().value!);
  }
  return value;
}

const wordCounts = new Map<string, { hash: string; value: number }>();

export function countCatalogCardWords(card: Pick<CatalogCard, 'id' | 'sourceHash' | 'markdown'>): number {
  return rememberByRevision(wordCounts, card, () => countCardWords(card.markdown, card.id.startsWith('doc:')));
}
