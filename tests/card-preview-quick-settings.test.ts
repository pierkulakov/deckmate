import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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

// 2026-11-08: no DOM shim can verify Radix's real Escape/focus behavior; use the installed headless browser over CDP.
describe.skipIf(!browserPath)('CardPreview Quick Settings (browser)', () => {
  let server: ViteDevServer | undefined;
  let browser: ChildProcess | undefined;
  let profile: string | undefined;
  let socket: WebSocket | undefined;
  let executionContextId: number | undefined;
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
  // 2026-11-09: keep data out of executable source, including selectors with quotes or backslashes.
  async function call(functionDeclaration: string, ...args: unknown[]): Promise<any> {
    if (executionContextId === undefined) throw new Error('No default browser execution context');
    const result = await send('Runtime.callFunctionOn', { functionDeclaration, executionContextId,
      arguments: args.map(value => ({ value })), returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result?.value;
  }
  // 2026-11-08: the first page load waits for Vite's cold dependency scan, which can exceed five seconds on Windows.
  async function until(expression: string | (() => Promise<unknown>), attempts = 100) {
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (await (typeof expression === 'string' ? evaluate(expression) : expression())) return;
      await delay(50);
    }
    throw new Error('Timed out: ' + expression + '\n' + errors.join('\n'));
  }
  async function click(selector: string) {
    await call('function(selector) { document.querySelector(selector).click(); }', selector);
    await delay(60);
  }
  async function key(key: string, code = key) {
    for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: key === 'Escape' ? 27 : undefined });
    await delay(80);
  }
  async function render(kind = 'task', options: object = {}) {
    await call('function(kind, options) { window.previewTest.render(kind, options); }', kind, options);
    await until(() => call(`function(kind) { return document.querySelector('.card-preview-' + kind)
      && document.querySelector('[data-panel="content"]')?.textContent.includes('Card text remains visible.'); }`, kind));
  }
  const button = (tab: string) => `.card-preview [data-quick-settings-tab="${tab}"]`;
  async function expectPopup(tab: string, anchor: string) {
    await until(() => call(`function(tab) { return document.querySelector('.card-quick-settings')?.dataset.tab === tab; }`, tab));
    expect(await evaluate(`document.querySelectorAll('.card-quick-settings').length`)).toBe(1);
    expect(await call(`function(anchor) { return document.querySelector(anchor).getAttribute('aria-expanded'); }`, anchor)).toBe('true');
    expect(await evaluate(`document.querySelector('.card-preview-action-rail button').getAttribute('aria-pressed')`)).toBe('false');
    expect(await evaluate(`document.querySelector('.card-properties-slot').hidden`)).toBe(true);
    expect(await evaluate(`document.querySelector('[data-panel="content"]').getBoundingClientRect().height > 0`)).toBe(true);
    expect(await call(`function(anchor) {
      const button = document.querySelector(anchor).getBoundingClientRect();
      const popup = document.querySelector('.deck-picker-popover').getBoundingClientRect();
      return Math.abs(popup.left - button.left) <= 32 && (Math.abs(popup.bottom - button.top) <= 9 || Math.abs(popup.top - button.bottom) <= 9);
    }`, anchor)).toBe(true);
  }
  async function expectClosed(anchor: string) {
    await until(() => call(`function(anchor) { return !document.querySelector('.card-quick-settings')
      && document.activeElement === document.querySelector(anchor); }`, anchor));
    expect(await call(`function(anchor) { return document.querySelector(anchor).getAttribute('aria-expanded'); }`, anchor)).toBe('false');
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
    // 2026-11-09: a headless Chrome on a Linux CI runner sees no pointing device and reports (hover: none), where the
    // tile ribbon stays pinned at rest by design; the suite tests the desktop pointer, so it declares a fine hovering one.
    browser = spawn(browserPath!, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--window-size=1280,1000',
      '--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4',
      `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
    const target = await waitForPageTarget(port, browser!);
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
      if (message.method === 'Runtime.executionContextCreated' && message.params.context.auxData?.isDefault) executionContextId = message.params.context.id;
      if (message.method === 'Runtime.executionContextsCleared') executionContextId = undefined;
    });
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
    await send('Emulation.setFocusEmulationEnabled', { enabled: true });
    // 2026-11-09: Windows CI can inherit disabled OS animations. Both the tile and flat bands ignore pointers in reduce.
    await setMotionPreference('no-preference');
    await send('Page.navigate', { url: server.resolvedUrls!.local[0] });
    await send('Page.bringToFront');
    await until(`Boolean(window.previewTest && document.querySelector('[data-panel="content"]'))`, 600);
    await evaluate(`document.addEventListener('pointermove', event => {
      window.previewPointerSample = { target: event.target, trusted: event.isTrusted, pointerType: event.pointerType,
        x: event.clientX, y: event.clientY };
    }, true)`);
    expect(await evaluate(`matchMedia('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)').matches`),
      'The browser fixture requires a fine hovering pointer with motion enabled').toBe(true);
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
    await moveOver(button('effort'), .5);
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
    expect(await call(`function(selector) { return document.querySelector(selector).getAttribute('aria-expanded'); }`, button('effort'))).toBe('false');
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
    expect(await call('function(selector) { return document.querySelector(selector).disabled; }', button('owner'))).toBe(true);
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
    await until(() => call('function(selector) { return document.querySelector(selector).disabled; }', button('effort')));
    await click(button('effort'));
    await evaluate('document.activeElement.blur()');
    await key('e', 'KeyE');
    expect(await evaluate(`document.querySelector('.card-quick-settings') === null`)).toBe(true);
  });

  it('does not expose Effort or Priority for Doc, but still opens Owner', async () => {
    await render('doc');
    expect(await call('function(selector) { return document.querySelector(selector) === null; }', button('effort'))).toBe(true);
    expect(await call('function(selector) { return document.querySelector(selector) === null; }', button('priority'))).toBe(true);
    await key('e', 'KeyE');
    expect(await evaluate(`document.querySelector('.card-quick-settings') === null`)).toBe(true);
    await click(button('owner'));
    await expectPopup('owner', button('owner'));
    await key('Escape');
    await expectClosed(button('owner'));
    expect(errors).toEqual([]);
  });

  async function setMotionPreference(value: 'reduce' | 'no-preference') {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value }] });
  }
  async function pointerDiagnostics(selector: string, point: { x: number; y: number } | null = null) {
    return call(`function(selector, point) {
      const element = document.querySelector(selector);
      const bounds = element?.getBoundingClientRect();
      const sample = window.previewPointerSample;
      point ??= { x: sample?.x ?? bounds?.x ?? 0, y: sample?.y ?? bounds?.y ?? 0 };
      const hit = document.elementFromPoint(point.x, point.y);
      const describe = node => node ? node.tagName + '#' + node.id + '.' + [...node.classList].join('.') : null;
      return { selector, point, bounds: bounds?.toJSON(),
        viewport: { width: innerWidth, height: innerHeight }, window: { width: outerWidth, height: outerHeight },
        scroll: { x: scrollX, y: scrollY }, visibility: document.visibilityState, focused: document.hasFocus(),
        hoverCapable: matchMedia('(hover: hover) and (pointer: fine)').matches,
        reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
        hit: describe(hit), hitMatches: Boolean(element && hit && element.contains(hit)), hovered: element?.matches(':hover'),
        event: sample ? { target: describe(sample.target), trusted: sample.trusted, pointerType: sample.pointerType,
          x: sample.x, y: sample.y, hitMatches: Boolean(element?.contains(sample.target)) } : null };
    }`, selector, point);
  }
  async function moveOver(selector: string, fraction: number) {
    await send('Page.bringToFront');
    const point = await call(`function(selector, fraction) {
      const element = document.querySelector(selector);
      if (!element) throw new Error('Pointer target not found: ' + selector);
      element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
      const box = element.getBoundingClientRect();
      window.previewPointerSample = null;
      return { x: box.x + box.width * fraction, y: box.y + box.height / 2 };
    }`, selector, fraction);
    const before = await pointerDiagnostics(selector, point);
    expect(before.hitMatches, 'Pointer hit test failed: ' + JSON.stringify(before)).toBe(true);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point, button: 'none', buttons: 0, pointerType: 'mouse' });
    const started = Date.now();
    let state;
    let received;
    do {
      state = await pointerDiagnostics(selector, point);
      received = state.event?.hitMatches && state.event.trusted && state.event.pointerType === 'mouse'
        && Math.abs(state.event.x - point.x) < 1 && Math.abs(state.event.y - point.y) < 1;
      if (received && state.hovered && state.visibility === 'visible' && state.focused) break;
      await delay(40);
    } while (Date.now() - started < 2000);
    expect({ received: Boolean(received), hovered: state.hovered, visibility: state.visibility, focused: state.focused },
      'CDP mouse did not reach the visible, focused target: ' + JSON.stringify(state))
      .toEqual({ received: true, hovered: true, visibility: 'visible', focused: true });
  }
  async function reflection(selector: string) {
    return call(`function(selector) {
      const layer = document.querySelector(selector).querySelector('.card-material-glare');
      const style = getComputedStyle(layer);
      const card = layer.closest('.deck-card');
      return { opacity: Number(style.opacity), display: style.display, willChange: style.willChange,
        layers: card ? getComputedStyle(card).willChange + ' / ' + getComputedStyle(layer, '::before').willChange : null,
        x: new DOMMatrix(getComputedStyle(layer, '::before').transform).m41 };
    }`, selector);
  }
  // 2026-11-09: polling with a 2s ceiling instead of fixed delays — a CI runner can be several times slower than a desktop.
  async function reflectionWhen(selector: string, accept: (value: Awaited<ReturnType<typeof reflection>>) => boolean, timeout = 2000) {
    const started = Date.now();
    let value = await reflection(selector);
    while (!accept(value) && Date.now() - started < timeout) {
      await delay(40);
      value = await reflection(selector);
    }
    if (!accept(value)) throw new Error('Reflection did not reach the expected state: '
      + JSON.stringify({ selector, value, pointer: await pointerDiagnostics(selector) }) + '\n' + errors.join('\n'));
    return value;
  }
  async function reflectionSettled(selector: string, timeout = 2000) {
    const started = Date.now();
    let value = await reflection(selector);
    while (Date.now() - started < timeout) {
      await delay(120);
      const next = await reflection(selector);
      if (next.x === value.x && next.opacity === value.opacity) return next;
      value = next;
    }
    throw new Error('Reflection did not settle: ' + JSON.stringify({ selector, value, pointer: await pointerDiagnostics(selector) }));
  }
  // 2026-11-09: sample throughout a hold, rather than sleeping and missing an intermediate drift.
  async function reflectionHolds(selector: string, accept: (value: Awaited<ReturnType<typeof reflection>>) => void, duration: number) {
    const started = Date.now();
    do {
      accept(await reflection(selector));
      await delay(40);
    } while (Date.now() - started < duration);
  }

  // 2026-11-08: the open card's band glows softly at rest and drifts towards the pointer.
  it('.card-preview-material-band keeps a soft glow at rest and drifts towards the pointer', async () => {
    const selector = '.card-preview-material-band';
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
    await render('hero');
    const rest = await reflectionSettled(selector);
    expect(rest.display).not.toBe('none');
    expect(rest.opacity).toBeCloseTo(.7, 2);
    await moveOver(selector, .15);
    await reflectionWhen(selector, value => value.opacity > rest.opacity);
    const left = await reflectionSettled(selector);
    expect(left.opacity).toBeGreaterThan(rest.opacity);
    await moveOver(selector, .85);
    await reflectionWhen(selector, value => value.x > left.x);
    const right = await reflectionSettled(selector);
    expect(right.x).toBeGreaterThan(left.x);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
    const after = await reflectionWhen(selector, value => Math.abs(value.opacity - .7) < .001);
    expect(after.opacity).toBeCloseTo(.7, 2);
    expect(after.x).toBeCloseTo(right.x, 1);
  }, 15000);

  // 2026-11-09: the gold parent bar above a Sub Card carries the open card's soft light, in the metal under its ink.
  it('.card-preview-parent glows softly at rest, brightens under the pointer and keeps the light under its ink', async () => {
    const selector = '.card-preview-parent';
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
    await render('task', { child: true });
    const rest = await reflectionSettled(selector);
    expect(rest.opacity).toBeCloseTo(.7, 2);
    expect(await call(`function(selector) { return getComputedStyle(document.querySelector(selector + ' > .card-material-glare')).zIndex; }`, selector)).toBe('-1');
    await moveOver(selector, .5);
    expect((await reflectionWhen(selector, value => value.opacity > rest.opacity)).opacity).toBeGreaterThan(rest.opacity);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
    expect((await reflectionWhen(selector, value => Math.abs(value.opacity - .7) < .001)).opacity).toBeCloseTo(.7, 2);
  }, 15000);

  // 2026-11-08: the tile ribbon rests beyond the right edge, sweeps in once,
  // moves against the pointer horizontally (with the tilt) and sweeps back out on leave.
  it.each(['.deck-card-space'])('%s ribbon sweeps in, follows the tilt, holds while paused and sweeps out on leave', async selector => {
    // Without a hovering fine pointer the ribbon is pinned by design; fail on the environment, not on the motion.
    expect(await evaluate(`matchMedia('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)').matches`)).toBe(true);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
    await render('hero');
    const rest = await reflectionSettled(selector);
    expect(rest.display).not.toBe('none');
    expect(rest.opacity).toBe(1);
    // 2026-11-09: compositing hints never change with hover — layers made and dropped per hover made the ink jump.
    expect(rest.willChange).toBe('auto');
    expect(rest.layers).toMatch(/ \/ auto$/);
    await moveOver(selector, .2);
    await reflectionWhen(selector, value => value.x < rest.x - 60);
    const left = await reflectionSettled(selector);
    expect(left.x).toBeLessThan(rest.x - 60);
    expect([left.willChange, left.layers]).toEqual([rest.willChange, rest.layers]);
    await moveOver(selector, .8);
    await reflectionWhen(selector, value => value.x < left.x - 30);
    const right = await reflectionSettled(selector);
    expect(right.x).toBeLessThan(left.x - 30);
    await reflectionHolds(selector, value => expect(value).toEqual(right), 1400);
    await moveOver(selector, .3);
    const reversed = await reflectionWhen(selector, value => value.x > right.x + 20);
    expect(reversed.x).toBeGreaterThan(right.x + 20);
    await reflectionSettled(selector);
    const before = await reflection(selector);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
    // The first sample that has moved is mid-sweep: the ribbon goes back to rest gradually, not in one jump.
    const leaving = await reflectionWhen(selector, value => value.x > before.x + 1);
    expect(leaving.x).toBeGreaterThan(before.x);
    expect(leaving.x).toBeLessThan(rest.x - 1);
    const idle = await reflectionWhen(selector, value => Math.abs(value.x - rest.x) < .05);
    expect(idle.x).toBeCloseTo(rest.x, 1);
    expect([idle.willChange, idle.layers]).toEqual([rest.willChange, rest.layers]);
  }, 15000);

  it.each([[115, 147], [180, 210]])('keeps both ribbon cuts on one diagonal across a %s × %s tile', async (width, height) => {
    await render('task', { child: true });
    await call(`function(width, height) {
      const style = document.querySelector('.deck-card').style;
      style.setProperty('--tile-width', width + 'px'); style.setProperty('--tile-height', height + 'px');
    }`, width, height);
    try {
      await moveOver('.deck-card-space', .6);
      await reflectionSettled('.deck-card-space');
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
    await reflectionSettled('.deck-card-space');
    expect((await reflection('.card-family-trigger')).opacity).toBeGreaterThan((await reflection('.deck-card-band')).opacity);
    for (const options of [{ checked: true }, { pending: true }]) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
      await render('hero', options);
      const rest = await reflectionSettled('.deck-card-space');
      await moveOver('.deck-card-space', .7);
      await reflectionHolds('.deck-card-space', value => expect(value.x).toBeCloseTo(rest.x, 1), 350);
    }
  });

  it('ignores touch and reduced motion and cancels a pointer frame when leaving immediately', async () => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
    await render('hero');
    // The tile's ribbon stays where it rests; the open card's band keeps its resting glow (0.7) instead of reacting.
    const tileRest = (await reflectionSettled('.deck-card-space')).x;
    const resting = (selector: string, value: Awaited<ReturnType<typeof reflection>>) => {
      if (selector === '.deck-card-space') expect(value.x).toBeCloseTo(tileRest, 1);
      else expect(value.opacity).toBeCloseTo(.7, 2);
    };
    for (const selector of ['.deck-card-space', '.card-preview-material-band']) {
      await call(`function(selector) { const el = document.querySelector(selector); el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'touch', clientX: 80, clientY: 80 })); }`, selector);
      await reflectionHolds(selector, value => resting(selector, value), 450);
      await call(`function(selector) { const el = document.querySelector(selector); el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse', clientX: 80, clientY: 80 })); el.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse', relatedTarget: document.body })); }`, selector);
      await reflectionHolds(selector, value => resting(selector, value), 450);
    }
    await setMotionPreference('reduce');
    try {
      // Under reduced motion the ribbon is still the band's material; it stays pinned where it rests.
      await moveOver('.deck-card-space', .8);
      expect((await reflection('.deck-card-space')).display).not.toBe('none');
      await reflectionHolds('.deck-card-space', value => resting('.deck-card-space', value), 350);
      // Under reduced motion the open card's glow is still part of the material; it just stops drifting.
      await moveOver('.card-preview-material-band', .8);
      expect((await reflection('.card-preview-material-band')).display).not.toBe('none');
      await reflectionHolds('.card-preview-material-band', value => resting('.card-preview-material-band', value), 350);
    } finally {
      await setMotionPreference('no-preference');
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
    }
    expect(await evaluate(`matchMedia('(prefers-reduced-motion: no-preference)').matches`)).toBe(true);
    expect(errors).toEqual([]);
  });
});
