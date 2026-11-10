import { useCallback, type RefObject } from 'react';

export function usePreparedEntrance<Element extends HTMLElement>(ref: RefObject<Element | null>) {
  return useCallback((element: Element | null) => {
    ref.current = element;
    return prepareEntrance(element);
  }, [ref]);
}

const preparationLimit = 120;

// 2026-11-10: mounting, font application and the first layer commit belong before motion, not in its first frame.
// Pause existing animations rather than replaying them: their design-token duration, delay and easing stay intact.
export function prepareEntrance(element: HTMLElement | null, supplied?: Animation[]): (() => void) | undefined {
  if (!element || element.dataset.state === 'closed' || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const animations = [...new Set(supplied ?? element.getAnimations({ subtree: true }).filter(animation =>
    animation instanceof CSSAnimation && animation.playState === 'running' && animation.effect?.getComputedTiming().iterations !== Infinity))];
  if (!animations.length) return;
  const previous = element.style.willChange;
  element.style.willChange = 'transform, opacity';
  for (const animation of animations) { animation.pause(); animation.currentTime = 0; }
  let frame = 0;
  let cancelled = false;
  const images = [...element.querySelectorAll('img')];
  const decoded = images.map(image => image.decode().catch(() => {}));
  // 2026-11-10: later layout effects in this commit can start fonts after an overlay's ref was attached.
  // The wait is capped: a large attachment still downloading must not hold a panel invisible on its frame zero.
  const prepared = Promise.all([Promise.resolve().then(() => document.fonts.ready), ...decoded]);
  void Promise.race([prepared, new Promise(resolve => setTimeout(resolve, preparationLimit))]).then(() => {
    if (cancelled || !element.isConnected) return;
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        if (cancelled || !element.isConnected) return;
        for (const animation of animations) if (animation.playState === 'paused') animation.play();
        void Promise.allSettled(animations.map(animation => animation.finished)).then(() => {
          if (!cancelled) element.style.willChange = previous;
        });
      });
    });
  });
  return () => {
    cancelled = true;
    cancelAnimationFrame(frame);
    element.style.willChange = previous;
  };
}
