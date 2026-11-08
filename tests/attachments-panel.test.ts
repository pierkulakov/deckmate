import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
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

// 2026-11-09: exercise the real panel buttons, clipboard failures and short feedback without a DOM shim.
describe.skipIf(!browserPath)('attachment row actions (browser)', () => {
  let server: ViteDevServer | undefined;
  let browser: ChildProcess | undefined;
  let temporary: string | undefined;
  let socket: WebSocket | undefined;
  let sequence = 0;
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  const errors: string[] = [];
  const copyButton = '.attachment-copy-control button';

  function send(method: string, params: object = {}): Promise<any> {
    const id = ++sequence;
    return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); socket!.send(JSON.stringify({ id, method, params })); });
  }
  async function evaluate(expression: string): Promise<any> {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result?.value;
  }
  async function until(expression: string, attempts = 100): Promise<void> {
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (await evaluate(expression)) return;
      await delay(50);
    }
    throw new Error('Timed out: ' + expression + '\n' + errors.join('\n'));
  }
  async function render(options: object = {}) {
    await evaluate(`window.attachmentsTest.render(${JSON.stringify(options)})`);
    await until(`document.querySelectorAll('.attachments-row').length === 3`);
  }
  async function copy(index: number) {
    await evaluate(`document.querySelectorAll(${JSON.stringify(copyButton)})[${index}].click()`);
  }

  beforeAll(async () => {
    temporary = await mkdtemp(path.join(process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Temp', 'opencode') : tmpdir(), 'attachments-panel-test-'));
    server = await createServer({ configFile: false, root: process.cwd(), cacheDir: path.join(temporary, 'vite'),
      plugins: [tailwindcss(), { name: 'attachments-panel-fixture', configureServer(vite) {
        vite.middlewares.use((request, response, next) => {
          if (request.url?.split('?')[0] !== '/') return next();
          response.setHeader('Content-Type', 'text/html');
          response.end('<!doctype html><html><body><div id="root"></div><script type="module" src="/tests/fixtures/attachments-panel.tsx"></script></body></html>');
        });
      } }], server: { host: '127.0.0.1', port: 0 }, optimizeDeps: { entries: ['tests/fixtures/attachments-panel.tsx'] }, logLevel: 'error' });
    await server.listen();
    await server.warmupRequest('/tests/fixtures/attachments-panel.tsx');
    const port = await freePort();
    browser = spawn(browserPath!, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(temporary, 'profile')}`, 'about:blank'], { stdio: 'ignore' });
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
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: server.resolvedUrls!.local[0] });
    await until(`Boolean(window.attachmentsTest) && document.querySelectorAll('.attachments-row').length === 3`, 600);
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
    if (temporary) await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }, 20000);

  it.each([
    { lang: 'en', theme: 'dark', writable: true, label: 'Copy link for the card text', copied: 'Copied' },
    { lang: 'en', theme: 'light', writable: false, label: 'Copy link for the card text', copied: 'Copied' },
    { lang: 'ru', theme: 'dark', writable: false, label: 'Скопировать ссылку для текста', copied: 'Скопировано' },
    { lang: 'ru', theme: 'light', writable: true, label: 'Скопировать ссылку для текста', copied: 'Скопировано' },
  ])('copies image, PDF and missing-file Markdown: $lang/$theme, writable=$writable', async options => {
    await render(options);
    expect(await evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(copyButton)}), button => [button.title, button.getAttribute('aria-label'), button.disabled])`))
      .toEqual(Array.from({ length: 3 }, () => [options.label, options.label, false]));
    expect(await evaluate(`document.querySelectorAll('.attachments-cover, input[type="range"]').length`)).toBe(0);
    for (const index of [0, 1, 2]) {
      await copy(index);
      await until(`document.querySelectorAll('.attachment-copy-feedback')[${index}].textContent.includes(${JSON.stringify(options.copied)})`);
    }
    const base = '../deckmate-assets/cards/ca1d0000-0000-4000-8000-000000000001/';
    expect(await evaluate('window.attachmentsTest.state.copies')).toEqual([
      `![Silhouette \\[v2\\].png](${base}00000000-0000-4000-8000-000000000001.png)`,
      `[Brief.pdf](${base}00000000-0000-4000-8000-000000000002.pdf)`,
      `![Missing.png](${base}00000000-0000-4000-8000-000000000003.png)`,
    ]);
    expect(await evaluate('window.attachmentsTest.state.actions')).toEqual([]);
    expect(await evaluate(`(() => { const panel = document.querySelector('.attachments-panel').getBoundingClientRect();
      return Array.from(document.querySelectorAll('.attachments-row-actions, .attachment-copy-feedback:not(:empty)'), element => {
        const box = element.getBoundingClientRect(); return box.left >= panel.left && box.right <= panel.right;
      }).every(Boolean); })()`)).toBe(true);
    await until(`Array.from(document.querySelectorAll('.attachment-copy-feedback')).every(element => element.textContent.trim() === '')`);
  });

  it('reports clipboard failure without claiming a successful copy', async () => {
    await render({ lang: 'ru' });
    await evaluate('window.attachmentsTest.state.failCopy = true');
    await copy(0);
    await until(`document.querySelector('.attachment-copy-feedback').textContent.includes('Не удалось скопировать')`);
    expect(await evaluate('window.attachmentsTest.state.copies')).toEqual([]);
    expect(await evaluate(`document.querySelector(${JSON.stringify(copyButton)}).hasAttribute('data-copied')`)).toBe(false);
  });

  it('uses the eye for image viewing, even read-only, without writing a cover', async () => {
    await render({ writable: false });
    await evaluate(`document.querySelector('.attachments-row-actions button[title="View Silhouette [v2].png"]').click()`);
    await until(`Boolean(document.querySelector('.attachment-viewer'))`);
    expect(await evaluate('window.attachmentsTest.state.actions')).toEqual([]);
    expect(errors).toEqual([]);
  });
});
