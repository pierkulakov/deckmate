import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openHeadlessBrowser, type HeadlessPage } from '../tools/layout-capture.ts';
import { browserFixtureUrl } from './browser-fixture.ts';
import { requireBrowser } from './browser-environment.ts';
import { contrastRatio } from '../client/color-contrast.ts';

const browserPath = requireBrowser();

describe.skipIf(!browserPath)('native select styling (browser)', () => {
  let page: HeadlessPage;
  beforeAll(async () => {
    page = await openHeadlessBrowser({ width: 1280, height: 800, scale: 1 });
    await page.send('Page.navigate', { url: browserFixtureUrl('selects') });
    const deadline = Date.now() + 10000;
    while (!await page.evaluate('Boolean(document.querySelector("#role"))')) {
      if (Date.now() > deadline) throw Error('Select fixture did not load');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }, 60000);
  afterAll(async () => { await page?.close(); });
  it('uses one picker icon and leaves listboxes native', async () => {
    const result = await page.evaluate(`(() => {
      const select = document.querySelector('#role');
      return { supported: CSS.supports('appearance', 'base-select'), appearance: getComputedStyle(select).appearance,
        arrow: getComputedStyle(select, '::picker-icon').display, sibling: getComputedStyle(select.nextElementSibling).display,
        multiple: getComputedStyle(document.querySelector('#multiple')).appearance, list: getComputedStyle(document.querySelector('#list')).appearance };
    })()`);
    if (result.supported) {
      expect(result.appearance).toBe('base-select');
      expect(result.arrow).not.toBe('none');
      expect(result.sibling).toBe('none');
      expect(result.multiple).not.toBe('base-select');
      expect(result.list).not.toBe('base-select');
    }
  });

  it('keeps the closed field and its selected label legible in both themes', async () => {
    try {
      for (const theme of ['light', 'dark']) {
        await page.evaluate(`document.documentElement.classList.toggle('dark', ${theme === 'dark'}); document.querySelector('#touch-select').style.transition = 'none'`);
        const style = await page.evaluate(`(() => {
          const select = document.querySelector('#touch-select'), probe = document.createElement('span'); document.body.append(probe);
          const rgb = color => color.match(/\\d+/g).slice(0, 3).map(Number);
          probe.style.color = 'var(--control-field-line)';
          const line = getComputedStyle(probe).color, actual = getComputedStyle(select);
          const result = { line, border: actual.borderTopColor, ink: rgb(actual.color), face: rgb(actual.backgroundColor), value: select.value };
          probe.remove(); return result;
        })()`) as { line: string; border: string; ink: number[]; face: number[]; value: string };
        expect(style.border, theme).toBe(style.line);
        expect(style.value, theme).toBe('first');
        expect(contrastRatio(style.ink, style.face), theme).toBeGreaterThanOrEqual(4.5);
      }
    } finally {
      await page.evaluate(`document.querySelector('#touch-select').style.removeProperty('transition')`);
    }
  });

  it('keeps the native picker and its neighbouring action reachable by touch at 375px', async () => {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 600, deviceScaleFactor: 1, mobile: false });
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    const tap = async (x: number, y: number) => {
      await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    try {
      for (const theme of ['light', 'dark']) {
        await page.evaluate(`document.documentElement.classList.toggle('dark', ${theme === 'dark'}); document.querySelector('#touch-select').value='first'; delete document.querySelector('#touch-neighbour').dataset.clicked`);
        const bounds = await page.evaluate(`(() => { const box=id=>{const r=document.getElementById(id).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right};};return {select:box('touch-select'),button:box('touch-neighbour'),base:CSS.supports('appearance','base-select')}; })()`);
        for (const box of [bounds.select, bounds.button]) {
          expect(box.width).toBeGreaterThanOrEqual(44);
          expect(box.height).toBeGreaterThanOrEqual(44);
          expect(box.right).toBeLessThanOrEqual(375);
        }
        expect(bounds.button.x - bounds.select.right).toBe(8);
        await tap(bounds.select.x + 12, bounds.select.y + 22);
        if (bounds.base) {
          expect(await page.evaluate(`document.querySelector('#touch-select').matches(':open')`)).toBe(true);
          const option = await page.evaluate(`(() => { const r=document.querySelector('#touch-select option[value="second"]').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}; })()`);
          expect(option.height).toBeGreaterThanOrEqual(44);
          expect(option.width).toBeLessThanOrEqual(375);
          await tap(option.x + option.width / 2, option.y + option.height / 2);
          expect(await page.evaluate(`document.querySelector('#touch-select').value`)).toBe('second');
        } else {
          for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key:'Escape', code:'Escape', windowsVirtualKeyCode:27 });
        }
        expect(await page.evaluate(`document.querySelector('#touch-neighbour').dataset.clicked`)).toBeUndefined();
        await tap(bounds.button.x + 2, bounds.button.y + 22);
        expect(await page.evaluate(`document.querySelector('#touch-neighbour').dataset.clicked`)).toBe('true');
      }
    } finally {
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: false });
      await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    }
  });
});
