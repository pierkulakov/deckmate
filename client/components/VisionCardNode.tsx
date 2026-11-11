// Live card nodes keep Vision boards linked to catalog data.
// The node is an Excalidraw embeddable; Excalidraw positions and scales this content with pan/zoom.
// The figure redraws from the catalog on every revision, so the title, state and owner are always live.
import { ArrowUpRight } from 'lucide-react';
import { useMemo } from 'react';
import type { CardPriority, CatalogCard, CatalogView } from '../../src/catalog-contracts.ts';
import { CardFaceStatus, cardFaceStatus } from './CardIndicators.tsx';
import { CardTags } from './CardTags.tsx';
import { CardMetrics, cardMetricsOf } from './CardMetrics.tsx';
import { docExcerpt } from '../doc-excerpt.ts';
import { splitJourneyStepLink } from './journey-step-link.ts';
import type { CardTileLookups } from '../card-tile-equality.ts';
import { defineText, formatNumber, textNow, useLang, useText } from '../i18n.ts';
import { kindLabel, priorityLabel, stateLabel } from '../locales/common.ts';

const text = defineText({
  missing: 'Card not found',
  openCard: (title: string) => `Open card ${title}`,
  open: 'Open',
  iteration: (iteration: string) => `Iteration ${iteration}`,
  priorityValue: (priority: CardPriority) => `Priority: ${priorityLabel(priority, 'en')}`,
  lane: 'Card lane',
  mini: 'Mini Card',
  full: 'Full Card',
}, {
  missing: 'Карточка не найдена',
  openCard: (title: string) => `Открыть карточку ${title}`,
  open: 'Открыть',
  iteration: (iteration: string) => `Итерация ${iteration}`,
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
  const excerpt = useMemo(() => card && view === 'full'
    ? docExcerpt(splitJourneyStepLink(card.markdown, card.journey).body, card.id.startsWith('doc:')).map(block => block.text).join(' ')
    : '', [card, view]);
  const pointerEvents = interactive ? 'auto' : 'none';
  if (!card) {
    return <div className="deckmate-vision-card is-missing" style={{ pointerEvents }}>
      <span>{t.missing}</span><code>{cardId}</code>
    </div>;
  }
  const owner = memberLabel(catalog, card.owner);
  const deck = card.deckId ? catalog?.decks.find(candidate => candidate.id === card.deckId) : undefined;
  const status = cardFaceStatus(card, lookups, lang);
  // 2026-11-11: a Task in progress or on review carries the same state metal as the tile and Hand bands, so the two
  // boards read one card state the same way. The band takes the node's existing footer row; the sizes stay documented.
  const stateBand = card.kind === 'task' && (card.state === 'started' || card.state === 'review') ? card.state : null;
  const description = [kindLabel(card.kind, lang), status.accessible, owner, cardMetricsOf(card, lookups, lang).effortLabel, card.kind !== 'doc' && card.priority ? t.priorityValue(card.priority) : '', ...(card.tags ?? [])].filter(Boolean).join(', ');
  return <div className={`deckmate-vision-card is-${view} kind-${card.kind}`} data-state={card.state ?? undefined} style={{ pointerEvents }} onClick={event => {
    const target = event.target;
    if (!interactive || !(target instanceof Element) || !event.currentTarget.contains(target)) return;
    const control = target.closest('button, a, [role="button"]');
    if (control && event.currentTarget.contains(control)) return;
    onOpen(cardId);
  }}>
    <button type="button" className="deckmate-card-opener" tabIndex={interactive ? 0 : -1} disabled={!interactive}
      aria-label={`${interactive ? t.openCard(card.title) : card.title}, ${description}`} onClick={() => onOpen(cardId)}
      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation(); }} />
    {view === 'lane' && <>
      <span className="deckmate-card-kind" aria-hidden="true">{kindLabel(card.kind, lang)}</span>
      <span className="vision-lane-main"><strong className="deckmate-card-title" title={card.title}>{card.title}</strong>
        <span className="deckmate-card-meta">{owner && <span className="deckmate-card-owner" title={owner}>{owner}</span>}<CardTags tags={card.tags} definitions={catalog?.projectTags} compact maxVisible={1} disabled={!interactive} /></span></span>
      <CardMetrics card={card} lookups={lookups} showEffort={false} className="vision-card-priority-icon" /><CardFaceStatus status={status} />
    </>}
    {view === 'mini' && <>
      <div className="deckmate-card-head">
        <span className="deckmate-card-kind" aria-hidden="true">{kindLabel(card.kind, lang)}</span>
        <strong className="deckmate-card-title" title={card.title}>{card.title}</strong>
      </div>
      <div className="deckmate-card-meta">
        <CardFaceStatus status={status} hideWorkflow />
      </div>
      <div className={'deckmate-card-meta deckmate-card-foot' + (stateBand ? ' is-state-band' : '')}>
        {stateBand && <span className="deckmate-card-state-word">{stateLabel(stateBand, lang)}</span>}
        {owner && <span className="deckmate-card-owner" title={owner}>{owner}</span>}
        <CardMetrics card={card} lookups={lookups} className="vision-card-priority-icon" />
        <CardTags tags={card.tags} definitions={catalog?.projectTags} compact maxVisible={1} disabled={!interactive} />
      </div>
    </>}
    {view === 'full' && <>
      <div className="deckmate-card-head">
        <span className="deckmate-card-kind" aria-hidden="true">{kindLabel(card.kind, lang)}</span>
        <strong className="deckmate-card-title" title={card.title}>{card.title}</strong>
        {interactive && <span className="deckmate-card-open"><ArrowUpRight size={12} />{t.open}</span>}
      </div>
      <div className="deckmate-card-meta">
        <CardFaceStatus status={status} hideWorkflow />
        {deck && <span className="deckmate-card-deck" title={deck.title}>{deck.title}</span>}
        {owner && <span className="deckmate-card-owner" title={owner}>{owner}</span>}
      </div>
      {excerpt && <p className="deckmate-card-excerpt">{excerpt}</p>}
      <CardTags tags={card.tags} definitions={catalog?.projectTags} compact maxVisible={1} disabled={!interactive} />
      <div className={'deckmate-card-properties' + (stateBand ? ' is-state-band' : '')}>
        {stateBand && <span className="deckmate-card-state-word">{stateLabel(stateBand, lang)}</span>}
        <CardMetrics card={card} lookups={lookups} className="vision-card-priority-icon" />
        {card.iteration != null && <span>{t.iteration(formatNumber(card.iteration, 0, lang))}</span>}
      </div>
    </>}
  </div>;
}
