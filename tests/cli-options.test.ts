import { afterEach, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

// 2026-11-09: option validation rejects options a command ignores, with the allowed list and a hint,
// before any project file is read; the process exits 1 with the message on stderr only.
const execute = promisify(execFile);
const workspace = fileURLToPath(new URL('../', import.meta.url));
const cliFile = path.join(workspace, 'tools', 'project.ts');
const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    if (path.dirname(directory) !== path.resolve(tmpdir()) || !path.basename(directory).startsWith('deckmate-cli-options-')) {
      throw new Error('Unexpected cli-options cleanup target.');
    }
    await rm(directory, { recursive: true, force: true });
  }
});

async function runProject(args: string[], data?: string) {
  const env = { ...process.env, DECKMATE_WRITE: '', NODE_OPTIONS: '', ...(data ? { DECKMATE_DATA: data } : {}) };
  return execute(process.execPath, [cliFile, ...args], { cwd: workspace, windowsHide: true, env });
}

async function expectRejected(args: string[], message: RegExp) {
  const failure = await runProject(args).then(
    result => { throw new Error(`expected a rejection, got success: ${result.stdout.slice(0, 200)}`); },
    error => error,
  );
  expect(failure.code).toBe(1);
  expect(failure.stdout).toBe('');
  expect(failure.stderr).toMatch(message);
  return failure.stderr as string;
}

it('rejects an option the command ignores, naming the command and its options', async () => {
  const stderr = await expectRejected(['show', 'c-1a2b3c4d5e', '--owner', 'glm'],
    /--owner is not available for show\. Options for show: --fields, --lines, --data, --source, --read-only\./u);
  expect(stderr).toContain('Run deckmate project show --help for an example.');
  await expectRejected(['brief', 'c-1a2b3c4d5e', '--lines', '1-2'], /--lines is not available for brief\. Options for brief: --budget, --json/u);
  await expectRejected(['map', '--text', 'шаги'], /--text is not available for map\. Options for map: --data, --source, --read-only/u);
});

it('rejects misplaced options for module commands, not only built-in ones', async () => {
  await expectRejected(['state', 'c-1a2b3c4d5e', 'done', '--file', 'report.md'],
    /--file is not available for state\. Options for state: --member, --reason, --data, --source, --read-only/u);
  await expectRejected(['next', '--reason', 'потому'], /--reason is not available for next\. Options for next: --member, --stale-hours, --brief/u);
  await expectRejected(['inbox', 'glm', '--dry'], /--dry is not available for inbox\. Options for inbox: --member, --since, --limit/u);
});

it('rejects unknown options, single-dash flags and unknown commands with a hint', async () => {
  const unknownOption = await expectRejected(['--bogus'], /Unknown option --bogus\. Run deckmate project --help to list the commands and their options\./u);
  expect(unknownOption).toContain('deckmate project');
  await expectRejected(['-x'], /Unknown option -x\./u);
  await expectRejected(['show', 'c-1a2b3c4d5e', '--colour', 'red'], /Unknown option --colour\./u);
  await expectRejected(['show', 'c-1a2b3c4d5e', '--tracks', 'sound'], /--tracks is not available for show\./u);
  await expectRejected(['totally-unknown'], /Unknown command "totally-unknown"\. Commands: /u);
});

it('still accepts the options a command declares, wherever they stand', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'deckmate-cli-options-'));
  directories.push(directory);
  const map = await runProject(['--data', directory, 'map', '--source', 'live', '--read-only']);
  expect(map.stderr).toBe('');
  expect(JSON.parse(map.stdout).decks).toEqual([]);
  const hand = await runProject(['hand', '--limit', '3', '--data', directory]);
  expect(hand.stderr).toBe('');
  expect(JSON.parse(hand.stdout).hands).toEqual([]);
});

it('passes option validation before command work, so a valid option reaches the command itself', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'deckmate-cli-options-'));
  directories.push(directory);
  const failure = await runProject(['next', '--member', 'glm', '--data', directory]).then(() => {
    throw new Error('expected a rejection');
  }, error => error);
  expect(failure.code).toBe(1);
  expect(failure.stderr).not.toContain('--member is not available');
  expect(failure.stderr).toMatch(/next: /u);
});
