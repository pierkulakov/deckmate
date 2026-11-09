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

// 2026-11-08: the Inbox contract touches real selects, checkboxes and covers; drive the fixture page over CDP
// like card-preview-quick-settings does, without a filesystem write or a built dist/.
describe.skipIf(!browserPath)('Inbox flows (browser)', () => {
  let server: ViteDevServer | undefined;
  let browser: ChildProcess | undefined;
  let profile: string | undefined;
  let cache: string | undefined;
  let socket: WebSocket | undefined;
  let sequence = 0;
  let executionContextId: number | undefined;
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
  // 2026-11-09: values cross into the page as callFunctionOn arguments, not as text baked into the evaluated code
  // (CodeQL js/bad-code-sanitization flags JSON.stringify interpolation).
  async function callFunction(functionDeclaration: string, ...args: unknown[]): Promise<any> {
    const result = await send('Runtime.callFunctionOn', { functionDeclaration, executionContextId,
      arguments: args.map(value => ({ value })), returnByValue: true, awaitPromise: true });
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
  async function click(selector: string) {
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    await delay(60);
  }
  async function type(selector: string, text: string) {
    await callFunction(`(selector, text) => { const field = document.querySelector(selector);
      const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(field, text);
      field.dispatchEvent(new Event('input', { bubbles: true })); }`, selector, text);
    await delay(60);
  }
  async function key(key: string, code: number) {
    for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode: code });
  }

  beforeAll(async () => {
    // A private dep cache: two Vite servers over the shared node_modules/.vite invalidate each other's
    // optimized deps (504 Outdated Optimize Dep) when test files run in parallel workers.
    cache = await mkdtemp(path.join(tmpdir(), 'deckmate-inbox-vite-'));
    server = await createServer({ configFile: false, root: process.cwd(), cacheDir: cache, plugins: [tailwindcss(), {
      name: 'inbox-flows-fixture', configureServer(vite) {
        vite.middlewares.use((request, response, next) => {
          if (request.url !== '/') return next();
          response.setHeader('Content-Type', 'text/html');
          response.end('<!doctype html><html><body><div id="root"></div><script type="module" src="/tests/fixtures/inbox-flows.tsx"></script></body></html>');
        });
      },
    }], server: { host: '127.0.0.1', port: 0 },
      // 2026-11-08: crawl the fixture's imports at startup so no late dep re-optimization reloads the page mid-test.
      optimizeDeps: { entries: ['tests/fixtures/inbox-flows.tsx'] }, logLevel: 'error' });
    await server.listen();
    // Warm transforms and the dep optimizer before the browser loads the page: a late re-optimization
    // fires a full-reload that wipes the page mid-test.
    await server.warmupRequest('/tests/fixtures/inbox-flows.tsx').catch(() => {});
    const port = await freePort();
    profile = await mkdtemp(path.join(tmpdir(), 'deckmate-inbox-flows-'));
    browser = spawn(browserPath!, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--disable-features=OverlayScrollbar', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
    const target = await waitForPageTarget(port, browser!);
    socket = new WebSocket(target);
    await new Promise(resolve => socket!.addEventListener('open', resolve, { once: true }));
    socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data));
      if (message.method === 'Runtime.executionContextCreated' && message.params.context.auxData?.isDefault)
        executionContextId = message.params.context.id;
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
    await send('Page.navigate', { url: server.resolvedUrls!.local[0] });
    // A cold dep optimizer can invalidate the first load's module URLs (504 Outdated Optimize Dep);
    // once it settles, one reload brings the page up.
    try { await until(`Boolean(window.inboxTest && document.querySelector('.card-family-composer'))`, 100); }
    catch { await send('Page.reload'); await until(`Boolean(window.inboxTest && document.querySelector('.card-family-composer'))`, 600); }
  }, 90000);

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
    if (cache) await rm(cache, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }, 20000);

  it('creates a Sub Card with deckId null when no deck takes Tasks', async () => {
    await evaluate(`window.inboxTest.render('family', { decks: [{ id: 'deck:art', title: 'Concepts', kind: 'asset' }] })`);
    await until(`Boolean(document.querySelector('.card-family-composer-deck select option[value=""]'))`);
    expect(await evaluate(`document.querySelector('.card-family-composer-deck select option[value=""]').textContent`)).toBe('No deck (Unassigned)');
    expect(await evaluate(`document.querySelector('.card-family-composer-deck select').value`)).toBe('');
    expect(await evaluate(`document.querySelector('.card-family-composer-error') === null`)).toBe(true);
    await type('.card-family-composer-content textarea', 'Art pass\nDescribe the pass');
    await click('.card-family-composer footer button[type="submit"]');
    await until('window.inboxTest.actions.length === 1');
    expect(await evaluate('window.inboxTest.actions[0]')).toMatchObject({ action: 'create-card', deckId: null, kind: 'task', parentId: 'card:hero' });
    expect(await evaluate('window.inboxTest.created[0].deckId')).toBe('');
  });

  it('offers the Inbox by name as the automatic choice and lands the card in it', async () => {
    await evaluate(`window.inboxTest.render('family', { decks: [{ id: 'deck:art', title: 'Concepts', kind: 'asset' }, { id: 'deck:trips', title: 'Trips', kind: 'task' }], inboxDeckId: 'deck:trips', recent: [] })`);
    await until(`Boolean(document.querySelector('.card-family-composer-deck select option[value=""]'))`);
    expect(await evaluate(`document.querySelector('.card-family-composer-deck select option[value=""]').textContent`)).toBe('Auto: Inbox → Trips');
    expect(await evaluate(`document.querySelector('.card-family-composer-deck select').value`)).toBe('');
    await type('.card-family-composer-content textarea', 'Trips task');
    await click('.card-family-composer footer button[type="submit"]');
    await until('window.inboxTest.actions.length === 1');
    expect(await evaluate('window.inboxTest.actions[0]')).toMatchObject({ action: 'create-card', deckId: null, kind: 'task' });
    expect(await evaluate('window.inboxTest.created[0].deckId')).toBe('deck:trips');
  });

  it('prefers the last used deck over the automatic choice', async () => {
    await evaluate(`window.inboxTest.render('family', { decks: [{ id: 'deck:art', title: 'Concepts', kind: 'asset' }, { id: 'deck:trips', title: 'Trips', kind: 'task' }, { id: 'deck:sound', title: 'Sound', kind: 'task' }], inboxDeckId: 'deck:trips', recent: ['deck:sound'] })`);
    await until(`Boolean(document.querySelector('.card-family-composer-deck select'))`);
    expect(await evaluate(`document.querySelector('.card-family-composer-deck select').value`)).toBe('deck:sound');
  });

  it('marks the Inbox deck cover with a labelled tray and leaves other covers clean', async () => {
    await evaluate(`window.inboxTest.render('cover', { inbox: true })`);
    await until(`Boolean(document.querySelector('.catalog-cover-kind-badge.is-inbox'))`);
    expect(await evaluate(`document.querySelector('.catalog-cover-kind-badge.is-inbox').getAttribute('aria-label')`)).toBe('Inbox: cards with no deck chosen go here');
    expect(await evaluate(`document.querySelector('.catalog-cover-kind-badge.is-inbox').getAttribute('title')`)).toBe('Inbox: cards with no deck chosen go here');
    await evaluate(`window.inboxTest.render('cover', { inbox: false })`);
    await until(`!document.querySelector('.catalog-cover-kind-badge.is-inbox')`);
    expect(await evaluate(`document.querySelectorAll('.catalog-cover-kind-badge').length`)).toBe(1);
  });

  it('disables the Inbox checkbox for an Asset deck and keeps it live for a Task deck', async () => {
    await evaluate(`window.inboxTest.render('settings', { deckKind: 'asset' })`);
    await until(`Boolean(document.querySelector('.deck-settings-inbox input'))`);
    expect(await evaluate(`document.querySelector('.deck-settings-inbox input').disabled`)).toBe(true);
    expect(await evaluate(`document.querySelector('.deck-settings-inbox span').textContent`)).toBe('Inbox must take Tasks: Task or Mixed decks only');
    expect(await evaluate(`Boolean(document.querySelector('.deck-settings-more .deck-settings-inbox'))`)).toBe(false);
    await evaluate(`window.inboxTest.render('settings', { deckKind: 'task', inboxDeckId: 'deck:one' })`);
    await until(`document.querySelector('.deck-settings-inbox input')?.checked`);
    expect(await evaluate(`document.querySelector('.deck-settings-inbox input').disabled`)).toBe(false);
    expect(await evaluate(`document.querySelector('.deck-settings-inbox span').textContent`)).toBe('Cards with no deck selected go here. This setting saves immediately.');
  });

  it.each([[375, 812], [1280, 800]])('keeps gallery and space-form overflow inside the workspace at %i × %i (D01, D02)', async (width, height) => {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await evaluate(`window.inboxTest.render('gallery')`);
    await until(`document.querySelectorAll('.catalog-cover-item').length === 8 && !document.querySelector('.project-pulse-loading')`);
    const dimensions = `({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight })`;
    expect(await evaluate(dimensions)).toEqual({ width, height });
    await click('.deck-gallery-add');
    await until(`document.activeElement === document.querySelector('.space-preset-form input') && document.querySelector('.space-preset-form').getBoundingClientRect().top < innerHeight - 100`);
    expect(await evaluate(dimensions)).toEqual({ width, height });
    await evaluate(`window.scrollTo({ top: 10000, left: 10000, behavior: 'instant' })`);
    expect(await evaluate(`({ x: scrollX, y: scrollY })`)).toEqual({ x: 0, y: 0 });
    await key('Escape', 27);
    await until(`!document.querySelector('.space-preset-form') && document.activeElement.matches('.deck-gallery-add')`);
    await click('.deck-gallery-add');
    await click('.space-preset-option input[value="custom"]');
    await type('.space-custom-fields input', 'Unsaved space');
    await key('Escape', 27);
    await delay(100);
    expect(await evaluate(`document.querySelector('.space-custom-fields input')?.value`)).toBe('Unsaved space');
    expect(await evaluate(dimensions)).toEqual({ width, height });
  });

  it('shows the first-project action before the pulse within the mobile viewport (D03)', async () => {
    await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: false });
    await evaluate(`window.inboxTest.render('gallery', { empty: true })`);
    await until(`Boolean(document.querySelector('.project-template-start')) && !document.querySelector('.project-pulse-loading')`);
    expect(await evaluate(`(() => { const start = document.querySelector('.project-template-start').getBoundingClientRect(); return start.top >= 0 && start.bottom <= innerHeight && start.bottom <= document.querySelector('.project-pulse').getBoundingClientRect().top; })()`)).toBe(true);
  });

  it('shows a clipped cover name on keyboard focus and hover, but not a short name (D09)', async () => {
    const title = 'Подготовка персонажей и предметов для первого релиза';
    await evaluate(`window.inboxTest.render('cover', { title: ${JSON.stringify(title)} })`);
    await until(`Boolean(document.querySelector('.catalog-deck-cover'))`);
    await evaluate('document.fonts.ready');
    await key('Tab', 9);
    await until(`Boolean(document.querySelector('[role="tooltip"]'))`);
    expect(await evaluate(`document.querySelector('[role="tooltip"]').textContent`)).toBe(title);
    await key('Escape', 27);
    await until(`!document.querySelector('[role="tooltip"]')`);
    const point = await evaluate(`(() => { const r = document.querySelector('.catalog-deck-cover').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    await until(`Boolean(document.querySelector('[role="tooltip"]'))`);
    expect(await evaluate(`document.querySelector('[role="tooltip"]').textContent`)).toBe(title);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });
    await evaluate(`window.inboxTest.render('cover')`);
    await until(`document.querySelector('.catalog-cover-title')?.textContent === 'Trips'`);
    await key('Tab', 9);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    await delay(450);
    expect(await evaluate(`Boolean(document.querySelector('[role="tooltip"]'))`)).toBe(false);
  });

  it('keeps the fixture free of page errors', () => {
    expect(errors).toEqual([]);
  });
});
