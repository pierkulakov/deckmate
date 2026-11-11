import { moveFocus } from '../focus.ts';
import { readStoredValue } from '../storage.ts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, Bell, CalendarDays, Plus } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import type { CatalogCard, CatalogView, RunRecord } from '../../src/catalog-contracts.ts';
import type { WorkspaceSnapshot } from '../../src/workspace-contracts.ts';
import type { PlanningEdit } from '../../src/planning-files.ts';
import { useCatalog } from '../useCatalog.ts';
import { readFreshCatalog } from '../catalog-store.ts';
import '../planning.css';
import { actorHeaders, currentMember, onMemberChange } from '../current-member.ts';
import { addDays, dayDistance, formatPlanningDate, isoWeek, metrics, monthStart, workdaysUntil } from '../planning-metrics.ts';
import { localIsoDate } from '../../src/catalog-hand.ts';
import { PlanningProgress, PlanningScope, type PlanningPlan, type PlanningTarget } from './PlanningScope.tsx';
import { orderedRunChoices, runLabel } from '../run-label.ts';
import { PlanningCalendar, countdown, type CalendarDraft } from './PlanningCalendar.tsx';
import type { ShortcutScreen } from '../keyboard-shortcuts.ts';
import { ShortcutsHelp } from './ShortcutsHelp.tsx';
import { Button } from './ui/button.tsx';
import { defineText, locale, useLang, useText, type Lang } from '../i18n.ts';
import { stateLabel } from '../locales/common.ts';
import { failureMessage } from '../failure-message.ts';
import { EmptyState } from './EmptyState.tsx';
import { LoadingState } from './LoadingState.tsx';
import { ErrorState } from './ErrorState.tsx';

// Timeline has no shortcuts of its own: the overview lists the app-wide ones, as in Hand.
const timelineShortcutScreens: readonly ShortcutScreen[] = ['app'];

const text = defineText({
  timeline: 'Timeline',
  milestone: (title: string) => `Milestone ${title}`,
  dueDates: (date: string) => `Due dates · ${date}`,
  myCards: 'My cards',
  saveError: 'Could not save the plan. Try again.',
  overview: 'Milestones overview',
  calendar: 'Calendar',
  createPlan: 'Create a Milestone or Run schedule',
  loading: 'Loading Timeline…',
  axisLabel: 'Timeline: scroll with the wheel, by dragging, or with arrow keys',
  milestoneTitle: (title: string, date: string, countdown: string, done: number, tasks: number) => `${title} · ${date} · ${countdown} · ${stateLabel('done', 'en').toLocaleLowerCase(locale('en'))} ${done.toLocaleString(locale())}/${tasks.toLocaleString(locale())}`,
  dueMarker: (date: string) => `Due dates ${date}`,
  dueMarkerTitle: (member: string, date: string, count: number) => `${member} · ${date} · ${count.toLocaleString(locale())} ${new Intl.PluralRules(locale('en')).select(count) === 'one' ? 'card' : 'cards'}`,
  openRun: (label: string) => `Open ${label}`,
  runTitle: (goal: string, start: string, end: string, count: number) => `${goal} · ${start} — ${end} · ${count.toLocaleString(locale())} ${new Intl.PluralRules(locale('en')).select(count) === 'one' ? 'card' : 'cards'}`,
  noMilestones: 'The project has no Milestones yet.',
  readOnlyPlanHint: 'Runs and Milestones appear here once the plan has them.',
  selectPrompt: 'Select a Run, Milestone diamond, or due-date bell on the axis.',
  setupRuns: 'Set up recurring Runs',
  nothingSelected: 'Nothing selected',
  createHintBefore: 'You can create Milestones or Runs via the',
  createHintAfter: 'button at the top.',
  createMilestone: 'Create Milestone',
  cluster: (count: number, date: string) => `${count.toLocaleString(locale())} items from ${date}`,
  more: (count: number) => `+${count.toLocaleString(locale())}`,
  accepted: 'Done', remainingEffort: 'Effort left',
}, {
  timeline: 'Timeline',
  milestone: (title: string) => `Milestone ${title}`,
  dueDates: (date: string) => `Сроки · ${date}`,
  myCards: 'Мои карточки',
  saveError: 'Не удалось сохранить план. Повторите действие.',
  overview: 'Обзор Milestone',
  calendar: 'Открыть календарь',
  createPlan: 'Создать Milestone или расписание Run',
  loading: 'Загружаем Timeline…',
  axisLabel: 'Ось времени: прокрутка колесом, перетаскиванием или стрелками',
  milestoneTitle: (title: string, date: string, countdown: string, done: number, tasks: number) => `${title} · ${date} · ${countdown} · ${stateLabel('done', 'ru').toLocaleLowerCase(locale('ru'))} ${done.toLocaleString(locale())}/${tasks.toLocaleString(locale())}`,
  dueMarker: (date: string) => `Сроки ${date}`,
  dueMarkerTitle: (member: string, date: string, count: number) => `${member} · ${date} · карточек: ${count.toLocaleString(locale())}`,
  openRun: (label: string) => `Открыть ${label}`,
  runTitle: (goal: string, start: string, end: string, count: number) => `${goal} · ${start} — ${end} · карточек: ${count.toLocaleString(locale())}`,
  noMilestones: 'В проекте ещё нет Milestone.',
  readOnlyPlanHint: 'Run и Milestone появятся здесь, когда они будут в плане.',
  selectPrompt: 'Выберите Run, ромб Milestone или колокольчик срока на оси.',
  setupRuns: 'Настроить повторяющиеся Run',
  nothingSelected: 'Ничего не выбрано',
  createHintBefore: 'Создать Milestone или Run можно кнопкой',
  createHintAfter: 'вверху.',
  createMilestone: 'Создать Milestone',
  cluster: (count: number, date: string) => {
    const rule = new Intl.PluralRules(locale('ru')).select(count);
    if (rule === 'one') return `${count.toLocaleString(locale())} отметка с ${date}`;
    if (rule === 'few') return `${count.toLocaleString(locale())} отметки с ${date}`;
    return `${count.toLocaleString(locale())} отметок с ${date}`;
  },
  more: (count: number) => `+${count.toLocaleString(locale())}`,
  accepted: 'Принято', remainingEffort: 'Осталось по оценке',
});

/** Ten pixels per day keep each ISO week cell 70 pixels wide. */
const dayWidth = 10;
/**
 * Axis band layout (2026-11-05, layout B): the month row, one row of Milestones, one row of the viewer's due dates
 * when there are any, then the date strip, week cells and Run lanes. Each kind of mark keeps its own row, so nothing climbs over
 * the month names or covers today's date.
 */
const band = { month: 8, rows: 30, row: 32, stripGap: 2, weekGap: 20, runsGap: 24, lane: 60, minRuns: 24 } as const;
/** Width of a milestone or due marker on the axis (.timeline-milestone-marker in planning.css); closer marks in a row merge. */
const markerWidth = 30;
export type PlanningSaveResult = { ok: boolean; revisions?: CatalogView; message?: string };
export type SavePlanning = (action: PlanningEdit) => Promise<PlanningSaveResult>;
function monthName(iso: string, lang: Lang) { return new Intl.DateTimeFormat(locale(lang), { month: 'long', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`)); }
/** The elapsed fraction of the day positions the shaded past's edge at the current hour. */
function dayFraction(now = new Date()) { return (now.getHours() * 60 + now.getMinutes()) / 1440; }
/**
 * Each Run schedule, and the standalone Runs without one, keeps its own lanes (2026-11-05): two «Run 3» of different schedules
 * never interleave. Inside a group a Run takes the first lane that is free by its start.
 */
function runLanes(runs: RunRecord[]) {
  const groups = new Map<string, RunRecord[]>();
  for (const run of [...runs].sort((first, second) => first.start.localeCompare(second.start))) groups.set(run.configurationId ?? '', [...groups.get(run.configurationId ?? '') ?? [], run]);
  const placed: { run: RunRecord; lane: number }[] = [];
  let base = 0;
  for (const [, group] of [...groups].sort(([first, firstRuns], [second, secondRuns]) => Number(!first) - Number(!second) || firstRuns[0].start.localeCompare(secondRuns[0].start))) {
    const ends: string[] = [];
    for (const run of group) {
      let lane = ends.findIndex(end => end < run.start);
      if (lane < 0) lane = ends.length;
      ends[lane] = run.end;
      placed.push({ run, lane: base + lane });
    }
    base += ends.length;
  }
  return { placed, count: base, schedules: groups.size };
}
/** A bell is red when an open task is due today or earlier, amber within five workdays. */
function dueTone(due: CatalogCard[], date: string, today = localIsoDate()): string {
  const open = due.some(card => card.kind === 'task' && card.state !== 'done');
  if (open && date <= today) return ' is-overdue';
  if (open && workdaysUntil(today, date) <= 5) return ' is-soon';
  return '';
}
function clusters<T>(marks: { x: number; item: T }[]): { x: number; items: T[] }[] {
  const groups: { x: number; items: T[] }[] = [];
  for (const mark of [...marks].sort((first, second) => first.x - second.x)) {
    const last = groups.at(-1);
    if (last && mark.x - last.x < markerWidth) last.items.push(mark.item);
    else groups.push({ x: mark.x, items: [mark.item] });
  }
  return groups;
}

export function TimelineView({ snapshot, refreshKey, selectCurrentRun = false, onOpenCard, onEditing }: {
  snapshot: WorkspaceSnapshot; refreshKey: number; selectCurrentRun?: boolean; onOpenCard: (id: string) => void; onEditing?: (editing: boolean) => void;
}) {
  const { catalog, error, warning, pending, edit, refresh } = useCatalog(snapshot, refreshKey);
  const t = useText(text);
  const lang = useLang();
  const [planningPending, setPlanningPending] = useState(false);
  const [planningError, setPlanningError] = useState<string | null>(null);
  const savingPlanning = useRef(false);
  const retryPlanning = useRef<() => Promise<unknown>>(async () => undefined);
  const [locked, setLocked] = useState(false);
  const [scopeDirty, setScopeDirty] = useState(false);
  const [selection, setSelection] = useState<PlanningTarget | null>(null);
  const lastSelectedPlan = useRef<PlanningPlan | undefined>(undefined);
  const [overview, setOverview] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarDraft, setCalendarDraft] = useState<CalendarDraft | null>(null);
  const [calendarDirty, setCalendarDirty] = useState(false);
  const calendarButton = useRef<HTMLButtonElement>(null);
  const createButton = useRef<HTMLButtonElement>(null);
  const calendarOpener = useRef<HTMLElement | null>(null);
  // A toolbar close or draft switch over a dirty form becomes a request the calendar answers through its strip (2026-11-05).
  const [calendarRequest, setCalendarRequest] = useState<{ id: number; draft: CalendarDraft | null } | null>(null);
  const calendarRequestId = useRef(0);
  const openingFromMenu = useRef(false);
  useEffect(() => { onEditing?.(scopeDirty || calendarDirty); }, [scopeDirty, calendarDirty, onEditing]);
  useEffect(() => () => onEditing?.(false), [onEditing]);
  const [memberRevision, setMemberRevision] = useState(0);
  const today = localIsoDate();
  const scrollRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointer: number; left: number; start: number } | null>(null);
  useEffect(() => onMemberChange(() => { setMemberRevision(value => value + 1); setSelection(previous => previous?.kind === 'dueDate' ? null : previous); }), []);
  const runs = [...catalog?.runs ?? []].sort((first, second) => first.start.localeCompare(second.start));
  const currentRun = orderedRunChoices(runs, today)[0];
  const milestones = catalog?.milestones ?? [];
  const cards = useMemo(() => (catalog?.cards ?? []).filter(card => !card.archived && !card.deleted), [catalog]);
  const member = useMemo(() => currentMember(catalog?.members ?? []), [catalog?.members, memberRevision]);
  const dueCards = useMemo(() => cards.filter(card => card.dueDate && member && [member.label, ...member.aliases].some(name => name.toLocaleLowerCase('ru') === card.owner?.toLocaleLowerCase('ru'))), [cards, member]);
  const dueGroups = useMemo(() => {
    const dates = new Map<string, CatalogCard[]>();
    for (const card of dueCards) dates.set(card.dueDate!, [...dates.get(card.dueDate!) ?? [], card]);
    return [...dates].sort(([first], [second]) => first.localeCompare(second));
  }, [dueCards]);
  const hasDates = runs.length > 0 || milestones.length > 0 || dueCards.length > 0;
  const model = useMemo(() => {
    const dates = [addDays(today, -120), addDays(today, 240), ...runs.flatMap(run => [run.start, run.end]), ...milestones.map(milestone => milestone.date), ...dueCards.map(card => card.dueDate!)].sort();
    const start = monthStart(dates[0]);
    const end = monthStart(dates.at(-1)!, 1);
    const months: string[] = [];
    for (let current = start; current < end; current = monthStart(current, 1)) months.push(current);
    const weeks: string[] = [];
    let monday = addDays(start, (8 - (new Date(`${start}T00:00:00Z`).getUTCDay() || 7)) % 7);
    for (; monday < end; monday = addDays(monday, 7)) weeks.push(monday);
    return { start, width: dayDistance(start, end) * dayWidth, months, weeks, today: dayDistance(start, today) * dayWidth, now: (dayDistance(start, today) + dayFraction()) * dayWidth };
  }, [catalog, dueCards, today]);
  const lanes = runLanes(runs);
  const offset = (date: string) => dayDistance(model.start, date) * dayWidth;
  const milestoneMarks = clusters(milestones.map(milestone => ({ x: offset(milestone.date), item: milestone })));
  const dueMarks = clusters(dueGroups.map(group => ({ x: offset(group[0]), item: group })));
  const rows = { milestones: band.rows, due: band.rows + band.row };
  const stripTop = band.rows + (dueMarks.length ? 2 : 1) * band.row + band.stripGap;
  const weekTop = stripTop + band.weekGap;
  const runsTop = weekTop + band.runsGap;
  const height = runsTop + Math.max(band.minRuns, lanes.count * band.lane);
  // With more than one schedule a Run bar names its schedule, as the short name is meant to tell parallel Runs apart.
  const bandRunLabel = (run: RunRecord) => {
    const shortName = lanes.schedules > 1 ? catalog?.runConfigurations?.find(candidate => candidate.id === run.configurationId)?.shortName : undefined;
    return shortName ? `${shortName} · ${runLabel(run, lang)}` : runLabel(run, lang);
  };
  const storageKey = catalog ? `deckmate-timeline:${snapshot.source}:${catalog.rootIdentity}` : null;
  function remember(target: PlanningTarget) {
    if (storageKey && target.kind !== 'dueDate') {
      try { localStorage.setItem(storageKey, JSON.stringify(target)); } catch { /* optional navigation memory */ }
    }
  }
  useEffect(() => {
    if (!storageKey || locked) return;
    if (selectCurrentRun) {
      if (currentRun) {
        const target: PlanningTarget = { kind: 'run', id: currentRun.id };
        setSelection(target);
        setOverview(false);
        remember(target);
      }
      return;
    }
    try {
      const stored = JSON.parse(readStoredValue(localStorage, storageKey) ?? 'null') as PlanningTarget | null;
      if (stored && ['run', 'milestone'].includes(stored.kind) && typeof stored.id === 'string') setSelection(stored);
    } catch { /* 2026-11-04: storage is optional; an unavailable browser store must not block the view. */ }
  }, [storageKey, selectCurrentRun, currentRun?.id]);
  function choose(target: PlanningTarget) { if (locked) return; setSelection(target); setOverview(false); remember(target); }
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollLeft = Math.max(0, model.today - element.clientWidth * .22);
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      const before = element.scrollLeft;
      const scale = event.deltaMode === 1 ? 16 : 1;
      element.scrollLeft += event.deltaY * scale;
      if (before !== element.scrollLeft) event.preventDefault();
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [Boolean(catalog), hasDates, model.start, model.width]);
  const savedRun = selection?.kind === 'run' ? runs.find(run => run.id === selection.id) : undefined;
  const savedMilestone = selection?.kind === 'milestone' ? milestones.find(milestone => milestone.id === selection.id) : undefined;
  useEffect(() => {
    if (savedRun) lastSelectedPlan.current = { kind: 'run', record: savedRun };
    else if (savedMilestone) lastSelectedPlan.current = { kind: 'milestone', record: savedMilestone };
  }, [savedRun, savedMilestone]);
  // 2026-11-05: a refreshed catalog may remove the record while the details form still owns an unsaved draft.
  const retainedPlan = scopeDirty && lastSelectedPlan.current?.kind === selection?.kind
    && lastSelectedPlan.current?.record.id === selection?.id ? lastSelectedPlan.current : undefined;
  const selectedRun = savedRun ?? (retainedPlan?.kind === 'run' ? retainedPlan.record : undefined);
  const selectedMilestone = savedMilestone ?? (retainedPlan?.kind === 'milestone' ? retainedPlan.record : undefined);
  const validSelection = Boolean(selectedRun || selectedMilestone || selection?.kind === 'dueDate' && dueGroups.some(([date]) => date === selection.id));
  const selectedCards = validSelection && selection ? (selection.kind === 'dueDate' ? dueCards : cards).filter(card => card[selection.kind] === selection.id) : [];
  let title = '';
  let subtitle = '';
  if (selectedRun) { title = selectedRun.goal || runLabel(selectedRun, lang); subtitle = `${formatPlanningDate(selectedRun.start, lang)} — ${formatPlanningDate(selectedRun.end, lang)}`; }
  if (selectedMilestone) { title = selectedMilestone.title; subtitle = `${formatPlanningDate(selectedMilestone.date, lang)} · ${countdown(selectedMilestone.date, today, lang)}`; }
  if (selection?.kind === 'dueDate') { title = t.dueDates(formatPlanningDate(selection.id, lang)); subtitle = member?.label ?? t.myCards; }
  const writable = snapshot.source === 'sandbox' && snapshot.writable;
  let emptyMessage = t.selectPrompt;
  if (!hasDates && writable) emptyMessage = `${t.createHintBefore} + ${t.createHintAfter}`;
  function openCalendar(draft: CalendarDraft | null, opener?: HTMLElement | null) {
    if (calendarOpen && calendarDirty) { setCalendarRequest({ id: ++calendarRequestId.current, draft }); return; }
    setPlanningError(null);
    if (!calendarOpen) calendarOpener.current = opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : calendarButton.current);
    setCalendarDraft(draft);
    setCalendarOpen(true);
  }
  function hideCalendar() {
    // 2026-11-11: the create menu disappears, so its surviving trigger owns the return step.
    moveFocus(calendarOpener.current?.isConnected ? calendarOpener.current : calendarButton.current, { preventScroll: true });
    setCalendarDraft(null);
    setCalendarOpen(false);
  }
  function closeCalendar() {
    if (calendarDirty) { setCalendarRequest({ id: ++calendarRequestId.current, draft: null }); return; }
    hideCalendar();
  }

  const savePlanning: SavePlanning = async action => {
    if (!catalog || !writable || savingPlanning.current || pending) return { ok: false };
    savingPlanning.current = true;
    setPlanningPending(true);
    setPlanningError(null);
    try {
      retryPlanning.current = () => savePlanning(action);
      const token = (snapshot as WorkspaceSnapshot & { token?: string }).token;
      const response = await fetch('/api/planning', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-deckmate-token': token ?? '', ...actorHeaders(catalog.members ?? []) },
        body: JSON.stringify({ ...action, source: snapshot.source }),
      });
      const result = await response.json();
      if (response.ok || result.saved) retryPlanning.current = refresh;
      if (!response.ok) {
        let revisions: CatalogView | undefined;
        if (response.status === 409 || result.saved) {
          revisions = await readFreshCatalog(snapshot.source);
        }
        setPlanningError(result.message ?? t.saveError);
        return { ok: false, revisions, message: result.message ?? t.saveError };
      }
      await refresh();
      setPlanningError(result.warnings?.find((message: string) => /(?:изменения сохранены|changes saved)/iu.test(message)) ?? null);
      return { ok: true, revisions: result as CatalogView };
    } catch (failure) {
      // 2026-11-06: a stopped server rejects fetch with a TypeError whose browser wording ("Failed to fetch") explains nothing.
      const message = failureMessage(failure, t.saveError);
      setPlanningError(message);
      return { ok: false, message };
    } finally {
      savingPlanning.current = false;
      setPlanningPending(false);
    }
  };

  // 2026-11-06: a modal menu traps focus while its items open the non-modal calendar form; the two scopes passed focus
  // back and forth until the form saw focus outside and closed, so «Create Milestone» and «Set up recurring Runs» showed no form.
  // A non-modal menu, as in the bulk «More» menu, lets the form take focus.
  const actions = <div className="timeline-actions page-tools">
      {writable && <DropdownMenu.Root modal={false}><DropdownMenu.Trigger asChild><Button ref={createButton} variant="default" size="icon" className="timeline-create action-mint" aria-label={t.createPlan} title={t.createPlan} disabled={locked || planningPending}><Plus size={18} /></Button></DropdownMenu.Trigger>
        <DropdownMenu.Portal><DropdownMenu.Content className="planning-create-menu" align="end" sideOffset={6} collisionPadding={12} onCloseAutoFocus={event => { if (openingFromMenu.current) { event.preventDefault(); openingFromMenu.current = false; } }}>
          <DropdownMenu.Item onSelect={() => { openingFromMenu.current = true; openCalendar({ kind: 'milestone', date: today }, createButton.current); }}>{t.createMilestone}</DropdownMenu.Item>
          <DropdownMenu.Item onSelect={() => { openingFromMenu.current = true; openCalendar({ kind: 'configuration' }, createButton.current); }}>{t.setupRuns}</DropdownMenu.Item>
        </DropdownMenu.Content></DropdownMenu.Portal>
      </DropdownMenu.Root>}
      <Button ref={calendarButton} variant="outline" size="icon" className="timeline-tool" aria-label={t.calendar} title={t.calendar} aria-pressed={calendarOpen} disabled={locked || planningPending} onClick={event => { if (calendarOpen) closeCalendar(); else openCalendar(null, event.currentTarget); }}><CalendarDays size={16} /></Button>
      <Button disabled={locked} variant="outline" size="icon" className="timeline-tool" aria-label={t.overview} title={t.overview} aria-pressed={overview} onClick={() => setOverview(value => !value)}><BarChart3 size={16} /></Button>
    </div>;

  return <section className="planning-view planning-parity page-light">
    <header className="page-head"><div className="page-head-main"><div className="page-title-block"><h1 className="page-title">{t.timeline}</h1></div>{actions}</div></header>
    <ErrorState message={error} onRetry={refresh} />{warning && <div className="notice" role="status">{warning}</div>}
    <ErrorState variant="saved-input" message={calendarOpen ? null : planningError} pending={planningPending} onRetry={() => retryPlanning.current()} />
    {catalog?.warnings.filter(message => /(?:deckmate|freetion)-(runs|milestones)/u.test(message)).map(message => <div key={message} className="notice">{message}</div>)}
    {!catalog && !error && <LoadingState message={t.loading} />}
    {catalog && <div className="timeline-axis-panel glass-panel"><div className="timeline-band"><div className="timeline-scroll" ref={scrollRef} tabIndex={0} role="region" aria-label={t.axisLabel}
      onKeyDown={event => { if (event.target !== event.currentTarget) return; if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); event.currentTarget.scrollLeft += event.key === 'ArrowRight' ? dayWidth * 7 : -dayWidth * 7; } if (event.key === 'Home') { event.preventDefault(); event.currentTarget.scrollLeft = model.today - event.currentTarget.clientWidth * .22; } }}
      onPointerDown={event => { if (event.button !== 0 || (event.target as Element).closest('button')) return; drag.current = { pointer: event.pointerId, start: event.clientX, left: event.currentTarget.scrollLeft }; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => { if (drag.current?.pointer === event.pointerId) event.currentTarget.scrollLeft = drag.current.left - (event.clientX - drag.current.start); }}
      onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}>
      <div className="timeline-canvas" style={{ width: model.width, height }}>
        {model.months.map(date => <span key={date} className="timeline-month-label" style={{ left: offset(date), top: band.month, width: dayDistance(date, monthStart(date, 1)) * dayWidth }}>{monthName(date, lang)}<small>{date.slice(0, 4)}</small></span>)}
        {model.months.map(date => <span key={`strip-${date}`} className="timeline-month-strip" style={{ left: offset(date), top: stripTop, width: dayDistance(date, monthStart(date, 1)) * dayWidth }} aria-hidden="true" />)}
        {model.weeks.map(date => <span key={date} className={`timeline-week-label${date <= today && today < addDays(date, 7) ? ' is-current' : ''}`} style={{ left: offset(date), top: weekTop, width: dayWidth * 7 }}>{isoWeek(date).toLocaleString(locale(lang))}</span>)}
        <span className="timeline-now-line" style={{ left: model.now, top: band.rows - 2 }} aria-hidden="true" />
        <span className="timeline-now" style={{ left: model.now, top: stripTop }}><span>{formatPlanningDate(today, lang)}</span></span>
        <div className="timeline-past" style={{ width: model.now }} aria-hidden="true" />
        {milestoneMarks.map(mark => {
          const [milestone] = mark.items;
          const summary = metrics(cards.filter(card => card.milestone === milestone.id));
          const marker = <button disabled={locked} className={`timeline-milestone-marker${milestone.date < today ? ' is-past' : ''}`} style={{ left: mark.x, top: rows.milestones, color: milestone.color }}
            aria-label={mark.items.length > 1 ? t.cluster(mark.items.length, formatPlanningDate(milestone.date, lang)) : t.milestone(milestone.title)}
            aria-pressed={selection?.kind === 'milestone' && mark.items.some(item => item.id === selection.id)}
            title={mark.items.length > 1 ? undefined : t.milestoneTitle(milestone.title, formatPlanningDate(milestone.date, lang), countdown(milestone.date, today, lang), summary.done, summary.tasks)}
            onClick={mark.items.length > 1 ? undefined : () => choose({ kind: 'milestone', id: milestone.id })}><span />{mark.items.length > 1 && <small className="timeline-cluster-count">{t.more(mark.items.length - 1)}</small>}</button>;
          return mark.items.length > 1 ? <TimelineCluster key={milestone.id} trigger={marker} entries={mark.items.map(item => ({ key: item.id, icon: <span className={`planning-diamond${item.date < today ? ' is-past' : ''}`} style={{ color: item.color }} />, label: item.title, date: formatPlanningDate(item.date, lang), onSelect: () => choose({ kind: 'milestone', id: item.id }) }))} />
            : <span key={milestone.id} className="timeline-mark">{marker}</span>;
        })}
        {dueMarks.map(mark => {
          const [[date, due]] = mark.items;
          const tone = dueTone(mark.items.flatMap(([, group]) => group), mark.items[0][0]);
          const marker = <button disabled={locked} className={`timeline-due-marker${tone}`} style={{ left: mark.x, top: rows.due }}
            aria-label={mark.items.length > 1 ? t.cluster(mark.items.length, formatPlanningDate(date, lang)) : t.dueMarker(formatPlanningDate(date, lang))}
            aria-pressed={selection?.kind === 'dueDate' && mark.items.some(([itemDate]) => itemDate === selection.id)}
            title={mark.items.length > 1 ? undefined : t.dueMarkerTitle(member?.label ?? '', formatPlanningDate(date, lang), due.length)}
            onClick={mark.items.length > 1 ? undefined : () => choose({ kind: 'dueDate', id: date })}><Bell size={22} />
            <small className={mark.items.length > 1 ? 'timeline-cluster-count' : undefined}>{mark.items.length > 1 ? t.more(mark.items.length - 1) : (due.length).toLocaleString(locale(lang))}</small></button>;
          return mark.items.length > 1 ? <TimelineCluster key={date} trigger={marker} entries={mark.items.map(([itemDate, group]) => ({ key: itemDate, icon: <Bell size={14} aria-hidden="true" />, label: t.dueMarkerTitle(member?.label ?? '', formatPlanningDate(itemDate, lang), group.length), date: '', onSelect: () => choose({ kind: 'dueDate', id: itemDate }) }))} />
            : <span key={date} className="timeline-mark">{marker}</span>;
        })}
        {[...new Map(lanes.placed.map(({ run, lane }) => [lane, run])).entries()].map(([lane, run]) => <div key={lane} className="timeline-lane-label" style={{ top: runsTop + lane * band.lane }}><span>{catalog.runConfigurations?.find(configuration => configuration.id === run.configurationId)?.shortName ?? t.timeline}</span></div>)}
        {lanes.placed.map(({ run, lane }) => {
          const runCards = cards.filter(card => card.run === run.id);
          const active = !run.finishedAt && run.start <= today && run.end >= today;
          const configuration = catalog.runConfigurations?.find(candidate => candidate.id === run.configurationId);
          const width = dayDistance(run.start, addDays(run.end, 1)) * dayWidth - 6;
          return <button disabled={locked} key={run.id} className={`timeline-run${active ? ' is-active' : ''}${run.finishedAt || run.end < today ? ' is-past' : ''}`} style={{ left: offset(run.start) + 3, width, top: runsTop + lane * band.lane + 18, borderColor: configuration?.color }} aria-label={t.openRun(bandRunLabel(run))} aria-pressed={selection?.kind === 'run' && selection.id === run.id} title={t.runTitle(bandRunLabel(run), formatPlanningDate(run.start, lang), formatPlanningDate(run.end, lang), runCards.length)} onClick={() => choose({ kind: 'run', id: run.id })}><span>{width < 100 ? run.number.toLocaleString(locale(lang)) : runLabel(run, lang)}</span><PlanningProgress cards={runCards} /></button>;
        })}
      </div>
    </div></div></div>}
    {catalog && overview && <section className="planning-overview glass-panel" aria-label={t.overview}>{milestones.map(milestone => {
      const summary = metrics(cards.filter(card => card.milestone === milestone.id));
      return <article className="planning-overview-row" key={milestone.id}>
      <button className="planning-overview-title" onClick={() => choose({ kind: 'milestone', id: milestone.id })}><span className="planning-diamond" style={{ color: milestone.color }} /><strong className="planning-overview-name">{milestone.title}</strong><span>{formatPlanningDate(milestone.date, lang)}</span><small>{countdown(milestone.date, today, lang)}</small></button>
      <div className="planning-count"><span>{t.accepted} <span className="page-number">{summary.done.toLocaleString(locale(lang))} / {summary.tasks.toLocaleString(locale(lang))}</span></span><span>{t.remainingEffort} <span className="page-number">{(summary.effort - summary.doneEffort).toLocaleString(locale(lang))}</span></span></div>
    </article>;
    })}{!milestones.length && (writable
      ? <EmptyState variant="first-run" title={t.noMilestones} art="milestone"
          message={t.createHintBefore + ' + ' + t.createHintAfter} action={{ label: t.createMilestone, onClick: () => openCalendar({ kind: 'milestone', date: today }) }} />
      : <EmptyState variant="first-run" art="milestone" title={t.noMilestones} message={t.readOnlyPlanHint} />)}</section>}
    {catalog && validSelection && !overview && selection && <div className="timeline-scope-panel glass-panel"><PlanningScope key={`${selection.kind}:${selection.id}:${selection.kind === 'dueDate' ? member?.id : ''}`} title={title} subtitle={subtitle} retainedPlan={retainedPlan} target={selection.kind === 'dueDate' ? undefined : selection} cards={selectedCards} catalog={catalog} snapshot={snapshot} pending={pending || planningPending} onEdit={edit} onOpenCard={onOpenCard} onLockChange={setLocked} onDirtyChange={setScopeDirty} onPlanningEdit={savePlanning} planningError={planningError} onDeleted={() => { setSelection(null); if (storageKey) { try { localStorage.removeItem(storageKey); } catch { /* 2026-11-05: navigation memory is optional. */ } } }} /></div>}
    {catalog && !validSelection && !overview && <aside className="timeline-nothing glass-panel"><EmptyState variant="first-run" title={t.nothingSelected} art="milestone"
      message={emptyMessage} /></aside>}
    {catalog && <PlanningCalendar open={calendarOpen} selected={selection} onClose={hideCalendar} draft={calendarDraft} onDraftChange={setCalendarDraft} onDirtyChange={setCalendarDirty}
      viewRequest={calendarRequest} onViewRequestHandled={() => setCalendarRequest(null)}
      catalog={catalog} cards={cards} today={today} writable={writable} pending={pending || planningPending} error={planningError} onSave={savePlanning} onChoose={target => { setSelection(target); setOverview(false); remember(target); }} />}
    <ShortcutsHelp screens={timelineShortcutScreens} writable={writable} />
  </section>;
}

/** Marks that share a spot open a short list; choosing one selects it as a single mark would (2026-11-05). */
export function TimelineCluster({ trigger, entries, opensForm = false }: { trigger: React.ReactElement; entries: { key: string; icon: React.ReactNode; label: string; date: string; onSelect: () => void }[]; opensForm?: boolean }) {
  const chosen = useRef(false);
  return <span className="timeline-mark"><DropdownMenu.Root modal={false}><DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
    <DropdownMenu.Portal><DropdownMenu.Content className="planning-create-menu timeline-cluster-menu" side="bottom" align="center" sideOffset={6} collisionPadding={12}
      onCloseAutoFocus={event => { if (chosen.current) { event.preventDefault(); chosen.current = false; } }}>
      {entries.map(entry => <DropdownMenu.Item key={entry.key} onSelect={() => { chosen.current = opensForm; entry.onSelect(); }}>{entry.icon}<span>{entry.label}</span>{entry.date && <small>{entry.date}</small>}</DropdownMenu.Item>)}
    </DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root></span>;
}
