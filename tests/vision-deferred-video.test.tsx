import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Excalidraw, serializeAsJSON } from '@excalidraw/excalidraw';
import type { ExcalidrawProps } from '@excalidraw/excalidraw/types';
import type { WorkspaceSnapshot } from '../src/workspace-contracts.ts';
import Vision from '../client/components/Vision.tsx';
import { setLang } from '../client/i18n.ts';
import { emitSignal } from '../client/onboarding/signals.ts';

// 2026-11-10: the state/memo/effect runtime is shared from ./react-hook-harness.ts. vi.hoisted runs before
// imports resolve, so the factory is loaded through a dynamic import; the react mock below and this file's
// body await the same per-suite instance.
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
  Excalidraw: () => null,
  CaptureUpdateAction: { IMMEDIATELY: 'immediately' },
  restore: (scene: unknown) => scene,
  serializeAsJSON: vi.fn((elements: unknown, appState: unknown, files: unknown) => JSON.stringify({ elements, appState, files })),
  convertToExcalidrawElements: (elements: unknown) => elements,
}));
vi.mock('../client/useCatalog.ts', () => ({ useCatalog: () => ({ catalog: null, error: null }) }));
vi.mock('../client/components/JourneyPanel.tsx', () => ({ CatalogReferenceLink: () => null }));
vi.mock('../client/onboarding/signals.ts', () => ({ emitSignal: vi.fn() }));

const hooks = await harnessPromise;

type Element = ReactElement<Record<string, any>>;
const snapshot = { source: 'sandbox', writable: true, token: 'test-token' } as unknown as WorkspaceSnapshot;
const onEditing = vi.fn();
const onOpenCard = vi.fn();
let tree: ReactNode;

function render() {
  for (let attempt = 0; attempt < 10; attempt++) {
    hooks.start();
    tree = Vision({ snapshot, refreshKey: 0, dark: false, onEditing, onOpenCard });
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
function change(elements: Record<string, unknown>[], files = {}, appState = {}) {
  const onChange = canvas().props.onChange as NonNullable<ExcalidrawProps['onChange']>;
  onChange(elements as never, { selectedElementIds: {}, ...appState } as never, files);
}
const dirty = () => find(element => element.props.className === 'vision-save-state')!.props.children;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  hooks.reset();
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] })));
  setLang('en');
  render();
  vi.mocked(serializeAsJSON).mockClear();
  onEditing.mockClear();
  vi.mocked(emitSignal).mockClear();
});
afterEach(() => { hooks.unmount(); vi.useRealTimers(); });

it('serializes zero times for 1000 pointer/selection events with three large images, compared with the old handler', () => {
  const elements = Array.from({ length: 10 }, (_, index) => ({ id: `element-${index}`, version: 1, versionNonce: index }));
  const files = Object.fromEntries(['a', 'b', 'c'].map(id => [id, { id, dataURL: 'data:image/png;base64,' + 'a'.repeat(1024 * 1024) }]));
  change(elements, files);
  render();
  vi.runAllTimers();
  vi.mocked(serializeAsJSON).mockClear();
  const startedBefore = performance.now();
  for (let index = 0; index < 1000; index++) {
    const serialized = serializeAsJSON(elements as never, { selectedElementIds: {}, cursorX: index } as never, files as never, 'local');
    const scene = JSON.parse(serialized);
    JSON.stringify({ elements: scene.elements, files: scene.files, background: scene.appState.viewBackgroundColor, gridSize: scene.appState.gridSize });
  }
  const beforeMs = performance.now() - startedBefore;
  expect(serializeAsJSON).toHaveBeenCalledTimes(1000);
  vi.mocked(serializeAsJSON).mockClear();
  const startedAfter = performance.now();
  for (let index = 0; index < 1000; index++) change(elements, files, { cursorX: index, selectedElementIds: { 'element-1': index % 2 === 0 } });
  vi.runAllTimers();
  const afterMs = performance.now() - startedAfter;
  expect(serializeAsJSON).not.toHaveBeenCalled();
  process.stdout.write(`Vision benchmark: 1000 events, 10 elements, 3 × 1 MiB; before: 1000 serializations / ${beforeMs.toFixed(2)} ms; after: 0 / ${afterMs.toFixed(2)} ms\n`);
}, 60000);

it('flushes the latest scene before Save, keeps dirty until confirmation, and does not lose files', async () => {
  change([{ id: 'text', version: 1, text: 'First' }]);
  render();
  expect(onEditing).toHaveBeenLastCalledWith(true);
  const files = { image: { id: 'image', dataURL: 'data:image/png;base64,complete' } };
  change([{ id: 'text', version: 2, text: 'Latest' }], files);
  expect(serializeAsJSON).toHaveBeenCalledTimes(1);
  vi.stubGlobal('fetch', vi.fn(async (_url: string, options?: RequestInit) => {
    if (!options?.body) return { ok: true, json: async () => [] };
    const body = JSON.parse(String(options.body));
    expect(body.scene.elements[0].text).toBe('Latest');
    expect(body.scene.files).toEqual(files);
    expect(dirty()).toBe('Unsaved changes');
    return { ok: true, json: async () => ({ id: 'saved', title: body.title, hash: 'hash', access: 'editable', scene: body.scene, linkedCardIds: [] }) };
  }));
  find(element => element.props.onClick && element.props.children?.some?.((child: unknown) => child === 'Save'))!.props.onClick();
  for (let attempt = 0; attempt < 12; attempt++) await Promise.resolve();
  render();
  expect(serializeAsJSON).toHaveBeenCalledTimes(2);
  expect(dirty()).toBe('Saved');
  expect(onEditing).toHaveBeenLastCalledWith(false);
});

it.each(['beforeunload', 'pagehide', 'unmount'])('flushes a pending edit on %s', event => {
  change([{ id: 'text', version: 1 }]); render();
  vi.mocked(serializeAsJSON).mockClear();
  change([{ id: 'text', version: 2 }]);
  if (event === 'unmount') hooks.unmount();
  else window.dispatchEvent(new Event(event));
  expect(serializeAsJSON).toHaveBeenCalledTimes(1);
  vi.runAllTimers();
  expect(serializeAsJSON).toHaveBeenCalledTimes(1);
});

it('preserves card-added signals without counting pointer events as additions', () => {
  const elements = [{ id: 'card', version: 1, customData: { deckmateCardId: 'first' } }];
  change(elements); change(elements); change(elements);
  expect(emitSignal).toHaveBeenCalledExactlyOnceWith({ type: 'vision-card-added', cardId: 'first' });
});

function video(link: string, customData = {}) {
  return canvas().props.renderEmbeddable({ id: 'video', type: 'embeddable', link, customData }, {});
}
function desktopRussian() {
  Object.assign(window, { deckmateBoard: {} });
  setLang('ru'); render();
}

it('keeps the stock video node and addition text in an ordinary browser', () => {
  expect(video('https://youtube.com/watch?v=example')).toBeNull();
  expect(find(element => element.type === 'p' && element.props.children.startsWith?.('A YouTube link'))).toBeDefined();
  expect(find(element => element.props.children === 'Add as link')).toBeUndefined();
});

it('shows Russian desktop guidance and a safe Open in browser placeholder for existing and pasted videos', () => {
  desktopRussian();
  expect(find(element => element.type === 'p' && element.props.children === 'В приложении видео не проигрывается. Добавьте его как ссылку и откройте в браузере.')).toBeDefined();
  expect(find(element => element.props.onClick && element.props.children?.includes?.('Добавить как ссылку'))).toBeDefined();
  for (const customData of [{}, { freetionVideo: 'https://youtu.be/example' }, { deckmateVideo: 'https://youtu.be/example' }]) {
    const html = renderToStaticMarkup(video('https://youtu.be/example', customData));
    expect(html).toContain('deckmate-vision-video');
    expect(html).toContain('Открыть в браузере');
    expect(html).toContain('href="https://youtu.be/example"');
    expect(html).not.toContain('<iframe');
  }
  expect(renderToStaticMarkup(video('youtu.be/example'))).toContain('href="https://youtu.be/example"');
});

it.each(['javascript:alert(1)', 'data:text/html,video', 'file:///video', '//youtube.com/watch?v=example', 'https://evil.example/video', 'https://youtube.com.evil.example/video', 'https://youtube.com:443@evil.example/video'])('does not offer to open an unsafe or unaccepted video address: %s', link => {
  desktopRussian();
  const html = renderToStaticMarkup(video(link, { deckmateVideo: link }));
  expect(html).toContain('deckmate-vision-video');
  expect(html).not.toContain('<a ');
});

it('adds a desktop video link with an explicit https address rather than a relative URL', () => {
  desktopRussian();
  const updateScene = vi.fn();
  canvas().props.excalidrawAPI({ updateScene, getSceneElements: () => [], getAppState: () => ({ scrollX: 0, scrollY: 0, zoom: { value: 1 } }), scrollToContent: vi.fn() });
  find(element => element.props['aria-label'] === 'Ссылка YouTube')!.props.onChange({ target: { value: 'youtu.be/example' } });
  render();
  find(element => element.props.onClick && element.props.children?.includes?.('Добавить как ссылку'))!.props.onClick();
  expect(updateScene.mock.calls[0][0].elements[0].link).toBe('https://youtu.be/example');
});
