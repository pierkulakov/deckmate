// Layout capture for UI parity work: opens a page in headless Edge/Chrome, optionally clicks through to a view,
// then saves a layout tree (boxes + computed styles) and a PNG for numerical layout comparisons.
//
//   npm run capture -- --url "http://127.0.0.1:4320/?view=deck&catalogSource=sandbox" --out tmp/overview
//   npm run capture -- --url ... --step "click:Characters, Asset" --step "wait:800" --out tmp/deck-open
//
// --step click:<text> clicks the first visible element whose aria-label or own text starts with <text>.
// Writes <out>.json and <out>.png. Viewport defaults to 1700x1000 at DPR 1.5 for consistent comparisons.
// Economy (2026-11-04): --clip <css selector> saves only that element's box; --dpr 1 for looking, not for parity numbers.
// Console errors and uncaught exceptions are counted from the first navigation and printed, so a look is needed only when numbers say so.
// 2026-11-09: the headless-browser harness (lookup, launch, CDP session, teardown) is exported for tools/launcher-capture.ts,
// so the repository keeps one browser driver (desktop/README.md, "Development loop").
// 2026-11-09: every CDP request has a deadline, error replies reject, and a dead socket fails all waiting calls —
// a browser that stops answering ends the run instead of hanging it forever.
import { spawn, type ChildProcess } from 'node:child_process';
import { environmentValue } from '../server/environment.ts';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** The first Edge/Chrome on this machine; DECKMATE_BROWSER (or legacy FREETION_BROWSER) overrides the list. */
export function findHeadlessBrowser(): string {
  const browsers = [environmentValue('BROWSER'), 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  const browser = browsers.find(candidate => candidate && existsSync(candidate));
  if (!browser) throw new Error('No Edge/Chrome found; set DECKMATE_BROWSER.');
  return browser;
}

/** One headless page over CDP. For openHeadlessBrowser close() ends the browser tree and removes the temporary
 * profile; for connectToHeadlessBrowser it only detaches and leaves the app running. */
export interface HeadlessPage {
  /** A CDP command; timeoutMs (2026-11-09, default 30 s) bounds the wait for the reply. */
  send(method: string, params?: object, timeoutMs?: number): Promise<any>;
  evaluate(expression: string): Promise<any>;
  callFunction(functionDeclaration: string, ...args: unknown[]): Promise<any>;
  readonly consoleErrors: string[];
  close(): Promise<void>;
}

type PageChannel = Omit<HeadlessPage, 'close'>;

/** 2026-11-09: a browser or renderer that stops answering must fail the run instead of hanging it —
 * every CDP request waits at most this long (overridable per connection and per call). */
const REQUEST_TIMEOUT_MS = 30_000;

/** Polls a CDP endpoint on 127.0.0.1:<port> until it exposes a page target.
 * 2026-11-09: a wall-clock deadline and a 2 s abort per /json/list request (the pattern of
 * tests/browser-target.ts, waitForPageTarget) — an endpoint that never answers fails fast. */
async function pageTargetUrl(port: number, timeoutMs = 45_000, launchFailure?: () => Error | undefined): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const failure = launchFailure?.();
    if (failure) throw failure;
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) })).json() as { type: string; webSocketDebuggerUrl: string }[];
      const page = list.find(item => item.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* browser still starting */ }
    await sleep(200);
  }
  throw new Error(`Browser did not expose a page target within ${timeoutMs / 1000} s on port ${port}`);
}

/** Opens a page's CDP socket and waits for 'open'.
 * 2026-11-09: a refused or silent endpoint never fires 'open'; the wait rejects instead of hanging forever. */
async function openPageSocket(url: string, timeoutMs = 10_000): Promise<WebSocket> {
  const socket = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`CDP socket ${url} did not open within ${timeoutMs / 1000} s`));
    }, timeoutMs);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error(`CDP socket ${url} failed to open`)); }, { once: true });
  });
  return socket;
}

/** The CDP session shared by launched and connected pages: framing, evaluate/callFunction, console errors.
 * 2026-11-09: every request has a deadline, CDP error replies reject, and socket death fails the waiting calls. */
function wirePage(socket: WebSocket, requestTimeoutMs = REQUEST_TIMEOUT_MS): PageChannel {
  let sequence = 0;
  let executionContextId: number | undefined;
  const pending = new Map<number, { method: string; resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const consoleErrors: string[] = [];
  // 2026-11-09: a closed or errored socket must fail every waiting call at once, and no timer may outlive its call.
  const failPending = (error: Error) => {
    for (const [id, call] of pending) {
      clearTimeout(call.timer);
      pending.delete(id);
      call.reject(error);
    }
  };
  socket.addEventListener('close', () => failPending(new Error('The CDP socket closed before the response arrived')));
  socket.addEventListener('error', () => failPending(new Error('The CDP socket errored before the response arrived')));
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    if (message.method === 'Runtime.executionContextCreated' && message.params.context.auxData?.isDefault)
      executionContextId = message.params.context.id;
    if (message.id && pending.has(message.id)) {
      const call = pending.get(message.id)!;
      pending.delete(message.id);
      clearTimeout(call.timer);
      // 2026-11-09: CDP reports failures on the success shape with an `error` field — reject instead of resolving
      // to a phantom response whose `result` readers would read as undefined.
      if (message.error) call.reject(new Error(`${call.method}: ${message.error.message ?? JSON.stringify(message.error)}`));
      else call.resolve(message);
      return;
    }
    if (message.method === 'Runtime.exceptionThrown') consoleErrors.push(String(message.params?.exceptionDetails?.exception?.description ?? message.params.exceptionDetails?.text ?? 'exception').split('\n')[0]);
    if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') consoleErrors.push((message.params.args ?? []).map((arg: { value?: unknown; description?: string }) => String(arg.value ?? arg.description ?? '')).join(' ').slice(0, 200));
  });
  // 2026-11-09: send() can now reject; a caller that discards the result (desktop-smoke.ts fires Page.crash
  // without awaiting) must not die of an unhandled rejection. The no-op catch marks this very promise handled
  // and changes nothing for callers that await it — they still see the throw.
  const send = (method: string, params: object = {}, timeoutMs: number = requestTimeoutMs) => {
    const call = new Promise<any>((resolve, reject) => {
      if (socket.readyState !== WebSocket.OPEN) {
        reject(new Error(`${method}: the CDP socket is closed`));
        return;
      }
      const id = ++sequence;
      // 2026-11-09: a renderer that dies mid-command never answers; the deadline rejects with the method name in the message.
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method}: no CDP response within ${timeoutMs / 1000} s`));
      }, timeoutMs);
      pending.set(id, { method, resolve, reject, timer });
      try {
        socket.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        // The socket can start closing between the readyState check above and the send.
        clearTimeout(timer);
        pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    call.catch(() => {});
    return call;
  };
  const evaluate = async (expression: string) => {
    const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (response.result?.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description ?? response.result.exceptionDetails.text);
    return response.result?.result?.value;
  };
  // 2026-11-09: values cross into the page as callFunctionOn arguments, not as text baked into the evaluated code
  // (CodeQL js/bad-code-sanitization flags JSON.stringify interpolation).
  const callFunction = async (functionDeclaration: string, ...args: unknown[]) => {
    const response = await send('Runtime.callFunctionOn', { functionDeclaration, executionContextId,
      arguments: args.map(value => ({ value })), returnByValue: true, awaitPromise: true });
    if (response.result?.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description ?? response.result.exceptionDetails.text);
    return response.result?.result?.value;
  };
  return { send, evaluate, callFunction, consoleErrors };
}

async function enablePage(page: PageChannel, viewport?: { width: number; height: number; scale: number }): Promise<void> {
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  if (viewport) await page.send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: viewport.scale, mobile: false });
}

/**
 * Connects to a CDP endpoint that is already listening on 127.0.0.1:<port> — the desktop shell
 * started with DECKMATE_DESKTOP_CDP_PORT. Unlike openHeadlessBrowser this owns no browser process,
 * so close() only detaches and leaves the app running (tools/desktop-smoke.ts, 2026-11-09).
 */
export async function connectToHeadlessBrowser(port: number, requestTimeoutMs = REQUEST_TIMEOUT_MS): Promise<HeadlessPage> {
  const socket = await openPageSocket(await pageTargetUrl(port));
  const page = wirePage(socket, requestTimeoutMs);
  await enablePage(page);
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    socket.close();
  };
  return { ...page, close };
}

export interface HeadlessBrowserOptions {
  // 2026-11-10: tests keep their authoritative requireBrowser discovery and Chromium feature flags.
  browserPath?: string;
  extraArgs?: string[];
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise(resolve => {
    const done = () => { clearTimeout(timer); child.off('exit', done); child.off('error', done); resolve(); };
    const timer = setTimeout(done, timeoutMs);
    child.once('exit', done);
    child.once('error', done);
  });
}

export async function openHeadlessBrowser(viewport?: { width: number; height: number; scale: number }, requestTimeoutMs = REQUEST_TIMEOUT_MS, options: HeadlessBrowserOptions = {}): Promise<HeadlessPage> {
  const browser = options.browserPath ?? findHeadlessBrowser();
  const port = 9300 + Math.floor(Math.random() * 500);
  const profile = mkdtempSync(path.join(tmpdir(), 'deckmate-capture-'));
  const windowArgs = viewport ? [`--window-size=${viewport.width},${viewport.height}`] : [];
  // 2026-11-10: a headless Chrome on a Linux runner sees no pointing device and reports (hover: none), and a Windows runner
  // with OS animations off reports (prefers-reduced-motion: reduce), so hover, focus and motion checks took other branches
  // there and passed only on desktops. Every page starts as a desktop with a fine hovering pointer and motion allowed;
  // a check of the touch layout or of reduced motion emulates it explicitly.
  const desktopArgs = ['--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4', '--force-prefers-no-reduced-motion'];
  const child = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', ...windowArgs, ...desktopArgs, ...(options.extraArgs ?? []), `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', detached: process.platform !== 'win32' });
  let launchError: Error | undefined;
  child.on('error', error => { launchError = error; });
  const launchFailure = () => {
    if (launchError) return launchError;
    if (child.exitCode !== null || child.signalCode !== null)
      return new Error(`Browser process exited early with code ${child.exitCode} (signal ${child.signalCode}) on port ${port}`);
  };
  // 2026-11-04: finally does not run when only this process is killed (TaskStop, an agent's timeout) and the headless tree stayed
  // alive; a detached watchdog waits for this process and ends the browser tree, checking the PID still belongs to a browser.
  if (process.platform === 'win32' && child.pid) {
    const watch = 'Wait-Process -Id ' + process.pid + ' -ErrorAction SilentlyContinue; $b = Get-Process -Id ' + child.pid + " -ErrorAction SilentlyContinue; if ($b -and $b.ProcessName -match 'msedge|chrome') { taskkill /T /F /PID " + child.pid + ' | Out-Null }';
    spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', watch], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  }
  let socket: WebSocket | undefined;
  let closing: Promise<void> | undefined;
  const close = () => closing ??= (async () => {
    // 2026-11-04: child.kill() on Windows ends only the launcher; the headless browser tree stayed alive (98 orphans, 10 GB).
    // Ask the browser to close over CDP first, then kill the whole process tree.
    if (socket && socket.readyState === WebSocket.OPEN) {
      try { socket.send(JSON.stringify({ id: 1_000_000, method: 'Browser.close' })); } catch { /* the page may already be gone */ }
      await waitForExit(child, 500);
    }
    try {
      socket?.close();
    } finally {
      // 2026-11-10: wait for tree termination before retrying profile removal; cleanup failure must not look successful.
      try {
        if (process.platform === 'win32' && child.pid) {
          const killer = spawn('taskkill', ['/T', '/F', '/PID', String(child.pid)], { stdio: 'ignore' });
          await waitForExit(killer, 5000);
        } else if (child.pid) {
          try { process.kill(-child.pid, 'SIGKILL'); } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
          }
        }
        if (child.pid) await waitForExit(child, 2000);
      } finally {
        await rm(profile, { recursive: true, force: true, maxRetries: 15, retryDelay: 100 });
      }
    }
  })();
  try {
    socket = await openPageSocket(await pageTargetUrl(port, 45_000, launchFailure));
    const page = wirePage(socket, requestTimeoutMs);
    await enablePage(page, viewport);
    return { ...page, close };
  } catch (error) {
    try { await close(); } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Browser startup and cleanup failed');
    }
    throw error;
  }
}

// Keep the tree format stable so captures remain comparable.
const walker = String.raw`(() => {
  const R = n => Math.round(n * 10) / 10;
  const keep = ['backgroundColor','color','fontSize','fontWeight','fontFamily','lineHeight','letterSpacing','textTransform','borderRadius','borderTopWidth','borderTopColor','borderLeftWidth','borderLeftColor','boxShadow','paddingTop','paddingRight','paddingBottom','paddingLeft','gap','opacity','backgroundImage','display','flexDirection','position','cursor','transform','filter','transition'];
  const defaults = {backgroundColor:'rgba(0, 0, 0, 0)',borderRadius:'0px',borderTopWidth:'0px',borderLeftWidth:'0px',boxShadow:'none',paddingTop:'0px',paddingRight:'0px',paddingBottom:'0px',paddingLeft:'0px',gap:'normal',opacity:'1',backgroundImage:'none',position:'static',cursor:'auto',transform:'none',filter:'none',letterSpacing:'normal',textTransform:'none',transition:'all 0s ease 0s'};
  const inherit = ['color','fontSize','fontWeight','fontFamily','lineHeight','cursor','letterSpacing','textTransform'];
  const walk = (el, depth, ps) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'contents') { const kids = []; for (const ch of el.children) { const k = walk(ch, depth + 1, ps); if (k) kids.push(k); } return kids.length ? { t: el.tagName.toLowerCase(), b: [0, 0, 0, 0], contents: true, k: kids } : null; }
    const r = el.getBoundingClientRect();
    // 2026-11-04: some apps put modals into a zero-size container — keep the children of tiny boxes, drop only the box itself.
    if (r.width < 4 || r.height < 4) { if (depth >= 50) return null; const kids = []; for (const ch of el.children) { const k = walk(ch, depth + 1, ps); if (k) kids.push(k); } return kids.length ? { t: el.tagName.toLowerCase(), b: [R(r.x), R(r.y), R(r.width), R(r.height)], tiny: true, k: kids } : null; }
    if (r.bottom < -50 || r.top > innerHeight * 1.5) return null;
    if (cs.display === 'none' || cs.visibility === 'hidden') return null;
    const s = {};
    for (const k of keep) { const v = cs[k]; if (defaults[k] === v) continue; if (k === 'borderTopColor' && cs.borderTopWidth === '0px') continue; if (k === 'borderLeftColor' && cs.borderLeftWidth === '0px') continue; if (ps && inherit.includes(k) && ps[k] === v) continue; s[k] = k === 'backgroundImage' ? v.slice(0, 160) : (k === 'transition' ? v.slice(0, 120) : v); }
    const node = { t: el.tagName.toLowerCase(), b: [R(r.x), R(r.y), R(r.width), R(r.height)] };
    const cls = typeof el.className === 'string' ? el.className : ''; if (cls) node.c = cls.slice(0, 100);
    const aria = el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('data-tooltip'); if (aria) node.a = aria.slice(0, 60);
    if (Object.keys(s).length) node.s = s;
    const txt = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ').trim(); if (txt) node.x = txt.slice(0, 70);
    if (el.tagName === 'svg' || el.tagName === 'IMG') { if (el.tagName === 'IMG') node.src = (el.currentSrc || '').slice(-80); return node; }
    if (depth < 50) { const kids = []; for (const ch of el.children) { const k = walk(ch, depth + 1, cs); if (k) kids.push(k); } if (kids.length) node.k = kids; }
    return node;
  };
  return JSON.stringify({ url: location.href, vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio, at: new Date().toISOString(), scrollY, tree: walk(document.body, 0, null) });
})()`;

const clicker = (text: string) => `(() => {
  const wanted = ${JSON.stringify(text)};
  const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const own = el => [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ').trim();
  const el = [...document.querySelectorAll('button, a, [role=button], [role=tab], input, label, span, div, h1, h2, h3, strong')]
    .find(el => visible(el) && ((el.getAttribute('aria-label') || '').startsWith(wanted) || own(el).startsWith(wanted)));
  if (!el) return 'not found: ' + wanted;
  (el.closest('button, a, [role=button], [role=tab]') || el).click();
  return 'clicked: ' + wanted;
})()`;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const option = (name: string, fallback?: string) => { const index = argv.indexOf('--' + name); return index >= 0 ? argv[index + 1] : fallback; };
  const steps: string[] = option('steps') ? JSON.parse(readFileSync(option('steps')!, 'utf8')) : argv.flatMap((value, index) => argv[index - 1] === '--step' ? [value] : []);
  const url = option('url');
  const out = option('out');
  if (!url || !out) { console.error('Usage: npm run capture -- --url <url> --out <path-without-ext> [--step click:<text>] [--step wait:<ms>]'); process.exit(2); }
  const width = Number(option('width', '1700'));
  const height = Number(option('height', '1000'));
  const scale = Number(option('dpr', '1.5'));
  const settle = Number(option('wait', '1500'));
  const colorScheme = option('color-scheme');
  if (colorScheme && colorScheme !== 'dark' && colorScheme !== 'light') throw new Error('--color-scheme must be dark or light');

  let page: HeadlessPage;
  try { page = await openHeadlessBrowser({ width, height, scale }); }
  catch (error) { console.error(error instanceof Error ? error.message : error); process.exit(2); }
  let mouseHeld = false;
  let mousePoint = { x: 0, y: 0 };
  async function capture(destination: string) {
    const tree = await page.evaluate(walker);
    mkdirSync(path.dirname(path.resolve(destination)), { recursive: true });
    writeFileSync(destination + '.json', tree);
    const shot = await page.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(destination + '.png', Buffer.from(shot.result.data, 'base64'));
    console.log('saved ' + destination + '.json and .png');
  }

  try {
    if (colorScheme) await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: colorScheme }] });
    const preload = option('preload');
    if (preload) await page.send('Page.addScriptToEvaluateOnNewDocument', { source: readFileSync(preload, 'utf8') });
    await page.send('Page.navigate', { url });
    await sleep(settle);
    for (const step of steps) {
      if (step.startsWith('wait:')) await sleep(Number(step.slice(5)));
      else if (step.startsWith('click:')) { console.log(await page.evaluate(clicker(step.slice(6)))); await sleep(700); }
      else if (step.startsWith('eval:')) console.log(await page.evaluate(step.slice(5)));
      // 2026-11-05: CDP input keeps the real pointer held for a mid-drag capture; DOM PointerEvents do not drive @dnd-kit faithfully.
      else if (step.startsWith('capture:')) await capture(step.slice(8));
      else if (step === 'mouse-down' || step === 'mouse-up') {
        mouseHeld = step === 'mouse-down';
        await page.send('Input.dispatchMouseEvent', { type: mouseHeld ? 'mousePressed' : 'mouseReleased', ...mousePoint, button: 'left', buttons: mouseHeld ? 1 : 0, clickCount: 1 });
        await sleep(100);
      }
      else if (step.startsWith('key:')) {
        const key = step.slice(4);
        const codes: Record<string, number> = { Enter: 13, Escape: 27, Space: 32, ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39 };
        // 2026-11-06: Enter needs its character event as well as the key code for native button activation in Chromium.
        for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key: key === 'Space' ? ' ' : key, code: key, windowsVirtualKeyCode: codes[key], text: type === 'keyDown' && key === 'Enter' ? '\r' : undefined });
        await sleep(150);
      }
      // hover:<selector>@<x>,<y> — the real mouse moves to that fraction of the element (0..1), so :hover and pointer handlers run.
      else if (step.startsWith('hover:')) {
        const [selector, at = '.5,.5'] = step.slice(6).split('@');
        const [fx, fy] = at.split(',').map(Number);
        const point = await page.callFunction(`(selector, scroll, fx, fy) => { const el = document.querySelector(selector); if (!el) return null;
          if (scroll) el.scrollIntoView({ block: 'center', behavior: 'instant' });
          const r = el.getBoundingClientRect(); return { x: r.x + r.width * fx, y: r.y + r.height * fy }; }`, selector, !mouseHeld, fx, fy);
        if (!point) console.log('not found: ' + selector);
        // Several moves on the way in: pointermove handlers that ease toward the pointer see a real path, not one jump.
        else for (let index = 1; index <= 6; index += 1) { mousePoint = { x: point.x - (6 - index) * 4, y: point.y - (6 - index) * 3 }; await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...mousePoint, buttons: mouseHeld ? 1 : 0 }); await sleep(30); }
        await sleep(700);
      }
    }
    const tree = await page.evaluate(walker);
    mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    writeFileSync(out + '.json', tree);
    const clipSelector = option('clip');
    const clip = clipSelector ? await page.callFunction(`selector => { const el = document.querySelector(selector); if (!el) return null;
      const r = el.getBoundingClientRect(); return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: Math.min(r.width, innerWidth), height: Math.min(r.height, innerHeight), scale: 1 }; }`, clipSelector) : null;
    if (clipSelector && !clip) console.log('clip not found: ' + clipSelector + ' — saving the whole viewport');
    const shot = await page.send('Page.captureScreenshot', clip ? { format: 'png', clip } : { format: 'png' });
    writeFileSync(out + '.png', Buffer.from(shot.result.data, 'base64'));
    console.log(`saved ${out}.json (${tree.length} bytes) and ${out}.png${clip ? ` (clip ${Math.round(clip.width)}x${Math.round(clip.height)})` : ''}`);
    console.log(`console errors: ${page.consoleErrors.length}${page.consoleErrors.length ? ' — ' + page.consoleErrors.slice(0, 3).join(' | ') : ''}`);
  } finally {
    await page.close();
  }
}

// Only a direct run (node tools/layout-capture.ts) captures; tools/launcher-capture.ts imports the harness instead.
const invokedDirectly = () => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
};

if (invokedDirectly()) await main();
