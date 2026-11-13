import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CatalogCard } from '../src/catalog-contracts.ts';
import { buildCatalogLookups } from '../client/catalog-lookups.ts';
import { CatalogCardTile } from '../client/components/CatalogCardTile.tsx';
import { setLang } from '../client/i18n.ts';
import { requireBrowser } from './browser-environment.ts';
import { openHeadlessBrowser, type HeadlessPage } from '../tools/layout-capture.ts';

vi.hoisted(() => { vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' }); });

// The rendered markup and actual styles need no fixture server, but still require a browser in CI.
const browserPath = requireBrowser();
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function localPoint(quad: number[], x: number, y: number) {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = quad;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  const denominator = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / denominator;
  const h = (dx1 * dy3 - dx3 * dy1) / denominator;
  const a = x1 - x0 + g * x1 - x * g, b = x3 - x0 + h * x3 - x * h;
  const d = y1 - y0 + g * y1 - y * g, e = y3 - y0 + h * y3 - y * h;
  const determinant = a * e - b * d;
  return [((x - x0) * e - b * (y - y0)) / determinant * 115,
    (a * (y - y0) - (x - x0) * d) / determinant * 147];
}

describe.skipIf(!browserPath)('tile selection corner (browser)', () => {
  let page: HeadlessPage;
  let cardNode: number;
  let checkboxNode: number;
  const move = (x: number, y: number) => page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0, pointerType: 'mouse' });
  const styles = () => page.evaluate(`(() => {
    const box = document.querySelector('.catalog-card-checkbox'), style = getComputedStyle(box);
    return { opacity: Number(style.opacity), transform: style.transform, outline: style.outlineStyle,
      checkWidth: getComputedStyle(box, '::before').width, checked: box.checked };
  })()`);

  beforeAll(async () => {
    vi.stubGlobal('window', Object.assign(new EventTarget(), { matchMedia: () => ({ matches: false }) }));
    vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
    const hero: CatalogCard = { id: 'hero', kind: 'hero', title: 'Parent Hero', path: 'hero.md', version: null,
      state: null, owner: null, markdown: '', sourceHash: 'hero', range: null, deckId: 'deck', trackIds: [], parentId: null };
    const card: CatalogCard = { ...hero, id: 'child', kind: 'task', title: 'Child title', parentId: hero.id };
    const noop = () => {};
    const markup = renderToStaticMarkup(<CatalogCardTile card={card} lookups={buildCatalogLookups([hero, card])} members={[]}
      selected={false} checked={false} selectionActive={false} disabled={false} onOpen={noop} onToggle={noop} onFamilyOpen={noop} />);
    const renderExtra = (value: CatalogCard, checked = false) => renderToStaticMarkup(<CatalogCardTile card={value}
      lookups={buildCatalogLookups([value])} members={[]} selected={false} checked={checked} selectionActive={checked}
      disabled={false} onOpen={noop} onToggle={noop} onFamilyOpen={noop} />);
    const decimal = { ...card, id: 'decimal-en', parentId: null, owner: 'Alex', effort: 123.45, priority: 'high' as const };
    setLang('en');
    const english = renderExtra(decimal);
    setLang('ru');
    const russian = renderExtra({ ...decimal, id: 'decimal-ru' });
    const completed = renderExtra({ ...hero, id: 'completed', state: 'done' }, true);
    setLang('en');
    vi.unstubAllGlobals();
    const css = (await Promise.all(['client/tokens.css', 'client/styles.css', 'client/card-material.css', 'client/card-family.css', 'client/card-indicators.css', 'client/card-transfer.css', 'client/focus.css'].map(path => readFile(path, 'utf8')))).join('\n');
    page = await openHeadlessBrowser({ width: 800, height: 600, scale: 1 }, undefined, { browserPath: browserPath! });
    await page.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    const frame = (await page.send('Page.getFrameTree')).result.frameTree.frame.id;
    await page.send('Page.setDocumentContent', { frameId: frame, html: `<html class="dark"><head><style>${css}</style><style>body { padding: 100px; } .deck-card-space { width: 115px; }</style></head><body>${markup}<div class="catalog-card-grid">${english}${russian}${completed}</div></body></html>` });
    await page.evaluate(await readFile('client/focus.js', 'utf8'));
    await page.send('Page.bringToFront');
    const root = (await page.send('DOM.getDocument')).result.root.nodeId;
    cardNode = (await page.send('DOM.querySelector', { nodeId: root, selector: '.deck-card' })).result.nodeId;
    checkboxNode = (await page.send('DOM.querySelector', { nodeId: root, selector: '.catalog-card-checkbox' })).result.nodeId;
  }, 30000);

  afterAll(async () => { vi.unstubAllGlobals(); await page?.close(); }, 20000);

  it('reveals over the whole tile, keeps both titles clickable and fades without a focus ring once the pointer leaves', async () => {
    expect(await page.evaluate(`matchMedia('(hover: hover) and (prefers-reduced-motion: no-preference)').matches`)).toBe(true);
    const points = await page.evaluate(`(() => {
      const card = document.querySelector('.deck-card').getBoundingClientRect();
      const parent = document.querySelector('.card-family-trigger > span:last-child').getBoundingClientRect();
      const title = document.querySelector('.deck-card-title').getBoundingClientRect();
      return { card: { x: card.x, y: card.y }, parent: { x: parent.x + .5, y: parent.y + 3 }, title: { x: title.x + .5, y: title.y + 3 } };
    })()`);
    await move(points.card.x + 60, points.card.y + 70);
    await delay(450);
    expect((await styles()).opacity).toBe(1);
    for (const [name, point] of [['parent', points.parent], ['title', points.title]] as const) {
      expect(await page.callFunction(`function(x, y) { return document.elementFromPoint(x, y).closest('button')?.className; }`, point.x, point.y), name)
        .toContain(name === 'parent' ? 'card-family-trigger' : 'deck-card-open');
    }
    await move(points.card.x - 5, points.card.y - 5);
    await delay(200);
    expect(await styles()).toMatchObject({ opacity: 1, outline: 'none', checkWidth: '10px' });
    await move(5, 5);
    await delay(300);
    expect((await styles()).opacity).toBe(0);
  });

  it('keeps the checkbox on the same projected sheet while tilt and opacity animate', async () => {
    const origin = await page.evaluate(`(() => { const r = document.querySelector('.deck-card').getBoundingClientRect(); return { x: r.x, y: r.y }; })()`);
    await move(origin.x - 5, origin.y - 5);
    await page.evaluate(`document.querySelector('.deck-card').style.setProperty('--tilt-x', '8deg'); document.querySelector('.deck-card').style.setProperty('--tilt-y', '-8deg')`);
    try {
      const frames: { x: number; y: number; opacity: number; transform: string }[] = [];
      // 2026-11-11: seek through the reveal so CDP round-trip timing cannot skip the entire fade under load.
      await page.evaluate(`(() => {
        const box = document.querySelector('.catalog-card-checkbox');
        getComputedStyle(box).opacity;
        const reveal = box.getAnimations().find(animation => animation.transitionProperty === 'opacity');
        if (!reveal) throw new Error('Checkbox opacity transition did not start');
        reveal.pause();
      })()`);
      for (let i = 0; i < 28; i++) {
        // The two CDP quad requests must see the same frame, even if the compositor advances between replies.
        await page.callFunction(`async progress => {
          const box = document.querySelector('.catalog-card-checkbox');
          const animations = document.getAnimations();
          await Promise.all(animations.map(async animation => { animation.pause(); await animation.ready; }));
          const reveal = box.getAnimations().find(animation => animation.transitionProperty === 'opacity');
          if (!reveal) throw new Error('Checkbox opacity transition disappeared');
          const timing = reveal.effect.getTiming();
          reveal.currentTime = Number(timing.delay) + Number(timing.duration) * progress;
        }`, (i + 1) / 29);
        const card = (await page.send('DOM.getContentQuads', { nodeId: cardNode })).result.quads[0] as number[];
        const check = (await page.send('DOM.getContentQuads', { nodeId: checkboxNode })).result.quads[0] as number[];
        const [x, y] = localPoint(card, check[0], check[1]);
        frames.push({ x, y, ...await styles() });
        await page.evaluate(`document.getAnimations().forEach(animation => { if (animation.transitionProperty !== 'opacity' || animation.effect.target !== document.querySelector('.catalog-card-checkbox')) animation.play(); })`);
        await delay(30);
      }
      expect(frames.some(frame => frame.opacity > 0 && frame.opacity < 1)).toBe(true);
      for (const frame of frames) {
        expect(frame.transform).toBe('none');
        expect(frame.x).toBeCloseTo(frames[0].x, 1);
        expect(frame.y).toBeCloseTo(frames[0].y, 1);
      }
    } finally {
      await page.evaluate(`document.getAnimations().forEach(animation => animation.play())`);
      await move(5, 5);
      await page.evaluate(`document.querySelector('.deck-card').style.setProperty('--tilt-x', '0deg'); document.querySelector('.deck-card').style.setProperty('--tilt-y', '0deg')`);
      await delay(300);
    }
  });

  it('shows checked, keyboard-focused, selection-mode and touch controls in both themes', async () => {
    for (const dark of [true, false]) {
      await page.callFunction('function(dark) { document.documentElement.classList.toggle("dark", dark); }', dark);
      await page.evaluate(`document.querySelector('.catalog-card-checkbox').setAttribute('data-selection-active', 'true')`);
      await delay(200);
      expect((await styles()).opacity).toBeCloseTo(.55, 2);
      await page.evaluate(`document.querySelector('.catalog-card-checkbox').checked = true`);
      await delay(200);
      expect(await styles()).toMatchObject({ opacity: 1, checked: true });
      await page.evaluate(`document.querySelector('.catalog-card-checkbox').checked = false; document.querySelector('.catalog-card-checkbox').removeAttribute('data-selection-active'); document.body.tabIndex = -1; document.body.focus()`);
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      await delay(200);
      expect(await page.evaluate(`document.activeElement.outerHTML`)).toMatch(/class="catalog-card-checkbox"/);
      expect(await page.evaluate(`document.activeElement.matches(':focus-visible')`)).toBe(true);
      expect(await styles()).toMatchObject({ opacity: 1, outline: 'solid' });
      await page.evaluate('document.activeElement.blur()');
    }
    await page.evaluate(`document.querySelector('.catalog-card-checkbox').setAttribute('data-selection-active', 'true')`);
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    await delay(200);
    expect(await page.evaluate(`matchMedia('(hover: none)').matches`)).toBe(true);
    expect((await styles()).opacity).toBe(1);
    expect(page.consoleErrors).toEqual([]);
  });

  it('keeps selection feedback without tilt or transitions under reduced motion', async () => {
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await page.evaluate(`document.querySelector('.catalog-card-checkbox').removeAttribute('data-selection-active');
      document.querySelector('.deck-card').style.setProperty('--tilt-x', '8deg')`);
    const point = await page.evaluate(`(() => { const r = document.querySelector('.deck-card').getBoundingClientRect(); return { x: r.x - 5, y: r.y - 5 }; })()`);
    await move(point.x, point.y);
    expect(await page.evaluate(`matchMedia('(prefers-reduced-motion: reduce)').matches`)).toBe(true);
    expect(await page.evaluate(`getComputedStyle(document.querySelector('.deck-card')).transform`)).toBe('none');
    expect(await page.evaluate(`getComputedStyle(document.querySelector('.catalog-card-checkbox')).transitionDuration`)).toBe('0s');
    expect((await styles()).opacity).toBe(1);
  });

  it('shows decimal effort in both locales without clipping its digits', async () => {
    for (const id of ['decimal-en', 'decimal-ru']) {
      const result = await page.callFunction(`id => {
        const card = document.querySelector('[data-deck-card="' + id + '"]');
        const number = card.querySelector('.deck-card-metric strong');
        const metric = number.parentElement.getBoundingClientRect();
        const owner = card.querySelector('.deck-card-owner-medallion').getBoundingClientRect();
        return { text: number.textContent, fits: number.scrollWidth <= number.clientWidth, font: parseFloat(getComputedStyle(number).fontSize),
          clear: metric.right <= owner.left, band: card.querySelector('.deck-card-band').getBoundingClientRect().height };
      }`, id);
      expect(result.text).toBe(id === 'decimal-en' ? '123.45' : '123,45');
      expect(result.fits).toBe(true);
      expect(result.clear).toBe(true);
      expect(result.font).toBeGreaterThanOrEqual(9);
      expect(result.band).toBe(24);
    }
  });

  it('keeps the selection frame and tint above the completed Hero film in both themes', async () => {
    for (const dark of [true, false]) {
      await page.callFunction('dark => document.documentElement.classList.toggle("dark", dark)', dark);
      const result = await page.evaluate(`(() => {
        const card = document.querySelector('[data-deck-card="completed"]');
        const frame = getComputedStyle(card, '::after'), film = getComputedStyle(card, '::before');
        return { border: frame.borderTopWidth, opacity: frame.opacity, mask: frame.maskImage, blend: frame.mixBlendMode,
          layer: frame.zIndex, inset: frame.top, tint: getComputedStyle(card).getPropertyValue('--hero-family-face').trim(), film: film.backgroundImage };
      })()`);
      expect(result).toMatchObject({ border: '2px', opacity: '1', mask: 'none', blend: 'normal', layer: '5', inset: '-2px' });
      expect(result.tint).toContain('color-mix');
      expect(result.film).not.toBe('none');
    }
  });
});
