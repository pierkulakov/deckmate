import { beforeEach, expect, it, vi } from 'vitest';
import { clearParseCache, parseCached, parseCacheStats, parseFileCached } from '../server/parse-cache.ts';

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

it('reuses a file revision after LRU eviction but verifies bytes even when size and mtime match', () => {
  const compute = vi.fn((hash: string) => ({ hash }));
  const first = parseFileCached('file', 'features/audio.md', Buffer.from('Original'), 123, compute);
  clearParseCache();
  expect(parseFileCached('file', 'features/audio.md', Buffer.from('Original'), 123, compute, first)).toBe(first);
  expect(compute).toHaveBeenCalledTimes(1);
  const changed = parseFileCached('file', 'features/audio.md', Buffer.from('External'), 123, compute, first);
  expect(changed).toMatchObject({ mtimeMs: 123, size: first.size });
  expect(changed.sourceHash).not.toBe(first.sourceHash);
  expect(changed.value).not.toBe(first.value);
  expect(compute).toHaveBeenCalledTimes(2);
});

it('updates a touched file revision without reparsing identical bytes or mutating its old revision', () => {
  const compute = vi.fn(() => ({ title: 'Unchanged' }));
  const bytes = Buffer.from('Same bytes');
  const first = parseFileCached('file', 'docs/guide.md', bytes, null, compute);
  const touched = parseFileCached('file', 'docs/guide.md', bytes, 456, compute, first);
  expect(touched).not.toBe(first);
  expect(touched.value).toBe(first.value);
  expect(first.mtimeMs).toBeNull();
  expect(touched.mtimeMs).toBe(456);
  expect(compute).toHaveBeenCalledTimes(1);
});

it('invalidates a file parse when its path, namespace, size or hash changes', () => {
  const compute = vi.fn((hash: string) => ({ hash }));
  const bytes = Buffer.from('Body');
  const first = parseFileCached('file', 'docs/first.md', bytes, 123, compute);
  const renamed = parseFileCached('file', 'docs/second.md', bytes, 123, compute, first);
  const otherParser = parseFileCached('another', 'docs/first.md', bytes, 123, compute, first);
  const resized = parseFileCached('file', 'docs/first.md', Buffer.from('Longer body'), 123, compute, first);
  for (const result of [renamed, otherParser, resized]) expect(result.value).not.toBe(first.value);
  expect(compute).toHaveBeenCalledTimes(4);
});

it('caches malformed file bytes without hiding recovery at the same mtime', () => {
  const failure = new Error('Malformed bytes');
  const compute = vi.fn(() => { throw failure; });
  for (let repeat = 0; repeat < 2; repeat++) {
    expect(() => parseFileCached('file', 'docs/broken.md', Buffer.from('broken'), 123, compute)).toThrow(failure);
  }
  expect(compute).toHaveBeenCalledTimes(1);
  const recovered = parseFileCached('file', 'docs/broken.md', Buffer.from('valid!'), 123, () => 'Recovered');
  expect(recovered.value).toBe('Recovered');
});
