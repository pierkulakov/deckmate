import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { CatalogCard } from '../../src/catalog-contracts.ts';

interface VirtualCardGridProps {
  cards: CatalogCard[];
  enabled: boolean;
  pinnedIds: readonly string[];
  children: (card: CatalogCard) => ReactNode;
}

interface GridMetrics {
  columns: number;
  tileWidth: number;
  tileHeight: number;
  columnWidth: number;
  rowHeight: number;
  insetLeft: number;
  insetTop: number;
  bottomInset: number;
}

interface GridWindow extends GridMetrics {
  start: number;
  end: number;
  interactionIds: string[];
}

interface RegisteredGrid extends GridMetrics { cards: CatalogCard[] }
const virtualGrids = new WeakMap<HTMLElement, RegisteredGrid>();

interface VirtualCardNavigationEntry {
  cardId: string;
  rectangle: { left: number; top: number; width: number; height: number };
}

/** 2026-11-05: keyboard geometry includes unmounted cards without a layout read for every card. */
export function virtualCardNavigationEntries(root: HTMLElement): VirtualCardNavigationEntry[] {
  const grids = [...root.querySelectorAll<HTMLElement>('[data-virtual-card-grid]')];
  if (root.matches('[data-virtual-card-grid]')) grids.unshift(root);
  return grids.flatMap(grid => {
    const registered = virtualGrids.get(grid);
    const bounds = grid.getBoundingClientRect();
    if (!registered || bounds.width === 0 || bounds.height === 0) return [];
    return registered.cards.map((card, index) => ({
      cardId: card.id,
      rectangle: {
        left: bounds.left + registered.insetLeft + index % registered.columns * registered.columnWidth,
        top: bounds.top + registered.insetTop + Math.floor(index / registered.columns) * registered.rowHeight,
        width: registered.tileWidth,
        height: registered.tileHeight,
      },
    }));
  });
}

function cssPixels(value: string, fallback = 0): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function gridMetrics(grid: HTMLElement): GridMetrics {
  const style = getComputedStyle(grid);
  const columnGap = cssPixels(style.columnGap);
  const rowGap = cssPixels(style.rowGap);
  const tracks = style.gridTemplateColumns.split(/\s+/u).map(track => Number.parseFloat(track)).filter(Number.isFinite);
  const tileWidth = tracks[0] ?? cssPixels(style.getPropertyValue('--tile-width'));
  const tileHeight = cssPixels(style.getPropertyValue('--tile-height'));
  const contentWidth = grid.clientWidth - cssPixels(style.paddingLeft) - cssPixels(style.paddingRight);
  // Old cell column positions can create implicit tracks during resize; count only tracks that fit the new width.
  const columns = Math.max(1, Math.floor((contentWidth + columnGap + .5) / (tileWidth + columnGap)));
  return { columns, tileWidth, tileHeight, columnWidth: tileWidth + columnGap, rowHeight: tileHeight + rowGap,
    insetLeft: cssPixels(style.borderLeftWidth) + cssPixels(style.paddingLeft),
    insetTop: cssPixels(style.borderTopWidth) + cssPixels(style.paddingTop),
    bottomInset: cssPixels(style.borderBottomWidth) + cssPixels(style.paddingBottom) };
}

function visibleBounds(grid: HTMLElement) {
  let top = 0;
  let bottom = window.innerHeight;
  // 2026-11-05: the workspace owns scrolling; its clipped viewport can be smaller than the browser window.
  for (let ancestor = grid.parentElement; ancestor; ancestor = ancestor.parentElement) {
    if (!/(auto|scroll|hidden|clip)/u.test(getComputedStyle(ancestor).overflowY)) continue;
    const bounds = ancestor.getBoundingClientRect();
    top = Math.max(top, bounds.top + ancestor.clientTop);
    bottom = Math.min(bottom, bounds.top + ancestor.clientTop + ancestor.clientHeight);
  }
  return { top, bottom };
}

/**
 * 2026-11-09: the open deck slides in under its shelf by a transform on the page's parts; every rect read during that
 * move is off by the remaining distance, and the window would keep a missing bottom row once the deck has landed.
 */
function movingAncestor(grid: HTMLElement): Animation | undefined {
  return document.getAnimations().find(animation => {
    const effect = animation.effect;
    if (!(effect instanceof KeyframeEffect) || !(effect.target instanceof Element)) return false;
    return effect.target !== grid && effect.target.contains(grid) && effect.getKeyframes().some(frame => 'transform' in frame);
  });
}

function interactionIds(grid: HTMLElement): string[] {
  const ids = new Set<string>();
  const focused = document.activeElement;
  if (focused instanceof Element && grid.contains(focused)) {
    const id = focused.closest<HTMLElement>('[data-virtual-card-cell]')?.dataset.virtualCardCell;
    if (id) ids.add(id);
  }
  // A Radix popup portals its focused content outside the grid, while its trigger retains the open state.
  for (const trigger of grid.querySelectorAll('.card-family-trigger[data-state="open"]')) {
    const id = trigger.closest<HTMLElement>('[data-virtual-card-cell]')?.dataset.virtualCardCell;
    if (id) ids.add(id);
  }
  return [...ids];
}

function sameWindow(previous: GridWindow, next: GridWindow): boolean {
  return previous.start === next.start && previous.end === next.end && previous.columns === next.columns
    && previous.tileWidth === next.tileWidth && previous.tileHeight === next.tileHeight
    && previous.columnWidth === next.columnWidth && previous.rowHeight === next.rowHeight
    && previous.insetLeft === next.insetLeft && previous.insetTop === next.insetTop && previous.bottomInset === next.bottomInset
    && previous.interactionIds.length === next.interactionIds.length
    && previous.interactionIds.every((id, index) => id === next.interactionIds[index]);
}

export function VirtualCardGrid({ cards, enabled, pinnedIds, children }: VirtualCardGridProps) {
  const element = useRef<HTMLDivElement>(null);
  const [visibleWindow, setVisibleWindow] = useState<GridWindow | null>(null);
  const initiallyVirtual = useRef(enabled);
  const currentCards = useRef(cards);
  const remeasure = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    currentCards.current = cards;
    remeasure.current?.();
  }, [cards]);

  useLayoutEffect(() => {
    const grid = element.current;
    if (!enabled || !grid) return;
    let frame: number | null = null;
    let active = true;
    let measured = false;
    let waitingFor: Animation | undefined;
    const measure = () => {
      frame = null;
      const moving = movingAncestor(grid);
      // Measure again once the move ends; the first read still runs, so a grid never starts as one column.
      if (moving) {
        if (moving !== waitingFor) {
          waitingFor = moving;
          moving.finished.then(schedule, schedule);
        }
        if (measured) return;
      }
      waitingFor = moving;
      if (grid.getBoundingClientRect().width === 0) return;
      measured = true;
      const metrics = gridMetrics(grid);
      const cards = currentCards.current;
      const bounds = grid.getBoundingClientRect();
      const viewport = visibleBounds(grid);
      const origin = bounds.top + metrics.insetTop;
      const rowCount = Math.ceil(cards.length / metrics.columns);
      const firstRow = Math.max(0, Math.min(rowCount, Math.floor((viewport.top - origin) / metrics.rowHeight) - 1));
      const lastRow = Math.max(firstRow, Math.min(rowCount, Math.ceil((viewport.bottom - origin) / metrics.rowHeight) + 1));
      const next: GridWindow = { ...metrics, start: firstRow * metrics.columns, end: Math.min(cards.length, lastRow * metrics.columns),
        interactionIds: interactionIds(grid) };
      virtualGrids.set(grid, { ...metrics, cards });
      setVisibleWindow(previous => previous && sameWindow(previous, next) ? previous : next);
    };
    const schedule = () => { if (active && frame === null) frame = requestAnimationFrame(measure); };
    remeasure.current = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      measure();
    };
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
    observer?.observe(grid);
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    document.addEventListener('focusin', schedule);
    document.addEventListener('focusout', schedule);
    return () => {
      active = false;
      remeasure.current = null;
      if (frame !== null) cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      document.removeEventListener('focusin', schedule);
      document.removeEventListener('focusout', schedule);
      virtualGrids.delete(grid);
    };
  }, [enabled]);

  // 2026-11-13: the same keyed cell survives enabling/disabling windowing; a short first batch would also clamp scrollTop.
  const measured = enabled ? visibleWindow : null;
  const pinned = new Set([...pinnedIds, ...(measured?.interactionIds ?? [])]);
  const rows = measured ? Math.ceil(cards.length / measured.columns) : 0;
  const style: CSSProperties | undefined = measured ? {
    height: measured.insetTop + measured.bottomInset + Math.max(0, rows * measured.rowHeight - (measured.rowHeight - measured.tileHeight)),
    gridAutoRows: measured.tileHeight,
    alignContent: 'start',
  } : undefined;
  return <div ref={element} className="deck-grid catalog-card-grid" data-virtual-card-grid={measured ? '' : undefined}
    data-card-window={measured ? [measured.start, measured.end, measured.columns, ...pinned].join(':') : undefined} style={style}>
    {(enabled && !measured && initiallyVirtual.current ? cards.slice(0, 24) : cards).flatMap((card, index) => {
      if (measured && (index < measured.start || index >= measured.end) && !pinned.has(card.id)) return [];
      return <div key={card.id} data-virtual-card-cell={card.id} style={{ minWidth: 0,
        gridRowStart: measured ? Math.floor(index / measured.columns) + 1 : undefined,
        gridColumnStart: measured ? index % measured.columns + 1 : undefined }}>{children(card)}</div>;
    })}
  </div>;
}
