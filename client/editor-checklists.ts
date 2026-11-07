import type { ListItem, Root, RootContent } from 'mdast';
import { markdownParser } from '../src/markdown-model.ts';
import { setMarkdownCheckbox } from './markdown-checkbox.ts';

// 2026-11-04: decorate actual list nodes, retaining their source positions; code examples remain untouched.
export function parseEditorMarkdown(markdown: string): Root {
  const tree = markdownParser.parse(markdown);
  function visit(nodes: RootContent[]) {
    for (const node of nodes) {
      if (node.type === 'listItem' && node.checked == null) {
        const offset = node.position?.start.offset;
        const raw = offset === undefined ? '' : markdown.slice(offset + (markdown.startsWith('\uFEFF') ? 1 : 0));
        const compact = /^(?:[-+*]|\d+[.)])[ \t]+\[\](?=[ \t\r\n]|$)/u.test(raw);
        const paragraph = node.children[0];
        const first = paragraph?.type === 'paragraph' ? paragraph.children[0] : null;
        if (compact && first?.type === 'text' && /^\[\](?:[ \t]|$)/u.test(first.value)) {
          node.checked = false;
          first.value = first.value.replace(/^\[\][ \t]?/u, '');
        }
      }
      if ('children' in node) visit(node.children as RootContent[]);
    }
  }
  visit(tree.children);
  return tree;
}

export function editorChecklistItems(tree: Root): ListItem[] {
  const items: ListItem[] = [];
  function visit(nodes: RootContent[]) {
    for (const node of nodes) {
      if (node.type === 'listItem' && typeof node.checked === 'boolean') items.push(node);
      if ('children' in node) visit(node.children as RootContent[]);
    }
  }
  visit(tree.children);
  return items;
}

export function toggleEditorChecklist(markdown: string, offset: number, checked: boolean): string | null {
  const standard = setMarkdownCheckbox(markdown, offset, checked);
  if (standard !== null) return standard;
  const item = editorChecklistItems(parseEditorMarkdown(markdown)).find(candidate => candidate.position?.start.offset === offset);
  if (!item) return null;
  if (!checked) return markdown;
  const sourceOffset = offset + (markdown.startsWith('\uFEFF') ? 1 : 0);
  const marker = /^(?:[-+*]|\d+[.)])[ \t]+\[\](?=[ \t\r\n]|$)/u.exec(markdown.slice(sourceOffset));
  if (!marker) return null;
  const insertion = sourceOffset + marker[0].length - 1;
  return markdown.slice(0, insertion) + 'x' + markdown.slice(insertion);
}
