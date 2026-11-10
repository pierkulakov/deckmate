import { afterEach, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { installSkills, localSkillEdits, skillsCli } from '../tools/deckmate-skills.ts';

// 2026-11-09: install guards local edits (--force replaces them), and every check — including a fresh read of the
// manifest — runs before the first file is replaced; a mid-install failure reports what was applied and what was not.
const nativeCards = vi.hoisted(() => ({ reads: 0, corruptSecondRead: false, failManifestWrite: false, injected: false }));
vi.mock('../server/native-cards.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../server/native-cards.ts')>();
  return {
    ...actual,
    readProjectMarkdown: async (...args: Parameters<typeof actual.readProjectMarkdown>) => {
      nativeCards.reads += 1;
      const bytes = await actual.readProjectMarkdown(...args);
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

afterEach(async () => {
  vi.restoreAllMocks();
  nativeCards.reads = 0;
  nativeCards.corruptSecondRead = false;
  nativeCards.failManifestWrite = false;
  nativeCards.injected = false;
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
