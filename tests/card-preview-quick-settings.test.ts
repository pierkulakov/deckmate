import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { freePort } from './free-port.ts';

const browserPath = [process.env.DECKMATE_BROWSER, process.env.BROWSER,
  'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
  .find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// 2026-11-08: no DOM shim can verify Radix's real Escape/focus behavior; use the installed headless browser over CDP.
describe.skipIf(!browserPath)('CardPreview Quick Settings (browser)', () => {
  let server: ViteDevServer | undefined;
  let browser: ChildProcess | undefined;
  let profile: string | undefined;
  let socket: WebSocket | undefined;
  let sequence = 0;
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  const errors: string[] = [];

  async function send(method: string, params: object = {}): Promise<any> {
    const id = ++sequence;
    return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); socket!.send(JSON.stringify({ id, method, params })); });
  }
  async function evaluate(expression: string): Promise<any> {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result?.value;
  }
  // 2026-11-08: the first page load waits for Vite's cold dependency scan, which can exceed five seconds on Windows.
  async function until(expression: string, attempts = 100) {
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (await evaluate(expression)) return;
      await delay(50);
    }
    throw new Error('Timed out: ' + expression + '\n' + errors.join('\n'));
  }
  async function click(selector: string) {
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    await delay(60);
  }
  async function key(key: string, code = key) {
    for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: key === 'Escape' ? 27 : undefined });
    await delay(80);
  }
  async function render(kind = 'task', options: object = {}) {
    await evaluate(`window.previewTest.render(${JSON.stringify(kind)}, ${JSON.stringify(options)})`);
    await until(`document.querySelector('.card-preview-${kind}') && document.querySelector('[data-panel="content"]')?.textContent.includes('Card text remains visible.')`);
  }
  const button = (tab: string) => `.card-preview [data-quick-settings-tab="${tab}"]`;
  async function expectPopup(tab: string, anchor: string) {
    await until(`document.querySelector('.card-quick-settings')?.dataset.tab === ${JSON.stringify(tab)}`);
    expect(await evaluate(`document.querySelectorAll('.card-quick-settings').length`)).toBe(1);
    expect(await evaluate(`document.querySelector(${JSON.stringify(anchor)}).getAttribute('aria-expanded')`)).toBe('true');
    expect(await evaluate(`document.querySelector('.card-preview-action-rail button').getAttribute('aria-pressed')`)).toBe('false');
    expect(await evaluate(`document.querySelector('.card-properties-slot').hidden`)).toBe(true);
    expect(await evaluate(`document.querySelector('[data-panel="content"]').getBoundingClientRect().height > 0`)).toBe(true);
    expect(await evaluate(`(() => {
      const button = document.querySelector(${JSON.stringify(anchor)}).getBoundingClientRect();
      const popup = document.querySelector('.deck-picker-popover').getBoundingClientRect();
      return Math.abs(popup.left - button.left) <= 32 && (Math.abs(popup.bottom - button.top) <= 9 || Math.abs(popup.top - button.bottom) <= 9);
    })()`)).toBe(true);
  }
  async function expectClosed(anchor: string) {
    await until(`!document.querySelector('.card-quick-settings') && document.activeElement === document.querySelector(${JSON.stringify(anchor)})`);
    expect(await evaluate(`document.querySelector(${JSON.stringify(anchor)}).getAttribute('aria-expanded')`)).toBe('false');
  }

  beforeAll(async () => {
    server = await createServer({ configFile: false, root: process.cwd(), plugins: [tailwindcss(), {
      name: 'quick-settings-fixture', configureServer(vite) {
        vite.middlewares.use((request, response, next) => {
          if (request.url !== '/') return next();
          response.setHeader('Content-Type', 'text/html');
          response.end('<!doctype html><html><body><div id="root"></div><script type="module" src="/tests/fixtures/card-preview-quick-settings.tsx"></script></body></html>');
        });
      },
    }], server: { host: '127.0.0.1', port: 0 },
      // 2026-11-08: crawl the fixture's imports at startup so no late dep re-optimization reloads the page mid-test.
      optimizeDeps: { entries: ['tests/fixtures/card-preview-quick-settings.tsx'] }, logLevel: 'error' });
    await server.listen();
    // 2026-11-08: warm transforms and the dep optimizer before the browser loads the page — a late
    // re-optimization fires a full-reload that wipes the page while the suite is already running.
    await server.warmupRequest('/tests/fixtures/card-preview-quick-settings.tsx').catch(() => {});
    const port = await freePort();
    profile = await mkdtemp(path.join(tmpdir(), 'deckmate-quick-settings-'));
    browser = spawn(browserPath!, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
    let target: string | undefined;
    for (let attempt = 0; attempt < 100 && !target; attempt++) {
      try {
        const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as { type: string; webSocketDebuggerUrl: string }[];
        target = pages.find(page => page.type === 'page')?.webSocketDebuggerUrl;
      } catch { /* Headless browser is starting. */ }
      if (!target) await delay(100);
    }
    if (!target) throw new Error('Browser did not start');
    socket = new WebSocket(target);
    await new Promise(resolve => socket!.addEventListener('open', resolve, { once: true }));
    socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const request = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) request?.reject(new Error(JSON.stringify(message.error)));
        else request?.resolve(message.result);
      }
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    });
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: server.resolvedUrls!.local[0] });
    await until(`Boolean(window.previewTest && document.querySelector('[data-panel="content"]'))`, 600);
  }, 60000);

  afterAll(async () => {
    if (socket?.readyState === WebSocket.OPEN) {
      await send('Browser.close').catch(() => {});
      socket.close();
    }
    if (browser?.pid && browser.exitCode === null) {
      const command = process.platform === 'win32' ? spawn('taskkill', ['/T', '/F', '/PID', String(browser.pid)], { stdio: 'ignore' }) : browser;
      if (process.platform !== 'win32') browser.kill();
      await new Promise(resolve => { if (command.exitCode !== null) resolve(null); else command.once('exit', resolve); });
    }
    await server?.close();
    if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }, 20000);

  it.each(['hero', 'task'])('%s: Effort keeps the text panel, tabs work, Escape restores the clicked anchor', async kind => {
    await render(kind);
    await click(button('effort'));
    await expectPopup('effort', button('effort'));
    const shots = process.env.DECKMATE_QUICK_SETTINGS_SHOTS;
    if (shots) {
      await mkdir(shots, { recursive: true });
      const screenshot = await send('Page.captureScreenshot', { format: 'png' });
      await writeFile(path.join(shots, `quick-${kind}.png`), Buffer.from(screenshot.data, 'base64'));
    }
    await click('[role="tab"][aria-label="Priority"]');
    await expectPopup('priority', button('effort'));
    await key('Escape');
    await expectClosed(button('effort'));
  });

  it.each(['owner', 'priority', 'run', 'milestone', 'deck'])('clicking %s anchors its own tab without switching panels', async tab => {
    await render();
    await click(button(tab));
    await expectPopup(tab, button(tab));
    await key('Escape');
    await expectClosed(button(tab));
  });

  it.each([['e', 'KeyE', 'effort'], ['p', 'KeyP', 'priority'], ['o', 'KeyO', 'owner'], [',', 'Comma', 'run'], ['m', 'KeyM', 'milestone']])('%s shortcut uses the matching preview button', async (character, code, tab) => {
    await render();
    await key(character, code);
    await expectPopup(tab, button(tab));
    await key('Escape');
    await expectClosed(button(tab));
  });

  it.each([{ child: true }, { child: true, journey: true }])('Sub Cards and Journey cards retain Quick Settings: %j', async options => {
    await render('task', options);
    await click(button('effort'));
    await expectPopup('effort', button('effort'));
    await key('Escape');
    await expectClosed(button('effort'));
  });

  it('saves through onEdit with the existing hashes and returns focus after selection', async () => {
    await render();
    await click(button('effort'));
    await click('[role="option"]:last-child');
    await expectClosed(button('effort'));
    expect(await evaluate('window.previewTest.actions')).toEqual([{ action: 'set-card-properties', cardId: 'card:preview',
      sourceHash: 'card-hash', manifestHash: 'manifest-hash', owner: null, priority: 'medium', effort: 8 }]);
  });

  it.each([0, 9])('keeps immediate numeric Effort assignment (%s) without a popup', async amount => {
    await render();
    const point = await evaluate(`(() => { const box = document.querySelector(${JSON.stringify(button('effort'))}).getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; })()`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    await key(String(amount), `Digit${amount}`);
    expect(await evaluate(`document.querySelector('.card-quick-settings') === null`)).toBe(true);
    expect(await evaluate('window.previewTest.actions[0].change')).toEqual({ kind: 'properties', effort: amount });
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
  });

  it('retains the anchor when tabs change and replaces the popup when another property is clicked', async () => {
    await render();
    await click(button('effort'));
    await click(button('owner'));
    await expectPopup('owner', button('owner'));
    expect(await evaluate(`document.querySelector(${JSON.stringify(button('effort'))}).getAttribute('aria-expanded')`)).toBe('false');
    await key('Escape');
    await expectClosed(button('owner'));
  });

  it.each(['effort', 'run', 'milestone'])('keeps %s open and its anchor mounted during an in-flight save', async tab => {
    await render('hero', { holdSave: true });
    await click(button(tab));
    await click('[role="option"]:last-child');
    await key('Escape');
    expect(await evaluate(`document.querySelector('.deck-picker-popover').getAttribute('aria-busy')`)).toBe('true');
    expect(await evaluate(`document.querySelector('.card-preview-action-rail button').disabled`)).toBe(true);
    expect(await evaluate(`document.querySelector(${JSON.stringify(button('owner'))}).disabled`)).toBe(true);
    await evaluate('window.previewTest.finishSave()');
    await expectClosed(button(tab));
  });

  it('leaves the full panel available and shares one popup with its own selectors', async () => {
    await render();
    await click('.card-preview-action-rail button');
    expect(await evaluate(`document.querySelector('.card-properties-slot').hidden`)).toBe(false);
    await click('.card-properties-owner');
    await until(`document.querySelector('.card-quick-settings')?.dataset.tab === 'owner'`);
    await key('Escape');
    await expectClosed('.card-properties-owner');
    expect(await evaluate(`document.querySelector('.card-properties-slot').hidden`)).toBe(false);
    await click(button('effort'));
    await until(`document.querySelector('.card-quick-settings')?.dataset.tab === 'effort'`);
    expect(await evaluate(`document.querySelectorAll('.card-quick-settings').length`)).toBe(1);
    expect(await evaluate(`document.querySelector('.card-properties-slot').hidden`)).toBe(false);
    await key('Escape');
  });

  it.each([{ writable: false }, { pending: true }])('blocks click and keyboard actions while unavailable: %j', async options => {
    await render('task', options);
    await click(button('effort'));
    await key('e', 'KeyE');
    expect(await evaluate(`document.querySelector('.card-quick-settings') === null`)).toBe(true);
  });

  it('blocks Quick Settings while the full properties panel holds an Effort draft', async () => {
    await render();
    await click('.card-preview-action-rail button');
    await evaluate(`document.querySelector('.card-properties-effort-custom input').focus()`);
    await send('Input.insertText', { text: '4' });
    await until(`document.querySelector(${JSON.stringify(button('effort'))}).disabled`);
    await click(button('effort'));
    await evaluate('document.activeElement.blur()');
    await key('e', 'KeyE');
    expect(await evaluate(`document.querySelector('.card-quick-settings') === null`)).toBe(true);
  });

  it('does not expose Effort or Priority for Doc, but still opens Owner', async () => {
    await render('doc');
    expect(await evaluate(`document.querySelector(${JSON.stringify(button('effort'))}) === null`)).toBe(true);
    expect(await evaluate(`document.querySelector(${JSON.stringify(button('priority'))}) === null`)).toBe(true);
    await key('e', 'KeyE');
    expect(await evaluate(`document.querySelector('.card-quick-settings') === null`)).toBe(true);
    await click(button('owner'));
    await expectPopup('owner', button('owner'));
    await key('Escape');
    await expectClosed(button('owner'));
    expect(errors).toEqual([]);
  });

  async function moveOver(selector: string, fraction: number) {
    const point = await evaluate(`(() => { const box = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: box.x + box.width * ${fraction}, y: box.y + box.height / 2 }; })()`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
  }
  async function reflection(selector: string) {
    return evaluate(`(() => {
      const layer = document.querySelector(${JSON.stringify(selector)}).querySelector('.card-material-glare');
      const style = getComputedStyle(layer);
      const card = layer.closest('.deck-card');
      return { opacity: Number(style.opacity), display: style.display, willChange: style.willChange,
        layers: card ? getComputedStyle(card).willChange + ' / ' + getComputedStyle(layer, '::before').willChange : null,
        x: new DOMMatrix(getComputedStyle(layer, '::before').transform).m41 };
    })()`);
  }

  // 2026-11-08: the open card's band glows softly at rest and drifts towards the pointer (author's reference).
  it('.card-preview-material-band keeps a soft glow at rest and drifts towards the pointer', async () => {
    const selector = '.card-preview-material-band';
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
    await render('hero');
    await delay(500);
    const rest = await reflection(selector);
    expect(rest.display).not.toBe('none');
    expect(rest.opacity).toBeCloseTo(.7, 2);
    await moveOver(selector, .15);
    await delay(900);
    const left = await reflection(selector);
    expect(left.opacity).toBeGreaterThan(rest.opacity);
    await moveOver(selector, .85);
    await delay(900);
    const right = await reflection(selector);
    expect(right.x).toBeGreaterThan(left.x);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
    await delay(600);
    const after = await reflection(selector);
    expect(after.opacity).toBeCloseTo(.7, 2);
    expect(after.x).toBeCloseTo(right.x, 1);
  });

  // 2026-11-09: the gold parent bar above a Sub Card carries the open card's soft light, in the metal under its ink.
  it('.card-preview-parent glows softly at rest, brightens under the pointer and keeps the light under its ink', async () => {
    const selector = '.card-preview-parent';
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
    await render('task', { child: true });
    await delay(500);
    const rest = await reflection(selector);
    expect(rest.opacity).toBeCloseTo(.7, 2);
    expect(await evaluate(`getComputedStyle(document.querySelector('${selector} > .card-material-glare')).zIndex`)).toBe('-1');
    await moveOver(selector, .5);
    await delay(600);
    expect((await reflection(selector)).opacity).toBeGreaterThan(rest.opacity);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
    await delay(600);
    expect((await reflection(selector)).opacity).toBeCloseTo(.7, 2);
  });

  // 2026-11-08: the tile ribbon follows the author's reference video: it rests beyond the right edge, sweeps in once,
  // moves against the pointer horizontally (with the tilt) and sweeps back out on leave.
  it.each(['.deck-card-space'])('%s ribbon sweeps in, follows the tilt, holds while paused and sweeps out on leave', async selector => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
    await render('hero');
    await delay(100);
    const rest = await reflection(selector);
    expect(rest.display).not.toBe('none');
    expect(rest.opacity).toBe(1);
    // 2026-11-09: compositing hints never change with hover — layers made and dropped per hover made the ink jump.
    expect(rest.willChange).toBe('auto');
    expect(rest.layers).toMatch(/ \/ auto$/);
    await moveOver(selector, .2);
    await delay(350);
    const left = await reflection(selector);
    expect(left.x).toBeLessThan(rest.x - 60);
    expect([left.willChange, left.layers]).toEqual([rest.willChange, rest.layers]);
    await moveOver(selector, .8);
    await delay(700);
    const right = await reflection(selector);
    expect(right.x).toBeLessThan(left.x - 30);
    await delay(1400);
    expect(await reflection(selector)).toEqual(right);
    await moveOver(selector, .3);
    await delay(350);
    const reversed = await reflection(selector);
    expect(reversed.x).toBeGreaterThan(right.x + 20);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
    await delay(50);
    const leaving = await reflection(selector);
    expect(leaving.x).toBeGreaterThan(reversed.x);
    expect(leaving.x).toBeLessThan(rest.x);
    await delay(600);
    const idle = await reflection(selector);
    expect(idle.x).toBeCloseTo(rest.x, 1);
    expect([idle.willChange, idle.layers]).toEqual([rest.willChange, rest.layers]);
  });

  it.each([[115, 147], [180, 210]])('keeps both ribbon cuts on one diagonal across a %s × %s tile', async (width, height) => {
    await render('task', { child: true });
    await evaluate(`document.querySelector('.deck-card').style.setProperty('--tile-width', '${width}px'); document.querySelector('.deck-card').style.setProperty('--tile-height', '${height}px')`);
    try {
      await moveOver('.deck-card-space', .6);
      await delay(350);
      // The hot cut sits at the middle of a ribbon five band widths long.
      const bands = await evaluate(`['.card-family-trigger', '.deck-card-band'].map(selector => {
        const band = document.querySelector('.deck-card > ' + selector);
        const layer = band.querySelector('.card-material-glare');
        const matrix = new DOMMatrix(getComputedStyle(layer, '::before').transform);
        return { x: band.offsetLeft + layer.offsetLeft + matrix.m41 + layer.clientWidth * 2.5,
          y: band.offsetTop + band.clientTop + layer.offsetTop + layer.clientHeight / 2, slope: matrix.m21 };
      })`);
      const [top, bottom] = bands;
      const slope = Math.tan(22 * Math.PI / 180);
      expect(top.x).toBeGreaterThan(bottom.x);
      for (const band of bands) expect(band.slope).toBeCloseTo(-slope, 5);
      expect(top.x + top.y * slope).toBeCloseTo(bottom.x + bottom.y * slope, 1);
    } finally {
      await evaluate(`document.querySelector('.deck-card').style.removeProperty('--tile-width'); document.querySelector('.deck-card').style.removeProperty('--tile-height')`);
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
    }
  });

  it('shares the ribbon with Sub Card affiliation and keeps checked or disabled tiles at rest', async () => {
    await render('task', { child: true });
    await moveOver('.deck-card-space', .6);
    await delay(350);
    expect((await reflection('.card-family-trigger')).opacity).toBeGreaterThan((await reflection('.deck-card-band')).opacity);
    for (const options of [{ checked: true }, { pending: true }]) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
      await render('hero', options);
      await delay(100);
      const rest = await reflection('.deck-card-space');
      await moveOver('.deck-card-space', .7);
      await delay(350);
      expect((await reflection('.deck-card-space')).x).toBeCloseTo(rest.x, 1);
    }
  });

  it('ignores touch and reduced motion and cancels a pointer frame when leaving immediately', async () => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
    await render('hero');
    await delay(100);
    // The tile's ribbon stays where it rests; the open card's band keeps its resting glow (0.7) instead of reacting.
    const tileRest = (await reflection('.deck-card-space')).x;
    const resting = async (selector: string) => {
      const value = await reflection(selector);
      if (selector === '.deck-card-space') expect(value.x).toBeCloseTo(tileRest, 1);
      else expect(value.opacity).toBeCloseTo(.7, 2);
    };
    for (const selector of ['.deck-card-space', '.card-preview-material-band']) {
      await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'touch', clientX: 80, clientY: 80 })); })()`);
      await delay(450);
      await resting(selector);
      await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse', clientX: 80, clientY: 80 })); el.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse', relatedTarget: document.body })); })()`);
      await delay(450);
      await resting(selector);
    }
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    try {
      // Under reduced motion the ribbon is still the band's material; it stays pinned where it rests.
      await moveOver('.deck-card-space', .8);
      await delay(350);
      expect((await reflection('.deck-card-space')).display).not.toBe('none');
      await resting('.deck-card-space');
      // Under reduced motion the open card's glow is still part of the material; it just stops drifting.
      await moveOver('.card-preview-material-band', .8);
      await delay(50);
      expect((await reflection('.card-preview-material-band')).display).not.toBe('none');
    } finally {
      await send('Emulation.setEmulatedMedia', { features: [] });
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
    }
    expect(errors).toEqual([]);
  });
});
