import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { CatalogCard } from '../src/catalog-contracts.ts';
import type { ByteRange } from '../src/contracts.ts';
import { parseDocument } from '../src/markdown.ts';
import { readHeroSections } from './card-content.ts';
import { containedFile } from './config.ts';

export interface SearchHit { line: number; text: string }
export interface SearchSnippets { title: string; markdown: string }
export type SearchCard = CatalogCard & { hits: SearchHit[] };

export class SearchSourceChangedError extends Error {}

const maximumHits = 3;
const maximumCharacters = 200;

function markedWords(snippet: string): Set<string> {
  return new Set([...snippet.matchAll(/\u0001([^\u0002]+)\u0002/gu)].map(match => match[1].toLowerCase()));
}

function lineAt(bytes: Buffer, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) if (bytes[index] === 10) line += 1;
  return line;
}

/** 2026-11-05: snippets contain lowercase index text; excerpts must come from the original file. */
function hitsInRange(bytes: Buffer, range: ByteRange, words: Set<string>): SearchHit[] {
  if (!words.size || range.start === range.end) return [];
  const firstLine = lineAt(bytes, range.start);
  const lines = bytes.subarray(range.start, range.end).toString('utf8').split(/\r?\n/u);
  const hits: SearchHit[] = [];
  for (const [offset, text] of lines.entries()) {
    const match = [...text.matchAll(/[\p{L}\p{N}]+/gu)].find(word => words.has(word[0].toLowerCase()));
    if (!match) continue;
    // Keep the matching word visible even when a source line is much longer than the excerpt.
    let start = Math.max(0, Math.min(match.index - 60, text.length - maximumCharacters));
    if (start > 0 && /[\uDC00-\uDFFF]/u.test(text[start])) start -= 1;
    const prefix = start > 0 ? '…' : '';
    const tail = text.length > start + maximumCharacters - prefix.length;
    const length = maximumCharacters - prefix.length - (tail ? 1 : 0);
    const excerpt = text.slice(start, start + length).replace(/[\uD800-\uDBFF]$/u, '');
    hits.push({ line: firstLine + offset, text: prefix + excerpt + (tail ? '…' : '') });
    if (hits.length === maximumHits) break;
  }
  return hits;
}

function nativeRanges(bytes: Buffer): { title: ByteRange; body: ByteRange } {
  const text = bytes.toString('utf8');
  const header = /^(?:\uFEFF)?---\r?\n[\s\S]*?^---[ \t]*(?:\r?\n|$)/mu.exec(text);
  if (!header) throw new SearchSourceChangedError('The card frontmatter changed. Refresh the search.');
  const bodyStart = Buffer.byteLength(header[0]);
  const title = /^title[ \t]*:.*(?:\r?\n|$)/mu.exec(header[0]);
  const titleStart = title ? Buffer.byteLength(header[0].slice(0, title.index)) : 0;
  return {
    title: { start: titleStart, end: title ? titleStart + Buffer.byteLength(title[0]) : 0 },
    body: { start: bodyStart, end: bytes.length },
  };
}

function cardRanges(card: CatalogCard, bytes: Buffer): { title: ByteRange; body: ByteRange } {
  if (card.id.startsWith('card:')) return nativeRanges(bytes);
  if (card.id.startsWith('hero:')) {
    const section = readHeroSections(parseDocument(card.path, bytes)).find(candidate => candidate.id === card.id);
    if (!section) throw new SearchSourceChangedError('The Hero changed. Refresh the search.');
    return { title: section.headingLine, body: section.introRange };
  }
  const range = card.range ?? { start: 0, end: bytes.length };
  return { title: range, body: range };
}

function sourceSearchHits(card: CatalogCard, bytes: Buffer, snippets: SearchSnippets): SearchHit[] {
  if (createHash('sha256').update(bytes).digest('hex') !== card.sourceHash) {
    throw new SearchSourceChangedError('The source changed while searching. Refresh the search.');
  }
  const ranges = cardRanges(card, bytes);
  const bodyHits = hitsInRange(bytes, ranges.body, markedWords(snippets.markdown));
  const titleHits = hitsInRange(bytes, ranges.title, markedWords(snippets.title));
  const byLine = new Map<number, SearchHit>();
  for (const hit of [...bodyHits, ...titleHits]) if (!byLine.has(hit.line)) byLine.set(hit.line, hit);
  return [...byLine.values()].sort((first, second) => first.line - second.line).slice(0, maximumHits);
}

export async function attachSearchHits(root: string, cards: CatalogCard[], snippets: Map<string, SearchSnippets>): Promise<SearchCard[]> {
  const files = new Map<string, Promise<Buffer>>();
  return Promise.all(cards.map(async card => {
    const snippet = snippets.get(card.id);
    if (!snippet) return { ...card, hits: [] };
    let bytes = files.get(card.path);
    if (!bytes) {
      bytes = containedFile(root, card.path).then(filename => readFile(filename));
      files.set(card.path, bytes);
    }
    return { ...card, hits: sourceSearchHits(card, await bytes, snippet) };
  }));
}
