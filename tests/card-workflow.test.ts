import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../server/app.ts';
import { emptyManifest, renderCatalogManifest } from '../server/catalog.ts';
import type { CardContent, CatalogView } from '../src/catalog-contracts.ts';
import { shortReference } from '../src/references.ts';

const execute = promisify(execFile);
const temporaryRoots: string[] = [];
const applications: FastifyInstance[] = [];
afterEach(async () => {
  for (const application of applications.splice(0)) await application.close();
  for (const root of temporaryRoots.splice(0)) await rm(root, { recursive: true, force: true });
});

it('creates, edits and moves a Sub Card across decks while preserving its Hero and rejecting stale drafts', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'deckmate-card-workflow-'));
  temporaryRoots.push(root);
  for (const directory of ['features', 'tasks', 'Tools']) await mkdir(path.join(root, directory));
  await writeFile(path.join(root, 'features/match.md'), '# Match\n### 1.0 Baseline\nKeep me.\n');
  await writeFile(path.join(root, 'tasks/iterations.md'), '## Итерация 1 — Test\nНачало: 2026-11-03\n');
  await writeFile(path.join(root, 'Tools/board.py'), '# Fixture\n');
  const manifest = emptyManifest();
  manifest.spaces.push({ id: 'production', title: 'Production' });
  manifest.members = [{ id: 'kimi', label: 'Kimi', kind: 'agent', aliases: [] }];
  manifest.decks.push(
    { id: 'concepts', title: 'Concepts', spaceId: 'production', kind: 'asset', icon: 'box', color: '#cfa657', description: '' },
    { id: 'audio', title: 'Audio', spaceId: 'production', kind: 'task', icon: 'audio', color: '#cfa657', description: '' },
    { id: 'qa', title: 'QA', spaceId: 'production', kind: 'task', icon: 'bug', color: '#9b769f', description: '' },
  );
  await writeFile(path.join(root, 'tasks/deckmate.md'), renderCatalogManifest(manifest));
  await execute('git', ['init', '-b', 'deckmate/sandbox', root], { windowsHide: true });
  const application = await createApp({ editMode: 'sandbox', dataRoot: root, writeRoot: root, projectName: 'Test', port: 44319, python: 'python' });
  applications.push(application);
  const headers = { host: '127.0.0.1:44319' };
  const snapshot = (await application.inject({ url: '/api/snapshot?source=sandbox', headers })).json();
  const authorized = { ...headers, 'x-deckmate-token': snapshot.token };
  let catalog = (await application.inject({ url: '/api/catalog?source=sandbox', headers })).json<CatalogView>();
  async function edit(action: Record<string, unknown>) {
    const response = await application.inject({ method: 'POST', url: '/api/catalog', headers: authorized, payload: { ...action, source: 'sandbox', manifestHash: catalog.manifestHash } });
    expect(response.statusCode, response.body).toBe(200);
    catalog = response.json<CatalogView>();
  }
  const heroId = 'card:' + randomUUID();
  const childId = 'card:' + randomUUID();
  await edit({ action: 'create-card', cardId: heroId, kind: 'hero', title: 'Sound event', markdown: '## Contract\nKeep the attack audible.\n', deckId: 'concepts', trackIds: [], parentId: null, owner: null, effort: null, priority: 'high' });
  const createChild = { action: 'create-card', cardId: childId, kind: 'task', title: 'Prepare sample', markdown: '- [ ] Normalize the sample\n', deckId: 'audio', trackIds: [], parentId: heroId, owner: 'Kimi', effort: 3, priority: 'medium' };
  await edit(createChild);
  await edit(createChild);
  expect(catalog.cards.filter(card => card.id === childId)).toHaveLength(1);
  const childPath = path.join(root, 'cards', childId.slice(5) + '.md');
  const childBefore = await readFile(childPath);
  const heroContentResponse = await application.inject({ url: '/api/card-content?source=sandbox&cardId=' + encodeURIComponent(heroId), headers });
  expect(heroContentResponse.statusCode, heroContentResponse.body).toBe(200);
  const heroContent = heroContentResponse.json<CardContent>();
  expect(heroContent.markdown).not.toContain('Prepare sample');
  await edit({ action: 'update-card-content', cardId: heroId, sourceHash: heroContent.sourceHash, title: 'Sound event — reviewed', markdown: heroContent.markdown });
  expect(await readFile(childPath)).toEqual(childBefore);
  const child = catalog.cards.find(card => card.id === childId)!;
  expect(child).toMatchObject({ parentId: heroId, deckId: 'audio', owner: 'Kimi', effort: 3, priority: 'medium' });
  await edit({ action: 'assign-deck', cardId: childId, sourceHash: child.sourceHash, deckId: 'qa' });
  expect(catalog.cards.find(card => card.id === childId)).toMatchObject({ parentId: heroId, deckId: 'qa' });
  const staleEdit = await application.inject({ method: 'POST', url: '/api/catalog', headers: authorized, payload: { action: 'update-card-content', source: 'sandbox', manifestHash: catalog.manifestHash, cardId: childId, sourceHash: child.sourceHash, title: 'Stale draft', markdown: 'Do not overwrite moved metadata.' } });
  expect(staleEdit.statusCode, staleEdit.body).toBe(409);
  const search = await application.inject({ url: '/api/cards?source=sandbox&deckId=qa&text=Prepare', headers });
  expect(search.json()[0]).toMatchObject({ id: childId, parentId: heroId, effort: 3, priority: 'medium' });
  const reference = await application.inject({ url: '/r/' + shortReference('c', childId) + '?source=sandbox', headers });
  expect(reference.statusCode).toBe(302);
  expect(reference.headers.location).toContain(encodeURIComponent(childId));
  const nativeAfter = await readFile(childPath);
  const payload = { action: 'update-card-content', cardId: childId, sourceHash: catalog.cards.find(card => card.id === childId)!.sourceHash, title: 'Not authorized', markdown: 'No write.', manifestHash: catalog.manifestHash, source: 'live' };
  expect((await application.inject({ method: 'POST', url: '/api/catalog', headers: authorized, payload })).statusCode).toBe(403);
  expect((await application.inject({ method: 'POST', url: '/api/catalog', headers, payload: { ...payload, source: 'sandbox' } })).statusCode).toBe(403);
  expect(await readFile(childPath)).toEqual(nativeAfter);
});
