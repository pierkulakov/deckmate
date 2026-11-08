import { AlertTriangle } from 'lucide-react';
import type { CatalogCard } from '../../src/catalog-contracts.ts';
import { dependencyConflicts, stateNeedsDependencyWarning, type DependencyConflict } from '../../src/dependency-contracts.ts';
import { StatusBadge } from './StatusMenu.tsx';
import { Button } from './ui/button.tsx';
import { defineText, useText } from '../i18n.ts';
import '../card-dependencies.css';

const text = defineText({
  waiting: 'waiting on:',
  inProgress: 'The change is already in progress.',
  single: (title: string, total: number) => {
    const dependency = new Intl.PluralRules('en-US').select(total) === 'one' ? 'dependency' : 'dependencies';
    return `"${title}" is waiting on ${total} open ${dependency}. Change the card state anyway?`;
  },
  multiple: (cards: number, total: number) => `${cards} cards have open incoming dependencies (${total} total). Change their state anyway?`,
  cancel: 'Cancel',
  anyway: 'Continue',
  noStatus: 'no status',
}, {
  waiting: 'ждёт:',
  inProgress: 'Изменение уже выполняется.',
  single: (title: string, total: number) => `«${title}» ждёт ${total} незакрыты${total === 1 ? 'й' : 'х'} зависимост${total === 1 ? 'ь' : 'и'}. Перевести карточку в новое состояние всё равно?`,
  multiple: (cards: number, total: number) => `У ${cards} карточек есть незакрытые входящие зависимости (всего ${total}). Перевести их всё равно?`,
  cancel: 'Отмена',
  anyway: 'Всё равно',
  noStatus: 'без статуса',
});

// Warning logic lives in src/dependency-contracts.ts; this module handles presentation only.
export { dependencyConflicts, stateNeedsDependencyWarning };
export type { DependencyConflict };

/** Card-to-prerequisite list shared by StatusMenu and bulk actions. */
export function DependencyConflictList({ conflicts, disabled = false }: { conflicts: readonly DependencyConflict[]; disabled?: boolean }) {
  const t = useText(text);
  return <ul className="dependency-warning-list">
    {conflicts.map(({ card, waiting }) => <li key={card.id}>
      <strong>{card.title}</strong>
      <span>{t.waiting} {waiting.map(dependency => dependency.title).join(', ')}</span>
    </li>)}
    {disabled && <li className="dependency-warning-note">{t.inProgress}</li>}
  </ul>;
}

/**
 * Warning shared by the open card, tile shortcut, and bulk actions:
 * explanatory content with Proceed Anyway and Cancel buttons.
 */
export function DependencyStateWarning({ conflicts, busy = false, onConfirm, onCancel }: {
  conflicts: readonly DependencyConflict[];
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const total = conflicts.reduce((sum, conflict) => sum + conflict.waiting.length, 0);
  const t = useText(text);
  return <div className="dependency-warning" role="alert">
    <p className="dependency-warning-title"><AlertTriangle size={14} />
      {conflicts.length === 1 ? t.single(conflicts[0].card.title, total) : t.multiple(conflicts.length, total)}
    </p>
    <DependencyConflictList conflicts={conflicts} disabled={busy} />
    <div className="dependency-warning-actions">
      <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onCancel}>{t.cancel}</Button>
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onConfirm}>{t.anyway}</Button>
    </div>
  </div>;
}

/** State label for dependency lists; Hero and Doc cards have no state. */
export function DependencyStateBadge({ card }: { card: CatalogCard }) {
  const t = useText(text);
  if (card.kind !== 'task' || !card.state) return <span className="dependency-state dependency-state-none">{t.noStatus}</span>;
  return <span className="dependency-state"><StatusBadge state={card.state} /></span>;
}
