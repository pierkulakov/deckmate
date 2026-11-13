import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { openHeadlessBrowser, type HeadlessPage } from '../tools/headless-browser.ts';
import { browserFixtureUrl } from './browser-fixture.ts';
import { requireBrowser } from './browser-environment.ts';

const browserPath = requireBrowser();
const themeScript = readFileSync(new URL('../client/theme.js', import.meta.url), 'utf8');
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe.skipIf(!browserPath)('cold first screen (browser)', () => {
  let page: HeadlessPage | undefined;
  let proxy: Server | undefined;
  let releaseDeck: (() => void) | undefined;
  const evaluate = (expression: string) => page!.evaluate(expression);
  async function until(expression: string) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return;
      await delay(25);
    }
    throw new Error(expression + '\n' + JSON.stringify(await evaluate('window.initialLoadMetrics')) + '\n' + page!.consoleErrors.join('\n'));
  }
  async function open(width = 1440, theme = 'dark', cpu = 1, query = '', reduced = false, origin = browserFixtureUrl('initial-load')) {
    page = await openHeadlessBrowser({ width, height: 900, scale: 1 });
    await page.send('Network.enable');
    await page.send('Network.setCacheDisabled', { cacheDisabled: true });
    await page.send('Emulation.setCPUThrottlingRate', { rate: cpu });
    await page.send('Emulation.setEmulatedMedia', { features: [
      { name: 'prefers-color-scheme', value: theme === 'dark' ? 'light' : 'dark' },
      { name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' },
    ] });
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `
      localStorage.setItem('deckmate-theme', ${JSON.stringify(theme)});
      localStorage.setItem('deckmate-language', ${JSON.stringify(width === 375 ? 'ru' : 'en')});
      const applyTheme = () => {
        if (!document.documentElement) return;
        themeObserver.disconnect();
        (() => { ${themeScript} })();
      };
      const themeObserver = new MutationObserver(applyTheme);
      themeObserver.observe(document, { childList: true, subtree: true });
      applyTheme();
      const metrics = window.initialLoadMetrics = { cls: 0, shifts: [], paints: [], longFrames: [], frames: [], blankFrames: 0, done: false };
      for (const type of ['layout-shift', 'paint', 'long-animation-frame']) {
        if (!PerformanceObserver.supportedEntryTypes.includes(type)) continue;
        new PerformanceObserver(list => {
          for (const entry of list.getEntries()) {
            if (type === 'layout-shift' && !entry.hadRecentInput) { metrics.cls += entry.value; metrics.shifts.push({ time: entry.startTime, value: entry.value }); }
            if (type === 'paint') metrics.paints.push({ name: entry.name, time: entry.startTime });
            if (type === 'long-animation-frame') metrics.longFrames.push({ time: entry.startTime, duration: entry.duration });
          }
        }).observe({ type, buffered: true });
      }
      const sample = () => {
        const shell = document.querySelector('.app-shell');
        const visible = shell && getComputedStyle(shell).visibility === 'visible' && Number(getComputedStyle(shell).opacity) > 0;
        const status = document.querySelector('.first-screen-status');
        if (status && !visible && (getComputedStyle(status).visibility === 'hidden' || Number(getComputedStyle(status).opacity) === 0)) metrics.blankFrames++;
        if (visible) {
          const rects = [...document.querySelectorAll('.topbar,.deck-gallery-name h1,.catalog-spaces [data-deck-cover]')].map(e => {
            const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height];
          });
          metrics.frames.push({ rects, covers: document.querySelectorAll('.catalog-spaces [data-deck-cover]').length,
            fonts: [...document.fonts].filter(f => ['Source Sans 3', 'Geist Mono'].includes(f.family)).map(f => f.status),
            pending: Boolean(document.querySelector('.loading-state,.catalog-empty[role=status],.project-pulse-loading')),
            dark: document.documentElement.classList.contains('dark'), background: getComputedStyle(document.documentElement).backgroundColor });
        }
        if (!metrics.done) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    ` });
    await page.send('Page.navigate', { url: origin + query });
    await until(`window.initialLoadTest?.requests.includes('snapshot')`);
  }
  const visible = `Boolean(document.querySelector('.app-shell') && getComputedStyle(document.querySelector('.app-shell')).visibility === 'visible' && Number(getComputedStyle(document.querySelector('.app-shell')).opacity) > 0)`;
  const ready = `document.querySelector('.first-screen')?.dataset.state === 'ready' && Boolean(document.querySelector('.app-shell')) && getComputedStyle(document.querySelector('.app-shell')).opacity === '1'`;
  afterEach(async () => {
    releaseDeck?.(); releaseDeck = undefined;
    await page?.close(); page = undefined;
    if (proxy) await new Promise<void>(resolve => proxy!.close(() => resolve()));
    proxy = undefined;
  });

  async function openBeforeDeck(empty = true) {
    const fixture = new URL(browserFixtureUrl('initial-load'));
    const deckGate = new Promise<void>(resolve => { releaseDeck = resolve; });
    let deckRequested = false;
    proxy = createServer(async (request, response) => {
      const url = new URL(request.url!, fixture);
      if (/\/Deck-[^/]+\.js$/u.test(url.pathname)) { deckRequested = true; await deckGate; }
      const upstream = await fetch(url);
      response.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') ?? 'text/plain' });
      response.end(Buffer.from(await upstream.arrayBuffer()));
    });
    await new Promise<void>(resolve => proxy!.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(proxy.address() as { port: number }).port}${fixture.pathname}`;
    await open(1440, 'dark', 1, empty ? '?empty=1' : '', false, origin);
    await evaluate(`initialLoadTest.release('snapshot'); initialLoadTest.release('catalog')`);
    await until(`Boolean(initialLoadTest.catalog())`);
    expect(deckRequested).toBe(true);
    expect(await evaluate(`Boolean(document.querySelector('.app-shell'))`)).toBe(false);
    releaseDeck!();
    await until(`initialLoadTest.requests.includes('pulse')`);
  }

  const cases = [375, 1440].flatMap(width => ['light', 'dark'].flatMap(theme => [1, 4].map(cpu => ({ width, theme, cpu }))));
  it.each(cases)('reveals one stable, font-ready screen at $width px / $theme / CPU ×$cpu', async ({ width, theme, cpu }) => {
    await open(width, theme, cpu);
    expect(await evaluate(visible)).toBe(false);
    expect(await evaluate(`Boolean(document.querySelector('.first-screen-status .opening-brand .deckmate-mark')
      && document.querySelector('.first-screen-status .opening-tile') && document.querySelector('.first-screen-status .opening-activity'))`)).toBe(true);
    await evaluate(`initialLoadTest.release('snapshot')`);
    await until(`initialLoadTest.requests.includes('catalog')`);
    await until(`document.querySelector('.first-screen-status .opening-name')?.textContent === 'Studio / Студия'`);
    expect(await evaluate(visible)).toBe(false);
    await evaluate(`initialLoadTest.release('catalog')`);
    await until(`initialLoadTest.requests.includes('pulse')`);
    expect(await evaluate(visible)).toBe(false);
    await evaluate(`initialLoadTest.release('pulse')`);
    await until(`document.querySelector('.project-pulse')?.getAttribute('aria-busy') === 'false'`);
    // 2026-11-13: even complete data cannot expose fallback font metrics on a slow font connection.
    expect(await evaluate(visible)).toBe(false);
    expect(await evaluate(`document.querySelector('.first-screen').inert`)).toBe(true);
    await evaluate(`initialLoadTest.release('fonts')`);
    await until(ready);
    await delay(200);
    const metrics = await evaluate('initialLoadMetrics.done = true; initialLoadMetrics');
    expect(metrics.cls, JSON.stringify(metrics.shifts)).toBeLessThanOrEqual(0.00001);
    expect(metrics.frames.length).toBeGreaterThan(0);
    for (const frame of metrics.frames) {
      expect(frame.covers).toBe(3);
      expect(frame.pending).toBe(false);
      expect(frame.fonts.every((status: string) => status === 'loaded')).toBe(true);
      expect(frame.dark).toBe(theme === 'dark');
      expect(frame.background).toBe(theme === 'dark' ? 'rgb(50, 47, 64)' : 'rgb(240, 236, 244)');
      expect(frame.rects).toEqual(metrics.frames.at(-1).rects);
    }
    expect(await evaluate(`document.querySelector('.first-screen').inert`)).toBe(false);
    expect(await evaluate(`initialLoadTest.requests.slice().sort()`)).toEqual(['catalog', 'pulse', 'snapshot']);
    expect(page!.consoleErrors).toEqual([]);
  });

  it.each(['snapshot', 'catalog', 'pulse', 'fonts'])('releases the initial screen when %s fails', async failure => {
    await open(375, 'light', 1, '?failure=' + failure);
    await evaluate('initialLoadTest.releaseAll()');
    await until(ready);
    if (failure !== 'fonts') expect(await evaluate(`document.body.textContent.includes(${JSON.stringify('Unavailable: ' + failure)})`)).toBe(true);
    else expect(await evaluate(`document.querySelectorAll('[data-deck-cover]').length`)).toBe(3);
    expect(page!.consoleErrors).toEqual([]);
  });

  it('reveals the empty-project actions without motion or a permanent loading gate', async () => {
    await open(375, 'dark', 1, '?empty=1', true);
    await evaluate('initialLoadTest.releaseAll()');
    await until(ready);
    expect(await evaluate(`Boolean(document.querySelector('.gallery-resolution:not([hidden]) button:not(:disabled)'))`)).toBe(true);
    expect(await evaluate(`document.querySelector('.app-shell').getAnimations().length`)).toBe(0);
    expect(await evaluate('initialLoadMetrics.cls')).toBeLessThanOrEqual(0.00001);
    expect(page!.consoleErrors).toEqual([]);
  });

  it.each(['hand', 'timeline', 'decisions', 'vision', 'sprint'])('keeps the opening screen until Workspace mounts for %s', async view => {
    await open(1440, 'dark', 1, '?view=' + view);
    await evaluate(`initialLoadTest.release('fonts')`);
    await until(`initialLoadTest.fontsLoaded === 6`);
    await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    expect(await evaluate(`Boolean(document.querySelector('.app-shell'))`)).toBe(false);
    expect(await evaluate(`document.querySelector('.first-screen-status')?.dataset.state`)).toBe('loading');
    expect(await evaluate(`getComputedStyle(document.querySelector('.first-screen-status')).opacity`)).toBe('1');
    expect(await evaluate(`document.querySelector('.first-screen').inert`)).toBe(true);
    await evaluate(`initialLoadTest.release('snapshot')`);
    await until(ready);
    expect(await evaluate(`Boolean(document.querySelector('.workspace-main > *'))`)).toBe(true);
    expect(await evaluate(`document.querySelector('.first-screen').inert`)).toBe(false);
    const metrics = await evaluate('initialLoadMetrics.done = true; initialLoadMetrics');
    expect(metrics.blankFrames).toBe(0);
    expect(metrics.frames.length).toBeGreaterThan(0);
    for (const frame of metrics.frames) expect(frame.rects).toEqual(metrics.frames.at(-1).rects);
    expect(metrics.cls, JSON.stringify(metrics.shifts)).toBeLessThanOrEqual(0.00001);
    expect(page!.consoleErrors).toEqual([]);
  });

  it.each(['hand', 'timeline', 'decisions', 'vision'])('reveals the snapshot error when starting in %s', async view => {
    await open(1440, 'dark', 1, '?view=' + view + '&failure=snapshot');
    await evaluate('initialLoadTest.releaseAll()');
    await until(ready);
    expect(await evaluate(`document.querySelector('.workspace-main')?.textContent`)).toContain('Unavailable: snapshot');
    expect(page!.consoleErrors).toEqual([]);
  });

  it('reuses a preload from the current catalog without a second pulse request', async () => {
    await openBeforeDeck(false);
    await evaluate('initialLoadTest.releaseAll()');
    await until(ready);
    await until(`document.querySelector('.project-pulse')?.getAttribute('aria-busy') === 'false'`);
    expect(await evaluate(`initialLoadTest.requests.filter(stage => stage === 'pulse').length`)).toBe(1);
    expect(page!.consoleErrors).toEqual([]);
  });

  it.each(['ready', 'pending'])('refreshes an unused %s pulse preload after an empty project gains a started card', async preload => {
    await openBeforeDeck();
    if (preload === 'ready') {
      await evaluate(`initialLoadTest.release('pulse')`);
      await until(`initialLoadTest.cachedPulse()?.inProgress.count === 0`);
    }
    await evaluate(`initialLoadTest.release('fonts')`);
    await until(ready);
    expect(await evaluate(`Boolean(document.querySelector('.project-pulse'))`)).toBe(false);
    await evaluate(`window.releaseOldPulse = initialLoadTest.hold('pulse'); initialLoadTest.hold('catalog'); initialLoadTest.hold('snapshot'); initialLoadTest.addStartedCard(); document.querySelector('.mission-control-trigger').click()`);
    await until(`Boolean(document.querySelector('.mission-control-menu'))`);
    const previous = await evaluate(`document.querySelector('.app-shell').dataset.updatedAt`);
    await evaluate(`[...document.querySelectorAll('.mission-control-menu button')].find(button => button.textContent === 'Refresh page').click()`);
    await until(`initialLoadTest.requests.filter(stage => stage === 'snapshot').length === 2 && initialLoadTest.requests.filter(stage => stage === 'catalog').length === 2`);
    await evaluate(`initialLoadTest.release('snapshot')`);
    await until(`document.querySelector('.app-shell').dataset.updatedAt !== ${JSON.stringify(previous)}`);
    await evaluate(`initialLoadTest.release('catalog')`);
    await until(`Boolean(document.querySelector('.project-pulse'))`);
    await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    expect(await evaluate(`document.querySelector('.project-pulse').getAttribute('aria-busy')`)).toBe('true');
    expect(await evaluate(`initialLoadTest.requests.filter(stage => stage === 'pulse').length`)).toBe(2);
    if (preload === 'ready') expect(await evaluate(`document.querySelector('[data-pulse="started"]').getAttribute('aria-label')`)).toBe('In progress: 0 tasks');
    await evaluate(`initialLoadTest.release('pulse')`);
    await until(`document.querySelector('.project-pulse')?.getAttribute('aria-busy') === 'false'`);
    expect(await evaluate(`document.querySelector('[data-pulse="started"]').getAttribute('aria-label')`)).toBe('In progress: 1 task');
    if (preload === 'pending') {
      await evaluate(`releaseOldPulse()`);
      await until(`initialLoadTest.responses.filter(stage => stage === 'pulse').length === 2`);
      await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
      expect(await evaluate(`initialLoadTest.cachedPulse()?.inProgress.count`)).toBe(1);
      expect(await evaluate(`document.querySelector('[data-pulse="started"]').getAttribute('aria-label')`)).toBe('In progress: 1 task');
    }
    expect(page!.consoleErrors).toEqual([]);
  });
});
