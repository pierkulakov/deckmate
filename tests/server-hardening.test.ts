import { afterEach, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import { createApp } from '../server/app.ts';
import { decodeAttachment } from '../server/attachments.ts';
import { emptyManifest, readProjectCatalog, renderCatalogManifest } from '../server/catalog.ts';
import type { ServerConfig } from '../server/config.ts';
import { freePort } from './free-port.ts';

// 2026-11-06 security hardening: request paths stay inside the project, Host/Origin/token guard every
// mutation, the WebSocket upgrade keeps the same policy, and uploads are typed by content, not by name.

const execute = promisify(execFile);
const roots: string[] = [];
const apps: FastifyInstance[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function project(options: { readOnly: boolean; port: number }): Promise<{ root: string; outside: string; app: FastifyInstance; headers: Record<string, string> }> {
  const directory = await mkdtemp(path.join(tmpdir(), 'deckmate-hardening-'));
  roots.push(directory);
  const root = path.join(directory, 'data');
  await mkdir(path.join(root, 'features'), { recursive: true });
  await mkdir(path.join(root, 'tasks'), { recursive: true });
  await writeFile(path.join(root, 'features/match.md'), '# Матч\n\nТело.\n');
  await writeFile(path.join(root, 'tasks/iterations.md'), '## Итерация 1 — Проверка\n');
  await writeFile(path.join(directory, 'outside.md'), '# Секрет за пределами проекта\n');
  if (!options.readOnly) {
    const manifest = emptyManifest();
    manifest.spaces.push({ id: 'work', title: 'Работа' });
    manifest.decks.push({ id: 'audio', spaceId: 'work', title: 'Звук', kind: 'task', icon: 'audio', color: '#ff990a', description: '' });
    await writeFile(path.join(root, 'tasks/deckmate.md'), renderCatalogManifest(manifest));
    await execute('git', ['init', '-b', 'deckmate/sandbox', root], { windowsHide: true });
  }
  const config: ServerConfig = options.readOnly
    ? { editMode: 'read-only', dataRoot: root, writeRoot: null, projectName: 'Тест', port: options.port, python: 'python' }
    : { editMode: 'sandbox', dataRoot: root, writeRoot: root, projectName: 'Тест', port: options.port, python: 'python' };
  const app = await createApp(config);
  apps.push(app);
  return { root, outside: directory, app, headers: { host: `127.0.0.1:${options.port}` } };
}

/**
 * 2026-11-09: Node creates a Windows junction as an empty directory and then opens it without sharing to set the
 * reparse point. The running app's file watcher could open that directory first, and Windows CI failed with EBUSY.
 * The link is built in an unwatched folder and moved into place finished.
 */
async function linkWhileWatched(target: string, link: string, staging: string): Promise<void> {
  const prepared = path.join(staging, `staged-${path.basename(link)}`);
  await symlink(target, prepared, process.platform === 'win32' ? 'junction' : 'dir');
  await rename(prepared, link);
}

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ipBwAAAAASUVORK5CYII=', 'base64');
const cardId = 'card:ca1d0000-0000-4000-8000-000000000001';

it('serves project files only through clean relative paths', async () => {
  const { root, outside, app, headers } = await project({ readOnly: true, port: 44342 });
  await linkWhileWatched(outside, path.join(root, 'features/link'), outside);
  await writeFile(path.join(root, 'tasks/art.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const honest = await app.inject({ url: '/api/file?path=features/match.md', headers });
  expect(honest.statusCode).toBe(200);
  expect(honest.headers['content-type']).toBe('text/plain; charset=utf-8');
  expect(honest.headers['content-security-policy']).toBe("default-src 'none'; sandbox; frame-ancestors 'self'");
  expect(honest.headers['x-frame-options']).toBe('SAMEORIGIN');
  expect(honest.headers['x-content-type-options']).toBe('nosniff');
  // Project SVG is served only with a sandboxed no-source policy, so embedded scripts never run.
  const svg = await app.inject({ url: '/api/file?path=tasks/art.svg', headers });
  expect(svg.statusCode).toBe(200);
  expect(svg.headers['content-type']).toBe('image/svg+xml');
  expect(svg.headers['content-security-policy']).toBe("default-src 'none'; sandbox; frame-ancestors 'self'");
  expect(svg.headers['x-frame-options']).toBe('SAMEORIGIN');
  expect(svg.headers['x-content-type-options']).toBe('nosniff');
  expect((await app.inject({ url: '/api/file?path=features/match.md&from=1&to=1', headers })).statusCode).toBe(200);
  // Traversal inside the project bypasses the whitelisted directories and must not serve (2026-11-06).
  expect((await app.inject({ url: '/api/file?path=features/../tasks/iterations.md', headers })).statusCode).toBe(404);
  expect((await app.inject({ url: '/api/file?path=features/..%2F..%2Foutside.md', headers })).statusCode).toBe(404);
  // A junction out of the project root is an unservable path, not a server error.
  expect((await app.inject({ url: '/api/file?path=' + encodeURIComponent('features/link/outside.md'), headers })).statusCode).toBe(404);
  // NUL and other control characters, absolute paths, backslashes and repeated values are refused before the filesystem.
  expect((await app.inject({ url: '/api/file?path=' + encodeURIComponent('features/naul' + String.fromCharCode(0) + '.md'), headers })).statusCode).toBe(404);
  expect((await app.inject({ url: '/api/file?path=' + encodeURIComponent('/features/match.md'), headers })).statusCode).toBe(404);
  expect((await app.inject({ url: '/api/file?path=' + encodeURIComponent('features\\match.md'), headers })).statusCode).toBe(404);
  expect((await app.inject({ url: '/api/file?path=features/match.md&path=tasks/iterations.md', headers })).statusCode).toBe(404);
  expect((await app.inject({ url: '/api/file?path=features/unknown.md', headers })).statusCode).toBe(404);
});

it('restricts framing of the client, API responses and rejected requests to the same origin', async () => {
  const { app, headers } = await project({ readOnly: true, port: 44362 });
  const page = await app.inject({ url: '/', headers });
  expect([200, 404]).toContain(page.statusCode);
  const api = await app.inject({ url: '/api/health', headers });
  expect(api.statusCode).toBe(200);
  const rejected = await app.inject({ url: '/api/health', headers: { host: 'evil.example:44362' } });
  expect(rejected.statusCode).toBe(403);
  const malformed = await app.inject({ url: '/%E0%A4%A', headers });
  expect([400, 404]).toContain(malformed.statusCode);
  for (const response of [page, api, rejected, malformed]) {
    expect(response.headers['content-security-policy']).toBe("frame-ancestors 'self'");
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
  }
});

it.each([false, true])('excludes linked scan roots from the catalog and index (read-only: %s)', async readOnly => {
  const { root, outside, app, headers } = await project({ readOnly, port: 44363 });
  const linked = path.join(outside, 'linked');
  await mkdir(linked);
  await writeFile(path.join(linked, 'secret.md'), '# ExternalSecret\nOutsideContentMustNotLeak\n');
  await rename(path.join(root, 'features'), path.join(root, 'original-features'));
  for (const name of ['docs', 'features']) {
    await linkWhileWatched(linked, path.join(root, name), outside);
  }
  await writeFile(path.join(root, 'tasks/inside.md'), '# InternalContent\nInside the project.\n');
  const catalog = await app.inject({ url: '/api/catalog', headers });
  expect(catalog.statusCode, catalog.body).toBe(200);
  expect(catalog.body).not.toContain('ExternalSecret');
  expect(catalog.body).not.toContain('OutsideContentMustNotLeak');
  for (const name of ['docs', 'features']) {
    expect(catalog.json().warnings).toContain(`${name}: Skipped linked scan root (symlink or junction).`);
  }
  expect(catalog.json().documents.map((document: { path: string }) => document.path)).toContain('tasks/inside.md');
  expect(catalog.json().documents.some((document: { path: string }) => /^(docs|features)\//u.test(document.path))).toBe(false);
  const indexed = await app.inject({ url: '/api/cards', headers });
  expect(indexed.statusCode).toBe(200);
  expect(indexed.json().map((card: { path: string }) => card.path)).toContain('tasks/inside.md');
  expect(indexed.json().some((card: { path: string }) => /^(docs|features)\//u.test(card.path))).toBe(false);
  const search = await app.inject({ url: '/api/cards?text=OutsideContentMustNotLeak', headers });
  expect(search.statusCode).toBe(200);
  expect(search.json()).toEqual([]);
});

it('rejects foreign Host and Origin headers on every method', async () => {
  const { app, headers } = await project({ readOnly: true, port: 44343 });
  expect((await app.inject({ url: '/api/health', headers: { host: 'evil.example:44343' } })).statusCode).toBe(403);
  expect((await app.inject({ url: '/api/health' })).statusCode).toBe(403);
  expect((await app.inject({ url: '/api/health', headers: { ...headers, origin: 'https://evil.example' } })).statusCode).toBe(403);
  expect((await app.inject({ url: '/api/health', headers: { ...headers, origin: 'null' } })).statusCode).toBe(403);
  expect((await app.inject({ url: '/api/health', headers })).statusCode).toBe(200);
});

it('accepts the IPv6 loopback Host and Origin', async () => {
  const { app } = await project({ readOnly: true, port: 44350 });
  const loopback = { host: '[::1]:44350', origin: 'http://[::1]:44350' };
  expect((await app.inject({ url: '/api/health', headers: loopback })).statusCode).toBe(200);
  // A foreign Host stays refused even when the Origin looks local.
  expect((await app.inject({ url: '/api/health', headers: { host: 'evil.example:44350', origin: 'http://[::1]:44350' } })).statusCode).toBe(403);
});

it('hides internal error details from the client on unexpected failures', async () => {
  const { app, headers } = await project({ readOnly: true, port: 44351 });
  app.get('/api/test-error', async () => { throw new Error('C:\\secret\\path'); });
  const response = await app.inject({ url: '/api/test-error', headers });
  expect(response.statusCode).toBe(500);
  expect(response.json().message).toBe('Could not complete the action.');
  expect(response.body).not.toContain('C:\\secret\\path');
});

it('requires the session token on every mutating route', async () => {
  const { app, headers } = await project({ readOnly: false, port: 44344 });
  const snapshot = (await app.inject({ url: '/api/snapshot', headers })).json();
  const authorized = { ...headers, 'x-deckmate-token': snapshot.token };
  const mutations: Array<[string, object]> = [
    ['/api/planning', { action: 'set-milestones', milestones: [], source: 'sandbox', manifestHash: '' }],
    ['/api/notifications/dismiss', { source: 'sandbox', memberId: 'glm', at: '2026-11-06T00:00:00.000Z' }],
    ['/api/notifications/watch', { source: 'sandbox', memberId: 'glm', cardId: cardId, watching: true, watchHash: '0'.repeat(64) }],
    ['/api/boards', { source: 'sandbox', title: 'Flow', hash: '', scene: { type: 'excalidraw', version: 2, appState: {}, files: {}, elements: [] } }],
    ['/api/catalog', { action: 'create-track', title: 'Путь', description: '', manifestHash: '', source: 'sandbox' }],
    ['/api/catalog-import', { source: 'sandbox', manifestHash: '', optionsHash: '', deckId: 'audio', cards: [] }],
    ['/api/shutdown', {}],
  ];
  for (const [url, payload] of mutations) {
    expect((await app.inject({ method: 'POST', url, headers, payload })).statusCode, url).toBe(403);
    expect((await app.inject({ method: 'POST', url, headers: { ...headers, 'x-deckmate-token': 'not-the-token' }, payload })).statusCode, url).toBe(403);
    expect((await app.inject({ method: 'POST', url, headers: { ...authorized, origin: 'https://evil.example' }, payload })).statusCode, url).toBe(403);
  }
});

it('upgrades the event WebSocket only for the local origin with the session token', { timeout: 15000 }, async () => {
  const port = await freePort();
  const { app, headers } = await project({ readOnly: true, port });
  await app.listen({ host: '127.0.0.1', port });
  const token = (await app.inject({ url: '/api/snapshot', headers })).json().token;
  const open = (socket: WebSocket) => new Promise<'open' | 'failed'>(resolve => {
    socket.once('open', () => resolve('open'));
    socket.once('error', () => resolve('failed'));
  });
  const wrongToken = new WebSocket(`ws://127.0.0.1:${port}/api/events?token=wrong`);
  expect(await open(wrongToken)).toBe('failed');
  const foreignOrigin = new WebSocket(`ws://127.0.0.1:${port}/api/events?token=${token}`, { headers: { origin: 'https://evil.example' } });
  expect(await open(foreignOrigin)).toBe('failed');
  const foreignHost = new WebSocket(`ws://127.0.0.1:${port}/api/events?token=${token}`, { headers: { host: 'evil.example' } });
  expect(await open(foreignHost)).toBe('failed');
  const honest = new WebSocket(`ws://127.0.0.1:${port}/api/events?token=${token}`);
  expect(await open(honest)).toBe('open');
  honest.close();
});

it('destroys the upgrade socket for a malformed URL without throwing or stopping the server', async () => {
  const { app, headers } = await project({ readOnly: true, port: 44352 });
  const socket = { destroy: vi.fn() };
  expect(() => app.server.emit('upgrade', { url: '//[', headers }, socket, Buffer.alloc(0))).not.toThrow();
  expect(socket.destroy).toHaveBeenCalledOnce();
  expect((await app.inject({ url: '/api/health', headers })).statusCode).toBe(200);
});

it('returns 409 for stale import options before writing cards', async () => {
  const { root, app, headers } = await project({ readOnly: false, port: 44353 });
  const snapshot = (await app.inject({ url: '/api/snapshot', headers })).json();
  const catalog = await readProjectCatalog(root);
  const response = await app.inject({ method: 'POST', url: '/api/catalog-import',
    headers: { ...headers, 'x-deckmate-token': snapshot.token },
    payload: { source: 'sandbox', manifestHash: catalog.manifestHash, optionsHash: '0'.repeat(64), deckId: 'audio',
      cards: [{ cardId: null, kind: 'task', title: 'Import', markdown: '', owner: null, effort: null, priority: null, state: null, tags: [] }] } });
  expect(response.statusCode).toBe(409);
  await expect(readdir(path.join(root, 'cards'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('types attachments by content and keeps honest uploads working', async () => {
  const { root, app, headers } = await project({ readOnly: false, port: 44345 });
  const snapshot = (await app.inject({ url: '/api/snapshot', headers })).json();
  const authorized = { ...headers, 'x-deckmate-token': snapshot.token };
  const upload = async (dataUrl: string) => (await app.inject({ method: 'POST', url: '/api/catalog', headers: authorized,
    payload: { action: 'upload-attachment', manifestHash: '', source: 'sandbox', cardId, attachmentsHash: '', dataUrl, fileName: null, addedBy: null } })).statusCode;
  // The JPEG magic bytes do not match the declared PNG Data URL.
  expect(await upload(`data:image/png;base64,${Buffer.from([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1]).toString('base64')}`)).toBe(422);
  // HTML and SVG never pass as attachments regardless of the declared type.
  expect(await upload(`data:image/png;base64,${Buffer.from('<svg onload="alert(1)"><script>alert(2)</script>').toString('base64')}`)).toBe(422);
  expect(await upload(`data:image/png;base64,${png.toString('base64')}`)).toBe(200);
  const attachments = (await app.inject({ url: '/api/attachments?cardId=' + encodeURIComponent(cardId), headers })).json();
  expect(attachments).not.toHaveProperty('cover');
  expect(attachments.files).toHaveLength(1);
  expect(attachments.files[0].mime).toBe('image/png');
  const stored = await readFile(path.join(root, attachments.files[0].file));
  expect(stored.equals(png)).toBe(true);
});

it('rejects the retired card cover action without creating an attachment registry', async () => {
  const { root, app, headers } = await project({ readOnly: false, port: 44363 });
  const snapshot = (await app.inject({ url: '/api/snapshot', headers })).json();
  const response = await app.inject({ method: 'POST', url: '/api/catalog', headers: { ...headers, 'x-deckmate-token': snapshot.token },
    payload: { action: 'set-card-cover', source: 'sandbox', manifestHash: '', cardId, attachmentsHash: '',
      coverFile: null, coverPosition: 50, coverTitleMode: 'light', coverBlur: false } });
  expect(response.statusCode).toBe(400);
  await expect(readdir(path.join(root, 'tasks/deckmate-assets/cards'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('decodeAttachment rejects oversize and noncanonical base64 without touching the filesystem', async () => {
  const tooLarge = Buffer.alloc(10 * 1024 * 1024 + 1, 7).toString('base64');
  expect(() => decodeAttachment(`data:image/png;base64,${tooLarge}`)).toThrow();
  expect(() => decodeAttachment(`data:image/png;base64,${png.toString('base64').slice(0, -2)}`)).toThrow();
  expect(() => decodeAttachment(`data:image/png;base64,${png.toString('base64')}=`)).toThrow();
  expect(decodeAttachment(`data:image/png;base64,${png.toString('base64')}`).extension).toBe('png');
});

it('keeps the static client folder refusing escapes and malformed escapes', async () => {
  const { app, headers } = await project({ readOnly: true, port: 44346 });
  // Without a client build every page is 404; escapes must never turn into a 500 or a file read.
  // A malformed percent escape is refused by the router itself (400) or the handler (404).
  expect([400, 404]).toContain((await app.inject({ url: '/%E0%A4%A', headers })).statusCode);
  const escape = await app.inject({ url: '/' + encodeURIComponent('..\\..\\package.json'), headers });
  expect(escape.statusCode).toBe(404);
  expect(escape.rawPayload.toString('utf8')).not.toContain('"dependencies"');
  const deep = await app.inject({ url: '/..%2F..%2F..%2Fetc%2Fpasswd', headers });
  expect(deep.statusCode).toBeLessThan(500);
  expect(deep.rawPayload.toString('utf8')).not.toContain('root:');
});

it('resolves card content only inside the project', async () => {
  const { app, headers } = await project({ readOnly: true, port: 44347 });
  const hostile = ['doc:../outside.md', 'doc:features/../../outside.md', 'task:../features/match.md#1.0',
    'hero:..\\..\\outside.md#1', 'doc:/etc/passwd', 'card:00000000-0000-4000-8000-000000000000'];
  for (const cardId of hostile) {
    const response = await app.inject({ url: '/api/card-content?cardId=' + encodeURIComponent(cardId), headers });
    expect(response.statusCode, cardId).toBe(404);
  }
  const honest = await app.inject({ url: '/api/card-content?cardId=' + encodeURIComponent('doc:features/match.md'), headers });
  expect(honest.statusCode).toBe(200);
});

it('answers 400 for a card identifier that cannot name attachments', async () => {
  const { app, headers } = await project({ readOnly: true, port: 44348 });
  const hostile = await app.inject({ url: '/api/attachments?cardId=' + encodeURIComponent('../../etc/passwd'), headers });
  expect(hostile.statusCode).toBe(400);
  const honest = await app.inject({ url: '/api/attachments?cardId=' + encodeURIComponent('card:00000000-0000-4000-8000-000000000000'), headers });
  expect(honest.statusCode).toBe(200);
  expect(honest.json().files).toEqual([]);
});

it('enforces the catalog body limit for authorized requests', async () => {
  const { app, headers } = await project({ readOnly: false, port: 44349 });
  const snapshot = (await app.inject({ url: '/api/snapshot', headers })).json();
  const authorized = { ...headers, 'x-deckmate-token': snapshot.token, 'content-type': 'application/json' };
  const oversized = await app.inject({ method: 'POST', url: '/api/catalog', headers: authorized,
    payload: JSON.stringify({ action: 'create-track', title: 'a'.repeat(17 * 1024 * 1024), manifestHash: '', source: 'sandbox' }) });
  expect(oversized.statusCode).toBe(413);
});

it('answers a ranged read of a non-card file under cards/ with a client error', async () => {
  const { root, app, headers } = await project({ readOnly: true, port: 44360 });
  await mkdir(path.join(root, 'cards'), { recursive: true });
  await writeFile(path.join(root, 'cards/notes.md'), '# Notes\n');
  expect((await app.inject({ url: '/api/file?path=cards/notes.md', headers })).statusCode).toBe(200);
  const ranged = await app.inject({ url: '/api/file?path=cards/notes.md&from=1&to=1', headers });
  expect(ranged.statusCode).toBe(422);
  expect(ranged.json().message).toBeTruthy();
});

it('does not send filesystem paths from a failed catalog write to the client', async () => {
  const { app, headers } = await project({ readOnly: false, port: 44361 });
  const snapshot = (await app.inject({ url: '/api/snapshot', headers })).json();
  const secret = String.raw`C:\secret\project\tasks\deckmate.md`;
  const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const catalogModule = await import('../server/catalog.ts');
  const failure = vi.spyOn(catalogModule, 'editProjectCatalog').mockRejectedValue(Object.assign(new Error(`EACCES: permission denied, open '${secret}'`), { code: 'EACCES', errno: -13, syscall: 'open' }));
  try {
    const response = await app.inject({ method: 'POST', url: '/api/catalog', headers: { ...headers, 'x-deckmate-token': snapshot.token },
      payload: { action: 'create-track', title: 'Путь', description: '', manifestHash: '', source: 'sandbox' } });
    expect(response.statusCode).toBe(422);
    expect(response.body).not.toContain(secret);
    expect(spy).toHaveBeenCalled();
  } finally { failure.mockRestore(); spy.mockRestore(); }
});
