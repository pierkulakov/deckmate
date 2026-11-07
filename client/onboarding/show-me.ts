// 2026-11-05: «Show me» points at the element a quest teaches. The Level panel calls this after switching the tab;
// the helper waits a frame for the new view to land, then scrolls to the element and rings it for ~1.6 s.
// A quest whose action needs, say, an open card lists the first-step elements after the action element in the same
// selector, so the ring lands on the nearest place to start. Parts are tried left to right: the first part with a
// painted element wins, which a plain querySelector on the whole list would not give (it returns document order).

const ringClass = 'show-me-ring';
const ringMs = 1600;
/** How long to wait for the element: a lazily loaded view (Vision) needs more than one frame. */
const appearMs = 600;
let ringTimer = 0;

/** Painted and not faded out: a tile checkbox that waits for hover must not steal the ring from the card face. */
function shown(element: HTMLElement): boolean {
  if (element.getClientRects().length === 0) return false;
  const style = getComputedStyle(element);
  return style.visibility !== 'hidden' && Number(style.opacity) > 0.05;
}

/** The first element of one selector part that paints somewhere; hidden matches give way to later parts. */
function firstShown(part: string): HTMLElement | null {
  return [...document.querySelectorAll<HTMLElement>(part)].find(shown) ?? null;
}

/** Scroll to `selector`'s first visible element and ring it; does nothing when nothing matches. */
export function showQuestTarget(selector: string): void {
  document.querySelectorAll('.' + ringClass).forEach(element => element.classList.remove(ringClass));
  window.clearTimeout(ringTimer);
  const deadline = performance.now() + appearMs;
  function attempt() {
    const element = selector.split(',').map(part => firstShown(part.trim())).find(Boolean) ?? null;
    // Retry within the deadline: React commits the tab switch after the first frame, a lazy view paints later.
    if (!element) {
      if (performance.now() < deadline) requestAnimationFrame(attempt);
      return;
    }
    element.scrollIntoView({ block: 'nearest' });
    element.classList.add(ringClass);
    ringTimer = window.setTimeout(() => element.classList.remove(ringClass), ringMs);
  }
  requestAnimationFrame(attempt);
}
