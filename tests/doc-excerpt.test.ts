import { afterEach, describe, expect, it, vi } from 'vitest';
import { catalogDocExcerpt, docExcerpt } from '../client/doc-excerpt.ts';
import { markdownParser } from '../src/markdown-model.ts';

afterEach(() => vi.restoreAllMocks());

// 2026-11-09: the Doc tile's face shows the start of the document as plain text blocks.
describe('Doc tile excerpt', () => {
  it('keeps headings apart from text and drops Markdown syntax', () => {
    const markdown = 'Use **broad** silhouettes, see [the brief](brief.md) and `Lantern`.\n\n## Working notes\n- Test assets\n- Keep sources\n\n![Harbor at dusk](harbor.png)';
    expect(docExcerpt(markdown)).toEqual([
      { heading: false, text: 'Use broad silhouettes, see the brief and Lantern.' },
      { heading: true, text: 'Working notes' },
      { heading: false, text: 'Test assets Keep sources' },
      { heading: false, text: 'Harbor at dusk' },
    ]);
  });

  it('skips code, HTML, rules and the legacy YAML and H1', () => {
    const legacy = '﻿---\ntitle: metadata\n---\n# Document title\n\n```js\nconst hidden = true;\n```\n\n<div>raw</div>\n\n---\n\nBody text';
    expect(docExcerpt(legacy, true)).toEqual([{ heading: false, text: 'Body text' }]);
    expect(docExcerpt('')).toEqual([]);
  });

  it('stops after a few hundred characters', () => {
    const blocks = docExcerpt(Array.from({ length: 40 }, (_, index) => `Paragraph ${index} with some words.`).join('\n\n'));
    const length = blocks.reduce((sum, block) => sum + block.text.length, 0);
    expect(length).toBeLessThanOrEqual(320);
    expect(blocks.length).toBeLessThan(40);
  });

  it('parses a revision once and again after the hash changes', () => {
    const parse = vi.spyOn(markdownParser, 'parse');
    const card = { id: 'card:excerpt-revision', sourceHash: 'first', markdown: 'First text' };
    expect(catalogDocExcerpt(card)).toEqual([{ heading: false, text: 'First text' }]);
    expect(catalogDocExcerpt({ ...card })).toEqual([{ heading: false, text: 'First text' }]);
    expect(parse).toHaveBeenCalledTimes(1);
    expect(catalogDocExcerpt({ ...card, sourceHash: 'second', markdown: 'Second text' })).toEqual([{ heading: false, text: 'Second text' }]);
    expect(parse).toHaveBeenCalledTimes(2);
  });
});
