import { moveFocus } from './focus.ts';
import type { KeyboardEvent } from 'react';

/** Keep focus and selection together in the app's automatically activated tab lists. */
export function navigateTabs(event: KeyboardEvent<HTMLElement>) {
  if (event.defaultPrevented || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled):not([aria-disabled="true"])')];
  const current = tabs.indexOf(event.target as HTMLButtonElement);
  if (current < 0) return;
  const direction = getComputedStyle(event.currentTarget).direction === 'rtl' ? -1 : 1;
  let next = (current + (event.key === 'ArrowRight' ? direction : -direction) + tabs.length) % tabs.length;
  if (event.key === 'Home') next = 0;
  if (event.key === 'End') next = tabs.length - 1;
  event.preventDefault();
  event.stopPropagation();
  moveFocus(tabs[next]);
  tabs[next].click();
}
