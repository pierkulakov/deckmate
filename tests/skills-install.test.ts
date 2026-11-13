import { afterEach, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parse } from 'yaml';
import { agentRuleConflicts, installSkills, mcpLaunch, patchDeckmateHome, planMcpFiles, skillsCli, skillsStatus } from '../tools/deckmate-skills.ts';

const directories: string[] = [];
const version = '2026-11-05';
const manifestText = '\uFEFF---\r\n# Каталог для теста — 2026-11-05\r\nschema: 1\r\nspaces: []\r\ndecks: []\r\ntracks: []\r\nmembership: []\r\n---\r\n\r\n# Проект\r\nТело  с  пробелами.\r\n';
const skillText = `---\nname: deckmate\ndescription: Собственный тестовый пакет\nmetadata:\n  version: ${version}\n---\n# Скилл для теста\n`;
const legacySkillText = `---\nname: deckmate\ndescription: Собственный тестовый пакет\nversion: ${version}\n---\n# Скилл для теста\n`;
const rulesText = '## Deckmate board\n\nПравила доски.\n';
const layoutText = '## Board layout\n\n- Одна сущность в колоде.\n';
const rulesStart = '<!-- deckmate:agent-rules:start -->';
const rulesEnd = '<!-- deckmate:agent-rules:end -->';
const rulesBlock = `${rulesStart}\n${rulesText}\n${layoutText}${rulesEnd}\n`;

// 2026-11-11: whether `deckmate` is on PATH picks the MCP launch kind; no test may depend on the host machine.
const savedPath = { PATH: process.env.PATH, PATHEXT: process.env.PATHEXT };
let restorePath: (() => void) | null = null;

/** Points PATH at `folders` and PATHEXT at `pathExt` (deleted when omitted); restored after each test. */
function setPath(folders: string[], pathExt?: string): void {
  process.env.PATH = folders.join(path.delimiter);
  if (pathExt === undefined) delete process.env.PATHEXT;
  else process.env.PATHEXT = pathExt;
  restorePath ??= () => {
    if (savedPath.PATH === undefined) delete process.env.PATH;
    else process.env.PATH = savedPath.PATH;
    if (savedPath.PATHEXT === undefined) delete process.env.PATHEXT;
    else process.env.PATHEXT = savedPath.PATHEXT;
  };
}

/** The `deckmate` command of this platform, as the portable launch line registers it. */
function launchEntry(home: string): { command: string; args: string[] } {
  const { command, args } = mcpLaunch(home);
  return { command, args };
}

async function installMcpPlan(project: string, home: string) {
  const plans = await planMcpFiles(await realpath(project), mcpLaunch(home));
  return installSkills(project, home, { mcpSnapshot: plans });
}

async function runCli(args: string[]): Promise<string> {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    await skillsCli(args);
    return log.mock.calls.map(call => call.join(' ')).join('\n');
  } finally {
    log.mockRestore();
  }
}

afterEach(async () => {
  restorePath?.();
  restorePath = null;
  for (const directory of directories.splice(0)) {
    const relative = path.relative(path.resolve(tmpdir()), path.resolve(directory));
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)
      || !path.basename(directory).startsWith('deckmate-skills-install-')) {
      throw new Error('Unexpected skills install cleanup target.');
    }
    await rm(directory, { recursive: true, force: true });
  }
});

async function put(root: string, relative: string, content: string): Promise<void> {
  const filename = path.join(root, relative);
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, content);
}

async function fixture(manifest = 'tasks/deckmate.md') {
  const directory = await mkdtemp(path.join(tmpdir(), 'deckmate-skills-install-'));
  directories.push(directory);
  // 2026-11-11: without deckmate on PATH every install lands on the machine-specific launch line and writes no
  // shared MCP config; the tests that need the portable line point PATH at a folder of their own.
  setPath([]);
  const home = path.join(directory, 'Deckmate source');
  const project = path.join(directory, 'Проект with spaces');
  await put(home, 'skills/deckmate/SKILL.md', skillText);
  await put(home, 'skills/deckmate/project-rules.md', rulesText);
  await put(home, 'skills/deckmate/layout-rules.md', layoutText);
  await put(home, 'skills/deckmate/workflows/analyze.md', '## Задание: research\nОбласть: {area}.\n');
  await put(home, 'skills/deckmate/lenses/fx.md', '# Линза теста\n');
  await put(home, 'skills/deckmate/engines/unity.md', '# Движок теста\n');
  await put(project, manifest, manifestText);
  await put(project, '.agents/skills/foreign/SKILL.md', '# Чужой скилл Codex\r\n');
  await put(project, '.claude/skills/foreign/SKILL.md', '# Чужой скилл Claude\n');
  return { directory, home, project, manifest: path.join(project, manifest) };
}

async function snapshot(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  async function visit(relative: string): Promise<void> {
    for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
      const filename = path.join(relative, entry.name);
      if (entry.isDirectory()) await visit(filename);
      else files[filename] = (await readFile(path.join(root, filename))).toString('hex');
    }
  }
  await visit('');
  return files;
}

function manifestHeader(bytes: Buffer): Record<string, unknown> {
  const match = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(bytes.toString('utf8'));
  expect(match).not.toBeNull();
  return parse(match![1]) as Record<string, unknown>;
}

it('copies the complete package to both clients and adds exactly one manifest line', async () => {
  const { home, project, manifest } = await fixture();
  const before = await snapshot(project);
  const result = await installSkills(project, home);
  expect(result).toEqual({ home, manifest, version, agentRules: path.join(project, 'AGENTS.md'),
    mcp: { launch: { kind: 'machine', command: process.execPath, args: [path.join(home, 'bin', 'deckmate.mjs'), 'mcp'] },
      files: [] } });
  const expectedFiles = await snapshot(path.join(home, 'skills/deckmate'));
  expect(Object.keys(expectedFiles)).toHaveLength(6);
  expect(await readFile(path.join(project, 'AGENTS.md'))).toEqual(Buffer.from(rulesBlock));
  for (const client of ['.claude', '.agents']) {
    expect(await snapshot(path.join(project, client, 'skills/deckmate'))).toEqual(expectedFiles);
    const foreignPath = path.join(client, 'skills/foreign/SKILL.md');
    expect((await readFile(path.join(project, foreignPath))).toString('hex')).toBe(before[foreignPath]);
  }
  const bytes = await readFile(manifest);
  expect(manifestHeader(bytes).deckmateHome).toBe(home);
  const text = bytes.toString('utf8');
  expect(text.match(/^deckmateHome:.*$/gmu)).toHaveLength(1);
  expect(Buffer.from(text.replace(/^deckmateHome:[^\r\n]*\r?\n/mu, ''))).toEqual(Buffer.from(manifestText));
});

it('repeats installation without changing any project bytes', async () => {
  const { home, project } = await fixture();
  await installSkills(project, home);
  const before = await snapshot(project);
  const filename = path.join(project, 'AGENTS.md');
  const metadata = await stat(filename);
  expect((await installSkills(project, home)).agentRules).toBeNull();
  expect((await stat(filename)).mtimeMs).toBe(metadata.mtimeMs);
  expect((await stat(filename)).ino).toBe(metadata.ino);
  expect(await snapshot(project)).toEqual(before);
  expect(await skillsStatus(project, home)).toMatchObject({ home, version, agentRules: 'matches',
    installations: [
      { version, matches: true },
      { version, matches: true },
    ],
  });
});

it('reads a top-level version from copies installed before metadata.version', async () => {
  const { home, project } = await fixture();
  await installSkills(project, home);
  for (const client of ['.claude', '.agents']) {
    await put(project, `${client}/skills/deckmate/SKILL.md`, legacySkillText);
  }
  const status = await skillsStatus(project, home);
  expect(status.agentRules).toBe('matches');
  expect(status.installations.map(installation => installation.version)).toEqual([version, version]);
  expect(status.installations.every(installation => !installation.matches)).toBe(true);
});

it('rejects a skill with an invalid version before installing any files', async () => {
  const { home, project } = await fixture();
  const invalidSkillText = skillText.replace(version, '06.11.2026');
  await put(home, 'skills/deckmate/SKILL.md', invalidSkillText);
  const before = await snapshot(project);
  await expect(installSkills(project, home)).rejects.toThrow(/version: expected YYYY-MM-DD/u);
  await expect(skillsStatus(project, home)).rejects.toThrow(/version: expected YYYY-MM-DD/u);
  expect(await snapshot(project)).toEqual(before);
});

it('reports absent installations without writing files', async () => {
  const { home, project } = await fixture();
  const before = await snapshot(project);
  const status = await skillsStatus(project, home);
  expect(status.agentRules).toBe('missing-file');
  expect(status.installations).toHaveLength(2);
  expect(status.installations.map(installation => ({ version: installation.version, matches: installation.matches })))
    .toEqual([{ version: null, matches: false }, { version: null, matches: false }]);
  expect(await snapshot(project)).toEqual(before);
});

it('detects same-version content drift and removes stale owned files on reinstall', async () => {
  const { home, project } = await fixture();
  await installSkills(project, home);
  await put(project, '.agents/skills/deckmate/lenses/fx.md', '# Локальное изменение\n');
  await put(project, '.claude/skills/deckmate/obsolete.md', '# Устаревший файл\n');
  const changed = await skillsStatus(project, home);
  expect(changed.installations.every(installation => installation.version === version && !installation.matches)).toBe(true);
  await installSkills(project, home);
  const expectedFiles = await snapshot(path.join(home, 'skills/deckmate'));
  for (const client of ['.agents', '.claude']) {
    expect(await snapshot(path.join(project, client, 'skills/deckmate'))).toEqual(expectedFiles);
  }
  expect((await skillsStatus(project, home)).installations.every(installation => installation.matches)).toBe(true);
});

it('updates a legacy manifest when the canonical name is absent', async () => {
  const { home, project, manifest } = await fixture('tasks/freetion.md');
  expect((await installSkills(project, home)).manifest).toBe(manifest);
  expect(manifestHeader(await readFile(manifest)).deckmateHome).toBe(home);
  expect(await readdir(path.join(project, 'tasks'))).toEqual(['freetion.md']);
});

it('prefers the canonical manifest and preserves the legacy file byte for byte', async () => {
  const { home, project, manifest } = await fixture();
  await put(project, 'tasks/freetion.md', manifestText);
  expect((await installSkills(project, home)).manifest).toBe(manifest);
  expect(await readFile(path.join(project, 'tasks/freetion.md'))).toEqual(Buffer.from(manifestText));
});

it('changes only the existing scalar, preserving BOM, CRLF, inline comments and body', () => {
  const home = path.resolve('fixture', 'Deckmate source');
  const source = Buffer.from(manifestText.replace('schema: 1', 'schema: 1\r\ndeckmateHome: "old" # сохранить комментарий'));
  const expected = Buffer.from(source.toString('utf8').replace('"old"', JSON.stringify(home)));
  const patched = patchDeckmateHome(source, home, path.resolve('fixture', 'tasks/deckmate.md'));
  expect(patched).toEqual(expected);
  expect(patchDeckmateHome(patched, home, path.resolve('fixture', 'tasks/deckmate.md'))).toEqual(patched);
});

it('keeps an already equivalent YAML value byte for byte', () => {
  const home = path.resolve('fixture', 'Deckmate source');
  const source = Buffer.from(manifestText.replace('schema: 1', `schema: 1\r\ndeckmateHome: '${home.replaceAll("'", "''")}' # свой стиль`));
  expect(patchDeckmateHome(source, home, path.resolve('fixture', 'tasks/deckmate.md'))).toEqual(source);
});

it('rejects a missing manifest before installing any package files', async () => {
  const { home, project, manifest } = await fixture();
  await rm(manifest);
  const before = await snapshot(project);
  await expect(installSkills(project, home)).rejects.toThrow(/deckmate\.md|freetion\.md/u);
  expect(await snapshot(project)).toEqual(before);
});

it.each(['', '\n', '\n\n'])('appends rules preserving BOM, CRLF and every existing byte (ending %j)', async ending => {
  const { home, project } = await fixture();
  const before = '\uFEFF# Свои правила\r\nСохранить  пробелы.' + ending.replaceAll('\n', '\r\n');
  await put(project, 'AGENTS.md', before);
  expect((await skillsStatus(project, home)).agentRules).toBe('missing-block');
  await installSkills(project, home);
  const separator = '\r\n'.repeat(2 - ending.length);
  expect(await readFile(path.join(project, 'AGENTS.md'))).toEqual(Buffer.from(before + separator + rulesBlock.replaceAll('\n', '\r\n')));
});

it('replaces only the managed content and keeps both marker lines and surrounding bytes', async () => {
  const { home, project } = await fixture();
  const prefix = `\uFEFF# Свои правила\r\n\r\n${rulesStart}`;
  const suffix = `${rulesEnd}\r\n\r\n# После\r\nСвой  текст без последнего перевода строки`;
  await put(project, 'AGENTS.md', prefix + '\r\nСтарая версия.\r\n' + suffix);
  expect((await skillsStatus(project, home)).agentRules).toBe('differs');
  await installSkills(project, home);
  expect(await readFile(path.join(project, 'AGENTS.md'))).toEqual(Buffer.from(prefix + '\r\n'
    + (rulesText + '\n' + layoutText).replaceAll('\n', '\r\n') + suffix));
  expect((await skillsStatus(project, home)).agentRules).toBe('matches');
});

it('lists possible board-rule conflicts outside the managed block without editing them', async () => {
  const { home, project } = await fixture();
  const before = [
    '# Project',
    'Tasks belong in one document.',
    'Keep indentation.',
    'Веди задачи в docs/tasks.md.',
    rulesStart,
    'Tasks inside the managed block.',
    rulesEnd,
    'Track work in docs/work.md.',
    '',
  ].join('\n');
  await put(project, 'AGENTS.md', before);
  const output = await runCli(['install', '--project', project, '--from', home]);
  expect(output).toContain('line 2: Tasks belong in one document. — may conflict with board rules');
  expect(output).toContain('line 4: Веди задачи в docs/tasks.md. — may conflict with board rules');
  expect(output).toContain('line 8: Track work in docs/work.md. — may conflict with board rules');
  expect(output).not.toContain('Tasks inside the managed block. —');
  const unmanaged = (text: string) => text.replace(/<!-- deckmate:agent-rules:start -->[\s\S]*?<!-- deckmate:agent-rules:end -->/u, '<managed>');
  expect(unmanaged(await readFile(path.join(project, 'AGENTS.md'), 'utf8'))).toBe(unmanaged(before));
});

it('ignores mentions of tasks, boards and documents without a placement directive', () => {
  const mentions = ['Срезы и доска описаны здесь.', 'Задача должна содержать критерии приёмки.',
    'Документ описывает сборку.', 'Проверь задачи перед отчётом.', 'The board shows tasks.',
    'Read the documents in docs/.', 'Keep indentation in docs/.', 'Keep code in docs/tasks/.',
    'Храни заметки в docs/tasks/.', 'Do not keep tasks in docs/tasks.md.',
    'Не веди задачи в docs/tasks.md.'];
  expect(agentRuleConflicts(Buffer.from(mentions.join('\n')))).toEqual([]);
  const directives = ['tasks go to docs/tasks.md', 'keep task notes in docs/work.md', 'track work in docs/work.md',
    'Ведите задачи в tasks/plan.md', 'Храни раскладку в docs/board.md'];
  expect(agentRuleConflicts(Buffer.from(directives.join('\n'))).map(row => row.text)).toEqual(directives);
});

it('prints at most ten conflicting rules and summarizes the rest', async () => {
  const { home, project } = await fixture();
  await put(project, 'AGENTS.md', Array.from({ length: 13 }, (_, index) => `Track work in docs/work-${index}.md.`).join('\n'));
  const output = await runCli(['install', '--project', project, '--from', home]);
  expect(output.match(/may conflict with board rules/gu)).toHaveLength(10);
  expect(output).toContain('and 3 more');
  expect(output).not.toContain('line 11:');
});

it.each([
  rulesStart,
  rulesEnd,
  `${rulesEnd}\n${rulesStart}`,
  `${rulesStart}\n${rulesStart}\n${rulesEnd}`,
  `${rulesStart}\n${rulesEnd}\n${rulesEnd}`,
  rulesBlock + rulesBlock,
  `inline ${rulesStart}\n${rulesEnd}`,
  `${rulesStart}\n${rulesEnd} trailing text`,
])('rejects malformed or repeated markers before any install writes: %j', async content => {
  const { home, project } = await fixture();
  await put(project, 'AGENTS.md', content);
  const before = await snapshot(project);
  await expect(installSkills(project, home)).rejects.toThrow(/AGENTS\.md: expected exactly one ordered pair/u);
  await expect(skillsStatus(project, home)).rejects.toThrow(/agent-rules markers/u);
  expect(await snapshot(project)).toEqual(before);
});

it('rejects an AGENTS.md directory before any install writes', async () => {
  const { home, project } = await fixture();
  await mkdir(path.join(project, 'AGENTS.md'));
  const before = await snapshot(project);
  await expect(installSkills(project, home)).rejects.toThrow(/AGENTS\.md: expected a regular file/u);
  expect(await snapshot(project)).toEqual(before);
});

/** A folder on PATH holding the platform's `deckmate` command, and PATH pointed at it: the portable launch line. */
async function portablePath(directory: string): Promise<void> {
  const shim = path.join(directory, 'shim');
  await put(shim, process.platform === 'win32' ? 'deckmate.cmd' : 'deckmate', '');
  setPath([shim]);
}

it('picks the MCP launch line: the desktop app, the PATH command, then the package binary', async () => {
  const { directory, home } = await fixture();
  expect(mcpLaunch(home)).toEqual({ kind: 'machine', command: process.execPath,
    args: [path.join(home, 'bin', 'deckmate.mjs'), 'mcp'] });
  await portablePath(directory);
  expect(mcpLaunch(home)).toEqual(process.platform === 'win32'
    ? { kind: 'machine', command: process.execPath, args: [path.join(home, 'bin', 'deckmate.mjs'), 'mcp'] }
    : { kind: 'portable', command: 'deckmate', args: ['mcp'] });
  const app = path.join(directory, 'Deckmate app');
  await put(app, 'Deckmate.exe', '');
  expect(mcpLaunch(home, path.join(app, 'node.exe')))
    .toEqual({ kind: 'machine', command: path.join(app, 'Deckmate.exe'), args: ['mcp'] });
});

it('does not let PATHEXT enable a Windows shell launch or change POSIX command matching', async () => {
  const { directory, home } = await fixture();
  const shim = path.join(directory, 'shim');
  await put(shim, 'deckmate.xyz', '');
  if (process.platform === 'win32') {
    setPath([shim], '.XYZ');
    expect(mcpLaunch(home)).toEqual({ kind: 'machine', command: process.execPath, args: [path.join(home, 'bin', 'deckmate.mjs'), 'mcp'] });
    setPath([shim]);
    expect(mcpLaunch(home).kind).toBe('machine');
  } else {
    setPath([shim]);
    expect(mcpLaunch(home).kind).toBe('machine');
  }
});

it('publishes an explicitly planned MCP launch, .cursor only when it already exists', async () => {
  const { directory, home, project } = await fixture();
  await portablePath(directory);
  const entry = launchEntry(home);
  const result = await installMcpPlan(project, home);
  expect(result.mcp.launch).toEqual(mcpLaunch(home));
  expect(result.mcp.files.map(file => ({ path: file.path, status: file.status })))
    .toEqual([{ path: '.mcp.json', status: 'create' }]);
  expect(await readFile(path.join(project, '.mcp.json'), 'utf8'))
    .toBe(`${JSON.stringify({ mcpServers: { deckmate: entry } }, null, 2)}\n`);
  expect(existsSync(path.join(project, '.cursor'))).toBe(false);
  await mkdir(path.join(project, '.cursor'));
  const again = await installMcpPlan(project, home);
  expect(again.mcp.files.map(file => ({ path: file.path, status: file.status }))).toEqual([
    { path: '.mcp.json', status: 'matches' },
    { path: '.cursor/mcp.json', status: 'create' },
  ]);
  expect(await readFile(path.join(project, '.cursor', 'mcp.json'), 'utf8'))
    .toBe(`${JSON.stringify({ mcpServers: { deckmate: entry } }, null, 2)}\n`);
  expect((await skillsStatus(project, home)).mcp.files).toEqual([
    { path: '.mcp.json', status: 'matches' },
    { path: '.cursor/mcp.json', status: 'matches' },
  ]);
  const status = await runCli(['status', '--project', project, '--from', home]);
  expect(status).toContain('MCP .mcp.json | matches');
  expect(status).toContain('MCP .cursor/mcp.json | matches');
});

it('keeps a foreign deckmate server without --force and replaces it with --force', async () => {
  const { directory, home, project } = await fixture();
  await portablePath(directory);
  const entry = launchEntry(home);
  const foreign = `${JSON.stringify({ mcpServers: { deckmate: { command: 'other', args: ['mcp'] }, keep: { command: 'kept', args: [] } } }, null, 2)}\n`;
  await put(project, '.mcp.json', foreign);
  if (process.platform === 'win32') {
    const output = await runCli(['install', '--project', project, '--from', home]);
    expect(output).toContain('claude mcp add --scope local deckmate --');
    expect(await readFile(path.join(project, '.mcp.json'), 'utf8')).toBe(foreign);
    return;
  }
  const refusal = await runCli(['install', '--project', project, '--from', home]).then(() => {
    throw new Error('expected a refusal');
  }, error => error as Error);
  expect(refusal.message).toContain('mcpServers.deckmate');
  expect(refusal.message).toContain('--force');
  expect(await readFile(path.join(project, '.mcp.json'), 'utf8')).toBe(foreign);
  const output = await runCli(['install', '--project', project, '--from', home, '--force']);
  expect(output).toContain('MCP .mcp.json | written');
  expect(JSON.parse(await readFile(path.join(project, '.mcp.json'), 'utf8')))
    .toEqual({ mcpServers: { deckmate: entry, keep: { command: 'kept', args: [] } } });
});

it('leaves a broken or custom-formatted MCP config untouched and prints a fragment', async () => {
  const { directory, home, project } = await fixture();
  await portablePath(directory);
  const entry = launchEntry(home);
  await put(project, '.mcp.json', '{не JSON');
  const broken = await installMcpPlan(project, home);
  expect(broken.mcp.files.map(file => ({ path: file.path, status: file.status })))
    .toEqual([{ path: '.mcp.json', status: 'invalid' }]);
  expect(await readFile(path.join(project, '.mcp.json'), 'utf8')).toBe('{не JSON');
  const odd = '{\n   "mcpServers": {\n   }\n}\n';
  await put(project, '.mcp.json', odd);
  const output = await runCli(['install', '--project', project, '--from', home]);
  expect(output).toContain(JSON.stringify({ deckmate: entry }));
  expect(await readFile(path.join(project, '.mcp.json'), 'utf8')).toBe(odd);
});

it('adds the server to an existing config keeping its own indent and line ending', async () => {
  const { directory, home, project } = await fixture();
  await portablePath(directory);
  const entry = launchEntry(home);
  const other = { command: 'kept', args: [] };
  const existing = `${JSON.stringify({ mcpServers: { other } }, null, 4).replace(/\n/gu, '\r\n')}\r\n`;
  await put(project, '.mcp.json', existing);
  await installMcpPlan(project, home);
  const expected = `${JSON.stringify({ mcpServers: { other, deckmate: entry } }, null, 4).replace(/\n/gu, '\r\n')}\r\n`;
  expect(await readFile(path.join(project, '.mcp.json'), 'utf8')).toBe(expected);
});

it('writes no shared config when the launch line is machine-specific and prints manual setup', async () => {
  const { home, project } = await fixture();
  const output = await runCli(['install', '--project', project, '--from', home]);
  expect(output).toContain('claude mcp add --scope local deckmate --');
  expect(output).toContain(JSON.stringify({ deckmate: { command: process.execPath,
    args: [path.join(home, 'bin', 'deckmate.mjs'), 'mcp'] } }));
  expect(output).toContain('--check');
  expect(existsSync(path.join(project, '.mcp.json'))).toBe(false);
  expect(existsSync(path.join(project, '.cursor'))).toBe(false);
  const status = await runCli(['status', '--project', project, '--from', home]);
  expect(status).toContain('MCP .mcp.json | no file');
});
