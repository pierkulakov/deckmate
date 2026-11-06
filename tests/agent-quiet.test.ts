import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';

const quietFile = fileURLToPath(new URL('../tools/agent-quiet.ts', import.meta.url));
const fixtureDirectories: string[] = [];
const fixtureEnvironment: NodeJS.ProcessEnv = { ...process.env, NODE_OPTIONS: '', FORCE_COLOR: '3' };
delete fixtureEnvironment.NO_COLOR;

async function fixtureDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'deckmate-quiet-'));
  fixtureDirectories.push(directory);
  return directory;
}

async function runCommand(argumentsList: string[], directory = '') {
  const cwd = directory || await fixtureDirectory();
  const result = spawnSync(process.execPath, [quietFile, ...argumentsList], {
    cwd, encoding: 'utf8', windowsHide: true, timeout: 10000, maxBuffer: 4 * 1024 * 1024,
    env: fixtureEnvironment,
  });
  expect(result.error).toBeUndefined();
  const filename = result.stdout.match(/^full log: (.+)$/mu)?.[1].trim();
  expect(filename).toBeDefined();
  expect(path.dirname(filename!)).toBe(path.join(cwd, '.deckmate', 'quiet'));
  expect(path.basename(filename!)).toMatch(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-.+\.log$/u);
  return { ...result, cwd, filename: filename!, log: await readFile(filename!, 'utf8') };
}

function runScript(script: string, directory?: string) {
  return runCommand([process.execPath, '-e', script], directory);
}

function lines(text: string): string[] {
  return text.trimEnd().split(/\r?\n/u);
}

function writeStdout(output: string): string {
  return `process.stdout.write(${JSON.stringify(output)});`;
}

afterEach(async () => {
  for (const directory of fixtureDirectories.splice(0)) {
    if (path.dirname(directory) !== path.resolve(tmpdir()) || !path.basename(directory).startsWith('deckmate-quiet-')) {
      throw new Error('Unsafe quiet fixture cleanup');
    }
    await rm(directory, { recursive: true, force: true });
  }
});

it('keeps Vitest totals within 20 lines and preserves cwd, arguments and FORCE_COLOR', async () => {
  const output = Array.from({ length: 50 }, (_, index) => ` ✓ tests/example-${index}.test.ts (2 tests)`).join('\n')
    + '\n Test Files  50 passed (50)\n      Tests  100 passed (100)\n   Duration  1.23s\n';
  const script = 'if (process.env.FORCE_COLOR !== "0") process.exit(9);'
    + 'console.log(process.cwd());' + writeStdout('quoted "text" & | < > spaces; $value\n') + writeStdout(output);
  const result = await runScript(script);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  expect(lines(result.stdout).length).toBeLessThanOrEqual(20);
  for (const label of ['Test Files', 'Tests', 'Duration']) expect(result.stdout).toContain(label);
  expect(result.stdout).not.toContain('tests/example-');
  expect(result.log).toBe(`${result.cwd}\nquoted "text" & | < > spaces; $value\n${output}`);
});

it('keeps the Vite build total without dist chunk lines', async () => {
  const output = Array.from({ length: 80 }, (_, index) => `dist/assets/chunk-${index}.js 12.00 kB`).join('\n')
    + '\n✓ built in 2.34s\n';
  const result = await runScript(writeStdout(output));
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('built in 2.34s');
  expect(result.stdout).not.toContain('dist/');
  expect(lines(result.stdout).length).toBeLessThanOrEqual(20);
  expect(result.log).toBe(output);
});

it('retains every warning line from both streams even before the generic five-line tail', async () => {
  const warnings = ['WARN: keep the whole first line', 'Warning: repeated', 'Warning: repeated'];
  const stderr = 'DEPRECATED: keep this diagnostic too\n';
  const output = [...warnings, ...Array.from({ length: 30 }, (_, index) => `progress ${index}`)].join('\n') + '\n';
  const result = await runScript(`process.stderr.write(${JSON.stringify(stderr)});`
    + `setTimeout(()=>{${writeStdout(output)}},20);`);
  expect(result.status).toBe(0);
  for (const warning of [...warnings, stderr.trim()]) expect(result.stdout).toContain(warning);
  expect(result.stdout.match(/Warning: repeated/gu)).toHaveLength(2);
  expect(result.stdout).not.toContain('progress 0\n');
  expect(lines(result.stdout).slice(-6, -1)).toEqual(['progress 25', 'progress 26', 'progress 27', 'progress 28', 'progress 29']);
  expect(result.log).toContain(output);
  expect(result.log).toContain(stderr);
});

it('preserves all failed test names, all stderr including repeats and blanks, and the exit code', async () => {
  const failures = [' FAIL tests/example.test.ts > first failed name', ' ✗ second failed name',
    ' × третий упавший тест', 'Error: early diagnostic', 'src/example.ts: error TS2322: mismatch',
    'not ok 6 - another failed name'];
  const progress = Array.from({ length: 70 }, (_, index) => `progress ${index}`);
  const stderr = ['first stderr', '', 'repeated stderr', 'repeated stderr',
    ...Array.from({ length: 60 }, (_, index) => `stderr ${index}`), 'последняя строка без переноса'].join('\n');
  const output = [...failures, ...progress].join('\n') + '\n';
  const result = await runScript(writeStdout(output) + `process.stderr.write(${JSON.stringify(stderr)});process.exitCode=7;`);
  expect(result.status).toBe(7);
  expect(result.stderr).toBe(stderr);
  for (const failure of failures) expect(result.stdout).toContain(failure + '\n');
  expect(lines(result.stdout).slice(0, -1)).toEqual([...failures, ...progress.slice(-40)]);
  expect(result.log).toContain(output);
  expect(result.log).toContain(stderr);
});

it('strips split ANSI controls on failure from both the console and the full log', async () => {
  const result = await runScript("process.stdout.write('\x1b[');"
    + "setTimeout(()=>process.stderr.write('\x1b[33mError: цветная ошибка\x1b[0m\\n'),20);"
    + "setTimeout(()=>{process.stdout.write('31mFAIL colored test\x1b[0m\\n');process.exitCode=3;},50);");
  expect(result.status).toBe(3);
  expect(result.stdout).toContain('FAIL colored test\n');
  expect(result.stderr).toBe('Error: цветная ошибка\n');
  expect(result.log).toBe('FAIL colored test\nError: цветная ошибка\n');
  expect(result.stdout + result.stderr + result.log).not.toContain('\x1b');
});

it('handles empty output and keeps separate logs for repeated commands', async () => {
  const directory = await fixtureDirectory();
  const first = await runScript('', directory);
  const second = await runScript('', directory);
  for (const result of [first, second]) {
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.log).toBe('');
    expect(lines(result.stdout)).toHaveLength(1);
  }
  expect(second.filename).not.toBe(first.filename);
  expect(await readFile(first.filename, 'utf8')).toBe('');
});

it('logs all 10000 stdout lines and prints only the last five plus the path', async () => {
  const output = Array.from({ length: 10000 }, (_, index) => `line ${index}`).join('\n') + '\n';
  const result = await runScript("process.stdout.write(Array.from({length:10000},(_,index)=>'line '+index).join('\\n')+'\\n');");
  expect(result.status).toBe(0);
  expect(result.log).toBe(output);
  expect(lines(result.stdout).slice(0, -1)).toEqual(lines(output).slice(-5));
  expect(lines(result.stdout).length).toBeLessThanOrEqual(20);
});

it('preserves the shell diagnostic and exit code when the command is not found', async () => {
  const command = 'deckmate-quiet-command-that-does-not-exist-8675309';
  const result = await runCommand([command]);
  const direct = spawnSync(command, {
    cwd: result.cwd, shell: true, windowsHide: true, encoding: 'utf8',
    env: { ...fixtureEnvironment, FORCE_COLOR: '0' },
  });
  expect(result.status).toBe(direct.status);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toBe(direct.stderr);
  expect(result.stderr).toContain(command);
  expect(result.log).toContain(result.stderr);
});
