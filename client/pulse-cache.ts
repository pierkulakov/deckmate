import type { ProjectPulse } from '../src/pulse-contracts.ts';
import type { DataSource } from '../src/workspace-contracts.ts';

// 2026-11-10: closing a deck remounts the Decks home, and the strip refetched from scratch, replaying its loading
// skeleton on every return. The last pulse per source stays in memory so a remount shows numbers immediately and
// refreshes in the background; the key is the source so Original and the Test copy never show each other's numbers.
const pulses = new Map<DataSource, ProjectPulse>();

export function cachedProjectPulse(source: DataSource): ProjectPulse | null {
  return pulses.get(source) ?? null;
}

export function rememberProjectPulse(source: DataSource, pulse: ProjectPulse): void {
  pulses.set(source, pulse);
}
