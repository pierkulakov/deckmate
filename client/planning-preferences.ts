import { useEffect, useState } from 'react';
import { readStoredValue } from './storage.ts';

export type PlanningGrouping = 'manual' | 'state' | 'priority' | 'owner' | 'deck' | 'run' | 'milestone';
export const planningGroupings: readonly PlanningGrouping[] = ['manual', 'state', 'priority', 'owner', 'deck', 'run', 'milestone'];

/** 2026-11-11: only an explicit choice writes storage, so changing scope cannot persist the preceding plan's value. */
export function usePlanningPreference<T extends string>(key: string, allowed: readonly T[], fallback: T): [T, (value: T) => void] {
  function read(): T {
    try {
      const value = readStoredValue(localStorage, key);
      return allowed.includes(value as T) ? value as T : fallback;
    } catch { return fallback; }
  }
  const [stored, setStored] = useState(() => ({ key, value: read() }));
  const value = stored.key === key ? stored.value : read();
  useEffect(() => { setStored(previous => previous.key === key ? previous : { key, value: read() }); }, [key]);
  return [value, next => {
    if (!allowed.includes(next)) return;
    setStored({ key, value: next });
    try { localStorage.setItem(key, next); } catch { /* 2026-11-11: the current view remains usable without preference storage. */ }
  }];
}
