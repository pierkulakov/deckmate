import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CatalogView } from '../src/catalog-contracts.ts';
import type { WorkspaceSnapshot } from '../src/workspace-contracts.ts';
import { Hand } from '../client/components/Hand.tsx';
import { setLang } from '../client/i18n.ts';

vi.hoisted(() => {
  vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
  vi.stubGlobal('localStorage', { getItem: () => null });
});
vi.mock('../client/useCatalog.ts', () => ({
  useCatalog: () => ({ catalog, error: null, pending: false, edit: vi.fn() }),
}));

const longName = 'Отдел международного сотрудничества и развития цифровых технологий';
const catalog: CatalogView = {
  rootIdentity: 'hand-layout', formatLanguage: 'en', manifestHash: 'manifest', configured: true, indexedAt: '',
  documents: [], cards: [], spaces: [], decks: [], tracks: [], warnings: [], runs: [], milestones: [],
  members: [
    { id: 'maya', label: 'Maya Chen', kind: 'human', aliases: [] },
    { id: 'long-member', label: longName, kind: 'human', aliases: [] },
  ],
};
const snapshot: WorkspaceSnapshot = {
  projectName: 'Layout', source: 'sandbox', writable: true, editMode: 'direct',
  iteration: { number: 1, goal: '', start: '' },
};

beforeEach(() => {
  vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
  setLang('en');
});
afterEach(() => vi.unstubAllGlobals());

function renderHand(search: string): string {
  vi.stubGlobal('location', new URL('http://localhost/' + search));
  return renderToStaticMarkup(<Hand snapshot={snapshot} refreshKey={0} onOpenCard={() => undefined} onOpenMembers={() => undefined} />);
}

it.each(['en', 'ru'] as const)('%s: the picker keeps the full selected name in its tooltip, including empty Hands and invalid-link fallback', lang => {
  setLang(lang);
  for (const [memberId, label] of [['long-member', longName], ['maya', 'Maya Chen'], ['missing', 'Maya Chen']]) {
    const html = renderHand('?handMember=' + memberId);
    const select = html.match(/<select\b[^>]*>/u)?.[0];
    expect(select).toContain(`title="${label}"`);
    expect(select).toContain(`aria-label="${lang === 'en' ? 'Whose Hand' : 'Чей Hand'}"`);
    expect(html).toContain(`<option value="long-member"${memberId === 'long-member' ? ' selected=""' : ''}>${longName}</option>`);
  }
});

it('keeps the planning member explicit in All Hands', () => {
  const html = renderHand('?hands=all');
  expect(html).toContain('hand-member-picker');
  expect(html).toContain('aria-label="Whose Hand"');
  expect(html).toContain('To change a Hand, turn off All Hands.');
  expect(html).toContain(longName);
});
