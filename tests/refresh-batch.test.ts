import { afterEach, expect, it, vi } from 'vitest';
import { createRefreshBatch } from '../client/refresh-batch.ts';

afterEach(() => vi.useRealTimers());

it('refreshes a multi-file Journey once, retaining latency from the first change', () => {
  vi.useFakeTimers();
  const refresh = vi.fn();
  const changes = createRefreshBatch(refresh);
  for (let index = 0; index < 30; index += 1) {
    changes.queue('sandbox', 1000 + index * 5);
    vi.advanceTimersByTime(5);
  }
  expect(refresh).not.toHaveBeenCalled();
  vi.advanceTimersByTime(10);
  expect(refresh.mock.calls).toEqual([['sandbox', 1000]]);
  changes.queue('sandbox', 1200);
  vi.advanceTimersByTime(160);
  expect(refresh.mock.calls).toEqual([['sandbox', 1000], ['sandbox', 1200]]);
});

it('does not starve refreshes under continuous external edits', () => {
  vi.useFakeTimers();
  const refresh = vi.fn();
  const changes = createRefreshBatch(refresh);
  for (let index = 0; index < 8; index += 1) {
    changes.queue('live', index * 40);
    vi.advanceTimersByTime(40);
  }
  expect(refresh.mock.calls).toEqual([['live', 0], ['live', 160]]);
});

it('discards pending notifications on teardown and source changes', () => {
  vi.useFakeTimers();
  const refresh = vi.fn();
  const changes = createRefreshBatch(refresh);
  changes.queue('live', 100);
  changes.queue('sandbox', 110);
  vi.advanceTimersByTime(160);
  expect(refresh.mock.calls).toEqual([['sandbox', 110]]);
  changes.queue('sandbox', 300);
  changes.cancel();
  vi.runAllTimers();
  expect(refresh).toHaveBeenCalledTimes(1);
});
