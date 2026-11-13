import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { lstat, mkdir, readFile, readdir, symlink, unlink, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupBrowserTemps, createBrowserTemp, processIsAlive, removeBrowserTemp, retainBrowserTemp, setBrowserTempPid } from '../tools/browser-temp.ts';

let root: string;
let deadPid: number;
beforeEach(async () => {
  root = await createBrowserTemp('deckmate-browser-fixtures-');
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore', windowsHide: true });
  await new Promise<void>((resolve, reject) => { child.once('exit', () => resolve()); child.once('error', reject); });
  deadPid = child.pid!;
});
afterEach(async () => { vi.restoreAllMocks(); await removeBrowserTemp(root); });

async function age(directory: string, owner: object = { pid: deadPid }) {
  await writeFile(path.join(directory, '.deckmate-owner.json'), JSON.stringify(owner));
  const past = new Date(Date.now() - 8 * 60 * 60 * 1000);
  await utimes(directory, past, past);
}

describe('browser temporary ownership', () => {
  it.each(['deckmate-capture-', 'deckmate-browser-fixtures-'] as const)('sweeps abandoned %s at the next allocation but preserves live and recent runs', async prefix => {
    const abandoned = await createBrowserTemp(prefix, root);
    const live = await createBrowserTemp(prefix, root);
    const liveBrowser = await createBrowserTemp(prefix, root);
    const recent = await createBrowserTemp(prefix, root);
    await age(abandoned);
    await age(live, { pid: process.pid });
    await age(liveBrowser, { pid: deadPid, browserPid: process.pid });
    await writeFile(path.join(recent, '.deckmate-owner.json'), JSON.stringify({ pid: deadPid }));
    const next = await createBrowserTemp(prefix, root);
    expect(existsSync(abandoned)).toBe(false);
    for (const directory of [live, liveBrowser, recent, next]) expect(existsSync(directory), directory).toBe(true);
    expect(JSON.parse(await readFile(path.join(next, '.deckmate-owner.json'), 'utf8'))).toEqual({ pid: process.pid });
  });

  it('keeps shared fixtures alive until the last preview releases its lease', async () => {
    const directory = await createBrowserTemp('deckmate-browser-fixtures-', root);
    const first = await retainBrowserTemp(directory);
    const second = await retainBrowserTemp(directory);
    await age(directory);
    await cleanupBrowserTemps(root);
    expect(existsSync(directory)).toBe(true);
    await first();
    await age(directory);
    await cleanupBrowserTemps(root);
    expect(existsSync(directory)).toBe(true);
    await second();
    await age(directory);
    await cleanupBrowserTemps(root);
    expect(existsSync(directory)).toBe(false);
  });

  it('records the browser separately so a dead coordinator cannot authorize deletion of a live profile', async () => {
    const directory = await createBrowserTemp('deckmate-capture-', root);
    await setBrowserTempPid(directory, process.pid);
    expect(JSON.parse(await readFile(path.join(directory, '.deckmate-owner.json'), 'utf8')))
      .toEqual({ pid: process.pid, browserPid: process.pid });
    await age(directory);
    await expect(setBrowserTempPid(directory, process.pid)).rejects.toThrow('different owner');
  });

  it('never follows root or nested directory links and rejects paths outside its namespace', async () => {
    const outside = await createBrowserTemp('deckmate-browser-fixtures-');
    try {
      const sentinel = path.join(outside, 'keep.txt');
      await writeFile(sentinel, 'keep');
      const linked = path.join(root, 'deckmate-capture-linked');
      await symlink(outside, linked, process.platform === 'win32' ? 'junction' : 'dir');
      expect((await lstat(linked)).isSymbolicLink()).toBe(true);
      await cleanupBrowserTemps(root);
      await expect(removeBrowserTemp(linked, root)).rejects.toThrow('linked');
      expect(await readFile(sentinel, 'utf8')).toBe('keep');
      await unlink(linked);
      const directory = await createBrowserTemp('deckmate-capture-', root);
      await mkdir(path.join(directory, 'nested'));
      await symlink(outside, path.join(directory, 'nested', 'link'), process.platform === 'win32' ? 'junction' : 'dir');
      await age(directory);
      await cleanupBrowserTemps(root);
      expect(existsSync(directory)).toBe(false);
      expect(await readFile(sentinel, 'utf8')).toBe('keep');
      await expect(removeBrowserTemp(outside, root)).rejects.toThrow('Not an owned');
      await expect(removeBrowserTemp(root, root)).rejects.toThrow('Not an owned');
    } finally { await removeBrowserTemp(outside); }
  });

  it('leaves unproven ownership, unrelated prefixes and unreadable live processes alone', async () => {
    const unmarked = await createBrowserTemp('deckmate-capture-', root);
    const invalid = await createBrowserTemp('deckmate-capture-', root);
    const unrelated = path.join(root, 'scoped_dir123');
    await mkdir(unrelated);
    for (const directory of [unmarked, invalid, unrelated]) await age(directory);
    await unlink(path.join(unmarked, '.deckmate-owner.json'));
    await writeFile(path.join(invalid, '.deckmate-owner.json'), JSON.stringify({ pid: -1 }));
    const past = new Date(0);
    for (const directory of [unmarked, invalid]) await utimes(directory, past, past);
    await cleanupBrowserTemps(root);
    expect(await readdir(root)).toEqual(expect.arrayContaining([path.basename(unmarked), path.basename(invalid), 'scoped_dir123']));
    vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('denied'), { code: 'EPERM' }); });
    expect(processIsAlive(deadPid)).toBe(true);
  });
});
