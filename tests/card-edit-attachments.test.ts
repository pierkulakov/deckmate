import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
const initial = 'Attachment test\n\nBefore AFTER';
const image = '![Sketch \\[v2\\].png](../deckmate-assets/cards/example/sketch.png)';
const pdf = '[Brief.pdf](../deckmate-assets/cards/example/brief.pdf)';

// Native focus, undo and the asynchronous Radix menu need the same browser editing path as the application.
describe.skipIf(!browserPath)('card attachment insertion (headless CDP)', () => {
  let server: ViteDevServer | undefined;
  let browser: ChildProcess | undefined;
  let temporary: string | undefined;
  let socket: WebSocket | undefined;
  let sequence = 0;
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  const errors: string[] = [];
  function send(method: string, params: object = {}): Promise<any> {
    return new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket!.send(JSON.stringify({ id, method, params })); });
  }
  async function evaluate(expression: string): Promise<any> {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result?.value;
  }
  async function until(expression: string, attempts = 100) {
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (await evaluate(expression)) return;
      await delay(50);
    }
    throw new Error('Timed out: ' + expression + '\n' + errors.join('\n'));
  }
  async function key(key: string, modifiers = 0) {
    const codes: Record<string, number> = { Enter: 13, Escape: 27, ArrowDown: 40, ArrowUp: 38, Home: 36, End: 35, z: 90, ' ': 32 };
    for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', {
      type, key, code: key === ' ' ? 'Space' : key, modifiers, windowsVirtualKeyCode: codes[key],
      text: type === 'keyDown' && key === 'Enter' ? '\r' : undefined,
    });
    await delay(40);
  }
  async function edit(options: object = {}) {
    await evaluate(`window.attachmentEditorTest.render(${JSON.stringify(options)})`);
    await until(`Boolean(document.querySelector('.card-content-edit-action:not(:disabled)'))`);
    await evaluate(`document.querySelector('.card-content-edit-action').click()`);
    await until(`Boolean(document.querySelector('.card-edit-text'))`);
  }
  async function open(keyName = 'Enter') {
    await evaluate(`document.querySelector('.card-edit-insert').focus()`);
    await key(keyName);
    await until(`Boolean(document.querySelector('.card-edit-attachments'))`);
  }
  async function selection(start: number, end = start) {
    await evaluate(`(() => { const text = document.querySelector('.card-edit-text'); text.focus(); text.setSelectionRange(${start}, ${end}); })()`);
  }
  const value = () => evaluate(`document.querySelector('.card-edit-text').value`);
  const highlighted = () => evaluate(`document.querySelector('.card-edit-attachment[data-highlighted]')?.textContent`);

  beforeAll(async () => {
    temporary = await mkdtemp(path.join(tmpdir(), 'attachment-editor-test-'));
    server = await createServer({ configFile: false, root: process.cwd(), cacheDir: path.join(temporary, 'vite'),
      plugins: [tailwindcss(), { name: 'attachment-editor-fixture', configureServer(vite) {
        vite.middlewares.use((request, response, next) => {
          if (request.url !== '/') return next();
          response.setHeader('Content-Type', 'text/html');
          response.end('<!doctype html><html><body><div id="root"></div><script type="module" src="/tests/fixtures/card-edit-attachments.tsx"></script></body></html>');
        });
      } }], server: { host: '127.0.0.1', port: 0 }, optimizeDeps: { entries: ['tests/fixtures/card-edit-attachments.tsx'] }, logLevel: 'error' });
    await server.listen();
    await server.warmupRequest('/tests/fixtures/card-edit-attachments.tsx');
    const port = await freePort();
    browser = spawn(browserPath!, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(temporary, 'profile')}`, 'about:blank'], { stdio: 'ignore' });
    let target: string | undefined;
    for (let attempt = 0; attempt < 100 && !target; attempt++) {
      try {
        const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as { type: string; webSocketDebuggerUrl: string }[];
        target = pages.find(page => page.type === 'page')?.webSocketDebuggerUrl;
      } catch { /* Browser is starting. */ }
      if (!target) await delay(100);
    }
    if (!target) throw new Error('Browser did not start');
    socket = new WebSocket(target);
    await new Promise(resolve => socket!.addEventListener('open', resolve, { once: true }));
    socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const request = pending.get(message.id); pending.delete(message.id);
        if (message.error) request?.reject(new Error(JSON.stringify(message.error))); else request?.resolve(message.result);
      }
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    });
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Page.navigate', { url: server.resolvedUrls!.local[0] });
    await until('Boolean(window.attachmentEditorTest)', 600);
  }, 60000);

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

  beforeEach(async () => { await edit(); });

  it('inserts an image at the caret, restores focus, marks the draft dirty, and supports undo', async () => {
    const caret = initial.indexOf('AFTER');
    await selection(caret);
    await open();
    await until(`document.querySelectorAll('.card-edit-attachment').length === 2`);
    await key('ArrowDown');
    expect(await highlighted()).toContain('Sketch [v2].png');
    expect(await highlighted()).toContain('image/png · 2 KB');
    await key('Enter');
    await until(`document.activeElement?.classList.contains('card-edit-text')`);
    expect(await value()).toBe(initial.slice(0, caret) + image + initial.slice(caret));
    expect(await evaluate('document.activeElement.selectionStart')).toBe(caret + image.length);
    expect(await evaluate('document.activeElement.selectionEnd')).toBe(caret + image.length);
    expect(await evaluate('window.attachmentEditorTest.dirty.at(-1)')).toBe(true);
    expect(await evaluate('window.attachmentEditorTest.saves')).toEqual([]);
    await key('z', 2);
    await until(`document.querySelector('.card-edit-text').value === ${JSON.stringify(initial)}`);
    expect(await evaluate('window.attachmentEditorTest.dirty.at(-1)')).toBe(false);
  });

  it('replaces the selection with a PDF link, previews it, and saves through the normal editor', async () => {
    const start = initial.indexOf('Before');
    await selection(start, start + 6);
    await open('ArrowDown');
    await until(`document.querySelectorAll('.card-edit-attachment').length === 2`);
    await key('ArrowDown'); await key('ArrowDown'); await key('ArrowUp'); await key('ArrowDown');
    expect(await highlighted()).toContain('Brief.pdf');
    await key('Enter');
    await until(`document.activeElement?.classList.contains('card-edit-text')`);
    expect(await value()).toBe(initial.slice(0, start) + pdf + initial.slice(start + 6));
    await evaluate(`document.querySelector('.card-edit-footer button').click()`);
    await until(`Boolean(document.querySelector('.card-edit-preview a'))`);
    expect(await evaluate(`document.querySelector('.card-edit-preview a').getAttribute('href')`)).toBe('/api/file?source=sandbox&path=tasks%2Fdeckmate-assets%2Fcards%2Fexample%2Fbrief.pdf');
    expect(await evaluate(`document.querySelector('.card-edit-preview a').target`)).toBe('_blank');
    expect(await evaluate(`document.querySelector('.card-edit-insert').disabled`)).toBe(true);
    await evaluate(`document.querySelector('.card-edit-save').click()`);
    await until(`!document.querySelector('.card-edit-text') && window.attachmentEditorTest.saves.length === 1`);
    expect(await evaluate('window.attachmentEditorTest.saves[0]')).toMatchObject({ action: 'update-card-content', markdown: pdf + ' AFTER', sourceHash: 'original', manifestHash: 'manifest' });
  });

  it.each(['en', 'ru'])('shows the empty state in %s and Escape returns the original caret without cancelling', async lang => {
    await edit({ lang, source: 'live' });
    await evaluate('window.attachmentEditorTest.files = []');
    await selection(20);
    await open(' ');
    await until(`document.querySelector('.card-edit-attachments [role="status"]')?.textContent.includes(${JSON.stringify(lang === 'ru' ? 'Вложений нет' : 'No attachments')})`);
    expect(await evaluate(`document.querySelector('.card-edit-attachments').textContent`)).toContain(lang === 'ru'
      ? 'Вложений нет — добавьте их в панели вложений' : 'No attachments — add them in the attachments panel');
    expect(await evaluate('window.attachmentEditorTest.requests')).toEqual(['/api/attachments?source=live&cardId=card%3Aattachment-test']);
    await key('Escape');
    await until(`document.activeElement?.classList.contains('card-edit-text')`);
    expect(await value()).toBe(initial);
    expect(await evaluate('document.activeElement.selectionStart')).toBe(20);
    expect(await evaluate('window.attachmentEditorTest.dirty.at(-1)')).toBe(false);
  });

  it('retries a failed request and reloads the list after attachments change', async () => {
    await evaluate('window.attachmentEditorTest.failure = true');
    await open();
    await until(`Boolean(document.querySelector('.card-edit-attachments [role="alert"]'))`);
    await evaluate('window.attachmentEditorTest.failure = false');
    await key('ArrowDown'); await key('Enter');
    await until(`document.querySelectorAll('.card-edit-attachment').length === 2`);
    await key('Escape');
    await until(`document.activeElement?.classList.contains('card-edit-text')`);
    await evaluate('window.attachmentEditorTest.files = []');
    await open();
    await until(`document.querySelector('.card-edit-attachments').textContent.includes('No attachments')`);
    expect(await evaluate('window.attachmentEditorTest.requests.length')).toBe(3);
    await key('Escape');
    expect(errors).toEqual([]);
  });
});
