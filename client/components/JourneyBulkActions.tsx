import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ChevronDown, Copy, Link2, Trash2, X } from 'lucide-react';
import { Button } from './ui/button.tsx';
import { defineText, locale, useText, type Lang } from '../i18n.ts';
import '../journey-editor.css';

function numberValue(value: number, lang: Lang): string {
  return new Intl.NumberFormat(locale(lang)).format(value);
}

const text = defineText({
  count: (count: number) => numberValue(count, 'en'),
  selected: (count: number): string => new Intl.PluralRules(locale('en')).select(count) === 'one' ? ' step selected' : ' steps selected',
  selectAll: 'Select all',
  chain: 'Dependency Chain',
  duplicate: 'Duplicate',
  duplicateInJourney: (count: number) => `Duplicate ${numberValue(count, 'en')} ${new Intl.PluralRules(locale('en')).select(count) === 'one' ? 'step' : 'steps'} in Journey`,
  delete: 'Delete',
  actions: 'Selected step actions',
  selectedTitle: (count: number, total: number) => `${numberValue(count, 'en')} of ${numberValue(total, 'en')} ${new Intl.PluralRules(locale('en')).select(total) === 'one' ? 'step' : 'steps'} selected`,
  selectAllTitle: 'Select all steps · Ctrl/Cmd+A',
  selectionActions: 'Selection actions',
  chainTitle: 'Chain the selected steps in their listed order',
  duplicateTitle: 'Duplicate the selected steps into this or another Journey',
  deleteTitle: 'Delete selected steps',
  clear: 'Clear selection',
  clearTitle: 'Clear selection · Escape',
}, {
  count: (count: number) => numberValue(count, 'ru'),
  selected: (count: number) => {
    const rule = new Intl.PluralRules(locale('ru')).select(count);
    return { one: ' шаг выбран', few: ' шага выбраны', many: ' шагов выбрано', zero: ' шагов выбрано', two: ' шага выбраны', other: ' шага выбраны' }[rule]!;
  },
  selectAll: 'Выбрать все',
  chain: 'Цепочка зависимостей',
  duplicate: 'Дублировать',
  duplicateInJourney: (count: number) => {
    const noun = { one: 'шаг', few: 'шага', many: 'шагов', zero: 'шагов', two: 'шага', other: 'шага' }[new Intl.PluralRules(locale('ru')).select(count)]!;
    return `Дублировать ${numberValue(count, 'ru')} ${noun} в Journey`;
  },
  delete: 'Удалить',
  actions: 'Действия с выбранными шагами',
  selectedTitle: (count: number, total: number) => {
    const noun = { one: 'шага', few: 'шагов', many: 'шагов', other: 'шага', zero: 'шагов', two: 'шагов' }[new Intl.PluralRules(locale('ru')).select(total)];
    return `Выбрано ${numberValue(count, 'ru')} из ${numberValue(total, 'ru')} ${noun}`;
  },
  selectAllTitle: 'Выбрать все шаги · Ctrl/Cmd+A',
  selectionActions: 'Действия с выделением',
  chainTitle: 'Выстроить зависимости выбранных шагов по порядку следования',
  duplicateTitle: 'Дублировать выбранные шаги в этот или другой Journey',
  deleteTitle: 'Удалить выбранные шаги',
  clear: 'Снять выбор',
  clearTitle: 'Снять выбор · Escape',
});

// The Journey bulk toolbar occupies the same 48px header slot as the normal toolbar.
// JourneyEditor handles dependencies, duplication and deletion; targets include the current Journey.
// JourneyEditor also warns when duplication removes external dependencies.
export function JourneyBulkActions(props: {
  count: number; total: number; disabled: boolean; targets: { id: string; title: string; disabled?: boolean }[];
  onSelectAll: () => void; onClear: () => void; onChain: () => void; onDuplicate: (journeyId: string) => void; onDelete: () => void;
}) {
  const { count, total, disabled, targets, onSelectAll, onClear, onChain, onDuplicate, onDelete } = props;
  const t = useText(text);
  if (count <= 0) return null;
  const duplicateBlocked = disabled || targets.length === 0 || targets.every(target => target.disabled);
  return <header className="journey-bulk-heading" aria-label={t.actions} aria-busy={disabled}>
    <strong className="journey-bulk-count" aria-live="polite" title={t.selectedTitle(count, total)}><span>{t.count(count)}</span>{t.selected(count)}</strong>
    <Button variant="ghost" size="sm" disabled={disabled || count >= total} onClick={onSelectAll} aria-keyshortcuts="Control+A Meta+A" title={t.selectAllTitle}>{t.selectAll}</Button>
    <span className="journey-bulk-divider" aria-hidden="true" />
    <div className="journey-bulk-buttons" role="group" aria-label={t.selectionActions}>
      {count >= 2 && <Button variant="ghost" size="sm" disabled={disabled} onClick={onChain} title={t.chainTitle}><Link2 size={14} />{t.chain}</Button>}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild><Button variant="ghost" size="sm" disabled={duplicateBlocked} title={t.duplicateTitle}><Copy size={13} />{t.duplicate}<ChevronDown size={13} /></Button></DropdownMenu.Trigger>
        <DropdownMenu.Portal><DropdownMenu.Content className="journey-editor-menu" align="end" sideOffset={6}>
          <DropdownMenu.Label className="journey-editor-menu-label">{t.duplicateInJourney(count)}</DropdownMenu.Label>
          {targets.map(target => <DropdownMenu.Item key={target.id} disabled={target.disabled} onSelect={() => onDuplicate(target.id)}><Copy size={13} />{target.title}</DropdownMenu.Item>)}
        </DropdownMenu.Content></DropdownMenu.Portal>
      </DropdownMenu.Root>
      <Button variant="ghost" size="sm" className="journey-bulk-delete" disabled={disabled} onClick={onDelete} title={t.deleteTitle}><Trash2 size={13} />{t.delete}</Button>
      <span className="journey-bulk-divider" aria-hidden="true" />
      <Button variant="ghost" size="icon" className="journey-bulk-clear" disabled={disabled} onClick={onClear} aria-label={t.clear} title={t.clearTitle}><X size={18} /></Button>
    </div>
  </header>;
}
