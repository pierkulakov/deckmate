import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../server/app.ts';
import { initializeDemo } from '../server/demo.ts';
import type { CatalogEdit, CatalogView } from '../src/catalog-contracts.ts';
import { editProjectCatalog, emptyManifest, renderCatalogManifest } from '../server/catalog.ts';
import { activityEventPath } from '../server/activity.ts';
import { createManagedMarkdown } from '../server/native-cards.ts';
import type { AgentBrief } from '../server/agent-brief.ts';
import type { DeckActivityEvent } from '../src/activity-contracts.ts';
import { freePort } from './free-port.ts';

it.each([
  { mode: 'single', state: 'not-started' }, { mode: 'bulk', state: 'not-started' },
  { mode: 'single', state: 'started' }, { mode: 'bulk', state: 'started' },
] as const)('requires and journals returnReason for ordinary and Journey Tasks ($mode → $state)', async ({ mode, state }) => {
  const root = await mkdtemp(path.join(tmpdir(), 'deckmate-review-reason-'));
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    await initializeDemo(root);
    const port = await freePort();
    app = await createApp({ editMode: 'direct', dataRoot: root, writeRoot: root, projectName: 'Return reason', port, python: 'python' });
    const headers = { host: `127.0.0.1:${port}` };
    const snapshot = (await app.inject({ url: '/api/snapshot?source=sandbox', headers })).json();
    let catalog = (await app.inject({ url: '/api/catalog?source=sandbox', headers })).json<CatalogView>();
    for (const journey of [false, true]) {
      const card = catalog.cards.find(candidate => candidate.kind === 'task' && candidate.state === 'review' && Boolean(candidate.journey) === journey)!;
      expect(card).toBeDefined();
      const reason = journey ? 'Уточнить проверку шага Journey.' : 'Исправить коллизию и приложить проверку.';
      const edit = (returnReason?: string): CatalogEdit => {
        if (mode === 'bulk') return { action: 'bulk-edit-cards', manifestHash: catalog.manifestHash, optionsHash: catalog.optionsHash!,
          cards: [{ cardId: card.id, sourceHash: card.sourceHash }], change: { kind: 'state', state, returnReason } };
        return { action: 'set-card-state', cardId: card.id, sourceHash: card.sourceHash, manifestHash: catalog.manifestHash,
          state, returnReason };
      };
      const before = await readFile(path.join(root, card.path));
      for (const invalid of [undefined, '', '   ', 'x'.repeat(501)]) {
        await expect(editProjectCatalog(root, edit(invalid), 'maya')).rejects.toThrow(/reason|причин/u);
        const rejected = await app.inject({ method: 'POST', url: '/api/catalog', headers: { ...headers, 'x-deckmate-token': snapshot.token, 'x-deckmate-actor': 'maya' },
          payload: { ...edit(invalid), source: 'sandbox' } });
        const expectedStatus = mode === 'single' && invalid?.length === 501 ? 400 : 422;
        expect(rejected.statusCode, rejected.body).toBe(expectedStatus);
        expect(await readFile(path.join(root, card.path))).toEqual(before);
      }
      const response = await app.inject({ method: 'POST', url: '/api/catalog', headers: { ...headers, 'x-deckmate-token': snapshot.token, 'x-deckmate-actor': 'maya' },
        payload: { ...edit(reason), source: 'sandbox' } });
      expect(response.statusCode, response.body).toBe(200);
      catalog = response.json<CatalogView>();
      const returned = catalog.cards.find(candidate => candidate.id === card.id)!;
      expect(returned.state).toBe(state);
      expect(returned.owner).toBe(card.owner);
      if (state === 'not-started') expect(returned.handMemberIds ?? []).toEqual(card.handMemberIds ?? []);
      const history = (await app.inject({ url: '/api/card-activity?source=sandbox&cardId=' + encodeURIComponent(card.id), headers })).json<{ events: DeckActivityEvent[] }>();
      expect(history.events.flatMap(event => event.transitions ?? [])).toContainEqual({ cardId: card.id, from: 'review', to: state, reason });
      expect(history.events.find(event => event.transitions?.some(transition => transition.reason === reason))?.actorMemberId).toBe('maya');
    }
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
}, 20000);

it.each(['single', 'bulk'] as const)('records a deckless return with actor, guarded source bytes and localized brief feedback (%s)', async mode => {
  const root = await mkdtemp(path.join(tmpdir(), 'deckmate-review-reason-'));
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    await mkdir(path.join(root, 'tasks'));
    const manifest = emptyManifest();
    manifest.formatLanguage = 'en';
    manifest.members = [{ id: 'reviewer', label: 'Reviewer', kind: 'human', aliases: [] }];
    await writeFile(path.join(root, 'tasks/deckmate.md'), renderCatalogManifest(manifest));
    const id = randomUUID();
    const cardId = `card:${id}`;
    const relativePath = `cards/${id}.md`;
    await createManagedMarkdown(root, relativePath, { deckmate: 'card', schema: 1, id, kind: 'task',
      title: 'Deckless review', state: 'review', owner: 'Assignee', deckId: null, parentId: null, trackIds: [] },
    'Keep this body.\nСохранить соседние байты.\n');
    const filename = path.join(root, relativePath);
    const before = Buffer.from('\uFEFF' + (await readFile(filename, 'utf8')).replace(/\n/gu, '\r\n'));
    await writeFile(filename, before);
    const port = await freePort();
    app = await createApp({ editMode: 'direct', dataRoot: root, writeRoot: root, projectName: 'Deckless review', port, python: 'python' });
    const headers = { host: `127.0.0.1:${port}` };
    const snapshot = (await app.inject({ url: '/api/snapshot?source=sandbox', headers })).json();
    let catalog = (await app.inject({ url: '/api/catalog?source=sandbox', headers })).json<CatalogView>();
    const reason = 'Исправить коллизию и приложить проверку.';
    const edit = (sourceHash: string, returnReason?: string): CatalogEdit => {
      if (mode === 'bulk') return { action: 'bulk-edit-cards', manifestHash: catalog.manifestHash, optionsHash: catalog.optionsHash!,
        cards: [{ cardId, sourceHash }], change: { kind: 'state', state: 'not-started', returnReason } };
      return { action: 'set-card-state', manifestHash: catalog.manifestHash, cardId, sourceHash, state: 'not-started', returnReason };
    };
    const send = (payload: CatalogEdit) => app!.inject({ method: 'POST', url: '/api/catalog',
      headers: { ...headers, 'x-deckmate-token': snapshot.token, 'x-deckmate-actor': 'reviewer' }, payload: { ...payload, source: 'sandbox' } });
    const card = catalog.cards.find(card => card.id === cardId)!;
    expect(card.deckId).toBeNull();
    expect((await send(edit('0'.repeat(64), reason))).statusCode).toBe(409);
    expect((await send(edit(card.sourceHash))).statusCode).toBe(422);
    expect(await readFile(filename)).toEqual(before);
    const response = await send(edit(card.sourceHash, reason));
    expect(response.statusCode, response.body).toBe(200);
    catalog = response.json<CatalogView>();
    expect(catalog.savedWarning).toBeUndefined();
    expect(catalog.cards.find(card => card.id === cardId)).toMatchObject({ state: 'not-started', owner: 'Assignee', deckId: null });
    expect(await readFile(filename)).toEqual(Buffer.from(before.toString('utf8').replace('state: review\r\n', 'state: "not-started"\r\n')));
    const history = (await app.inject({ url: '/api/card-activity?source=sandbox&cardId=' + encodeURIComponent(cardId), headers })).json<{ events: DeckActivityEvent[] }>();
    expect(history.events).toHaveLength(1);
    const event = history.events[0];
    expect(event).toMatchObject({ deckIds: [], actor: 'Deckmate', actorMemberId: 'reviewer',
      transitions: [{ cardId, from: 'review', to: 'not-started', reason }] });
    const journalBytes = await readFile(path.join(root, activityEventPath(event)));
    for (const language of ['en', 'ru']) {
      const briefResponse = await app.inject({ url: '/api/brief?source=sandbox&cardId=' + encodeURIComponent(cardId),
        headers: { ...headers, cookie: `deckmate-lang=${language}` } });
      expect(briefResponse.statusCode, briefResponse.body).toBe(200);
      const brief = briefResponse.json<AgentBrief>();
      expect(brief.markdown).toContain(language === 'en' ? '## Latest recorded review return\n' : '## Последний записанный возврат с приёмки\n');
      expect(brief.markdown).toContain(language === 'en' ? 'Actor: reviewer' : 'Автор: reviewer');
      expect(brief.markdown).toContain(`${event.at} · `);
      expect(brief.markdown).toContain('review → not-started');
      expect(brief.markdown).toContain((language === 'en' ? 'Reason: ' : 'Причина: ') + reason);
      expect(brief.tokens).toBeLessThanOrEqual(1500);
    }
    expect(await readFile(path.join(root, activityEventPath(event)))).toEqual(journalBytes);
    expect((await send(edit(catalog.cards.find(card => card.id === cardId)!.sourceHash))).statusCode).toBe(200);
    expect(await readdir(path.join(root, 'tasks/deckmate-activity'))).toHaveLength(1);
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
}, 20000);

it('accepts Review without a return reason, then reopens Done to planned without changing its owner', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'deckmate-review-accept-'));
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    await initializeDemo(root);
    const port = await freePort();
    app = await createApp({ editMode: 'direct', dataRoot: root, writeRoot: root, projectName: 'Review decisions', port, python: 'python' });
    const headers = { host: `127.0.0.1:${port}` };
    const snapshot = (await app.inject({ url: '/api/snapshot?source=sandbox', headers })).json();
    let catalog = (await app.inject({ url: '/api/catalog?source=sandbox', headers })).json<CatalogView>();
    const original = catalog.cards.find(card => card.kind === 'task' && card.state === 'review' && !card.journey)!;
    for (const state of ['done', 'not-started'] as const) {
      const current = catalog.cards.find(card => card.id === original.id)!;
      const response = await app.inject({ method: 'POST', url: '/api/catalog',
        headers: { ...headers, 'x-deckmate-token': snapshot.token, 'x-deckmate-actor': 'maya' },
        payload: { source: 'sandbox', action: 'set-card-state', cardId: current.id, state, sourceHash: current.sourceHash, manifestHash: catalog.manifestHash } });
      expect(response.statusCode, response.body).toBe(200);
      catalog = response.json<CatalogView>();
      expect(catalog.cards.find(card => card.id === original.id)).toMatchObject({ state, owner: original.owner });
    }
    const history = (await app.inject({ url: '/api/card-activity?source=sandbox&cardId=' + encodeURIComponent(original.id), headers })).json<{ events: DeckActivityEvent[] }>();
    expect(history.events.flatMap(event => event.transitions ?? [])).toEqual(expect.arrayContaining([
      { cardId: original.id, from: 'review', to: 'done' }, { cardId: original.id, from: 'done', to: 'not-started' },
    ]));
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
}, 20000);
