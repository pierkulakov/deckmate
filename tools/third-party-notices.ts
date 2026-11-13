import { readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

interface NoticeEntry {
  packages: string[];
  source: string;
  text: string;
}

interface VendoredEntry extends NoticeEntry {
  host: string;
  license: string;
}

interface ThirdPartyNotices {
  notices: Map<string, string>;
  vendored: VendoredEntry[];
}

const packageName = /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/;
const packageVersion = /^((?:@[a-z0-9._-]+\/)?[a-z0-9._-]+)@([^@\s/\\]+)$/;

// One section of vite's emitted file: "## <name> - <version> (<license id>)". Packages without a
// license field in package.json, such as format 0.2.2, get no parenthesised identifier; compound
// expressions keep their own parentheses, as in "## dompurify - 3.4.17 ((MPL-2.0 OR Apache-2.0))".
const sectionHeading = /^## (.+?) - (\S+?)(?: \(.+\))?\r?$/;

/**
 * 2026-11-07: the npm tarballs of the @radix-ui/* primitives, fastdom, format and others carry no
 * LICENSE file, so vite's build.license option emits only their section headings. The supplement in
 * assets/third-party-notices.json holds the notice of each such package, keyed by package name and
 * sourced from its upstream repository, so the emitted notices keep satisfying MIT's attribution clause.
 */
export function parseThirdPartyNotices(json: string): ThirdPartyNotices {
  const parsed = JSON.parse(json) as { notices?: unknown; vendored?: unknown } | null;
  if (parsed === null) throw new Error('third-party notices: expected an object');
  if (!Array.isArray(parsed.notices)) throw new Error('third-party notices: expected a "notices" array');
  if (!Array.isArray(parsed.vendored)) throw new Error('third-party notices: expected a "vendored" array');
  const notices = new Map<string, string>();
  for (const entry of parsed.notices) {
    validateNoticeEntry(entry, packageName);
    for (const name of entry.packages) {
      if (notices.has(name)) throw new Error(`third-party notices: ${name} is listed twice`);
      notices.set(name, entry.text.trim());
    }
  }
  const declared = new Map<string, Set<string>>();
  for (const entry of parsed.vendored) {
    validateNoticeEntry(entry, packageVersion);
    if (!isNonEmptyText(entry.host) || !packageVersion.test(entry.host) || !isNonEmptyText(entry.license)) {
      throw new Error('third-party notices: every vendored entry needs host name@version and a non-empty license');
    }
    const packages = declared.get(entry.host) ?? new Set<string>();
    for (const name of entry.packages) {
      if (packages.has(name)) throw new Error(`third-party notices: ${name} is listed twice in ${entry.host}`);
      packages.add(name);
    }
    declared.set(entry.host, packages);
  }
  return { notices, vendored: parsed.vendored as VendoredEntry[] };
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function validateNoticeEntry(value: unknown, namePattern: RegExp): asserts value is NoticeEntry & Record<string, unknown> {
  if (typeof value !== 'object' || value === null || !('packages' in value) || !Array.isArray(value.packages)
    || value.packages.length === 0 || !value.packages.every(name => typeof name === 'string' && namePattern.test(name))
    || !('text' in value) || !isNonEmptyText(value.text) || !('source' in value) || !isNonEmptyText(value.source)) {
    throw new Error('third-party notices: every entry needs valid packages, a source and a non-empty text');
  }
}

export function loadThirdPartyNotices(): ThirdPartyNotices {
  const file = fileURLToPath(new URL('../assets/third-party-notices.json', import.meta.url));
  return parseThirdPartyNotices(readFileSync(file, 'utf8'));
}

/**
 * Returns the markdown with every empty "## <name> - <version>" section filled from the notices,
 * plus the name@version pairs that stayed empty because no notice exists for them.
 */
export function fillThirdPartyNotices(markdown: string, notices: Map<string, string>): { markdown: string; missing: string[]; used: Set<string> } {
  const headings = Array.from(markdown.matchAll(/^#{1,2} [^\r\n]*\r?$/gm));
  const missing: string[] = [];
  const used = new Set<string>();
  let filled = '';
  let copiedUpTo = 0;
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    const headingStart = heading.index;
    if (headingStart === undefined || !heading[0].startsWith('## ')) continue;
    const bodyStart = skipLineBreak(markdown, headingStart + heading[0].length);
    const nextHeading = headings[index + 1];
    const bodyEnd = nextHeading?.index ?? markdown.length;
    if (markdown.slice(bodyStart, bodyEnd).trim() !== '') continue;
    const section = sectionHeading.exec(heading[0]);
    const notice = section === null ? undefined : notices.get(section[1]);
    if (notice === undefined) {
      missing.push(section === null ? heading[0].slice(3).trim() : `${section[1]}@${section[2]}`);
      continue;
    }
    used.add(section![1]);
    filled += markdown.slice(copiedUpTo, bodyStart) + '\n' + notice + '\n';
    if (nextHeading !== undefined) filled += '\n';
    copiedUpTo = bodyEnd;
  }
  return { markdown: filled + markdown.slice(copiedUpTo), missing, used };
}

function skipLineBreak(markdown: string, at: number): number {
  if (markdown[at] === '\r' && markdown[at + 1] === '\n') return at + 2;
  if (markdown[at] === '\n') return at + 1;
  return at;
}

export function findVendoredPackages(code: string): string[] {
  const packages = new Set<string>();
  const markers = code.replaceAll('\\', '/').matchAll(/\bnode_modules\/\.pnpm\/([^/]+)\/node_modules\/((?:@[^/\s]+\/)?[^/\s]+)\//g);
  for (const [, folder, name] of markers) {
    const prefix = `${name.replace('/', '+')}@`;
    let version = 'unknown';
    if (folder.startsWith(prefix)) version = folder.slice(prefix.length).split('_')[0] || 'unknown';
    packages.add(`${name}@${version}`);
  }
  return [...packages];
}

function modulePackageRoot(id: string): string | undefined {
  const segments = [...id.matchAll(/(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)(?=\/|$)/g)];
  const last = segments.at(-1);
  if (last?.index === undefined) return undefined;
  return id.slice(0, last.index + last[0].length);
}

async function readIfPresent(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || (error as NodeJS.ErrnoException).code === 'ENOTDIR') return undefined;
    throw error;
  }
}

export async function collectVendoredPackages(moduleIds: Iterable<string>): Promise<Map<string, Set<string>>> {
  const found = new Map<string, Set<string>>();
  const visited = new Set<string>();
  const hosts = new Map<string, { name: string; version: string }>();
  for (const moduleId of moduleIds) {
    if (moduleId.startsWith('\0')) continue;
    const file = moduleId.split('?')[0].replaceAll('\\', '/');
    const root = modulePackageRoot(file);
    if (root === undefined || visited.has(file)) continue;
    visited.add(file);
    const code = await readIfPresent(file);
    if (code === undefined) continue;
    const packages = findVendoredPackages(code);
    if (packages.length === 0) continue;
    let host = hosts.get(root);
    if (host === undefined) {
      host = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { name: string; version: string };
      if (!isNonEmptyText(host.name) || !isNonEmptyText(host.version)
        || !packageName.test(host.name) || !packageVersion.test(`${host.name}@${host.version}`)) {
        throw new Error(`third-party notices: invalid host package.json in ${root}`);
      }
      hosts.set(root, host);
    }
    const key = `${host.name}@${host.version}`;
    for (const name of packages) {
      if (name.slice(0, name.lastIndexOf('@')) === host.name) continue;
      const embedded = found.get(key) ?? new Set<string>();
      embedded.add(name);
      found.set(key, embedded);
    }
  }
  return found;
}

export function completeThirdPartyNotices(markdown: string, manifest: ThirdPartyNotices, found: Map<string, Set<string>>, subset = false): string {
  const filled = fillThirdPartyNotices(nestLicenseHeadings(markdown), manifest.notices);
  const errors: string[] = [];
  if (filled.missing.length > 0) errors.push(`bundled packages without license text or a supplement entry: ${filled.missing.join(', ')}`);
  const declared = new Map<string, Set<string>>();
  const notFound: string[] = [];
  // 2026-11-13: smaller entry points omit whole hosts; embedded code within a present host still needs exact coverage.
  const vendored = subset ? manifest.vendored.filter(entry => found.has(entry.host)) : manifest.vendored;
  for (const entry of vendored) {
    const packages = declared.get(entry.host) ?? new Set<string>();
    for (const name of entry.packages) {
      packages.add(name);
      if (!found.get(entry.host)?.has(name)) notFound.push(`${name} in ${entry.host}`);
    }
    declared.set(entry.host, packages);
  }
  for (const [host, packages] of found) {
    for (const name of packages) {
      if (!declared.get(host)?.has(name)) errors.push(`undeclared vendored code: ${name} in ${host}`);
    }
  }
  if (notFound.length > 0) errors.push(`vendored entries not found in the bundle: ${notFound.join(', ')}`);
  const unused = [...manifest.notices.keys()].filter(name => !filled.used.has(name));
  if (!subset && unused.length > 0) errors.push(`unused notices entries: ${unused.join(', ')}`);
  if (errors.length > 0) throw new Error(errors.join('\n'));
  return (filled.markdown.trimEnd() + renderVendoredNotices(vendored) + '\n').replaceAll('\r\n', '\n');
}

function nestLicenseHeadings(markdown: string): string {
  // 2026-11-07: marked's license has its own #/## headings; nesting upstream headings keeps them
  // inside their package section instead of making a non-empty notice look empty to markdown readers.
  let insidePackage = false;
  return markdown.replace(/^#{1,2} [^\r\n]*\r?$/gm, heading => {
    if (sectionHeading.test(heading)) {
      insidePackage = true;
      return heading;
    }
    return insidePackage ? `##${heading}` : heading;
  });
}

function displayPackage(name: string): string {
  const separator = name.lastIndexOf('@');
  return `${name.slice(0, separator)} ${name.slice(separator + 1)}`;
}

function renderVendoredNotices(entries: VendoredEntry[]): string {
  if (entries.length === 0) return '';
  const sorted = [...entries].sort((left, right) => left.host.localeCompare(right.host) || left.packages[0].localeCompare(right.packages[0]));
  const sections = sorted.map(entry => `## ${entry.packages.map(displayPackage).join(', ')} (${entry.license})\n\nBundled inside ${displayPackage(entry.host)}.\n\n${entry.text.trim()}`);
  return '\n\n# Code bundled inside other packages\n\n'
    + 'The packages below ship prebuilt files that already contain code from other packages. Each notice covers that embedded code.\n\n'
    + sections.join('\n\n');
}

// 2026-11-07: vite:license emits its markdown in generateBundle. Rewriting the written file in
// writeBundle does not depend on how the hooks of vite's internal plugins are ordered against ours,
// and the same hook receives every chunk's module ids for the embedded-code check.
export function thirdPartyNoticesPlugin({ subset = false }: { subset?: boolean } = {}): Plugin {
  let noticesFile: string | undefined;
  return {
    name: 'deckmate:license-supplement',
    configResolved(config) {
      const license = config.build.license;
      if (!license) return;
      // 2026-11-07: outDir is still root-relative here; vite absolutizes it later in the build.
      noticesFile = join(resolve(config.root, config.build.outDir), typeof license === 'object' ? license.fileName : '.vite/license.md');
    },
    async writeBundle(_options, bundle) {
      if (noticesFile === undefined) return;
      try {
        const moduleIds = Object.values(bundle).flatMap(output => output.type === 'chunk' ? output.moduleIds : []);
        const found = await collectVendoredPackages(moduleIds);
        const emitted = await readFile(noticesFile, 'utf8');
        const markdown = completeThirdPartyNotices(emitted, loadThirdPartyNotices(), found, subset);
        if (markdown !== emitted) await writeFile(noticesFile, markdown);
      } catch (error) {
        this.error(error instanceof Error ? error.message : String(error));
      }
    },
  };
}
