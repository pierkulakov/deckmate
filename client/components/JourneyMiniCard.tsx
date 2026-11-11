import { Hourglass } from 'lucide-react';
import type { MouseEventHandler, ReactNode } from 'react';
import type { CardPriority } from '../../src/catalog-contracts.ts';
import { defineText, locale, textNow, useLang, useText } from '../i18n.ts';
import { PriorityIcon } from './PriorityIcon.tsx';
import { EffortIcon } from './EffortIcon.tsx';
import { journeyStepTitle } from './journey-step-title.ts';


const text = defineText({
  effort: (value: string) => `Effort: ${value}`,
  newStep: 'New step',
  taskCardInDeck: (deck: string) => `Task Card in deck “${deck}”`,
  noDeck: 'No deck selected',
}, {
  effort: (value: string) => `Оценка: ${value}`,
  newStep: 'Новый шаг',
  taskCardInDeck: (deck: string) => `Task Card в колоде «${deck}»`,
  noDeck: 'Колода не выбрана',
});

// %PARENT_TITLE% becomes the Hero Card title when the Journey starts; on step cards it reads as a short token.
export function journeyStepLabel(title: string) {
  return journeyStepTitle(title, '‹Hero›', textNow(text).newStep);
}

// The 115×146 step card uses a 14/17 title, a task hourglass and a purple effort/priority band.
// onClick passes Ctrl/Shift for bulk selection; callbacks without arguments remain compatible.
// The optional badge shows editor step metrics on the hourglass row.
export function JourneyMiniCard({ title, effort, priority, deckTitle, onClick, disabled, selected, badge }: {
  title: string; effort?: number | null; priority?: CardPriority | null; deckTitle?: string; onClick?: MouseEventHandler<HTMLButtonElement>; disabled?: boolean; selected?: boolean; badge?: ReactNode;
}) {
  const t = useText(text);
  const lang = useLang();
  const effortLabel = effort == null ? null : new Intl.NumberFormat(locale(lang), { maximumFractionDigits: 20 }).format(effort);
  const target = deckTitle === undefined ? null : deckTitle ? t.taskCardInDeck(deckTitle) : t.noDeck;
  const content = <>
    <strong>{journeyStepLabel(title)}</strong>
    {target && <span className="journey-mini-state" title={target}><Hourglass size={14} aria-hidden="true" /><span className="visually-hidden">{target}</span></span>}
    {badge}
    <span className="journey-mini-band">
      <span className="journey-mini-effort" title={t.effort(effortLabel ?? '—')}><EffortIcon size={14} /><b>{effortLabel ?? '-'}</b></span>
      <PriorityIcon priority={priority} size={15} />
    </span>
  </>;
  if (!onClick) return <div className="journey-mini">{content}</div>;
  return <button type="button" className="journey-mini" disabled={disabled} aria-pressed={selected} onClick={onClick}>{content}</button>;
}

// Layered sea under the step cards: back swell, two teal crests, dark ground.
export function JourneyWaves() {
  return <svg className="journey-waves" viewBox="0 0 1200 100" preserveAspectRatio="none" aria-hidden="true">
    <path className="journey-wave-back" d="M0 46 C70 30 130 8 210 14 S330 52 410 40 S520 6 610 10 S730 46 800 44 S930 4 1020 8 S1140 36 1200 30 V100 H0Z" />
    <path className="journey-wave-mid" d="M0 70 C90 50 160 38 250 52 S390 80 470 66 S600 44 690 60 S830 84 920 66 S1080 48 1200 60 V100 H0Z" />
    <path className="journey-wave-front" d="M0 78 C110 64 190 58 280 70 S430 90 520 80 S660 62 760 76 S900 94 990 82 S1120 66 1200 74 V100 H0Z" />
    <path className="journey-wave-ground" d="M0 90 C120 84 200 82 300 88 S470 96 560 92 S720 84 820 90 S1000 97 1080 92 S1170 88 1200 89 V100 H0Z" />
  </svg>;
}
