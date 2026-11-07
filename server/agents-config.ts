import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { isMap, parseDocument } from 'yaml';
import { defineText, serverText } from './i18n.ts';
import type { LauncherInvocation } from './launch-process.ts';

const messages = defineText({
  launchMode: 'Specify exactly one of run (an argv list) or command (a trusted shell string).',
  runList: 'Expected a non-empty list of strings: a non-empty executable followed by arguments, which may be empty.',
  shellBoolean: 'Expected a boolean.',
  runShell: 'Use run without shell: true; trusted shell mode requires command instead.',
  trustedShell: 'Switch to run, or knowingly opt into trusted shell execution with shell: true.',
  shellPath: 'Do not use {prompt} or {cwd} in command; read DECKMATE_PROMPT and DECKMATE_CWD from the environment instead.',
}, {
  launchMode: 'Укажите ровно одно поле: run (список аргументов) или command (доверенная строка оболочки).',
  runList: 'Ожидается непустой список строк: непустое имя исполняемого файла, затем аргументы, которые могут быть пустыми.',
  shellBoolean: 'Ожидается логическое значение.',
  runShell: 'Используйте run без shell: true; для доверенного запуска через оболочку требуется command.',
  trustedShell: 'Перейдите на run или осознанно разрешите доверенный запуск через оболочку с shell: true.',
  shellPath: 'Не используйте {prompt} и {cwd} в command; читайте DECKMATE_PROMPT и DECKMATE_CWD из окружения.',
});

interface LauncherSettings {
  tools?: string;
  capUsd?: number;
}

export type AgentLauncher = LauncherSettings & (
  | { run: string[]; command?: never; shell?: false }
  | { command: string; shell: true; run?: never }
);

export interface AgentsConfig {
  schema: 1;
  launchers: Record<string, AgentLauncher>;
  routing: Record<string, string>;
  limits: { parallel: number; startGapSeconds: number };
}

function invalid(filename: string, key: string, message: string): never {
  throw new Error(`${filename}: ${key}: ${message}`);
}

/** 2026-11-05: preserve YAML source ranges for targeted manifest edits. */
export function markdownHeader(text: string, filename: string) {
  const opening = /^(?:\uFEFF)?---[ \t]*\r?\n/u.exec(text);
  if (!opening) invalid(filename, 'YAML', 'no YAML frontmatter');
  const rest = text.slice(opening[0].length);
  const closing = /^---[ \t]*(?:\r?\n|$)/mu.exec(rest);
  if (!closing) invalid(filename, 'YAML', 'no closing --- line');
  const yaml = rest.slice(0, closing.index);
  const document = parseDocument(yaml);
  if (document.errors.length) invalid(filename, 'YAML', document.errors[0].message.replace(/\s+/gu, ' '));
  if (!isMap(document.contents)) invalid(filename, 'YAML', 'expected an object');
  return { document, yaml, start: opening[0].length };
}

function record(value: unknown, filename: string, key: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(filename, key, 'expected an object');
  return value as Record<string, unknown>;
}

function nonemptyString(value: unknown, filename: string, key: string): string {
  if (typeof value !== 'string' || !value.trim()) invalid(filename, key, 'expected a non-empty string');
  return value;
}

function launcherMode(entry: Record<string, unknown>, filename: string, key: string): AgentLauncher {
  const text = serverText(messages);
  if ((entry.run !== undefined) === (entry.command !== undefined)) invalid(filename, key, text.launchMode);
  if (entry.shell !== undefined && typeof entry.shell !== 'boolean') invalid(filename, `${key}.shell`, text.shellBoolean);
  if (entry.run !== undefined) {
    if (!Array.isArray(entry.run) || !entry.run.length
      || entry.run.some((value, index) => typeof value !== 'string' || (index === 0 && !value.trim()))) invalid(filename, `${key}.run`, text.runList);
    if (entry.shell === true) invalid(filename, `${key}.shell`, text.runShell);
    return { run: entry.run as string[] };
  }
  if (entry.shell !== true) invalid(filename, `${key}.command`, text.trustedShell);
  const command = nonemptyString(entry.command, filename, `${key}.command`);
  if (/\{(?:prompt|cwd)\}/u.test(command)) invalid(filename, `${key}.command`, text.shellPath);
  return { command, shell: true };
}

export function parseAgentsConfig(text: string, filename: string): AgentsConfig {
  const config = record(markdownHeader(text, filename).document.toJS(), filename, 'YAML');
  if (config.deckmate !== 'agents') invalid(filename, 'deckmate', 'expected agents');
  if (config.schema !== 1) invalid(filename, 'schema', 'only 1 is supported');
  const launchers: Record<string, AgentLauncher> = Object.create(null);
  for (const [name, value] of Object.entries(record(config.launchers, filename, 'launchers'))) {
    const key = `launchers.${name}`;
    const entry = record(value, filename, key);
    const launcher = launcherMode(entry, filename, key);
    if (entry.tools !== undefined) {
      if (typeof entry.tools !== 'string') invalid(filename, `${key}.tools`, 'expected a string');
      launcher.tools = entry.tools;
    }
    if (entry.capUsd !== undefined) {
      if (typeof entry.capUsd !== 'number' || !Number.isFinite(entry.capUsd) || entry.capUsd <= 0) {
        invalid(filename, `${key}.capUsd`, 'expected a finite number greater than zero');
      }
      launcher.capUsd = entry.capUsd;
    }
    const templates = launcher.run ?? [launcher.command];
    if (templates.some(value => value.includes('{cap}')) && launcher.capUsd === undefined) {
      invalid(filename, `${key}.capUsd`, 'required by the {cap} substitution');
    }
    launchers[name] = launcher;
  }
  const routing: Record<string, string> = Object.create(null);
  for (const [role, value] of Object.entries(record(config.routing, filename, 'routing'))) {
    const target = nonemptyString(value, filename, `routing.${role}`);
    if (target !== 'self' && !Object.hasOwn(launchers, target)) invalid(filename, `routing.${role}`, `launcher ${target} not found`);
    routing[role] = target;
  }
  const limits = record(config.limits, filename, 'limits');
  const parallel = limits.parallel;
  const startGapSeconds = limits.startGapSeconds;
  if (typeof parallel !== 'number' || !Number.isSafeInteger(parallel) || parallel < 1) {
    invalid(filename, 'limits.parallel', 'expected an integer greater than zero');
  }
  if (typeof startGapSeconds !== 'number' || !Number.isFinite(startGapSeconds) || startGapSeconds < 0) {
    invalid(filename, 'limits.startGapSeconds', 'expected a finite number of at least zero');
  }
  return { schema: 1, launchers, routing, limits: { parallel, startGapSeconds } };
}

export async function readAgentsConfig(project: string): Promise<AgentsConfig> {
  const filename = path.resolve(project, 'tasks/deckmate-agents.md');
  let text: string;
  try { text = await readFile(filename, 'utf8'); }
  catch (error) {
    // 2026-11-05: without configuration, every role receives files for manual execution.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { schema: 1, launchers: {}, routing: {}, limits: { parallel: 1, startGapSeconds: 20 } };
    }
    invalid(filename, 'file', (error as Error).message);
  }
  return parseAgentsConfig(text, filename);
}

export function launcherInvocation(name: string, launcher: AgentLauncher, prompt: string, cwd: string): LauncherInvocation {
  const substitutions = { prompt, cwd, tools: launcher.tools ?? '', cap: String(launcher.capUsd ?? '') };
  if (launcher.shell) {
    const command = launcher.command.replace(/\{(tools|cap)\}/gu,
      (_match, key: 'tools' | 'cap') => substitutions[key]);
    return { name, command, shell: true, env: { DECKMATE_PROMPT: prompt, DECKMATE_CWD: cwd } };
  }
  const run = launcher.run.map(value => value.replace(/\{(prompt|cwd|tools|cap)\}/gu,
    (_match, key: keyof typeof substitutions) => substitutions[key]));
  return { name, run };
}
