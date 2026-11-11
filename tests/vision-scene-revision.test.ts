import { beforeEach, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { Excalidraw } from '@excalidraw/excalidraw';
import type { ExcalidrawProps } from '@excalidraw/excalidraw/types';
import type { WorkspaceSnapshot } from '../src/workspace-contracts.ts';
import { shortReference } from '../src/references.ts';
import Vision from '../client/components/Vision.tsx';

// 2026-11-10: retain hook state and memo dependencies between renders without installing a DOM package or
// loading the canvas; the runtime itself is shared from ./react-hook-harness.ts. vi.hoisted runs before
// imports resolve, so the factory is loaded through a dynamic import and awaited by the react mock and
// this file's body alike.
const harnessPromise = vi.hoisted(() => import('./react-hook-harness.ts').then(module => module.createHookHarness()));

vi.hoisted(() => {
  vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
  vi.stubGlobal('localStorage', { getItem: () => null });
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
  serializeAsJSON: (elements: unknown, appState: unknown, files: unknown) => JSON.stringify({ elements, appState, files }),
  convertToExcalidrawElements: (elements: unknown) => elements,
}));
vi.mock('../client/useCatalog.ts', () => ({ useCatalog: () => ({ catalog: null, error: null }) }));
vi.mock('../client/components/JourneyPanel.tsx', () => ({ CatalogReferenceLink: () => null }));
vi.mock('../client/onboarding/signals.ts', () => ({ emitSignal: vi.fn() }));

const hooks = await harnessPromise;

type Element = ReactElement<Record<string, any>>;
const snapshot = { source: 'sandbox', writable: true } as WorkspaceSnapshot;
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
  if (Array.isArray(node)) return node.map(child => find(predicate, child ?? null)).find(Boolean);
  if (!isValidElement<Record<string, any>>(node)) return;
  if (predicate(node)) return node;
  return find(predicate, node.props.children ?? null);
}

function change(elements: Record<string, unknown>[], selectedElementIds = {}) {
  const onChange = find(element => element.type === Excalidraw)!.props.onChange as NonNullable<ExcalidrawProps['onChange']>;
  onChange(elements as never, { selectedElementIds } as never, {});
  render();
}

beforeEach(() => {
  hooks.reset();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] })));
  render();
});

it('adds, replaces and removes text references after the scene is already dirty', () => {
  const token = (id: string) => '$' + shortReference('c', id);
  const refs = () => find(element => element.props.className?.split(' ').includes('vision-text-refs'))!;
  const hasToken = (value: string) => Boolean(find(element => element.type === 'small' && element.props.children === value, refs()));
  change([{ id: 'text', type: 'text', text: token('first') }]);
  expect(hasToken(token('first'))).toBe(true);
  change([{ id: 'text', type: 'text', text: token('second') }]);
  expect(hasToken(token('first'))).toBe(false);
  expect(hasToken(token('second'))).toBe(true);
  change([{ id: 'text', type: 'text', text: token('second'), isDeleted: true }]);
  expect(hasToken(token('second'))).toBe(false);
});

it('updates the selected card view without changing selection or clearing dirty', () => {
  for (const view of ['mini', 'full', 'lane']) {
    change([{ id: 'card', type: 'embeddable', customData: { deckmateCardId: 'first', deckmateCardView: view } }], { card: true });
    expect(find(element => element.props['aria-label'] === 'Card node view')?.props.value).toBe(view);
  }
  change([{ id: 'card', type: 'embeddable', customData: { deckmateCardId: 'first' }, isDeleted: true }], { card: true });
  expect(find(element => element.props['aria-label'] === 'Card node view')).toBeUndefined();
});

it('refreshes a selected image caption on repeated edits and removal', () => {
  const image = { id: 'image', type: 'image' };
  for (const text of ['First caption', 'Second caption', 'Third caption']) {
    change([image, { id: 'caption', type: 'text', text, customData: { deckmateCaptionFor: 'image' } }], { image: true });
    expect(find(element => element.props['aria-label'] === 'Image caption')?.props.value).toBe(text);
  }
  change([image], { image: true });
  expect(find(element => element.props['aria-label'] === 'Image caption')?.props.value).toBe('');
});
