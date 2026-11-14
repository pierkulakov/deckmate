import { spawn, type ChildProcess, type SpawnOptions, type StdioOptions } from 'node:child_process';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { defineText, serverText } from './i18n.ts';

const messages = defineText({
  notFound: (name: string, executable: string) => `Launcher ${name}: executable ${JSON.stringify(executable)} not found. Check run[0] and PATH.`,
  newline: (name: string) => `Launcher ${name}: Windows arguments must not contain CR or LF.`,
  batchArgument: (name: string, value: string) => `Launcher ${name}: .cmd/.bat paths and arguments must not contain CR, LF, %, ! or "; refused ${JSON.stringify(value)}.`,
  systemLauncherMissing: 'A system file launcher was not found in a trusted absolute directory.',
}, {
  notFound: (name: string, executable: string) => `Запуск ${name}: исполняемый файл ${JSON.stringify(executable)} не найден. Проверьте run[0] и PATH.`,
  newline: (name: string) => `Запуск ${name}: аргументы Windows не должны содержать CR или LF.`,
  batchArgument: (name: string, value: string) => `Запуск ${name}: пути и аргументы .cmd/.bat не должны содержать CR, LF, %, ! или "; отклонено значение ${JSON.stringify(value)}.`,
  systemLauncherMissing: 'Системная программа открытия файлов не найдена в доверенном абсолютном каталоге.',
});

export type LauncherInvocation =
  | { name: string; run: string[]; shell?: false }
  | { name: string; command: string; shell: true; env: { DECKMATE_PROMPT: string; DECKMATE_CWD: string } };

function notFound(name: string, executable: string): Error {
  return new Error(serverText(messages).notFound(name, executable));
}

async function isFile(filename: string): Promise<boolean> {
  try { return (await stat(filename)).isFile(); }
  catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return false;
    throw error;
  }
}

async function findExecutable(candidates: readonly string[]): Promise<string | null> {
  for (const candidate of candidates) {
    if (await isFile(candidate)) return candidate;
  }
  return null;
}

async function windowsExecutable(executable: string, cwd: string, name: string): Promise<string> {
  const hasPath = /[\\/]/u.test(executable) || /^[a-z]:/iu.test(executable);
  // 2026-11-07: untrusted projects may plant executables, so only explicit paths may implicitly resolve against cwd.
  const locations = hasPath ? [''] : (process.env.PATH ?? '').split(';').map(location => location.replace(/^"(.*)"$/u, '$1')).filter(Boolean);
  const extensions = path.extname(executable) ? [''] : (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  const candidates = locations.flatMap(location => extensions.map(extension => path.resolve(cwd, location, executable) + extension));
  const resolved = await findExecutable(candidates);
  if (!resolved) throw notFound(name, executable);
  return resolved;
}

/** 2026-11-14: project file actions must never resolve a launcher through project cwd or inherited PATH. */
export async function resolveSystemFileLauncher(platform: NodeJS.Platform = process.platform): Promise<string> {
  let candidates: string[];
  if (platform === 'win32') {
    const root = process.env.SystemRoot ?? 'C:\\Windows';
    // A root-relative Windows path still depends on the current drive, even though isAbsolute accepts it.
    if (!path.win32.isAbsolute(root) || path.win32.parse(root).root.length <= 1) {
      throw new Error(serverText(messages).systemLauncherMissing);
    }
    candidates = [path.win32.join(root, 'explorer.exe')];
  } else if (platform === 'darwin') {
    candidates = ['/usr/bin/open'];
  } else {
    candidates = ['/usr/bin/xdg-open', '/bin/xdg-open', '/usr/local/bin/xdg-open'];
  }
  const resolved = await findExecutable(candidates);
  if (!resolved) throw new Error(serverText(messages).systemLauncherMissing);
  return resolved;
}

function quoteArgument(value: string): string {
  return '"' + value.replace(/(\\*)$/u, '$1$1') + '"';
}

function batchCommand(name: string, executable: string, args: string[]): string {
  const values = [executable, ...args];
  // 2026-11-07: cmd.exe and npm shims' %* parse the line again; refuse expansion and quote breakers instead of escaping.
  for (const value of values) {
    if (/[\r\n%!"]/u.test(value)) throw new Error(serverText(messages).batchArgument(name, value));
  }
  return '"' + values.map(quoteArgument).join(' ') + '"';
}

async function invocationProcess(invocation: LauncherInvocation, cwd: string): Promise<{ executable: string; args: string[]; options: SpawnOptions }> {
  if (invocation.shell) {
    return { executable: invocation.command, args: [], options: { shell: true, env: { ...process.env, ...invocation.env } } };
  }
  const [executable, ...args] = invocation.run;
  if (process.platform !== 'win32') return { executable, args, options: { shell: false } };
  const resolved = await windowsExecutable(executable, cwd, invocation.name);
  if (/\.(?:cmd|bat)$/iu.test(resolved)) {
    return { executable: process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', batchCommand(invocation.name, resolved, args)],
      options: { shell: false, windowsVerbatimArguments: true } };
  }
  if (invocation.run.some(value => /[\r\n]/u.test(value))) throw new Error(serverText(messages).newline(invocation.name));
  return { executable: resolved, args, options: { shell: false } };
}

export async function spawnLauncher(invocation: LauncherInvocation, cwd: string, stdio: StdioOptions = 'inherit'): Promise<ChildProcess> {
  const { executable, args, options } = await invocationProcess(invocation, cwd);
  const child = spawn(executable, args, { cwd, stdio, windowsHide: true, ...options });
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') reject(notFound(invocation.name, executable));
      else reject(error);
    });
  });
  return child;
}
