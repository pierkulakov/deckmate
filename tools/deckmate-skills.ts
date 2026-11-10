import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { isMap, isScalar } from 'yaml';
import { markdownHeader } from '../server/agents-config.ts';
import { runAsScript } from '../server/cli-entry.ts';
import { defineText, serverText } from '../server/i18n.ts';
import { resolveDataPath } from '../server/data-paths.ts';
import { readProjectMarkdown, replaceProjectMarkdown } from '../server/native-cards.ts';
import { packagePath } from '../server/package-path.ts';

const destinations = ['.claude/skills/deckmate', '.agents/skills/deckmate'];

/** 2026-11-09: files a reinstall would overwrite or delete, per installed copy. */
export interface SkillCopyEdits { destination: string; changed: string[]; added: string[] }

const messages = defineText({
  skillsHelp: `Usage: deckmate skills <install|status> [--project <folder>] [--from <Deckmate folder>] [--force]

install  Copy this Deckmate's skills/deckmate package into the project's .claude/skills and .agents/skills folders.
status   Compare the installed copies with this package, byte for byte.
--force  install: replace copies that contain local changes; without it install lists them and changes nothing.

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
  stoppedInstall: (step: string, reason: string, applied: string[], pending: string[]) =>
    `deckmate skills install stopped at ${step} (${reason}); ${step} may be partially written. Applied: ${applied.join(', ') || 'none'}. Not applied: ${pending.join(', ') || 'none'}. Fix the problem and re-run deckmate skills install.`,
}, {
  skillsHelp: `Использование: deckmate skills <install|status> [--project <папка>] [--from <папка Deckmate>] [--force]

install  Скопировать пакет skills/deckmate этого Deckmate в папки .claude/skills и .agents/skills проекта.
status   Сравнить установленные копии с этим пакетом байт в байт.
--force  install: заменить копии с локальными правками; без флага install перечисляет их и ничего не меняет.

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
  const relative = path.relative(project, target);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw new Error(`${target}: the path must be inside ${project}`);
  }
  let current = project;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error(`${current}: cannot write through a symbolic link`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
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
 * programmatic caller (2026-11-09: tests, tools) has no interactive user to warn.
 */
export async function installSkills(project: string, from = packagePath()) {
  const text = serverText(messages);
  const root = await realpath(path.resolve(project));
  const home = await realpath(path.resolve(from));
  const source = path.join(home, 'skills/deckmate');
  const files = await treeFiles(source);
  const version = skillVersion(files, source);
  const relative = await resolveDataPath(root, 'tasks/deckmate.md');
  const manifest = path.join(root, relative);
  let before: Buffer;
  try { before = await readProjectMarkdown(root, relative); }
  catch (error) { throw new Error(`${manifest}: cannot read the project manifest: ${(error as Error).message}`); }
  const after = patchDeckmateHome(before, home, manifest);
  const targets = destinations.map(destination => path.join(root, destination));
  for (const target of targets) {
    await guardProjectPath(root, target);
    if ([path.relative(source, target), path.relative(target, source)].some(relativePath =>
      relativePath === '' || (!path.isAbsolute(relativePath) && relativePath !== '..' && !relativePath.startsWith(`..${path.sep}`)))) {
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
  return { home, manifest, version };
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
    const changed = [...files.entries()].filter(([name, bytes]) => installed.has(name) && !installed.get(name)!.equals(bytes))
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
  const installations = [];
  for (const destination of destinations) {
    const directory = path.join(root, destination);
    await guardProjectPath(root, directory);
    const installed = await installedFiles(directory);
    installations.push({ path: directory, version: installed.has('SKILL.md') ? skillVersion(installed, directory) : null,
      matches: sameFiles(files, installed) });
  }
  return { home, version, installations };
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
    // 2026-11-09: replacing a copy with local changes would delete the user's work; list the files and stop instead.
    if (!values.force) {
      const edits = (await localSkillEdits(project, values.from)).filter(edit => edit.changed.length + edit.added.length > 0);
      if (edits.length) throw new Error(text.localEdits(edits));
    }
    const installed = await installSkills(project, values.from);
    console.log(`Installed: ${installed.version} into ${destinations.join(' and ')}\nSource: ${installed.home}\nManifest: ${installed.manifest}`);
  } else {
    if (values.force) throw new Error(text.forceInstallOnly);
    const status = await skillsStatus(project, values.from);
    console.log(`Source: ${status.home}\nVersion: ${status.version}`);
    for (const entry of status.installations) {
      console.log(`${entry.path} | ${entry.version ?? 'not installed'} | ${entry.matches ? 'matches' : 'differs'}`);
    }
  }
}

runAsScript(import.meta.url, skillsCli);
