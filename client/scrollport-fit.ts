import { useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * The visible height of a panel that must fit the workspace scrollport below its own top edge. A sticky panel sits
 * lower than its pinned offset until the page scrolls (the deck view keeps the neighbor rail above the toolbar), so
 * the measured space — not the pinned-offset formula in CSS — is the cap; New Card has measured this way since
 * 2026-11-04, and the open card shares the same cap (2026-11-08), so its material band stays inside the viewport
 * without scrolling the page. Sets <variable> on the element the resolver returns; nothing happens when the resolver
 * finds no element (Focus Mode's portal lives outside .workspace-main).
 */
export function useScrollportFitHeight(resolve: (start: HTMLElement) => HTMLElement | null, variable: string): RefObject<HTMLElement | null> {
  const start = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const element = start.current ? resolve(start.current) : null;
    if (!element) return;
    const panel: HTMLElement = element;
    const scrollport = panel.closest<HTMLElement>('.workspace-main');
    const viewport = window.visualViewport;
    let frame = 0;
    function measure() {
      const bounds = panel.getBoundingClientRect();
      const scale = panel.offsetWidth > 0 ? bounds.width / panel.offsetWidth : 1;
      if (scale <= 0) return;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight);
      const scrollportBounds = scrollport?.getBoundingClientRect();
      const top = Math.max(bounds.top, viewportTop, scrollportBounds?.top ?? viewportTop);
      const bottom = Math.min(viewportBottom, scrollportBounds?.bottom ?? viewportBottom);
      // Clamp to visible scrollport space; scrolling a static slot above the panel must not grow it.
      const height = Math.max(0, Math.floor((bottom - top) / scale - 12));
      const value = height + 'px';
      if (panel.style.getPropertyValue(variable) !== value) panel.style.setProperty(variable, value);
    }
    function schedule() {
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; measure(); });
    }
    const observer = new ResizeObserver(schedule);
    for (const node of [panel, scrollport, panel.closest('.catalog-view')]) if (node) observer.observe(node);
    measure();
    scrollport?.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, { passive: true });
    viewport?.addEventListener('resize', schedule);
    viewport?.addEventListener('scroll', schedule);
    return () => {
      observer.disconnect(); cancelAnimationFrame(frame);
      scrollport?.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule);
      viewport?.removeEventListener('resize', schedule);
      viewport?.removeEventListener('scroll', schedule);
    };
  }, [resolve, variable]);
  return start;
}
