import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createBrowserSession } from './browser-session.ts';
import { browserFixtureUrl } from './browser-fixture.ts';
import { requireBrowser } from './browser-environment.ts';
import { waitForLayout } from './browser-layout.ts';

const browserPath = requireBrowser();
describe.skipIf(!browserPath)('visible workbench divider', () => {
  const page = createBrowserSession();
  beforeAll(async () => {
    await page.open(browserPath!, { viewport: { width: 1440, height: 900, scale: 1 } });
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.removeItem('deckmate-summary-collapsed')` });
  }, 60000);
  afterAll(async () => { await page.close(); }, 20000);

  async function open(width: number, theme: string, many: boolean) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    const url = new URL(`?view=deck&catalogSource=sandbox&deck=audio&theme=${theme}&long=1`, browserFixtureUrl('layout-divider'));
    if (many) url.searchParams.set('many', '1');
    await page.send('Page.navigate', { url: url.href });
    await page.until(`Boolean(document.querySelector('.catalog-results .deck-card'))`);
    await waitForLayout(page.evaluate, '.catalog-workbench');
  }

  async function selectHero() {
    await page.evaluate(`document.querySelector('.workspace-main').scrollTo({ top: 0, behavior: 'instant' })`);
    await page.until(`Boolean(document.querySelector('[data-deck-card="card:scale-0"] .deck-card-open'))`);
    await page.evaluate(`document.querySelector('[data-deck-card="card:scale-0"] .deck-card-open').click()`);
    await page.until(`Boolean(document.querySelector('.card-preview-document .check-item'))`);
  }

  async function toggle(selector: string, panel: string, opened: boolean) {
    await page.callFunction(`selector => document.querySelector('.card-preview-action-rail ' + selector).click()`, selector);
    await page.until(`${opened ? '' : '!'}Boolean(document.querySelector(${JSON.stringify(panel)}))`);
  }

  async function measure() {
    await waitForLayout(page.evaluate, '.catalog-workbench, .catalog-resize-line, .card-preview, .card-family-panel, .card-properties-slot');
    return page.evaluate(`(() => {
      const rect = selector => document.querySelector(selector)?.getBoundingClientRect().toJSON() ?? null;
      const line = document.querySelector('.catalog-resize-line');
      const workspace = document.querySelector('.workspace-main');
      return { line: rect('.catalog-resize-line'), toolbar: rect('.deck-open-toolbar'), workspace: rect('.workspace-main'),
        sheet: rect('.card-preview-sheet'), panel: rect('.catalog-family-layer > .card-family-panel, .card-properties-slot:not([hidden])'),
        color: line && getComputedStyle(line).backgroundColor, scroll: workspace.scrollTop,
        overflow: workspace.scrollWidth > workspace.clientWidth || document.documentElement.scrollWidth > innerWidth };
    })()`);
  }

  async function capture(name: string, geometry: Awaited<ReturnType<typeof measure>>, desktop: boolean) {
    const destination = process.env.DECKMATE_DIVIDER_CAPTURE;
    const top = desktop ? geometry.toolbar.bottom : geometry.sheet?.top ?? geometry.toolbar.bottom;
    const x = desktop ? geometry.line.x : 0;
    const clip = { x: Math.max(0, Math.floor(x) - 100), y: Math.max(0, Math.floor(top) - 24), width: 260, height: 120, scale: 3 };
    if (destination) {
      await mkdir(destination, { recursive: true });
      const shot = await page.send('Page.captureScreenshot', { format: 'png' });
      const zoom = await page.send('Page.captureScreenshot', { format: 'png', clip });
      await writeFile(path.join(destination, name + '.png'), Buffer.from(shot.data, 'base64'));
      await writeFile(path.join(destination, name + '-top.png'), Buffer.from(zoom.data, 'base64'));
      await writeFile(path.join(destination, name + '.json'), JSON.stringify(geometry, null, 2));
    }
    if (!desktop) return;
    // 2026-11-13: DOM bounds also include pixels hidden by the sticky toolbar's opaque underlay.
    const pixels = await page.send('Page.captureScreenshot', { format: 'png', clip: { x: Math.floor(x), y: Math.floor(top), width: 1, height: 32, scale: 1 } });
    const firstPixel = await page.callFunction(`async (data, color) => {
      const image = new Image();
      image.src = 'data:image/png;base64,' + data;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d');
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const expected = context.getImageData(0, 0, 1, 1).data;
      context.drawImage(image, 0, 0);
      const actual = context.getImageData(0, 0, 1, image.height).data;
      for (let y = 0; y < image.height; y++) {
        if ([0, 1, 2].every(channel => Math.abs(actual[y * 4 + channel] - expected[channel]) <= 1)) return y;
      }
      return -1;
    }`, pixels.data, geometry.color);
    expect.soft(firstPixel, name + ': first painted divider pixel').toBeGreaterThanOrEqual(0);
    expect.soft(firstPixel, name + ': first painted divider pixel').toBeLessThanOrEqual(1);
  }

  for (const theme of ['dark', 'light']) for (const many of [false, true]) {
    it(`reaches the panel edges before and after scrolling a ${many ? 'long' : 'short'} deck in ${theme} at 1440px`, async () => {
      await open(1440, theme, many);
      const verify = async (state: string) => {
        for (const offset of many ? [0, 80, 400, 'end'] : [0, 'end']) {
          await page.callFunction(`offset => {
            const workspace = document.querySelector('.workspace-main');
            workspace.scrollTo({ top: offset === 'end' ? workspace.scrollHeight : offset, behavior: 'instant' });
          }`, offset);
          const geometry = await measure();
          const name = `1440-${theme}-${many ? 'long' : 'short'}-${state}-${offset}`;
          expect.soft(Math.abs(geometry.line.top - geometry.toolbar.bottom), name + ': top').toBeLessThanOrEqual(1);
          if (geometry.panel) {
            expect.soft(Math.abs(geometry.line.top - geometry.panel.top), name + ': panel top').toBeLessThanOrEqual(1);
            expect.soft(Math.abs(geometry.line.bottom - geometry.panel.bottom), name + ': panel bottom').toBeLessThanOrEqual(1);
          }
          const bottom = geometry.sheet?.bottom ?? geometry.workspace.bottom;
          expect.soft(Math.abs(Math.min(geometry.line.bottom, geometry.workspace.bottom) - bottom), name + ': bottom').toBeLessThanOrEqual(1);
          expect.soft(geometry.overflow, name).toBe(false);
          if (offset && many) expect(geometry.scroll).toBeGreaterThan(0);
          await capture(name, geometry, true);
        }
      };
      await verify('summary');
      await selectHero();
      await verify('card');
      const family = '.catalog-family-layer > .card-family-panel';
      await toggle('[data-card-family]', family, true);
      await verify('hero');
      await toggle('[data-card-family]', family, false);
      const properties = '.card-properties-slot:not([hidden])';
      await toggle('[aria-controls$="-properties"]', properties, true);
      await verify('properties');
      await toggle('[aria-controls$="-properties"]', properties, false);
      expect(page.errors).toEqual([]);
    });
  }

  for (const theme of ['dark', 'light']) {
    it(`keeps the stacked 375px layout free of a resize column with and without Hero in ${theme}`, async () => {
      await open(375, theme, true);
      const verify = async (state: string) => {
        const geometry = await measure();
        expect(geometry.overflow).toBe(false);
        expect(await page.evaluate(`document.querySelector('.catalog-resize-handle')?.getClientRects().length ?? 0`)).toBe(0);
        await capture(`375-${theme}-${state}`, geometry, false);
      };
      await verify('deck');
      await page.evaluate(`document.querySelector('.workspace-main').scrollTo({ top: 400, behavior: 'instant' })`);
      await verify('deck-scroll');
      await page.evaluate(`document.querySelector('.workspace-main').scrollTo({ top: 0, behavior: 'instant' })`);
      await selectHero();
      await verify('card');
      await page.evaluate(`document.querySelector('.card-preview-panels').scrollTop = 400`);
      expect(await page.evaluate(`document.querySelector('.card-preview-panels').scrollTop`)).toBeGreaterThan(0);
      await verify('card-scroll');
      const family = '.card-preview-mobile-family-slot:not([hidden]) .card-family-panel';
      await toggle('[data-card-family]', family, true);
      await verify('hero');
      await toggle('[data-card-family]', family, false);
      await verify('card-return');
      expect(page.errors).toEqual([]);
    });
  }
});
