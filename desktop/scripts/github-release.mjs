// The release workflow's draft-only GitHub API path. All mutations use REST database IDs;
// lookup lists drafts as well as public releases, and never turns an API error into creation.
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

export class GitHubRelease {
  constructor({ repository, token, request = fetch }) {
    if (!/^[\w.-]+\/[\w.-]+$/u.test(repository) || !token) throw new Error('GitHub repository and token are required.');
    this.repository = repository;
    this.root = `https://api.github.com/repos/${repository}`;
    this.token = token;
    this.request = request;
  }

  async api(endpoint, { method = 'GET', json, bytes, binary = false, allowMissing = false } = {}) {
    const url = endpoint.startsWith('https://') ? endpoint : `${this.root}/${endpoint}`;
    const headers = {
      Authorization: `Bearer ${this.token}`,
      Accept: binary ? 'application/octet-stream' : 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (json !== undefined) headers['Content-Type'] = 'application/json';
    if (bytes !== undefined) headers['Content-Type'] = 'application/octet-stream';
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

  async list(endpoint) {
    const all = [];
    for (let page = 1; ; page++) {
      const entries = await this.api(`${endpoint}?per_page=100&page=${page}`);
      all.push(...entries);
      if (entries.length < 100) return all;
    }
  }

  assertDraft(release, tag) {
    if (!Number.isSafeInteger(release.id) || release.id <= 0 || release.tag_name !== tag) {
      throw new Error('The release database ID or tag does not match.');
    }
    if (release.draft !== true) {
      throw new Error('This release is already published. Releases must be published only by pushing a tag (not in the UI); use a new version.');
    }
    return release;
  }

  async draft(id, tag) {
    if (!/^\d+$/u.test(String(id))) throw new Error('A numeric release database ID is required.');
    return this.assertDraft(await this.api(`releases/${id}`), tag);
  }

  async prepare(plan, { version, commit, notes }) {
    const matches = (await this.list('releases')).filter(release => release.tag_name === plan.tag);
    if (matches.length > 1) throw new Error(`Multiple releases already exist for ${plan.tag}; resolve the duplicate drafts first.`);
    if (plan.dryRun) {
      const tag = await this.api(`git/ref/tags/${encodeURIComponent(plan.tag)}`, { allowMissing: true });
      if (tag !== null) throw new Error('The dry-run tag already exists; refusing to use it.');
    }
    if (matches.length === 1) return this.assertDraft(matches[0], plan.tag);
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
    if (asset.name !== file.name || asset.state !== 'uploaded' || asset.size !== file.bytes.length) return false;
    if (asset.digest != null && asset.digest !== digest(file.bytes)) return false;
    const remote = await this.api(`releases/assets/${asset.id}`, { binary: true });
    return remote.equals(file.bytes);
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
    await this.api(url.href, { method: 'POST', bytes: file.bytes });
    const uploaded = (await this.assets(id)).filter(asset => asset.name === file.name);
    if (uploaded.length !== 1 || !await this.matches(uploaded[0], file)) {
      throw new Error(`${file.name}: uploaded asset name, state, size, SHA-256 digest or bytes do not match.`);
    }
    console.log(`${file.name}: verified asset ${uploaded[0].id}, ${uploaded[0].size} bytes.`);
    return uploaded[0];
  }

  installerUrl(tag, asset) {
    // latest.json is built once on Windows. Prove that its planned URL is exactly
    // the URL derived from GitHub's actual asset name, rather than rewriting it here.
    const url = `https://github.com/${this.repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(asset.name)}`;
    if (asset.browser_download_url !== url) throw new Error('GitHub returned an unexpected installer download URL.');
    return url;
  }

  async upload(id, plan, inputs) {
    await this.draft(id, plan.tag);
    // A retry may replace an expired build. Remove even an old, identical manifest
    // first so latest.json is always the last asset uploaded to the hidden draft.
    for (const asset of (await this.assets(id)).filter(asset => asset.name === 'latest.json')) {
      await this.removeAsset(id, plan.tag, asset);
    }
    for (const file of inputs.files) {
      const asset = await this.ensureAsset(id, plan.tag, file);
      if (file.name === inputs.installerName) {
        const url = this.installerUrl(plan.tag, asset);
        if (Object.values(inputs.manifest.platforms).some(platform => platform.url !== url)) {
          throw new Error('latest.json does not point to the actual installer URL from the GitHub API.');
        }
      }
    }
    await this.ensureAsset(id, plan.tag, inputs.manifestFile);
  }

  async publish(id, plan, inputs) {
    if (plan.dryRun) throw new Error('A dry run must never publish a release.');
    await this.draft(id, plan.tag);
    const assets = await this.assets(id);
    for (const file of [...inputs.files, inputs.manifestFile]) {
      const found = assets.filter(asset => asset.name === file.name);
      if (found.length !== 1 || !await this.matches(found[0], file)) throw new Error(`Cannot publish: ${file.name} is not verified.`);
    }
    await this.draft(id, plan.tag);
    const release = await this.api(`releases/${id}`, {
      method: 'PATCH', json: { draft: false, prerelease: plan.prerelease, make_latest: String(!plan.prerelease) },
    });
    if (release.draft !== false) throw new Error('GitHub did not publish the completed draft.');
    console.log(release.html_url);
  }

  async cleanup(id, plan) {
    if (!plan.dryRun) throw new Error('Only dry-run drafts may be deleted by cleanup.');
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

export async function verifyPublicManifest({ repository, plan, bytes, request = fetch, wait = delay }) {
  const urls = [`https://github.com/${repository}/releases/download/${encodeURIComponent(plan.tag)}/latest.json`];
  if (!plan.prerelease) urls.push(`https://github.com/${repository}/releases/latest/download/latest.json`);
  for (const url of urls) {
    let failure;
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const response = await request(url, { signal: AbortSignal.timeout(30000), headers: { 'Cache-Control': 'no-cache' } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        if (!Buffer.from(await response.arrayBuffer()).equals(bytes)) throw new Error('different manifest bytes');
        failure = null;
        break;
      } catch (error) {
        failure = error;
        if (attempt < 5) await wait(5000);
      }
    }
    if (failure) throw new Error(`Public updater endpoint ${url}: ${failure.message}`);
    console.log(`Verified public updater endpoint: ${url}`);
  }
}

async function main() {
  const env = process.env;
  const plan = releasePlan({ eventName: env.GITHUB_EVENT_NAME, dryRun: env.DRY_RUN, refType: env.GITHUB_REF_TYPE,
    refName: env.GITHUB_REF_NAME, version: env.VERSION, runId: env.GITHUB_RUN_ID });
  if (env.RELEASE_TAG !== plan.tag) throw new Error('Release tag does not match the validated release plan.');
  const action = process.argv[2];
  if (action === 'verify-public') {
    if (plan.dryRun) throw new Error('Dry runs have no public endpoints.');
    await verifyPublicManifest({ repository: env.GITHUB_REPOSITORY, plan, bytes: readFileSync('desktop/release/latest.json') });
    return;
  }
  if (['verify', 'upload', 'publish'].includes(action)) {
    const directory = 'desktop/release';
    const config = JSON.parse(readFileSync('desktop/src-tauri/tauri.conf.json', 'utf8'));
    const verified = verifyDesktopManifest({ directory, version: env.VERSION,
      url: `https://github.com/${env.GITHUB_REPOSITORY}/releases/download/${plan.tag}/Deckmate.Setup.${env.VERSION}.exe`,
      publicKey: config.plugins?.updater?.pubkey, pubDate: env.PUB_DATE,
      changelog: readFileSync('CHANGELOG.md', 'utf8'), changelogRu: readFileSync('CHANGELOG.ru.md', 'utf8') });
    if (action === 'verify') return;
    const [artifact] = JSON.parse(readFileSync('release-input/npm/package-info.json', 'utf8'));
    if (path.basename(artifact.filename) !== artifact.filename) throw new Error('Invalid npm artifact filename.');
    const inputs = { ...verified, files: [localFile(`release-input/npm/${artifact.filename}`), verified.installer,
      localFile(`${directory}/Deckmate-${env.VERSION}-win-x64.zip`)] };
    const client = new GitHubRelease({ repository: env.GITHUB_REPOSITORY, token: env.GH_TOKEN });
    await client[action](env.RELEASE_ID, plan, inputs);
    return;
  }
  const client = new GitHubRelease({ repository: env.GITHUB_REPOSITORY, token: env.GH_TOKEN });
  if (action === 'prepare') {
    const release = await client.prepare(plan, { version: env.VERSION, commit: env.GITHUB_SHA,
      notes: readFileSync('release-input/npm/release-notes.md', 'utf8') });
    appendFileSync(env.GITHUB_OUTPUT, `release_id=${release.id}\n`);
  } else if (action === 'cleanup') {
    await client.cleanup(env.RELEASE_ID, plan);
  } else {
    throw new Error(`Unknown release action: ${action}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(`github-release: ${error.message}`);
    process.exitCode = 1;
  });
}
