import type { ChildProcess } from 'node:child_process';

// 2026-11-09: parallel browser test files on a slow CI runner did not get a CDP
// page target within the old 10 s attempt budget, so poll by wall clock up to 45 s.
export async function waitForPageTarget(port: number, browser: ChildProcess, timeoutMs = 45_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (browser.exitCode !== null) {
      throw new Error(`Browser process exited early with code ${browser.exitCode} on port ${port}`);
    }
    try {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) }))
        .json() as { type: string; webSocketDebuggerUrl: string }[];
      const target = pages.find(page => page.type === 'page')?.webSocketDebuggerUrl;
      if (target) return target;
    } catch { /* Headless browser is starting. */ }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`Browser did not start within ${timeoutMs / 1000} s on port ${port}`);
}

// 2026-11-09: Browser.close can stay unanswered when the browser drops the socket first; an unbounded
// await then held afterAll until its 20 s limit on a Windows CI runner. The caller kills the process next.
export async function closeBrowserGently(send: (method: string) => Promise<unknown>, timeoutMs = 2000): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>(resolve => { timer = setTimeout(resolve, timeoutMs); });
  await Promise.race([send('Browser.close').then(() => undefined, () => undefined), timeout]);
  clearTimeout(timer);
}
