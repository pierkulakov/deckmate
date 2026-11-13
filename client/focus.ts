import './focus.js';

/** 2026-11-13: sharing Tab intent with the launcher keeps Escape, shortcuts and pointer returns quiet.
 *  The CSS guard also covers engines that ignore focusVisible and focus restored by dialog libraries. */
export function moveFocus(element: HTMLElement | null | undefined, options: Omit<FocusOptions, 'focusVisible'> & { quiet?: boolean } = {}): void {
  const { quiet = false, ...focusOptions } = options;
  element?.focus({ ...focusOptions, focusVisible: !quiet && document.documentElement?.hasAttribute('data-tab-focus') === true });
}
