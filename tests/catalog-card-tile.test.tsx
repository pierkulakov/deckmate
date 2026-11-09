import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CatalogCard } from '../src/catalog-contracts.ts';
import { CatalogCardTile } from '../client/components/CatalogCardTile.tsx';
import { buildCatalogLookups } from '../client/catalog-lookups.ts';
import { setLang } from '../client/i18n.ts';

vi.hoisted(() => {
  vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
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
