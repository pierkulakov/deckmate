import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../server/app.ts';
import { emptyManifest, readProjectCatalog, renderCatalogManifest } from '../server/catalog.ts';
import { createManagedMarkdown } from '../server/native-cards.ts';

let app: FastifyInstance | undefined;
let root: string | undefined;
afterEach(async () => { await app?.close(); if (root) await rm(root, { recursive: true, force: true }); });

it.each(['leo', 'build-agent', undefined])('retains the human answer and the actual recording actor (%s)', async actor => {
  root = await mkdtemp(path.join(tmpdir(), 'deckmate-decision-author-'));
  await mkdir(path.join(root, 'tasks'));
  const manifest = emptyManifest();
  manifest.formatLanguage = 'en';
  manifest.members = [
    { id: 'maya', label: 'Maya Chen', kind: 'human', aliases: [] },
    { id: 'leo', label: 'Leo Park', kind: 'human', aliases: [] },
    { id: 'build-agent', label: 'Build Agent', kind: 'agent', aliases: [] },
  ];
  await writeFile(path.join(root, 'tasks/deckmate.md'), renderCatalogManifest(manifest));
  const id = randomUUID();
  const filename = `cards/${id}.md`;
  await createManagedMarkdown(root, filename, { deckmate: 'card', schema: 1, id, kind: 'doc', title: 'Review rules',
    state: null, owner: null, deckId: null, parentId: null, trackIds: [] }, '# Review rules\n\n## Open questions\n\n- Which build?\n');
  app = await createApp({ editMode: 'direct', dataRoot: root, writeRoot: root, projectName: 'Authors', port: 44327, python: 'python' });
  const headers = { host: '127.0.0.1:44327' };
  const { token } = (await app.inject({ url: '/api/snapshot?source=sandbox', headers })).json();
  const catalog = await readProjectCatalog(root);
  const card = catalog.cards.find(card => card.id === `card:${id}`)!;
  const payload = { source: 'sandbox', action: 'record-decision', manifestHash: catalog.manifestHash,
    cardId: card.id, sourceHash: card.sourceHash, questionIndex: 0, questionText: 'Which build?', answer: 'Use the checked build.', memberId: 'leo' };
  const authorized = { ...headers, 'x-deckmate-token': token, ...(actor ? { 'x-deckmate-actor': actor } : {}) };
  const rejected = await app.inject({ method: 'POST', url: '/api/catalog', headers: authorized, payload: { ...payload, memberId: 'build-agent' } });
  expect(rejected.statusCode).toBe(422);
  const response = await app.inject({ method: 'POST', url: '/api/catalog', headers: authorized, payload });
  expect(response.statusCode, response.body).toBe(200);
  const markdown = await readFile(path.join(root, filename), 'utf8');
  expect(markdown).toContain('Use the checked build. — Leo Park,');
  expect(markdown).not.toContain('— Maya Chen');
  const history = (await app.inject({ url: `/api/card-activity?source=sandbox&cardId=${encodeURIComponent(card.id)}`, headers })).json();
  expect(markdown).toContain(actor === 'build-agent' ? '— Leo Park, via Build Agent,' : '— Leo Park, 20');
  expect(history.events.find((event: { action: string }) => event.action === 'record-decision'), JSON.stringify({ history, warnings: response.json().warnings })).toMatchObject({ actorMemberId: actor ?? 'leo' });
  const retry = await app.inject({ method: 'POST', url: '/api/catalog', headers: authorized, payload });
  expect(retry.statusCode).toBe(200);
  const repeated = (await app.inject({ url: `/api/card-activity?source=sandbox&cardId=${encodeURIComponent(card.id)}`, headers })).json();
  expect(repeated.events).toHaveLength(1);
});
