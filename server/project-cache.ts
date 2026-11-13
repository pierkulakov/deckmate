import { createHash } from 'node:crypto';
import { constants, type BigIntStats } from 'node:fs';
import { link, lstat, mkdir, open, realpath, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { environmentValue } from './environment.ts';
import { checkDirectories, checkGuardedFile, guardedDirectory, sameIdentity, type DirectoryGuard } from './guarded-files.ts';
import { CatalogError } from './catalog-error.ts';
import { defineText, serverText } from './i18n.ts';
import { checkWindowsAccess } from './windows-access.ts';

const messages = defineText({
  unsafe: (filename: string) => `Unsafe Deckmate coordination path: ${filename}. Use a directory owned by you, without links or access for other writers.`,
}, {
  unsafe: (filename: string) => `Небезопасный путь координации Deckmate: ${filename}. Используйте свою папку без ссылок и доступа других пользователей на запись.`,
});

const coordinationByteLimit = 16_384;
const windowsAccessChecks = new Map<string, { identity: string; restricted: boolean; checked: Promise<void> }>();
const directoryPreparations = new Map<string, Promise<void>>();
const privateDirectories = new Map<string, BigIntStats>();

function unsafeCoordination(filename: string): CatalogError {
  return new CatalogError(503, serverText(messages).unsafe(filename));
}

function checkOwner(filename: string, info: BigIntStats, ancestor = false): void {
  if (!process.getuid) return;
  const uid = BigInt(process.getuid());
  const owned = info.uid === uid || (ancestor && info.uid === 0n);
  const sharedTemporaryDirectory = ancestor && (info.mode & 0o1000n) !== 0n;
  if (!owned || (!sharedTemporaryDirectory && (info.mode & 0o022n) !== 0n)) throw unsafeCoordination(filename);
}

/** 2026-11-12: Windows ignores POSIX mode/uid; verify NTFS ownership and DACL rather than trusting chmod. */
async function windowsAccess(filename: string, info: BigIntStats, restrict = false, parent?: { filename: string; stat: BigIntStats }): Promise<void> {
  if (process.platform !== 'win32') return;
  const identity = `${info.dev}:${info.ino}:${info.ctimeNs}:${parent?.stat.ctimeNs ?? ''}`;
  const previous = windowsAccessChecks.get(filename);
  if (previous?.identity === identity && (!restrict || previous.restricted)) return previous.checked;
  const checked = checkWindowsAccess(filename, parent?.filename, restrict)
    .catch(error => { throw Object.assign(unsafeCoordination(filename), { cause: error }); });
  if (windowsAccessChecks.size >= 256) windowsAccessChecks.clear();
  windowsAccessChecks.set(filename, { identity, restricted: restrict, checked });
  try { await checked; }
  catch (error) { if (windowsAccessChecks.get(filename)?.checked === checked) windowsAccessChecks.delete(filename); throw error; }
}

async function coordinationGuard(create: boolean): Promise<DirectoryGuard | null> {
  const directory = projectCoordinationDirectory();
  const root = path.parse(directory).root;
  const relative = path.relative(root, directory).split(path.sep).join('/');
  const message = () => serverText(messages).unsafe(directory);
  const options = { create: false, missing: 'null' as const, rootReference: 'none' as const,
    messages: () => ({ invalidRoot: message(), pathChanged: message(), directoryLink: message() }) };
  const known = privateDirectories.get(directory);
  if (known) {
    let current: BigIntStats | undefined;
    try { current = await lstat(directory, { bigint: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (current && sameIdentity(current, known)) {
      // 2026-11-12: an unchanged private directory is the authority; rewalking every ancestor for every reaper
      // snapshot would turn lock contention into quadratic filesystem work. Its real path is still checked.
      const guard: DirectoryGuard = { root: directory, relativeDirectory: '', directory,
        directories: [{ filename: directory, stat: current }], messages: options.messages };
      checkOwner(directory, current);
      await windowsAccess(directory, current);
      await checkDirectories(guard);
      return guard;
    }
    privateDirectories.delete(directory);
  }
  let guard = await guardedDirectory(root, relative, options);
  let created = false;
  if (!guard && create) {
    // 2026-11-12: inspect existing ancestors before recursive mkdir can follow a link or an untrusted parent.
    let ancestor = path.dirname(directory);
    let parentGuard: DirectoryGuard | null = null;
    while (!parentGuard) {
      parentGuard = await guardedDirectory(root, path.relative(root, ancestor).split(path.sep).join('/'), options);
      if (!parentGuard) ancestor = path.dirname(ancestor);
    }
    for (const parent of parentGuard.directories) checkOwner(parent.filename, parent.stat, true);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    created = true;
    guard = await guardedDirectory(root, relative, options);
  }
  if (!guard) return null;
  for (const parent of guard.directories) checkOwner(parent.filename, parent.stat, parent.filename !== directory);
  await windowsAccess(directory, guard.directories.at(-1)!.stat, created);
  await checkDirectories(guard);
  const ownedDirectory = guard.directories.at(-1)!;
  if (privateDirectories.size >= 256) privateDirectories.clear();
  privateDirectories.set(directory, ownedDirectory.stat);
  return { ...guard, root: directory, relativeDirectory: '', directories: [ownedDirectory] };
}

export async function prepareCoordinationDirectory(): Promise<void> {
  const directory = projectCoordinationDirectory();
  const running = directoryPreparations.get(directory);
  if (running) return running;
  const preparing = coordinationGuard(true).then(() => {});
  directoryPreparations.set(directory, preparing);
  try { await preparing; }
  finally { directoryPreparations.delete(directory); }
}

function publicationTemporary(filename: string, contents: string | Buffer): string {
  return `${filename}.${createHash('sha256').update(contents).digest('hex')}.tmp`;
}

async function removePublicationTemporary(filename: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try { await unlink(filename); return; }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return;
      if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(code ?? '') || attempt >= 4) throw error;
      // 2026-11-12: a transient Windows sharing failure must not strand an already published live owner.
      await delay(25 * (attempt + 1));
    }
  }
}

/** 2026-11-12: link publishes complete ownership exclusively; a paused publisher never exposes an empty lock. */
export async function publishCoordinationFile(filename: string, contents: string): Promise<BigIntStats> {
  const guard = await coordinationGuard(false);
  if (!guard || path.dirname(filename) !== guard.directory || Buffer.byteLength(contents) > coordinationByteLimit) {
    throw unsafeCoordination(filename);
  }
  const temporary = publicationTemporary(filename, contents);
  const invalidFile = () => serverText(messages).unsafe(filename);
  const handle = await open(temporary, 'wx', 0o600);
  try {
    let stat: BigIntStats;
    try {
      const expected = await handle.stat({ bigint: true });
      await checkGuardedFile(guard, temporary, { expected, invalidFile });
      if (expected.nlink !== 1n) throw unsafeCoordination(filename);
      await handle.writeFile(contents);
      stat = await handle.stat({ bigint: true });
      checkOwner(temporary, stat);
      await checkGuardedFile(guard, temporary, { expected: stat, invalidFile });
      if (stat.nlink !== 1n) throw unsafeCoordination(filename);
      await windowsAccess(temporary, stat, false, guard.directories.at(-1));
    } finally {
      // 2026-11-12: close before linking/removing so Windows never depends on deleting our open handle.
      await handle.close();
    }
    await checkGuardedFile(guard, temporary, { expected: stat, invalidFile });
    await link(temporary, filename);
    return stat;
  } finally {
    await removePublicationTemporary(temporary);
  }
}

async function checkPublicationLink(guard: DirectoryGuard, filename: string, stat: BigIntStats, bytes: Buffer): Promise<void> {
  const invalidFile = () => serverText(messages).unsafe(filename);
  // 2026-11-12: both names must account for every link in the private directory, including after a publisher crash.
  // Unrelated hard links remain unsafe; the bounded contents identify the one permitted publication temporary.
  const temporary = await checkGuardedFile(guard, publicationTemporary(filename, bytes), { expected: stat, invalidFile });
  if (temporary.nlink !== 2n) throw unsafeCoordination(filename);
}

/** 2026-11-12: bytes and metadata belong to one open inode, never a link or a separately stat'ed successor. */
export async function readCoordinationFile(filename: string, options: { volatile?: boolean } = {}): Promise<{ bytes: Buffer; stat: BigIntStats } | null> {
  await directoryPreparations.get(projectCoordinationDirectory());
  const guard = await coordinationGuard(false);
  if (!guard) return null;
  const invalidFile = () => serverText(messages).unsafe(filename);
  try {
    let expected: BigIntStats;
    try { expected = await checkGuardedFile(guard, filename, { invalidFile, outsideDirectory: invalidFile }); }
    catch (error) {
      const deletePending = process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EBADF';
      if (!options.volatile || !(error instanceof Error) || (error.message !== invalidFile() && !deletePending)) throw error;
      // 2026-11-13: Windows deletion can clear type bits or make realpath fail with EBADF after lstat.
      // Rechecking distinguishes a vanished or replaced owner from a persistent link or other non-file.
      const current = await lstat(filename, { bigint: true });
      if (current.isFile() || current.mode === 0n || current.nlink === 0n) throw Object.assign(error, { code: 'EBUSY' });
      throw error;
    }
    checkOwner(filename, expected);
    if (options.volatile && expected.nlink === 0n) throw Object.assign(unsafeCoordination(filename), { code: 'EBUSY' });
    if ((expected.nlink !== 1n && !(options.volatile && expected.nlink === 2n))
      || expected.size > BigInt(coordinationByteLimit)) throw unsafeCoordination(filename);
    try { await windowsAccess(filename, expected, false, guard.directories.at(-1)); }
    catch (error) {
      if (!options.volatile) throw error;
      const current = await lstat(filename, { bigint: true });
      if (!sameIdentity(current, expected) || current.ctimeNs !== expected.ctimeNs) {
        throw Object.assign(unsafeCoordination(filename), { code: 'EBUSY' });
      }
      throw error;
    }
    const handle = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const stat = await handle.stat({ bigint: true });
      checkOwner(filename, stat);
      if (!sameIdentity(stat, expected)) throw Object.assign(unsafeCoordination(filename), { code: 'EBUSY' });
      if (options.volatile && stat.nlink === 0n) throw Object.assign(unsafeCoordination(filename), { code: 'EBUSY' });
      if ((stat.nlink !== 1n && !(options.volatile && stat.nlink === 2n))
        || stat.size > BigInt(coordinationByteLimit)) throw unsafeCoordination(filename);
      const buffer = Buffer.alloc(coordinationByteLimit + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > coordinationByteLimit) throw unsafeCoordination(filename);
      const bytes = buffer.subarray(0, bytesRead);
      if (options.volatile) {
        if (stat.nlink === 2n) {
          try { await checkPublicationLink(guard, filename, stat, bytes); }
          catch (error) {
            const current = await handle.stat({ bigint: true });
            // 2026-11-12: the publisher may remove its temporary during validation, leaving the ordinary single link.
            if (current.nlink === 0n) throw Object.assign(unsafeCoordination(filename), { code: 'EBUSY' });
            if (current.nlink !== 1n) throw Object.assign(unsafeCoordination(filename), { cause: error });
          }
        }
        // 2026-11-12: a released lock may already be delete-pending on Windows. Its open-inode snapshot stays
        // valid; the reaper compares a fresh snapshot under its guard before unlinking any owner.
        await checkDirectories(guard);
        return { bytes, stat };
      }
      const current = await checkGuardedFile(guard, filename, { invalidFile });
      checkOwner(filename, current);
      if (current.nlink !== 1n) throw unsafeCoordination(filename);
      if (!sameIdentity(stat, current)) throw Object.assign(unsafeCoordination(filename), { code: 'EBUSY' });
      return { bytes, stat };
    } finally { await handle.close(); }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export function projectCacheDirectory(): string {
  return environmentValue('INDEX') ?? path.join(homedir(), '.cache', 'deckmate');
}

// 2026-11-12: a home-relative directory is shared across launchers on every OS, even when their SQLite
// indexes differ. Only the explicit coordination override isolates test processes; INDEX must not split writers.
export function projectCoordinationDirectory(): string {
  return path.resolve(process.env.DECKMATE_COORDINATION ?? path.join(homedir(), '.cache', 'deckmate', 'coordination'));
}

export async function projectRootIdentity(root: string): Promise<string> {
  return createHash('sha256').update(await realpath(root)).digest('hex');
}

export async function projectCacheFile(root: string, kind: 'server' | 'write'): Promise<string> {
  return path.join(projectCoordinationDirectory(), `${kind}-${await projectRootIdentity(root)}.json`);
}

export function processIsAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    // 2026-11-11: denied access (including EPERM) is not proof that another writer has exited.
    return true;
  }
}
