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

function renderTile(overrides: Partial<CatalogCard> = {}, groupedBy?: 'state' | 'priority', calendarDay?: string, sharedTags?: readonly string[]): string {
  const card: CatalogCard = { id: 'card:tile', kind: 'task', title: 'Project title', path: 'cards/tile.md', version: null, state: 'not-started', owner: 'Alex',
    markdown: 'Project text.', sourceHash: 'hash', range: null, deckId: 'deck', trackIds: [], parentId: null, ...overrides };
  const noop = () => {};
  return renderToStaticMarkup(<CatalogCardTile card={card} lookups={buildCatalogLookups([card])} members={[]}
    groupedBy={groupedBy} sharedTags={sharedTags} calendarDay={calendarDay} selected={false} checked={false} selectionActive={false} disabled={false} onOpen={noop} onToggle={noop} onFamilyOpen={noop} />);
}

it('names Trash in the single state position ahead of Archive, hiding ordinary metadata', () => {
  for (const kind of ['task', 'hero', 'doc'] as const) {
    const html = renderTile({ kind, archived: true, deleted: true, effort: 3, tags: ['world'], dueDate: '2026-01-01' });
    expect(html).toContain('>In Trash</span>');
    expect(html).toContain('aria-label="Open: Project title,');
    expect(html).not.toContain('card-tag-summary');
    expect(html).not.toContain('deck-card-effort');
    expect(html).not.toContain('deck-card-owner');
    expect(html).not.toContain('card-face-due');
    expect(html).not.toContain('lucide-archive');
    expect(html).not.toContain('title="Archived"');
  }
  setLang('ru');
  expect(renderTile({ deleted: true })).toContain('>В корзине</span>');
});

it('names Archive in text and keeps the active task workflow in the same place', () => {
  expect(renderTile({ archived: true })).toContain('>Archived</span>');
  expect(renderTile({ archived: true })).not.toContain('card-trash-indicator');
  expect(renderTile()).not.toContain('card-trash-indicator');
  expect(renderTile()).toContain('>Not started</span>');
});

it('sizes Hero progress by Sub Card effort and labels the separate accepted-card count', () => {
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
  expect(html).toContain('>1 of 3</span>');
  expect(html).toContain('1 of 3 accepted; segment length is Sub Card effort');
  expect(html).not.toContain('catalog-card-effort');
});

it('names Doc and open questions without passive glyphs and keeps the document excerpt', () => {
  // Its own hash: tiles remember text-derived values per card revision, and other tests render card:tile with other text.
  const doc: Partial<CatalogCard> = { kind: 'doc', state: null, sourceHash: 'doc-page', markdown: 'Watch a new player arrive.\n\n## Working notes\nCan they find the lantern?', openQuestions: [{ text: 'Question?', taskRef: null }] };
  const html = renderTile(doc);
  expect(html).toContain('class="deck-card-kind-name">Doc</span>');
  expect(html).toContain('>Questions: 1</span>');
  expect(html).not.toContain('deck-card-doc-words');
  expect(html).not.toContain('lucide-notebook');
  expect(html).not.toContain('Markdown');
  expect(html).toContain('<span class="deck-card-doc-excerpt" aria-hidden="true"><span>Watch a new player arrive.</span><b>Working notes</b><span>Can they find the lantern?</span></span>');
  expect(html).toContain('class="deck-card-owner" title="Owner: Alex"');
  expect(html).toContain('card-owner-avatar');
  expect(renderTile({ kind: 'task' })).not.toContain('deck-card-doc-excerpt');
  setLang('ru');
  const russian = renderTile(doc);
  expect(russian).toContain('>Вопросов: 1</span>');
  expect(russian).toContain('class="deck-card-kind-name">Doc</span>');
});

it('names a finished Hero count and preserves its owner in both completion states', () => {
  const hero: CatalogCard = { id: 'card:hero', kind: 'hero', title: 'Hero title', path: 'cards/hero.md', version: null, state: null, owner: 'Alex',
    markdown: 'Hero text.', sourceHash: 'hash', range: null, deckId: 'deck', trackIds: [], parentId: null };
  const child = (state: CatalogCard['state']): CatalogCard => ({ ...hero, id: 'card:child', kind: 'task', title: 'Child', path: 'cards/child.md', state, parentId: hero.id });
  const noop = () => {};
  const render = (children: CatalogCard[]) => renderToStaticMarkup(<CatalogCardTile card={hero} lookups={buildCatalogLookups([hero, ...children])} members={[]}
    selected={false} checked={false} selectionActive={false} disabled={false} onOpen={noop} onToggle={noop} onFamilyOpen={noop} />);
  const done = render([child('done')]);
  expect(done).toContain('is-family-done');
  expect(done).toContain('>1 of 1</span>');
  expect(done).toContain('1 of 1 accepted');
  expect(done).toContain('title="Owner: Alex"');
  expect(done).not.toContain('deck-card-done-medallion');
  const started = render([child('started')]);
  expect(started).not.toContain('deck-card-done-medallion');
  expect(started).toContain('title="Owner: Alex"');
  setLang('ru');
  expect(render([child('done')])).toContain('1 из 1 принято');
});

// 2026-11-09: a Hero without Task Sub Cards marked done by hand wears the same done look as a finished family.
it('marks a Hero without Task Sub Cards done by its own mark', () => {
  const hero: CatalogCard = { id: 'card:hero', kind: 'hero', title: 'Hero title', path: 'cards/hero.md', version: null, state: 'done', owner: 'Alex',
    markdown: 'Hero text.', sourceHash: 'hash', range: null, deckId: 'deck', trackIds: [], parentId: null };
  const noop = () => {};
  const render = (card: CatalogCard) => renderToStaticMarkup(<CatalogCardTile card={card} lookups={buildCatalogLookups([card])} members={[]}
    selected={false} checked={false} selectionActive={false} disabled={false} onOpen={noop} onToggle={noop} onFamilyOpen={noop} />);
  const done = render(hero);
  expect(done).toContain('is-family-done');
  expect(done).not.toContain('deck-state-accepted');
  expect(done).toContain('Hero done');
  expect(done).toContain('>Done</span>');
  expect(done).toContain('deck-card-owner');
  expect(render({ ...hero, state: null })).not.toContain('is-family-done');
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
  const empty = render([doc('card:archived', { archived: true }), doc('card:deleted', { deleted: true })]);
  expect(empty).not.toContain('sub-card-progress');
  expect(empty).not.toContain('No Sub Cards');
  expect(empty).toContain('deck-card-family-count');
});

it('uses readable localized workflow labels and keeps the state and due date in the opener name', () => {
  setLang('ru');
  for (const [state, label] of [['not-started', 'Не начата'], ['started', 'В работе'], ['review', 'Приёмка'], ['done', 'Принято']] as const) {
    const html = renderTile({ state });
    expect(html).toContain('>' + label + '</span>');
    expect(html).toContain('aria-label="Открыть: Project title, Task, ' + label);
    expect(html).not.toMatch(/lucide-(hourglass|eye|play|check)/);
  }
  expect(renderTile({ state: 'discussing' })).toContain('>Обсуждаем</span>');
  expect(renderTile({ dueDate: '2020-01-01' })).toContain('>Просрочено</span>');
  expect(renderTile({ dueDate: '2020-01-01' })).toContain('Срок: 01.01.2020');
});

it('suppresses only known group context, retaining deadlines, lifecycle and the accessible workflow', () => {
  const grouped = renderTile({ state: 'review', dueDate: '2020-01-01' }, 'state');
  expect(grouped).not.toContain('>Review</span>');
  expect(grouped).toContain('Task, Review');
  expect(grouped).toContain('>Overdue</span>');
  expect(renderTile({ deleted: true }, 'state')).toContain('>In Trash</span>');
  expect(renderTile({ priority: 'high' })).toContain('>High</span>');
  expect(renderTile({ priority: 'high' }, 'priority')).not.toContain('>High</span>');
  expect(renderTile({ priority: 'low' })).not.toContain('deck-card-priority');
  expect(renderTile({ priority: 'medium' })).not.toContain('deck-card-priority');
  const shared = renderTile({ tags: ['world', 'light'] }, undefined, undefined, ['world']);
  expect(shared).toContain('tags: world, light');
  expect(shared).toContain('>#light</span>');
  expect(shared).not.toContain('>#world</span>');
  expect(renderTile({ tags: ['world'] }, undefined, undefined, ['world'])).not.toContain('card-tag-summary');
});

it('preserves an estimate of zero and leaves a missing estimate empty', () => {
  expect(renderTile({ effort: 0 })).toContain('Est. <b>0</b>');
  expect(renderTile({ effort: null })).not.toContain('deck-card-effort');
  expect(renderTile()).not.toContain('deck-card-effort');
});

it('treats the deck calendar day as an invalidation token rather than an ISO date', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 11, 12));
  try {
    const html = renderTile({ dueDate: '2026-11-12' }, undefined, new Date().toDateString());
    expect(html).toContain('>Due 11/12</span>');
    expect(html).not.toContain('>Overdue</span>');
  } finally { vi.useRealTimers(); }
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
