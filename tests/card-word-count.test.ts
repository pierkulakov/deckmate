import { afterEach, describe, expect, it, vi } from 'vitest';
import { countCardWords, countCatalogCardWords } from '../client/card-word-count.ts';
import { markdownParser } from '../src/markdown-model.ts';

afterEach(() => vi.restoreAllMocks());

describe('card word counts', () => {
  it('excludes the legacy YAML, BOM and H1 with LF or CRLF without counting Markdown syntax', () => {
    const markdown = '\uFEFF---\ntitle: metadata words\n---\n# Document title\n\nTwo body words\n\n## Section\nmore text\n';
    expect(countCardWords(markdown, true)).toBe(6);
    expect(countCardWords(markdown.replaceAll('\n', '\r\n'), true)).toBe(6);
  });

  it('preserves legacy documents without an H1 and empty bodies', () => {
    expect(countCardWords('---\ntitle: metadata\n---\n\nThree body words', true)).toBe(3);
    expect(countCardWords('\uFEFFJust body words', true)).toBe(3);
    expect(countCardWords('# Title only', true)).toBe(0);
    expect(countCardWords('---\ntitle: metadata\n---', true)).toBe(0);
    expect(countCardWords(' \n\t ', true)).toBe(0);
  });

  it('counts native Markdown directly and preserves the first legacy H1 boundary', () => {
    expect(countCardWords('# Body heading\n\nTwo words')).toBe(4);
    expect(countCardWords('Intro excluded\n\n# Heading excluded\n\nKept words\n# Another heading', true)).toBe(4);
    expect(countCatalogCardWords({ id: 'card:native-words', sourceHash: 'native', markdown: '# Body heading\n\nTwo words' })).toBe(4);
  });

  it('counts reading text, not markup, in Cyrillic and Latin', () => {
    const markdown = '# Заголовок\n\nЖирный **текст** и [ссылка](https://example.com), `код`, ![alt](image.png).\n\n'
      + '- [ ] первая задача\n- [x] второй пункт\n\n> Цитата с двумя словами\n\n'
      + '| Столбец | Column |\n| --- | --- |\n| значение | value |\n\n'
      + 'Latin words 123 and --- stray * punctuation.\n\n```ts\nconst hidden = true;\n```\n\n<div>raw</div>\n\n---\n';
    expect(countCardWords(markdown)).toBe(25);
    expect(countCardWords('Только кириллица и latin mix', false)).toBe(5);
  });

  it('reuses a count for a remounted or cloned card and replaces it when the hash changes', () => {
    const parse = vi.spyOn(markdownParser, 'parse');
    const card = { id: 'doc:cache-revision', sourceHash: 'first', markdown: '# Title\n\nTwo words' };
    expect(countCatalogCardWords(card)).toBe(2);
    expect(countCatalogCardWords({ ...card })).toBe(2);
    expect(parse).toHaveBeenCalledTimes(1);
    const changed = { ...card, sourceHash: 'second', markdown: '# Title\n\nThree new words' };
    expect(countCatalogCardWords(changed)).toBe(3);
    expect(countCatalogCardWords({ ...changed })).toBe(3);
    expect(parse).toHaveBeenCalledTimes(2);
    expect(countCatalogCardWords(card)).toBe(2);
    expect(parse).toHaveBeenCalledTimes(3);
  });

  it('does not share counts between card IDs with the same hash', () => {
    const parse = vi.spyOn(markdownParser, 'parse');
    const card = { id: 'doc:cache-id-one', sourceHash: 'shared', markdown: '# Title\n\nTwo words' };
    expect(countCatalogCardWords(card)).toBe(2);
    expect(countCatalogCardWords({ ...card, id: 'doc:cache-id-two' })).toBe(2);
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it.each(['', undefined])('does not cache a missing source hash (%s)', sourceHash => {
    const parse = vi.spyOn(markdownParser, 'parse');
    const card = { id: 'doc:missing-hash', sourceHash: sourceHash as string, markdown: '# Title\n\nTwo words' };
    expect(countCatalogCardWords(card)).toBe(2);
    expect(countCatalogCardWords({ ...card, markdown: '# Title\n\nThree new words' })).toBe(3);
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it('keeps at most 512 card revisions and evicts the least recently read entry', () => {
    const parse = vi.spyOn(markdownParser, 'parse');
    const oldest = { id: 'doc:eviction-oldest', sourceHash: 'same', markdown: '# Title\n\nTwo words' };
    const recent = { ...oldest, id: 'doc:eviction-recent' };
    countCatalogCardWords(oldest);
    countCatalogCardWords(recent);
    for (let index = 0; index < 510; index += 1) {
      countCatalogCardWords({ id: `card:eviction-filler-${index}`, sourceHash: 'same', markdown: 'Body' });
    }
    // Counting parses each card once, so the revision cache is proven by what does not parse again.
    const parses = parse.mock.calls.length;
    expect(countCatalogCardWords({ ...recent })).toBe(2);
    expect(parse).toHaveBeenCalledTimes(parses);
    countCatalogCardWords({ id: 'card:eviction-overflow', sourceHash: 'same', markdown: 'Body' });
    expect(countCatalogCardWords(recent)).toBe(2);
    expect(parse).toHaveBeenCalledTimes(parses + 1);
    expect(countCatalogCardWords(oldest)).toBe(2);
    expect(parse).toHaveBeenCalledTimes(parses + 2);
  });
});
