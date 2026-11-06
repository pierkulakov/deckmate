import { expect, it } from 'vitest';
import type { CatalogCard, CatalogView } from '../src/catalog-contracts.ts';
import { shortReference } from '../src/references.ts';
import { summarizeCatalog } from '../server/catalog-summary.ts';

function card(id: string, state: string | null, overrides: Partial<CatalogCard> = {}): CatalogCard {
  return { id, title: id, kind: 'task', path: `cards/${id}.md`, version: null, state: state as CatalogCard['state'], owner: null,
    markdown: 'Long private instructions should not appear in the summary.', sourceHash: 'hash', range: null,
    deckId: 'audio', trackIds: ['sound'], parentId: null, ...overrides };
}
function fixture(cards: CatalogCard[] = []): CatalogView {
  return { rootIdentity: 'root', formatLanguage: 'ru', configured: true, manifestHash: 'hash', indexedAt: '2026-11-03', documents: [], spaces: [], warnings: [], cards,
    decks: [{ id: 'audio', title: 'Audio tasks', spaceId: 'work', kind: 'task', color: '#123456', icon: 'music', description: '' }],
    tracks: [{ id: 'sound', title: 'Звук', description: '' }, { id: 'animation', title: 'Анимация', description: '' }] };
}

it('resolves exact ID, mixed-case Cyrillic title and unique substring without requiring an iteration', () => {
  const catalog = fixture([card('footsteps', 'started', { owner: '@Кими' }), card('walk', 'not-started', { trackIds: ['animation'] })]);
  for (const track of ['sound', ' зВуК ', 'ВУ']) {
    const summary = summarizeCatalog(catalog, track);
    expect(summary.track).toEqual({ id: 'sound', title: 'Звук' });
    expect(summary.counts.total).toBe(1);
    expect(summary.groups.doing.cards[0]).toMatchObject({ id: 'footsteps', owner: '@Кими' });
  }
  expect(summarizeCatalog(catalog).counts.total).toBe(2);
});

it('reports ambiguous titles with candidate names and prioritizes exact IDs and exact titles', () => {
  const catalog = fixture();
  catalog.tracks.push({ id: 'mix', title: 'Звуковые эффекты', description: '' });
  expect(() => summarizeCatalog(catalog, 'звук')).not.toThrow();
  expect(() => summarizeCatalog(catalog, 'ЗВ')).toThrow('Звук (sound), Звуковые эффекты (mix)');
  catalog.tracks.push({ id: 'copy', title: 'ЗВУК', description: '' });
  expect(() => summarizeCatalog(catalog, 'звук')).toThrow('ЗВУК (copy)');
  expect(summarizeCatalog(catalog, 'sound').track?.id).toBe('sound');
  expect(() => summarizeCatalog(catalog, 'missing')).toThrow('not found');
  expect(() => summarizeCatalog(catalog, '  ')).toThrow('nonempty');
});

it('counts raw states and task owners, preserving unknown states without treating checkmarks as acceptance', () => {
  const catalog = fixture([
    card('hero', null, { kind: 'hero' }), card('doc', null, { kind: 'doc' }),
    card('doing', 'started', { owner: '@Кими' }), card('review', 'review', { owner: '@Павел' }),
    card('custom', 'needs sound pass', { owner: '@Кими' }), card('checkmark', '✅'), card('no-state', null),
    card('accepted', 'done', { title: 'No green checkmark' }), card('planned', 'not-started', { title: '✅ Still planned' }),
  ]);
  const before = JSON.stringify(catalog);
  const summary = summarizeCatalog(catalog, 'Звук');
  expect(summary.counts.kind).toEqual({ task: 7, hero: 1, doc: 1 });
  expect(summary.counts.taskStates).toEqual(expect.arrayContaining([{ state: 'needs sound pass', count: 1 }, { state: '✅', count: 1 }, { state: null, count: 1 }]));
  expect(summary.counts.owners).toEqual(expect.arrayContaining([{ owner: '@Кими', count: 2 }, { owner: null, count: 4 }]));
  expect(summary.groups.planned.cards.map(row => row.id)).toEqual(['planned']);
  expect(summary.groups.doing.total).toBe(1);
  expect(summary.groups.review.total).toBe(1);
  expect(JSON.stringify(summary)).not.toContain('Long private instructions');
  expect(JSON.stringify(catalog)).toBe(before);
});

it('shows explicit blockers outside the track with names/status and does not invent dependencies', () => {
  const catalog = fixture([
    card('parent', null, { kind: 'hero', title: 'Footstep system' }),
    card('sound-task', 'started', { dependsOn: ['animation-task', 'missing'], parentId: 'parent' }),
    card('animation-task', 'review', { title: 'Walk animation', trackIds: ['animation'] }),
    card('inferred', 'not-started', { markdown: 'Blocked by animation-task' }),
    card('accepted', 'done', { dependsOn: ['missing'] }),
  ]);
  const summary = summarizeCatalog(catalog, 'sound');
  expect(summary.groups.blocked.cards.map(row => row.id)).toEqual(['sound-task']);
  expect(summary.dependencies).toMatchObject({ total: 2, truncated: false, cards: [
    { id: 'missing', title: null, state: null, missing: true },
    { id: 'animation-task', title: 'Walk animation', state: 'review', missing: false },
  ] });
  const row = summary.groups.doing.cards[0];
  expect(row).toMatchObject({ parent: { id: 'parent', title: 'Footstep system' }, deck: { id: 'audio', title: 'Audio tasks' }, dependencies: ['animation-task', 'missing'] });
  expect(row.ref).toBe(shortReference('c', row.id));
  expect(row.link).toBe(`/r/${row.ref}`);
});

it('marks ready only explicit iteration tasks with accepted prerequisites and a real iteration number', () => {
  const catalog = fixture([
    card('accepted', 'done', { trackIds: ['animation'] }), card('green', '✅', { trackIds: ['animation'] }),
    card('ready', 'in-iteration', { iteration: 7, dependsOn: ['accepted'] }),
    card('not-ready', 'in-iteration', { iteration: 7, dependsOn: ['green'] }),
    card('no-iteration', 'in-iteration'), card('planned', 'not-started', { dependsOn: ['accepted'] }),
  ]);
  const summary = summarizeCatalog(catalog, 'sound');
  expect(summary.groups.ready.cards.map(row => row.id)).toEqual(['ready']);
  expect(summary.groups.blocked.cards.map(row => row.id)).toEqual(['not-ready']);
  expect(summary.groups.planned.cards.map(row => row.id)).toEqual(['planned']);
  expect(summary.counts.taskStates).toContainEqual({ state: 'in-iteration', count: 3 });
});

it('limits each group independently while keeping totals, exact counts and truncation', () => {
  const catalog = fixture(Array.from({ length: 7 }, (_, index) => card(`task-${index}`, 'started', { dependsOn: [`missing-${index}`] })));
  const summary = summarizeCatalog(catalog, undefined, 2);
  expect(summary.counts.total).toBe(7);
  expect(summary.groups.doing).toMatchObject({ total: 7, truncated: true, cards: [expect.any(Object), expect.any(Object)] });
  expect(summary.groups.blocked.total).toBe(7);
  expect(summary.groups.blocked.cards).toHaveLength(2);
  expect(summary.dependencies.total).toBe(7);
  expect(summary.dependencies.cards).toHaveLength(2);
  expect(summary.groups.planned).toEqual({ total: 0, truncated: false, cards: [] });
  expect(summarizeCatalog(catalog).groups.doing.cards).toHaveLength(5);
  expect(summarizeCatalog(catalog, undefined, 0).groups.doing).toEqual({ total: 7, truncated: true, cards: [] });
  for (const limit of [-1, 1.5, NaN, 101]) expect(() => summarizeCatalog(catalog, undefined, limit)).toThrow('summary limit');
});

it('excludes archived and deleted cards from every normal summary count and group', () => {
  const cards = (['task', 'hero', 'doc'] as const).flatMap(kind => [
    card(`${kind}-active`, kind === 'task' ? 'started' : null, { kind, owner: 'Kimi' }),
    card(`${kind}-archived`, 'started', { kind, owner: 'GLM', archived: true, dependsOn: ['missing'] }),
    card(`${kind}-deleted`, 'review', { kind, owner: 'GLM', deleted: true }),
  ]);
  for (const track of [undefined, 'sound']) {
    const summary = summarizeCatalog(fixture(cards), track);
    expect(summary.counts).toEqual({ total: 3, kind: { task: 1, hero: 1, doc: 1 }, taskStates: [{ state: 'started', count: 1 }], owners: [{ owner: 'Kimi', count: 1 }] });
    expect(summary.groups.doing.cards.map(item => item.id)).toEqual(['task-active']);
    expect(summary.groups.review.total).toBe(0);
    expect(summary.groups.blocked.total).toBe(0);
    expect(summary.dependencies.total).toBe(0);
  }
});

it('keeps new planning fields readable in compact summaries while leaving instructions out', () => {
  const source = card('active', 'started', { handMemberIds: ['kimi'], tags: ['audio'], bookmarked: true, run: 'r1', milestone: 'Demo', dueDate: '2026-11-20' });
  const row = summarizeCatalog(fixture([source])).groups.doing.cards[0];
  expect(row).toMatchObject({ handMemberIds: ['kimi'], tags: ['audio'], bookmarked: true, run: 'r1', milestone: 'Demo', dueDate: '2026-11-20' });
  expect(row).not.toHaveProperty('markdown');
  row.tags!.push('changed');
  expect(source.tags).toEqual(['audio']);
});

it('retains explicitly marked archived/deleted prerequisites as context for active tasks', () => {
  const summary = summarizeCatalog(fixture([
    card('active', 'in-iteration', { iteration: 1, dependsOn: ['archived', 'deleted'] }),
    card('archived', 'review', { archived: true, handMemberIds: ['kimi'] }),
    card('deleted', 'not-started', { deleted: true, tags: ['legacy'] }),
  ]));
  expect(summary.counts.total).toBe(1);
  expect(summary.groups.blocked.cards.map(item => item.id)).toEqual(['active']);
  expect(summary.groups.ready.total).toBe(0);
  expect(summary.dependencies.cards).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'archived', state: 'review', missing: false, archived: true, handMemberIds: ['kimi'] }),
    expect.objectContaining({ id: 'deleted', state: 'not-started', missing: false, deleted: true, tags: ['legacy'] }),
  ]));
});
