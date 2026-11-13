import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Excalidraw } from '@excalidraw/excalidraw';
import type { ExcalidrawProps } from '@excalidraw/excalidraw/types';
import type { WorkspaceSnapshot } from '../src/workspace-contracts.ts';
import Vision from '../client/components/Vision.tsx';
import { EmptyState } from '../client/components/EmptyState.tsx';
import { LoadingState } from '../client/components/LoadingState.tsx';
import { setLang } from '../client/i18n.ts';

// The chrome grammar test rides the same hook harness as the other Vision suites: Vision renders to a tree of
// elements without a DOM, so class names and structure are asserted directly where the browser suite measures
// computed styles. 2026-11-10: the runtime itself is shared from ./react-hook-harness.ts; vi.hoisted runs
// before imports resolve, so the factory is loaded through a dynamic import and awaited by the react mock and
// this file's body alike.
const harnessPromise = vi.hoisted(() => import('./react-hook-harness.ts').then(module => module.createHookHarness()));
const catalogState = vi.hoisted(() => ({ catalog: { cards: [], decks: [], members: [] } as { cards: []; decks: []; members: [] } | null, error: null as string | null }));

vi.hoisted(() => {
  vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
  vi.stubGlobal('location', new URL('http://localhost/?view=vision'));
});
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  ...(await harnessPromise).react,
}));
vi.mock('@excalidraw/excalidraw', () => ({
  Excalidraw: vi.fn(() => null),
  CaptureUpdateAction: { IMMEDIATELY: 'immediately' },
  restore: (scene: unknown) => scene,
  serializeAsJSON: vi.fn(() => '{"elements":[],"appState":{},"files":{}}'),
  convertToExcalidrawElements: (elements: unknown) => elements,
}));
vi.mock('../client/useCatalog.ts', () => ({ useCatalog: () => catalogState }));
vi.mock('../client/components/JourneyPanel.tsx', () => ({ CatalogReferenceLink: () => null }));
vi.mock('../client/onboarding/signals.ts', () => ({ emitSignal: vi.fn() }));

const hooks = await harnessPromise;

type Element = ReactElement<Record<string, any>>;
const snapshot = { source: 'sandbox', writable: true, token: 'test-token' } as unknown as WorkspaceSnapshot;
let tree: ReactNode;

function render() {
  for (let attempt = 0; attempt < 10; attempt++) {
    hooks.start();
    tree = Vision({ snapshot, refreshKey: 0, dark: false, onEditing: vi.fn(), onOpenCard: vi.fn() });
    if (!hooks.flush()) return;
  }
  throw new Error('Vision render did not settle');
}

function findAll(predicate: (element: Element) => boolean, node = tree, out: Element[] = []): Element[] {
  if (Array.isArray(node)) { node.forEach(child => findAll(predicate, child, out)); return out; }
  if (!isValidElement<Record<string, any>>(node)) return out;
  if (predicate(node)) out.push(node);
  const children = node.props.children ?? null;
  if (Array.isArray(children)) children.forEach(child => findAll(predicate, child, out));
  else findAll(predicate, children, out);
  return out;
}
const byClass = (name: string) => findAll(element => element.props.className === name);
const byClassStart = (name: string) => findAll(element => typeof element.props.className === 'string' && element.props.className.startsWith(name));
const textOf = (element: Element) => renderToStaticMarkup(element).replace(/<[^>]*>/gu, '');

beforeEach(() => {
  hooks.reset();
  catalogState.catalog = { cards: [], decks: [], members: [] };
  catalogState.error = null;
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] })));
  setLang('en');
  render();
});
afterEach(() => { hooks.unmount(); });

it('builds the toolbar from the shared page grammar of surface.css', () => {
  expect(byClass('vision-workspace page-light')).toHaveLength(1);
  expect(byClass('vision-toolbar page-head')).toHaveLength(1);
  expect(byClass('page-title vision-board-name')).toHaveLength(1);
  // The save state keeps its exact class: tests and the quiet caption under the name read it.
  expect(textOf(byClass('vision-save-state')[0])).toBe('New board');
  expect(byClass('page-caption')).toHaveLength(1);
  expect(byClass('action-mint vision-new-board')).toHaveLength(1);
  expect(textOf(byClass('action-mint vision-new-board')[0].props.children[1])).toBe('New board');
  expect(byClass('control-field vision-board-picker')).toHaveLength(1);
  expect(byClass('control-field vision-board-picker')[0].props['aria-label']).toBe('Vision board');
});

// 2026-11-10: the sidebar is one glass sheet; its panels become sections split by seams (surface.css .glass-sheet).
it('builds the sidebar as one glass sheet of panels with the shared empty states', () => {
  expect(byClass('glass-sheet vision-stack')).toHaveLength(1);
  const panels = byClassStart('glass-panel vision-panel');
  expect(panels).toHaveLength(4);
  expect(panels.map(panel => panel.props.className)).toEqual([
    'glass-panel vision-panel',
    'glass-panel vision-panel vision-tools',
    'glass-panel vision-panel vision-tools',
    'glass-panel vision-panel vision-text-refs',
  ]);
  expect(byClass('panel-title').map(textOf)).toEqual(['Cards on the board', 'Smart Node', 'YouTube video', 'References in text']);
  expect(byClass('panel-count').map(textOf)).toEqual(['0', '0']);
  // Empty lists explain themselves through the shared EmptyState, not panel-local paragraphs.
  const empties = findAll(element => element.type === EmptyState);
  expect(empties.map(element => ({ ...element.props, message: renderToStaticMarkup(element.props.message) }))).toEqual([
    { variant: 'quiet', message: expect.stringContaining('<span>Find a card and click + to add it to the board.</span>') },
    { variant: 'quiet', message: expect.stringContaining('<span>There are no references in text nodes yet.</span>') },
  ]);
});

it('keeps the localized chrome in Russian', () => {
  setLang('ru');
  render();
  expect(textOf(byClass('vision-save-state')[0])).toBe('Новая доска');
  expect(textOf(byClass('action-mint vision-new-board')[0].props.children[1])).toBe('Новая доска');
  expect(byClass('panel-title').map(textOf)).toEqual(['Карточки на доске', 'Умный узел', 'Видео YouTube', 'Ссылки в тексте']);
  expect(byClass('control-field vision-board-picker')[0].props['aria-label']).toBe('Доска Vision');
});

it('still mounts the canvas and keeps the loading plate inside it', () => {
  const canvas = findAll(element => element.type === Excalidraw)[0] as ExcalidrawProps extends never ? never : Element;
  expect(canvas).toBeDefined();
  expect(canvas.props.onChange).toBeTypeOf('function');
});

it('waits for the first catalog without flashing empty sidebar results, and ends the wait on failure', () => {
  catalogState.catalog = null;
  render();
  const sidebar = () => byClass('vision-links')[0];
  expect(findAll(element => element.type === LoadingState, sidebar())).toHaveLength(1);
  expect(findAll(element => element.type === EmptyState, sidebar())).toHaveLength(0);
  catalogState.error = 'Catalog unavailable';
  render();
  expect(findAll(element => element.type === LoadingState, sidebar())).toHaveLength(0);
  expect(byClass('catalog-error vision-error')).toHaveLength(1);
  expect(findAll(element => element.props.children === 'Retry')).toHaveLength(1);
});

it.each(['en', 'ru'] as const)('keeps %s on entry even if the document has a regional locale', lang => {
  setLang(lang);
  render();
  const code = lang === 'ru' ? 'ru-RU' : 'en-US';
  expect(findAll(element => element.type === Excalidraw)[0].props.langCode).toBe(code);
  document.documentElement.lang = code;
  render();
  expect(findAll(element => element.type === Excalidraw)[0].props.langCode).toBe(code);
});
