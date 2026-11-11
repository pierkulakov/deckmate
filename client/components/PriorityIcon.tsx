import type { CardPriority } from '../../src/catalog-contracts.ts';
import { defineText, useText } from '../i18n.ts';
import { priorityLabel } from '../locales/common.ts';

const text = defineText({
  priority: (priority: CardPriority) => `Priority: ${priorityLabel(priority, 'en')}`,
  noPriority: 'No priority',
}, {
  priority: (priority: CardPriority) => `Приоритет: ${priorityLabel(priority, 'ru')}`,
  noPriority: 'Без приоритета',
});

const chevrons: Record<CardPriority, readonly number[]> = {
  low: [6.5], medium: [4.5, 8.5], high: [2.5, 6.5, 10.5],
};

export function PriorityIcon({ priority, size = 16 }: { priority?: CardPriority | null; size?: number }) {
  const t = useText(text);
  const label = priority ? t.priority(priority) : t.noPriority;
  return <span className="journey-priority-icon priority-icon" title={label}>
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {priority ? chevrons[priority].map(y => <path key={y} d={`M3 ${y}l5 3 5-3`} />) : <path d="M5 8h6" />}
    </svg>
    <span className="visually-hidden">{label}</span>
  </span>;
}
