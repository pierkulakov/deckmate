import { useRef } from 'react';
import { X } from 'lucide-react';
import { defineText, formatNumber, useLang, useText } from '../i18n.ts';
import { moveFocus } from '../focus.ts';
import type { CardOrderKey } from '../catalog-ordering.ts';
import '../card-filter-bar.css';

const text = defineText({
  activeFilters: 'Active filters',
  remove: (label: string) => `Remove filter: ${label}`,
  clear: 'Clear all',
  clearLabel: 'Clear search and filters',
  filter: (kind: string, value: string) => `${kind}: ${value}`,
  of: 'of',
  cards: (count: number): string => count === 1 ? 'card' : 'cards',
  state: 'State', priority: 'Priority', owner: 'Owner', tags: 'Tags', search: 'Search', mine: 'My cards',
  kind: 'Type', effort: 'Effort', run: 'Run', milestone: 'Milestone', hero: 'Hero Card', deck: 'Deck',
  manual: 'Zone', updated: 'Last updated', created: 'Creation date', title: 'Title',
}, {
  activeFilters: 'Активные фильтры',
  remove: (label: string) => `Убрать фильтр: ${label}`,
  clear: 'Сбросить всё',
  clearLabel: 'Сбросить поиск и фильтры',
  filter: (kind: string, value: string) => `${kind}: ${value}`,
  of: 'из',
  // After the Russian equivalent of "out of", the noun is genitive and its ending varies with the number.
  cards: (count: number) => count % 10 === 1 && count % 100 !== 11 ? 'карточки' : 'карточек',
  state: 'Состояние', priority: 'Приоритет', owner: 'Исполнитель', tags: 'Теги', search: 'Поиск', mine: 'Мои карточки',
  kind: 'Тип', effort: 'Оценка', run: 'Run', milestone: 'Milestone', hero: 'Hero Card', deck: 'Колода',
  manual: 'Зона', updated: 'Последнее изменение', created: 'Дата создания', title: 'Название',
});

export interface CardFilter {
  id: string;
  kind: CardOrderKey | 'kind' | 'search' | 'mine';
  value: string;
  onRemove: () => void;
}

export function CardFilterBar({ filters, shown, total, disabled, onClear, onEmptyFocus }: {
  filters: CardFilter[];
  shown: number;
  total: number;
  disabled: boolean;
  onClear: () => void;
  onEmptyFocus: () => void;
}) {
  const t = useText(text);
  const lang = useLang();
  const buttons = useRef(new Map<string, HTMLButtonElement>());

  function remove(index: number) {
    // 2026-11-10: focus the next surviving control before its neighbour disappears; the last one returns to search.
    const next = filters[index + 1] ?? filters[index - 1];
    if (next) moveFocus(buttons.current.get(next.id), { preventScroll: true });
    else onEmptyFocus();
    filters[index].onRemove();
  }

  return <div className={filters.length ? 'card-filter-bar panel-head' : 'visually-hidden'}
    role={filters.length ? 'group' : undefined} aria-label={filters.length ? t.activeFilters : undefined}>
    <span className="card-filter-count" role="status" aria-atomic="true">
      <span className="page-number">{formatNumber(shown, 0, lang)}</span>{' '}{t.of}{' '}
      <span className="page-number">{formatNumber(total, 0, lang)}</span>{' '}{t.cards(total)}
    </span>
    {filters.map((filter, index) => {
      const label = filter.kind === 'mine' ? t.mine : t.filter(t[filter.kind], filter.value);
      return <button key={filter.id} type="button" className="control is-on card-filter-remove" disabled={disabled}
        ref={button => { if (button) buttons.current.set(filter.id, button); else buttons.current.delete(filter.id); }}
        aria-label={t.remove(label)} onClick={() => remove(index)}>
        <span>{label}</span><X size={14} aria-hidden="true" />
      </button>;
    })}
    {filters.length > 0 && <button type="button" className="control control-ghost card-filter-clear" disabled={disabled}
      aria-label={t.clearLabel} onClick={onClear}>{t.clear}</button>}
  </div>;
}
