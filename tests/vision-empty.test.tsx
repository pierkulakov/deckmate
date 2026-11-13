import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CatalogView } from '../src/catalog-contracts.ts';
import type { WorkspaceSnapshot } from '../src/workspace-contracts.ts';
import Vision from '../client/components/Vision.tsx';
import { setLang } from '../client/i18n.ts';

// 2026-11-10: Vision renders without Excalidraw (mocked below) and without a browser; the shared runtime from
// ./react-hook-harness.ts lets a static render re-run after a state change. vi.hoisted runs before imports
// resolve, so the factory is loaded through a dynamic import; the react mock below and this file's body
// await the same per-suite instance.
const harnessPromise = vi.hoisted(() => import('./react-hook-harness.ts').then(module => module.createHookHarness()));

vi.hoisted(() => {
  vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '', getElementById: () => null });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
  vi.stubGlobal('location', new URL('http://localhost/?view=vision'));
});
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  ...(await harnessPromise).react,
}));
vi.mock('@excalidraw/excalidraw', () => ({
  Excalidraw: () => null,
  CaptureUpdateAction: { IMMEDIATELY: 'immediately' },
  restore: (scene: unknown) => scene,
  serializeAsJSON: vi.fn((elements: unknown, appState: unknown, files: unknown) => JSON.stringify({ elements, appState, files })),
  convertToExcalidrawElements: (elements: unknown) => elements,
}));
const catalogState = vi.hoisted(() => ({ catalog: null as CatalogView | null }));
vi.mock('../client/useCatalog.ts', () => ({ useCatalog: () => ({ catalog: catalogState.catalog, error: null }) }));
vi.mock('../client/components/JourneyPanel.tsx', () => ({ CatalogReferenceLink: () => null }));
vi.mock('../client/onboarding/signals.ts', () => ({ emitSignal: vi.fn() }));

const hooks = await harnessPromise;

type Element = ReactElement<Record<string, any>>;
const defaultCatalog: CatalogView = {
  rootIdentity: 'vision-empty', formatLanguage: 'en', manifestHash: 'manifest', configured: true, indexedAt: '',
  documents: [], spaces: [], tracks: [], warnings: [],
  cards: [{
    id: 'c-1', kind: 'task', path: 'card-1.md', version: null, title: 'First card', state: null,
    owner: null, markdown: '', sourceHash: 'hash', range: null, deckId: null, trackIds: [], parentId: null,
  }],
  decks: [{ id: 'd-1', spaceId: 's-1', title: 'Deck', kind: 'task', description: '', color: '', icon: '' }],
  members: [],
};
let snapshot: WorkspaceSnapshot = { source: 'sandbox', writable: true, token: 'test-token' } as unknown as WorkspaceSnapshot;
let tree: ReactNode;

function render() {
  for (let attempt = 0; attempt < 10; attempt++) {
    hooks.start();
    tree = Vision({ snapshot, refreshKey: 0, dark: false, onEditing: () => undefined, onOpenCard: () => undefined });
    if (!hooks.flush()) return;
  }
  throw new Error('Vision render did not settle');
}

function find(predicate: (element: Element) => boolean, node = tree): Element | undefined {
  if (Array.isArray(node)) return node.map(child => find(predicate, child)).find(Boolean);
  if (!isValidElement<Record<string, any>>(node)) return;
  if (predicate(node)) return node;
  return find(predicate, node.props.children ?? null);
}
const html = () => renderToStaticMarkup(tree as ReactElement);
// 2026-11-10: the search field's aria-label is language-dependent, so the tests track the active lang themselves.
let lang: 'en' | 'ru' = 'en';
const searchLabel = () => lang === 'ru' ? 'Найти карточку для доски' : 'Find a card for the board';
const searchInput = () => find(element => element.props['aria-label'] === searchLabel())!;
function typeQuery(value: string) {
  searchInput().props.onChange({ target: { value } });
  render();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  hooks.reset();
  catalogState.catalog = defaultCatalog;
  snapshot = { source: 'sandbox', writable: true, token: 'test-token' } as unknown as WorkspaceSnapshot;
  vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '', getElementById: () => null });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
  vi.stubGlobal('location', new URL('http://localhost/?view=vision'));
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] })));
  setLang('en');
  lang = 'en';
  render();
});
afterEach(() => { hooks.unmount(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it.each(['en', 'ru'] as const)('%s: a query without matches is a filtered state with a reset, not a quiet note', testLang => {
  setLang(testLang);
  lang = testLang;
  render();
  typeQuery('no-such-card');
  const markup = html();
  expect(markup).toContain('ui-empty-filtered');
  expect(markup).toContain(testLang === 'en' ? 'No matches.' : 'Совпадений нет.');
  expect(markup).toContain(testLang === 'en' ? 'Reset search and filters' : 'Сбросить поиск и фильтры');
  // EmptyState is an unexpanded component in the tree, so the reset is invoked through its onReset prop.
  const filtered = find(element => element.props.variant === 'filtered')!;
  filtered.props.onReset();
  render();
  expect(html()).not.toContain('ui-empty-filtered');
});

it('a project without cards states the quiet fact instead of a failed search', () => {
  catalogState.catalog = { ...defaultCatalog, cards: [] };
  render();
  typeQuery('anything');
  const markup = html();
  expect(markup).toContain('ui-empty-quiet');
  expect(markup).toContain('The project has no cards yet.');
  expect(markup).not.toContain('ui-empty-filtered');
  expect(markup).not.toContain('Reset search and filters');
});

it('writable: an unlinked board invites the + action', () => {
  expect(html()).toContain('Find a card and click + to add it to the board.');
});

it('read-only: an unlinked board states the fact without inviting an unavailable action', () => {
  snapshot = { ...snapshot, writable: false } as WorkspaceSnapshot;
  render();
  const markup = html();
  expect(markup).toContain('No cards are linked to this board yet.');
  expect(markup).not.toContain('Find a card and click +');
});

it('a project without decks is a quiet note, not an alert, and the Widget stays disabled', () => {
  catalogState.catalog = { ...defaultCatalog, decks: [] };
  render();
  const markup = html();
  expect(markup).toContain('The project has no decks for Smart Node.');
  expect(markup).not.toContain('role="alert"');
  expect(markup).not.toContain('inline-error');
  const deckSelect = find(element => element.props['aria-label'] === 'Widget deck')!;
  expect(deckSelect.props['aria-invalid']).toBeUndefined();
  const widget = find(element => element.props.onClick && renderToStaticMarkup(element).replace(/<[^>]*>/gu, '') === 'Widget');
  expect(widget!.props.disabled).toBe(true);
});
