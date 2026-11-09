// Stages the inputs a Tauri release build needs (desktop/README.md, "Development loop" and
// "How it works"): the pinned Node runtime in src-tauri/binaries/ (Tauri externalBin naming),
// the deckmate package with its production node_modules in src-tauri/resources/deckmate/, and
// src-tauri/THIRD-PARTY-NOTICES.txt beside the executable. Run from the repository root:
//   node desktop/scripts/prepare-sidecar.mjs [--skip-smoke]
// Environment: DECKMATE_REPO (repository root) when the script runs outside the checkout.

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { generateDesktopNotices } from './desktop-notices.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const shellDir = path.resolve(scriptDir, '..');
const cacheDir = path.join(shellDir, '.cache');
const srcTauriDir = path.join(shellDir, 'src-tauri');
const nodeBinary = path.join(srcTauriDir, 'binaries', 'node-x86_64-pc-windows-msvc.exe');
const packageDir = path.join(srcTauriDir, 'resources', 'deckmate');
const isWindows = process.platform === 'win32';
const skipSmoke = process.argv.includes('--skip-smoke');
// The same line the Tauri shell waits for (desktop/README.md, "How it works").
const READY_LINE = /Deckmate: (http:\/\/127\.0\.0\.1:\d+)/;
// node.exe is ~90-110 MB; 10 minutes tolerates a slow link without hanging forever.
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;
const READY_TIMEOUT_MS = 20 * 1000;
// The shell gives the server the same 3 s before killing it (STOP_TIMEOUT in server.rs).
const STOP_TIMEOUT_MS = 3 * 1000;

function fail(message) {
  console.error(`prepare-sidecar: ${message}`);
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
  const inside = path.resolve(scriptDir, '..', '..');
  if (!isDeckmateRepo(inside)) fail(`deckmate repository not found at ${inside}. Set DECKMATE_REPO.`);
  return inside;
}

function readNodePin() {
  const file = path.join(shellDir, 'node-runtime.json');
  let pin;
  try {
    pin = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`cannot read node-runtime.json: ${error.message}`);
  }
  const valid = pin && /^\d+\.\d+\.\d+$/u.test(pin.version) && /^[0-9a-f]{64}$/u.test(pin.sha256)
    && /^[0-9a-f]{64}$/u.test(pin.licenseSha256);
  if (!valid) fail('node-runtime.json must hold {"version": "<x.y.z>", "sha256": "<64 lowercase hex>", "licenseSha256": "<64 lowercase hex>"}');
  return pin;
}

async function sha256File(file) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function fetchToFile(url, target) {
  const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS), redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(target));
}

async function stageNodeRuntime(pin) {
  fs.mkdirSync(path.dirname(nodeBinary), { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  const cacheFile = path.join(cacheDir, `node-v${pin.version}-win-x64.exe`);
  if (fs.existsSync(cacheFile)) {
    if (await sha256File(cacheFile) === pin.sha256) {
      fs.copyFileSync(cacheFile, nodeBinary);
      console.log(`1/5 Node v${pin.version}: reused ${path.relative(shellDir, cacheFile)} (cache hit)`);
      return;
    }
    console.log(`    ${path.relative(shellDir, cacheFile)} is cached with a wrong SHA-256, downloading again`);
  }
  const primary = `https://nodejs.org/dist/v${pin.version}/win-x64/node.exe`;
  const mirror = `https://npmmirror.com/mirrors/node/v${pin.version}/win-x64/node.exe`;
  const tempFile = path.join(cacheDir, `node-download-${process.pid}.tmp`);
  const errors = [];
  for (const url of [primary, mirror]) {
    try {
      console.log(`    downloading ${url}`);
      await fetchToFile(url, tempFile);
      const actual = await sha256File(tempFile);
      if (actual !== pin.sha256) {
        fail(`SHA-256 mismatch for ${url}: node-runtime.json pins ${pin.sha256}, the downloaded file has ${actual}.`);
      }
      fs.renameSync(tempFile, cacheFile);
      fs.copyFileSync(cacheFile, nodeBinary);
      console.log(`1/5 Node v${pin.version}: downloaded from ${url}`);
      return;
    } catch (error) {
      fs.rmSync(tempFile, { force: true });
      errors.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  fail(`could not download the Node runtime:\n  ${errors.join('\n  ')}`);
}

async function stageNodeLicense(pin) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const cacheFile = path.join(cacheDir, `node-v${pin.version}-LICENSE`);
  if (fs.existsSync(cacheFile)) {
    if (await sha256File(cacheFile) === pin.licenseSha256) {
      console.log(`    Node.js LICENSE: reused ${path.relative(shellDir, cacheFile)} (cache hit)`);
      return cacheFile;
    }
    console.log(`    ${path.relative(shellDir, cacheFile)} is cached with a wrong SHA-256, downloading again`);
  }
  const url = `https://raw.githubusercontent.com/nodejs/node/v${pin.version}/LICENSE`;
  const tempFile = path.join(cacheDir, `node-license-download-${process.pid}.tmp`);
  try {
    console.log(`    downloading ${url}`);
    await fetchToFile(url, tempFile);
    const actual = await sha256File(tempFile);
    if (actual !== pin.licenseSha256) {
      fail(`SHA-256 mismatch for ${url}: node-runtime.json pins ${pin.licenseSha256}, the downloaded LICENSE has ${actual}.`);
    }
    fs.renameSync(tempFile, cacheFile);
    return cacheFile;
  } catch (error) {
    fs.rmSync(tempFile, { force: true });
    fail(`could not download the Node.js LICENSE: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function packName(stdout) {
  try {
    const entries = JSON.parse(stdout);
    const first = Array.isArray(entries) ? entries[0] : entries;
    if (first && typeof first.filename === 'string') return path.basename(first.filename);
  } catch { /* npm printed extra text; fall back to the regex */ }
  const match = /"filename":\s*"([^"]+\.tgz)"/.exec(stdout ?? '');
  return match ? path.basename(match[1]) : null;
}

function extractTar(tgz, destination) {
  // Windows 10+ ships bsdtar as System32\tar.exe, which takes native paths. CI images often put an
  // MSYS GNU tar first in PATH instead; it reads "C:" as a remote host without --force-local (2026-11-09).
  const forward = value => value.split(path.sep).join('/');
  const candidates = [];
  const systemTar = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
  if (fs.existsSync(systemTar)) {
    candidates.push({ command: systemTar, args: ['-xzf', tgz, '-C', destination, '--strip-components=1'] });
  }
  candidates.push({
    command: 'tar',
    args: ['-xzf', forward(tgz), '--force-local', '-C', forward(destination), '--strip-components=1'],
  });
  const errors = [];
  for (const candidate of candidates) {
    const result = spawnSync(candidate.command, candidate.args, { encoding: 'utf8', windowsHide: true });
    if (!result.error && result.status === 0) return;
    errors.push(`${candidate.command}: ${result.error ? result.error.message : result.stderr || `exited with code ${result.status}`}`);
  }
  fail(`could not extract ${path.relative(shellDir, tgz)}:\n  ${errors.join('\n  ')}`);
}

// npm ci installs files the staged server never reads: TypeScript declarations and sources,
// source maps, changelogs, readmes and test/docs/example folders (~2000 files, 7 MB measured
// 2026-11-09). The lists below delete exactly those, and never: license/notice files (any
// spelling), package.json manifests, native *.node addons, or a file any package's
// main/exports/bin points at — so require() keeps working and every license stays in place
// for the notices. desktop-notices.mjs reads only Rust crate licenses, the Node.js LICENSE
// and the WebView2 SDK text, and the deckmate package ships its own JavaScript notices in
// dist/, so nothing the notices read lives in node_modules anyway.
const PRUNED_DIRECTORY_NAMES = new Set(['test', 'tests', '__tests__', 'docs', 'example', 'examples', '.github']);
const PRUNED_FILE_TESTS = [/\.d\.cts$/iu, /\.d\.mts$/iu, /\.d\.ts$/iu, /\.map$/iu, /\.md$/iu, /^CHANGELOG/iu];
const PROTECTED_FILE_TEST = /^(?:licen[cs]e|notice|copying)/iu;
const TS_SOURCE_TO_COMPILED = [['.cts', '.cjs'], ['.mts', '.mjs'], ['.ts', '.js']];

function entryFiles(manifest, packageDir) {
  const files = new Set();
  // A wildcard export ("./*") names no single file, and the files it covers are plain js this
  // prune never touches; "#" is the exports fallback condition key, not a path.
  const add = value => {
    if (typeof value !== 'string' || value === '' || value.startsWith('#') || value.includes('*')) return;
    files.add(path.resolve(packageDir, value.split('?')[0]));
  };
  add(manifest.main);
  if (typeof manifest.bin === 'string') add(manifest.bin);
  else if (manifest.bin !== null && typeof manifest.bin === 'object') Object.values(manifest.bin).forEach(add);
  const walkExports = value => {
    if (typeof value === 'string') add(value);
    else if (value !== null && typeof value === 'object') Object.values(value).forEach(walkExports);
  };
  walkExports(manifest.exports);
  return files;
}

function pruneStagedDependencies() {
  const modulesDir = path.join(packageDir, 'node_modules');
  if (!fs.existsSync(modulesDir)) return { files: 0, bytes: 0 };

  // One walk snapshots the tree as npm ci left it; every decision below works on the snapshot.
  const dirs = [];
  const files = [];
  const manifests = [];
  const visit = dir => {
    for (const name of fs.readdirSync(dir)) {
      const entry = path.join(dir, name);
      const stat = fs.lstatSync(entry);
      if (stat.isDirectory()) {
        dirs.push(entry);
        visit(entry);
      } else {
        files.push({ path: entry, bytes: stat.size });
        if (name === 'package.json') manifests.push(entry);
      }
    }
  };
  visit(modulesDir);

  const protectedFiles = new Set();
  for (const manifest of manifests) {
    try {
      for (const entry of entryFiles(JSON.parse(fs.readFileSync(manifest, 'utf8')), path.dirname(manifest))) {
        protectedFiles.add(entry);
      }
    } catch { /* an unreadable manifest protects nothing its package.json name does not */ }
  }

  const inside = (file, dir) => file.startsWith(`${dir}${path.sep}`);
  // Whole directories first, outer before inner (visit order). A directory that somehow holds
  // an entry file is kept whole rather than breaking the package that reaches into it.
  const removedDirs = [];
  for (const dir of dirs) {
    if (!PRUNED_DIRECTORY_NAMES.has(path.basename(dir).toLowerCase())) continue;
    if (removedDirs.some(pruned => inside(dir, pruned))) continue;
    if (files.some(file => inside(file.path, dir) && protectedFiles.has(file.path))) continue;
    removedDirs.push(dir);
  }

  const removedFiles = [];
  for (const file of files) {
    if (removedDirs.some(pruned => inside(file.path, pruned))) {
      removedFiles.push(file);
      continue;
    }
    if (protectedFiles.has(file.path)) continue;
    const name = path.basename(file.path);
    // License, notice and manifest files are never patterns' business, whatever else matches.
    if (PROTECTED_FILE_TEST.test(name) || name === 'package.json' || name.endsWith('.node')) continue;
    const twin = TS_SOURCE_TO_COMPILED.find(([from]) => name.toLowerCase().endsWith(from));
    const compiledBeside = twin !== undefined && fs.existsSync(path.join(path.dirname(file.path), name.slice(0, -twin[0].length) + twin[1]));
    if (compiledBeside || PRUNED_FILE_TESTS.some(test => test.test(name))) removedFiles.push(file);
  }

  for (const dir of removedDirs) fs.rmSync(dir, { recursive: true, force: true });
  for (const file of removedFiles) fs.rmSync(file.path, { force: true });
  // Directories that held only pruned files stay behind as empty husks; drop them bottom-up.
  for (const dir of dirs.sort((left, right) => right.length - left.length)) {
    if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  }
  return { files: removedFiles.length, bytes: removedFiles.reduce((total, file) => total + file.bytes, 0) };
}

function stagePackage(repo) {
  console.log('2/5 Packing deckmate (npm pack runs prepack, which builds dist)...');
  const packed = spawnSync(`npm pack --json --pack-destination "${cacheDir}"`, {
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
  const name = packName(packed.stdout);
  if (!name) fail('npm pack finished, but the tgz name was not found in its output.');
  const tgz = path.join(cacheDir, name);
  if (!fs.existsSync(tgz)) fail(`npm pack did not create ${path.relative(shellDir, tgz)}.`);
  for (const file of fs.readdirSync(cacheDir)) {
    if (/^deckmate-.*\.tgz$/u.test(file) && file !== name) fs.rmSync(path.join(cacheDir, file));
  }
  console.log(`    created ${path.relative(shellDir, tgz)}`);

  fs.rmSync(packageDir, { recursive: true, force: true });
  fs.mkdirSync(packageDir, { recursive: true });
  extractTar(tgz, packageDir);
  // The lock makes npm ci install exactly the tested dependency versions, not what a resolver picks today.
  fs.copyFileSync(path.join(repo, 'package-lock.json'), path.join(packageDir, 'package-lock.json'));
  console.log('3/5 Installing production dependencies (npm ci)...');
  // One command string, not an args array: npm is npm.cmd on Windows, and args plus shell: true
  // trip Node's DEP0190 deprecation (2026-11-09).
  const installed = spawnSync('npm ci --omit=dev --ignore-scripts --no-audit --no-fund', {
    cwd: packageDir,
    shell: true,
    stdio: 'inherit',
    env: process.env,
  });
  if (installed.error) fail(`npm ci failed to start: ${installed.error.message}`);
  if (installed.status !== 0) fail(`npm ci in ${path.relative(shellDir, packageDir)} exited with code ${installed.status}.`);
  const pruned = pruneStagedDependencies();
  console.log(`    pruned ${pruned.files} files, ${pruned.bytes} bytes (${(pruned.bytes / 1024 / 1024).toFixed(1)} MB) from node_modules`);
}

// The Tauri shell passes the inherited environment without DECKMATE_/FREETION_/NODE_/OPENSSL_
// variables, case-insensitively, to everything it starts (filtered_env in server.rs, used by
// both the server and the init CLI; desktop/README.md, "How it works"). Every staged run in
// the smoke check keeps the same shape so the staged build runs exactly as the shell runs it.
function filteredEnvironment() {
  const env = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (!/^(DECKMATE|FREETION|NODE|OPENSSL)_/iu.test(name) && value !== undefined) env[name] = value;
  }
  return env;
}

function serverEnvironment(projectDir, port, indexDir) {
  return {
    ...filteredEnvironment(),
    DECKMATE_DATA: projectDir,
    DECKMATE_PORT: String(port),
    DECKMATE_HOST: '127.0.0.1',
    // Keep the smoke index inside the temp folder instead of the user's ~/.cache/deckmate.
    DECKMATE_INDEX: indexDir,
    DECKMATE_SHUTDOWN_STDIN: '1',
  };
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function runStaged(label, args, options = {}) {
  const result = spawnSync(nodeBinary, args, { encoding: 'utf8', windowsHide: true, ...options });
  if (result.error) fail(`smoke check: ${label} failed to start: ${result.error.message}`);
  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? '');
    fail(`smoke check: ${label} exited with code ${result.status}.`);
  }
  return result;
}

function collectLines(stream, onLine) {
  let buffer = '';
  stream.setEncoding('utf8');
  stream.on('data', chunk => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/u);
    buffer = lines.pop() ?? '';
    for (const line of lines) onLine(line);
  });
}

function killTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (isWindows) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  else child.kill('SIGKILL');
}

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise(resolve => child.once('exit', resolve));
}

async function startServerAndCheck(serverEntry, projectDir, port, indexDir) {
  const lines = [];
  const tail = () => lines.slice(-12).join('\n');
  const child = spawn(nodeBinary, [serverEntry], {
    cwd: srcTauriDir,
    env: serverEnvironment(projectDir, port, indexDir),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let url = null;
  const onLine = line => {
    lines.push(line);
    const match = READY_LINE.exec(line);
    if (match && !url) url = match[1];
  };
  collectLines(child.stdout, onLine);
  collectLines(child.stderr, onLine);
  try {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (!url) {
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`the server exited before the ready line (code ${child.exitCode ?? child.signalCode}):\n${tail()}`);
      }
      if (Date.now() > deadline) throw new Error(`no ready line within ${READY_TIMEOUT_MS / 1000} s:\n${tail()}`);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (response.status !== 200) throw new Error(`GET ${url} answered ${response.status}, expected 200.`);
    console.log(`    server: ${url} answered 200`);
    // The shell stops the server through stdin and kills it after 3 s (desktop/README.md, "How it
    // works", STOP_TIMEOUT in server.rs); the smoke check holds the same deadline, so a staged
    // build that cannot close cleanly within it fails here (2026-11-09).
    const stopped = Date.now();
    child.stdin.end('{"type":"shutdown"}\n');
    const exited = await Promise.race([waitForExit(child).then(() => true), new Promise(resolve => setTimeout(resolve, STOP_TIMEOUT_MS, false))]);
    if (!exited) throw new Error(`the server did not stop within ${STOP_TIMEOUT_MS / 1000} s after the stdin shutdown:\n${tail()}`);
    if (child.exitCode !== 0) throw new Error(`the server stopped with code ${child.exitCode ?? child.signalCode}:\n${tail()}`);
    console.log(`    server: stopped cleanly through stdin in ${Date.now() - stopped} ms`);
  } finally {
    killTree(child);
    await waitForExit(child);
  }
}

async function removeTree(dir) {
  // Windows can release the sqlite files a moment after taskkill; a short retry keeps cleanup reliable.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

async function smokeCheck(repoVersion) {
  console.log('5/5 Smoke check of the staged build...');
  const deckmateBin = path.join(packageDir, 'bin', 'deckmate.mjs');
  const serverEntry = path.join(packageDir, 'dist', 'server', 'main.js');
  for (const file of [nodeBinary, deckmateBin, serverEntry]) {
    if (!fs.existsSync(file)) fail(`smoke check: staged file is missing: ${path.relative(shellDir, file)}`);
  }
  const printed = runStaged('deckmate --version', [deckmateBin, '--version'], { cwd: srcTauriDir, env: filteredEnvironment() }).stdout.trim();
  if (printed !== repoVersion) fail(`smoke check: deckmate --version printed "${printed}", expected "${repoVersion}".`);
  console.log(`    deckmate --version: ${printed}`);

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deckmate-sidecar-smoke-'));
  try {
    const projectDir = path.join(tempRoot, 'demo');
    runStaged('deckmate init', [deckmateBin, 'init', projectDir], { cwd: srcTauriDir, env: filteredEnvironment() });
    console.log(`    deckmate init: demo created in ${projectDir}`);
    const port = await freePort();
    await startServerAndCheck(serverEntry, projectDir, port, path.join(tempRoot, 'index'));
  } finally {
    await removeTree(tempRoot);
  }
}

function folderStats(dir) {
  let bytes = 0;
  let files = 0;
  const visit = entry => {
    const stat = fs.statSync(entry);
    if (stat.isDirectory()) for (const name of fs.readdirSync(entry)) visit(path.join(entry, name));
    else {
      bytes += stat.size;
      files++;
    }
  };
  visit(dir);
  return { bytes, files };
}

function printSummary(pin, notices) {
  const node = fs.statSync(nodeBinary);
  const pack = folderStats(packageDir);
  console.log('Summary:');
  console.log(`  Node v${pin.version} (SHA-256 ${pin.sha256})`);
  console.log(`  Node.js LICENSE SHA-256: ${pin.licenseSha256}`);
  console.log(`  node.exe: ${node.size} bytes (${(node.size / 1024 / 1024).toFixed(1)} MB)`);
  console.log(`  ${path.relative(shellDir, packageDir)}: ${pack.files} files, ${pack.bytes} bytes (${(pack.bytes / 1024 / 1024).toFixed(1)} MB)`);
  console.log(`  ${path.relative(shellDir, notices.output)}: ${notices.bytes} bytes, ${notices.crateCount} crates, ${notices.groupCount} groups`);
  console.log('  notices include the full Node.js LICENSE and the Microsoft.Web.WebView2 SDK license');
  console.log(`  smoke check: ${skipSmoke ? 'skipped (--skip-smoke)' : 'passed'}`);
}

const repo = findRepo();
console.log(`Repository: ${repo}`);
const version = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')).version;
const pin = readNodePin();
await stageNodeRuntime(pin);
const nodeLicenseFile = await stageNodeLicense(pin);
stagePackage(repo);
console.log('4/5 Generating third-party notices (locked Windows Rust graph)...');
const notices = generateDesktopNotices({ shellDir, nodePin: pin, nodeLicenseFile });
console.log(`    ${path.relative(shellDir, notices.output)}: ${notices.bytes} bytes, ${notices.crateCount} crates, ${notices.groupCount} groups`);
if (skipSmoke) console.log('5/5 Smoke check skipped (--skip-smoke).');
else await smokeCheck(version);
printSummary(pin, notices);
