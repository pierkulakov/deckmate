import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { FastifyInstance } from 'fastify';
import { parse } from 'yaml';
import { createApp } from '../server/app.ts';
import { emptyManifest, renderCatalogManifest } from '../server/catalog.ts';
import type { ServerConfig } from '../server/config.ts';
import { notificationStatePath } from '../server/notifications.ts';
import type { CatalogView } from '../src/catalog-contracts.ts';

// 2026-11-09: CodeQL js/prototype-polluting-assignment (server/notifications.ts). A member ID is checked by
// memberIdPattern, which refuses "__proto__" but accepts "constructor"; the first seen mark of such a member
// walked into the global Object constructor instead of the new file and was lost.
const execute = promisify(execFile);
const roots: string[] = [];
const applications: FastifyInstance[] = [];
const host = { host: '127.0.0.1:44322' };

afterEach(async () => {
  for (const application of applications.splice(0)) await application.close();
  for (const root of roots.splice(0)) {
    const relative = path.relative(path.resolve(tmpdir()), path.resolve(root));
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !path.basename(root).startsWith('deckmate-notification-keys-')) {
      throw new Error('Unexpected fixture cleanup target');
    }
    await rm(root, { recursive: true, force: true });
  }
});

async function project(memberId: string) {
  const root = await mkdtemp(path.join(tmpdir(), 'deckmate-notification-keys-'));
  roots.push(root);
  await mkdir(path.join(root, 'tasks'));
  const manifest = emptyManifest();
  manifest.formatLanguage = 'en';
  manifest.spaces.push({ id: 'work', title: 'Work' });
  manifest.decks.push({ id: 'audio', title: 'Audio', kind: 'task', spaceId: 'work', description: '', icon: 'box', color: '#234567' });
  manifest.members = [{ id: memberId, label: 'Builder', kind: 'agent', aliases: [] }];
  await writeFile(path.join(root, 'tasks/deckmate.md'), renderCatalogManifest(manifest));
  await execute('git', ['init', '-b', 'deckmate/sandbox', root], { windowsHide: true });
  const config: ServerConfig = { editMode: 'sandbox', dataRoot: root, writeRoot: root, projectName: 'Notification keys', port: 44322, python: 'python' };
  const app = await createApp(config);
  applications.push(app);
  const token = (await app.inject({ url: '/api/snapshot?source=sandbox', headers: host })).json<{ token: string }>().token;
  const headers = { ...host, 'x-deckmate-token': token };
  const post = async (url: string, payload: Record<string, unknown>) => {
    const response = await app.inject({ method: 'POST', url, headers, payload: { source: 'sandbox', ...payload } });
    expect(response.statusCode, response.body).toBe(200);
    return response;
  };
  const cardId = 'card:' + randomUUID();
  const initial = (await app.inject({ url: '/api/catalog?source=sandbox', headers })).json<CatalogView>();
  await post('/api/catalog', { action: 'create-card', manifestHash: initial.manifestHash, cardId, kind: 'task', title: 'Bell',
    markdown: 'Ring.\n', deckId: 'audio', parentId: null, trackIds: [], owner: null, effort: 2, priority: 'medium' });
  return { root, post, cardId };
}

async function stateMetadata(root: string): Promise<Record<string, unknown>> {
  const text = await readFile(path.join(root, notificationStatePath), 'utf8');
  const yaml = /^---\r?\n([\s\S]*?)^---/mu.exec(text)?.[1];
  return parse(yaml ?? '') as Record<string, unknown>;
}

it('records the first seen mark of a member named after an Object.prototype key in the new state file', async () => {
  const { root, post, cardId } = await project('constructor');
  const at = '2026-11-09T10:00:00.000Z';
  try {
    await post('/api/notifications/dismiss', { memberId: 'constructor', cardId, at });
    expect(Object.hasOwn(Object, 'seenCards')).toBe(false);
    expect(await stateMetadata(root)).toEqual({ schema: 1, members: { constructor: { seenCards: { [cardId]: at } } } });
  } finally {
    // Keep a failed run from leaking the polluted static into other tests of this worker.
    Reflect.deleteProperty(Object, 'seenCards');
  }
});

it('records a dismissed stack for a member named after an Object.prototype key', async () => {
  const { root, post } = await project('constructor');
  const at = '2026-11-09T10:00:00.000Z';
  try {
    await post('/api/notifications/dismiss', { memberId: 'constructor', stack: 'owned', at });
    expect(Object.hasOwn(Object, 'dismissedStacks')).toBe(false);
    expect(await stateMetadata(root)).toEqual({ schema: 1, members: { constructor: { dismissedStacks: { owned: at } } } });
  } finally {
    Reflect.deleteProperty(Object, 'dismissedStacks');
  }
});
