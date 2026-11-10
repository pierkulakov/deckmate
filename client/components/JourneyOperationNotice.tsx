import { useRef, useState } from 'react';
import type { CatalogJourney, CatalogView } from '../../src/catalog-contracts.ts';
import type { DataSource } from '../../src/workspace-contracts.ts';
import type { CatalogAction } from '../useCatalog.ts';
import { readFreshCatalog } from '../catalog-store.ts';
import { defineText, useText } from '../i18n.ts';
import { moveFocus } from '../focus.ts';
import { failureMessage } from '../failure-message.ts';
import { ConfirmStrip } from './ConfirmStrip.tsx';
import { Button } from './ui/button.tsx';
import '../journey-operation.css';

const text = defineText({
  pending: 'The previous Journey save did not finish. Finish saving to recover all changes, or abandon it and keep the files as they are.',
  conflict: 'Saving stopped because a file was changed outside this save. Check the file and refresh, or abandon the unfinished save. Step editing is paused.',
  invalid: 'The unfinished Journey save cannot be read. Abandon it to continue working with the files as they are. Step editing is paused.',
  badge: 'Unfinished save',
  finish: 'Finish saving',
  abandon: 'Abandon unfinished save',
  refresh: 'Refresh',
  confirmation: 'The files will stay as they are. Nothing is rolled back. The unsaved part of the edit will be lost. Abandon the unfinished save?',
  keep: 'Keep unfinished save',
  failed: 'The action was not confirmed. The catalog was refreshed; check the Journey before trying again.',
  refreshed: 'Journey refreshed. Your editor input is preserved.',
  finished: 'The unfinished save is complete. Review the Journey. Your editor input is preserved.',
  abandoned: 'The unfinished save was abandoned. The files are unchanged. Your editor input is preserved.',
  applyBlocked: 'Finish or abandon the unfinished Journey save before applying it to a Deck.',
}, {
  pending: 'Предыдущее сохранение Journey не завершилось. Завершите его, чтобы восстановить все изменения, или бросьте и оставьте файлы как есть.',
  conflict: 'Сохранение остановлено: файл изменён вне этого сохранения. Проверьте файл и обновите данные или бросьте незавершённое сохранение. Редактирование шагов приостановлено.',
  invalid: 'Не удалось прочитать незавершённое сохранение Journey. Бросьте его, чтобы продолжить работу с файлами как есть. Редактирование шагов приостановлено.',
  badge: 'Сохранение не завершено',
  finish: 'Завершить сохранение',
  abandon: 'Бросить незавершённое сохранение',
  refresh: 'Обновить',
  confirmation: 'Файлы останутся как есть, ничего не откатывается. Несохранённая часть правки потеряна. Бросить незавершённое сохранение?',
  keep: 'Оставить незавершённое сохранение',
  failed: 'Действие не подтверждено. Каталог перечитан; проверьте Journey перед повтором.',
  refreshed: 'Journey обновлён. Ввод в редакторе сохранён.',
  finished: 'Незавершённое сохранение завершено. Проверьте Journey. Ввод в редакторе сохранён.',
  abandoned: 'Незавершённое сохранение брошено. Файлы не изменены. Ввод в редакторе сохранён.',
  applyBlocked: 'Завершите или бросьте незавершённое сохранение Journey перед применением к Deck.',
});

export function journeyRecoveryAction(journey: CatalogJourney, manifestHash: string): CatalogAction {
  // 2026-11-10: send the observed snapshot, never an unsaved draft; server recovery runs before request hash validation.
  return { action: 'update-journey', manifestHash, journeyId: journey.id, journeyHash: journey.fileHash,
    title: journey.title, description: journey.description ?? '', zones: journey.zones ?? [], steps: journey.steps };
}

export function JourneyOperationBadge({ journey }: { journey: CatalogJourney }) {
  const t = useText(text);
  return journey.pendingOperation ? <span className="journey-operation-badge">{t.badge}</span> : null;
}

export function JourneyOption({ journey }: { journey: CatalogJourney }) {
  const t = useText(text);
  return <option value={journey.id}>{journey.title} · v{journey.version}{journey.pendingOperation && ` · ${t.badge}`}</option>;
}

export function useJourneyApplyBlocked(journey: CatalogJourney | undefined): string | undefined {
  const t = useText(text);
  return journey?.pendingOperation ? t.applyBlocked : undefined;
}

export function JourneyOperationNotice({ journey, catalog, source, writable, disabled = false, onEdit, onBusyChange }: {
  journey: CatalogJourney; catalog: CatalogView; source: DataSource; writable: boolean; disabled?: boolean;
  onEdit?: (action: CatalogAction) => Promise<boolean>; onBusyChange?: (busy: boolean) => void;
}) {
  const t = useText(text);
  const operation = journey.pendingOperation;
  const [confirmingHash, setConfirmingHash] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const active = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const abandonButton = useRef<HTMLButtonElement>(null);
  const busy = disabled || working;
  const confirming = !!operation && confirmingHash === operation.journalHash;

  function cancel() { setConfirmingHash(null); moveFocus(abandonButton.current); }

  async function act(kind: 'finish' | 'abandon' | 'refresh') {
    if (active.current || busy || !operation || (kind !== 'refresh' && (!writable || !onEdit))) return;
    if (kind === 'abandon' && !confirming) return;
    active.current = true; setWorking(true); onBusyChange?.(true); setError(''); setFeedback('');
    let failureText = '';
    try {
      if (kind === 'finish') await onEdit!(journeyRecoveryAction(journey, catalog.manifestHash));
      if (kind === 'abandon') {
        const saved = await onEdit!({ action: 'abandon-journey-operation', journeyId: journey.id,
          journalHash: operation.journalHash, manifestHash: catalog.manifestHash });
        if (!saved) failureText = t.failed;
      }
    } catch (failure) { failureText = failureMessage(failure, t.failed); }
    try {
      // 2026-11-10: recovery can succeed then return 409 for stale request hashes; reread even after a rejected write.
      const fresh = await readFreshCatalog(source);
      const current = fresh.journeys?.find(candidate => candidate.id === journey.id);
      if (kind === 'refresh') setFeedback(t.refreshed);
      else if (current && !current.pendingOperation) setFeedback(kind === 'finish' ? t.finished : t.abandoned);
      else if (!failureText) failureText = t.failed;
    } catch (failure) { if (!failureText) failureText = failureMessage(failure, t.failed); }
    setError(failureText); setConfirmingHash(null); setWorking(false); active.current = false; onBusyChange?.(false);
    moveFocus(root.current, { preventScroll: true });
  }

  if (!operation && !feedback && !error && !working) return null;
  let role: 'status' | 'alert' = 'status';
  if (error || operation && operation.state !== 'pending') role = 'alert';
  return <div ref={root} tabIndex={-1} className="journey-operation-notice catalog-notice" role={role} aria-busy={working}>
    {operation && <><p>{t[operation.state]}</p>{operation.state === 'conflict' && operation.file && <p><code>{operation.file}</code></p>}
      <div className="journey-operation-actions">
        {writable && onEdit && operation.state === 'pending' && <Button type="button" size="sm" disabled={busy} onClick={() => void act('finish')}>{t.finish}</Button>}
        {writable && onEdit && <Button ref={abandonButton} type="button" size="sm" variant="outline" disabled={busy} onClick={() => setConfirmingHash(operation.journalHash)}>{t.abandon}</Button>}
        {operation.state === 'conflict' && <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void act('refresh')}>{t.refresh}</Button>}
      </div>
      {confirming && !working && <ConfirmStrip question={t.confirmation} keepLabel={t.keep} confirmLabel={t.abandon} danger onKeep={cancel} onEscape={cancel} onConfirm={() => void act('abandon')} />}
    </>}
    {feedback && <p>{feedback}</p>}{error && <p>{error}</p>}
  </div>;
}
