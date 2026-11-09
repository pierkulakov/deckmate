import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

type Plan = { dryRun: boolean; tag: string; prerelease: boolean };
type File = { name: string; bytes: Buffer };
type Inputs = { files: File[]; installerName: string; manifestFile: File; manifest: { platforms: Record<string, { url: string }> } };
type Release = { id: number; node_id: string; tag_name: string; draft: boolean; upload_url: string };
type Asset = { id: number; name: string; state: string; size: number; digest?: string | null; browser_download_url: string };
type Client = {
  prepare: (plan: Plan, options: { version: string; commit: string; notes: string }) => Promise<Release>;
  upload: (id: number, plan: Plan, inputs: Inputs) => Promise<void>;
  publish: (id: number, plan: Plan, inputs: Inputs) => Promise<void>;
  cleanup: (id: number, plan: Plan) => Promise<void>;
};
const require = createRequire(import.meta.url);
const { GitHubRelease, releasePlan, verifyDesktopManifest, verifyPublicManifest } = require('../desktop/scripts/github-release.mjs') as {
  GitHubRelease: new (options: { repository: string; token: string; request: (url: string, init?: RequestInit) => Promise<Response> }) => Client;
  releasePlan: (options: { eventName: string; dryRun: string; refType: string; refName: string; version: string; runId: string }) => Plan;
  verifyDesktopManifest: (options: { directory: string; version: string; url: string; publicKey: string;
    changelog: string; changelogRu: string; pubDate: string }) => { manifestFile: File };
  verifyPublicManifest: (options: { repository: string; plan: Plan; bytes: Buffer;
    request: (url: string, init?: RequestInit) => Promise<Response>; wait: (ms: number) => Promise<void> }) => Promise<void>;
};

const repository = 'owner/deckmate';
const stable: Plan = { dryRun: false, tag: 'v0.6.0', prerelease: false };
const releaseOptions = { version: '0.6.0', commit: '0123456789', notes: 'Release notes' };
const hash = (bytes: Buffer) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
function inputs(tag = stable.tag): Inputs {
  const installerName = 'Deckmate.Setup.0.6.0.exe';
  const manifest = { platforms: {
    'windows-x86_64': { url: `https://github.com/${repository}/releases/download/${tag}/${installerName}` },
    'windows-x86_64-nsis': { url: `https://github.com/${repository}/releases/download/${tag}/${installerName}` },
  } };
  return {
    installerName, manifest,
    files: ['deckmate-0.6.0.tgz', installerName, 'Deckmate-0.6.0-win-x64.zip'].map(name => ({ name, bytes: Buffer.from(name) })),
    manifestFile: { name: 'latest.json', bytes: Buffer.from(JSON.stringify(manifest)) },
  };
}

// Simulates draft-only REST semantics, including the exact asset upload/download paths.
// No GitHub connection or credential is used by these lifecycle regressions.
function github(plan = stable) {
  const release: Release = { id: 439165688, node_id: 'RE_graphql_is_not_a_database_id', tag_name: plan.tag, draft: true,
    upload_url: `https://uploads.github.com/repos/${repository}/releases/439165688/assets{?name,label}` };
  const state = { releases: [] as Release[], assets: [] as Asset[], bytes: new Map<number, Buffer>(),
    badUploadDigest: false, badDownloadUrl: false, failPublish: false, nextId: 1 };
  const add = (file: File, overrides: Partial<Asset> = {}) => {
    const asset = { id: state.nextId++, name: file.name, state: 'uploaded', size: file.bytes.length, digest: hash(file.bytes),
      browser_download_url: `https://github.com/${repository}/releases/download/${plan.tag}/${file.name}`, ...overrides };
    state.assets.push(asset);
    state.bytes.set(asset.id, file.bytes);
    return asset;
  };
  const request = vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const endpoint = url.pathname.replace(`/repos/${repository}/`, '');
    const method = init.method ?? 'GET';
    if (endpoint === 'releases' && method === 'GET') return json(state.releases);
    if (endpoint.startsWith('git/ref/tags/') && method === 'GET') return json({ message: 'Not Found' }, 404);
    if (endpoint === 'releases' && method === 'POST') {
      const body = JSON.parse(String(init.body));
      expect(body).toMatchObject({ draft: true, make_latest: 'false', tag_name: plan.tag });
      state.releases.push(release);
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
        return json({ ...release, html_url: 'https://github.com/owner/deckmate/releases/tag/v0.6.0' });
      }
    }
    if (endpoint === `releases/${release.id}/assets`) {
      if (method === 'GET') return json(state.assets);
      if (method === 'POST' && url.hostname === 'uploads.github.com') {
        const file = { name: url.searchParams.get('name')!, bytes: Buffer.from(init.body as unknown as Uint8Array) };
        const asset = add(file);
        if (state.badUploadDigest) asset.digest = 'sha256:incorrect';
        if (state.badDownloadUrl) asset.browser_download_url += '-renamed';
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
  const mutations = () => request.mock.calls.filter(([, init]) => init?.method !== 'GET');
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

  it('rejects duplicate drafts and an already published release before any mutation', async () => {
    const api = github();
    api.state.releases.push(api.release, { ...api.release, id: 99 });
    await expect(api.client.prepare(stable, releaseOptions)).rejects.toThrow('Multiple releases');
    api.state.releases.pop();
    api.release.draft = false;
    await expect(api.client.prepare(stable, releaseOptions)).rejects.toThrow('only by pushing a tag');
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

  it('rejects a URL that differs from the actual GitHub asset name', async () => {
    const api = github();
    api.state.badDownloadUrl = true;
    await expect(api.client.upload(api.release.id, stable, inputs())).rejects.toThrow('unexpected installer download URL');
    expect(api.state.assets.some(asset => asset.name === 'latest.json')).toBe(false);
  });

  it('resumes after a publication failure without changing manifest bytes', async () => {
    const api = github();
    const files = inputs();
    await api.client.upload(api.release.id, stable, files);
    api.state.failPublish = true;
    await expect(api.client.publish(api.release.id, stable, files)).rejects.toThrow('HTTP 503');
    await api.client.upload(api.release.id, stable, files);
    api.state.failPublish = false;
    await api.client.publish(api.release.id, stable, files);
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
    await api.client.upload(api.release.id, plan, files);
    await api.client.publish(api.release.id, plan, files);
    expect(JSON.parse(String(api.mutations().at(-1)![1]?.body))).toMatchObject({ prerelease: true, make_latest: 'false' });
  });

  it('runs the full dry-run asset path and deletes the draft without publishing or creating a tag', async () => {
    const plan = { dryRun: true, tag: 'v0.6.0-dryrun.1234', prerelease: true };
    const api = github(plan);
    const files = inputs(plan.tag);
    await api.client.prepare(plan, releaseOptions);
    await api.client.upload(api.release.id, plan, files);
    await expect(api.client.publish(api.release.id, plan, files)).rejects.toThrow('must never publish');
    await api.client.cleanup(api.release.id, plan);
    expect(api.state.releases).toEqual([]);
    expect(api.mutations().some(([url, init]) => init?.method === 'PATCH' || url.includes('/git/'))).toBe(false);
  });
});

describe('anonymous updater endpoints after publication', () => {
  it('checks the tag and latest endpoints without a token, allowing propagation delay', async () => {
    const bytes = Buffer.from('manifest bytes');
    const request = vi.fn().mockResolvedValueOnce(json({}, 404))
      .mockImplementation(async () => new Response(new Uint8Array(bytes)));
    const wait = vi.fn(async () => {});
    await verifyPublicManifest({ repository, plan: stable, bytes, request, wait });
    expect(wait).toHaveBeenCalledTimes(1);
    expect(request.mock.calls.map(([url]) => url)).toEqual([
      `https://github.com/${repository}/releases/download/v0.6.0/latest.json`,
      `https://github.com/${repository}/releases/download/v0.6.0/latest.json`,
      `https://github.com/${repository}/releases/latest/download/latest.json`,
    ]);
    for (const [, init] of request.mock.calls) expect(init.headers.Authorization).toBeUndefined();
  });

  it('fails when the public bytes stay different, and never checks stable latest for a prerelease', async () => {
    const request = vi.fn(async () => new Response('wrong bytes'));
    await expect(verifyPublicManifest({ repository, plan: { ...stable, prerelease: true }, bytes: Buffer.from('expected'),
      request, wait: async () => {} })).rejects.toThrow('different manifest bytes');
    expect(request).toHaveBeenCalledTimes(6);
  });
});
