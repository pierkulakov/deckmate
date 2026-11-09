import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { FastifyInstance } from 'fastify';
import { appendActivity, describeActivity, readActivity, readCardActivity } from '../server/activity.ts';
import { activityEventGroups } from '../src/activity-groups.ts';
import { createApp } from '../server/app.ts';
import { CatalogService } from '../server/catalog-service.ts';
import { editProjectCatalog, emptyManifest, readManifest, readProjectCatalog, renderCatalogManifest } from '../server/catalog.ts';
import type { ServerConfig } from '../server/config.ts';
import type { DeckActivityEvent } from '../src/activity-contracts.ts';
import type { CatalogEdit } from '../src/catalog-contracts.ts';
import type { WorkspaceSnapshot } from '../src/workspace-contracts.ts';
import type { CatalogView } from '../src/catalog-contracts.ts';
import type { NotificationsView } from '../src/notification-contracts.ts';

const execute = promisify(execFile);
const roots: string[] = [];
const services: CatalogService[] = [];
const applications: FastifyInstance[] = [];
const headers = { host: '127.0.0.1:44321' };
type CreateCard = Extract<CatalogEdit, { action: 'create-card' }>;

afterEach(async () => {
  for (const application of applications.splice(0)) await application.close();
  for (const service of services.splice(0)) await service.close();
  for (const root of roots.splice(0)) {
    const relative = path.relative(path.resolve(tmpdir()), path.resolve(root));
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !path.basename(root).startsWith('deckmate-activity-')) {
      throw new Error('Unexpected activity fixture cleanup target');
    }
    await rm(root, { recursive: true, force: true });
  }
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'deckmate-activity-'));
  roots.push(root);
  for (const directory of ['features', 'tasks', 'Tools']) await mkdir(path.join(root, directory));
  await writeFile(path.join(root, 'features/match.md'), '# Матч\n## Правила\n- Правило.\n## 1 — Бой\n### 1.0 Звук выстрела (обсуждаем)\nТело.\n');
  await writeFile(path.join(root, 'tasks/iterations.md'), '## Итерация 1 — Проверка\nНачало: 2026-11-03\n');
  await writeFile(path.join(root, 'tasks/iteration-board.md'), 'Доска\n');
  await writeFile(path.join(root, 'tasks/mechanics.md'), 'Таблица\n');
  await writeFile(path.join(root, 'Tools/board.py'), "BOARD = 'tasks/iteration-board.md'\nTABLE = 'tasks/mechanics.md'\ndef build():\n    return {BOARD: 'Доска\\n', TABLE: 'Таблица\\n'}\n");
  const manifest = emptyManifest();
  manifest.spaces.push({ id: 'work', title: 'Work' }, { id: 'archive', title: 'Archive' });
  manifest.members = [{ id: 'kimi', label: 'Kimi', kind: 'agent', aliases: [] }];
  for (const [id, kind] of [['audio', 'task'], ['qa', 'task'], ['concepts', 'asset'], ['other-concepts', 'asset']] as const) {
    manifest.decks.push({ id, title: id, kind, spaceId: 'work', description: '', icon: 'box', color: '#234567' });
  }
  manifest.membership.push({ card: 'task:features/match.md#1.0', deck: 'audio' });
  await writeFile(path.join(root, 'tasks/deckmate.md'), renderCatalogManifest(manifest));
  await execute('git', ['init', '-b', 'deckmate/sandbox', root], { windowsHide: true });
  const config: ServerConfig = { editMode: 'sandbox', dataRoot: root, writeRoot: root, projectName: 'Activity test', port: 44321, python: 'python' };
  const service = new CatalogService(config, ':memory:');
  services.push(service);
  return { root, config, service };
}

async function creation(root: string, overrides: Partial<CreateCard> = {}): Promise<CreateCard> {
  return { action: 'create-card', manifestHash: (await readProjectCatalog(root)).manifestHash,
    cardId: 'card:' + randomUUID(), kind: 'task', title: 'Sound sample', markdown: 'Normalize the sample.\n',
    deckId: 'audio', parentId: null, trackIds: [], owner: 'Kimi', effort: 2, priority: 'medium', ...overrides };
}

async function seedCard(root: string, overrides: Partial<CreateCard> = {}) {
  const edit = await creation(root, overrides);
  await editProjectCatalog(root, edit);
  return (await readProjectCatalog(root)).cards.find(card => card.id === edit.cardId)!;
}

async function seedHero(root: string, deckId = 'concepts') {
  return seedCard(root, { kind: 'hero', title: deckId + ' Hero', deckId, owner: null, effort: null });
}

function activityEvent(index: number, deckIds = ['audio']): DeckActivityEvent {
  return { schema: 1, id: randomUUID(), at: new Date(Date.UTC(2026, 10, 3, 12, 0, index)).toISOString(),
    action: 'update-card-content', actor: 'Deckmate', summary: 'Изменено содержимое карточки',
    cards: [{ id: 'card:' + randomUUID(), title: 'Sample ' + index }], deckIds, details: ['Updated ' + index] };
}

async function appFixture() {
  const context = await fixture();
  const app = await createApp(context.config);
  applications.push(app);
  const snapshot = (await app.inject({ url: '/api/snapshot?source=sandbox', headers })).json<WorkspaceSnapshot & { token: string }>();
  return { ...context, app, snapshot, authorized: { ...headers, 'x-deckmate-token': snapshot.token } };
}

it('journals a created Sub Card in its own and Hero decks, and idempotent retry adds no event', async () => {
  const { root, service } = await fixture();
  const hero = await seedHero(root);
  const edit = await creation(root, { parentId: hero.id });
  const created = await service.edit(edit, 'sandbox');
  const page = await service.activity('sandbox', 'audio');
  expect(page.events).toHaveLength(1);
  expect(page.events[0]).toMatchObject({ action: 'create-card', actor: 'Deckmate', cards: [{ id: edit.cardId, title: edit.title }] });
  expect(new Set(page.events[0].deckIds)).toEqual(new Set(['audio', 'concepts']));
  expect((await service.activity('sandbox', 'concepts')).events[0].id).toBe(page.events[0].id);
  expect(created.cards.find(card => card.id === edit.cardId)?.owner).toBe('Kimi');
  const filename = path.join(root, 'cards', edit.cardId.slice(5) + '.md');
  const saved = await readFile(filename);
  await service.edit({ ...edit, manifestHash: created.manifestHash }, 'sandbox');
  expect((await service.activity('sandbox', 'audio')).events).toHaveLength(1);
  expect(await readFile(filename)).toEqual(saved);
});

it('serves the pulse and persists pile changes through the guarded API without duplicate events', async () => {
  const { root, app, authorized } = await appFixture();
  const filename = path.join(root, 'tasks/deckmate.md');
  const before = await readFile(filename);
  const catalog = (await app.inject({ url: '/api/catalog?source=sandbox', headers })).json<CatalogView>();
  const request = { action: 'set-deck-pile', source: 'sandbox', deckId: 'audio', piled: true, manifestHash: catalog.manifestHash };
  const pile = await app.inject({ method: 'POST', url: '/api/catalog', headers: authorized, payload: request });
  expect(pile.statusCode).toBe(200);
  expect((await readProjectCatalog(root)).decks.find(deck => deck.id === 'audio')?.piled).toBe(true);
  expect((await app.inject({ method: 'POST', url: '/api/catalog', headers: authorized, payload: request })).statusCode).toBe(409);
  const piled = await readProjectCatalog(root);
  const retry = { ...request, manifestHash: piled.manifestHash };
  expect((await app.inject({ method: 'POST', url: '/api/catalog', headers: authorized, payload: retry })).statusCode).toBe(200);
  expect((await readActivity(root, 'audio')).events.filter(event => event.action === 'set-deck-pile')).toHaveLength(1);
  expect((await app.inject({ method: 'POST', url: '/api/catalog', headers: authorized, payload: { ...retry, source: 'live' } })).statusCode).toBe(403);
  expect((await app.inject({ method: 'POST', url: '/api/catalog', headers: authorized, payload: { ...retry, piled: 'invalid' } })).statusCode).toBe(400);
  expect((await app.inject({ method: 'POST', url: '/api/catalog', headers: authorized, payload: { ...retry, deckId: 'missing' } })).statusCode).toBe(422);
  const shelve = await app.inject({ method: 'POST', url: '/api/catalog', headers: authorized, payload: { ...retry, piled: false } });
  expect(shelve.statusCode).toBe(200);
  expect(await readFile(filename)).toEqual(before);
  const events = (await readActivity(root, 'audio')).events.filter(event => event.action === 'set-deck-pile');
  expect(events).toHaveLength(2);
  expect(events[0].summary).not.toBe(events[1].summary);

  for (const source of ['live', 'sandbox']) {
    const response = await app.inject({ url: `/api/project-pulse?source=${source}`, headers });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ inProgress: { count: 0 }, review: { count: 0 }, accepted: { days: Array(14).fill(0), total: 0 }, run: null });
  }
  expect((await app.inject({ url: '/api/project-pulse?source=unknown', headers })).statusCode).toBe(400);
  expect(await readFile(filename)).toEqual(before);
});

it('journals actual content changes and leaves an unchanged save out of history', async () => {
  const { root, service } = await fixture();
  const hero = await seedHero(root);
  const child = await seedCard(root, { parentId: hero.id });
  let catalog = await service.get('sandbox');
  const edit = { action: 'update-card-content' as const, cardId: child.id, sourceHash: child.sourceHash!, manifestHash: catalog.manifestHash, title: 'Reviewed sample', markdown: 'New content.\n' };
  catalog = await service.edit(edit, 'sandbox');
  const page = await service.activity('sandbox', 'audio');
  expect(page.events).toHaveLength(1);
  // 2026-11-06: the journal is a project file; this legacy fixture has no formatLanguage and is Russian.
  expect(page.events[0].details.join('\n')).toContain('Название: Sound sample → Reviewed sample');
  expect(page.events[0].details.join('\n')).toContain('Обновлено описание');
  expect((await service.activity('sandbox', 'concepts')).events[0].id).toBe(page.events[0].id);
  await service.edit({ ...edit, sourceHash: catalog.cards.find(card => card.id === child.id)!.sourceHash!, manifestHash: catalog.manifestHash }, 'sandbox');
  expect((await service.activity('sandbox', 'audio')).events).toHaveLength(1);
});

it('moving a Sub Card journals old deck, new deck and Hero deck without changing its parent', async () => {
  const { root, service } = await fixture();
  const hero = await seedHero(root);
  const child = await seedCard(root, { parentId: hero.id });
  const catalog = await service.get('sandbox');
  const moved = await service.edit({ action: 'assign-deck', manifestHash: catalog.manifestHash, sourceHash: child.sourceHash!, cardId: child.id, deckId: 'qa' }, 'sandbox');
  const pages = await Promise.all(['audio', 'qa', 'concepts'].map(deck => service.activity('sandbox', deck)));
  expect(pages.every(page => page.events.length === 1)).toBe(true);
  expect(new Set(pages.map(page => page.events[0].id)).size).toBe(1);
  expect(pages[0].events[0].details.join('\n')).toContain('Колода: audio → qa');
  expect(moved.cards.find(card => card.id === child.id)).toMatchObject({ deckId: 'qa', parentId: hero.id });
});

it('reparenting records both Hero decks and the child deck; repeating the relation is a no-op', async () => {
  const { root, service } = await fixture();
  const first = await seedHero(root);
  const second = await seedHero(root, 'other-concepts');
  const child = await seedCard(root, { parentId: first.id });
  let catalog = await service.get('sandbox');
  const edit = { action: 'set-card-parent' as const, manifestHash: catalog.manifestHash, sourceHash: child.sourceHash!, cardId: child.id,
    expectedParentId: first.id, parentId: second.id, parentSourceHash: second.sourceHash! };
  catalog = await service.edit(edit, 'sandbox');
  const pages = await Promise.all(['audio', 'concepts', 'other-concepts'].map(deck => service.activity('sandbox', deck)));
  expect(pages.every(page => page.events.length === 1)).toBe(true);
  expect(new Set(pages.map(page => page.events[0].id)).size).toBe(1);
  expect(pages[0].events[0].details.join('\n')).toContain('Hero: concepts Hero → other-concepts Hero');
  await service.edit({ ...edit, manifestHash: catalog.manifestHash, sourceHash: catalog.cards.find(card => card.id === child.id)!.sourceHash!, expectedParentId: second.id }, 'sandbox');
  expect((await service.activity('sandbox', 'audio')).events).toHaveLength(1);
});

it('rejected writes and failed callbacks leave source bytes and history untouched', async () => {
  const { root, service } = await fixture();
  const child = await seedCard(root);
  const catalog = await service.get('sandbox');
  const filename = path.join(root, 'cards', child.id.slice(5) + '.md');
  const before = await readFile(filename);
  const edit = { action: 'assign-deck' as const, cardId: child.id, sourceHash: child.sourceHash!, manifestHash: catalog.manifestHash, deckId: 'qa' };
  await expect(service.edit({ ...edit, sourceHash: '0'.repeat(64) }, 'sandbox')).rejects.toMatchObject({ status: 409 });
  await expect(service.edit({ ...edit, deckId: 'concepts' }, 'sandbox')).rejects.toMatchObject({ status: 422 });
  await expect(service.edit(edit, 'live')).rejects.toMatchObject({ status: 403 });
  await expect(service.recordMutation('import-cards', async () => { throw new Error('rejected before write'); })).rejects.toThrow('rejected before write');
  expect(await service.recordMutation('import-cards', async () => ({ unchanged: true }))).toEqual({ unchanged: true });
  expect(await readFile(filename)).toEqual(before);
  expect((await service.activity('sandbox', 'audio')).events).toEqual([]);
});

it('paginates by stable cursor without duplicates even when a newer event arrives', async () => {
  const { root } = await fixture();
  const expected: DeckActivityEvent[] = [];
  for (let index = 0; index < 13; index++) {
    const event = activityEvent(index, index % 3 === 0 ? ['qa'] : ['audio']);
    await appendActivity(root, event, 'ru');
    if (event.deckIds.includes('audio')) expected.push(event);
  }
  let page = await readActivity(root, 'audio', 3);
  expect(page.events).toHaveLength(3);
  expect(page.nextCursor).not.toBeNull();
  const seen = [...page.events];
  const newest = activityEvent(30);
  await appendActivity(root, newest, 'ru');
  while (page.nextCursor) {
    page = await readActivity(root, 'audio', 3, page.nextCursor);
    seen.push(...page.events);
    expect(seen.length).toBeLessThanOrEqual(expected.length);
  }
  expect(seen.map(event => event.id)).toEqual(expected.reverse().map(event => event.id));
  expect(new Set(seen.map(event => event.id)).size).toBe(seen.length);
  expect(seen.some(event => event.id === newest.id)).toBe(false);
  expect((await readActivity(root, 'audio', 1)).events[0].id).toBe(newest.id);
});

it('reports corrupt and mismatched-ID entries while returning readable history', async () => {
  const { root } = await fixture();
  const good = activityEvent(1);
  await appendActivity(root, good, 'ru');
  await appendActivity(root, activityEvent(2), 'ru');
  const files = (await readdir(path.join(root, 'tasks/deckmate-activity'))).sort();
  await writeFile(path.join(root, 'tasks/deckmate-activity', files[1]), 'not a managed event');
  const mismatch = activityEvent(3);
  await appendActivity(root, mismatch, 'ru');
  const mismatchPath = path.join(root, 'tasks/deckmate-activity', mismatch.at.replace(/[-:.]/gu, '') + '-' + mismatch.id + '.md');
  await writeFile(mismatchPath, (await readFile(mismatchPath, 'utf8')).replace(mismatch.id, randomUUID()));
  const page = await readActivity(root, 'audio');
  expect(page.events.map(event => event.id)).toEqual([good.id]);
  expect(page.warnings).toHaveLength(1);
  expect(page.warnings[0]).toContain('could not be read');
});

it('does not turn activity Markdown into a Doc Card or indexed project content', async () => {
  const { root, service } = await fixture();
  const before = await service.get('sandbox');
  const event = activityEvent(1);
  event.summary = 'OnlyActivitySentinel';
  await appendActivity(root, event, 'ru');
  const filename = (await readdir(path.join(root, 'tasks/deckmate-activity')))[0];
  expect(await readFile(path.join(root, 'tasks/deckmate-activity', filename), 'utf8')).toContain('OnlyActivitySentinel');
  service.invalidate('sandbox');
  const after = await service.get('sandbox');
  expect(after.cards.map(card => card.id)).toEqual(before.cards.map(card => card.id));
  expect(after.documents.some(document => document.path.startsWith('tasks/deckmate-activity/'))).toBe(false);
  expect(await service.search('sandbox', { text: 'OnlyActivitySentinel' })).toEqual([]);
});

it('returns a saved warning when journal persistence fails, without retrying the primary mutation', async () => {
  const { root, service } = await fixture();
  const child = await seedCard(root);
  const before = await service.get('sandbox');
  await writeFile(path.join(root, 'tasks/deckmate-activity'), 'A file blocks the journal directory.');
  const result = await service.edit({ action: 'assign-deck', manifestHash: before.manifestHash, sourceHash: child.sourceHash!, cardId: child.id, deckId: 'qa' }, 'sandbox');
  expect(result.cards.find(card => card.id === child.id)?.deckId).toBe('qa');
  expect(result.warnings.join(' ')).toContain('Changes were saved');
  expect(result.warnings.join(' ')).toContain('Do not repeat the change');
  expect((await readProjectCatalog(root)).cards.find(card => card.id === child.id)?.deckId).toBe('qa');
  expect((await readdir(path.join(root, 'cards'))).filter(name => name.endsWith('.md'))).toHaveLength(1);
});

it('validates the activity API query', async () => {
  const { app, root } = await appFixture();
  for (const url of ['/api/activity', '/api/activity?deckId=audio&limit=0', '/api/activity?deckId=audio&limit=51', '/api/activity?deckId=audio&cursor=..%2Fescape.md', '/api/activity?deckId=audio&source=other']) {
    expect((await app.inject({ url, headers })).statusCode).toBe(400);
  }
  await expect(readActivity(root, 'audio', 10, '../escape.md')).rejects.toThrow('Invalid journal cursor');
});

it('moving a deck does not attribute a settings edit to untouched neighboring decks', async () => {
  const { service } = await fixture();
  const before = await service.get('sandbox');
  await service.edit({ action: 'move-deck', deckId: 'audio', spaceId: 'archive', beforeDeckId: null, manifestHash: before.manifestHash }, 'sandbox');
  expect((await service.activity('sandbox', 'audio')).events).toHaveLength(1);
  for (const untouched of ['qa', 'concepts', 'other-concepts']) expect((await service.activity('sandbox', untouched)).events).toEqual([]);
});

it.each(['en', 'ru'] as const)('journals Space order in %s without attributing edits to unchanged decks', async formatLanguage => {
  const { root, service } = await fixture();
  const source = await readManifest(root);
  source.manifest.formatLanguage = formatLanguage;
  await writeFile(path.join(root, 'tasks/deckmate.md'), renderCatalogManifest(source.manifest));
  const before = await service.get('sandbox');
  const after = await service.edit({ action: 'move-space', spaceId: 'archive', beforeSpaceId: 'work', manifestHash: before.manifestHash }, 'sandbox');
  const event = describeActivity(before, after, 'move-space');
  expect(event).toMatchObject({ action: 'move-space', summary: formatLanguage === 'en' ? 'Space moved' : 'Space перемещён',
    deckIds: [], cards: [], details: ['1. Archive', '2. Work'] });
  expect(activityEventGroups(event!)).toEqual(new Set(['properties']));
  const journal = await readdir(path.join(root, 'tasks/deckmate-activity'));
  expect(journal).toHaveLength(1);
  expect(await readFile(path.join(root, 'tasks/deckmate-activity', journal[0]), 'utf8')).toContain(event!.summary);
  await service.edit({ action: 'move-space', spaceId: 'archive', beforeSpaceId: 'work', manifestHash: after.manifestHash }, 'sandbox');
  expect(await readdir(path.join(root, 'tasks/deckmate-activity'))).toEqual(journal);
  expect(describeActivity(after, after, 'move-space')).toBeNull();
  for (const deck of after.decks) expect((await service.activity('sandbox', deck.id)).events).toEqual([]);
});

it('keeps concurrent API errors in the request language and defaults to English', async () => {
  const { app } = await appFixture();
  const choices = ['ru', 'en', 'ru', undefined, 'unknown'];
  const responses = await Promise.all(choices.map(language => app.inject({
    url: '/r/c-missing', headers: { ...headers, ...(language ? { cookie: `deckmate-lang=${language}` } : {}) },
  })));
  responses.forEach((response, index) => {
    expect(response.statusCode).toBe(404);
    expect(response.json().message).toBe(choices[index] === 'ru' ? 'Карточка не найдена.' : 'Card not found.');
  });
});

it('keeps cached shared diagnostics in the request language without changing card data', async () => {
  const { root, config } = await fixture();
  const { manifest } = await readManifest(root);
  manifest.decks.push({ id: 'rules', title: 'Rules', kind: 'knowledge', spaceId: 'work', description: '', icon: 'box', color: '#234567' });
  await writeFile(path.join(root, 'tasks/deckmate.md'), renderCatalogManifest(manifest));
  const markdown = '## Открыто\n\n- Первый вопрос\n\n## Открыто\n\n- Второй вопрос\n';
  const card = await seedCard(root, { kind: 'doc', title: 'Правило', markdown, deckId: 'rules', owner: null, effort: null, priority: null });
  const app = await createApp(config);
  applications.push(app);
  for (const language of ['en', 'ru', 'en', 'ru']) {
    const response = await app.inject({ url: '/api/catalog?source=sandbox', headers: { ...headers, cookie: `deckmate-lang=${language}` } });
    expect(response.statusCode).toBe(200);
    const found = response.json<CatalogView>().cards.find(candidate => candidate.id === card.id)!;
    expect(found.title).toBe('Правило');
    expect(found.markdown).toBe(markdown);
    expect(found.openQuestionWarnings).toHaveLength(1);
    expect(found.openQuestionWarnings?.[0]).toBe(language === 'ru'
      ? 'Несколько разделов «Открыто» — считается только первый.'
      : 'Multiple “Open questions” sections; only the first is counted.');
    const search = await app.inject({ url: '/api/cards?source=sandbox&kind=doc', headers: { ...headers, cookie: `deckmate-lang=${language}` } });
    expect(search.statusCode).toBe(200);
    expect(search.json<CatalogView['cards']>().find(candidate => candidate.id === card.id)).toMatchObject({ title: found.title, markdown });
  }
  const snapshot = (await app.inject({ url: '/api/snapshot?source=sandbox', headers })).json<{ token: string }>();
  const edit = await creation(root);
  const created = await app.inject({ method: 'POST', url: '/api/catalog',
    headers: { ...headers, 'x-deckmate-token': snapshot.token }, payload: { ...edit, source: 'sandbox' } });
  expect(created.statusCode).toBe(200);
  for (const language of ['ru', 'en']) {
    const refreshed = await app.inject({ url: '/api/catalog?source=sandbox', headers: { ...headers, cookie: `deckmate-lang=${language}` } });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json<CatalogView>().cards.some(candidate => candidate.id === edit.cardId)).toBe(true);
  }
});

it('reads English and historic Russian journal fields while localizing generated notification lines', async () => {
  const { root, app } = await appFixture();
  const card = await seedCard(root);
  const event: DeckActivityEvent = { ...activityEvent(1), at: new Date().toISOString(), actorMemberId: 'another-member',
    cards: [{ id: card.id, title: card.title }], details: [`${card.title}: Archive: false → true`, `${card.title}: Удаление: false → true`] };
  await appendActivity(root, event, 'ru');
  const filename = path.join(root, 'tasks/deckmate-activity', event.at.replace(/[-:.]/gu, '') + '-' + event.id + '.md');
  const bytes = await readFile(filename);
  for (const language of ['ru', 'en']) {
    const response = await app.inject({ url: '/api/notifications?source=sandbox&member=kimi', headers: { ...headers, cookie: `deckmate-lang=${language}` } });
    expect(response.statusCode).toBe(200);
    const notification = response.json<NotificationsView>().stacks.find(stack => stack.id === 'owned')!.cards.find(item => item.cardId === card.id)!;
    expect(notification.changes[0].lines).toEqual(language === 'ru' ? ['Перенесена в архив', 'Удалена'] : ['Archived', 'Deleted']);
    const history = await readActivity(root, 'audio');
    expect(history.events[0].summary).toBe(event.summary);
    expect(history.events[0].details).toEqual(event.details);
    expect(await readFile(filename)).toEqual(bytes);
  }
});

it('localizes cached journal views and notifications without changing names, reasons or journal bytes', async () => {
  const { root, app } = await appFixture();
  const card = await seedCard(root, { title: 'State: the card' });
  const event: DeckActivityEvent = { ...activityEvent(2), at: new Date().toISOString(), actorMemberId: 'another-member',
    action: 'bulk-edit-cards', summary: 'Cards updated', cards: [{ id: card.id, title: card.title }],
    details: [`${card.title}: Description updated`, `${card.title}: State: started → review. Reason: Owner: keep this`,
      `${card.title}: Owner: Old Owner → Kimi`, `${card.title}: Effort: 1 → 2`, `${card.title}: Priority: low → high`,
      `${card.title}: Due date: null → "2026-11-09"`, `${card.title}: Custom: untouched`] };
  await appendActivity(root, event, 'en');
  const filename = path.join(root, 'tasks/deckmate-activity', event.at.replace(/[-:.]/gu, '') + '-' + event.id + '.md');
  const bytes = await readFile(filename);
  for (const language of ['ru', 'en', 'ru']) {
    const localizedHeaders = { ...headers, cookie: `deckmate-lang=${language}` };
    const expected = language === 'ru' ? [
      `${card.title}: Обновлено описание`, `${card.title}: Статус: В работе → Приёмка. Причина: Owner: keep this`,
      `${card.title}: Исполнитель: Old Owner → Kimi`, `${card.title}: Оценка: 1 → 2`, `${card.title}: Приоритет: Низкий → Высокий`,
      `${card.title}: Срок: null → "2026-11-09"`, `${card.title}: Custom: untouched`,
    ] : event.details;
    for (const url of ['/api/activity?source=sandbox&deckId=audio', `/api/card-activity?source=sandbox&cardId=${encodeURIComponent(card.id)}`]) {
      const response = await app.inject({ url, headers: localizedHeaders });
      expect(response.statusCode).toBe(200);
      const found = response.json().events.find((item: DeckActivityEvent) => item.id === event.id);
      expect(found.summary).toBe(language === 'ru' ? 'Карточки обновлены' : event.summary);
      expect(found.details).toEqual(expected);
      expect(found.cards).toEqual(event.cards);
    }
    const response = await app.inject({ url: '/api/notifications?source=sandbox&member=kimi', headers: localizedHeaders });
    const stacks = response.json<NotificationsView>().stacks;
    expect(stacks.map(stack => stack.title)).toEqual(language === 'ru'
      ? ['Ваши карточки', 'Карточки под наблюдением', 'Карточки со сроком']
      : ['Cards you own', 'Cards you watch', 'Due Cards']);
    const lines = stacks[0].cards.find(item => item.cardId === card.id)!.changes[0].lines;
    expect(lines).toContain(language === 'ru' ? 'Статус: В работе → Приёмка. Причина: Owner: keep this' : 'State: started → review. Reason: Owner: keep this');
    expect(lines).toContain(language === 'ru' ? 'Срок: — → 2026-11-09' : 'Due date: — → 2026-11-09');
    expect(await readFile(filename)).toEqual(bytes);
  }
});

// 2026-11-06: journal scans read entries in parallel chunks and share parses by file bytes. Pages, the first-page
// creation date and a rewritten entry must read exactly as the sequential scan did, across chunk boundaries.
it('keeps deck pages and card history exact across read-ahead chunks and after an entry is rewritten', async () => {
  const { root } = await fixture();
  const cardId = 'card:' + randomUUID();
  const written: DeckActivityEvent[] = [];
  for (let index = 0; index < 150; index++) {
    const event = activityEvent(index, index % 7 === 0 ? ['qa'] : ['audio']);
    if (index % 10 === 0) event.cards = [{ id: cardId, title: 'Tracked' }];
    await appendActivity(root, event, 'en');
    written.push(event);
  }
  const newestFirst = [...written].reverse();
  const deckPages: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await readActivity(root, 'qa', 5, cursor);
    deckPages.push(...page.events.map(event => event.id));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  expect(deckPages).toEqual(newestFirst.filter(event => event.deckIds.includes('qa')).map(event => event.id));

  const historyPages: string[] = [];
  const created: (string | null)[] = [];
  cursor = undefined;
  do {
    const page = await readCardActivity(root, cardId, 4, cursor);
    historyPages.push(...page.events.map(event => event.id));
    created.push(page.created?.at ?? null);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  expect(historyPages).toEqual(newestFirst.filter(event => event.cards.some(card => card.id === cardId)).map(event => event.id));
  expect(created).toEqual([written[0].at, ...created.slice(1).map(() => null)]);

  const newestQa = newestFirst.find(event => event.deckIds.includes('qa'))!;
  const filename = path.join(root, 'tasks/deckmate-activity', newestQa.at.replace(/[-:.]/gu, '') + '-' + newestQa.id + '.md');
  await writeFile(filename, (await readFile(filename, 'utf8')).replace(`summary: ${newestQa.summary}`, 'summary: Rewritten by hand'));
  expect((await readActivity(root, 'qa', 1)).events[0].summary).toBe('Rewritten by hand');
});
