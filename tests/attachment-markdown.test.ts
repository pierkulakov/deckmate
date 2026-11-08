import { describe, expect, it } from 'vitest';
import { attachmentMarkdown } from '../client/attachment-markdown.ts';

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
