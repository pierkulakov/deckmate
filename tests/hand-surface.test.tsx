import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CatalogView, RunRecord } from '../src/catalog-contracts.ts';
import type { WorkspaceSnapshot } from '../src/workspace-contracts.ts';
import { Hand, HandRunsSection } from '../client/components/Hand.tsx';
import { setLang } from '../client/i18n.ts';

vi.hoisted(() => {
  vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
  vi.stubGlobal('localStorage', { getItem: () => null });
});
vi.mock('../client/useCatalog.ts', () => ({
  useCatalog: () => ({ catalog, error: null, pending: false, edit: vi.fn(), refresh: vi.fn() }),
}));

const defaultCatalog: CatalogView = {
  rootIdentity: 'hand-surface', formatLanguage: 'en', manifestHash: 'manifest', configured: true, indexedAt: '',
  documents: [], cards: [], spaces: [], decks: [], tracks: [], warnings: [], runs: [], milestones: [],
  members: [{ id: 'maya', label: 'Maya', kind: 'human', aliases: [] }],
};
let catalog: CatalogView = defaultCatalog;
const snapshot: WorkspaceSnapshot = {
  projectName: 'Surface', source: 'sandbox', writable: true, editMode: 'direct',
  iteration: { number: 1, goal: '', start: '' },
};

beforeEach(() => {
  catalog = defaultCatalog;
  vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('location', new URL('http://localhost/'));
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());

it.each(['en', 'ru'] as const)('%s: Hand uses the shared page and empty-state surfaces', lang => {
  setLang(lang);
  const html = renderToStaticMarkup(<Hand snapshot={snapshot} refreshKey={0} onOpenCard={() => undefined} onOpenMembers={() => undefined} />);
  expect(html).toContain('hand-view page-light');
  expect(html).toContain('hand-panel-header page-head');
  expect(html).toContain('hand-panel glass-panel');
  expect(html).toContain('hand-tab-panel glass-panel');
  expect(html).toContain('ui-empty-quiet');
  expect(html).toContain('role="tablist"');
  expect(html).toContain('hand-tab control-tab');
  expect(html).toContain('control-tabs');
});

it('no members, writable: the team scene with the empty-art pixel scene and the Members action', () => {
  setLang('en');
  catalog = { ...defaultCatalog, members: [] };
  const html = renderToStaticMarkup(<Hand snapshot={snapshot} refreshKey={0} onOpenCard={() => undefined} onOpenMembers={() => undefined} />);
  expect(html).toContain('ui-empty-scene');
  expect(html).toContain('empty-art');
  expect(html).toContain('Members…');
  expect(html).toContain('Add project members to give people and agents their own Hands.');
});

it('no members, read-only: no action, and the message only states that Hands will appear', () => {
  setLang('en');
  catalog = { ...defaultCatalog, members: [] };
  const html = renderToStaticMarkup(<Hand snapshot={{ ...snapshot, writable: false }} refreshKey={0} onOpenCard={() => undefined} onOpenMembers={() => undefined} />);
  expect(html).toContain('Hands appear here once the project has members.');
  expect(html).not.toContain('Add project members to give people');
  expect(html).not.toContain('Members…');
});

it('a Run without the member’s cards shows the quiet empty state', () => {
  setLang('en');
  // 2026-11-10: the section is rendered directly because the Hand tab starts on Bookmarks and a static render cannot switch tabs.
  const run: RunRecord = { id: 'run-1', number: 1, start: '2020-01-01', end: '2099-12-31', goal: '' };
  const html = renderToStaticMarkup(<HandRunsSection owned={[]} withoutCards={[run]} decksById={new Map()} onOpenTimeline={() => undefined} onOpenCard={() => undefined} />);
  expect(html).toContain('You have no cards in this Run.');
  expect(html).toContain('ui-empty-quiet');
});
