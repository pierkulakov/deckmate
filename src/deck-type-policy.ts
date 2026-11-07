import { deckAcceptsCard, type CatalogCard, type CatalogJourney, type DeckKind } from './catalog-contracts.ts';
import { defaultLang, defineText, type Lang } from './i18n.ts';

const text = defineText({
  incompatibleCards: (kind: DeckKind, count: number) => {
    const noun = new Intl.PluralRules('en-US').select(count) === 'one' ? 'Card' : 'Cards';
    return `Type ${kind} does not accept ${new Intl.NumberFormat('en-US').format(count)} ${noun} in this Deck, including Archive and Trash. Move incompatible Cards first.`;
  },
  journeyTemplate: 'A Deck with a Journey template must use Asset or Mixed.',
  journeySteps: 'Journey steps target this Deck: use Task or Mixed.',
}, {
  incompatibleCards: (kind: DeckKind, count: number) => `Тип ${kind} не принимает ${count} карт этой колоды, включая Archive и Trash. Сначала перенесите несовместимые карты.`,
  journeyTemplate: 'Колода с шаблоном Journey должна иметь тип Asset или Mixed.',
  journeySteps: 'В эту колоду направлены шаги Journey: нужен тип Task или Mixed.',
});

/** 2026-11-03: Shared UI/server policy includes inactive cards so restoration stays valid. */
export function deckTypeChangeIssue(deckId: string, kind: DeckKind, cards: readonly CatalogCard[], journeys: readonly CatalogJourney[], lang: Lang = defaultLang): string | null {
  const incompatible = cards.filter(card => card.deckId === deckId && !deckAcceptsCard(kind, card.kind));
  if (incompatible.length) return text[lang].incompatibleCards(kind, incompatible.length);
  if (!['asset', 'mixed'].includes(kind) && journeys.some(journey => journey.deckId === deckId)) return text[lang].journeyTemplate;
  if (!['task', 'mixed'].includes(kind) && journeys.some(journey => journey.steps.some(step => step.deckId === deckId))) return text[lang].journeySteps;
  return null;
}
