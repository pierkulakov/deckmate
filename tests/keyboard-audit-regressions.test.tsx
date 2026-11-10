import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { readFileSync } from 'node:fs';
import { Excalidraw, restore } from '@excalidraw/excalidraw';
import { EditorCommandMenu } from '../client/components/EditorCommandMenu.tsx';
import { ShortcutsHelp } from '../client/components/ShortcutsHelp.tsx';
import { useCardSelection } from '../client/components/CardSelection.tsx';
import Vision from '../client/components/Vision.tsx';
import { ALL_SHORTCUTS, matchShortcut, type ShortcutScreen } from '../client/keyboard-shortcuts.ts';
import { setLang } from '../client/i18n.ts';
import type { CatalogView } from '../src/catalog-contracts.ts';
import type { WorkspaceSnapshot } from '../src/workspace-contracts.ts';

// 2026-11-10: the shared state/memo/effect runtime lives in ./react-hook-harness.ts. vi.hoisted runs before
// imports resolve, so the factory is loaded through a dynamic import; the react mock below and this file's
// body await the same per-suite instance instead of each suite carrying its own copy of the hooks.
const harnessPromise = vi.hoisted(() => import('./react-hook-harness.ts').then(module => module.createHookHarness()));
const fixture = vi.hoisted(() => ({ catalog: null as CatalogView | null, catalogError: null as string | null, refresh: vi.fn() }));
vi.hoisted(() => {
  vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
  vi.stubGlobal('localStorage', { getItem: () => null });
});
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(), ...(await harnessPromise).react,
  // 2026-11-10: EditorCommandMenu builds DOM ids from useId; the fixed value keeps this suite's old contract.
  useId: () => 'editor-test',
}));
vi.mock('@excalidraw/excalidraw', () => ({
  Excalidraw: () => null, CaptureUpdateAction: { IMMEDIATELY: 'immediately' },
  restore: vi.fn((scene: unknown) => scene),
  serializeAsJSON: (elements: unknown, appState: unknown, files: unknown) => JSON.stringify({ elements, appState, files }),
  convertToExcalidrawElements: (elements: unknown) => elements,
}));
vi.mock('../client/useCatalog.ts', () => ({ useCatalog: () => ({ catalog: fixture.catalog, error: fixture.catalogError, refresh: fixture.refresh }) }));
vi.mock('../client/components/Deck.tsx', () => ({ DeckHeaderHint: () => null }));
vi.mock('../client/components/JourneyPanel.tsx', () => ({ CatalogReferenceLink: () => null }));
vi.mock('../client/components/BulkActions.tsx', () => ({ BulkActions: () => null }));
vi.mock('../client/components/CatalogCardTile.tsx', () => ({ cardIcons: {} }));
vi.mock('../client/onboarding/signals.ts', () => ({ emitSignal: vi.fn() }));

const hooks = await harnessPromise;

type ElementNode = ReactElement<Record<string, any>>;
let tree: ReactNode;
function nodes(node = tree): ElementNode[] {
  if (Array.isArray(node)) return node.flatMap(child => nodes(child ?? null));
  if (!isValidElement<Record<string, any>>(node)) return [];
  return [node, ...nodes(node.props.children ?? null)];
}
function find(predicate: (element: ElementNode) => boolean, node = tree) { return nodes(node).find(predicate)!; }
function render(component: () => ReactNode) {
  for (let attempt = 0; attempt < 10; attempt++) {
    hooks.start(); tree = component();
    if (!hooks.flush()) return;
  }
  throw new Error('Render did not settle');
}
class Target {
  constructor(readonly canvas = false) {}
  closest(selector: string) { return this.canvas && selector === '.vision-canvas .excalidraw' ? this : null; }
}
function key(code: string, key: string, extra: Record<string, unknown> = {}) {
  const event = new Event('keydown', { cancelable: true });
  Object.assign(event, { code, key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, isComposing: false, ...extra });
  return event as KeyboardEvent;
}
function dispatch(event: KeyboardEvent, target = new Target()) {
  Object.defineProperty(event, 'target', { value: target });
  window.dispatchEvent(event);
}
const stored = new Map<string, string>();
const snapshot = { source: 'sandbox', writable: true, token: 'test-token' } as unknown as WorkspaceSnapshot;
const catalog = { decks: [], cards: [], members: [], documents: [] } as unknown as CatalogView;
const board = { id: 'remembered', title: 'Existing board', hash: 'original-hash', access: 'editable', linkedCardIds: [],
  scene: { type: 'excalidraw', version: 2, elements: [{ id: 'kept', type: 'rectangle', version: 1 }], appState: {}, files: {} } };
const vision = () => Vision({ snapshot, refreshKey: 0, dark: false, onEditing: vi.fn(), onOpenCard: vi.fn() });
const help = (screens: readonly ShortcutScreen[] = ['app'], writable = true) => ShortcutsHelp({ screens, writable, vision: true });
const canvas = () => find(element => element.type === Excalidraw);
const button = (label: string) => find(element => element.props.onClick && (element.props.children === label || element.props.children?.includes?.(label)));
async function settle(component = vision) { for (let index = 0; index < 30; index++) await Promise.resolve(); render(component); }

beforeEach(() => {
  hooks.reset(); stored.clear(); vi.clearAllMocks();
  fixture.catalog = null; fixture.catalogError = null;
  vi.stubGlobal('Element', Target); vi.stubGlobal('HTMLElement', Target);
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '', activeElement: null,
    getElementById: () => null, querySelectorAll: () => [], execCommand: () => false });
  vi.stubGlobal('localStorage', { getItem: (name: string) => stored.get(name) ?? null, setItem: (name: string, value: string) => stored.set(name, value), removeItem: (name: string) => stored.delete(name) });
  vi.stubGlobal('location', new URL('http://localhost/?view=vision'));
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] })));
  setLang('en');
});
afterEach(() => { hooks.reset(); vi.useRealTimers(); });

it.each([
  ['KeyB', 'и', false, '**text**'], ['KeyI', 'ш', false, '_text_'], ['KeyE', 'у', false, '`text`'],
  ['KeyK', 'л', false, '[text](https://)'], ['KeyX', 'Ч', true, '~~text~~'],
] as const)('formats by physical %s with a Russian key', (code, character, shiftKey, expected) => {
  const onChange = vi.fn();
  render(() => EditorCommandMenu({ value: 'text', onChange, catalog, disabled: false }));
  const textarea = find(element => element.type === 'textarea');
  textarea.props.ref.current = { selectionStart: 0, selectionEnd: 4, maxLength: 1000, focus: vi.fn(), setSelectionRange: vi.fn() };
  const event = { code, key: character, shiftKey, ctrlKey: true, nativeEvent: {}, preventDefault: vi.fn(), stopPropagation: vi.fn() };
  textarea.props.onKeyDown(event);
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(onChange).toHaveBeenCalledWith(expected);
});

it('leaves ? inside the Vision canvas to Excalidraw and opens Deckmate help outside', () => {
  render(help);
  dispatch(key('Slash', '?', { shiftKey: true }), new Target(true)); render(help);
  expect(find(element => element.type === Dialog.Root).props.open).toBe(false);
  dispatch(key('Slash', '?', { shiftKey: true })); render(help);
  expect(find(element => element.type === Dialog.Root).props.open).toBe(true);
  expect(nodes().some(element => element.props.children === 'The Vision canvas has its own shortcuts: focus the canvas and press ? for its help.')).toBe(true);
});

it.each(['en', 'ru'] as const)('opens Info and Activity by a stable attribute in %s', lang => {
  setLang(lang);
  const panels = ['info', 'activity'].map(panel => ({ panel, disabled: false, getClientRects: () => [1], getAttribute: () => 'false', click: vi.fn() }));
  document.querySelectorAll = vi.fn((selector: string) => panels.filter(panel => selector === `.deck-action-rail [data-deck-panel="${panel.panel}"]`)) as unknown as typeof document.querySelectorAll;
  render(() => { useCardSelection([], 'deck'); return null; });
  dispatch(key('KeyM', 'Ь', { shiftKey: true }));
  dispatch(key('KeyI', 'Ш', { shiftKey: true }));
  panels.forEach(panel => expect(panel.click).toHaveBeenCalledOnce());
  const deckSource = readFileSync(new URL('../client/components/Deck.tsx', import.meta.url), 'utf8');
  panels.forEach(panel => expect(deckSource).toContain(`data-deck-panel="${panel.panel}"`));
});

it.each(['en', 'ru'] as const)('renders precisely the registry rows for every screen/permission combination in %s', lang => {
  setLang(lang);
  const screens: ShortcutScreen[] = ['app', 'cards', 'deck', 'card'];
  for (let mask = 0; mask < 16; mask++) for (const writable of [false, true]) {
    hooks.reset();
    const selected = screens.filter((_, index) => mask & (1 << index));
    render(() => help(selected, writable));
    const rows = nodes().filter(element => element.type === 'li');
    const shown = rows.flatMap(row => {
      const label = find(element => element.props.className === 'shortcuts-panel-label', row).props.children;
      return nodes(row).filter(element => element.type === 'kbd').map(element => [element.props.children, label]);
    });
    const expected = ALL_SHORTCUTS.filter(item => selected.includes(item.screen) && (writable || !item.edits));
    expect(shown).toEqual(expected.map(item => [item.keys, item.label]));
    for (const item of expected) {
      const event = key(item.code ?? item.codes?.[0] ?? '', item.key ?? 'ф', { shiftKey: item.shift ?? false, ctrlKey: item.command ?? false });
      expect(matchShortcut(event, [item])?.id).toBe(item.id);
    }
  }
});

it.each([false, true])('shows desktop palette/zoom caveats only with the bridge (desktop=%s)', desktop => {
  if (desktop) Object.assign(window, { deckmateBoard: {} });
  render(help);
  const paragraphs = nodes().filter(element => element.type === 'p').map(element => element.props.children).join('\n');
  expect(paragraphs.includes('Ctrl+/')).toBe(desktop);
  expect(paragraphs.includes('Ctrl+Shift+P')).toBe(desktop);
  expect(paragraphs.includes('Ctrl+0')).toBe(desktop);
});

it('retries the board list after a loading error', async () => {
  vi.mocked(fetch).mockRejectedValueOnce(new TypeError('offline'));
  render(vision); await settle();
  expect(button('Retry')).toBeDefined();
  button('Retry').props.onClick(); await settle();
  expect(nodes().some(element => element.props.className === 'error-banner vision-error')).toBe(false);
  expect(fetch).toHaveBeenCalledTimes(3);
});

it.each(['network', 'restore'] as const)('keeps the remembered board and blocks empty saving after a %s failure, then retries', async failure => {
  stored.set('deckmate-vision-board-sandbox', 'remembered');
  vi.mocked(fetch).mockImplementation(async url => {
    if (String(url).startsWith('/api/boards/')) {
      if (failure === 'network') throw new TypeError('offline');
      return { ok: true, json: async () => board } as Response;
    }
    return { ok: true, json: async () => [] } as unknown as Response;
  });
  if (failure === 'restore') vi.mocked(restore).mockImplementationOnce(scene => scene as never).mockImplementationOnce(() => { throw new Error('Invalid scene'); });
  render(vision); await settle();
  expect(canvas()).toBeUndefined();
  expect(button('Save').props.disabled).toBe(true);
  expect(stored.get('deckmate-vision-board-sandbox')).toBe('remembered');
  expect(nodes().some(element => typeof element.props.children === 'string' && element.props.children.includes('It has not been replaced'))).toBe(true);
  vi.mocked(fetch).mockImplementation(async url => ({ ok: true, json: async () => String(url).startsWith('/api/boards/') ? board : [] }) as Response);
  button('Retry').props.onClick(); await settle();
  expect(canvas().props.initialData.elements).toEqual(board.scene.elements);
  expect(button('Save').props.disabled).toBe(false);
});

it('keeps the current drawing when another board fails to load', async () => {
  stored.set('deckmate-vision-board-sandbox', board.id);
  vi.mocked(fetch).mockImplementation(async url => ({ ok: true, json: async () => String(url).startsWith('/api/boards/') ? board : [] }) as Response);
  render(vision); await settle();
  const original = canvas().props.initialData;
  vi.mocked(fetch).mockRejectedValueOnce(new TypeError('offline'));
  find(element => element.props['aria-label'] === 'Vision board').props.onChange({ target: { value: 'other' } }); await settle();
  expect(button('Retry')).toBeDefined();
  expect(button('Save').props.disabled).toBe(false);
  expect(canvas().props.initialData).toBe(original);
  expect(find(element => element.props['aria-label'] === 'Board title').props.value).toBe(board.title);
});

it('does not let a late background list error erase the failed restore retry', async () => {
  stored.set('deckmate-vision-board-sandbox', board.id);
  let rejectList: (reason: unknown) => void = () => {};
  let lists = 0;
  vi.mocked(fetch).mockImplementation(async url => {
    if (String(url).startsWith('/api/boards/')) throw new TypeError('board offline');
    if (++lists === 2) return new Promise<Response>((_resolve, reject) => { rejectList = reject; });
    return { ok: true, json: async () => [] } as unknown as Response;
  });
  render(vision); await settle();
  rejectList(new TypeError('list offline')); await settle();
  expect(nodes().some(element => typeof element.props.children === 'string' && element.props.children.includes('It has not been replaced'))).toBe(true);
  vi.mocked(fetch).mockImplementation(async url => ({ ok: true, json: async () => String(url).startsWith('/api/boards/') ? board : [] }) as Response);
  button('Retry').props.onClick(); await settle();
  expect(canvas().props.initialData.elements).toEqual(board.scene.elements);
});

it('creates an empty board only after an explicit New board action following a failed restore', async () => {
  stored.set('deckmate-vision-board-sandbox', board.id);
  vi.mocked(fetch).mockImplementation(async url => {
    if (String(url).startsWith('/api/boards/')) throw new TypeError('offline');
    return { ok: true, json: async () => [] } as unknown as Response;
  });
  render(vision); await settle();
  expect(canvas()).toBeUndefined();
  button('New board').props.onClick(); render(vision);
  expect(canvas().props.initialData.elements).toEqual([]);
  expect(button('Save').props.disabled).toBe(false);
  expect(stored.get('deckmate-vision-board-sandbox')).toBe(board.id);
});

it('retries Save with the latest scene and original hash instead of replacing the drawing', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  stored.set('deckmate-vision-board-sandbox', board.id);
  let failSave = true;
  const posted: Record<string, any>[] = [];
  vi.mocked(fetch).mockImplementation(async (url, options) => {
    if (options?.body) {
      const payload = JSON.parse(String(options.body)); posted.push(payload);
      if (failSave) throw new TypeError('offline');
      return { ok: true, json: async () => ({ ...board, scene: payload.scene, title: payload.title }) } as Response;
    }
    return { ok: true, json: async () => String(url).startsWith('/api/boards/') ? board : [] } as Response;
  });
  render(vision); await settle();
  canvas().props.onChange([{ id: 'new', type: 'rectangle', version: 1 }], { selectedElementIds: {} }, {}); render(vision);
  const initialData = canvas().props.initialData;
  button('Save').props.onClick(); await settle();
  expect(button('Retry')).toBeDefined();
  canvas().props.onChange([{ id: 'latest', type: 'rectangle', version: 2 }], { selectedElementIds: {} }, {}); render(vision);
  failSave = false; button('Retry').props.onClick(); await settle();
  expect(posted[1]).toMatchObject({ id: board.id, hash: board.hash, scene: { elements: [{ id: 'latest', version: 2 }] } });
  expect(canvas().props.initialData).toBe(initialData);
  expect(nodes().some(element => element.props.className === 'error-banner vision-error')).toBe(false);
});

it('keeps a deckless Smart Node quiet, puts the video error beside its field, associates it, and clears corrected input', () => {
  fixture.catalog = catalog;
  render(vision);
  // 2026-11-10: a project without decks is a fact, not an error: Smart Node shows a quiet note, no invalid field or alert.
  const smart = find(element => element.props['aria-label'] === 'Widget deck');
  expect(smart.props['aria-invalid']).not.toBe(true);
  expect(nodes().some(element => element.props.className === 'vision-note' && element.props.role !== 'alert')).toBe(true);
  find(element => element.props['aria-label'] === 'YouTube link').props.onChange({ target: { value: 'invalid' } }); render(vision);
  button('Add').props.onClick(); render(vision);
  const video = find(element => element.props['aria-label'] === 'YouTube link');
  expect(video.props['aria-invalid']).toBe(true);
  expect(find(element => element.props.id === video.props['aria-describedby']).props.className).toBe('inline-error');
  expect(nodes().some(element => element.props.className === 'error-banner vision-error')).toBe(false);
  video.props.onChange({ target: { value: 'https://youtu.be/example' } }); render(vision);
  expect(find(element => element.props['aria-label'] === 'YouTube link').props['aria-invalid']).toBe(false);
});

it('offers a catalog retry separately from board operations', () => {
  fixture.catalogError = 'Catalog offline'; render(vision);
  button('Retry').props.onClick();
  expect(fixture.refresh).toHaveBeenCalledOnce();
});
