import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CatalogCard } from '../src/catalog-contracts.ts';
import { CardIndicators } from '../client/components/CardIndicators.tsx';
import { buildCatalogLookups } from '../client/catalog-lookups.ts';
import { setLang } from '../client/i18n.ts';

vi.hoisted(() => {
  vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
});

beforeEach(() => {
  vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-05T12:00:00Z'));
  setLang('en');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function card(overrides: Partial<CatalogCard> = {}): CatalogCard {
  return {
    id: 'card:indicator', kind: 'task', title: 'Текст проекта', path: 'cards/indicator.md',
    version: null, state: 'not-started', owner: null, markdown: '', sourceHash: 'revision', range: null,
    deckId: null, trackIds: [], parentId: null, ...overrides,
  };
}

function renderCard(value: CatalogCard): string {
  return renderToStaticMarkup(createElement(CardIndicators, {
    card: value, lookups: buildCatalogLookups([value]), members: [], variant: 'tile',
    catalog: { runs: [], milestones: [{ id: 'release', title: 'Релиз', date: '2026-11-30', color: '#123456' }] },
  }));
}

it('switches tooltip dates and wording without changing card data', () => {
  const value = card({ dueDate: '2026-11-06', milestone: 'release' });
  const original = structuredClone(value);
  const english = renderCard(value);
  expect(english).toContain('aria-label="Card properties"');
  expect(english).toContain('Due: 11/06/2026 · 1 working day');
  expect(english).toContain('Milestone: Релиз · 11/30/2026 · 1 card · done 0');
  setLang('ru');
  const russian = renderCard(value);
  expect(russian).toContain('aria-label="Свойства карточки"');
  expect(russian).toContain('Срок: 06.11.2026 · 1 рабочих дней');
  expect(russian).toContain('Milestone: Релиз · 30.11.2026 · 1 карт · принято 0');
  expect(value).toEqual(original);
});

it('counts workdays across a weekend and uses the plural English form', () => {
  const html = renderCard(card({ dueDate: '2026-11-09' }));
  expect(html).toContain('Due: 11/09/2026 · 2 working days');
});

it('shows unknown registry IDs as data with translated explanations', () => {
  const value = card({ run: 'номер-проекта', milestone: 'веха-проекта' });
  expect(renderCard(value)).toContain('Run номер-проекта · not in registry');
  expect(renderCard(value)).toContain('Milestone веха-проекта · not in registry');
  setLang('ru');
  expect(renderCard(value)).toContain('Run номер-проекта · нет в реестре');
  expect(renderCard(value)).toContain('Milestone веха-проекта · нет в реестре');
});
