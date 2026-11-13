// 2026-11-11: a running Deckmate server is found by its project, not by a fixed port: each server registers its
// port under the cache folder keyed by the project's root identity, so two open projects never answer for each other.
import type { ServerConfig } from './config.ts';
import { randomUUID } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import { prepareCoordinationDirectory, processIsAlive, projectCacheFile, readCoordinationFile } from './project-cache.ts';
import { withProjectWriteLock } from './write-lock.ts';
import { renameChecked } from './guarded-files.ts';
import { CatalogError } from './catalog-error.ts';
import { defineText, serverText } from './i18n.ts';

const messages = defineText({
  wrongServer: 'The registered port did not identify itself as the expected Deckmate process. No write was sent; check the running server.',
}, {
  wrongServer: 'На зарегистрированном порту не подтверждён ожидаемый процесс Deckmate. Запись не отправлена; проверьте запущенный сервер.',
});

export interface RunningServer { port: number; pid: number; startedAt: string; version: string }

async function readRegistration(filename: string): Promise<RunningServer | null> {
  const snapshot = await readCoordinationFile(filename);
  if (!snapshot) return null;
  let value: RunningServer;
  try { value = JSON.parse(snapshot.bytes.toString('utf8')) as RunningServer; } catch { return null; }
  if (!value || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535
    || !Number.isInteger(value.pid) || value.pid <= 0 || typeof value.startedAt !== 'string' || typeof value.version !== 'string') return null;
  return value;
}

/** 2026-11-11: a closing server must not erase a newer server's registration. */
export async function removeRunningServer(root: string, expected: RunningServer): Promise<void> {
  const filename = await projectCacheFile(root, 'server');
  await withProjectWriteLock(root, async () => {
    const current = await readRegistration(filename);
    if (!current || JSON.stringify(current) !== JSON.stringify(expected)) return;
    await unlink(filename).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
  }, { timeoutMs: 0 });
}

export async function registerRunningServer(config: ServerConfig, root: string, port: number, version: string): Promise<() => Promise<void>> {
  if (config.editMode === 'read-only' || !config.writeRoot) return async () => {};
  const filename = await projectCacheFile(root, 'server');
  await prepareCoordinationDirectory();
  const registration: RunningServer = { port, pid: process.pid, startedAt: new Date().toISOString(), version };
  const temporary = `${filename}.${randomUUID()}.tmp`;
  await withProjectWriteLock(root, async () => {
    await readRegistration(filename);
    try {
      await writeFile(temporary, JSON.stringify(registration), { flag: 'wx', mode: 0o600 });
      await renameChecked(temporary, filename);
    } finally {
      await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
    }
  }, { timeoutMs: 0 });
  return () => removeRunningServer(root, registration);
}

/** The live server that has `root` open, or null when the project's files are written directly. */
export async function findRunningServer(root: string): Promise<RunningServer | null> {
  const registration = await readRegistration(await projectCacheFile(root, 'server'));
  if (!registration) return null;
  if (processIsAlive(registration.pid)) {
    let response: Response;
    try {
      response = await fetch(`http://127.0.0.1:${registration.port}/api/health`, { signal: AbortSignal.timeout(5000), redirect: 'error' });
    } catch (error) {
      if ((error as { cause?: NodeJS.ErrnoException }).cause?.code !== 'ECONNREFUSED') throw error;
      await removeRunningServer(root, registration);
      return null;
    }
    let health: unknown;
    try { health = await response.json(); } catch { /* 2026-11-12: an invalid identity is never a reason to send a write. */ }
    if (!response.ok || !health || typeof health !== 'object' || !('app' in health) || health.app !== 'Deckmate'
      || !('pid' in health) || health.pid !== registration.pid) throw new CatalogError(502, serverText(messages).wrongServer);
    return registration;
  }
  await removeRunningServer(root, registration);
  return null;
}
