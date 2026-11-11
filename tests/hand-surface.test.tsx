import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CatalogCard, CatalogView, RunRecord } from '../src/catalog-contracts.ts';
import type { WorkspaceSnapshot } from '../src/workspace-contracts.ts';
import { Hand, HandRunsSection } from '../client/components/Hand.tsx';
import { setLang } from '../client/i18n.ts';
import { isoWeekStart, localIsoDate } from '../src/catalog-hand.ts';
import { buildCatalogLookups } from '../client/catalog-lookups.ts';
import { CardMetrics } from '../client/components/CardMetrics.tsx';

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
  vi.stubGlobal('window', Object.assign(new EventTarget(), { matchMedia: () => ({ matches: false }) }));
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

it.each(['due', 'runs', 'milestone'])('falls back when the linked %s tab is unavailable in this project', tab => {
  vi.stubGlobal('location', new URL(`http://localhost/?handTab=${tab}`));
  const html = renderToStaticMarkup(<Hand snapshot={snapshot} refreshKey={0} onOpenCard={() => undefined} onOpenMembers={() => undefined} />);
  expect(html).toMatch(/id="hand-tab-bookmarks"[^>]*aria-selected="true"/u);
  expect(html).not.toContain(`id="hand-tab-${tab}"`);
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

it.each(['en', 'ru'] as const)('%s: an empty read-only Hand does not offer a write action', lang => {
  setLang(lang);
  const html = renderToStaticMarkup(<Hand snapshot={{ ...snapshot, writable: false }} refreshKey={0} onOpenCard={() => undefined} onOpenMembers={() => undefined} />);
  expect(html).toContain(lang === 'en' ? 'No cards in this Hand yet.' : 'В этой Hand пока нет карточек.');
  expect(html).not.toContain('Choose cards in Decks');
  expect(html).not.toContain('Выбрать карточки в Decks');
});

it('a Run without the member’s cards shows the quiet empty state', () => {
  setLang('en');
  // 2026-11-10: the section is rendered directly because the Hand tab starts on Bookmarks and a static render cannot switch tabs.
  const run: RunRecord = { id: 'run-1', number: 1, start: '2020-01-01', end: '2099-12-31', goal: '' };
  const html = renderToStaticMarkup(<HandRunsSection title="Your Runs" owned={[]} withoutCards={[run]} decksById={new Map()} onOpenTimeline={() => undefined} onOpenCard={() => undefined} />);
  expect(html).toContain('You have no cards in this Run.');
  expect(html).toContain('ui-empty-quiet');
});

function card(overrides: Partial<CatalogCard>): CatalogCard {
  return { id: 'card:test', kind: 'task', title: 'A card', path: 'cards/test.md', version: null,
    state: 'not-started', owner: 'Maya', markdown: '', sourceHash: 'hash', range: null,
    deckId: null, trackIds: [], parentId: null, ...overrides };
}

it('does not offer removal or reordering in a read-only occupied Hand', () => {
  setLang('en');
  catalog = { ...defaultCatalog, cards: [card({ handMemberIds: ['maya'] })] };
  const html = renderToStaticMarkup(<Hand snapshot={{ ...snapshot, writable: false }} refreshKey={0} onOpenCard={() => undefined} onOpenMembers={() => undefined} />);
  expect(html).toContain('A card');
  expect(html).not.toContain('hand-slot-remove');
  expect(html).not.toContain('hand-slot-handle');
});

it('offers quick settings on writable Hand tiles but not on read-only tiles, without hiding the owner', () => {
  setLang('en');
  catalog = { ...defaultCatalog, cards: [card({ handMemberIds: ['maya'] })] };
  const render = (writable: boolean) => renderToStaticMarkup(<Hand snapshot={{ ...snapshot, writable }} refreshKey={0} onOpenCard={() => undefined} onOpenMembers={() => undefined} />);
  const writable = render(true);
  expect(writable).toContain('aria-label="Quick Settings: A card, Owner: Maya"');
  expect(writable).toContain('class="deck-card-owner" title="Owner: Maya" aria-label="Owner: Maya"');
  expect(writable).toContain('class="card-owner-avatar"');
  const readOnly = render(false);
  expect(readOnly).not.toContain('class="deck-card-settings"');
  expect(readOnly).toContain('class="deck-card-owner" title="Owner: Maya" aria-label="Owner: Maya"');
  expect(readOnly).toContain('class="card-owner-avatar"');
});

it('shows a decorated tag only once in Hand queue and Run rows', () => {
  setLang('en');
  const projectTags = [{ name: 'sound', color: '#abcdef', emoji: '🔈' }];
  const cards = Array.from({ length: 8 }, (_, index) => card({ id: `card:${index}`, title: `Card ${index}`, handMemberIds: ['maya'], handOrder: { maya: index }, tags: ['sound'] }));
  catalog = { ...defaultCatalog, cards, projectTags };
  const hand = renderToStaticMarkup(<Hand snapshot={snapshot} refreshKey={0} onOpenCard={() => undefined} onOpenMembers={() => undefined} />);
  const queue = hand.slice(hand.indexOf('class="hand-queue"'));
  expect(queue).toContain('tag-badge');
  expect(queue).not.toContain('card-title-tags');
  expect(queue.match(/🔈/gu)).toHaveLength(1);
  const run: RunRecord = { id: 'run-1', number: 1, start: '2020-01-01', end: '2099-12-31', goal: '' };
  const runs = renderToStaticMarkup(<HandRunsSection title="Your Runs" owned={[{ run, cards: [cards[0]] }]} withoutCards={[]} decksById={new Map()} projectTags={projectTags} onOpenTimeline={() => undefined} onOpenCard={() => undefined} />);
  expect(runs).toContain('tag-badge');
  expect(runs).not.toContain('card-title-tags');
  expect(runs.match(/🔈/gu)).toHaveLength(1);
});

it.each([1, 3, 6])('bounds %s queue tags below the opening button', count => {
  setLang('en');
  const names = ['Очень длинное название русского тега', 'second', 'third', 'fourth', 'fifth', 'sixth'].slice(0, count);
  const cards = Array.from({ length: 8 }, (_, index) => card({ id: `card:${index}`, title: `Card ${index}`, handMemberIds: ['maya'], handOrder: { maya: index }, tags: index === 7 ? names : [] }));
  catalog = { ...defaultCatalog, cards };
  const html = renderToStaticMarkup(<Hand snapshot={snapshot} refreshKey={0} onOpenCard={() => undefined} onOpenMembers={() => undefined} />);
  const queue = html.slice(html.indexOf('class="hand-queue"'));
  expect(queue).toMatch(/class="hand-queue-open"[\s\S]*?<\/button><div class="hand-queue-tags">/u);
  expect(queue.match(/class="tag-badge-name"/gu)).toHaveLength(Math.min(2, count));
  expect(queue).toContain(`title="${names[0]}"`);
  if (count > 2) expect(queue).toContain(`+${count - 2}`);
});

it.each(['en', 'ru'] as const)('%s: Hand queue and Run rows expose effort and priority, including zero and unset', lang => {
  setLang(lang);
  const cards = Array.from({ length: 8 }, (_, index) => card({ id: `card:${index}`, handMemberIds: ['maya'], handOrder: { maya: index }, effort: 0, priority: index === 7 ? 'low' : null }));
  catalog = { ...defaultCatalog, cards };
  const hand = renderToStaticMarkup(<Hand snapshot={snapshot} refreshKey={0} onOpenCard={() => undefined} onOpenMembers={() => undefined} />);
  const queue = hand.slice(hand.indexOf('class="hand-queue"'));
  expect(queue).toContain(lang === 'en' ? 'Effort: 0' : 'Оценка: 0');
  expect(queue).toContain(lang === 'en' ? 'Priority: Low' : 'Приоритет: Низкий');
  const run: RunRecord = { id: 'run-1', number: 1, start: '2020-01-01', end: '2099-12-31', goal: '' };
  const rows = renderToStaticMarkup(<HandRunsSection title="Your Runs" owned={[{ run, cards: [cards[0], cards[7]] }]} withoutCards={[]} decksById={new Map()} onOpenTimeline={() => undefined} onOpenCard={() => undefined} />);
  expect(rows).toContain(lang === 'en' ? 'No priority' : 'Без приоритета');
  expect(rows).toContain(lang === 'en' ? 'Priority: Low' : 'Приоритет: Низкий');
});

it('the Done pile is an expandable control and reports only this week’s dated cards', () => {
  setLang('en');
  catalog = { ...defaultCatalog, cards: [
    card({ id: 'card:done', state: 'done', doneAt: localIsoDate(), effort: 3 }),
    card({ id: 'card:undated', state: 'done', doneAt: null, effort: 9 }),
  ] };
  const html = renderToStaticMarkup(<Hand snapshot={snapshot} refreshKey={0} onOpenCard={() => undefined} onOpenMembers={() => undefined} />);
  expect(html).toMatch(/<button[^>]*class="hand-slot hand-slot-done"[^>]*aria-expanded="false"/u);
  expect(html).toContain('This week: 1');
  expect(html).toContain('Effort 3');
  expect(html).toContain('hand-slot-done-count">2');
});

it('the Done pile tooltip reports the previous week rather than the next week', () => {
  setLang('en');
  catalog = { ...defaultCatalog, cards: [
    card({ id: 'previous', state: 'done', doneAt: isoWeekStart(1), effort: 5 }),
    card({ id: 'future', state: 'done', doneAt: isoWeekStart(-1), effort: 12 }),
  ] };
  const html = renderToStaticMarkup(<Hand snapshot={snapshot} refreshKey={0} onOpenCard={() => undefined} onOpenMembers={() => undefined} />);
  expect(html).toContain('Last week: 1 · 5');
  expect(html).toContain('Last week: 1 · Effort 5');
  expect(html).not.toContain('Last week: 1 · 12');
});

it('Run workload counts active Task effort, unknown estimates and remaining workdays', () => {
  setLang('en');
  const run: RunRecord = { id: 'run-1', number: 1, start: '2020-01-01', end: '2099-12-31', goal: '' };
  const cards = [card({ effort: 0 }), card({ id: 'unknown', effort: null }),
    card({ id: 'done', state: 'done', effort: 9 }), card({ id: 'hero', kind: 'hero', state: null, effort: 20 }),
    card({ id: 'doc', kind: 'doc', state: null, effort: 30 })];
  const html = renderToStaticMarkup(<HandRunsSection title="Your Runs" owned={[{ run, cards }]} withoutCards={[]} decksById={new Map()} onOpenTimeline={() => undefined} onOpenCard={() => undefined} />);
  expect(html).toContain('Active Effort: 0');
  expect(html).toContain('Unestimated: 1');
  expect(html).toMatch(/Workdays left: [\d,]+/u);
});

it.each(['en', 'ru'] as const)('%s: another member’s Hand is named, the acting member’s keeps its own labels', lang => {
  setLang(lang);
  catalog = { ...defaultCatalog,
    members: [{ id: 'maya', label: 'Maya', kind: 'human', aliases: [] }, { id: 'bolt', label: 'Bolt', kind: 'agent', aliases: [] }],
    runs: [{ id: 'run-1', number: 1, start: '2020-01-01', end: '2099-12-31', goal: '' }],
    cards: [card({ id: 'card:bolt', owner: 'Bolt', dueDate: '2099-12-31', handMemberIds: ['bolt'] })] };
  // The acting member stays Maya (no stored choice): Bolt's Hand must not claim to be the viewer's own.
  vi.stubGlobal('location', new URL('http://localhost/?handMember=bolt'));
  const foreign = renderToStaticMarkup(<Hand snapshot={snapshot} refreshKey={0} onOpenCard={() => undefined} onOpenMembers={() => undefined} />);
  expect(foreign).toContain('Hand: Bolt');
  expect(foreign).not.toContain(lang === 'en' ? 'Your Hand' : 'Ваш Hand');
  expect(foreign).toContain(lang === 'en' ? 'aria-label="Due cards, 1 card"' : 'aria-label="Карточки по срокам, 1 карточка"');
  expect(foreign).toContain(lang === 'en' ? 'aria-label="Runs, 0 cards"' : 'aria-label="Run, 0 карточек"');
  expect(foreign).not.toContain(lang === 'en' ? 'Your due cards' : 'Ваши карточки по срокам');
  expect(foreign).not.toContain(lang === 'en' ? 'Your Runs' : 'Ваши Run');
  vi.stubGlobal('location', new URL('http://localhost/'));
  const own = renderToStaticMarkup(<Hand snapshot={snapshot} refreshKey={0} onOpenCard={() => undefined} onOpenMembers={() => undefined} />);
  expect(own).toContain(lang === 'en' ? 'Your Hand' : 'Ваш Hand');
  expect(own).toContain(lang === 'en' ? 'Your due cards' : 'Ваши карточки по срокам');
  expect(own).toContain(lang === 'en' ? 'Your Runs' : 'Ваши Run');
});

it.each(['en', 'ru'] as const)('%s: Hero totals include all active Task children in queue, due, Run and Milestone rows', lang => {
  setLang(lang);
  const run: RunRecord = { id: 'run-1', number: 1, start: '2020-01-01', end: '2099-12-31', goal: '' };
  const hero = card({ id: 'hero', kind: 'hero', effort: 2.125, handMemberIds: ['maya'], handOrder: { maya: 8 }, dueDate: '2099-12-30', milestone: 'milestone' });
  const cards = [hero, card({ id: 'estimated', parentId: hero.id, effort: 3 }), card({ id: 'unknown', parentId: hero.id, effort: null }),
    card({ id: 'zero', parentId: hero.id, effort: 0 }), card({ id: 'archived', parentId: hero.id, effort: 99, archived: true }),
    card({ id: 'deleted', parentId: hero.id, effort: 99, deleted: true }), card({ id: 'doc', kind: 'doc', parentId: hero.id, effort: 99 }),
    ...Array.from({ length: 7 }, (_, i) => card({ id: `slot-${i}`, handMemberIds: ['maya'], handOrder: { maya: i } }))];
  catalog = { ...defaultCatalog, cards, runs: [run], pinnedMilestoneId: 'milestone', milestones: [{ id: 'milestone', title: 'Milestone', date: '2099-12-31', color: '#abcdef' }] };
  const label = lang === 'en' ? 'Effort: own and Sub Cards — 6.125' : 'Оценка: своя и Sub Cards — 6,125';
  for (const tab of ['due', 'milestone']) {
    vi.stubGlobal('location', new URL(`http://localhost/?handTab=${tab}`));
    const html = renderToStaticMarkup(<Hand snapshot={snapshot} refreshKey={0} onOpenCard={() => undefined} onOpenMembers={() => undefined} />);
    expect(html.slice(html.indexOf('class="hand-queue"'))).toContain(label);
    expect(html.slice(html.indexOf('class="hand-section-row"'))).toContain(label);
  }
  const runs = renderToStaticMarkup(<HandRunsSection title="Runs" owned={[{ run, cards: [hero] }]} withoutCards={[]} decksById={new Map()} lookups={buildCatalogLookups(cards)} onOpenTimeline={() => undefined} onOpenCard={() => undefined} />);
  expect(runs).toContain(label);
});

it('shared metrics preserve zero, omit unknown estimates, and never show Doc properties', () => {
  setLang('en');
  const lookups = buildCatalogLookups([]);
  const render = (value: CatalogCard) => renderToStaticMarkup(<CardMetrics card={value} lookups={lookups} />);
  expect(render(card({ effort: 0 }))).toContain('Effort: 0');
  expect(render(card({ effort: null }))).not.toContain('effort-icon');
  expect(render(card({ effort: null }))).toContain('No priority');
  expect(render(card({ kind: 'hero', effort: null }))).not.toContain('effort-icon');
  expect(render(card({ kind: 'doc', effort: 5, priority: 'high' }))).toBe('');
});

it.each(['en', 'ru'] as const)('%s: Team Hands reuse tiles with family totals and per-member saved slots', lang => {
  setLang(lang);
  vi.stubGlobal('location', new URL('http://localhost/?handTab=team'));
  const hero = card({ id: 'hero', kind: 'hero', title: 'Hero without own effort', effort: null, handMemberIds: ['maya', 'leo'], handOrder: { maya: 5, leo: 0 }, dueDate: '2099-12-31', bookmarked: true });
  catalog = { ...defaultCatalog,
    members: [...(defaultCatalog.members ?? []), { id: 'leo', label: 'Очень длинное имя участника команды', kind: 'human', aliases: [] }],
    cards: [card({ id: 'first', handMemberIds: ['maya'], handOrder: { maya: 0 }, state: 'started' }), hero,
      card({ id: 'child', parentId: hero.id, effort: 3 }), card({ id: 'unknown', parentId: hero.id, effort: null }),
      card({ id: 'doc', kind: 'doc', title: 'Notes', handMemberIds: ['maya'], handOrder: { maya: 9 }, markdown: 'Readable notes' })],
  };
  const html = renderToStaticMarkup(<Hand snapshot={snapshot} refreshKey={0} onOpenCard={() => undefined} onOpenMembers={() => undefined} />);
  const team = html.slice(html.indexOf('aria-labelledby="hand-tab-team"'));
  expect(team.match(/class="deck-card-space/g)).toHaveLength(4);
  expect(team).not.toContain('sprint-task');
  expect(team).not.toContain('hand-card-open');
  expect(team).toContain(lang === 'en' ? 'Effort: own and Sub Cards — 4' : 'Оценка: своя и Sub Cards — 4');
  expect(team).toContain('class="deck-card-owner-medallion"');
  expect(team).toContain('deck-state-working');
  expect(team).toContain('catalog-card-doc');
  expect(team).toContain('Readable notes');
  expect(team).toContain('class="card-hand-number">2</strong>');
  expect(team).toContain('class="card-hand-number">1</strong>');
  expect(team).toContain('hand-team-card-meta');
  expect(team).toContain(lang === 'en' ? 'Due ·' : 'Срок ·');
  expect(team).toContain('hand-team-bookmark');
  const bands = [...team.matchAll(/class="deck-card-band">([\s\S]*?)<\/article>/gu)].map(match => match[1]);
  for (const band of bands) {
    expect(band).not.toContain('status-badge');
    expect(band).not.toContain('hand-team-card-meta');
  }
  const readonly = renderToStaticMarkup(<Hand snapshot={{ ...snapshot, writable: false }} refreshKey={0} onOpenCard={() => undefined} onOpenMembers={() => undefined} />);
  expect(readonly.slice(readonly.indexOf('aria-labelledby="hand-tab-team"'))).not.toContain('class="deck-card-settings"');
});
