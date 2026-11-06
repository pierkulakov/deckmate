import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { isMap, parseDocument } from 'yaml';

export interface AgentLauncher {
  command: string;
  tools?: string;
  capUsd?: number;
}

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

export function parseAgentsConfig(text: string, filename: string): AgentsConfig {
  const config = record(markdownHeader(text, filename).document.toJS(), filename, 'YAML');
  if (config.deckmate !== 'agents') invalid(filename, 'deckmate', 'expected agents');
  if (config.schema !== 1) invalid(filename, 'schema', 'only 1 is supported');
  const launchers: Record<string, AgentLauncher> = Object.create(null);
  for (const [name, value] of Object.entries(record(config.launchers, filename, 'launchers'))) {
    const key = `launchers.${name}`;
    const entry = record(value, filename, key);
    const launcher: AgentLauncher = { command: nonemptyString(entry.command, filename, `${key}.command`) };
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
    if (launcher.command.includes('{cap}') && launcher.capUsd === undefined) {
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

export function launcherCommand(launcher: AgentLauncher, prompt: string, cwd: string): string {
  const substitutions = { prompt, cwd, tools: launcher.tools ?? '', cap: String(launcher.capUsd ?? '') };
  return launcher.command.replace(/\{(prompt|cwd|tools|cap)\}/gu,
    (_match, key: keyof typeof substitutions) => substitutions[key]);
}
