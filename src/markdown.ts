import { markdownParser as parser } from './markdown-model.ts';
import type { ParsedDocument, SliceRecord } from './contracts.ts';
import { defaultLang, defineText, type Lang } from './i18n.ts';
import { cardStateMarkWords, readCardState, type CardState } from './format-vocabulary.ts';

const messages = defineText({
  missingBlock: (relativePath: string, line: number) => `board.py heading has no mdast block: ${relativePath}:${line}`,
}, {
  missingBlock: (relativePath: string, line: number) => `board.py heading has no mdast block: ${relativePath}:${line}`,
});

const sliceHeading = /^###\s+(?:✅\s+)?(\d+\.\d+[a-z]?)\s+(.+?)\s*$/u;
// Python's Unicode word boundary differs from JavaScript's ASCII \b (2026-11-03).
const stateMark = new RegExp(`\\((${cardStateMarkWords().join('|')})(?![\\p{L}\\p{N}_])([^)]*)\\)`, 'gu');
const datePattern = /\d{4}-\d{2}-\d{2}/u;

interface SourceLine {
  body: string;
  offset: number;
}

function sourceLines(text: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let offset = 0;
  for (const match of text.matchAll(/([^\r\n]*)(\r\n|\r|\n|$)/gu)) {
    if (match[0] === '' && offset === text.length) break;
    lines.push({ body: match[1], offset });
    offset += match[0].length;
  }
  return lines;
}

function shortText(text: string, limit = 70): string {
  const plain = text.replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1').replace(/[*`]/gu, '').replace(/^[ —·.]+|[ —·.]+$/gu, '');
  const characters = Array.from(plain);
  if (characters.length <= limit) return plain;
  return characters.slice(0, limit - 1).join('').trimEnd() + '…';
}

function documentName(lines: SourceLine[], relativePath: string): string {
  const heading = lines.find(line => line.body.startsWith('# '));
  const name = heading ? heading.body.slice(2) : relativePath.split('/').at(-1)!;
  return name.split(/ — |: /u, 1)[0].trim();
}

function sliceOwner(lines: SourceLine[], index: number, state: CardState, note: string): string {
  for (const line of lines.slice(index + 1, index + 12)) {
    if (line.body.startsWith('#')) break;
    const owner = /^\*\*Кто:\*\*\s*(.+)/u.exec(line.body);
    if (owner) return shortText(owner[1], 30);
  }
  return state === 'started' && note ? shortText(note, 30) : '';
}

export function isMechanicPath(relativePath: string): boolean {
  const parts = relativePath.split('/');
  const fileName = parts.at(-1)!;
  return parts[0] === 'features' && fileName.endsWith('.md')
    && fileName !== 'README.md' && fileName !== 'template.md'
    && !parts.slice(1, -1).some(part => part === 'tasks' || part === 'research');
}

export function parseDocument(relativePath: string, bytes: Uint8Array, lang: Lang = defaultLang): ParsedDocument {
  const hasBom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const bomBytes = hasBom ? 3 : 0;
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const tree = parser.parse(text);
  const lines = sourceLines(text);
  const headings = tree.children.filter(node => node.type === 'heading' && node.depth <= 3);
  const byteOffset = (offset: number) => bomBytes + Buffer.byteLength(text.slice(0, offset), 'utf8');
  const slices: SliceRecord[] = [];
  let insideFence = false;
  for (const [index, line] of lines.entries()) {
    // The legacy grammar toggles only on backtick fences, including four backticks (2026-11-03).
    // An unaddressable mdast heading is rejected, never patched by guesswork.
    if (line.body.trimStart().startsWith('```')) insideFence = !insideFence;
    if (insideFence) continue;
    const match = sliceHeading.exec(line.body);
    if (!match) continue;
    const node = headings.find(heading => heading.position?.start.offset === line.offset);
    if (!node) throw new Error(messages[lang].missingBlock(relativePath, index + 1));
    const following = headings.find(heading => heading.position!.start.offset! > line.offset);
    const mark = Array.from(match[2].matchAll(stateMark))[0];
    const state = mark ? readCardState(mark[1]) ?? 'not-started' : 'not-started';
    const note = (mark?.[2] ?? '').replace(/^[ ,—]+|[ ,—]+$/gu, '');
    const iteration = state === 'in-iteration' ? /^(\d+)/u.exec(note) : null;
    slices.push({
      ver: match[1], title: shortText(match[2].replace(stateMark, '')),
      heading: line.body.slice(3).trim(), state,
      who: sliceOwner(lines, index, state, note), date: datePattern.exec(note)?.[0] ?? '',
      iter: iteration ? Number(iteration[1]) : 0,
      range: { start: byteOffset(node.position!.start.offset!), end: following ? byteOffset(following.position!.start.offset!) : bytes.length },
    });
  }
  return { relativePath, bytes, text, tree, name: documentName(lines, relativePath), slices };
}
