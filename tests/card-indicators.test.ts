import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CatalogCard } from '../src/catalog-contracts.ts';
import { CardFaceStatus, CardHandIndicator, CardIndicators, cardFaceStatus, cardHandStatus } from '../client/components/CardIndicators.tsx';
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
    card: value, lookups: buildCatalogLookups([value]), members: [], variant: 'table',
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

it('gives tiles a Hand mark without workflow text, leaving planning icons in table rows', () => {
  const value = card({ state: 'review', dueDate: '2026-11-06', run: 'current', milestone: 'release', handMemberIds: ['maya'] });
  const lookups = buildCatalogLookups([value]);
  setLang('ru');
  const html = renderToStaticMarkup(createElement(CardFaceStatus, { status: cardFaceStatus(value, lookups, 'ru'), hideWorkflow: true, hideDue: true }))
    + renderToStaticMarkup(createElement(CardHandIndicator, { hand: cardHandStatus(value, [], undefined, undefined, 'ru') }));
  expect(html).not.toContain('>Приёмка</span>');
  expect(html).not.toContain('06.11');
  expect(html).not.toContain('card-face-due');
  expect(html).toContain('card-hand-indicator');
  expect(html).not.toMatch(/card-(run|due|milestone|gate)-indicator/);
  expect(renderCard(value)).toContain('card-run-indicator');
  expect(renderCard(value)).toContain('card-milestone-indicator');
  expect(renderCard(value)).toContain('card-hand-indicator');
});

it('keeps both blocking and overdue visible without changing the saved workflow', () => {
  const dependency = card({ id: 'card:dependency' });
  const value = card({ dependsOn: [dependency.id, dependency.id], dueDate: '2026-11-04' });
  const lookups = buildCatalogLookups([value, dependency]);
  const status = cardFaceStatus(value, lookups, 'ru', '2026-11-05');
  expect(status).toMatchObject({ label: 'Заблокирована', due: 'Просрочено', urgent: true, attention: true });
  expect(status.accessible).toContain('Не начата');
  expect(status.accessible).toContain('Ждёт 1');
  expect(status.accessible).not.toContain('04.11.2026');
  expect(value.state).toBe('not-started');
  for (const patch of [{ state: 'done' }, { archived: true }, { deleted: true }] as const) {
    const changed = { ...dependency, ...patch };
    expect(cardFaceStatus(value, buildCatalogLookups([value, changed]), 'ru').label).toBe('');
  }
});

it('keeps dates off tiles, including today and soon, and hides overdue attention for closed tasks', () => {
  const value = card({ dueDate: '2026-12-31' });
  const lookups = buildCatalogLookups([value]);
  expect(cardFaceStatus(value, lookups, 'en')).toMatchObject({ label: '', due: '', workflow: 'Not started' });
  expect(cardFaceStatus(value, lookups, 'en').accessible).not.toContain('12/31/2026');
  for (const dueDate of ['2026-11-05', '2026-11-06', '2026-12-31']) {
    expect(cardFaceStatus({ ...value, dueDate }, lookups, 'ru').due).toBe('');
  }
  for (const state of ['done', 'wont-do'] as const) expect(cardFaceStatus({ ...value, state, dueDate: '2026-11-04' }, lookups, 'ru').due).toBe('');
});

it.each([
  ['missing', null, 0], ['archived', { archived: true }, 0], ['deleted', { deleted: true }, 0],
  ['accepted', { state: 'done' }, 0], ['live', { state: 'started' }, 1], ['cancelled', { state: 'wont-do' }, 1],
] as const)('counts only open prerequisites in the gate (%s)', (_name, patch, open) => {
  const dependency = card({ id: 'card:dependency', ...patch });
  const value = card({ dependsOn: [dependency.id, dependency.id] });
  const lookups = buildCatalogLookups(patch ? [value, dependency] : [value]);
  const html = renderToStaticMarkup(createElement(CardIndicators, { card: value, lookups, members: [], variant: 'table' }));
  expect(html).toContain(`incoming 1 (${open} open)`);
  expect(html.includes('card-gate-indicator is-blocked')).toBe(open > 0);
  expect(cardFaceStatus(value, lookups).attention).toBe(open > 0);
});

it('uses supplied Hand positions instead of sparse sort keys and retains every member', () => {
  const value = card({ handMemberIds: ['maya', 'alex'], handOrder: { maya: 100, alex: 900 } });
  const members = ['maya', 'alex'].map(id => ({ id, label: id, kind: 'human' as const, aliases: [] }));
  const props = { card: value, lookups: buildCatalogLookups([value]), members, variant: 'table' as const, currentMemberId: 'alex' };
  const html = renderToStaticMarkup(createElement(CardIndicators, { ...props, handPositions: { maya: 2, alex: 1 } }));
  expect(html).toContain('Hands: maya · slot 2; alex · slot 1');
  expect(html).toContain('<strong class="card-hand-number">1</strong>');
  const unknown = renderToStaticMarkup(createElement(CardIndicators, props));
  expect(unknown).toContain('Hands: maya; alex');
  expect(unknown).not.toContain('card-hand-number');
});

it('chooses the viewer, then the owner alias, then the earliest Hand and names its slot', () => {
  const members = ['maya', 'alex', 'leo'].map(id => ({ id, label: id, kind: 'human' as const, aliases: [id + '-alias'] }));
  const value = card({ owner: 'alex-alias', handMemberIds: ['maya', 'alex'], handOrder: { maya: 100, alex: 900 } });
  const positions = { maya: 3, alex: 5 };
  expect(cardHandStatus(value, members, 'maya', positions, 'ru')).toMatchObject({ mine: true, slot: 3, accessible: 'В Hand у maya, слот 3; В Hand у alex, слот 5' });
  expect(cardHandStatus(value, members, 'leo', positions, 'ru')).toMatchObject({ mine: false, slot: 5, accessible: 'В Hand у alex, слот 5; В Hand у maya, слот 3' });
  expect(cardHandStatus({ ...value, owner: null }, members, 'leo', positions)?.slot).toBe(3);
  expect(cardHandStatus({ ...value, handMemberIds: [] }, members)).toBeNull();
  const html = renderToStaticMarkup(createElement(CardHandIndicator, { hand: cardHandStatus(value, members, 'maya', positions) }));
  expect(html).toContain('card-hand-indicator is-mine');
  expect(html).toContain('fill="currentColor"');
});

it.each([1, 2, 3, 4, 5, 6, 7, 12])('keeps Hand slot %s outside the glyph and distinguishes ownership without color', slot => {
  const value = card({ handMemberIds: ['maya'] });
  const members = ['maya', 'alex'].map(id => ({ id, label: id, kind: 'human' as const, aliases: [] }));
  for (const variant of ['tile', 'table'] as const) {
    for (const currentMemberId of ['maya', 'alex']) {
      const hand = cardHandStatus(value, members, currentMemberId, { maya: slot });
      const html = variant === 'tile' ? renderToStaticMarkup(createElement(CardHandIndicator, { hand }))
        : renderToStaticMarkup(createElement(CardIndicators, { card: value, lookups: buildCatalogLookups([value]),
          members, variant: 'table', currentMemberId, handPositions: { maya: slot } }));
      expect(html).toContain(`aria-label="In maya’s Hand, slot ${slot}"`);
      expect(html).toContain(`</svg><strong class="card-hand-number">${slot}</strong>`);
      expect(html.includes('fill="currentColor"')).toBe(currentMemberId === 'maya');
      expect(html).toContain('aria-hidden="true"');
    }
  }
});
