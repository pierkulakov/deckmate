import { afterEach, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { launcherInvocation } from '../server/agents-config.ts';
import { spawnLauncher, type LauncherInvocation } from '../server/launch-process.ts';

vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});

const directories: string[] = [];
const specialArguments = ['with spaces (x86)', '"quotes"', '$()', '`backticks`', '%PATH%', '!x!', '& | ^ < >',
  'trailing\\', '\\"quote', '\\\\"quote', 'two\\\\', '', 'Русский текст', 'all (x86) " $() ` %PATH% !x! & | ^ < >\\'];
const batchArguments = ['with spaces (x86)', '$()', '`backticks`', '&', '|', '^', '(', ')', '<', '>', '& | ^ < >',
  'trailing\\', 'D:\\', 'two\\\\', '', ' ', 'Русский текст', 'all (x86) $() ` & | ^ < >\\'];
const unsafeBatchArguments = ['%PATH%', '!x!', '"quotes"', '\\"quote', '\\\\"quote', 'a\rb', 'a\nb', 'a\r\nb'];
const printArguments = 'console.log(JSON.stringify(process.argv.slice(1)))';

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  for (const directory of directories.splice(0)) {
    if (path.dirname(directory) !== path.resolve(tmpdir()) || !path.basename(directory).startsWith('deckmate-launch-')) {
      throw new Error('Unexpected launcher test cleanup target.');
    }
    await rm(directory, { recursive: true, force: true });
  }
});

async function capture(invocation: LauncherInvocation, cwd = process.cwd()) {
  const child = await spawnLauncher(invocation, cwd, 'pipe');
  let stdout = '';
  let stderr = '';
  child.stdout!.on('data', chunk => { stdout += chunk; });
  child.stderr!.on('data', chunk => { stderr += chunk; });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  expect(stderr).toBe('');
  expect(code).toBe(0);
  return JSON.parse(stdout.trim());
}

it('passes literal argv through a real shell-free node process', async () => {
  const invocation = launcherInvocation('node', {
    run: [process.execPath, '-e', printArguments, '--', 'Read {prompt} and finish.', '{cwd}', ...specialArguments],
  }, specialArguments.join('/'), specialArguments.join('\\'));
  expect(await capture(invocation)).toEqual([
    `Read ${specialArguments.join('/')} and finish.`, specialArguments.join('\\'), ...specialArguments,
  ]);
});

it('names the launcher and executable when resolution fails', async () => {
  await expect(spawnLauncher({ name: 'researcher', run: ['deckmate-missing-executable-20261107'] }, process.cwd()))
    .rejects.toThrow('Launcher researcher: executable "deckmate-missing-executable-20261107" not found');
});

it('passes trusted shell paths in the environment and preserves the inherited environment', async () => {
  vi.stubEnv('DECKMATE_LAUNCH_TEST', 'inherited');
  const program = 'console.log(JSON.stringify([process.env.DECKMATE_PROMPT,process.env.DECKMATE_CWD,process.env.DECKMATE_LAUNCH_TEST]))';
  const invocation = launcherInvocation('trusted', { command: `"${process.execPath}" -e "${program}"`, shell: true },
    specialArguments.join('/'), specialArguments.join('\\'));
  expect(await capture(invocation)).toEqual([specialArguments.join('/'), specialArguments.join('\\'), 'inherited']);
});

it.skipIf(process.platform !== 'win32').each(['\r', '\n', '\r\n'])('rejects Windows argument line breaks %j', async newline => {
  await expect(spawnLauncher({ name: 'reader', run: [process.execPath, '-e', printArguments, `a${newline}b`] }, process.cwd()))
    .rejects.toThrow('Launcher reader: Windows arguments must not contain CR or LF');
});

async function shim(extension: string, binName = 'bin with spaces & ^ (x86)') {
  const directory = await mkdtemp(path.join(tmpdir(), 'deckmate-launch-'));
  directories.push(directory);
  const bin = path.join(directory, binName);
  await mkdir(bin);
  const script = path.join(bin, `fixture-shim.${extension}`);
  await writeFile(script, `@node -e "${printArguments}" -- %*\r\n`);
  vi.stubEnv('PATH', [bin, path.dirname(process.execPath), process.env.PATH].join(path.delimiter));
  return { directory, bin, script };
}

it.skipIf(process.platform !== 'win32').each(['cmd', 'bat'])('passes literal arguments through a real .%s shim', async extension => {
  const { directory, script } = await shim(extension);
  expect(await capture({ name: 'shim', run: [script, ...batchArguments] }, directory)).toEqual(batchArguments);
});

it.skipIf(process.platform !== 'win32').each(['cmd', 'bat'].flatMap(extension =>
  unsafeBatchArguments.map(argument => ({ extension, argument }))))('refuses $extension argument $argument before spawning', async ({ extension, argument }) => {
  const { directory, script } = await shim(extension);
  await expect(spawnLauncher({ name: 'shim', run: [script, argument] }, directory))
    .rejects.toThrow(`Launcher shim: .cmd/.bat paths and arguments must not contain CR, LF, %, ! or "; refused ${JSON.stringify(argument)}.`);
  expect(spawn).not.toHaveBeenCalled();
});

it.skipIf(process.platform !== 'win32').each(['cmd', 'bat'].flatMap(extension =>
  ['%PATH%', '!x!'].map(value => ({ extension, value }))))('refuses a .$extension script path containing $value before spawning', async ({ extension, value }) => {
  const { directory, script } = await shim(extension, `bin with ${value}`);
  await expect(spawnLauncher({ name: 'shim', run: [script] }, directory))
    .rejects.toThrow(`Launcher shim: .cmd/.bat paths and arguments must not contain CR, LF, %, ! or "; refused ${JSON.stringify(script)}.`);
  expect(spawn).not.toHaveBeenCalled();
});

it.skipIf(process.platform !== 'win32')('sets the real shim working directory without a cwd substitution', async () => {
  const { directory, script } = await shim('cmd');
  await writeFile(script, '@node -e "console.log(JSON.stringify(process.cwd()))"\r\n');
  expect(await capture({ name: 'shim', run: [script] }, directory)).toBe(directory);
});

it.skipIf(process.platform !== 'win32')('resolves a bare shim through PATH and PATHEXT', async () => {
  const { directory } = await shim('cmd');
  vi.stubEnv('PATHEXT', '.EXE;.CMD');
  expect(await capture({ name: 'shim', run: ['fixture-shim', ...batchArguments] }, directory)).toEqual(batchArguments);
});

it.skipIf(process.platform !== 'win32').each(['fixture-shim', 'fixture-shim.cmd'])('resolves bare %s from PATH instead of a planted cwd shim', async executable => {
  const { directory, bin } = await shim('cmd');
  await writeFile(path.join(directory, 'fixture-shim.cmd'), '@echo ["planted"]\r\n');
  vi.stubEnv('PATH', [`"${bin}"`, path.dirname(process.execPath)].join(';'));
  vi.stubEnv('PATHEXT', '.EXE;.CMD');
  expect(await capture({ name: 'shim', run: [executable, ...batchArguments] }, directory)).toEqual(batchArguments);
});

it.skipIf(process.platform !== 'win32').each(['', ';', ';;', '""', ';"";;'])('ignores empty PATH entries in %j instead of resolving a cwd shim', async searchPath => {
  const { directory } = await shim('cmd');
  await writeFile(path.join(directory, 'fixture-shim.cmd'), '@echo ["planted"]\r\n');
  vi.stubEnv('PATH', searchPath);
  vi.stubEnv('PATHEXT', '.CMD');
  await expect(spawnLauncher({ name: 'shim', run: ['fixture-shim'] }, directory))
    .rejects.toThrow('Launcher shim: executable "fixture-shim" not found');
});

it.skipIf(process.platform !== 'win32').each(['./fixture-shim', '.\\fixture-shim.cmd'])('resolves explicit project-local %s against cwd', async executable => {
  const { directory } = await shim('cmd');
  await writeFile(path.join(directory, 'fixture-shim.cmd'), '@echo ["project"]\r\n');
  vi.stubEnv('PATHEXT', '.CMD');
  expect(await capture({ name: 'shim', run: [executable] }, directory)).toEqual(['project']);
});

it.skipIf(process.platform !== 'win32')('resolves a relative extensionless shim against the launch cwd', async () => {
  const { directory, bin } = await shim('cmd');
  vi.stubEnv('PATHEXT', '.CMD;.EXE');
  const executable = path.relative(directory, path.join(bin, 'fixture-shim'));
  expect(await capture({ name: 'shim', run: [executable, ...batchArguments] }, directory)).toEqual(batchArguments);
});

it.skipIf(process.platform !== 'win32').each(['exe', 'com'])('resolves a .%s executable through PATH and PATHEXT without a shell', async extension => {
  const { directory, bin } = await shim('cmd');
  await copyFile(process.execPath, path.join(bin, `fixture-node.${extension}`));
  vi.stubEnv('PATHEXT', '.COM;.EXE;.CMD');
  expect(await capture({ name: 'node', run: ['fixture-node', '-e', printArguments, '--', ...specialArguments] }, directory))
    .toEqual(specialArguments);
});
