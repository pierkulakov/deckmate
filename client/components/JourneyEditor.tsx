import { useEffect, useMemo, useRef, useState } from 'react';
import { prepareEntrance } from '../prepared-motion.ts';
import { primaryModifierPressed } from '../shortcut-format.ts';
import * as Dialog from '@radix-ui/react-dialog';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ChartNoAxesColumn, ChevronDown, Copy, Info, LayoutGrid, Layers, LoaderCircle, Plus, X } from 'lucide-react';
import type { CatalogDeck, CatalogJourney, CatalogJourneyTemplate, CatalogView, JourneyRoleTarget } from '../../src/catalog-contracts.ts';
import type { DataSource } from '../../src/workspace-contracts.ts';
import type { CatalogAction } from '../useCatalog.ts';
import { readFreshCatalog } from '../catalog-store.ts';
import { JourneyCatalog, JourneySaveTemplateDialog } from './JourneyCatalog.tsx';
import { JourneyOperationBadge, JourneyOperationNotice, JourneyOption } from './JourneyOperationNotice.tsx';
import { JourneyStepPanel } from './JourneyStepPanel.tsx';
import { JourneyZones } from './JourneyZones.tsx';
import { JourneyBulkActions } from './JourneyBulkActions.tsx';
import { JourneyMetricsTable, useJourneyMetrics } from './JourneyMetrics.tsx';
import { dependencyCycle, draftError, duplicateJourneySteps, journeyDraft, mergeJourneyDraft, nextJourneyId, normalizedDraft, sameDraft, visibleSteps, type JourneyDraft, type JourneySnapshot } from './JourneyDraft.tsx';
import { CatalogReferenceLink, journeyIntroductionText } from './JourneyPanel.tsx';
import { Button } from './ui/button.tsx';
import { defineText, formatNumber, locale, useText } from '../i18n.ts';
import { failureMessage } from '../failure-message.ts';
import { useDesktopDirty } from '../desktop-bridge.ts';
import { currentSourceLabels } from '../source-access.ts';
import { moveFocus } from '../focus.ts';
import '../journey-editor.css';

// The new zone title is saved to the project file, so it follows the project's format language, not the interface language.
const formatText = defineText({
  newZoneTitle: 'New zone',
}, {
  newZoneTitle: 'Новая зона',
});

const text = defineText({
  prepareJourney: 'Prepare Journey for ',
  browseTemplates: 'Browse templates',
  saveAsTemplate: 'Save as template',
  cloneJourney: 'Clone Journey',
  copyJourney: 'Copy Journey to Deck',
  closeJourney: 'Close Journey',
  addZone: 'Add step zone',
  allSaved: 'All changes saved',
  localStepUnsaved: 'Step text is not saved',
  unfinishedSave: 'Journey save is unfinished',
  addJourneyStep: 'Add a Journey step',
  readOnly: 'Read only',
  conflictStatus: 'Autosave paused: resolve the conflict',
  createConfirmation: 'Creation needs confirmation',
  autosavePaused: 'Autosave paused',
  fillForAutosave: 'Fill in the fields for autosave',
  saving: 'Saving…',
  waitingAutosave: 'Waiting for autosave…',
  thisJourney: 'This Journey',
  newJourney: (title: string) => `${title} · new Journey`,
  saveFailed: 'Could not save the Journey. Your input is preserved in the editor.',
  createUnconfirmed: 'Journey creation was not confirmed. Your input is preserved; reread the result before writing again.',
  zonesUnconfirmed: (deck: string) => `The Journey was created in “${deck}”, but its zones were not confirmed. Open the created Journey; copying again will create another one.`,
  createStillUnconfirmed: 'Creation is still unconfirmed. Your input is preserved; check the deck’s Journey before closing.',
  createConfirmed: 'Journey creation confirmed',
  autosaveUnconfirmed: 'Autosave was not confirmed. Your input is preserved; try again.',
  lastStep: 'The last step cannot be deleted: a Journey must contain at least one step.',
  cycleNotice: 'The chain creates a dependency cycle. Changes were not applied.',
  chainNotice: (count: number) => `Dependency Chain: ${formatNumber(count, 3, 'en')} ${new Intl.PluralRules(locale('en')).select(count) === 'one' ? 'step' : 'steps'}`,
  duplicateMessage: (count: number, dropped: number) => {
    const noun = new Intl.PluralRules(locale('en')).select(count) === 'one' ? 'step' : 'steps';
    return `${formatNumber(count, 3, 'en')} ${noun} copied${dropped ? `. Dependencies on unselected steps removed: ${formatNumber(dropped, 3, 'en')}` : ''}`;
  },
  copyUnconfirmed: 'Copying was not confirmed: the target Journey was reread. Your selection is preserved; check it before trying again.',
  localChangesApplied: 'Your edits were applied to the reread Journey',
  cloned: (deck: string) => `Journey copied to deck “${deck}”`,
  imported: 'Template imported',
  templateSaveUnconfirmed: 'Template save was not confirmed. The fields are preserved.',
  templateSaved: 'Template saved in the project',
  conflictText: 'The Journey changed in the files and was reread. Your input is preserved; autosave is paused.',
  applyMine: 'Apply my edits',
  useFileVersion: 'Use the file version',
  rereadResult: 'Reread result',
  retryAutosave: 'Retry autosave',
  closeMessage: 'Close message',
  editorDescription: 'Editor for the deck’s Journey steps, zones, and templates. Changes are saved automatically.',
  aboutAria: 'About Journey: title, description, link',
  aboutTitle: 'Journey title and description',
  metricsTitle: 'Step metrics: returns from Review, cycle, reasons',
  metrics: 'Metrics',
  saveTemplateWaiting: 'Waiting for autosave',
  saveTemplateTitle: 'Save in the project catalog',
  journeyTitle: 'Journey title',
  journeyDescription: 'Description',
  deckJourney: 'Deck Journey',
  assetMixedOnly: 'Journey is available for Asset and Mixed decks.',
  discardTitle: 'Changes are not confirmed yet',
  discardCreateDescription: 'Creation may have completed on the server. Check the deck’s Journey before creating it again. Leaving discards local input.',
  discardDescription: 'Correct the fields or resolve the conflict to continue autosaving.',
  continueEditing: 'Continue editing',
  discardChanges: 'Discard changes',
}, {
  prepareJourney: 'Подготовить Journey для ',
  browseTemplates: 'Обзор шаблонов',
  saveAsTemplate: 'Сохранить как шаблон',
  cloneJourney: 'Дублировать Journey',
  copyJourney: 'Скопировать Journey в колоду',
  closeJourney: 'Закрыть Journey',
  addZone: 'Добавить зону шагов',
  allSaved: 'Все изменения сохранены',
  localStepUnsaved: 'Текст шага не сохранён',
  unfinishedSave: 'Сохранение Journey не завершено',
  addJourneyStep: 'Добавьте шаг Journey',
  readOnly: 'Только чтение',
  conflictStatus: 'Автосохранение приостановлено: разрешите конфликт',
  createConfirmation: 'Создание требует подтверждения',
  autosavePaused: 'Автосохранение приостановлено',
  fillForAutosave: 'Заполните поля для автосохранения',
  saving: 'Сохраняем…',
  waitingAutosave: 'Ожидаем автосохранение…',
  thisJourney: 'В этот Journey',
  newJourney: (title: string) => `${title} · новый Journey`,
  saveFailed: 'Не удалось сохранить Journey. Ввод сохранён в редакторе.',
  createUnconfirmed: 'Создание Journey не подтверждено. Ввод сохранён; перечитайте результат перед дальнейшей записью.',
  zonesUnconfirmed: (deck: string) => `Journey в «${deck}» создан, но его зоны не подтверждены. Откройте созданный Journey; повторное копирование создаст ещё один.`,
  createStillUnconfirmed: 'Создание всё ещё не подтверждено. Ввод сохранён; проверьте Journey колоды перед закрытием.',
  createConfirmed: 'Создание Journey подтверждено',
  autosaveUnconfirmed: 'Автосохранение не подтверждено. Ввод сохранён; повторите попытку.',
  lastStep: 'Последний шаг удалить нельзя: Journey должен содержать хотя бы один шаг.',
  cycleNotice: 'Цепочка создаёт цикл зависимостей. Изменения не применены.',
  chainNotice: (count: number) => {
    const noun = { one: 'шаг', few: 'шага', many: 'шагов', other: 'шага', zero: 'шагов', two: 'шага' }[new Intl.PluralRules(locale('ru')).select(count)];
    return `Цепочка зависимостей: ${formatNumber(count, 3, 'ru')} ${noun}`;
  },
  duplicateMessage: (count: number, dropped: number) => {
    const noun = { one: 'шаг скопирован', few: 'шага скопировано', many: 'шагов скопировано', other: 'шага скопировано', zero: 'шагов скопировано', two: 'шага скопировано' }[new Intl.PluralRules(locale('ru')).select(count)];
    return `${formatNumber(count, 3, 'ru')} ${noun}${dropped ? `. Снято зависимостей от невыбранных шагов: ${formatNumber(dropped, 3, 'ru')}` : ''}`;
  },
  copyUnconfirmed: 'Копирование не подтверждено: целевой Journey перечитан. Выбор сохранён; проверьте его перед повтором.',
  localChangesApplied: 'Ваши правки перенесены на перечитанный Journey',
  cloned: (deck: string) => `Journey скопирован в колоду «${deck}»`,
  imported: 'Шаблон импортирован',
  templateSaveUnconfirmed: 'Сохранение шаблона не подтверждено. Заполненные поля сохранены.',
  templateSaved: 'Шаблон сохранён в проекте',
  conflictText: 'Journey изменился в файлах и перечитан. Ваш ввод сохранён; автосохранение приостановлено.',
  applyMine: 'Применить мои правки',
  useFileVersion: 'Взять версию из файлов',
  rereadResult: 'Перечитать результат',
  retryAutosave: 'Повторить автосохранение',
  closeMessage: 'Закрыть сообщение',
  editorDescription: 'Редактор шагов, зон и шаблонов Journey колоды. Изменения сохраняются автоматически.',
  aboutAria: 'О Journey: название, описание, ссылка',
  aboutTitle: 'Название и описание Journey',
  metricsTitle: 'Метрики шагов: возвраты с приёмки, цикл, причины',
  metrics: 'Метрики',
  saveTemplateWaiting: 'Ожидаем автосохранение',
  saveTemplateTitle: 'Сохранить в каталоге проекта',
  journeyTitle: 'Название Journey',
  journeyDescription: 'Описание',
  deckJourney: 'Journey колоды',
  assetMixedOnly: 'Journey доступен для Asset и Mixed колод.',
  discardTitle: 'Изменения ещё не подтверждены',
  discardCreateDescription: 'Создание могло сохраниться на сервере. Перед повторным созданием проверьте Journey колоды. Выход уберёт локальный ввод.',
  discardDescription: 'Исправьте поля или разрешите конфликт, чтобы продолжить автосохранение.',
  continueEditing: 'Продолжить редактирование',
  discardChanges: 'Отбросить изменения',
});

type Destination = 'close' | 'catalog' | { journeyId: string };
interface CreateAttempt { deckId: string; previousIds: string[]; draft: JourneyDraft }

export function JourneyEditor({ catalog, deck, source, initialJourneyId, writable, pending, onEdit, onClose, onRestoreFocus }: {
  catalog: CatalogView; deck: CatalogDeck; source: DataSource; initialJourneyId?: string | null; writable: boolean; pending: boolean;
  onEdit: (action: CatalogAction) => Promise<boolean>; onClose: () => void; onRestoreFocus?: () => void;
}) {
  const t = useText(text);
  const introduction = useText(journeyIntroductionText);
  const journeys = (catalog.journeys ?? []).filter(journey => journey.deckId === deck.id);
  const initialJourney = journeys.find(journey => journey.id === initialJourneyId) ?? journeys[0] ?? null;
  const [base, setBase] = useState<JourneySnapshot>(() => ({ journey: initialJourney, manifestHash: catalog.manifestHash, draft: journeyDraft(initialJourney, deck, catalog.formatLanguage) }));
  const [draft, setDraft] = useState(() => journeyDraft(initialJourney, deck, catalog.formatLanguage));
  const [screen, setScreen] = useState<'editor' | 'catalog'>('editor');
  const [settings, setSettings] = useState(false);
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const [invalidStepText, setInvalidStepText] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [saveTemplate, setSaveTemplate] = useState(false);
  const [metricsOpen, setMetricsOpen] = useState(false);
  const [discardTo, setDiscardTo] = useState<Destination | null>(null);
  const [navigation, setNavigation] = useState<Destination | null>(null);
  const [saving, setSaving] = useState(false);
  const [operationBusy, setOperationBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [conflict, setConflict] = useState<JourneySnapshot | null>(null);
  const [unconfirmedCreate, setUnconfirmedCreate] = useState<CreateAttempt | null>(null);
  const mutation = useRef(false);
  const catalogBack = useRef<(() => void) | null>(null);
  const browseButton = useRef<HTMLButtonElement>(null);
  const latestCatalog = useRef(catalog);
  const latestDraft = useRef(draft);
  const latestBase = useRef(base);
  latestCatalog.current = catalog; latestDraft.current = draft; latestBase.current = base;
  const dirty = !sameDraft(draft, base.draft);
  const busy = pending || saving || operationBusy;
  const currentJourney = journeys.find(journey => journey.id === base.journey?.id);
  const operationJourney = currentJourney ?? base.journey;
  const operationBlocked = !!operationJourney?.pendingOperation && operationJourney.pendingOperation.state !== 'pending';
  const editable = writable && !operationBlocked && (deck.kind === 'asset' || deck.kind === 'mixed');
  const inspected = draft.steps.find(step => step.id === inspectedId);
  const invalid = draftError(draft, catalog);
  const cloneTargets = catalog.decks.filter(candidate => candidate.id !== deck.id && (candidate.kind === 'asset' || candidate.kind === 'mixed'));
  const locked = busy || !!unconfirmedCreate;
  let saveStatus = base.journey ? t.allSaved : t.addJourneyStep;
  if (operationJourney?.pendingOperation) saveStatus = t.unfinishedSave;
  else if (invalidStepText) saveStatus = t.localStepUnsaved;
  else if (!editable) saveStatus = t.readOnly;
  else if (conflict) saveStatus = t.conflictStatus;
  else if (unconfirmedCreate) saveStatus = t.createConfirmation;
  else if (error && dirty) saveStatus = t.autosavePaused;
  else if (invalid && dirty) saveStatus = t.fillForAutosave;
  else if (busy) saveStatus = t.saving;
  else if (dirty) saveStatus = t.waitingAutosave;
  // Refresh metrics when this Journey's cards or their states change.
  const metricsRevision = base.journey ? catalog.cards.filter(card => card.journey?.journeyId === base.journey!.id).map(card => `${card.id}:${card.state}`).join('|') : '';
  const { metrics, error: metricsError, loading: metricsLoading, retry: retryMetrics } = useJourneyMetrics(source, base.journey?.id ?? null, metricsRevision);
  const metricsByStep = useMemo(() => new Map((metrics?.steps ?? []).map(step => [step.stepId, step])), [metrics]);
  const metricsAvailable = Boolean(base.journey);
  const duplicateTargets = (catalog.journeys ?? []).map(journey => ({ id: journey.id, title: journey.id === base.journey?.id ? t.thisJourney : `${catalog.decks.find(target => target.id === journey.deckId)?.title ?? journey.deckId} · ${journey.title}`, disabled: journey.steps.length + selectedIds.length > 30 }));
  for (const target of cloneTargets.filter(target => !catalog.journeys?.some(journey => journey.deckId === target.id))) duplicateTargets.push({ id: `deck:${target.id}`, title: t.newJourney(target.title), disabled: false });

  function replaceDraft(next: JourneyDraft) { latestDraft.current = next; setDraft(next); }
  function replaceBase(next: JourneySnapshot) { latestBase.current = next; setBase(next); }
  function snapshot(journey: CatalogJourney | null, manifestHash: string): JourneySnapshot { return { journey, manifestHash, draft: journeyDraft(journey, deck, catalog.formatLanguage) }; }
  function acceptSnapshot(journey: CatalogJourney | null, manifestHash: string) {
    const next = snapshot(journey, manifestHash);
    replaceBase(next); replaceDraft(next.draft); setConflict(null); setError(''); setSelectedIds([]);
  }

  useEffect(() => {
    if (busy || mutation.current || unconfirmedCreate || conflict) return;
    const changed = base.journey && (!currentJourney || currentJourney.version >= base.journey.version && currentJourney.fileHash !== base.journey.fileHash);
    // 2026-11-04: an open step editor owns its text. A remote refresh must
    // not change its props while the editor still holds the old text.
    if (changed && (dirty || inspectedId)) { setConflict(snapshot(currentJourney ?? null, catalog.manifestHash)); return; }
    if (changed) { acceptSnapshot(currentJourney ?? null, catalog.manifestHash); return; }
    if (catalog.manifestHash !== base.manifestHash) replaceBase({ ...base, manifestHash: catalog.manifestHash });
  }, [catalog, busy, dirty, conflict, unconfirmedCreate, inspectedId]);

  useDesktopDirty(dirty || !!unconfirmedCreate || invalidStepText);
  useEffect(() => {
    if (!dirty && !unconfirmedCreate && !invalidStepText) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, unconfirmedCreate, invalidStepText]);

  useEffect(() => {
    if (!dirty || !editable || busy || conflict || error || unconfirmedCreate || invalid || screen !== 'editor') return;
    const timer = window.setTimeout(() => { void save(); }, 450);
    return () => window.clearTimeout(timer);
  }, [draft, base, editable, busy, conflict, error, unconfirmedCreate, invalid, screen]);

  useEffect(() => {
    if (navigation && !dirty && !busy && !conflict && !unconfirmedCreate) navigate(navigation);
  }, [navigation, dirty, busy, conflict, unconfirmedCreate]);

  async function readCatalog(): Promise<CatalogView> {
    return readFreshCatalog(source);
  }

  async function exclusive(work: () => Promise<boolean>, reportFailure = true): Promise<boolean> {
    if (mutation.current || pending || !editable) return false;
    mutation.current = true; setSaving(true); setError('');
    try { return await work(); }
    catch (failure) {
      if (reportFailure) setError(failureMessage(failure, t.saveFailed));
      try { await readCatalog(); } catch { /* 2026-11-10: preserve the original server explanation when rereading fails. */ }
      if (!reportFailure) throw failure;
      return false;
    }
    finally { mutation.current = false; setSaving(false); }
  }

  function findCreated(fresh: CatalogView, attempt: CreateAttempt): CatalogJourney | undefined {
    const matches = (fresh.journeys ?? []).filter(journey => journey.deckId === attempt.deckId && !attempt.previousIds.includes(journey.id) && sameDraft(journeyDraft(journey, deck, catalog.formatLanguage), attempt.draft));
    return matches.length === 1 ? matches[0] : undefined;
  }

  async function createJourney(targetDeck: CatalogDeck, next: JourneyDraft, fresh: CatalogView): Promise<CatalogJourney | null> {
    const initial = { ...next, description: '', zones: journeyDraft(null, targetDeck, catalog.formatLanguage).zones, steps: next.steps.map(step => ({ ...step, zoneId: 'default' })) };
    const attempt = { deckId: targetDeck.id, previousIds: (fresh.journeys ?? []).map(journey => journey.id), draft: initial };
    // 2026-11-04: create has no client identity. Never replay an unconfirmed request.
    setUnconfirmedCreate(attempt);
    await onEdit({ action: 'create-journey', manifestHash: fresh.manifestHash, deckId: targetDeck.id, title: initial.title, steps: initial.steps });
    const refreshed = await readCatalog();
    const created = findCreated(refreshed, attempt);
    if (!created) { setError(t.createUnconfirmed); return null; }
    setUnconfirmedCreate(null);
    if (targetDeck.id === deck.id) replaceBase(snapshot(created, refreshed.manifestHash));
    if (!sameDraft(journeyDraft(created, targetDeck, catalog.formatLanguage), next) && targetDeck.id !== deck.id) {
      await onEdit({ action: 'update-journey', manifestHash: refreshed.manifestHash, journeyId: created.id, journeyHash: created.fileHash, ...next });
      const complete = (await readCatalog()).journeys?.find(journey => journey.id === created.id);
      if (!complete || !sameDraft(journeyDraft(complete, targetDeck, catalog.formatLanguage), next)) throw new Error(t.zonesUnconfirmed(targetDeck.title));
      return complete;
    }
    return created;
  }

  async function verifyCreate() {
    if (!unconfirmedCreate) return;
    await exclusive(async () => {
      const fresh = await readCatalog();
      const created = findCreated(fresh, unconfirmedCreate);
      if (!created) { setError(t.createStillUnconfirmed); return false; }
      if (created.deckId === deck.id) replaceBase(snapshot(created, fresh.manifestHash));
      setUnconfirmedCreate(null); setNotice(t.createConfirmed); return true;
    });
  }

  async function save(): Promise<boolean> {
    if (conflict || unconfirmedCreate || mutation.current) return false;
    const next = latestDraft.current;
    const problem = draftError(next, latestCatalog.current);
    if (problem) { setError(problem); return false; }
    const sent = normalizedDraft(next);
    const before = latestBase.current;
    if (sameDraft(sent, before.draft)) return true;
    return exclusive(async () => {
      if (!before.journey) return Boolean(await createJourney(deck, sent, latestCatalog.current));
      await onEdit({ action: 'update-journey', manifestHash: before.manifestHash, journeyId: before.journey.id, journeyHash: before.journey.fileHash, ...sent });
      const fresh = await readCatalog();
      const saved = fresh.journeys?.find(journey => journey.id === before.journey!.id) ?? null;
      if (saved && !saved.pendingOperation && sameDraft(journeyDraft(saved, deck, catalog.formatLanguage), sent)) {
        // Keep the live draft: typing can continue while the request is pending.
        replaceBase(snapshot(saved, fresh.manifestHash)); return true;
      }
      if (!saved || saved.fileHash !== before.journey.fileHash || fresh.manifestHash !== before.manifestHash) setConflict(snapshot(saved, fresh.manifestHash));
      else setError(t.autosaveUnconfirmed);
      return false;
    });
  }

  function changeDraft(patch: Partial<JourneyDraft>) {
    const next = { ...latestDraft.current, ...patch };
    if (JSON.stringify(next) === JSON.stringify(latestDraft.current)) return;
    replaceDraft(next); setNotice('');
    if (!unconfirmedCreate) setError('');
  }

  function addStep(zoneId: string) {
    const target = catalog.decks.find(candidate => candidate.kind === 'task' || candidate.kind === 'mixed');
    const id = nextJourneyId('step', draft.steps);
    changeDraft({ steps: [...draft.steps, { id, title: '', markdown: '', deckId: target?.id ?? '', owner: null, dependsOn: [], effort: null, priority: null, zoneId }] });
    setSelectedIds([]); setInspectedId(id);
  }

  function deleteSteps(ids: string[]) {
    if (draft.steps.every(step => ids.includes(step.id))) { setError(t.lastStep); return; }
    changeDraft({ steps: draft.steps.filter(step => !ids.includes(step.id)).map(step => ({ ...step, dependsOn: step.dependsOn.filter(id => !ids.includes(id)) })) });
    setSelectedIds([]);
    if (inspectedId && ids.includes(inspectedId)) setInspectedId(null);
  }

  function chainSteps() {
    const selected = visibleSteps(draft).filter(step => selectedIds.includes(step.id));
    const predecessor = new Map(selected.slice(1).map((step, index) => [step.id, selected[index]!.id]));
    const steps = draft.steps.map(step => ({ ...step, dependsOn: [...new Set([...step.dependsOn, ...(predecessor.has(step.id) ? [predecessor.get(step.id)!] : [])])] }));
    if (dependencyCycle(steps)) { setNotice(t.cycleNotice); return; }
    changeDraft({ steps }); setNotice(t.chainNotice(selected.length));
  }

  async function duplicateSteps(targetId: string) {
    if (locked || dirty || conflict || !selectedIds.length) return;
    const target = catalog.journeys?.find(journey => journey.id === targetId);
    const targetDeck = target ? catalog.decks.find(candidate => candidate.id === target.deckId) : catalog.decks.find(candidate => `deck:${candidate.id}` === targetId);
    if (!targetDeck) return;
    const result = duplicateJourneySteps(draft, journeyDraft(target ?? null, targetDeck, catalog.formatLanguage), selectedIds);
    const problem = draftError(result.draft, catalog);
    if (problem) { setError(problem); return; }
    const message = t.duplicateMessage(selectedIds.length, result.dropped);
    if (target?.id === base.journey?.id) { changeDraft(result.draft); setSelectedIds(result.ids); setNotice(message); return; }
    await exclusive(async () => {
      if (target) {
        await onEdit({ action: 'update-journey', manifestHash: catalog.manifestHash, journeyId: target.id, journeyHash: target.fileHash, ...result.draft });
        const fresh = await readCatalog();
        const updated = fresh.journeys?.find(journey => journey.id === target.id);
        if (!updated || !sameDraft(journeyDraft(updated, targetDeck, catalog.formatLanguage), result.draft)) { setError(t.copyUnconfirmed); return false; }
      } else if (!await createJourney(targetDeck, result.draft, catalog)) return false;
      setNotice(`${message} → ${targetDeck.title}`); return true;
    });
  }

  function navigate(destination: Destination) {
    setNavigation(null); setDiscardTo(null); setError(''); setSelectedIds([]);
    if (destination === 'close') { onClose(); return; }
    if (destination === 'catalog') { setScreen('catalog'); return; }
    acceptSnapshot(journeys.find(journey => journey.id === destination.journeyId) ?? null, catalog.manifestHash);
    setNotice(''); setInspectedId(null);
  }

  function requestNavigation(destination: Destination) {
    if (invalidStepText) return;
    if (unconfirmedCreate) { setDiscardTo(destination); return; }
    if (conflict || invalid && dirty || error && dirty) { setDiscardTo(destination); return; }
    if (dirty || busy || mutation.current) { setNavigation(destination); if (!busy) void save(); return; }
    navigate(destination);
  }
  function backFromCatalog() {
    setScreen('editor'); setError('');
    window.requestAnimationFrame(() => moveFocus(browseButton.current));
  }

  function applyLocalChanges() {
    if (!conflict?.journey) return;
    setInspectedId(null);
    replaceDraft(mergeJourneyDraft(base.draft, latestDraft.current, conflict.draft));
    replaceBase(conflict); setConflict(null); setError(''); setNotice(t.localChangesApplied);
  }

  async function cloneTo(target: CatalogDeck) {
    if (!base.journey || dirty || locked || conflict) return;
    await exclusive(async () => {
      const created = await createJourney(target, base.draft, catalog);
      if (created) setNotice(t.cloned(target.title));
      return Boolean(created);
    });
  }

  async function importTemplate(template: CatalogJourneyTemplate, mode: 'add' | 'replace', roleMapping: Record<string, JourneyRoleTarget>) {
    return exclusive(async () => {
      const previousIds = journeys.map(journey => journey.id);
      const saved = await onEdit({ action: 'import-journey-template', manifestHash: base.manifestHash, deckId: deck.id, templateId: template.id, templateSource: template.source, templateHash: template.fileHash, mode, journeyId: base.journey?.id ?? null, journeyHash: base.journey?.fileHash ?? null, roleMapping });
      const fresh = await readCatalog();
      const candidates = fresh.journeys?.filter(journey => journey.deckId === deck.id && (base.journey ? journey.id === base.journey.id && journey.fileHash !== base.journey.fileHash : !previousIds.includes(journey.id))) ?? [];
      if (!saved || candidates.length !== 1) return false;
      acceptSnapshot(candidates[0]!, fresh.manifestHash); setScreen('editor'); setNotice(t.imported); return true;
    }, false);
  }

  async function saveAsTemplate(metadata: { title: string; description: string; category: string; tags: string[] }) {
    if (!base.journey || dirty) return false;
    const journey = base.journey;
    return exclusive(async () => {
      const previousIds = new Set((catalog.journeyTemplates ?? []).filter(template => template.source === 'project').map(template => template.id));
      await onEdit({ action: 'save-journey-template', manifestHash: base.manifestHash, journeyId: journey.id, journeyHash: journey.fileHash, ...metadata });
      const fresh = await readCatalog();
      if (!fresh.journeyTemplates?.some(template => template.source === 'project' && !previousIds.has(template.id) && template.title === metadata.title)) { setError(t.templateSaveUnconfirmed); return false; }
      setSaveTemplate(false); setNotice(t.templateSaved); return true;
    });
  }

  const conflictFeedback = conflict && <div className="journey-editor-error" role="alert">{t.conflictText}
    <Button variant="outline" size="sm" disabled={busy || invalidStepText || !conflict.journey} onClick={applyLocalChanges}>{t.applyMine}</Button>
    <Button variant="ghost" size="sm" disabled={busy || invalidStepText} onClick={() => { setInspectedId(null); acceptSnapshot(conflict.journey, conflict.manifestHash); }}>{t.useFileVersion}</Button></div>;
  const errorFeedback = error && <div className="journey-editor-error" role="alert">{error}
    {unconfirmedCreate && <Button variant="outline" size="sm" disabled={busy} onClick={() => void verifyCreate()}>{t.rereadResult}</Button>}
    {dirty && !conflict && !unconfirmedCreate && screen === 'editor' && <Button variant="outline" size="sm" disabled={busy} onClick={() => { setError(''); void save(); }}>{t.retryAutosave}</Button>}
    {!dirty && !unconfirmedCreate && <Button variant="ghost" size="sm" onClick={() => setError('')}>{t.closeMessage}</Button>}
  </div>;
  const operationFeedback = operationJourney && <JourneyOperationNotice key={operationJourney.id} journey={operationJourney} catalog={catalog} source={source}
    writable={writable} disabled={busy} onEdit={onEdit} onBusyChange={setOperationBusy} />;

  return <Dialog.Root open onOpenChange={open => { if (!open) requestNavigation('close'); }}><Dialog.Portal>
    <Dialog.Overlay ref={prepareEntrance} className="journey-editor-overlay" />
      <Dialog.Content ref={prepareEntrance} className="journey-editor-dialog dialog-panel" aria-busy={busy} onCloseAutoFocus={event => { event.preventDefault(); onRestoreFocus?.(); }}
      onEscapeKeyDown={event => { event.preventDefault(); if (screen === 'catalog') { if (!(event.target instanceof Element && event.target.closest('.confirm-strip'))) catalogBack.current?.(); return; } if (selectedIds.length) setSelectedIds([]); else requestNavigation('close'); }} onPointerDownOutside={event => event.preventDefault()}
      onKeyDown={event => {
        if (screen !== 'editor' || inspectedId || !editable || (event.target instanceof HTMLElement && event.target.closest('input,textarea,select,[contenteditable="true"],[role="menu"]'))) return;
        if (primaryModifierPressed(event) && event.code === 'KeyA') { event.preventDefault(); event.stopPropagation(); setSelectedIds(draft.steps.map(step => step.id)); }
      }}>
      <Dialog.Title className="visually-hidden">{t.prepareJourney}{deck.title}</Dialog.Title>
      <Dialog.Description className="visually-hidden">{t.editorDescription}</Dialog.Description>
      <div className="journey-editor-shell">
        {screen === 'editor' ? <>
          {selectedIds.length > 0 ? <JourneyBulkActions count={selectedIds.length} total={draft.steps.length} disabled={locked || !editable || dirty || !!conflict} targets={duplicateTargets} onSelectAll={() => setSelectedIds(draft.steps.map(step => step.id))} onClear={() => setSelectedIds([])} onChain={chainSteps} onDuplicate={target => void duplicateSteps(target)} onDelete={() => deleteSteps(selectedIds)} /> :
          <header className="journey-editor-heading dialog-head"><h2 className="dialog-title">{t.prepareJourney}<span className="journey-deck-chip" title={deck.title}><span className="journey-deck-icon" aria-hidden="true"><Layers size={11} /></span><span className="journey-deck-name">{deck.title}</span></span></h2>
            <Button variant="ghost" size="icon" className="journey-editor-info" aria-pressed={settings} aria-label={t.aboutAria} title={t.aboutTitle} onClick={() => setSettings(previous => !previous)}><Info size={15} /></Button>
            <div className="journey-editor-actions">{metricsAvailable && <Button variant="outline" size="sm" className="journey-metrics-toggle" aria-pressed={metricsOpen} title={t.metricsTitle} onClick={() => setMetricsOpen(previous => !previous)}><ChartNoAxesColumn size={13} />{t.metrics}</Button>}
              <Button ref={browseButton} variant="outline" size="sm" className="journey-browse-button" disabled={locked} onClick={() => requestNavigation('catalog')}><LayoutGrid size={13} />{t.browseTemplates}</Button>
              <Button variant="outline" size="sm" disabled={locked || !editable || !!operationJourney?.pendingOperation || !base.journey || dirty || !!conflict} title={dirty ? t.saveTemplateWaiting : t.saveTemplateTitle} onClick={() => setSaveTemplate(true)}>{t.saveAsTemplate}</Button>
              <DropdownMenu.Root><DropdownMenu.Trigger asChild><Button variant="ghost" size="sm" disabled={locked || !editable || !base.journey || dirty || !!conflict || cloneTargets.length === 0}>{t.cloneJourney}<ChevronDown size={13} /></Button></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content className="journey-editor-menu" align="end" sideOffset={6}>
                <DropdownMenu.Label className="journey-editor-menu-label">{t.copyJourney}</DropdownMenu.Label>
                {cloneTargets.map(target => <DropdownMenu.Item key={target.id} onSelect={() => void cloneTo(target)}><Copy size={13} />{target.title}</DropdownMenu.Item>)}
              </DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>
            </div><Button variant="ghost" size="icon" className="journey-editor-close" aria-label={t.closeJourney} onClick={() => requestNavigation('close')}><X size={18} /></Button>
          </header>}
          <div className="journey-editor-body">
            {!inspected && operationFeedback}
            {settings && <div className="journey-editor-settings"><label>{t.journeyTitle}<input className="control-field" maxLength={120} value={draft.title} disabled={!editable} onChange={event => changeDraft({ title: event.target.value })} /></label><label>{t.journeyDescription}<textarea className="control-field" rows={2} maxLength={2000} value={draft.description} disabled={!editable} onChange={event => changeDraft({ description: event.target.value })} /></label>
              {journeys.length > 1 && <label>{t.deckJourney}<select className="control-field" value={base.journey?.id ?? ''} disabled={locked} onChange={event => requestNavigation({ journeyId: event.target.value })}>{journeys.map(journey => <JourneyOption key={journey.id} journey={journey} />)}</select>{operationJourney && <JourneyOperationBadge journey={operationJourney} />}</label>}
              {base.journey && <CatalogReferenceLink kind="p" id={base.journey.id} source={source} />}</div>}
            {!editable && !operationBlocked && <p className="journey-editor-notice">{writable ? t.assetMixedOnly : currentSourceLabels().projectReadOnly}</p>}
            {draft.steps.length === 0 && <p className="journey-editor-intro">{introduction.explanation}</p>}
            {!inspected && conflictFeedback}
            {metricsOpen && metricsAvailable && <JourneyMetricsTable metrics={metrics} error={metricsError} loading={metricsLoading} onRetry={retryMetrics} steps={draft.steps} />}
            <JourneyZones zones={draft.zones} steps={draft.steps} decks={catalog.decks} disabled={!editable || !!unconfirmedCreate} selectedIds={selectedIds} onSelectionChange={setSelectedIds} metrics={metricsByStep} onZonesChange={zones => changeDraft({ zones })} onStepsChange={steps => changeDraft({ steps })} onOpen={setInspectedId} onAdd={addStep} />
            <button type="button" className="journey-add-zone control" disabled={!editable || !!unconfirmedCreate || draft.zones.length >= 20} onClick={() => changeDraft({ zones: [...draft.zones, { id: nextJourneyId('zone', draft.zones), title: formatText[catalog.formatLanguage].newZoneTitle }] })}><Plus size={14} />{t.addZone}</button>
          </div>
        </> : <JourneyCatalog catalog={catalog} deck={deck} journey={operationJourney} source={source} disabled={locked || !writable} onEdit={onEdit} onOperationBusyChange={setOperationBusy} onImport={importTemplate} onBack={backFromCatalog} backRef={catalogBack} />}
        {screen === 'catalog' && <Button className="journey-catalog-close" variant="ghost" size="icon" aria-label={t.closeJourney} onClick={() => requestNavigation('close')}><X size={18} /></Button>}
        {!inspected && errorFeedback}
        {screen === 'editor' && <footer className="journey-editor-footer"><span role="status">{saveStatus}{busy && <LoaderCircle size={14} className="spin" />}</span>
          {invalid && dirty ? <span className="journey-save-help">{invalid}</span> : notice && <span className="journey-save-help" role="status">{notice}</span>}
        </footer>}
      </div>
    </Dialog.Content></Dialog.Portal>
    {inspected && <JourneyStepPanel key={inspected.id} step={inspected} steps={draft.steps} catalog={catalog} source={source} path={base.journey?.path.replace(/index\.md$/, `steps/${inspected.id}.md`)} disabled={!editable}
      feedback={<>{operationFeedback}{conflictFeedback}{errorFeedback}</>} saveStatus={saveStatus + (invalid && dirty ? `. ${invalid}` : '')} onLocalUnsavedChange={setInvalidStepText}
      onChange={patch => changeDraft({ steps: latestDraft.current.steps.map(step => step.id === inspected.id ? { ...step, ...patch } : step) })} onClose={() => setInspectedId(null)} onRemove={() => deleteSteps([inspected.id])} />}
    {saveTemplate && base.journey && <JourneySaveTemplateDialog journey={base.journey} categories={[...new Set((catalog.journeyTemplates ?? []).map(template => template.category))]} disabled={busy} onSave={saveAsTemplate} onClose={() => { if (!busy) setSaveTemplate(false); }} />}
    <Dialog.Root open={discardTo !== null} onOpenChange={open => { if (!open) setDiscardTo(null); }}><Dialog.Portal><Dialog.Overlay className="journey-confirm-overlay" /><Dialog.Content className="journey-confirm-dialog dialog-panel">
      <header className="dialog-head"><Dialog.Title className="dialog-title">{t.discardTitle}</Dialog.Title></header><Dialog.Description className="dialog-body">{unconfirmedCreate ? t.discardCreateDescription : t.discardDescription}</Dialog.Description><div className="dialog-foot"><Button variant="ghost" onClick={() => { setDiscardTo(null); setNavigation(null); }}>{t.continueEditing}</Button><Button onClick={() => { if (discardTo) { replaceDraft(base.draft); setConflict(null); setUnconfirmedCreate(null); navigate(discardTo); } }}>{t.discardChanges}</Button></div>
    </Dialog.Content></Dialog.Portal></Dialog.Root>
  </Dialog.Root>;
}
