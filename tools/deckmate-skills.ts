import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, statSync } from 'node:fs';
import { lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { isMap, isScalar } from 'yaml';
import { markdownHeader } from '../server/agents-config.ts';
import { runAsScript } from '../server/cli-entry.ts';
import { defineText, serverText } from '../server/i18n.ts';
import { resolveDataPath } from '../server/data-paths.ts';
import { readProjectMarkdown, replaceProjectMarkdown } from '../server/native-cards.ts';
import { renameChecked } from '../server/guarded-files.ts';
import { packagePath } from '../server/package-path.ts';

const destinations = ['.claude/skills/deckmate', '.agents/skills/deckmate'];
const rulesStart = '<!-- deckmate:agent-rules:start -->';
const rulesEnd = '<!-- deckmate:agent-rules:end -->';
type AgentRulesStatus = 'missing-file' | 'missing-block' | 'matches' | 'differs';

/** 2026-11-09: files a reinstall would overwrite or delete, per installed copy. */
export interface SkillCopyEdits { destination: string; changed: string[]; added: string[] }

const messages = defineText({
  skillsHelp: `Usage: deckmate skills <install|status> [--project <folder>] [--from <Deckmate folder>] [--force]

install  Copy this Deckmate's skills/deckmate package into the project's .claude/skills and .agents/skills folders.
         Add or update the marked Deckmate rules block in the project's AGENTS.md; preserve text outside it.
         Register the deckmate MCP server in .mcp.json and, when the folder exists, .cursor/mcp.json; when the launch
         line belongs to this machine only, print it for manual setup instead.
status   Compare the installed copies with this package, byte for byte, and show the MCP registration state.
--force  install: replace copies that contain local changes and a deckmate MCP entry that names another server;
         without it install lists them and changes nothing.

Example: deckmate skills install --project <folder>

Other Deckmate entry points: deckmate · deckmate init <folder> · deckmate project <command> · deckmate agents run <workflow> <area>
See deckmate --help for the full overview.`,
  usage: 'Usage: deckmate skills <install|status> [--project <folder>] [--from <Deckmate folder>] [--force]',
  forceInstallOnly: '--force applies to install only. See deckmate skills --help.',
  localEdits: (edits: SkillCopyEdits[]) => {
    const listed = edits.map(edit => {
      const parts: string[] = [];
      if (edit.changed.length) parts.push(`changed: ${edit.changed.join(', ')}`);
      if (edit.added.length) parts.push(`added: ${edit.added.join(', ')}`);
      return `${edit.destination} (${parts.join('; ')})`;
    }).join('; ');
    return `deckmate skills install: installed copies contain files that differ from this package: ${listed}. Nothing was changed; move your edits out first, or pass --force to replace the copies and lose them.`;
  },
  manifestChanged: (manifest: string) =>
    `${manifest}: the project manifest changed while deckmate skills install was checking the project; nothing was replaced. Re-run deckmate skills install.`,
  invalidRules: (filename: string) => `${filename}: expected exactly one ordered pair of Deckmate agent-rules markers on separate lines, or no markers. Nothing was changed.`,
  regularFile: (filename: string) => `${filename}: expected a regular file, not a link or folder.`,
  fileChanged: (filename: string) => `${filename}: the file changed while deckmate skills install was running; it was not replaced. Re-run deckmate skills install.`,
  'missing-server': 'no deckmate server',
  'mcp-invalid': 'invalid JSON or not an object',
  'mcp-written': 'written',
  'mcp-format': (file: string, fragment: string) =>
    `${file}: the JSON formatting is not one Deckmate can reproduce; nothing was changed. Add the server by hand inside "mcpServers": ${fragment}`,
  mcpDiffers: (paths: string[]) =>
    `deckmate skills install: ${paths.join(', ')}: mcpServers.deckmate already names another server; nothing was changed. Move that entry out of the file, or pass --force to replace it.`,
  mcpManualIntro: 'The deckmate MCP launch line names this machine, so shared project files were left alone. Register the server by hand:',
  mcpClaude: (line: string) => `Claude Code: ${line}`,
  mcpOtherClients: (fragment: string) => `Other clients, inside "mcpServers": ${fragment}`,
  mcpCheck: (line: string) => `Check the server: ${line}`,
  missingRules: (source: string) => `${source}: project-rules.md: file not found.`,
  missingLayoutRules: (source: string) => `${source}: layout-rules.md: file not found.`,
  ruleConflict: (line: number, text: string) => `line ${line}: ${text} — may conflict with board rules`,
  moreRuleConflicts: (count: number) => `and ${count} more`,
  'missing-file': 'no file',
  'missing-block': 'no block',
  matches: 'matches',
  differs: 'differs',
  installed: (version: string, destinations: string, home: string, manifest: string) =>
    `Installed: ${version} into ${destinations}\nSource: ${home}\nManifest: ${manifest}`,
  statusSummary: (home: string, version: string) => `Source: ${home}\nVersion: ${version}`,
  notInstalled: 'not installed',
  rulesUpdated: (filename: string) => `Updated: ${filename}`,
  stoppedInstall: (step: string, reason: string, applied: string[], pending: string[]) =>
    `deckmate skills install stopped at ${step} (${reason}); ${step} may be partially written. Applied: ${applied.join(', ') || 'none'}. Not applied: ${pending.join(', ') || 'none'}. Fix the problem and re-run deckmate skills install.`,
}, {
  skillsHelp: `Использование: deckmate skills <install|status> [--project <папка>] [--from <папка Deckmate>] [--force]

install  Скопировать пакет skills/deckmate этого Deckmate в папки .claude/skills и .agents/skills проекта.
         Добавить или обновить блок правил Deckmate между маркерами в AGENTS.md проекта; остальной текст сохранить.
         Прописать MCP-сервер deckmate в .mcp.json и, если папка есть, в .cursor/mcp.json; если строка запуска
         привязана к этой машине, напечатать её для ручной настройки.
status   Сравнить установленные копии с этим пакетом байт в байт и показать состояние регистрации MCP.
--force  install: заменить копии с локальными правками и запись MCP deckmate, указывающую на другой сервер;
         без флага install перечисляет их и ничего не меняет.

Пример: deckmate skills install --project <папка>

Другие входы Deckmate: deckmate · deckmate init <папка> · deckmate project <команда> · deckmate agents run <workflow> <area>
Полный обзор: deckmate --help.`,
  usage: 'Использование: deckmate skills <install|status> [--project <папка>] [--from <папка Deckmate>] [--force]',
  forceInstallOnly: '--force применим только к install. Смотрите deckmate skills --help.',
  localEdits: (edits: SkillCopyEdits[]) => {
    const listed = edits.map(edit => {
      const parts: string[] = [];
      if (edit.changed.length) parts.push(`изменены: ${edit.changed.join(', ')}`);
      if (edit.added.length) parts.push(`добавлены: ${edit.added.join(', ')}`);
      return `${edit.destination} (${parts.join('; ')})`;
    }).join('; ');
    return `deckmate skills install: в установленных копиях есть файлы, отличающиеся от этого пакета: ${listed}. Ничего не изменено; сначала уберите свои правки или передайте --force, чтобы заменить копии и потерять их.`;
  },
  manifestChanged: (manifest: string) =>
    `${manifest}: манифест проекта изменился во время проверки в deckmate skills install; ничего не заменено. Повторите deckmate skills install.`,
  invalidRules: (filename: string) => `${filename}: нужна ровно одна упорядоченная пара маркеров Deckmate agent-rules на отдельных строках либо отсутствие маркеров. Ничего не изменено.`,
  regularFile: (filename: string) => `${filename}: нужен обычный файл, не ссылка и не папка.`,
  fileChanged: (filename: string) => `${filename}: файл изменился во время deckmate skills install; он не заменён. Повторите deckmate skills install.`,
  'missing-server': 'нет сервера deckmate',
  'mcp-invalid': 'некорректный JSON или неверный формат объекта MCP',
  'mcp-written': 'записан',
  'mcp-format': (file: string, fragment: string) =>
    `${file}: JSON отформатирован так, что Deckmate не может воспроизвести файл; ничего не изменено. Добавьте сервер вручную внутри "mcpServers": ${fragment}`,
  mcpDiffers: (paths: string[]) =>
    `deckmate skills install: ${paths.join(', ')}: mcpServers.deckmate уже указывает на другой сервер; ничего не изменено. Уберите эту запись из файла или передайте --force, чтобы заменить её.`,
  mcpManualIntro: 'Строка запуска MCP deckmate привязана к этой машине, поэтому общие файлы проекта не тронуты. Пропишите сервер вручную:',
  mcpClaude: (line: string) => `Claude Code: ${line}`,
  mcpOtherClients: (fragment: string) => `Другие клиенты, внутри "mcpServers": ${fragment}`,
  mcpCheck: (line: string) => `Проверка сервера: ${line}`,
  missingRules: (source: string) => `${source}: project-rules.md: файл не найден.`,
  missingLayoutRules: (source: string) => `${source}: layout-rules.md: файл не найден.`,
  ruleConflict: (line: number, text: string) => `строка ${line}: ${text} — может противоречить правилам доски`,
  moreRuleConflicts: (count: number) => `и ещё ${count}`,
  'missing-file': 'нет файла',
  'missing-block': 'нет блока',
  matches: 'совпадает',
  differs: 'отличается',
  installed: (version: string, destinations: string, home: string, manifest: string) =>
    `Установлено: ${version} в ${destinations}\nИсточник: ${home}\nМанифест: ${manifest}`,
  statusSummary: (home: string, version: string) => `Источник: ${home}\nВерсия: ${version}`,
  notInstalled: 'не установлен',
  rulesUpdated: (filename: string) => `Обновлён: ${filename}`,
  stoppedInstall: (step: string, reason: string, applied: string[], pending: string[]) =>
    `deckmate skills install остановился на шаге ${step} (${reason}); шаг ${step} может быть применён частично. Применено: ${applied.join(', ') || 'ничего'}. Не применено: ${pending.join(', ') || 'ничего'}. Исправьте проблему и повторите deckmate skills install.`,
});

export function patchDeckmateHome(bytes: Buffer, home: string, filename: string): Buffer {
  const text = bytes.toString('utf8');
  const { document, yaml, start } = markdownHeader(text, filename);
  if (document.get('deckmateHome') === home) return bytes;
  if (!isMap(document.contents) || !document.contents.range) throw new Error(`${filename}: YAML: the frontmatter object has no source range`);
  let from: number;
  let to: number;
  let replacement: string;
  if (document.has('deckmateHome')) {
    const scalar = document.get('deckmateHome', true);
    if (!isScalar(scalar) || !scalar.range) throw new Error(`${filename}: deckmateHome: expected an explicit scalar value`);
    [from, to] = scalar.range;
    const separator = from === to && yaml[from - 1] === ':' ? ' ' : '';
    replacement = separator + JSON.stringify(home) + (yaml.slice(from, to).match(/\r?\n$/u)?.[0] ?? '');
  } else {
    from = document.contents.range[0] + (document.contents.flow ? 1 : 0);
    to = from;
    const newline = text.includes('\r\n') ? '\r\n' : '\n';
    const suffix = document.contents.flow ? (document.contents.items.length ? ', ' : '') : newline;
    replacement = `deckmateHome: ${JSON.stringify(home)}${suffix}`;
  }
  const byteStart = Buffer.byteLength(text.slice(0, start + from));
  const byteEnd = Buffer.byteLength(text.slice(0, start + to));
  const updated = Buffer.concat([bytes.subarray(0, byteStart), Buffer.from(replacement), bytes.subarray(byteEnd)]);
  const expected = { ...document.toJS(), deckmateHome: home };
  if (!isDeepStrictEqual(markdownHeader(updated.toString('utf8'), filename).document.toJS(), expected)) {
    throw new Error(`${filename}: deckmateHome: the edit would change other YAML values`);
  }
  return updated;
}

export async function projectDeckmateHome(project: string): Promise<string> {
  const relative = await resolveDataPath(project, 'tasks/deckmate.md');
  let bytes: Buffer;
  try { bytes = await readProjectMarkdown(project, relative); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return packagePath();
    throw error;
  }
  const filename = path.join(project, relative);
  const home = markdownHeader(bytes.toString('utf8'), filename).document.get('deckmateHome');
  if (home === undefined) return packagePath();
  if (typeof home !== 'string' || !path.isAbsolute(home)) throw new Error(`${filename}: deckmateHome: expected an absolute path`);
  return home;
}

/** 2026-11-05: check every parent directory before writing or deleting a tree. */
export async function guardProjectPath(project: string, target: string): Promise<void> {
  if (!pathInside(project, target)) {
    throw new Error(`${target}: the path must be inside ${project}`);
  }
  let current = project;
  for (const segment of path.relative(project, target).split(path.sep)) {
    current = path.join(current, segment);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error(`${current}: cannot write through a symbolic link`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

/** True when `target` lies strictly under `parent`; the same path, `..` escapes and other roots do not count. */
function pathInside(parent: string, target: string): boolean {
  const relative = path.relative(parent, target);
  return Boolean(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** Reads a project file for a guarded write: null when it does not exist, an error when it is not a regular file. */
async function readProjectFile(project: string, filename: string): Promise<Buffer | null> {
  await guardProjectPath(project, filename);
  try {
    if (!(await lstat(filename)).isFile()) throw new Error(serverText(messages).regularFile(filename));
    return await readFile(filename);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function patchAgentRules(before: Buffer | null, rules: Buffer, filename: string): { after: Buffer; status: AgentRulesStatus } {
  const text = before?.toString('utf8') ?? '';
  const newline = text.match(/\r?\n/u)?.[0] ?? '\n';
  const content = rules.toString('utf8').replace(/(?:\r?\n)+$/u, '').replace(/\r?\n/gu, newline);
  const start = text.indexOf(rulesStart);
  const end = text.indexOf(rulesEnd);
  if (start < 0 && end < 0) {
    let separator = '';
    if (text && text !== '\uFEFF') {
      separator = newline + newline;
      if (text.endsWith(newline)) separator = newline;
      if (text.endsWith(newline + newline)) separator = '';
    }
    const block = Buffer.from(`${separator}${rulesStart}${newline}${content}${newline}${rulesEnd}${newline}`);
    return { after: Buffer.concat([before ?? Buffer.alloc(0), block]), status: before === null ? 'missing-file' : 'missing-block' };
  }
  const onOwnLine = (index: number, marker: string) => {
    const previous = text.slice(0, index);
    const following = text.slice(index + marker.length);
    return (previous === '' || previous === '\uFEFF' || previous.endsWith('\n'))
      && (following === '' || following.startsWith('\n') || following.startsWith('\r\n'));
  };
  if (start < 0 || end < start + rulesStart.length || text.lastIndexOf(rulesStart) !== start
    || text.lastIndexOf(rulesEnd) !== end || !onOwnLine(start, rulesStart) || !onOwnLine(end, rulesEnd)) {
    throw new Error(serverText(messages).invalidRules(filename));
  }
  const from = Buffer.byteLength(text.slice(0, start + rulesStart.length));
  const to = Buffer.byteLength(text.slice(0, end));
  const after = Buffer.concat([before!.subarray(0, from), Buffer.from(`${newline}${content}${newline}`), before!.subarray(to)]);
  return { after, status: before!.equals(after) ? 'matches' : 'differs' };
}

async function checkProjectFile(project: string, filename: string, before: Buffer | null): Promise<void> {
  const current = await readProjectFile(project, filename);
  if (before === null ? current !== null : current === null || !before.equals(current)) {
    throw new Error(serverText(messages).fileChanged(filename));
  }
}

/**
 * 2026-11-12: fresh source bytes prevent overwriting concurrent edits; cleanup also covers a failed publication.
 */
async function replaceProjectFile(project: string, filename: string, before: Buffer | null, after: Buffer): Promise<void> {
  const temporary = path.join(path.dirname(filename), `.${path.basename(filename)}.${randomUUID()}.tmp`);
  await guardProjectPath(project, filename);
  await guardProjectPath(project, temporary);
  try {
    await writeFile(temporary, after, { flag: 'wx' });
    await renameChecked(temporary, filename, { beforeRename: async () => {
      await checkProjectFile(project, filename, before);
      await guardProjectPath(project, filename);
    } });
  } finally {
    await rm(temporary, { force: true });
  }
}

export interface McpLaunch { kind: 'machine' | 'portable'; command: string; args: string[] }

/** One `mcpServers` entry: the launch line without the classification. */
type McpEntry = { command: string; args: string[] };

/** The config entry a launch line writes, with its own copy of the arguments. */
function entryOf(launch: McpLaunch): McpEntry {
  return { command: launch.command, args: [...launch.args] };
}

function commandOnPath(name: string): boolean {
  const directories = (process.env.PATH ?? '').split(path.delimiter).map(entry => entry.replace(/^"+|"+$/u, ''));
  return directories.some(directory => path.isAbsolute(directory) && statSync(path.join(directory, name), { throwIfNoEntry: false })?.isFile());
}

/**
 * The launch line of `deckmate mcp` on this machine (2026-11-11). A `machine` line embeds absolute paths of this
 * installation and must not reach the shared project files; a `portable` line names the `deckmate` command from
 * PATH and keeps working for everyone who clones the project.
 */
export function mcpLaunch(home = packagePath(), execPath = process.execPath): McpLaunch {
  // 2026-11-11: the desktop app runs a bundled node.exe placed next to Deckmate.exe (desktop/src-tauri/src/paths.rs),
  // and the shell binary starts the same bundled server, so the app path alone identifies the installation.
  const directory = path.dirname(execPath);
  if (path.basename(execPath).toLowerCase() === 'node.exe'
    && statSync(path.join(directory, 'Deckmate.exe'), { throwIfNoEntry: false })?.isFile()) {
    return { kind: 'machine', command: path.join(directory, 'Deckmate.exe'), args: ['mcp'] };
  }
  // 2026-11-12: Windows shell/PATH resolution includes cwd; shared projects must not select an executable.
  if (process.platform !== 'win32' && commandOnPath('deckmate')) return { kind: 'portable', command: 'deckmate', args: ['mcp'] };
  return { kind: 'machine', command: execPath, args: [path.join(home, 'bin', 'deckmate.mjs'), 'mcp'] };
}

/** Shared project files that MCP-capable clients read. */
async function mcpConfigTargets(root: string): Promise<string[]> {
  const targets = [path.join(root, '.mcp.json')];
  // 2026-11-11: the person owns the .cursor folder; Deckmate configures it only when it is already there.
  // 2026-11-12: lstat stays synchronous — the promise variant has no throwIfNoEntry and would throw on a missing folder.
  if (lstatSync(path.join(root, '.cursor'), { throwIfNoEntry: false })?.isDirectory()) {
    targets.push(path.join(root, '.cursor', 'mcp.json'));
  }
  return targets;
}

interface McpConfig { text: string; root: Record<string, unknown>; servers: Record<string, unknown> | undefined }

/** Parses a client MCP config; null when it is not a JSON object with an object `mcpServers` field. */
function parseMcpConfig(bytes: Buffer): McpConfig | null {
  // 2026-11-12: JSON.parse cannot consume a BOM; planMcpFile preserves it when publishing the updated bytes.
  const text = bytes.toString('utf8').replace(/^\uFEFF/u, '');
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return null; }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const servers = (parsed as Record<string, unknown>).mcpServers;
  if (servers !== undefined && (typeof servers !== 'object' || servers === null || Array.isArray(servers))) return null;
  return { text, root: parsed as Record<string, unknown>, servers: servers as Record<string, unknown> | undefined };
}

type JsonIndent = 2 | 4 | '\t';

/** The indent of the first indented line, as JSON.stringify writes it; null when the file uses anything else. */
function jsonIndent(text: string): JsonIndent | null {
  const leading = /^([ \t]+)\S/mu.exec(text)?.[1];
  if (leading === undefined) return 2;
  if (leading.startsWith('\t')) return '\t';
  return leading.length === 2 || leading.length === 4 ? leading.length as 2 | 4 : null;
}

function configStyle(text: string): { newline: '\r\n' | '\n'; trailing: string } {
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  return { newline, trailing: /\r?\n$/u.test(text) ? newline : '' };
}

/** The bytes JSON.stringify writes for `value` under the file's own indent and line ending. */
function asConfigBytes(value: unknown, indent: JsonIndent, style: { newline: '\r\n' | '\n'; trailing: string }): string {
  return `${JSON.stringify(value, null, indent).replace(/\n/gu, style.newline)}${style.trailing}`;
}

export type McpPlanStatus = 'create' | 'update' | 'matches' | 'differs' | 'invalid' | 'format';
export type McpFileState = 'no-file' | 'missing-server' | 'matches' | 'differs' | 'invalid';

export interface McpPlan {
  /** Absolute path of the config file. */
  file: string;
  /** Path relative to the project root with forward slashes, for messages. */
  path: string;
  status: McpPlanStatus;
  before: Buffer | null;
  after: Buffer | null;
}

async function planMcpFile(root: string, file: string, entry: McpEntry): Promise<McpPlan> {
  const display = path.relative(root, file).split(path.sep).join('/');
  const before = await readProjectFile(root, file);
  if (before === null) {
    // 2026-11-11: a new file gets Deckmate's own format: two spaces and one final newline.
    return { file, path: display, status: 'create', before,
      after: Buffer.from(`${JSON.stringify({ mcpServers: { deckmate: entry } }, null, 2)}\n`) };
  }
  const config = parseMcpConfig(before);
  if (!config) return { file, path: display, status: 'invalid', before, after: null };
  const indent = jsonIndent(config.text);
  const style = configStyle(config.text);
  // 2026-11-11: rewrite only a file whose bytes JSON.stringify reproduces exactly, so no foreign formatting moves.
  if (indent === null || asConfigBytes(config.root, indent, style) !== config.text) {
    return { file, path: display, status: 'format', before, after: null };
  }
  if (config.servers !== undefined && isDeepStrictEqual(config.servers.deckmate, entry)) {
    return { file, path: display, status: 'matches', before, after: null };
  }
  const updated = { ...config.root, mcpServers: { ...config.servers, deckmate: entry } };
  return { file, path: display, before,
    status: config.servers !== undefined && 'deckmate' in config.servers ? 'differs' : 'update',
    after: Buffer.from((before.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) ? '\uFEFF' : '') + asConfigBytes(updated, indent, style)) };
}

export async function planMcpFiles(root: string, launch: McpLaunch): Promise<McpPlan[]> {
  const entry = entryOf(launch);
  const plans: McpPlan[] = [];
  for (const file of await mcpConfigTargets(root)) plans.push(await planMcpFile(root, file, entry));
  return plans;
}

/** The MCP plans install would apply; the CLI uses them to ask for `--force` before a foreign server is replaced. */
async function mcpPlans(project: string, from = packagePath()): Promise<McpPlan[]> {
  const root = await realpath(path.resolve(project));
  const launch = mcpLaunch(await realpath(path.resolve(from)));
  return launch.kind === 'portable' ? planMcpFiles(root, launch) : [];
}

async function mcpFileState(root: string, file: string, entry: McpEntry): Promise<McpFileState> {
  const before = await readProjectFile(root, file);
  if (before === null) return 'no-file';
  const config = parseMcpConfig(before);
  if (!config) return 'invalid';
  if (config.servers?.deckmate === undefined) return 'missing-server';
  return isDeepStrictEqual(config.servers.deckmate, entry) ? 'matches' : 'differs';
}

/** The launch line with every word quoted, as command-line examples show it. */
function mcpCommandWords(launch: McpLaunch): string {
  return [launch.command, ...launch.args].map(part => `"${part.replaceAll('"', '\\"')}"`).join(' ');
}

function mcpFragment(launch: McpLaunch): string {
  return JSON.stringify({ deckmate: entryOf(launch) });
}

function mcpCheckCommand(launch: McpLaunch): string {
  // 2026-11-11: a machine line must be checked exactly as registered; the portable command is plain `deckmate`.
  return launch.kind === 'portable' ? 'deckmate mcp --check' : `${mcpCommandWords(launch)} --check`;
}

export interface AgentRuleConflict { line: number; text: string }

function prescribesWorkLocation(line: string): boolean {
  const content = line.replace(/^(?:[-*]|\d+[.)])\s+/u, '').replace(/[*_`]/gu, '').trim();
  const subject = /\b(?:tasks?|work|slices?|boards?|layout)\b|задач|работ|срез|доск|расклад/iu;
  const imperative = /^(?:please\s+)?(?:keep|track|manage|store|write|put|record|maintain)\s+(.+?)\s+(?:in|on|under|at|to)\s+\S/iu;
  const russian = /^(?:пожалуйста[,\s]+)?(?:веди(?:те)?|храни(?:те)?|записывай(?:те)?|отслеживай(?:те)?|размещай(?:те)?|ведём|храним|вести|хранить|размещать)\s+(.+?)\s+(?:в|на)\s+\S/iu;
  const placedSubject = imperative.exec(content)?.[1] ?? russian.exec(content)?.[1];
  if (placedSubject && subject.test(placedSubject)) return true;
  return /^(?:tasks?|work|slices?|boards?|layout)\s+(?:go(?:es)?\s+to|belong(?:s)?\s+in|must\s+be\s+(?:kept|tracked|stored)\s+in)\s+\S/iu.test(content);
}

/** 2026-11-12: only placement directives merit review; ordinary task and document mentions hide real conflicts. */
export function agentRuleConflicts(before: Buffer | null): AgentRuleConflict[] {
  const text = before?.toString('utf8') ?? '';
  const start = text.indexOf(rulesStart);
  const end = text.indexOf(rulesEnd);
  const managedEnd = end < 0 ? -1 : end + rulesEnd.length;
  const conflicts: AgentRuleConflict[] = [];
  let offset = 0;
  let lineNumber = 0;
  for (const line of text.split(/(?<=\n)/u)) {
    lineNumber += 1;
    const outside = start < 0 || end < start || offset < start || offset >= managedEnd;
    const content = line.replace(/^\uFEFF/u, '').trim();
    if (outside && prescribesWorkLocation(content)) {
      conflicts.push({ line: lineNumber, text: content });
    }
    offset += line.length;
  }
  return conflicts;
}

export function assembleAgentRules(projectRules: Buffer, layoutRules: Buffer): Buffer {
  const project = projectRules.toString('utf8').replace(/(?:\r?\n)+$/u, '');
  const layout = layoutRules.toString('utf8').replace(/^(?:\r?\n)+/u, '');
  return Buffer.from(`${project}\n\n${layout}`);
}

function projectRules(files: Map<string, Buffer>, source: string): Buffer {
  const rules = files.get('project-rules.md');
  if (!rules) throw new Error(serverText(messages).missingRules(source));
  const layout = files.get('layout-rules.md');
  if (!layout) throw new Error(serverText(messages).missingLayoutRules(source));
  return assembleAgentRules(rules, layout);
}

async function treeFiles(directory: string): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  async function visit(current: string) {
    if ((await lstat(current)).isSymbolicLink()) throw new Error(`${current}: symbolic link in the skill package`);
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const filename = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`${filename}: symbolic link in the skill package`);
      if (entry.isDirectory()) await visit(filename);
      else if (entry.isFile()) files.set(path.relative(directory, filename), await readFile(filename));
      else throw new Error(`${filename}: expected a regular file or folder`);
    }
  }
  await visit(directory);
  return files;
}

function skillVersion(files: Map<string, Buffer>, directory: string): string {
  const filename = path.join(directory, 'SKILL.md');
  const bytes = files.get('SKILL.md');
  if (!bytes) throw new Error(`${filename}: file not found`);
  const document = markdownHeader(bytes.toString('utf8'), filename).document;
  const version = document.getIn(['metadata', 'version']) ?? document.get('version');
  if (typeof version !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(version)) {
    throw new Error(`${filename}: metadata.version: expected YYYY-MM-DD`);
  }
  return version;
}

function sameFiles(first: Map<string, Buffer>, second: Map<string, Buffer>): boolean {
  return first.size === second.size && [...first].every(([name, bytes]) => second.get(name)?.equals(bytes));
}

async function installedFiles(directory: string): Promise<Map<string, Buffer>> {
  try { return await treeFiles(directory); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Map(); throw error; }
}

/**
 * Replaces differing copies unconditionally; the CLI checks `localSkillEdits` first and asks for `--force`, because a
 * programmatic caller (2026-11-09: tests, tools) has no interactive user to warn. The same division covers a
 * `mcpServers.deckmate` entry that names another server (2026-11-11).
 */
export async function installSkills(project: string, from = packagePath(), options: { mcpSnapshot?: readonly McpPlan[] } = {}) {
  const text = serverText(messages);
  const root = await realpath(path.resolve(project));
  const home = await realpath(path.resolve(from));
  const source = path.join(home, 'skills/deckmate');
  const files = await treeFiles(source);
  const version = skillVersion(files, source);
  const agentRulesFile = path.join(root, 'AGENTS.md');
  const agentRulesBefore = await readProjectFile(root, agentRulesFile);
  const agentRules = patchAgentRules(agentRulesBefore, projectRules(files, source), agentRulesFile);
  const ruleConflicts = agentRuleConflicts(agentRulesBefore);
  const launch = mcpLaunch(home);
  // 2026-11-11: shared project files must stay valid for everyone who clones them, so only the portable launch line.
  const plans = options.mcpSnapshot ?? (launch.kind === 'portable' ? await planMcpFiles(root, launch) : []);
  const relative = await resolveDataPath(root, 'tasks/deckmate.md');
  const manifest = path.join(root, relative);
  let before: Buffer;
  try { before = await readProjectMarkdown(root, relative); }
  catch (error) { throw new Error(`${manifest}: cannot read the project manifest: ${(error as Error).message}`); }
  const after = patchDeckmateHome(before, home, manifest);
  const targets = destinations.map(destination => path.join(root, destination));
  for (const target of targets) {
    await guardProjectPath(root, target);
    if (path.relative(source, target) === '' || pathInside(source, target) || pathInside(target, source)) {
      throw new Error(`${target}: the source and the destination overlap`);
    }
  }
  // 2026-11-09: every check, including a fresh read of the manifest, runs before the first deletion or write: a
  // conflict used to be discovered only when the manifest was saved, after the copies had already been replaced.
  const copies = [];
  for (const [index, target] of targets.entries()) {
    copies.push({ label: destinations[index], target, files: await installedFiles(target) });
  }
  if (!(await readProjectMarkdown(root, relative)).equals(before)) throw new Error(text.manifestChanged(manifest));
  await checkProjectFile(root, agentRulesFile, agentRulesBefore);
  for (const plan of plans) await checkProjectFile(root, plan.file, plan.before);
  const steps: Array<{ label: string; run: () => Promise<void> }> = [];
  for (const copy of copies) {
    if (sameFiles(files, copy.files)) continue;
    steps.push({ label: copy.label, run: async () => {
      await guardProjectPath(root, copy.target);
      await rm(copy.target, { recursive: true, force: true });
      for (const [relativePath, bytes] of files) {
        const filename = path.join(copy.target, relativePath);
        await mkdir(path.dirname(filename), { recursive: true });
        await writeFile(filename, bytes);
      }
    } });
  }
  if (!before.equals(after)) {
    steps.push({ label: relative, run: async () => {
      await replaceProjectMarkdown(root, relative, createHash('sha256').update(before).digest('hex'), after);
    } });
  }
  const rulesChanged = agentRules.status !== 'matches';
  if (rulesChanged) {
    steps.push({ label: 'AGENTS.md', run: () => replaceProjectFile(root, agentRulesFile, agentRulesBefore, agentRules.after) });
  }
  for (const plan of plans) {
    const { file, path: label, before, after } = plan;
    // 2026-11-11: `matches` needs no write; `invalid` and `format` are reported instead of touched.
    if (after === null) continue;
    steps.push({ label, run: () => replaceProjectFile(root, file, before, after) });
  }
  const applied: string[] = [];
  for (const step of steps) {
    try {
      await step.run();
      applied.push(step.label);
    } catch (error) {
      // 2026-11-09: a half-finished install must say what was applied and what was not.
      const pending = steps.slice(applied.length + 1).map(following => following.label);
      throw new Error(text.stoppedInstall(step.label, (error as Error).message, applied, pending));
    }
  }
  return { home, manifest, version, agentRules: rulesChanged ? agentRulesFile : null,
    ...(ruleConflicts.length ? { ruleConflicts } : {}), mcp: { launch, files: plans } };
}

/**
 * 2026-11-09: compares both installed copies with the package. `changed` are package files the copy modified, `added`
 * are files that exist only in the copy; copies that merely miss package files carry no user data and are not listed.
 */
export async function localSkillEdits(project: string, from = packagePath()): Promise<SkillCopyEdits[]> {
  const root = await realpath(path.resolve(project));
  const home = await realpath(path.resolve(from));
  const files = await treeFiles(path.join(home, 'skills/deckmate'));
  const edits: SkillCopyEdits[] = [];
  for (const destination of destinations) {
    const directory = path.join(root, destination);
    await guardProjectPath(root, directory);
    const installed = await installedFiles(directory);
    // 2026-11-09: file names are shown with forward slashes so the message reads the same on Windows.
    const changed = [...files.entries()].filter(([name, bytes]) => installed.get(name)?.equals(bytes) === false)
      .map(([name]) => name.split(path.sep).join('/'));
    const added = [...installed.keys()].filter(name => !files.has(name)).map(name => name.split(path.sep).join('/'));
    edits.push({ destination, changed, added });
  }
  return edits;
}

export async function skillsStatus(project: string, from = packagePath()) {
  const root = await realpath(path.resolve(project));
  const home = await realpath(path.resolve(from));
  const source = path.join(home, 'skills/deckmate');
  const files = await treeFiles(source);
  const version = skillVersion(files, source);
  const agentRulesFile = path.join(root, 'AGENTS.md');
  const agentRules = patchAgentRules(await readProjectFile(root, agentRulesFile), projectRules(files, source), agentRulesFile).status;
  const installations = [];
  for (const destination of destinations) {
    const directory = path.join(root, destination);
    await guardProjectPath(root, directory);
    const installed = await installedFiles(directory);
    installations.push({ path: directory, version: installed.has('SKILL.md') ? skillVersion(installed, directory) : null,
      matches: sameFiles(files, installed) });
  }
  const launch = mcpLaunch(home);
  const mcpFiles: Array<{ path: string; status: McpFileState }> = [];
  for (const file of await mcpConfigTargets(root)) {
    mcpFiles.push({ path: path.relative(root, file).split(path.sep).join('/'), status: await mcpFileState(root, file, entryOf(launch)) });
  }
  return { home, version, installations, agentRules, mcp: { launch, files: mcpFiles } };
}

/** `npm run skills -- <install|status>` and `deckmate skills <install|status>`; the project defaults to the current folder. */
export async function skillsCli(args = process.argv.slice(2)): Promise<void> {
  const { values, positionals } = parseArgs({ args, allowPositionals: true,
    options: { project: { type: 'string' }, from: { type: 'string' }, force: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' } } });
  const text = serverText(messages);
  // 2026-11-09: --help and -h answer with usage before the positional check, as the other entries do.
  if (values.help) { console.log(text.skillsHelp); return; }
  const project = values.project ?? process.cwd();
  if (positionals.length !== 1 || !['install', 'status'].includes(positionals[0])) {
    throw new Error(text.usage);
  }
  if (positionals[0] === 'install') {
    const plans = await mcpPlans(project, values.from);
    // 2026-11-09: replacing a copy with local changes would delete the user's work; list the files and stop instead.
    if (!values.force) {
      const edits = (await localSkillEdits(project, values.from)).filter(edit => edit.changed.length + edit.added.length > 0);
      if (edits.length) throw new Error(text.localEdits(edits));
      // 2026-11-11: a foreign deckmate server entry is the user's configuration; replace it only with consent.
      const conflicts = plans.filter(plan => plan.status === 'differs');
      if (conflicts.length) throw new Error(text.mcpDiffers(conflicts.map(plan => plan.path)));
    }
    const installed = await installSkills(project, values.from, { mcpSnapshot: plans });
    console.log(text.installed(installed.version, destinations.join(' and '), installed.home, installed.manifest));
    if (installed.agentRules) console.log(text.rulesUpdated(installed.agentRules));
    const conflicts = installed.ruleConflicts ?? [];
    for (const conflict of conflicts.slice(0, 10)) console.log(text.ruleConflict(conflict.line, conflict.text));
    if (conflicts.length > 10) console.log(text.moreRuleConflicts(conflicts.length - 10));
    for (const plan of installed.mcp.files) {
      if (plan.status === 'matches') continue;
      if (plan.status === 'invalid') console.log(`MCP ${plan.path} | ${text['mcp-invalid']}`);
      else if (plan.status === 'format') console.log(text['mcp-format'](plan.path, mcpFragment(installed.mcp.launch)));
      else console.log(`MCP ${plan.path} | ${text['mcp-written']}`);
    }
    // 2026-11-11: a machine-specific line never goes into shared files; agents without an auto-read config get the
    // fragment in every case, because the entry written above still has to be copied client by client.
    if (installed.mcp.launch.kind === 'machine') {
      console.log(text.mcpManualIntro);
      console.log(text.mcpClaude(`claude mcp add --scope local deckmate -- ${mcpCommandWords(installed.mcp.launch)}`));
    }
    console.log(text.mcpOtherClients(mcpFragment(installed.mcp.launch)));
    console.log(text.mcpCheck(mcpCheckCommand(installed.mcp.launch)));
  } else {
    if (values.force) throw new Error(text.forceInstallOnly);
    const status = await skillsStatus(project, values.from);
    console.log(text.statusSummary(status.home, status.version));
    console.log(`AGENTS.md | ${text[status.agentRules]}`);
    for (const entry of status.installations) {
      console.log(`${entry.path} | ${entry.version ?? text.notInstalled} | ${entry.matches ? text.matches : text.differs}`);
    }
    const mcpStates: Record<McpFileState, string> = {
      'no-file': text['missing-file'],
      'missing-server': text['missing-server'],
      matches: text.matches,
      differs: text.differs,
      invalid: text['mcp-invalid'],
    };
    for (const file of status.mcp.files) console.log(`MCP ${file.path} | ${mcpStates[file.status]}`);
  }
}

runAsScript(import.meta.url, skillsCli);
