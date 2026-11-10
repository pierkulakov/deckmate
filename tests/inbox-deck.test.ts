import { afterEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../server/app.ts';
import { editProjectCatalog, readProjectCatalog } from '../server/catalog.ts';
import { CatalogService } from '../server/catalog-service.ts';

const roots: string[] = [];
const apps: FastifyInstance[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture(inbox: string | null = null) {
  const root = await mkdtemp(path.join(tmpdir(), 'deckmate-inbox-'));
  roots.push(root);
  await mkdir(path.join(root, 'tasks'));
  const text = '\uFEFF---\r\n# Keep this comment\r\nschema: 1\r\nformatLanguage: en\r\n'
    + `inboxDeckId: ${JSON.stringify(inbox)} # Receiver\r\n`
    + 'spaces: [{ id: work, title: Work }]\r\ndecks:\r\n'
    + "  - { id: tasks, title: Tasks, kind: 'task', spaceId: work, description: '', icon: box, color: '#123456' } # Task deck\r\n"
    + "  - { id: assets, title: Assets, kind: asset, spaceId: work, description: '', icon: box, color: '#123456' }\r\n"
    + "  - { id: docs, title: Docs, kind: knowledge, spaceId: work, description: '', icon: box, color: '#123456' }\r\n"
    + "  - { id: mixed, title: Mixed, kind: mixed, spaceId: work, description: '', icon: box, color: '#123456' }\r\n"
    + 'tracks: []\r\nmembership: []\r\n---\r\n# Personal notes\nKeep mixed EOL and Unicode: привет.\r\n';
  const filename = path.join(root, 'tasks/deckmate.md');
  await writeFile(filename, text);
  const config = { editMode: 'direct' as const, dataRoot: root, writeRoot: root, projectName: 'Inbox', port: 44327, python: 'python' };
  return { root, filename, text, config };
}

it.each(['tasks', 'mixed'])('sets %s as Inbox by changing only its scalar and treats repeats as no-ops', async deckId => {
  const { root, filename, text } = await fixture();
  await editProjectCatalog(root, { action: 'set-inbox-deck', deckId, manifestHash: (await readProjectCatalog(root)).manifestHash });
  const next = text.replace('inboxDeckId: null', `inboxDeckId: "${deckId}"`);
  expect(await readFile(filename)).toEqual(Buffer.from(next));
  const edit = { action: 'set-inbox-deck' as const, deckId, manifestHash: (await readProjectCatalog(root)).manifestHash };
  expect(await editProjectCatalog(root, edit)).toEqual([]);
  await expect(editProjectCatalog(root, { ...edit, deckId: null, manifestHash: 'stale' })).rejects.toThrow('CATALOG_CONFLICT');
  expect(await readFile(filename)).toEqual(Buffer.from(next));
  await editProjectCatalog(root, { ...edit, deckId: null });
  expect(await readFile(filename)).toEqual(Buffer.from(text));
});

it.each(['assets', 'docs'])('rejects assigning %s as Inbox, including a legacy assignment, without changing bytes', async deckId => {
  const { root, filename, text } = await fixture(deckId);
  const catalog = await readProjectCatalog(root);
  expect(catalog.inboxDeckId).toBe(deckId);
  await expect(editProjectCatalog(root, { action: 'set-inbox-deck', deckId, manifestHash: catalog.manifestHash }))
    .rejects.toThrow('Inbox must take Tasks: choose a Task or Mixed deck.');
  expect(await readFile(filename)).toEqual(Buffer.from(text));
});

it.each(['en', 'ru'])('returns the Inbox type validation error through the API in %s', async lang => {
  const { config } = await fixture();
  const app = await createApp(config);
  apps.push(app);
  const headers = { host: '127.0.0.1:44327', cookie: `deckmate-lang=${lang}` };
  const token = (await app.inject({ url: '/api/snapshot', headers })).json().token;
  const catalog = (await app.inject({ url: '/api/catalog?source=sandbox', headers })).json();
  const response = await app.inject({ method: 'POST', url: '/api/catalog', headers: { ...headers, 'x-deckmate-token': token },
    payload: { source: 'sandbox', action: 'set-inbox-deck', deckId: 'assets', manifestHash: catalog.manifestHash } });
  expect(response.statusCode, response.body).toBe(422);
  expect(response.json().message).toBe(lang === 'en' ? 'Inbox must take Tasks: choose a Task or Mixed deck.'
    : 'Inbox должен принимать задачи: выберите колоду Task или Mixed.');
});

it.each(['asset', 'knowledge'] as const)('clears Inbox atomically when its kind becomes %s, preserving all other bytes and returning a warning', async kind => {
  const { root, filename, text, config } = await fixture('tasks');
  const service = new CatalogService(config, ':memory:');
  try {
    const view = await service.edit({ action: 'set-deck-kind', deckId: 'tasks', kind,
      manifestHash: (await readProjectCatalog(root)).manifestHash }, 'sandbox');
    expect(view.inboxDeckId).toBeNull();
    // 2026-11-10: notices about what a write also changed travel in savedWarning, not among project content warnings.
    expect(view.savedWarning).toContain('Inbox destination cleared: this deck no longer takes Tasks.');
    expect(await readFile(filename)).toEqual(Buffer.from(text.replace("kind: 'task'", `kind: '${kind}'`).replace('inboxDeckId: "tasks"', 'inboxDeckId: null')));
  } finally { await service.close(); }
});

it('retains Inbox when changing to Mixed and only auto-assigns a deck named Inbox if it takes Tasks', async () => {
  const { root } = await fixture('tasks');
  await editProjectCatalog(root, { action: 'set-deck-kind', deckId: 'tasks', kind: 'mixed', manifestHash: (await readProjectCatalog(root)).manifestHash });
  expect((await readProjectCatalog(root)).inboxDeckId).toBe('tasks');
  await editProjectCatalog(root, { action: 'set-inbox-deck', deckId: null, manifestHash: (await readProjectCatalog(root)).manifestHash });
  for (const kind of ['asset', 'knowledge', 'task'] as const) {
    await editProjectCatalog(root, { action: 'create-deck', kind, title: 'Inbox', spaceId: 'work', icon: 'box', color: '#123456', description: '',
      manifestHash: (await readProjectCatalog(root)).manifestHash });
    const catalog = await readProjectCatalog(root);
    expect(catalog.inboxDeckId).toBe(kind === 'task' ? catalog.decks.find(deck => deck.title === 'Inbox' && deck.kind === 'task')!.id : null);
  }
});
