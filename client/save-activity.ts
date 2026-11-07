import { useSyncExternalStore } from 'react';

/**
 * Writes in flight across the app (2026-11-05). Panels no longer print their own "Saving…" lines, which pushed their
 * content down; the server status chip beside the logo shows Saving… and then Saved for every write instead.
 */
interface SaveActivity { saving: boolean; savedAt: number }

let inFlight = 0;
let state: SaveActivity = { saving: false, savedAt: 0 };
const listeners = new Set<() => void>();

function publish(next: SaveActivity) {
  state = next;
  for (const listener of listeners) listener();
}

/** Marks one write as started; call the returned function once when it settles, whatever the outcome. */
export function beginSave(): (saved: boolean) => void {
  inFlight += 1;
  if (inFlight === 1) publish({ ...state, saving: true });
  let settled = false;
  return saved => {
    if (settled) return;
    settled = true;
    inFlight -= 1;
    publish({ saving: inFlight > 0, savedAt: saved ? Date.now() : state.savedAt });
  };
}

export function useSaveActivity(): SaveActivity {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => state);
}
