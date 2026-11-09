import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { freePort } from './free-port.ts';
import { waitForPageTarget } from './browser-target.ts';

const browserPath = [process.env.DECKMATE_BROWSER, process.env.BROWSER,
  'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
  .find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// 2026-11-09: exercise pointer transfer with the real Deck and trusted CDP mouse input.
describe.skipIf(!browserPath)('card drag layout (browser)', () => {
  let server: ViteDevServer | undefined;
  let browser: ChildProcess | undefined;
  let temporary: string | undefined;
  let socket: WebSocket | undefined;
  let sequence = 0;
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();

  function send(method: string, params: object = {}): Promise<any> {
    const id = ++sequence;
    return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); socket!.send(JSON.stringify({ id, method, params })); });
  }
  async function evaluate(expression: string): Promise<any> {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result?.value;
  }
  async function until(expression: string, attempts = 200) {
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (await evaluate(`Boolean(${expression})`)) return;
      await delay(50);
    }
    throw new Error('Timed out: ' + expression);
  }
  async function move(point: { x: number; y: number }, buttons: 0 | 1) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point, button: buttons ? 'left' : 'none', buttons, pointerType: 'mouse' });
  }

  beforeAll(async () => {
    temporary = await mkdtemp(path.join(tmpdir(), 'card-drag-layout-test-'));
    server = await createServer({ configFile: false, root: process.cwd(), cacheDir: path.join(temporary, 'vite'),
      plugins: [tailwindcss(), { name: 'card-drag-layout-fixture', configureServer(vite) {
        vite.middlewares.use((request, response, next) => {
          if (request.url?.split('?')[0] !== '/') return next();
          response.setHeader('Content-Type', 'text/html');
          response.end('<!doctype html><html><body><div id="root"></div><script type="module" src="/tests/fixtures/card-drag-layout.tsx"></script></body></html>');
        });
      } }], server: { host: '127.0.0.1', port: 0 }, optimizeDeps: { entries: ['tests/fixtures/card-drag-layout.tsx'] }, logLevel: 'error' });
    await server.listen();
    await server.warmupRequest('/tests/fixtures/card-drag-layout.tsx');
    const port = await freePort();
    browser = spawn(browserPath!, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--disable-features=OverlayScrollbar', `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(temporary, 'profile')}`, 'about:blank'], { stdio: 'ignore' });
    const target = await waitForPageTarget(port, browser!);
    socket = new WebSocket(target);
    await new Promise(resolve => socket!.addEventListener('open', resolve, { once: true }));
    socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data));
      if (!message.id) return;
      const request = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) request?.reject(new Error(JSON.stringify(message.error)));
      else request?.resolve(message.result);
    });
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 800, height: 850, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: server.resolvedUrls!.local[0] });
    await until(`document.querySelector('.card-preview') && document.querySelector('[data-card-id="card:ferry"]')`, 600);
    await delay(300);
  }, 90000);

  afterAll(async () => {
    if (socket?.readyState === WebSocket.OPEN) { await send('Browser.close').catch(() => {}); socket.close(); }
    if (browser?.pid && browser.exitCode === null) {
      const command = process.platform === 'win32' ? spawn('taskkill', ['/T', '/F', '/PID', String(browser.pid)], { stdio: 'ignore' }) : browser;
      if (process.platform !== 'win32') browser.kill();
      await new Promise(resolve => { if (command.exitCode !== null) resolve(null); else command.once('exit', resolve); });
    }
    await server?.close();
    if (temporary) await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }, 20000);

  it('keeps CardPreview and every scroll ancestor stationary from High to the empty part of Low', async () => {
    const contentHeight = await evaluate(`document.querySelector('.workspace-main').scrollHeight`);
    await send('Emulation.setDeviceMetricsOverride', { width: 800, height: contentHeight + 20, deviceScaleFactor: 1, mobile: false });
    await delay(150);
    const points = await evaluate(`(() => {
      const source = document.querySelector('[data-card-id="card:ferry"][data-card-transfer-enabled]').getBoundingClientRect();
      const low = document.querySelector('.catalog-card-group[aria-label="Low"]').getBoundingClientRect();
      return { start: { x: source.x + source.width / 2, y: source.y + source.height / 2 },
        end: { x: low.right - 24, y: low.bottom - 12 } };
    })()`);
    await evaluate(`(() => {
      const preview = document.querySelector('.card-preview');
      const initial = preview.getBoundingClientRect();
      const origins = [preview, document.querySelector('[data-card-id="card:ferry"]'), document.querySelector('.catalog-card-group[aria-label="Low"]')];
      const scrollers = new Set([document.scrollingElement]);
      for (const origin of origins) for (let node = origin?.parentElement; node; node = node.parentElement) scrollers.add(node);
      const scrollInitial = [...scrollers].map(element => [element, element?.scrollLeft ?? 0, element?.scrollTop ?? 0]);
      const recorder = window.dragLayoutRecorder = { maximum: 0, scrollMaximum: 0, initial: initial.toJSON(), worst: null, running: true,
        initialWorkspace: { width: document.querySelector('.workspace-main').clientWidth, gutter: getComputedStyle(document.querySelector('.workspace-main')).scrollbarGutter } };
      const sample = () => {
        if (!recorder.running) return;
        const box = preview.getBoundingClientRect();
        for (const key of ['left', 'top', 'width', 'height']) {
          const delta = Math.abs(box[key] - initial[key]);
          if (delta > recorder.maximum) { recorder.maximum = delta; recorder.worst = { key, before: initial[key], after: box[key] }; }
        }
        for (const [element, left, top] of scrollInitial) {
          if (!element) continue;
          recorder.scrollMaximum = Math.max(recorder.scrollMaximum, Math.abs(element.scrollLeft - left), Math.abs(element.scrollTop - top));
        }
        requestAnimationFrame(sample);
      };
      sample();
    })()`);
    await move(points.start, 0);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...points.start, button: 'left', buttons: 1, clickCount: 1, pointerType: 'mouse' });
    for (let step = 1; step <= 16; step++) {
      await move({ x: points.start.x + (points.end.x - points.start.x) * step / 16,
        y: points.start.y + (points.end.y - points.start.y) * step / 16 }, 1);
      await delay(25);
    }
    await until(`document.querySelector('.catalog-card-group[aria-label="Low"]').classList.contains('is-drop-over')`);
    await delay(250);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...points.end, button: 'left', buttons: 0, clickCount: 1, pointerType: 'mouse' });
    await until(`document.querySelector('.catalog-card-group[aria-label="Low"] [data-card-id="card:ferry"]')`);
    await delay(500);
    const result = await evaluate(`(() => { const recorder = window.dragLayoutRecorder; recorder.running = false;
      return { maximum: recorder.maximum, scrollMaximum: recorder.scrollMaximum, initial: recorder.initial, initialWorkspace: recorder.initialWorkspace, worst: recorder.worst,
        final: document.querySelector('.card-preview').getBoundingClientRect().toJSON(),
        workspace: { width: document.querySelector('.workspace-main').clientWidth, scrollWidth: document.querySelector('.workspace-main').scrollWidth,
          height: document.querySelector('.workspace-main').clientHeight, scrollHeight: document.querySelector('.workspace-main').scrollHeight } }; })()`);
    expect(result.workspace.scrollHeight, JSON.stringify(result)).toBeGreaterThan(result.workspace.height);
    expect(result.scrollMaximum, JSON.stringify(result)).toBeLessThanOrEqual(1);
    expect(result.maximum, JSON.stringify(result)).toBeLessThanOrEqual(1);
  }, 20000);
});
