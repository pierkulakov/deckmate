// Release mutations use REST database IDs and are restricted to drafts. Published
// releases can only be verified; lookup never turns an API error into creation.
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { buildUpdaterManifest, verifyUpdaterSignature } from './updater-manifest.mjs';

export function releasePlan({ eventName, dryRun, refType, refName, version, runId }) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) throw new Error('Invalid release version.');
  if (eventName === 'workflow_dispatch' && dryRun === 'true' && /^\d+$/u.test(runId)) {
    return { dryRun: true, tag: `v${version}-dryrun.${runId}`, prerelease: true };
  }
  if (eventName === 'push' && dryRun === 'false' && refType === 'tag' && refName === `v${version}`) {
    return { dryRun: false, tag: refName, prerelease: version.includes('-') };
  }
  throw new Error('Releases are only published by pushing a matching version tag; workflow_dispatch requires dry_run=true.');
}

const digest = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const downloadUrl = (repository, tag, name) =>
  `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`;

function contentType(name) {
  const types = { '.json': 'application/json', '.tgz': 'application/gzip', '.zip': 'application/zip' };
  return types[path.extname(name).toLowerCase()] ?? 'application/octet-stream';
}

function matchesMetadata(asset, file) {
  return asset.name === file.name && asset.state === 'uploaded' && asset.size === file.bytes.length
    && (asset.digest == null || asset.digest === digest(file.bytes));
}

function verifiedAsset(asset, file) {
  return { id: asset.id, name: file.name, sha256: digest(file.bytes) };
}

// The status checks the main ruleset requires. Each summarizes every unit and browser job of CI on both systems.
export const REQUIRED_CHECKS = ['checks (ubuntu-latest)', 'checks (windows-latest)'];

export class GitHubRelease {
  constructor({ repository, token, request = fetch }) {
    if (!/^[\w.-]+\/[\w.-]+$/u.test(repository) || !token) throw new Error('GitHub repository and token are required.');
    this.repository = repository;
    this.root = `https://api.github.com/repos/${repository}`;
    this.token = token;
    this.request = request;
  }

  async api(endpoint, { method = 'GET', json, bytes, mediaType, binary = false, allowMissing = false } = {}) {
    const url = endpoint.startsWith('https://') ? endpoint : `${this.root}/${endpoint}`;
    const headers = {
      Authorization: `Bearer ${this.token}`,
      Accept: binary ? 'application/octet-stream' : 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (json !== undefined) headers['Content-Type'] = 'application/json';
    if (bytes !== undefined) headers['Content-Type'] = mediaType ?? 'application/octet-stream';
    const response = await this.request(url, {
      method, headers, body: bytes ?? (json === undefined ? undefined : JSON.stringify(json)),
      signal: AbortSignal.timeout(300000),
    });
    if (allowMissing && response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub ${method} ${url}: HTTP ${response.status}: ${await response.text()}`);
    if (response.status === 204) return null;
    if (binary) return Buffer.from(await response.arrayBuffer());
    return response.json();
  }

  // The release workflow does not run the test suite again (2026-11-10): it ships a commit only after GitHub Actions
  // reported every required check green on that exact commit. A tag pushed right after the merge waits for CI on main.
  async requireGreenChecks(commit, { names = REQUIRED_CHECKS, wait = delay, now = Date.now,
    intervalMs = 30000, timeoutMs = 30 * 60000 } = {}) {
    if (!/^[0-9a-f]{40}$/u.test(commit)) throw new Error('A full commit SHA is required to check CI.');
    const deadline = now() + timeoutMs;
    for (;;) {
      const waiting = [];
      for (const name of names) {
        const { check_runs: runs } = await this.api(`commits/${commit}/check-runs?check_name=${encodeURIComponent(name)}&per_page=100`);
        const own = runs.filter(run => run.name === name && run.app?.slug === 'github-actions');
        if (own.some(run => run.status === 'completed' && run.conclusion === 'success')) continue;
        const finished = own.filter(run => run.status === 'completed');
        if (own.length && finished.length === own.length) {
          throw new Error(`CI check "${name}" finished with ${finished.map(run => run.conclusion).join(', ')} on ${commit}; release only a commit with green CI.`);
        }
        waiting.push(name);
      }
      if (!waiting.length) {
        console.log(`CI is green on ${commit}: ${names.join(', ')}.`);
        return;
      }
      if (now() >= deadline) {
        throw new Error(`CI did not report ${waiting.join(', ')} on ${commit} in time; push the commit to main and wait for CI.`);
      }
      console.log(`Waiting for CI on ${commit}: ${waiting.join(', ')}.`);
      await wait(intervalMs);
    }
  }

  async list(endpoint) {
    const all = [];
    for (let page = 1; ; page++) {
      const entries = await this.api(`${endpoint}?per_page=100&page=${page}`);
      all.push(...entries);
      if (entries.length < 100) return all;
    }
  }

  assertRelease(release, tag) {
    if (!Number.isSafeInteger(release.id) || release.id <= 0 || release.tag_name !== tag) {
      throw new Error('The release database ID or tag does not match.');
    }
    return release;
  }

  assertDraft(release, tag) {
    this.assertRelease(release, tag);
    if (release.draft !== true) {
      throw new Error('This release is already published. Only verification is allowed; changed assets require a new version.');
    }
    return release;
  }

  async release(id, tag) {
    if (!/^\d+$/u.test(String(id))) throw new Error('A numeric release database ID is required.');
    return this.assertRelease(await this.api(`releases/${id}`), tag);
  }

  async draft(id, tag) {
    return this.assertDraft(await this.release(id, tag), tag);
  }

  async findRelease(tag) {
    const matches = (await this.list('releases')).filter(release => release.tag_name === tag);
    if (matches.length > 1) throw new Error(`Multiple releases already exist for ${tag}; resolve the duplicates first.`);
    return matches.length === 0 ? null : this.assertRelease(matches[0], tag);
  }

  async prepare(plan, { version, commit, notes }, inputs) {
    const existing = await this.findRelease(plan.tag);
    if (plan.dryRun) {
      const tag = await this.api(`git/ref/tags/${encodeURIComponent(plan.tag)}`, { allowMissing: true });
      if (tag !== null) throw new Error('The dry-run tag already exists; refusing to use it.');
    }
    if (existing) {
      if (existing.draft === true || plan.dryRun) return this.assertDraft(existing, plan.tag);
      await this.verifyPublished(existing.id, plan, inputs);
      console.log('The identical release is already published; only public verification remains.');
      return existing;
    }
    const release = await this.api('releases', {
      method: 'POST', json: {
        tag_name: plan.tag, target_commitish: commit, name: `Deckmate ${version}${plan.dryRun ? ' (dry run)' : ''}`,
        body: notes, draft: true, prerelease: plan.prerelease, make_latest: 'false',
      },
    });
    return this.assertDraft(release, plan.tag);
  }

  async assets(id) {
    return this.list(`releases/${id}/assets`);
  }

  async matches(asset, file) {
    if (!matchesMetadata(asset, file)) return false;
    const remote = await this.api(`releases/assets/${asset.id}`, { binary: true });
    return remote.length === file.bytes.length && digest(remote) === digest(file.bytes) && remote.equals(file.bytes);
  }

  async removeAsset(id, tag, asset) {
    await this.draft(id, tag);
    await this.api(`releases/assets/${asset.id}`, { method: 'DELETE' });
  }

  async ensureAsset(id, tag, file) {
    const existing = (await this.assets(id)).filter(asset => asset.name === file.name);
    if (existing.length === 1 && await this.matches(existing[0], file)) {
      console.log(`${file.name}: identical uploaded bytes; keeping asset ${existing[0].id}.`);
      return existing[0];
    }
    for (const asset of existing) await this.removeAsset(id, tag, asset);
    const release = await this.draft(id, tag);
    const url = new URL(release.upload_url.split('{')[0]);
    if (url.origin !== 'https://uploads.github.com' || url.pathname !== `/repos/${this.repository}/releases/${id}/assets`) {
      throw new Error('Unexpected GitHub asset upload URL.');
    }
    url.searchParams.set('name', file.name);
    await this.api(url.href, { method: 'POST', bytes: file.bytes, mediaType: contentType(file.name) });
    const uploaded = (await this.assets(id)).filter(asset => asset.name === file.name);
    if (uploaded.length !== 1 || !await this.matches(uploaded[0], file)) {
      throw new Error(`${file.name}: uploaded asset name, state, size, SHA-256 digest or bytes do not match.`);
    }
    console.log(`${file.name}: verified asset ${uploaded[0].id}, ${uploaded[0].size} bytes.`);
    return uploaded[0];
  }

  assertInstallerUrl(tag, asset, manifest) {
    // Draft browser_download_url uses untagged-<hash>; the updater needs the
    // eventual public URL, derived from the actual API asset name instead.
    const url = downloadUrl(this.repository, tag, asset.name);
    if (['windows-x86_64', 'windows-x86_64-nsis'].some(platform => manifest.platforms[platform]?.url !== url)) {
      throw new Error('latest.json does not point to the expected public installer URL in both Windows platforms.');
    }
  }

  async verifyAssets(id, plan, inputs, { published = false, verifiedAssets } = {}) {
    const context = published ? 'Published release mismatch (use a new version)' : 'Cannot publish';
    if (!inputs) throw new Error(`${context}: verified local release inputs are required.`);
    const files = [...inputs.files, inputs.manifestFile];
    const assets = await this.assets(id);
    const extra = assets.filter(asset => !files.some(file => file.name === asset.name));
    if (extra.length) throw new Error(`${context}: unexpected assets: ${extra.map(asset => asset.name).join(', ')}.`);
    const verified = [];
    for (const file of files) {
      const found = assets.filter(asset => asset.name === file.name);
      if (found.length !== 1) throw new Error(`${context}: expected exactly one ${file.name}.`);
      const asset = found[0];
      // Asset bytes cannot be replaced under the same REST ID. The upload receipt
      // lets the final gate detect replacements without downloading again after npm.
      const receipt = verifiedAssets?.find(entry => entry.name === file.name);
      const matches = verifiedAssets
        ? matchesMetadata(asset, file) && receipt?.id === asset.id && receipt.sha256 === digest(file.bytes)
        : await this.matches(asset, file);
      if (!matches) throw new Error(`${context}: ${file.name} name, state, size, SHA-256 or verified asset ID differs.`);
      if (file.name === inputs.installerName) this.assertInstallerUrl(plan.tag, asset, inputs.manifest);
      if (published && [inputs.installerName, inputs.manifestFile.name].includes(file.name)
        && asset.browser_download_url !== downloadUrl(this.repository, plan.tag, asset.name)) {
        throw new Error(`${context}: unexpected public download URL for ${file.name}.`);
      }
      verified.push(verifiedAsset(asset, file));
    }
    return verified;
  }

  async verifyPublished(id, plan, inputs) {
    const release = await this.release(id, plan.tag);
    if (release.draft !== false || release.prerelease !== plan.prerelease) {
      throw new Error('Published release mismatch: draft/prerelease status differs from the release plan.');
    }
    await this.verifyAssets(id, plan, inputs, { published: true });
  }

  async upload(id, plan, inputs) {
    await this.draft(id, plan.tag);
    // A retry may replace an expired build. Remove even an old, identical manifest
    // first so latest.json is always the last asset uploaded to the hidden draft.
    for (const asset of (await this.assets(id)).filter(asset => asset.name === 'latest.json')) {
      await this.removeAsset(id, plan.tag, asset);
    }
    const verifiedAssets = [];
    for (const file of [...inputs.files, inputs.manifestFile]) {
      const asset = await this.ensureAsset(id, plan.tag, file);
      if (file.name === inputs.installerName) this.assertInstallerUrl(plan.tag, asset, inputs.manifest);
      verifiedAssets.push(verifiedAsset(asset, file));
    }
    return this.verifyAssets(id, plan, inputs, { verifiedAssets });
  }

  async assertTagCommit(tag, commit) {
    if (!commit) throw new Error('GITHUB_SHA is required before publication.');
    const ref = await this.api(`git/ref/tags/${encodeURIComponent(tag)}`, { allowMissing: true });
    let object = ref?.object;
    const seen = new Set();
    while (object?.type === 'tag' && !seen.has(object.sha)) {
      seen.add(object.sha);
      object = (await this.api(`git/tags/${encodeURIComponent(object.sha)}`)).object;
    }
    if (object?.type !== 'commit' || object.sha !== commit) {
      throw new Error(`Tag ${tag} no longer points to GITHUB_SHA (${commit}); refusing to publish.`);
    }
  }

  async publish(id, plan, inputs, { commit, verifiedAssets } = {}) {
    if (plan.dryRun) throw new Error('A dry run must never publish a release.');
    if (!Array.isArray(verifiedAssets)) throw new Error('The verified draft asset receipt is required before publication.');
    await this.draft(id, plan.tag);
    await this.verifyAssets(id, plan, inputs, { verifiedAssets });
    await this.draft(id, plan.tag);
    await this.assertTagCommit(plan.tag, commit);
    const release = await this.api(`releases/${id}`, {
      method: 'PATCH', json: { draft: false, prerelease: plan.prerelease, make_latest: String(!plan.prerelease) },
    });
    if (release.draft !== false) throw new Error('GitHub did not publish the completed draft.');
    await this.verifyAssets(id, plan, inputs, { published: true, verifiedAssets });
    console.log(release.html_url);
  }

  async cleanup(id, plan) {
    if (!plan.dryRun || !/-dryrun\.\d+$/u.test(plan.tag)) throw new Error('Only dry-run drafts may be deleted by cleanup.');
    if (!id) {
      const release = await this.findRelease(plan.tag);
      if (!release) return;
      id = release.id;
    }
    await this.draft(id, plan.tag);
    await this.api(`releases/${id}`, { method: 'DELETE' });
  }
}

function localFile(file) {
  return { name: path.basename(file), bytes: readFileSync(file) };
}

export function verifyDesktopManifest({ directory, version, url, publicKey, changelog, changelogRu, pubDate }) {
  const installerName = `Deckmate.Setup.${version}.exe`;
  const installer = localFile(path.join(directory, installerName));
  const signature = readFileSync(path.join(directory, `${installerName}.sig`), 'utf8').trim();
  const manifestFile = localFile(path.join(directory, 'latest.json'));
  const manifest = JSON.parse(manifestFile.bytes.toString('utf8'));
  const expected = buildUpdaterManifest({ version, url, signature, changelog, changelogRu, now: new Date(pubDate) });
  if (!isDeepStrictEqual(manifest, expected)) throw new Error('The downloaded latest.json does not match the signed release inputs.');
  verifyUpdaterSignature({ installer: installer.bytes, signature, publicKey, version });
  return { installerName, installer, manifest, manifestFile };
}

export async function verifyPublicRelease({ repository, plan, installer, manifestFile, request = fetch, wait = delay }) {
  if (plan.dryRun) throw new Error('Dry runs have no public endpoints.');
  const downloads = [installer, manifestFile].map(file => ({ url: downloadUrl(repository, plan.tag, file.name), file }));
  if (!plan.prerelease) downloads.push({ url: `https://github.com/${repository}/releases/latest/download/latest.json`, file: manifestFile });
  for (const { url, file } of downloads) {
    const expectedDigest = digest(file.bytes);
    let failure;
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const response = await request(url, { signal: AbortSignal.timeout(30000), headers: { 'Cache-Control': 'no-cache' } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = Buffer.from(await response.arrayBuffer());
        if (file === installer && (bytes.length !== file.bytes.length || digest(bytes) !== expectedDigest)) {
          throw new Error('installer size or SHA-256 differs from the verified build');
        }
        if (file === manifestFile && !bytes.equals(file.bytes)) throw new Error('different manifest bytes');
        failure = null;
        break;
      } catch (error) {
        failure = error;
        if (attempt < 5) await wait(5000);
      }
    }
    if (failure) throw new Error(`Public release endpoint ${url}: ${failure.message}`);
    console.log(`Verified public release endpoint: ${url}`);
  }
}

async function main() {
  const env = process.env;
  const plan = releasePlan({ eventName: env.GITHUB_EVENT_NAME, dryRun: env.DRY_RUN, refType: env.GITHUB_REF_TYPE,
    refName: env.GITHUB_REF_NAME, version: env.VERSION, runId: env.GITHUB_RUN_ID });
  if (env.RELEASE_TAG !== plan.tag) throw new Error('Release tag does not match the validated release plan.');
  const action = process.argv[2];
  if (action === 'require-ci') {
    await new GitHubRelease({ repository: env.GITHUB_REPOSITORY, token: env.GH_TOKEN }).requireGreenChecks(env.GITHUB_SHA);
    return;
  }
  if (action === 'cleanup') {
    const client = new GitHubRelease({ repository: env.GITHUB_REPOSITORY, token: env.GH_TOKEN });
    await client.cleanup(env.RELEASE_ID, plan);
    return;
  }
  if (['verify', 'prepare', 'upload', 'publish', 'verify-public'].includes(action)) {
    const directory = 'desktop/release';
    const config = JSON.parse(readFileSync('desktop/src-tauri/tauri.conf.json', 'utf8'));
    const verified = verifyDesktopManifest({ directory, version: env.VERSION,
      url: downloadUrl(env.GITHUB_REPOSITORY, plan.tag, `Deckmate.Setup.${env.VERSION}.exe`),
      publicKey: config.plugins?.updater?.pubkey, pubDate: env.PUB_DATE,
      changelog: readFileSync('CHANGELOG.md', 'utf8'), changelogRu: readFileSync('CHANGELOG.ru.md', 'utf8') });
    if (action === 'verify') return;
    const [artifact] = JSON.parse(readFileSync('release-input/npm/package-info.json', 'utf8'));
    if (path.basename(artifact.filename) !== artifact.filename) throw new Error('Invalid npm artifact filename.');
    const inputs = { ...verified, files: [localFile(`release-input/npm/${artifact.filename}`), verified.installer,
      localFile(`${directory}/Deckmate-${env.VERSION}-win-x64.zip`)] };
    const client = new GitHubRelease({ repository: env.GITHUB_REPOSITORY, token: env.GH_TOKEN });
    if (action === 'prepare') {
      const release = await client.prepare(plan, { version: env.VERSION, commit: env.GITHUB_SHA,
        notes: readFileSync('release-input/npm/release-notes.md', 'utf8') }, inputs);
      appendFileSync(env.GITHUB_OUTPUT, `release_id=${release.id}\npublished=${!release.draft}\n`);
    } else if (action === 'upload') {
      const verifiedAssets = await client.upload(env.RELEASE_ID, plan, inputs);
      appendFileSync(env.GITHUB_OUTPUT, `verified_assets=${JSON.stringify(verifiedAssets)}\n`);
    } else if (action === 'publish') {
      await client.publish(env.RELEASE_ID, plan, inputs, { commit: env.GITHUB_SHA,
        verifiedAssets: JSON.parse(env.VERIFIED_ASSETS ?? 'null') });
    } else {
      await client.verifyPublished(env.RELEASE_ID, plan, inputs);
      await verifyPublicRelease({ repository: env.GITHUB_REPOSITORY, plan, installer: verified.installer,
        manifestFile: verified.manifestFile });
    }
    return;
  }
  throw new Error(`Unknown release action: ${action}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(`github-release: ${error.message}`);
    process.exitCode = 1;
  });
}
