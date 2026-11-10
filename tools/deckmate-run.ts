import { mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { launcherInvocation, markdownHeader, readAgentsConfig, type AgentsConfig } from '../server/agents-config.ts';
import { spawnLauncher, type LauncherInvocation } from '../server/launch-process.ts';
import { runAsScript, type ExitCodeError } from '../server/cli-entry.ts';
import { defineText, serverText } from '../server/i18n.ts';
import { guardProjectPath, projectDeckmateHome } from './deckmate-skills.ts';
import { markerWords } from '../src/format-vocabulary.ts';
import { localIsoDate } from '../src/catalog-hand.ts';

const messages = defineText({
  agentsHelp: `Usage: deckmate agents run <workflow> <area> [--project <folder>] [--dry] [--roles research,code] [--lens <file>] [--out <folder>]

Writes a tz-<role>.md assignment for every "## Assignment:" section of the workflow and starts the launchers
configured in tasks/deckmate-agents.md; --dry writes and prints them without launching anything.

Options: --project <folder> · --dry · --roles <research,code> · --lens <file> · --out <folder>
Example: deckmate agents run analyze fx --dry --project <folder>

Other Deckmate entry points: deckmate · deckmate init <folder> · deckmate project <command> · deckmate skills <install|status>
See deckmate --help for the full overview.`,
  usage: 'Usage: deckmate agents run <workflow> <area> [--project <folder>] [--dry] [--roles research,code] [--lens <file>] [--out <folder>]',
  rolesValue: '--roles: expected a comma-separated list of roles',
}, {
  agentsHelp: `Использование: deckmate agents run <workflow> <area> [--project <папка>] [--dry] [--roles research,code] [--lens <файл>] [--out <папка>]

Записывает tz-<роль>.md для каждой секции "## Assignment:" сценария и запускает лаунчеры, настроенные в
tasks/deckmate-agents.md; --dry записывает и печатает задания, ничего не запуская.

Опции: --project <папка> · --dry · --roles <research,code> · --lens <файл> · --out <папка>
Пример: deckmate agents run analyze fx --dry --project <папка>

Другие входы Deckmate: deckmate · deckmate init <папка> · deckmate project <команда> · deckmate skills <install|status>
Полный обзор: deckmate --help.`,
  usage: 'Использование: deckmate agents run <workflow> <area> [--project <папка>] [--dry] [--roles research,code] [--lens <файл>] [--out <папка>]',
  rolesValue: '--roles: ожидается список ролей через запятую',
});

export interface RunOptions {
  project?: string;
  lens?: string;
  out?: string;
  dry?: boolean;
  roles?: string[];
  date?: string;
}

/** 2026-11-05: a missing --lens exits with 2 before anything is written. */
class LensFileError extends Error implements ExitCodeError {
  readonly exitCode = 2;
}

export interface RoleResult {
  role: string;
  prompt: string;
  result: string;
  invocation: LauncherInvocation | null;
  exitCode: number | null;
  state: 'manual' | 'dry' | 'finished' | 'failed';
  error?: string;
}

export interface RunRuntime {
  launch(invocation: LauncherInvocation, cwd: string): Promise<number>;
  now(): number;
  wait(milliseconds: number): Promise<void>;
}

const runtime: RunRuntime = {
  launch: async (invocation, cwd) => {
    const child = await spawnLauncher(invocation, cwd);
    return new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', code => resolve(code ?? 1));
    });
  },
  now: () => performance.now(),
  wait: milliseconds => delay(milliseconds),
};

function safeName(value: string, label: string): void {
  if (!/^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u.test(value)) throw new Error(`${label}: use letters, digits, hyphens or underscores`);
}

async function isFile(filename: string): Promise<boolean> {
  try { return (await stat(filename)).isFile(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

export async function detectEngine(project: string): Promise<'unity' | 'unreal' | 'godot' | 'none'> {
  if (await isFile(path.join(project, 'ProjectSettings/ProjectVersion.txt'))) return 'unity';
  const files = await readdir(project, { withFileTypes: true });
  if (files.some(entry => entry.isFile() && entry.name.endsWith('.uproject'))) return 'unreal';
  if (await isFile(path.join(project, 'project.godot'))) return 'godot';
  return 'none';
}

export function workflowAssignments(markdown: string, filename: string): Array<{ role: string; text: string }> {
  const nodes = unified().use(remarkParse).parse(markdown).children;
  const headings = nodes.filter(node => node.type === 'heading' && node.depth <= 2);
  const assignments: Array<{ role: string; text: string }> = [];
  const assignmentPattern = new RegExp(`^##[ \\t]+(?:${markerWords('assignment').join('|')})[ \\t]*(\\S+?)(?:[ \\t]+#+)?[ \\t]*$`, 'u');
  for (const [index, heading] of headings.entries()) {
    const start = heading.position!.start.offset!;
    const end = heading.position!.end.offset!;
    const label = markdown.slice(start, end).match(assignmentPattern);
    if (!label) continue;
    const role = label[1];
    safeName(role, `${filename}: role`);
    if (assignments.some(assignment => assignment.role === role)) throw new Error(`${filename}: ${markerWords('assignment').join(' / ')} ${role}: the role is repeated`);
    const nextStart = headings[index + 1]?.position?.start.offset ?? markdown.length;
    const text = markdown.slice(end, nextStart).trim();
    if (!text) throw new Error(`${filename}: ${markerWords('assignment').join(' / ')} ${role}: the assignment is empty`);
    assignments.push({ role, text });
  }
  return assignments;
}

async function skillFile(roots: string[], relative: string): Promise<string | null> {
  for (const root of roots) {
    const filename = path.join(root, relative);
    if (await isFile(filename)) return filename;
  }
  return null;
}

async function explicitLens(filename: string): Promise<string> {
  const absolute = path.resolve(filename);
  try {
    if (await isFile(absolute)) return absolute;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOTDIR') throw error;
  }
  throw new LensFileError(`--lens: ${absolute}: lens file not found`);
}

async function projectProfile(project: string, roots: string[]): Promise<{ profile: string; genre: string }> {
  const profile = path.join(project, 'tasks/deckmate-project.md');
  if (!await isFile(profile)) return { profile: '', genre: '' };
  const text = await readFile(profile, 'utf8');
  // 2026-11-05: profiles without YAML remain readable by agents but have no genre key.
  if (!/^(?:\uFEFF)?---[ \t]*\r?\n/u.test(text)) return { profile, genre: '' };
  const key = markdownHeader(text, profile).document.get('genre');
  if (key === undefined || key === null || key === '') return { profile, genre: '' };
  if (typeof key !== 'string') throw new Error(`${profile}: genre: expected a genre key string`);
  safeName(key, `${profile}: genre`);
  // 2026-11-06: a project genre guide in tasks/deckmate-genres/ overrides a built-in one with the same key.
  return { profile, genre: await skillFile([path.join(project, 'tasks/deckmate-genres')], `${key}.md`)
    ?? await skillFile(roots, `genres/${key}.md`) ?? '' };
}

/** 2026-11-07: a repeated run with the same --out must not silently replace a task file that was edited or answered. */
async function writeAssignment(prompt: string, content: string): Promise<void> {
  try {
    await writeFile(prompt, content, { flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    if (await readFile(prompt, 'utf8') !== content) {
      throw new Error(`${prompt}: already exists with different content; remove it or choose another --out`);
    }
  }
}

async function launchRoles(rows: RoleResult[], project: string, limits: AgentsConfig['limits'], execution: RunRuntime): Promise<void> {
  const active = new Set<Promise<void>>();
  let lastStart: number | undefined;
  for (const row of rows) {
    if (!row.invocation) continue;
    while (active.size >= limits.parallel) await Promise.race(active);
    if (lastStart !== undefined) {
      // 2026-11-05: short waits also support delays beyond Node's single-timer limit.
      let remaining = limits.startGapSeconds * 1000 - (execution.now() - lastStart);
      while (remaining > 0) {
        await execution.wait(Math.min(remaining, 60_000));
        remaining = limits.startGapSeconds * 1000 - (execution.now() - lastStart);
      }
    }
    lastStart = execution.now();
    const pending = (async () => {
      try {
        row.exitCode = await execution.launch(row.invocation!, project);
        row.state = row.exitCode === 0 ? 'finished' : 'failed';
      } catch (error) {
        row.exitCode = 1;
        row.state = 'failed';
        row.error = (error as Error).message;
      }
    })();
    active.add(pending);
    void pending.then(() => active.delete(pending));
  }
  await Promise.all(active);
}

export async function runWorkflow(workflow: string, area: string, options: RunOptions = {}, execution = runtime) {
  safeName(workflow, 'Workflow');
  safeName(area, 'Area');
  const chosenLens = options.lens === undefined ? undefined : await explicitLens(options.lens);
  const project = await realpath(path.resolve(options.project ?? process.cwd()));
  const home = await projectDeckmateHome(project);
  const roots = ['.agents/skills/deckmate', '.claude/skills/deckmate', 'skills/deckmate'].map(relative => path.join(project, relative));
  roots.push(path.join(home, 'skills/deckmate'));
  const filename = await skillFile(roots, `workflows/${workflow}.md`);
  if (!filename) throw new Error(`Workflow ${workflow} not found in ${roots.join(', ')}`);
  const assignments = workflowAssignments(await readFile(filename, 'utf8'), filename);
  for (const role of options.roles ?? []) {
    if (!assignments.some(assignment => assignment.role === role)) throw new Error(`${filename}: role ${role} not found`);
  }
  const selected = assignments.filter(assignment => !options.roles || options.roles.includes(assignment.role));
  const config = await readAgentsConfig(project);
  const engine = await detectEngine(project);
  // 2026-11-06: a project lens in tasks/deckmate-lenses/ takes precedence over installed and built-in lenses.
  const lens = chosenLens ?? await skillFile([path.join(project, 'tasks/deckmate-lenses')], `${area}.md`)
    ?? await skillFile(roots, `lenses/${area}.md`) ?? '';
  const { profile, genre } = await projectProfile(project, roots);
  const date = options.date ?? localIsoDate();
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) throw new Error('Date: expected YYYY-MM-DD');
  const out = options.out === undefined ? path.join(project, 'research_notes', `${area}-${date}`) : path.resolve(options.out);
  // 2026-11-05: explicitly allowed external output still needs parent checks from the drive or UNC root.
  const outputRoot = options.out === undefined ? project : path.parse(out).root;
  const substitutions = { area, project, date, out, engine, lens, profile, genre };
  const rows: RoleResult[] = [];
  if (out !== outputRoot) await guardProjectPath(outputRoot, out);
  for (const assignment of selected) await guardProjectPath(outputRoot, path.join(out, `tz-${assignment.role}.md`));
  if (selected.length || options.out !== undefined) await mkdir(out, { recursive: true });
  for (const assignment of selected) {
    const prompt = path.join(out, `tz-${assignment.role}.md`);
    await guardProjectPath(outputRoot, prompt);
    const content = assignment.text.replace(/\{(area|project|date|out|engine|lens|profile|genre)\}/gu,
      (_match, key: keyof typeof substitutions) => substitutions[key]);
    await writeAssignment(prompt, content + '\n');
    const target = config.routing[assignment.role];
    const launcher = target && target !== 'self' ? config.launchers[target] : undefined;
    rows.push({ role: assignment.role, prompt, result: path.join(out, `${assignment.role}.md`),
      invocation: launcher ? launcherInvocation(target, launcher, prompt, project) : null,
      exitCode: null, state: launcher ? 'dry' : 'manual' });
  }
  if (!options.dry) await launchRoles(rows, project, config.limits, execution);
  return { workflow: filename, project, out, engine, lens, profile, genre, rows };
}

export function runSummary(run: Awaited<ReturnType<typeof runWorkflow>>): string {
  const lines = [`Workflow: ${run.workflow}`, `Engine: ${run.engine}`, `Assignments: ${run.out}`,
    `Results: ${run.out}`,
    `Profile: ${run.profile || 'none'}`, `Genre: ${run.genre || 'none'}`,
    'Role | Command | Exit code | Result | State'];
  const states = { manual: 'manual: no launcher', dry: 'dry: not launched', finished: 'finished', failed: 'failed' };
  for (const row of run.rows) {
    const launch = row.invocation;
    let command = '—';
    if (launch) command = JSON.stringify(launch.shell ? { command: launch.command, env: launch.env } : launch.run);
    lines.push(`${row.role} | ${command} | ${row.exitCode ?? '—'} | ${row.result} | ${states[row.state]}`);
    if (row.error) lines.push(`${row.role}: ${row.error.replace(/\s+/gu, ' ')}`);
  }
  if (!run.rows.length) lines.push('No agent assignments; the calling model performs the self sections.');
  return lines.join('\n');
}

/** `npm run agents -- run …` and `deckmate agents run …`; returns 1 when a launched role failed. */
export async function agentsCli(args = process.argv.slice(2)): Promise<number> {
  const { values, positionals } = parseArgs({ args, allowPositionals: true,
    options: { project: { type: 'string' }, dry: { type: 'boolean' }, roles: { type: 'string' },
      lens: { type: 'string' }, out: { type: 'string' }, help: { type: 'boolean', short: 'h' } } });
  // 2026-11-09: --help and -h answer with usage before the positional check, like the other entries.
  if (values.help) { console.log(serverText(messages).agentsHelp); return 0; }
  const text = serverText(messages);
  if (positionals.length !== 3 || positionals[0] !== 'run') {
    throw new Error(text.usage);
  }
  const roles = values.roles?.split(',').map(role => role.trim());
  if (roles?.some(role => !role)) throw new Error(text.rolesValue);
  const run = await runWorkflow(positionals[1], positionals[2], {
    project: values.project, dry: values.dry, roles, lens: values.lens, out: values.out,
  });
  console.log(runSummary(run));
  return run.rows.some(row => row.state === 'failed') ? 1 : 0;
}

runAsScript(import.meta.url, agentsCli);
