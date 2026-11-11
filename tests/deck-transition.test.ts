import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openHeadlessBrowser, type HeadlessPage } from '../tools/layout-capture.ts';
import { requireBrowser } from './browser-environment.ts';
import { browserFixtureUrl } from './browser-fixture.ts';
import { waitForLayout } from './browser-layout.ts';

const browserPath = requireBrowser();

interface Frame {
  time: number;
  x: number;
  y: number;
  width: number;
  titleY: number | null;
  scroll: number;
  stage: boolean;
  paused: boolean;
  overflow: boolean;
  progress: number | null;
  parts: Record<string, { x: number; y: number }>;
  chrome: Record<string, number>;
  open: boolean;
  topCut: number | null;
}

describe.skipIf(!browserPath)('deck transition continuity (browser)', () => {
  let page: HeadlessPage;
  beforeAll(async () => { page = await openHeadlessBrowser({ width: 1280, height: 800, scale: 1 }); });
  afterAll(async () => { await page?.close(); });

  async function load(deck?: string, pulseTest = false) {
    const url = new URL(browserFixtureUrl('deck-transition'));
    url.search = new URLSearchParams({ view: 'deck', catalogSource: 'sandbox', ...(deck ? { deck } : {}), ...(pulseTest ? { pulseTest: '1' } : {}) }).toString();
    await page.send('Page.navigate', { url: url.href });
    await page.evaluate(`new Promise((resolve, reject) => {
      const deadline = performance.now() + 10000;
      function check() {
        if (document.querySelector('[data-deck-cover]')) return resolve(true);
        if (performance.now() > deadline) return reject(new Error('Deck did not load'));
        requestAnimationFrame(check);
      }
      check();
    })`);
    await waitForLayout(page.evaluate, '.deck-view');
  }

  async function transition(direction: 'open' | 'close', deck: string, action: 'click' | 'Enter' | 'Escape' | 'back' | 'forward' = 'click'): Promise<Frame[]> {
    await page.callFunction(`(direction, deck) => { window.deckTransitionFrames = new Promise((resolve, reject) => {
      const frames = [];
      const start = performance.now();
      let stable = 0;
      function sample() {
        const ghost = document.querySelector('.deck-transition-ghost');
        const scope = ghost || document.querySelector('.deck-view');
        const cover = scope.querySelector('[data-deck-cover="' + deck + '"]');
        const face = cover.closest('.catalog-cover-item') || cover.querySelector('.catalog-deck-cover') || cover;
        const rect = face.getBoundingClientRect();
        const title = scope.querySelector('.deck-gallery-header h1');
        const travel = ghost?.getAnimations().find(a => a.effect.getKeyframes().some(key => key.transform));
        const parts = {};
        for (const selector of ['.deck-gallery-header h1', '.deck-gallery-header button', '.deck-gallery-header input',
          '.deck-gallery-header select', '.catalog-source', '.catalog-source-part']) {
          scope.querySelectorAll(selector).forEach((el, index) => {
            const r = el.getBoundingClientRect(); parts[selector + index] = { x:r.x, y:r.y };
          });
        }
        scope.querySelectorAll('[data-deck-cover]').forEach(button => {
          const face = button.closest('.catalog-cover-item') || button.querySelector('.catalog-deck-cover') || button;
          const r = face.getBoundingClientRect();
          parts['cover:' + button.dataset.deckCover] = { x:r.x, y:r.y };
        });
        const chrome = {};
        for (const selector of ['.deck-neighbor-rail', '.deck-open-toolbar', '.catalog-workbench', '.deck-action-rail']) {
          const el = document.querySelector('.workspace-main > .deck-view')?.querySelector(selector);
          if (el) chrome[selector] = el.getBoundingClientRect().y;
        }
        const scrollport = document.querySelector('.workspace-main');
        const layer = document.querySelector('.deck-transition-layer');
        let topCut = null;
        if (layer) {
          const clip = getComputedStyle(layer).clipPath;
          const inset = clip.startsWith('inset(') ? parseFloat(clip.slice(6)) : 0;
          const ghostStyle = getComputedStyle(ghost);
          const ghostInset = ghostStyle.clipPath.startsWith('inset(') ? parseFloat(ghostStyle.clipPath.slice(6)) : 0;
          const scale = new DOMMatrixReadOnly(ghostStyle.transform).a;
          const portTop = scrollport.getBoundingClientRect().top;
          topCut = Math.max(portTop, layer.getBoundingClientRect().top + inset, ghost.getBoundingClientRect().top + ghostInset * scale) - portTop;
        }
        frames.push({ time: performance.now() - start, x: rect.x, y: rect.y, width: rect.width,
          titleY: title?.getBoundingClientRect().y ?? null, scroll: scrollport.scrollTop, stage: !!ghost,
          paused: scope.getAnimations({subtree:true}).some(a => a.playState === 'paused'),
          overflow: scrollport.scrollWidth > scrollport.clientWidth,
          progress: travel?.effect.getComputedTiming().progress ?? null, parts, chrome,
          open: !!document.querySelector('.workspace-main > .is-deck-open'), topCut });
      }
      sample();
      function tick() {
        sample();
        const navigating = document.getAnimations().some(a => a.playState === 'running' && a.effect.getComputedTiming().iterations !== Infinity);
        const arrived = !!document.querySelector('.workspace-main > .is-deck-open') === (direction === 'open');
        stable = arrived && !document.querySelector('.deck-transition-layer') && !navigating ? stable + 1 : 0;
        if (stable >= 3) return resolve(frames);
        if (performance.now() - start > 5000) return reject(new Error('Transition did not finish'));
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    }); }`, direction, deck);
    if (action === 'click') {
      await page.callFunction(`(direction, deck) => {
        const selector = direction === 'open' ? '.catalog-cover-item [data-deck-cover="' + deck + '"]' : '.deck-open-toolbar button';
        document.querySelector(selector).click();
      }`, direction, deck);
    } else if (action === 'back' || action === 'forward') {
      await page.callFunction(`action => history[action]()`, action);
    } else {
      for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key: action, code: action,
        windowsVirtualKeyCode: action === 'Enter' ? 13 : 27, text: type === 'keyDown' && action === 'Enter' ? '\r' : undefined });
    }
    return page.evaluate('window.deckTransitionFrames');
  }

  function expectContinuous(frames: Frame[], direction: 'open' | 'close') {
    const positions = new Set(frames.map(frame => `${frame.x.toFixed(1)},${frame.y.toFixed(1)},${frame.width.toFixed(1)}`));
    expect(positions.size).toBeGreaterThanOrEqual(4);
    expect(frames.some(frame => frame.overflow)).toBe(false);
    const first = frames[0];
    const last = frames.at(-1)!;
    const titles = frames.filter(frame => frame.titleY !== null);
    const titleSign = Math.sign((titles.at(-1)?.titleY ?? 0) - (titles[0]?.titleY ?? 0));
    expect(Math.abs(last.y - first.y)).toBeGreaterThan(30);
    expect(Math.abs(frames[1].x - first.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(frames[1].y - first.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(frames[1].width - first.width)).toBeLessThanOrEqual(1);
    expect(frames.some(frame => frame.paused)).toBe(false);
    const home = direction === 'open' ? first : last;
    const shelf = direction === 'open' ? last : first;
    const shelfScale = shelf.width / home.width;
    // 2026-11-10: the larger shelf reverses the old shrink: opening grows the row by 9/8, closing shrinks it back.
    expect(shelfScale).toBeCloseTo(9 / 8, 3);
    const stages = frames.filter(frame => frame.stage);
    const homeHandoff = direction === 'open' ? stages[0] : stages.at(-1)!;
    expect(homeHandoff.topCut, 'the stage must include the home padding at handoff').not.toBeNull();
    expect(homeHandoff.topCut!).toBeLessThanOrEqual(1);
    // 2026-11-10: subtract only the intended shared travel/scale. A padding or header reflow can be monotonic too,
    // so direction checks alone miss it; every header part and cover in the moving row must stay within one pixel.
    const previousErrors = new Map<string, { x: number; y: number }>();
    for (const frame of frames) {
      if (frame.progress === null) continue;
      const progress = direction === 'open' ? frame.progress : 1 - frame.progress;
      const scale = 1 + (shelfScale - 1) * progress;
      const x = home.x + (shelf.x - home.x) * progress;
      const y = home.y + (shelf.y - home.y) * progress;
      for (const [name, part] of Object.entries(home.parts)) {
        const actual = frame.parts[name];
        expect(actual, name).toBeDefined();
        const error = { x: actual.x - (x + (part.x - home.x) * scale), y: actual.y - (y + (part.y - home.y) * scale) };
        const previous = previousErrors.get(name) ?? { x: 0, y: 0 };
        for (const axis of ['x', 'y'] as const) {
          expect(Math.abs(error[axis]), `${name} ${axis} at ${frame.time} ms`).toBeLessThanOrEqual(1);
          expect(Math.abs(error[axis] - previous[axis]), `${name} ${axis} step at ${frame.time} ms`).toBeLessThanOrEqual(1);
        }
        previousErrors.set(name, error);
      }
    }
    // 2026-11-10: sample the snapshot/live handoffs too, not just the middle of the WAAPI animation.
    // Normal fast ease-out travel may be large; a reversal or a sideways first-frame snap may not.
    for (let index = 1; index < frames.length; index++) {
      const previous = frames[index - 1];
      const frame = frames[index];
      const sign = direction === 'open' ? -1 : 1;
      expect((frame.y - previous.y) * sign, `vertical reversal at ${frame.time} ms`).toBeGreaterThanOrEqual(-1);
      if (frame.topCut !== null && previous.topCut !== null) {
        expect((frame.topCut - previous.topCut) * -sign, `clipping reversal at ${frame.time} ms`).toBeGreaterThanOrEqual(-1);
      }
      if (frame.titleY !== null && previous.titleY !== null) {
        expect((frame.titleY - previous.titleY) * titleSign, `title reversal at ${frame.time} ms`).toBeGreaterThanOrEqual(-1);
      }
      if (!frame.stage && !previous.stage && frame.open === previous.open) {
        for (const [name, part] of Object.entries(frame.parts)) {
          if (previous.parts[name]) expect(Math.abs(part.y - previous.parts[name].y), `${name} settled step`).toBeLessThanOrEqual(1);
        }
      }
      for (const [name, y] of Object.entries(frame.chrome)) {
        if (name in previous.chrome) expect(Math.abs(y - previous.chrome[name]), `${name} drift at ${frame.time} ms`).toBeLessThanOrEqual(1);
      }
    }
  }

  it.each([1440, 375])('prepares a delayed nonzero pulse before the first return from a direct deck link at %s px', async width => {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await load('top', true);
    expect(await page.evaluate('window.pulseRequests.count')).toBe(1);
    expect(await page.evaluate(`document.querySelector('.project-pulse').getBoundingClientRect().height`)).toBe(0);
    await page.evaluate(`window.pulseRequests.release(); new Promise(resolve => { function check() { if (document.querySelector('.project-pulse-grid')) resolve(true); else requestAnimationFrame(check); } check(); })`);
    expectContinuous(await transition('close', 'top'), 'close');
    expect(await page.evaluate(`document.querySelector('[data-pulse=started] .project-pulse-value').textContent`)).toContain('3');
    expect(await page.evaluate('window.pulseRequests.count')).toBe(1);
  });

  it('returns immediately while the initial pulse is pending without freezing an obsolete loading layout', async () => {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await load('top', true);
    const frames = await transition('close', 'top');
    expect(frames.some(frame => frame.stage)).toBe(false);
    expect(await page.evaluate(`!document.querySelector('.deck-view').inert && document.activeElement.matches('[data-deck-cover="top"]')`)).toBe(true);
    await page.evaluate('window.pulseRequests.release()');
    await waitForLayout(page.evaluate, '.project-pulse');
  });

  it.each([{ width: 1700, height: 1000, rate: 1 }, { width: 1700, height: 1000, rate: 4 },
    { width: 760, height: 1000, rate: 1 }, { width: 760, height: 1000, rate: 4 },
    { width: 375, height: 812, rate: 1 }, { width: 375, height: 812, rate: 4 }])(
    'animates first close and restores top/lower gallery at $width px, CPU ×$rate', async ({ width, height, rate }) => {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      await page.send('Emulation.setCPUThrottlingRate', { rate });
      await load('top');
      expectContinuous(await transition('close', 'top'), 'close');
      await load();
      for (const deck of ['top', 'lower']) {
        if (deck === 'lower') await page.evaluate(`document.querySelector('.catalog-cover-item [data-deck-cover="lower"]').scrollIntoView({block:'center',behavior:'instant'})`);
        await waitForLayout(page.evaluate, '.deck-view');
        const before = await page.evaluate(`document.querySelector('.workspace-main').scrollTop`);
        if (deck === 'lower') expect(before).toBeGreaterThan(100);
        expectContinuous(await transition('open', deck), 'open');
        expectContinuous(await transition('close', deck), 'close');
        expect(await page.evaluate(`document.querySelector('.workspace-main').scrollTop`)).toBeCloseTo(before, 0);
        expect(await page.evaluate(`document.querySelector('.deck-view').inert`)).toBe(false);
      }
      expect(page.consoleErrors).toEqual([]);
    }, 30000);

  it.each([1700, 760, 375])('keeps keyboard focus and animates Escape, Close and browser Back/Forward at %s px', async width => {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1.5, mobile: false });
    await page.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await load();
    for (const action of ['Escape', 'click', 'back'] as const) {
      await page.evaluate(`document.querySelector('.catalog-cover-item [data-deck-cover="top"]').focus({preventScroll:true})`);
      expectContinuous(await transition('open', 'top', 'Enter'), 'open');
      // 2026-11-10: opening focuses the deck title quietly, so no tooltip pops up on Close.
      expect(await page.evaluate(`document.activeElement === document.querySelector('.deck-open-toolbar .page-title') && !document.activeElement.matches(':focus-visible') && !document.querySelector('.deck-header-hint')`)).toBe(true);
      expectContinuous(await transition('close', 'top', action), 'close');
      // 2026-11-10: focus returns to the cover, quietly — no ring on the deck the person just left, even after Escape.
      expect(await page.evaluate(`document.activeElement === document.querySelector('.catalog-cover-item [data-deck-cover="top"]') && !document.activeElement.matches(':focus-visible')`)).toBe(true);
    }
    expectContinuous(await transition('open', 'top', 'forward'), 'open');
    expect(await page.evaluate(`document.activeElement === document.querySelector('.deck-open-toolbar .page-title')`)).toBe(true);
    expectContinuous(await transition('close', 'top'), 'close');
  }, 30000);

  it.each([1700, 760, 375])('restores a lower gallery instantly without layout settling with reduced motion at %s px', async width => {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1.5, mobile: false });
    await page.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    try {
      await load();
      await page.evaluate(`document.querySelector('.catalog-cover-item [data-deck-cover="lower"]').scrollIntoView({block:'center',behavior:'instant'})`);
      const scroll = await page.evaluate(`document.querySelector('.workspace-main').scrollTop`);
      expect(scroll).toBeGreaterThan(100);
      const opening = await transition('open', 'lower');
      const closing = await transition('close', 'lower');
      expect([...opening, ...closing].some(frame => frame.stage)).toBe(false);
      for (const frames of [opening, closing]) {
        const last = frames.at(-1)!;
        for (const frame of frames.filter(frame => frame.open === last.open)) {
          expect(Math.abs(frame.y - last.y)).toBeLessThanOrEqual(1);
          for (const [name, part] of Object.entries(frame.parts)) expect(Math.abs(part.y - last.parts[name].y), name).toBeLessThanOrEqual(1);
          expect(frame.chrome).toEqual(last.chrome);
        }
      }
      expect(closing.at(-1)!.scroll).toBeCloseTo(scroll, 0);
      expect(await page.evaluate(`!document.querySelector('.deck-view').inert && getComputedStyle(document.querySelector('.deck-view')).visibility === 'visible'`)).toBe(true);
      expect(await page.evaluate(`document.activeElement === document.querySelector('.catalog-cover-item [data-deck-cover="lower"]')`)).toBe(true);
    } finally { await page.send('Emulation.setEmulatedMedia', { features: [] }); }
  });
});
