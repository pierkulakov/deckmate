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
  expect(html).not.toContain('card-tag-emoji');
  expect(html).not.toContain('status-badge');
  if (view !== 'lane') expect(html).toMatch(/>(?:Оц\. |Оценка: )0</u);
});

it.each(['lane', 'mini', 'full'] as const)('%s does not invent an empty Hero or Doc state', view => {
  for (const kind of ['hero', 'doc'] as const) {
    const html = render({ ...base, kind, state: null }, view);
    expect(html).not.toContain('Без статуса');
    expect(html).not.toContain('Не начата');
  }
});

it('keeps all established canvas footprints', () => {
  expect(visionCardSize).toEqual({ lane: { width: 280, height: 44 }, mini: { width: 280, height: 110 }, full: { width: 300, height: 230 } });
});
