import { beforeEach, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { Excalidraw, loadFromBlob, restore } from '@excalidraw/excalidraw';
import Vision from '../client/components/Vision.tsx';
import type { WorkspaceSnapshot } from '../src/workspace-contracts.ts';

// 2026-11-10: the shared state/memo/effect runtime lives in ./react-hook-harness.ts; Vision renders to an
// element tree without a DOM or a real canvas. vi.hoisted runs before imports resolve, so the factory is
// loaded through a dynamic import; the react mock below and this file's body await the same instance.
const harnessPromise = vi.hoisted(() => import('./react-hook-harness.ts').then(module => module.createHookHarness()));
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
  Excalidraw: () => null, CaptureUpdateAction: { IMMEDIATELY: 'immediately' },
  restore: vi.fn((scene: unknown) => scene),
  loadFromBlob: vi.fn(),
  serializeAsJSON: (elements: unknown, appState: unknown, files: unknown) => JSON.stringify({ elements, appState, files }),
  convertToExcalidrawElements: (elements: unknown) => elements,
}));
vi.mock('../client/useCatalog.ts', () => ({ useCatalog: () => ({ catalog: null, error: null }) }));
vi.mock('../client/components/JourneyPanel.tsx', () => ({ CatalogReferenceLink: () => null }));
vi.mock('../client/onboarding/signals.ts', () => ({ emitSignal: vi.fn() }));

const hooks = await harnessPromise;

type Element = ReactElement<Record<string, any>>;
const snapshot = { source: 'sandbox', writable: true } as WorkspaceSnapshot;
const safeElement = { id: 'safe', type: 'rectangle', customData: { generationData: { status: 'done', html: '<script />' }, keep: 1 } };
const badElement = { id: 'html', type: 'iframe', customData: { generationData: { status: 'done', html: '<script>fetch("https://evil.test")</script>' } } };
const untrusted = { type: 'excalidraw', version: 2, elements: [safeElement, badElement], files: {}, appState: { activeTool: { type: 'magicframe' }, openSidebar: { name: 'library' }, deckmateAccess: 'readonly' } };
let tree: ReactNode;
function render() {
  for (let attempt = 0; attempt < 10; attempt++) {
    hooks.start();
    tree = Vision({ snapshot, refreshKey: 0, dark: false, onEditing: vi.fn(), onOpenCard: vi.fn() });
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
const canvas = () => find(element => element.type === Excalidraw)!;
async function settle() { for (let index = 0; index < 20; index++) await Promise.resolve(); render(); }
beforeEach(() => {
  hooks.reset(); vi.mocked(restore).mockClear();
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('location', new URL('http://localhost/?view=vision'));
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] })));
});

it('sanitizes restored documents before calling restore or passing initialData, even in view mode', async () => {
  vi.stubGlobal('location', new URL('http://localhost/?view=vision&board=untrusted'));
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => url.startsWith('/api/boards/')
    ? { id: 'untrusted', title: 'Imported', hash: 'source-hash', access: 'readonly', linkedCardIds: [], scene: untrusted }
    : [] })));
  render(); await settle();
  const input = canvas().props.initialData;
  expect(input.elements).toEqual([{ id: 'safe', type: 'rectangle', customData: { keep: 1 } }]);
  expect(input.appState).toEqual({ deckmateAccess: 'readonly' });
  expect(vi.mocked(restore).mock.calls.every(([value]) => !JSON.stringify(value).includes('generationData'))).toBe(true);
  expect(canvas().props.viewModeEnabled).toBe(true);
  expect(canvas().props.aiEnabled).toBe(false);
  expect(canvas().props.UIOptions.canvasActions.loadScene).toBe(false);
  expect(find(element => element.props.children === 'The board contained embedded HTML; it was not displayed.')).toBeDefined();
});

it('cleans clipboard elements/files before Excalidraw can insert them and cancels HTML-only paste', () => {
  render();
  const data = { elements: untrusted.elements, files: { bad: { mimeType: 'text/html', dataURL: 'data:text/html,<script />' } } };
  expect(canvas().props.onPaste(data, null)).toBe(true);
  expect(data.elements).toEqual([{ id: 'safe', type: 'rectangle', customData: { keep: 1 } }]);
  expect(data.files).toEqual({});
  expect(canvas().props.onPaste({ elements: [badElement] }, null)).toBe(false);
  expect(untrusted.elements[0].customData).toHaveProperty('generationData');
});

it('cleans library insertion and duplication before scene.replaceAllElements, not from onChange after rendering', () => {
  render();
  const result = canvas().props.onDuplicate(untrusted.elements, []);
  expect(result).toEqual([{ id: 'safe', type: 'rectangle', customData: { keep: 1 } }]);
});

it('intercepts dropped scenes, sanitizes before restore/updateScene, and never invokes the native file loader', async () => {
  render();
  const api = { updateScene: vi.fn(), addFiles: vi.fn(), scrollToContent: vi.fn() };
  canvas().props.excalidrawAPI(api);
  const event = { dataTransfer: { files: [{ name: 'untrusted.excalidraw', size: 100, text: async () => JSON.stringify(untrusted) }] }, preventDefault: vi.fn(), stopPropagation: vi.fn() };
  find(element => Boolean(element.props.onDropCapture))!.props.onDropCapture(event);
  await settle();
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(event.stopPropagation).toHaveBeenCalledOnce();
  expect(api.updateScene).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ elements: [{ id: 'safe', type: 'rectangle', customData: { keep: 1 } }], appState: { deckmateAccess: 'readonly' } }));
});

it('blocks SVG paste before the library image shortcut and cancels unsafe link opening', () => {
  render();
  const event = { clipboardData: { files: [{ type: 'image/svg+xml' }], getData: () => '' }, preventDefault: vi.fn(), stopPropagation: vi.fn() };
  find(element => Boolean(element.props.onPasteCapture))!.props.onPasteCapture(event);
  expect(event.stopPropagation).toHaveBeenCalledOnce();
  for (const clipboard of [
    { 'text/plain': '<svg onload="alert(1)"></svg>' },
    { 'text/plain': 'Image', 'text/html': '<img src="https://evil.test/active.svg">' },
  ]) {
    const pasted = { clipboardData: { files: [], getData: (type: keyof typeof clipboard) => clipboard[type] ?? '' }, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    find(element => Boolean(element.props.onPasteCapture))!.props.onPasteCapture(pasted);
    expect(pasted.stopPropagation).toHaveBeenCalledOnce();
  }
  for (const link of ['javascript:alert(1)', 'data:text/html,<script />', 'file:///C:/secret', 'vbscript:msgbox(1)']) {
    const linkEvent = { preventDefault: vi.fn() };
    canvas().props.onLinkOpen({ link }, linkEvent);
    expect(linkEvent.preventDefault).toHaveBeenCalledOnce();
  }
  for (const link of ['https://youtube.com.evil.test/watch?v=x', 'http://youtube.com/watch?v=x', 'deckmate://arbitrary/path']) expect(canvas().props.validateEmbeddable(link)).toBe(false);
});

it('sanitizes an imported library before updateLibrary receives it', async () => {
  render();
  const updateLibrary = vi.fn(); canvas().props.excalidrawAPI({ updateLibrary });
  const event = { dataTransfer: { files: [{ name: 'untrusted.excalidrawlib', size: 100, text: async () => JSON.stringify({ type: 'excalidrawlib', libraryItems: [{ id: 'item', elements: untrusted.elements }] }) }] }, preventDefault: vi.fn(), stopPropagation: vi.fn() };
  find(element => Boolean(element.props.onDropCapture))!.props.onDropCapture(event);
  await settle();
  expect(updateLibrary).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ libraryItems: [{ id: 'item', elements: [{ id: 'safe', type: 'rectangle', customData: { keep: 1 } }] }] }));
});

it('treats dropped PNGs as raster data only, never importing embedded scene metadata', async () => {
  render();
  const updateScene = vi.fn(), addFiles = vi.fn();
  canvas().props.excalidrawAPI({ updateScene, addFiles, getSceneElements: () => [], getAppState: () => ({ scrollX: 0, scrollY: 0, zoom: { value: 1 } }) });
  vi.mocked(loadFromBlob).mockClear();
  vi.mocked(restore).mockClear();
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhVEAAAAASUVORK5CYII=';
  vi.stubGlobal('FileReader', class {
    result = `data:image/png;base64,${png}`;
    onload?: () => void;
    readAsDataURL() { this.onload?.(); }
  });
  vi.stubGlobal('Image', class { src = ''; naturalWidth = 1; naturalHeight = 1; async decode() {} });
  try {
    const file = { name: 'with-scene.png', type: 'image/png', size: 100, text: vi.fn(async () => JSON.stringify(untrusted)) };
    const event = { dataTransfer: { files: [file] }, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    find(element => Boolean(element.props.onDropCapture))!.props.onDropCapture(event);
    await settle();
    expect(file.text).not.toHaveBeenCalled();
    expect(loadFromBlob).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
    expect(addFiles).toHaveBeenCalledOnce();
    expect(updateScene.mock.calls[0][0].elements).toEqual([expect.objectContaining({ type: 'image', width: 1, height: 1 })]);
  } finally { vi.stubGlobal('FileReader', undefined); vi.stubGlobal('Image', undefined); }
});
