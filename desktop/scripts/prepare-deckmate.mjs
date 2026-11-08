// Packs the deckmate repository into a tgz next to this shell, points the
// dependency at it and installs. Run from anywhere: node scripts/prepare-deckmate.mjs
// Environment: DECKMATE_REPO (repository root), ELECTRON_MIRROR (passed through to npm install).

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const shellDir = path.resolve(scriptDir, '..');
const isWindows = process.platform === 'win32';

function fail(message) {
  console.error(`prepare-deckmate: ${message}`);
  process.exit(1);
}

function isDeckmateRepo(dir) {
  const file = path.join(dir, 'package.json');
  if (!fs.existsSync(file)) return false;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')).name === 'deckmate';
  } catch {
    return false;
  }
}

function findRepo() {
  if (process.env.DECKMATE_REPO) {
    const dir = path.resolve(process.env.DECKMATE_REPO);
    if (!isDeckmateRepo(dir)) fail(`DECKMATE_REPO is not a deckmate repository: ${dir}`);
    return dir;
  }
  // Layout since 0.2.0 (2026-11-08): desktop/ inside the deckmate repository.
  const inside = path.resolve(scriptDir, '..', '..');
  if (isDeckmateRepo(inside)) return inside;
  // Older layout: a separate deckmate-desktop checkout next to deckmate.
  const sibling = path.resolve(shellDir, '..', 'deckmate');
  if (isDeckmateRepo(sibling)) return sibling;
  fail(`deckmate repository not found. Set DECKMATE_REPO, or clone it next to this folder (${sibling}).`);
}

function run(command, args, options) {
  const result = spawnSync(command, args, { shell: isWindows, encoding: 'utf8', ...options });
  if (result.error) fail(`${command} failed to start: ${result.error.message}`);
  if (result.status !== 0) fail(`${command} ${args.join(' ')} exited with code ${result.status}.`);
  return result;
}

const repo = findRepo();
console.log(`1/4 Repository: ${repo}`);

console.log('2/4 Packing deckmate (npm pack runs prepack, which builds dist)...');
const packed = spawnSync('npm', ['pack', '--json', '--pack-destination', `"${shellDir}"`], {
  cwd: repo,
  shell: true,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
if (packed.error) fail(`npm pack failed to start: ${packed.error.message}`);
if (packed.status !== 0) {
  process.stderr.write(packed.stderr ?? '');
  fail(`npm pack exited with code ${packed.status}.`);
}
const nameMatch = /"filename":\s*"([^"]+\.tgz)"/.exec(packed.stdout ?? '');
if (!nameMatch) fail('npm pack finished, but the tgz name was not found in its output.');
const tgzName = nameMatch[1];
if (!fs.existsSync(path.join(shellDir, tgzName))) fail(`npm pack did not create ${tgzName} in ${shellDir}.`);
console.log(`    created ${tgzName}`);

console.log('3/4 Updating package.json and removing old packs...');
for (const file of fs.readdirSync(shellDir)) {
  if (/^deckmate-.*\.tgz$/.test(file) && file !== tgzName) {
    fs.rmSync(path.join(shellDir, file));
    console.log(`    removed ${file}`);
  }
}
const pkgFile = path.join(shellDir, 'package.json');
let pkg;
try {
  pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
} catch (error) {
  fail(`cannot read package.json: ${error.message}`);
}
pkg.dependencies = { ...(pkg.dependencies ?? {}), deckmate: `file:${tgzName}` };
fs.writeFileSync(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`);
console.log(`    deckmate -> file:${tgzName}`);

console.log('4/4 Installing dependencies (npm install)...');
if (process.env.ELECTRON_MIRROR) console.log(`    ELECTRON_MIRROR=${process.env.ELECTRON_MIRROR}`);
run('npm', ['install', '--no-audit', '--no-fund'], { cwd: shellDir, stdio: 'inherit', env: process.env });

// Electron 45 has no postinstall download: its binary comes from install.js on request,
// and electron-builder fails without node_modules/electron/dist (2026-11-08).
if (!fs.existsSync(path.join(shellDir, 'node_modules', 'electron', 'dist'))) {
  console.log('    downloading the Electron binary...');
  run('node', [path.join('node_modules', 'electron', 'install.js')], { cwd: shellDir, stdio: 'inherit', env: process.env });
}

console.log('Done. Start the app with: npm start');
