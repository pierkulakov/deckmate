import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { freePort } from './free-port.ts';
import { closeBrowserGently, waitForPageTarget } from './browser-target.ts';
import { version } from '../package.json';

const browserPath = [process.env.DECKMATE_BROWSER, process.env.BROWSER,
  'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
  .find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe.skipIf(!browserPath)('application shell (browser)', () => {
  let server: ViteDevServer | undefined;
  let browser: ChildProcess | undefined;
  let temporary: string | undefined;
  let socket: WebSocket | undefined;
  let sequence = 0;
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  const errors: string[] = [];

  function send(method: string, params: object = {}): Promise<any> {
    const id = ++sequence;
    return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); socket!.send(JSON.stringify({ id, method, params })); });
  }
  async function evaluate(expression: string): Promise<any> {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result?.value;
  }
  async function until(expression: string, attempts = 150) {
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (await evaluate(expression)) return;
      await delay(50);
    }
    throw new Error('Timed out: ' + expression + '\n' + errors.join('\n'));
  }
  async function click(selector: string) {
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    await delay(80);
  }
  async function key(key: string) {
    for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode: key === 'Escape' ? 27 : 13, text: type === 'keyDown' && key === 'Enter' ? '\r' : undefined });
    await delay(100);
  }
  async function render(scene = 'app', options: object = {}, width = 375) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: width === 375 ? 812 : 800, deviceScaleFactor: 1, mobile: false });
    await evaluate(`window.shellTest.render(${JSON.stringify(scene)}, ${JSON.stringify(options)})`);
    await until(scene === 'bulk' ? `Boolean(document.querySelector('.bulk-actions'))` : `Boolean(document.querySelector('.global-search-field input') && document.querySelector('.catalog-view, .planning-view'))`);
    await evaluate('document.fonts.ready');
  }
  async function workspace(options: object = {}, width = 1280) {
    await render('app', { workspace: true, ...options }, width);
    await click('.mission-control-trigger');
    await until(`Boolean(document.querySelector('.mission-control-workspace-add:not(:disabled)'))`);
    await evaluate(`Promise.all(document.querySelector('.mission-control').getAnimations().map(animation => animation.finished))`);
  }
  async function addMenu() {
    await evaluate(`document.querySelector('.mission-control-workspace-add').focus()`);
    await key('Enter');
    await until(`Boolean(document.querySelector('.mission-control-workspace-menu'))`);
    await until(`Boolean(document.activeElement.closest('.mission-control-workspace-menu'))`);
  }
  async function menuItem(label: string) {
    await evaluate(`[...document.querySelectorAll('.mission-control-workspace-menu [role="menuitem"]')].find(e => e.textContent.trim() === ${JSON.stringify(label)}).click()`);
    await delay(100);
  }
  async function altMove(direction: 'ArrowUp' | 'ArrowDown') {
    for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: direction, code: direction, modifiers: 1, windowsVirtualKeyCode: direction === 'ArrowUp' ? 38 : 40 });
    await delay(100);
  }

  beforeAll(async () => {
    const base = tmpdir();
    temporary = await mkdtemp(path.join(base, 'deckmate-shell-test-'));
    server = await createServer({ configFile: false, root: process.cwd(), define: { __DECKMATE_VERSION__: JSON.stringify(version) }, cacheDir: path.join(temporary, 'vite'), plugins: [tailwindcss(), {
      name: 'shell-ui-fixture', configureServer(vite) {
        vite.middlewares.use((request, response, next) => {
          if (!request.url?.startsWith('/?') && request.url !== '/') return next();
          response.setHeader('Content-Type', 'text/html');
          response.end('<!doctype html><html><body><div id="root"></div><script type="module" src="/tests/fixtures/shell-ui.tsx"></script></body></html>');
        });
      },
    }], server: { host: '127.0.0.1', port: 0 }, optimizeDeps: { entries: ['tests/fixtures/shell-ui.tsx'] }, logLevel: 'error' });
    await server.listen();
    await server.warmupRequest('/tests/fixtures/shell-ui.tsx').catch(() => {});
    const port = await freePort();
    browser = spawn(browserPath!, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-features=OverlayScrollbar',
      `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(temporary, 'chrome')}`, 'about:blank'], { stdio: 'ignore' });
    const target = await waitForPageTarget(port, browser!);
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
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Page.navigate', { url: server.resolvedUrls!.local[0] });
    try { await until(`Boolean(window.shellTest && document.querySelector('.global-tabs'))`); }
    catch { await send('Page.reload'); await until(`Boolean(window.shellTest && document.querySelector('.global-tabs'))`, 600); }
  }, 90000);

  afterAll(async () => {
    if (socket?.readyState === WebSocket.OPEN) { await closeBrowserGently(send); socket.close(); }
    if (browser?.pid && browser.exitCode === null) {
      const command = process.platform === 'win32' ? spawn('taskkill', ['/T', '/F', '/PID', String(browser.pid)], { stdio: 'ignore' }) : browser;
      if (process.platform !== 'win32') browser.kill();
      await new Promise(resolve => { if (command.exitCode !== null) resolve(null); else command.once('exit', resolve); });
    }
    await server?.close();
    if (temporary) await rm(temporary, { recursive: true, force: true, maxRetries: 15, retryDelay: 100 });
  }, 20000);

  it.each(['en', 'ru'])('%s: phone tabs and Timeline search keep their complete labels', async lang => {
    await render('app', { lang, view: 'timeline' });
    await until(`document.querySelectorAll('.timeline-actions button').length === 3`);
    expect(await evaluate(`(() => {
      const canvas=document.createElement('canvas').getContext('2d');
      return [...document.querySelectorAll('.global-tabs button'), document.querySelector('.global-search-field input')].every(e => {
        const s=getComputedStyle(e); canvas.font=s.font;
        return canvas.measureText(e.placeholder ?? e.textContent).width <= e.clientWidth-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight);
      });
    })()`)).toBe(true);
    expect(await evaluate(`document.querySelector('.global-tabs').scrollWidth <= document.querySelector('.global-tabs').clientWidth`)).toBe(true);
  });

  it.each([375, 1280])('D11/D12: menu and recent paths fit %s px in both themes and languages', async width => {
    for (const theme of ['light', 'dark']) for (const lang of ['ru', 'en']) {
      await render('app', { theme, lang }, width);
      await click('.mission-control-trigger');
      await until(`document.querySelectorAll('.mission-control-recent-path').length === 2`);
      await delay(300);
      expect(await evaluate(`document.querySelector('.mission-control').getBoundingClientRect().width`)).toBe(width === 375 ? 375 : 336);
      expect(await evaluate(`[...document.querySelectorAll('.mission-control-recent-path')].every(e => {
        const r=e.getBoundingClientRect(); const time=e.previousElementSibling.querySelector('time').getBoundingClientRect();
        const name=e.previousElementSibling.querySelector('strong').getBoundingClientRect();
        return time.bottom <= r.top + 4 && Math.abs(time.top-name.top) < 5 && time.right <= e.parentElement.getBoundingClientRect().right + .5;
      })`)).toBe(true);
      expect(await evaluate(`document.querySelector('.mission-control-recent-path').textContent.endsWith('первого-релиза')`)).toBe(true);
    }
  });

  it('keeps five full-width recent rows without scrolling and preserves width when a sixth is added', async () => {
    await render('app', { lang: 'ru' });
    await click('.mission-control-trigger');
    await until(`document.querySelectorAll('.mission-control-recent-row').length === 2`);
    expect(await evaluate(`(() => {
      const list = document.querySelector('.mission-control-recent-list');
      const current = document.querySelector('.mission-control-project > .mission-control-project-row');
      while (list.children.length < 5) list.append(list.firstElementChild.cloneNode(true));
      const width = list.querySelector('button').getBoundingClientRect().width;
      const fits = list.scrollHeight === list.clientHeight && width === current.getBoundingClientRect().width;
      list.append(list.firstElementChild.cloneNode(true));
      return fits && list.scrollHeight > list.clientHeight && list.querySelector('button').getBoundingClientRect().width === width;
    })()`)).toBe(true);
  });

  it.each([375, 1280])('workspace: localized rows, version and actions fit %s px in both themes', async width => {
    for (const theme of ['light', 'dark']) for (const lang of ['ru', 'en']) {
      await workspace({ theme, lang }, width);
      expect(await evaluate(`document.querySelector('.mission-control-version').textContent`)).toBe(`v${version}`);
      expect(await evaluate(`document.querySelector('.mission-control-workspace h3').textContent`)).toBe(lang === 'ru' ? 'Рабочее пространство' : 'Workspace');
      expect(await evaluate(`document.querySelectorAll('.mission-control-workspace-row').length`)).toBe(4);
      expect(await evaluate(`(() => {
        const panel = document.querySelector('.mission-control');
        const current = document.querySelector('.mission-control-project > .mission-control-project-row');
        const tile = current.querySelector('.mission-control-recent-tile').getBoundingClientRect();
        return panel.scrollWidth <= panel.clientWidth && [...document.querySelectorAll('.mission-control-workspace-row')].every(row => {
          const r = row.getBoundingClientRect(), t = row.querySelector('.mission-control-recent-tile').getBoundingClientRect();
          return Math.abs(r.width - current.getBoundingClientRect().width) < 1 && t.left === tile.left && row.scrollWidth <= row.clientWidth;
        });
      })()`)).toBe(true);
      await evaluate(`document.querySelector('.mission-control-workspace-open').focus()`);
      await delay(180);
      expect(await evaluate(`getComputedStyle(document.querySelector('.mission-control-workspace-remove')).opacity`)).toBe('1');
      await click('.mission-control-workspace-open[aria-current="true"]');
      expect(await evaluate('window.shellTest.workspaceCalls')).toEqual([]);
    }
  });

  it('workspace: empty state adds current, dialog and recent projects only on request', async () => {
    await workspace({ workspace: [] });
    expect(await evaluate(`document.querySelector('.mission-control-workspace-empty').textContent`)).toBe('Pin the projects you work on and switch between them in one click.');
    expect(await evaluate('window.shellTest.workspaceCalls')).toEqual([]);
    await addMenu();
    await menuItem('Add current project');
    await until(`document.querySelectorAll('.mission-control-workspace-row').length === 1`);
    await addMenu();
    expect(await evaluate(`document.querySelector('.mission-control-workspace-menu').textContent.includes('Add current project')`)).toBe(false);
    await menuItem('Choose folder…');
    await until(`document.querySelectorAll('.mission-control-workspace-row').length === 2`);
    await addMenu();
    await until(`Boolean(document.querySelector('.mission-control-workspace-recent'))`);
    await evaluate(`[...document.querySelectorAll('.mission-control-workspace-recent')].find(e => e.textContent.includes('Field Notes')).click()`);
    await until(`document.querySelectorAll('.mission-control-workspace-row').length === 3`);
    expect(await evaluate('window.shellTest.workspaceCalls')).toEqual([
      { method: 'add', args: [{ kind: 'current' }] }, { method: 'add', args: [{ kind: 'dialog' }] },
      { method: 'add', args: [{ kind: 'recent', path: 'C:\\Work\\Field Notes' }] },
    ]);
    expect(await evaluate(`document.querySelector('.mission-control-workspace-empty') === null`)).toBe(true);
    expect(await evaluate(`document.querySelector('.mission-control-workspace-menu') === null`)).toBe(true);
  });

  it('workspace: mutations render the authoritative shell list, including its order and flags', async () => {
    await workspace({ workspace: [] });
    const authoritative = [{ path: 'C:\\Returned', name: 'Returned by shell', current: false, missing: true }];
    await evaluate(`window.shellTest.setWorkspaceResult({ ok: true, projects: ${JSON.stringify(authoritative)} })`);
    await addMenu();
    await menuItem('Add current project');
    await until(`document.querySelector('.mission-control-workspace-open')?.textContent.includes('Returned by shell')`);
    expect(await evaluate(`document.querySelectorAll('.mission-control-workspace-row').length`)).toBe(1);
    expect(await evaluate(`document.querySelector('.mission-control-workspace-missing').textContent`)).toBe('Folder not found');
    expect(await evaluate(`document.querySelector('.mission-control-workspace-open').getAttribute('aria-current')`)).toBeNull();
  });

  it('workspace: a pending native dialog disables actions and restores focus after cancellation', async () => {
    await workspace({ workspace: [] });
    await evaluate(`window.deckmateBoard.addToWorkspace = () => new Promise(resolve => { window.finishWorkspace = resolve; })`);
    await addMenu(); await menuItem('Choose folder…');
    expect(await evaluate(`document.querySelector('.mission-control-workspace-add').disabled && document.querySelector('.mission-control-recent-open').disabled`)).toBe(true);
    expect(await evaluate(`Boolean(document.querySelector('.mission-control-workspace-actions .spin'))`)).toBe(true);
    expect(await evaluate(`document.querySelector('.mission-control-workspace-menu') === null`)).toBe(true);
    await evaluate(`window.finishWorkspace({ ok: false, code: 'cancelled' })`);
    await until(`!document.querySelector('.mission-control-workspace-add').disabled`);
    expect(await evaluate(`document.activeElement === document.querySelector('.mission-control-workspace-add')`)).toBe(true);
    await addMenu();
    await key('Escape');
  });

  it('workspace: a full list stays bounded, honors reduced motion and frees a slot on removal', async () => {
    const projects = Array.from({ length: 30 }, (_, index) => ({ path: `C:\\Work\\Project ${index}`, name: `Project ${index}`, current: false, missing: false }));
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    try {
      await render('app', { workspace: projects }, 1280);
      await click('.mission-control-trigger');
      await until(`document.querySelectorAll('.mission-control-workspace-row').length === 30`);
      expect(await evaluate(`document.querySelector('.mission-control-workspace-add').disabled`)).toBe(true);
      expect(await evaluate(`getComputedStyle(document.querySelector('.mission-control')).animationName`)).toBe('none');
      expect(await evaluate(`(() => { const list = document.querySelector('.mission-control-workspace-list'); return list.scrollHeight > list.clientHeight && list.clientHeight <= 306; })()`)).toBe(true);
      await click('.mission-control-workspace-row:last-child .mission-control-workspace-remove');
      await until(`!document.querySelector('.mission-control-workspace-add').disabled`);
      expect(await evaluate(`document.querySelectorAll('.mission-control-workspace-row').length`)).toBe(29);
    } finally { await send('Emulation.setEmulatedMedia', { features: [] }); }
  });

  it('workspace: missing folders cannot switch but can be removed, with focus on the next row', async () => {
    await workspace();
    await click('.mission-control-workspace-row.is-missing .mission-control-workspace-open');
    expect(await evaluate('window.shellTest.workspaceCalls')).toEqual([]);
    await click('.mission-control-workspace-row.is-missing .mission-control-workspace-remove');
    await until(`document.querySelectorAll('.mission-control-workspace-row').length === 3`);
    expect(await evaluate('window.shellTest.workspaceCalls')).toEqual([{ method: 'remove', args: ['E:\\Archive\\Lost project'] }]);
    expect(await evaluate(`document.activeElement === document.querySelectorAll('.mission-control-workspace-open')[2]`)).toBe(true);
  });

  it('workspace: Alt+arrows reorder the focused current row and keep focus, without switching', async () => {
    await workspace();
    await evaluate(`document.querySelector('.mission-control-workspace-open').focus()`);
    await altMove('ArrowUp');
    expect(await evaluate('window.shellTest.workspaceCalls')).toEqual([]);
    await altMove('ArrowDown');
    expect(await evaluate(`document.querySelectorAll('.mission-control-workspace-open')[1].getAttribute('aria-current')`)).toBe('true');
    expect(await evaluate(`document.activeElement === document.querySelectorAll('.mission-control-workspace-open')[1]`)).toBe(true);
    await altMove('ArrowUp');
    expect(await evaluate('window.shellTest.workspaceCalls')).toEqual([
      { method: 'move', args: ['C:\\Work\\Shell test', 1] }, { method: 'move', args: ['C:\\Work\\Shell test', 0] },
    ]);
    expect(await evaluate(`[...document.querySelectorAll('.mission-control-workspace [role="status"]')].some(e => e.textContent.includes('position 1 of 4'))`)).toBe(true);
  });

  it('workspace: pointer dragging reorders without opening a project', async () => {
    await workspace();
    const points = await evaluate(`[...document.querySelectorAll('.mission-control-workspace-open')].slice(0, 2).map(e => { const r = e.getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 }; })`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...points[0] });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...points[0], button: 'left', buttons: 1, clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: points[0].x, y: points[0].y + 10, buttons: 1 });
    await until(`Boolean(document.querySelector('.mission-control-workspace-row.is-dragging'))`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...points[1], buttons: 1 });
    await delay(200);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...points[1], button: 'left', buttons: 0, clickCount: 1 });
    await until(`window.shellTest.workspaceCalls.length === 1`);
    expect(await evaluate('window.shellTest.workspaceCalls')).toEqual([{ method: 'move', args: ['C:\\Work\\Shell test', 1] }]);
  });

  it('workspace: cancel is silent, rejected edits keep the list, and retry recovers', async () => {
    await workspace({ workspace: [] });
    await evaluate(`window.shellTest.setWorkspaceResult({ ok: false, code: 'cancelled' })`);
    await addMenu(); await menuItem('Choose folder…');
    expect(await evaluate(`document.querySelector('.mission-control-workspace [role="alert"]') === null`)).toBe(true);
    await evaluate(`window.shellTest.setWorkspaceResult('throw')`);
    await addMenu(); await menuItem('Choose folder…');
    await until(`Boolean(document.querySelector('.mission-control-workspace [role="alert"]'))`);
    expect(await evaluate(`document.querySelector('.mission-control-workspace [role="alert"]').textContent`)).toContain('Could not update');
    expect(await evaluate(`Boolean(document.querySelector('.mission-control-workspace-empty'))`)).toBe(true);
    await evaluate(`window.shellTest.setWorkspaceResult(null)`);
    await addMenu(); await menuItem('Choose folder…');
    await until(`document.querySelectorAll('.mission-control-workspace-row').length === 1`);
    expect(await evaluate(`document.querySelector('.mission-control-workspace [role="alert"]') === null`)).toBe(true);
  });

  it('workspace: a failed load can retry; failed recents do not block choosing a folder', async () => {
    await render('app', { workspace: true }, 1280);
    await evaluate('window.shellTest.setWorkspaceLoadFails(true)');
    await click('.mission-control-trigger');
    await until(`Boolean(document.querySelector('.mission-control-workspace [role="alert"]'))`);
    expect(await evaluate(`document.querySelector('.mission-control-workspace-empty') === null`)).toBe(true);
    await evaluate('window.shellTest.setWorkspaceLoadFails(false)');
    await click('.mission-control-retry');
    await until(`document.querySelectorAll('.mission-control-workspace-row').length === 4`);
    await evaluate('window.shellTest.setRecentFails(true)');
    await addMenu();
    await until(`Boolean(document.querySelector('.mission-control-workspace-menu [role="alert"]'))`);
    await menuItem('Choose folder…');
    await until(`document.querySelectorAll('.mission-control-workspace-row').length === 5`);
  });

  it('workspace: recent choices deduplicate Windows paths case-insensitively and Escape restores focus', async () => {
    await workspace({ workspace: [{ path: 'c:\\work\\FIELD NOTES', name: 'Pinned notes', current: false, missing: false }] });
    await addMenu();
    await until(`Boolean(document.querySelector('.mission-control-workspace-recent'))`);
    expect(await evaluate(`document.querySelector('.mission-control-workspace-menu').textContent.includes('Field Notes')`)).toBe(false);
    await key('Escape');
    expect(await evaluate(`Boolean(document.querySelector('.mission-control')) && !document.querySelector('.mission-control-workspace-menu')`)).toBe(true);
    expect(await evaluate(`document.activeElement === document.querySelector('.mission-control-workspace-add')`)).toBe(true);
  });

  it('workspace: switching and start-screen errors recover, successful switching keeps its spinner', async () => {
    await workspace();
    await evaluate(`window.shellTest.setNavigationFailure('missing')`);
    await click('.mission-control-workspace-row:nth-child(2) .mission-control-workspace-open');
    await until(`Boolean(document.querySelector('.mission-control-workspace [role="alert"]'))`);
    expect(await evaluate(`document.querySelector('.mission-control-workspace [role="alert"]').textContent`)).toContain('not found');
    await click('.mission-control-recent-open');
    expect(await evaluate(`document.querySelector('.mission-control-workspace [role="alert"]').textContent`)).toContain('Could not open the start screen');
    await evaluate(`window.shellTest.setNavigationFailure(null)`);
    await click('.mission-control-workspace-row:nth-child(2) .mission-control-workspace-open');
    await until(`Boolean(document.querySelector('.mission-control-workspace-open[aria-busy="true"] .spin'))`);
    expect(await evaluate(`document.querySelector('.mission-control-workspace-add').disabled && document.querySelector('.mission-control-recent-open').disabled`)).toBe(true);
  });

  it('workspace: a partial bridge falls back to recent projects', async () => {
    await render('app', { partialBridge: true }, 1280);
    await click('.mission-control-trigger');
    await until(`document.querySelectorAll('.mission-control-recent-row').length === 3`);
    expect(await evaluate(`document.querySelector('.mission-control-workspace') === null`)).toBe(true);
    await click('.mission-control-recent-open');
    expect(await evaluate('window.shellTest.workspaceCalls')).toEqual([{ method: 'start', args: [] }]);
  });

  it.each(['en', 'ru'])('D14: %s intentional Stop hides late reconnect failures', async lang => {
    await render('app', { lang });
    await click('.mission-control-trigger');
    await click('.mission-control-menu .is-destructive');
    await until(`Boolean(document.querySelector('.empty-state h1'))`);
    await delay(1800);
    expect(await evaluate(`document.querySelector('.empty-state h1').textContent`)).toBe(lang === 'en' ? 'Deckmate is stopped' : 'Deckmate остановлен');
    expect(await evaluate(`window.shellTest.shutdownCalls`)).toBe(1);
    expect(await evaluate(`document.querySelector('.error-banner') === null`)).toBe(true);
    const notificationCalls = await evaluate('window.shellTest.notificationCalls');
    await click('.mission-control-trigger');
    await evaluate(`document.querySelectorAll('.mission-control-menu button')[3].click()`);
    await click('.mission-control-head button');
    expect(await evaluate(`document.querySelector('.notifications-error') === null`)).toBe(true);
    expect(await evaluate('window.shellTest.notificationCalls')).toBe(notificationCalls);
  });

  it('D14: an unexpected disconnect and a rejected Stop remain visible errors', async () => {
    await render();
    await evaluate('window.shellTest.disconnect()');
    await until(`Boolean(document.querySelector('.error-banner'))`);
    expect(await evaluate(`document.querySelector('.error-banner').textContent`)).toContain('Could not connect to Deckmate');
    expect(await evaluate(`document.querySelector('.empty-state h1') === null`)).toBe(true);
    await render('app', { failShutdown: true });
    await click('.mission-control-trigger');
    await click('.mission-control-menu .is-destructive');
    await until(`Boolean(document.querySelector('.error-banner'))`);
    expect(await evaluate(`document.querySelector('.error-banner').textContent`)).toContain('Shutdown refused');
    expect(await evaluate(`document.querySelector('.empty-state h1') === null`)).toBe(true);
  });

  it.each(['Escape', 'close', 'cancel'])('returns focus from Run to More after %s, not to the last direct bulk action', async close => {
    await render('bulk');
    await click('.bulk-action-button[aria-label="Owner"]');
    await until(`Boolean(document.querySelector('.bulk-actions-dialog'))`);
    await key('Escape');
    await until(`!document.querySelector('.bulk-actions-dialog')`);
    // A programmatic/menu activation need not deliver a focus event to the trigger.
    await evaluate(`document.querySelector('.bulk-actions button[aria-label="More actions"]').dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true}))`);
    await until(`Boolean(document.querySelector('.bulk-more-menu'))`);
    await evaluate(`[...document.querySelectorAll('.bulk-more-item')].find(e=>e.textContent==='Run').click()`);
    await until(`Boolean(document.querySelector('.bulk-actions-dialog select'))`);
    if (close === 'Escape') await key('Escape');
    else await click(close === 'close' ? '.bulk-actions-dialog button[aria-label="Close bulk action"]' : '.bulk-dialog-footer button[type="button"]');
    await until(`!document.querySelector('.bulk-actions-dialog')`);
    await until(`document.activeElement === document.querySelector('.bulk-actions button[aria-label="More actions"]')`);
    await until(`!document.querySelector('.bulk-more-menu')`);
    expect(await evaluate(`document.querySelector('.bulk-more-menu') === null`)).toBe(true);
  }, 15000);

  it('NW-01/DW-02/DW-07: shelf buttons stay inside the rail and Table keeps one thin workspace scrollport', async () => {
    await render('app', { deck: true });
    await until(`Boolean(document.querySelector('.deck-neighbor-rail'))`);
    expect(await evaluate(`(() => { const rail=document.querySelector('.deck-neighbor-rail').getBoundingClientRect(); return [...document.querySelectorAll('.deck-neighbor-rail > button')].every(e=>{const r=e.getBoundingClientRect();return r.top>=rail.top && r.bottom<=rail.bottom && getComputedStyle(e.querySelector('.deck-neighbor-window')).overflow==='hidden';}); })()`)).toBe(true);
    await click('.catalog-table-title');
    await until(`Boolean(document.querySelector('.card-preview'))`);
    expect(await evaluate(`document.documentElement.scrollHeight === innerHeight`)).toBe(true);
    expect(await evaluate(`document.querySelector('.workspace-main').scrollHeight > document.querySelector('.workspace-main').clientHeight`)).toBe(true);
    expect(await evaluate(`getComputedStyle(document.querySelector('.workspace-main'),'::-webkit-scrollbar').width`)).toBe('6px');
    expect(await evaluate(`getComputedStyle(document.querySelector('.workspace-main'),'::-webkit-scrollbar-button').display`)).toBe('none');
    await click('.deck-action-rail button[aria-label="Ordering"]');
    await until(`Boolean(document.querySelector('.deck-narrow-panel'))`);
    expect(await evaluate(`document.documentElement.scrollHeight === innerHeight`)).toBe(true);
  });

  it.each([375, 1280])('L-02/L-03/L-08: composer controls and deck search fit at %s px', async width => {
    for (const theme of ['light', 'dark']) for (const lang of ['ru', 'en']) {
      await render('app', { deck: true, theme, lang }, width);
      await until(`Boolean(document.querySelector('.deck-toolbar-search input') && document.querySelector('.deck-action-rail'))`);
      expect(await evaluate(`(() => {
        const input = document.querySelector('.deck-toolbar-search input');
        const style = getComputedStyle(input), canvas = document.createElement('canvas').getContext('2d');
        canvas.font = style.font;
        return canvas.measureText(input.placeholder).width <= input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
          && Boolean(input.closest('label').textContent.trim());
      })()`)).toBe(true);
      await click(`.deck-action-rail button[aria-label="${lang === 'ru' ? 'Новая карточка' : 'New card'}"]`);
      await until(`Boolean(document.querySelector('.card-composer-again label'))`);
      await delay(200);
      expect(await evaluate(`(() => {
        const save = document.querySelector('.card-composer .card-edit-save');
        const footer = save.closest('.card-edit-footer').getBoundingClientRect();
        const button = save.getBoundingClientRect(), text = document.createRange();
        text.selectNodeContents(save); const ink = text.getBoundingClientRect();
        return save.textContent.trim() === ${JSON.stringify(lang === 'ru' ? 'Сохранить' : 'Save')}
          && button.left >= footer.left && button.right <= footer.right
          && ink.left >= button.left && ink.right <= button.right && ink.top >= button.top && ink.bottom <= button.bottom;
      })()`)).toBe(true);
      expect(await evaluate(`(() => {
        const label = document.querySelector('.card-composer-again label'), box = label.getBoundingClientRect();
        const range = document.createRange(); range.selectNodeContents(label);
        const style = getComputedStyle(label), left = box.left + parseFloat(style.paddingLeft), right = box.right - parseFloat(style.paddingRight);
        return label.textContent.trim() === ${JSON.stringify(lang === 'ru' ? 'Создать ещё одну' : 'Create another')}
          && box.height >= 24 && [...range.getClientRects()].every(r => r.left >= left - 1 && r.right <= right + 1 && r.top >= box.top && r.bottom <= box.bottom);
      })()`)).toBe(true);
      const target = await evaluate(`(() => {
        const label = document.querySelector('.card-composer-again label'), r = label.getBoundingClientRect();
        const x = r.left + 5, y = r.top + 1;
        return { x, y, hit: document.elementFromPoint(x, y) === label && document.elementFromPoint(x, r.bottom - 1) === label };
      })()`);
      expect(target.hit).toBe(true);
      for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: target.x, y: target.y, button: 'left', clickCount: 1 });
      await delay(80);
      expect(await evaluate(`document.querySelector('.card-composer-again [role="switch"]').getAttribute('aria-checked')`)).toBe('true');
    }
  }, 30000);

  it.each(['ru', 'en'])('L-06: %s phone stacks start compact and stay usable when expanded', async lang => {
    await evaluate(`['owned', 'watching', 'due'].forEach(id => localStorage.removeItem('deckmate-notifications-' + id + '-collapsed:maya'))`);
    await render('app', { deck: true, lang, notifications: true });
    await until(`document.querySelectorAll('.notification-pill').length === 3`);
    expect(await evaluate(`(() => { const corner = document.querySelector('.notifications-corner'); return corner.getBoundingClientRect().height < innerHeight * .25 && [...corner.querySelectorAll('.notification-pill')].every(e => e.getAttribute('aria-expanded') === 'false'); })()`)).toBe(true);
    expect(await evaluate(`(() => {
      const corner = document.querySelector('.notifications-corner'), bounds = corner.getBoundingClientRect();
      const pill = corner.querySelector('.notification-pill').getBoundingClientRect();
      const under = document.elementFromPoint(bounds.left + 30, pill.top + pill.height / 2);
      return Boolean(under && !corner.contains(under));
    })()`)).toBe(true);
    for (const title of ['Cards you own', 'Cards you watch', 'Due Cards']) {
      await click(`.notification-pill[title*="${title}"]`);
      await until(`document.activeElement?.classList.contains('notification-collapse')`);
      await until(`(() => { const corner = document.querySelector('.notifications-corner'); return corner.scrollWidth <= corner.clientWidth; })()`);
    }
    await until(`document.querySelectorAll('.notification-stack').length === 3`);
    expect(await evaluate(`(() => {
      const corner = document.querySelector('.notifications-corner'), box = corner.getBoundingClientRect();
      return box.height <= innerHeight * .45 + 1 && box.top > innerHeight / 2
        && corner.scrollHeight > corner.clientHeight && getComputedStyle(corner).overflowY === 'auto';
    })()`)).toBe(true);
    for (const stack of ['owned', 'watching', 'due']) {
      expect(await evaluate(`(() => {
        const corner = document.querySelector('.notifications-corner');
        const header = document.querySelector('.notification-stack-${stack} .notification-stack-header');
        header.scrollIntoView({ block: 'nearest' });
        const c = corner.getBoundingClientRect(), h = header.getBoundingClientRect();
        return h.top >= c.top - 1 && h.bottom <= c.bottom + 1;
      })()`)).toBe(true);
    }
    await click('.notification-stack-watching .notification-collapse');
    await until(`document.activeElement?.classList.contains('notification-pill') && document.activeElement.title.includes('Cards you watch')`);
    expect(await evaluate(`localStorage.getItem('deckmate-notifications-watching-collapsed:maya')`)).toBe('1');
    await click('.notification-pill[title*="Cards you watch"]');
    expect(await evaluate(`localStorage.getItem('deckmate-notifications-watching-collapsed:maya')`)).toBe('0');
  });

  it('L-06: resizing changes defaults, and the old Due Cards preference remains intact', async () => {
    await evaluate(`['owned', 'watching', 'due'].forEach(id => localStorage.removeItem('deckmate-notifications-' + id + '-collapsed:maya'))`);
    await render('app', { deck: true, notifications: true }, 1280);
    await until(`document.querySelectorAll('.notification-stack').length === 3`);
    await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: false });
    await until(`document.querySelectorAll('.notification-pill').length === 3`);
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await until(`document.querySelectorAll('.notification-stack').length === 3`);
    await evaluate(`localStorage.setItem('deckmate-notifications-due-collapsed:maya', '1')`);
    await render('app', { deck: true, notifications: true }, 1280);
    await until(`document.querySelectorAll('.notification-stack').length === 2 && Boolean(document.querySelector('.notification-pill[title*="Due Cards"]'))`);
    await click('.notification-pill[title*="Due Cards"]');
    expect(await evaluate(`localStorage.getItem('deckmate-notifications-due-collapsed:maya')`)).toBe('0');
    await render('app', { deck: true, notifications: true });
    await until(`document.querySelector('.notification-stack-due') && document.querySelectorAll('.notification-pill').length === 2`);
  });

  it('has no uncaught browser errors', () => { expect(errors).toEqual([]); });
});
