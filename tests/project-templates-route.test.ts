import { afterEach, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { registerRequestLang } from '../server/i18n.ts';
import { createProjectTemplateList, type ProjectTemplateOptions } from '../server/project-templates.ts';
import { registerProjectTemplatesRoute } from '../server/project-templates-route.ts';

vi.mock('node:fs/promises', async importOriginal => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return { ...original, readFile: vi.fn(original.readFile), readdir: vi.fn(original.readdir), lstat: vi.fn(original.lstat) };
});

const packageRoots = vi.hoisted(() => ({ art: '', clientAssets: '' }));
vi.mock('../server/package-path.ts', async importOriginal => {
  const original = await importOriginal<typeof import('../server/package-path.ts')>();
  const { default: paths } = await import('node:path');
  return { ...original, packagePath: (...segments: string[]) => {
    if (packageRoots.art && segments[0] === 'assets' && segments[1] === 'deck-art') {
      return paths.join(packageRoots.art, ...segments.slice(2));
    }
    if (packageRoots.clientAssets && segments.slice(0, 3).join('/') === 'dist/client/assets') {
      return paths.join(packageRoots.clientAssets, ...segments.slice(3));
    }
    return original.packagePath(...segments);
  } };
});

const roots: string[] = [];
const applications: FastifyInstance[] = [];

afterEach(async () => {
  for (const app of applications.splice(0)) await app.close();
  vi.restoreAllMocks();
  packageRoots.art = '';
  packageRoots.clientAssets = '';
  for (const root of roots.splice(0)) {
    if (path.dirname(root) !== path.resolve(tmpdir()) || !path.basename(root).startsWith('deckmate-template-route-')) {
      throw new Error('Unsafe template-route test cleanup target.');
    }
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'deckmate-template-route-'));
  roots.push(root);
  const options = { templatesRoot: path.join(root, 'templates'), journeysRoot: path.join(root, 'journeys'), artRoot: path.join(root, 'art') };
  await mkdir(options.artRoot);
  await Promise.all([
    cp('tests/fixtures/project-templates', options.templatesRoot, { recursive: true }),
    cp('tests/fixtures/journey-templates', options.journeysRoot, { recursive: true }),
    cp('assets/deck-art/units.webp', path.join(options.artRoot, 'units.webp')),
  ]);
  return { root, options };
}

function open(options: ProjectTemplateOptions): FastifyInstance {
  const app = Fastify();
  applications.push(app);
  registerRequestLang(app);
  registerProjectTemplatesRoute(app, options);
  return app;
}

function clearReads(): void {
  vi.mocked(readFile).mockClear();
  vi.mocked(readdir).mockClear();
  vi.mocked(lstat).mockClear();
}

it('shares a cold load and reuses the assembled list without rereading file contents', async () => {
  const { options } = await fixture();
  const list = createProjectTemplateList(options);
  clearReads();
  const results = await Promise.all(Array.from({ length: 8 }, () => list()));
  expect(results[0].map(template => template.id)).toEqual(['fixture']);
  expect(results.every(result => result === results[0])).toBe(true);
  expect(vi.mocked(readFile).mock.calls.filter(([filename]) => path.basename(String(filename)) === 'fixture.md')).toHaveLength(1);
  clearReads();
  expect(await list()).toBe(results[0]);
  expect(readFile).not.toHaveBeenCalled();
  expect(lstat).toHaveBeenCalled();
});

it('serves identical cached GET and HEAD responses without rereading template, Journey or cover contents', async () => {
  const { options } = await fixture();
  const app = open(options);
  const first = await app.inject({ url: '/api/project-templates' });
  expect(first.statusCode, first.body).toBe(200);
  clearReads();
  const second = await app.inject({ url: '/api/project-templates' });
  const head = await app.inject({ method: 'HEAD', url: '/api/project-templates' });
  expect(second.statusCode).toBe(200);
  expect(second.body).toBe(first.body);
  expect(head.statusCode).toBe(200);
  expect(head.body).toBe('');
  expect(head.headers['content-length']).toBe(first.headers['content-length']);
  expect(readFile).not.toHaveBeenCalled();
});

it.each(['mtime', 'size'] as const)('refreshes the list after a template %s change', async change => {
  const { options } = await fixture();
  const filename = path.join(options.templatesRoot, 'fixture.md');
  const original = await readFile(filename, 'utf8');
  const timestamp = new Date('2026-11-13T00:00:00Z');
  await utimes(filename, timestamp, timestamp);
  const list = createProjectTemplateList(options);
  const first = await list();
  const title = change === 'mtime' ? 'Changed' : 'A longer title';
  await writeFile(filename, original.replace('title: Fixture', `title: ${title}`));
  const updatedAt = change === 'mtime' ? new Date(timestamp.getTime() + 2000) : timestamp;
  await utimes(filename, updatedAt, updatedAt);
  const refreshed = await list();
  expect(refreshed).not.toBe(first);
  expect(refreshed[0].title).toBe(title);
  expect(refreshed[0].fileHash).not.toBe(first[0].fileHash);
});

it('detects added and removed templates, including a directory created after an empty response', async () => {
  const { root, options } = await fixture();
  const original = await readFile(path.join(options.templatesRoot, 'fixture.md'), 'utf8');
  options.templatesRoot = path.join(root, 'later');
  const list = createProjectTemplateList(options);
  expect(await list()).toEqual([]);
  await mkdir(options.templatesRoot);
  await writeFile(path.join(options.templatesRoot, 'fixture.md'), original);
  expect((await list()).map(template => template.id)).toEqual(['fixture']);
  const added = path.join(options.templatesRoot, 'added.md');
  await writeFile(added, original.replace('id: fixture', 'id: added'));
  expect((await list()).map(template => template.id)).toEqual(['added', 'fixture']);
  await rm(added);
  expect((await list()).map(template => template.id)).toEqual(['fixture']);
});

it.each(['index.md', 'steps/implement.md'])('invalidates a changed Journey %s and retries after repair', async relative => {
  const { options } = await fixture();
  const list = createProjectTemplateList(options);
  const first = await list();
  const filename = path.join(options.journeysRoot, 'fixture-units', relative);
  const original = await readFile(filename);
  await writeFile(filename, 'Invalid Journey template.');
  await expect(list()).rejects.toThrow('Bundled Journey template is missing or invalid');
  await writeFile(filename, original);
  expect(await list()).toEqual(first);
});

it('invalidates changed and removed covers and recovers after repair', async () => {
  const { options } = await fixture();
  const list = createProjectTemplateList(options);
  const first = await list();
  const filename = path.join(options.artRoot, 'units.webp');
  const original = await readFile(filename);
  await writeFile(filename, 'Invalid WebP image.');
  await expect(list()).rejects.toThrow();
  await rm(filename);
  await expect(list()).rejects.toMatchObject({ code: 'ENOENT' });
  await writeFile(filename, original);
  expect(await list()).toEqual(first);
});

it('tracks packaged covers and switches to source artwork when it appears', async () => {
  const { root, options } = await fixture();
  packageRoots.art = path.join(root, 'source-art');
  packageRoots.clientAssets = path.join(root, 'client-assets');
  await mkdir(packageRoots.clientAssets);
  const packaged = path.join(packageRoots.clientAssets, 'units-bundled.webp');
  const original = await readFile(path.join(options.artRoot, 'units.webp'));
  await writeFile(packaged, original);
  const list = createProjectTemplateList({ templatesRoot: options.templatesRoot, journeysRoot: options.journeysRoot });
  const first = await list();
  clearReads();
  expect(await list()).toBe(first);
  expect(readFile).not.toHaveBeenCalled();
  await writeFile(packaged, 'Invalid packaged WebP image.');
  await expect(list()).rejects.toThrow();
  await mkdir(packageRoots.art);
  await writeFile(path.join(packageRoots.art, 'units.webp'), original);
  expect(await list()).toEqual(first);
});

it('limits combined GET/HEAD bursts before filesystem work and returns localized 429 with Retry-After', async () => {
  const { options } = await fixture();
  const clock = vi.spyOn(performance, 'now').mockReturnValue(1000);
  const app = open(options);
  const burst = await Promise.all(Array.from({ length: 120 }, (_, index) => app.inject({
    method: index % 2 ? 'HEAD' : 'GET', url: '/api/project-templates',
  })));
  expect(burst.every(response => response.statusCode === 200)).toBe(true);
  clearReads();
  const blocked = await app.inject({ url: '/api/project-templates?fresh=1',
    headers: { cookie: 'deckmate-lang=ru', 'x-forwarded-for': '192.0.2.1' } });
  expect(blocked.statusCode).toBe(429);
  expect(blocked.headers['retry-after']).toBe('60');
  expect(blocked.json()).toEqual({ message: 'Слишком много запросов шаблонов. Повторите попытку чуть позже.' });
  const english = await app.inject({ url: '/api/project-templates' });
  expect(english.statusCode).toBe(429);
  expect(english.json()).toEqual({ message: 'Too many template requests. Try again shortly.' });
  clock.mockReturnValue(60_500);
  const head = await app.inject({ method: 'HEAD', url: '/api/project-templates' });
  expect(head.statusCode).toBe(429);
  expect(head.headers['retry-after']).toBe('1');
  expect(head.body).toBe('');
  expect(readFile).not.toHaveBeenCalled();
  expect(readdir).not.toHaveBeenCalled();
  expect(lstat).not.toHaveBeenCalled();
  clock.mockReturnValue(61_000);
  const recovered = await app.inject({ url: '/api/project-templates' });
  expect(recovered.statusCode).toBe(200);
  expect(recovered.headers['retry-after']).toBeUndefined();
  expect(readFile).not.toHaveBeenCalled();
});

it('allows frequent dialog reopenings across multiple windows', async () => {
  const { options } = await fixture();
  const clock = vi.spyOn(performance, 'now').mockReturnValue(1000);
  const app = open(options);
  for (let index = 0; index < 180; index += 1) {
    clock.mockReturnValue(1000 + index * 2000);
    const response = await app.inject({ url: '/api/project-templates' });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers['retry-after']).toBeUndefined();
  }
});
