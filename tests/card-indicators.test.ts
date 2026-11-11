import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CatalogCard } from '../src/catalog-contracts.ts';
import { CardIndicators, cardFaceStatus } from '../client/components/CardIndicators.tsx';
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
    card: value, lookups: buildCatalogLookups([value]), members: [], variant: 'preview',
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
  expect(russian).toContain('Milestone: Релиз · 30.11.2026 · карточек: 1 · принято 0');
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

it('renders a translated Trash indicator even without planning metadata', () => {
  expect(renderCard(card())).toBe('');
  const deleted = card({ deleted: true });
  expect(renderCard(deleted)).toContain('class="card-indicator card-trash-indicator" role="img" title="In Trash" aria-label="In Trash"');
  setLang('ru');
  expect(renderCard(deleted)).toContain('title="В корзине" aria-label="В корзине"');
});

it('gives tiles one textual state and a nearby due date, leaving planning details in the preview', () => {
  const value = card({ state: 'review', dueDate: '2026-11-06', run: 'current', milestone: 'release', handMemberIds: ['maya'] });
  const lookups = buildCatalogLookups([value]);
  setLang('ru');
  const html = renderToStaticMarkup(createElement(CardIndicators, { card: value, lookups, members: [], variant: 'tile' }));
  expect(html).toContain('>Приёмка</span>');
  expect(html).toContain('>До 06.11</span>');
  expect(html).not.toContain('<svg');
  expect(html).not.toMatch(/card-(run|milestone|hand|gate)-indicator/);
  expect(renderCard(value)).toContain('card-run-indicator');
  expect(renderCard(value)).toContain('card-milestone-indicator');
  expect(renderCard(value)).toContain('card-hand-indicator');
});

it('keeps both blocking and overdue visible without changing the saved workflow', () => {
  const dependency = card({ id: 'card:dependency' });
  const value = card({ dependsOn: [dependency.id, dependency.id], dueDate: '2026-11-04' });
  const lookups = buildCatalogLookups([value, dependency]);
  const status = cardFaceStatus(value, lookups, 'ru', '2026-11-05');
  expect(status).toMatchObject({ label: 'Ждёт 1', due: 'Просрочено', urgent: true, attention: true });
  expect(status.accessible).toContain('Не начата');
  expect(status.accessible).toContain('04.11.2026');
  expect(value.state).toBe('not-started');
  for (const patch of [{ state: 'done' }, { archived: true }, { deleted: true }] as const) {
    const changed = { ...dependency, ...patch };
    expect(cardFaceStatus(value, buildCatalogLookups([value, changed]), 'ru').label).toBe('Не начата');
  }
});

it('hides distant and closed-task deadlines visually while retaining an active distant date in the accessible name', () => {
  const value = card({ dueDate: '2026-12-31' });
  const lookups = buildCatalogLookups([value]);
  expect(cardFaceStatus(value, lookups, 'en')).toMatchObject({ label: 'Not started', due: '' });
  expect(cardFaceStatus(value, lookups, 'en').accessible).toContain('12/31/2026');
  expect(cardFaceStatus({ ...value, dueDate: '2026-11-05' }, lookups, 'ru').due).toBe('Сегодня');
  for (const state of ['done', 'wont-do'] as const) expect(cardFaceStatus({ ...value, state, dueDate: '2026-11-04' }, lookups, 'ru').due).toBe('');
});

it.each([
  ['missing', null, 0], ['archived', { archived: true }, 0], ['deleted', { deleted: true }, 0],
  ['accepted', { state: 'done' }, 0], ['live', { state: 'started' }, 1], ['cancelled', { state: 'wont-do' }, 1],
] as const)('counts only open prerequisites in the gate (%s)', (_name, patch, open) => {
  const dependency = card({ id: 'card:dependency', ...patch });
  const value = card({ dependsOn: [dependency.id, dependency.id] });
  const lookups = buildCatalogLookups(patch ? [value, dependency] : [value]);
  for (const variant of ['table', 'preview'] as const) {
    const html = renderToStaticMarkup(createElement(CardIndicators, { card: value, lookups, members: [], variant }));
    expect(html).toContain(`incoming 1 (${open} open)`);
    expect(html.includes('card-gate-indicator is-blocked')).toBe(open > 0);
  }
  expect(cardFaceStatus(value, lookups).attention).toBe(open > 0);
});

it('uses supplied Hand positions instead of sparse sort keys and retains every member', () => {
  const value = card({ handMemberIds: ['maya', 'alex'], handOrder: { maya: 100, alex: 900 } });
  const members = ['maya', 'alex'].map(id => ({ id, label: id, kind: 'human' as const, aliases: [] }));
  const props = { card: value, lookups: buildCatalogLookups([value]), members, variant: 'preview' as const, currentMemberId: 'alex' };
  const html = renderToStaticMarkup(createElement(CardIndicators, { ...props, handPositions: { maya: 2, alex: 1 } }));
  expect(html).toContain('Hands: maya · slot 2; alex · slot 1');
  expect(html).toContain('<strong>1</strong>');
  const unknown = renderToStaticMarkup(createElement(CardIndicators, props));
  expect(unknown).toContain('Hands: maya; alex');
  expect(unknown).not.toContain('<strong>');
});
