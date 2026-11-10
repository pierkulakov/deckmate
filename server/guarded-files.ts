import { lstat, mkdir, open, realpath, unlink } from 'node:fs/promises';
import type { BigIntStats } from 'node:fs';
import path from 'node:path';

interface DirectoryMessages {
  invalidRoot: string;
  rootChanged?: string;
  pathChanged: string;
  directoryLink: string;
}

export interface DirectoryGuard {
  originalRoot?: string;
  root: string;
  relativeDirectory: string;
  directory: string;
  directories: { filename: string; stat: BigIntStats }[];
  messages: () => DirectoryMessages;
}

export function sameIdentity(first: BigIntStats, second: BigIntStats): boolean {
  return first.dev === second.dev && first.ino === second.ino;
}

function samePath(first: string, second: string): boolean {
  return path.relative(first, second) === '';
}

export async function checkDirectories(guard: DirectoryGuard): Promise<void> {
  if (guard.originalRoot !== undefined && !samePath(await realpath(guard.originalRoot), guard.root)) {
    throw new Error(guard.messages().rootChanged ?? guard.messages().pathChanged);
  }
  for (const directory of guard.directories) {
    const current = await lstat(directory.filename, { bigint: true });
    if (!current.isDirectory() || current.isSymbolicLink() || !sameIdentity(current, directory.stat)
      || !samePath(await realpath(directory.filename), directory.filename)) {
      throw new Error(guard.messages().pathChanged);
    }
  }
}

interface DirectoryOptions {
  create: boolean;
  missing: 'null' | 'throw';
  rootReference: 'absolute' | 'provided' | 'none';
  messages: () => DirectoryMessages;
}

export async function guardedDirectory(root: string, relativeDirectory: string, options: DirectoryOptions): Promise<DirectoryGuard | null> {
  const absoluteRoot = path.resolve(root);
  const rootStat = await lstat(absoluteRoot, { bigint: true });
  // 2026-11-10: Markdown guards (no root reference) rejected a non-directory root before realpath; keep that order so a
  // broken link is refused without being resolved.
  if (options.rootReference === 'none' && (!rootStat.isDirectory() || rootStat.isSymbolicLink())) {
    throw new Error(options.messages().invalidRoot);
  }
  const canonicalRoot = await realpath(absoluteRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || !samePath(absoluteRoot, canonicalRoot)) {
    throw new Error(options.messages().invalidRoot);
  }
  let originalRoot: string | undefined;
  if (options.rootReference === 'absolute') originalRoot = absoluteRoot;
  if (options.rootReference === 'provided') originalRoot = root;
  // 2026-11-10: fixed-root Markdown guards retain their resolved spelling; asset guards retain their canonical path.
  const guardedRoot = options.rootReference === 'none' ? absoluteRoot : canonicalRoot;
  const guard: DirectoryGuard = { originalRoot, root: guardedRoot, relativeDirectory, directory: guardedRoot,
    directories: [{ filename: guardedRoot, stat: rootStat }], messages: options.messages };
  for (const part of relativeDirectory.split('/')) {
    await checkDirectories(guard);
    const directory = path.join(guard.directory, part);
    let stat: BigIntStats;
    try { stat = await lstat(directory, { bigint: true }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      if (!options.create) {
        if (options.missing === 'null') return null;
        throw error;
      }
      // 2026-11-03: recursive mkdir could follow an ancestor replaced since the previous check.
      await checkDirectories(guard);
      try { await mkdir(directory); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      stat = await lstat(directory, { bigint: true });
    }
    if (!stat.isDirectory() || stat.isSymbolicLink() || !samePath(await realpath(directory), directory)) {
      throw new Error(options.messages().directoryLink);
    }
    guard.directories.push({ filename: directory, stat });
    guard.directory = directory;
    await checkDirectories(guard);
  }
  return guard;
}

interface FileOptions {
  invalidFile: () => string;
  outsideDirectory?: () => string;
  resolvePath?: () => Promise<string>;
  expected?: BigIntStats;
  checkBefore?: boolean;
  checkAfter?: boolean;
}

export async function checkGuardedFile(guard: DirectoryGuard, filename: string, options: FileOptions): Promise<BigIntStats> {
  if (options.checkBefore !== false) await checkDirectories(guard);
  if (options.outsideDirectory && !samePath(path.dirname(filename), guard.directory)) throw new Error(options.outsideDirectory());
  const stat = await lstat(filename, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink() || !samePath(await (options.resolvePath?.() ?? realpath(filename)), filename)
    || (options.expected && !sameIdentity(stat, options.expected))) throw new Error(options.invalidFile());
  if (options.checkAfter !== false) await checkDirectories(guard);
  return stat;
}

interface RemovalOptions {
  checkFile: (expected: BigIntStats) => Promise<BigIntStats>;
  replaced: () => string;
  missing: 'ignore' | 'throw';
}

export async function removeGuardedFile(guard: DirectoryGuard, filename: string, expected: BigIntStats, options: RemovalOptions): Promise<void> {
  let current: BigIntStats;
  try { current = await options.checkFile(expected); }
  catch (error) {
    if (options.missing !== 'ignore' || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await checkDirectories(guard);
    return;
  }
  // 2026-11-03: cleanup owns the created inode, never a replacement at the same path.
  if (!sameIdentity(current, expected)) throw new Error(options.replaced());
  await unlink(filename);
}

interface NewFileOptions extends RemovalOptions {
  beforeWrite: () => string;
  afterWrite: () => string;
  cleanupFailed: () => string;
  close: 'suppress-secondary' | 'propagate-secondary' | 'temporary-finally';
}

export async function writeGuardedNewFile(guard: DirectoryGuard, relativePath: string, bytes: Buffer, options: NewFileOptions) {
  const filename = path.join(guard.root, relativePath);
  await checkDirectories(guard);
  const handle = await open(filename, 'wx');
  let created: BigIntStats | null = null;
  let closed = false;
  const remove = async () => {
    if (created) await removeGuardedFile(guard, filename, created, options);
  };
  const close = async () => {
    if (options.close === 'suppress-secondary') await handle.close().catch(() => {});
    else await handle.close();
  };
  try {
    created = await handle.stat({ bigint: true });
    const opened = await options.checkFile(created);
    if (!sameIdentity(opened, created)) throw new Error(options.beforeWrite());
    await handle.writeFile(bytes);
    // 2026-11-10: Markdown checks the open temporary file; assets check after closing it.
    if (options.close !== 'temporary-finally') {
      await handle.close();
      closed = true;
    }
    const written = await options.checkFile(created);
    if (!sameIdentity(written, created)) throw new Error(options.afterWrite());
    return { relativePath, filename, stat: created, remove };
  } catch (error) {
    if (options.close === 'temporary-finally') await handle.close();
    else if (!closed) { await close(); closed = true; }
    try { await remove(); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], options.cleanupFailed()); }
    throw error;
  } finally {
    // 2026-11-10: preserve the callers' pinned close-error precedence, including Markdown's unconditional final close.
    if (options.close === 'temporary-finally') await handle.close();
    else if (!closed) await close();
  }
}
