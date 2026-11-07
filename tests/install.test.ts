import { afterEach, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { Repository } from '../server/repository.ts';
import { createApp } from '../server/app.ts';
import { WebSocket } from 'ws';
import { readProjectCatalog } from '../server/catalog.ts';
import { runCli } from '../server/cli.ts';
import { reportCliError } from '../server/cli-entry.ts';
import { initializeDemo } from '../server/demo.ts';

// 2026-11-05: test CLI flag precedence without opening a listener or a browser.
vi.mock('../server/main.ts', () => ({ address: 'http://127.0.0.1:4382' }));

const executeFile = promisify(execFile);
const directories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0)) {
    if (path.dirname(directory) !== tmpdir() || !path.basename(directory).startsWith('deckmate-install-')) {
      throw new Error('Unexpected install test cleanup target.');
    }
    await rm(directory, { recursive: true, force: true });
  }
});

it('opens a plain folder read-only without requiring or writing iteration metadata', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'deckmate-install-'));
  directories.push(directory);
  const repository = new Repository({ editMode: 'read-only', dataRoot: directory, writeRoot: null, port: 4317, projectName: 'Plain folder', python: 'unavailable-python' });
  await repository.initialize();
  const snapshot = await repository.snapshot();
  expect(snapshot).toMatchObject({ source: 'live', writable: false, editMode: 'read-only', iteration: { number: 0 } });
  expect(await readdir(directory)).toEqual([]);
});

it('rejects old Node before loading compiled modules or SQLite', async () => {
  const launcher = new URL('../bin/deckmate.mjs', import.meta.url).href;
  const script = `Object.defineProperty(process.versions, 'node', { value: '24.0.0' }); await import(${JSON.stringify(launcher)});`;
  await expect(executeFile(process.execPath, ['--input-type=module', '-e', script], { windowsHide: true }))
    .rejects.toMatchObject({ code: 1, stderr: 'Deckmate requires Node.js 26 or newer; found 24.0.0.\n' });
});

it('initializes the rich demo through the CLI and refuses to overwrite it', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'deckmate-install-'));
  directories.push(directory);
  const demo = path.join(directory, 'demo');
  const launcher = new URL('../server/cli.ts', import.meta.url).href;
  const script = `const { runCli } = await import(${JSON.stringify(launcher)}); await runCli();`;
  // 2026-11-05: a real entry file uses the same argv semantics as bin/deckmate.mjs, unlike node -e.
  const entry = path.join(directory, 'cli.mjs');
  await writeFile(entry, script);
  const args = [entry, 'init', demo];
  const result = await executeFile(process.execPath, args, { cwd: directory, windowsHide: true });
  expect(result.stdout).toContain('Demo created:');
  const catalog = await readProjectCatalog(demo);
  expect(catalog.warnings).toEqual([]);
  expect(catalog.decks).toHaveLength(5);
  expect(catalog.cards).toHaveLength(30);
  const repository = new Repository({ editMode: 'direct', dataRoot: demo, writeRoot: demo, port: 4317,
    projectName: 'Editable demo', python: 'unavailable-python' });
  await repository.initialize();
  expect(await repository.snapshot()).toMatchObject({ source: 'sandbox', writable: true, editMode: 'direct' });
  expect(await readdir(demo)).not.toContain('.git');
  const before = await readFile(path.join(demo, 'tasks/deckmate.md'));
  await expect(executeFile(process.execPath, args, { cwd: directory, windowsHide: true }))
    .rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('Demo destination is not empty') });
  expect(await readFile(path.join(demo, 'tasks/deckmate.md'))).toEqual(before);
}, 20000);

it('routes project, skills and agents subcommands like the npm scripts, with the current folder as the default', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'deckmate-install-'));
  directories.push(directory);
  const project = path.join(directory, 'project');
  const empty = path.join(directory, 'empty');
  await initializeDemo(project);
  await mkdir(empty);
  // 2026-11-05: in-process calls keep the suite light; each starts without a data folder, like a new process.
  const cwd = vi.spyOn(process, 'cwd');
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const deckmate = async (folder: string, ...args: string[]) => {
    for (const name of ['DATA', 'WRITE', 'READ_ONLY']) for (const prefix of ['DECKMATE_', 'FREETION_']) vi.stubEnv(prefix + name, undefined);
    cwd.mockReturnValue(folder);
    log.mockClear();
    await runCli(args);
    return log.mock.calls.map(call => call.join(' ')).join('\n');
  };

  expect(JSON.parse(await deckmate(project, 'project', 'map')).decks).toHaveLength(5);
  await writeFile(path.join(directory, '.env.local'), `DECKMATE_DATA='${project}'\n`);
  expect(JSON.parse(await deckmate(directory, 'project', 'summary')).counts.total).toBeGreaterThan(0);
  expect(JSON.parse(await deckmate(directory, 'project', '--data', empty, 'map')).decks).toEqual([]);
  await expect(deckmate(project, 'project', 'brief', 'c-missing')).rejects.toThrow(/^Card not found\. Pass a card ID or c-ref\.$/u);
  const manifest = await readFile(path.join(project, 'tasks/deckmate.md'));
  await expect(deckmate(project, 'project', 'init', 'action', '--read-only')).rejects.toThrow(/read-only mode/u);
  expect(await readFile(path.join(project, 'tasks/deckmate.md'))).toEqual(manifest);

  const skills = await deckmate(project, 'skills', 'status');
  expect(skills).toMatch(/^Source: .+\nVersion: \d{4}-\d{2}-\d{2}\n/u);
  expect(skills.match(/ \| not installed \| differs$/gmu)).toHaveLength(2);
  const out = path.join(directory, 'assignments');
  expect(await deckmate(project, 'agents', 'run', 'analyze', 'fx', '--dry', '--out', out)).toContain(`Assignments: ${out}\n`);
  expect((await readdir(out)).sort()).toEqual(['tz-code.md', 'tz-docs.md', 'tz-research.md']);
  expect(await deckmate(project, 'skills', '--help')).toContain('deckmate agents run <workflow> <area>');

  // bin/deckmate.mjs prints a command error as one line and takes the exit code from the error.
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const exitCode = process.exitCode;
  try {
    reportCliError(Object.assign(new Error('--lens: missing.md: lens file not found'), { exitCode: 2 }), 'Deckmate: ');
    expect(error).toHaveBeenCalledWith('Deckmate: --lens: missing.md: lens file not found');
    expect(process.exitCode).toBe(2);
  } finally {
    process.exitCode = exitCode;
  }
}, 30000);

it('makes --read-only override the local setting before starting the server', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'deckmate-install-'));
  directories.push(directory);
  await writeFile(path.join(directory, '.env.local'), 'DECKMATE_READ_ONLY=0\n');
  vi.spyOn(process, 'cwd').mockReturnValue(directory);
  vi.stubEnv('DECKMATE_READ_ONLY', undefined);
  vi.stubEnv('DECKMATE_DATA', undefined);
  const argumentsBefore = process.argv;
  process.argv = [process.execPath, 'deckmate', '--data', directory, '--read-only', '--no-open'];
  try {
    await runCli();
    expect(process.env.DECKMATE_READ_ONLY).toBe('1');
    expect(process.env.DECKMATE_DATA).toBe(directory);
  } finally {
    process.argv = argumentsBefore;
  }
});

it('shuts down while the browser event socket is still connected', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'deckmate-install-'));
  directories.push(directory);
  const app = await createApp({ editMode: 'read-only', dataRoot: directory, writeRoot: null, port: 4317, projectName: 'Socket demo', python: 'unavailable-python' });
  const headers = { host: '127.0.0.1:4317' };
  const { token } = (await app.inject({ url: '/api/snapshot', headers })).json();
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const socket = new WebSocket(address.replace('http:', 'ws:') + '/api/events?token=' + token, { headers });
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    // 2026-11-06: server shutdown can finish before the client receives its close event.
    const socketClosed = new Promise<void>(resolve => { socket.once('close', () => resolve()); });
    await Promise.race([
      Promise.all([app.close(), socketClosed]),
      new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new Error('Shutdown waited for the browser')), 2000); }),
    ]);
    expect(socket.readyState).toBe(WebSocket.CLOSED);
  } finally {
    clearTimeout(deadline);
    socket.terminate();
    await app.close();
  }
});
