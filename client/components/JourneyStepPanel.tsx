import { useMemo, useRef, useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Gauge, Layers, Link2, SlidersHorizontal, Trash2, UserRound, X } from 'lucide-react';
import type { CardPriority, CatalogJourneyStep, CatalogView } from '../../src/catalog-contracts.ts';
import type { DataSource } from '../../src/workspace-contracts.ts';
import { parseEditorMarkdown } from '../editor-checklists.ts';
import { MemberOptions } from './JourneyPanel.tsx';
import { JourneyPriorityIcon, journeyStepLabel } from './JourneyMiniCard.tsx';
import { Markdown } from './Markdown.tsx';
import { CardEditForm, composeDraft, splitDraft } from './CardEditForm.tsx';
import { ConfirmStrip, useConfirmStrip } from './ConfirmStrip.tsx';
import { Button } from './ui/button.tsx';
import { defineText, locale, useText } from '../i18n.ts';
import { moveFocus } from '../focus.ts';
import { priorityLabel } from '../locales/common.ts';
import '../journey-step.css';

const stepText = defineText({
  step: 'Step',
  done: 'Done',
  owner: 'Owner',
  edit: 'Edit',
  effort: 'Effort',
  priority: 'Priority',
  noPriority: 'None',
  priorityValue: (priority: CardPriority) => priorityLabel(priority, 'en'),
  properties: 'Properties',
  stepLength: (titleLimit: number, markdownLimit: number) => `The step title is limited to ${new Intl.NumberFormat(locale('en')).format(titleLimit)} characters and instructions to ${new Intl.NumberFormat(locale('en')).format(markdownLimit)} characters.`,
  stepTitleRequired: 'Enter the step title.',
  cancelConfirm: 'Discard the step edit? The text returns to the start of editing.',
  keepEditing: 'Keep editing',
  discardChanges: 'Discard changes',
  roleTitle: 'The step role in the template becomes a deck on import',
  stepRole: 'Step role',
  targetDeckTitle: 'The deck where the step’s Task Card appears',
  targetDeck: 'Target Deck',
  chooseDeck: 'Choose a deck',
  deckUnavailable: 'Deck unavailable',
  closeStep: 'Close step',
  descriptionReadonly: 'Template step preview: text, role, dependencies, Effort, and Priority. The template cannot be changed in this panel.',
  descriptionEditable: 'Journey step: text, Owner, dependencies, Effort, and Priority. Every change is saved automatically.',
  textLabel: 'Step text: first line is the title',
  noInstructionReadonly: 'No instructions.',
  noInstructionEditable: 'No instructions. Click Edit to describe the step and checklist.',
  ownerAria: 'Step Owner',
  unassigned: 'Unassigned',
  ownerUnavailable: (owner: string) => `${owner} — unavailable`,
  dependenciesLegend: 'Dependencies — this step waits for',
  noOtherSteps: 'There are no other steps yet.',
  cycleTitle: 'This step already depends on the current one: a cycle would be created.',
  newStep: 'New step',
  reverseDependency: 'Reverse dependency',
  missingDependency: (id: string) => `Unavailable step: ${id}`,
  removeDependency: 'Remove the dependency before saving.',
  targetInvalid: 'Choose an available Task or Mixed deck.',
  targetRequired: 'Steps need a Task or Mixed deck.',
  ownerInvalid: 'Choose a team member or clear the assignment.',
  stepEffortAria: 'Step Effort',
  stepPriorityAria: 'Step Priority',
  stepActions: 'Step actions',
  propertiesAria: 'Properties: Owner and dependencies',
  deleteStep: 'Delete step',
}, {
  step: 'Шаг',
  done: 'Готово',
  owner: 'Исполнитель',
  edit: 'Изменить',
  effort: 'Оценка',
  priority: 'Приоритет',
  noPriority: 'Нет',
  priorityValue: (priority: CardPriority) => priorityLabel(priority, 'ru'),
  properties: 'Свойства',
  stepLength: (titleLimit: number, markdownLimit: number) => `Название шага ограничено ${new Intl.NumberFormat(locale('ru')).format(titleLimit)} знаками, инструкция — ${new Intl.NumberFormat(locale('ru')).format(markdownLimit)} знаками.`,
  stepTitleRequired: 'Укажите название шага.',
  cancelConfirm: 'Отменить правку шага? Текст вернётся к началу правки.',
  keepEditing: 'Продолжить правку',
  discardChanges: 'Отменить изменения',
  roleTitle: 'Роль шага в шаблоне: при импорте она станет колодой',
  stepRole: 'Роль шага',
  targetDeckTitle: 'Колода, в которой появится Task Card шага',
  targetDeck: 'Целевая колода',
  chooseDeck: 'Выберите колоду',
  deckUnavailable: 'Колода недоступна',
  closeStep: 'Закрыть шаг',
  descriptionReadonly: 'Просмотр шага шаблона: текст, роль, зависимости, оценка и приоритет. Шаблон нельзя изменить в панели.',
  descriptionEditable: 'Шаг Journey: текст, исполнитель, зависимости, оценка и приоритет. Каждое изменение сохраняется автоматически.',
  textLabel: 'Текст шага: первая строка — название',
  noInstructionReadonly: 'Инструкции нет.',
  noInstructionEditable: 'Инструкции нет. Нажмите «Изменить», чтобы описать шаг и чек-лист.',
  ownerAria: 'Исполнитель шага',
  unassigned: 'Без исполнителя',
  ownerUnavailable: (owner: string) => `${owner} — недоступен`,
  dependenciesLegend: 'Зависимости — шаг ждёт',
  noOtherSteps: 'Других шагов ещё нет.',
  cycleTitle: 'Этот шаг уже зависит от текущего: возникнет цикл.',
  newStep: 'Новый шаг',
  reverseDependency: 'Обратная зависимость',
  missingDependency: (id: string) => `Недоступный шаг: ${id}`,
  removeDependency: 'Снимите зависимость перед сохранением.',
  targetInvalid: 'Выберите доступную Task или Mixed колоду.',
  targetRequired: 'Для шагов нужна Task или Mixed колода.',
  ownerInvalid: 'Выберите участника из команды или снимите назначение.',
  stepEffortAria: 'Оценка шага',
  stepPriorityAria: 'Приоритет шага',
  stepActions: 'Действия шага',
  propertiesAria: 'Свойства: исполнитель и зависимости',
  deleteStep: 'Удалить шаг',
});

interface JourneyStepPanelProps {
  step: CatalogJourneyStep;
  steps: CatalogJourneyStep[];
  catalog: CatalogView;
  source: DataSource;
  path?: string;
  disabled: boolean;
  // 2026-11-04: template steps open the same sheet as a viewer. readOnly differs from disabled:
  // disabled temporarily blocks writing in the editable sheet, readOnly shows a step that has no deck at all.
  readOnly?: boolean;
  // readOnly replaces the deck select: the template step targets a role, which the import maps to a deck later.
  targetLabel?: string;
  feedback?: ReactNode;
  onChange: (patch: Partial<CatalogJourneyStep>) => void;
  onClose: () => void;
  onRemove: () => void;
}

function createsDependencyCycle(stepId: string, dependencyId: string, steps: CatalogJourneyStep[]): boolean {
  const visited = new Set<string>();
  function reachesStep(candidateId: string): boolean {
    if (candidateId === stepId) return true;
    if (visited.has(candidateId)) return false;
    visited.add(candidateId);
    return steps.find(candidate => candidate.id === candidateId)?.dependsOn.some(reachesStep) ?? false;
  }
  return reachesStep(dependencyId);
}

const stepTitleLimit = 200;
const stepMarkdownLimit = 50000;

// The step sheet presents a card with Edit; the sliders icon opens properties.
// Edit mode is the card's text editor (CardEditForm): first line — title, every keystroke goes to the Journey draft and its autosave.
// A template step reuses the sheet with readOnly: Edit/Delete hidden, fields locked, the role shown instead of the deck.
export function JourneyStepPanel({
  step, steps, catalog, source, path, disabled, readOnly = false, targetLabel, feedback, onChange, onClose, onRemove,
}: JourneyStepPanelProps) {
  const t = useText(stepText);
  const closeButton = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const locked = disabled || readOnly;
  const [editing, setEditing] = useState(() => !locked && !step.title.trim());
  const [text, setText] = useState(() => composeDraft(step.title, step.markdown));
  // Cancel returns the step to this text; autosave has already written the intermediate edits.
  const origin = useRef({ title: step.title, markdown: step.markdown });
  const [propertiesOpen, setPropertiesOpen] = useState(() => Boolean(step.owner) || step.dependsOn.length > 0);
  const [editError, setEditError] = useState('');
  // Cancel with changes asks through the strip in the editor's footer instead of window.confirm (2026-11-05).
  const strip = useConfirmStrip();
  const targets = catalog.decks.filter(deck => deck.kind === 'task' || deck.kind === 'mixed');
  const dependencies = steps.filter(candidate => candidate.id !== step.id);
  const missingDependencies = step.dependsOn.filter(id => !dependencies.some(candidate => candidate.id === id));
  const ownerUnavailable = Boolean(step.owner && !catalog.members?.some(member => member.label === step.owner));
  const targetUnavailable = Boolean(step.deckId && !targets.some(deck => deck.id === step.deckId));
  const instruction = useMemo(() => parseEditorMarkdown(step.markdown), [step.markdown]);

  function startEditing() {
    if (locked) return;
    origin.current = { title: step.title, markdown: step.markdown };
    setText(composeDraft(step.title, step.markdown));
    setEditError('');
    setEditing(true);
  }
  function changeText(value: string) {
    setText(value);
    // A fresh edit after a declined discard asks again on the next Cancel.
    strip.settle();
    const { title, markdown } = splitDraft(value);
    if (title.length > stepTitleLimit || markdown.length > stepMarkdownLimit) {
      setEditError(t.stepLength(stepTitleLimit, stepMarkdownLimit));
      return;
    }
    setEditError('');
    onChange({ title, markdown });
  }
  function finishEditing() {
    if (!splitDraft(text).title) { setEditError(t.stepTitleRequired); return; }
    if (!editError) setEditing(false);
  }
  function discardEditing() {
    const { title, markdown } = origin.current;
    strip.settle();
    onChange({ title, markdown });
    setEditError('');
    setEditing(false);
  }
  function cancelEditing() {
    const { title, markdown } = origin.current;
    if (text !== composeDraft(title, markdown) && !strip.escape()) return;
    discardEditing();
  }

  function toggleDependency(dependencyId: string, checked: boolean) {
    if (locked || (checked && createsDependencyCycle(step.id, dependencyId, steps))) return;
    const dependsOn = checked ? [...new Set([...step.dependsOn, dependencyId])] : step.dependsOn.filter(id => id !== dependencyId);
    onChange({ dependsOn });
  }

  return <Dialog.Root open onOpenChange={open => { if (!open) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="journey-step-overlay" />
      <Dialog.Content className="journey-step-sheet"
        onOpenAutoFocus={event => { event.preventDefault(); if (!editing) moveFocus(closeButton.current); }}
        onCloseAutoFocus={event => { event.preventDefault(); if (opener.current?.isConnected) moveFocus(opener.current); }}
        onEscapeKeyDown={event => {
          event.preventDefault();
          // In edit mode Escape belongs to the editor, as on a card: its menus close first, then the form cancels the edit.
          if (editing) return;
          event.stopPropagation();
          onClose();
        }}
        onPointerDownOutside={event => { event.preventDefault(); onClose(); }}>
        <header className="journey-step-sheet-header">
          <Dialog.Title>{t.step}</Dialog.Title>
          {readOnly ? <span className="journey-step-target" title={t.roleTitle}>
            <Layers size={13} aria-hidden="true" />
            <span className="visually-hidden">{t.stepRole}</span>
            <span className="journey-step-target-name">{targetLabel}</span>
          </span> : <label className="journey-step-target" title={t.targetDeckTitle}>
            <Layers size={13} aria-hidden="true" />
            <span className="visually-hidden">{t.targetDeck}</span>
            <select aria-label={t.targetDeck} value={step.deckId} disabled={disabled} onChange={event => onChange({ deckId: event.target.value })}>
              <option value="">{t.chooseDeck}</option>
              {targetUnavailable && <option value={step.deckId} disabled>{t.deckUnavailable}</option>}
              {targets.map(deck => <option key={deck.id} value={deck.id}>{deck.title}</option>)}
            </select>
          </label>}
          <button ref={closeButton} type="button" className="ui-button button-ghost button-size-icon" onClick={onClose} aria-label={t.closeStep}><X size={18} /></button>
        </header>
        <Dialog.Description className="visually-hidden">{readOnly
          ? t.descriptionReadonly
          : t.descriptionEditable}</Dialog.Description>
        <div className="journey-step-sheet-body">
          <article className={'journey-step-document' + (editing ? ' is-editing' : '')}>
            <div className="journey-step-content">
              {editing ? <CardEditForm draft={text} onDraftChange={changeText} catalog={catalog} source={source} path={path}
                writable={!locked} busy={false} blocked={Boolean(editError)} saveLabel={t.done} textLabel={t.textLabel}
                maxLength={stepTitleLimit + 2 + stepMarkdownLimit} notice={editError} onSave={finishEditing} onCancel={cancelEditing}
                confirmStrip={strip.confirming
                  ? <ConfirmStrip question={t.cancelConfirm} keepLabel={t.keepEditing} confirmLabel={t.discardChanges}
                      onKeep={strip.keep} onConfirm={discardEditing} />
                  : undefined} /> : <>
                <h3 className="journey-step-title">{journeyStepLabel(step.title)}</h3>
                {step.markdown.trim() ? <div className="journey-step-markdown"><Markdown tree={instruction} rawMarkdown={step.markdown} projectTags={catalog.projectTags} source={source} path={path} members={catalog.members} cards={catalog.cards} taskToggleDisabled /></div> : <p className="journey-step-empty">{readOnly ? t.noInstructionReadonly : t.noInstructionEditable}</p>}
              </>}
              {propertiesOpen && <div className="journey-step-settings" id={'journey-step-properties-' + step.id}>
                <label className="journey-step-owner">
                  <span><UserRound size={14} aria-hidden="true" />{t.owner}</span>
                  <select aria-label={t.ownerAria} value={step.owner ?? ''} disabled={locked} onChange={event => onChange({ owner: event.target.value || null })}>
                    <option value="">{t.unassigned}</option>
                    <MemberOptions members={catalog.members ?? []} />
                    {ownerUnavailable && <option value={step.owner!} disabled>{t.ownerUnavailable(step.owner!)}</option>}
                  </select>
                </label>
                <fieldset className="journey-step-dependencies" disabled={locked}>
                  <legend><Link2 size={14} aria-hidden="true" />{t.dependenciesLegend}</legend>
                  {dependencies.length === 0 && missingDependencies.length === 0 && <p>{t.noOtherSteps}</p>}
                  {dependencies.map(dependency => {
                    const checked = step.dependsOn.includes(dependency.id);
                    const cyclic = !checked && createsDependencyCycle(step.id, dependency.id, steps);
                    return <label key={dependency.id} title={cyclic ? t.cycleTitle : undefined}>
                      <input type="checkbox" checked={checked} disabled={locked || cyclic} onChange={event => toggleDependency(dependency.id, event.target.checked)} />
                      <span>{dependency.title || t.newStep}{cyclic && <small>{t.reverseDependency}</small>}</span>
                    </label>;
                  })}
                  {missingDependencies.map(dependencyId => <label key={dependencyId} className="journey-step-missing-dependency">
                    <input type="checkbox" checked onChange={() => toggleDependency(dependencyId, false)} />
                    <span>{t.missingDependency(dependencyId)}{!readOnly && <small>{t.removeDependency}</small>}</span>
                  </label>)}
                </fieldset>
              </div>}
              {!readOnly && targetUnavailable && <p className="journey-step-field-error" role="alert">{t.targetInvalid}</p>}
              {!readOnly && targets.length === 0 && <p className="journey-step-field-error">{t.targetRequired}</p>}
              {!readOnly && ownerUnavailable && <p className="journey-step-field-error" role="alert">{t.ownerInvalid}</p>}
            </div>
            {!readOnly && !editing && <div className="journey-step-edit-row">
              <button type="button" className="journey-step-edit" disabled={disabled} onClick={startEditing}>{t.edit}</button>
            </div>}
            <footer className="journey-step-properties">
              <label><span>{t.effort}</span><Gauge size={18} aria-hidden="true" /><input aria-label={t.stepEffortAria} type="number" min="0" step="0.25" inputMode="decimal" placeholder="-" value={step.effort ?? ''} disabled={locked} onChange={event => {
                const value = event.target.value;
                if (!value) onChange({ effort: null });
                else if (Number.isFinite(Number(value)) && Number(value) >= 0) onChange({ effort: Number(value) });
              }} /></label>
              <label className="journey-step-priority" title={t.priority}><span>{t.priority}</span><JourneyPriorityIcon priority={step.priority} size={20} /><select aria-label={t.stepPriorityAria} value={step.priority ?? ''} disabled={locked} onChange={event => onChange({ priority: event.target.value ? event.target.value as CardPriority : null })}>
                <option value="">{t.noPriority}</option><option value="high">{t.priorityValue('high')}</option><option value="medium">{t.priorityValue('medium')}</option><option value="low">{t.priorityValue('low')}</option>
              </select></label>
            </footer>
          </article>
          <nav className="journey-step-rail" aria-label={t.stepActions}>
            <Button type="button" variant="ghost" size="icon" aria-pressed={propertiesOpen} aria-controls={'journey-step-properties-' + step.id} aria-label={t.propertiesAria} title={t.properties} onClick={() => setPropertiesOpen(previous => !previous)}><SlidersHorizontal size={18} /></Button>
            {!readOnly && <Button type="button" variant="ghost" size="icon" className="journey-step-delete" disabled={disabled} aria-label={t.deleteStep} title={t.deleteStep} onClick={onRemove}><Trash2 size={17} /></Button>}
          </nav>
        </div>
        {feedback && <div className="journey-step-feedback">{feedback}</div>}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
