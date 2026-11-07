import path from 'node:path';
import type { Definition, Image, Link, Nodes } from 'mdast';
import { markdownParser } from '../src/markdown-model.ts';
import { defineText, serverText } from './i18n.ts';

const messages = defineText({
  unsafeDestination: 'Could not safely locate the Markdown link destination in the Journey instructions.',
}, {
  unsafeDestination: 'Не удалось безопасно определить адрес Markdown-ссылки в инструкции Journey.',
});

type DestinationNode = Link | Image | Definition;
interface Replacement { start: number; end: number; value: string }
const markdownTitle = String.raw`(?:"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|\((?:\\[\s\S]|[^)\\])*\))`;
const inlineTail = new RegExp(String.raw`^\s*(?:${markdownTitle}\s*)?\)$`, 'u');
const definitionTail = new RegExp(String.raw`^(?:\s+${markdownTitle})?\s*$`, 'u');

function destinationEnd(text: string, start: number, angled: boolean): number {
  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (character === '\\') { index += 1; continue; }
    if (angled) { if (character === '>') return index; continue; }
    if (/\s/u.test(character)) return index;
    if (character === '(') depth += 1;
    if (character === ')') { if (depth === 0) return index; depth -= 1; }
  }
  return text.length;
}

function decodedDestination(raw: string, angled: boolean): string | null {
  const tree = markdownParser.parse(`[destination](${angled ? `<${raw}>` : raw})`);
  const paragraph = tree.children[0];
  if (paragraph?.type !== 'paragraph') return null;
  const link = paragraph.children[0];
  return link?.type === 'link' ? link.url : null;
}

function destinationRange(source: string, node: DestinationNode): { start: number; end: number } {
  const nodeStart = node.position!.start.offset!;
  const nodeEnd = node.position!.end.offset!;
  const text = source.slice(nodeStart, nodeEnd);
  const delimiter = node.type === 'definition' ? ']:' : '](';
  // Work inside an AST-confirmed link. A valid suffix distinguishes its destination
  // from brackets in labels, code spans, nested images, or the optional title.
  for (let marker = text.lastIndexOf(delimiter); marker >= 0; marker = text.lastIndexOf(delimiter, marker - 1)) {
    let start = marker + delimiter.length;
    while (/\s/u.test(text[start] ?? '') && start < text.length) start += 1;
    const angled = text[start] === '<';
    if (angled) start += 1;
    const end = destinationEnd(text, start, angled);
    if (angled && text[end] !== '>') continue;
    const tail = text.slice(end + (angled ? 1 : 0));
    if (!(node.type === 'definition' ? definitionTail : inlineTail).test(tail)) continue;
    if (decodedDestination(text.slice(start, end), angled) !== node.url) continue;
    return { start: nodeStart + start, end: nodeStart + end };
  }
  throw new Error(serverText(messages).unsafeDestination);
}

/** Rebase file URLs without reserializing headings, code, whitespace or link labels. */
export function rebaseMarkdownLinks(markdown: string, fromFile: string, toFile: string): string {
  const replacements: Replacement[] = [];
  function visit(node: Nodes): void {
    if (node.type === 'link' || node.type === 'image' || node.type === 'definition') {
      const url = node.url;
      if (url && !/^(?:[a-z][a-z0-9+.-]*:|\/|#)/iu.test(url)) {
        const target = new URL(url, `https://deckmate.invalid/${fromFile}`);
        const relative = path.posix.relative(path.posix.dirname(toFile), target.pathname.slice(1)) || path.posix.basename(toFile);
        const value = `${relative}${target.search}${target.hash}`.replace(/\(/gu, '%28').replace(/\)/gu, '%29').replace(/&/gu, '&amp;');
        replacements.push({ ...destinationRange(markdown, node), value });
      }
    }
    if ('children' in node) for (const child of node.children) visit(child);
  }
  visit(markdownParser.parse(markdown));
  let result = markdown;
  for (const replacement of replacements.sort((first, second) => second.start - first.start)) {
    result = result.slice(0, replacement.start) + replacement.value + result.slice(replacement.end);
  }
  return result;
}
