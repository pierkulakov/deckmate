import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { connectToHeadlessBrowser, openHeadlessBrowser } from '../tools/layout-capture.ts';
import { createBrowserSession } from './browser-session.ts';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
vi.mock('node:fs', async importOriginal => ({
  ...await importOriginal<typeof import('node:fs')>(),
  mkdtempSync: vi.fn(), existsSync: () => true,
}));
vi.mock('node:fs/promises', () => ({ rm: vi.fn() }));
vi.mock('./browser-fixture.ts', () => ({ browserFixtureUrl: (fixture: string) => `http://fixture/${fixture}/` }));

class BrowserProcess extends EventEmitter {
  pid = 12345;
  exitCode: number | null = null;
  signalCode: string | null = null;
  unref() {}
  end(code = 0) { this.exitCode = code; this.emit('exit', code); }
}

class PageSocket extends EventTarget {
  static OPEN = 1;
  static latest: PageSocket;
  readyState = 1;
  commands: { id: number; method: string; params: any }[] = [];
  respond = true;
  errorReply = false;
  runtimeValue = true;
  constructor(readonly url: string) {
    super();
    PageSocket.latest = this;
    queueMicrotask(() => this.dispatchEvent(new Event('open')));
  }
  message(data: object) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) })); }
  send(text: string) {
    const command = JSON.parse(text);
    this.commands.push(command);
    if (command.method === 'Browser.close') { browser.end(); this.close(); return; }
    if (!this.respond) return;
    queueMicrotask(() => {
      if (this.errorReply) { this.message({ id: command.id, error: { message: 'CDP rejected command' } }); return; }
      const result = command.method.startsWith('Runtime.') ? { result: { value: this.runtimeValue } } : { data: 'image' };
      this.message({ id: command.id, result });
    });
  }
  close() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
}

let browser: BrowserProcess;
beforeEach(() => {
  browser = new BrowserProcess();
  vi.mocked(spawn).mockImplementation((command: any) => {
    if (command === 'powershell') return new BrowserProcess() as any;
    if (command === 'taskkill') {
      const killer = new BrowserProcess();
      queueMicrotask(() => { browser.end(); killer.end(); });
      return killer as any;
    }
    return browser as any;
  });
  let profiles = 0;
  vi.mocked(mkdtempSync).mockImplementation(() => `profile-${++profiles}`);
  vi.mocked(rm).mockResolvedValue(undefined);
  vi.stubEnv('DECKMATE_BROWSER', 'default-browser');
  vi.stubGlobal('WebSocket', PageSocket);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => [{ type: 'page', webSocketDebuggerUrl: 'ws://page' }] }));
  vi.spyOn(process, 'kill').mockImplementation(() => { browser.end(); return true; });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('shared browser session', () => {
  it('keeps existing viewport/timeout callers and CDP envelopes unchanged', async () => {
    const page = await openHeadlessBrowser({ width: 900, height: 700, scale: 1.5 }, 1234);
    expect(spawn).toHaveBeenCalledWith('default-browser', expect.arrayContaining(['--window-size=900,700']), expect.anything());
    expect(PageSocket.latest.commands).toContainEqual(expect.objectContaining({ method: 'Emulation.setDeviceMetricsOverride',
      params: { width: 900, height: 700, deviceScaleFactor: 1.5, mobile: false } }));
    expect(await page.send('Page.captureScreenshot')).toMatchObject({ result: { data: 'image' } });
    await page.close();
  });

  it('uses the selected executable, feature flags, fixture readiness and result bodies', async () => {
    const session = createBrowserSession();
    await session.open('requireBrowser-result', { extraArgs: ['--pointer-flag'] });
    expect(spawn).toHaveBeenCalledWith('requireBrowser-result', expect.arrayContaining(['--pointer-flag']), expect.anything());
    expect(PageSocket.latest.commands.some(command => command.method === 'Emulation.setDeviceMetricsOverride')).toBe(false);
    await session.navigate('attachments-panel', 'window.ready');
    expect(PageSocket.latest.commands).toContainEqual(expect.objectContaining({ method: 'Page.navigate', params: { url: 'http://fixture/attachments-panel/' } }));
    expect(await session.send('Page.captureScreenshot')).toEqual({ data: 'image' });
    expect(await session.evaluate('true')).toBe(true);
    expect(await session.callFunction('(value) => value', 'quoted\\value')).toBe(true);
    expect(PageSocket.latest.commands.at(-1)?.params.arguments).toEqual([{ value: 'quoted\\value' }]);
    PageSocket.latest.message({ method: 'Runtime.exceptionThrown', params: { exceptionDetails: { text: 'fixture exception' } } });
    expect(session.errors).toEqual(['fixture exception']);
    await session.close();
  });

  it('keeps connected callers detached from process and profile ownership', async () => {
    const page = await connectToHeadlessBrowser(9222);
    expect(await page.send('Page.captureScreenshot')).toMatchObject({ result: { data: 'image' } });
    await page.close();
    expect(spawn).not.toHaveBeenCalled();
    expect(rm).not.toHaveBeenCalled();
    expect(PageSocket.latest.readyState).toBe(3);
  });

  it('retains readiness retry budgets and cleans up on readiness failure', async () => {
    vi.useFakeTimers();
    const session = createBrowserSession({ attempts: 2, intervalMs: 25 });
    await session.open('browser');
    const ready = vi.fn().mockResolvedValue(false);
    const failure = expect(session.until(ready)).rejects.toThrow('Timed out');
    await vi.advanceTimersByTimeAsync(50);
    await failure;
    expect(ready).toHaveBeenCalledTimes(2);
    PageSocket.latest.runtimeValue = false;
    const navigation = expect(session.navigate('attachments-panel', 'window.ready')).rejects.toThrow('Timed out: window.ready');
    await vi.advanceTimersByTimeAsync(50);
    await navigation;
    expect(rm).toHaveBeenCalled();
  });

  it('rejects early browser exit without waiting for the target deadline and removes its profile', async () => {
    browser.end(7);
    await expect(openHeadlessBrowser(undefined, undefined, { browserPath: 'browser' })).rejects.toThrow('exited early with code 7');
    expect(fetch).not.toHaveBeenCalled();
    expect(rm).toHaveBeenCalledWith('profile-1', expect.objectContaining({ recursive: true }));
  });

  it('detects exit while polling instead of spending the remaining startup budget', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
      browser.end(9);
      return { json: async () => [] };
    }));
    const failure = expect(openHeadlessBrowser()).rejects.toThrow('exited early with code 9');
    await vi.advanceTimersByTimeAsync(200);
    await failure;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(rm).toHaveBeenCalled();
  });

  it('retains both startup and cleanup errors', async () => {
    browser.end(7);
    const cleanupError = new Error('profile locked');
    vi.mocked(rm).mockRejectedValueOnce(cleanupError);
    const error = await openHeadlessBrowser().catch(error => error);
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.errors[0].message).toContain('exited early with code 7');
    expect(error.errors[1]).toBe(cleanupError);
  });

  it('rejects spawn failure and still removes its profile', async () => {
    vi.mocked(spawn).mockImplementationOnce(() => { queueMicrotask(() => browser.emit('error', new Error('spawn failed'))); return browser as any; });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('not listening')));
    await expect(openHeadlessBrowser(undefined, undefined, { browserPath: 'browser' })).rejects.toThrow('spawn failed');
    expect(rm).toHaveBeenCalled();
  });

  it('rejects CDP error replies', async () => {
    const session = createBrowserSession();
    await session.open('browser');
    PageSocket.latest.errorReply = true;
    await expect(session.send('Page.badCommand')).rejects.toThrow('Page.badCommand: CDP rejected command');
    await expect(session.navigate('attachments-panel', 'true')).rejects.toThrow('CDP rejected command');
    expect(rm).toHaveBeenCalled();
  });

  it.each(['close', 'error'])('rejects pending commands on socket %s', async event => {
    const page = await openHeadlessBrowser();
    PageSocket.latest.respond = false;
    const failure = expect(page.send('Page.wait')).rejects.toThrow(/CDP socket (closed|errored)/);
    PageSocket.latest.dispatchEvent(new Event(event));
    await failure;
    await page.close();
  });

  it('bounds silence after a command and Browser.close, then kills and cleans up once', async () => {
    vi.useFakeTimers();
    const page = await openHeadlessBrowser(undefined, 25);
    PageSocket.latest.respond = false;
    const failure = expect(page.send('Page.silent')).rejects.toThrow('Page.silent: no CDP response');
    await vi.advanceTimersByTimeAsync(25);
    await failure;
    vi.spyOn(PageSocket.latest, 'send').mockImplementation(() => {});
    const closing = page.close();
    const again = page.close();
    expect(again).toBe(closing);
    await vi.advanceTimersByTimeAsync(500);
    await closing;
    expect(rm).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    if (process.platform === 'win32') expect(spawn).toHaveBeenCalledWith('taskkill', ['/T', '/F', '/PID', '12345'], expect.anything());
    else expect(process.kill).toHaveBeenCalledWith(-12345, 'SIGKILL');
  });

  it('creates isolated profiles and reports removal failure instead of swallowing it', async () => {
    const first = await openHeadlessBrowser();
    await first.close();
    browser = new BrowserProcess();
    const second = await openHeadlessBrowser();
    const launches = vi.mocked(spawn).mock.calls.filter(([command]) => command === 'default-browser');
    expect(launches.map(([, args]) => (args as string[]).find(arg => arg.startsWith('--user-data-dir='))))
      .toEqual(['--user-data-dir=profile-1', '--user-data-dir=profile-2']);
    vi.mocked(rm).mockRejectedValueOnce(new Error('profile locked'));
    await expect(second.close()).rejects.toThrow('profile locked');
  });
});
