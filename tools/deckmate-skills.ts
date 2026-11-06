import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { isMap, isScalar } from 'yaml';
import { markdownHeader } from '../server/agents-config.ts';
import { runAsScript } from '../server/cli-entry.ts';
import { resolveDataPath } from '../server/data-paths.ts';
import { readProjectMarkdown, replaceProjectMarkdown } from '../server/native-cards.ts';
import { packagePath } from '../server/package-path.ts';

const destinations = ['.claude/skills/deckmate', '.agents/skills/deckmate'];

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
  const version = markdownHeader(bytes.toString('utf8'), filename).document.get('version');
  if (typeof version !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(version)) {
    throw new Error(`${filename}: version: expected YYYY-MM-DD`);
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

export async function installSkills(project: string, from = packagePath()) {
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
  for (const target of targets) {
    if (sameFiles(files, await installedFiles(target))) continue;
    await guardProjectPath(root, target);
    await rm(target, { recursive: true, force: true });
    for (const [relativePath, bytes] of files) {
      const filename = path.join(target, relativePath);
      await mkdir(path.dirname(filename), { recursive: true });
      await writeFile(filename, bytes);
    }
  }
  if (!before.equals(after)) {
    await replaceProjectMarkdown(root, relative, createHash('sha256').update(before).digest('hex'), after);
  }
  return { home, manifest, version };
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
    options: { project: { type: 'string' }, from: { type: 'string' } } });
  const project = values.project ?? process.cwd();
  if (positionals.length !== 1 || !['install', 'status'].includes(positionals[0])) {
    throw new Error('Usage: deckmate skills <install|status> [--project <folder>] [--from <Deckmate folder>]');
  }
  if (positionals[0] === 'install') {
    const installed = await installSkills(project, values.from);
    console.log(`Installed: ${installed.version} into ${destinations.join(' and ')}\nSource: ${installed.home}\nManifest: ${installed.manifest}`);
  } else {
    const status = await skillsStatus(project, values.from);
    console.log(`Source: ${status.home}\nVersion: ${status.version}`);
    for (const entry of status.installations) {
      console.log(`${entry.path} | ${entry.version ?? 'not installed'} | ${entry.matches ? 'matches' : 'differs'}`);
    }
  }
}

runAsScript(import.meta.url, skillsCli);
