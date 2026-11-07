import { describe, expect, it } from 'vitest';
import { readIteration } from '../server/document.ts';

// 2026-11-04: buildPage tests were removed with the Docs tab;
// Sprint, Timeline, and slice iteration labels still read the iteration log.
describe('iteration journal', () => {
  it('uses the last iteration and the first date below it', () => {
    const markdown = '## Итерация 2 — старая\r\n**Начало:** 2026-11-02\r\n## Итерация 12 — новая цель\r\n**Начало:** 2026-11-09 · **Конец:** 2026-11-15\r\n';
    expect(readIteration(markdown)).toEqual({ number: 12, goal: 'новая цель', start: '2026-11-09' });
  });

  it('provides the empty iteration and preserves the reference missing-date value', () => {
    expect(readIteration('# Журнал\n')).toEqual({ number: 0, goal: 'No iteration set', start: '' });
    expect(readIteration('## Итерация 3 — без даты\n')).toEqual({ number: 3, goal: 'без даты', start: '0000-00-00' });
  });
});
