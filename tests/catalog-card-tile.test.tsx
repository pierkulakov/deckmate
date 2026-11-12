import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CatalogCard, CatalogView } from '../src/catalog-contracts.ts';
import { CatalogCardTile } from '../client/components/CatalogCardTile.tsx';
import { CardFamilyPanel } from '../client/components/CardFamily.tsx';
import { buildCatalogLookups } from '../client/catalog-lookups.ts';
import { setLang } from '../client/i18n.ts';
import { EffortIcon } from '../client/components/EffortIcon.tsx';

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

function renderTile(overrides: Partial<CatalogCard> = {}, calendarDay?: string, handPositions?: Record<string, number>): string {
  const card: CatalogCard = { id: 'card:tile', kind: 'task', title: 'Project title', path: 'cards/tile.md', version: null, state: 'not-started', owner: 'Alex',
    markdown: 'Project text.', sourceHash: 'hash', range: null, deckId: 'deck', trackIds: [], parentId: null, ...overrides };
  const noop = () => {};
  return renderToStaticMarkup(<CatalogCardTile card={card} lookups={buildCatalogLookups([card])} members={[]}
    handPositions={handPositions} calendarDay={calendarDay} selected={false} checked={false} selectionActive={false} disabled={false} onOpen={noop} onToggle={noop} onFamilyOpen={noop} />);
}

it('exposes selection mode on the tile checkbox without changing its checked state', () => {
  const card: CatalogCard = { id: 'card:selection', kind: 'task', title: 'Selectable', path: 'cards/selection.md', version: null,
    state: 'not-started', owner: null, markdown: '', sourceHash: 'hash', range: null, deckId: 'deck', trackIds: [], parentId: null };
  const noop = () => {};
  const render = (selectionActive: boolean, checked: boolean, selectable = true) => renderToStaticMarkup(<CatalogCardTile card={card}
    lookups={buildCatalogLookups([card])} members={[]} selected={false} checked={checked} selectionActive={selectionActive}
    disabled={false} selectable={selectable} onOpen={noop} onToggle={noop} onFamilyOpen={noop} />);
  expect(render(false, false)).not.toContain('data-selection-active');
  expect(render(true, false)).toMatch(/<input[^>]*data-selection-active="true"[^>]*\/>/);
  expect(render(true, false)).not.toMatch(/<input[^>]*\schecked=/);
  expect(render(true, true)).toMatch(/<input[^>]*\schecked=/);
  expect(render(true, false, false)).not.toContain('catalog-card-checkbox');
});

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

it('names Archive in text and keeps an unstarted workflow only in the accessible name', () => {
  expect(renderTile({ archived: true })).toContain('>Archived</span>');
  expect(renderTile({ archived: true })).not.toContain('card-trash-indicator');
  expect(renderTile()).not.toContain('card-trash-indicator');
  expect(renderTile()).not.toContain('>Not started</span>');
  expect(renderTile()).toContain('Task, Not started');
});

it('pairs Hero effort with priority above the effort-weighted family progress', () => {
  const base = { path: 'cards/tile.md', version: null, owner: null, markdown: '', sourceHash: 'hash', range: null, deckId: 'deck', trackIds: [] };
  const hero: CatalogCard = { ...base, id: 'card:hero', kind: 'hero', title: 'Lantern', state: 'not-started', parentId: null, priority: 'high' };
  const child = (id: string, effort: number | null, state: CatalogCard['state']): CatalogCard =>
    ({ ...base, id, kind: 'task', title: id, state, effort, parentId: hero.id });
  const children = [child('card:a', 5, 'done'), child('card:b', null, 'started'), child('card:c', 0, 'not-started')];
  const noop = () => {};
  const html = renderToStaticMarkup(<CatalogCardTile card={hero} lookups={buildCatalogLookups([hero, ...children])} members={[]}
    selected={false} checked={false} selectionActive={false} disabled={false} onOpen={noop} onToggle={noop} onFamilyOpen={noop} />);
  const weights = [...html.matchAll(/class="sub-card-progress-segment" data-state="(\w+)" style="--sub-card-weight:([\d.]+)"/g)].map(match => `${match[1]}:${match[2]}`);
  expect(weights).toEqual(['accepted:5', 'working:1', 'planned:0']);
  expect(html).toContain('1 of 3 accepted; segment length is Sub Card effort');
  expect(html).toMatch(/title="Effort: own and Sub Cards — 6".*class="effort-icon".*<strong>6<\/strong>/);
  expect(html).toContain('Priority: High');
  expect(html).toContain('title="Priority: High"');
  expect(html).not.toContain('lucide-crown');
  expect(html.indexOf('deck-card-metrics')).toBeLessThan(html.indexOf('sub-card-progress'));
});

it('uses the same sized priority in Task and Hero, omitting only an unset Hero priority', () => {
  for (const priority of ['low', 'medium', 'high'] as const) {
    const task = renderTile({ kind: 'task', priority });
    const hero = renderTile({ kind: 'hero', priority });
    const prioritySvg = (html: string) => html.match(/class="journey-priority-icon priority-icon"[\s\S]*?<\/svg>/u)?.[0];
    expect(prioritySvg(hero)).toBe(prioritySvg(task));
    expect(hero).toMatch(new RegExp(`aria-label="Open: Project title,[^"]*Priority: ${priority[0].toUpperCase() + priority.slice(1)}`));
  }
  expect(renderTile({ kind: 'hero', priority: null })).not.toContain('priority-icon');
  expect(renderTile({ kind: 'task', priority: null })).toContain('title="No priority"');
  expect(renderTile({ kind: 'doc', priority: 'high' })).not.toContain('Priority: High');
  setLang('ru');
  const hero = renderTile({ kind: 'hero', priority: 'medium' });
  expect(hero).toContain('Приоритет: Средний');
  expect(hero).toContain('title="Приоритет: Средний"');
});

it('uses one decorative, scalable effort mark and preserves long values', () => {
  const icon = renderToStaticMarkup(<EffortIcon size={17} className="test-mark" />);
  expect(icon).toContain('width="17" height="17" viewBox="0 0 24 24"');
  expect(icon).toContain('fill="none" stroke="currentColor" stroke-width="2"');
  expect(icon).toContain('fill="currentColor" stroke="none"');
  expect(icon).toContain('aria-hidden="true"');
  expect(icon).toContain('class="effort-icon test-mark"');
  for (const kind of ['task', 'hero'] as const) {
    const html = renderTile({ kind, effort: 123, priority: 'high' });
    expect(html).toContain('deck-card-metrics is-compact');
    expect(html).toContain('class="effort-icon"');
    expect(html).toContain('<strong>123</strong>');
  }
  expect(renderTile({ kind: 'hero', effort: null })).toContain('<strong>—</strong>');
  expect(renderTile({ kind: 'hero', effort: 0 })).toContain('<strong>0</strong>');
});

it('places Doc questions on the band without covering the excerpt', () => {
  // Its own hash: tiles remember text-derived values per card revision, and other tests render card:tile with other text.
  const doc: Partial<CatalogCard> = { kind: 'doc', state: null, sourceHash: 'doc-page', markdown: 'Watch a new player arrive.\n\n## Working notes\nCan they find the lantern?', openQuestions: [{ text: 'Question?', taskRef: null, assignee: null, target: null }] };
  const html = renderTile(doc);
  expect(html).toContain('class="card-questions-metric" role="img" title="Open questions: 1" aria-label="Open questions: 1"');
  expect(html).toContain('<span class="doc-word-count" role="img" aria-label="12 words" title="12 words"><span aria-hidden="true">12w</span></span>');
  expect(html.indexOf('deck-card-band')).toBeLessThan(html.indexOf('card-questions-metric'));
  expect(html).toContain('lucide-message-circle-question');
  expect(html).not.toContain('>Questions: 1</span>');
  expect(html).not.toContain('deck-card-doc-words');
  expect(renderTile({ kind: 'doc' })).toContain('lucide-notebook');
  expect(html).not.toContain('Markdown');
  expect(html).toContain('<span class="deck-card-doc-excerpt" aria-hidden="true"><span>Watch a new player arrive.</span><b>Working notes</b><span>Can they find the lantern?</span></span>');
  expect(html).toContain('class="deck-card-owner-medallion"><span class="deck-card-owner" title="Owner: Alex"');
  expect(html).toContain('card-owner-avatar');
  expect(renderTile({ kind: 'task' })).not.toContain('deck-card-doc-excerpt');
  expect(renderTile({ kind: 'doc', state: null, sourceHash: 'doc-empty', markdown: '' })).not.toContain('doc-word-count');
  setLang('ru');
  const russian = renderTile(doc);
  expect(russian).toContain('aria-label="Открытых вопросов: 1"');
  expect(russian).not.toContain('>Вопросов: 1</span>');
  expect(russian).toContain('<span class="doc-word-count" role="img" aria-label="12 слов" title="12 слов"><span aria-hidden="true">12 сл.</span></span>');
});

it.each(['task', 'hero', 'doc'] as const)('shows questions and pending decisions on a %s tile', kind => {
  const card = { kind, openQuestions: [{ text: 'Question?', taskRef: null, assignee: 'maya', target: null }],
    decisions: [{ index: 0, question: 'Question?', answer: 'Answer', by: 'Maya', date: '2026-11-12', target: null, applied: null }] };
  const html = renderTile(card);
  expect(html).toContain('aria-label="Open questions: 1"');
  expect(html).toContain('deck-card-pending-dot');
  expect(html).toContain('Decision to apply');
  if (kind === 'task') expect(html).toContain('Waiting on @maya');
  const applied = { ...card, decisions: [{ ...card.decisions[0], applied: '2026-11-12' }] };
  expect(renderTile(applied)).not.toContain('deck-card-pending-dot');
});

it('replaces a finished Hero owner with the accepted medallion but retains the owner in the opener name', () => {
  const hero: CatalogCard = { id: 'card:hero', kind: 'hero', title: 'Hero title', path: 'cards/hero.md', version: null, state: null, owner: 'Alex',
    markdown: 'Hero text.', sourceHash: 'hash', range: null, deckId: 'deck', trackIds: [], parentId: null };
  const child = (state: CatalogCard['state']): CatalogCard => ({ ...hero, id: 'card:child', kind: 'task', title: 'Child', path: 'cards/child.md', state, parentId: hero.id });
  const noop = () => {};
  const render = (children: CatalogCard[]) => renderToStaticMarkup(<CatalogCardTile card={hero} lookups={buildCatalogLookups([hero, ...children])} members={[]}
    selected={false} checked={false} selectionActive={false} disabled={false} onOpen={noop} onToggle={noop} onFamilyOpen={noop} />);
  const done = render([child('done')]);
  expect(done).toContain('is-family-done');
  expect(done).toContain('1 of 1 accepted');
  expect(done).toContain('Owner: Alex');
  expect(done).not.toContain('title="Owner: Alex"');
  expect(done).toContain('deck-card-done-medallion" role="img" title="Hero done: all Sub Cards accepted"');
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
  expect(done).toContain('deck-card-done-medallion" role="img" title="Hero done"');
  expect(done).not.toContain('all Sub Cards accepted');
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
  expect(withDoc).toContain('class="sub-card-progress" aria-hidden="true"');
  const empty = render([doc('card:archived', { archived: true }), doc('card:deleted', { deleted: true })]);
  expect(empty).toContain('class="sub-card-progress" role="img" title="No Sub Cards"');
  expect(empty).toContain('deck-card-metrics');
});

it('names active work without putting calendar dates or an overdue mark on the tile', () => {
  setLang('ru');
  for (const [state, label] of [['not-started', 'Не начата'], ['started', 'В работе'], ['review', 'Приёмка'], ['done', 'Принято']] as const) {
    const html = renderTile({ state });
    expect(html).not.toContain('>' + label + '</span>');
    expect(html.includes('deck-state-working')).toBe(state === 'started');
    expect(html).toContain('aria-label="Открыть: Project title, Task, ' + label);
    expect(html).not.toMatch(/lucide-(hourglass|eye|play|check)/);
  }
  for (const state of ['discussing', 'in-iteration', 'wont-do'] as const) {
    expect(renderTile({ state })).not.toContain('class="card-face-status"');
  }
  // 2026-11-11: a missed date is not printed on the face; the accessible name still carries it.
  expect(renderTile({ dueDate: '2020-01-01' })).not.toContain('>Просрочено</span>');
  expect(renderTile({ dueDate: '2020-01-01' })).toContain('Просрочено');
  expect(renderTile({ dueDate: '2020-01-01' })).not.toContain('01.01.2020');
});

it('keeps the body free of tags and priority words while retaining context in the accessible name', () => {
  const grouped = renderTile({ state: 'review', dueDate: '2020-01-01' });
  expect(grouped).not.toContain('>Review</span>');
  expect(grouped).toContain('Task, Review');
  expect(grouped).not.toContain('>Overdue</span>');
  expect(grouped).toContain('Overdue');
  expect(renderTile({ deleted: true })).toContain('>In Trash</span>');
  expect(renderTile({ priority: 'high' })).toContain('Priority: High');
  expect(renderTile({ priority: 'high' })).not.toContain('deck-card-priority');
  expect(renderTile({ priority: 'low' })).not.toContain('deck-card-priority');
  expect(renderTile({ priority: 'medium' })).not.toContain('deck-card-priority');
  const shared = renderTile({ tags: ['world', 'light'] });
  expect(shared).toContain('tags: world, light');
  expect(shared).not.toContain('card-tag-summary');
  expect(shared).not.toContain('>#world</span>');
  expect(renderTile({ tags: ['world'] })).not.toContain('card-tag-summary');
});

it('preserves a zero estimate, uses a dash for unknown effort and keeps accepted Task metal', () => {
  expect(renderTile({ effort: 0 })).toContain('<strong>0</strong>');
  expect(renderTile({ effort: null })).toContain('<strong>—</strong>');
  expect(renderTile({ state: 'done' })).toContain('deck-state-accepted');
  expect(renderTile({ state: 'done' })).not.toContain('deck-card-done-medallion');
});

it('distinguishes all four priorities by geometry', () => {
  const paths: string[] = [];
  for (const priority of [null, 'low', 'medium', 'high'] as const) {
    const html = renderTile({ priority });
    const icon = html.match(/class="journey-priority-icon priority-icon"[\s\S]*?<\/svg>/u)?.[0];
    expect(icon).toBeDefined();
    expect(icon).not.toContain('lucide-layers');
    paths.push([...icon!.matchAll(/<path[^>]*d="([^"]+)"/gu)].map(match => match[1]).join(' '));
  }
  expect(new Set(paths).size).toBe(4);
  setLang('ru');
  expect(renderTile({ priority: 'high' })).toContain('Приоритет: Высокий');
});

it.each(['task', 'hero', 'doc'] as const)('restores emoji and a separately focusable color dot on a %s', kind => {
  const card: CatalogCard = { id: 'tagged', kind, title: 'Tagged title', path: 'tagged.md', version: null, state: null, owner: null,
    markdown: '', sourceHash: 'tagged', range: null, deckId: null, trackIds: [], parentId: null, tags: ['bug', 'world', 'personal'] };
  const noop = () => {};
  const html = renderToStaticMarkup(<CatalogCardTile card={card} lookups={buildCatalogLookups([card])} members={[]}
    tagDefinitions={[{ name: 'bug', emoji: '🐞', color: '#687e9c' }, { name: 'world', color: '#cc5c65' }]}
    selected={false} checked={false} selectionActive={false} disabled={false} onOpen={noop} onToggle={noop} onFamilyOpen={noop} />);
  expect(html).toMatch(/deck-card-title.*🐞.*Tagged title/u);
  expect(html).toMatch(/<\/button><span class="card-tag-pie" role="img" tabindex="0"/u);
  expect(html).not.toContain('card-tag-summary');
  expect(html).not.toContain('>world</span>');
});

it('puts Hand membership and the slot it is given in the face and opener name, never the sparse sort key', () => {
  setLang('ru');
  const html = renderTile({ handMemberIds: ['alex'], handOrder: { alex: 900 } }, undefined, { alex: 3 });
  expect(renderTile({ handMemberIds: ['alex'], handOrder: { alex: 900 } })).not.toContain('901');
  expect(html).toContain('В Hand у alex, слот 3');
  expect(html).toMatch(/deck-card-hand-row.*card-hand-indicator is-foreign.*<strong class="card-hand-number">3<\/strong>/);
  expect(html).not.toMatch(/card-(run|due|milestone|gate)-indicator/);
});

it('shows a known parent in the gold affiliation strip without putting it inside the opener', () => {
  const hero: CatalogCard = { id: 'hero', kind: 'hero', title: 'Combat Arena', path: 'hero.md', version: null,
    state: null, owner: null, markdown: '', sourceHash: 'hero', range: null, deckId: 'deck', trackIds: [], parentId: null };
  const child: CatalogCard = { ...hero, id: 'child', title: 'Create Room Art Assets', kind: 'task', parentId: hero.id };
  const noop = () => {};
  const html = renderToStaticMarkup(<CatalogCardTile card={child} lookups={buildCatalogLookups([hero, child])} members={[]}
    selected={false} checked={false} selectionActive={false} disabled={false} onOpen={noop} onToggle={noop} onFamilyOpen={noop} />);
  expect(html).toMatch(/class="card-family-trigger"[^>]*>.*<span>Combat Arena<\/span><\/button>/);
  expect(html).toContain('class="deck-card-title">Create Room Art Assets</span>');
});

it('treats the deck calendar day as an invalidation token rather than an ISO date', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 11, 12));
  try {
    const html = renderTile({ dueDate: '2026-11-12' }, new Date().toDateString());
    expect(html).not.toContain('11/12');
    expect(html).not.toContain('card-face-status');
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
