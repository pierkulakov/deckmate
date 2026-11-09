import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { CatalogView, MilestoneRecord } from '../../src/catalog-contracts.ts';
import { defineText, useText } from '../i18n.ts';
import { useDesktopDirty } from '../desktop-bridge.ts';
import { Switch } from './CardOrdering.tsx';
import { PlanningColorField, planningColors } from './PlanningColors.tsx';
import { ConfirmStrip } from './ConfirmStrip.tsx';
import type { SavePlanning } from './TimelineView.tsx';
import { Button } from './ui/button.tsx';

const text = defineText({
  projectSpecific: 'Only for this project',
  projectHint: 'A project-specific Milestone is shown only with its project; without it, the Milestone is global.',
  title: 'Title',
  date: 'Date',
  color: 'Color',
  titleRequired: 'Enter the Milestone title.',
  create: 'Create Milestone',
  save: 'Save',
  saving: 'Saving…',
  discard: 'Discard the unsaved changes?',
  keepEditing: 'Keep editing',
  discardChanges: 'Discard changes',
}, {
  projectSpecific: 'Только для проекта',
  projectHint: 'Milestone проекта виден только с ним; без отметки Milestone глобальный.',
  title: 'Название',
  date: 'Дата',
  color: 'Цвет',
  titleRequired: 'Укажите название Milestone.',
  create: 'Создать Milestone',
  save: 'Сохранить',
  saving: 'Сохраняем…',
  discard: 'Отменить несохранённые изменения?',
  keepEditing: 'Продолжить правку',
  discardChanges: 'Отменить изменения',
});

/**
 * Non-modal form anchored to a date cell or a button: centered on it, 10 px away, kept 16 px inside the window (2026-11-05).
 * A dirty form no longer blocks on window.confirm: the owner shows `confirm`, the form goes inert and the strip below answers.
 */
export function PlanningPopover({ anchor, placement, wide, title, closeLabel, dirty, pending, confirm, onInteract, onClose, children }: {
  anchor: HTMLElement; placement: 'above' | 'below'; wide: boolean; title: string; closeLabel: string; dirty: boolean; pending: boolean;
  confirm?: { onKeep: () => void; onDiscard: () => void } | null;
  /** The user touched the form again after a declined discard: the next close attempt asks anew. */
  onInteract?: () => void;
  onClose: () => void; children: ReactNode;
}) {
  const t = useText(text);
  // Radix mounts the content after its own presence pass, so the node arrives through a callback ref, not on the first effect.
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  // Until it is measured the form waits off-screen but visible, so Radix can still move focus into its first field.
  const [position, setPosition] = useState({ left: -10000, top: 0 });
  useLayoutEffect(() => {
    if (!element) return;
    const margin = 16;
    const gap = 10;
    function place() {
      if (!element || !anchor.isConnected) return;
      const target = anchor.getBoundingClientRect();
      const { width, height } = element.getBoundingClientRect();
      let top = placement === 'above' ? target.top - gap - height : target.bottom + gap;
      if (placement === 'above' && top < margin) top = target.bottom + gap;
      top = Math.max(margin, Math.min(top, window.innerHeight - height - margin));
      const left = Math.max(margin, Math.min(target.left + target.width / 2 - width / 2, window.innerWidth - width - margin));
      setPosition(previous => previous.left === left && previous.top === top ? previous : { left, top });
    }
    place();
    const resize = new ResizeObserver(place);
    resize.observe(element);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    // Opened from «+», the form mounts while the panel still slides in; its date cell settles only when the slide ends.
    window.addEventListener('animationend', place, true);
    return () => {
      resize.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('animationend', place, true);
    };
  }, [anchor, placement, element]);
  return <Dialog.Root open modal={false} onOpenChange={value => { if (!value) onClose(); }}><Dialog.Portal>
    <Dialog.Content ref={setElement} aria-describedby={undefined} className={`planning-popover${wide ? ' is-wide' : ''}`} style={position}
      // A press on the anchor itself is left to its own click: «Set up Runs» toggles, a date cell keeps its form.
      onInteractOutside={event => { if (dirty || pending || anchor.contains(event.target as Node)) event.preventDefault(); }}
      onEscapeKeyDown={event => { if (pending) event.preventDefault(); }}
      // The strip is the only active part while it asks; a touch of the dimmed form means the user stayed.
      onPointerDownCapture={() => { if (!confirm) onInteract?.(); }}
      onKeyDownCapture={event => { if (!confirm && event.key !== 'Escape') onInteract?.(); }}
      onCloseAutoFocus={event => { event.preventDefault(); if (anchor.isConnected) (anchor.querySelector<HTMLElement>('button') ?? anchor).focus(); }}>
      <header><Dialog.Title title={title}>{title}</Dialog.Title><button type="button" className="planning-popover-close" disabled={pending} aria-label={closeLabel} onClick={onClose}><X size={20} /></button></header>
      {/* The wrapper always renders: mounting it with the strip would reset the form's own draft state (2026-11-05). */}
      <div className="planning-popover-body" inert={Boolean(confirm)}>{children}</div>
      {confirm && <ConfirmStrip question={t.discard} keepLabel={t.keepEditing} confirmLabel={t.discardChanges}
        onKeep={confirm.onKeep} onConfirm={confirm.onDiscard} />}
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}

/** One form creates a Milestone at a date or edits the clicked one: project scope, title, date and color. */
export function MilestoneForm({ date, milestone, catalog, pending, onSave, onDirtyChange, onDone }: {
  date: string; milestone?: MilestoneRecord; catalog: CatalogView; pending: boolean;
  onSave: SavePlanning; onDirtyChange: (dirty: boolean) => void; onDone: (id: string) => void;
}) {
  const t = useText(text);
  const [id] = useState(() => milestone?.id ?? `milestone-${crypto.randomUUID()}`);
  const initial = useRef({ title: milestone?.title ?? '', date: milestone?.date ?? date, color: milestone?.color ?? planningColors[0], projectSpecific: milestone?.projectSpecific ?? false });
  const [value, setValue] = useState(initial.current);
  const [revision, setRevision] = useState(catalog.milestonesHash ?? '');
  const [validation, setValidation] = useState(false);
  const dirty = JSON.stringify(value) !== JSON.stringify(initial.current);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useDesktopDirty(dirty);
  useEffect(() => {
    if (!dirty) return;
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [dirty]);
  const update = <Key extends keyof typeof value>(key: Key, next: (typeof value)[Key]) => setValue(previous => ({ ...previous, [key]: next }));

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (!value.title.trim()) { setValidation(true); return; }
    setValidation(false);
    const record: MilestoneRecord = { ...milestone, id, title: value.title.trim(), date: value.date, color: value.color, projectSpecific: value.projectSpecific };
    const result = await onSave(milestone ? { action: 'update-milestone', milestone: record, milestonesHash: revision } : { action: 'create-milestone', milestone: record, milestonesHash: revision });
    if (result.ok) onDone(id);
    else if (result.revisions) setRevision(result.revisions.milestonesHash ?? '');
  }

  return <form className="planning-popover-form" onSubmit={event => void submit(event)}>
    <fieldset disabled={pending}>
      <div className="planning-popover-band"><Switch label={t.projectSpecific} hint={t.projectHint} checked={value.projectSpecific} onChange={checked => update('projectSpecific', checked)} /></div>
      <div className="planning-popover-columns">
        <div>
          <label className="planning-underline-field">{t.title}<input autoFocus required maxLength={120} value={value.title} onChange={event => update('title', event.target.value)} /></label>
          <label className="planning-underline-field">{t.date}<input type="date" min="0001-01-01" max="9999-12-31" required value={value.date} onChange={event => update('date', event.target.value)} /></label>
        </div>
        <div>
          <div className="planning-underline-field"><span>{t.color}</span><PlanningColorField label={t.color} value={value.color} onChange={color => update('color', color)} /></div>
          {validation && <p className="error-banner" role="alert">{t.titleRequired}</p>}
          <Button type="submit" className="planning-popover-submit" disabled={pending || Boolean(milestone && !dirty)}>{pending ? t.saving : milestone ? t.save : t.create}</Button>
        </div>
      </div>
    </fieldset>
  </form>;
}
