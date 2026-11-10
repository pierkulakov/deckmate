import { moveFocus } from './focus.ts';
import { useEffect, useEffectEvent } from 'react';
import type { RefObject } from 'react';

// Native select popups are outside the DOM and do not expose their open state.
function listenForEscape(close: () => void): () => void {
  let openSelect: HTMLSelectElement | null = null;
  const selectFrom = (target: EventTarget | null) => target instanceof HTMLSelectElement && !target.multiple && target.size <= 1 ? target : null;
  const pointer = (event: PointerEvent) => { openSelect = selectFrom(event.target); };
  const clearSelect = (event: Event) => { if (event.target === openSelect) openSelect = null; };
  const keyup = (event: KeyboardEvent) => { if (event.key === 'Escape') openSelect = null; };
  const keydown = (event: KeyboardEvent) => {
    const select = selectFrom(event.target);
    if (select && (event.key === 'Enter' || event.key === ' ' || event.key === 'F4' || (event.altKey && event.key === 'ArrowDown'))) openSelect = select;
    if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented || event.repeat) return;
    if (openSelect) { openSelect = null; return; }
    if (document.querySelector('[role="dialog"][data-state="open"], [role="menu"][data-state="open"], [role="listbox"][data-state="open"], [data-radix-popper-content-wrapper] [data-state="open"]')) return;
    event.preventDefault();
    close();
  };
  document.addEventListener('pointerdown', pointer, true);
  document.addEventListener('change', clearSelect, true);
  document.addEventListener('focusout', clearSelect, true);
  document.addEventListener('keydown', keydown);
  document.addEventListener('keyup', keyup);
  return () => {
    document.removeEventListener('pointerdown', pointer, true);
    document.removeEventListener('change', clearSelect, true);
    document.removeEventListener('focusout', clearSelect, true);
    document.removeEventListener('keydown', keydown);
    document.removeEventListener('keyup', keyup);
  };
}

export function useEscapeToClose(enabled: boolean, onClose: () => void, opener: RefObject<HTMLElement | null>) {
  const close = useEffectEvent(() => {
    const target = opener.current;
    onClose();
    requestAnimationFrame(() => { if (target?.isConnected) moveFocus(target); });
  });
  useEffect(() => enabled ? listenForEscape(close) : undefined, [enabled]);
}
