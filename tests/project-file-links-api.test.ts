import { afterEach, expect, it, vi } from 'vitest';
import { link, mkdir, readFile, symlink, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../server/app.ts';
import { emptyManifest, readProjectCatalog, renderCatalogManifest } from '../server/catalog.ts';
import type { ServerConfig } from '../server/config.ts';
import { applyAttachmentEdit, readCardAttachments } from '../server/attachments.ts';
import { callAgentTool } from '../server/agent-ops.ts';
import { shortReference } from '../src/references.ts';
import { run as runAttach } from '../tools/commands/attach.ts';
import { run as runDetach } from '../tools/commands/detach.ts';
import { tempProjects } from './helpers/temp-projects.ts';

vi.mock('../server/launch-process.ts', () => ({ resolveSystemFileLauncher: vi.fn(async () => process.execPath) }));

const temps = tempProjects('deckmate-link-api-');
const apps: FastifyInstance[] = [];
const cardId = 'task:features/models.md#1.1';
const file = 'ArtSource/Birch.blend';
const headers = { host: '127.0.0.1:44319' };
const attach = { action: 'attach-project-file' as const, cardId, file, attachmentsHash: '', manifestHash: '', addedBy: null };

afterEach(async () => {
  vi.restoreAllMocks();
  for (const app of apps.splice(0)) await app.close();
  await temps.removeAll();
});

async function fixture(readOnly = false) {
  const root = await temps.create();
  for (const dir of ['tasks', 'features', 'ArtSource']) await mkdir(path.join(root, dir));
  await writeFile(path.join(root, 'features/models.md'), '\uFEFF# Models\r\n## 1 — Art\r\n### 1.1 Birch (план)\r\nOriginal body.\r\n');
  await writeFile(path.join(root, file), 'BLENDER');
  const manifest = emptyManifest();
  manifest.members = [{ id: 'worker', label: 'Worker', kind: 'agent', aliases: [] }];
  await writeFile(path.join(root, 'tasks/deckmate.md'), renderCatalogManifest(manifest));
  const config: ServerConfig = { dataRoot: root, writeRoot: readOnly ? null : root, editMode: readOnly ? 'read-only' : 'direct',
    projectName: 'Links test', port: 44319, python: 'python' };
  return { root, config };
}

async function connect(config: ServerConfig) {
  const launcher = vi.fn().mockResolvedValue(undefined);
  const app = await createApp(config, { fileLauncher: launcher });
  apps.push(app);
  const snapshot = (await app.inject({ url: '/api/snapshot', headers })).json();
  const authorized = { ...headers, 'x-deckmate-token': snapshot.token };
  const edit = (changes: Record<string, unknown> = {}) => app.inject({ method: 'POST', url: '/api/catalog', headers: authorized,
    payload: { source: 'sandbox', ...attach, ...changes } });
  const act = (action: 'open' | 'reveal', changes: Record<string, unknown> = {}, requestHeaders: Record<string, string> = authorized) =>
    app.inject({ method: 'POST', url: `/api/attachments/${action}`, headers: requestHeaders, payload: { source: 'sandbox', cardId, file, ...changes } });
  return { app, launcher, authorized, edit, act };
}

it('attaches with the actor, rejects stale hashes and detaches without changing card or target bytes', async () => {
  const { root, config } = await fixture();
  const { app, authorized, edit } = await connect(config);
  const before = await readFile(path.join(root, 'features/models.md'));
  const response = await app.inject({ method: 'POST', url: '/api/catalog', headers: { ...authorized, 'x-deckmate-actor': 'worker' },
    payload: { source: 'sandbox', ...attach, addedBy: 'other' } });
  expect(response.statusCode, response.body).toBe(200);
  let view = await readCardAttachments(root, cardId);
  expect(view.projectFiles![0].addedBy).toBe('worker');
  expect((await edit()).statusCode).toBe(409);
  expect((await edit({ action: 'detach-project-file' })).statusCode).toBe(409);
  expect((await edit({ action: 'detach-project-file', attachmentsHash: view.hash })).statusCode).toBe(200);
  view = await readCardAttachments(root, cardId);
  expect(view.projectFiles).toBeUndefined();
  expect(await readFile(path.join(root, 'features/models.md'))).toEqual(before);
  expect(await readFile(path.join(root, file), 'utf8')).toBe('BLENDER');
});

it('protects local launches against foreign origins/hosts and missing tokens; only attached files of this card open', async () => {
  const { config } = await fixture();
  const { app, launcher, authorized, edit, act } = await connect(config);
  expect((await act('open')).statusCode).toBe(404);
  expect((await edit()).statusCode).toBe(200);
  expect((await act('open', {}, headers as typeof authorized)).statusCode).toBe(403);
  expect((await act('open', {}, { ...authorized, origin: 'https://foreign.invalid' })).statusCode).toBe(403);
  expect((await act('reveal', {}, { ...authorized, host: 'foreign.invalid:44319' })).statusCode).toBe(403);
  expect((await act('open', { cardId: 'task:features/models.md#1.2' })).statusCode).toBe(404);
  expect((await act('open', { file: '../outside.blend' })).statusCode).toBe(404);
  expect(launcher).not.toHaveBeenCalled();
  for (const action of ['open', 'reveal'] as const) expect((await act(action)).statusCode).toBe(200);
  expect(launcher).toHaveBeenCalledTimes(2);
  expect(launcher.mock.calls.every(call => call[2].shell === false && Array.isArray(call[1]))).toBe(true);
  await app.inject({ method: 'GET', url: '/api/attachments/open', headers });
  expect(launcher).toHaveBeenCalledTimes(2);
});

it.each(['../outside.blend', '/absolute.blend', 'C:/outside.blend', 'missing.blend', 'ArtSource'])('HTTP refuses invalid project file %j', async file => {
  const { config } = await fixture();
  const { edit, launcher } = await connect(config);
  expect((await edit({ file })).statusCode).toBe(422);
  expect(launcher).not.toHaveBeenCalled();
});

it('rejects symlink/junction attach and a file replaced by a junction after attaching', async () => {
  const { root, config } = await fixture();
  const { edit, act, launcher } = await connect(config);
  await symlink(path.join(root, 'ArtSource'), path.join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  expect((await edit({ file: 'link/Birch.blend' })).statusCode).toBe(422);
  expect((await edit()).statusCode).toBe(200);
  await unlink(path.join(root, file));
  await symlink(path.join(root, 'tasks'), path.join(root, file), process.platform === 'win32' ? 'junction' : 'dir');
  expect((await act('open')).statusCode).toBe(404);
  expect((await act('reveal')).statusCode).toBe(404);
  expect(launcher).not.toHaveBeenCalled();
});

it('allows read-only open/reveal but denies attaching and detaching', async () => {
  const { root, config } = await fixture(true);
  await applyAttachmentEdit(root, attach);
  const { launcher, edit, act } = await connect(config);
  expect((await edit()).statusCode).toBe(403);
  expect((await edit({ action: 'detach-project-file', attachmentsHash: (await readCardAttachments(root, cardId)).hash })).statusCode).toBe(403);
  for (const action of ['open', 'reveal'] as const) expect((await act(action)).statusCode).toBe(200);
  expect((await act('open', { source: 'live' })).statusCode).toBe(200);
  expect(launcher).toHaveBeenCalledTimes(3);
});

it('reports launcher errors without changing the registry', async () => {
  const { root, config } = await fixture();
  const { launcher, edit, act } = await connect(config);
  expect((await edit()).statusCode).toBe(200);
  const before = await readCardAttachments(root, cardId);
  launcher.mockRejectedValue(new Error('Launch failed'));
  expect((await act('open')).statusCode).toBe(422);
  expect(await readCardAttachments(root, cardId)).toEqual(before);
});

it.each(['invoice.pdf.ExE', 'run.CmD', 'run.command', 'run.desktop', 'unknown.custom', 'no-extension', 'document.PdF', 'payload.exe.TxT'])(
  'returns a stable open policy for %s and enforces it on the server', async file => {
    const { root, config } = await fixture();
    await writeFile(path.join(root, file), 'document');
    const { app, launcher, authorized, edit, act } = await connect(config);
    expect((await edit({ file })).statusCode).toBe(200);
    const url = '/api/attachments?source=sandbox&cardId=' + encodeURIComponent(cardId);
    const response = await app.inject({ url, headers });
    expect(response.statusCode).toBe(200);
    const canOpen = ['document.PdF', 'payload.exe.TxT'].includes(file);
    const openBlockedReason = canOpen ? null : 'UNSAFE_FILE_TYPE';
    expect(response.json().projectFiles[0]).toMatchObject({ file, canOpen, openBlockedReason });
    const before = await readCardAttachments(root, cardId);
    const opened = await act('open', { file });
    expect(opened.statusCode).toBe(canOpen ? 200 : 422);
    if (!canOpen) {
      expect(opened.json()).toMatchObject({ code: 'UNSAFE_FILE_TYPE' });
      expect(launcher).not.toHaveBeenCalled();
      const russian = await app.inject({ method: 'POST', url: '/api/attachments/open',
        headers: { ...authorized, cookie: 'deckmate-lang=ru' },
        payload: { source: 'sandbox', cardId, file } });
      expect(russian.json()).toMatchObject({ code: 'UNSAFE_FILE_TYPE', message: expect.stringContaining('Показать в папке') });
    }
    expect((await act('reveal', { file })).statusCode).toBe(200);
    expect(launcher).toHaveBeenCalledTimes(canOpen ? 2 : 1);
    expect(await readCardAttachments(root, cardId)).toEqual(before);
  });

it('rejects an outside hardlink on attach and refuses read/open/reveal after replacement', async () => {
  const { root, config } = await fixture();
  const outside = await temps.create();
  const external = path.join(outside, 'outside.blend');
  await writeFile(external, 'outside');
  await link(external, path.join(root, 'linked.blend'));
  const { app, edit, act, launcher } = await connect(config);
  expect((await edit({ file: 'linked.blend' })).statusCode).toBe(422);
  expect((await edit()).statusCode).toBe(200);
  await unlink(path.join(root, file));
  await link(external, path.join(root, file));
  const view = await app.inject({ url: '/api/attachments?cardId=' + encodeURIComponent(cardId), headers });
  expect(view.json().projectFiles[0]).toMatchObject({ missing: true, canOpen: false, openBlockedReason: 'FILE_UNAVAILABLE' });
  for (const action of ['open', 'reveal'] as const) expect((await act(action)).statusCode).toBe(404);
  expect(launcher).not.toHaveBeenCalled();
});

it('shares offline guarded attachment writes between CLI commands and MCP update_card', async () => {
  const { root, config } = await fixture();
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(Object.assign(new Error('offline'), { cause: { code: 'ECONNREFUSED' } }));
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const context = { root, config, source: 'sandbox' as const, catalog: await readProjectCatalog(root) };
  const ref = shortReference('c', cardId);
  await runAttach(context, [ref], new Map([['file', file], ['member', 'worker']]));
  expect(JSON.parse(log.mock.calls.at(-1)![0])).toMatchObject({ file, action: 'attach', via: 'files' });
  expect((await readCardAttachments(root, cardId)).projectFiles![0].addedBy).toBe('worker');
  await runDetach(context, [ref], new Map([['file', file]]));
  expect((await readCardAttachments(root, cardId)).projectFiles).toBeUndefined();
  const result = await callAgentTool(context, 'update_card', { ref, attach: file, member: 'worker' });
  expect(result.changed).toEqual(['attach']);
  expect((await readCardAttachments(root, cardId)).projectFiles![0].file).toBe(file);
  expect((await callAgentTool(context, 'update_card', { ref, detach: file, member: 'worker' })).changed).toEqual(['detach']);
  expect(await readFile(path.join(root, file), 'utf8')).toBe('BLENDER');
  await expect(runAttach({ ...context, config: { ...config, editMode: 'read-only', writeRoot: null } }, [ref], new Map([['file', file]]))).rejects.toThrow();
});

it('routes CLI attachment writes through the running server', async () => {
  const { root, config } = await fixture();
  const { app } = await connect(config);
  const requests: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    requests.push(url.pathname);
    const response = await app.inject({ url: url.pathname + url.search, method: init?.method === 'POST' ? 'POST' : 'GET',
      headers: { ...headers, ...Object.fromEntries(new Headers(init?.headers)) }, payload: init?.body as string | undefined });
    return new Response(response.body, { status: response.statusCode });
  });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  await runAttach({ root, config, source: 'sandbox', catalog: await readProjectCatalog(root) }, [cardId], new Map([['file', file]]));
  expect(requests).toContain('/api/catalog');
  expect((await readCardAttachments(root, cardId)).projectFiles![0].file).toBe(file);
});
