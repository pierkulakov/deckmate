/** A duration token in milliseconds. 2026-11-10: the CSS optimizer may write 220ms as .22s; WAAPI, dnd-kit and timers take milliseconds. */
export function readDurationMs(token: string) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return parseFloat(value) * (value.endsWith('ms') ? 1 : 1000);
}

export function readMotionTokens(durationToken: string) {
  const easing = getComputedStyle(document.documentElement).getPropertyValue('--ease-out').trim();
  return { duration: readDurationMs(durationToken), easing };
}
