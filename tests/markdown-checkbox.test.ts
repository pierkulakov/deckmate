import { describe, expect, it } from 'vitest';
import { setMarkdownCheckbox } from '../client/markdown-checkbox.ts';

describe('preview Markdown checkboxes', () => {
  it('changes only one marker byte in a mixed-ending document with duplicate task text', () => {
    const original = '\uFEFFТекст  \r\n\r\n- [ ] Дубликат\r\n- [X] Дубликат\n\rСледующий текст\r';
    const offset = original.indexOf('- [ ]');
    const astOffset = offset - 1;
    const changed = setMarkdownCheckbox(original, astOffset, true);
    expect(changed).toBe(original.slice(0, offset + 3) + 'x' + original.slice(offset + 4));
    expect(changed?.length).toBe(original.length);
    expect(setMarkdownCheckbox(changed!, astOffset, false)).toBe(original);
  });

  it.each([
    ['> 1. [ ] Quoted\r\n>    - [x] Nested\r\n', '1. [ ]', true, '1. [x]'],
    ['- Parent\n  + [X] Nested\n', '+ [X]', false, '+ [ ]'],
    ['1) [ ] Ordered\n', '1) [ ]', true, '1) [x]'],
  ])('supports nested, quoted and ordered task syntax: %s', (original, marker, checked, replacement) => {
    expect(setMarkdownCheckbox(original, original.indexOf(marker), checked as boolean)).toBe(original.replace(marker, replacement));
  });

  it('preserves uppercase checked markers on a no-op', () => {
    expect(setMarkdownCheckbox('- [X] Done\r\n', 0, true)).toBe('- [X] Done\r\n');
  });

  it('rejects task-looking text in code, escaped markers and stale offsets', () => {
    const original = '```md\n- [ ] Example\n```\n\n- \\[ ] Text\n\n- [ ] Actual\n';
    expect(setMarkdownCheckbox(original, original.indexOf('- [ ]'), true)).toBeNull();
    expect(setMarkdownCheckbox(original, original.indexOf('- \\'), true)).toBeNull();
    expect(setMarkdownCheckbox(original, original.lastIndexOf('- [ ]') + 3, true)).toBeNull();
    expect(setMarkdownCheckbox(original, -1, true)).toBeNull();
  });
});
