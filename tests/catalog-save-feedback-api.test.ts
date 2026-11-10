import { afterEach, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../server/app.ts';
import { emptyManifest, readProjectCatalog, renderCatalogManifest } from '../server/catalog.ts';
import { publishJourney, updateJourney } from '../server/journeys.ts';
import { CatalogStore, type CatalogAction } from '../client/catalog-store.ts';
import { setLang } from '../client/i18n.ts';
import { langCookie, type Lang } from '../src/i18n.ts';
import type { CatalogEdit, CatalogView } from '../src/catalog-contracts.ts';
import type { WorkspaceSnapshot } from '../src/workspace-contracts.ts';

const fault = vi.hoisted(() => {
  vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
  return { cardPath: '', manifestPath: '', renameTarget: '', failBeforeRenameTarget: '' };
});
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual,
    async link(...args: Parameters<typeof actual.link>) {
      await actual.link(...args);
      if (String(args[1]) === fault.cardPath) {
        fault.cardPath = '';
        const bytes = await actual.readFile(fault.manifestPath);
        await actual.writeFile(fault.manifestPath, Buffer.concat([bytes, Buffer.from('\nExternal edit.\n')]));
      }
    },
    async rename(...args: Parameters<typeof actual.rename>) {
      if (fault.failBeforeRenameTarget && String(args[1]).replaceAll('\\', '/').endsWith(fault.failBeforeRenameTarget)) {
        fault.failBeforeRenameTarget = '';
        throw new Error('Injected bulk publication failure');
      }
      await actual.rename(...args);
      if (fault.renameTarget && String(args[1]).replaceAll('\\', '/').endsWith(fault.renameTarget)) {
        fault.renameTarget = '';
        throw new Error('Injected interruption after publication');
      }
    },
  };
});

const roots: string[] = [];
const apps: FastifyInstance[] = [];
const existingCardId = 'task:features/work.md#1.0';
const host = '127.0.0.1:44369';
afterEach(async () => {
  Object.assign(fault, { cardPath: '', manifestPath: '', renameTarget: '', failBeforeRenameTarget: '' });
  for (const app of apps.splice(0)) await app.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'deckmate-save-feedback-'));
  roots.push(root);
  await mkdir(path.join(root, 'tasks'));
  await mkdir(path.join(root, 'features'));
  await writeFile(path.join(root, 'features/work.md'), '# Work\n## 1 — Work\n### 1.0 Existing (not-started)\n');
  const manifest = emptyManifest();
  manifest.formatLanguage = 'en';
  manifest.spaces.push({ id: 'work', title: 'Work' });
  manifest.decks.push({ id: 'work', spaceId: 'work', title: 'Work', kind: 'task', icon: 'box', color: '#123456', description: '' },
    { id: 'assets', spaceId: 'work', title: 'Assets', kind: 'asset', icon: 'box', color: '#123456', description: '' });
  manifest.membership.push({ card: existingCardId, deck: 'work' });
  manifest.deckOrder = { work: { flatOrder: [existingCardId] } };
  await writeFile(path.join(root, 'tasks/deckmate.md'), renderCatalogManifest(manifest));
  return root;
}

async function connect(root: string, lang: Lang) {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
  vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
  setLang(lang);
  const app = await createApp({ dataRoot: root, writeRoot: root, editMode: 'direct',
    projectName: 'Save feedback', port: 44369, python: 'python' });
  apps.push(app);
  const headers = { host, cookie: `${langCookie}=${lang}` };
  const snapshot = (await app.inject({ url: '/api/snapshot?source=sandbox', headers })).json<WorkspaceSnapshot & { token: string }>();
  const posts: Array<{ status: number; body: Record<string, unknown> }> = [];
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const requestHeaders = Object.fromEntries(new Headers(init?.headers).entries());
    const response = await app.inject({ url: String(input), method: init?.method === 'POST' ? 'POST' : 'GET',
      headers: { ...headers, ...requestHeaders }, payload: init?.body ? String(init.body) : undefined });
    if (init?.method === 'POST') posts.push({ status: response.statusCode, body: response.json() });
    return new Response(response.body, { status: response.statusCode, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  const store = new CatalogStore('sandbox');
  await store.load();
  expect(store.getSnapshot().error).toBeNull();
  return { store, snapshot, posts, fetchMock };
}

it.each(['en', 'ru'] as const)('shows a real server partial-save response after card creation/order conflict (%s)', async lang => {
  const root = await fixture();
  const { store, snapshot, posts } = await connect(root, lang);
  const uuid = randomUUID();
  const action: CatalogAction = { action: 'create-card', cardId: `card:${uuid}`, kind: 'task', title: 'Saved before order conflict',
    markdown: 'Keep my draft.', deckId: 'work', trackIds: [], parentId: null, owner: null, effort: null, priority: null };
  fault.cardPath = path.join(root, 'cards', `${uuid}.md`);
  fault.manifestPath = path.join(root, 'tasks/deckmate.md');
  expect(await store.edit(snapshot, action)).toBe(true);
  expect(fault.cardPath).toBe('');
  const message = lang === 'en' ? 'Some changes were saved. Refresh the data before continuing.'
    : 'Часть изменений сохранена. Обновите данные перед продолжением.';
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({ status: 200, body: { savedWarning: message } });
  expect(store.getSnapshot()).toMatchObject({ error: null, warning: message, pending: false });
  expect(store.getSnapshot().catalog!.cards.some(card => card.id === action.cardId)).toBe(true);
  expect(store.getSnapshot().catalog!.deckOrder!.work.flatOrder).toEqual([existingCardId]);
  expect(store.getSnapshot().catalog!.warnings).not.toContain(message);
  const ordinaryRead = await fetch(`/api/catalog?source=sandbox`).then(response => response.json()) as CatalogView;
  expect(ordinaryRead.savedWarning).toBeUndefined();
});

it.each(['en', 'ru'] as const)('keeps drafts and the real recovery message for saved and completed Journey conflicts (%s)', async lang => {
  const root = await fixture();
  const id = randomUUID();
  const step = { id: 'prepare', title: 'Prepare', markdown: 'Original instructions.\n', deckId: 'work', owner: null, dependsOn: [] };
  await publishJourney(root, async () => {}, { id, title: 'Journey', version: 1, deckId: 'assets', description: '', zones: [], steps: [step] });
  const catalog = await readProjectCatalog(root);
  const journey = catalog.journeys![0];
  const edit: Extract<CatalogEdit, { action: 'update-journey' }> = { action: 'update-journey', journeyId: id,
    journeyHash: journey.fileHash, manifestHash: catalog.manifestHash, title: 'New Journey', description: '', zones: [],
    steps: [{ ...step, markdown: 'Updated instructions.\n' }] };
  fault.renameTarget = '/steps/prepare.md';
  await expect(updateJourney(root, catalog, edit)).rejects.toMatchObject({ saved: true });
  expect(fault.renameTarget).toBe('');
  const stepPath = path.join(root, `tasks/journeys/${id}/steps/prepare.md`);
  const savedBytes = await readFile(stepPath);
  const externalBytes = Buffer.concat([savedBytes, Buffer.from('\nForeign instructions.\n')]);
  await writeFile(stepPath, externalBytes);
  const { store, snapshot, posts, fetchMock } = await connect(root, lang);
  const draft = structuredClone(edit);
  const onConfirmed = vi.fn();
  expect(await store.edit(snapshot, draft, undefined, onConfirmed)).toBe(false);
  expect(posts[0]).toMatchObject({ status: 409, body: { code: 'CATALOG', saved: true, message: expect.stringContaining('steps/prepare.md') } });
  expect(store.getSnapshot()).toMatchObject({ warning: posts[0]!.body.message, error: null, pending: false,
    catalog: { journeys: [{ pendingOperation: { state: 'conflict', file: 'steps/prepare.md' } }] } });
  expect(await readFile(stepPath)).toEqual(externalBytes);
  expect(onConfirmed).not.toHaveBeenCalled();
  expect(draft).toEqual(edit);
  expect(fetchMock).toHaveBeenCalledTimes(3);

  await writeFile(stepPath, savedBytes);
  expect(await store.edit(snapshot, draft, undefined, onConfirmed)).toBe(false);
  const recoveredMessage = lang === 'en' ? 'An unfinished Journey save has now been completed. Check the Journey and repeat your action.'
    : 'Незавершённое сохранение Journey сейчас завершено. Проверьте Journey и повторите действие.';
  expect(posts[1]).toMatchObject({ status: 409, body: { saved: false, message: recoveredMessage } });
  expect(store.getSnapshot()).toMatchObject({ error: recoveredMessage, warning: null,
    catalog: { journeys: [{ version: 2, title: edit.title }] } });
  expect(store.getSnapshot().catalog!.journeys![0].pendingOperation).toBeUndefined();
  expect(onConfirmed).not.toHaveBeenCalled();
  expect(draft).toEqual(edit);
});

it('preserves the real server validation explanation on 422', async () => {
  const root = await fixture();
  const { store, snapshot, posts } = await connect(root, 'ru');
  expect(await store.edit(snapshot, { action: 'create-space', title: '   ' })).toBe(false);
  expect(posts[0]!.status).toBe(422);
  expect(store.getSnapshot().error).toBe(posts[0]!.body.message);
  expect(store.getSnapshot().error).toBeTruthy();
});

it('exposes bulk mutation warnings separately from project warnings with the exact pending selection', async () => {
  const root = await fixture();
  const { store, snapshot, posts } = await connect(root, 'en');
  const ids = [randomUUID(), randomUUID()];
  for (const id of ids) {
    expect(await store.edit(snapshot, { action: 'create-card', cardId: `card:${id}`, kind: 'task', title: id,
      markdown: '', deckId: 'work', trackIds: [], parentId: null, owner: null, effort: null, priority: null })).toBe(true);
  }
  const before = store.getSnapshot().catalog!;
  const cards = ids.map(id => before.cards.find(card => card.id === `card:${id}`)!);
  fault.failBeforeRenameTarget = `/cards/${ids[1]}.md`;
  const onOutcome = vi.fn();
  expect(await store.edit(snapshot, { action: 'bulk-edit-cards', optionsHash: before.optionsHash!,
    cards: cards.map(card => ({ cardId: card.id, sourceHash: card.sourceHash })),
    change: { kind: 'state', state: 'started' } }, onOutcome)).toBe(false);
  expect(fault.failBeforeRenameTarget).toBe('');
  const result = posts.at(-1)!;
  expect(result.status).toBe(200);
  expect(result.body.savedWarning).toContain('Injected bulk publication failure');
  expect(result.body.warnings).not.toContain(result.body.savedWarning);
  expect(onOutcome).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ applied: [cards[0]!.id], pending: [cards[1]!.id] }));
  expect(store.getSnapshot().warning).toBe(result.body.savedWarning);
});
