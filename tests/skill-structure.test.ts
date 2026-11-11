import { expect, it, vi } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { projectCli } from '../tools/project.ts';

// 2026-11-11: the skill text is rewritten in parallel; these checks pin the invariants the router,
// the installer and the assignment runner depend on, not the current wording.
const root = fileURLToPath(new URL('..', import.meta.url));
const skillRoot = path.join(root, 'skills', 'deckmate');
const taskStates = new Set(['not-started', 'discussing', 'in-iteration', 'started', 'review', 'done', 'wont-do']);
// Plain backticked paths may use the skill root; Markdown links stay relative to their linking file.
const routedDirectories = new Set(['workflows', 'references', 'genres', 'lenses', 'engines']);
const routerBodyLineLimit = 80;

interface SkillFile {
  relative: string;
  text: string;
  /** Lines with fenced code blocks blanked: examples inside fences are quoted, not live references. */
  lines: string[];
  slugs: Set<string>;
}

async function readSkillFiles(): Promise<SkillFile[]> {
  const files: SkillFile[] = [];
  const visit = async (relative: string): Promise<void> => {
    const directory = relative ? path.join(skillRoot, relative) : skillRoot;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await visit(child);
      else if (entry.name.endsWith('.md')) {
        const text = await readFile(path.join(skillRoot, child), 'utf8');
        const lines = visibleLines(text);
        files.push({ relative: child, text, lines, slugs: headingSlugs(lines) });
      }
    }
  };
  await visit('');
  files.sort((one, two) => one.relative.localeCompare(two.relative));
  return files;
}

function visibleLines(text: string): string[] {
  let fenced = false;
  return text.split(/\r?\n/u).map(line => {
    if (/^\s*(?:```|~~~)/u.test(line)) {
      fenced = !fenced;
      return '';
    }
    return fenced ? '' : line;
  });
}

/** GitHub-style anchors: lowercase, punctuation dropped, spaces to hyphens, repeated headings numbered. */
function headingSlugs(lines: readonly string[]): Set<string> {
  const slugs = new Set<string>();
  const seen = new Map<string, number>();
  for (const line of lines) {
    const heading = /^#{1,6}[ \t]+(.+?)[ \t]*#*$/u.exec(line);
    if (!heading) continue;
    const base = heading[1].trim().toLowerCase().replace(/[^\p{L}\p{N} -]/gu, '').replace(/\s+/gu, '-');
    const repeat = seen.get(base) ?? 0;
    seen.set(base, repeat + 1);
    slugs.add(repeat ? `${base}-${repeat}` : base);
  }
  return slugs;
}

function frontMatter(text: string): Record<string, unknown> | null {
  const match = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(text);
  return match ? parse(match[1]) as Record<string, unknown> : null;
}

/** Only plain paths may fall back to the routed directories at the skill root. */
function resolveTargets(from: string, target: string, allowRootFallback = false): string[] {
  const targets = [path.posix.normalize(path.posix.join(path.posix.dirname(from), target))];
  if (allowRootFallback && routedDirectories.has(target.split('/')[0])) targets.push(path.posix.normalize(target));
  return [...new Set(targets)];
}

/** The help of `deckmate project`, captured the way tests/cli-help.test.ts runs the CLI in-process. */
async function projectHelp(): Promise<string> {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    await projectCli(['--help']);
    return log.mock.calls.map(call => call.join(' ')).join('\n');
  } finally {
    log.mockRestore();
  }
}

it('keeps SKILL.md front matter complete and the router body within 80 lines', async () => {
  const skill = (await readSkillFiles()).find(file => file.relative === 'SKILL.md');
  expect(skill, 'skills/deckmate/SKILL.md exists').toBeDefined();
  const matter = frontMatter(skill!.text);
  expect(matter, 'SKILL.md starts with YAML front matter').not.toBeNull();
  expect(matter!.name).toBe('deckmate');
  expect(String(matter!.description ?? '').trim(), 'SKILL.md describes itself').not.toBe('');
  const metadata = matter!.metadata as Record<string, unknown> | undefined;
  const version = String(metadata?.version ?? '');
  expect(version, 'metadata.version uses YYYY-MM-DD').toMatch(/^\d{4}-\d{2}-\d{2}$/u);
  expect(Number.isNaN(Date.parse(version)), 'metadata.version is a real calendar date').toBe(false);
  const body = skill!.text.replace(/^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u, '').replace(/(?:\r?\n)+$/u, '');
  expect(body.split(/\r?\n/u).length, 'router body stays compact').toBeLessThanOrEqual(routerBodyLineLimit);
});

it('resolves Markdown links relative to the linking file and permits root fallback only for plain paths', () => {
  expect(resolveTargets('workflows/gdd.md', 'references/cli.md')).toEqual(['workflows/references/cli.md']);
  expect(resolveTargets('workflows/gdd.md', '../references/cli.md')).toEqual(['references/cli.md']);
  expect(resolveTargets('workflows/gdd.md', 'references/cli.md', true)).toEqual(['workflows/references/cli.md', 'references/cli.md']);
});

it('points every reference into the skill at an existing file and heading', async () => {
  const files = await readSkillFiles();
  const byPath = new Map(files.map(file => [file.relative, file]));
  const problems: string[] = [];
  const link = /\[[^\]]*\]\(([^)\s]+)(?:[ \t]+"[^"]*")?\)/gu;
  const inlineSkillPath = /^((?:workflows|references|genres|lenses|engines)\/[^\s`#]+\.md)(?:#([^`\s]+))?$/u;
  const placeholder = /[{<>*\\]/u;
  for (const file of files) {
    for (const [index, line] of file.lines.entries()) {
      const place = `${file.relative}:${index + 1}`;
      for (const found of line.matchAll(link)) {
        const target = found[1];
        if (/^[a-z][a-z0-9+.-]*:/iu.test(target) || target.startsWith('#')) continue;
        const hash = target.indexOf('#');
        const filePath = hash < 0 ? target : target.slice(0, hash);
        const anchor = hash < 0 ? '' : target.slice(hash + 1);
        const resolved = resolveTargets(file.relative, filePath).filter(candidate => byPath.has(candidate));
        if (!resolved.length) problems.push(`${place}: links '${target}' to a file outside the skill`);
        else if (anchor && !resolved.some(candidate => byPath.get(candidate)!.slugs.has(anchor))) {
          problems.push(`${place}: no heading '${anchor}' in ${filePath}`);
        }
      }
      for (const span of line.matchAll(/`([^`\n]+)`/gu)) {
        const mentioned = inlineSkillPath.exec(span[1]);
        if (!mentioned || placeholder.test(mentioned[1])) continue;
        // A path directly after "no"/"not" states that the file is absent; it is a warning, not a reference.
        if (/\b(?:no|not|never|without)\s+$/iu.test(line.slice(0, span.index ?? 0))) continue;
        const anchor = mentioned[2] ?? '';
        const resolved = resolveTargets(file.relative, mentioned[1], true).filter(candidate => byPath.has(candidate));
        if (!resolved.length) problems.push(`${place}: mentions '${span[1]}', which is not a file in the skill`);
        else if (anchor && !resolved.some(candidate => byPath.get(candidate)!.slugs.has(anchor))) {
          problems.push(`${place}: no heading '${anchor}' in ${mentioned[1]}`);
        }
      }
    }
  }
  if (problems.length) throw new Error(`Skill reference violations:\n${problems.join('\n')}`);
});

it('names only commands that deckmate project really has', async () => {
  const listed = /^Commands: (.*)\.$/mu.exec(await projectHelp())?.[1];
  expect(listed, 'deckmate project --help lists its commands').toBeDefined();
  const commands = new Set(listed!.split(', '));
  const problems: string[] = [];
  const commandCall = /(?:(?:npx )?deckmate project|npm run project --)\s+([a-z][a-z-]*)(?![a-z-])/gu;
  for (const file of await readSkillFiles()) {
    for (const [index, line] of file.lines.entries()) {
      for (const span of line.matchAll(/`[^`\n]+`/gu)) {
        for (const call of span[0].matchAll(commandCall)) {
          if (!commands.has(call[1])) {
            problems.push(`${file.relative}:${index + 1}: '${call[1]}' in ${span[0]} is not a deckmate project command`);
          }
        }
      }
    }
  }
  if (problems.length) throw new Error(`Skill command violations:\n${problems.join('\n')}`);
});

it('uses only the seven Task state ids as the argument of state', async () => {
  const problems: string[] = [];
  const stateCall = /(?<![a-z-])state\s+(?:<[a-z-]*ref>|…|c-[a-z0-9]+)\s+([a-z][a-z-]*)(?![a-z-])/giu;
  for (const file of await readSkillFiles()) {
    for (const [index, line] of file.lines.entries()) {
      for (const call of line.matchAll(stateCall)) {
        if (taskStates.has(call[1].toLowerCase())) continue;
        // A warning may quote a forbidden call to explain it: "never `state <c-ref> accepted` (invalid)".
        if (/\b(?:never|invalid|forbidden)\b|\bnot\s+(?:a\s+)?(?:valid|allowed)\b/iu.test(line.replace(call[0], ''))) continue;
        problems.push(`${file.relative}:${index + 1}: state argument '${call[1]}' is not one of: ${[...taskStates].join(', ')}`);
      }
    }
  }
  if (problems.length) throw new Error(`Skill state violations:\n${problems.join('\n')}`);
});

it('keeps the required front matter and headings of genre, lens and engine guides', async () => {
  const problems: string[] = [];
  const engineHeadings = ['Where to look', 'How to measure', 'Pitfalls'];
  for (const file of await readSkillFiles()) {
    const directory = path.posix.dirname(file.relative);
    if ((directory === 'genres' || directory === 'lenses') && path.posix.basename(file.relative) !== 'README.md') {
      const identityKey = directory === 'genres' ? 'genre' : 'area';
      const matter = frontMatter(file.text);
      for (const key of [identityKey, 'title']) {
        const value = matter?.[key];
        if (typeof value !== 'string' || !value.trim()) problems.push(`${file.relative}: front matter must set '${key}'`);
      }
    }
    if (directory === 'engines') {
      const headings = file.lines
        .map(line => /^##[ \t]+(.+?)[ \t]*#*$/u.exec(line)?.[1]?.trim())
        .filter((heading): heading is string => heading !== undefined);
      for (const heading of engineHeadings) {
        if (!headings.includes(heading)) problems.push(`${file.relative}: missing heading '## ${heading}'`);
      }
    }
  }
  if (problems.length) throw new Error(`Skill guide violations:\n${problems.join('\n')}`);
});

it('keeps assignment sections to the analyze and audit workflows', async () => {
  const misplaced = (await readSkillFiles())
    .filter(file => path.posix.dirname(file.relative) === 'workflows')
    .filter(file => /^## Assignment:/mu.test(file.text))
    .map(file => file.relative)
    .filter(name => name !== 'workflows/analyze.md' && name !== 'workflows/audit.md');
  expect(misplaced, `Assignment markers belong in analyze.md and audit.md only: ${misplaced.join(', ')}`).toEqual([]);
});
