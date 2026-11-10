import { startTransition, useEffect, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { warmupInputAbort } from './first-screen-warmup.ts';

function Commit({ children, ready }: { children: ReactNode; ready: () => void }) {
  useEffect(ready, [ready]);
  return children;
}

// 2026-11-10: warm only standalone controls, never a page that writes URL/selection or loads project data.
// Inert also blocks an editor's autofocus; abort tears the temporary root down before the input reaches the real UI.
export function warmMount(content: ReactNode, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  const container = document.createElement('div');
  container.setAttribute('aria-hidden', 'true');
  container.inert = true;
  container.dataset.interfaceWarmup = '';
  Object.assign(container.style, { position: 'fixed', left: '-10000px', top: '0', width: `${innerWidth}px`, height: `${innerHeight}px`, visibility: 'hidden', contain: 'strict', pointerEvents: 'none' });
  document.body.append(container);
  const root = createRoot(container);
  return new Promise(resolve => {
    let frame = 0;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(frame);
      clearTimeout(timeout);
      signal.removeEventListener('abort', finish);
      container.remove();
      const unmount = () => { root.unmount(); resolve(); };
      // 2026-11-10: source/unmount cleanup can run inside another React commit. Input cancellation, unlike cleanup,
      // must still remove vendor key handlers synchronously before the input reaches the real interface.
      if (signal.aborted && signal.reason !== warmupInputAbort) queueMicrotask(unmount);
      else unmount();
    };
    // 2026-11-10: a suspended vendor control must not retain a hidden root indefinitely or block the rest of the queue.
    const timeout = window.setTimeout(finish, 2000);
    const ready = () => {
      frame = requestAnimationFrame(() => {
        void document.fonts.ready.then(() => {
          if (!finished) frame = requestAnimationFrame(finish);
        });
      });
    };
    signal.addEventListener('abort', finish, { once: true });
    startTransition(() => root.render(<Commit ready={ready}>{content}</Commit>));
  });
}
