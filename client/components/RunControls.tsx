import { useEffect, useRef, useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Check, RotateCcw, Settings, Trash2, X } from 'lucide-react';
import type { CatalogView, RunCarryOver, RunConfiguration, RunRecord } from '../../src/catalog-contracts.ts';
import { defineText, useText } from '../i18n.ts';
import { addDays, localDay } from '../planning-metrics.ts';
import { Button } from './ui/button.tsx';
import { Switch } from './CardOrdering.tsx';
import { PlanningColorField, planningColors } from './PlanningColors.tsx';
import { ConfirmStrip, useConfirmStrip } from './ConfirmStrip.tsx';
import type { SavePlanning } from './TimelineView.tsx';
import '../run-controls.css';

const text = defineText({
  setup: 'Set up recurring Runs', settings: 'Run settings', shortName: 'Short name', color: 'Color',
  projectOnly: 'Only for this project', projectNote: 'This workspace contains one project. Global schedules can use all its decks.',
  label: 'Run label', labelHelp: 'Use %RUN_NR% for the Run number or %CALENDAR_WEEK% for the ISO week.',
  start: 'First start date', duration: 'Duration · weeks', upcoming: 'Active and upcoming Runs',
  startWeekday: 'Start weekday', weekday: (day: number) => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][day],
  finishTime: 'Finish at', timeZone: 'Time zone', finishHelp: '00:00 is the start of the end date; 24:00 is the end of that date.',
  carry: 'Move unfinished cards to the next Run', review: 'In review', blocked: 'Blocked', other: 'Other unfinished',
  cancel: 'Cancel', save: 'Save settings', saving: 'Saving…', close: 'Close Run settings',
  invalidZone: 'Enter a valid IANA time zone, such as Europe/Berlin.',
  finish: 'Finish Run', finishDescription: 'Save the final statistics, then move the selected unfinished cards to the next Run in this schedule. Done cards stay here.',
  finishLegacyDescription: 'Move eligible Discussing, In progress, and Review cards to an existing following Run. This legacy Run keeps its original record; no final statistics are created.',
  delete: 'Delete Run and following', deleteDescription: 'This Run and later unfinished Runs in the same schedule will be removed. Cards remain in the project and lose these Run assignments. The schedule stops until you resume it.',
  deleteStandalone: 'This Run will be removed. Its cards remain in the project and lose their Run assignment.',
  resume: 'Resume Runs', stopped: 'Schedule stopped', editFuture: 'Schedule changes affect current and upcoming Runs. Finished Runs keep their statistics.',
  conflict: 'The plan changed. Review the refreshed data before saving again.',
  reload: 'Load saved settings', reloadHint: 'Another edit changed this schedule. Load the saved settings before editing again.',
  removed: 'This schedule was removed. Your draft is kept; cancel to return to Timeline.',
  discard: 'Discard these unsaved settings?', schedules: 'Run schedules', newSchedule: 'New schedule',
  keepEditing: 'Keep editing', discardChanges: 'Discard changes',
}, {
  setup: 'Настроить повторяющиеся Run', settings: 'Настройки Run', shortName: 'Короткое имя', color: 'Цвет',
  projectOnly: 'Только для этого проекта', projectNote: 'В рабочей папке один проект. Глобальное расписание охватывает все его колоды.',
  label: 'Подпись Run', labelHelp: '%RUN_NR% — номер Run, %CALENDAR_WEEK% — номер недели ISO.',
  start: 'Дата первого старта', duration: 'Длительность · недели', upcoming: 'Активных и будущих Run',
  startWeekday: 'День старта', weekday: (day: number) => ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'][day],
  finishTime: 'Завершать в', timeZone: 'Часовой пояс', finishHelp: '00:00 — начало даты окончания, 24:00 — конец этой даты.',
  carry: 'Переносить незавершённые карты в следующий Run', review: 'На приёмке', blocked: 'Заблокированные', other: 'Остальные незавершённые',
  cancel: 'Отмена', save: 'Сохранить настройки', saving: 'Сохраняем…', close: 'Закрыть настройки Run',
  invalidZone: 'Укажите часовой пояс IANA, например Europe/Moscow.',
  finish: 'Завершить Run', finishDescription: 'Сохранить итоговую статистику и перенести выбранные незавершённые карты в следующий Run этого расписания. Принятые карты останутся здесь.',
  finishLegacyDescription: 'Перенести подходящие карты «обсуждаем», «в работе» и «приёмка» в существующий следующий Run. Исходная запись старого Run сохранится; итоговая статистика не создаётся.',
  delete: 'Удалить Run и следующие', deleteDescription: 'Этот и последующие незавершённые Run того же расписания будут удалены. Карты останутся в проекте без связи с этими Run. Расписание остановится до возобновления.',
  deleteStandalone: 'Run будет удалён. Его карты останутся в проекте без связи с этим Run.',
  resume: 'Возобновить Run', stopped: 'Расписание остановлено', editFuture: 'Изменения расписания затронут текущий и будущие Run. Статистика завершённых Run сохранится.',
  conflict: 'План изменился. Проверьте обновлённые данные перед повторным сохранением.',
  reload: 'Загрузить сохранённые настройки', reloadHint: 'Расписание изменено извне. Загрузите сохранённые настройки перед новой правкой.',
  removed: 'Расписание удалено. Черновик сохранён; отмените правку, чтобы вернуться в Timeline.',
  discard: 'Отменить несохранённые настройки?', schedules: 'Расписания Run', newSchedule: 'Новое расписание',
  keepEditing: 'Продолжить правку', discardChanges: 'Отменить изменения',
});

export function CarryOverFields({ value, onChange }: { value: RunCarryOver; onChange: (value: RunCarryOver) => void }) {
  const t = useText(text);
  return <fieldset className="run-carry-fields"><legend>{t.carry}</legend>{(['review', 'blocked', 'other'] as const).map(key =>
    <label className="planning-checkbox" key={key}><input type="checkbox" checked={value[key]} onChange={event => onChange({ ...value, [key]: event.target.checked })} />{t[key]}</label>)}</fieldset>;
}

function configurationDraftKey(value: RunConfiguration): string {
  return JSON.stringify({ ...value, projectSpecific: Boolean(value.projectSpecific) });
}

export function RunConfigurationForm({ catalog, configuration, pending, onSave, onCancel, onSaved, onDirtyChange, confirmStrip }: {
  catalog: CatalogView; configuration?: RunConfiguration; pending: boolean; onSave: SavePlanning;
  onCancel: () => void; onSaved: (configurationId: string, catalog?: CatalogView) => void; onDirtyChange?: (dirty: boolean) => void;
  /** A pending discard question: the strip stands in place of the footer until the answer comes. */
  confirmStrip?: ReactNode;
}) {
  const t = useText(text);
  const [value, setValue] = useState<RunConfiguration>(() => configuration ?? {
    id: `schedule-${crypto.randomUUID()}`, shortName: '', color: planningColors[0],
    labelTemplate: 'Run %RUN_NR%', startDate: localDay(), durationWeeks: 2, upcomingCount: 3,
    finishTime: '24:00', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    carryOver: { review: true, blocked: true, other: true },
  });
  const [revision, setRevision] = useState(catalog.runsHash ?? '');
  const [error, setError] = useState<string | null>(null);
  const [conflictingConfiguration, setConflictingConfiguration] = useState<RunConfiguration | null>(null);
  const [removed, setRemoved] = useState(false);
  const initial = useRef(configurationDraftKey(value));
  const dirty = configurationDraftKey(value) !== initial.current;
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [dirty]);
  const update = <Key extends keyof RunConfiguration>(key: Key, next: RunConfiguration[Key]) => setValue(previous => ({ ...previous, [key]: next }));
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending || conflictingConfiguration || removed) return;
    try { new Intl.DateTimeFormat('en', { timeZone: value.timeZone }).format(); }
    catch { setError(t.invalidZone); return; }
    setError(null);
    const result = await onSave({ action: 'save-run-configuration', configuration: { ...value, shortName: value.shortName.trim(), labelTemplate: value.labelTemplate.trim() }, runsHash: revision });
    if (result.ok) { onDirtyChange?.(false); onSaved(value.id, result.revisions); }
    else {
      setError(result.message ?? t.conflict);
      if (result.revisions) {
        setRevision(result.revisions.runsHash ?? '');
        const refreshed = result.revisions.runConfigurations?.find(item => item.id === value.id) ?? null;
        setConflictingConfiguration(refreshed);
        if (configuration && !refreshed) { setRemoved(true); setError(t.removed); }
      }
    }
  }
  return <form className="planning-create-form run-configuration-form" onSubmit={event => void submit(event)}>
    <fieldset disabled={pending || Boolean(confirmStrip)}>
      <div className="run-form-band"><Switch label={t.projectOnly} hint={t.projectNote} checked={value.projectSpecific ?? false} onChange={checked => update('projectSpecific', checked)} /></div>
      {/* 2026-11-05: three groups — name and color, period, finish and carry-over; the calendar's popover sets them in columns, a narrow dialog stacks them. */}
      <div className="run-form-columns">
        <div>
          <label>{t.shortName}<input required autoFocus maxLength={5} value={value.shortName} onChange={event => update('shortName', event.target.value)} /></label>
          <label>{t.label}<input required maxLength={160} value={value.labelTemplate} onChange={event => update('labelTemplate', event.target.value)} /></label><p className="planning-form-note">{t.labelHelp}</p>
          <div className="run-form-color"><span>{t.color}</span><PlanningColorField label={t.color} value={value.color} onChange={color => update('color', color)} /></div>
        </div>
        <div>
          <label>{t.duration}<input type="number" min={1} max={52} required value={value.durationWeeks} onChange={event => update('durationWeeks', Number(event.target.value))} /></label>
          {configuration ? <label>{t.startWeekday}<select value={new Date(value.startDate + 'T00:00:00Z').getUTCDay()} onChange={event => { const weekday = new Date(value.startDate + 'T00:00:00Z').getUTCDay(); update('startDate', addDays(value.startDate, Number(event.target.value) - weekday)); }}>{[1, 2, 3, 4, 5, 6, 0].map(day => <option key={day} value={day}>{t.weekday(day)}</option>)}</select></label>
            : <label>{t.start}<input type="date" required min="0001-01-01" max="9999-12-31" value={value.startDate} onChange={event => update('startDate', event.target.value)} /></label>}
          <label>{t.upcoming}<input type="number" min={1} max={52} required value={value.upcomingCount} onChange={event => update('upcomingCount', Number(event.target.value))} /></label>
        </div>
        <div>
          <div className="planning-form-dates"><label>{t.finishTime}<input required pattern="([01][0-9]|2[0-3]):[0-5][0-9]|24:00" value={value.finishTime} onChange={event => update('finishTime', event.target.value)} /></label>
            <label>{t.timeZone}<input required maxLength={100} value={value.timeZone} onChange={event => update('timeZone', event.target.value)} /></label></div><p className="planning-form-note">{t.finishHelp}</p>
          <CarryOverFields value={value.carryOver} onChange={next => update('carryOver', next)} />
        </div>
      </div>
    </fieldset>
    {configuration && <p className="run-settings-note">{t.editFuture}</p>}
    {error && <p className="error-banner" role="alert">{error}</p>}
    {conflictingConfiguration && <div className="notice"><p>{t.reloadHint}</p><Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => { initial.current = configurationDraftKey(conflictingConfiguration); setValue(conflictingConfiguration); setConflictingConfiguration(null); setError(null); }}>{t.reload}</Button></div>}
    {confirmStrip ?? <footer><Button type="button" variant="ghost" disabled={pending} onClick={onCancel}>{t.cancel}</Button><Button type="submit" disabled={pending || Boolean(conflictingConfiguration) || removed || Boolean(configuration && !dirty)}>{pending ? t.saving : t.save}</Button></footer>}
  </form>;
}

export function RunControls({ catalog, run, pending, writable, onSave, onDeleted, onOpenChange, onDirtyChange }: {
  catalog: CatalogView; run: RunRecord; pending: boolean; writable: boolean; onSave: SavePlanning; onDeleted?: () => void; onOpenChange?: (open: boolean) => void; onDirtyChange?: (dirty: boolean) => void;
}) {
  const t = useText(text);
  const configuration = catalog.runConfigurations?.find(candidate => candidate.id === run.configurationId);
  const [dialog, setDialog] = useState<'settings' | 'finish' | 'delete' | null>(null);
  const [revisions, setRevisions] = useState(catalog);
  const [dirty, setDirty] = useState(false);
  const [carry, setCarry] = useState<RunCarryOver>(configuration?.carryOver ?? { review: true, blocked: true, other: true });
  const initialCarry = useRef(carry);
  const [conflict, setConflict] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => { onOpenChange?.(Boolean(dialog)); }, [dialog, onOpenChange]);
  useEffect(() => () => onOpenChange?.(false), [onOpenChange]);
  useEffect(() => { onDirtyChange?.(Boolean(dialog) && dirty); }, [dialog, dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  const disabled = pending || !writable;
  // Closing with changes asks through the strip in the dialog instead of window.confirm (2026-11-05).
  const strip = useConfirmStrip();
  function open(next: typeof dialog) {
    const nextCarry = configuration?.carryOver ?? { review: true, blocked: true, other: true };
    initialCarry.current = nextCarry;
    strip.settle();
    setRevisions(catalog); setConflict(false); setFailure(null); setDirty(false); setCarry(nextCarry); setDialog(next);
  }
  function closeNow() { strip.settle(); setDialog(null); }
  function close() { if (pending) return; if (dirty && !strip.escape()) return; closeNow(); }
  async function perform() {
    if (disabled || !dialog || dialog === 'settings') return;
    const base = { runId: run.id, runsHash: revisions.runsHash ?? '', optionsHash: revisions.optionsHash ?? '' };
    const result = await onSave(dialog === 'finish' ? { action: 'finish-run', ...base, carryOver: carry } : { action: 'delete-run', ...base });
    if (result.ok) { closeNow(); if (dialog === 'delete') onDeleted?.(); }
    else { setFailure(result.message ?? t.conflict); if (result.revisions) { setRevisions(result.revisions); setConflict(true); } }
  }
  let dialogTitle = t.delete;
  let dialogDescription = configuration ? t.deleteDescription : t.deleteStandalone;
  if (dialog === 'settings') { dialogTitle = t.settings; dialogDescription = t.editFuture; }
  if (dialog === 'finish') { dialogTitle = t.finish; dialogDescription = configuration ? t.finishDescription : t.finishLegacyDescription; }
  const actionLabel = dialog === 'finish' ? t.finish : t.delete;
  if (!writable) return null;
  return <div className="planning-scope-actions">
    {configuration && <Button variant="ghost" size="icon" disabled={disabled} aria-label={t.settings} title={t.settings} onClick={() => open('settings')}><Settings size={18} /></Button>}
    {!run.finishedAt && <><Button variant="ghost" size="icon" disabled={disabled || run.start > localDay()} aria-label={t.finish} title={t.finish} onClick={() => open('finish')}><Check size={18} /></Button>
      <Button variant="ghost" size="icon" disabled={disabled} aria-label={t.delete} title={t.delete} onClick={() => open('delete')}><Trash2 size={18} /></Button></>}
    {configuration?.stopDate && <Button variant="ghost" size="sm" disabled={disabled} onClick={() => void onSave({ action: 'resume-runs', configurationId: configuration.id, runsHash: catalog.runsHash ?? '' })}><RotateCcw size={15} />{t.resume}</Button>}
    <Dialog.Root open={Boolean(dialog)} onOpenChange={next => { if (!next) close(); }}><Dialog.Portal><Dialog.Overlay className="planning-calendar-overlay" /><Dialog.Content className="planning-calendar planning-calendar-editing" onPointerDownOutside={event => { if (dirty || pending) event.preventDefault(); }}>
      <header><Dialog.Title>{dialogTitle}</Dialog.Title><Button variant="ghost" size="icon" disabled={pending} aria-label={t.close} onClick={close}><X size={18} /></Button></header>
      <Dialog.Description>{dialogDescription}</Dialog.Description>
      {dialog === 'settings' && configuration ? <RunConfigurationForm catalog={revisions} configuration={configuration} pending={pending} onSave={onSave} onCancel={close} onDirtyChange={setDirty} onSaved={() => { setDirty(false); closeNow(); }}
        confirmStrip={strip.confirming
          ? <ConfirmStrip question={t.discard} keepLabel={t.keepEditing} confirmLabel={t.discardChanges} onKeep={strip.keep} onConfirm={closeNow} />
          : undefined} /> : <div className="planning-create-form">
        {dialog === 'finish' && configuration && <fieldset disabled={pending || strip.confirming}><CarryOverFields value={carry} onChange={next => { setCarry(next); setDirty(JSON.stringify(next) !== JSON.stringify(initialCarry.current)); strip.settle(); }} /></fieldset>}
        {conflict && <p className="error-banner" role="alert">{t.conflict}</p>}
        {failure && !conflict && <p className="error-banner" role="alert">{failure}</p>}
        {strip.confirming
          ? <ConfirmStrip question={t.discard} keepLabel={t.keepEditing} confirmLabel={t.discardChanges} onKeep={strip.keep} onConfirm={closeNow} />
          : <footer><Button variant="ghost" disabled={pending} onClick={close}>{t.cancel}</Button><Button variant="outline" className={dialog === 'delete' ? 'planning-delete-confirm' : undefined} disabled={pending} onClick={() => void perform()}>{pending ? t.saving : actionLabel}</Button></footer>}
      </div>}
    </Dialog.Content></Dialog.Portal></Dialog.Root>
  </div>;
}

export function RunScheduleList({ catalog, pending, writable, onSave, onEdit }: {
  catalog: CatalogView; pending: boolean; writable: boolean; onSave: SavePlanning; onEdit: (configuration: RunConfiguration) => void;
}) {
  const t = useText(text);
  if (!catalog.runConfigurations?.length) return null;
  return <section className="run-schedule-list"><h3>{t.schedules}</h3>{catalog.runConfigurations.map(configuration => <div key={configuration.id}>
    <span className="run-schedule-color" style={{ backgroundColor: configuration.color }} /><strong title={configuration.shortName}>{configuration.shortName}</strong><span title={configuration.labelTemplate}>{configuration.labelTemplate}</span>
    {configuration.stopDate && <small>{t.stopped}</small>}
    {writable && <Button variant="ghost" size="icon" disabled={pending} aria-label={`${t.settings}: ${configuration.shortName}`} onClick={() => onEdit(configuration)}><Settings size={16} /></Button>}
    {writable && configuration.stopDate && <Button variant="ghost" size="sm" disabled={pending} onClick={() => void onSave({ action: 'resume-runs', configurationId: configuration.id, runsHash: catalog.runsHash ?? '' })}><RotateCcw size={15} />{t.resume}</Button>}
  </div>)}</section>;
}
