import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openHeadlessBrowser, type HeadlessPage } from '../tools/layout-capture.ts';
import { requireBrowser } from './browser-environment.ts';
import { browserFixtureUrl } from './browser-fixture.ts';
import { waitForLayout } from './browser-layout.ts';

const browserPath = requireBrowser();

interface PulseSample { loading: boolean; values: number; firstValue: string | null; error: boolean; busy: string | null }
interface PulseObservation { samples: PulseSample[]; loadingMutations: number }

// 2026-11-10: the loading state flashed on every return to the Decks home;
// this watches the DOM across remounts and refreshKey bumps to prove numbers paint immediately instead.
describe.skipIf(!browserPath)('project pulse stale-while-revalidate (browser)', () => {
  let page: HeadlessPage;
  beforeAll(async () => {
    page = await openHeadlessBrowser({ width: 1280, height: 800, scale: 1 });
    await page.send('Page.navigate', { url: browserFixtureUrl('project-pulse-cache') });
    await page.evaluate(`new Promise((resolve, reject) => {
      const deadline = performance.now() + 10000;
      function check() {
        const value = document.querySelector('.project-pulse-value');
        if (value && value.childNodes[0]?.textContent === '3') return resolve(true);
        if (performance.now() > deadline) return reject(new Error('Pulse did not load'));
        requestAnimationFrame(check);
      }
      check();
    })`);
  });
  afterAll(async () => { await page?.close(); });

  // Click a control and sample every frame: the cached pulse must never give way to the loading state.
  async function observeClick(selector: string): Promise<PulseObservation> {
    return await page.callFunction(`selector => new Promise((resolve, reject) => {
      const root = document.getElementById('root');
      let loadingMutations = 0;
      const observer = new MutationObserver(() => { if (root.querySelector('.project-pulse-loading')) loadingMutations += 1; });
      observer.observe(root, { childList: true, subtree: true });
      const samples = [];
      document.querySelector(selector).click();
      const start = performance.now();
      function tick() {
        const strip = root.querySelector('.project-pulse');
        samples.push({
          loading: Boolean(root.querySelector('.project-pulse-loading')),
          values: root.querySelectorAll('.project-pulse-value').length,
          firstValue: root.querySelector('.project-pulse-value')?.childNodes[0]?.textContent ?? null,
          error: Boolean(root.querySelector('.project-pulse-error')),
          busy: strip?.getAttribute('aria-busy') ?? null,
        });
        if (performance.now() - start > 500) { observer.disconnect(); resolve({ samples, loadingMutations }); }
        else requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
      setTimeout(() => reject(new Error('Observation did not finish')), 8000);
    })`, selector) as Promise<PulseObservation>;
  }

  it('updates the numbers in place when a background refresh returns new data', async () => {
    await page.evaluate(`window.pulseTest.setCount(7)`);
    const { samples, loadingMutations } = await observeClick('.pulse-refresh');
    const last = samples.at(-1)!;
    expect(loadingMutations).toBe(0);
    expect(samples.some(sample => sample.loading)).toBe(false);
    expect(last.firstValue).toBe('7');
    expect(last.error).toBe(false);
    // The fetch went to the strip's own source.
    expect(await page.evaluate(`window.pulseTest.pulseRequests.at(-1)`)).toContain('source=sandbox');
  });

  it('shows the cached numbers on the first render after a remount, without a loading state', async () => {
    const before = await page.evaluate(`document.querySelector('.project-pulse-value')?.childNodes[0]?.textContent`);
    const { samples, loadingMutations } = await observeClick('.pulse-remount');
    expect(loadingMutations).toBe(0);
    expect(samples.every(sample => !sample.loading)).toBe(true);
    // The first frames can catch the one-frame unmounted gap between the host's unmount and remount;
    // the strip's first painted frame must already carry the cached numbers.
    const painted = samples.find(sample => sample.values > 0);
    expect(painted).toBeDefined();
    expect(painted!.firstValue).toBe(before);
  });

  it('keeps cached numbers, reports a failed refresh and retries in place', async () => {
    const before = await page.evaluate(`document.querySelector('.project-pulse-value')?.childNodes[0]?.textContent`);
    await page.evaluate(`window.pulseTest.setFail(true)`);
    try {
      const { samples, loadingMutations } = await observeClick('.pulse-refresh');
      const last = samples.at(-1)!;
      expect(loadingMutations).toBe(0);
      expect(last.loading).toBe(false);
      expect(last.error).toBe(false);
      expect(last.firstValue).toBe(before);
      expect(await page.evaluate(`document.querySelector('.project-pulse [role="alert"]')?.textContent`)).toContain('pulse unavailable');
      await page.evaluate(`window.pulseTest.setFail(false); window.pulseTest.setCount(9)`);
      const retried = await observeClick('.project-pulse-retry');
      expect(retried.samples.at(-1)!.firstValue).toBe('9');
      expect(await page.evaluate(`document.querySelector('.project-pulse [role="alert"]')`)).toBeNull();
    } finally {
      await page.evaluate(`window.pulseTest.setFail(false)`);
    }
  }, 20000);
});

describe.skipIf(!browserPath)('project pulse first-return geometry (browser)', () => {
  let page: HeadlessPage;
  beforeAll(async () => {
    page = await openHeadlessBrowser({ width: 1440, height: 900, scale: 1 });
  });
  afterAll(async () => { await page?.close(); });

  async function until(expression: string) {
    await page.evaluate(`new Promise((resolve, reject) => {
      const deadline = performance.now() + 10000;
      function check() {
        if (${expression}) return resolve(true);
        if (performance.now() > deadline) return reject(new Error(${JSON.stringify(expression)}));
        requestAnimationFrame(check);
      }
      check();
    })`);
  }

  async function openDirectLink(width: number) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    const url = new URL(browserFixtureUrl('deck-transition'));
    url.search = new URLSearchParams({ view: 'deck', catalogSource: 'sandbox', deck: 'top', pulseTest: '1' }).toString();
    await page.send('Page.navigate', { url: url.href });
    await until(`Boolean(document.querySelector('.deck-open-toolbar button') && window.pulseRequests?.count)`);
    await page.evaluate(`document.querySelector('.deck-open-toolbar button').click()`);
    await until(`Boolean(document.querySelector('.deck-gallery .catalog-spaces'))`);
    await waitForLayout(page.evaluate, '.project-pulse, .catalog-spaces');
  }

  async function geometry(): Promise<{ height: number; shelf: number; cover: number }> {
    return page.evaluate(`(() => {
      const scroll = document.querySelector('.workspace-main').scrollTop;
      return {
        height: document.querySelector('.deck-gallery .project-pulse').getBoundingClientRect().height,
        shelf: document.querySelector('.catalog-spaces').getBoundingClientRect().top + scroll,
        cover: document.querySelector('.catalog-cover-item').getBoundingClientRect().top + scroll,
      };
    })()`);
  }

  it.each([375, 1440])('keeps the shelf still when the initial response arrives after returning at %s px', async width => {
    await openDirectLink(width);
    expect(await page.evaluate(`document.querySelector('.project-pulse').getAttribute('aria-busy')`)).toBe('true');
    const before = await geometry();
    await page.evaluate('window.pulseRequests.release()');
    await until(`document.querySelector('.project-pulse').getAttribute('aria-busy') === 'false'`);
    await waitForLayout(page.evaluate, '.project-pulse, .catalog-spaces');
    expect(await geometry()).toEqual(before);
    if (width === 375) {
      expect(before.height).toBe(40);
      expect(before.cover).toBeLessThan(900);
    }
    expect(page.consoleErrors).toEqual([]);
  });

  it.each([375, 1440])('reserves the saved expanded layout before a delayed response at %s px', async width => {
    await openDirectLink(375);
    if (await page.evaluate(`document.querySelector('.project-pulse-toggle').getAttribute('aria-expanded') === 'false'`)) {
      await page.evaluate(`document.querySelector('.project-pulse-toggle').click()`);
    }
    await until(`document.querySelector('.project-pulse-toggle').getAttribute('aria-expanded') === 'true'`);
    await openDirectLink(width);
    expect(await page.evaluate(`document.querySelector('.project-pulse-toggle').getAttribute('aria-expanded')`)).toBe('true');
    expect(await page.evaluate(`document.querySelector('.project-pulse').getAttribute('aria-busy')`)).toBe('true');
    const before = await geometry();
    expect(before.height).toBeGreaterThan(40);
    await page.evaluate('window.pulseRequests.release()');
    await until(`document.querySelector('.project-pulse').getAttribute('aria-busy') === 'false'`);
    await waitForLayout(page.evaluate, '.project-pulse, .catalog-spaces');
    expect(await geometry()).toEqual(before);
    expect(await page.evaluate(`getComputedStyle(document.querySelector('.project-pulse-details')).display`)).not.toBe('none');
    expect(page.consoleErrors).toEqual([]);
  });

  it('remembers a keyboard collapse and keeps the primary count actionable on touch', async () => {
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    await openDirectLink(375);
    await page.evaluate(`document.querySelector('.project-pulse-toggle').focus()`);
    for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', {
      type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13,
      text: type === 'keyDown' ? '\r' : undefined,
    });
    await until(`document.querySelector('.project-pulse-toggle').getAttribute('aria-expanded') === 'false'`);
    await openDirectLink(375);
    expect((await geometry()).height).toBe(44);
    expect(await page.evaluate(`getComputedStyle(document.querySelector('.project-pulse-details')).display`)).toBe('none');
    const before = await geometry();
    await page.evaluate('window.pulseRequests.release()');
    await until(`document.querySelector('.project-pulse').getAttribute('aria-busy') === 'false'`);
    expect(await geometry()).toEqual(before);
    await page.evaluate(`document.querySelector('[data-pulse="started"]').click()`);
    await until(`Boolean(document.querySelector('.card-scope-view .card-filter-bar'))`);
    expect(await page.evaluate(`document.querySelector('.card-filter-bar').textContent`)).toContain('Started');
    expect(page.consoleErrors).toEqual([]);
  });
});
