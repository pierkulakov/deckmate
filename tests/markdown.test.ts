import { describe, expect, it } from 'vitest';
import { isMechanicPath, parseDocument } from '../src/markdown.ts';

function parse(markdown: string) { return parseDocument('features/example.md', Buffer.from(markdown)); }

describe('board-compatible slices with mdast byte ranges', () => {
  it('handles old done marks, suffixes, Cyrillic boundaries and iteration', () => {
    const document = parse('# Механика — описание\n### ✅ 1.2a «Готово» (сделано 2026-11-03)\n### 2.1 План (итерация 7)\n');
    expect(document.name).toBe('Механика');
    expect(document.slices.map(({ ver, title, state, date, iter }) => ({ ver, title, state, date, iter }))).toEqual([
      { ver: '1.2a', title: '«Готово»', state: 'done', date: '2026-11-03', iter: 0 },
      { ver: '2.1', title: 'План', state: 'in-iteration', date: '', iter: 7 },
    ]);
    expect(parse('### 1.1 Тест (принятое)\n').slices[0].state).toBe('not-started');
  });

  it('preserves exact BOM/CRLF byte spans after Cyrillic and emoji', () => {
    const prefix = '\uFEFF# Кириллица 🧱\r\n\r\n';
    const first = '### 1.1 «Первый» — блок\r\nТекст\r\n#### Внутри\r\nЕщё\r\n\r\n';
    const second = '### 1.2 Второй\r\nКонец';
    const document = parse(prefix + first + second);
    expect(document.slices.map(slice => slice.range)).toEqual([
      { start: Buffer.byteLength(prefix), end: Buffer.byteLength(prefix + first) },
      { start: Buffer.byteLength(prefix + first), end: document.bytes.length },
    ]);
    expect(Buffer.from(document.bytes.subarray(document.slices[0].range.start, document.slices[0].range.end)).toString()).toBe(first);
  });

  it('ends at the next ordinary H3 or H2 and skips fenced fake slices', () => {
    const document = parse('# Механика\n```md\n### 9.9 Пример\n```\n### 1.1 Реальный\nТекст\n### Примечание\nОстальное\n## Конец\n');
    expect(document.slices).toHaveLength(1);
    const range = document.slices[0].range;
    expect(Buffer.from(document.bytes.subarray(range.start, range.end)).toString()).toBe('### 1.1 Реальный\nТекст\n');
  });

  it('uses the reference owner window, free text and in-progress fallback', () => {
    expect(parse('### 1.1 Работа (в работе, Codex)\n- **Кто:** Павел\n').slices[0].who).toBe('Codex');
    expect(parse('### 1.1 Работа\n**Кто:** Павел — затем Claude\n').slices[0].who).toBe('Павел — затем Claude');
    expect(parse('### 1.1 Работа\n' + '\n'.repeat(11) + '**Кто:** Claude\n').slices[0].who).toBe('');
    expect(parse('### 1.1 Работа\n## Раздел\n**Кто:** Claude\n').slices[0].who).toBe('');
  });

  it('truncates Unicode code points rather than surrogate pairs', () => {
    expect(parse('### 1.1 ' + '🧱'.repeat(71) + '\n').slices[0].title).toBe('🧱'.repeat(69) + '…');
  });

  it('rejects invalid UTF-8 and ambiguous reference-only headings', () => {
    expect(() => parseDocument('features/bad.md', Uint8Array.from([0xff]))).toThrow();
    expect(() => parse('~~~\n### 1.1 Пример в fence\n~~~\n')).toThrow('no mdast block');
  });

  it('selects the same mechanic paths as board.py', () => {
    expect(isMechanicPath('features/vehicles/medical-truck/medical-truck.md')).toBe(true);
    for (const relative of ['tasks/iterations.md', 'features/README.md', 'features/template.md', 'features/x/tasks/plan.md', 'features/x/research/plan.md']) {
      expect(isMechanicPath(relative)).toBe(false);
    }
  });
});
