import type { ListItem, RootContent } from 'mdast';
import { markdownParser } from '../src/markdown-model.ts';

/** Use a remark list-item offset; change only a real GFM task marker, never a fenced example. */
export function setMarkdownCheckbox(markdown: string, itemOffset: number, checked: boolean): string | null {
  if (!Number.isInteger(itemOffset) || itemOffset < 0) return null;
  function findItem(nodes: RootContent[]): ListItem | undefined {
    for (const node of nodes) {
      if (node.type === 'listItem' && typeof node.checked === 'boolean' && node.position?.start.offset === itemOffset) return node;
      if ('children' in node) {
        const nested = findItem(node.children as RootContent[]);
        if (nested) return nested;
      }
    }
    return undefined;
  }
  const item = findItem(markdownParser.parse(markdown).children);
  if (!item) return null;
  if (item.checked === checked) return markdown;
  // 2026-11-03: remark omits an initial BOM from its positions; the stored source retains that byte.
  const sourceOffset = itemOffset + (markdown.startsWith('\uFEFF') ? 1 : 0);
  const marker = /^(?:[-+*]|\d+[.)])[ \t]+\[([ \txX])\](?=[ \t\r\n]|$)/u.exec(markdown.slice(sourceOffset));
  if (!marker) return null;
  const markerOffset = sourceOffset + marker[0].length - 2;
  return markdown.slice(0, markerOffset) + (checked ? 'x' : ' ') + markdown.slice(markerOffset + 1);
}
