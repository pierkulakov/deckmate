import { expect, it } from 'vitest';
import { cardStates, formatLanguages, readCardState, writeCardState } from '../src/format-vocabulary.ts';

it('round-trips randomly selected states through either project language', () => {
  let seed = 0x20261105;
  const random = (limit: number) => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed % limit;
  };
  for (let sample = 0; sample < 500; sample += 1) {
    const state = cardStates[random(cardStates.length)];
    const language = formatLanguages[random(formatLanguages.length)];
    expect(readCardState(writeCardState(state, language))).toBe(state);
  }
});
