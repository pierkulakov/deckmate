import { randomUUID } from 'node:crypto';
import { lstat, mkdtemp, readFile, readdir, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

type BrowserTempPrefix = 'deckmate-capture-' | 'deckmate-browser-fixtures-';
interface Owner { pid: number; browserPid?: number }
const ownerFile = '.deckmate-owner.json';
const leasePrefix = '.deckmate-reader-';
const staleAfterMs = 6 * 60 * 60 * 1000;

function ownedPath(directory: string, root: string): boolean {
  return path.dirname(path.resolve(directory)) === path.resolve(root)
    && /^(deckmate-capture-|deckmate-browser-fixtures-)[a-zA-Z0-9]+$/.test(path.basename(directory));
}

export function processIsAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) {
    // 2026-11-13: denied access is not evidence that another shard's owner has exited.
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

async function readOwner(directory: string): Promise<Owner | undefined> {
  const info = await lstat(directory);
  if (info.isSymbolicLink() || !info.isDirectory()) return;
  const filename = path.join(directory, ownerFile);
  const marker = await lstat(filename);
  if (marker.isSymbolicLink() || !marker.isFile()) return;
  const owner = JSON.parse(await readFile(filename, 'utf8')) as Owner;
  if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0) return;
  if (owner.browserPid !== undefined && (!Number.isSafeInteger(owner.browserPid) || owner.browserPid <= 0)) return;
  return owner;
}

async function hasLiveReader(directory: string): Promise<boolean> {
  const names = await readdir(directory);
  return names.some(name => {
    const match = /^\.deckmate-reader-(\d+)-/.exec(name);
    return match !== null && processIsAlive(Number(match[1]));
  });
}

async function removeTree(filename: string, root = false): Promise<void> {
  try {
    const info = await lstat(filename);
    // 2026-11-13: junctions are links too; unlink them without visiting their targets.
    if (info.isSymbolicLink()) {
      if (root) throw new Error(`Refusing to remove a linked browser temporary directory: ${filename}`);
      await unlink(filename);
    } else if (info.isDirectory()) {
      const entries = await readdir(filename);
      // 2026-11-13: a failed deletion must retain its ownership marker for the next sweep.
      entries.sort((a, b) => Number(a === ownerFile) - Number(b === ownerFile));
      for (const entry of entries) await removeTree(path.join(filename, entry));
      await rmdir(filename);
    } else {
      if (root) throw new Error(`Not a browser temporary directory: ${filename}`);
      await unlink(filename);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

export async function removeBrowserTemp(directory: string, root = tmpdir()): Promise<void> {
  if (!ownedPath(directory, root)) throw new Error(`Not an owned browser temporary path: ${directory}`);
  for (let attempt = 0; ; attempt++) {
    try { await removeTree(directory, true); return; } catch (error) {
      // 2026-11-13: Chromium can release profile handles shortly after its process tree exits.
      if (attempt >= 15 || !['EBUSY', 'ENOTEMPTY', 'EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      await delay(100 * (attempt + 1));
    }
  }
}

export async function cleanupBrowserTemps(root = tmpdir()): Promise<void> {
  let entries: string[];
  try { entries = await readdir(root); } catch { return; }
  const cutoff = Date.now() - staleAfterMs;
  for (const entry of entries) {
    const directory = path.join(root, entry);
    if (!ownedPath(directory, root)) continue;
    try {
      const info = await lstat(directory);
      if (info.isSymbolicLink() || !info.isDirectory() || info.mtimeMs > cutoff) continue;
      const owner = await readOwner(directory);
      // 2026-11-13: unmarked/invalid directories cannot prove ownership; leave legacy live runs alone.
      if (!owner || processIsAlive(owner.pid) || (owner.browserPid && processIsAlive(owner.browserPid))) continue;
      if (await hasLiveReader(directory)) continue;
      await removeBrowserTemp(directory, root);
    } catch { /* 2026-11-13: a concurrent sweep or a locked orphan must not prevent another shard from starting. */ }
  }
}

export async function createBrowserTemp(prefix: BrowserTempPrefix, root = tmpdir()): Promise<string> {
  await cleanupBrowserTemps(root);
  const directory = await mkdtemp(path.join(root, prefix));
  try {
    await writeFile(path.join(directory, ownerFile), JSON.stringify({ pid: process.pid }), { flag: 'wx' });
    return directory;
  } catch (error) {
    await removeBrowserTemp(directory, root);
    throw error;
  }
}

export async function setBrowserTempPid(directory: string, browserPid: number): Promise<void> {
  const owner = await readOwner(directory);
  if (owner?.pid !== process.pid) throw new Error(`Browser temporary directory has a different owner: ${directory}`);
  await writeFile(path.join(directory, ownerFile), JSON.stringify({ ...owner, browserPid }));
}

export async function retainBrowserTemp(directory: string): Promise<() => Promise<void>> {
  // 2026-11-13: a shared build can outlive its builder while another shard still serves it.
  const owner = await readOwner(directory);
  if (!owner) throw new Error(`Browser temporary directory has no owner: ${directory}`);
  const filename = path.join(directory, `${leasePrefix}${process.pid}-${randomUUID()}`);
  await writeFile(filename, '', { flag: 'wx' });
  return async () => {
    try { await unlink(filename); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  };
}
