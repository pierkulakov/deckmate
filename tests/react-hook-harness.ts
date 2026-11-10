// 2026-11-10: six unit suites rendered components straight to an element tree, each with its own copy of a
// useState/useMemo/useEffect runtime (finding F4). This module is the single shared runtime, one instance per
// suite. It is deliberately NOT a React renderer: no DOM, no scheduler, no focus — a suite re-invokes the
// component and flushes effects by hand, so the model only has to keep hook slots stable across those calls.

export type ReactHookStubs = {
  useState<T>(initial: T | (() => T)): [T, (next: T | ((previous: T) => T)) => void];
  useMemo<T>(calculate: () => T, dependencies: readonly unknown[]): T;
  useEffect(effect: () => unknown, dependencies: readonly unknown[]): void;
  useRef<T>(value: T): { current: T };
  useCallback<T>(callback: T, dependencies: readonly unknown[]): T;
  useLayoutEffect(): void;
  useImperativeHandle(): void;
  useId(): string;
  useSyncExternalStore<T>(subscribe: () => () => void, getSnapshot: () => T): T;
};

export type HookHarness = {
  /** Everything a suite spreads over the real react module inside vi.mock('react', ...). */
  readonly react: ReactHookStubs;
  /** Begin a render pass: rewinds the slot cursor and the changed flag. */
  start(): void;
  /**
   * Run the effects scheduled by the render pass that just finished; each effect whose dependencies changed
   * runs the cleanup of its previous run first. Returns whether state changed and another pass is needed.
   */
  flush(): boolean;
  /** Run every still-registered cleanup once, in declaration order; effects never flushed have no cleanup. */
  unmount(): void;
  /** Unmount and drop all slots and pending effects, so the next render starts from a clean slate. */
  reset(): void;
};

type Slot =
  | { kind: 'state'; value: unknown }
  | { kind: 'memo'; dependencies: readonly unknown[]; value: unknown }
  | { kind: 'effect'; dependencies: readonly unknown[]; cleanup?: () => void };

type EffectSlot = Extract<Slot, { kind: 'effect' }>;
type ScheduledEffect = { slot: EffectSlot; previous?: EffectSlot; effect: () => unknown };

function sameDependencies(dependencies: readonly unknown[], previous: readonly unknown[]): boolean {
  return dependencies.every((value, index) => Object.is(value, previous[index]));
}

export function createHookHarness(): HookHarness {
  let slots: Slot[] = [];
  let cursor = 0;
  let changed = false;
  let scheduled: ScheduledEffect[] = [];
  let identifiers = 0;

  const useState = <T,>(initial: T | (() => T)): [T, (next: T | ((previous: T) => T)) => void] => {
    const index = cursor++;
    const current = () => slots[index] as { kind: 'state'; value: T };
    if (slots[index]?.kind !== 'state') slots[index] = { kind: 'state', value: typeof initial === 'function' ? (initial as () => T)() : initial };
    return [current().value, next => {
      const previous = current().value;
      const value = typeof next === 'function' ? (next as (before: T) => T)(previous) : next;
      if (!Object.is(value, previous)) changed = true;
      current().value = value;
    }];
  };

  const useMemo = <T,>(calculate: () => T, dependencies: readonly unknown[]): T => {
    const index = cursor++;
    const previous = slots[index];
    if (previous?.kind !== 'memo' || !sameDependencies(dependencies, previous.dependencies)) {
      slots[index] = { kind: 'memo', dependencies, value: calculate() };
    }
    return (slots[index] as { kind: 'memo'; value: T }).value;
  };

  const useEffect = (effect: () => unknown, dependencies: readonly unknown[]): void => {
    const index = cursor++;
    const previous = slots[index]?.kind === 'effect' ? slots[index] : undefined;
    if (previous && sameDependencies(dependencies, previous.dependencies)) return;
    const slot: EffectSlot = { kind: 'effect', dependencies };
    slots[index] = slot;
    scheduled.push({ slot, previous, effect });
  };

  const flush = (): boolean => {
    const pending = scheduled;
    scheduled = [];
    for (const { slot, previous, effect } of pending) {
      previous?.cleanup?.();
      slot.cleanup = undefined;
      const result = effect();
      if (typeof result === 'function') slot.cleanup = result as () => void;
    }
    return changed;
  };

  const unmount = (): void => {
    // An effect that was scheduled but never flushed never ran, so it registers nothing to clean up.
    scheduled = [];
    for (const slot of slots) {
      if (slot?.kind !== 'effect') continue;
      slot.cleanup?.();
      slot.cleanup = undefined;
    }
  };

  return {
    react: {
      useState,
      useMemo,
      useEffect,
      useRef: <T,>(value: T) => useState(() => ({ current: value }))[0],
      useCallback: <T,>(callback: T, dependencies: readonly unknown[]) => useMemo(() => callback, dependencies),
      // 2026-11-10: layout effects and imperative refs need a real renderer with a DOM; the tree-based suites
      // only assert markup and handlers, so these stay inert instead of half-simulating React ordering.
      useLayoutEffect: () => {},
      useImperativeHandle: () => {},
      // Stable per slot like React's useId, so re-renders do not churn ids that memo or aria wiring depends on.
      useId: () => useMemo(() => `hook-harness-${++identifiers}`, []),
      // Suites drive re-renders themselves, so a store is only ever read: subscribing would never fire.
      useSyncExternalStore: <T,>(_subscribe: () => () => void, getSnapshot: () => T) => getSnapshot(),
    },
    start: () => { cursor = 0; changed = false; },
    flush,
    unmount,
    reset: () => {
      unmount();
      slots = [];
      cursor = 0;
      changed = false;
      scheduled = [];
    },
  };
}
