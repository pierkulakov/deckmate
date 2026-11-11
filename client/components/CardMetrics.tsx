import type { CatalogCard } from '../../src/catalog-contracts.ts';
import { familyChildren } from '../catalog-lookups.ts';
import type { CardTileLookups } from '../card-tile-equality.ts';
import { currentLang, defineText, formatNumber, useLang, type Lang } from '../i18n.ts';
import { cardHeroEffort } from './CardQuickSettings.tsx';
import { EffortIcon } from './EffortIcon.tsx';
import { PriorityIcon } from './PriorityIcon.tsx';
import '../card-metrics.css';

const text = defineText({
  effort: (value: string) => `Effort: ${value}`,
  totalEffort: (value: string) => `Effort: own and Sub Cards — ${value}`,
}, {
  effort: (value: string) => `Оценка: ${value}`,
  totalEffort: (value: string) => `Оценка: своя и Sub Cards — ${value}`,
});

type MetricsLookups = Pick<CardTileLookups, 'childrenByParent'>;

export function cardMetricsOf(card: CatalogCard, lookups: MetricsLookups, lang: Lang = currentLang()) {
  if (card.kind === 'doc') return { effort: null, effortLabel: '' };
  const value = card.kind === 'hero' ? cardHeroEffort(card, { cards: familyChildren(lookups, card.id) }) : card.effort;
  const effort = value == null ? null : formatNumber(value, 20, lang);
  const label = card.kind === 'hero' ? text[lang].totalEffort : text[lang].effort;
  return { effort, effortLabel: effort === null ? '' : label(effort) };
}

export function CardMetrics({ card, lookups, showEffort = true, className = '' }: {
  card: CatalogCard;
  lookups: MetricsLookups;
  showEffort?: boolean;
  className?: string;
}) {
  const lang = useLang();
  if (card.kind === 'doc') return null;
  const { effort, effortLabel } = cardMetricsOf(card, lookups, lang);
  return <span className={`card-metrics${className ? ' ' + className : ''}`}>
    {showEffort && effort !== null && <span className="card-metrics-effort" role="img" title={effortLabel} aria-label={effortLabel}><span className="visually-hidden">{effortLabel}</span><EffortIcon size={16} /><span aria-hidden="true">{effort}</span></span>}
    <PriorityIcon priority={card.priority} size={16} />
  </span>;
}
