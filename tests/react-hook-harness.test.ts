import { expect, it, vi } from 'vitest';
import { createHookHarness, type HookHarness } from './react-hook-harness.ts';

// 2026-11-10: these tests pin the contract the six migrated suites rely on: slot stability across passes,
// cleanup on dependency change and unmount, and one fully independent runtime per suite.

function pass(harness: HookHarness, body: () => void): boolean {
  harness.start();
  body();
  return harness.flush();
}

it('keeps state between passes and reports a change only when a pass produces one', () => {
  const harness = createHookHarness();
  let setter!: (next: number | ((previous: number) => number)) => void;
  let value!: number;
  const render = () => { [value, setter] = harness.react.useState(0); };
  expect(pass(harness, render)).toBe(false);
  setter(0);
  expect(pass(harness, render)).toBe(false);
  setter(1);
  expect(pass(harness, render)).toBe(false);
  expect(value).toBe(1);
  expect(pass(harness, () => {
    render();
    setter(previous => previous + 1);
  })).toBe(true);
});

it('runs a state-setting effect through the same change flag', () => {
  const harness = createHookHarness();
  let setter!: (next: number | ((previous: number) => number)) => void;
  let remaining = 1;
  const render = () => {
    [, setter] = harness.react.useState(0);
    harness.react.useEffect(() => { if (remaining > 0) { remaining--; setter(5); } }, []);
  };
  expect(pass(harness, render)).toBe(true);
  expect(pass(harness, render)).toBe(false);
});

it('recalculates a memo only when a dependency is replaced', () => {
  const harness = createHookHarness();
  let calls = 0;
  let dependency = 'first';
  const render = () => harness.react.useMemo(() => ({ tag: ++calls }), [dependency]);
  const first = render();
  expect(pass(harness, () => {})).toBe(false);
  harness.start();
  expect(render()).toBe(first);
  expect(calls).toBe(1);
  dependency = 'second';
  harness.start();
  const second = render();
  expect(second).not.toBe(first);
  expect(second.tag).toBe(2);
});

it('keeps refs and callbacks stable until their dependencies change', () => {
  const harness = createHookHarness();
  let dependency = 1;
  let ref!: { current: string };
  let callback!: () => number;
  const render = () => {
    ref = harness.react.useRef('shared');
    callback = harness.react.useCallback(() => dependency, [dependency]);
  };
  pass(harness, render);
  pass(harness, render);
  expect(ref.current).toBe('shared');
  const first = callback;
  dependency = 2;
  pass(harness, render);
  expect(callback).not.toBe(first);
  expect(callback()).toBe(2);
});

it('keeps useId stable per slot across passes', () => {
  const harness = createHookHarness();
  let first!: string;
  let second!: string;
  const render = () => { first = harness.react.useId(); second = harness.react.useId(); };
  pass(harness, render);
  const originalFirst = first;
  const originalSecond = second;
  pass(harness, render);
  expect(first).toBe(originalFirst);
  expect(second).toBe(originalSecond);
  expect(second).not.toBe(first);
});

it('runs cleanups on unmount once, in declaration order', () => {
  const harness = createHookHarness();
  const log: string[] = [];
  pass(harness, () => {
    harness.react.useEffect(() => { log.push('run-a'); return () => log.push('cleanup-a'); }, []);
    harness.react.useEffect(() => { log.push('run-b'); return () => log.push('cleanup-b'); }, []);
  });
  expect(log).toEqual(['run-a', 'run-b']);
  harness.unmount();
  expect(log).toEqual(['run-a', 'run-b', 'cleanup-a', 'cleanup-b']);
  harness.unmount();
  expect(log).toEqual(['run-a', 'run-b', 'cleanup-a', 'cleanup-b']);
});

it('replaces the previous cleanup when an effect dependency changes', () => {
  const harness = createHookHarness();
  const log: string[] = [];
  let dependency = 1;
  const render = () => {
    const current = dependency;
    harness.react.useEffect(() => {
      log.push(`run-${current}`);
      return () => log.push(`cleanup-${current}`);
    }, [current]);
  };
  pass(harness, render);
  dependency = 2;
  pass(harness, render);
  expect(log).toEqual(['run-1', 'cleanup-1', 'run-2']);
  harness.reset();
  expect(log).toEqual(['run-1', 'cleanup-1', 'run-2', 'cleanup-2']);
});

it('skips an effect whose dependencies are all unchanged', () => {
  const harness = createHookHarness();
  const effect = vi.fn();
  const render = () => harness.react.useEffect(effect, ['stable', 7]);
  expect(pass(harness, render)).toBe(false);
  expect(pass(harness, render)).toBe(false);
  expect(effect).toHaveBeenCalledTimes(1);
});

it('never runs an effect that was scheduled but not flushed', () => {
  const harness = createHookHarness();
  const log: string[] = [];
  harness.start();
  harness.react.useEffect(() => { log.push('run'); return () => log.push('cleanup'); }, []);
  harness.unmount();
  harness.reset();
  expect(log).toEqual([]);
});

it('reset drops state, so the next render starts from initial values', () => {
  const harness = createHookHarness();
  let setter!: (next: number | ((previous: number) => number)) => void;
  let value!: number;
  const render = () => { [value, setter] = harness.react.useState(7); };
  pass(harness, render);
  setter(8);
  pass(harness, render);
  expect(value).toBe(8);
  harness.reset();
  pass(harness, render);
  expect(value).toBe(7);
});

it('keeps several harnesses fully independent', () => {
  const one = createHookHarness();
  const two = createHookHarness();
  const log: string[] = [];
  let setOne!: (next: string | ((previous: string) => string)) => void;
  let valueOne = '';
  const renderOne = () => {
    [valueOne, setOne] = one.react.useState('one');
    one.react.useEffect(() => () => log.push('one-cleanup'), []);
  };
  let valueTwo = '';
  const renderTwo = () => {
    valueTwo = two.react.useState('two')[0];
    two.react.useMemo(() => ({ from: 'two' }), []);
  };
  pass(one, renderOne);
  pass(two, renderTwo);
  setOne('moved');
  pass(one, renderOne);
  expect(valueOne).toBe('moved');
  pass(two, renderTwo);
  expect(valueTwo).toBe('two');
  one.unmount();
  two.unmount();
  expect(log).toEqual(['one-cleanup']);
});

it('reads useSyncExternalStore snapshots without subscribing', () => {
  const harness = createHookHarness();
  const subscribe = vi.fn(() => () => {});
  let snapshot = 1;
  const render = () => harness.react.useSyncExternalStore(subscribe, () => snapshot);
  expect(pass(harness, render)).toBe(false);
  expect(render()).toBe(1);
  snapshot = 2;
  harness.start();
  expect(render()).toBe(2);
  expect(subscribe).not.toHaveBeenCalled();
});

it('exposes inert layout and imperative hooks', () => {
  const harness = createHookHarness();
  expect(() => pass(harness, () => {
    harness.react.useLayoutEffect();
    harness.react.useImperativeHandle();
  })).not.toThrow();
});
