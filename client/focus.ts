/**
 * Focus moved by script shows the keyboard ring only when the person is using the keyboard (2026-11-10).
 *
 * Chromium decides :focus-visible for a script's focus() from the element that had focus before, so a click on an area
 * that leaves focus where it was (a card face, the canvas, a scrim) carried an old keyboard ring onto whatever the code
 * focused next, and a click that closed a panel lit its opener. Every
 * programmatic focus goes through moveFocus, which passes the last input — keyboard or pointer — as focusVisible
 * (FocusOptions.focusVisible; Chrome 152 and WebView2 157 honour it, other engines ignore the flag and keep their own
 * heuristic). Before the first input nothing has been pressed yet, so no ring is drawn.
 */
let lastInput: 'keyboard' | 'pointer' | 'none' = 'none';

const modifierKeys = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock']);

// Window capture is the first stop of every event, so a handler that moves focus in its own keydown (Escape closing a
// card on window or document) already sees this input; this module loads before the app registers its handlers.
// Server-side renders in tests stub window and document; only a real event target takes listeners.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('keydown', event => { if (!modifierKeys.has(event.key)) lastInput = 'keyboard'; }, true);
  window.addEventListener('pointerdown', () => { lastInput = 'pointer'; }, true);
}

/** Focuses an element with the keyboard ring when the last input was a key, and without it after a click or a tap.
 *  `quiet` suppresses the ring for a destination that should not call attention to itself, such as the opened deck's title. */
export function moveFocus(element: HTMLElement | null | undefined, options: Omit<FocusOptions, 'focusVisible'> & { quiet?: boolean } = {}): void {
  const { quiet = false, ...focusOptions } = options;
  element?.focus({ ...focusOptions, focusVisible: !quiet && lastInput === 'keyboard' });
}
