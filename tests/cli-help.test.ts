import { afterEach, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { runCli } from '../server/cli.ts';
import { projectCli } from '../tools/project.ts';
import { skillsCli } from '../tools/deckmate-skills.ts';
import { agentsCli } from '../tools/deckmate-run.ts';

// 2026-11-09: --help and -h print the help of the command they name to stdout with exit code 0,
// identically through `deckmate …` and the npm-script entries; usage errors stay on stderr with code 1.
const execute = promisify(execFile);
const workspace = fileURLToPath(new URL('../', import.meta.url));

function toolFile(relative: string): string {
  return path.join(workspace, relative);
}

/** Captures console.log while the in-process CLI runs; one help entry prints exactly one line block. */
async function capturedOutput(run: () => Promise<number | void>): Promise<string> {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    const code = await run();
    expect(code === undefined || code === 0).toBe(true);
    return log.mock.calls.map(call => call.join(' ')).join('\n');
  } finally {
    log.mockRestore();
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

it('answers --help and -h with the same general help on stdout', async () => {
  const long = await capturedOutput(() => runCli(['--help']));
  const short = await capturedOutput(() => runCli(['-h']));
  expect(long).toBe(short);
  expect(long).toContain('A local Markdown project board');
  expect(long).toContain('Usage: deckmate [');
  expect(long).toContain('deckmate agents run <workflow> <area>');
  expect(long).toContain('[--force]');
});

it('prints the same project help for deckmate project --help and the npm script entry', async () => {
  const viaDeckmate = await capturedOutput(() => runCli(['project', '--help']));
  const viaScript = await capturedOutput(() => projectCli(['--help']));
  expect(viaDeckmate).toBe(viaScript);
  expect(viaDeckmate).toContain('Usage: deckmate project <command> [arguments]');
  expect(viaDeckmate).toContain('Commands: ');
  expect(viaDeckmate).toContain('Run deckmate project <command> --help');
  for (const command of ['next', 'ask', 'report', 'state', 'inbox']) expect(viaDeckmate).toContain(command);
  const shortFlag = await capturedOutput(() => runCli(['project', '-h']));
  expect(shortFlag).toBe(viaDeckmate);
  const subprocess = await execute(process.execPath, [toolFile('tools/project.ts'), '--help'], { cwd: workspace, windowsHide: true });
  expect(subprocess.stderr).toBe('');
  expect(subprocess.stdout).toBe(viaScript + '\n');
});

it('shows arguments, options and one example for every agent-route command', async () => {
  const route: Array<[string, RegExp, RegExp]> = [
    ['next', /Usage: deckmate project next \[member\] \[--member <id>\] \[--stale-hours <hours>\] \[--brief\]/u, /Example: deckmate project next agent --data <project>/u],
    ['ask', /Usage: deckmate project ask <c-ref> "<question>" \[--member <id>\] \[--to <id>\] \[--target <c-ref\[#section\]>\]/u, /Example: deckmate project ask c-1a2b3c4d5e/u],
    ['question', /Usage: deckmate project question <c-ref#N>/u, /Example: deckmate project question c-1a2b3c4d5e#1/u],
    ['answer', /Usage: deckmate project answer <c-ref#N> "<answer>" \[--as <human-id>\]/u, /Example: deckmate project answer c-1a2b3c4d5e#1/u],
    ['apply', /Usage: deckmate project apply <c-ref> <index> \[--note <text>\]/u, /Example: deckmate project apply c-1a2b3c4d5e 0/u],
    ['report', /Usage: deckmate project report <c-ref> \[--file <path>\] \[--member <id>\] \[--state <state>\]/u, /Example: deckmate project report c-1a2b3c4d5e --file report\.md --member agent --state review/u],
    ['state', /Usage: deckmate project state <c-ref> <state> \[--member <id>\] \[--reason <text>\]/u, /Example: deckmate project state c-1a2b3c4d5e done --member reviewer/u],
    ['organize', /Usage: deckmate project organize \[--about <new thing>\]/u, /Example: deckmate project organize --about "new unit" --data <project>/u],
  ];
  for (const [command, usage, example] of route) {
    const viaDeckmate = await capturedOutput(() => runCli(['project', command, '--help']));
    const viaScript = await capturedOutput(() => projectCli([command, '--help']));
    expect(viaDeckmate).toBe(viaScript);
    expect(viaDeckmate).toMatch(usage);
    expect(viaDeckmate).toMatch(example);
  }
  const read = await capturedOutput(() => runCli(['project', 'show', '--help']));
  expect(read).toMatch(/Usage: deckmate project show <c-ref> \[--fields <brief>\] \[--lines <a-b>\]/u);
  expect(read).toMatch(/Example: deckmate project show c-1a2b3c4d5e --lines 12-40/u);
});

it('prints the same skills help for deckmate skills --help, -h and the npm script entry', async () => {
  const viaDeckmate = await capturedOutput(() => runCli(['skills', '--help']));
  const viaScript = await capturedOutput(() => skillsCli(['--help']));
  expect(viaDeckmate).toBe(viaScript);
  expect(await capturedOutput(() => skillsCli(['-h']))).toBe(viaScript);
  expect(viaDeckmate).toContain('Usage: deckmate skills <install|status>');
  expect(viaDeckmate).toContain("rules block in the project's AGENTS.md");
  expect(viaDeckmate).toContain('--force');
  expect(viaDeckmate).toContain('deckmate agents run <workflow> <area>');
  const subprocess = await execute(process.execPath, [toolFile('tools/deckmate-skills.ts'), '--help'], { cwd: workspace, windowsHide: true });
  expect(subprocess.stderr).toBe('');
  expect(subprocess.stdout).toBe(viaScript + '\n');
});

it('prints the same agents help for deckmate agents --help, -h and the npm script entry', async () => {
  const viaDeckmate = await capturedOutput(() => runCli(['agents', '--help']));
  const viaScript = await capturedOutput(() => agentsCli(['--help']));
  expect(viaDeckmate).toBe(viaScript);
  expect(await capturedOutput(() => agentsCli(['-h']))).toBe(viaScript);
  expect(await capturedOutput(() => agentsCli(['run', 'analyze', 'fx', '--help']))).toBe(viaScript);
  expect(viaDeckmate).toContain('Usage: deckmate agents run <workflow> <area>');
  expect(viaDeckmate).toContain('Example: deckmate agents run analyze fx --dry --project <folder>');
  const subprocess = await execute(process.execPath, [toolFile('tools/deckmate-run.ts'), '--help'], { cwd: workspace, windowsHide: true });
  expect(subprocess.stderr).toBe('');
  expect(subprocess.stdout).toBe(viaScript + '\n');
});

it('rejects help for an unknown command with the command list instead of printing it', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  await expect(runCli(['project', 'no-such-command', '--help'])).rejects.toThrow('Unknown command "no-such-command"');
  expect(error).not.toHaveBeenCalled();
  error.mockRestore();
});

// 2026-11-10: `help <command> …` once fell through to the command itself and performed the write.
it('treats the word form `help` as usage only, even when followed by a writing command and its arguments', async () => {
  const overview = await capturedOutput(() => projectCli(['help']));
  expect(overview).toBe(await capturedOutput(() => projectCli(['--help'])));
  const state = await capturedOutput(() => projectCli(['help', 'state', 'c-0000000000', 'started', '--member', 'nobody', '--data', path.join(workspace, 'no-such-project')]));
  expect(state).toBe(await capturedOutput(() => projectCli(['state', '--help'])));
  await expect(projectCli(['help', 'no-such-command'])).rejects.toThrow(/no-such-command/u);
});
