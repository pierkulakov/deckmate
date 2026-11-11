import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import VisionCardNode, { visionCardSize, type VisionCardView } from '../client/components/VisionCardNode.tsx';
import { buildCatalogLookups } from '../client/catalog-lookups.ts';
import { setLang } from '../client/i18n.ts';
import type { CatalogCard, CatalogView } from '../src/catalog-contracts.ts';

vi.hoisted(() => { vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' }); });
beforeEach(() => {
  vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
  setLang('ru');
});
afterEach(() => vi.unstubAllGlobals());

const base: CatalogCard = { id: 'one', title: 'Имя карточки', kind: 'task', state: 'not-started', owner: null,
  path: 'cards/one.md', version: null, markdown: '', sourceHash: 'one', range: null, deckId: null, parentId: null, trackIds: [] };
function render(card: CatalogCard, view: VisionCardView) {
  const catalog = { cards: [card, { ...base, id: 'dependency' }], decks: [], members: [], projectTags: [{ name: 'world', color: '#687e9c', emoji: '🌍' }] } as unknown as CatalogView;
  return renderToStaticMarkup(<VisionCardNode card={card} cardId={card.id} view={view} catalog={catalog}
    lookups={buildCatalogLookups(catalog.cards)} interactive onOpen={() => {}} />);
}

it.each(['lane', 'mini', 'full'] as const)('%s shares attention and due text, preserving zero effort', view => {
  const html = render({ ...base, effort: 0, dependsOn: ['dependency'], dueDate: '2020-01-01', tags: ['world'] }, view);
  expect(html).toContain('Ждёт 1');
  expect(html).toContain('Просрочено');
  expect(html).toContain('Оценка: 0');
  expect(html).not.toContain('card-title-tags');
  expect(html).toContain('card-tag-emoji');
  expect(html).not.toContain('status-badge');
  if (view !== 'lane') {
    expect(html).toContain('class="card-metrics-effort"');
    expect(html).toContain('class="effort-icon"');
    expect(html).toContain('<span aria-hidden="true">0</span>');
  }
});

it.each(['lane', 'mini', 'full'] as const)('%s shows one marked tag and leaves overflow outside the card opener', view => {
  const html = render({ ...base, tags: ['world', 'Очень длинный русский тег', 'third'] }, view);
  expect(html).toContain('card-tags is-bounded');
  expect(html.match(/class="tag-badge-name"/gu)).toHaveLength(1);
  expect(html).toContain('card-tag-emoji');
  expect(html).toContain('+2');
  expect(html).toMatch(/class="deckmate-card-opener"[^>]*><\/button>/u);
  expect(html).toContain('Очень длинный русский тег');
});

it.each(['lane', 'mini', 'full'] as const)('%s does not invent an empty Hero or Doc state', view => {
  for (const kind of ['hero', 'doc'] as const) {
    const html = render({ ...base, kind, state: null }, view);
    expect(html).not.toContain('Без статуса');
    expect(html).not.toContain('Не начата');
  }
});

it.each(['mini', 'full'] as const)('%s turns the footer of a started or review Task into the state band', view => {
  const started = render({ ...base, state: 'started' }, view);
  expect(started).toContain('data-state="started"');
  expect(started).toContain('is-state-band');
  expect(started).toContain('В работе');
  // The band says the state, as on the tile face: the meta rows keep only blockers, questions and due dates.
  expect(started).not.toContain('card-face-state');
  const review = render({ ...base, state: 'review' }, view);
  expect(review).toContain('data-state="review"');
  expect(review).toContain('is-state-band');
  expect(review).toContain('Приёмка');
  expect(review).not.toContain('card-face-state');
  const idle = render({ ...base, state: 'not-started' }, view);
  expect(idle).not.toContain('is-state-band');
  expect(idle).toContain('Не начата');
});

it('keeps the one-line lane view free of the state band', () => {
  const lane = render({ ...base, state: 'started' }, 'lane');
  expect(lane).not.toContain('is-state-band');
  expect(lane).toContain('В работе');
});

it('keeps all established canvas footprints', () => {
  expect(visionCardSize).toEqual({ lane: { width: 280, height: 44 }, mini: { width: 280, height: 110 }, full: { width: 300, height: 230 } });
});

it.each(['en', 'ru'] as const)('%s: mini and full share the tile Hero total and Doc has no metrics', lang => {
  setLang(lang);
  const hero = { ...base, id: 'hero', kind: 'hero', effort: 0.125 } as CatalogCard;
  const catalog = { cards: [hero,
    { ...base, id: 'estimated', parentId: hero.id, effort: 3 },
    { ...base, id: 'unknown', parentId: hero.id, effort: null },
    { ...base, id: 'zero', parentId: hero.id, effort: 0 },
    { ...base, id: 'archived', parentId: hero.id, effort: 99, archived: true },
    { ...base, id: 'deleted', parentId: hero.id, effort: 99, deleted: true },
    { ...base, id: 'doc', kind: 'doc', parentId: hero.id, effort: 99 },
  ], decks: [], members: [] } as unknown as CatalogView;
  const lookups = buildCatalogLookups(catalog.cards);
  for (const view of ['mini', 'full'] as const) {
    const html = renderToStaticMarkup(<VisionCardNode card={hero} cardId={hero.id} view={view} catalog={catalog} lookups={lookups} interactive onOpen={() => {}} />);
    expect(html).toContain(lang === 'en' ? 'Effort: own and Sub Cards — 4.125' : 'Оценка: своя и Sub Cards — 4,125');
    expect(html).toContain('class="effort-icon"');
    const doc = render({ ...base, kind: 'doc', effort: 5, priority: 'high' }, view);
    expect(doc).not.toContain('card-metrics');
    expect(doc).not.toContain('Приоритет:');
    expect(doc).not.toContain('Effort:');
  }
});

it('full excerpts reuse Markdown text extraction and hide only the matching service step link', () => {
  const markdown = '# Goal\n\n**Readable** [link](https://example.com).\n\n- [x] Done\n- [ ] Next\n\n```ts\nsecret code\n```\n\n---\n\nJourney step: [build](../tasks/journeys/journey/steps/build.md)\n';
  const html = render({ ...base, markdown, journey: { journeyId: 'journey', stepId: 'build', instanceId: 'instance', version: 1 } }, 'full');
  expect(html).toContain('Goal Readable link. Done Next');
  for (const noise of ['[x]', '[ ]', '---', 'Journey step:', 'secret code', '**Readable**']) expect(html).not.toContain(noise);
  expect(render({ ...base, markdown }, 'full')).toContain('Journey step: build');
});
