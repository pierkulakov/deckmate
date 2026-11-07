import type { DataSource } from '../src/workspace-contracts.ts';

/** 2026-11-03: A Journey writes several files; refresh once per bounded burst, not once per file. */
export function createRefreshBatch(refresh: (source: DataSource, detectedAt: number) => void, delay = 160) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: { source: DataSource; detectedAt: number } | undefined;

  function cancel() {
    clearTimeout(timer);
    timer = undefined;
    pending = undefined;
  }

  function queue(source: DataSource, detectedAt: number) {
    if (pending && pending.source !== source) cancel();
    pending ??= { source, detectedAt };
    pending.detectedAt = Math.min(pending.detectedAt, detectedAt);
    if (timer !== undefined) return;
    // Do not postpone this deadline on every event: continuous edits must still appear promptly.
    timer = setTimeout(() => {
      const change = pending;
      timer = undefined;
      pending = undefined;
      if (change) refresh(change.source, change.detectedAt);
    }, delay);
  }

  return { queue, cancel };
}
