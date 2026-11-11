import { afterEach, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { installSkills, localSkillEdits, skillsCli } from '../tools/deckmate-skills.ts';

const agentFiles = vi.hoisted(() => ({ target: '', reads: 0, changeOnRead: 0, failRename: false, injected: false }));
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile: vi.fn(async (...args: Parameters<typeof actual.readFile>) => {
      if (String(args[0]) === agentFiles.target) {
        agentFiles.reads += 1;
        if (agentFiles.reads === agentFiles.changeOnRead) {
          agentFiles.injected = true;
          await actual.writeFile(agentFiles.target, 'Concurrent edit\n');
        }
      }
      return actual.readFile(...args);
    }),
    writeFile: vi.fn(actual.writeFile),
    rename: vi.fn(async (...args: Parameters<typeof actual.rename>) => {
      if (agentFiles.failRename && String(args[1]) === agentFiles.target) {
        agentFiles.injected = true;
        throw new Error('rename failed (fixture)');
      }
      return actual.rename(...args);
    }),
  };
});

// 2026-11-09: install guards local edits (--force replaces them), and every check — including a fresh read of the
// manifest — runs before the first file is replaced; a mid-install failure reports what was applied and what was not.
const nativeCards = vi.hoisted(() => ({ reads: 0, corruptSecondRead: false, failManifestWrite: false, injected: false,
  beforeSecondRead: null as null | (() => Promise<void>) }));
vi.mock('../server/native-cards.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../server/native-cards.ts')>();
  return {
    ...actual,
    readProjectMarkdown: async (...args: Parameters<typeof actual.readProjectMarkdown>) => {
      nativeCards.reads += 1;
      const bytes = await actual.readProjectMarkdown(...args);
      if (nativeCards.reads === 2) await nativeCards.beforeSecondRead?.();
      // Simulate a manifest edit that lands between the install's two reads, after all other checks passed.
      if (nativeCards.corruptSecondRead && nativeCards.reads === 2) {
        nativeCards.injected = true;
        return Buffer.concat([bytes, Buffer.from('\n')]);
      }
      return bytes;
    },
    replaceProjectMarkdown: (...args: Parameters<typeof actual.replaceProjectMarkdown>) => {
      if (nativeCards.failManifestWrite) {
        nativeCards.injected = true;
        return Promise.reject(new Error('CARD_CONFLICT (fixture)'));
      }
      return actual.replaceProjectMarkdown(...args);
    },
  };
});

const directories: string[] = [];
const version = '2026-11-09';
const manifestText = '---\nschema: 1\nspaces: []\ndecks: []\ntracks: []\nmembership: []\n---\n# Проект\nТело манифеста.\n';
const skillText = `---\nname: deckmate\ndescription: Собственный тестовый пакет\nmetadata:\n  version: ${version}\n---\n# Скилл для теста\n`;
const rulesText = '## Deckmate board\n\nПравила доски.\n';

afterEach(async () => {
  agentFiles.target = '';
  agentFiles.reads = 0;
  agentFiles.changeOnRead = 0;
  agentFiles.failRename = false;
  agentFiles.injected = false;
  vi.clearAllMocks();
  vi.restoreAllMocks();
  nativeCards.reads = 0;
  nativeCards.corruptSecondRead = false;
  nativeCards.failManifestWrite = false;
  nativeCards.injected = false;
  nativeCards.beforeSecondRead = null;
  for (const directory of directories.splice(0)) {
    if (path.dirname(directory) !== path.resolve(tmpdir()) || !path.basename(directory).startsWith('deckmate-skills-safety-')) {
      throw new Error('Unexpected skills safety cleanup target.');
    }
    await rm(directory, { recursive: true, force: true });
  }
});

async function put(root: string, relative: string, content: string): Promise<void> {
  const filename = path.join(root, relative);
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, content);
}

async function fixture(editedWorkflow = 'Область: {area}.\n') {
  const directory = await mkdtemp(path.join(tmpdir(), 'deckmate-skills-safety-'));
  directories.push(directory);
  const home = path.join(directory, 'Deckmate source');
  const project = path.join(directory, 'Проект with spaces');
  await put(home, 'skills/deckmate/SKILL.md', skillText);
  await put(home, 'skills/deckmate/project-rules.md', rulesText);
  await put(home, 'skills/deckmate/workflows/analyze.md', `## Задание: research\n${editedWorkflow}`);
  await put(project, 'tasks/deckmate.md', manifestText);
  return { directory, home, project };
}

async function install(project: string, home: string, ...extra: string[]): Promise<string> {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    await skillsCli(['install', '--project', project, '--from', home, ...extra]);
    return log.mock.calls.map(call => call.join(' ')).join('\n');
  } finally {
    log.mockRestore();
  }
}

it('refuses to replace changed or added files without --force and keeps them byte for byte', async () => {
  const { home, project } = await fixture();
  await install(project, home);
  const modified = '# Локальное изменение линзы\n';
  await put(project, '.agents/skills/deckmate/workflows/analyze.md', modified);
  await put(project, '.claude/skills/deckmate/notes.md', '# Заметка пользователя\n');
  const manifest = await readFile(path.join(project, 'tasks/deckmate.md'));

  const refusal = await install(project, home).then(() => {
    throw new Error('expected a refusal');
  }, error => error as Error);
  expect(refusal.message).toContain('--force');
  expect(refusal.message).toContain('.agents/skills/deckmate (changed: workflows/analyze.md)');
  expect(refusal.message).toContain('.claude/skills/deckmate (added: notes.md)');

  expect(await readFile(path.join(project, '.agents/skills/deckmate/workflows/analyze.md'), 'utf8')).toBe(modified);
  expect(await readFile(path.join(project, '.claude/skills/deckmate/notes.md'), 'utf8')).toBe('# Заметка пользователя\n');
  expect(await readFile(path.join(project, 'tasks/deckmate.md'))).toEqual(manifest);
  expect((await localSkillEdits(project, home)).map(edit => edit.destination)).toEqual(['.claude/skills/deckmate', '.agents/skills/deckmate']);
});

it('installs without --force when copies carry no local edits, even if files are missing', async () => {
  const { home, project } = await fixture();
  await install(project, home);
  await rm(path.join(project, '.agents/skills/deckmate/workflows/analyze.md'));
  const output = await install(project, home);
  expect(output).toContain(`Installed: ${version}`);
  expect(await readFile(path.join(project, '.agents/skills/deckmate/workflows/analyze.md'), 'utf8')).toContain('{area}');
});

it('replaces local edits with --force and updates the manifest only through its hash guard', async () => {
  const { home, project } = await fixture();
  await install(project, home);
  await put(project, '.agents/skills/deckmate/workflows/analyze.md', '# Локальное изменение\n');
  const output = await install(project, home, '--force');
  expect(output).toContain(`Installed: ${version}`);
  expect(await readFile(path.join(project, '.agents/skills/deckmate/workflows/analyze.md'), 'utf8')).toContain('{area}');
  expect((await readFile(path.join(project, 'tasks/deckmate.md'))).toString('utf8')).toContain(JSON.stringify(home));
});

it('rejects --force for status', async () => {
  const { home, project } = await fixture();
  await expect(skillsCli(['status', '--project', project, '--from', home, '--force'])).rejects.toThrow('--force applies to install only');
});

it('stops before replacing copies when the manifest changes between the two reads', async () => {
  const { home, project } = await fixture();
  await install(project, home);
  await put(home, 'skills/deckmate/workflows/analyze.md', '## Задание: research\nНовая версия пакета.\n');
  const installed = await readFile(path.join(project, '.agents/skills/deckmate/workflows/analyze.md'));
  const manifest = await readFile(path.join(project, 'tasks/deckmate.md'));
  nativeCards.reads = 0;
  nativeCards.corruptSecondRead = true;
  await expect(installSkills(project, home)).rejects.toThrow('changed while deckmate skills install was checking');
  expect(nativeCards.injected).toBe(true);
  expect(await readFile(path.join(project, '.agents/skills/deckmate/workflows/analyze.md'))).toEqual(installed);
  expect(await readFile(path.join(project, '.claude/skills/deckmate/SKILL.md'))).toEqual(Buffer.from(skillText));
  expect(await readFile(path.join(project, 'tasks/deckmate.md'))).toEqual(manifest);
});

it('reports exactly what was applied when the manifest write fails after the copies', async () => {
  const { home, project } = await fixture();
  await install(project, home);
  const otherHome = path.join(path.dirname(home), 'Deckmate source 2');
  await put(otherHome, 'skills/deckmate/SKILL.md', skillText);
  await put(otherHome, 'skills/deckmate/project-rules.md', rulesText);
  await put(otherHome, 'skills/deckmate/workflows/analyze.md', '## Задание: research\nВторая копия пакета.\n');
  nativeCards.failManifestWrite = true;
  const failure = await installSkills(project, otherHome).then(() => {
    throw new Error('expected a failure');
  }, error => error as Error);
  expect(failure.message).toContain('stopped at tasks/deckmate.md (CARD_CONFLICT (fixture))');
  expect(nativeCards.injected).toBe(true);
  expect(failure.message).toContain('Applied: .claude/skills/deckmate, .agents/skills/deckmate.');
  expect(failure.message).toContain('Not applied: none.');
  expect(await readFile(path.join(project, '.agents/skills/deckmate/workflows/analyze.md'), 'utf8')).toContain('Вторая копия пакета.');
  expect((await readFile(path.join(project, 'tasks/deckmate.md'))).toString('utf8')).toContain(JSON.stringify(home));
});

it.each([false, true])('updates only the Deckmate rules without treating them as local edits (force=%s)', async force => {
  const { home, project } = await fixture();
  const first = await install(project, home);
  expect(first).toContain(`Updated: ${path.join(project, 'AGENTS.md')}`);
  const filename = path.join(project, 'AGENTS.md');
  const edited = '# User rules\n\n' + (await readFile(filename, 'utf8')).replace('Правила доски.', 'Edited managed rules.');
  await writeFile(filename, edited);
  expect((await localSkillEdits(project, home)).every(edit => edit.changed.length + edit.added.length === 0)).toBe(true);
  const output = await install(project, home, ...(force ? ['--force'] : []));
  expect(output).toContain('AGENTS.md');
  expect(await readFile(filename, 'utf8')).toBe(edited.replace('Edited managed rules.', 'Правила доски.'));
  vi.mocked(writeFile).mockClear();
  vi.mocked(rename).mockClear();
  expect(await install(project, home)).not.toContain('AGENTS.md');
  expect(writeFile).not.toHaveBeenCalled();
  expect(rename).not.toHaveBeenCalled();
});

it.each([false, true])('rejects a concurrent AGENTS.md edit during preflight (existing=%s)', async existing => {
  const { home, project } = await fixture();
  const filename = path.join(project, 'AGENTS.md');
  if (existing) await writeFile(filename, '# User rules\n');
  agentFiles.target = filename;
  if (existing) agentFiles.changeOnRead = 2;
  else nativeCards.beforeSecondRead = async () => {
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    await actual.writeFile(filename, 'Concurrent edit\n');
    agentFiles.injected = true;
  };
  vi.mocked(writeFile).mockClear();
  await expect(installSkills(project, home)).rejects.toThrow(/AGENTS\.md: the file changed/u);
  expect(agentFiles.injected).toBe(true);
  expect(writeFile).not.toHaveBeenCalled();
  expect(await readdir(project)).toEqual(expect.not.arrayContaining(['.agents', '.claude']));
  expect(await readFile(filename, 'utf8')).toBe('Concurrent edit\n');
});

it('rechecks AGENTS.md immediately before publishing and removes the temporary file on conflict', async () => {
  const { home, project } = await fixture();
  await put(project, 'AGENTS.md', '# User rules\n');
  agentFiles.target = path.join(project, 'AGENTS.md');
  agentFiles.changeOnRead = 3;
  await expect(installSkills(project, home)).rejects.toThrow(/stopped at AGENTS\.md .*the file changed/u);
  expect(agentFiles.injected).toBe(true);
  expect(await readFile(agentFiles.target, 'utf8')).toBe('Concurrent edit\n');
  expect((await readdir(project)).filter(name => name.endsWith('.tmp'))).toEqual([]);
});

it('names the AGENTS.md step and cleans up when atomic publication fails', async () => {
  const { home, project } = await fixture();
  await put(project, 'AGENTS.md', '# User rules\n');
  agentFiles.target = path.join(project, 'AGENTS.md');
  agentFiles.failRename = true;
  await expect(installSkills(project, home)).rejects.toThrow(/stopped at AGENTS\.md \(rename failed \(fixture\)\).*Applied: .claude\/skills\/deckmate, .agents\/skills\/deckmate, tasks\/deckmate\.md\. Not applied: none/u);
  expect(agentFiles.injected).toBe(true);
  expect(await readFile(agentFiles.target, 'utf8')).toBe('# User rules\n');
  expect((await readdir(project)).filter(name => name.endsWith('.tmp'))).toEqual([]);
});

it('rejects an AGENTS.md symbolic link before writing anything', async () => {
  const { home, project, directory } = await fixture();
  const outside = path.join(directory, 'outside.md');
  await writeFile(outside, '# Outside\n');
  try {
    await symlink(outside, path.join(project, 'AGENTS.md'), 'file');
  } catch (error) {
    if (process.platform !== 'win32' || (error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
    await symlink(directory, path.join(project, 'AGENTS.md'), 'junction');
  }
  vi.mocked(writeFile).mockClear();
  await expect(installSkills(project, home)).rejects.toThrow(/symbolic link/u);
  expect(writeFile).not.toHaveBeenCalled();
  expect(await readFile(outside, 'utf8')).toBe('# Outside\n');
});

it('prints one rules status line without writing for each of the four states', async () => {
  const { home, project } = await fixture();
  const status = async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.mocked(writeFile).mockClear();
    try {
      await skillsCli(['status', '--project', project, '--from', home]);
      expect(writeFile).not.toHaveBeenCalled();
      const lines = log.mock.calls.map(call => call.join(' ')).filter(line => line.startsWith('AGENTS.md | '));
      expect(lines).toHaveLength(1);
      return lines[0];
    } finally { log.mockRestore(); }
  };
  expect(await status()).toBe('AGENTS.md | no file');
  await put(project, 'AGENTS.md', '# User rules\n');
  expect(await status()).toBe('AGENTS.md | no block');
  await install(project, home);
  expect(await status()).toBe('AGENTS.md | matches');
  const filename = path.join(project, 'AGENTS.md');
  await writeFile(filename, (await readFile(filename, 'utf8')).replace('Правила доски.', 'Old rules.'));
  expect(await status()).toBe('AGENTS.md | differs');
});
