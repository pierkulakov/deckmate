import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CatalogCard, CatalogView } from '../src/catalog-contracts.ts';
import { CatalogCardTile } from '../client/components/CatalogCardTile.tsx';
import { CardFamilyPanel } from '../client/components/CardFamily.tsx';
import { buildCatalogLookups } from '../client/catalog-lookups.ts';
import { setLang } from '../client/i18n.ts';

vi.hoisted(() => {
  vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
});
// The family panel portals its drag overlay into document.body; the server renderer cannot render portals,
// so the mock renders the overlay in place. It is empty without an active drag, so markup stays the same.
vi.mock('react-dom', async importOriginal => {
  const actual = await importOriginal<typeof import('react-dom')>();
  return { ...actual, createPortal: (children: unknown) => children } as typeof actual;
});
beforeEach(() => {
  vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
  vi.stubGlobal('window', Object.assign(new EventTarget(), { matchMedia: () => ({ matches: false }) }));
  vi.stubGlobal('location', { search: '?catalogSource=sandbox' });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
  setLang('en');
});
afterEach(() => vi.unstubAllGlobals());

function renderTile(overrides: Partial<CatalogCard> = {}): string {
  const card: CatalogCard = { id: 'card:tile', kind: 'task', title: 'Project title', path: 'cards/tile.md', version: null, state: 'not-started', owner: 'Alex',
    markdown: 'Project text.', sourceHash: 'hash', range: null, deckId: 'deck', trackIds: [], parentId: null, ...overrides };
  const noop = () => {};
  return renderToStaticMarkup(<CatalogCardTile card={card} lookups={buildCatalogLookups([card])} members={[]}
    selected={false} checked={false} selectionActive={false} disabled={false} onOpen={noop} onToggle={noop} onFamilyOpen={noop} />);
}

it('marks Trash with a localized icon and tooltip, ahead of Archive', () => {
  for (const kind of ['task', 'hero', 'doc'] as const) {
    const html = renderTile({ kind, archived: true, deleted: true });
    expect(html).toContain('card-trash-indicator');
    expect(html).toContain('lucide-trash-2');
    expect(html).toContain('title="In Trash" aria-label="In Trash"');
    expect(html).not.toContain('lucide-archive');
    expect(html).not.toContain('title="Archived"');
  }
  setLang('ru');
  expect(renderTile({ deleted: true })).toContain('title="В корзине" aria-label="В корзине"');
});

it('keeps the existing Archive mark for archived cards and no lifecycle mark on active cards', () => {
  expect(renderTile({ archived: true })).toContain('lucide-archive');
  expect(renderTile({ archived: true })).not.toContain('card-trash-indicator');
  expect(renderTile()).not.toContain('card-trash-indicator');
});

it('sizes each Hero progress step by its Sub Card weight, the same weight as the effort total', () => {
  const base = { path: 'cards/tile.md', version: null, owner: null, markdown: '', sourceHash: 'hash', range: null, deckId: 'deck', trackIds: [] };
  const hero: CatalogCard = { ...base, id: 'card:hero', kind: 'hero', title: 'Lantern', state: 'not-started', parentId: null };
  const child = (id: string, effort: number | null, state: CatalogCard['state']): CatalogCard =>
    ({ ...base, id, kind: 'task', title: id, state, effort, parentId: hero.id });
  const children = [child('card:a', 5, 'done'), child('card:b', null, 'started'), child('card:c', 0, 'not-started')];
  const noop = () => {};
  const html = renderToStaticMarkup(<CatalogCardTile card={hero} lookups={buildCatalogLookups([hero, ...children])} members={[]}
    selected={false} checked={false} selectionActive={false} disabled={false} onOpen={noop} onToggle={noop} onFamilyOpen={noop} />);
  const weights = [...html.matchAll(/class="sub-card-progress-segment" data-state="(\w+)" style="--sub-card-weight:([\d.]+)"/g)].map(match => `${match[1]}:${match[2]}`);
  expect(weights).toEqual(['accepted:5', 'working:1', 'planned:0']);
  expect(html).toContain('title="Effort: own and Sub Cards — 6">6</strong>');
});

it('puts only the type icon and question count around the Doc owner, retaining accessible labels', () => {
  const html = renderTile({ kind: 'doc', state: null, openQuestions: [{ text: 'Question?', taskRef: null }] });
  const identity = html.slice(html.indexOf('<div class="deck-card-identity">'), html.indexOf('<span class="catalog-card-progress">'));
  expect(identity).toContain('class="deck-card-doc-kind" role="img" title="Doc Card" aria-label="Doc Card"');
  expect(identity).toContain('aria-label="Open questions: 1"');
  expect(identity).not.toContain('<strong');
  expect(html).toContain('class="deck-card-owner-medallion" title="Owner: Alex"');
  expect(html).toContain('class="deck-card-doc-caption">Markdown');
  setLang('ru');
  expect(renderTile({ kind: 'doc', openQuestions: [{ text: 'Question?', taskRef: null }] })).toContain('aria-label="Открытых вопросов: 1"');
});

// 2026-11-09: a finished Hero shows a localized done medallion in the owner's place; an unfinished one keeps its owner.
it('marks a Hero whose Sub Cards are all accepted with a done medallion instead of the owner', () => {
  const hero: CatalogCard = { id: 'card:hero', kind: 'hero', title: 'Hero title', path: 'cards/hero.md', version: null, state: null, owner: 'Alex',
    markdown: 'Hero text.', sourceHash: 'hash', range: null, deckId: 'deck', trackIds: [], parentId: null };
  const child = (state: CatalogCard['state']): CatalogCard => ({ ...hero, id: 'card:child', kind: 'task', title: 'Child', path: 'cards/child.md', state, parentId: hero.id });
  const noop = () => {};
  const render = (children: CatalogCard[]) => renderToStaticMarkup(<CatalogCardTile card={hero} lookups={buildCatalogLookups([hero, ...children])} members={[]}
    selected={false} checked={false} selectionActive={false} disabled={false} onOpen={noop} onToggle={noop} onFamilyOpen={noop} />);
  const done = render([child('done')]);
  expect(done).toContain('is-family-done');
  expect(done).toContain('class="deck-card-owner-medallion deck-card-done-medallion" role="img" title="Hero done: all Sub Cards accepted"');
  expect(done).not.toContain('title="Owner: Alex"');
  const started = render([child('started')]);
  expect(started).not.toContain('deck-card-done-medallion');
  expect(started).toContain('title="Owner: Alex"');
  setLang('ru');
  expect(render([child('done')])).toContain('title="Hero выполнена: все Sub Cards приняты"');
});

it('does not call a Hero with only live Doc Sub Cards empty or count Docs as Task progress', () => {
  const hero: CatalogCard = { id: 'card:hero', kind: 'hero', title: 'Hero title', path: 'cards/hero.md', version: null, state: null, owner: null,
    markdown: '', sourceHash: 'hash', range: null, deckId: 'deck', trackIds: [], parentId: null };
  const doc = (id: string, overrides: Partial<CatalogCard> = {}): CatalogCard => ({ ...hero, id, kind: 'doc', title: id, path: `cards/${id}.md`, parentId: hero.id, ...overrides });
  const noop = () => {};
  const render = (children: CatalogCard[]) => renderToStaticMarkup(<CatalogCardTile card={hero} lookups={buildCatalogLookups([hero, ...children])} members={[]}
    selected={false} checked={false} selectionActive={false} disabled={false} onOpen={noop} onToggle={noop} onFamilyOpen={noop} />);
  const withDoc = render([doc('card:doc')]);
  expect(withDoc).not.toContain('No Sub Cards');
  expect(withDoc).not.toContain('sub-card-progress');
  expect(render([doc('card:archived', { archived: true }), doc('card:deleted', { deleted: true })])).toContain('No Sub Cards');
});

// 2026-11-09: Sub Cards without a deck are an indication only; the panel counts them in its heading and marks each row.
it('counts and marks Sub Cards without a deck in the Hero family panel', () => {
  const base = { path: 'cards/family.md', version: null, owner: null, markdown: '', sourceHash: 'hash', range: null, trackIds: [] };
  const hero: CatalogCard = { ...base, id: 'card:hero', kind: 'hero', title: 'Lantern', state: null, deckId: 'deck', parentId: null };
  const child = (id: string, deckId: string | null, overrides: Partial<CatalogCard> = {}): CatalogCard =>
    ({ ...base, id, kind: 'task', title: id, state: 'not-started', deckId, parentId: hero.id, ...overrides });
  const noop = () => {};
  const render = (children: CatalogCard[]) => {
    const catalog: CatalogView = { rootIdentity: 'root', configured: true, formatLanguage: 'en', manifestHash: 'hash', indexedAt: '',
      documents: [], spaces: [], decks: [], tracks: [], cards: [hero, ...children], warnings: [] };
    return renderToStaticMarkup(<CardFamilyPanel hero={hero} card={hero} children={children} openedId={hero.id} catalog={catalog}
      disabled={false} writable={false} onOpen={noop} onCreate={noop} onAttach={noop} />);
  };
  // Two active children without a deck; a third one with a deck and an archived fourth without one stay out of the count.
  const html = render([child('card:a', null), child('card:b', null), child('card:c', 'deck'), child('card:d', null, { archived: true })]);
  expect(html).toContain('card-family-no-deck-count">No deck: 2<');
  expect(html.match(/card-family-row-no-deck/g)).toHaveLength(2);
  setLang('ru');
  const russian = render([child('card:a', null), child('card:b', null)]);
  expect(russian).toContain('card-family-no-deck-count">Без колоды: 2<');
  expect(russian.match(/card-family-row-no-deck/g)).toHaveLength(2);
  setLang('en');
  const allDecks = render([child('card:a', 'deck'), child('card:b', 'deck')]);
  expect(allDecks).not.toContain('card-family-no-deck-count');
  expect(allDecks).not.toContain('card-family-row-no-deck');
});
