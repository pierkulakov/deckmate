import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openHeadlessBrowser, type HeadlessPage } from '../tools/headless-browser.ts';
import { requireBrowser } from './browser-environment.ts';
import { browserFixtureUrl } from './browser-fixture.ts';
import { expectPageStateDuring, waitForLayout } from './browser-layout.ts';

const browserPath = requireBrowser();
describe.skipIf(!browserPath)('cold loading surfaces (browser)', () => {
  let page: HeadlessPage;
  async function until(expression: string, navigating = false) {
    for (let attempt = 0; attempt < 400; attempt++) {
      try { if (await page.evaluate(expression)) return; }
      catch (error) {
        // 2026-11-13: a reload replaces the execution context while the next document becomes ready.
        if (!navigating || !(error instanceof Error) || !/^Runtime\.evaluate: (Inspected target navigated or closed|Execution context was destroyed|Cannot find context)/u.test(error.message)) throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    throw new Error(expression + '\n' + page.consoleErrors.join('\n'));
  }
  async function reset(screen: string, width = 1440, theme = 'light', extra = '') {
    await page.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await page.send('Page.navigate', { url: browserFixtureUrl('loading-surfaces') + `?screen=${screen}&theme=${theme}${extra}` });
    await until('Boolean(window.loadingTest)');
    await page.evaluate('document.fonts.ready');
  }
  beforeAll(async () => {
    page = await openHeadlessBrowser({ width: 1440, height: 900, scale: 1 });
    await page.send('Network.enable');
    await page.send('Network.setCacheDisabled', { cacheDisabled: true });
    await page.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  }, 60000);
  afterAll(async () => { await page?.close(); }, 20000);

  for (const width of [375, 1440]) for (const theme of ['light', 'dark']) {
    it.each([
      { screen: 'hand', frame: '.hand-view', ready: '.hand-panel' },
      { screen: 'timeline', frame: '.planning-view', ready: '.timeline-canvas' },
      { screen: 'vision', frame: '.vision-workspace', ready: '.excalidraw' },
    ])(`keeps $screen through separate cold code/data waits at ${width}px (${theme})`, async ({ screen, frame, ready }) => {
      await reset(screen, width, theme);
      await until(`Boolean(document.querySelector('.lazy-section-page [role=status]'))`);
      await page.evaluate(`window.samples=[];window.shifts=[];window.sampling=true;
        window.observer=new PerformanceObserver(list=>shifts.push(...list.getEntries().map(e=>({value:e.value,sources:e.sources.map(s=>({node:s.node?.className,before:[s.previousRect.x,s.previousRect.y,s.previousRect.width,s.previousRect.height],after:[s.currentRect.x,s.currentRect.y,s.currentRect.width,s.currentRect.height]}))}))));observer.observe({type:'layout-shift'});
        (function sample(){const main=document.querySelector('main').getBoundingClientRect();const frame=document.querySelector(${JSON.stringify(frame)})?.getBoundingClientRect();
          samples.push({height:main.height,frame:frame?.height,ready:!!document.querySelector(${JSON.stringify(ready)}),waiting:!!document.querySelector('.ui-loading [role=status]')});if(sampling)requestAnimationFrame(sample)})()`);
      await page.send('Network.emulateNetworkConditions', { offline: false, latency: 250, downloadThroughput: 750000, uploadThroughput: 750000 });
      await page.evaluate('loadingTest.releaseCode()');
      await until(`Boolean(document.querySelector(${JSON.stringify(frame)})) && loadingTest.reads > 0`);
      // 2026-11-13: the first data read must not restart the delay, collapse the screen, or display an empty result.
      expect(await page.evaluate(`document.querySelector(${JSON.stringify(frame)}).getBoundingClientRect().height >= document.querySelector('main').clientHeight`)).toBe(true);
      await expectPageStateDuring(page.evaluate, `Boolean(document.querySelector('.ui-loading [role=status]')) && !document.querySelector(${JSON.stringify(ready)})`, 200);
      await page.evaluate('loadingTest.releaseData()');
      await until(`Boolean(document.querySelector(${JSON.stringify(ready)}))`);
      await waitForLayout(page.evaluate, 'main');
      const result = await page.evaluate('sampling=false;observer.disconnect();({samples,shifts})');
      expect(result.samples.every((sample: { height: number; ready: boolean; waiting: boolean }) => sample.height === 900 && (sample.ready || sample.waiting))).toBe(true);
      expect(result.shifts.reduce((total: number, shift: { value: number }) => total + shift.value, 0), JSON.stringify(result.shifts)).toBeLessThan(0.001);
      expect(await page.evaluate(`document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight`)).toBe(true);
    }, 30000);

    it(`keeps the members dialog and its footer fixed during a delayed roster (${width}px, ${theme})`, async () => {
      await reset('members', width, theme);
      await page.evaluate('loadingTest.releaseCode()');
      await until(`Boolean(document.querySelector('.members-editor .ui-loading'))`);
      await waitForLayout(page.evaluate, '.members-editor');
      const box = await page.evaluate(`document.querySelector('.members-editor').getBoundingClientRect().toJSON()`);
      const footer = await page.evaluate(`document.querySelector('.members-editor-footer').getBoundingClientRect().y`);
      await page.evaluate(`window.emptyFrames=0;window.checkEmpty=true;(function check(){if(!document.querySelector('.members-editor .ui-loading')&&!document.querySelector('.members-editor-row'))emptyFrames++;if(checkEmpty)requestAnimationFrame(check)})()`);
      await page.evaluate('loadingTest.releaseData()');
      await until(`Boolean(document.querySelector('.members-editor-row'))`);
      await waitForLayout(page.evaluate, '.members-editor');
      expect(await page.evaluate('checkEmpty=false;emptyFrames')).toBe(0);
      expect(await page.evaluate(`document.querySelector('.members-editor').getBoundingClientRect().toJSON()`)).toEqual(box);
      expect(await page.evaluate(`document.querySelector('.members-editor-footer').getBoundingClientRect().y`)).toBe(footer);
    });
  }

  it('hides short plate/skeleton waits and reveals long waits without shifting the next action, including reduced motion', async () => {
    await page.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    try {
      for (const extra of ['', '&skeleton']) {
        await reset('probe', 375, 'dark', extra);
        // 2026-11-13: run the short wait and observations on the page's clock, independent of CDP round trips.
        await page.evaluate(`window.probeStatuses=[];new MutationObserver(()=>probeStatuses.push(!!document.querySelector('.ui-loading [role=status]'))).observe(document.querySelector('main'),{subtree:true,attributes:true,childList:true});startProbe();setTimeout(finishProbe,60)`);
        await expectPageStateDuring(page.evaluate, `!document.querySelector('.ui-loading [role=status]')`, 200);
        expect(await page.evaluate('probeStatuses.includes(true)')).toBe(false);
        await reset('probe', 375, 'dark', extra);
        await page.evaluate('startProbe()');
        const y = await page.evaluate(`document.querySelector('#anchor').getBoundingClientRect().y`);
        await until(`Boolean(document.querySelector('.ui-loading [role=status]'))`);
        expect(await page.evaluate(`document.querySelector('#anchor').getBoundingClientRect().y`)).toBe(y);
        expect(await page.evaluate(`document.querySelector('.ui-loading').getAnimations({subtree:true}).length`)).toBe(0);
      }
    } finally {
      await page.send('Emulation.setEmulatedMedia', { features: [] });
      await page.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    }
  });

  it('contains a failed chunk and recovers with the explicit reload action', async () => {
    await page.send('Network.setBlockedURLs', { urls: ['*MembersEditor-*.js'] });
    try {
      await reset('members', 375, 'dark', '&auto');
      await until(`Boolean(document.querySelector('.lazy-section-dialog-error'))`);
      expect(await page.evaluate(`document.querySelector('#retained').textContent`)).toBe('Рабочая область');
      expect(await page.evaluate(`document.querySelector('.lazy-section-dialog-error').textContent`)).toContain('Обновить интерфейс');
      await page.send('Network.setBlockedURLs', { urls: [] });
      const button = await page.evaluate(`[...document.querySelectorAll('.lazy-section-dialog-error button')].find(e=>e.textContent==='Обновить интерфейс').getBoundingClientRect().toJSON()`);
      const point = { x: button.x + button.width / 2, y: button.y + button.height / 2, button: 'left', clickCount: 1 };
      await page.send('Input.dispatchMouseEvent', { ...point, type: 'mousePressed' });
      await page.send('Input.dispatchMouseEvent', { ...point, type: 'mouseReleased' });
      await until(`Boolean(document.querySelector('.members-editor-row'))`, true);
      expect(await page.evaluate(`Boolean(document.querySelector('.lazy-section-dialog-error'))`)).toBe(false);
    } finally { await page.send('Network.setBlockedURLs', { urls: [] }); }
  });
});
