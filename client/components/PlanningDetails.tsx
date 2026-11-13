import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Pencil } from 'lucide-react';
import type { CatalogView, MilestoneRecord, RunRecord } from '../../src/catalog-contracts.ts';
import type { DataSource } from '../../src/workspace-contracts.ts';
import { markdownParser } from '../../src/markdown-model.ts';
import { validPlanningCover } from '../../src/planning-cover.ts';
import { attachmentFileUrl } from '../attachments.ts';
import { defineText, useText } from '../i18n.ts';
import { useDesktopDirty } from '../desktop-bridge.ts';
import { Button } from './ui/button.tsx';
import { Markdown } from './Markdown.tsx';
import { DecodedImage } from './DecodedImage.tsx';
import { MilestoneForm } from './PlanningPopover.tsx';
import type { SavePlanning } from './TimelineView.tsx';
import '../planning-details.css';

const text = defineText({
  edit: 'Edit details', goal: 'Goal', description: 'Description', cover: 'Cover image',
  coverHint: 'Project-relative image path or HTTPS URL.', noDescription: 'Add a description to explain this plan.',
  emptyDescription: 'No description.',
  save: 'Save details', saving: 'Saving…', cancel: 'Cancel',
  conflict: 'The file changed. Your draft remains in this form. Load the saved details to replace this draft before editing again.',
  loadSaved: 'Load saved details',
  missing: 'This plan was removed. Your draft is kept; cancel to return to Timeline.',
  failed: 'Could not save the details. Your draft is kept.',
  coverInvalid: 'Use an HTTPS image URL or a project-relative path without “..”.',
  coverUnavailable: 'The cover image could not be loaded.',
}, {
  edit: 'Изменить сведения', goal: 'Цель', description: 'Описание', cover: 'Обложка',
  coverHint: 'Путь к изображению внутри проекта или HTTPS-ссылка.', noDescription: 'Добавьте описание этого плана.',
  emptyDescription: 'Описания нет.',
  save: 'Сохранить сведения', saving: 'Сохраняем…', cancel: 'Отмена',
  conflict: 'Файл изменился. Черновик остался в форме. Загрузите сохранённые сведения вместо черновика, прежде чем продолжить правку.',
  loadSaved: 'Загрузить сохранённые сведения',
  missing: 'Этот план удалён. Черновик сохранён; отмените правку, чтобы вернуться в Timeline.',
  failed: 'Не удалось сохранить сведения. Черновик сохранён.',
  coverInvalid: 'Укажите HTTPS-ссылку или путь внутри проекта без «..».',
  coverUnavailable: 'Не удалось загрузить обложку.',
});

type Plan = { kind: 'run'; record: RunRecord } | { kind: 'milestone'; record: MilestoneRecord };
interface Draft { title: string; description: string; cover: string }

function valuesOf(plan: Plan): Draft {
  return {
    title: plan.kind === 'run' ? plan.record.goal : plan.record.title,
    description: plan.record.description ?? '', cover: plan.record.cover ?? '',
  };
}

function coverSource(value: string, source: DataSource): string | undefined {
  if (!value || !validPlanningCover(value)) return undefined;
  return /^https:\/\//iu.test(value) ? value : attachmentFileUrl(source, value);
}

/** A conflict keeps the draft visible but requires explicitly loading the current record before another edit (2026-11-05). */
export function PlanningDetails({ plan, catalog, source, writable, pending, onSave, onDirtyChange }: {
  plan: Plan; catalog: CatalogView; source: DataSource; writable: boolean; pending: boolean;
  onSave?: SavePlanning; onDirtyChange: (dirty: boolean) => void;
}) {
  const t = useText(text);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => valuesOf(plan));
  const [initialDraft, setInitialDraft] = useState(() => valuesOf(plan));
  const [base, setBase] = useState(catalog);
  const [conflict, setConflict] = useState<CatalogView | null>(null);
  const [message, setMessage] = useState<keyof typeof text.en | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const descriptionTree = useMemo(() => markdownParser.parse(plan.record.description ?? ''), [plan.record.description]);
  const image = coverSource(plan.record.cover ?? '', source);
  const dirty = editing && JSON.stringify(draft) !== JSON.stringify(initialDraft);
  const missing = plan.kind === 'run'
    ? !catalog.runs?.some(record => record.id === plan.record.id)
    : !catalog.milestones?.some(record => record.id === plan.record.id);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  useDesktopDirty(dirty);
  useEffect(() => {
    if (!dirty) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warnBeforeLeaving);
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving);
  }, [dirty]);

  function begin() {
    const initial = valuesOf(plan);
    setDraft(initial); setInitialDraft(initial); setBase(catalog); setConflict(null); setMessage(null); setServerError(null); setEditing(true);
  }
  function change<Key extends keyof Draft>(key: Key, value: Draft[Key]) {
    setDraft(previous => ({ ...previous, [key]: value }));
  }
  function loadSaved() {
    if (!conflict || pending || plan.kind !== 'run') return;
    const savedRun = conflict.runs?.find(item => item.id === plan.record.id);
    if (!savedRun) { setMessage('missing'); return; }
    const initial = valuesOf({ kind: 'run', record: savedRun });
    setDraft(initial); setInitialDraft(initial);
    setBase(conflict); setConflict(null); setMessage(null); setServerError(null);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!onSave || plan.kind !== 'run' || pending || !writable || conflict || missing || !dirty) return;
    setServerError(null);
    const cover = draft.cover.trim();
    if (!validPlanningCover(cover)) { setMessage('coverInvalid'); return; }
    const details = { description: draft.description, cover };
    const record = base.runs?.find(item => item.id === plan.record.id);
    if (!record) { setMessage('missing'); return; }
    const result = await onSave({ action: 'update-run', runsHash: base.runsHash ?? '', run: { ...record, ...details, goal: draft.title.trim() } });
    if (result.ok) { setEditing(false); setMessage(null); }
    else if (result.revisions) { setConflict(result.revisions); setMessage('conflict'); }
    else if (result.message) { setMessage(null); setServerError(result.message); }
    else setMessage('failed');
  }

  if (editing && plan.kind === 'milestone' && onSave) return <div className="planning-detail-form"><MilestoneForm date={plan.record.date} milestone={plan.record} catalog={base}
    pending={pending || !writable} details onSave={onSave} onDirtyChange={onDirtyChange} onCancel={() => setEditing(false)} onDone={() => setEditing(false)} /></div>;

  if (editing) return <form className="planning-detail-form" onSubmit={event => void save(event)}>
    <fieldset disabled={pending || !writable}>
      <label>{t.goal}<input className="control-field" autoFocus required maxLength={200} value={draft.title} onChange={event => change('title', event.target.value)} /></label>
      <label>{t.description}<textarea className="control-field" rows={5} maxLength={10000} value={draft.description} onChange={event => change('description', event.target.value)} /></label>
      <label>{t.cover}<input className="control-field" maxLength={2000} value={draft.cover} onChange={event => change('cover', event.target.value)} /><small>{t.coverHint}</small></label>
    </fieldset>
    {missing ? <p className="planning-detail-error" role="alert">{t.missing}</p> : message && <p className="planning-detail-error" role="alert">{t[message]}</p>}
    {serverError && <p className="planning-detail-error" role="alert">{serverError}</p>}
    {conflict && !missing && <Button type="button" size="sm" variant="outline" disabled={pending} onClick={loadSaved}>{t.loadSaved}</Button>}
    <footer><Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setEditing(false)}>{t.cancel}</Button>
      <Button type="submit" size="sm" disabled={pending || !writable || Boolean(conflict) || missing || !dirty || !draft.title.trim()}>{pending ? t.saving : t.save}</Button></footer>
  </form>;

  return <section className="planning-description-panel">
    {plan.kind === 'run' && !plan.record.configurationId && <div className="planning-run-goal"><h3>{t.goal}</h3><p>{plan.record.goal}</p></div>}
    {image && <DecodedImage className="planning-cover-image" src={image} alt="" loading="lazy" fallback={<span>{t.coverUnavailable}</span>} />}
    {plan.record.description ? <div className="planning-description-markdown"><Markdown tree={descriptionTree} source={source} path={plan.kind === 'run' ? 'tasks/deckmate-runs.md' : 'tasks/deckmate-milestones.md'} /></div>
      : <p className="planning-stat-note">{writable ? t.noDescription : t.emptyDescription}</p>}
    {onSave && writable && <Button size="sm" variant="ghost" disabled={pending} onClick={begin}><Pencil size={14} />{t.edit}</Button>}
  </section>;
}
