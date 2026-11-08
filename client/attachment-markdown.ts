import type { CardAttachment } from '../src/catalog-contracts.ts';

/** 2026-11-09: the Markdown that references a card's attachment from its text. The path is relative to the card file, so
 *  people and agents reach the real file on disk and the reader resolves it through /api/file like any relative link;
 *  images embed, other files link. One format for the editor's insert menu and the panel's copy action. */
export function attachmentMarkdown(cardPath: string, attachment: Pick<CardAttachment, 'file' | 'name' | 'kind'>): string {
  const from = cardPath.split('/').slice(0, -1);
  const to = attachment.file.split('/');
  let common = 0;
  while (common < from.length && common < to.length - 1 && from[common] === to[common]) common++;
  const relative = [...from.slice(common).map(() => '..'), ...to.slice(common)].map(encodeURIComponent).join('/');
  const label = attachment.name.replace(/[[\]\\]/g, '\\$&');
  return attachment.kind === 'image' ? `![${label}](${relative})` : `[${label}](${relative})`;
}
