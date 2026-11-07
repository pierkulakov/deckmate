import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';
import './deck-transition.css';

// 2026-11-05: opening a deck is not a screen swap. The clicked row stays where it is, the open deck appears under it and the
// page scrolls up until only the lower part of the row shows — that strip is the shelf. Closing brings the row back down into
// full view. The shelf is rendered as a separate rail, so the moment is built from a frozen copy of the gallery that scrolls
// away above the arriving deck; React owns only the new layout.

/** easeOutQuart, the scroll curve; the same value is --ease-scroll in motion.css. */
const scrollEasing = 'cubic-bezier(.25, 1, .5, 1)';
const dimDuration = 150;
const dimmedOpacity = .25;

type Direction = 'open' | 'close';

interface Snapshot {
  direction: Direction;
  deckId: string;
  from: DOMRect;
  page: DOMRect;
  /** Where the shelf cuts its covers; the returning row is cut there too until it is below it. */
  shelfTop: number | null;
  ghost: HTMLElement | null;
}

/**
 * Half a millisecond per pixel of travel, 200–300 ms: rows further down take the full 300 ms, and a deck in the first row
 * would flash by in 100 ms without the floor.
 */
export function travelDuration(distance: number) {
  return Math.max(200, Math.min(300, Math.abs(distance) * .5));
}

function coverOf(scope: ParentNode, deckId: string) {
  return scope.querySelector<HTMLElement>(`[data-deck-cover="${CSS.escape(deckId)}"]`);
}

function reducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Call the returned function right before the deck opens or closes, while the old layout is still on screen.
 * The motion runs once, on the commit that shows the requested deck; every other render is left alone.
 */
export function useDeckTransition(page: RefObject<HTMLElement | null>, openDeckId: string | null) {
  const pending = useRef<Snapshot | null>(null);
  const stop = useRef<(() => void) | null>(null);

  const capture = useCallback((direction: Direction, deckId: string) => {
    stop.current?.();
    stop.current = null;
    pending.current = null;
    const section = page.current;
    const cover = section && coverOf(section, deckId);
    if (!section || !cover) return;
    const still = reducedMotion();
    const shelf = cover.closest('.deck-neighbor-rail');
    const snapshot: Snapshot = { direction, deckId, from: cover.getBoundingClientRect(), page: section.getBoundingClientRect(), shelfTop: shelf ? shelf.getBoundingClientRect().top : null, ghost: direction === 'open' && !still ? freeze(section, deckId) : null };
    pending.current = snapshot;
    // A navigation that did not happen must not animate a later one from stale positions.
    window.setTimeout(() => { if (pending.current === snapshot) pending.current = null; }, 1000);
  }, [page]);

  useLayoutEffect(() => {
    const snapshot = pending.current;
    const section = page.current;
    if (!snapshot || !section) return;
    const arrived = snapshot.direction === 'open' ? openDeckId === snapshot.deckId : openDeckId === null;
    if (!arrived) return;
    pending.current = null;
    stop.current = snapshot.direction === 'open' ? arrive(section, snapshot) : comeBack(section, snapshot);
  }, [openDeckId, page]);

  useEffect(() => () => { stop.current?.(); }, []);
  return capture;
}

/** A static copy of a page as it looks now: no ids, no focus, no pointer. */
function freeze(section: HTMLElement, hoveredDeckId?: string) {
  const copy = section.cloneNode(true) as HTMLElement;
  for (const element of copy.querySelectorAll('[id]')) element.removeAttribute('id');
  copy.removeAttribute('id');
  copy.setAttribute('aria-hidden', 'true');
  copy.inert = true;
  copy.classList.add('deck-transition-ghost');
  // The pointer leaves the cover as the page moves; the copy starts from the hover look and fades out of it like the real tile.
  if (hoveredDeckId) for (const element of hovered(copy, hoveredDeckId)) element.classList.add('is-transition-hover');
  return copy;
}

function hovered(copy: HTMLElement, deckId: string) {
  const cover = coverOf(copy, deckId);
  return [cover, cover?.closest<HTMLElement>('.catalog-cover-item')].filter(element => element != null);
}

function scrollportOf(section: HTMLElement) {
  return section.closest<HTMLElement>('.workspace-main');
}

function scrollBy(scrollport: HTMLElement, delta: number) {
  if (Math.abs(delta) >= 1) scrollport.scrollTo({ top: scrollport.scrollTop + delta, behavior: 'instant' });
}

function arrive(section: HTMLElement, snapshot: Snapshot) {
  const scrollport = scrollportOf(section);
  const target = coverOf(section.querySelector('.deck-neighbor-rail') ?? section, snapshot.deckId);
  const rail = target?.parentElement;
  if (!scrollport || !target || !rail) { snapshot.ghost?.remove(); return null; }
  // The open deck starts at its shelf: a scrolled gallery must not leave the deck view scrolled into its cards.
  const port = scrollport.getBoundingClientRect();
  if (rail.getBoundingClientRect().top < port.top) scrollBy(scrollport, section.getBoundingClientRect().top - port.top);
  // Keep the row's columns: scroll the shelf so the opened deck stays at the x it had in the gallery.
  rail.scrollLeft += target.getBoundingClientRect().left - snapshot.from.left;
  const ghost = snapshot.ghost;
  const to = target.getBoundingClientRect();
  const dx = snapshot.from.left - to.left;
  const dy = snapshot.from.top - to.top;
  if (!ghost || (Math.abs(dx) < 1 && Math.abs(dy) < 1)) { ghost?.remove(); return null; }

  const edge = Math.max(port.top, rail.getBoundingClientRect().top);
  const page = section.getBoundingClientRect();
  // Both pages travel as frozen copies in a fixed layer, cut at the shelf's top edge where the arriving covers are cut too.
  // The old page is also cut below the clicked row, so the open deck shows under it like the rest of a scrolled page.
  // The live deck stays put and hidden: moved by a transform, it stretched the scroll area for the length of the move and
  // the scrollbar blinked (2026-11-05).
  const layer = document.createElement('div');
  layer.className = 'deck-transition-layer';
  layer.setAttribute('aria-hidden', 'true');
  Object.assign(layer.style, { left: port.left + 'px', top: edge + 'px', width: scrollport.clientWidth + 'px', height: Math.max(0, port.bottom - edge) + 'px' });
  const arrival = freeze(section);
  Object.assign(arrival.style, { left: page.left - port.left + 'px', top: page.top - edge + 'px', width: page.width + 'px' });
  Object.assign(ghost.style, { left: snapshot.page.left - port.left + 'px', top: snapshot.page.top - edge + 'px', width: snapshot.page.width + 'px', clipPath: `inset(0 0 ${Math.max(0, snapshot.page.bottom - snapshot.from.bottom)}px 0)` });
  layer.append(arrival, ghost);
  scrollport.append(layer);
  // Scroll offsets are not part of a copy.
  const arrivalRail = arrival.querySelector<HTMLElement>('.deck-neighbor-rail');
  if (arrivalRail) arrivalRail.scrollLeft = rail.scrollLeft;

  const duration = travelDuration(dy);
  const timing: KeyframeAnimationOptions = { duration, easing: scrollEasing };
  const motions = [
    section.animate([{ opacity: 0 }, { opacity: 0 }], { duration }),
    // When the shelf cannot scroll far enough to keep the column (a row further down a wide space), only the leaving copy
    // drifts sideways onto the shelf; the arriving deck moves straight up.
    arrival.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { ...timing, fill: 'forwards' }),
    ghost.animate([{ transform: 'none' }, { transform: `translate(${-dx}px, ${-dy}px)` }], { ...timing, fill: 'forwards' }),
  ];
  // Neighbours dim as the shelf forms: the leaving copies fade out over the arriving shelf, whose covers are already dimmed.
  // Dimmed to 25% themselves, they stacked on the shelf's 25% covers and the row dropped to its final look only when the
  // layer went away (2026-11-07). The gallery's own tools are not part of the shelf and leave with the page.
  for (const cover of ghost.querySelectorAll<HTMLElement>('[data-deck-cover]')) {
    if (cover.dataset.deckCover !== snapshot.deckId) motions.push(cover.animate([{ opacity: 1 }, { opacity: 0 }], { duration, easing: 'ease-out', fill: 'forwards' }));
  }
  for (const tile of ghost.querySelectorAll<HTMLElement>('.catalog-add-deck')) motions.push(tile.animate([{ opacity: 1 }, { opacity: 0 }], { duration: dimDuration, easing: 'ease-out', fill: 'forwards' }));
  requestAnimationFrame(() => { for (const element of hovered(ghost, snapshot.deckId)) element.classList.remove('is-transition-hover'); });

  const finish = () => { for (const motion of motions) motion.cancel(); layer.remove(); };
  motions[0].finished.then(finish, finish);
  return finish;
}

function comeBack(section: HTMLElement, snapshot: Snapshot) {
  const scrollport = scrollportOf(section);
  const target = coverOf(section, snapshot.deckId);
  if (!scrollport || !target) return null;
  const port = scrollport.getBoundingClientRect();
  // The row returns where the shelf was; a row outside the view is brought in first, 5 px under the edge.
  const landing = target.getBoundingClientRect();
  if (landing.top < port.top || landing.bottom > port.bottom) scrollBy(scrollport, landing.top - port.top - 5);
  if (reducedMotion()) return null;
  const to = target.getBoundingClientRect();
  const dy = snapshot.from.top - to.top;
  const motions: Animation[] = [];
  if (Math.abs(dy) >= 1) {
    const timing: KeyframeAnimationOptions = { duration: travelDuration(dy), easing: scrollEasing };
    const pageTop = section.getBoundingClientRect().top;
    // Straight down only: a page shifted sideways stretches the scroll area and blinks a horizontal scrollbar (2026-11-05).
    // Upward the transform never adds scroll length, so the live gallery moves itself.
    motions.push(section.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], timing));
    // The row leaves the shelf cut at the shelf's edge, not 12 px higher at the scrollport's: the cut stays put while the
    // page slides under it, and ends inside the page's empty top padding.
    if (snapshot.shelfTop !== null) {
      const cut = snapshot.shelfTop - pageTop;
      motions.push(section.animate([{ clipPath: `inset(${cut - dy}px -100vw -100vh)` }, { clipPath: `inset(${cut}px -100vw -100vh)` }], timing));
    }
  }
  for (const cover of section.querySelectorAll<HTMLElement>('[data-deck-cover]')) {
    if (cover.dataset.deckCover !== snapshot.deckId) motions.push(cover.animate([{ opacity: dimmedOpacity }, { opacity: 1 }], { duration: dimDuration, easing: 'ease-out' }));
  }
  for (const tile of section.querySelectorAll<HTMLElement>('.catalog-add-deck')) motions.push(tile.animate([{ opacity: 0 }, { opacity: 1 }], { duration: dimDuration, easing: 'ease-out' }));
  if (motions.length === 0) return null;
  return () => { for (const motion of motions) motion.cancel(); };
}
