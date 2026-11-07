import { spawn } from 'node:child_process';
import { mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';

const warningPattern = /warn|warning|deprecated/iu;
const summaryPattern = /^\s*(?:Test Files|Tests|Duration)\s|\bbuilt in\b/iu;
const failurePattern = /FAIL|✗|×|Error|error TS|^\s*(?:●|not ok\b|\d+\))/u;

function shellArgument(argument: string): string {
  if (/^[\w./:=+,-]+$/u.test(argument)) return argument;
  if (process.platform !== 'win32') return "'" + argument.replaceAll("'", "'\\''") + "'";

  // 2026-11-05: cmd consumes carets; the executable then consumes quoted argv.
  const quoted = '"' + argument.replace(/(\\*)"/gu, '$1$1\\"').replace(/(\\+)$/u, '$1$1') + '"';
  return quoted.replace(/[()%!^"`<>&|;, *?\[\]]/gu, '^$&');
}

function shellCommand(argumentsList: string[]): string {
  const [command, ...argumentsTail] = argumentsList;
  const executable = process.platform === 'win32' && /\s/u.test(command) ? '"' + command + '"' : shellArgument(command);
  return [executable, ...argumentsTail.map(shellArgument)].join(' ');
}

function outputLines(output: string): string[] {
  const lines = output.split(/\r\n|\n|\r/u);
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

function successfulOutput(lines: string[]): string[] {
  const summaries = lines.flatMap((line, index) => summaryPattern.test(line) ? [index] : []);
  const fallback = lines.flatMap((line, index) => line.trim() ? [index] : []).slice(-5);
  // 2026-11-05: leave room for npm's four-line banner and the log path.
  const selected = new Set((summaries.length ? summaries : fallback).slice(-15));
  return lines.filter((line, index) => selected.has(index) || warningPattern.test(line));
}

function captureOutput(completedLines: string[]) {
  const chunks: string[] = [];
  let pending = '';
  return {
    append(chunk: string) {
      chunks.push(chunk);
      const lines = (pending + chunk).split('\n');
      pending = lines.pop()!;
      for (const line of lines) completedLines.push(line);
    },
    finish() {
      if (pending) completedLines.push(pending);
      return stripVTControlCharacters(chunks.join(''));
    },
  };
}

function failedOutput(stdout: string): string[] {
  const lines = outputLines(stdout);
  return lines.filter((line, index) => failurePattern.test(line) || index >= lines.length - 40);
}

async function createLog(command: string) {
  const directory = path.resolve('.deckmate', 'quiet');
  await mkdir(directory, { recursive: true });
  const timestamp = new Date().toLocaleString('sv-SE').replace(' ', '_').replaceAll(':', '-');
  const commandWord = path.basename(command).replace(/[^\p{L}\p{N}_.-]/gu, '_') || 'command';
  for (let sequence = 1; ; sequence += 1) {
    const suffix = sequence === 1 ? '' : '-' + sequence;
    const filename = path.join(directory, `${timestamp}-${commandWord}${suffix}.log`);
    try {
      return { filename, handle: await open(filename, 'wx') };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
}

async function main(): Promise<void> {
  const argumentsList = process.argv.slice(2);
  if (!argumentsList.length) {
    process.stderr.write('Usage: npm run quiet -- <command and arguments>\n');
    process.exitCode = 1;
    return;
  }

  const log = await createLog(argumentsList[0]);
  const completedLines: string[] = [];
  const stdout = captureOutput(completedLines);
  const stderr = captureOutput(completedLines);
  let cleanStdout: string;
  let cleanStderr: string;
  let exitCode: number;
  try {
    const child = spawn(shellCommand(argumentsList), {
      shell: true, cwd: process.cwd(), windowsHide: true,
      env: { ...process.env, FORCE_COLOR: '0' }, stdio: ['inherit', 'pipe', 'pipe'],
    });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', stdout.append);
    child.stderr.on('data', stderr.append);
    child.once('error', (error) => {
      const diagnostic = error.message + '\n';
      stderr.append(diagnostic);
    });
    exitCode = await new Promise<number>(resolve => child.once('close', code => resolve(code ?? 1)));
    cleanStdout = stdout.finish();
    cleanStderr = stderr.finish();
    // 2026-11-05: clean streams separately so interleaving cannot split an ANSI escape in the log.
    await log.handle.writeFile(cleanStdout + cleanStderr, 'utf8');
  } finally {
    await log.handle.close();
  }

  const selected = exitCode === 0
    ? successfulOutput(completedLines.map(line => stripVTControlCharacters(line).replace(/\r$/u, '')))
    : failedOutput(cleanStdout);
  if (selected.length) process.stdout.write(selected.join('\n') + '\n');
  if (exitCode !== 0) process.stderr.write(cleanStderr);
  process.stdout.write(`full log: ${log.filename}\n`);
  process.exitCode = exitCode;
}

main().catch((error: unknown) => {
  process.stderr.write(stripVTControlCharacters(String(error)) + '\n');
  process.exitCode = 1;
});
