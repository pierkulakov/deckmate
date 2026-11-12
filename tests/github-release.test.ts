import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';

type Plan = { dryRun: boolean; tag: string; prerelease: boolean };
type File = { name: string; bytes: Buffer };
type Inputs = { files: File[]; installerName: string; manifestFile: File; manifest: { platforms: Record<string, { url: string }> } };
type Release = { id: number; node_id: string; tag_name: string; draft: boolean; prerelease: boolean; upload_url: string };
type Asset = { id: number; name: string; state: string; size: number; digest?: string | null; browser_download_url: string };
type VerifiedAsset = { id: number; name: string; sha256: string };
type GitObject = { type: string; sha: string };
type Client = {
  prepare: (plan: Plan, options: { version: string; commit: string; notes: string }, inputs?: Inputs) => Promise<Release>;
  upload: (id: number, plan: Plan, inputs: Inputs) => Promise<VerifiedAsset[]>;
  publish: (id: number, plan: Plan, inputs: Inputs, options?: { commit: string; verifiedAssets: VerifiedAsset[] }) => Promise<void>;
  verifyPublished: (id: number, plan: Plan, inputs: Inputs) => Promise<void>;
  cleanup: (id: number | string | undefined, plan: Plan) => Promise<void>;
  requireGreenChecks: (commit: string, options?: { wait?: (ms: number) => Promise<void>; now?: () => number;
    intervalMs?: number; timeoutMs?: number }) => Promise<void>;
};
const require = createRequire(import.meta.url);
const { GitHubRelease, REQUIRED_CHECKS, releasePlan, verifyDesktopManifest, verifyPublicRelease } = require('../desktop/scripts/github-release.mjs') as {
  REQUIRED_CHECKS: string[];
  GitHubRelease: new (options: { repository: string; token: string; request: (url: string, init?: RequestInit) => Promise<Response> }) => Client;
  releasePlan: (options: { eventName: string; dryRun: string; refType: string; refName: string; version: string; runId: string }) => Plan;
  verifyDesktopManifest: (options: { directory: string; version: string; url: string; publicKey: string;
    changelog: string; changelogRu: string; pubDate: string }) => { manifestFile: File };
  verifyPublicRelease: (options: { repository: string; plan: Plan; installer: File; manifestFile: File;
    request: (url: string, init?: RequestInit) => Promise<Response>; wait: (ms: number) => Promise<void> }) => Promise<void>;
};

const repository = 'owner/deckmate';
const stable: Plan = { dryRun: false, tag: 'v0.6.0', prerelease: false };
const releaseOptions = { version: '0.6.0', commit: '0123456789abcdef0123456789abcdef01234567', notes: 'Release notes' };
const hash = (bytes: Buffer) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
function inputs(tag = stable.tag, installerName = 'Deckmate.Setup.0.6.0.exe'): Inputs {
  const manifest = { platforms: {
    'windows-x86_64': { url: `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(installerName)}` },
    'windows-x86_64-nsis': { url: `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(installerName)}` },
  } };
  return {
    installerName, manifest,
    files: ['deckmate-0.6.0.tgz', installerName, 'Deckmate-0.6.0-win-x64.zip'].map(name => ({ name, bytes: Buffer.from(name) })),
    manifestFile: { name: 'latest.json', bytes: Buffer.from(JSON.stringify(manifest)) },
  };
}

// Draft URLs are temporary even when the tag already exists; only PATCH makes them public.
// No GitHub connection or credential is used by these lifecycle regressions.
function github(plan = stable) {
  const release: Release = { id: 439165688, node_id: 'RE_graphql_is_not_a_database_id', tag_name: plan.tag, draft: true,
    prerelease: plan.prerelease,
    upload_url: `https://uploads.github.com/repos/${repository}/releases/439165688/assets{?name,label}` };
  const state = { releases: [] as Release[], assets: [] as Asset[], bytes: new Map<number, Buffer>(),
    badUploadDigest: false, badPublishedUrl: '', failPublish: false, losePrepareResponse: false, losePublishResponse: false,
    tagObject: (plan.dryRun ? null : { type: 'commit', sha: releaseOptions.commit }) as GitObject | null,
    annotatedTags: new Map<string, GitObject>(), nextId: 1 };
  const add = (file: File, overrides: Partial<Asset> = {}) => {
    const asset = { id: state.nextId++, name: file.name, state: 'uploaded', size: file.bytes.length, digest: hash(file.bytes),
      browser_download_url: `https://github.com/${repository}/releases/download/${release.draft ? 'untagged-abc123' : plan.tag}/${encodeURIComponent(file.name)}`, ...overrides };
    state.assets.push(asset);
    state.bytes.set(asset.id, file.bytes);
    return asset;
  };
  const request = vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const endpoint = url.pathname.replace(`/repos/${repository}/`, '');
    const method = init.method ?? 'GET';
    if (url.hostname === 'github.com') {
      expect(new Headers(init.headers).has('Authorization')).toBe(false);
      if (release.draft) return json({ message: 'Not Found' }, 404);
      const asset = state.assets.find(entry => entry.browser_download_url === input
        || (input === `https://github.com/${repository}/releases/latest/download/latest.json` && entry.name === 'latest.json'));
      return asset ? new Response(new Uint8Array(state.bytes.get(asset.id)!)) : json({}, 404);
    }
    if (endpoint === 'releases' && method === 'GET') return json(state.releases);
    if (endpoint.startsWith('git/ref/tags/') && method === 'GET') {
      return state.tagObject ? json({ object: state.tagObject }) : json({ message: 'Not Found' }, 404);
    }
    if (endpoint.startsWith('git/tags/') && method === 'GET') {
      const object = state.annotatedTags.get(endpoint.split('/').at(-1)!);
      return object ? json({ object }) : json({}, 404);
    }
    if (endpoint === 'releases' && method === 'POST') {
      const body = JSON.parse(String(init.body));
      expect(body).toMatchObject({ draft: true, make_latest: 'false', tag_name: plan.tag });
      state.releases.push(release);
      if (state.losePrepareResponse) throw new Error('Lost create response');
      return json(release, 201);
    }
    if (endpoint === `releases/${release.id}`) {
      if (method === 'GET') return json(release);
      if (method === 'DELETE') {
        state.releases = [];
        return new Response(null, { status: 204 });
      }
      if (method === 'PATCH') {
        if (state.failPublish) return json({ message: 'Unavailable' }, 503);
        Object.assign(release, JSON.parse(String(init.body)));
        for (const asset of state.assets) {
          asset.browser_download_url = `https://github.com/${repository}/releases/download/${plan.tag}/${encodeURIComponent(asset.name)}`;
          if (asset.name === state.badPublishedUrl) asset.browser_download_url += '-renamed';
        }
        if (state.losePublishResponse) throw new Error('Lost publish response');
        return json({ ...release, html_url: 'https://github.com/owner/deckmate/releases/tag/v0.6.0' });
      }
    }
    if (endpoint === `releases/${release.id}/assets`) {
      if (method === 'GET') return json(state.assets);
      if (method === 'POST' && url.hostname === 'uploads.github.com') {
        const file = { name: url.searchParams.get('name')!, bytes: Buffer.from(init.body as unknown as Uint8Array) };
        const asset = add(file);
        if (state.badUploadDigest) asset.digest = 'sha256:incorrect';
        return json(asset, 201);
      }
    }
    if (endpoint.startsWith('releases/assets/')) {
      const id = Number(endpoint.split('/').at(-1));
      if (method === 'DELETE') {
        state.assets = state.assets.filter(asset => asset.id !== id);
        return new Response(null, { status: 204 });
      }
      if (method === 'GET') {
        expect(init.headers).toMatchObject({ Accept: 'application/octet-stream' });
        return new Response(new Uint8Array(state.bytes.get(id)!));
      }
    }
    throw new Error(`Unexpected ${method} ${input}`);
  });
  const client = new GitHubRelease({ repository, token: 'local-test-token', request });
  const mutations = () => request.mock.calls.filter(([, init]) => (init?.method ?? 'GET') !== 'GET');
  return { client, state, request, release, add, mutations };
}

describe('release event boundary', () => {
  const base = { eventName: 'push', dryRun: 'false', refType: 'tag', refName: 'v0.6.0', version: '0.6.0', runId: '1234' };
  it('allows publication only from the matching tag push', () => {
    expect(releasePlan(base)).toEqual(stable);
    for (const change of [{ refType: 'branch' }, { refName: 'v0.5.0' }, { eventName: 'workflow_dispatch' },
      { eventName: 'pull_request' }, { dryRun: 'true' }]) {
      expect(() => releasePlan({ ...base, ...change })).toThrow('only published by pushing');
    }
  });
  it('uses a run-scoped tag for manual dry runs, including on a tag ref', () => {
    expect(releasePlan({ ...base, eventName: 'workflow_dispatch', dryRun: 'true' }))
      .toEqual({ dryRun: true, prerelease: true, tag: 'v0.6.0-dryrun.1234' });
  });
});

describe('downloaded desktop artifact verification', () => {
  const folders: string[] = [];
  afterEach(() => {
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
  });

  function fixture() {
    const publicFixture = JSON.parse(readFileSync(new URL('./fixtures/updater-public.json', import.meta.url), 'utf8')) as {
      payloadBase64: string; signature: string; publicKeyFile: string; otherPublicKeyFile: string;
    };
    const tempBase = existsSync(path.join(tmpdir(), 'opencode')) ? path.join(tmpdir(), 'opencode') : tmpdir();
    const directory = mkdtempSync(path.join(tempBase, 'release-inputs-'));
    folders.push(directory);
    const url = 'https://github.com/owner/deckmate/releases/download/v2.0.0/Deckmate.Setup.2.0.0.exe';
    const pubDate = '2026-11-09T12:00:00.000Z';
    const options = { directory, version: '2.0.0', url, pubDate,
      publicKey: Buffer.from(publicFixture.publicKeyFile).toString('base64'),
      changelog: '## [2.0.0] - 2026-11-09\n\n- English notes.\n',
      changelogRu: '## [2.0.0] - 2026-11-09\n\n- Русские заметки.\n' };
    const signature = Buffer.from(publicFixture.signature).toString('base64');
    const manifest = { version: '2.0.0', notes: '- English notes.', notes_ru: '- Русские заметки.', pub_date: pubDate,
      platforms: { 'windows-x86_64-nsis': { url, signature }, 'windows-x86_64': { url, signature } } };
    writeFileSync(path.join(directory, 'Deckmate.Setup.2.0.0.exe'), Buffer.from(publicFixture.payloadBase64, 'base64'));
    writeFileSync(path.join(directory, 'Deckmate.Setup.2.0.0.exe.sig'), signature);
    const manifestPath = path.join(directory, 'latest.json');
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    return { options, manifest, manifestPath, publicFixture };
  }

  it('verifies the installer with the configured key without rewriting the manifest', () => {
    const { options, manifestPath } = fixture();
    const before = readFileSync(manifestPath);
    expect(verifyDesktopManifest(options).manifestFile.bytes).toEqual(before);
    expect(readFileSync(manifestPath)).toEqual(before);
  });

  it('refuses corrupted installer bytes and a different configured public key', () => {
    const { options, publicFixture } = fixture();
    expect(() => verifyDesktopManifest({ ...options, publicKey: Buffer.from(publicFixture.otherPublicKeyFile).toString('base64') }))
      .toThrow('different key id');
    writeFileSync(path.join(options.directory, 'Deckmate.Setup.2.0.0.exe'), 'corrupted installer');
    expect(() => verifyDesktopManifest(options)).toThrow('artifact signature verification failed');
  });

  it('refuses a manifest whose date, URL, signature or Russian notes changed in transit', () => {
    const { options, manifest, manifestPath } = fixture();
    for (const changed of [
      { ...manifest, pub_date: '2026-11-10T12:00:00.000Z' }, { ...manifest, notes_ru: undefined },
      { ...manifest, platforms: { 'windows-x86_64': { url: 'https://example.com/wrong.exe', signature: 'wrong' } } },
    ]) {
      writeFileSync(manifestPath, JSON.stringify(changed));
      expect(() => verifyDesktopManifest(options)).toThrow('does not match the signed release inputs');
    }
  });
});

describe('draft lifecycle', () => {
  it('creates and resumes a draft with its numeric REST id', async () => {
    const api = github();
    expect((await api.client.prepare(stable, releaseOptions)).id).toBe(439165688);
    expect((await api.client.prepare(stable, releaseOptions)).id).toBe(439165688);
    expect(api.mutations()).toHaveLength(1);
  });

  it.each([401, 403, 404, 500])('does not create a duplicate on a lookup HTTP %s', async status => {
    const request = vi.fn(async () => json({ message: 'Lookup failed' }, status));
    const client = new GitHubRelease({ repository, token: 'test', request });
    await expect(client.prepare(stable, releaseOptions)).rejects.toThrow(`HTTP ${status}`);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('propagates a lookup transport error', async () => {
    const request = vi.fn(async () => { throw new Error('offline'); });
    const client = new GitHubRelease({ repository, token: 'test', request });
    await expect(client.prepare(stable, releaseOptions)).rejects.toThrow('offline');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('finds an existing draft beyond the first page', async () => {
    const api = github();
    const request = vi.fn().mockResolvedValueOnce(json(Array.from({ length: 100 }, (_, i) => ({ tag_name: `v0.0.${i}` }))))
      .mockResolvedValueOnce(json([api.release]));
    const client = new GitHubRelease({ repository, token: 'test', request });
    expect((await client.prepare(stable, releaseOptions)).id).toBe(api.release.id);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1][0]).toContain('page=2');
  });

  it('rejects duplicate drafts and refuses unverified published releases before any mutation', async () => {
    const api = github();
    api.state.releases.push(api.release, { ...api.release, id: 99 });
    await expect(api.client.prepare(stable, releaseOptions)).rejects.toThrow('Multiple releases');
    api.state.releases.pop();
    api.release.draft = false;
    await expect(api.client.prepare(stable, releaseOptions)).rejects.toThrow('verified local release inputs are required');
    await expect(api.client.prepare(stable, releaseOptions, inputs())).rejects.toThrow('Published release mismatch');
    await expect(api.client.upload(api.release.id, stable, inputs())).rejects.toThrow('already published');
    expect(api.mutations()).toHaveLength(0);
  });

  it.each([
    { state: 'starter' }, { size: 1 }, { digest: 'sha256:wrong' }, { digest: null },
  ])('repairs a broken draft asset (%j), keeps identical assets and uploads latest.json last', async overrides => {
    const api = github();
    const files = inputs();
    const keep = api.add(files.files[0]);
    const old = api.add({ ...files.files[1], bytes: Buffer.alloc(files.files[1].bytes.length) }, overrides);
    api.add(files.manifestFile);
    await api.client.upload(api.release.id, stable, files);
    expect(api.state.assets.some(asset => asset.id === keep.id)).toBe(true);
    expect(api.state.assets.some(asset => asset.id === old.id)).toBe(false);
    const calls = api.mutations();
    expect(calls[0][1]?.method).toBe('DELETE');
    expect(calls.at(-1)![0]).toContain('name=latest.json');
    expect(api.request.mock.calls.every(([url]) => !url.includes('/releases/tags/') && !url.includes('RE_graphql'))).toBe(true);
  });

  it('rejects an incorrect post-upload API digest even when the size matches', async () => {
    const api = github();
    api.state.badUploadDigest = true;
    await expect(api.client.upload(api.release.id, stable, inputs())).rejects.toThrow('SHA-256');
    expect(api.state.assets.some(asset => asset.name === 'latest.json')).toBe(false);
  });

  it('derives the encoded public URL from the API name while draft URLs use untagged hashes', async () => {
    const api = github();
    const files = inputs(stable.tag, 'Deckmate Setup+0.6.0.exe');
    const verifiedAssets = await api.client.upload(api.release.id, stable, files);
    expect(api.state.assets.every(asset => asset.browser_download_url.includes('/untagged-abc123/'))).toBe(true);
    expect(files.manifest.platforms['windows-x86_64'].url).toContain('/Deckmate%20Setup%2B0.6.0.exe');
    await api.client.publish(api.release.id, stable, files, { commit: releaseOptions.commit, verifiedAssets });
    expect(api.state.assets.every(asset => asset.browser_download_url.includes(`/${stable.tag}/`))).toBe(true);
  });

  it.each(['windows-x86_64', 'windows-x86_64-nsis'])('rejects a wrong planned URL in %s before uploading latest.json', async platform => {
    const api = github();
    const files = inputs();
    files.manifest.platforms[platform].url = 'https://github.com/owner/deckmate/releases/download/untagged-abc123/wrong.exe';
    await expect(api.client.upload(api.release.id, stable, files)).rejects.toThrow('expected public installer URL');
    expect(api.state.assets.some(asset => asset.name === 'latest.json')).toBe(false);
  });

  it('uses extension-specific content types and uploads the manifest last', async () => {
    const api = github();
    const files = inputs();
    files.files.push({ name: 'notice.txt', bytes: Buffer.from('notice') });
    await api.client.upload(api.release.id, stable, files);
    const uploads = api.mutations().filter(([url]) => url.startsWith('https://uploads.github.com/'));
    expect(uploads.map(([url, init]) => [new URL(url).searchParams.get('name'), new Headers(init?.headers).get('Content-Type')]))
      .toEqual([
        ['deckmate-0.6.0.tgz', 'application/gzip'], ['Deckmate.Setup.0.6.0.exe', 'application/octet-stream'],
        ['Deckmate-0.6.0-win-x64.zip', 'application/zip'], ['notice.txt', 'application/octet-stream'], ['latest.json', 'application/json'],
      ]);
  });

  it('rejects extra draft assets during upload verification and again before PATCH', async () => {
    const api = github();
    const files = inputs();
    const extra = api.add({ name: 'manual-attempt.exe', bytes: Buffer.from('unverified') });
    await expect(api.client.upload(api.release.id, stable, files)).rejects.toThrow('unexpected assets: manual-attempt.exe');
    api.state.assets = api.state.assets.filter(asset => asset.id !== extra.id);
    const verifiedAssets = await api.client.upload(api.release.id, stable, files);
    api.add({ name: 'manual-attempt.exe', bytes: Buffer.from('unverified') });
    await expect(api.client.publish(api.release.id, stable, files, { commit: releaseOptions.commit, verifiedAssets }))
      .rejects.toThrow('unexpected assets: manual-attempt.exe');
    expect(api.mutations().some(([, init]) => init?.method === 'PATCH')).toBe(false);
  });

  it.each(['replaced', 'missing', 'duplicate', 'digest', 'size', 'state'])('refuses a %s asset after draft verification', async change => {
    const api = github();
    const files = inputs();
    const verifiedAssets = await api.client.upload(api.release.id, stable, files);
    const asset = api.state.assets[0];
    if (change === 'replaced' || change === 'missing') api.state.assets.shift();
    if (change === 'replaced' || change === 'duplicate') api.add(files.files[0]);
    if (change === 'digest') asset.digest = 'sha256:wrong';
    if (change === 'size') asset.size++;
    if (change === 'state') asset.state = 'starter';
    await expect(api.client.publish(api.release.id, stable, files, { commit: releaseOptions.commit, verifiedAssets }))
      .rejects.toThrow('Cannot publish');
    expect(api.mutations().some(([, init]) => init?.method === 'PATCH')).toBe(false);
  });

  it('requires the verified upload receipt and performs no upload or binary download in the publication gate', async () => {
    const api = github();
    const files = inputs();
    await expect(api.client.publish(api.release.id, stable, files)).rejects.toThrow('verified draft asset receipt');
    const verifiedAssets = await api.client.upload(api.release.id, stable, files);
    api.request.mockClear();
    await api.client.publish(api.release.id, stable, files, { commit: releaseOptions.commit, verifiedAssets });
    expect(api.mutations().map(([, init]) => init?.method)).toEqual(['PATCH']);
    expect(api.request.mock.calls.some(([, init]) => new Headers(init?.headers).get('Accept') === 'application/octet-stream')).toBe(false);
    const patchIndex = api.request.mock.calls.findIndex(([, init]) => init?.method === 'PATCH');
    expect(api.request.mock.calls[patchIndex - 1][0]).toContain(`/git/ref/tags/${stable.tag}`);
    expect(api.request.mock.calls[patchIndex + 1][0]).toContain(`/releases/${api.release.id}/assets`);
  });

  it.each(['Deckmate.Setup.0.6.0.exe', 'latest.json'])('requires the public browser_download_url for %s after PATCH', async name => {
    const api = github();
    const files = inputs();
    const verifiedAssets = await api.client.upload(api.release.id, stable, files);
    api.state.badPublishedUrl = name;
    await expect(api.client.publish(api.release.id, stable, files, { commit: releaseOptions.commit, verifiedAssets }))
      .rejects.toThrow(`unexpected public download URL for ${name}`);
    expect(api.release.draft).toBe(false);
  });

  it.each([null, { type: 'commit', sha: 'moved' }, { type: 'tree', sha: releaseOptions.commit }])(
    'refuses PATCH when the tag no longer resolves to GITHUB_SHA (%j)', async object => {
      const api = github();
      const files = inputs();
      const verifiedAssets = await api.client.upload(api.release.id, stable, files);
      api.state.tagObject = object;
      await expect(api.client.publish(api.release.id, stable, files, { commit: releaseOptions.commit, verifiedAssets }))
        .rejects.toThrow('no longer points to GITHUB_SHA');
      expect(api.mutations().some(([, init]) => init?.method === 'PATCH')).toBe(false);
    });

  it('peels annotated tags before comparing the target commit with GITHUB_SHA', async () => {
    const api = github();
    const files = inputs();
    const verifiedAssets = await api.client.upload(api.release.id, stable, files);
    api.state.tagObject = { type: 'tag', sha: 'outer-tag' };
    api.state.annotatedTags.set('outer-tag', { type: 'tag', sha: 'inner-tag' });
    api.state.annotatedTags.set('inner-tag', { type: 'commit', sha: releaseOptions.commit });
    await api.client.publish(api.release.id, stable, files, { commit: releaseOptions.commit, verifiedAssets });
    expect(api.request.mock.calls.some(([url]) => url.endsWith('/git/tags/inner-tag'))).toBe(true);
  });

  it('resumes after a publication failure without changing manifest bytes', async () => {
    const api = github();
    const files = inputs();
    let verifiedAssets = await api.client.upload(api.release.id, stable, files);
    api.state.failPublish = true;
    await expect(api.client.publish(api.release.id, stable, files, { commit: releaseOptions.commit, verifiedAssets })).rejects.toThrow('HTTP 503');
    verifiedAssets = await api.client.upload(api.release.id, stable, files);
    api.state.failPublish = false;
    await api.client.publish(api.release.id, stable, files, { commit: releaseOptions.commit, verifiedAssets });
    const patch = api.mutations().at(-1)!;
    expect(patch[0]).toContain(`/releases/${api.release.id}`);
    expect(JSON.parse(String(patch[1]?.body))).toEqual({ draft: false, prerelease: false, make_latest: 'true' });
    const latest = api.state.assets.find(asset => asset.name === 'latest.json')!;
    expect(api.state.bytes.get(latest.id)).toEqual(files.manifestFile.bytes);
  });

  it('explicitly excludes a prerelease from latest', async () => {
    const plan = { ...stable, tag: 'v0.6.0-beta.1', prerelease: true };
    const api = github(plan);
    const files = inputs(plan.tag);
    const verifiedAssets = await api.client.upload(api.release.id, plan, files);
    await api.client.publish(api.release.id, plan, files, { commit: releaseOptions.commit, verifiedAssets });
    expect(JSON.parse(String(api.mutations().at(-1)![1]?.body))).toMatchObject({ prerelease: true, make_latest: 'false' });
  });

  it('runs the full dry-run asset path and deletes the draft without publishing or creating a tag', async () => {
    const plan = { dryRun: true, tag: 'v0.6.0-dryrun.1234', prerelease: true };
    const api = github(plan);
    const files = inputs(plan.tag);
    await api.client.prepare(plan, releaseOptions);
    await api.client.upload(api.release.id, plan, files);
    expect(api.state.assets.every(asset => asset.browser_download_url.includes('/untagged-abc123/'))).toBe(true);
    await expect(api.client.publish(api.release.id, plan, files)).rejects.toThrow('must never publish');
    await api.client.cleanup(api.release.id, plan);
    expect(api.state.releases).toEqual([]);
    expect(api.mutations().some(([url, init]) => init?.method === 'PATCH' || url.includes('/git/'))).toBe(false);
  });

  it('finds and deletes an orphan dry-run draft when the create response was lost before release_id was saved', async () => {
    const plan = { dryRun: true, tag: 'v0.6.0-dryrun.1234', prerelease: true };
    const api = github(plan);
    api.state.losePrepareResponse = true;
    await expect(api.client.prepare(plan, releaseOptions)).rejects.toThrow('Lost create response');
    expect(api.state.releases).toHaveLength(1);
    await api.client.cleanup('', plan);
    expect(api.state.releases).toEqual([]);
    await api.client.cleanup(undefined, plan);
    expect(api.mutations().map(([, init]) => init?.method)).toEqual(['POST', 'DELETE']);
  });

  it('never cleans up a public release, a different tag, or ambiguous dry-run drafts', async () => {
    const plan = { dryRun: true, tag: 'v0.6.0-dryrun.1234', prerelease: true };
    const api = github(plan);
    api.state.releases.push(api.release);
    api.release.draft = false;
    await expect(api.client.cleanup('', plan)).rejects.toThrow('already published');
    api.release.draft = true;
    api.state.releases.push({ ...api.release, id: 99 });
    await expect(api.client.cleanup('', plan)).rejects.toThrow('Multiple releases');
    await expect(api.client.cleanup('', stable)).rejects.toThrow('Only dry-run drafts');
    await expect(api.client.cleanup('', { ...stable, dryRun: true })).rejects.toThrow('Only dry-run drafts');
    await expect(api.client.cleanup(api.release.id, { ...plan, tag: 'v0.6.0-dryrun.5678' })).rejects.toThrow('tag does not match');
    api.state.releases = [{ ...api.release, tag_name: stable.tag }];
    await api.client.cleanup('', plan);
    expect(api.mutations()).toEqual([]);
  });
});

describe('published release recovery', () => {
  it.each(['lost PATCH response', 'failed public download'])('retries after %s with identical assets and no mutations', async failure => {
    const api = github();
    const files = inputs();
    await api.client.prepare(stable, releaseOptions, files);
    const verifiedAssets = await api.client.upload(api.release.id, stable, files);
    const publicOptions = { repository, plan: stable, installer: files.files[1], manifestFile: files.manifestFile, wait: async () => {} };
    api.state.losePublishResponse = failure === 'lost PATCH response';
    const publication = api.client.publish(api.release.id, stable, files, { commit: releaseOptions.commit, verifiedAssets });
    if (api.state.losePublishResponse) await expect(publication).rejects.toThrow('Lost publish response');
    else await publication;
    if (failure === 'failed public download') {
      await expect(verifyPublicRelease({ ...publicOptions, request: async () => json({}, 503) })).rejects.toThrow('HTTP 503');
    }
    api.request.mockClear();
    expect((await api.client.prepare(stable, releaseOptions, files)).draft).toBe(false);
    await api.client.verifyPublished(api.release.id, stable, files);
    await verifyPublicRelease({ ...publicOptions, request: api.request });
    expect(api.mutations()).toEqual([]);
    expect(api.request.mock.calls.filter(([url]) => url.startsWith('https://github.com/'))).toHaveLength(3);
  });

  it.each(['installer bytes', 'npm bytes', 'zip bytes', 'manifest bytes', 'digest', 'extra asset', 'missing asset', 'installer URL', 'manifest URL', 'prerelease'])(
    'refuses a public release with different %s without changing it', async change => {
      const api = github();
      const files = inputs();
      await api.client.prepare(stable, releaseOptions, files);
      const verifiedAssets = await api.client.upload(api.release.id, stable, files);
      await api.client.publish(api.release.id, stable, files, { commit: releaseOptions.commit, verifiedAssets });
      if (change.endsWith('bytes')) {
        const names: Record<string, string> = {
          'installer bytes': files.installerName, 'npm bytes': files.files[0].name,
          'zip bytes': files.files[2].name, 'manifest bytes': files.manifestFile.name,
        };
        const asset = api.state.assets.find(entry => entry.name === names[change])!;
        // No API digest: equal lengths still require downloading and hashing the real bytes.
        asset.digest = null;
        api.state.bytes.set(asset.id, Buffer.alloc(asset.size));
      }
      if (change === 'digest') api.state.assets[0].digest = 'sha256:wrong';
      if (change === 'extra asset') api.add({ name: 'manual.exe', bytes: Buffer.from('extra') });
      if (change === 'missing asset') api.state.assets.pop();
      if (change.endsWith('URL')) {
        const name = change === 'installer URL' ? files.installerName : files.manifestFile.name;
        api.state.assets.find(asset => asset.name === name)!.browser_download_url += '-wrong';
      }
      if (change === 'prerelease') api.release.prerelease = true;
      api.request.mockClear();
      await expect(api.client.prepare(stable, releaseOptions, files)).rejects.toThrow('Published release mismatch');
      expect(api.mutations()).toEqual([]);
    });
});

describe('anonymous release endpoints after publication', () => {
  function fixture(plan = stable) {
    const files = inputs(plan.tag);
    const installer = files.files[1];
    const manifestFile = files.manifestFile;
    const urls = [
      `https://github.com/${repository}/releases/download/${plan.tag}/${installer.name}`,
      `https://github.com/${repository}/releases/download/${plan.tag}/latest.json`,
      `https://github.com/${repository}/releases/latest/download/latest.json`,
    ];
    const request = vi.fn(async (url: string, _init?: RequestInit) =>
      new Response(new Uint8Array(url === urls[0] ? installer.bytes : manifestFile.bytes)));
    const wait = vi.fn(async () => {});
    return { options: { repository, plan, installer, manifestFile, request, wait }, urls };
  }

  it('checks installer, tag manifest and stable latest anonymously, allowing propagation delay', async () => {
    const { options, urls } = fixture();
    options.request.mockResolvedValueOnce(json({}, 404));
    await verifyPublicRelease(options);
    expect(options.wait).toHaveBeenCalledTimes(1);
    expect(options.request.mock.calls.map(([url]) => url)).toEqual([urls[0], ...urls]);
    for (const [, init] of options.request.mock.calls) expect(new Headers(init?.headers).has('Authorization')).toBe(false);
  });

  it.each(['size', 'SHA-256'])('rejects an installer with a different %s even if the manifests match', async change => {
    const { options, urls } = fixture();
    options.request.mockImplementation(async url => new Response(new Uint8Array(url === urls[0]
      ? Buffer.alloc(options.installer.bytes.length + Number(change === 'size')) : options.manifestFile.bytes)));
    await expect(verifyPublicRelease(options)).rejects.toThrow('installer size or SHA-256 differs');
    expect(options.request).toHaveBeenCalledTimes(6);
  });

  it.each([1, 2])('rejects different manifest bytes at endpoint %s after verifying the installer', async index => {
    const { options, urls } = fixture();
    options.request.mockImplementation(async url => {
      if (url === urls[index]) return new Response('different manifest');
      return new Response(new Uint8Array(url === urls[0] ? options.installer.bytes : options.manifestFile.bytes));
    });
    await expect(verifyPublicRelease(options)).rejects.toThrow('different manifest bytes');
    expect(options.request.mock.calls.filter(([url]) => url === urls[index])).toHaveLength(6);
  });

  it('checks both tag downloads but never stable latest for a prerelease', async () => {
    const { options, urls } = fixture({ ...stable, tag: 'v0.6.0-beta.1', prerelease: true });
    await verifyPublicRelease(options);
    expect(options.request.mock.calls.map(([url]) => url)).toEqual(urls.slice(0, 2));
  });
});

describe('release CI gate', () => {
  const commit = releaseOptions.commit;
  const [ubuntu, windows] = REQUIRED_CHECKS;
  const run = (name: string, status = 'completed', conclusion: string | null = 'success', slug = 'github-actions') =>
    ({ name, status, conclusion, app: { slug } });
  function gate(rounds: Array<Record<string, unknown[]>>) {
    let round = 0;
    let clock = 0;
    const request = vi.fn(async (url: string) => {
      const name = new URL(url).searchParams.get('check_name')!;
      return json({ check_runs: rounds[Math.min(round, rounds.length - 1)][name] ?? [] });
    });
    const wait = vi.fn(async (ms: number) => { round += 1; clock += ms; });
    const client = new GitHubRelease({ repository, token: 'test', request });
    const check = () => client.requireGreenChecks(commit, { wait, now: () => clock, intervalMs: 30000, timeoutMs: 120000 });
    return { request, wait, check };
  }

  it('passes when both required checks are green on the exact commit, counting a green rerun', async () => {
    const { request, wait, check } = gate([{ [ubuntu]: [run(ubuntu, 'completed', 'failure'), run(ubuntu)], [windows]: [run(windows)] }]);
    await check();
    expect(wait).not.toHaveBeenCalled();
    expect(request.mock.calls.map(([url]) => url)).toEqual(REQUIRED_CHECKS.map(name =>
      `https://api.github.com/repos/${repository}/commits/${commit}/check-runs?check_name=${encodeURIComponent(name)}&per_page=100`));
  });

  it('waits while CI has not started or is still running, then passes', async () => {
    const { wait, check } = gate([{}, { [ubuntu]: [run(ubuntu, 'in_progress', null)], [windows]: [run(windows)] },
      { [ubuntu]: [run(ubuntu)], [windows]: [run(windows)] }]);
    await check();
    expect(wait).toHaveBeenCalledTimes(2);
  });

  it('stops on a failed check without waiting', async () => {
    const { wait, check } = gate([{ [ubuntu]: [run(ubuntu, 'completed', 'cancelled')], [windows]: [run(windows)] }]);
    await expect(check()).rejects.toThrow(`CI check "${ubuntu}" finished with cancelled`);
    expect(wait).not.toHaveBeenCalled();
  });

  it('ignores same-named checks from other apps and gives up at the deadline', async () => {
    const { wait, check } = gate([{ [ubuntu]: [run(ubuntu)], [windows]: [run(windows, 'completed', 'success', 'another-app')] }]);
    await expect(check()).rejects.toThrow(`CI did not report ${windows} on ${commit} in time`);
    expect(wait).toHaveBeenCalledTimes(4);
  });

  it('requires a full commit SHA', async () => {
    const client = new GitHubRelease({ repository, token: 'test', request: vi.fn() });
    await expect(client.requireGreenChecks('0123456')).rejects.toThrow('full commit SHA');
  });
});

describe('CI workflow required checks', () => {
  type Job = { name?: string; if?: string; needs?: string[]; env?: Record<string, string>;
    strategy: { matrix: { os: string[]; shard?: number[] } }; steps: Array<{ run?: string }> };
  const ci = parse(readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')) as { jobs: Record<string, Job> };

  it('summarizes every unit and browser job in the contexts the ruleset and the release require', () => {
    const checks = ci.jobs.checks;
    expect(checks.needs).toEqual(['unit', 'browser']);
    expect(checks.if).toBe('always()');
    expect(checks.name).toBeUndefined();
    expect(checks.strategy.matrix.os.map(os => `checks (${os})`)).toEqual(REQUIRED_CHECKS);
  });

  it('splits the browser project into Windows shards and keeps unit tests on both systems', () => {
    const { browser, unit } = ci.jobs;
    const shards = browser.strategy.matrix.shard!;
    expect(shards).toEqual(Array.from({ length: shards.length }, (_, index) => index + 1));
    expect(browser.name).toBe(`browser (\${{ matrix.os }}, \${{ matrix.shard }}/${shards.length})`);
    expect(browser.env?.SHARD).toBe(`\${{ matrix.shard }}/${shards.length}`);
    expect(browser.steps.at(-1)?.run).toBe('npx vitest run --project browser --shard="$SHARD"');
    expect(browser.strategy.matrix.os).toEqual(['windows-latest']);
    expect(unit.strategy.matrix.os).toEqual(['ubuntu-latest', 'windows-latest']);
    expect(unit.steps.map(step => step.run)).toEqual(expect.arrayContaining(['npm run typecheck', 'npx vitest run --project unit']));
  });
});

describe('release workflow publication boundary', () => {
  type Step = { name?: string; id?: string; if?: string; run?: string; env?: Record<string, string> };
  const workflow = parse(readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8')) as {
    jobs: Record<string, { needs?: string | string[]; permissions?: Record<string, string>; steps: Step[] }>;
  };

  it('publishes only a commit with green CI and does not run the suite again', () => {
    const preflight = workflow.jobs.preflight.steps;
    const gate = preflight.findIndex(step => step.run === 'node desktop/scripts/github-release.mjs require-ci');
    expect(gate).toBeGreaterThan(-1);
    expect(preflight[gate].if).toBe("github.event_name == 'push'");
    expect(gate).toBeLessThan(preflight.findIndex(step => /^npm ci(?: |$)/u.test(step.run ?? '')));
    expect(preflight.some(step => step.run === 'npm test' || step.run === 'npm run typecheck')).toBe(false);
    expect(workflow.jobs.preflight.permissions).toEqual({ contents: 'read', checks: 'read' });
  });
  const steps = workflow.jobs.release.steps;
  const action = (name: string) => steps.find(step => step.run === `node desktop/scripts/github-release.mjs ${name}`)!;

  it('fully verifies draft uploads before npm and GHCR, then publishes and verifies public downloads', () => {
    expect(workflow.jobs.desktop.needs).toBe('preflight');
    expect(workflow.jobs.release.needs).toEqual(['preflight', 'desktop']);
    const ordered = [action('prepare'), action('upload'), steps.find(step => step.run?.includes('npm publish '))!,
      steps.find(step => step.run?.includes('docker push '))!, action('publish'), action('verify-public')];
    expect(ordered.every(Boolean)).toBe(true);
    const positions = ordered.map(step => steps.indexOf(step));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(action('publish').env?.VERIFIED_ASSETS).toBe('${{ steps.upload.outputs.verified_assets }}');
  });

  it('skips every publication step on published-release recovery while retaining public verification', () => {
    const mutations = steps.filter(step => step === action('upload') || step === action('publish')
      || step.id === 'npm' || step.id === 'container' || step.run?.includes('npm publish ') || step.run?.includes('docker push '));
    expect(mutations).toHaveLength(6);
    for (const step of mutations) expect(step.if).toContain("steps.github-release.outputs.published == 'false'");
    expect(action('verify-public').if).not.toContain('published');
    expect(action('verify-public').env?.RELEASE_ID).toBe('${{ steps.github-release.outputs.release_id }}');
  });

  it('runs prepare, upload and cleanup for a dry run, including cleanup without a saved release ID', () => {
    expect(action('prepare').if).toBeUndefined();
    expect(action('upload').if).toBe("steps.github-release.outputs.published == 'false'");
    for (const step of steps.filter(step => step.id === 'npm' || step.id === 'container'
      || step.run?.includes('npm publish ') || step.run?.includes('docker push ')
      || step === action('publish') || step === action('verify-public'))) {
      expect(step.if).toContain("github.event_name == 'push'");
      expect(step.if).toContain("needs.preflight.outputs.dry_run == 'false'");
    }
    expect(action('cleanup').if).toBe("always() && github.event_name == 'workflow_dispatch' && needs.preflight.outputs.dry_run == 'true'");
  });

  it('passes Actions values through env rather than interpolating any expressions into shell scripts', () => {
    for (const job of Object.values(workflow.jobs)) {
      for (const step of job.steps) if (step.run) expect(step.run).not.toContain('${{');
    }
  });
});
