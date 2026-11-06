import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import type { BulkOutcome } from '../src/bulk-contracts.ts';
import type { WorkspaceSnapshot } from '../src/workspace-contracts.ts';
import { catalogStore, type CatalogAction } from './catalog-store.ts';

export type { CatalogAction } from './catalog-store.ts';

// 2026-11-05: refreshKey remains the screen contract; workspace events invalidate the shared store once.
export function useCatalog(snapshot: WorkspaceSnapshot, _refreshKey: number) {
  const token = (snapshot as WorkspaceSnapshot & { token?: string }).token;
  const store = catalogStore(snapshot.source, token);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const currentStore = useRef(store);
  const mounted = useRef(true);
  currentStore.current = store;
  useEffect(() => {
    mounted.current = true;
    void store.load();
    return () => { mounted.current = false; };
  }, [store]);
  const refresh = useCallback(() => store.refresh(), [store]);
  async function edit(action: CatalogAction, onOutcome?: (outcome: BulkOutcome) => void): Promise<boolean> {
    const current = () => mounted.current && currentStore.current === store;
    const saved = await store.edit(snapshot, action, outcome => { if (current()) onOutcome?.(outcome); });
    return current() && saved;
  }
  return { ...state, edit, refresh, dismissWarning: store.dismissWarning };
}
