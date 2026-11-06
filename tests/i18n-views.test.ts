import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogDeck, CatalogView } from '../src/catalog-contracts.ts';

vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
vi.stubGlobal('window', { dispatchEvent: () => true, addEventListener: () => undefined, removeEventListener: () => undefined });

const { setLang } = await import('../client/i18n.ts');
const { journeyStepLabel } = await import('../client/components/JourneyMiniCard.tsx');
const { draftError, journeyDraft, sameDraft } = await import('../client/components/JourneyDraft.tsx');
const { formatJourneyDuration } = await import('../client/components/JourneyMetrics.tsx');
const { parseSearch } = await import('../client/search-query.ts');

const deck = { id: 'deck:one', title: 'Deck' } as CatalogDeck;
const catalog = { decks: [deck], cards: [], members: [] } as unknown as CatalogView;

beforeEach(() => setLang('en'));
afterAll(() => vi.unstubAllGlobals());

describe('part C interface language', () => {
  it('uses English by default and Russian after the switch for generated step labels', () => {
    expect(journeyStepLabel('')).toBe('New step');
    setLang('ru');
    expect(journeyStepLabel('')).toBe('Новый шаг');
  });

  it('localizes Journey validation while keeping persisted defaults stable across languages', () => {
    const initial = journeyDraft(null, deck, 'ru');
    expect(initial.zones[0]).toEqual({ id: 'default', title: 'Основные шаги' });
    expect(journeyDraft(null, deck, 'en').zones[0]).toEqual({ id: 'default', title: 'Main steps' });
    expect(draftError(journeyDraft(null, deck, 'ru'), catalog)).toBe('Add at least one step.');
    setLang('ru');
    expect(journeyDraft(null, deck, 'ru').zones[0]).toEqual({ id: 'default', title: 'Основные шаги' });
    expect(draftError(journeyDraft(null, deck, 'ru'), catalog)).toBe('Добавьте хотя бы один шаг.');
    expect(sameDraft(initial, journeyDraft(null, deck, 'ru'))).toBe(true);
  });

  it('formats Journey durations with the active locale', () => {
    expect(formatJourneyDuration(0.5)).toBe('<1 h');
    expect(formatJourneyDuration(2)).toBe('2 h');
    expect(formatJourneyDuration(36)).toBe('1.5 d');
    setLang('ru');
    expect(formatJourneyDuration(0.5)).toBe('<1 ч');
    expect(formatJourneyDuration(2)).toBe('2 ч');
    expect(formatJourneyDuration(36)).toBe('1,5 д');
  });

  it('keeps search operators and Russian state ids unchanged', () => {
    expect(parseSearch('!#tag @none state:принято')).toMatchObject([
      { kind: 'tag', value: 'tag', negated: true },
      { kind: 'owner', value: 'none', none: true, negated: false },
      { kind: 'state', value: 'принято', negated: false },
    ]);
  });
});
