import { afterEach, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../server/app.ts';
import { Repository } from '../server/repository.ts';
import { CatalogService } from '../server/catalog-service.ts';
import { ProjectIndex } from '../server/project-index.ts';
import * as fileEvents from '../server/file-events.ts';
import * as discovery from '../server/server-discovery.ts';
import type { ServerConfig } from '../server/config.ts';

vi.mock('../server/package-path.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../server/package-path.ts')>();
  return { packagePath: (...segments: string[]) => {
    // 2026-11-12: unit runs precede the client build; the source shell exercises the same static-file handler.
    if (segments.join('/') === 'dist/client') return actual.packagePath('client');
    return actual.packagePath(...segments);
  } };
});

const directories: string[] = [];
const apps: FastifyInstance[] = [];
const releases: Array<() => void> = [];

function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  releases.push(release);
  return { promise, release };
}

async function fixture(): Promise<ServerConfig> {
  const directory = await mkdtemp(path.join(tmpdir(), 'deckmate-startup-'));
  directories.push(directory);
  vi.stubEnv('DECKMATE_INDEX', path.join(directory, 'index'));
  vi.stubEnv('DECKMATE_COORDINATION', path.join(directory, 'coordination'));
  const root = path.join(directory, 'project');
  await mkdir(path.join(root, 'features'), { recursive: true });
  await writeFile(path.join(root, 'features/work.md'), '# Work\n### 1.0 Searchable task\nOriginal body.\n');
  return { editMode: 'read-only', dataRoot: root, writeRoot: null, port: 4317, python: 'python', projectName: 'Startup' };
}

afterEach(async () => {
  for (const release of releases.splice(0)) release();
  for (const app of apps.splice(0)) await app.close();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

it('listens and serves the shell and health before project checks, watching and indexing finish', async () => {
  const config = await fixture();
  const startup = gate();
  const watching = gate();
  const initialize = vi.spyOn(Repository.prototype, 'initialize').mockImplementation(() => startup.promise);
  vi.spyOn(fileEvents, 'watchProjectFiles').mockImplementation(() => ({ ready: watching.promise, close: async () => watching.release() }));
  const replace = vi.spyOn(ProjectIndex.prototype, 'replace');
  const register = vi.spyOn(discovery, 'registerRunningServer');
  const onStartupError = vi.fn();
  const app = await createApp(config, { deferStartup: true, onStartupError });
  apps.push(app);
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const headers = { host: new URL(address).host };
  const health = await fetch(address + '/api/health');
  expect(health.status).toBe(200);
  expect(await health.json()).toMatchObject({ app: 'Deckmate', pid: process.pid });
  expect(initialize).not.toHaveBeenCalled();
  expect(replace).not.toHaveBeenCalled();
  const shell = await app.inject({ url: '/', headers });
  expect(shell.statusCode).toBe(200);
  expect(shell.body).toContain('<html');
  expect((await app.inject({ url: '/api/catalog', headers: { host: 'foreign.invalid' } })).statusCode).toBe(403);
  expect(initialize).not.toHaveBeenCalled();

  let completed = false;
  const catalog = app.inject({ url: '/api/catalog', headers }).then(response => { completed = true; return response; });
  const search = app.inject({ url: '/api/cards?text=Searchable&kind=task', headers });
  await vi.waitFor(() => expect(initialize).toHaveBeenCalledTimes(1));
  expect(completed).toBe(false);
  expect((await app.inject({ url: '/api/health', headers })).statusCode).toBe(200);
  expect(replace).not.toHaveBeenCalled();
  startup.release();
  watching.release();
  const [view, cards] = await Promise.all([catalog, search]);
  expect(view.statusCode, view.body).toBe(200);
  expect(cards.statusCode, cards.body).toBe(200);
  expect(cards.json().map((card: { title: string }) => card.title)).toEqual(['Searchable task']);
  expect(replace).toHaveBeenCalledTimes(1);
  expect(register).not.toHaveBeenCalled();
  expect(onStartupError).not.toHaveBeenCalled();
  expect(await readdir(config.dataRoot)).toEqual(['features']);
});

it('reports a deferred initialization failure once with its original cause after HTTP readiness', async () => {
  const config = await fixture();
  const startup = gate();
  const failure = new Error('The path is outside the project.');
  const initialize = vi.spyOn(Repository.prototype, 'initialize').mockImplementation(async () => {
    await startup.promise;
    throw failure;
  });
  const onStartupError = vi.fn();
  const app = await createApp(config, { deferStartup: true, onStartupError });
  apps.push(app);
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const headers = { host: new URL(address).host };
  expect((await app.inject({ url: '/', headers })).statusCode).toBe(200);
  expect(initialize).not.toHaveBeenCalled();
  const requests = Promise.all(['/api/catalog', '/api/snapshot', '/api/cards'].map(url => app.inject({ url, headers })));
  await vi.waitFor(() => expect(initialize).toHaveBeenCalledTimes(1));
  expect(onStartupError).not.toHaveBeenCalled();
  expect((await app.inject({ url: '/api/health', headers })).statusCode).toBe(200);
  startup.release();
  for (const response of await requests) {
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain(failure.message);
  }
  expect((await app.inject({ url: '/api/catalog', headers })).statusCode).toBe(500);
  expect(onStartupError).toHaveBeenCalledExactlyOnceWith(failure);
  expect(initialize).toHaveBeenCalledTimes(1);
  expect((await app.inject({ url: '/api/health', headers })).statusCode).toBe(200);
});

it.each(['snapshot', 'catalog'] as const)('reports a failed first %s read after initialization', async step => {
  const config = await fixture();
  const failure = new Error('Project data could not be read.');
  if (step === 'snapshot') vi.spyOn(Repository.prototype, 'snapshot').mockRejectedValue(failure);
  else vi.spyOn(CatalogService.prototype, 'get').mockRejectedValue(failure);
  const onStartupError = vi.fn();
  const app = await createApp(config, { deferStartup: true, onStartupError });
  apps.push(app);
  const headers = { host: '127.0.0.1:4317' };
  const other = step === 'snapshot' ? 'catalog' : 'snapshot';
  expect((await app.inject({ url: `/api/${other}`, headers })).statusCode).toBe(200);
  const responses = await Promise.all([1, 2].map(() => app.inject({ url: `/api/${step}`, headers })));
  expect(responses.map(response => response.statusCode)).toEqual([500, 500]);
  expect(onStartupError).toHaveBeenCalledExactlyOnceWith(failure);
});

it.each(['snapshot', 'catalog'] as const)('keeps later %s read failures in the API after a successful first read', async step => {
  const config = await fixture();
  const onStartupError = vi.fn();
  const app = await createApp(config, { deferStartup: true, onStartupError });
  apps.push(app);
  const headers = { host: '127.0.0.1:4317' };
  expect((await app.inject({ url: `/api/${step}`, headers })).statusCode).toBe(200);
  const failure = new Error('A later read failed.');
  if (step === 'snapshot') vi.spyOn(Repository.prototype, 'snapshot').mockRejectedValue(failure);
  else vi.spyOn(CatalogService.prototype, 'get').mockRejectedValue(failure);
  expect((await app.inject({ url: `/api/${step}`, headers })).statusCode).toBe(500);
  expect(onStartupError).not.toHaveBeenCalled();
});

it('closes a watcher whose initial scan is still pending without opening the catalog', async () => {
  const config = await fixture();
  const watching = gate();
  const close = vi.fn(async () => watching.release());
  const watch = vi.spyOn(fileEvents, 'watchProjectFiles').mockImplementation(() => ({ ready: watching.promise, close }));
  const replace = vi.spyOn(ProjectIndex.prototype, 'replace');
  const app = await createApp(config, { deferStartup: true });
  apps.push(app);
  await app.listen({ host: '127.0.0.1', port: 0 });
  await vi.waitFor(() => expect(watch).toHaveBeenCalledTimes(1));
  await app.close();
  expect(close).toHaveBeenCalledTimes(1);
  expect(replace).not.toHaveBeenCalled();
});

it('drains a catalog request waiting for the initial scan when shutdown starts', async () => {
  const config = await fixture();
  const watching = gate();
  const close = vi.fn(async () => watching.release());
  vi.spyOn(fileEvents, 'watchProjectFiles').mockImplementation(() => ({ ready: watching.promise, close }));
  const initialize = vi.spyOn(Repository.prototype, 'initialize');
  const app = await createApp(config, { deferStartup: true });
  apps.push(app);
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const request = fetch(address + '/api/catalog').then(async response => ({ status: response.status, body: await response.json() }));
  await vi.waitFor(() => expect(initialize).toHaveBeenCalledTimes(1));
  const closing = app.close();
  const response = await request;
  await closing;
  expect(response.status).toBe(200);
  expect(response.body.cards.some((card: { title: string }) => card.title === 'Searchable task')).toBe(true);
  expect(close).toHaveBeenCalledTimes(1);
});

it('keeps health available while concurrent catalog and search requests wait for one index', async () => {
  const config = await fixture();
  const indexing = gate();
  const service = CatalogService.prototype as unknown as { openIndex(root: string): Promise<ProjectIndex> };
  const open = service.openIndex;
  const openIndex = vi.spyOn(service, 'openIndex').mockImplementation(async function (this: typeof service, root) {
    await indexing.promise;
    return open.call(this, root);
  });
  const replace = vi.spyOn(ProjectIndex.prototype, 'replace');
  const app = await createApp(config, { deferStartup: true });
  apps.push(app);
  const headers = { host: '127.0.0.1:4317' };
  const pending = [app.inject({ url: '/api/catalog', headers }), app.inject({ url: '/api/cards?text=Searchable&kind=task', headers })];
  const responses = Promise.all(pending);
  await vi.waitFor(() => expect(openIndex).toHaveBeenCalledTimes(1));
  expect((await app.inject({ url: '/api/health', headers })).statusCode).toBe(200);
  expect((await app.inject({ url: '/', headers })).statusCode).toBe(200);
  expect(replace).not.toHaveBeenCalled();
  indexing.release();
  const [catalog, search] = await responses;
  expect(catalog.statusCode, catalog.body).toBe(200);
  expect(search.statusCode, search.body).toBe(200);
  expect(search.json()).toHaveLength(1);
  expect(replace).toHaveBeenCalledTimes(1);
});

it('registers a writable server after listening and awaits late registration cleanup on close', async () => {
  const config = await fixture();
  const registration = gate();
  const cleanup = vi.fn(async () => {});
  const register = vi.spyOn(discovery, 'registerRunningServer').mockImplementationOnce(async () => {
    await registration.promise;
    return cleanup;
  });
  const app = await createApp({ ...config, editMode: 'direct', writeRoot: config.dataRoot }, { deferStartup: true });
  apps.push(app);
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const response = await fetch(address + '/api/health');
  expect(response.status).toBe(200);
  await response.json();
  await vi.waitFor(() => expect(register).toHaveBeenCalledTimes(1));
  expect(register).toHaveBeenCalledWith(expect.objectContaining({ editMode: 'direct' }), config.dataRoot, Number(new URL(address).port), expect.any(String));
  let closed = false;
  const closing = app.close().then(() => { closed = true; });
  expect(closed).toBe(false);
  registration.release();
  await closing;
  expect(cleanup).toHaveBeenCalledTimes(1);
});

it('falls back to fresh catalog reads after the initial watcher scan fails', async () => {
  const config = await fixture();
  const close = vi.fn(async () => {});
  vi.spyOn(fileEvents, 'watchProjectFiles').mockImplementation(() => ({ ready: Promise.reject(new Error('Watch unavailable')), close }));
  const onStartupError = vi.fn();
  const app = await createApp(config, { deferStartup: true, onStartupError });
  apps.push(app);
  const headers = { host: '127.0.0.1:4317' };
  const first = await app.inject({ url: '/api/catalog', headers });
  expect(first.statusCode, first.body).toBe(200);
  expect(first.json().warnings.join(' ')).toContain('File watching has stopped');
  const filename = path.join(config.dataRoot, 'features/work.md');
  await writeFile(filename, (await readFile(filename, 'utf8')).replace('Original body.', 'Changed while unwatched.'));
  const search = await app.inject({ url: '/api/cards?text=unwatched&kind=task', headers });
  expect(search.statusCode, search.body).toBe(200);
  expect(search.json()).toHaveLength(1);
  expect(onStartupError).not.toHaveBeenCalled();
});
