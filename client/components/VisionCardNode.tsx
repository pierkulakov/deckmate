// Live card nodes keep Vision boards linked to catalog data.
// The node is an Excalidraw embeddable; Excalidraw positions and scales this content with pan/zoom.
// The figure redraws from the catalog on every revision, so the title, state and owner are always live.
import { ArrowUpRight } from 'lucide-react';
import type { CardPriority, CatalogCard, CatalogView } from '../../src/catalog-contracts.ts';
import { StatusBadge } from './StatusMenu.tsx';
import { CardTags, TagTitlePrefix } from './CardTags.tsx';
import { defineText, locale, textNow, useLang, useText } from '../i18n.ts';
import { kindLabel, priorityLabel } from '../locales/common.ts';

const text = defineText({
  missing: 'Card not found',
  openCard: (title: string) => `Open card ${title}`,
  noState: 'No status',
  open: 'Open',
  iteration: (iteration: string) => `Iteration ${iteration}`,
  effort: 'Effort',
  effortValue: (effort: string) => `Effort: ${effort}`,
  priorityValue: (priority: CardPriority) => `Priority: ${priorityLabel(priority, 'en')}`,
  lane: 'Card lane',
  mini: 'Mini Card',
  full: 'Full Card',
}, {
  missing: 'Карточка не найдена',
  openCard: (title: string) => `Открыть карточку ${title}`,
  noState: 'Без статуса',
  open: 'Открыть',
  iteration: (iteration: string) => `Итерация ${iteration}`,
  effort: 'Effort',
  effortValue: (effort: string) => `Effort: ${effort}`,
  priorityValue: (priority: CardPriority) => `Priority: ${priorityLabel(priority, 'ru')}`,
  lane: 'Строка карты',
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
  /** True while Excalidraw hands pointer events to the embeddable (activated by a click on the node center). */
  interactive: boolean;
  onOpen: (cardId: string) => void;
};

export default function VisionCardNode({ card, cardId, view, catalog, interactive, onOpen }: Props) {
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
  const openCard = () => { onOpen(cardId); };
  return <div className={`deckmate-vision-card is-${view} kind-${card.kind}`} style={{ pointerEvents }} onClick={openCard} role={interactive ? 'button' : undefined} tabIndex={interactive ? 0 : -1}
    aria-label={interactive ? t.openCard(card.title) : card.title} onKeyDown={event => { if (interactive && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openCard(); } }}>
    {view === 'lane' && <>
      <span className="deckmate-card-kind" aria-hidden="true">{kindLabel(card.kind, lang)}</span>
      <span className="vision-lane-main"><strong className="deckmate-card-title" title={card.title}><TagTitlePrefix tags={card.tags} definitions={catalog?.projectTags} />{card.title}</strong>
        <CardTags tags={card.tags} definitions={catalog?.projectTags} compact maxVisible={1} /></span>
      {card.state ? <StatusBadge state={card.state} /> : <span className="deckmate-card-muted">{t.noState}</span>}
      {owner && <span className="deckmate-card-owner" title={owner}>{owner}</span>}
    </>}
    {view === 'mini' && <>
      <div className="deckmate-card-head">
        <span className="deckmate-card-kind" aria-hidden="true">{kindLabel(card.kind, lang)}</span>
        <strong className="deckmate-card-title" title={card.title}><TagTitlePrefix tags={card.tags} definitions={catalog?.projectTags} />{card.title}</strong>
      </div>
      <div className="deckmate-card-meta">
        {card.state ? <StatusBadge state={card.state} /> : <span className="deckmate-card-muted">{t.noState}</span>}
        {owner && <span className="deckmate-card-owner" title={owner}>{owner}</span>}
        {card.effort != null && card.effort > 0 && <span className="deckmate-card-effort" title={t.effort}>{numbers.format(card.effort)}</span>}
      </div>
      <CardTags tags={card.tags} definitions={catalog?.projectTags} compact maxVisible={2} />
    </>}
    {view === 'full' && <>
      <div className="deckmate-card-head">
        <span className="deckmate-card-kind" aria-hidden="true">{kindLabel(card.kind, lang)}</span>
        <strong className="deckmate-card-title" title={card.title}><TagTitlePrefix tags={card.tags} definitions={catalog?.projectTags} />{card.title}</strong>
        {interactive && <span className="deckmate-card-open"><ArrowUpRight size={12} />{t.open}</span>}
      </div>
      <div className="deckmate-card-meta">
        {card.state ? <StatusBadge state={card.state} /> : <span className="deckmate-card-muted">{t.noState}</span>}
        {deck && <span className="deckmate-card-deck" title={deck.title}>{deck.title}</span>}
        {owner && <span className="deckmate-card-owner" title={owner}>{owner}</span>}
      </div>
      {textExcerpt(card.markdown) && <p className="deckmate-card-excerpt">{textExcerpt(card.markdown)}</p>}
      <CardTags tags={card.tags} definitions={catalog?.projectTags} compact maxVisible={2} />
      <div className="deckmate-card-properties">
        {card.priority && <span>{t.priorityValue(card.priority)}</span>}
        {card.effort != null && card.effort > 0 && <span>{t.effortValue(numbers.format(card.effort))}</span>}
        {card.iteration != null && <span>{t.iteration(numbers.format(card.iteration))}</span>}
      </div>
    </>}
  </div>;
}
