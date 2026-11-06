import type { CatalogCard } from '../src/catalog-contracts.ts';
import { markdownParser } from '../src/markdown-model.ts';

export function countCardWords(markdown: string, legacyDocument = false): number {
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
  const content = body.trim();
  return content ? content.split(/\s+/u).length : 0;
}

const wordCountLimit = 512;
const wordCounts = new Map<string, { hash: string; count: number }>();

export function countCatalogCardWords(card: Pick<CatalogCard, 'id' | 'sourceHash' | 'markdown'>): number {
  // 2026-11-05: keep counts across tile remounts without retaining Markdown or old revisions.
  const cached = wordCounts.get(card.id);
  if (card.sourceHash && cached?.hash === card.sourceHash) {
    wordCounts.delete(card.id);
    wordCounts.set(card.id, cached);
    return cached.count;
  }
  const count = countCardWords(card.markdown, card.id.startsWith('doc:'));
  wordCounts.delete(card.id);
  if (card.sourceHash) {
    wordCounts.set(card.id, { hash: card.sourceHash, count });
    if (wordCounts.size > wordCountLimit) wordCounts.delete(wordCounts.keys().next().value!);
  }
  return count;
}
