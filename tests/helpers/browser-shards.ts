import timing from '../browser-durations.json' with { type: 'json' };

export function balanceBrowserFiles(files: string[], count: number, durations: Record<string, number> = timing.durationMs) {
  if (!Number.isInteger(count) || count < 1) throw new Error('Shard count must be a positive integer');
  const known = Object.values(durations).filter(value => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  const fallback = known[Math.floor(known.length / 2)] ?? 1000;
  const duration = (file: string) => Number.isFinite(durations[file]) && durations[file] > 0 ? durations[file] : fallback;
  const shards = Array.from({ length: count }, () => ({ files: [] as string[], durationMs: 0 }));
  // 2026-11-12: longest-first placement balances wall time; path tie-breaks make sharding independent of filesystem/cache order.
  const ordered = [...files].sort((a, b) => duration(b) - duration(a) || a.localeCompare(b, 'en'));
  for (const file of ordered) {
    const shard = shards.reduce((best, candidate) => candidate.durationMs < best.durationMs ? candidate : best);
    shard.files.push(file);
    shard.durationMs += duration(file);
  }
  return shards;
}
