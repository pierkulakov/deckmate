import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openHeadlessBrowser, type HeadlessPage } from '../tools/layout-capture.ts';
import { requireBrowser } from './browser-environment.ts';
import { browserFixtureUrl } from './browser-fixture.ts';

const browserPath = requireBrowser();

interface PulseSample { skeleton: boolean; values: number; firstValue: string | null; error: boolean; busy: string | null }
interface PulseObservation { samples: PulseSample[]; skeletonMutations: number }

// 2026-11-10: the pulse skeleton flashed on every return to the Decks home;
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

  const valueText = `document.querySelector('.project-pulse-value')?.childNodes[0]?.textContent ?? null`;

  // Click a control and sample every frame: the cached pulse must never give way to the loading skeleton.
  async function observeClick(selector: string): Promise<PulseObservation> {
    return await page.callFunction(`selector => new Promise((resolve, reject) => {
      const root = document.getElementById('root');
      let skeletonMutations = 0;
      const observer = new MutationObserver(() => { if (root.querySelector('.project-pulse-loading')) skeletonMutations += 1; });
      observer.observe(root, { childList: true, subtree: true });
      const samples = [];
      document.querySelector(selector).click();
      const start = performance.now();
      function tick() {
        const strip = root.querySelector('.project-pulse');
        samples.push({
          skeleton: Boolean(root.querySelector('.project-pulse-loading')),
          values: root.querySelectorAll('.project-pulse-value').length,
          firstValue: root.querySelector('.project-pulse-value')?.childNodes[0]?.textContent ?? null,
          error: Boolean(root.querySelector('.project-pulse-error')),
          busy: strip?.getAttribute('aria-busy') ?? null,
        });
        if (performance.now() - start > 500) { observer.disconnect(); resolve({ samples, skeletonMutations }); }
        else requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
      setTimeout(() => reject(new Error('Observation did not finish')), 8000);
    })`, selector) as Promise<PulseObservation>;
  }

  it('updates the numbers in place when a background refresh returns new data', async () => {
    await page.evaluate(`window.pulseTest.setCount(7)`);
    const { samples, skeletonMutations } = await observeClick('.pulse-refresh');
    const last = samples.at(-1)!;
    expect(skeletonMutations).toBe(0);
    expect(samples.some(sample => sample.skeleton)).toBe(false);
    expect(last.firstValue).toBe('7');
    expect(last.error).toBe(false);
    // The fetch went to the strip's own source.
    expect(await page.evaluate(`window.pulseTest.pulseRequests.at(-1)`)).toContain('source=sandbox');
  });

  it('shows the cached numbers on the first render after a remount, without the skeleton', async () => {
    const { samples, skeletonMutations } = await observeClick('.pulse-remount');
    expect(skeletonMutations).toBe(0);
    expect(samples.every(sample => !sample.skeleton)).toBe(true);
    // The first frames can catch the one-frame unmounted gap between the host's unmount and remount;
    // the strip's first painted frame must already carry the cached numbers.
    const painted = samples.find(sample => sample.values > 0);
    expect(painted).toBeDefined();
    expect(painted!.firstValue).toBe('7');
  });

  it('keeps the cached numbers when a background refresh fails', async () => {
    await page.evaluate(`window.pulseTest.setFail(true)`);
    try {
      const { samples, skeletonMutations } = await observeClick('.pulse-refresh');
      const last = samples.at(-1)!;
      expect(skeletonMutations).toBe(0);
      expect(last.skeleton).toBe(false);
      expect(last.error).toBe(false);
      expect(last.firstValue).toBe('7');
    } finally {
      await page.evaluate(`window.pulseTest.setFail(false)`);
    }
  }, 20000);
});
