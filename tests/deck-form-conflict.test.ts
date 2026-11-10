import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CatalogStore, withCatalogFormHash, type CatalogAction } from '../client/catalog-store.ts';
import type { CatalogView } from '../src/catalog-contracts.ts';
import type { WorkspaceSnapshot } from '../src/workspace-contracts.ts';
import { setLang } from '../client/i18n.ts';

vi.hoisted(() => {
  vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
});

const fetchMock = vi.fn<typeof fetch>();
const snapshot: WorkspaceSnapshot & { token: string } = {
  projectName: 'Form conflict test', source: 'sandbox', writable: true, editMode: 'sandbox',
  iteration: { number: 1, goal: 'Conflict', start: '2026-11-09' }, token: 'test-token',
};

function view(revision: string): CatalogView {
  return {
    rootIdentity: 'test-root', formatLanguage: 'en', manifestHash: `manifest-${revision}`,
    documents: [], tracks: [], cards: [], warnings: [], configured: true, indexedAt: revision,
    spaces: [{ id: 'space', title: 'Space', kind: 'custom', icon: 'layers' }],
    decks: [{ id: 'deck', title: 'Original title', description: 'Original description', spaceId: 'space', kind: 'task',
      color: '#878787', icon: 'layers', style: 'symbol', cover: null, coverPosition: 50 }],
  };
}

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
  setLang('en');
});
afterEach(() => vi.unstubAllGlobals());

it('submits the hash captured when a deck form opened and preserves its draft through a conflict', async () => {
  const store = new CatalogStore('sandbox');
  fetchMock.mockResolvedValueOnce(response(view('opened')))
    .mockResolvedValueOnce(response(view('external')))
    .mockResolvedValueOnce(response({ message: 'conflict' }, 409))
    .mockResolvedValueOnce(response(view('external')))
    .mockResolvedValueOnce(response(view('retried')));
  await store.load();
  const openedHash = store.getSnapshot().catalog!.manifestHash;
  const draft: CatalogAction = { action: 'update-deck', deckId: 'deck', title: 'Draft title', description: 'Draft description',
    icon: 'book', color: '#123456', style: 'symbol', cover: null, coverPosition: 50 };
  const preservedDraft = structuredClone(draft);

  // 2026-11-09: a socket refresh must not rebase an open form or replace its field values.
  await store.refresh();
  expect(store.getSnapshot().catalog?.manifestHash).toBe('manifest-external');
  expect(await store.edit(snapshot, withCatalogFormHash(draft, openedHash))).toBe(false);

  const conflictRequest = fetchMock.mock.calls[2]![1]!;
  expect(JSON.parse(String(conflictRequest.body))).toMatchObject({ action: 'update-deck', manifestHash: 'manifest-opened', title: 'Draft title' });
  expect(store.getSnapshot().error).toBe('conflict');
  expect(draft).toEqual(preservedDraft);

  const retryHash = store.getSnapshot().catalog!.manifestHash;
  expect(await store.edit(snapshot, withCatalogFormHash(draft, retryHash))).toBe(true);
  expect(JSON.parse(String(fetchMock.mock.calls[4]![1]!.body))).toMatchObject({ ...preservedDraft, manifestHash: 'manifest-external' });
});

it('uses the previous response hash for the next operation in a space form', async () => {
  const store = new CatalogStore('sandbox');
  fetchMock.mockResolvedValueOnce(response(view('opened')))
    .mockResolvedValueOnce(response(view('updated')))
    .mockResolvedValueOnce(response(view('moved')));
  await store.load();
  let responseHash = store.getSnapshot().catalog!.manifestHash;

  expect(await store.edit(snapshot, withCatalogFormHash({ action: 'update-space', spaceId: 'space', title: 'Draft space', kind: 'custom', icon: 'layers' }, responseHash),
    undefined, result => { responseHash = result.manifestHash; })).toBe(true);
  expect(responseHash).toBe('manifest-updated');
  expect(await store.edit(snapshot, withCatalogFormHash({ action: 'move-space', spaceId: 'space', beforeSpaceId: null }, responseHash),
    undefined, result => { responseHash = result.manifestHash; })).toBe(true);

  expect(JSON.parse(String(fetchMock.mock.calls[1]![1]!.body))).toMatchObject({ action: 'update-space', manifestHash: 'manifest-opened' });
  expect(JSON.parse(String(fetchMock.mock.calls[2]![1]!.body))).toMatchObject({ action: 'move-space', manifestHash: 'manifest-updated' });
  expect(responseHash).toBe('manifest-moved');
});
