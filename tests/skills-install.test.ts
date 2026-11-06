import { afterEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parse } from 'yaml';
import { installSkills, patchDeckmateHome, skillsStatus } from '../tools/deckmate-skills.ts';

const directories: string[] = [];
const version = '2026-11-05';
const manifestText = '\uFEFF---\r\n# Каталог для теста — 2026-11-05\r\nschema: 1\r\nspaces: []\r\ndecks: []\r\ntracks: []\r\nmembership: []\r\n---\r\n\r\n# Проект\r\nТело  с  пробелами.\r\n';
const skillText = `---\nname: deckmate\ndescription: Собственный тестовый пакет\nversion: ${version}\n---\n# Скилл для теста\n`;

afterEach(async () => {
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
  const home = path.join(directory, 'Deckmate source');
  const project = path.join(directory, 'Проект with spaces');
  await put(home, 'skills/deckmate/SKILL.md', skillText);
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
  expect(result).toEqual({ home, manifest, version });
  const expectedFiles = await snapshot(path.join(home, 'skills/deckmate'));
  expect(Object.keys(expectedFiles)).toHaveLength(4);
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
  await installSkills(project, home);
  expect(await snapshot(project)).toEqual(before);
  expect(await skillsStatus(project, home)).toMatchObject({ home, version,
    installations: [
      { version, matches: true },
      { version, matches: true },
    ],
  });
});

it('reports absent installations without writing files', async () => {
  const { home, project } = await fixture();
  const before = await snapshot(project);
  const status = await skillsStatus(project, home);
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
