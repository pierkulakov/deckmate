// Builds latest.json, the Tauri updater manifest the desktop app reads from the GitHub Release
// (.deckmate/ota-updates/plan.md, section 2). Run from the repository root:
//   node desktop/scripts/updater-manifest.mjs --version <version> --url <browser_download_url> --installer <installer.exe> --signature-file <installer.exe.sig> [--pub-date <commit date>] [--out <latest.json>]
// CI keeps the .sig next to the renamed installer and passes its path; the manifest carries the
// canonical base64 signature, both Windows platform keys, and this version's release notes in
// English and Russian. The publication date defaults to the checked-out commit's timestamp.

import { execFileSync } from 'node:child_process';
import { createHash, createPublicKey, verify as verifyEd25519 } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { extractReleaseNotes } from './release-notes.mjs';

// tauri-plugin-updater 2.14.1 looks up windows-x86_64-nsis first, then the generic
// windows-x86_64 (plugins/updater, RemoteRelease::find_artifact).
const NSIS_X64 = 'windows-x86_64-nsis';
const GENERIC_X64 = 'windows-x86_64';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function decodeBase64(value, label) {
  if (typeof value !== 'string') throw new Error(`${label} is missing.`);
  const compact = value.trim();
  if (compact === '' || !/^[A-Za-z0-9+/]*={0,2}$/u.test(compact) || compact.length % 4 !== 0) {
    throw new Error(`${label} is not valid base64.`);
  }
  const decoded = Buffer.from(compact, 'base64');
  if (decoded.toString('base64') !== compact) throw new Error(`${label} is not canonical base64.`);
  return decoded;
}

function decodePublicKey(encoded) {
  const keyFile = decodeBase64(encoded, 'The updater public key').toString('utf8');
  const lines = keyFile.trim().split(/\r?\n/u);
  if (lines.length !== 2 || !lines[0].startsWith('untrusted comment: ')) {
    throw new Error('The updater public key is not a minisign public key file.');
  }
  const decoded = decodeBase64(lines[1], 'The minisign public key');
  if (decoded.length !== 42 || !['Ed', 'ED'].includes(decoded.subarray(0, 2).toString('ascii'))) {
    throw new Error('The minisign public key has an invalid length or algorithm.');
  }
  return {
    keyId: decoded.subarray(2, 10),
    key: createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, decoded.subarray(10)]), format: 'der', type: 'spki' }),
  };
}

// 2026-11-09: a Tauri .sig file — and the latest.json signature field the plugin reads — holds the base64 of the
// minisign SignatureBox, not the box itself (tauri-plugin-updater 2.14.1 verify_signature decodes it first). Without
// this the release job rejected every signature the Tauri signer produced; the raw box stays accepted for test vectors.
function signatureBox(signature) {
  if (typeof signature !== 'string') throw new Error('The updater signature is missing.');
  const text = signature.trim();
  if (text.startsWith('untrusted comment: ')) return text;
  return decodeBase64(text, 'The updater signature').toString('utf8');
}

function decodeSignature(signature) {
  const lines = signatureBox(signature).trim().split(/\r?\n/u);
  if (lines.length !== 4 || !lines[0].startsWith('untrusted comment: ') || !lines[2].startsWith('trusted comment: ')) {
    throw new Error('The updater signature is not a four-line minisign SignatureBox.');
  }
  const primary = decodeBase64(lines[1], 'The minisign signature');
  const global = decodeBase64(lines[3], 'The minisign global signature');
  if (primary.length !== 74 || global.length !== 64) throw new Error('The minisign signature has an invalid length.');
  const algorithm = primary.subarray(0, 2).toString('ascii');
  if (!['ED', 'Ed'].includes(algorithm)) throw new Error(`Unsupported minisign signature algorithm: ${algorithm}`);
  return {
    algorithm,
    keyId: primary.subarray(2, 10),
    signature: primary.subarray(10),
    trustedComment: lines[2].slice('trusted comment: '.length),
    global,
  };
}

function checkEd25519(publicKey, message, signature, label) {
  let valid = false;
  try {
    valid = verifyEd25519(null, message, publicKey, signature);
  } catch {
    // A malformed signature is simply invalid; the generic error below is safe to show in CI.
  }
  if (!valid) throw new Error(`Updater ${label} verification failed.`);
}

// Mirrors minisign-verify 0.3.0 and tauri-plugin-updater 2.14.1, including the trusted-comment
// global signature and the signed version field introduced by the Tauri signer.
export function verifyUpdaterSignature({ installer, signature, publicKey: encodedPublicKey, version }) {
  if (!Buffer.isBuffer(installer) && !(installer instanceof Uint8Array)) throw new Error('Installer bytes are required.');
  if (typeof version !== 'string' || version === '') throw new Error('A release version is required for signature verification.');
  const publicKey = decodePublicKey(encodedPublicKey);
  const decoded = decodeSignature(signature);
  if (!publicKey.keyId.equals(decoded.keyId)) throw new Error('The updater signature was created with a different key id.');
  const message = decoded.algorithm === 'ED'
    ? createHash('blake2b512').update(installer).digest()
    : Buffer.from(installer);
  checkEd25519(publicKey.key, message, decoded.signature, 'artifact signature');
  const globalMessage = Buffer.concat([decoded.signature, Buffer.from(decoded.trustedComment, 'utf8')]);
  checkEd25519(publicKey.key, globalMessage, decoded.global, 'trusted-comment signature');
  const signedVersion = decoded.trustedComment.split('\t').find(field => field.startsWith('version:'))?.slice('version:'.length);
  if (!signedVersion) throw new Error('The updater trusted comment does not contain a signed version.');
  if (signedVersion.replace(/^v/u, '') !== version.replace(/^v/u, '')) {
    throw new Error(`The updater signature is for version ${signedVersion}, not ${version}.`);
  }
  return true;
}

export function buildUpdaterManifest(options) {
  const { version, url, signature, changelog, changelogRu, now } = options;
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error('A release version is required.');
  }
  if (typeof url !== 'string' || url.length === 0) {
    throw new Error('The installer download URL is required.');
  }
  if (typeof signature !== 'string' || signature.trim().length === 0) {
    throw new Error('The updater signature is empty; the signed build must produce <installer>.exe.sig.');
  }
  // Verification accepts raw minisign vectors; the updater wire format must fail closed.
  const encodedSignature = decodeBase64(signature, 'The updater signature').toString('base64');
  if (typeof changelogRu !== 'string') {
    throw new Error('CHANGELOG.ru.md is required for the updater release notes.');
  }
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error('A valid commit date is required for the updater publication date.');
  }
  const manifest = {
    version,
    notes: extractReleaseNotes(changelog, version, 'CHANGELOG.md'),
    notes_ru: extractReleaseNotes(changelogRu, version, 'CHANGELOG.ru.md'),
  };
  manifest.pub_date = now.toISOString();
  manifest.platforms = {
    [NSIS_X64]: { url, signature: encodedSignature },
    [GENERIC_X64]: { url, signature: encodedSignature },
  };
  return manifest;
}

function parseArgs(argv) {
  const known = ['version', 'url', 'installer', 'signature-file', 'pub-date', 'out', 'changelog', 'changelog-ru', 'config'];
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
  for (const key of ['version', 'url', 'installer', 'signature-file']) {
    if (!args[key]) throw new Error(`Missing --${key}.`);
  }
  const signature = decodeBase64(readFileSync(args['signature-file'], 'utf8'), 'The updater signature').toString('base64');
  const configPath = path.resolve(repoRoot, args.config ?? 'desktop/src-tauri/tauri.conf.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  verifyUpdaterSignature({
    installer: readFileSync(args.installer),
    signature,
    publicKey: config.plugins?.updater?.pubkey,
    version: args.version,
  });
  const changelogPath = path.resolve(repoRoot, args.changelog ?? 'CHANGELOG.md');
  const changelogRuPath = path.resolve(repoRoot, args['changelog-ru'] ?? 'CHANGELOG.ru.md');
  const manifest = buildUpdaterManifest({
    version: args.version,
    url: args.url,
    signature,
    changelog: readFileSync(changelogPath, 'utf8'),
    changelogRu: readFileSync(changelogRuPath, 'utf8'),
    now: new Date(args['pub-date'] ?? execFileSync('git', ['show', '-s', '--format=%cI', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim()),
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
