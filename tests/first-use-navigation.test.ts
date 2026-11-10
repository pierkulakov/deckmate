import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openHeadlessBrowser, type HeadlessPage } from '../tools/layout-capture.ts';
import { browserFixtureUrl } from './browser-fixture.ts';
import { requireBrowser } from './browser-environment.ts';
import { expectPageStateDuring, waitForLayout } from './browser-layout.ts';

const browserPath = requireBrowser();

describe.skipIf(!browserPath)('first-use navigation and CSS readiness (browser)', () => {
  let page: HeadlessPage;
  async function until(expression: string) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (await page.evaluate(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw Error(expression + '\n' + page.consoleErrors.join('\n'));
  }
  async function reset(width: number) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false });
    await page.send('Page.navigate', { url: browserFixtureUrl('first-use-navigation') + '?instance=' + Math.random() });
    await until('Boolean(window.firstUse && document.querySelector("#open"))');
  }
  beforeAll(async () => { page = await openHeadlessBrowser({ width: 1280, height: 800, scale: 1 }); }, 60000);
  afterAll(async () => { await page?.close(); }, 20000);

  it.each([1280, 375])('keeps the old screen interactive until the first JS/CSS chunk is ready at %s px', async width => {
    await reset(width);
    expect(await page.evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--first-use-installed').trim()`)).toBe('');
    await page.evaluate(`document.querySelector('#open').click();document.querySelector('#old-screen').click()`);
    await expectPageStateDuring(page.evaluate, `!document.querySelector('#prepared-screen,#fallback') && document.querySelector('#old-screen').textContent === 'Old screen 1'`, 200);
    await page.evaluate('firstUse.release()');
    await until(`Boolean(document.querySelector('#prepared-screen'))`);
    expect(await page.evaluate('firstUse.commits')).toEqual(['ready']);
    await waitForLayout(page.evaluate, '#prepared-screen');
    expect(await page.evaluate(`document.querySelector('#prepared-screen').style.willChange`)).toBe('');
  });

  it('uses the same idle import for the click and cancels stale navigation', async () => {
    await reset(1280);
    await page.evaluate(`firstUse.warm();document.querySelector('#open').click();firstUse.cancel();firstUse.release()`);
    await until('firstUse.ready()');
    expect(await page.evaluate('firstUse.commits')).toEqual([]);
    expect(await page.evaluate(`Boolean(document.querySelector('#old-screen'))`)).toBe(true);
    await page.evaluate(`document.querySelector('#open').click()`);
    await until(`Boolean(document.querySelector('#prepared-screen'))`);
    expect(await page.evaluate('firstUse.commits')).toEqual(['ready']);
    expect(page.consoleErrors).toEqual([]);
  });

  it('warms a control without stealing focus and removes the temporary root on completion or input cancellation', async () => {
    await reset(1280);
    expect(await page.evaluate(`(() => { document.querySelector('#old-screen').focus();firstUse.mount();return document.querySelector('[data-interface-warmup][aria-hidden="true"]').inert; })()`)).toBe(true);
    await page.evaluate('firstUse.mounted()');
    expect(await page.evaluate(`document.activeElement.id`)).toBe('old-screen');
    expect(await page.evaluate(`document.querySelector('[data-interface-warmup]')`)).toBeNull();
    await page.evaluate('firstUse.mount();firstUse.abortMount();firstUse.mounted()');
    expect(await page.evaluate(`document.querySelector('[data-interface-warmup]')`)).toBeNull();
    expect(await page.evaluate(`document.activeElement.id`)).toBe('old-screen');
    expect(page.consoleErrors).toEqual([]);
  });

  it('disposes a warm root from another React commit without nested-unmount warnings', async () => {
    await reset(1280);
    await page.evaluate('firstUse.mount();firstUse.unmount();firstUse.mounted()');
    expect(await page.evaluate(`document.querySelector('[data-interface-warmup]')`)).toBeNull();
    expect(page.consoleErrors).toEqual([]);
  });
});
