import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CatalogCard, CatalogView } from '../src/catalog-contracts.ts';
import { CardFamilyPanel, CardMetrics } from '../client/components/CardFamily.tsx';
import { setLang } from '../client/i18n.ts';

vi.hoisted(() => vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' }));
vi.mock('react-dom', async original => ({ ...await original<typeof import('react-dom')>(), createPortal: (children: unknown) => children }));
beforeEach(() => {
  vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
  vi.stubGlobal('window', Object.assign(new EventTarget(), { matchMedia: () => ({ matches: false }) }));
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
  setLang('ru');
});
afterEach(() => vi.unstubAllGlobals());

const hero: CatalogCard = { id: 'card:hero', kind: 'hero', title: 'Arena', path: 'cards/hero.md', version: null,
  state: null, owner: null, markdown: '', sourceHash: 'hash', range: null, deckId: 'work', trackIds: [], parentId: null };
const child = (id: string, fields: Partial<CatalogCard> = {}): CatalogCard => ({ ...hero, id: 'card:' + id, kind: 'task',
  title: id, state: 'not-started', parentId: hero.id, ...fields });
function render(children: CatalogCard[], extras: CatalogCard[] = [], parent: CatalogCard = hero, projectTags: CatalogView['projectTags'] = []) {
  const catalog: CatalogView = { rootIdentity: 'family', documents: [], cards: [parent, ...children, ...extras], spaces: [], projectTags,
    decks: [{ id: 'work', title: 'Work', kind: 'mixed', spaceId: 'space', description: '', color: '#446688', icon: 'box' }],
    tracks: [], warnings: [], formatLanguage: 'en', manifestHash: 'hash', optionsHash: 'hash', configured: true, indexedAt: '',
    members: [{ id: 'alex', label: 'Alex', kind: 'human', aliases: [] }] };
  return renderToStaticMarkup(<CardFamilyPanel hero={parent} card={parent} children={children} openedId={parent.id} catalog={catalog}
    disabled={false} writable onOpen={() => {}} onCreate={() => {}} onAttach={() => {}} />);
}

it('shows the actual open Hand slot, urgent date, questions and Task-only family progress', () => {
  const html = render([
    child('done', { state: 'done', handMemberIds: ['alex'], handOrder: { alex: 1 } }),
    child('working', { state: 'started', owner: 'Alex', effort: 5, priority: 'high', dueDate: '2000-01-01', handMemberIds: ['alex'], handOrder: { alex: 90 } }),
    child('doc', { kind: 'doc', state: null, openQuestions: [{ text: 'Which input?', taskRef: null }] }),
    child('hidden', { archived: true }),
  ], [child('earlier', { parentId: null, handMemberIds: ['alex'], handOrder: { alex: 40 } })]);
  expect(html).toContain('1 из 2 принято');
  expect(html).toContain('Hand: Alex · слот 2');
  expect(html).toContain('Просрочено');
  expect(html).toContain('Вопросов: 1');
  expect(html).not.toContain('слот 90');
});

it('uses the Hero total including its own effort and only active Task Sub Cards', () => {
  const html = render([
    child('estimated', { effort: 2 }),
    child('unset', { effort: null }),
    child('archived', { effort: 50, archived: true }),
    child('doc', { kind: 'doc', effort: 50 }),
  ], [], { ...hero, effort: 3 });
  const parent = html.slice(html.indexOf('card-family-row card-family-hero'), html.indexOf('card-family-subcards-slot'));
  expect(parent).toContain('aria-label="Оценка: 6"');
});

it('keeps glyphs in the title and bounds the remaining family tags without duplicating them', () => {
  const projectTags = [
    { name: 'emoji', color: '#687e9c', emoji: '🎵' },
    { name: 'icon', color: '#cc5c65', iconSvg: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/></svg>' },
    { name: 'цветной', color: '#cc5c65' },
  ];
  const tags = ['emoji', 'icon', 'цветной', 'Очень длинное название русского тега', 'third', 'fourth'];
  const html = render([child('tagged', { tags }), child('glyph-only', { tags: ['emoji', 'icon'] })], [], { ...hero, tags }, projectTags);
  const rows = [...html.matchAll(/<div class="card-family-row-tags">([\s\S]*?)<\/div>/gu)].map(match => match[1]);
  expect(rows).toHaveLength(2);
  for (const row of rows) {
    expect(row).toContain('цветной');
    expect(row).toContain('Очень длинное название русского тега');
    expect(row).toContain('+2');
    expect(row).not.toContain('emoji');
    expect(row).not.toContain('icon');
  }
  expect(html).toContain('🎵');
  expect(html).toContain('card-tag-icon');
});

it('keeps blocked status and a useful empty family without invented metadata', () => {
  const blocked = render([child('blocked', { dependsOn: ['card:missing'] })]);
  expect(blocked).toContain('Заблокирована');
  expect(blocked).toContain('card:missing');
  const empty = render([]);
  expect(empty).toContain('Создайте Sub Card');
  expect(empty).not.toContain('>—<');
  expect(empty).not.toContain('0 из 0');
});

it('shows distinct, labelled priority icons for every compact family row, including unset', () => {
  setLang('en');
  const priorities = ['high', 'medium', 'low', null] as const;
  const icons = priorities.map(priority => {
    const html = renderToStaticMarkup(<CardMetrics card={child('task', { priority, effort: 0 })} compact showOwner={false} />);
    expect(html).toContain(priority ? `aria-label="Priority: ${priority[0].toUpperCase() + priority.slice(1)}"` : 'aria-label="No priority"');
    expect(html).toContain('aria-label="Effort: 0"');
    const svgs = [...html.matchAll(/<svg\b[^>]*>[\s\S]*?<\/svg>/gu)].map(match => match[0]);
    expect(svgs).toHaveLength(2);
    expect(svgs.every(svg => svg.includes('width="16"'))).toBe(true);
    expect(svgs[0]).toContain('fill="currentColor"');
    expect(svgs[1]).toContain('stroke-width="2"');
    return svgs[1];
  });
  expect(new Set(icons).size).toBe(priorities.length);
});
