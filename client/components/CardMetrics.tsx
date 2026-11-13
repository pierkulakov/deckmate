import type { CatalogCard } from '../../src/catalog-contracts.ts';
import { MessageCircleQuestion } from 'lucide-react';
import { familyChildren } from '../catalog-lookups.ts';
import type { CardTileLookups } from '../card-tile-equality.ts';
import { countCatalogCardWords } from '../card-word-count.ts';
import { currentLang, defineText, formatNumber, useLang, type Lang } from '../i18n.ts';
import { cardHeroEffort } from './CardQuickSettings.tsx';
import { EffortIcon } from './EffortIcon.tsx';
import { PriorityIcon } from './PriorityIcon.tsx';
import '../card-metrics.css';

const text = defineText({
  effort: (value: string) => `Effort: ${value}`,
  totalEffort: (value: string) => `Effort: own and Sub Cards — ${value}`,
  openQuestions: (count: string) => `Open questions: ${count}`,
}, {
  effort: (value: string) => `Оценка: ${value}`,
  totalEffort: (value: string) => `Оценка: своя и Sub Cards — ${value}`,
  openQuestions: (count: string) => `Открытых вопросов: ${count}`,
});

const englishPlural = new Intl.PluralRules('en-US');
const russianPlural = new Intl.PluralRules('ru-RU');

// 2026-11-12: a Doc's volume on its material band. The short form keeps a thousands abbreviation; the exact count
// serves tooltips and menus. Numbers follow the interface language.
const docWords = defineText({
  exact: (count: number) => `${formatNumber(count, 0, 'en')} ${englishPlural.select(count) === 'one' ? 'word' : 'words'}`,
  short: (count: number) => `${formatNumber(count, 0, 'en')}w`,
  shortThousand: (value: string) => `${value}kw`,
}, {
  exact: (count: number) => {
    const rule = russianPlural.select(count);
    let unit = 'слов';
    if (rule === 'one') unit = 'слово';
    else if (rule === 'few') unit = 'слова';
    return `${formatNumber(count, 0, 'ru')} ${unit}`;
  },
  short: (count: number) => `${formatNumber(count, 0, 'ru')} сл.`,
  shortThousand: (value: string) => `${value} тыс. сл.`,
});

/** The full word count, for tooltips and menus. */
export function docWordsLabel(count: number, lang: Lang = currentLang()): string {
  return docWords[lang].exact(count);
}

/** The band's short volume: the exact number below a thousand, one decimal of thousands above. */
export function docWordsShortLabel(count: number, lang: Lang = currentLang()): string {
  const words = docWords[lang];
  return count < 1000 ? words.short(count) : words.shortThousand(formatNumber(count / 1000, 1, lang));
}

type MetricsLookups = Pick<CardTileLookups, 'childrenByParent'>;

export function OpenQuestionsBadge({ card, table = false }: { card: CatalogCard; table?: boolean }) {
  const lang = useLang();
  const count = table || (!card.archived && !card.deleted) ? card.openQuestions?.length ?? 0 : 0;
  if (!count) return null;
  const warnings = card.openQuestionWarnings ?? [];
  const label = text[lang].openQuestions(formatNumber(count, 0, lang));
  const title = label + (warnings.length ? '. ' + warnings.join(' ') : '');
  const visibleCount = !table && count > 99 ? '99+' : formatNumber(count, 0, lang);
  return <span className={table ? `catalog-card-open-questions${warnings.length ? ' has-warning' : ''}` : 'card-questions-metric'} role="img" title={title} aria-label={title}><MessageCircleQuestion size={14} aria-hidden="true" /><span aria-hidden="true">{visibleCount}</span></span>;
}

export function cardMetricsOf(card: CatalogCard, lookups: MetricsLookups, lang: Lang = currentLang()) {
  if (card.kind === 'doc') return { effort: null, effortLabel: '' };
  const value = card.kind === 'hero' ? cardHeroEffort(card, { cards: familyChildren(lookups, card.id) }) : card.effort;
  const effort = value == null ? null : formatNumber(value, 20, lang);
  const label = card.kind === 'hero' ? text[lang].totalEffort : text[lang].effort;
  return { effort, effortLabel: effort === null ? '' : label(effort) };
}

/** 2026-11-12: one Doc volume element for every material band — the tile, the open card, Hand and Vision. An empty document shows nothing. */
export function DocWordCount({ card, className = '' }: { card: Pick<CatalogCard, 'id' | 'sourceHash' | 'markdown'>; className?: string }) {
  const lang = useLang();
  // The helper caches by card revision, so the text is parsed once, not on every render.
  const count = countCatalogCardWords(card);
  if (!count) return null;
  const label = docWordsLabel(count, lang);
  return <span className={`doc-word-count${className ? ' ' + className : ''}`} role="img" aria-label={label} title={label}><span aria-hidden="true">{docWordsShortLabel(count, lang)}</span></span>;
}

export function CardMetrics({ card, lookups, showEffort = true, className = '' }: {
  card: CatalogCard;
  lookups: MetricsLookups;
  showEffort?: boolean;
  className?: string;
}) {
  const lang = useLang();
  // A Doc has no effort or priority; its one metric is the document's volume.
  if (card.kind === 'doc') {
    if (!card.openQuestions?.length || card.archived || card.deleted) return <DocWordCount card={card} className={className} />;
    return <span className={`card-metrics${className ? ' ' + className : ''}`}><OpenQuestionsBadge card={card} /><DocWordCount card={card} /></span>;
  }
  const { effort, effortLabel } = cardMetricsOf(card, lookups, lang);
  return <span className={`card-metrics${className ? ' ' + className : ''}`}>
    {showEffort && effort !== null && <span className="card-metrics-effort" role="img" title={effortLabel} aria-label={effortLabel}><span className="visually-hidden">{effortLabel}</span><EffortIcon size={16} /><span aria-hidden="true">{effort}</span></span>}
    <PriorityIcon priority={card.priority} size={16} />
  </span>;
}
