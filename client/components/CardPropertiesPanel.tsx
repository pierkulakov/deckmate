import { useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode, type Ref } from 'react';
import { ChevronDown, Info, Layers, LoaderCircle, Settings, X } from 'lucide-react';
import * as Tooltip from '@radix-ui/react-tooltip';
import type { BulkChange } from '../../src/bulk-contracts.ts';
import type { CardPriority, CatalogCard, CatalogView } from '../../src/catalog-contracts.ts';
import type { DataSource } from '../../src/workspace-contracts.ts';
import type { CatalogAction } from '../useCatalog.ts';
import { CardOwnerAvatar, CardQuickSettings, cardEffortPresets, type CardQuickSettingsTab } from './CardQuickSettings.tsx';
import { TagGlyph } from './CardTags.tsx';
import { TagPicker } from './TagPicker.tsx';
import { Button } from './ui/button.tsx';
import { defineText, locale, useLang, useText } from '../i18n.ts';
import { priorityLabel } from '../locales/common.ts';
import { orderedRunChoices, runChoiceLabel } from '../run-label.ts';
import '../card-properties.css';

const text = defineText({
  stale: 'Change not saved. Check the catalog message and try again.',
  connection: 'Could not save the change. Check the connection and try again.',
  docEffort: (value: string) => `The card became a Doc. Effort draft: ${value}. Discard it to continue.`,
  notSet: 'not set',
  discardEffort: 'Discard Effort',
  clearPriority: 'Clear Priority',
  clearEffort: 'Clear Effort',
  customEffort: 'Custom Effort',
  saveEffort: 'Save Effort',
  cancel: 'Cancel',
  invalidEffort: 'Enter a non-negative number.',
  effortConflict: 'The source changed. Discard the Effort draft and edit again with current data.',
  save: 'Save',
  clearDue: 'Clear Due Date',
  dueConflict: 'The properties changed. Discard the due date draft and edit again with current data.',
  projectTags: 'Project Tags',
  projectTagsInfo: 'Project tags are shared by everyone in the project. Click a tag to add it to the card or to remove it. Personal tags: type # in the card text.',
  noProjectTags: 'No project tags yet — create one with the gear.',
  addTag: (name: string) => 'Add tag ' + name, removeTag: (name: string) => 'Remove tag ' + name,
  pick: (label: string) => `Pick ${label}`,
  pickButton: 'Pick',
  noRuns: 'No upcoming Runs',
  noMilestones: 'No upcoming milestones',
  none: 'None',
  propertiesAria: 'Properties',
  ownerLabel: 'Owner',
  unassigned: 'Unassigned',
  priority: 'Priority',
  effort: 'Effort',
  totalEffort: 'Total effort incl. Sub Cards: ',
  runLabel: 'Run',
  milestoneLabel: 'Milestone',
  dueDate: 'Due Date',
}, {
  stale: 'Изменение не сохранено. Проверьте сообщение каталога и повторите действие.',
  connection: 'Не удалось сохранить изменение. Проверьте соединение и повторите действие.',
  docEffort: (value: string) => `Карта стала Doc. Черновик Effort: ${value}. Отмените его, чтобы продолжить.`,
  notSet: 'не задан',
  discardEffort: 'Отменить Effort',
  clearPriority: 'Снять Priority',
  clearEffort: 'Снять Effort',
  customEffort: 'Свой Effort',
  saveEffort: 'Сохранить Effort',
  cancel: 'Отмена',
  invalidEffort: 'Введите неотрицательное число.',
  effortConflict: 'Источник изменился. Отмените черновик Effort и повторите правку с актуальными данными.',
  save: 'Сохранить',
  clearDue: 'Снять Due Date',
  dueConflict: 'Свойства изменились. Отмените черновик срока и повторите правку с актуальными данными.',
  projectTags: 'Теги проекта',
  projectTagsInfo: 'Теги проекта общие для всех в проекте. Щелчок по тегу добавляет его к карте или снимает. Личные теги — через # в тексте карты.',
  noProjectTags: 'Тегов проекта пока нет — создайте шестерёнкой.',
  addTag: (name: string) => 'Добавить тег ' + name, removeTag: (name: string) => 'Снять тег ' + name,
  pick: (label: string) => `Выбрать: ${label}`,
  pickButton: 'Выбрать',
  noRuns: 'Нет предстоящих Run',
  noMilestones: 'Нет предстоящих вех',
  none: 'Нет',
  propertiesAria: 'Свойства',
  ownerLabel: 'Владелец',
  unassigned: 'Unassigned',
  priority: 'Priority',
  effort: 'Effort',
  totalEffort: 'Суммарный Effort с Sub Cards: ',
  runLabel: 'Run',
  milestoneLabel: 'Веха',
  dueDate: 'Due Date',
});

type Selector = 'dueDate';
interface DraftRevision { sourceHash: string; manifestHash: string; optionsHash: string; value: string }
type PropertyChange = Partial<Pick<CatalogCard, 'owner' | 'effort' | 'priority'>>;
export interface CardPropertiesPanelHandle { openQuickSettings: (tab: CardQuickSettingsTab) => void }

export function cardHeroEffort(card: CatalogCard, catalog: Pick<CatalogView, 'cards'>): number | null {
  if (card.kind !== 'hero') return null;
  const children = catalog.cards.filter(candidate => candidate.parentId === card.id && candidate.kind === 'task' && !candidate.archived && !candidate.deleted);
  if (!children.length && card.effort == null) return null;
  // 2026-11-04: unestimated work contributes one point; a Hero's own estimate is additional work.
  return (card.effort ?? 0) + children.reduce((total, child) => total + (child.effort ?? 1), 0);
}

export function CardPropertiesPanel({ id, card, catalog, source, disabled, visible, onEdit, onActiveChange, children, ref }: {
  id: string; card: CatalogCard; catalog: CatalogView; source?: DataSource; disabled: boolean; visible: boolean;
  onEdit: (action: CatalogAction) => Promise<boolean>; onActiveChange: (active: boolean) => void; children?: ReactNode;
  ref?: Ref<CardPropertiesPanelHandle>;
}) {
  const [selector, setSelector] = useState<Selector | null>(null);
  const t = useText(text);
  const lang = useLang();
  const [quickTab, setQuickTab] = useState<CardQuickSettingsTab | null>(null);
  const [quickSaving, setQuickSaving] = useState(false);
  const quickAnchor = useRef<HTMLElement | null>(null);
  const [effortDraft, setEffortDraft] = useState<DraftRevision | null>(null);
  const [dueDraft, setDueDraft] = useState<DraftRevision | null>(null);
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const panel = useRef<HTMLElement>(null);
  const current = catalog.cards.find(candidate => candidate.id === card.id);
  const value = current ?? card;
  // Offer every project tag, followed by this card's personal tags so they can be removed.
  const projectTagChips = useMemo(() => [...(catalog.projectTags ?? [])].sort((left, right) => left.name.localeCompare(right.name)), [catalog.projectTags]);
  const personalTags = useMemo(() => (value.tags ?? []).filter(name => !projectTagChips.some(tag => tag.name === name)), [value.tags, projectTagChips]);
  const unavailable = disabled || busy || quickSaving || !current;
  const editing = effortDraft !== null || dueDraft !== null;
  const controlsDisabled = unavailable || editing || tagManagerOpen;
  const effortText = effortDraft?.value ?? (value.effort == null ? '' : String(value.effort));
  const effortNumber = effortText.trim() ? Number(effortText) : null;
  const effortValid = effortNumber === null || (Number.isFinite(effortNumber) && effortNumber >= 0);
  const effortConflict = Boolean(effortDraft && (effortDraft.sourceHash !== value.sourceHash || effortDraft.manifestHash !== catalog.manifestHash));
  const dueConflict = Boolean(dueDraft && (dueDraft.sourceHash !== value.sourceHash || dueDraft.manifestHash !== catalog.manifestHash || dueDraft.optionsHash !== (catalog.optionsHash ?? '')));
  const active = busy || quickSaving || editing;
  const heroEffort = cardHeroEffort(value, catalog);
  const dueDate = value.dueDate ? new Date(value.dueDate + 'T00:00:00') : null;
  const dueLabel = dueDate && !Number.isNaN(dueDate.getTime())
    ? new Intl.DateTimeFormat(locale(lang), { dateStyle: 'medium' }).format(dueDate)
    : value.dueDate;

  useEffect(() => { onActiveChange(active); }, [active, onActiveChange]);
  useEffect(() => () => onActiveChange(false), [onActiveChange]);
  useEffect(() => {
    // 2026-11-04: hidden pickers must not lock navigation; an actual date draft stays reopenable.
    if (!visible) { setQuickTab(null); if (!dueDraft) setSelector(null); }
  }, [visible, dueDraft]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (selector) panel.current?.querySelector<HTMLElement>('[data-property-selector] input, [data-property-selector] button')?.focus();
  }, [selector]);

  function revision(text: string): DraftRevision {
    return { value: text, sourceHash: value.sourceHash, manifestHash: catalog.manifestHash, optionsHash: catalog.optionsHash ?? '' };
  }

  function toggleSelector(next: Selector) {
    if (controlsDisabled) return;
    setSelector(previous => previous === next ? null : next);
    setMessage('');
  }

  async function save(action: CatalogAction, afterSave?: () => void) {
    if (unavailable || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage('');
    try {
      const saved = await onEdit(action);
      if (!mounted.current) return;
      if (saved) afterSave?.();
      else setMessage(t.stale);
    } catch {
      if (mounted.current) setMessage(t.connection);
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function saveProperties(change: PropertyChange, captured = revision(''), afterSave?: () => void) {
    return save({ action: 'set-card-properties', cardId: value.id, sourceHash: captured.sourceHash,
      manifestHash: captured.manifestHash, owner: value.owner, effort: value.effort ?? null,
      priority: value.priority ?? null, ...change }, afterSave);
  }

  function saveBulk(change: BulkChange, captured = revision(''), afterSave?: () => void) {
    return save({ action: 'bulk-edit-cards', manifestHash: captured.manifestHash, optionsHash: captured.optionsHash,
      cards: [{ cardId: value.id, sourceHash: captured.sourceHash }], change }, afterSave);
  }

  function openQuickSettings(tab: CardQuickSettingsTab, anchor: HTMLElement) {
    if (controlsDisabled) return;
    quickAnchor.current = anchor;
    setSelector(null);
    setQuickTab(tab);
  }

  useImperativeHandle(ref, () => ({
    openQuickSettings(tab) {
      const anchor = panel.current?.querySelector<HTMLElement>('[data-property="' + tab + '"]') ?? panel.current;
      if (anchor) openQuickSettings(tab, anchor);
    },
  }));

  function discardEffort() { setEffortDraft(null); setMessage(''); }
  function discardDue() { setDueDraft(null); setSelector(null); setMessage(''); }

  function saveEffort() {
    if (!effortDraft || !effortValid || effortConflict) return;
    if (effortNumber === (value.effort ?? null)) { discardEffort(); return; }
    void saveProperties({ effort: effortNumber }, effortDraft, discardEffort);
  }

  function saveDue() {
    if (!dueDraft || dueConflict) return;
    const date = dueDraft.value || null;
    if (date === (value.dueDate ?? null)) { discardDue(); return; }
    void saveBulk({ kind: 'options', patch: { dueDate: date } }, dueDraft, discardDue);
  }

  function pickButton(field: Selector | 'owner' | 'run' | 'milestone', label: string) {
    return <button type="button" className="card-properties-pick" disabled={controlsDisabled} aria-label={t.pick(label)} aria-expanded={selector === field || quickTab === field} onClick={event => {
      if (field === 'owner' || field === 'run' || field === 'milestone') openQuickSettings(field, event.currentTarget);
      else toggleSelector(field);
    }}><span>{t.pickButton}</span><ChevronDown size={16} /></button>;
  }

  function planningSection(field: 'run' | 'milestone', label: string, choices: { value: string; label: string }[]) {
    const selected = value[field];
    const selectedLabel = choices.find(choice => choice.value === selected)?.label ?? selected;
    const emptyLabel = field === 'run' ? t.noRuns : t.noMilestones;
    return <section className="card-properties-section" data-property={field}>
      <div className="card-properties-heading"><h3>{label}</h3>{pickButton(field, label)}</div>
      <p className="card-properties-value">{selectedLabel || (choices.length ? t.none : emptyLabel)}</p>

    </section>;
  }

  return <section ref={panel} id={id} className="card-properties-panel" aria-label={t.propertiesAria} aria-busy={busy}>
    <section className="card-properties-section" data-property="owner">
      <div className="card-properties-heading"><h3>{t.ownerLabel}</h3>{pickButton('owner', t.ownerLabel)}</div>
      <div className="card-properties-owner-value"><button type="button" className="card-properties-owner" disabled={controlsDisabled} aria-expanded={quickTab === 'owner'} onClick={event => openQuickSettings('owner', event.currentTarget)}>
        <CardOwnerAvatar owner={value.owner} members={catalog.members ?? []} /><span>{value.owner || t.unassigned}</span>
      </button></div>
    </section>
    {value.kind === 'doc' && effortDraft && <div className="card-properties-section" role="alert"><p className="card-properties-error">{t.docEffort(effortDraft.value || t.notSet)}</p><Button type="button" variant="outline" size="sm" disabled={busy} onClick={discardEffort}>{t.discardEffort}</Button></div>}
    {value.kind !== 'doc' && <>
      <section className="card-properties-section" data-property="priority">
        <div className="card-properties-heading"><h3>{t.priority}</h3>{value.priority && <button type="button" className="card-properties-clear" aria-label={t.clearPriority} title={t.clearPriority} disabled={controlsDisabled} onClick={() => void saveProperties({ priority: null })}><X size={13} /></button>}</div>
        <div className="card-properties-priorities" role="group" aria-label={t.priority}>
          {(['low', 'medium', 'high'] as CardPriority[]).map(priority => <button key={priority} type="button" disabled={controlsDisabled} aria-pressed={value.priority === priority} onClick={() => void saveProperties({ priority: value.priority === priority ? null : priority })}>
            <Layers size={24} strokeWidth={priority === 'high' ? 2.5 : 1.5} /><span>{priorityLabel(priority, lang)}</span>
          </button>)}
        </div>
      </section>
      <section className="card-properties-section" data-property="effort">
        <div className="card-properties-heading"><h3>{t.effort}</h3>{value.effort != null && <button type="button" className="card-properties-clear" aria-label={t.clearEffort} title={t.clearEffort} disabled={controlsDisabled} onClick={() => void saveProperties({ effort: null })}><X size={13} /></button>}</div>
        <form className="card-properties-effort-form" onSubmit={event => { event.preventDefault(); saveEffort(); }}>
          <div className="card-properties-effort-values"><div className="card-properties-effort-scale" role="group" aria-label={t.effort}>
            {cardEffortPresets.filter(amount => amount <= 8).map(amount => <button key={amount} type="button" disabled={controlsDisabled} aria-pressed={value.effort === amount} onClick={() => void saveProperties({ effort: amount })}>{amount}</button>)}
          </div><label className="card-properties-effort-custom"><span className="visually-hidden">{t.customEffort}</span><input type="text" inputMode="decimal" value={effortText} disabled={unavailable || dueDraft !== null || tagManagerOpen} aria-invalid={!effortValid || effortConflict}
            onChange={event => { setSelector(null); setEffortDraft(previous => ({ ...(previous ?? revision('')), value: event.target.value })); setMessage(''); }} /></label></div>
          {effortDraft && <div className="card-properties-effort-draft-actions"><Button type="submit" size="sm" disabled={unavailable || !effortValid || effortConflict}>{t.saveEffort}</Button><Button type="button" variant="ghost" size="sm" disabled={busy} onClick={discardEffort}>{t.cancel}</Button></div>}
        </form>
        {value.kind === 'hero' && <p className="card-properties-total">{t.totalEffort}<strong>{heroEffort?.toLocaleString(locale(lang), { maximumFractionDigits: 2 }) ?? '—'}</strong></p>}
        {!effortValid && <p className="card-properties-error" role="alert">{t.invalidEffort}</p>}
        {effortConflict && <p className="card-properties-error" role="alert">{t.effortConflict}</p>}
      </section>
    </>}
    {planningSection('run', t.runLabel, orderedRunChoices(catalog.runs ?? []).map(run => ({ value: run.id, label: runChoiceLabel(run, lang) })))}
    {planningSection('milestone', t.milestoneLabel, (catalog.milestones ?? []).map(milestone => ({ value: milestone.id, label: milestone.title })))}
    <section className="card-properties-section" data-property="dueDate">
      <div className="card-properties-heading"><h3>{t.dueDate}</h3>{value.dueDate && <button type="button" className="card-properties-clear" aria-label={t.clearDue} title={t.clearDue} disabled={controlsDisabled} onClick={() => void saveBulk({ kind: 'options', patch: { dueDate: null } })}><X size={13} /></button>}{pickButton('dueDate', t.dueDate)}</div>
      <p className="card-properties-value">{dueLabel || t.none}</p>
      {selector === 'dueDate' && <form className="card-properties-date" data-property-selector onSubmit={event => { event.preventDefault(); saveDue(); }}>
        <label><span className="visually-hidden">{t.dueDate}</span><input type="date" value={dueDraft?.value ?? value.dueDate ?? ''} disabled={unavailable} onChange={event => { setDueDraft(previous => ({ ...(previous ?? revision('')), value: event.target.value })); setMessage(''); }} /></label>
        <div><Button type="submit" size="sm" disabled={unavailable || !dueDraft || dueConflict}>{t.save}</Button><Button type="button" variant="ghost" size="sm" disabled={busy} onClick={discardDue}>{t.cancel}</Button></div>
        {dueConflict && <p className="card-properties-error" role="alert">{t.dueConflict}</p>}
      </form>}
    </section>
    <section className="card-properties-section" data-property="tags">
      <div className="card-properties-heading"><h3>{t.projectTags}</h3>
        <Tooltip.Provider delayDuration={200}><Tooltip.Root><Tooltip.Trigger asChild>
          <button type="button" className="card-properties-info" aria-label={t.projectTagsInfo}><Info size={14} aria-hidden="true" /></button>
        </Tooltip.Trigger><Tooltip.Portal><Tooltip.Content className="card-properties-info-tip" side="top" align="start" sideOffset={6}>{t.projectTagsInfo}</Tooltip.Content></Tooltip.Portal></Tooltip.Root></Tooltip.Provider>
        <div className="card-properties-tag-manager"><Settings size={15} aria-hidden="true" /><TagPicker card={value} catalog={catalog} disabled={unavailable || editing} onEdit={onEdit} onOpenChange={setTagManagerOpen} /></div>
      </div>
      {projectTagChips.length || personalTags.length ? <div className="card-properties-tag-chips" role="group" aria-label={t.projectTags}>
        {projectTagChips.map(tag => { const on = Boolean(value.tags?.includes(tag.name)); return <button type="button" key={tag.name} className="card-properties-tag-chip" aria-pressed={on} disabled={controlsDisabled}
          aria-label={on ? t.removeTag(tag.name) : t.addTag(tag.name)} title={tag.name} onClick={() => void saveBulk({ kind: 'tags', tags: [tag.name], mode: on ? 'remove' : 'add' })}>
          <span className="card-properties-tag-chip-label"><TagGlyph tag={tag} />{tag.name}</span>{on && <span className="card-properties-tag-chip-remove" aria-hidden="true"><X size={13} /></span>}
        </button>; })}
        {personalTags.map(name => <button type="button" key={name} className="card-properties-tag-chip is-personal" aria-pressed="true" disabled={controlsDisabled}
          aria-label={t.removeTag(name)} title={'#' + name} onClick={() => void saveBulk({ kind: 'tags', tags: [name], mode: 'remove' })}>
          <span className="card-properties-tag-chip-label">#{name}</span><span className="card-properties-tag-chip-remove" aria-hidden="true"><X size={13} /></span>
        </button>)}
      </div> : <p className="card-properties-value">{t.noProjectTags}</p>}
    </section>
    {message && <p className="card-properties-error" role="alert">{message}</p>}
    {quickTab && <CardQuickSettings key={value.id} card={value} catalog={catalog} source={source} anchor={quickAnchor.current}
      tab={quickTab} onTabChange={setQuickTab} disabled={disabled || busy || editing || !current} onEdit={onEdit}
      onSavingChange={setQuickSaving} onClose={() => setQuickTab(null)} />}
    {children}
  </section>;
}
