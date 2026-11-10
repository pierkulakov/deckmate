import { afterEach, expect, it, vi } from 'vitest';
import * as filesystem from 'node:fs/promises';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../server/app.ts';
import { editProjectCatalog, emptyManifest, readProjectCatalog, renderCatalogManifest } from '../server/catalog.ts';
import type { ServerConfig } from '../server/config.ts';

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, link: vi.fn(actual.link) };
});

const execute = promisify(execFile);
const roots: string[] = [];
const apps: FastifyInstance[] = [];
const headers = { host: '127.0.0.1:44368' };
const existingCardId = 'task:features/audio.md#1.0';

afterEach(async () => {
  const actual = await vi.importActual<typeof filesystem>('node:fs/promises');
  vi.mocked(filesystem.link).mockReset().mockImplementation(actual.link);
  for (const app of apps.splice(0)) await app.close();
  for (const root of roots.splice(0)) {
    if (path.dirname(root) !== path.resolve(tmpdir()) || !path.basename(root).startsWith('deckmate-partial-conflict-')) throw new Error('Unexpected fixture cleanup target');
    await rm(root, { recursive: true, force: true });
  }
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'deckmate-partial-conflict-'));
  roots.push(root);
  await mkdir(path.join(root, 'tasks'));
  await mkdir(path.join(root, 'features'));
  await writeFile(path.join(root, 'features/audio.md'), '# Audio\n## 1 — Sounds\n### 1.0 Existing task (план)\n');
  const manifest = emptyManifest();
  manifest.spaces.push({ id: 'work', title: 'Work' });
  manifest.decks.push({ id: 'audio', spaceId: 'work', title: 'Audio', kind: 'task', icon: 'audio', color: '#ff990a', description: '' });
  manifest.membership.push({ card: existingCardId, deck: 'audio' });
  manifest.deckOrder = { audio: { flatOrder: [existingCardId] } };
  const filename = path.join(root, 'tasks/deckmate.md');
  await writeFile(filename, renderCatalogManifest(manifest));
  await execute('git', ['init', '-b', 'deckmate/sandbox', root], { windowsHide: true });
  const config: ServerConfig = { editMode: 'sandbox', dataRoot: root, writeRoot: root,
    projectName: 'Partial save', port: 44368, python: 'python' };
  const catalog = await readProjectCatalog(root);
  const uuid = randomUUID();
  const cardFilename = path.join(root, 'cards', uuid + '.md');
  const edit = { action: 'create-card' as const, manifestHash: catalog.manifestHash, cardId: 'card:' + uuid,
    kind: 'task' as const, title: 'Saved before conflict', markdown: 'Keep this card.\n', deckId: 'audio',
    trackIds: [], parentId: null, owner: null, effort: null, priority: null };
  const external = Buffer.concat([await readFile(filename), Buffer.from('\nExternal edit.\n')]);
  const actual = await vi.importActual<typeof filesystem>('node:fs/promises');
  const fault = { hit: false };
  vi.mocked(filesystem.link).mockImplementation(async (source, destination) => {
    await actual.link(source, destination);
    // 2026-11-09: a real external edit after card publication makes the order stage reject its stale source hash.
    if (String(destination) === cardFilename) {
      fault.hit = true;
      await actual.writeFile(filename, external);
    }
  });
  return { root, config, edit, filename, cardFilename, external, fault };
}

it('marks the second-stage order conflict saved after creating the card file', async () => {
  const { root, edit, filename, cardFilename, external, fault } = await fixture();

  await expect(editProjectCatalog(root, edit)).rejects.toMatchObject({ message: 'CARD_CONFLICT', saved: true });
  expect(fault.hit).toBe(true);

  expect(await readFile(cardFilename, 'utf8')).toContain(edit.markdown);
  expect(await readFile(filename)).toEqual(external);
  expect((await readProjectCatalog(root)).deckOrder?.audio.flatOrder).toEqual([existingCardId]);
});

it('returns the saved card and a warning instead of 409 for a second-stage conflict', async () => {
  const { config, edit, filename, cardFilename, external, fault } = await fixture();
  const app = await createApp(config);
  apps.push(app);
  const snapshot = (await app.inject({ url: '/api/snapshot', headers })).json();
  const authorized = { ...headers, 'x-deckmate-token': snapshot.token };

  const response = await app.inject({ method: 'POST', url: '/api/catalog', headers: authorized,
    payload: { ...edit, source: 'sandbox' } });
  expect(fault.hit).toBe(true);

  expect(response.statusCode, response.body).toBe(200);
  expect(response.json().cards.filter((card: { id: string }) => card.id === edit.cardId)).toHaveLength(1);
  // 2026-11-09: the person sees the partial-save notice, never the internal conflict code.
  expect(response.json().savedWarning).not.toContain('CARD_CONFLICT');
  expect(response.json().savedWarning).toMatch(/saved|сохранен/u);
  expect(response.json().warnings).not.toContain(response.json().savedWarning);
  expect(response.json().deckOrder.audio.flatOrder).toEqual([existingCardId]);
  expect(await readFile(cardFilename, 'utf8')).toContain(edit.markdown);
  expect(await readFile(filename)).toEqual(external);

  const stale = await app.inject({ method: 'POST', url: '/api/catalog', headers: authorized,
    payload: { ...edit, cardId: 'card:' + randomUUID(), source: 'sandbox' } });
  expect(stale.statusCode, stale.body).toBe(409);
});
