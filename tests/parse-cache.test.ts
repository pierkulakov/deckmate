import { beforeEach, expect, it, vi } from 'vitest';
import { clearParseCache, parseCached, parseCacheStats } from '../server/parse-cache.ts';

beforeEach(clearParseCache);

it('rethrows a cached synchronous failure rather than returning it as a parsed value', () => {
  const failure = new Error('Invalid source bytes');
  const parse = vi.fn((): string => { throw failure; });
  expect(() => parseCached('failure', 'same-path-and-hash', 128, parse)).toThrow(failure);
  expect(() => parseCached('failure', 'same-path-and-hash', 128, parse)).toThrow(failure);
  expect(parse).toHaveBeenCalledTimes(1);
  expect(parseCacheStats()).toMatchObject({ entries: 1, weightBytes: 128, hits: 1, misses: 1 });
});

it('returns oversized values without caching them or evicting useful entries', () => {
  const useful = { title: 'Keep this parse' };
  const oversized = { title: 'Read without retention' };
  const parseOversized = vi.fn(() => oversized);
  parseCached('small', 'useful', 256, () => useful);
  const maximumBytes = 64 * 1024 * 1024;
  expect(parseCached('large', 'oversized', maximumBytes + 1, parseOversized)).toBe(oversized);
  expect(parseCacheStats()).toMatchObject({ entries: 1, weightBytes: 256 });
  const unexpected = vi.fn(() => ({ title: 'Unexpected reparse' }));
  expect(parseCached('small', 'useful', 256, unexpected)).toBe(useful);
  expect(unexpected).not.toHaveBeenCalled();
  expect(parseCached('large', 'oversized', maximumBytes + 1, parseOversized)).toBe(oversized);
  expect(parseOversized).toHaveBeenCalledTimes(2);
  expect(parseCacheStats().weightBytes).toBeLessThanOrEqual(maximumBytes);
});

it('keeps the existing entry limit and evicts the least recently used parse', () => {
  for (let index = 0; index < 4096; index++) parseCached('limit', String(index), 1, () => index);
  expect(parseCached('limit', '0', 1, () => -1)).toBe(0);
  parseCached('limit', 'new', 1, () => 4096);
  expect(parseCacheStats()).toMatchObject({ entries: 4096, weightBytes: 4096 });
  expect(parseCached('limit', '0', 1, () => -1)).toBe(0);
  const reparsed = vi.fn(() => 1);
  expect(parseCached('limit', '1', 1, reparsed)).toBe(1);
  expect(reparsed).toHaveBeenCalledTimes(1);
  expect(parseCacheStats().entries).toBe(4096);
});
