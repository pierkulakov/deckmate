import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { BigIntStats } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { CatalogError } from './catalog-error.ts';
import { defineText, serverText } from './i18n.ts';
import { prepareCoordinationDirectory, processIsAlive, projectCacheFile, publishCoordinationFile, readCoordinationFile } from './project-cache.ts';
import { sameIdentity } from './guarded-files.ts';

const messages = defineText({
  busy: 'Another Deckmate process is writing this project; retry.',
  stalled: (filename: string) => `Another Deckmate process has held the project write lock for over two minutes: ${filename}. Check and stop that process, then remove this lock file before retrying; it was not removed automatically.`,
  recovery: (filename: string) => `The project write lock is being recovered: ${filename}. If the recovery process has exited, remove ${filename}.reap before retrying.`,
  acquireFailed: 'Could not acquire the project write lock. No changes were saved; check the cache before retrying.',
  releaseFailed: 'Could not release the project write lock. Check the catalog and cache before retrying; changes may have been saved.',
}, {
  busy: 'Другой процесс Deckmate записывает этот проект; повторите попытку.',
  stalled: (filename: string) => `Другой процесс Deckmate удерживает блокировку записи проекта более двух минут: ${filename}. Проверьте и остановите этот процесс, затем удалите этот файл блокировки перед повтором; автоматически он не удалён.`,
  recovery: (filename: string) => `Восстанавливается блокировка записи проекта: ${filename}. Если процесс восстановления завершился, удалите ${filename}.reap перед повтором.`,
  acquireFailed: 'Не удалось получить блокировку записи проекта. Изменения не сохранены; проверьте кэш перед повтором.',
  releaseFailed: 'Не удалось снять блокировку записи проекта. Проверьте каталог и кэш перед повтором; изменения могли сохраниться.',
});

interface Owner { pid: number; startedAt: number; token: string }
interface HeldLock { filename: string; active: boolean }
interface OwnerSnapshot { bytes: Buffer; stat: BigIntStats; mtimeMs: number; owner: Owner | null }
const heldLocks = new AsyncLocalStorage<HeldLock[]>();
const stalledLockMs = 120_000;

export interface WriteLockOptions { timeoutMs?: number; retryMs?: number; staleMs?: number; now?: () => number }

function isContention(error: unknown): boolean {
  return ['EEXIST', 'EPERM', 'EACCES', 'EBUSY'].includes((error as NodeJS.ErrnoException).code ?? '');
}

async function readOwner(filename: string): Promise<OwnerSnapshot | null> {
  const snapshot = await readCoordinationFile(filename, { volatile: true });
  if (!snapshot) return null;
  const { bytes, stat } = snapshot;
  let owner: Owner | null = null;
  try {
    const value = JSON.parse(bytes.toString('utf8')) as Owner;
    if (value && Number.isInteger(value.pid) && value.pid > 0 && Number.isFinite(value.startedAt)) owner = value;
  } catch { /* 2026-11-11: an incompletely published owner is not evidence of a dead process. */ }
  return { bytes, stat, mtimeMs: Number(stat.mtimeNs) / 1_000_000, owner };
}

function unchanged(current: OwnerSnapshot | null, expected: OwnerSnapshot): boolean {
  return current !== null && sameIdentity(current.stat, expected.stat) && current.stat.mtimeNs === expected.stat.mtimeNs
    && current.bytes.equals(expected.bytes);
}

async function stillOwned(filename: string, identity: BigIntStats, token: string): Promise<boolean> {
  const current = await readOwner(filename);
  return current !== null && sameIdentity(current.stat, identity) && current.owner?.token === token;
}

async function removeStaleReaper(filename: string, staleMs: number, now: () => number): Promise<void> {
  const current = await readOwner(filename);
  if (!current || now() - current.mtimeMs < staleMs) return;
  // 2026-11-12: a paused live reaper still owns its guard; only an abandoned guard can be recovered safely.
  if (current.owner && processIsAlive(current.owner.pid)) return;
  // 2026-11-12: recovery guards use the same protocol, so competing recoveries cannot unlink a new guard.
  await removeDeadOwner(filename, current, staleMs, now);
}

async function removeDeadOwner(filename: string, expected: OwnerSnapshot, staleMs: number, now: () => number): Promise<boolean> {
  // 2026-11-12: every recovery level publishes a live owner atomically, so no late reaper can lose its guard.
  const reaper = `${filename}.reap`;
  const reaperOwner: Owner = { pid: process.pid, startedAt: now(), token: randomUUID() };
  let identity: BigIntStats;
  try { identity = await publishCoordinationFile(reaper, JSON.stringify(reaperOwner)); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      await removeStaleReaper(reaper, staleMs, now);
      return false;
    }
    throw error;
  }
  try {
    if (!unchanged(await readOwner(filename), expected)) return true;
    await unlink(filename).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
    return true;
  } finally {
    if (await stillOwned(reaper, identity, reaperOwner.token)) await unlink(reaper);
  }
}

/** 2026-11-11: async-context ownership allows nested mutations, not unrelated writes from the same PID. */
export async function ownsProjectWriteLock(root: string): Promise<boolean> {
  const held = heldLocks.getStore();
  if (!held?.some(lock => lock.active)) return false;
  const filename = await projectCacheFile(root, 'write');
  return held.some(lock => lock.active && lock.filename === filename);
}

export async function withProjectWriteLock<Result>(root: string, operation: () => Promise<Result>, options: WriteLockOptions = {}): Promise<Result> {
  const filename = await projectCacheFile(root, 'write');
  const held = heldLocks.getStore() ?? [];
  const inherited = held.find(lock => lock.active && lock.filename === filename);
  if (inherited) {
    return operation();
  }
  await prepareCoordinationDirectory();
  // 2026-11-12: owner ages may use a controlled wall clock without stopping acquisition timeouts.
  const now = options.now ?? Date.now;
  const deadline = Date.now() + (options.timeoutMs ?? 10_000);
  const staleMs = options.staleMs ?? 30_000;
  const owner: Owner = { pid: process.pid, startedAt: now(), token: randomUUID() };
  let identity: BigIntStats;
  for (;;) {
    try { identity = await publishCoordinationFile(filename, JSON.stringify(owner)); break; }
    catch (error) {
      if (!isContention(error)) {
        if (error instanceof CatalogError) throw error;
        throw Object.assign(new CatalogError(503, serverText(messages).acquireFailed), { cause: error });
      }
    }
    try {
      const current = await readOwner(filename);
      const dead = current?.owner && !processIsAlive(current.owner.pid);
      const abandoned = current && !current.owner && now() - current.mtimeMs >= staleMs;
      if (current && (dead || abandoned)) {
        if (await removeDeadOwner(filename, current, staleMs, now)) continue;
      } else if (current?.owner && now() - current.owner.startedAt > stalledLockMs) {
        throw new CatalogError(503, serverText(messages).stalled(filename));
      }
    } catch (error) { if (!isContention(error)) throw error; }
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      let recovering = false;
      try { recovering = await readOwner(`${filename}.reap`) !== null; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !isContention(error)) throw error; }
      throw new CatalogError(503, recovering ? serverText(messages).recovery(filename) : serverText(messages).busy);
    }
    await delay(Math.min(options.retryMs ?? 25, remaining));
  }
  const lock: HeldLock = { filename, active: true };
  let started = false;
  try {
    // 2026-11-12: a published owner is never incomplete; an older reaper can only have checked a different inode.
    if (!await stillOwned(filename, identity, owner.token)) throw new CatalogError(503, serverText(messages).busy);
    started = true;
    return await heldLocks.run([...held, lock], operation);
  } finally {
    lock.active = false;
    try {
      if (!await stillOwned(filename, identity, owner.token)) throw new CatalogError(503, serverText(messages).releaseFailed, started);
      await unlink(filename);
    } catch {
      // 2026-11-11: failure to release a lock is not evidence that the mutation itself failed.
      throw new CatalogError(503, serverText(messages).releaseFailed, started);
    }
  }
}
