import { useCallback, useEffect, useRef } from 'react';

/** 2026-11-13: menu navigation can focus an item until Presence unmounts it; a non-modal form must wait for that teardown. */
export function useMenuHandoff() {
  const pending = useRef<(() => void) | null>(null);
  const cancel = useCallback(() => { pending.current = null; }, []);
  useEffect(() => cancel, [cancel]);
  return {
    defer: (action: () => void) => { pending.current = action; },
    cancel,
    onCloseAutoFocus: (event: Event) => {
      const action = pending.current;
      if (!action) return;
      pending.current = null;
      event.preventDefault();
      action();
    },
  };
}
