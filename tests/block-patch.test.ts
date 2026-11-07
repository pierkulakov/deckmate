import { describe, expect, it } from 'vitest';
import { markdownModel, replaceMarkdownBlock } from '../src/block-patch.ts';

describe('block byte replacement', () => {
  it.each(['\n', '\r\n'])('keeps BOM, emoji and bytes outside an edited block (%j)', (newline) => {
    const prefix = Buffer.from('\uFEFF# Тест 🧱' + newline + newline);
    const original = Buffer.from('Текст «один» — ссылка [→](<file.md#один>)' + newline);
    const suffix = Buffer.from(newline + '## Далее' + newline + 'Без правок.');
    const source = Buffer.concat([prefix, original, suffix]);
    const replacement = Buffer.from('Текст «два» — ссылка [→](<file.md#два>)' + newline);
    const result = replaceMarkdownBlock(source, { start: prefix.length, end: prefix.length + original.length },
      replacement, markdownModel(replacement.toString('utf8')));
    expect(result.subarray(0, prefix.length)).toEqual(prefix);
    expect(result.subarray(prefix.length + replacement.length)).toEqual(suffix);
    expect(source).toEqual(Buffer.concat([prefix, original, suffix]));
  });

  it('rejects a serializer which dropped a link', () => {
    const original = Buffer.from('[→](<mechanic.md#1.1 Тест>)');
    expect(() => replaceMarkdownBlock(original, { start: 0, end: original.length }, Buffer.from('→'),
      markdownModel(original.toString()))).toThrow('Block model changed');
  });

  it('rejects invalid byte boundaries and out-of-range patches', () => {
    const source = Buffer.from('Блок');
    expect(() => replaceMarkdownBlock(source, { start: 1, end: 4 }, Buffer.from('x'), markdownModel('x'))).toThrow();
    expect(() => replaceMarkdownBlock(source, { start: -1, end: 4 }, Buffer.from('x'), markdownModel('x'))).toThrow();
  });
});
