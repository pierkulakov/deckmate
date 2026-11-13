import { createHash } from 'node:crypto';
import { serverLang } from './i18n.ts';

// 2026-11-04: cache parsed project files by their content hash.
// File bytes are authoritative: the key includes their SHA-256 hash, so identical bytes
// share a result and changed bytes always get a new key.
// Parsed values retain card text; bound memory by both entry count
// and total weight, evicting least recently used entries. Parse errors are deterministic
// for the same bytes and are cached like successful results. Cached values are immutable:
// callers receive read-only objects and copy them before editing.

const maximumEntries = 4096;
const maximumBytes = 64 * 1024 * 1024;

interface Slot { value: unknown; weight: number; failed: boolean }

// Map preserves insertion order: newest entries are last; eviction candidates are first.
const slots = new Map<string, Slot>();
let totalWeight = 0;
let hits = 0;
let misses = 0;

export interface ParseCacheStats { entries: number; weightBytes: number; hits: number; misses: number }

export function parseCacheStats(): ParseCacheStats {
  return { entries: slots.size, weightBytes: totalWeight, hits, misses };
}

/** Test utilities may clear the cache; production code relies on keys changing with file bytes. */
export function clearParseCache(): void {
  slots.clear();
  totalWeight = 0;
  hits = 0;
  misses = 0;
}

function remember(key: string, value: unknown, weight: number, failed = false): void {
  // 2026-11-05: one oversized file must neither exceed the bound nor evict useful entries.
  if (!Number.isFinite(weight) || weight < 0 || weight > maximumBytes) return;
  const previous = slots.get(key);
  if (previous !== undefined) { totalWeight -= previous.weight; slots.delete(key); }
  while (slots.size > 0 && (slots.size >= maximumEntries || totalWeight + weight > maximumBytes)) {
    const oldest = slots.keys().next().value!;
    totalWeight -= slots.get(oldest)!.weight;
    slots.delete(oldest);
  }
  slots.set(key, { value, weight, failed });
  totalWeight += weight;
}

// A JSON pair of namespace and identity is unambiguous for every path.
const keyOf = (namespace: string, identity: string): string => JSON.stringify([namespace, identity, serverLang()]);

/**
 * Cache parsed results by path and content hash. Store the promise for asynchronous computation
 * so concurrent calls for the same bytes share one result.
 */
export function parseCached<T>(namespace: string, identity: string, weight: number, compute: () => T): T {
  const key = keyOf(namespace, identity);
  const found = slots.get(key);
  if (found !== undefined) {
    slots.delete(key);
    slots.set(key, found);
    hits += 1;
    if (found.failed) throw found.value;
    return found.value as T;
  }
  misses += 1;
  let value: T;
  try { value = compute(); }
  catch (error) { remember(key, error, weight, true); throw error; }
  remember(key, value, weight);
  return value;
}

export interface FileParse<T> {
  context: string;
  mtimeMs: number | null;
  size: number;
  sourceHash: string;
  value: T;
}

/** 2026-11-12: metadata identifies a revision, but only fresh bytes can confirm an unchanged parse. */
export function parseFileCached<T>(namespace: string, identity: string, bytes: Buffer, mtimeMs: number | null,
  compute: (sourceHash: string) => T, previous?: FileParse<T>): FileParse<T> {
  const context = keyOf(namespace, identity);
  const sourceHash = createHash('sha256').update(bytes).digest('hex');
  const size = bytes.length;
  if (previous?.context === context && previous.sourceHash === sourceHash) {
    if (previous.mtimeMs === mtimeMs && previous.size === size) return previous;
    return { ...previous, mtimeMs, size };
  }
  const value = parseCached(namespace, JSON.stringify([identity, sourceHash]), size, () => compute(sourceHash));
  return { context, mtimeMs, size, sourceHash, value };
}
