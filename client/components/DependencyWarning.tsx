import { AlertTriangle } from 'lucide-react';
import type { CatalogCard } from '../../src/catalog-contracts.ts';
import type { SliceStatus } from '../../src/workspace-contracts.ts';
import { dependencyConflicts, stateNeedsDependencyWarning, type DependencyConflict } from '../../src/dependency-contracts.ts';
import { StatusBadge } from './StatusMenu.tsx';
import { Button } from './ui/button.tsx';
import { defineText, useText } from '../i18n.ts';
import '../card-dependencies.css';

const text = defineText({
  waiting: 'waiting on:',
  inProgress: 'The change is already in progress.',
  single: (total: number) => `Unfinished dependencies: ${total}.`,
  multiple: (cards: number, total: number) => `Unfinished dependencies: ${total}, across ${cards} cards.`,
  cancel: 'Cancel',
  startAnyway: 'Start work anyway',
  acceptAnyway: 'Accept anyway',
  reviewAnyway: 'Send to review anyway',
  changeAnyway: 'Change state anyway',
  noStatus: 'no status',
}, {
  waiting: 'ждёт:',
  inProgress: 'Изменение уже выполняется.',
  single: (total: number) => `Не завершены зависимости: ${total}.`,
  multiple: (cards: number, total: number) => `Не завершены зависимости: ${total}. Карточек: ${cards}.`,
  cancel: 'Отмена',
  startAnyway: 'Начать работу всё равно',
  acceptAnyway: 'Принять всё равно',
  reviewAnyway: 'Отправить на приёмку всё равно',
  changeAnyway: 'Изменить состояние всё равно',
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
      {conflicts.length > 1 && <strong>{card.title}</strong>}
      <span>{t.waiting} {waiting.map(dependency => dependency.title).join(', ')}</span>
    </li>)}
    {disabled && <li className="dependency-warning-note">{t.inProgress}</li>}
  </ul>;
}

/**
 * Warning shared by the open card, tile shortcut, and bulk actions:
 * explanatory content with Proceed Anyway and Cancel buttons.
 */
export function DependencyStateWarning({ conflicts, busy = false, state, onConfirm, onCancel }: {
  conflicts: readonly DependencyConflict[];
  busy?: boolean;
  state?: SliceStatus;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const total = conflicts.reduce((sum, conflict) => sum + conflict.waiting.length, 0);
  const t = useText(text);
  let action = t.changeAnyway;
  if (state === 'done') action = t.acceptAnyway;
  if (state === 'started') action = t.startAnyway;
  if (state === 'review') action = t.reviewAnyway;
  return <div className="dependency-warning" role="alert">
    <p className="dependency-warning-title"><AlertTriangle size={14} />
      {conflicts.length === 1 ? t.single(total) : t.multiple(conflicts.length, total)} {action}?
    </p>
    <DependencyConflictList conflicts={conflicts} disabled={busy} />
    <div className="dependency-warning-actions">
      <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onCancel}>{t.cancel}</Button>
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onConfirm}>{action}</Button>
    </div>
  </div>;
}

/** State label for dependency lists; Hero and Doc cards have no state. */
export function DependencyStateBadge({ card }: { card: CatalogCard }) {
  const t = useText(text);
  if (card.kind !== 'task' || !card.state) return <span className="dependency-state dependency-state-none">{t.noStatus}</span>;
  return <span className="dependency-state"><StatusBadge state={card.state} /></span>;
}
