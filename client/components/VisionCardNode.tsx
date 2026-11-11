// Live card nodes keep Vision boards linked to catalog data.
// The node is an Excalidraw embeddable; Excalidraw positions and scales this content with pan/zoom.
// The figure redraws from the catalog on every revision, so the title, state and owner are always live.
import { ArrowUpRight } from 'lucide-react';
import type { CardPriority, CatalogCard, CatalogView } from '../../src/catalog-contracts.ts';
import { CardFaceStatus, cardFaceStatus } from './CardIndicators.tsx';
import { CardTagSummary } from './CardTags.tsx';
import type { CardTileLookups } from '../card-tile-equality.ts';
import { defineText, locale, textNow, useLang, useText } from '../i18n.ts';
import { kindLabel, priorityLabel } from '../locales/common.ts';

const text = defineText({
  missing: 'Card not found',
  openCard: (title: string) => `Open card ${title}`,
  open: 'Open',
  iteration: (iteration: string) => `Iteration ${iteration}`,
  effortShort: (effort: string) => `Est. ${effort}`,
  effortValue: (effort: string) => `Effort: ${effort}`,
  priorityValue: (priority: CardPriority) => `Priority: ${priorityLabel(priority, 'en')}`,
  lane: 'Card lane',
  mini: 'Mini Card',
  full: 'Full Card',
}, {
  missing: 'Карточка не найдена',
  openCard: (title: string) => `Открыть карточку ${title}`,
  open: 'Открыть',
  iteration: (iteration: string) => `Итерация ${iteration}`,
  effortShort: (effort: string) => `Оц. ${effort}`,
  effortValue: (effort: string) => `Оценка: ${effort}`,
  priorityValue: (priority: CardPriority) => `Приоритет: ${priorityLabel(priority, 'ru')}`,
  lane: 'Строка карточки',
  mini: 'Мини-карточка',
  full: 'Полная карточка',
});

export type VisionCardView = 'lane' | 'mini' | 'full';
export const visionCardViewOptions: { id: VisionCardView; title: string }[] = [
  { id: 'lane', get title() { return textNow(text).lane; } },
  { id: 'mini', get title() { return textNow(text).mini; } },
  { id: 'full', get title() { return textNow(text).full; } },
];
// Mini keeps the documented node size 280×110; Lane is the compact one-line view, Full shows the description.
export const visionCardSize: Record<VisionCardView, { width: number; height: number }> = {
  lane: { width: 280, height: 44 },
  mini: { width: 280, height: 110 },
  full: { width: 300, height: 230 },
};

export function visionCardViewOf(value: unknown): VisionCardView {
  return value === 'lane' || value === 'full' ? value : 'mini';
}

function memberLabel(catalog: CatalogView | null, ownerId: string | null | undefined): string | null {
  if (!ownerId) return null;
  return catalog?.members?.find(member => member.id === ownerId)?.label ?? ownerId;
}

/** Plain-text excerpt of the card Markdown for the Full view; the Markdown file stays the source of truth. */
function textExcerpt(markdown: string, limit = 300): string {
  const plain = markdown
    .replace(/```[\s\S]*?```/gu, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/[#>*_`|]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  return plain.length > limit ? `${plain.slice(0, limit).trimEnd()}…` : plain;
}

type Props = {
  card: CatalogCard | undefined;
  cardId: string;
  view: VisionCardView;
  catalog: CatalogView | null;
  lookups: CardTileLookups;
  /** True while Excalidraw hands pointer events to the embeddable (activated by a click on the node center). */
  interactive: boolean;
  onOpen: (cardId: string) => void;
};

export default function VisionCardNode({ card, cardId, view, catalog, lookups, interactive, onOpen }: Props) {
  const t = useText(text);
  const lang = useLang();
  const numbers = new Intl.NumberFormat(locale(lang));
  const pointerEvents = interactive ? 'auto' : 'none';
  if (!card) {
    return <div className="deckmate-vision-card is-missing" style={{ pointerEvents }}>
      <span>{t.missing}</span><code>{cardId}</code>
    </div>;
  }
  const owner = memberLabel(catalog, card.owner);
  const deck = card.deckId ? catalog?.decks.find(candidate => candidate.id === card.deckId) : undefined;
  const status = cardFaceStatus(card, lookups, lang);
  const description = [kindLabel(card.kind, lang), status.accessible, owner, card.effort != null ? t.effortValue(numbers.format(card.effort)) : '', ...(card.tags ?? [])].filter(Boolean).join(', ');
  const openCard = () => { onOpen(cardId); };
  return <div className={`deckmate-vision-card is-${view} kind-${card.kind}`} style={{ pointerEvents }} onClick={openCard} role={interactive ? 'button' : undefined} tabIndex={interactive ? 0 : -1}
    aria-label={`${interactive ? t.openCard(card.title) : card.title}, ${description}`} onKeyDown={event => { if (interactive && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); event.stopPropagation(); openCard(); } }}>
    {view === 'lane' && <>
      <span className="deckmate-card-kind" aria-hidden="true">{kindLabel(card.kind, lang)}</span>
      <span className="vision-lane-main"><strong className="deckmate-card-title" title={card.title}>{card.title}</strong>
        <span className="deckmate-card-meta">{owner && <span className="deckmate-card-owner" title={owner}>{owner}</span>}<CardTagSummary tags={card.tags} definitions={catalog?.projectTags} /></span></span>
      <CardFaceStatus status={status} />
    </>}
    {view === 'mini' && <>
      <div className="deckmate-card-head">
        <span className="deckmate-card-kind" aria-hidden="true">{kindLabel(card.kind, lang)}</span>
        <strong className="deckmate-card-title" title={card.title}>{card.title}</strong>
      </div>
      <div className="deckmate-card-meta">
        <CardFaceStatus status={status} />
      </div>
      <div className="deckmate-card-meta">
        {owner && <span className="deckmate-card-owner" title={owner}>{owner}</span>}
        {card.effort != null && <span className="deckmate-card-effort" title={t.effortValue(numbers.format(card.effort))}>{t.effortShort(numbers.format(card.effort))}</span>}
        <CardTagSummary tags={card.tags} definitions={catalog?.projectTags} />
      </div>
    </>}
    {view === 'full' && <>
      <div className="deckmate-card-head">
        <span className="deckmate-card-kind" aria-hidden="true">{kindLabel(card.kind, lang)}</span>
        <strong className="deckmate-card-title" title={card.title}>{card.title}</strong>
        {interactive && <span className="deckmate-card-open"><ArrowUpRight size={12} />{t.open}</span>}
      </div>
      <div className="deckmate-card-meta">
        <CardFaceStatus status={status} />
        {deck && <span className="deckmate-card-deck" title={deck.title}>{deck.title}</span>}
        {owner && <span className="deckmate-card-owner" title={owner}>{owner}</span>}
      </div>
      {textExcerpt(card.markdown) && <p className="deckmate-card-excerpt">{textExcerpt(card.markdown)}</p>}
      <CardTagSummary tags={card.tags} definitions={catalog?.projectTags} />
      <div className="deckmate-card-properties">
        {card.priority && <span>{t.priorityValue(card.priority)}</span>}
        {card.effort != null && <span>{t.effortValue(numbers.format(card.effort))}</span>}
        {card.iteration != null && <span>{t.iteration(numbers.format(card.iteration))}</span>}
      </div>
    </>}
  </div>;
}
