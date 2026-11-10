import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CatalogStore, type CatalogAction } from '../client/catalog-store.ts';
import { setLang } from '../client/i18n.ts';
import type { CatalogView } from '../src/catalog-contracts.ts';
import type { WorkspaceSnapshot } from '../src/workspace-contracts.ts';

vi.hoisted(() => vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' }));

const fetchMock = vi.fn<typeof fetch>();
const snapshot: WorkspaceSnapshot & { token: string } = {
  projectName: 'Save feedback', source: 'sandbox', writable: true, editMode: 'direct',
  iteration: { number: 1, goal: '', start: '2026-11-10' }, token: 'test-token',
};
function view(revision: string, feedback: Partial<CatalogView> = {}): CatalogView {
  return { rootIdentity: 'feedback', formatLanguage: 'en', manifestHash: revision, cards: [], documents: [],
    spaces: [], decks: [], tracks: [], warnings: [], configured: true, indexedAt: revision, ...feedback };
}
function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}
const action: CatalogAction = { action: 'create-space', title: 'Unsaved draft', manifestHash: 'draft-base' };

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
  setLang('en');
});
afterEach(() => vi.unstubAllGlobals());

it.each(['en', 'ru'] as const)('preserves the server conflict message and draft on saved 409 (%s)', async lang => {
  setLang(lang);
  const store = new CatalogStore('sandbox');
  const message = lang === 'en' ? 'Resolve the conflict in steps/prepare.md.' : 'Устраните конфликт в steps/prepare.md.';
  fetchMock.mockResolvedValueOnce(response(view('initial')))
    .mockResolvedValueOnce(response({ message, saved: true }, 409))
    .mockResolvedValueOnce(response(view('refreshed')));
  await store.load();
  const draft = structuredClone(action);
  const onConfirmed = vi.fn();
  const onOutcome = vi.fn();
  expect(await store.edit(snapshot, draft, onOutcome, onConfirmed)).toBe(false);
  expect(store.getSnapshot()).toMatchObject({ pending: false, loading: false, error: null, warning: message,
    catalog: { manifestHash: 'refreshed' } });
  expect(onConfirmed).not.toHaveBeenCalled();
  expect(onOutcome).not.toHaveBeenCalled();
  expect(draft).toEqual(action);
  expect(JSON.parse(String(fetchMock.mock.calls[1]![1]!.body))).toMatchObject(action);
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

it.each(['', '<html>Conflict</html>', 'null', '{"message":42}'])('falls back safely for an unreadable 409 body: %s', async body => {
  const store = new CatalogStore('sandbox');
  fetchMock.mockResolvedValueOnce(response(view('initial')))
    .mockResolvedValueOnce(new Response(body, { status: 409 }))
    .mockResolvedValueOnce(response(view('refreshed')));
  await store.load();
  expect(await store.edit(snapshot, action)).toBe(false);
  expect(store.getSnapshot()).toMatchObject({ warning: null, pending: false, catalog: { manifestHash: 'refreshed' } });
  expect(store.getSnapshot().error).toContain('your form values are preserved');
});

it('uses a partial-save fallback rather than a retry suggestion when a saved 409 has no message', async () => {
  const store = new CatalogStore('sandbox');
  fetchMock.mockResolvedValueOnce(response(view('initial')))
    .mockResolvedValueOnce(response({ saved: true }, 409))
    .mockResolvedValueOnce(response(view('refreshed')));
  await store.load();
  expect(await store.edit(snapshot, action)).toBe(false);
  expect(store.getSnapshot()).toMatchObject({ error: null, warning: 'Some changes were saved. Refresh the data before continuing.' });
});

it.each([400, 403, 409, 422, 500])('preserves a server message on HTTP %s', async status => {
  const store = new CatalogStore('sandbox');
  const message = 'A specific server explanation; do not replace it.';
  fetchMock.mockResolvedValueOnce(response(view('initial')))
    .mockResolvedValueOnce(response({ code: 'CATALOG', message, saved: false }, status));
  if (status === 409) fetchMock.mockResolvedValueOnce(response(view('refreshed')));
  await store.load();
  expect(await store.edit(snapshot, action)).toBe(false);
  expect(store.getSnapshot()).toMatchObject({ pending: false, error: message, warning: null });
});

it.each([422, 500])('does not leak a JSON parser error for an HTML HTTP %s response', async status => {
  const store = new CatalogStore('sandbox');
  fetchMock.mockResolvedValueOnce(response(view('initial')))
    .mockResolvedValueOnce(new Response('<html>Failure</html>', { status }));
  await store.load();
  expect(await store.edit(snapshot, action)).toBe(false);
  expect(store.getSnapshot().error).toBe(`The request failed (HTTP ${status}).`);
});

it('does not treat project warnings as mutation feedback, even when their wording resembles a partial save', async () => {
  const store = new CatalogStore('sandbox');
  const warnings = ['Some changes were saved in an old document.', 'Изменения сохранены не полностью: текст карточки.'];
  fetchMock.mockResolvedValueOnce(response(view('initial')))
    .mockResolvedValueOnce(response(view('first-save', { savedWarning: 'Arbitrary localized feedback.' })))
    .mockResolvedValueOnce(response(view('second-save', { warnings })));
  await store.load();
  expect(await store.edit(snapshot, action)).toBe(true);
  expect(store.getSnapshot().warning).toBe('Arbitrary localized feedback.');
  expect(await store.edit(snapshot, action)).toBe(true);
  expect(store.getSnapshot()).toMatchObject({ error: null, warning: null, catalog: { warnings } });
});

it('retains the saved-conflict warning alongside a failed confirming read', async () => {
  const store = new CatalogStore('sandbox');
  fetchMock.mockResolvedValueOnce(response(view('initial')))
    .mockResolvedValueOnce(response({ message: 'Conflict in steps/prepare.md.', saved: true }, 409))
    .mockRejectedValueOnce(new TypeError('Failed to fetch'));
  await store.load();
  expect(await store.edit(snapshot, action)).toBe(false);
  expect(store.getSnapshot()).toMatchObject({ pending: false, loading: false, warning: 'Conflict in steps/prepare.md.',
    error: 'Deckmate is not responding. Check that it is running, then try again.' });
});

it('fences a read started before saved-conflict recovery', async () => {
  const store = new CatalogStore('sandbox');
  fetchMock.mockResolvedValueOnce(response(view('initial')));
  await store.load();
  let resolveRead!: (response: Response) => void;
  fetchMock.mockReturnValueOnce(new Promise(resolve => { resolveRead = resolve; }))
    .mockResolvedValueOnce(response({ message: 'Saved recovery conflict.', saved: true }, 409))
    .mockResolvedValueOnce(response(view('after-recovery')));
  const refreshing = store.refresh();
  const editing = store.edit(snapshot, action);
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  resolveRead(response(view('before-recovery')));
  expect(await editing).toBe(false);
  await refreshing;
  expect(store.getSnapshot()).toMatchObject({ warning: 'Saved recovery conflict.', error: null,
    catalog: { manifestHash: 'after-recovery' } });
});
