import { afterEach, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import { watchProjectFiles, type ProjectFileWatcher } from '../server/file-events.ts';
import { createApp } from '../server/app.ts';
import { createManagedMarkdown, readManagedBytes } from '../server/native-cards.ts';
import { readCardAttachments } from '../server/attachments.ts';
import { affectsCatalog } from '../client/catalog-store.ts';
import { freePort } from './free-port.ts';
import { emptyManifest, renderCatalogManifest } from '../server/catalog.ts';
import { publishJourney } from '../server/journeys.ts';
import type { CatalogView } from '../src/catalog-contracts.ts';

vi.hoisted(() => {
  vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
});

const roots: string[] = [];
const watchers: ProjectFileWatcher[] = [];
const apps: FastifyInstance[] = [];
const sockets: WebSocket[] = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  for (const app of apps.splice(0)) await app.close();
  for (const watcher of watchers.splice(0)) await watcher.close();
  for (const root of roots.splice(0)) {
    expect(path.dirname(root)).toBe(path.resolve(tmpdir()));
    expect(path.basename(root)).toMatch(/^deckmate-attachment-events-/u);
    await rm(root, { recursive: true, force: true });
  }
  vi.unstubAllGlobals();
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'deckmate-attachment-events-'));
  roots.push(root);
  await mkdir(path.join(root, 'tasks'));
  return root;
}

it.each(['deckmate', 'freetion'])('observes %s registry create/change/atomic replace/unlink, but not binaries or temporary files', async prefix => {
  const root = await fixture();
  const relative = `tasks/${prefix}-assets/cards/legacy-1234567890abcdef/attachments.md`;
  await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
  const onChange = vi.fn();
  const watcher = watchProjectFiles(root, onChange);
  watchers.push(watcher);
  await watcher.ready;
  expect(onChange).not.toHaveBeenCalled();
  const filename = path.join(root, relative);
  const changes = [
    () => writeFile(filename, '# Registry\n'),
    () => writeFile(filename, '# Changed\n'),
    async () => { await writeFile(filename + '.tmp', '# Atomic\n'); await rename(filename + '.tmp', filename); },
    () => rm(filename),
  ];
  for (const change of changes) {
    onChange.mockClear();
    await change();
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith(relative), { timeout: 3000, interval: 10 });
  }
  onChange.mockClear();
  await writeFile(filename + '.tmp', '# Temporary\n');
  await writeFile(path.join(path.dirname(filename), 'binary.png'), Buffer.from([1, 2, 3]));
  await writeFile(filename, '# Registry after ignored files\n');
  await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith(relative), { timeout: 3000, interval: 10 });
  expect(onChange).toHaveBeenCalledTimes(1);
}, 15_000);

it('delivers upload, removal and legacy external changes over WebSocket in the existing client format', async () => {
  const root = await fixture();
  const id = 'ca1d0000-0000-4000-8000-000000000001';
  const cardId = `card:${id}`;
  await createManagedMarkdown(root, `cards/${id}.md`, { deckmate: 'card', schema: 1, id, kind: 'task', title: 'Attachments',
    state: 'not-started', owner: null, deckId: null, parentId: null, trackIds: [] }, 'Body.\n');
  const legacyPath = 'tasks/freetion-assets/cards/legacy-1234567890abcdef/attachments.md';
  const port = await freePort();
  const app = await createApp({ editMode: 'direct', dataRoot: root, writeRoot: root, projectName: 'Events', port, python: 'python' });
  apps.push(app);
  await app.listen({ host: '127.0.0.1', port });
  const headers = { host: `127.0.0.1:${port}` };
  const token = (await app.inject({ url: '/api/snapshot', headers })).json().token as string;
  const socket = new WebSocket(`ws://127.0.0.1:${port}/api/events?token=${token}`);
  sockets.push(socket);
  const messages: { type: string; source: string; relativePath: string; detectedAt: number }[] = [];
  socket.on('message', data => messages.push(JSON.parse(data.toString())));
  await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  const registry = `tasks/deckmate-assets/cards/${id}/attachments.md`;
  const uploaded = await app.inject({ method: 'POST', url: '/api/catalog', headers: { ...headers, 'x-deckmate-token': token },
    payload: { action: 'upload-attachment', source: 'sandbox', manifestHash: '', attachmentsHash: '', cardId,
      dataUrl: `data:application/pdf;base64,${Buffer.from('%PDF-1.7\n%%EOF\n').toString('base64')}`, fileName: 'notes.pdf' } });
  expect(uploaded.statusCode, uploaded.body).toBe(200);
  await vi.waitFor(() => expect(messages).toContainEqual({ type: 'changed', source: 'sandbox', relativePath: registry,
    detectedAt: expect.any(Number) }), { timeout: 5000 });
  expect(affectsCatalog(registry)).toBe(true);
  messages.length = 0;
  const attachments = await readCardAttachments(root, cardId);
  const removed = await app.inject({ method: 'POST', url: '/api/catalog', headers: { ...headers, 'x-deckmate-token': token },
    payload: { action: 'remove-attachment', source: 'sandbox', manifestHash: '', attachmentsHash: attachments.hash, cardId,
      file: attachments.files[0].file } });
  expect(removed.statusCode, removed.body).toBe(200);
  await vi.waitFor(() => expect(messages.some(message => message.relativePath === registry)).toBe(true), { timeout: 5000 });
  expect((await readCardAttachments(root, cardId)).files).toEqual([]);
  await mkdir(path.dirname(path.join(root, legacyPath)), { recursive: true });
  await writeFile(path.join(root, legacyPath), '# External legacy registry\n');
  await vi.waitFor(() => expect(messages).toContainEqual({ type: 'changed', source: 'sandbox', relativePath: legacyPath,
    detectedAt: expect.any(Number) }), { timeout: 5000 });
  expect(affectsCatalog(legacyPath)).toBe(true);
}, 20_000);

it('invalidates cached Journey operations and delivers journal add/change/unlink over WebSocket', async () => {
  const root = await fixture();
  const manifest = emptyManifest();
  manifest.spaces.push({ id: 'project', title: 'Project' });
  for (const [id, kind] of [['assets', 'asset'], ['work', 'task']] as const) {
    manifest.decks.push({ id, kind, title: id, spaceId: 'project', icon: 'box', color: '#123456', description: '' });
  }
  await writeFile(path.join(root, 'tasks/deckmate.md'), renderCatalogManifest(manifest));
  const id = '11111111-2222-4333-8444-555555555555';
  await publishJourney(root, async () => {}, { id, title: 'Pipeline', version: 1, deckId: 'assets', description: '', zones: [],
    steps: [{ id: 'a', title: 'Step', markdown: 'Work.', deckId: 'work', owner: null, dependsOn: [] }] });
  const port = await freePort();
  const app = await createApp({ editMode: 'direct', dataRoot: root, writeRoot: root, projectName: 'Events', port, python: 'python' });
  apps.push(app);
  await app.listen({ host: '127.0.0.1', port });
  const headers = { host: `127.0.0.1:${port}` };
  const token = (await app.inject({ url: '/api/snapshot', headers })).json().token as string;
  const readCatalog = async () => (await app.inject({ url: '/api/catalog?source=sandbox', headers })).json<CatalogView>();
  expect((await readCatalog()).journeys![0].pendingOperation).toBeUndefined();
  const socket = new WebSocket(`ws://127.0.0.1:${port}/api/events?token=${token}`);
  sockets.push(socket);
  const messages: { type: string; source: string; relativePath: string; detectedAt: number }[] = [];
  socket.on('message', data => messages.push(JSON.parse(data.toString())));
  await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  const relative = `tasks/journeys/${id}/.deckmate-operation.json`;
  const filename = path.join(root, relative);
  const files = [];
  for (const file of ['steps/a.md', 'index.md']) {
    const bytes = (await readManagedBytes(root, `tasks/journeys/${id}/${file}`))!;
    const after = file === 'index.md' ? bytes.toString('utf8').replace('version: 1', 'version: 2') : bytes.toString('utf8') + '\nNew instruction.\n';
    files.push({ path: file, before: { text: bytes.toString('utf8'), hash: createHash('sha256').update(bytes).digest('hex') },
      after: { text: after, hash: createHash('sha256').update(after).digest('hex') } });
  }
  const journal = JSON.stringify({ deckmate: 'journey-operation', schema: 1, id: randomUUID(), journeyId: id, files });
  for (const [index, change] of [() => writeFile(filename, journal), () => writeFile(filename, '{changed'), () => rm(filename)].entries()) {
    messages.length = 0;
    await change();
    await vi.waitFor(() => expect(messages).toContainEqual({ type: 'changed', source: 'sandbox', relativePath: relative,
      detectedAt: expect.any(Number) }), { timeout: 5000 });
    expect(affectsCatalog(relative)).toBe(true);
    const catalog = await readCatalog();
    if (index === 2) expect(catalog.journeys![0].pendingOperation).toBeUndefined();
    else expect(catalog.journeys![0].pendingOperation?.state).toBe(index === 0 ? 'pending' : 'invalid');
    expect(catalog.documents.some(document => document.path === relative)).toBe(false);
  }
}, 20_000);
