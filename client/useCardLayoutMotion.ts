import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { RefCallback } from 'react';
import './card-motion.css';

interface CardLayoutMotionOptions {
  /** Include the ordered IDs and group boundaries; use a stable primitive. */
  layoutKey: string | number;
  /** Change on navigation, source, or Cards/Table switches, not on sorting. */
  resetKey?: string | number;
  /** Suspend layout motion while the drag engine owns item positions. */
  dragging?: boolean;
}

interface CardPosition {
  element: HTMLElement;
  parent: HTMLElement | null;
  left: number;
  top: number;
  width: number;
  height: number;
  visible: boolean;
}

interface RunningMotion {
  element: HTMLElement;
  animation: Animation;
}

interface LayoutMotionController {
  update: (options: CardLayoutMotionOptions) => void;
  dispose: () => void;
}

/**
 * Put data-card-id on each stable, transform-free outer wrapper, with tilt on
 * its child. Flow elements that are not cards (group headings, an Add control) carry
 * data-layout-follow="<key>" and move with the cards instead of jumping over them. One common container lets a card move between keyed groups.
 * This animates committed layout changes; it does not implement drag ordering.
 */
export function useCardLayoutMotion<ElementType extends HTMLElement = HTMLDivElement>(
  options: CardLayoutMotionOptions,
): RefCallback<ElementType> {
  const [container, setContainer] = useState<ElementType | null>(null);
  const controller = useRef<LayoutMotionController | null>(null);
  const attach = useCallback((element: ElementType | null) => setContainer(element), []);

  useLayoutEffect(() => {
    if (!container) return;
    const active = createLayoutMotion(container);
    controller.current = active;
    return () => {
      active.dispose();
      if (controller.current === active) controller.current = null;
    };
  }, [container]);

  useLayoutEffect(() => {
    controller.current?.update(options);
  }, [container, options.layoutKey, options.resetKey, options.dragging]);

  return attach;
}

/**
 * Page layout position, blind to transforms and scrolling. 2026-11-05: container-relative offsets missed a row inserted
 * above the grid (a result count, a banner), and viewport offsets went stale when measured while an ancestor was moving
 * (the deck transition); the layout position is right in both cases. Any scroll rebases before the next update.
 */
function layoutOffset(element: HTMLElement) {
  let left = 0;
  let top = 0;
  for (let node: Element | null = element; node instanceof HTMLElement; node = node.offsetParent) {
    left += node.offsetLeft;
    top += node.offsetTop;
  }
  return { left, top };
}

// 2026-11-05 (Add zone ran over the cards leaving under My cards): a heading or an Add control never travels across
// content. It steps out where it was, waits until removed cards have faded (220 ms) and the rest have landed, then appears
// in its new place. Keyframe easing is per segment; the animation itself runs linear so the offsets stay in real time.
const followerDuration = 440;
const followerShown = .6;

function followerMove(horizontal: number, vertical: number): Keyframe[] {
  const from = `translate(${horizontal}px, ${vertical}px)`;
  return [
    { offset: 0, transform: from, opacity: 1, easing: 'ease-out' },
    { offset: .2, transform: from, opacity: 0 },
    { offset: .2, transform: 'none', opacity: 0 },
    { offset: followerShown, transform: 'none', opacity: 0, easing: 'ease-out' },
    { offset: 1, transform: 'none', opacity: 1 },
  ];
}

function followerArrival(): Keyframe[] {
  return [{ offset: 0, opacity: 0 }, { offset: followerShown, opacity: 0, easing: 'ease-out' }, { offset: 1, opacity: 1 }];
}

function createLayoutMotion(container: HTMLElement): LayoutMotionController {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const running = new Map<string, RunningMotion>();
  const originalRoot = container.getAttribute('data-card-motion-root');
  container.setAttribute('data-card-motion-root', '');
  let positions = new Map<string, CardPosition>();
  let previousKey: CardLayoutMotionOptions['layoutKey'];
  let previousReset: CardLayoutMotionOptions['resetKey'];
  let containerWidth = 0;
  let initialized = false;
  let disposed = false;
  let resetFrame: number | null = null;
  // Cards that left the layout keep fading where they were while the others close the gap (2026-11-05).
  const leaving = new Set<HTMLElement>();
  const fadeEasing = getComputedStyle(document.documentElement).getPropertyValue('--ease-spring-firm').trim() || 'ease-out';

  function measure() {
    const bounds = container.getBoundingClientRect();
    const next = new Map<string, CardPosition>();
    for (const element of container.querySelectorAll<HTMLElement>('[data-card-id], [data-layout-follow]')) {
      if (element.closest('[data-card-motion-root]') !== container) continue;
      const id = element.dataset.cardId ?? (element.dataset.layoutFollow ? 'follow:' + element.dataset.layoutFollow : undefined);
      const rect = element.getBoundingClientRect();
      if (!id || next.has(id) || rect.width === 0 || rect.height === 0) continue;
      next.set(id, {
        element,
        parent: element.parentElement,
        ...layoutOffset(element),
        width: rect.width,
        height: rect.height,
        visible: rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth,
      });
    }
    return { positions: next, width: bounds.width };
  }

  /** A removed card is copied back over its old place, out of flow and inert, and fades while the others close the gap. */
  function fadeOut(position: CardPosition, shift: { left: number; top: number }) {
    if (typeof position.element.animate !== 'function') return;
    const ghost = position.element.cloneNode(true) as HTMLElement;
    for (const element of [ghost, ...ghost.querySelectorAll<HTMLElement>('[data-card-id], [data-layout-follow], [id]')]) { element.removeAttribute('data-card-id'); element.removeAttribute('data-layout-follow'); element.removeAttribute('id'); }
    ghost.removeAttribute('data-card-layout-moving');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.inert = true;
    Object.assign(ghost.style, {
      // Beneath the flow of its isolated motion root: cards and followers closing the gap pass over the fading copy.
      position: 'fixed', zIndex: '-1', margin: '0', pointerEvents: 'none', transform: 'none',
      left: position.left + shift.left + 'px', top: position.top + shift.top + 'px',
      width: position.width + 'px', height: position.height + 'px',
    });
    (position.parent?.isConnected ? position.parent : container).append(ghost);
    leaving.add(ghost);
    const animation = ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: fadeEasing, fill: 'forwards' });
    const remove = () => { leaving.delete(ghost); ghost.remove(); };
    animation.onfinish = remove;
    animation.oncancel = remove;
  }

  function stopMotion(motion: RunningMotion) {
    motion.animation.onfinish = null;
    motion.animation.oncancel = null;
    motion.animation.cancel();
    motion.element.removeAttribute('data-card-layout-moving');
  }

  function stopAll() {
    for (const motion of running.values()) stopMotion(motion);
    running.clear();
  }

  function rebase() {
    const measured = measure();
    positions = measured.positions;
    containerWidth = measured.width;
  }

  function scheduleRebase() {
    stopAll();
    if (resetFrame !== null) return;
    resetFrame = requestAnimationFrame(() => {
      resetFrame = null;
      if (!disposed) rebase();
    });
  }

  function animate(id: string, element: HTMLElement, keyframes: Keyframe[], duration: number, easing = 'cubic-bezier(.16, 1, .3, 1)') {
    if (typeof element.animate !== 'function') return;
    element.setAttribute('data-card-layout-moving', '');
    const animation = element.animate(keyframes, { duration, easing, fill: 'both' });
    const motion = { element, animation };
    running.set(id, motion);
    const finish = () => {
      if (running.get(id) !== motion) return;
      running.delete(id);
      stopMotion(motion);
    };
    animation.onfinish = finish;
    animation.oncancel = finish;
  }

  function update(options: CardLayoutMotionOptions) {
    if (disposed) return;
    const previous = new Map(positions);
    // Read every running offset before canceling: rapid sorts start where the
    // cards currently appear, not at the previous animation's destination.
    for (const [id, motion] of running) {
      const position = previous.get(id);
      if (!position || !motion.element.isConnected) continue;
      const transform = getComputedStyle(motion.element).transform;
      if (transform === 'none') continue;
      const matrix = new DOMMatrixReadOnly(transform);
      previous.set(id, { ...position, left: position.left + matrix.m41, top: position.top + matrix.m42 });
    }
    stopAll();
    const wasResizing = resetFrame !== null;
    if (resetFrame !== null) cancelAnimationFrame(resetFrame);
    resetFrame = null;
    const next = measure();
    const shouldAnimate = initialized && previousKey !== options.layoutKey && previousReset === options.resetKey
      && !options.dragging && !reducedMotion.matches && !wasResizing && Math.abs(next.width - containerWidth) < 1;
    positions = next.positions;
    containerWidth = next.width;
    previousKey = options.layoutKey;
    previousReset = options.resetKey;
    initialized = true;
    if (!shouldAnimate) return;

    // Reads above, animation writes below; never alternate layout reads and
    // writes per card. Only visible, stable-size cards need spatial motion.
    // Layout to viewport for this frame, read once before the copies are written.
    const origin = layoutOffset(container);
    const bounds = container.getBoundingClientRect();
    const shift = { left: bounds.left - origin.left, top: bounds.top - origin.top };
    for (const [id, position] of previous) {
      if (!next.positions.has(id) && position.visible && !position.element.isConnected) fadeOut(position, shift);
    }
    for (const [id, nextPosition] of next.positions) {
      const previousPosition = previous.get(id);
      const follower = id.startsWith('follow:');
      if (!previousPosition) {
        if (!nextPosition.visible) continue;
        if (follower) animate(id, nextPosition.element, followerArrival(), followerDuration, 'linear');
        else animate(id, nextPosition.element, [{ opacity: .65 }, { opacity: 1 }], 150);
        continue;
      }
      if (!previousPosition.visible && !nextPosition.visible) continue;
      if (Math.abs(previousPosition.width - nextPosition.width) > 1 || Math.abs(previousPosition.height - nextPosition.height) > 1) continue;
      const horizontal = previousPosition.left - nextPosition.left;
      const vertical = previousPosition.top - nextPosition.top;
      if (Math.abs(horizontal) < .5 && Math.abs(vertical) < .5) continue;
      // Do not fly cards through multiple screens after a large filter change.
      if (Math.abs(horizontal) > window.innerWidth || Math.abs(vertical) > window.innerHeight) continue;
      if (follower) {
        animate(id, nextPosition.element, followerMove(horizontal, vertical), followerDuration, 'linear');
        continue;
      }
      animate(id, nextPosition.element, [
        { transform: `translate(${horizontal}px, ${vertical}px)` },
        { transform: 'translate(0px, 0px)' },
      ], 220);
    }
  }

  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
    if (Math.abs(container.getBoundingClientRect().width - containerWidth) >= 1) scheduleRebase();
  }) : null;
  observer?.observe(container);
  // 2026-11-05: virtual rows commit after the scroll callback; rebase on that commit, never animate windowing.
  const windowObserver = new MutationObserver(scheduleRebase);
  windowObserver.observe(container, { attributes: true, subtree: true, attributeFilter: ['data-card-window'] });
  // Page/ancestor scrolling must not replay a stale viewport position. Cancel
  // immediately and coalesce measurements; no per-frame animation polling.
  window.addEventListener('scroll', scheduleRebase, true);
  window.addEventListener('resize', scheduleRebase);
  reducedMotion.addEventListener('change', scheduleRebase);

  return {
    update,
    dispose() {
      disposed = true;
      stopAll();
      for (const ghost of leaving) ghost.remove();
      leaving.clear();
      if (resetFrame !== null) cancelAnimationFrame(resetFrame);
      observer?.disconnect();
      windowObserver.disconnect();
      window.removeEventListener('scroll', scheduleRebase, true);
      window.removeEventListener('resize', scheduleRebase);
      reducedMotion.removeEventListener('change', scheduleRebase);
      if (originalRoot === null) container.removeAttribute('data-card-motion-root');
      else container.setAttribute('data-card-motion-root', originalRoot);
      positions.clear();
    },
  };
}
