import { readFileSync, readdirSync } from 'node:fs';
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
vi.mock('../client/useCatalog.ts', () => ({ useCatalog: () => ({ catalog, error: null, pending: false, edit: vi.fn() }) }));

const catalog: CatalogView = {
  rootIdentity: 'hand-vocabulary', formatLanguage: 'en', manifestHash: 'manifest', configured: true, indexedAt: '',
  documents: [], cards: [], spaces: [], decks: [], tracks: [], warnings: [], runs: [], milestones: [],
  members: [{ id: 'maya', label: 'Maya', kind: 'human', aliases: [] }, { id: 'alex', label: 'Alex', kind: 'human', aliases: [] }],
};
const snapshot = { projectName: 'Vocabulary', source: 'sandbox', writable: true, editMode: 'direct', iteration: { number: 1, goal: '', start: '' } } as WorkspaceSnapshot;

beforeEach(() => {
  vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
  setLang('ru');
});
afterEach(() => vi.unstubAllGlobals());

function render(search = '') {
  vi.stubGlobal('location', new URL('http://localhost/' + search));
  return renderToStaticMarkup(<Hand snapshot={snapshot} refreshKey={0} onOpenCard={() => {}} onOpenMembers={() => {}} />);
}

it('keeps Hand in Russian headings, controls, tabs and invalid-member feedback', () => {
  const html = render('?handMember=missing');
  for (const label of ['Ваш Hand', 'Hand команды', 'Все Hand', 'Чей Hand', 'Разделы Hand', 'Показан Hand по умолчанию.']) expect(html).toContain(label);
  for (const label of ['Ваш Hand', 'Все Hand', 'Чей Hand', 'Разделы Hand']) expect(html).toContain(`aria-label="${label}"`);
});

it('keeps Hand in accessible names for every member in All Hands', () => {
  const html = render('?hands=all');
  expect(html).toContain('aria-label="Hand: Maya"');
  expect(html).toContain('aria-label="Hand: Alex"');
});

it('leaves the English Hand labels unchanged', () => {
  setLang('en');
  const html = render();
  for (const label of ['Your Hand', 'Team Hands', 'All Hands', 'Whose Hand', 'Hand sections']) expect(html).toContain(label);
});

it('does not translate the Hand product name elsewhere in the client', () => {
  const root = new URL('../client/', import.meta.url);
  const literalHand = /(?<![а-яё])рук(?:а|и|у|е|ой|ами|ах|ам)(?![а-яё])/iu;
  const offenders = readdirSync(root, { recursive: true }).filter((path): path is string => typeof path === 'string')
    .filter(path => /\.tsx?$/u.test(path) && !['editor-emoji.ts', 'tag-emoji.ts'].includes(path))
    .filter(path => literalHand.test(readFileSync(new URL(path.replaceAll('\\', '/'), root), 'utf8')));
  expect(offenders).toEqual([]);
});
