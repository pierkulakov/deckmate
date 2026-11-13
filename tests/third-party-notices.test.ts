import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import {
  collectVendoredPackages, completeThirdPartyNotices, fillThirdPartyNotices, findVendoredPackages,
  loadThirdPartyNotices, parseThirdPartyNotices,
} from '../tools/third-party-notices.ts';

const notices = new Map([['left-pad', 'MIT License\n\nCopyright (c) 2020 Left Pad Corp']]);

it('fills empty sections and leaves sections with text untouched', () => {
  const markdown = [
    '# Licenses',
    '',
    '## kept - 1.0.0 (MIT)',
    '',
    'Existing notice.',
    '',
    '## left-pad - 1.3.0 (MIT)',
    '',
    '## format - 0.2.2',
    '',
  ].join('\n');
  const { markdown: filled, missing } = fillThirdPartyNotices(markdown, notices);
  expect(filled).toContain('## left-pad - 1.3.0 (MIT)\n\nMIT License\n\nCopyright (c) 2020 Left Pad Corp\n');
  expect(filled).toContain('Existing notice.');
  expect(filled).not.toContain('## left-pad - 1.3.0 (MIT)\n\n## ');
  expect(missing).toEqual(['format@0.2.2']);
});

it('fills an empty section that ends the file', () => {
  const filled = fillThirdPartyNotices('# Licenses\n\n## left-pad - 1.3.0 (MIT)\n', notices);
  expect(filled.markdown).toBe('# Licenses\n\n## left-pad - 1.3.0 (MIT)\n\nMIT License\n\nCopyright (c) 2020 Left Pad Corp\n');
  expect(filled.missing).toEqual([]);
});

it('rejects a package listed in two notices', () => {
  const entry = { packages: ['a'], source: 's', text: 'Copyright (c) 2020 A' };
  expect(() => parseThirdPartyNotices(JSON.stringify({ notices: [entry, entry], vendored: [] }))).toThrow('listed twice');
});

it('ships a copyright notice for every package in the supplement', () => {
  const { notices: shipped } = loadThirdPartyNotices();
  expect(shipped.size).toBeGreaterThan(0);
  for (const [name, text] of shipped) expect(text, name).toMatch(/Copyright/i);
});

const vendoredEntry = {
  host: 'host-pkg@1.0.0', packages: ['embedded@2.0.0'], license: 'MIT', source: 'npm tarball',
  text: 'MIT License\n\nCopyright 2026 Embedded',
};

it.each([
  { host: 'host-pkg' },
  { host: '@scope/host' },
  { packages: [] },
  { packages: ['embedded'] },
  { packages: ['@scope/embedded'] },
  { packages: [42] },
  { packages: ['embedded@'] },
  { packages: ['embedded@2.0.0 with spaces'] },
  { license: ' ' },
  { text: '\n' },
])('rejects malformed vendored entries: %j', overrides => {
  expect(() => parseThirdPartyNotices(JSON.stringify({ notices: [], vendored: [{ ...vendoredEntry, ...overrides }] }))).toThrow('third-party notices:');
});

it('rejects empty notices text', () => {
  expect(() => parseThirdPartyNotices(JSON.stringify({
    notices: [{ packages: ['example'], source: 'upstream', text: '' }], vendored: [],
  }))).toThrow('non-empty text');
});

it('rejects duplicate embedded packages within a group or across groups of the same host', () => {
  for (const vendored of [
    [{ ...vendoredEntry, packages: ['embedded@2.0.0', 'embedded@2.0.0'] }],
    [vendoredEntry, vendoredEntry],
  ]) {
    expect(() => parseThirdPartyNotices(JSON.stringify({ notices: [], vendored })))
      .toThrow('embedded@2.0.0 is listed twice in host-pkg@1.0.0');
  }
  expect(parseThirdPartyNotices(JSON.stringify({
    notices: [], vendored: [vendoredEntry, { ...vendoredEntry, host: '@scope/other@1.0.0' }],
  })).vendored).toHaveLength(2);
});

it('finds unique scoped and unscoped pnpm packages, stripping peer suffixes', () => {
  const code = [
    '// ../../node_modules/.pnpm/@chevrotain+regexp-to-ast@11.1.2/node_modules/@chevrotain/regexp-to-ast/lib/a.js',
    '// ../../node_modules/.pnpm/chevrotain-allstar@0.3.1_chevrotain@11.1.2/node_modules/chevrotain-allstar/lib/a.js',
    '// ../../node_modules/.pnpm/chevrotain-allstar@0.3.1_chevrotain@11.1.2/node_modules/chevrotain-allstar/lib/b.js',
  ].join('\n');
  expect(findVendoredPackages(code)).toEqual(['@chevrotain/regexp-to-ast@11.1.2', 'chevrotain-allstar@0.3.1']);
  expect(findVendoredPackages('export const a = 1;')).toEqual([]);
});

it('keeps hashed pnpm folders visible with an unknown version', () => {
  expect(findVendoredPackages('// node_modules/.pnpm/short_hash/node_modules/@scope/long-name/index.js'))
    .toEqual(['@scope/long-name@unknown']);
});

const temporaryFolders: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryFolders.splice(0).map(folder => rm(folder, { recursive: true, force: true })));
});

async function createBundleModules(): Promise<string[]> {
  const root = await mkdtemp(join(tmpdir(), 'deckmate-notices-'));
  temporaryFolders.push(root);
  const host = join(root, 'node_modules', 'host-pkg');
  const scoped = join(host, 'node_modules', '@scope', 'host');
  await mkdir(join(host, 'dist'), { recursive: true });
  await mkdir(join(scoped, 'dist'), { recursive: true });
  await writeFile(join(host, 'package.json'), JSON.stringify({ name: 'host-pkg', version: '1.0.0' }));
  await writeFile(join(scoped, 'package.json'), JSON.stringify({ name: '@scope/host', version: '3.0.0' }));
  const chunk = join(host, 'dist', 'chunk.mjs');
  const scopedChunk = join(scoped, 'dist', 'chunk.mjs');
  await writeFile(chunk, [
    '// node_modules/.pnpm/embedded@2.0.0/node_modules/embedded/lib/a.js',
    '// node_modules/.pnpm/host-pkg@0.9.0/node_modules/host-pkg/lib/self.js',
  ].join('\n'));
  await writeFile(scopedChunk, 'export const scoped = true;');
  return [chunk, `${chunk}?query`, chunk.replaceAll('\\', '/'), scopedChunk.replaceAll('/', '\\'),
    `\0${chunk}`, `${chunk}.missing`, join(root, 'outside-node_modules.mjs')];
}

it('collects bundled module files once, skipping virtual, missing, self and non-package modules', async () => {
  const modules = await createBundleModules();
  expect(await collectVendoredPackages(modules)).toEqual(new Map([['host-pkg@1.0.0', new Set(['embedded@2.0.0'])]]));
});

it('uses the last node_modules segment and handles scoped hosts and Windows separators', async () => {
  const modules = await createBundleModules();
  const scopedFile = modules[3];
  await writeFile(scopedFile.replaceAll('\\', '/'), '// node_modules/.pnpm/embedded@2.0.0/node_modules/embedded/lib/a.js');
  expect(await collectVendoredPackages([scopedFile])).toEqual(new Map([['@scope/host@3.0.0', new Set(['embedded@2.0.0'])]]));
});

it('reports undeclared, missing and unused manifest entries together with empty sections', async () => {
  const found = await collectVendoredPackages(await createBundleModules());
  const manifest = parseThirdPartyNotices(JSON.stringify({
    notices: [{ packages: ['unused'], source: 'upstream', text: 'Copyright Unused' }],
    vendored: [{ ...vendoredEntry, packages: ['absent@9.0.0'] }],
  }));
  let message = '';
  try {
    completeThirdPartyNotices('# Licenses\n\n## empty - 1.0.0 (MIT)\n', manifest, found);
  } catch (error) {
    message = (error as Error).message;
  }
  expect(message).toContain('undeclared vendored code: embedded@2.0.0 in host-pkg@1.0.0');
  expect(message).toContain('vendored entries not found in the bundle: absent@9.0.0 in host-pkg@1.0.0');
  expect(message).toContain('unused notices entries: unused');
  expect(message).toContain('bundled packages without license text or a supplement entry: empty@1.0.0');
});

it('appends sorted vendored notices after filled sections with LF line endings', () => {
  const extra = { ...vendoredEntry, packages: ['aaa@1.0.0'], text: 'Copyright Another' };
  const manifest = { notices, vendored: [vendoredEntry, extra, { ...vendoredEntry, host: 'aaa-host@1.0.0' }] };
  const found = new Map([
    ['host-pkg@1.0.0', new Set(['embedded@2.0.0', 'aaa@1.0.0'])],
    ['aaa-host@1.0.0', new Set(['embedded@2.0.0'])],
  ]);
  const output = completeThirdPartyNotices('# Licenses\r\n\r\n## left-pad - 1.3.0 (MIT)\r\n', manifest, found);
  expect(output).toContain('Copyright (c) 2020 Left Pad Corp\n\n# Code bundled inside other packages');
  expect(output).toContain('## embedded 2.0.0 (MIT)\n\nBundled inside host-pkg 1.0.0.\n\nMIT License\n\nCopyright 2026 Embedded');
  expect(output.indexOf('Bundled inside aaa-host')).toBeLessThan(output.indexOf('## aaa 1.0.0'));
  expect(output.indexOf('## aaa 1.0.0')).toBeLessThan(output.indexOf('Bundled inside host-pkg 1.0.0.\n\nMIT License'));
  expect(output).not.toContain('\r');
  expect(fillThirdPartyNotices(output, notices).missing).toEqual([]);
});

it('allows a smaller entry point to omit notices and whole vendored hosts without weakening coverage of shipped code', () => {
  const manifest = { notices, vendored: [vendoredEntry] };
  const source = '# Licenses\n\n## kept - 1.0.0 (MIT)\n\nCopyright Kept\n';
  expect(completeThirdPartyNotices(source, manifest, new Map(), true)).toBe(source);
  expect(() => completeThirdPartyNotices(source, manifest, new Map())).toThrow('unused notices entries');
  expect(() => completeThirdPartyNotices('# Licenses\n\n## empty - 1.0.0 (MIT)\n', manifest, new Map(), true))
    .toThrow('bundled packages without license text');
  const found = new Map([['host-pkg@1.0.0', new Set(['unknown@1.0.0'])]]);
  expect(() => completeThirdPartyNotices(source, manifest, found, true)).toThrow('undeclared vendored code: unknown@1.0.0');
  expect(() => completeThirdPartyNotices(source, manifest, found, true)).toThrow('vendored entries not found in the bundle: embedded@2.0.0');
  found.set('host-pkg@1.0.0', new Set(['embedded@2.0.0']));
  expect(completeThirdPartyNotices(source, manifest, found, true)).toContain('Copyright 2026 Embedded');
});

it('does not let another heading disguise an empty section', () => {
  const filled = fillThirdPartyNotices('# Licenses\n\n## missing - 1.0.0 (MIT)\n\n# Next\n\n## empty group\n', notices);
  expect(filled.missing).toEqual(['missing@1.0.0', 'empty group']);
});

it('nests upstream markdown headings inside their package without changing license wording', () => {
  const source = '# Licenses\n\n## marked - 16.4.2 (MIT)\n\n# License information\n\n## Marked\n\nCopyright Marked\n';
  const output = completeThirdPartyNotices(source, { notices: new Map(), vendored: [] }, new Map());
  expect(output).toContain('## marked - 16.4.2 (MIT)\n\n### License information\n\n#### Marked\n\nCopyright Marked');
  expect(fillThirdPartyNotices(output, new Map()).missing).toEqual([]);
});

it('keeps headings with compound license expressions as package sections', () => {
  const source = '# Licenses\n\n## kept - 1.0.0 (MIT)\n\nCopyright Kept\n\n## dompurify - 3.4.17 ((MPL-2.0 OR Apache-2.0))\n\nCopyright Cure53\n';
  const output = completeThirdPartyNotices(source, { notices: new Map(), vendored: [] }, new Map());
  expect(output).toContain('\n## dompurify - 3.4.17 ((MPL-2.0 OR Apache-2.0))\n\nCopyright Cure53');
  expect(fillThirdPartyNotices('# Licenses\n\n## pako - 2.0.3 ((MIT AND Zlib))\n', new Map()).missing).toEqual(['pako@2.0.3']);
});

it('ships versioned embedded packages and their original license texts', () => {
  const { vendored } = loadThirdPartyNotices();
  expect(vendored.length).toBeGreaterThan(0);
  const versioned = /^(?:@[^/@\s]+\/)?[^/@\s]+@[^/@\s]+$/;
  for (const entry of vendored) {
    expect(entry.host).toMatch(versioned);
    expect(entry.packages.length).toBeGreaterThan(0);
    for (const name of entry.packages) expect(name).toMatch(versioned);
    expect(entry.text, entry.host).toMatch(/Copyright|Apache License/i);
  }
});
