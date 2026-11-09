import type { CatalogCard } from '../src/catalog-contracts.ts';
import { markdownParser } from '../src/markdown-model.ts';

// The body a tile reads: legacy projections also carry YAML and the H1, which readDocLayout leaves out.
export function cardBody(markdown: string, legacyDocument = false): string {
  let body = markdown;
  if (legacyDocument) {
    // 2026-11-04: legacy projections include YAML and H1; match the body returned by readDocLayout.
    const text = markdown.replace(/^\uFEFF/u, '');
    const tree = markdownParser.parse(text);
    const firstBlock = tree.children[0];
    const frontmatterEnd = firstBlock?.type === 'yaml' ? firstBlock.position?.end.offset ?? 0 : 0;
    const heading = tree.children.find(node => node.type === 'heading' && node.depth === 1
      && (node.position?.start.offset ?? 0) >= frontmatterEnd);
    const headerEnd = heading?.position?.end.offset ?? frontmatterEnd;
    body = text;
    if (headerEnd > 0) {
      const newline = text.indexOf('\n', headerEnd);
      body = text.slice(newline < 0 ? text.length : newline + 1);
    }
  }
  return body;
}

export function countCardWords(markdown: string, legacyDocument = false): number {
  const content = cardBody(markdown, legacyDocument).trim();
  return content ? content.split(/\s+/u).length : 0;
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
