import { useEffect } from 'react';

let subscribers = 0;

function captureSelectEscape(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !document.querySelector('select:open')) return;
  // Radix listens on document capture; keep the browser's default so only the picker closes.
  event.stopPropagation();
}

/** The shell protects every dialog, including portals; standalone panels share the same listener. */
export function useSelectEscapeGuard() {
  useEffect(() => {
    if (!CSS.supports('selector(select:open)')) return;
    if (subscribers++ === 0) window.addEventListener('keydown', captureSelectEscape, true);
    return () => {
      if (--subscribers === 0) window.removeEventListener('keydown', captureSelectEscape, true);
    };
  }, []);
}
