import { defineText, locale, useLang, useText } from '../i18n.ts';
import { kindLabel, priorityLabel, stateLabel } from '../locales/common.ts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownWideNarrow, Info, MoreHorizontal, Pencil, Pin, PinOff, Plus, Search, Trash2 } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import type { CatalogCard, CatalogView, MilestoneRecord, RunRecord } from '../../src/catalog-contracts.ts';
import type { BulkChange } from '../../src/bulk-contracts.ts';
import type { WorkspaceSnapshot } from '../../src/workspace-contracts.ts';
import { boardColumns } from '../../src/catalog-contracts.ts';
import { PriorityIcon } from './PriorityIcon.tsx';
import { buildCatalogLookups } from '../catalog-lookups.ts';
import { currentMember } from '../current-member.ts';
import type { CatalogAction } from '../useCatalog.ts';
import { CatalogCardTile } from './CatalogCardTile.tsx';
import { memberForOwner } from './CardOwnerAvatar.tsx';
import { MilestoneForm, PlanningPopover } from './PlanningPopover.tsx';
import { useConfirmStrip } from './ConfirmStrip.tsx';
import { SelectionToolbar, useCardSelection } from './CardSelection.tsx';
import { CardComposer } from './CardComposer.tsx';
import { PlanningStats } from './PlanningStats.tsx';
import { PlanningDetails } from './PlanningDetails.tsx';
import { RunControls } from './RunControls.tsx';
import { statusClass } from './StatusMenu.tsx';
import { metrics } from '../planning-metrics.ts';
import { planningGroupings, usePlanningPreference, type PlanningGrouping } from '../planning-preferences.ts';
import { moveFocus } from '../focus.ts';
import { orderedRunChoices, runChoiceLabel } from '../run-label.ts';
import { Button } from './ui/button.tsx';
import type { SavePlanning } from './TimelineView.tsx';
import { EmptyState } from './EmptyState.tsx';
// 2026-11-10: the Timeline card scope uses the open deck's action rail, so both rails share one button style.
import '../deck-workbench.css';

const text = defineText({
  progress: (done: string, tasks: string) => `${done} of ${tasks} tasks done`,
  noDeck: "No deck",
  noRun: "No Run",
  noMilestone: "No Milestone",
  noPriority: "No priority",
  noOwner: "Unassigned",
  cards: "Cards",
  unpin: "Unpin Milestone",
  pin: "Pin Milestone to Hand",
  deleteMilestone: "Delete Milestone",
  editMilestone: "Edit Milestone",
  editMilestoneTitle: "Edit Milestone",
  closeEdit: "Close",
  myCards: "My cards",
  myCardsHint: "Show only the cards you own",
  search: "Search cards in plan",
  searchPlaceholder: "Search cards…",
  remainingEffort: 'Effort left',
  groupEffort: 'Known Effort · done / total', unestimated: 'Without estimates', effortShort: 'Effort',
  attachFailed: "Card created, but the assignment was not saved.",
  attaching: "Assigning the created card…",
  retry: "Retry assignment",
  actions: "Plan actions",
  addToPlan: "Add card to plan",
  addCard: "Add card",
  information: "Details and statistics",
  backToCards: 'Back to cards',
  grouping: "Grouping",
  groupingCards: "Group cards in plan",
  state: "State",
  priority: "Priority",
  owner: "Owner",
  deck: "Deck",
  cardCount: (count: number) => `${new Intl.NumberFormat(locale("en")).format(count)} ${new Intl.PluralRules(locale("en")).select(count) === "one" ? "card" : "cards"}`,
  noResults: "No cards match this search.",
  filteredTitle: "No matching cards",
  filteredHint: "No cards match the current search or filters.",
  empty: "No cards in this plan yet.",
  emptyHint: "Cards assigned to this plan will appear here.",
  confirmDelete: (title: string) => `Delete Milestone “${title}”?`,
  deleteDescription: (active: number, total: string, pinned: boolean) => `${active > 0 ? `This Milestone has ${new Intl.NumberFormat(locale("en")).format(active)} ${new Intl.PluralRules(locale("en")).select(active) === "one" ? "unarchived card" : "unarchived cards"}. ` : ""}All its cards (${total}), including Archive and Trash, will be unlinked. The cards will stay in the project.${pinned ? " The Milestone will be unpinned from Hand." : ""}`,
  cancel: "Cancel",
  deleting: "Deleting…",
  uiManual: "Manual",
  uiRun: "Run",
  uiMilestone: "Milestone"
}, {
  progress: (done: string, tasks: string) => `${done} из ${tasks} задач принято`,
  noDeck: "Без колоды",
  noRun: "Без Run",
  noMilestone: "Без Milestone",
  noPriority: "Без приоритета",
  noOwner: "Без исполнителя",
  cards: "Карточки",
  unpin: "Открепить Milestone",
  pin: "Закрепить Milestone в Hand",
  deleteMilestone: "Удалить Milestone",
  editMilestone: "Изменить Milestone",
  editMilestoneTitle: "Изменить Milestone",
  closeEdit: "Закрыть",
  myCards: "Мои карточки",
  myCardsHint: "Показать только ваши карточки",
  search: "Поиск карточек в плане",
  searchPlaceholder: "Поиск карточек…",
  remainingEffort: 'Осталось по оценке',
  groupEffort: 'Известная оценка · принято / всего', unestimated: 'Без оценки',
  effortShort: 'Оценка',
  attachFailed: "Карточка создана, но привязка не сохранилась.",
  attaching: "Привязываем созданную карточку…",
  retry: "Повторить привязку",
  actions: "Действия плана",
  addToPlan: "Добавить карточку в план",
  addCard: "Добавить карточку",
  information: "Сведения и статистика",
  backToCards: 'К карточкам',
  grouping: "Группировка",
  groupingCards: "Группировка карточек плана",
  state: "Состояние",
  priority: "Приоритет",
  owner: "Исполнитель",
  deck: "Колода",
  cardCount: (count: number) => `Карточек: ${new Intl.NumberFormat(locale("ru")).format(count)}`,
  noResults: "Нет карточек по этому запросу.",
  filteredTitle: "Карточки не найдены",
  filteredHint: "Нет карточек по текущему запросу или фильтрам.",
  empty: "В плане ещё нет карточек.",
  emptyHint: "Здесь появятся карточки, добавленные в план.",
  confirmDelete: (title: string) => `Удалить Milestone «${title}»?`,
  deleteDescription: (active: number, total: string, pinned: boolean) => `${active > 0 ? `В Milestone ${new Intl.NumberFormat(locale("ru")).format(active)} карточек вне архива. ` : ""}Связь с Milestone будет снята со всех его карточек (${total}), включая архив и корзину. Карточки останутся в проекте.${pinned ? " Закрепление в Hand будет снято." : ""}`,
  cancel: "Отмена",
  deleting: "Удаляем…",
  uiManual: "Вручную",
  uiRun: "Run",
  uiMilestone: "Milestone"
});


export type PlanningTarget = { kind: 'run' | 'milestone' | 'dueDate'; id: string };
export type PlanningPlan = { kind: 'run'; record: RunRecord } | { kind: 'milestone'; record: MilestoneRecord };
function GroupEffort({ cards }: { cards: CatalogCard[] }) {
  const t = useText(text);
  const lang = useLang();
  const summary = metrics(cards);
  const amount = (value: number) => new Intl.NumberFormat(locale(lang)).format(value);
  return <span className="planning-group-effort" title={t.groupEffort} aria-label={`${t.groupEffort}: ${amount(summary.doneEffort)} / ${amount(summary.effort)}; ${t.unestimated}: ${amount(summary.unestimated)}`}>
    <span>{t.effortShort}</span> <span className="page-number">{amount(summary.doneEffort)} / {amount(summary.effort)}</span>
    {summary.unestimated > 0 && <span>{t.unestimated}: <span className="page-number">{amount(summary.unestimated)}</span></span>}
  </span>;
}

export function PlanningProgress({ cards }: { cards: CatalogCard[] }) {
  const t = useText(text);
  const lang = useLang();
  const amount = (value: number) => new Intl.NumberFormat(locale(lang)).format(value);
  const summary = metrics(cards);
  return <span className="planning-progress" role="img" aria-label={t.progress(amount(summary.done), amount(summary.tasks))}>
    {boardColumns.map(column => {
      const count = cards.filter(card => card.kind === 'task' && (card.state ?? 'not-started') === column.id).length;
      return count > 0 && <span key={column.id} className={`status-${statusClass(column.id)}`} style={{ width: `${count / Math.max(1, summary.tasks) * 100}%` }} />;
    })}
  </span>;
}

/** Shared open collection for Run, Milestone and personal due dates, 2026-11-04. */
export function PlanningScope({ title, subtitle, target, retainedPlan, cards, catalog, snapshot, pending, onEdit, onOpenCard, onLockChange, onDirtyChange, onPlanningEdit, planningError, onDeleted }: {
  title: string; subtitle: string; target?: PlanningTarget; retainedPlan?: PlanningPlan;
  cards: CatalogCard[]; catalog: CatalogView; snapshot: WorkspaceSnapshot; pending: boolean;
  onEdit: (action: CatalogAction) => Promise<boolean>; onOpenCard: (id: string) => void;
  onLockChange: (locked: boolean) => void;
  onDirtyChange: (dirty: boolean) => void;
  onPlanningEdit?: SavePlanning; planningError?: string | null; onDeleted?: () => void;
}) {
  const t = useText(text);
  const lang = useLang();
  const amount = (value: number) => new Intl.NumberFormat(locale(lang)).format(value);
  const preferenceKey = `deckmate-planning:${JSON.stringify([catalog.rootIdentity, snapshot.source, target?.kind ?? 'dueDate', target?.id ?? title])}`;
  const [informationPreference, setInformationPreference] = usePlanningPreference(`${preferenceKey}:information`, ['open', 'closed'], 'closed');
  const information = informationPreference === 'open';
  const setInformation = (value: boolean) => setInformationPreference(value ? 'open' : 'closed');
  const informationButton = useRef<HTMLButtonElement>(null);
  const [composing, setComposing] = useState(false);
  const [composerDirty, setComposerDirty] = useState(false);
  const [detailsDirty, setDetailsDirty] = useState(false);
  const [runControlsOpen, setRunControlsOpen] = useState(false);
  const [runControlsDirty, setRunControlsDirty] = useState(false);
  const [query, setQuery] = useState('');
  // «My cards»: the plan's cards owned by the viewer, on top of the search (2026-11-05).
  const [mine, setMine] = useState(false);
  const [editAnchor, setEditAnchor] = useState<HTMLElement | null>(null);
  const [editDirty, setEditDirty] = useState(false);
  // Closing the edit form with changes asks through the strip in the popover instead of window.confirm (2026-11-05).
  const editStrip = useConfirmStrip();
  const [grouping, setGrouping] = usePlanningPreference(`${preferenceKey}:grouping`, planningGroupings, 'manual');
  const [ordering, setOrdering] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [attachFailed, setAttachFailed] = useState(false);
  const [deletion, setDeletion] = useState<CatalogView | null>(null);
  const attaching = useRef(false);
  const activeCards = useMemo(() => cards.filter(card => !card.archived && !card.deleted), [cards]);
  const viewer = currentMember(catalog.members ?? []);
  const visible = useMemo(() => activeCards.filter(card => (!mine || Boolean(viewer) && memberForOwner(card.owner ?? null, catalog.members ?? [])?.id === viewer?.id)
    && [card.title, card.owner, card.version].join(' ').toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru'))), [activeCards, query, mine, viewer, catalog.members]);
  const lookups = useMemo(() => buildCatalogLookups(catalog.cards, catalog.subCardOrder), [catalog]);
  const savedRun = target?.kind === 'run' ? catalog.runs?.find(item => item.id === target.id) : undefined;
  const savedMilestone = target?.kind === 'milestone' ? catalog.milestones?.find(item => item.id === target.id) : undefined;
  const run = savedRun ?? (retainedPlan?.kind === 'run' ? retainedPlan.record : undefined);
  const summary = run?.finishedAt && run.statistics ? run.statistics : metrics(activeCards);
  const milestone = savedMilestone ?? (retainedPlan?.kind === 'milestone' ? retainedPlan.record : undefined);
  const missingPlan = Boolean(target && !savedRun && !savedMilestone);
  const writable = snapshot.source === 'sandbox' && snapshot.writable;
  const pinned = target?.kind === 'milestone' && catalog.pinnedMilestoneId === target.id;
  const affectedCards = deletion?.cards.filter(card => card.milestone === target?.id) ?? [];
  const unarchivedCount = affectedCards.filter(card => !card.archived && !card.deleted).length;
  const draftOpen = composerDirty || detailsDirty || editDirty;
  const mutationDisabled = !writable || pending || draftOpen || runControlsOpen || missingPlan || Boolean(createdId);
  useEffect(() => { onLockChange(draftOpen || runControlsOpen || Boolean(deletion) || Boolean(createdId) || pending); }, [draftOpen, runControlsOpen, deletion, createdId, pending, onLockChange]);
  useEffect(() => () => onLockChange(false), [onLockChange]);
  useEffect(() => { onDirtyChange(draftOpen || runControlsDirty); }, [draftOpen, runControlsDirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  function closeComposer() { setComposing(false); setComposerDirty(false); }

  async function createInPlan(action: CatalogAction): Promise<boolean> {
    if (missingPlan || !writable || pending) return false;
    const saved = await onEdit(action);
    if (saved && action.action === 'create-card' && target) {
      setCreatedId(action.cardId);
      setAttachFailed(false);
    }
    return saved;
  }

  async function apply(change: BulkChange, chosen = selection): Promise<boolean> {
    if (!chosen.length) return false;
    return onEdit({ action: 'bulk-edit-cards', optionsHash: catalog.optionsHash ?? '',
      cards: chosen.map(card => ({ cardId: card.id, sourceHash: card.sourceHash })), change });
  }

  // 2026-11-04: two guarded operations; retry assignment of the same card rather than creating a duplicate.
  async function attachCreated() {
    const card = catalog.cards.find(candidate => candidate.id === createdId);
    if (!card || !target || attaching.current) return;
    attaching.current = true;
    const saved = await apply({ kind: 'options', patch: { [target.kind]: target.id } }, [card]);
    attaching.current = false;
    setAttachFailed(!saved);
    if (saved) setCreatedId(null);
  }
  useEffect(() => { if (createdId && !attachFailed && !pending) void attachCreated(); }, [createdId, catalog, pending, attachFailed]);

  const groups = useMemo(() => {
    function key(card: CatalogCard): string {
      if (grouping === 'state') return card.kind === 'task' ? card.state ?? 'not-started' : card.kind;
      if (grouping === 'priority') return card.priority ?? '';
      if (grouping === 'owner') return card.owner ?? '';
      if (grouping === 'deck') return card.deckId ?? '';
      if (grouping === 'run' || grouping === 'milestone') return card[grouping] ?? '';
      return '';
    }
    const grouped = new Map<string, CatalogCard[]>();
    if (grouping === 'run') for (const run of orderedRunChoices(catalog.runs ?? [])) grouped.set(run.id, []);
    if (grouping === 'milestone') for (const milestone of catalog.milestones ?? []) grouped.set(milestone.id, []);
    for (const card of visible) grouped.set(key(card), [...grouped.get(key(card)) ?? [], card]);
    function label(value: string): string {
      if (grouping === 'state') return value === 'hero' || value === 'doc' ? kindLabel(value, lang) : stateLabel(value, lang);
      if (grouping === 'deck') return catalog.decks.find(deck => deck.id === value)?.title ?? t.noDeck;
      if (grouping === 'run') { const run = catalog.runs?.find(candidate => candidate.id === value); return run ? runChoiceLabel(run, lang) : value || t.noRun; }
      if (grouping === 'milestone') return catalog.milestones?.find(milestone => milestone.id === value)?.title ?? (value || t.noMilestone);
      if (grouping === 'priority') return value === 'high' || value === 'medium' || value === 'low' ? priorityLabel(value, lang) : t.noPriority;
      if (grouping === 'owner') return value || t.noOwner;
      return t.cards;
    }
    return [...grouped].filter(([, items]) => items.length || !query.trim() && !mine)
      .map(([value, items]) => ({ value, label: label(value), cards: items }));
  }, [visible, grouping, catalog, lang, t, query, mine]);

  const orderedIds = groups.flatMap(group => group.cards.map(card => card.id));
  const selectionState = useCardSelection(orderedIds, preferenceKey, pending || draftOpen || runControlsOpen || Boolean(createdId));
  const selection = visible.filter(card => selectionState.selectedIds.has(card.id));

  function closeInformation() {
    setInformation(false);
    moveFocus(informationButton.current);
    informationButton.current?.scrollIntoView({ block: 'nearest' });
  }

  async function pinMilestone() {
    if (mutationDisabled || target?.kind !== 'milestone' || !onPlanningEdit) return;
    await onPlanningEdit({ action: 'pin-milestone', milestoneId: pinned ? null : target.id,
      milestonesHash: catalog.milestonesHash ?? '', manifestHash: catalog.manifestHash });
  }

  async function deleteMilestone() {
    if (!deletion || mutationDisabled || target?.kind !== 'milestone' || !onPlanningEdit) return;
    const result = await onPlanningEdit({ action: 'delete-milestone', milestoneId: target.id,
      milestonesHash: deletion.milestonesHash ?? '', optionsHash: deletion.optionsHash ?? '', manifestHash: deletion.manifestHash });
    if (result.ok) { setDeletion(null); onDeleted?.(); }
    else if (result.revisions) setDeletion(result.revisions);
  }

  function closeMilestoneEditNow() {
    editStrip.settle();
    setEditDirty(false);
    setEditAnchor(null);
  }
  function closeMilestoneEdit() {
    if (pending) return;
    if (editDirty && !editStrip.escape()) return;
    closeMilestoneEditNow();
  }
  // 2026-11-10: cards hidden by search or My cards are a filtered state with one reset for both, never an empty plan;
  // a truly empty Run or Milestone offers Add card where it can be used.
  const filtered = Boolean(query || mine);
  const filteredMessage = mine ? t.filteredHint : t.noResults;
  const canAddCard = Boolean(target && target.kind !== 'dueDate' && writable && !mutationDisabled && !composing && catalog.decks.length);
  const addCardAction = canAddCard ? { label: t.addCard, onClick: () => setComposing(true) } : undefined;

  return <section className="planning-collection" aria-label={title}>
    <header className="planning-collection-header">
      <div className="planning-collection-title"><h2 title={title}>{title}</h2><p title={subtitle}>{subtitle}</p></div>
      {onPlanningEdit && (milestone || run) && <details className="planning-scope-menu"><summary className="control control-ghost" aria-label={t.actions} title={t.actions}><MoreHorizontal size={18} /></summary><div className="planning-scope-menu-body">
      {target?.kind === 'milestone' && <div className="planning-scope-actions">
        <Button variant="ghost" size="icon" disabled={mutationDisabled && !editAnchor} aria-label={t.editMilestone} title={t.editMilestone} aria-pressed={Boolean(editAnchor)} onClick={event => { if (editAnchor) { if (!editDirty) setEditAnchor(null); } else setEditAnchor(event.currentTarget); }}><Pencil size={18} /></Button>
        <Button variant="ghost" size="icon" disabled={mutationDisabled} aria-label={pinned ? t.unpin : t.pin} title={pinned ? t.unpin : t.pin} aria-pressed={pinned} onClick={() => void pinMilestone()}>{pinned ? <PinOff size={18} /> : <Pin size={18} />}</Button>
        <Button variant="ghost" size="icon" disabled={mutationDisabled} aria-label={t.deleteMilestone} title={t.deleteMilestone} onClick={() => setDeletion(catalog)}><Trash2 size={18} /></Button>
      </div>}
      {run && onPlanningEdit && <RunControls catalog={catalog} run={run} pending={pending} writable={writable && !draftOpen && !createdId && !missingPlan} onSave={onPlanningEdit} onDeleted={onDeleted} onOpenChange={setRunControlsOpen} onDirtyChange={setRunControlsDirty} />}
      </div></details>}
      <div className="planning-count"><span>{stateLabel('done', lang)} <span className="page-number">{amount(summary.done)} / {amount(summary.tasks)}</span></span><span>{t.remainingEffort} <span className="page-number">{amount(summary.effort - summary.doneEffort)}</span></span></div>
    </header>
    {editAnchor && milestone && onPlanningEdit && <PlanningPopover anchor={editAnchor} placement="below" wide={false} title={t.editMilestoneTitle} closeLabel={t.closeEdit} dirty={editDirty} pending={pending}
      onClose={closeMilestoneEdit}
      confirm={editStrip.confirming ? { onKeep: editStrip.keep, onDiscard: closeMilestoneEditNow } : null}
      onInteract={editStrip.settle}>
      <MilestoneForm date={milestone.date} milestone={milestone} catalog={catalog} pending={pending} onSave={onPlanningEdit} onDirtyChange={setEditDirty}
        onDone={() => { setEditDirty(false); setEditAnchor(null); }} />
    </PlanningPopover>}
    <PlanningProgress cards={activeCards} />
    <div className="planning-collection-tools">
      <Button ref={informationButton} variant="outline" size="sm" aria-label={t.information} aria-expanded={information} aria-pressed={information} disabled={detailsDirty} onClick={() => setInformation(!information)}><Info size={16} />{t.information}</Button>
      <label className="planning-search"><Search size={15} /><input aria-label={t.search} placeholder={t.searchPlaceholder} value={query} onChange={event => setQuery(event.target.value)} /></label>
      {target && <button type="button" className="planning-mine control" aria-pressed={mine} title={t.myCardsHint} onClick={() => setMine(value => !value)}>{t.myCards}</button>}
    </div>
    <SelectionToolbar selectedCards={selection} catalog={catalog} source={snapshot.source} totalShown={visible.length} pending={mutationDisabled}
      writable={writable} onClear={selectionState.clear} onSelectAll={selectionState.selectAllShown} onAction={change => apply(change)}
      onMove={deckId => onEdit({ action: 'bulk-assign-deck', cards: selection.map(card => ({ cardId: card.id, sourceHash: card.sourceHash })), deckId })}
      onAddTrack={trackId => onEdit({ action: 'bulk-add-track', cards: selection.map(card => ({ cardId: card.id, sourceHash: card.sourceHash })), trackId })} />
    {createdId && <div className="notice" role="status">{attachFailed ? t.attachFailed : t.attaching}{attachFailed && <Button size="sm" variant="outline" disabled={pending} onClick={() => void attachCreated()}>{t.retry}</Button>}</div>}
    <div className="planning-collection-body">
      <nav className="planning-rail deck-action-rail" aria-label={t.actions}>
        {target && <Button variant="ghost" size="icon" aria-label={t.addToPlan} title={t.addCard} disabled={mutationDisabled || composing || !catalog.decks.length} onClick={() => setComposing(true)}><Plus size={18} /></Button>}
        <Button variant="ghost" size="icon" aria-label={t.grouping} title={t.grouping} aria-pressed={ordering} onClick={() => setOrdering(value => !value)}><ArrowDownWideNarrow size={18} /></Button>
      </nav>
      {(information || composing) && <aside className="planning-details">
        {composing ? <CardComposer catalog={catalog} snapshot={snapshot} initialDeckId={catalog.decks.find(deck => deck.kind === 'task' || deck.kind === 'mixed')?.id ?? catalog.decks[0]?.id ?? ''} pending={pending || Boolean(createdId)} onEdit={createInPlan} onClose={closeComposer} onCreated={closeComposer} onDirtyChange={setComposerDirty} /> : <>
          {run && <PlanningDetails plan={{ kind: 'run', record: run }} catalog={catalog} source={snapshot.source} writable={writable} pending={pending} onSave={onPlanningEdit} onDirtyChange={setDetailsDirty} />}
          {milestone && <PlanningDetails plan={{ kind: 'milestone', record: milestone }} catalog={catalog} source={snapshot.source} writable={writable} pending={pending} onSave={onPlanningEdit} onDirtyChange={setDetailsDirty} />}
          <PlanningStats cards={activeCards} catalog={catalog} run={run} milestoneId={milestone?.id} history={run || milestone ? (run?.history ?? milestone?.history ?? []) : undefined} />
          <Button variant="ghost" size="sm" disabled={detailsDirty} onClick={closeInformation}>{t.backToCards}</Button>
        </>}
      </aside>}
      <div className="planning-cards">
        <div className="planning-order">{ordering && <label>{t.grouping} <select className="control-field" aria-label={t.groupingCards} value={grouping} onChange={event => setGrouping(event.target.value as PlanningGrouping)}>
          <option value="manual">{t.uiManual}</option><option value="state">{t.state}</option><option value="priority">{t.priority}</option><option value="owner">{t.owner}</option><option value="deck">{t.deck}</option><option value="run">{t.uiRun}</option><option value="milestone">{t.uiMilestone}</option>
        </select></label>}<span>{t.cardCount(visible.length)}</span>{grouping === 'manual' && visible.length > 0 && <GroupEffort cards={visible} />}</div>
        {groups.map(group => <section className="planning-card-group" key={group.value} aria-label={group.label}
          onDragOver={event => { if (!mutationDisabled && (grouping === 'run' || grouping === 'milestone') && event.dataTransfer.types.includes('application/x-deckmate-planning')) event.preventDefault(); }}
          onDrop={event => { event.preventDefault(); const card = visible.find(candidate => candidate.id === event.dataTransfer.getData('application/x-deckmate-planning')); if (card && !mutationDisabled && (grouping === 'run' || grouping === 'milestone')) void apply({ kind: 'options', patch: { [grouping]: group.value || null } }, [card]); }}>
          {grouping !== 'manual' && <h3>{grouping === 'priority' && <span aria-hidden="true"><PriorityIcon priority={group.value === 'high' || group.value === 'medium' || group.value === 'low' ? group.value : null} size={16} /></span>}<span>{group.label}</span><span className="page-number">{amount(group.cards.length)}</span><GroupEffort cards={group.cards} /></h3>}
          <div className="planning-card-grid">{group.cards.map(card => <div key={card.id} draggable={!mutationDisabled && (grouping === 'run' || grouping === 'milestone')} onDragStart={event => { event.dataTransfer.setData('application/x-deckmate-planning', card.id); event.dataTransfer.effectAllowed = 'move'; }}>
            <CatalogCardTile card={card} catalog={catalog} members={catalog.members ?? []} currentMemberId={viewer?.id} tagDefinitions={catalog.projectTags} lookups={lookups} selected={false} checked={selectionState.selectedIds.has(card.id)} selectionActive={selection.length > 0} disabled={pending || draftOpen || Boolean(createdId)} onOpen={(opened, _button, shift) => { if (draftOpen || createdId || pending) return; if (shift || selection.length) selectionState.toggle(opened.id, shift); else { closeComposer(); onOpenCard(opened.id); } }} onToggle={selectionState.toggle} onFamilyOpen={parent => { if (!draftOpen && !createdId && !pending) { closeComposer(); onOpenCard(parent.id); } }} />
          </div>)}</div>
        </section>)}
        {!visible.length && (filtered
          ? <EmptyState variant="filtered" art="no-results" title={t.filteredTitle} message={filteredMessage} onReset={() => { setQuery(''); setMine(false); }} />
          : <EmptyState variant="first-run" art="first-card" title={t.empty} message={t.emptyHint} action={addCardAction} />)}
      </div>
    </div>
    <Dialog.Root open={Boolean(deletion)} onOpenChange={open => { if (!open && !pending) setDeletion(null); }}><Dialog.Portal><Dialog.Overlay className="planning-calendar-overlay" /><Dialog.Content className="planning-calendar planning-delete-dialog dialog-panel">
      <header className="dialog-head"><Dialog.Title className="dialog-title">{t.confirmDelete(title)}</Dialog.Title></header>
      <div className="dialog-body"><Dialog.Description className="dialog-description">{t.deleteDescription(unarchivedCount, amount(affectedCards.length), pinned)}</Dialog.Description>
      {planningError && <p className="error-banner" role="alert">{planningError}</p>}
      </div><footer className="dialog-foot"><Button variant="ghost" disabled={pending} onClick={() => setDeletion(null)}>{t.cancel}</Button><Button className="destructive" disabled={pending} onClick={() => void deleteMilestone()}>{pending ? t.deleting : t.deleteMilestone}</Button></footer>
    </Dialog.Content></Dialog.Portal></Dialog.Root>
  </section>;
}
