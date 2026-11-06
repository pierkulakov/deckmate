import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import * as Tooltip from '@radix-ui/react-tooltip';
import { CalendarSync, Plus, X } from 'lucide-react';
import type { CatalogCard, CatalogView, MilestoneRecord, RunConfiguration } from '../../src/catalog-contracts.ts';
import { defineText, locale, useLang, useText, type Lang } from '../i18n.ts';
import { addDays, formatPlanningDate, isoWeek, metrics, monthStart, workdaysUntil } from '../planning-metrics.ts';
import { orderedRunChoices } from '../run-label.ts';
import { PlanningProgress, type PlanningTarget } from './PlanningScope.tsx';
import { RunConfigurationForm, RunScheduleList } from './RunControls.tsx';
import { useConfirmStrip } from './ConfirmStrip.tsx';
import { contrastRatio, rgbOf } from '../color-contrast.ts';
import type { SavePlanning } from './TimelineView.tsx';
import { MilestoneForm, PlanningPopover } from './PlanningPopover.tsx';
import '../planning-calendar.css';

const text = defineText({
  calendar: 'Calendar',
  clickToAdd: 'Choose a day for a new Milestone',
  setupRuns: 'Run schedules',
  close: 'Close calendar',
  closeForm: 'Close',
  weekday: (index: number) => ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'][index],
  week: (week: number) => `Week ${week.toLocaleString(locale())}`,
  addOn: (date: string) => `Create Milestone ${date}`,
  milestoneOn: (titles: string, date: string) => `${titles} · ${date}`,
  hint: 'Click: edit · Ctrl/Cmd-click: open · Drag: move to another day',
  readOnlyHint: 'Click to open the Milestone.',
  pastMilestone: 'Passed',
  due: 'Due',
  dueToday: 'Due today',
  overdue: (count: number) => `Overdue · ${Math.abs(count).toLocaleString(locale())} ${new Intl.PluralRules('en-US').select(Math.abs(count)) === 'one' ? 'workday' : 'workdays'}`,
  remaining: (count: number) => `${count.toLocaleString(locale())} ${new Intl.PluralRules('en-US').select(count) === 'one' ? 'workday' : 'workdays'} left`,
  cards: (count: number, done: number, tasks: number) => `${count.toLocaleString(locale())} ${new Intl.PluralRules('en-US').select(count) === 'one' ? 'card' : 'cards'} · done ${done.toLocaleString(locale())}/${tasks.toLocaleString(locale())}`,
  createTitle: 'New Milestone',
  editTitle: 'Edit Milestone',
  setupTitle: 'New Run schedule',
  scheduleTitle: 'Edit Run schedule',
}, {
  calendar: 'Календарь',
  clickToAdd: 'Выберите день для новой вехи',
  setupRuns: 'Расписания Run',
  close: 'Закрыть календарь',
  closeForm: 'Закрыть',
  weekday: (index: number) => ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'][index],
  week: (week: number) => `Неделя ${week.toLocaleString(locale())}`,
  addOn: (date: string) => `Создать веху ${date}`,
  milestoneOn: (titles: string, date: string) => `${titles} · ${date}`,
  hint: 'Щелчок — изменить · Ctrl/Cmd+щелчок — открыть · перетащить — на другой день',
  readOnlyHint: 'Щелчок открывает веху.',
  pastMilestone: 'Прошла',
  due: 'Срок',
  dueToday: 'Срок сегодня',
  overdue: (count: number) => `Срок прошёл · ${Math.abs(count).toLocaleString(locale())} раб. дн.`,
  remaining: (count: number) => `Осталось ${count.toLocaleString(locale())} раб. дн.`,
  cards: (count: number, done: number, tasks: number) => `Карт: ${count.toLocaleString(locale())} · готово ${done.toLocaleString(locale())}/${tasks.toLocaleString(locale())}`,
  createTitle: 'Новая веха',
  editTitle: 'Изменить веху',
  setupTitle: 'Новое расписание Run',
  scheduleTitle: 'Изменить расписание Run',
});

/** A Milestone draft opens at its date cell; a Run schedule draft opens under «Set up Runs». */
export type CalendarDraft = { kind: 'milestone'; date: string } | { kind: 'edit'; id: string } | { kind: 'configuration'; configuration?: RunConfiguration };

export function countdown(date: string, today: string, lang: Lang): string {
  const t = text[lang];
  if (date === today) return t.dueToday;
  const count = workdaysUntil(today, date);
  return date < today ? t.overdue(count) : t.remaining(count);
}

/** Light --overlay-ink and dark --hero-ink, the fixed text pair for user colors in both themes. */
const tileInks = { light: rgbOf('#f9f9fa'), dark: rgbOf('#24180a') };
/**
 * 2026-11-06: a Milestone tile shows the day number on the Milestone's own color; light ink reached 2.49:1 on the champagne
 * swatch and 3.17:1 on mint, so the tile takes whichever ink contrasts more with its color.
 */
function tileInkClass(color: string): string {
  if (!/^#[\da-f]{6}$/iu.test(color)) return '';
  const tile = rgbOf(color);
  return contrastRatio(tileInks.dark, tile) > contrastRatio(tileInks.light, tile) ? ' is-dark-ink' : '';
}

/** The calendar covers the current year and the two after it (2026-11-05). */
const yearsAhead = 2;
/** The current month's row starts this far below the top, so the end of the previous row stays in view. */
const scrollLead = 80;

/**
 * Calendar panel (2026-11-05): a non-modal 660 px panel under the top bar with a year grid of months, two per row. A click on a
 * date opens the new Milestone form at that cell; a Milestone tile is edited by a click, opened behind the panel by Ctrl/Cmd-click
 * and moved by dragging. The panel stays open on outside clicks; ×, Escape or the calendar button closes it.
 */
export function PlanningCalendar({ open, onClose, draft, onDraftChange, onDirtyChange, viewRequest, onViewRequestHandled, catalog, cards, today, writable, pending, error, onSave, onChoose }: {
  open: boolean; onClose: () => void;
  draft: CalendarDraft | null; onDraftChange: (draft: CalendarDraft | null) => void; onDirtyChange: (dirty: boolean) => void;
  /** The view asks to switch the draft (null closes the panel); a dirty form answers through the strip first. */
  viewRequest?: { id: number; draft: CalendarDraft | null } | null;
  onViewRequestHandled?: () => void;
  catalog: CatalogView; cards: CatalogCard[]; today: string; writable: boolean; pending: boolean; error: string | null;
  onSave: SavePlanning; onChoose: (target: PlanningTarget) => void;
}) {
  const t = useText(text);
  const lang = useLang();
  const panelRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const setupRef = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [dirty, setDirty] = useState(false);
  // Switching away from a dirty form asks through the strip inside the popover instead of window.confirm (2026-11-05).
  const strip = useConfirmStrip();
  const [pendingDraft, setPendingDraft] = useState<CalendarDraft | null>(null);
  const [pendingClose, setPendingClose] = useState(false);
  const drag = useMilestoneDrag({ panelRef, scrollRef, writable, pending, onSave });
  useEffect(() => { onDirtyChange(open && dirty); }, [open, dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  useEffect(() => { if (!open) setDirty(false); }, [open]);
  const year = Number(today.slice(0, 4));
  const years = Array.from({ length: yearsAhead + 1 }, (_, index) => year + index);
  const milestonesByDate = useMemo(() => {
    const dates = new Map<string, MilestoneRecord[]>();
    for (const saved of catalog.milestones ?? []) {
      // A dropped Milestone shows at its new day at once; the saved file confirms it a moment later.
      const milestone = drag.moved?.id === saved.id ? { ...saved, date: drag.moved.date } : saved;
      dates.set(milestone.date, [...dates.get(milestone.date) ?? [], milestone]);
    }
    return dates;
  }, [catalog.milestones, drag.moved]);
  const settled = Boolean(drag.moved && catalog.milestones?.find(item => item.id === drag.moved?.id)?.date === drag.moved.date);
  useEffect(() => { if (settled) drag.settle(); }, [settled]);
  const editing = draft?.kind === 'edit' ? catalog.milestones?.find(milestone => milestone.id === draft.id) : undefined;
  // A Milestone removed elsewhere closes its form: saving the draft would create it again under the old id.
  const editedGone = draft?.kind === 'edit' && !editing;
  useEffect(() => { if (editedGone) { setDirty(false); onDraftChange(null); } }, [editedGone, onDraftChange]);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const month = scroller?.querySelector<HTMLElement>(`[data-month="${monthStart(today)}"]`);
    if (scroller && month) scroller.scrollTop += month.getBoundingClientRect().top - scroller.getBoundingClientRect().top - scrollLead;
  }, [open]);
  useLayoutEffect(() => {
    if (!open || !draft) { setAnchor(null); return; }
    let element: HTMLElement | null = null;
    if (draft.kind === 'configuration') element = setupRef.current;
    else {
      const date = draft.kind === 'milestone' ? draft.date : editing?.date;
      element = date ? panelRef.current?.querySelector<HTMLElement>(`[data-date="${date}"]`) ?? null : null;
      // Only the year list scrolls to the cell: scrollIntoView would also move the page while the panel slides in.
      const scroller = scrollRef.current;
      if (element && scroller) {
        const cell = element.getBoundingClientRect();
        const view = scroller.getBoundingClientRect();
        if (cell.top < view.top) scroller.scrollTop -= view.top - cell.top + scrollLead;
        else if (cell.bottom > view.bottom) scroller.scrollTop += cell.bottom - view.bottom + scrollLead;
      }
    }
    setAnchor(element ?? panelRef.current?.querySelector<HTMLElement>('.planning-calendar-panel-header') ?? null);
  }, [open, draft, editing?.date]);

  /** Switching or dropping the draft: a dirty form answers through the strip first; the intent waits in pendingDraft. */
  function requestDraft(next: CalendarDraft | null, closePanel = false): boolean {
    if (pending) return false;
    if (dirty && !strip.escape()) { setPendingDraft(next); setPendingClose(closePanel); return false; }
    applyDraft(next, closePanel);
    return true;
  }
  function applyDraft(next: CalendarDraft | null, closePanel: boolean) {
    strip.settle();
    setPendingDraft(null);
    setPendingClose(false);
    setDirty(false);
    onDraftChange(next);
    if (closePanel) onClose();
  }
  function close() { requestDraft(null, true); }
  // 2026-11-06: Escape closes the panel like ×, also while focus stays on the Calendar button; an open Milestone or schedule
  // form, a drag and any dialog above the panel answer that Escape first.
  const closeOnEscape = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || pending || draft || drag.dragging) return;
    if (document.querySelector('[role="dialog"][data-state="open"]')) return;
    event.preventDefault();
    close();
  });
  useEffect(() => {
    if (!open) return;
    const listener = (event: KeyboardEvent) => closeOnEscape(event);
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, [open]);
  useEffect(() => {
    if (!viewRequest) return;
    requestDraft(viewRequest.draft, viewRequest.draft === null);
    onViewRequestHandled?.();
  }, [viewRequest]);

  if (!open) return null;
  let popoverTitle = t.setupTitle;
  if (draft?.kind === 'milestone') popoverTitle = t.createTitle;
  else if (draft?.kind === 'edit') popoverTitle = t.editTitle;
  else if (draft?.kind === 'configuration' && draft.configuration) popoverTitle = t.scheduleTitle;
  return <Tooltip.Provider delayDuration={250}><aside ref={panelRef} className="planning-calendar-panel" aria-labelledby="planning-calendar-title">
    <header className="planning-calendar-panel-header">
      <h2 id="planning-calendar-title">{writable ? t.clickToAdd : t.calendar}</h2>
      {writable && <button ref={setupRef} type="button" className="planning-calendar-setup" disabled={pending} aria-pressed={draft?.kind === 'configuration'} onClick={() => requestDraft(draft?.kind === 'configuration' ? null : { kind: 'configuration' })}><CalendarSync size={16} aria-hidden="true" /><span>{t.setupRuns}</span></button>}
      <button type="button" className="planning-calendar-close" disabled={pending} aria-label={t.close} title={t.close} onClick={close}><X size={16} /></button>
    </header>
    {error && <p className="error-banner" role="alert">{error}</p>}
    <div className="planning-calendar-years" ref={scrollRef}>
      {years.map(value => <section key={value} className="planning-calendar-year" aria-labelledby={`planning-calendar-year-${value}`}>
        <h3 id={`planning-calendar-year-${value}`}>{value.toLocaleString(locale(lang), { useGrouping: false })}</h3>
        <div className="planning-calendar-months">{Array.from({ length: 12 }, (_, index) => {
          const month = `${value}-${String(index + 1).padStart(2, '0')}-01`;
          return <CalendarMonth key={month} month={month} today={today} lang={lang} writable={writable} pending={pending} milestonesByDate={milestonesByDate} cards={cards}
            onAdd={date => requestDraft({ kind: 'milestone', date })} onEdit={id => { if (!drag.consumeClick()) requestDraft({ kind: 'edit', id }); }}
            onOpen={id => { if (!drag.consumeClick()) onChoose({ kind: 'milestone', id }); }}
            draggingId={drag.dragging?.milestone.id ?? null} onTilePointerDown={(event, milestone, day) => drag.start(event, milestone, catalog.milestonesHash ?? '', day)} />;
        })}</div>
      </section>)}
    </div>
    {draft && anchor && !editedGone && <PlanningPopover key={draft.kind === 'configuration' ? `runs:${draft.configuration?.id ?? 'new'}` : `milestone:${draft.kind === 'edit' ? draft.id : draft.date}`}
      anchor={anchor} placement={draft.kind === 'configuration' ? 'below' : 'above'} wide={draft.kind === 'configuration'} title={popoverTitle} closeLabel={t.closeForm} dirty={dirty} pending={pending}
      onClose={() => requestDraft(null)}
      confirm={strip.confirming ? { onKeep: strip.keep, onDiscard: () => applyDraft(pendingDraft, pendingClose) } : null}
      onInteract={strip.settle}>
      {draft.kind === 'configuration' ? <>
        <RunConfigurationForm catalog={catalog} configuration={draft.configuration} pending={pending} onSave={onSave} onDirtyChange={setDirty}
          onCancel={() => requestDraft(null)} onSaved={(id, next) => {
            setDirty(false); onDraftChange(null);
            const run = orderedRunChoices(next?.runs ?? [], today).find(item => item.configurationId === id && !item.finishedAt);
            if (run) onChoose({ kind: 'run', id: run.id });
          }} />
        {!draft.configuration && <RunScheduleList catalog={catalog} pending={pending} writable={writable} onSave={onSave} onEdit={configuration => requestDraft({ kind: 'configuration', configuration })} />}
      </> : <MilestoneForm date={draft.kind === 'milestone' ? draft.date : editing?.date ?? today} milestone={editing} catalog={catalog} pending={pending} onSave={onSave} onDirtyChange={setDirty}
        onDone={id => { setDirty(false); onDraftChange(null); onChoose({ kind: 'milestone', id }); }} />}
    </PlanningPopover>}
    {drag.dragging && createPortal(<div ref={drag.ghostRef} className={`planning-calendar-milestone planning-calendar-ghost${tileInkClass(drag.dragging.milestone.color)}`} aria-hidden="true" style={{ backgroundColor: drag.dragging.milestone.color }}>{drag.dragging.day}</div>, document.body)}
  </aside></Tooltip.Provider>;
}

function CalendarMonth({ month, today, lang, writable, pending, milestonesByDate, cards, draggingId, onAdd, onEdit, onOpen, onTilePointerDown }: {
  month: string; today: string; lang: Lang; writable: boolean; pending: boolean; milestonesByDate: Map<string, MilestoneRecord[]>; cards: CatalogCard[];
  draggingId: string | null; onAdd: (date: string) => void; onEdit: (id: string) => void; onOpen: (id: string) => void;
  onTilePointerDown: (event: ReactPointerEvent<HTMLButtonElement>, milestone: MilestoneRecord, day: string) => void;
}) {
  const t = useText(text);
  const next = monthStart(month, 1);
  const weeks: string[] = [];
  for (let monday = addDays(month, -((new Date(`${month}T00:00:00Z`).getUTCDay() + 6) % 7)); monday < next; monday = addDays(monday, 7)) weeks.push(monday);
  const current = monthStart(today);
  const tense = month < current ? ' is-past' : month === current ? ' is-current' : '';
  const name = new Intl.DateTimeFormat(locale(lang), { month: 'long', timeZone: 'UTC' }).format(new Date(`${month}T00:00:00Z`));
  const label = new Intl.DateTimeFormat(locale(lang), { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}T00:00:00Z`));
  return <div className={`planning-calendar-month${tense}`} data-month={month}>
    <div className="planning-calendar-month-body">
      <h4>{name}</h4>
      <table aria-label={label}>
        <thead><tr><td />{Array.from({ length: 7 }, (_, index) => <th key={index} scope="col">{t.weekday(index)}</th>)}</tr></thead>
        <tbody>{weeks.map(monday => <tr key={monday} className={monday <= today && today < addDays(monday, 7) ? 'is-current-week' : undefined}>
          <th scope="row" aria-label={t.week(isoWeek(monday))}>{isoWeek(monday).toLocaleString(locale(lang))}</th>
          {Array.from({ length: 7 }, (_, index) => {
            const date = addDays(monday, index);
            if (date < month || date >= next) return <td key={date} />;
            const day = Number(date.slice(8)).toLocaleString(locale(lang));
            const milestones = milestonesByDate.get(date);
            const classes = `${index >= 5 ? 'is-weekend' : ''}${date === today ? ' is-today' : ''}`.trim();
            return <td key={date} data-date={date} className={classes || undefined}>
              {milestones ? <MilestoneTile date={date} day={day} milestones={milestones} cards={cards} today={today} lang={lang} writable={writable} pending={pending} onEdit={onEdit} onOpen={onOpen}
                dragSource={milestones[0].id === draggingId} onPointerDown={event => onTilePointerDown(event, milestones[0], day)} />
                : writable ? <button type="button" className="planning-calendar-day" disabled={pending} aria-label={t.addOn(formatPlanningDate(date, lang))} onClick={() => onAdd(date)}><span>{day}</span><span className="planning-calendar-add" aria-hidden="true"><Plus size={22} /></span></button>
                  : <span className="planning-calendar-day">{day}</span>}
            </td>;
          })}
        </tr>)}</tbody>
      </table>
    </div>
  </div>;
}

function MilestoneTile({ date, day, milestones, cards, today, lang, writable, pending, dragSource, onEdit, onOpen, onPointerDown }: {
  date: string; day: string; milestones: MilestoneRecord[]; cards: CatalogCard[]; today: string; lang: Lang; writable: boolean; pending: boolean;
  dragSource: boolean; onEdit: (id: string) => void; onOpen: (id: string) => void; onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  const t = useText(text);
  const [first] = milestones;
  return <Tooltip.Root><Tooltip.Trigger asChild>
    <button type="button" className={`planning-calendar-milestone${tileInkClass(first.color)}${writable && !pending ? ' is-movable' : ''}${dragSource ? ' is-drag-source' : ''}`} style={{ backgroundColor: first.color }}
      aria-label={t.milestoneOn(milestones.map(milestone => milestone.title).join(', '), formatPlanningDate(date, lang))}
      onPointerDown={onPointerDown}
      onClick={event => { if (!writable || event.ctrlKey || event.metaKey) onOpen(first.id); else onEdit(first.id); }}>{day}</button>
  </Tooltip.Trigger><Tooltip.Portal><Tooltip.Content className="planning-milestone-card" side="right" align="center" sideOffset={12} collisionPadding={12}>
    {milestones.map(milestone => {
      const own = cards.filter(card => card.milestone === milestone.id);
      const summary = metrics(own);
      return <section key={milestone.id}>
        <header><span className={`planning-diamond${milestone.date < today ? ' is-past' : ''}`} style={{ color: milestone.color }} /><strong title={milestone.title}>{milestone.title}</strong>{milestone.date < today && <span className="planning-milestone-card-tag">{t.pastMilestone}</span>}</header>
        <p><span>{t.due}</span>{formatPlanningDate(milestone.date, lang)}<small>{countdown(milestone.date, today, lang)}</small></p>
        <PlanningProgress cards={own} />
        <p className="planning-milestone-card-count">{t.cards(own.length, summary.done, summary.tasks)}</p>
      </section>;
    })}
    <footer>{writable ? t.hint : t.readOnlyHint}</footer>
  </Tooltip.Content></Tooltip.Portal></Tooltip.Root>;
}

/** The pointer travels this far before a press on a Milestone tile becomes a move rather than a click. */
const dragThreshold = 4;
/** Within this distance of the year list's top or bottom edge a carried tile scrolls the list, faster nearer the edge. */
const scrollEdge = 56;

/**
 * Moving a Milestone to another day (2026-11-05). The browser's own drag-and-drop showed a faint, lagging copy and no target, so
 * the tile is carried by pointer events instead: a solid copy follows the pointer every frame, the day under it is outlined,
 * the year list scrolls near its edges, and the dropped tile shows at its new day at once while the save completes. Escape or a
 * release outside the days cancels. Position and target change outside React; only the start and the end of a move re-render.
 */
function useMilestoneDrag({ panelRef, scrollRef, writable, pending, onSave }: {
  panelRef: RefObject<HTMLElement | null>; scrollRef: RefObject<HTMLDivElement | null>; writable: boolean; pending: boolean; onSave: SavePlanning;
}) {
  const ghostRef = useRef<HTMLDivElement>(null);
  const session = useRef<{ milestone: MilestoneRecord; hash: string; day: string; pointerId: number; startX: number; startY: number;
    x: number; y: number; grabX: number; grabY: number; active: boolean; over: HTMLElement | null; frame: number; release: () => void } | null>(null);
  const clickSwallowed = useRef(false);
  const [dragging, setDragging] = useState<{ milestone: MilestoneRecord; day: string } | null>(null);
  const [moved, setMoved] = useState<{ id: string; date: string } | null>(null);

  function placeGhost() {
    const state = session.current;
    if (state && ghostRef.current) ghostRef.current.style.transform = `translate(${state.x - state.grabX}px, ${state.y - state.grabY}px) scale(1.08)`; // scale after the move, or it would stretch the offset too
  }
  function markTarget() {
    const state = session.current;
    if (!state) return;
    const found = document.elementFromPoint(state.x, state.y)?.closest<HTMLElement>('td[data-date]') ?? null;
    const cell = found && panelRef.current?.contains(found) && found.dataset.date !== state.milestone.date ? found : null;
    if (cell === state.over) return;
    state.over?.classList.remove('is-drop-target');
    cell?.classList.add('is-drop-target');
    state.over = cell;
  }
  function scrollNearEdge() {
    const state = session.current;
    const scroller = scrollRef.current;
    if (!state?.active || !scroller) return;
    const view = scroller.getBoundingClientRect();
    let step = 0;
    if (state.y < view.top + scrollEdge) step = -Math.ceil((view.top + scrollEdge - state.y) / 4);
    else if (state.y > view.bottom - scrollEdge) step = Math.ceil((state.y - view.bottom + scrollEdge) / 4);
    if (step) { scroller.scrollTop += step; markTarget(); }
    state.frame = requestAnimationFrame(scrollNearEdge);
  }
  function finish(drop: boolean) {
    const state = session.current;
    if (!state) return;
    session.current = null;
    state.release();
    cancelAnimationFrame(state.frame);
    state.over?.classList.remove('is-drop-target');
    document.documentElement.classList.remove('is-carrying-milestone');
    if (!state.active) return;
    // The release that ends a move also clicks the tile; that click must not open the edit form.
    clickSwallowed.current = true;
    window.setTimeout(() => { clickSwallowed.current = false; });
    setDragging(null);
    const date = state.over?.dataset.date;
    if (!drop || !date) return;
    setMoved({ id: state.milestone.id, date });
    void onSave({ action: 'update-milestone', milestone: { ...state.milestone, date }, milestonesHash: state.hash }).then(result => { if (!result.ok) setMoved(null); });
  }
  function start(event: ReactPointerEvent<HTMLButtonElement>, milestone: MilestoneRecord, hash: string, day: string) {
    if (!writable || pending || event.button !== 0 || event.ctrlKey || event.metaKey || session.current) return;
    const box = event.currentTarget.getBoundingClientRect();
    const move = (pointer: PointerEvent) => {
      const state = session.current;
      if (!state || pointer.pointerId !== state.pointerId) return;
      state.x = pointer.clientX;
      state.y = pointer.clientY;
      if (!state.active) {
        if (Math.hypot(state.x - state.startX, state.y - state.startY) < dragThreshold) return;
        state.active = true;
        document.documentElement.classList.add('is-carrying-milestone');
        setDragging({ milestone: state.milestone, day: state.day });
        state.frame = requestAnimationFrame(scrollNearEdge);
      }
      placeGhost();
      markTarget();
    };
    const up = (pointer: PointerEvent) => { if (pointer.pointerId === session.current?.pointerId) finish(true); };
    const cancel = (pointer: PointerEvent) => { if (pointer.pointerId === session.current?.pointerId) finish(false); };
    const key = (keyboard: KeyboardEvent) => { if (keyboard.key === 'Escape' && session.current?.active) { keyboard.preventDefault(); keyboard.stopPropagation(); finish(false); } };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key, true);
    session.current = { milestone, hash, day, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY,
      grabX: event.clientX - box.left, grabY: event.clientY - box.top, active: false, over: null, frame: 0,
      release: () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', cancel);
        window.removeEventListener('keydown', key, true);
      } };
  }
  useLayoutEffect(placeGhost, [dragging]);
  useEffect(() => () => finish(false), []);
  return {
    ghostRef, dragging, moved, start,
    consumeClick: () => clickSwallowed.current,
    settle: () => setMoved(null),
  };
}
