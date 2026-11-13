import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';

const paths = vi.hoisted(() => ({ client: '' }));
vi.mock('../server/package-path.ts', async importOriginal => {
  const original = await importOriginal<typeof import('../server/package-path.ts')>();
  return { packagePath: (...parts: string[]) => parts.join('/') === 'dist/client' ? paths.client : original.packagePath(...parts) };
});

let directory: string;
let data: string;
let app: FastifyInstance;
const headers = { host: '127.0.0.1:44318' };
const fileUrl = '/api/file?source=sandbox&path=tasks%2Fcover.webp';
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'deckmate-image-cache-'));
  paths.client = path.join(directory, 'client');
  data = path.join(directory, 'data');
  await mkdir(path.join(paths.client, 'assets'), { recursive: true });
  await mkdir(path.join(data, 'tasks'), { recursive: true });
  await writeFile(path.join(data, 'tasks/cover.webp'), await readFile('assets/deck-art/buildings.webp'));
  await writeFile(path.join(data, 'tasks/note.md'), '# Note\n');
  await writeFile(path.join(paths.client, 'assets/buildings-abcdefgh.webp'), await readFile('assets/deck-art/buildings.webp'));
  await writeFile(path.join(paths.client, 'index.html'), '<!doctype html><title>Images</title>');
  const { createApp } = await import('../server/app.ts');
  app = await createApp({ editMode: 'read-only', dataRoot: data, writeRoot: null, projectName: 'Images', port: 44318, python: 'python' }, { deferStartup: true });
});
afterAll(async () => {
  await app?.close();
  if (directory) await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

it('revalidates project images, sends no body for matching ETags, and detects edits and deletion', async () => {
  const original = await app.inject({ url: fileUrl, headers });
  expect(original.statusCode).toBe(200);
  expect(original.headers['cache-control']).toBe('private, no-cache');
  const etag = original.headers.etag as string;
  expect(etag).toMatch(/^"[a-f0-9]{64}"$/u);
  for (const condition of [etag, `"other", W/${etag}`, '*']) {
    const cached = await app.inject({ url: fileUrl, headers: { ...headers, 'if-none-match': condition } });
    expect(cached.statusCode).toBe(304);
    expect(cached.body).toBe('');
    expect(cached.headers.etag).toBe(etag);
    expect(cached.headers['cache-control']).toBe(original.headers['cache-control']);
    expect(cached.headers['content-security-policy']).toBe(original.headers['content-security-policy']);
  }
  await writeFile(path.join(data, 'tasks/cover.webp'), await readFile('assets/deck-art/art.webp'));
  const changed = await app.inject({ url: fileUrl, headers: { ...headers, 'if-none-match': etag } });
  expect(changed.statusCode).toBe(200);
  expect(changed.headers.etag).not.toBe(etag);
  expect(changed.rawPayload).not.toEqual(original.rawPayload);
  await rm(path.join(data, 'tasks/cover.webp'));
  expect((await app.inject({ url: fileUrl, headers: { ...headers, 'if-none-match': '*' } })).statusCode).toBe(404);
});

it('caches fingerprinted bundled artwork immutably without caching Markdown or the HTML shell', async () => {
  const url = '/assets/buildings-abcdefgh.webp';
  const image = await app.inject({ url, headers });
  expect(image.statusCode).toBe(200);
  expect(image.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  const cached = await app.inject({ url, headers: { ...headers, 'if-none-match': image.headers.etag as string } });
  expect(cached.statusCode).toBe(304);
  expect(cached.body).toBe('');
  for (const url of ['/', '/api/file?path=tasks%2Fnote.md']) {
    const text = await app.inject({ url, headers: { ...headers, 'if-none-match': '*' } });
    expect(text.statusCode).toBe(200);
    expect(text.headers.etag).toBeUndefined();
    expect(text.headers['cache-control']).toBeUndefined();
  }
});
