import { openHeadlessBrowser, type HeadlessPage } from '../tools/layout-capture.ts';
import type { BrowserFixture } from './browser-files.ts';
import { browserFixtureUrl } from './browser-fixture.ts';

// 2026-11-10: a fixture's first load (document, scripts and its first requests) took over 10 s on a CI runner, while
// in-page waits settle in milliseconds; navigation readiness gets its own time budget instead of the in-page attempts.
const NAVIGATION_READY_MS = 30_000;

export function createBrowserSession(wait: { attempts?: number; intervalMs?: number; navigationMs?: number } = {}) {
  let page: HeadlessPage | undefined;
  const errors = () => page?.consoleErrors ?? [];
  // 2026-11-10: legacy suites consume CDP result bodies, while capture tools consume the full envelope.
  const send = async (method: string, params: object = {}, timeoutMs?: number): Promise<any> =>
    (await page!.send(method, params, timeoutMs)).result;
  const evaluate = (expression: string): Promise<any> => page!.evaluate(expression);
  const callFunction = (declaration: string, ...args: unknown[]): Promise<any> => page!.callFunction(declaration, ...args);
  const until = async (expression: string | (() => Promise<unknown>), attempts = wait.attempts ?? 100) => {
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (await (typeof expression === 'string' ? evaluate(expression) : expression())) return;
      await new Promise(resolve => setTimeout(resolve, wait.intervalMs ?? 50));
    }
    throw new Error('Timed out: ' + expression + '\n' + errors().join('\n'));
  };
  const close = async () => { await page?.close(); };
  const open = async (browserPath: string, options: {
    viewport?: { width: number; height: number; scale: number };
    extraArgs?: string[];
  } = {}) => {
    page = await openHeadlessBrowser(options.viewport, undefined, { browserPath, extraArgs: options.extraArgs });
  };
  const navigate = async (fixture: BrowserFixture, ready: string,
    attempts = Math.ceil((wait.navigationMs ?? NAVIGATION_READY_MS) / (wait.intervalMs ?? 50))) => {
    try {
      await send('Page.navigate', { url: browserFixtureUrl(fixture) });
      await until(ready, attempts);
    } catch (error) {
      try { await close(); } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Browser fixture and cleanup failed');
      }
      throw error;
    }
  };
  return { open, navigate, send, evaluate, callFunction, until, get errors() { return errors(); }, close };
}
