import { useCallback, type RefObject } from 'react';

export function usePreparedEntrance<Element extends HTMLElement>(ref: RefObject<Element | null>) {
  return useCallback((element: Element | null) => {
    ref.current = element;
    return prepareEntrance(element);
  }, [ref]);
}

const imagePreparationLimit = 120;

// 2026-11-10: mounting, font application and the first layer commit belong before motion, not in its first frame.
// Pause existing animations rather than replaying them: their design-token duration, delay and easing stay intact.
export function prepareEntrance(element: HTMLElement | null, supplied?: Animation[]): (() => void) | undefined {
  if (!element || element.dataset.state === 'closed' || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const animations = [...new Set(supplied ?? element.getAnimations({ subtree: true }).filter(animation =>
    animation instanceof CSSAnimation && animation.playState === 'running' && animation.effect?.getComputedTiming().iterations !== Infinity))];
  if (!animations.length) return;
  // 2026-11-13: promote the actual moving targets, not their ancestor; a preview's content and its shell are different layers.
  const layers = new Map<HTMLElement | SVGElement, { previous: string; properties: Set<string> }>();
  for (const animation of animations) {
    const effect = animation.effect as KeyframeEffect | null;
    const target = effect?.target;
    if (!(target instanceof HTMLElement || target instanceof SVGElement)) continue;
    const properties = ['transform', 'translate', 'scale', 'opacity', 'clipPath'].filter(property =>
      effect!.getKeyframes().some(keyframe => property in keyframe));
    if (!properties.length) continue;
    let layer = layers.get(target);
    if (!layer) {
      layer = { previous: target.style.willChange, properties: new Set() };
      layers.set(target, layer);
    }
    for (const property of properties) layer.properties.add(property === 'clipPath' ? 'clip-path' : property);
  }
  for (const [target, layer] of layers) target.style.willChange = [...layer.properties].join(', ');
  const restoreLayers = () => { for (const [target, layer] of layers) target.style.willChange = layer.previous; };
  for (const animation of animations) { animation.pause(); animation.currentTime = 0; }
  let frame = 0;
  let cancelled = false;
  const images = [...element.querySelectorAll('img')];
  const decoded = images.map(image => image.decode().catch(() => {}));
  // 2026-11-10: later layout effects in this commit can start fonts after an overlay's ref was attached.
  // Image decoding is capped: a large attachment still downloading must not hold a panel invisible on its frame zero.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const imagesReady = Promise.race([Promise.all(decoded), new Promise(resolve => { timer = setTimeout(resolve, imagePreparationLimit); })]);
  // 2026-11-13: only images have a deadline. Releasing a slow font at 120 ms lets its swap move text during the entrance.
  const prepared = Promise.all([Promise.resolve().then(() => document.fonts.ready), imagesReady]);
  void prepared.then(() => {
    clearTimeout(timer);
    if (cancelled || !element.isConnected) return;
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        if (cancelled || !element.isConnected) return;
        for (const animation of animations) if (animation.playState === 'paused') animation.play();
        void Promise.allSettled(animations.map(animation => animation.finished)).then(() => {
          if (!cancelled) restoreLayers();
        });
      });
    });
  });
  return () => {
    cancelled = true;
    clearTimeout(timer);
    cancelAnimationFrame(frame);
    restoreLayers();
  };
}
