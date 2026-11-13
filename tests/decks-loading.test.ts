import { afterEach, describe, expect, it } from 'vitest';
import { openHeadlessBrowser, type HeadlessPage } from '../tools/headless-browser.ts';
import { browserFixtureUrl } from './browser-fixture.ts';
import { requireBrowser } from './browser-environment.ts';
import { waitForLayout } from './browser-layout.ts';

const browserPath = requireBrowser();
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// 2026-11-13: all four catalog resolutions share the real shell and the same measured cover grid.
describe.skipIf(!browserPath)('decks loading, ready, empty and error surfaces (browser)', () => {
  let page: HeadlessPage | undefined;
  const evaluate = (expression: string) => page!.evaluate(expression);
  async function until(expression: string) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return;
      await delay(25);
    }
    throw new Error(expression + '\n' + page!.consoleErrors.join('\n') + '\n' + await evaluate(`document.body.innerText + ' STATE:' + document.querySelector('.first-screen')?.dataset.state`));
  }
  async function open(options: { width?: number; theme?: string; state?: string; lang?: string; long?: boolean; coarse?: boolean; reduced?: boolean; readonly?: boolean } = {}) {
    const { width = 1920, theme = 'light', state = 'ready', lang = 'en', long = false, coarse = false, reduced = false, readonly = false } = options;
    page = await openHeadlessBrowser({ width, height: width === 375 ? 812 : 1080, scale: 1 });
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `
      localStorage.setItem('deckmate-theme', ${JSON.stringify(theme)});
      localStorage.setItem('deckmate-language', ${JSON.stringify(lang)});
    ` });
    await page.send('Emulation.setEmulatedMedia', { features: [
      { name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' },
      ...(coarse ? [{ name: 'pointer', value: 'coarse' }] : []),
    ] });
    if (coarse) await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    const query = new URLSearchParams({ scenario: state, ...(long ? { long: '1' } : {}), ...(readonly ? { readonly: '1' } : {}) });
    await page.send('Page.navigate', { url: browserFixtureUrl('decks-loading') + '?' + query });
    await until(`Boolean(document.querySelector('.deck-gallery') && document.querySelector('.first-screen')?.dataset.state === 'ready')`);
    await evaluate('document.fonts.ready');
  }
  afterEach(async () => { await page?.close(); page = undefined; });

  async function expectContinuousBackground() {
    const result = await evaluate(`(() => {
      const main = document.querySelector('.workspace-main');
      const gallery = document.querySelector('.deck-gallery');
      const style = getComputedStyle(main);
      return { image: style.backgroundImage, color: style.backgroundColor, galleryHeight: gallery.getBoundingClientRect().height,
        mainHeight: main.clientHeight, galleryBottom: gallery.getBoundingClientRect().bottom, mainBottom: main.getBoundingClientRect().bottom,
        overflow: document.documentElement.scrollWidth > innerWidth };
    })()`);
    expect(result.image).not.toBe('none');
    expect(result.color).not.toBe('rgba(0, 0, 0, 0)');
    expect(result.galleryHeight).toBeGreaterThanOrEqual(result.mainHeight);
    expect(result.galleryBottom).toBeGreaterThanOrEqual(result.mainBottom - 1);
    expect(result.overflow).toBe(false);
  }

  it.each([375, 1920].flatMap(width => ['light', 'dark'].map(theme => ({ width, theme }))))(
    'keeps six slots and CLS 0 from loading to ready at $width px ($theme)', async ({ width, theme }) => {
      await open({ width, theme });
      await until(`document.querySelectorAll('.catalog-cover-skeleton').length === 6`);
      const before = await evaluate(`[...document.querySelectorAll('.catalog-cover-item')].map(node => {
        const r = node.getBoundingClientRect(); return [r.x, r.y, r.width, r.height];
      })`);
      expect(before).toHaveLength(6);
      expect(await evaluate(`document.querySelector('.gallery-body').inert && document.querySelector('.gallery-body').getAttribute('aria-busy') === 'true'
        && document.querySelector('.catalog-source[role=status]') !== null`)).toBe(true);
      await expectContinuousBackground();
      await evaluate(`window.loadingShifts = 0; window.loadingShiftDetails = [];
        window.loadingObserver = new PerformanceObserver(list => { for (const entry of list.getEntries()) {
          loadingShifts += entry.value; loadingShiftDetails.push(...entry.sources.map(source => ({ node: source.node?.className, before: source.previousRect.toJSON(), after: source.currentRect.toJSON() })));
        } }); loadingObserver.observe({ type: 'layout-shift' }); decksLoadingTest.release()`);
      await until(`document.querySelectorAll('[data-deck-cover]').length === 5 && !document.querySelector('.project-pulse-loading')`);
      await waitForLayout(evaluate, '.catalog-deck-grid, .project-pulse');
      await delay(200);
      const after = await evaluate(`[...document.querySelectorAll('.catalog-cover-item, .catalog-add-deck')].map(node => {
        const r = node.getBoundingClientRect(); return [r.x, r.y, r.width, r.height];
      })`);
      expect(after).toHaveLength(6);
      after.forEach((rect: number[], index: number) => rect.forEach((value, axis) => expect(Math.abs(value - before[index][axis]), `slot ${index}, axis ${axis}`).toBeLessThanOrEqual(1)));
      const shifts = await evaluate('loadingObserver.disconnect(); ({ value: loadingShifts, details: loadingShiftDetails })');
      expect(shifts.value, JSON.stringify(shifts.details)).toBeLessThanOrEqual(0.00001);
      expect(await evaluate(`document.querySelector('.gallery-body').getAttribute('aria-busy') === 'false' && !document.querySelector('.gallery-body').inert`)).toBe(true);
      await expectContinuousBackground();
      expect(page!.consoleErrors).toEqual([]);
    });

  it('replaces a completely empty project with one available starting action and no zero summary', async () => {
    await open({ state: 'empty', width: 375, lang: 'ru' });
    await evaluate('decksLoadingTest.release()');
    await until(`document.querySelector('.deck-gallery')?.dataset.state === 'empty'`);
    expect(await evaluate(`document.querySelectorAll('.gallery-resolution:not([hidden]) .ui-empty-scene').length`)).toBe(1);
    expect(await evaluate(`document.querySelectorAll('.gallery-resolution:not([hidden]) .ui-button').length`)).toBe(1);
    expect(await evaluate(`document.querySelector('.gallery-resolution:not([hidden])').textContent`)).toContain('Начать с шаблона');
    expect(await evaluate(`document.querySelector('.project-pulse') === null && document.querySelector('.catalog-cover-skeleton') === null`)).toBe(true);
    expect(await evaluate(`document.querySelector('.deck-gallery-add').disabled`)).toBe(false);
    await expectContinuousBackground();
  });

  it('keeps the same retry node, guards duplicate requests and restores focus after recovery', async () => {
    await open({ state: 'error', width: 375, lang: 'ru', coarse: true });
    await evaluate('decksLoadingTest.release()');
    await until(`document.querySelector('.deck-gallery')?.dataset.state === 'error' && document.querySelector('.gallery-resolution').getAttribute('aria-busy') !== 'true'`);
    expect(await evaluate(`document.querySelectorAll('[role=alert]:not([hidden])').length`)).toBe(1);
    expect(await evaluate(`document.querySelector('.gallery-resolution details').open`)).toBe(false);
    expect(await evaluate(`document.querySelector('.gallery-resolution .ui-button').getBoundingClientRect().height >= 44`)).toBe(true);
    await evaluate(`window.retryButton = document.querySelector('.gallery-resolution .ui-button'); retryButton.focus({ preventScroll: true }); retryButton.click(); retryButton.click()`);
    await until(`document.querySelector('.gallery-resolution').getAttribute('aria-busy') === 'true'`);
    expect(await evaluate(`document.activeElement === retryButton && document.querySelector('.gallery-resolution .ui-button') === retryButton
      && retryButton.getAttribute('aria-disabled') === 'true' && decksLoadingTest.requests.length`)).toBe(2);
    await evaluate('decksLoadingTest.releaseRetry()');
    await until(`document.querySelectorAll('[data-deck-cover]').length === 5`);
    await until(`document.querySelector('.gallery-resolution').hidden && document.activeElement === document.querySelector('.gallery-body')`);
    expect(await evaluate(`!document.querySelector('.gallery-resolution').checkVisibility()`)).toBe(true);
    await expectContinuousBackground();
  });

  it('uses neutral read-only empty copy and immediate replacement with reduced motion and long Russian text', async () => {
    await open({ state: 'empty', width: 375, lang: 'ru', long: true, readonly: true, reduced: true, coarse: true });
    await evaluate('decksLoadingTest.release()');
    await until(`document.querySelector('.deck-gallery')?.dataset.state === 'empty'`);
    expect(await evaluate(`document.querySelector('.gallery-resolution:not([hidden])').textContent`)).toContain('В этом проекте пока нет пространств и колод.');
    expect(await evaluate(`document.querySelector('.gallery-resolution:not([hidden]) .ui-button') === null && document.querySelector('.deck-gallery-add') === null`)).toBe(true);
    expect(await evaluate(`document.querySelector('.gallery-body').getAnimations({ subtree: true }).length`)).toBe(0);
    await expectContinuousBackground();
  });
});
