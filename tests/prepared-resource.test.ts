import { describe, expect, it, vi } from 'vitest';
import { preparedNavigation, preparedResource, preload } from '../client/prepared-resource.ts';

function held<Value>() {
  let resolve!: (value: Value) => void; let reject!: (error: Error) => void;
  const promise = new Promise<Value>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('prepared navigation', () => {
  it('deduplicates idle, intent and click loads and does not commit before chunk evaluation/CSS readiness', async () => {
    const pending = held<string>(); const load = vi.fn(() => pending.promise); const resource = preparedResource(load);
    const gate = preparedNavigation(); const commit = vi.fn();
    const idle = resource.load(); expect(resource.load()).toBe(idle); gate.run(resource, commit);
    expect(load).toHaveBeenCalledOnce(); expect(commit).not.toHaveBeenCalled(); expect(resource.ready()).toBe(false);
    pending.resolve('evaluated with CSS'); await idle; await Promise.resolve();
    expect(resource.ready()).toBe(true); expect(commit).toHaveBeenCalledOnce();
    gate.run(resource, commit); expect(commit).toHaveBeenCalledTimes(2);
  });

  it('ignores late completions after a newer navigation or source change/unmount', async () => {
    const first = held<void>(); const second = held<void>(); const gate = preparedNavigation();
    const a = preparedResource(() => first.promise); const b = preparedResource(() => second.promise);
    const old = vi.fn(); const current = vi.fn(); gate.run(a, old); gate.run(b, current);
    first.resolve(); await a.load(); await Promise.resolve(); expect(old).not.toHaveBeenCalled();
    gate.cancel(); second.resolve(); await b.load(); await Promise.resolve(); expect(current).not.toHaveBeenCalled();
  });

  it('lets a failed chunk reach the foreground error boundary without an unhandled speculative rejection', async () => {
    const pending = held<void>(); const resource = preparedResource(() => pending.promise); const commit = vi.fn();
    preload(resource); preload(resource); preparedNavigation().run(resource, commit); pending.reject(Error('stale chunk'));
    await expect(resource.load()).rejects.toThrow('stale chunk'); await Promise.resolve(); expect(commit).toHaveBeenCalledOnce(); expect(resource.ready()).toBe(false);
  });
});
