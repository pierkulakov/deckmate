import { useEffect, useRef, type PointerEvent } from 'react';

// 2026-11-08: one rigid ribbon of metal moves across a tile's bands:
// it sweeps in once on enter, follows the tilt while hovered — against the pointer horizontally, with it vertically —
// and sweeps out on leave. The ribbon's hot cut is measured in band widths at the tile's mid-height; the numbers are
// tuned for the motion, and card-material.css mirrors RIBBON_REST as --glare-rest.
const RIBBON_REST = 1.39;
const RIBBON_CENTER = 0.377;
const RIBBON_PER_ACROSS = -0.522;
const RIBBON_PER_DOWN = 0.485;
// Each 33 ms closes 35% of the remaining distance: an exponential follow with a 77 ms time constant.
const RIBBON_FOLLOW_MS = 77;
const RIBBON_SETTLED = 0.0005;

// 2026-11-08: tiles and flat preview bands share one pointer sample and one animation frame. Flat bands (maximum 0)
// have no tilt and no ribbon; their glow only reads --glare-x and --glare-opacity.
export function useCardTilt<Element extends HTMLElement>(maximum: number, disabled = false) {
  const element = useRef<Element>(null);
  const frame = useRef(0);
  const pointer = useRef({ hovered: false, x: 0.5, y: 0.5 });
  const ribbon = useRef({ shift: RIBBON_REST, time: 0 });
  const reducedMotion = useRef<MediaQueryList | null>(null);
  if (!reducedMotion.current) reducedMotion.current = window.matchMedia('(prefers-reduced-motion: reduce)');

  function paint(time: number) {
    frame.current = 0;
    const style = element.current?.style;
    if (!style) return;
    const { hovered, x, y } = pointer.current;
    if (maximum) {
      style.setProperty('--tilt-x', hovered ? `${(0.5 - y) * maximum * 2}deg` : '0deg');
      style.setProperty('--tilt-y', hovered ? `${(x - 0.5) * maximum * 2}deg` : '0deg');
    }
    // The last horizontal position stays after leaving: the open card's glow finishes its drift while fading out.
    style.setProperty('--glare-x', `${x * 100}%`);
    // 2026-11-09: the accepted Hero's foil and glitter also follow the pointer vertically.
    style.setProperty('--glare-y', `${y * 100}%`);
    style.setProperty('--glare-u', x.toFixed(4));
    style.setProperty('--glare-v', y.toFixed(4));
    style.setProperty('--glare-opacity', hovered ? '1' : '0');
    let moving = false;
    if (maximum) {
      const state = ribbon.current;
      const target = hovered ? RIBBON_CENTER + RIBBON_PER_ACROSS * (x - 0.5) + RIBBON_PER_DOWN * (y - 0.5) : RIBBON_REST;
      const elapsed = state.time ? Math.min(100, time - state.time) : 1000 / 60;
      state.shift += (target - state.shift) * (1 - Math.exp(-elapsed / RIBBON_FOLLOW_MS));
      moving = Math.abs(target - state.shift) > RIBBON_SETTLED;
      if (!moving) state.shift = target;
      state.time = moving ? time : 0;
      style.setProperty('--glare-shift', state.shift.toFixed(4));
    }
    // 2026-11-09: no will-change toggling here — layers created and dropped per hover made the content jump; the tile
    // keeps one layer for good in card-material.css.
    if (moving) frame.current = requestAnimationFrame(paint);
  }
  function schedule() {
    if (!frame.current) frame.current = requestAnimationFrame(paint);
  }
  function reset() {
    pointer.current.hovered = false;
    schedule();
  }
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  useEffect(() => { if (disabled) reset(); }, [disabled]);
  function tilt(event: PointerEvent<HTMLElement>) {
    if (disabled || event.pointerType === 'touch' || reducedMotion.current?.matches) { reset(); return; }
    const rectangle = event.currentTarget.getBoundingClientRect();
    if (!rectangle.width || !rectangle.height) return;
    pointer.current = {
      hovered: true,
      x: Math.min(1, Math.max(0, (event.clientX - rectangle.left) / rectangle.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rectangle.top) / rectangle.height)),
    };
    schedule();
  }
  return { element, tilt, reset };
}
