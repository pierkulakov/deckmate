import { expect, it } from 'vitest';
import { cardLink } from '../src/references.ts';

it.each(['live', 'sandbox'] as const)('keeps the board source before an optional card fragment: %s', source => {
  expect(cardLink('c-0123456789', source)).toBe(`/r/c-0123456789?source=${source}`);
  expect(cardLink('c-0123456789', source, '2')).toBe(`/r/c-0123456789?source=${source}#2`);
  expect(cardLink('c-0123456789', source, '')).toBe(cardLink('c-0123456789', source));
});
