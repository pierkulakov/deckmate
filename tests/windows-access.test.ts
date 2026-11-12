import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

function processFixture() {
  const pipe = () => Object.assign(new PassThrough(), { unref: vi.fn() });
  return Object.assign(new EventEmitter(), { stdin: pipe(), stdout: pipe(), stderr: pipe(), kill: vi.fn(), unref: vi.fn() });
}

let child: ReturnType<typeof processFixture>;
let check: typeof import('../server/windows-access.ts').checkWindowsAccess;

beforeEach(async () => {
  vi.resetModules();
  child = processFixture();
  // 2026-11-12: only the process/pipe boundary is simulated; no PowerShell process starts in these lifecycle tests.
  vi.mocked(spawn).mockReturnValue(child as unknown as ChildProcessWithoutNullStreams);
  check = (await import('../server/windows-access.ts')).checkWindowsAccess;
});

afterEach(() => {
  child.emit('exit', 0);
  for (const pipe of [child.stdin, child.stdout, child.stderr]) pipe.destroy();
  vi.useRealTimers();
  vi.clearAllMocks();
});

it('reuses one unreferenced helper and sends paths as data, not PowerShell source', async () => {
  const requests: Array<{ id: number; filename: string }> = [];
  child.stdin.on('data', chunk => { requests.push(JSON.parse(String(chunk))); });
  const filename = "C:\\project\\quote'; Write-Output injected\nfolder";
  const first = check(filename, undefined, false);
  const second = check('C:\\second', 'C:\\parent', true);
  expect(spawn).toHaveBeenCalledTimes(1);
  expect(String(vi.mocked(spawn).mock.calls[0][1])).not.toContain(filename);
  expect(requests.map(request => request.filename)).toEqual([filename, 'C:\\second']);
  child.stdout.write(`${requests[1].id}:ok\n${requests[0].id}:ok\n`);
  await Promise.all([first, second]);
  expect(child.unref).toHaveBeenCalledOnce();
  for (const pipe of [child.stdin, child.stdout, child.stderr]) expect(pipe.unref).toHaveBeenCalledOnce();
});

it('rejects a denied ACL and rejects all pending checks when the helper exits', async () => {
  const denied = check('C:\\denied', undefined, false).catch(error => error);
  child.stdout.write('1:denied\n');
  expect((await denied).message).toContain('denied');
  const pending = [check('C:\\one', undefined, false), check('C:\\two', undefined, false)]
    .map(request => request.catch(error => error));
  child.emit('exit', 1);
  expect((await Promise.all(pending)).every(error => error instanceof Error)).toBe(true);
  expect(child.kill).toHaveBeenCalledOnce();
});

it('fails closed and terminates the helper when its response deadline expires', async () => {
  vi.useFakeTimers();
  const pending = check('C:\\blocked', undefined, false).catch(error => error);
  await vi.advanceTimersByTimeAsync(5000);
  expect(await pending).toBeInstanceOf(Error);
  expect(child.kill).toHaveBeenCalledOnce();
});

it.each(['unexpected response\n', 'x'.repeat(16_385)])('rejects malformed helper output and can start a fresh helper (%#)', async output => {
  const pending = check('C:\\first', undefined, false).catch(error => error);
  child.stdout.write(output);
  expect(await pending).toBeInstanceOf(Error);
  expect(child.kill).toHaveBeenCalledOnce();
  for (const pipe of [child.stdin, child.stdout, child.stderr]) pipe.destroy();
  child = processFixture();
  vi.mocked(spawn).mockReturnValue(child as unknown as ChildProcessWithoutNullStreams);
  const retry = check('C:\\second', undefined, false);
  child.stdout.write('2:ok\n');
  await expect(retry).resolves.toBeUndefined();
  expect(spawn).toHaveBeenCalledTimes(2);
});

it.each(['process', 'stdin'] as const)('settles pending checks after a %s error', async target => {
  const pending = check('C:\\first', undefined, false).catch(error => error);
  if (target === 'process') child.emit('error', new Error('Unavailable helper pipe'));
  else child.stdin.emit('error', new Error('Unavailable helper pipe'));
  expect(await pending).toBeInstanceOf(Error);
  expect(child.kill).toHaveBeenCalledOnce();
});

it('bounds pending ACL checks and does not send rejected requests to the helper', async () => {
  const requests: string[] = [];
  child.stdin.on('data', chunk => { requests.push(String(chunk)); });
  const admitted = Array.from({ length: 256 }, (_, index) => check(`C:\\${index}`, undefined, false));
  await expect(check('C:\\overflow', undefined, false)).rejects.toThrow('queue is full');
  expect(requests).toHaveLength(256);
  child.stdout.write(admitted.map((_, index) => `${index + 1}:ok\n`).join(''));
  await Promise.all(admitted);
});
