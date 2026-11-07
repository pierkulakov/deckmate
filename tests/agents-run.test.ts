import { afterEach, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { detectEngine, runSummary, runWorkflow, workflowAssignments, type RunRuntime } from '../tools/deckmate-run.ts';

const directories: string[] = [];
const date = '2026-11-05';
const roles = ['research', 'code', 'docs'];
const workflow = '# Сценарий теста\n\n## Шаг 1 — ввод (self)\nТекст ведущей модели.\n\n' + roles.map(role =>
  `## Задание: ${role}\nОбласть: {area}\nПроект: {project}\nДата: {date}\nРезультат: {out}/${role}.md\nДвижок: {engine}\nЛинза: {lens}\n### Детали\nСохранить результат.\n`).join('\n');
const config = `---
deckmate: agents
schema: 1
launchers:
  fixture:
    run: ['never-launch-fixture', '{prompt}', '{cwd}', '{tools}', '{cap}']
    tools: 'Read,Write'
    capUsd: 2
routing:
  research: fixture
  code: fixture
  docs: fixture
limits:
  parallel: 2
  startGapSeconds: 0.02
---
`;

afterEach(async () => {
  vi.useRealTimers();
  for (const directory of directories.splice(0)) {
    if (path.dirname(directory) !== path.resolve(tmpdir()) || !path.basename(directory).startsWith('deckmate-run-')) {
      throw new Error('Unexpected run test cleanup target.');
    }
    await rm(directory, { recursive: true, force: true });
  }
});

async function put(root: string, relative: string, text: string) {
  const filename = path.join(root, relative);
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, text);
}

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'deckmate-run-'));
  directories.push(directory);
  const project = path.join(directory, 'Проект with spaces');
  const home = path.join(directory, 'Deckmate');
  await put(home, 'skills/deckmate/workflows/analyze.md', workflow);
  await put(home, 'skills/deckmate/lenses/fx.md', '# Тестовая линза\n');
  await put(project, 'tasks/deckmate.md', `---\nschema: 1\ndeckmateHome: ${JSON.stringify(home)}\n---\n# Тест\n`);
  await put(project, 'tasks/deckmate-agents.md', config);
  await put(project, 'ProjectSettings/ProjectVersion.txt', 'm_EditorVersion: fixture\n');
  return { directory, project, home };
}

it('dry run writes three assignments with all six substitutions and prints commands without launching', async () => {
  const { project, home } = await fixture();
  const launch = vi.fn();
  const run = await runWorkflow('analyze', 'fx', { project, dry: true, date }, { launch, now: Date.now, wait: async () => {} });
  expect(launch).not.toHaveBeenCalled();
  expect(run.engine).toBe('unity');
  expect(run.out).toBe(path.join(project, 'research_notes/fx-2026-11-05'));
  expect(await readdir(run.out)).toEqual(roles.map(role => `tz-${role}.md`).sort());
  for (const row of run.rows) {
    const text = await readFile(row.prompt, 'utf8');
    for (const value of ['fx', project, date, run.out, 'unity', path.join(home, 'skills/deckmate/lenses/fx.md')]) {
      expect(text).toContain(value);
    }
    expect(text).not.toMatch(/\{(?:area|project|date|out|engine|lens)\}/u);
    expect(text).toContain('### Детали');
    expect(text).not.toContain('Текст ведущей модели');
    expect(row.invocation).toEqual({ name: 'fixture', run: ['never-launch-fixture', row.prompt, project, 'Read,Write', '2'] });
    expect(row.exitCode).toBeNull();
    expect(runSummary(run)).toContain(JSON.stringify(['never-launch-fixture', row.prompt, project, 'Read,Write', '2']));
    expect(runSummary(run)).toContain(row.result);
  }
});

it('prints trusted shell commands and both environment paths without launching in dry mode', async () => {
  const { project } = await fixture();
  await put(project, 'tasks/deckmate-agents.md', config.replace("run: ['never-launch-fixture', '{prompt}', '{cwd}', '{tools}', '{cap}']",
    "command: 'trusted-agent --tools {tools} --cap {cap}'\n    shell: true"));
  const launch = vi.fn(async () => 0);
  const run = await runWorkflow('analyze', 'fx', { project, date, dry: true }, { launch, now: Date.now, wait: async () => {} });
  expect(launch).not.toHaveBeenCalled();
  for (const row of run.rows) {
    expect(runSummary(run)).toContain(JSON.stringify({ command: 'trusted-agent --tools Read,Write --cap 2',
      env: { DECKMATE_PROMPT: row.prompt, DECKMATE_CWD: project } }));
  }
});

it('passes a formerly shell-active output path as one literal argument', async () => {
  const { directory, project } = await fixture();
  const out = path.join(directory, 'literal %PATH% !x! & (x86) $() `');
  const launch = vi.fn(async () => 0);
  const run = await runWorkflow('analyze', 'fx', { project, date, out }, { launch, now: Date.now, wait: async () => {} });
  for (const row of run.rows) {
    expect(launch).toHaveBeenCalledWith({ name: 'fixture', run: ['never-launch-fixture', row.prompt, project, 'Read,Write', '2'] }, project);
  }
});

it('launches a real argv process through the default workflow runtime', async () => {
  const { directory, project } = await fixture();
  const program = "require('node:fs').writeFileSync(process.argv[1]+'.argv.json',JSON.stringify(process.argv.slice(1)))";
  const runArguments = [process.execPath, '-e', program, '--', '{prompt}', '{cwd}', '{tools}', '{cap}'];
  await put(project, 'tasks/deckmate-agents.md', config.replace(
    "['never-launch-fixture', '{prompt}', '{cwd}', '{tools}', '{cap}']", () => JSON.stringify(runArguments)));
  const out = path.join(directory, 'literal %PATH% !x! & (x86) $() `');
  const run = await runWorkflow('analyze', 'fx', { project, date, out, roles: ['research'] });
  const row = run.rows[0];
  expect(row).toMatchObject({ state: 'finished', exitCode: 0 });
  expect(JSON.parse(await readFile(row.prompt + '.argv.json', 'utf8'))).toEqual([row.prompt, project, 'Read,Write', '2']);
});

it('reports a missing executable with its launcher name through the default runtime', async () => {
  const { project } = await fixture();
  const run = await runWorkflow('analyze', 'fx', { project, date, roles: ['research'] });
  expect(run.rows[0]).toMatchObject({ state: 'failed', exitCode: 1,
    error: expect.stringContaining('Launcher fixture: executable "never-launch-fixture" not found') });
});

it('runs the actual CLI in dry mode using only the temporary workflow', async () => {
  const { project } = await fixture();
  const tool = fileURLToPath(new URL('../tools/deckmate-run.ts', import.meta.url));
  const { stdout, stderr } = await promisify(execFile)(process.execPath,
    [tool, 'run', 'analyze', 'fx', '--dry', '--roles', 'research,code'], { cwd: project, windowsHide: true });
  expect(stderr).toBe('');
  expect(stdout).toContain('Engine: unity');
  expect(stdout.match(/never-launch-fixture/gu)).toHaveLength(2);
  const outputDirectory = (await readdir(path.join(project, 'research_notes')))[0];
  expect(await readdir(path.join(project, 'research_notes', outputDirectory))).toEqual(['tz-code.md', 'tz-research.md']);
});

it('prefers the installed project workflow and lens over Deckmate defaults', async () => {
  const { project } = await fixture();
  await put(project, '.agents/skills/deckmate/workflows/analyze.md', '## Задание: docs\nЛокальный сценарий: {lens}\n');
  await put(project, '.agents/skills/deckmate/lenses/fx.md', '# Локальная линза\n');
  const run = await runWorkflow('analyze', 'fx', { project, dry: true, date });
  expect(run.rows.map(row => row.role)).toEqual(['docs']);
  expect(await readFile(run.rows[0].prompt, 'utf8')).toBe(`Локальный сценарий: ${path.join(project, '.agents/skills/deckmate/lenses/fx.md')}\n`);
});

// 2026-11-06: docs/skills.md promises that a project lens and genre in tasks/ win over installed and built-in ones.
it('prefers project lenses and genres in tasks/ over installed skills', async () => {
  const { project, home } = await fixture();
  await put(project, '.agents/skills/deckmate/lenses/fx.md', '# Installed lens\n');
  await put(project, 'tasks/deckmate-lenses/fx.md', '# Project lens\n');
  await put(home, 'skills/deckmate/genres/rts.md', '# Built-in genre\n');
  await put(project, 'tasks/deckmate-genres/rts.md', '# Project genre\n');
  await put(project, 'tasks/deckmate-project.md', '---\ngenre: rts\n---\n# Profile\n');
  const run = await runWorkflow('analyze', 'fx', { project, dry: true, date });
  const text = await readFile(run.rows[0].prompt, 'utf8');
  expect(text).toContain(path.join(project, 'tasks/deckmate-lenses/fx.md'));
  expect(text).not.toContain(path.join(project, '.agents/skills/deckmate/lenses/fx.md'));
});

it('keeps roles without routing and self as manual assignments', async () => {
  const { project } = await fixture();
  await put(project, 'tasks/deckmate-agents.md', config.replace('  docs: fixture\n', '').replace('code: fixture', 'code: self'));
  const launch = vi.fn(async () => 0);
  const run = await runWorkflow('analyze', 'fx', { project, date }, { launch, now: Date.now, wait: async () => {} });
  expect(launch).toHaveBeenCalledTimes(1);
  expect(run.rows.map(row => row.state)).toEqual(['finished', 'manual', 'manual']);
  expect(await readdir(run.out)).toHaveLength(3);
  expect(runSummary(run)).toContain('manual: no launcher');
});

it('substitutes none and an empty lens when no marker or lens exists', async () => {
  const { project, home } = await fixture();
  await rm(path.join(project, 'ProjectSettings/ProjectVersion.txt'));
  await rm(path.join(home, 'skills/deckmate/lenses/fx.md'));
  const run = await runWorkflow('analyze', 'fx', { project, dry: true, date });
  expect(run.engine).toBe('none');
  expect(await readFile(run.rows[0].prompt, 'utf8')).toContain('Движок: none\nЛинза: \n');
});

it.each([{ marker: 'Example.uproject', engine: 'unreal' }, { marker: 'project.godot', engine: 'godot' }])(
  'detects $engine from $marker', async ({ marker, engine }) => {
    const { project } = await fixture();
    await rm(path.join(project, 'ProjectSettings/ProjectVersion.txt'));
    await put(project, marker, '{}\n');
    expect(await detectEngine(project)).toBe(engine);
  },
);

it('does not parse fenced headings as assignments and stops at the next top-level section', () => {
  const text = '## Задание: docs\nТекст\n```md\n## Задание: code\nПример\n```\n### Детали\nДа\n## Шаг 2 (self)\nНет\n';
  const assignments = workflowAssignments(text, 'fixture.md');
  expect(assignments).toHaveLength(1);
  expect(assignments[0].text).toContain('## Задание: code');
  expect(assignments[0].text).not.toContain('Нет');
  expect(() => workflowAssignments('## Задание: code\nРаз\n## Задание: code\nДва\n', 'fixture.md')).toThrow('repeated');
});

it('reads English and Russian assignment markers through one grammar', () => {
  expect(workflowAssignments('## Assignment: research\nRead sources.\n## Задание: docs\nПроверить документы.\n', 'fixture.md'))
    .toEqual([{ role: 'research', text: 'Read sources.' }, { role: 'docs', text: 'Проверить документы.' }]);
});

it('enforces both simultaneous slots and gaps between starts while collecting failures', async () => {
  const { project } = await fixture();
  let active = 0;
  let maximumActive = 0;
  const starts: number[] = [];
  const execution: RunRuntime = {
    now: () => Date.now(),
    wait: milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
    launch: async (invocation, cwd) => {
      expect(cwd).toBe(project);
      starts.push(Date.now());
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise(resolve => setTimeout(resolve, 100));
      active -= 1;
      const args = invocation.shell ? [] : invocation.run;
      if (args.some(arg => arg.includes('tz-code.md'))) throw new Error('fixture launch error');
      return args.some(arg => arg.includes('tz-docs.md')) ? 7 : 0;
    },
  };
  // 2026-11-05: only the clock is mocked; no shell or model processes are started.
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  const pending = runWorkflow('analyze', 'fx', { project, date }, execution);
  await vi.waitFor(() => expect(starts.length).toBeGreaterThan(0));
  await vi.runAllTimersAsync();
  const run = await pending;
  expect(maximumActive).toBe(2);
  expect(starts).toHaveLength(3);
  expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(20);
  expect(starts[2] - starts[1]).toBeGreaterThanOrEqual(20);
  expect(starts[2] - starts[0]).toBeGreaterThanOrEqual(100);
  expect(active).toBe(0);
  expect(run.rows.map(row => row.exitCode)).toEqual([0, 1, 7]);
  expect(runSummary(run)).toContain('fixture launch error');
});

it('rejects unknown role filters and path traversal before writing assignments', async () => {
  const { project } = await fixture();
  await expect(runWorkflow('analyze', 'fx', { project, dry: true, roles: ['absent'] })).rejects.toThrow('role absent');
  await expect(runWorkflow('analyze', '../escape', { project, dry: true })).rejects.toThrow('Area');
  expect(await readdir(project)).not.toContain('research_notes');
});

it.each([
  { name: 'profile and Deckmate genre file', profileText: '\uFEFF---\r\ngenre: rts\r\n---\r\n# Профиль\r\n', genreFile: true },
  { name: 'profile without genre file', profileText: '---\ngenre: rts\n---\n# Профиль\n', genreFile: false },
  { name: 'no profile even with a genre file', profileText: null, genreFile: true },
  { name: 'profile without genre key', profileText: '---\ndescription: Тестовый проект\n---\n', genreFile: true },
  { name: 'profile without YAML', profileText: '# Профиль без шапки\n', genreFile: true },
])('substitutes profile and genre for $name without leaving any placeholders', async ({ profileText, genreFile }) => {
  const { project, home } = await fixture();
  const profilePath = path.join(project, 'tasks/deckmate-project.md');
  const genrePath = path.join(home, 'skills/deckmate/genres/rts.md');
  const profileWorkflow = workflow.replaceAll('Линза: {lens}', 'Линза: {lens}\nПрофиль: {profile}\nЖанр: {genre}');
  await put(home, 'skills/deckmate/workflows/analyze.md', profileWorkflow);
  if (profileText !== null) await put(project, 'tasks/deckmate-project.md', profileText);
  if (genreFile) await put(home, 'skills/deckmate/genres/rts.md', '# Жанр теста\n');
  const expectedProfile = profileText === null ? '' : profilePath;
  const expectedGenre = genreFile && profileText?.includes('genre: rts') ? genrePath : '';
  const run = await runWorkflow('analyze', 'fx', { project, dry: true, date });
  expect(run.profile).toBe(expectedProfile);
  expect(run.genre).toBe(expectedGenre);
  expect(run.rows).toHaveLength(3);
  for (const row of run.rows) {
    const text = await readFile(row.prompt, 'utf8');
    expect(text).toContain(`Профиль: ${expectedProfile}\nЖанр: ${expectedGenre}\n`);
    expect(text).not.toMatch(/\{[^{}]*\}/u);
  }
  expect(runSummary(run)).toContain(`Profile: ${expectedProfile || 'none'}\nGenre: ${expectedGenre || 'none'}\n`);
});

it.each(['.agents', '.claude'])('prefers the %s project genre copy over the Deckmate genre', async client => {
  const { project, home } = await fixture();
  await put(project, 'tasks/deckmate-project.md', '---\ngenre: rts\n---\n');
  await put(home, 'skills/deckmate/genres/rts.md', '# Жанр в Deckmate\n');
  const relative = `${client}/skills/deckmate/genres/rts.md`;
  await put(project, relative, '# Жанр в проекте\n');
  await put(home, 'skills/deckmate/workflows/analyze.md', '## Задание: research\n{profile}\n{genre}\n');
  const run = await runWorkflow('analyze', 'fx', { project, dry: true, date });
  expect(run.genre).toBe(path.join(project, relative));
  expect(await readFile(run.rows[0].prompt, 'utf8')).toBe(`${path.join(project, 'tasks/deckmate-project.md')}\n${run.genre}\n`);
});

it('rejects a genre key containing a path before writing assignments', async () => {
  const { project } = await fixture();
  await put(project, 'tasks/deckmate-project.md', '---\ngenre: ../outside\n---\n');
  await expect(runWorkflow('analyze', 'fx', { project, dry: true, date }))
    .rejects.toThrow(`${path.join(project, 'tasks/deckmate-project.md')}: genre`);
  expect(await readdir(project)).not.toContain('research_notes');
});

async function projectFileList(project: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(relative: string): Promise<void> {
    for (const entry of await readdir(path.join(project, relative), { withFileTypes: true })) {
      const filename = path.join(relative, entry.name);
      if (entry.isDirectory()) await visit(filename);
      else files.push(filename);
    }
  }
  await visit('');
  return files.sort();
}

it('uses an explicit relative --lens without looking up the area lens', async () => {
  const { directory, project } = await fixture();
  await put(directory, 'chosen lens.md', '# Явная линза\n');
  // 2026-11-05: looking up lenses/fx.md would fail with ENOTDIR; an explicit lens skips that lookup.
  await put(project, '.agents/skills/deckmate/lenses', 'Не каталог\n');
  const out = path.join(directory, 'external results');
  const before = await projectFileList(project);
  const tool = fileURLToPath(new URL('../tools/deckmate-run.ts', import.meta.url));
  const { stdout, stderr } = await promisify(execFile)(process.execPath,
    [tool, 'run', 'analyze', 'fx', '--project', project, '--dry', '--lens', 'chosen lens.md', '--out', 'external results'],
    { cwd: directory, windowsHide: true });
  expect(stderr).toBe('');
  expect(stdout).toContain(`Results: ${out}\n`);
  expect(await readdir(out)).toEqual(roles.map(role => `tz-${role}.md`).sort());
  for (const role of roles) {
    const text = await readFile(path.join(out, `tz-${role}.md`), 'utf8');
    expect(text).toContain(`Линза: ${path.join(directory, 'chosen lens.md')}\n`);
    expect(text).toContain(`Результат: ${out}/${role}.md\n`);
    expect(text).not.toMatch(/\{[^{}]*\}/u);
  }
  expect(await projectFileList(project)).toEqual(before);
});

it.each([true, false])('returns code 2 for a missing --lens without writing (output exists: %s)', async outputExists => {
  const { directory, project } = await fixture();
  const out = path.join(directory, 'untouched results');
  if (outputExists) await mkdir(out);
  const missingLens = path.join(directory, 'missing lens.md');
  const before = await projectFileList(directory);
  const tool = fileURLToPath(new URL('../tools/deckmate-run.ts', import.meta.url));
  await expect(promisify(execFile)(process.execPath,
    [tool, 'run', 'analyze', 'fx', '--project', project, '--dry', '--lens', missingLens, '--out', out],
    { cwd: directory, windowsHide: true }))
    .rejects.toMatchObject({ code: 2, stdout: '', stderr: expect.stringContaining(missingLens) });
  expect(await projectFileList(directory)).toEqual(before);
  if (outputExists) expect(await readdir(out)).toEqual([]);
  else expect(await readdir(directory)).not.toContain(path.basename(out));
});

it('creates --out outside the project and leaves the project file list unchanged', async () => {
  const { directory, project } = await fixture();
  const out = path.join(directory, 'reports', 'external results');
  const before = await projectFileList(project);
  const tool = fileURLToPath(new URL('../tools/deckmate-run.ts', import.meta.url));
  const { stdout, stderr } = await promisify(execFile)(process.execPath,
    [tool, 'run', 'analyze', 'fx', '--project', project, '--dry', '--out', out], { cwd: directory, windowsHide: true });
  expect(stderr).toBe('');
  expect(stdout).toContain(`Results: ${out}\n`);
  expect(await readdir(out)).toEqual(roles.map(role => `tz-${role}.md`).sort());
  expect(await projectFileList(project)).toEqual(before);
  for (const role of roles) {
    expect(await readFile(path.join(out, `tz-${role}.md`), 'utf8')).toContain(`Результат: ${out}/${role}.md\n`);
    expect(stdout).toContain(path.join(out, `${role}.md`));
  }
});

// 2026-11-07: rerunning into the same --out is idempotent, but an edited task file must never be overwritten silently.
it('accepts identical assignments on a rerun and rejects an edited one without modifying it', async () => {
  const { directory, project } = await fixture();
  const out = path.join(directory, 'rerun results');
  const options = { project, dry: true, date, out };
  const read = async () => Promise.all(roles.map(role => readFile(path.join(out, `tz-${role}.md`), 'utf8')));
  await runWorkflow('analyze', 'fx', options);
  const first = await read();
  await expect(runWorkflow('analyze', 'fx', options)).resolves.toMatchObject({ out });
  expect(await read()).toEqual(first);
  const edited = path.join(out, 'tz-code.md');
  await writeFile(edited, 'Ответ исполнителя\n');
  await expect(runWorkflow('analyze', 'fx', options)).rejects.toThrow('already exists with different content');
  expect(await readFile(edited, 'utf8')).toBe('Ответ исполнителя\n');
});
