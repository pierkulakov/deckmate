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

// An inline link or image with an optional title: ![label](target "title"). Reference-style links are left alone.
const inlineLink = /!?\[(?:\\.|[^\]\\\n])*\]\(\s*<?([^)\s>]+)>?(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\s*\)/gu;

/** Project path a relative link in the card text points at, or null for external, absolute or broken targets. */
function linkedProjectPath(cardPath: string, target: string): string | null {
  if (/^[a-z][a-z\d+.-]*:/iu.test(target) || target.startsWith('/') || target.startsWith('#')) return null;
  let decoded: string;
  try { decoded = decodeURIComponent(target.split(/[?#]/u)[0]!.replaceAll('\\', '/')); } catch { return null; }
  const parts = cardPath.split('/').slice(0, -1);
  for (const segment of decoded.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') { if (!parts.length) return null; parts.pop(); } else parts.push(segment);
  }
  return parts.join('/');
}

/** 2026-11-09: links and images in the card text that point at one attachment file, so deleting the attachment can
 *  also drop them instead of leaving a broken image. A line left empty by the removal goes too; other bytes stay. */
export function removeAttachmentLinks(markdown: string, cardPath: string, file: string): { markdown: string; count: number } {
  let count = 0;
  const pieces = markdown.split(/(\r?\n)/u);
  const kept: string[] = [];
  for (let index = 0; index < pieces.length; index += 2) {
    const line = pieces[index]!;
    const newline = pieces[index + 1] ?? '';
    let removedHere = 0;
    const next = line.replace(inlineLink, (match, target: string) => {
      if (linkedProjectPath(cardPath, target) !== file) return match;
      removedHere++;
      return '';
    });
    count += removedHere;
    if (removedHere && next.trim() === '') {
      // The last line has no newline of its own: drop the one before it so the text does not end in a new blank line.
      if (!newline && kept.length) kept.pop();
      continue;
    }
    kept.push(removedHere ? next.replace(/[ \t]+$/u, '') : next, ...(newline ? [newline] : []));
  }
  if (!count) return { markdown, count };
  // A pasted image goes after a blank line; once it is gone, the text keeps the ending it had before the paste,
  // not a dangling empty line.
  const ending = /(?:\r?\n)*$/u;
  const original = ending.exec(markdown)![0];
  const result = kept.join('');
  const current = ending.exec(result)![0];
  const trimmed = current.length > original.length ? result.slice(0, result.length - current.length) + original : result;
  return { markdown: trimmed, count };
}
