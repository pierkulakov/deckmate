import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, link, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import * as filesystem from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { prepareCoordinationDirectory, projectCacheFile, projectCoordinationDirectory, publishCoordinationFile, readCoordinationFile } from '../server/project-cache.ts';
import { registerRunningServer } from '../server/server-discovery.ts';
import { withProjectWriteLock } from '../server/write-lock.ts';

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, lstat: vi.fn(actual.lstat), open: vi.fn(actual.open) };
});

let directory: string;
let root: string;
const execute = promisify(execFile);
const getuid = Object.getOwnPropertyDescriptor(process, 'getuid');

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'deckmate-cache-security-'));
  root = path.join(directory, 'project');
  await mkdir(root);
  vi.stubEnv('DECKMATE_COORDINATION', path.join(directory, 'coordination'));
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(filesystem.lstat).mockReset();
  vi.mocked(filesystem.open).mockReset();
  if (getuid) Object.defineProperty(process, 'getuid', getuid);
  else Reflect.deleteProperty(process, 'getuid');
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

async function registration() {
  const config = { dataRoot: root, writeRoot: root, editMode: 'direct' as const, port: 4393, projectName: 'Security', python: 'python' };
  await registerRunningServer(config, root, config.port, 'test');
  return projectCacheFile(root, 'server');
}

async function grantOtherWriter(filename: string) {
  if (process.platform !== 'win32') { await chmod(filename, 0o777); return; }
  const executable = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'icacls.exe');
  await execute(executable, [filename, '/grant', '*S-1-1-0:(W)'], { windowsHide: true });
}

it('creates private coordination files, reads a registration and releases a private lock', async () => {
  const filename = await registration();
  const snapshot = await readCoordinationFile(filename);
  expect(JSON.parse(snapshot!.bytes.toString('utf8'))).toMatchObject({ pid: process.pid, port: 4393 });
  expect(snapshot!.stat.nlink).toBe(1n);
  if (process.platform !== 'win32') {
    expect((await lstat(projectCoordinationDirectory())).mode & 0o777).toBe(0o700);
    expect(Number(snapshot!.stat.mode & 0o777n)).toBe(0o600);
  }
  await withProjectWriteLock(root, async () => {
    const lock = await readCoordinationFile(await projectCacheFile(root, 'write'));
    expect(JSON.parse(lock!.bytes.toString('utf8')).pid).toBe(process.pid);
    if (process.platform !== 'win32') expect(Number(lock!.stat.mode & 0o777n)).toBe(0o600);
  });
  expect(await readCoordinationFile(await projectCacheFile(root, 'write'))).toBeNull();
});

it('rejects a writable-by-others registration even when its content and PID look valid', async () => {
  const filename = await registration();
  const bytes = await readFile(filename);
  await grantOtherWriter(filename);
  await expect(readCoordinationFile(filename)).rejects.toMatchObject({ status: 503, saved: false });
  expect(await readFile(filename)).toEqual(bytes);
});

it('checks the file ACL of an existing volatile owner instead of trusting the parent alone', async () => {
  await prepareCoordinationDirectory();
  const filename = await projectCacheFile(root, 'write');
  await writeFile(filename, JSON.stringify({ pid: process.pid, startedAt: Date.now(), token: 'fixture' }), { mode: 0o600 });
  await grantOtherWriter(filename);
  await expect(readCoordinationFile(filename, { volatile: true })).rejects.toMatchObject({ status: 503, saved: false });
});

it('rejects an existing shared coordination directory without changing its permissions', async () => {
  await mkdir(projectCoordinationDirectory(), { mode: 0o700 });
  await grantOtherWriter(projectCoordinationDirectory());
  await expect(prepareCoordinationDirectory()).rejects.toMatchObject({ status: 503, saved: false });
});

it('rechecks directory write access before trusting a previously read registration', async () => {
  const filename = await registration();
  await expect(readCoordinationFile(filename)).resolves.not.toBeNull();
  await grantOtherWriter(projectCoordinationDirectory());
  await expect(readCoordinationFile(filename)).rejects.toMatchObject({ status: 503, saved: false });
});

it('rejects a directory junction before creating a lock or changing its destination', async () => {
  const outside = path.join(directory, 'outside');
  await mkdir(outside);
  await symlink(outside, projectCoordinationDirectory(), process.platform === 'win32' ? 'junction' : 'dir');
  const operation = vi.fn(async () => {});
  await expect(withProjectWriteLock(root, operation)).rejects.toThrow();
  expect(operation).not.toHaveBeenCalled();
  expect(await filesystem.readdir(outside)).toEqual([]);
});

it.each([false, true])('rejects file links and hard links without replacing linked data (volatile=%s)', async volatile => {
  await prepareCoordinationDirectory();
  const filename = await projectCacheFile(root, 'server');
  const outside = path.join(directory, 'outside.json');
  await writeFile(outside, '{"private":true}');
  await link(outside, filename);
  await expect(readCoordinationFile(filename, { volatile })).rejects.toThrow();
  await rm(filename);
  try { await symlink(outside, filename, 'file'); }
  catch (error) {
    if (process.platform !== 'win32' || (error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
    await symlink(directory, filename, 'junction');
  }
  await expect(readCoordinationFile(filename, { volatile })).rejects.toThrow();
  expect(await readFile(outside, 'utf8')).toBe('{"private":true}');
});

it('does not authorize an outside hard link with a different inode at the publication temporary path', async () => {
  await prepareCoordinationDirectory();
  const filename = await projectCacheFile(root, 'write');
  const bytes = JSON.stringify({ pid: process.pid, startedAt: Date.now(), token: 'fixture' });
  const outside = path.join(directory, 'outside.json');
  await writeFile(outside, bytes, { mode: 0o600 });
  await link(outside, filename);
  const temporary = `${filename}.${createHash('sha256').update(bytes).digest('hex')}.tmp`;
  await writeFile(temporary, bytes, { mode: 0o600 });
  await expect(readCoordinationFile(filename, { volatile: true })).rejects.toMatchObject({ status: 503, saved: false });
  expect(await readFile(outside, 'utf8')).toBe(bytes);
});

it('rejects a third link even when the publication temporary accounts for the second', async () => {
  await prepareCoordinationDirectory();
  const filename = await projectCacheFile(root, 'write');
  const bytes = JSON.stringify({ pid: process.pid, startedAt: Date.now(), token: 'fixture' });
  await publishCoordinationFile(filename, bytes);
  await link(filename, `${filename}.${createHash('sha256').update(bytes).digest('hex')}.tmp`);
  await link(filename, path.join(directory, 'outside.json'));
  await expect(readCoordinationFile(filename, { volatile: true })).rejects.toMatchObject({ status: 503, saved: false });
});

it('cleans an unpublished temporary without overwriting an existing owner', async () => {
  await prepareCoordinationDirectory();
  const filename = await projectCacheFile(root, 'write');
  await publishCoordinationFile(filename, 'first owner');
  await expect(publishCoordinationFile(filename, 'second owner')).rejects.toMatchObject({ code: 'EEXIST' });
  expect(await readFile(filename, 'utf8')).toBe('first owner');
  expect(await filesystem.readdir(projectCoordinationDirectory())).toEqual([path.basename(filename)]);
});

it('reads the same owner when temporary cleanup races with link validation', async () => {
  await prepareCoordinationDirectory();
  const filename = await projectCacheFile(root, 'write');
  const bytes = JSON.stringify({ pid: process.pid, startedAt: Date.now(), token: 'fixture' });
  await publishCoordinationFile(filename, bytes);
  const temporary = `${filename}.${createHash('sha256').update(bytes).digest('hex')}.tmp`;
  await link(filename, temporary);
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  let removed = false;
  vi.mocked(filesystem.lstat).mockImplementation(async (...args) => {
    if (args[0] === temporary && !removed) { removed = true; await rm(temporary); }
    return actual.lstat(...args);
  });
  const snapshot = await readCoordinationFile(filename, { volatile: true });
  expect(removed).toBe(true);
  expect(snapshot!.bytes.toString('utf8')).toBe(bytes);
  expect((await lstat(filename)).nlink).toBe(1);
});

it('rechecks directory access before publishing a lock after preparation', async () => {
  await prepareCoordinationDirectory();
  await grantOtherWriter(projectCoordinationDirectory());
  const filename = await projectCacheFile(root, 'write');
  await expect(publishCoordinationFile(filename, 'owner')).rejects.toMatchObject({ status: 503, saved: false });
  expect(await filesystem.readdir(projectCoordinationDirectory())).toEqual([]);
});

it.each(['file', 'directory'] as const)('rejects another POSIX owner of a %s before opening it', async target => {
  const filename = await registration();
  const unsafe = target === 'file' ? filename : projectCoordinationDirectory();
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  Object.defineProperty(process, 'getuid', { value: () => 1000, configurable: true });
  vi.mocked(filesystem.lstat).mockImplementation(async (...args) => {
    const info = await actual.lstat(...args);
    if (typeof info.uid === 'bigint') {
      return Object.assign(info, { uid: String(args[0]) === unsafe ? 1001n : 1000n, mode: BigInt(info.mode) & ~0o022n });
    }
    return info;
  });
  vi.mocked(filesystem.open).mockClear();
  await expect(readCoordinationFile(filename)).rejects.toMatchObject({ status: 503, saved: false });
  expect(filesystem.open).not.toHaveBeenCalled();
});

it('rejects an oversized coordination file before allocating its contents', async () => {
  const filename = await registration();
  await writeFile(filename, 'x'.repeat(16_385));
  vi.mocked(filesystem.open).mockClear();
  await expect(readCoordinationFile(filename)).rejects.toThrow();
  expect(filesystem.open).not.toHaveBeenCalled();
});

it('rejects a replacement between lstat and open instead of mixing its bytes and metadata', async () => {
  const filename = await registration();
  const replacement = path.join(projectCoordinationDirectory(), 'replacement.json');
  await writeFile(replacement, 'replacement', { mode: 0o600 });
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  let injected = false;
  vi.mocked(filesystem.open).mockImplementation(async (...args) => {
    if (String(args[0]) === filename && !injected) {
      injected = true;
      await actual.rename(replacement, filename);
    }
    return actual.open(...args);
  });
  await expect(readCoordinationFile(filename)).rejects.toMatchObject({ code: 'EBUSY' });
  expect(injected).toBe(true);
  expect(await readFile(filename, 'utf8')).toBe('replacement');
});
