import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, readdir, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { requireBrowser } from './browser-environment.ts';
import { createBrowserTemp, processIsAlive, removeBrowserTemp } from '../tools/browser-temp.ts';
import { startSharedHeadlessBrowser } from '../tools/headless-browser.ts';
import { killBrowserTree, waitForExit } from '../tools/browser-watchdog.ts';

const browserPath = requireBrowser();
const browsers = [...new Set([browserPath, process.platform === 'win32'
  ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined].filter((value): value is string => Boolean(value && existsSync(value))))];

async function coordinator(browser: string): Promise<{ child: ChildProcess; profile: string; pid: number }> {
  const child = spawn(process.execPath, [fileURLToPath(new URL('./helpers/browser-crash-coordinator.ts', import.meta.url)), browser], {
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true,
  });
  let errors = '';
  child.stderr!.on('data', chunk => { errors += chunk; });
  const ready = new Promise<{ profile: string; pid: number }>((resolve, reject) => {
    child.once('message', message => resolve(message as any));
    child.once('error', reject);
    child.once('exit', code => reject(new Error(`Coordinator exited (${code}): ${errors}`)));
  });
  try { return { child, ...await ready }; } catch (error) { child.kill('SIGKILL'); throw error; }
}

describe.skipIf(!browserPath)('headless browser crash cleanup', () => {
  it.each(browsers)('removes the profile after killing the coordinator for %s', async executable => {
    const before = new Set(await readdir(tmpdir()));
    const browser = await coordinator(executable);
    try {
      expect(existsSync(browser.profile)).toBe(true);
      expect(processIsAlive(browser.pid)).toBe(true);
      const owner = JSON.parse(await readFile(path.join(browser.profile, '.deckmate-owner.json'), 'utf8'));
      expect(owner).toEqual({ pid: browser.child.pid, browserPid: browser.pid });
      browser.child.kill('SIGKILL');
      await waitForExit(browser.child, 2000);
      await expect.poll(() => existsSync(browser.profile), { timeout: 15_000, interval: 100 }).toBe(false);
      expect(processIsAlive(browser.pid)).toBe(false);
      expect((await readdir(tmpdir())).filter(name => !before.has(name) && /^(deckmate-capture-|scoped_dir|msedge_)/.test(name))).toEqual([]);
    } finally {
      if (browser.child.exitCode === null && browser.child.signalCode === null) browser.child.kill('SIGKILL');
      await waitForExit(browser.child, 2000);
      if (processIsAlive(browser.pid)) await killBrowserTree(browser.pid);
      await removeBrowserTemp(browser.profile);
    }
  });

  it('sweeps an old dead profile at browser startup while keeping a live owner and browser', async () => {
    const dead = spawn(process.execPath, ['-e', ''], { stdio: 'ignore', windowsHide: true });
    await waitForExit(dead, 2000);
    const abandoned = await createBrowserTemp('deckmate-capture-');
    const live = await startSharedHeadlessBrowser({ browserPath });
    let next: Awaited<ReturnType<typeof startSharedHeadlessBrowser>> | undefined;
    try {
      const past = new Date(Date.now() - 8 * 60 * 60 * 1000);
      await writeFile(path.join(abandoned, '.deckmate-owner.json'), JSON.stringify({ pid: dead.pid }));
      await utimes(abandoned, past, past);
      await utimes(live.profile, past, past);
      next = await startSharedHeadlessBrowser({ browserPath });
      expect(existsSync(abandoned)).toBe(false);
      expect(existsSync(live.profile)).toBe(true);
      expect(processIsAlive(live.pid!)).toBe(true);
    } finally {
      await next?.close();
      await live.close();
      await removeBrowserTemp(abandoned);
    }
  });
});
