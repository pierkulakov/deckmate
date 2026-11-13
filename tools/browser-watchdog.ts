import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { processIsAlive, removeBrowserTemp } from './browser-temp.ts';

const executeFile = promisify(execFile);

export function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise(resolve => {
    const done = () => { clearTimeout(timer); child.off('exit', done); child.off('error', done); resolve(); };
    const timer = setTimeout(done, timeoutMs);
    child.once('exit', done);
    child.once('error', done);
  });
}

export async function killBrowserTree(pid: number): Promise<void> {
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true });
    await waitForExit(killer, 5000);
  } else {
    try { process.kill(-pid, 'SIGKILL'); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  }
}

async function browserUsesProfile(pid: number, profile: string): Promise<boolean> {
  // 2026-11-13: a recycled PID must not let a late watchdog terminate an unrelated process.
  let command: string;
  if (process.platform === 'win32') {
    const script = `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}').CommandLine`;
    command = (await executeFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 10_000 })).stdout;
  } else {
    command = (await executeFile('ps', ['-p', String(pid), '-o', 'args='], { timeout: 5000 })).stdout;
  }
  return command.includes('--user-data-dir=') && command.includes(profile);
}

async function cleanAbandonedProfile(profile: string, pid: number) {
  try {
    const info = await lstat(profile);
    if (info.isSymbolicLink() || !info.isDirectory()) return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  if (processIsAlive(pid)) {
    if (!await browserUsesProfile(pid, profile)) return;
    await killBrowserTree(pid);
    const deadline = Date.now() + 2000;
    while (processIsAlive(pid) && Date.now() < deadline) await delay(50);
    if (processIsAlive(pid)) return;
  }
  await removeBrowserTemp(profile);
}

export async function watchBrowserProfile(profile: string, browserPid: number): Promise<() => Promise<void>> {
  const watcher = spawn(process.execPath, [fileURLToPath(import.meta.url), profile, String(browserPid)], {
    detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true,
  });
  const stop = async () => {
    if (watcher.connected) watcher.send('stop', () => {});
    await waitForExit(watcher, 2000);
    if (watcher.exitCode === null && watcher.signalCode === null) {
      watcher.kill();
      await waitForExit(watcher, 2000);
    }
  };
  try {
    await new Promise<void>((resolve, reject) => {
      const clear = () => {
        clearTimeout(timer);
        watcher.off('message', ready);
        watcher.off('error', failed);
        watcher.off('exit', exited);
      };
      const ready = () => { clear(); resolve(); };
      const failed = (error: Error) => { clear(); reject(error); };
      const exited = () => failed(new Error('Browser watchdog exited before it was ready'));
      const timer = setTimeout(() => failed(new Error('Browser watchdog did not start within 10 s')), 10_000);
      watcher.once('message', ready);
      watcher.once('error', failed);
      watcher.once('exit', exited);
    });
    watcher.unref();
    watcher.channel?.unref();
    return stop;
  } catch (error) {
    await stop();
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const profile = process.argv[2];
  const pid = Number(process.argv[3]);
  if (!profile || !Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid browser watchdog arguments');
  let stopped = false;
  process.once('message', message => {
    if (message !== 'stop') return;
    stopped = true;
    process.disconnect?.();
  });
  const disconnected = () => {
    if (stopped) return;
    // 2026-11-13: IPC disconnect also arrives after SIGKILL, when coordinator exit hooks cannot run.
    void cleanAbandonedProfile(profile, pid).catch(() => { process.exitCode = 1; });
  };
  process.once('disconnect', disconnected);
  if (process.connected) process.send?.('ready');
  else disconnected();
}
