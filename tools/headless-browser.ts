import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { findBrowser, missingBrowserReason } from './browser-environment.ts';
import { createBrowserTemp, removeBrowserTemp, setBrowserTempPid } from './browser-temp.ts';
import { killBrowserTree, waitForExit, watchBrowserProfile } from './browser-watchdog.ts';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const REQUEST_TIMEOUT_MS = 30_000;

export function findHeadlessBrowser(): string {
  const browser = findBrowser();
  if (!browser) throw new Error(missingBrowserReason);
  return browser;
}

export interface HeadlessPage {
  send(method: string, params?: object, timeoutMs?: number): Promise<any>;
  evaluate(expression: string): Promise<any>;
  callFunction(functionDeclaration: string, ...args: unknown[]): Promise<any>;
  readonly consoleErrors: string[];
  close(): Promise<void>;
}

type PageChannel = Omit<HeadlessPage, 'close'>;
type Viewport = { width: number; height: number; scale: number };

async function pageTargetUrl(port: number, timeoutMs = 45_000, launchFailure?: () => Error | undefined): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const failure = launchFailure?.();
    if (failure) throw failure;
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) })).json() as { type: string; webSocketDebuggerUrl: string }[];
      const page = list.find(item => item.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* 2026-11-12: the HTTP endpoint can lag the browser process at startup. */ }
    await sleep(200);
  }
  throw new Error(`Browser did not expose a page target within ${timeoutMs / 1000} s on port ${port}`);
}

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

function wirePage(socket: WebSocket, requestTimeoutMs = REQUEST_TIMEOUT_MS): PageChannel {
  let sequence = 0;
  let executionContextId: number | undefined;
  const pending = new Map<number, { method: string; resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const consoleErrors: string[] = [];
  // 2026-11-12: a dead socket must reject all waiting requests and release their deadline timers.
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
      if (message.error) call.reject(new Error(`${call.method}: ${message.error.message ?? JSON.stringify(message.error)}`));
      else call.resolve(message);
      return;
    }
    if (message.method === 'Runtime.exceptionThrown') consoleErrors.push(String(message.params?.exceptionDetails?.exception?.description ?? message.params.exceptionDetails?.text ?? 'exception').split('\n')[0]);
    if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') consoleErrors.push((message.params.args ?? []).map((arg: { value?: unknown; description?: string }) => String(arg.value ?? arg.description ?? '')).join(' ').slice(0, 200));
  });
  const send = (method: string, params: object = {}, timeoutMs: number = requestTimeoutMs) => {
    const call = new Promise<any>((resolve, reject) => {
      if (socket.readyState !== WebSocket.OPEN) {
        reject(new Error(`${method}: the CDP socket is closed`));
        return;
      }
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method}: no CDP response within ${timeoutMs / 1000} s`));
      }, timeoutMs);
      pending.set(id, { method, resolve, reject, timer });
      try {
        socket.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        clearTimeout(timer);
        pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    // 2026-11-12: fire-and-forget Page.crash must not cause an unhandled rejection; awaiting callers still receive errors.
    call.catch(() => {});
    return call;
  };
  const evaluate = async (expression: string) => {
    const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (response.result?.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description ?? response.result.exceptionDetails.text);
    return response.result?.result?.value;
  };
  const callFunction = async (functionDeclaration: string, ...args: unknown[]) => {
    const response = await send('Runtime.callFunctionOn', { functionDeclaration, executionContextId,
      arguments: args.map(value => ({ value })), returnByValue: true, awaitPromise: true });
    if (response.result?.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description ?? response.result.exceptionDetails.text);
    return response.result?.result?.value;
  };
  return { send, evaluate, callFunction, consoleErrors };
}

async function enablePage(page: PageChannel, viewport?: Viewport): Promise<void> {
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  if (viewport) await page.send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: viewport.scale, mobile: false });
}

export async function connectToHeadlessBrowser(port: number, requestTimeoutMs = REQUEST_TIMEOUT_MS): Promise<HeadlessPage> {
  const socket = await openPageSocket(await pageTargetUrl(port));
  const page = wirePage(socket, requestTimeoutMs);
  try {
    await enablePage(page);
    return { ...page, close: async () => { socket.close(); } };
  } catch (error) {
    socket.close();
    throw error;
  }
}

export interface HeadlessBrowserOptions {
  browserPath?: string;
  extraArgs?: string[];
}

async function launchBrowser(options: HeadlessBrowserOptions, viewport?: Viewport, browserTarget = false) {
  const browserPath = options.browserPath ?? findHeadlessBrowser();
  const profile = await createBrowserTemp('deckmate-capture-');
  const windowArgs = viewport ? [`--window-size=${viewport.width},${viewport.height}`] : [];
  // 2026-11-12: desktop pointer/motion defaults must be independent of the host; touch and reduced-motion tests override them.
  const desktopArgs = ['--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4', '--force-prefers-no-reduced-motion'];
  let child: ChildProcess;
  try {
    child = spawn(browserPath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      ...windowArgs, ...desktopArgs, ...(options.extraArgs ?? []), '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'],
    // 2026-11-13: Chromium's scoped_dir/msedge scratch files must share the profile's cleanup lifetime.
    { stdio: 'ignore', detached: process.platform !== 'win32', windowsHide: true,
      env: { ...process.env, TEMP: profile, TMP: profile, TMPDIR: profile } });
  } catch (error) {
    await removeBrowserTemp(profile);
    throw error;
  }
  let launchError: Error | undefined;
  child.on('error', error => { launchError = error; });
  const launchFailure = () => {
    if (launchError) return launchError;
    if (child.exitCode !== null || child.signalCode !== null)
      return new Error(`Browser process exited early with code ${child.exitCode} (signal ${child.signalCode})`);
  };
  let stopWatching: (() => Promise<void>) | undefined;
  let socket: WebSocket | undefined;
  let closing: Promise<void> | undefined;
  const close = () => closing ??= (async () => {
    if (socket?.readyState === WebSocket.OPEN) {
      try { socket.send(JSON.stringify({ id: 1_000_000, method: 'Browser.close' })); } catch { /* 2026-11-12: a crashed page can already be detached. */ }
      await waitForExit(child, 500);
    }
    socket?.close();
    try {
      if (child.pid && child.exitCode === null && child.signalCode === null) await killBrowserTree(child.pid);
      if (child.pid) await waitForExit(child, 2000);
    } finally {
      await removeBrowserTemp(profile);
      await stopWatching?.();
    }
  })();
  try {
    if (child.pid) {
      await setBrowserTempPid(profile, child.pid);
      stopWatching = await watchBrowserProfile(profile, child.pid);
    }
    const deadline = Date.now() + 45_000;
    let port = 0;
    let endpoint = '';
    // 2026-11-12: OS-assigned CDP ports cannot collide with other test shards or concurrent captures.
    while (Date.now() < deadline) {
      const failure = launchFailure();
      if (failure) throw failure;
      try {
        const lines = readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').trim().split(/\r?\n/u);
        port = Number(lines[0]);
        endpoint = lines[1];
        if (port > 0 && endpoint?.startsWith('/devtools/browser/')) break;
      } catch (error) {
        // 2026-11-13: Chromium briefly locks the port file while publishing it on Windows; keep the existing startup deadline.
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT' && !(process.platform === 'win32' && code === 'EBUSY')) throw error;
      }
      await sleep(200);
    }
    if (!Number.isInteger(port) || port < 1 || !endpoint?.startsWith('/devtools/browser/'))
      throw new Error('Browser did not publish DevToolsActivePort within 45 s');
    let url = `ws://127.0.0.1:${port}${endpoint}`;
    if (!browserTarget) url = await pageTargetUrl(port, Math.max(0, deadline - Date.now()), launchFailure);
    socket = await openPageSocket(url);
    return { socket, url, profile, browserPath, pid: child.pid, close };
  } catch (error) {
    try { await close(); } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Browser startup and cleanup failed');
    }
    throw error;
  }
}

export interface SharedHeadlessBrowser {
  url: string;
  browserPath: string;
  extraArgs: string[];
}

export async function startSharedHeadlessBrowser(options: HeadlessBrowserOptions = {}) {
  const browser = await launchBrowser(options, undefined, true);
  const connection: SharedHeadlessBrowser = { url: browser.url, browserPath: browser.browserPath, extraArgs: options.extraArgs ?? [] };
  return { connection, profile: browser.profile, pid: browser.pid, close: browser.close };
}

let sharedBrowsers: SharedHeadlessBrowser[] = [];
const sharedPages = new Set<HeadlessPage>();

export function useSharedHeadlessBrowsers(browsers: SharedHeadlessBrowser[]) {
  if (sharedBrowsers.length) throw new Error('A shared browser scope is already active');
  sharedBrowsers = browsers;
  return async () => {
    sharedBrowsers = [];
    const closed = await Promise.allSettled([...sharedPages].map(page => page.close()));
    const errors = closed.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
    if (errors.length) throw new AggregateError(errors, 'Shared browser page cleanup failed');
  };
}

async function openIsolatedPage(browser: SharedHeadlessBrowser, viewport: Viewport | undefined, requestTimeoutMs: number): Promise<HeadlessPage> {
  const controlSocket = await openPageSocket(browser.url);
  const control = wirePage(controlSocket, requestTimeoutMs);
  let contextId: string | undefined;
  let socket: WebSocket | undefined;
  let page: HeadlessPage | undefined;
  let closing: Promise<void> | undefined;
  const close = () => closing ??= (async () => {
    try {
      if (contextId) await control.send('Target.disposeBrowserContext', { browserContextId: contextId });
    } finally {
      socket?.close();
      // 2026-11-12: disposeOnDetach also clears storage and permissions if a worker dies before its cleanup hooks.
      controlSocket.close();
      if (page) sharedPages.delete(page);
    }
  })();
  try {
    contextId = (await control.send('Target.createBrowserContext', { disposeOnDetach: true })).result.browserContextId;
    // 2026-11-12: preserve standalone focus and native window bounds, including after tests clear device emulation.
    const targetId = (await control.send('Target.createTarget', { url: 'about:blank', browserContextId: contextId,
      background: true, newWindow: true, width: viewport?.width, height: viewport?.height })).result.targetId;
    const url = new URL(browser.url);
    url.pathname = `/devtools/page/${targetId}`;
    socket = await openPageSocket(url.href);
    page = { ...wirePage(socket, requestTimeoutMs), close };
    await enablePage(page, viewport);
    sharedPages.add(page);
    return page;
  } catch (error) {
    try { await close(); } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Browser page startup and cleanup failed');
    }
    throw error;
  }
}

export async function openHeadlessBrowser(viewport?: Viewport, requestTimeoutMs = REQUEST_TIMEOUT_MS, options: HeadlessBrowserOptions = {}): Promise<HeadlessPage> {
  const browserPath = options.browserPath ?? findHeadlessBrowser();
  const shared = sharedBrowsers.find(browser => browser.browserPath === browserPath && JSON.stringify(browser.extraArgs) === JSON.stringify(options.extraArgs ?? []));
  if (shared) return openIsolatedPage(shared, viewport, requestTimeoutMs);
  const browser = await launchBrowser({ ...options, browserPath }, viewport);
  const page = wirePage(browser.socket, requestTimeoutMs);
  try {
    await enablePage(page, viewport);
    return { ...page, close: browser.close };
  } catch (error) {
    try { await browser.close(); } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Browser startup and cleanup failed');
    }
    throw error;
  }
}
