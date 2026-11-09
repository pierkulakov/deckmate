import { describe, expect, it } from 'vitest';
import { attachmentMarkdown, removeAttachmentLinks } from '../client/attachment-markdown.ts';

describe('removeAttachmentLinks', () => {
  const file = 'tasks/deckmate-assets/cards/abc/1.png';

  it('drops a link on its own last line without leaving a trailing blank line', () => {
    const body = 'Acceptance.\n![file.png](../tasks/deckmate-assets/cards/abc/1.png)';
    expect(removeAttachmentLinks(body, 'cards/hero.md', file)).toEqual({ markdown: 'Acceptance.', count: 1 });
  });

  it('drops the blank line a paste put before the image', () => {
    const body = 'Acceptance.\n\n![probe.png](../tasks/deckmate-assets/cards/abc/1.png)\n';
    expect(removeAttachmentLinks(body, 'cards/hero.md', file)).toEqual({ markdown: 'Acceptance.\n', count: 1 });
  });

  it('keeps CRLF, other links and inline text around the removed link', () => {
    const body = 'See ![a](../tasks/deckmate-assets/cards/abc/1.png "t") here.\r\n![b](../tasks/deckmate-assets/cards/abc/2.png)\r\n![c](../tasks/deckmate-assets/cards/abc/1.png)\r\nEnd\r\n';
    expect(removeAttachmentLinks(body, 'cards/hero.md', file)).toEqual({
      markdown: 'See  here.\r\n![b](../tasks/deckmate-assets/cards/abc/2.png)\r\nEnd\r\n', count: 2,
    });
  });

  it('matches encoded and nested paths, ignores external links and leaves untouched text byte for byte', () => {
    const nested = removeAttachmentLinks('[Doc](../deckmate-assets/cards/a%20b/3.pdf)\n', 'tasks/features/ferry.md', 'tasks/deckmate-assets/cards/a b/3.pdf');
    expect(nested).toEqual({ markdown: '', count: 1 });
    const other = '![x](https://example.com/tasks/deckmate-assets/cards/abc/1.png)\n';
    expect(removeAttachmentLinks(other, 'cards/hero.md', file)).toEqual({ markdown: other, count: 0 });
  });
});

describe('attachmentMarkdown', () => {
  it('embeds an image by a path relative to the card file', () => {
    expect(attachmentMarkdown('cards/hero.md', { file: 'tasks/deckmate-assets/cards/abc/1.png', name: 'Silhouette.png', kind: 'image' }))
      .toBe('![Silhouette.png](../tasks/deckmate-assets/cards/abc/1.png)');
  });

  it('links other files and walks up from a nested card folder', () => {
    expect(attachmentMarkdown('tasks/features/ferry.md', { file: 'tasks/deckmate-assets/cards/abc/2.pdf', name: 'Brief.pdf', kind: 'pdf' }))
      .toBe('[Brief.pdf](../deckmate-assets/cards/abc/2.pdf)');
  });

  it('escapes brackets in the label and encodes path segments', () => {
    expect(attachmentMarkdown('cards/a.md', { file: 'tasks/deckmate-assets/cards/a b/3.pdf', name: 'Plan [v2].pdf', kind: 'pdf' }))
      .toBe('[Plan \\[v2\\].pdf](../tasks/deckmate-assets/cards/a%20b/3.pdf)');
  });
});
