import { spawn, type ChildProcess, type SpawnOptions, type StdioOptions } from 'node:child_process';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { defineText, serverText } from './i18n.ts';

const messages = defineText({
  notFound: (name: string, executable: string) => `Launcher ${name}: executable ${JSON.stringify(executable)} not found. Check run[0] and PATH.`,
  newline: (name: string) => `Launcher ${name}: Windows arguments must not contain CR or LF.`,
  batchArgument: (name: string, value: string) => `Launcher ${name}: .cmd/.bat paths and arguments must not contain CR, LF, %, ! or "; refused ${JSON.stringify(value)}.`,
}, {
  notFound: (name: string, executable: string) => `Запуск ${name}: исполняемый файл ${JSON.stringify(executable)} не найден. Проверьте run[0] и PATH.`,
  newline: (name: string) => `Запуск ${name}: аргументы Windows не должны содержать CR или LF.`,
  batchArgument: (name: string, value: string) => `Запуск ${name}: пути и аргументы .cmd/.bat не должны содержать CR, LF, %, ! или "; отклонено значение ${JSON.stringify(value)}.`,
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

async function windowsExecutable(executable: string, cwd: string, name: string): Promise<string> {
  const hasPath = /[\\/]/u.test(executable) || /^[a-z]:/iu.test(executable);
  // 2026-11-07: untrusted projects may plant executables, so only explicit paths may implicitly resolve against cwd.
  const locations = hasPath ? [''] : (process.env.PATH ?? '').split(';').map(location => location.replace(/^"(.*)"$/u, '$1')).filter(Boolean);
  const extensions = path.extname(executable) ? [''] : (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  for (const location of locations) {
    const base = path.resolve(cwd, location, executable);
    for (const extension of extensions) {
      if (await isFile(base + extension)) return base + extension;
    }
  }
  throw notFound(name, executable);
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
