import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { moveFocus } from './focus.ts';
import './deck-transition.css';

// 2026-11-09: the frozen gallery owns the moving frame. Only after its row becomes the clipped shelf do the live tools
// and cards appear; moving both pages together exposes controls through the departing Add deck tile.

function motionTokens(section: HTMLElement) {
  const style = getComputedStyle(section);
  return { easing: style.getPropertyValue('--ease-scroll').trim(), feedback: parseFloat(style.getPropertyValue('--motion-feedback')) };
}

type Direction = 'open' | 'close';

interface Snapshot {
  direction: Direction;
  deckId: string;
  from: DOMRect;
  page: DOMRect;
  /** Where the shelf cuts its covers; the returning row is cut there too until it is below it. */
  shelfTop: number | null;
  galleryScrollTop: number | null;
  ghost: HTMLElement | null;
}

/**
 * Half a millisecond per pixel of travel, 200–300 ms: rows further down take the full 300 ms, and a deck in the first row
 * would flash by in 100 ms without the floor.
 */
function travelDuration(distance: number) {
  return Math.max(200, Math.min(300, Math.abs(distance) * .5));
}

/** 2026-11-10: scale from the second box to the first in either direction; differences under 1% are the same size. */
function sizeRatio(first: DOMRect, second: DOMRect) {
  const ratio = second.width > 0 ? first.width / second.width : 1;
  return Math.abs(ratio - 1) < .01 ? 1 : ratio;
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
  const galleryScrollTop = useRef<number | null>(null);

  const capture = useCallback((direction: Direction, deckId: string) => {
    stop.current?.();
    stop.current = null;
    pending.current = null;
    const section = page.current;
    const cover = section && coverOf(section, deckId);
    if (!section || !cover) return;
    const still = reducedMotion();
    if (direction === 'open') galleryScrollTop.current = scrollportOf(section)?.scrollTop ?? null;
    const shelf = cover.closest('.deck-neighbor-rail');
    const face = shelf ? cover.querySelector<HTMLElement>('.catalog-deck-cover') ?? cover : cover.closest<HTMLElement>('.catalog-cover-item') ?? cover;
    const snapshot: Snapshot = { direction, deckId, from: face.getBoundingClientRect(), page: section.getBoundingClientRect(), shelfTop: shelf ? shelf.getBoundingClientRect().top : null, galleryScrollTop: galleryScrollTop.current, ghost: direction === 'open' && !still ? freeze(section, deckId) : null };
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
    // 2026-11-10: focusing in the navigation commit fails while the live page is inert (and closing hides it).
    // The visible handoff owns focus too; preventScroll keeps it from moving the measured landing point.
    const ready = () => {
      if (!section.isConnected) return;
      // 2026-11-10: opening lands on the deck's title, not on Close: a focused Close opened its "Close deck" tooltip right
      // away. Both directions focus quietly — no ring on the title or on the cover just left (Escape lit the
      // whole cover); the next Tab shows the ring as usual.
      const target = snapshot.direction === 'open' ? section.querySelector<HTMLElement>('.deck-open-toolbar .page-title') : coverOf(section, snapshot.deckId);
      moveFocus(target, { preventScroll: true, quiet: true });
    };
    stop.current = snapshot.direction === 'open' ? arrive(section, snapshot, ready) : comeBack(section, snapshot, ready);
    if (!stop.current) ready();
  }, [openDeckId, page]);

  useEffect(() => () => { stop.current?.(); }, []);
  return capture;
}

/** A static copy of a page as it looks now: no ids, no focus, no pointer. */
function freeze(section: HTMLElement, hoveredDeckId: string) {
  const copy = section.cloneNode(true) as HTMLElement;
  for (const element of copy.querySelectorAll('[id]')) element.removeAttribute('id');
  copy.removeAttribute('id');
  copy.setAttribute('aria-hidden', 'true');
  copy.inert = true;
  copy.classList.add('deck-transition-ghost');
  // 2026-11-09: do not invent hover on a touch opening; preserve only an actual pointer or keyboard light.
  const original = coverOf(section, hoveredDeckId);
  const lit = original?.matches(':focus-visible') || (window.matchMedia('(hover: hover)').matches && original?.closest('.catalog-cover-item')?.matches(':hover'));
  if (lit) coverItemOf(copy, hoveredDeckId)?.classList.add('is-transition-hover');
  return copy;
}

function coverItemOf(copy: HTMLElement, deckId: string) {
  return coverOf(copy, deckId)?.closest<HTMLElement>('.catalog-cover-item');
}

function scrollportOf(section: HTMLElement) {
  return section.closest<HTMLElement>('.workspace-main');
}

function scrollBy(scrollport: HTMLElement, delta: number) {
  if (Math.abs(delta) >= 1) scrollport.scrollTo({ top: scrollport.scrollTop + delta, behavior: 'instant' });
}

// 2026-11-10: both directions move a frozen page outside layout. Scaling the live gallery changes its scrollable
// overflow; its scrollbar and scroll anchoring must not move the landing point during the animation.
function stage(scrollport: HTMLElement, ghost: HTMLElement, page: DOMRect) {
  const port = scrollport.getBoundingClientRect();
  const layer = document.createElement('div');
  layer.className = 'deck-transition-layer';
  layer.setAttribute('aria-hidden', 'true');
  Object.assign(layer.style, { left: port.left + 'px', top: port.top + 'px', width: scrollport.clientWidth + 'px', height: port.height + 'px' });
  Object.assign(ghost.style, { left: page.left - port.left + 'px', top: page.top - port.top + 'px', width: page.width + 'px' });
  layer.append(ghost);
  scrollport.append(layer);
  return layer;
}

function arrive(section: HTMLElement, snapshot: Snapshot, ready: () => void) {
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
  // 2026-11-10: the shelf button is 120px, but its clipped face is 225px. Landing at the button's top leaves 105px
  // of the departing cover on the Journey toolbar. Match the full face instead.
  const to = (target.querySelector<HTMLElement>('.catalog-deck-cover') ?? target).getBoundingClientRect();
  const dx = snapshot.from.left - to.left;
  const dy = snapshot.from.top - to.top;
  // 2026-11-10: the 165px shelf face is 9/8 of the 146.67px gallery box, and both are one drawing in --u, so the
  // frozen row grows around the opened box's corner and lands on the face line for line. Measured gaps scale with it.
  const scale = sizeRatio(to, snapshot.from);
  if (!ghost || (Math.abs(dx) < 1 && Math.abs(dy) < 1 && scale === 1)) { ghost?.remove(); return null; }

  const shelfInset = Math.max(0, rail.getBoundingClientRect().top - port.top);
  // 2026-11-09: an opaque, inert stage prevents even a single frame with the gallery and the open workbench interleaved.
  Object.assign(ghost.style, { transformOrigin: `${snapshot.from.left - snapshot.page.left}px ${snapshot.from.top - snapshot.page.top}px`, clipPath: `inset(0 0 ${Math.max(0, snapshot.page.bottom - snapshot.from.bottom)}px 0)` });
  const layer = stage(scrollport, ghost, snapshot.page);

  const duration = travelDuration(dy);
  const tokens = motionTokens(section);
  const timing: KeyframeAnimationOptions = { duration, easing: tokens.easing };
  const wasInert = section.inert;
  section.inert = true;
  const motions = [
    ghost.animate([{ transform: 'none' }, { transform: `translate(${-dx}px, ${-dy}px) scale(${scale})` }], { ...timing, fill: 'forwards' }),
    // 2026-11-10: the home's top padding belongs to its snapshot too. Cutting the stage at the shelf immediately
    // exposed the new padding before travel; move the viewport cut with the row instead of switching it in one frame.
    layer.animate([{ clipPath: 'inset(0)' }, { clipPath: `inset(${shelfInset}px 0 0)` }], { ...timing, fill: 'forwards' }),
  ];
  const reveals: Animation[] = [];
  for (const part of section.children) {
    if (part !== rail) reveals.push(part.animate([{ opacity: 0 }, { opacity: 1 }], { duration: tokens.feedback, delay: duration, easing: tokens.easing, fill: 'backwards' }));
  }
  for (const tile of ghost.querySelectorAll<HTMLElement>('.catalog-add-deck, .catalog-cover-settings, .catalog-space-heading')) motions.push(tile.animate([{ opacity: 1 }, { opacity: 0 }], { duration: tokens.feedback, easing: tokens.easing, fill: 'forwards' }));
  // 2026-11-10: the opened cover stays filled with its color all the way to the shelf, where the current deck is filled too;
  // its hover chrome (the settings button) leaves on the next frame.
  coverItemOf(ghost, snapshot.deckId)?.classList.add('is-transition-open');
  requestAnimationFrame(() => { coverItemOf(ghost, snapshot.deckId)?.classList.remove('is-transition-hover'); });
  // 2026-11-10: this is already a snapshot of painted content, not a mounting overlay. Pausing it for preparation
  // holds the departing page after navigation has committed and separates the travel from the live-page reveal.

  let stageCleared = false;
  let finished = false;
  const clearStage = (restoreFocus = false) => {
    if (stageCleared) return;
    stageCleared = true;
    layer.remove();
    section.inert = wasInert;
    if (restoreFocus) ready();
  };
  const finish = () => {
    if (finished) return;
    finished = true;
    for (const motion of [...motions, ...reveals]) motion.cancel();
    clearStage();
  };
  motions[0].finished.then(() => clearStage(true), () => clearStage());
  Promise.all([...motions, ...reveals].map(motion => motion.finished)).then(finish, finish);
  return finish;
}

function comeBack(section: HTMLElement, snapshot: Snapshot, ready: () => void) {
  const scrollport = scrollportOf(section);
  const target = coverOf(section, snapshot.deckId);
  if (!scrollport || !target) return null;
  const port = scrollport.getBoundingClientRect();
  // 2026-11-10: restore the scroll owner before measuring or painting the returning page, not after its first frame.
  if (snapshot.galleryScrollTop !== null) scrollport.scrollTo({ top: snapshot.galleryScrollTop, behavior: 'instant' });
  // The row returns where the shelf was; a row outside the view is brought in first, 5 px under the edge.
  const landing = target.getBoundingClientRect();
  if (snapshot.galleryScrollTop === null && (landing.top < port.top || landing.bottom > port.bottom)) scrollBy(scrollport, landing.top - port.top - 5);
  // 2026-11-11: initial pulse data can change the landing point; keep navigation immediate instead of freezing its loader.
  if (reducedMotion() || section.querySelector('.project-pulse-loading')) return null;
  const to = target.getBoundingClientRect();
  const dx = snapshot.from.left - to.left;
  const dy = snapshot.from.top - to.top;
  // 2026-11-10: the row shrinks from its 165px shelf face back to the gallery box, around the returning box's corner.
  const scale = sizeRatio(snapshot.from, to);
  const tokens = motionTokens(section);
  const page = section.getBoundingClientRect();
  const ghost = freeze(section, snapshot.deckId);
  ghost.classList.add('is-transition-returning');
  const layer = stage(scrollport, ghost, page);
  const wasInert = section.inert;
  const visibility = section.style.visibility;
  section.inert = true;
  section.style.visibility = 'hidden';
  const motions: Animation[] = [];
  if (Math.abs(dx) >= 1 || Math.abs(dy) >= 1 || scale !== 1) {
    const timing: KeyframeAnimationOptions = { duration: travelDuration(dy), easing: tokens.easing };
    const origin = { x: to.left - page.left, y: to.top - page.top };
    const transformOrigin = `${origin.x}px ${origin.y}px`;
    // 2026-11-10: the fixed stage can also match X without enlarging the scroll area; ignoring it snapped the row sideways.
    motions.push(ghost.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${scale})`, transformOrigin }, { transform: 'none', transformOrigin }], { ...timing, fill: 'both' }));
    // 2026-11-10: clip in viewport coordinates, outside the scaling page. Returning all the way to the scrollport
    // restores the home's padding before handoff; a cut left at the shelf made its top strip appear in one frame.
    if (snapshot.shelfTop !== null) {
      const shelfInset = Math.max(0, snapshot.shelfTop - port.top);
      motions.push(layer.animate([{ clipPath: `inset(${shelfInset}px 0 0)` }, { clipPath: 'inset(0)' }], { ...timing, fill: 'both' }));
    }
  }
  for (const tile of ghost.querySelectorAll<HTMLElement>('.catalog-add-deck')) motions.push(tile.animate([{ opacity: 0 }, { opacity: 1 }], { duration: tokens.feedback, easing: tokens.easing }));
  let finished = false;
  const finish = (restoreFocus = false) => {
    if (finished) return;
    finished = true;
    for (const motion of motions) motion.cancel();
    layer.remove();
    section.inert = wasInert;
    section.style.visibility = visibility;
    if (restoreFocus) ready();
  };
  void Promise.all(motions.map(motion => motion.finished)).then(() => finish(true), () => finish());
  return () => finish();
}
