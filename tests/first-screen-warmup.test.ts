import { describe, expect, it, vi } from 'vitest';
import { afterFirstScreen, browserWarmupEnvironment, warmupInputAbort, WarmupQueue, type WarmupEnvironment } from '../client/first-screen-warmup.ts';

function environment() {
  const idle = new Set<(remaining: number) => void>();
  const timers = new Set<() => void>();
  let interrupt = () => {};
  const state = { visible: true, saveData: false, reduced: false, input: false };
  const host: WarmupEnvironment = {
    allowed: () => state.visible && !state.saveData,
    reducedMotion: () => state.reduced,
    inputPending: () => state.input,
    idle: callback => { idle.add(callback); return () => { idle.delete(callback); }; },
    delay: callback => { timers.add(callback); return () => { timers.delete(callback); }; },
    subscribe: callback => { interrupt = callback; return () => { interrupt = () => {}; }; },
  };
  const turn = async (remaining = 20) => {
    const callbacks = [...idle]; idle.clear();
    for (const callback of callbacks) callback(remaining);
    await Promise.resolve(); await Promise.resolve();
  };
  const resume = () => { const callbacks = [...timers]; timers.clear(); for (const callback of callbacks) callback(); };
  return { host, state, idle, timers, turn, resume, interrupt: () => interrupt() };
}

describe('first useful screen warmup queue', () => {
  it('runs by priority, FIFO within priority, once per key and once per idle turn', async () => {
    const env = environment(); const queue = new WarmupQueue(env.host); const seen: string[] = [];
    const add = (key: string, priority: number) => queue.add({ key, priority, run: () => { seen.push(key); } });
    add('vision', 30); add('fonts', 0); add('images', 1); add('hand', 10); add('timeline', 10); add('fonts', 0);
    await env.turn(); expect(seen).toEqual(['fonts']);
    for (let i = 0; i < 4; i++) await env.turn();
    expect(seen).toEqual(['fonts', 'images', 'hand', 'timeline', 'vision']);
    env.interrupt(); expect(env.timers.size).toBe(0);
    add('fonts', 0); await env.turn(); expect(seen).toHaveLength(5); queue.dispose();
  });

  it('serializes asynchronous work and cancels its signal on input before resuming it', async () => {
    const env = environment(); const queue = new WarmupQueue(env.host);
    let release = () => {}; const signals: AbortSignal[] = []; const next = vi.fn();
    queue.add({ key: 'import', priority: 1, run: signal => { signals.push(signal); return new Promise<void>(resolve => { release = resolve; }); } });
    queue.add({ key: 'next', priority: 2, run: next });
    await env.turn(); await env.turn(); expect(signals).toHaveLength(1); expect(next).not.toHaveBeenCalled();
    env.interrupt(); expect(signals[0].aborted).toBe(true);
    expect(signals[0].reason).toBe(warmupInputAbort);
    release(); await Promise.resolve(); await env.turn(); expect(signals).toHaveLength(1);
    env.resume(); await env.turn(); expect(signals).toHaveLength(2);
    release(); await Promise.resolve(); await env.turn(); expect(next).toHaveBeenCalledOnce(); queue.dispose();
  });

  it.each(['visible', 'saveData'] as const)('does not run when %s forbids it and resumes after the policy changes', async key => {
    const env = environment(); env.state[key] = key === 'saveData';
    const queue = new WarmupQueue(env.host); const run = vi.fn(); queue.add({ key: 'task', priority: 0, run });
    await env.turn(); expect(run).not.toHaveBeenCalled();
    env.state[key] = key === 'visible'; env.interrupt(); env.resume(); await env.turn();
    expect(run).toHaveBeenCalledOnce(); queue.dispose();
  });

  it('rechecks visibility in an already scheduled callback and aborts active work on hiding', async () => {
    const env = environment(); const queue = new WarmupQueue(env.host); const run = vi.fn();
    queue.add({ key: 'task', priority: 0, run }); env.state.visible = false; await env.turn(); expect(run).not.toHaveBeenCalled();
    env.state.visible = true; env.interrupt(); env.resume();
    let signal: AbortSignal | undefined;
    queue.add({ key: 'active', priority: -1, run: value => { signal = value; return new Promise(() => {}); } });
    await env.turn(); env.state.visible = false; env.interrupt(); expect(signal?.aborted).toBe(true); queue.dispose();
  });

  it('skips decorative motion work under reduced motion but still prepares instantaneous content', async () => {
    const env = environment(); env.state.reduced = true; const queue = new WarmupQueue(env.host);
    const decoration = vi.fn(); const content = vi.fn();
    queue.add({ key: 'layer', priority: 0, motionOnly: true, run: decoration });
    queue.add({ key: 'chunk', priority: 1, run: content });
    await env.turn(); await env.turn(); expect(decoration).not.toHaveBeenCalled(); expect(content).toHaveBeenCalledOnce(); queue.dispose();
  });

  it('yields to insufficient idle budget or pending input; disposal and cancellation leave no work', async () => {
    const env = environment(); const queue = new WarmupQueue(env.host); const run = vi.fn();
    const cancel = queue.add({ key: 'task', priority: 0, run });
    await env.turn(3); expect(run).not.toHaveBeenCalled(); env.resume();
    env.state.input = true; await env.turn(); expect(run).not.toHaveBeenCalled();
    env.state.input = false; cancel(); env.resume(); await env.turn(); expect(run).not.toHaveBeenCalled();
    queue.add({ key: 'disposed', priority: 0, run }); queue.dispose(); env.interrupt(); env.resume(); await env.turn();
    expect(env.idle.size).toBe(0); expect(env.timers.size).toBe(0); expect(run).not.toHaveBeenCalled();
  });

  it('isolates failed speculative work from subsequent tasks', async () => {
    const env = environment(); const queue = new WarmupQueue(env.host); const run = vi.fn();
    queue.add({ key: 'failure', priority: 0, run: () => { throw Error('stale chunk'); } });
    queue.add({ key: 'next', priority: 1, run }); await env.turn(); await env.turn(); expect(run).toHaveBeenCalledOnce(); queue.dispose();
  });

  it('uses a cancellable timer without requestIdleCallback and subscribes to real policy/input events', () => {
    vi.useFakeTimers();
    const windowTarget = new EventTarget(); const documentTarget = new EventTarget(); const connection = new EventTarget();
    Object.assign(windowTarget, { setTimeout, clearTimeout }); Object.assign(documentTarget, { hidden: false, getAnimations: () => [] });
    Object.assign(connection, { saveData: false });
    vi.stubGlobal('window', windowTarget); vi.stubGlobal('document', documentTarget);
    vi.stubGlobal('navigator', { connection }); vi.stubGlobal('matchMedia', () => ({ matches: false }));
    try {
      const host = browserWarmupEnvironment(); const callback = vi.fn(); const interrupt = vi.fn();
      const unsubscribe = host.subscribe(interrupt); const cancel = host.idle(callback); cancel(); vi.runAllTimers(); expect(callback).not.toHaveBeenCalled();
      host.idle(callback); vi.runAllTimers(); expect(callback).toHaveBeenCalledWith(8);
      windowTarget.dispatchEvent(new Event('pointerdown')); documentTarget.dispatchEvent(new Event('visibilitychange')); connection.dispatchEvent(new Event('change'));
      expect(interrupt).toHaveBeenCalledTimes(3); unsubscribe(); windowTarget.dispatchEvent(new Event('keydown')); expect(interrupt).toHaveBeenCalledTimes(3);
      Object.assign(connection, { saveData: true }); expect(host.allowed()).toBe(false);
      Object.assign(connection, { saveData: false }); Object.assign(documentTarget, { hidden: true }); expect(host.allowed()).toBe(false);
      Object.assign(documentTarget, { getAnimations: () => [{ playState: 'running', effect: { getComputedTiming: () => ({ iterations: 1 }) } }] });
      expect(host.inputPending()).toBe(true);
      Object.assign(documentTarget, { getAnimations: () => [{ playState: 'running', effect: { getComputedTiming: () => ({ iterations: Infinity }) } }] });
      expect(host.inputPending()).toBe(false);
      class StatusTarget { closest(selector: string) { return selector === '[role="status"]' ? this : null; } }
      vi.stubGlobal('Element', StatusTarget);
      Object.assign(documentTarget, { getAnimations: () => [{ playState: 'running', effect: { target: new StatusTarget(), getComputedTiming: () => ({ iterations: 1 }) } }] });
      expect(host.inputPending()).toBe(false);
    } finally { vi.unstubAllGlobals(); vi.useRealTimers(); }
  });

  it('does not start on the loading shell and cancels pending first-screen frames on unmount', () => {
    vi.useFakeTimers();
    let content = false; let changed = () => {}; let sequence = 0;
    const frames = new Map<number, FrameRequestCallback>(); const disconnect = vi.fn(); const start = vi.fn();
    vi.stubGlobal('window', { setTimeout }); vi.stubGlobal('document', { body: {}, querySelector: () => content ? {} : null });
    vi.stubGlobal('MutationObserver', class { constructor(callback: () => void) { changed = callback; } observe() {} disconnect = disconnect; });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++sequence, callback); return sequence; });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    const frame = () => { const current = [...frames.values()]; frames.clear(); current.forEach(callback => callback(0)); };
    try {
      const cancel = afterFirstScreen(start); changed(); vi.runAllTimers(); expect(start).not.toHaveBeenCalled();
      content = true; changed(); frame(); expect(start).not.toHaveBeenCalled(); cancel(); frame(); vi.runAllTimers(); expect(start).not.toHaveBeenCalled();
      const cancelReady = afterFirstScreen(start); frame(); frame(); vi.advanceTimersByTime(399); expect(start).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1); expect(start).toHaveBeenCalledOnce(); cancelReady();
    } finally { vi.unstubAllGlobals(); vi.useRealTimers(); }
  });
});
