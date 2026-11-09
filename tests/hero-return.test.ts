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

// 2026-11-08: test the actual Deck capture listener, native focus and scrolling with CDP keyboard/mouse input.
describe.skipIf(!browserPath)('one-step Hero return (browser)', () => {
  let server: ViteDevServer | undefined;
  let browser: ChildProcess | undefined;
  let temporary: string | undefined;
  let socket: WebSocket | undefined;
  let sequence = 0;
  let executionContextId: number | undefined;
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  const errors: string[] = [];
  const tile = (id: string) => `.catalog-results [data-card-id="card:${id}"] .deck-card-open`;
  const mini = (id: string) => `[data-journey-card-id="card:${id}"]`;
  const row = (id: string) => `.card-family-list [data-card-id="card:${id}"] .card-family-row-open`;
  const selected = (id: string) => `new URLSearchParams(location.search).get('card') === 'card:${id}'`;

  function send(method: string, params: object = {}): Promise<any> {
    const id = ++sequence;
    return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); socket!.send(JSON.stringify({ id, method, params })); });
  }
  async function evaluate(expression: string): Promise<any> {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result?.value;
  }
  // 2026-11-09: values cross into the page as callFunctionOn arguments, not as text baked into the evaluated code
  // (CodeQL js/bad-code-sanitization flags JSON.stringify interpolation, and arguments survive undefined too).
  async function callFunction(functionDeclaration: string, ...args: unknown[]): Promise<any> {
    const result = await send('Runtime.callFunctionOn', { functionDeclaration, executionContextId,
      arguments: args.map(value => ({ value })), returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result?.value;
  }
  async function until(expression: string, attempts = 100) {
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (await evaluate(`Boolean(${expression})`)) return;
      await delay(50);
    }
    throw new Error('Timed out: ' + expression + '\n' + errors.join('\n'));
  }
  async function click(selector: string) {
    const point = await callFunction(`selector => { const element = document.querySelector(selector); element.scrollIntoView({ block: 'nearest' });
      const box = element.getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; }`, selector);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
    await delay(80);
  }
  async function key(key: string, code = key) {
    const codes: Record<string, number> = { Escape: 27, Enter: 13, Tab: 9 };
    for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: codes[key],
      text: type === 'keyDown' && key === 'Enter' ? '\r' : undefined });
    await delay(80);
  }
  async function render(options: object = {}) {
    await evaluate(`window.heroReturnTest.render(${JSON.stringify(options)})`);
    await until(`Boolean(document.querySelector(${JSON.stringify(tile('hero'))}))`);
    await delay(80);
  }
  async function openHero(familyVisible = false) {
    await click(tile('hero'));
    await until(`${selected('hero')} && document.querySelector('.card-title-edit:not(:disabled)')`);
    if (familyVisible) await click('.card-preview-subcards-toggle');
    await evaluate(`document.querySelector('.card-preview-panels').scrollTop = 10000`);
    await delay(100);
    const scroll = await evaluate(`document.querySelector('.card-preview-panels').scrollTop`);
    expect(scroll).toBeGreaterThan(0);
    return scroll as number;
  }
  async function expectHero(scroll: number, focus: string, familyVisible: boolean) {
    await until(`${selected('hero')} && document.activeElement === document.querySelector(${JSON.stringify(focus)})`);
    await delay(150);
    expect(await evaluate(`document.querySelector('.card-preview-panels').scrollTop`)).toBeCloseTo(scroll, 0);
    expect(await evaluate(`Boolean(document.querySelector('.card-family-panel'))`)).toBe(familyVisible);
  }
  async function expectClosed(focus = tile('hero')) {
    await until(`!document.querySelector('.card-preview')`);
    expect(await evaluate(`document.activeElement === document.querySelector(${JSON.stringify(focus)})`)).toBe(true);
  }

  beforeAll(async () => {
    temporary = await mkdtemp(path.join(tmpdir(), 'hero-return-test-'));
    server = await createServer({ configFile: false, root: process.cwd(), cacheDir: path.join(temporary, 'vite'),
      plugins: [tailwindcss(), { name: 'hero-return-fixture', configureServer(vite) {
        vite.middlewares.use((request, response, next) => {
          if (request.url?.split('?')[0] !== '/') return next();
          response.setHeader('Content-Type', 'text/html');
          response.end('<!doctype html><html><body><div id="root"></div><script type="module" src="/tests/fixtures/hero-return.tsx"></script></body></html>');
        });
      } }], server: { host: '127.0.0.1', port: 0 }, optimizeDeps: { entries: ['tests/fixtures/hero-return.tsx'] }, logLevel: 'error' });
    await server.listen();
    await server.warmupRequest('/tests/fixtures/hero-return.tsx');
    const port = await freePort();
    browser = spawn(browserPath!, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--disable-features=OverlayScrollbar', `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(temporary, 'profile')}`, 'about:blank'], { stdio: 'ignore' });
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
    await send('Emulation.setDeviceMetricsOverride', { width: 1700, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: server.resolvedUrls!.local[0] });
    await until(`Boolean(window.heroReturnTest && document.querySelector(${JSON.stringify(tile('hero'))}))`, 600);
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

  beforeEach(async () => {
    await send('Emulation.setDeviceMetricsOverride', { width: 1700, height: 900, deviceScaleFactor: 1, mobile: false });
    await render();
  });

  it.each([false, true])('mini-card → Escape restores scroll/focus and family visibility (%s); second Escape closes', async visible => {
    const scroll = await openHero(visible);
    await click(mini('design'));
    await until(selected('design'));
    expect(await evaluate(`document.querySelector('.card-preview-parent kbd')?.textContent`)).toBe('Esc');
    expect(await evaluate(`document.querySelector('.card-preview-parent').getAttribute('aria-keyshortcuts')`)).toBe('Escape');
    expect(await evaluate(`(() => { const style = getComputedStyle(document.querySelector('.card-preview-parent kbd'));
      return { family: style.fontFamily, weight: style.fontWeight, size: style.fontSize, line: style.lineHeight }; })()`))
      .toEqual({ family: '"Geist Mono", monospace', weight: '600', size: '10px', line: '10px' });
    await key('Escape');
    await expectHero(scroll, mini('design'), visible);
    expect(await evaluate(`document.querySelector(${JSON.stringify(mini('design'))}).tabIndex`)).toBe(0);
    expect(await evaluate(`document.querySelectorAll('.journey-track-open[tabindex="0"]').length`)).toBe(1);
    await key('Escape');
    await expectClosed();
  });

  it('Next and the parent strip share the one-step return', async () => {
    const scroll = await openHero();
    await click('.journey-track-next');
    await until(selected('build'));
    expect(await evaluate(`document.querySelector('.card-preview-parent').title`)).toBe('Back to Hero: Test Hero · Esc');
    await click('.card-preview-parent');
    await expectHero(scroll, mini('build'), false);
    await key('Escape');
    await expectClosed();
  });

  it('returns focus to the Sub Cards row and restores the shown list', async () => {
    const scroll = await openHero(true);
    await click(row('build'));
    await until(selected('build'));
    await click('.card-preview-action-rail button');
    await until(`!document.querySelector('.card-family-panel')`);
    await key('Escape');
    await expectHero(scroll, row('build'), true);
    await key('Escape');
    await expectClosed();
  });

  it('deck opening has no keycap and Escape closes immediately; its strip still opens the family', async () => {
    await click(tile('build'));
    await until(selected('build'));
    expect(await evaluate(`document.querySelector('.card-preview-parent kbd')`)).toBeNull();
    expect(await evaluate(`document.querySelector('.card-preview-parent').getAttribute('aria-keyshortcuts')`)).toBeNull();
    await key('Escape');
    await expectClosed(tile('build'));
    await click(tile('build'));
    await click('.card-preview-parent');
    await until(`${selected('hero')} && document.querySelector('.card-family-panel')`);
  });

  it('menus and card selection are dismissed before returning', async () => {
    await openHero();
    await click(mini('build'));
    // 2026-11-09: a Journey step opens its Sub Card inside the Sub Cards tab; closing the tab keeps the return target.
    await until(`document.querySelector('[data-card-family]')?.getAttribute('aria-pressed') === 'true'`);
    await click('[data-card-family]');
    await until(`Boolean(document.querySelector('.catalog-results [data-card-id="card:hero"] input[type="checkbox"]'))`);
    await click('.catalog-results [data-card-id="card:hero"] input[type="checkbox"]');
    await until(`Boolean(document.querySelector('.card-selection-toolbar'))`);
    await click('.card-preview-more');
    await until(`Boolean(document.querySelector('[role="menu"]'))`);
    await key('Escape');
    await until(`!document.querySelector('[role="menu"]')`);
    expect(await evaluate(`Boolean(document.querySelector('.card-selection-toolbar')) && ${selected('build')}`)).toBe(true);
    await key('Escape');
    await until(`!document.querySelector('.card-selection-toolbar')`);
    expect(await evaluate(selected('build'))).toBe(true);
    await key('Escape');
    await until(selected('hero'));
  });

  it('editor Escape consumes its own step before Hero return', async () => {
    await openHero();
    await click(mini('build'));
    await until(`Boolean(document.querySelector('.card-title-edit:not(:disabled)'))`);
    await click('.card-title-edit');
    await until(`Boolean(document.querySelector('.card-edit textarea'))`);
    await key('Escape');
    await until(`!document.querySelector('.card-edit textarea')`);
    expect(await evaluate(selected('build'))).toBe(true);
    await key('Escape');
    await until(selected('hero'));
  });

  it.each(['tile', 'link', 'tag', 'family'])('%s navigation to another card clears the return target', async origin => {
    await openHero(origin === 'family');
    await click(mini('build'));
    if (origin === 'tile') {
      await click('[data-card-family]');
      await until(`Boolean(document.querySelector(${JSON.stringify(tile('review'))}))`);
      await click(tile('review'));
    }
    if (origin === 'link') await click('.card-preview-document a');
    if (origin === 'tag') await click('.card-preview-meta-row .tag-badge-link');
    if (origin === 'family') await click(row('review'));
    await until(selected('review'));
    expect(await evaluate(`Boolean(document.querySelector('.card-preview-parent kbd'))`)).toBe(false);
    await key('Escape');
    await until(`!document.querySelector('.card-preview')`);
  });

  it('closing and reopening the same Sub Card does not resurrect the target', async () => {
    await openHero();
    await click(mini('build'));
    await click('.card-preview-tools button');
    await click(tile('build'));
    expect(await evaluate(`Boolean(document.querySelector('.card-preview-parent kbd'))`)).toBe(false);
    await key('Escape');
    await expectClosed(tile('build'));
  });

  it('a direct card URL and a Hero content link do not create a return target', async () => {
    await render({ card: 'card:build' });
    await until(selected('build'));
    expect(await evaluate(`Boolean(document.querySelector('.card-preview-parent kbd'))`)).toBe(false);
    await key('Escape');
    await until(`!document.querySelector('.card-preview')`);
    await openHero();
    await click('.card-preview-document a');
    await until(selected('design'));
    expect(await evaluate(`Boolean(document.querySelector('.card-preview-parent kbd'))`)).toBe(false);
  });

  it('search and switching decks clear the target', async () => {
    await openHero();
    await click(mini('build'));
    await click('.deck-toolbar-search input');
    await send('Input.insertText', { text: 'Build' });
    await until(`!document.querySelector('.card-preview-parent kbd')`);
    await evaluate(`document.querySelector('.card-preview-title').focus()`);
    await key('Escape');
    await until(`!document.querySelector('.card-preview')`);
    await render();
    await openHero();
    await click(mini('build'));
    await click('[data-deck-cover="other"]');
    await until(`new URLSearchParams(location.search).get('deck') === 'other' && !document.querySelector('.card-preview')`);
  });

  it('uses the Russian return hint', async () => {
    await render({ lang: 'ru' });
    await openHero();
    await click(mini('build'));
    expect(await evaluate(`document.querySelector('.card-preview-parent').title`)).toBe('Вернуться к Hero: Test Hero · Esc');
  });

  it.each(['hero', 'task', 'doc', 'subcard'].flatMap(kind =>
    [[kind, 1700, 1000, 'en'], [kind, 375, 812, 'ru']] as const))('%s: unlinked tags reveal and focus the tags section at %s×%s (%s)', async (kind, width, height, lang) => {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    const card = kind === 'subcard' ? 'build' : 'hero';
    await render({ card: 'card:' + card, kind: kind === 'subcard' ? 'hero' : kind, tags: ['unlinked', 'personal'], lang });
    await until(`Boolean(document.querySelector('.card-title-edit:not(:disabled)'))`);
    for (const name of ['unlinked', 'personal', 'unlinked']) {
      const tag = `.card-preview-meta-row .tag-badge-link[aria-label="${name}"]`;
      // 2026-11-08: returning from the stacked properties panel must reveal the tag below the sticky toolbar before clicking.
      if (width <= 760) await evaluate(`document.querySelector(${JSON.stringify(tag)}).scrollIntoView({ block: 'center', behavior: 'instant' })`);
      await click(tag);
      await until(`document.activeElement === document.querySelector('section[data-property="tags"]')`);
      const section = await evaluate(`(() => {
        const target = document.querySelector('section[data-property="tags"]');
        const heading = target.querySelector('h3');
        const box = heading.getBoundingClientRect();
        return { visible: !target.closest('.card-properties-slot').hidden,
          top: box.top, bottom: box.bottom, toolbarBottom: document.querySelector('.deck-open-toolbar').getBoundingClientRect().bottom,
          hit: heading.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)) };
      })()`);
      expect(section.visible).toBe(true);
      expect(section.top).toBeGreaterThanOrEqual(section.toolbarBottom + 8);
      expect(section.bottom).toBeLessThan(height);
      expect(section.hit).toBe(true);
      expect(await evaluate(selected(card))).toBe(true);
    }
  });

  // 2026-11-09: the author's reference puts the ID at the left of the reading footer, level with Journey and Edit.
  it.each(['hero', 'task', 'doc', 'subcard'])('%s keeps its copyable ID at the left of the reading footer', async kind => {
    const card = kind === 'subcard' ? 'build' : 'hero';
    await render({ card: 'card:' + card, kind: kind === 'subcard' ? 'hero' : kind, tags: [] });
    await until(`Boolean(document.querySelector('.card-title-edit:not(:disabled)'))`);
    expect(await evaluate(`document.querySelectorAll('.card-content-reading-footer .card-id-chip').length`)).toBe(1);
    expect(await evaluate(`Boolean(document.querySelector('.card-preview-meta-row .card-id-chip'))`)).toBe(false);
    expect(await evaluate(`Boolean(document.querySelector('.card-preview-material-band .card-id-chip'))`)).toBe(false);
    expect(await evaluate(`(() => {
      const chip = document.querySelector('.card-content-reading-footer .card-id-chip').getBoundingClientRect();
      const edit = document.querySelector('.card-content-edit-action')?.getBoundingClientRect();
      return !edit || (chip.right < edit.left && Math.abs((chip.top + chip.bottom) / 2 - (edit.top + edit.bottom) / 2) <= 2);
    })()`)).toBe(true);
    await evaluate(`Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.copiedCardId = text; } } })`);
    await click('.card-content-reading-footer .card-id-chip');
    await until(`document.querySelector('.card-id-chip').dataset.copied === 'true'`);
    expect(await evaluate(`window.copiedCardId`)).toBe(await evaluate(`document.querySelector('.card-id-chip').textContent`));
  });

  it('puts a running Journey after the reading footer and opens it from the title menu', async () => {
    await openHero();
    expect(await evaluate(`Boolean(document.querySelector('.card-content-reading .card-preview-journey-progress'))`)).toBe(false);
    expect(await evaluate(`document.querySelector('.card-content-reading').nextElementSibling.matches('.card-preview-journey-progress')`)).toBe(true);
    expect(await evaluate(`Boolean(document.querySelector('.card-content-reading-footer .card-preview-journey-action'))`)).toBe(false);
    await click('.journey-track-title-button');
    await until(`Boolean(document.querySelector('.journey-track-menu-open'))`);
    await click('.journey-track-menu-open');
    await until(`Boolean(document.querySelector('.card-journey-dialog'))`);
    await key('Escape');
  });

  it('keeps the reading Journey action for a Hero without a run', async () => {
    await render({ card: 'card:hero', withoutJourney: true });
    await until(`Boolean(document.querySelector('.card-title-edit:not(:disabled)'))`);
    expect(await evaluate(`Boolean(document.querySelector('.card-preview-journey-progress'))`)).toBe(false);
    await click('.card-content-reading-footer .card-preview-journey-action');
    await until(`Boolean(document.querySelector('.card-journey-dialog'))`);
    await key('Escape');
  });

  it.each(['properties', 'attachments'])('reveals the stacked %s heading below the sticky toolbar', async panel => {
    await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: false });
    await render({ card: 'card:build', longContent: true, lang: 'ru' });
    await until(`Boolean(document.querySelector('.card-title-edit:not(:disabled)'))`);
    const selector = panel === 'properties' ? '.card-preview-action-rail button:first-child' : '.card-preview-action-rail button:last-child';
    await click(selector);
    await until(`Boolean(document.querySelector('.card-properties-slot:not([hidden])'))`);
    await delay(200);
    const geometry = await evaluate(`(() => {
      const slot = document.querySelector('.card-properties-slot:not([hidden])');
      const heading = slot.querySelector('h2, h3');
      const box = heading.getBoundingClientRect();
      const toolbar = document.querySelector('.deck-open-toolbar').getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, toolbarBottom: toolbar.bottom, height: innerHeight,
        focused: document.activeElement === slot, hit: heading.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)) };
    })()`);
    expect(geometry.top).toBeGreaterThanOrEqual(geometry.toolbarBottom + 8);
    expect(geometry.bottom).toBeLessThan(geometry.height);
    expect(geometry.focused).toBe(true);
    expect(geometry.hit).toBe(true);
  });

  it.each([[1024, 768, 'en'], [1280, 800, 'ru']] as const)('refits editor actions after a late panels resize at %s×%s (%s)', async (width, height, lang) => {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await render({ card: 'card:build', longContent: true, width: 420, lang });
    await until(`Boolean(document.querySelector('.card-title-edit:not(:disabled)'))`);
    await click('.card-title-edit');
    await until(`Boolean(document.querySelector('.card-edit-text'))`);
    await delay(250);
    const original = await evaluate(`document.querySelector('.card-edit-text').clientHeight`);
    const originalPanels = await evaluate(`document.querySelector('.card-preview-panels').clientHeight`);
    expect(original).toBeGreaterThan(204);
    // 2026-11-08: resize only the scroll area, after the draft's initial layout; no window resize or input event.
    await evaluate(`(() => { const panels = document.querySelector('.card-preview-panels'); panels.style.flex = 'none'; panels.style.height = '${originalPanels - 60}px'; })()`);
    await until(`document.querySelector('.card-edit-text').clientHeight < ${original - 40}`);
    const geometry = await evaluate(`(() => {
      const panels = document.querySelector('.card-preview-panels');
      const bounds = panels.getBoundingClientRect();
      return { excess: panels.scrollHeight - panels.clientHeight, buttons: [...document.querySelectorAll('.card-edit-footer button')].map(button => {
        const box = button.getBoundingClientRect();
        return { inside: box.top >= bounds.top && box.bottom <= bounds.bottom + 1,
          hit: button.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)) };
      }) };
    })()`);
    expect(geometry.excess).toBeLessThanOrEqual(1);
    expect(geometry.buttons).toHaveLength(3);
    expect(geometry.buttons.every((button: { inside: boolean; hit: boolean }) => button.inside && button.hit)).toBe(true);
    await evaluate(`document.querySelector('.card-preview-panels').style.height = '${originalPanels}px'`);
    await until(`document.querySelector('.card-edit-text').clientHeight >= ${original - 1}`);
  });

  it('a missing Hero invalidates the return instead of opening a stale card', async () => {
    await openHero();
    await click(mini('build'));
    await evaluate('window.heroReturnTest.removeHero()');
    await until(`!document.querySelector('.card-preview-parent')`);
    await key('Escape');
    await until(`!document.querySelector('.card-preview')`);
    expect(errors).toEqual([]);
  });
});
