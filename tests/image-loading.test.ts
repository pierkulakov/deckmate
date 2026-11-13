import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { openHeadlessBrowser, type HeadlessPage } from '../tools/headless-browser.ts';
import { requireBrowser } from './browser-environment.ts';
import { browserFixtureUrl } from './browser-fixture.ts';

const browserPath = requireBrowser();
const matrix = [
  { theme: 'light', width: 375, scale: 1.5 }, { theme: 'dark', width: 375, scale: 2 },
  { theme: 'light', width: 1440, scale: 2 }, { theme: 'dark', width: 1440, scale: 1.5 },
];

describe.skipIf(!browserPath)('decoded image continuity (browser)', () => {
  let page: HeadlessPage;
  let server: Server;
  let origin: string;
  let release: () => void;
  let transport: Promise<void>;
  const requests = new Map<string, number>();
  beforeAll(async () => {
    const art = await readFile('assets/deck-art/buildings.webp');
    const fixture = new URL(browserFixtureUrl('image-loading'));
    server = createServer(async (request, response) => {
      const url = new URL(request.url!, fixture);
      if (url.pathname === '/api/file') {
        const file = url.searchParams.get('path')!;
        requests.set(file, (requests.get(file) ?? 0) + 1);
        await transport;
        response.setHeader('Cache-Control', 'private, no-cache');
        response.setHeader('Content-Type', 'image/webp');
        response.statusCode = file.includes('missing') ? 404 : 200;
        if (file.includes('wide') || file.includes('portrait')) {
          response.setHeader('Content-Type', 'image/svg+xml');
          const [width, height] = file.includes('wide') ? [800, 100] : [100, 800];
          response.end(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><path fill="#607d98" d="M0 0H${width}V${height}H0Z"/></svg>`);
        } else response.end(file.includes('missing') ? '' : art);
      } else {
        const upstream = await fetch(url);
        response.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') ?? 'text/plain' });
        response.end(Buffer.from(await upstream.arrayBuffer()));
      }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(async () => { await new Promise<void>(resolve => server?.close(() => resolve())); });
  beforeEach(async () => {
    requests.clear();
    transport = new Promise(resolve => { release = resolve; });
    page = await openHeadlessBrowser({ width: 1440, height: 900, scale: 1.5 });
    await page.send('Network.enable');
    await page.send('Network.clearBrowserCache');
    await page.send('Page.navigate', { url: origin + '/image-loading/' });
    await until('Boolean(window.imageTest)');
    await page.evaluate('document.fonts.ready');
    await page.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 64000, uploadThroughput: 64000 });
    await page.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  });
  afterEach(async () => { release?.(); await page?.close(); });

  async function until(expression: string) {
    for (let i = 0; i < 200; i++) {
      if (await page.evaluate(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error('Timed out: ' + expression + '\n' + page.consoleErrors.join('\n'));
  }
  const paint = () => page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  async function observe(selector: string) {
    await paint();
    return page.callFunction(`selector => {
      window.imageCLS = 0; window.imageFrames = []; window.recordImages = true;
      window.imageObserver?.disconnect();
      window.imageObserver = new PerformanceObserver(list => { for(const entry of list.getEntries()) window.imageCLS += entry.value; });
      window.imageObserver.observe({type:'layout-shift'});
      function sample() {
        window.imageFrames.push([...document.querySelectorAll(selector)].map(el => {const r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,opacity:Number(getComputedStyle(el).opacity)};}));
        if(window.recordImages) requestAnimationFrame(sample);
      } sample();
      return window.imageFrames[0];
    }`, selector);
  }
  async function stop() {
    await paint();
    return page.evaluate(`(() => {window.recordImages=false;return {cls:window.imageCLS,frames:window.imageFrames};})()`);
  }

  it.each(matrix)('keeps slow covers at CLS 0, decoded before fading, $theme $width at $scale', async ({ theme, width, scale }) => {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: scale, mobile: false });
    await page.evaluate(`imageTest.holdDecode(); imageTest.render('gallery', '${theme}')`);
    const initial = await observe('.catalog-cover-art img');
    expect(initial).toHaveLength(5);
    expect(initial.every((r: { w: number; h: number; opacity: number }) => r.w > 0 && r.h > 0 && r.opacity === 0)).toBe(true);
    release();
    await until(`[...document.images].every(i => i.complete && i.naturalWidth > 0)`);
    expect(await page.evaluate(`[...document.images].every(i => i.dataset.imageState === 'loading' && getComputedStyle(i).opacity === '0')`)).toBe(true);
    await page.evaluate('imageTest.releaseDecode()');
    await until(`[...document.images].every(i => i.dataset.imageState === 'ready' && getComputedStyle(i).opacity === '1')`);
    const { cls, frames } = await stop();
    expect(cls).toBe(0);
    expect(frames.some((frame: { opacity: number }[]) => frame.some(r => r.opacity > 0 && r.opacity < 1))).toBe(true);
    for (const frame of frames) expect(frame.map(({ opacity: _, ...rect }: { opacity: number }) => rect))
      .toEqual(initial.map(({ opacity: _, ...rect }: { opacity: number }) => rect));
    expect(await page.evaluate(`[...document.images].every(i => i.decoding === 'async' && getComputedStyle(i).imageRendering === 'pixelated')`)).toBe(true);
    await page.evaluate(`imageTest.render('empty')`);
    await paint();
    await page.evaluate(`imageTest.render('gallery', '${theme}')`);
    expect(await page.evaluate(`[...document.images].every(i => i.dataset.imageState === 'ready' && getComputedStyle(i).opacity === '1')`)).toBe(true);
    expect([...requests.values()]).toEqual([1, 1, 1, 1, 1]);
  });

  it.each(matrix)('reserves Markdown and attachment slots, including failed images, $theme $width', async ({ theme, width, scale }) => {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: scale, mobile: false });
    await page.evaluate(`imageTest.render('attachments', '${theme}')`);
    await until(`document.querySelectorAll('.attachments-preview').length === 3`);
    const selector = '.markdown-image, .attachments-preview';
    const initial = await observe(selector);
    release();
    await until(`document.querySelector('.markdown .image-fallback') && [...document.querySelectorAll('.markdown img')].every(i=>i.dataset.imageState==='ready')`);
    const result = await stop();
    expect(result.cls).toBe(0);
    expect(initial.every((r: { h: number }) => r.h > 0)).toBe(true);
    for (const frame of result.frames) expect(frame).toEqual(initial);
    await page.evaluate(`document.querySelector('.attachments-preview').scrollIntoView(); document.querySelector('.attachments-preview').click()`);
    await until(`document.querySelector('.attachment-viewer img')?.dataset.imageState === 'ready'`);
    expect(await page.evaluate(`getComputedStyle(document.querySelector('.attachment-viewer img')).opacity`)).toBe('1');
    expect(await page.evaluate(`document.querySelector('.markdown .image-fallback').textContent`)).toContain('file not found');
  });

  it('keeps virtual row geometry and cached images steady after scrolling away and back', async () => {
    await page.evaluate(`imageTest.render('virtual')`);
    await until(`Boolean(document.querySelector('[data-virtual-card-grid]'))`);
    const height = await page.evaluate(`document.querySelector('[data-virtual-card-grid]').getBoundingClientRect().height`);
    release();
    await until(`[...document.images].every(i=>i.dataset.imageState==='ready')`);
    await page.evaluate(`window.firstImage = document.querySelector('.deck-thumb img'); document.querySelector('.workspace-main').scrollTop=4000`);
    await until(`!document.querySelector('[data-card-id="card:0"]')`);
    await page.evaluate(`document.querySelector('.workspace-main').scrollTop=0`);
    await until(`Boolean(document.querySelector('[data-card-id="card:0"]'))`);
    expect(await page.evaluate(`document.querySelector('.deck-thumb img') !== window.firstImage`)).toBe(true);
    expect(await page.evaluate(`[...document.images].every(i=>i.dataset.imageState==='ready' && getComputedStyle(i).opacity==='1')`)).toBe(true);
    expect(await page.evaluate(`document.querySelector('[data-virtual-card-grid]').getBoundingClientRect().height`)).toBe(height);
    expect(requests.get('tasks/virtual.webp')).toBe(1);
  });

  it('respects reduced motion and ignores an obsolete decode after a source replacement', async () => {
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await page.evaluate(`imageTest.holdDecode(); imageTest.render('source:old')`);
    release();
    await until(`imageTest.waitingFor('old.webp')`);
    await page.evaluate(`imageTest.render('source:new')`);
    await until(`imageTest.waitingFor('new.webp')`);
    await page.evaluate(`imageTest.releaseDecode('old.webp')`);
    await paint();
    expect(await page.evaluate(`document.querySelector('img').dataset.imageState`)).toBe('loading');
    await page.evaluate('imageTest.releaseDecode()');
    await until(`document.querySelector('img').dataset.imageState==='ready'`);
    expect(await page.evaluate(`document.querySelector('img').getAttribute('src')`)).toContain('new.webp');
    expect(await page.evaluate(`getComputedStyle(document.querySelector('img')).transitionDuration`)).toBe('0s');
    expect(page.consoleErrors).toEqual([]);
  });
});
