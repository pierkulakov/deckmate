import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useWorkspace } from '../client/useWorkspace.ts';
import type { WorkspaceSnapshot } from '../src/workspace-contracts.ts';

const harnessPromise = vi.hoisted(() => import('./react-hook-harness.ts').then(module => module.createHookHarness()));
const session = vi.hoisted(() => ({ prepare: vi.fn(), release: vi.fn(), store: vi.fn() }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), ...(await harnessPromise).react }));
vi.mock('../client/catalog-store.ts', () => ({
  prepareCatalogSession: session.prepare, releaseCatalogSession: session.release, catalogStore: session.store,
  invalidateCatalogs: vi.fn(), affectsCatalog: () => true,
}));
vi.mock('../client/i18n.ts', async () => ({
  ...await import('../src/i18n.ts'), useLang: () => 'en', useText: <T,>(messages: { en: T }) => messages.en,
  textNow: <T,>(messages: { en: T }) => messages.en,
}));
const hooks = await harnessPromise;
const fetchMock = vi.fn<typeof fetch>();
const snapshot: WorkspaceSnapshot & { token: string } = {
  projectName: 'Lifecycle', source: 'sandbox', writable: true, editMode: 'direct', token: 'late-token',
  iteration: { number: 1, goal: '', start: '2026-11-10' },
};

function render() {
  hooks.start();
  const workspace = useWorkspace();
  hooks.flush();
  return workspace;
}

beforeEach(() => {
  hooks.reset(); vi.clearAllMocks();
  vi.stubGlobal('location', new URL('http://localhost/?catalogSource=sandbox'));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { hooks.reset(); vi.unstubAllGlobals(); });

it('does not prepare a catalog session from a snapshot that arrives after unmount', async () => {
  let resolve!: (value: Response) => void;
  fetchMock.mockReturnValueOnce(new Promise(complete => { resolve = complete; }));
  const json = vi.fn().mockResolvedValue(snapshot);
  render();
  expect(fetchMock).toHaveBeenCalledOnce();
  hooks.unmount();
  resolve({ ok: true, json } as unknown as Response);
  await vi.waitFor(() => expect(json).toHaveBeenCalledOnce());
  expect(session.prepare).not.toHaveBeenCalled();
});
