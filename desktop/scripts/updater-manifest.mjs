// Builds latest.json, the Tauri updater manifest the desktop app reads from the GitHub Release
// (.deckmate/ota-updates/plan.md, section 2). Run from the repository root:
//   node desktop/scripts/updater-manifest.mjs --version <version> --url <browser_download_url> --signature-file <installer.exe.sig> [--out <latest.json>]
// CI keeps the .sig next to the renamed installer and passes its path; the manifest carries the
// signature text, both Windows platform keys, and this version's release notes in English and,
// when CHANGELOG.ru.md has the section, Russian.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { extractReleaseNotes } from './release-notes.mjs';

// tauri-plugin-updater 2.14.1 looks up windows-x86_64-nsis first, then the generic
// windows-x86_64 (plugins/updater, RemoteRelease::find_artifact).
const NSIS_X64 = 'windows-x86_64-nsis';
const GENERIC_X64 = 'windows-x86_64';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');

export function buildUpdaterManifest(options) {
  const { version, url, signature, changelog, changelogRu = null, now = new Date() } = options;
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error('A release version is required.');
  }
  if (typeof url !== 'string' || url.length === 0) {
    throw new Error('The installer download URL is required.');
  }
  if (typeof signature !== 'string' || signature.trim().length === 0) {
    throw new Error('The updater signature is empty; the signed build must produce <installer>.exe.sig.');
  }
  const manifest = { version, notes: extractReleaseNotes(changelog, version, 'CHANGELOG.md') };
  if (changelogRu !== null) {
    try {
      manifest.notes_ru = extractReleaseNotes(changelogRu, version, 'CHANGELOG.ru.md');
    } catch {
      // The shell falls back to English notes when the Russian section is absent (plan, 2026-11-09).
    }
  }
  manifest.pub_date = now.toISOString();
  manifest.platforms = {
    [NSIS_X64]: { url, signature },
    [GENERIC_X64]: { url, signature },
  };
  return manifest;
}

function parseArgs(argv) {
  const known = ['version', 'url', 'signature-file', 'out', 'changelog', 'changelog-ru'];
  const args = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`);
    const key = arg.slice(2);
    if (!known.includes(key)) throw new Error(`Unknown option: ${arg}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${arg}.`);
    args[key] = value;
    index++;
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const key of ['version', 'url', 'signature-file']) {
    if (!args[key]) throw new Error(`Missing --${key}.`);
  }
  // The .sig holds the whole minisign SignatureBox; latest.json carries its text (research-updater.md, section 2).
  const signature = readFileSync(args['signature-file'], 'utf8').trim();
  const changelogPath = path.resolve(repoRoot, args.changelog ?? 'CHANGELOG.md');
  const changelogRuPath = path.resolve(repoRoot, args['changelog-ru'] ?? 'CHANGELOG.ru.md');
  const manifest = buildUpdaterManifest({
    version: args.version,
    url: args.url,
    signature,
    changelog: readFileSync(changelogPath, 'utf8'),
    changelogRu: existsSync(changelogRuPath) ? readFileSync(changelogRuPath, 'utf8') : null,
  });
  const out = path.resolve(process.cwd(), args.out ?? 'latest.json');
  writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`updater-manifest: wrote ${out}`);
}

const invokedAsScript = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedAsScript) {
  try {
    main();
  } catch (error) {
    console.error(`updater-manifest: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
