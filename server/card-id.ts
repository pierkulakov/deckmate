import { createHash } from 'node:crypto';

/** 2026-11-12: import and agent retries derive the same valid native ID to avoid creating duplicate cards. */
export function deterministicCardId(canonical: string): string {
  const bytes = createHash('sha256').update(canonical).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `card:${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
