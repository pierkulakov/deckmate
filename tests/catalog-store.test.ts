import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { affectsCatalog, CatalogStore, catalogStore, invalidateCatalogs, prepareCatalogSession, releaseCatalogSession, readFreshCatalog, type CatalogAction } from '../client/catalog-store.ts';
import type { CatalogCard, CatalogView } from '../src/catalog-contracts.ts';
import type { WorkspaceSnapshot } from '../src/workspace-contracts.ts';
import { setLang } from '../client/i18n.ts';

vi.hoisted(() => {
  vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
});

const fetchMock = vi.fn<typeof fetch>();
const snapshot: WorkspaceSnapshot & { token: string } = {
  projectName: 'Cache test', source: 'sandbox', writable: true, editMode: 'sandbox',
  iteration: { number: 1, goal: 'Cache', start: '2026-11-05' }, token: 'test-token',
};
const cardId = 'card:00000000-0000-4000-8000-000000000001';

function view(revision: string, overrides: Partial<CatalogCard> = {}): CatalogView {
  return {
    rootIdentity: 'test-root', formatLanguage: 'ru', manifestHash: `manifest-${revision}`, optionsHash: `options-${revision}`,
    documents: [], spaces: [], decks: [], tracks: [], warnings: [], configured: true, indexedAt: revision,
    members: [{ id: 'reviewer', label: 'Reviewer', kind: 'human', aliases: [] }],
    cards: [{ id: cardId, kind: 'task', path: 'cards/test.md', version: null, title: revision, state: 'not-started',
      owner: null, markdown: '', sourceHash: `source-${revision}`, range: null, deckId: null,
      trackIds: [], parentId: null, ...overrides }],
  };
}

function stateEdit(overrides: Partial<Extract<CatalogAction, { action: 'set-card-state' }>> = {}): CatalogAction {
  return { action: 'set-card-state', cardId, sourceHash: 'source-initial', state: 'started', ...overrides };
}

function bulkEdit(): CatalogAction {
  return { action: 'bulk-edit-cards', manifestHash: 'draft-manifest', optionsHash: 'draft-options',
    cards: [{ cardId, sourceHash: 'draft-source' }], change: { kind: 'options', patch: { bookmarked: true } } };
}

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(complete => { resolve = complete; });
  return { promise, resolve };
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

it('shares one initial request and the same snapshot across consumers and twenty remounts', async () => {
  const store = new CatalogStore('sandbox');
  const pending = deferred<Response>();
  fetchMock.mockReturnValueOnce(pending.promise);
  const first = store.load();
  const second = store.load();
  expect(second).toBe(first);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  pending.resolve(response(view('initial')));
  await first;
  const confirmed = store.getSnapshot().catalog;
  const listener = vi.fn();
  const unsubscribe = store.subscribe(listener);
  for (let transition = 0; transition < 20; transition += 1) await store.load();
  expect(store.getSnapshot().catalog).toBe(confirmed);
  expect(listener).not.toHaveBeenCalled();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  unsubscribe();
  fetchMock.mockResolvedValueOnce(response(view('updated')));
  await store.refresh();
  expect(listener).not.toHaveBeenCalled();
  expect(store.getSnapshot().catalog?.cards[0]?.title).toBe('updated');
});

it('deduplicates explicit concurrent refreshes but reads again after an event during the request', async () => {
  const store = new CatalogStore('sandbox');
  fetchMock.mockResolvedValueOnce(response(view('initial')));
  await store.load();
  const pending = deferred<Response>();
  fetchMock.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(response(view('after-event')));
  const first = store.refresh();
  const second = store.refresh();
  expect(second).toBe(first);
  store.invalidate();
  pending.resolve(response(view('before-event')));
  await first;
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(store.getSnapshot()).toMatchObject({ loading: false, error: null, catalog: { indexedAt: 'after-event' } });
});

it('retries the current revision when a file event supersedes a failed GET', async () => {
  const store = new CatalogStore('sandbox');
  fetchMock.mockResolvedValueOnce(response(view('initial')));
  await store.load();
  const oldRead = deferred<Response>();
  fetchMock.mockReturnValueOnce(oldRead.promise).mockResolvedValueOnce(response(view('after-event')));
  const refreshing = store.refresh();
  store.invalidate();
  const eventRead = store.load();
  oldRead.resolve(response({ message: 'outdated failure' }, 500));
  await Promise.all([refreshing, eventRead]);
  expect(store.getSnapshot()).toMatchObject({ loading: false, error: null, catalog: { indexedAt: 'after-event' } });
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

it('optimistically clears a manual Hero mark to null and restores it after rejection', async () => {
  const store = new CatalogStore('sandbox');
  fetchMock.mockResolvedValueOnce(response(view('initial', { kind: 'hero', state: 'done' })));
  await store.load();
  const saving = deferred<Response>();
  fetchMock.mockReturnValueOnce(saving.promise);
  const editing = store.edit(snapshot, stateEdit({ state: 'not-started' }));
  const optimisticState = store.getSnapshot().catalog?.cards[0].state;
  saving.resolve(response({ message: 'not saved' }, 500));
  expect(await editing).toBe(false);
  expect(optimisticState).toBeNull();
  expect(store.getSnapshot().catalog?.cards[0].state).toBe('done');
});

it('keeps a failed initial request retryable instead of caching its rejected result', async () => {
  const store = new CatalogStore('sandbox');
  fetchMock.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(response(view('recovered')));
  await store.load();
  expect(store.getSnapshot()).toMatchObject({ catalog: null, loading: false, error: 'offline' });
  await store.load();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(store.getSnapshot()).toMatchObject({ loading: false, error: null, catalog: { indexedAt: 'recovered' } });
});

it('shows optimistic edits to every subscriber and rolls back onto the newest confirmed read', async () => {
  const store = new CatalogStore('sandbox');
  fetchMock.mockResolvedValueOnce(response(view('initial')));
  await store.load();
  const original = store.getSnapshot().catalog;
  const frozenOriginal = structuredClone(original);
  const saved = deferred<Response>();
  fetchMock.mockReturnValueOnce(saved.promise).mockResolvedValueOnce(response(view('external', { state: 'review' })));
  const listener = vi.fn();
  const unsubscribe = store.subscribe(listener);
  const editing = store.edit(snapshot, stateEdit());
  expect(store.getSnapshot()).toMatchObject({ pending: true, catalog: { cards: [{ state: 'started', sourceHash: 'source-initial' }] } });
  await store.refresh();
  expect(store.getSnapshot().catalog?.cards[0]).toMatchObject({ title: 'external', state: 'started', sourceHash: 'source-external' });
  saved.resolve(response({ message: 'save failed' }, 500));
  expect(await editing).toBe(false);
  expect(store.getSnapshot()).toMatchObject({ pending: false, error: 'save failed', catalog: { cards: [{ title: 'external', state: 'review' }] } });
  expect(original).toEqual(frozenOriginal);
  expect(listener).toHaveBeenCalled();
  unsubscribe();
});

it('does not let a late pre-save GET overwrite a successful POST', async () => {
  const store = new CatalogStore('sandbox');
  fetchMock.mockResolvedValueOnce(response(view('initial')));
  await store.load();
  const oldRead = deferred<Response>();
  fetchMock.mockReturnValueOnce(oldRead.promise).mockResolvedValueOnce(response(view('saved', { state: 'started' })));
  const refreshing = store.refresh();
  expect(await store.edit(snapshot, stateEdit())).toBe(true);
  oldRead.resolve(response(view('stale')));
  await refreshing;
  expect(store.getSnapshot()).toMatchObject({ loading: false, pending: false, catalog: { indexedAt: 'saved' } });
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

it('allows only one mutation per shared source and keeps explicit draft hashes unchanged', async () => {
  const store = new CatalogStore('sandbox');
  fetchMock.mockResolvedValueOnce(response(view('initial')));
  await store.load();
  const pending = deferred<Response>();
  fetchMock.mockReturnValueOnce(pending.promise);
  const action = stateEdit({ sourceHash: 'draft-source', manifestHash: 'draft-manifest' });
  const editing = store.edit(snapshot, action);
  expect(await store.edit(snapshot, stateEdit())).toBe(false);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  const request = fetchMock.mock.calls[1]![1]!;
  expect(JSON.parse(String(request.body))).toMatchObject({ ...action, source: 'sandbox' });
  expect(request.headers).toMatchObject({ 'x-deckmate-token': snapshot.token, 'x-deckmate-actor': 'reviewer' });
  pending.resolve(response(view('saved')));
  expect(await editing).toBe(true);
});

it('refreshes on conflict while preserving the submitted draft revisions and reporting failure', async () => {
  const store = new CatalogStore('sandbox');
  fetchMock.mockResolvedValueOnce(response(view('initial')))
    .mockResolvedValueOnce(response({ message: 'conflict' }, 409))
    .mockResolvedValueOnce(response(view('external')));
  await store.load();
  const action = bulkEdit();
  const frozenAction = structuredClone(action);
  expect(await store.edit(snapshot, action)).toBe(false);
  expect(store.getSnapshot()).toMatchObject({ pending: false, loading: false, catalog: { indexedAt: 'external' } });
  expect(store.getSnapshot().error).toBe('conflict');
  expect(action).toEqual(frozenAction);
  expect(JSON.parse(String(fetchMock.mock.calls[1]![1]!.body))).toMatchObject(frozenAction);
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

it('blocks uncertain bulk retries until a fresh read and delivers the eventual bulk outcome', async () => {
  const store = new CatalogStore('sandbox');
  const outcome = { applied: [cardId], unchanged: [], pending: [], warnings: [] };
  const confirmation = deferred<Response>();
  fetchMock.mockResolvedValueOnce(response(view('initial')))
    .mockResolvedValueOnce(response({ saved: true, message: 'result missing' }, 503))
    .mockReturnValueOnce(confirmation.promise)
    .mockResolvedValueOnce(response({ ...view('saved'), bulkOutcome: outcome }));
  await store.load();
  expect(await store.edit(snapshot, bulkEdit())).toBe(false);
  expect(store.getSnapshot().warning).toBe('result missing');
  expect(await store.edit(snapshot, bulkEdit())).toBe(false);
  expect(fetchMock).toHaveBeenCalledTimes(3);
  const confirming = store.load();
  confirmation.resolve(response(view('confirmed')));
  await confirming;
  const onOutcome = vi.fn();
  expect(await store.edit(snapshot, bulkEdit(), onOutcome)).toBe(true);
  expect(onOutcome).toHaveBeenCalledExactlyOnceWith(outcome);
});

it('retains the optimistic result of a saved edit until the confirming read arrives', async () => {
  const store = new CatalogStore('sandbox');
  const confirmation = deferred<Response>();
  fetchMock.mockResolvedValueOnce(response(view('initial')))
    .mockResolvedValueOnce(response({ saved: true, message: 'result missing' }, 503))
    .mockReturnValueOnce(confirmation.promise);
  await store.load();
  expect(await store.edit(snapshot, stateEdit())).toBe(true);
  expect(store.getSnapshot()).toMatchObject({ pending: false, warning: 'result missing',
    catalog: { cards: [{ state: 'started', sourceHash: 'source-initial' }] } });
  const confirming = store.load();
  confirmation.resolve(response(view('confirmed', { state: 'review' })));
  await confirming;
  expect(store.getSnapshot().catalog?.cards[0]).toMatchObject({ state: 'review', sourceHash: 'source-confirmed' });
});

it('does not accept a pre-failure GET as confirmation of an uncertain saved bulk result', async () => {
  const store = new CatalogStore('sandbox');
  fetchMock.mockResolvedValueOnce(response(view('initial')));
  await store.load();
  const oldRead = deferred<Response>();
  fetchMock.mockReturnValueOnce(oldRead.promise)
    .mockResolvedValueOnce(response({ saved: true, message: 'result missing' }, 503))
    .mockResolvedValueOnce(response(view('actually-saved')));
  const refreshing = store.refresh();
  expect(await store.edit(snapshot, bulkEdit())).toBe(false);
  expect(await store.edit(snapshot, bulkEdit())).toBe(false);
  oldRead.resolve(response(view('stale-before-write')));
  await refreshing;
  expect(store.getSnapshot().catalog?.indexedAt).toBe('actually-saved');
  expect(fetchMock).toHaveBeenCalledTimes(4);
});

it('reports partial bulk outcomes without losing the confirmed successful changes', async () => {
  const store = new CatalogStore('sandbox');
  const outcome = { applied: [cardId], unchanged: [], pending: ['another-card'], warnings: [] };
  fetchMock.mockResolvedValueOnce(response(view('initial')))
    .mockResolvedValueOnce(response({ ...view('partially-saved'), bulkOutcome: outcome }));
  await store.load();
  const onOutcome = vi.fn();
  expect(await store.edit(snapshot, bulkEdit(), onOutcome)).toBe(false);
  expect(onOutcome).toHaveBeenCalledExactlyOnceWith(outcome);
  expect(store.getSnapshot().catalog?.indexedAt).toBe('partially-saved');
  expect(store.getSnapshot().error).toContain('Saved 1, remaining 1');
});

it('isolates live and sandbox reads and edits even when one source resolves later', async () => {
  const sandbox = catalogStore('sandbox', 'source-isolation');
  const live = catalogStore('live', 'source-isolation');
  const sandboxRead = deferred<Response>();
  fetchMock.mockReturnValueOnce(sandboxRead.promise).mockResolvedValueOnce(response(view('live')));
  const pending = sandbox.load();
  await live.load();
  sandboxRead.resolve(response(view('sandbox')));
  await pending;
  expect(live.getSnapshot().catalog?.indexedAt).toBe('live');
  expect(sandbox.getSnapshot().catalog?.indexedAt).toBe('sandbox');
  expect(await live.edit({ ...snapshot, source: 'live', writable: false }, stateEdit())).toBe(false);
  expect(await sandbox.edit({ ...snapshot, source: 'live' }, stateEdit())).toBe(false);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('invalidates inactive source caches and resets both entries when the server session changes', async () => {
  const sandbox = catalogStore('sandbox', 'old-session');
  const live = catalogStore('live', 'old-session');
  fetchMock.mockResolvedValueOnce(response(view('sandbox-old')))
    .mockResolvedValueOnce(response(view('live-old')))
    .mockResolvedValueOnce(response(view('sandbox-new')))
    .mockResolvedValueOnce(response(view('live-new')));
  await sandbox.load();
  await live.load();
  invalidateCatalogs();
  await sandbox.load();
  expect(live.getSnapshot().catalog?.indexedAt).toBe('live-old');
  await live.load();
  expect(live.getSnapshot().catalog?.indexedAt).toBe('live-new');
  expect(catalogStore('sandbox', 'old-session')).toBe(sandbox);
  const newSandbox = catalogStore('sandbox', 'new-session');
  const newLive = catalogStore('live', 'new-session');
  expect(newSandbox).not.toBe(sandbox);
  expect(newLive).not.toBe(live);
  expect(newSandbox.getSnapshot().catalog).toBeNull();
  expect(newLive.getSnapshot().catalog).toBeNull();
});

it('skips only event paths that have no catalog representation', () => {
  expect(affectsCatalog('boards/example.excalidraw')).toBe(false);
  expect(affectsCatalog('tasks/deckmate-activity/event.md')).toBe(false);
  for (const changedPath of [undefined, 'cards/example.md', 'features/audio.md', 'docs/guide.md',
    'tasks/deckmate.md', 'tasks/iterations.md', 'tasks/deckmate-card-options.md', 'tasks/deckmate-notifications.md',
    'tasks/deckmate-runs.md', 'tasks/deckmate-milestones.md', 'tasks/journeys/example/index.md',
    'tasks/journey-templates/example/index.md']) expect(affectsCatalog(changedPath)).toBe(true);
});

it('subscribes to events before the first shared catalog read, including source changes', async () => {
  prepareCatalogSession('waiting-for-socket');
  const sandbox = catalogStore('sandbox', 'waiting-for-socket');
  const first = sandbox.load();
  const second = sandbox.load();
  await Promise.resolve();
  expect(fetchMock).not.toHaveBeenCalled();
  fetchMock.mockResolvedValueOnce(response(view('initial'))).mockResolvedValueOnce(response(view('live')));
  releaseCatalogSession('waiting-for-socket');
  await Promise.all([first, second]);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  // A new source on the same open socket must not wait for another connection.
  const live = catalogStore('live', 'waiting-for-socket');
  await live.load();
  expect(live.getSnapshot().catalog?.indexedAt).toBe('live');
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('revalidates a pending read when a separate completed write requests fresh revisions', async () => {
  const store = catalogStore('sandbox', 'external-write');
  const oldRead = deferred<Response>();
  fetchMock.mockReturnValueOnce(oldRead.promise).mockResolvedValueOnce(response(view('after-planning-write')));
  const loading = store.load();
  await Promise.resolve();
  const fresh = readFreshCatalog('sandbox');
  oldRead.resolve(response(view('before-write')));
  await loading;
  expect((await fresh).indexedAt).toBe('after-planning-write');
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('does not surface a failed stale GET after a successful POST', async () => {
  const store = new CatalogStore('sandbox');
  fetchMock.mockResolvedValueOnce(response(view('initial')));
  await store.load();
  const oldRead = deferred<Response>();
  fetchMock.mockReturnValueOnce(oldRead.promise).mockResolvedValueOnce(response(view('saved')));
  const loading = store.refresh();
  expect(await store.edit(snapshot, stateEdit())).toBe(true);
  oldRead.resolve(response({ message: 'outdated GET failure' }, 500));
  await loading;
  expect(store.getSnapshot()).toMatchObject({ error: null, catalog: { indexedAt: 'saved' } });
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

it('uses the current language for local failures while preserving server messages', async () => {
  const store = new CatalogStore('sandbox');
  fetchMock.mockRejectedValueOnce(null).mockRejectedValueOnce(null)
    .mockResolvedValueOnce(response({ message: 'Project-specific failure' }, 500));
  await store.load();
  expect(store.getSnapshot().error).toBe('Deckmate is not responding. Check that it is running, then try again.');
  setLang('ru');
  await store.load();
  expect(store.getSnapshot().error).toBe('Deckmate не отвечает. Проверьте, что он запущен, и повторите.');
  await store.load();
  expect(store.getSnapshot().error).toBe('Project-specific failure');
});

it('reports a stopped server in words instead of the browser text and says the edit was not saved', async () => {
  const store = new CatalogStore('sandbox');
  fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  await store.load();
  expect(store.getSnapshot().error).toBe('Deckmate is not responding. Check that it is running, then try again.');
  fetchMock.mockResolvedValueOnce(response(view('initial'))).mockRejectedValueOnce(new TypeError('Failed to fetch'));
  await store.load();
  expect(await store.edit(snapshot, stateEdit())).toBe(false);
  expect(store.getSnapshot()).toMatchObject({ pending: false, error: 'Not saved: Deckmate is not responding. Check that it is running, then try again.', catalog: { indexedAt: 'initial' } });
  expect(store.getSnapshot().catalog?.cards[0]?.state).toBe('not-started');
});

it.each([
  'Changes saved. The index was not fully updated.',
  'Изменения сохранены. Индекс обновлён не полностью.',
])('retains an incomplete-save warning in either server language: %s', async warning => {
  const store = new CatalogStore('sandbox');
  fetchMock.mockResolvedValueOnce(response(view('initial')))
    .mockResolvedValueOnce(response({ ...view('saved'), savedWarning: warning }));
  await store.load();
  expect(await store.edit(snapshot, stateEdit())).toBe(true);
  expect(store.getSnapshot().warning).toBe(warning);
});
