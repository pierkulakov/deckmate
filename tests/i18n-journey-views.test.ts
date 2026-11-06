import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogDeck, CatalogJourney } from '../src/catalog-contracts.ts';

vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
vi.stubGlobal('window', { dispatchEvent: () => true, addEventListener: () => undefined, removeEventListener: () => undefined });

const { setLang } = await import('../client/i18n.ts');
const { journeyDraft, sameDraft } = await import('../client/components/JourneyDraft.tsx');
const { JourneyBulkActions } = await import('../client/components/JourneyBulkActions.tsx');
const { JourneyMiniCard } = await import('../client/components/JourneyMiniCard.tsx');

beforeEach(() => setLang('en'));
afterAll(() => vi.unstubAllGlobals());

describe('Journey language changes', () => {
  it('keeps the draft used to verify a created Journey stable across language changes', () => {
    const deck = { id: 'deck:one', title: 'Deck' } as CatalogDeck;
    const journey = { title: 'Journey', description: '', zones: [], steps: [] } as unknown as CatalogJourney;
    const creationAttempt = journeyDraft(journey, deck, 'ru');
    setLang('ru');
    expect(sameDraft(journeyDraft(journey, deck, 'ru'), creationAttempt)).toBe(true);
    expect(creationAttempt.zones).toEqual([{ id: 'default', title: 'Основные шаги' }]);
  });

  it('uses singular and plural selection labels in the rendered bulk toolbar', () => {
    const actions = { disabled: false, targets: [], onSelectAll() {}, onClear() {}, onChain() {}, onDuplicate() {}, onDelete() {} };
    const single = renderToStaticMarkup(createElement(JourneyBulkActions, { ...actions, count: 1, total: 1 }));
    const multiple = renderToStaticMarkup(createElement(JourneyBulkActions, { ...actions, count: 2, total: 2 }));
    expect(single).toContain('title="1 of 1 step selected"');
    expect(single).toContain('<span>1</span> step selected');
    expect(multiple).toContain('<span>2</span> steps selected');
  });

  it('formats Effort in the current locale without changing a step title', () => {
    const card = { title: 'Исходный заголовок', effort: 1000.25 };
    expect(renderToStaticMarkup(createElement(JourneyMiniCard, card))).toContain('Effort: 1,000.25');
    setLang('ru');
    const russian = renderToStaticMarkup(createElement(JourneyMiniCard, card));
    expect(russian).toContain('Effort: 1 000,25');
    expect(russian).toContain('Исходный заголовок');
  });
});
