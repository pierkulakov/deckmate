import { describe, expect, it, vi } from 'vitest';
import { addDays, dayDistance, isoWeek, monthStart } from '../client/planning-metrics.ts';

vi.mock('../client/i18n.ts', async () => {
  const shared = await import('../src/i18n.ts');
  return { locale: shared.localeOf };
});

describe('planning calendar dates', () => {
  it('keeps four-digit years below 100 when changing months', () => {
    expect(monthStart('0001-01-31')).toBe('0001-01-01');
    expect(monthStart('0001-12-31', 1)).toBe('0002-01-01');
    expect(monthStart('0099-12-31', 1)).toBe('0100-01-01');
    expect(monthStart('0100-01-01', -1)).toBe('0099-12-01');
    expect(addDays('0096-02-28', 1)).toBe('0096-02-29');
    expect(dayDistance('0099-12-31', '0100-01-01')).toBe(1);
  });

  it('calculates ISO weeks using the actual year, including a year boundary', () => {
    expect(isoWeek('0001-01-01')).toBe(1);
    expect(isoWeek('0099-01-01')).toBe(1);
    expect(isoWeek('0100-01-01')).toBe(53);
    expect(isoWeek('2021-01-01')).toBe(53);
    expect(isoWeek('2021-01-04')).toBe(1);
  });
});
