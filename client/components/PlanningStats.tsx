import { defineText, locale, useLang, useText } from '../i18n.ts';
import { priorityLabel, stateLabel } from '../locales/common.ts';
import type { CatalogCard, CatalogView, PlanningDistribution, PlanningHistoryPoint, RunRecord } from '../../src/catalog-contracts.ts';
import { boardColumns } from '../../src/catalog-contracts.ts';
import { dayDistance, formatPlanningDate, localDay, metrics, runVelocityEffort } from '../planning-metrics.ts';
import { statusClass } from './StatusMenu.tsx';
import '../planning-details.css';

const text = defineText({
  distribution: (label: string, done: string, total: string) => `${label}: ${done} of ${total} done`,
  noPriority: "No priority",
  tasksDone: "Tasks done",
  effortDone: "Effort · done / total",
  effortRemaining: "Effort remaining",
  unestimated: "Tasks without estimates",
  completion: "Share of tasks done",
  empty: "No tasks in this scope. Heroes and Docs are not included in progress.",
  states: "States",
  priority: "Priority · done / total",
  owners: "Owners · done / total",
  noOwner: "Unassigned",
  effortDecks: "Effort by Deck",
  noDeck: "No deck",
  remaining: (effort: string, unestimated: string) => `${effort} remaining${unestimated ? ` · without estimates: ${unestimated}` : ""}`,
  saved: (date: string) => `Statistics preserved at completion · ${date}`,
  velocity: 'Velocity · Effort done in 7 days',
  velocityThrough: (date: string) => `Across this Run configuration, through ${date}.`,
  standaloneVelocityThrough: (date: string) => `For this Run, through ${date}.`,
  burndown: 'Burndown · remaining tasks',
  observed: 'Recorded observations; dates without observations are not reconstructed.',
  noHistory: 'No saved daily observations. Past dates are not reconstructed.',
  historyData: 'Show recorded values', historyDate: 'Date', historyRemaining: 'Remaining', historyTotal: 'Total',
  chart: (start: string, end: string) => `Remaining tasks from ${start} to ${end}`,
}, {
  distribution: (label: string, done: string, total: string) => `${label}: принято ${done} из ${total}`,
  noPriority: "Без приоритета",
  tasksDone: "Принято задач",
  effortDone: "Effort · принято / всего",
  effortRemaining: "Осталось Effort",
  unestimated: "Задач без оценки",
  completion: "Доля принятых задач",
  empty: "В этом объёме нет задач. Hero и документы не входят в прогресс.",
  states: "Состояния",
  priority: "Приоритет · принято / всего",
  owners: "Исполнители · принято / всего",
  noOwner: "Без исполнителя",
  effortDecks: "Effort по колодам",
  noDeck: "Без колоды",
  remaining: (effort: string, unestimated: string) => `Осталось ${effort}${unestimated ? ` · без оценки: ${unestimated}` : ""}`,
  saved: (date: string) => `Статистика сохранена при завершении · ${date}`,
  velocity: 'Velocity · принято Effort за 7 дней',
  velocityThrough: (date: string) => `По всей настройке Run, по ${date} включительно.`,
  standaloneVelocityThrough: (date: string) => `Для этого Run, по ${date} включительно.`,
  burndown: 'Сгорание · осталось задач',
  observed: 'Сохранённые наблюдения; даты без наблюдений не восстанавливаются.',
  noHistory: 'Сохранённых дневных наблюдений нет. Прошлые даты не восстанавливаются.',
  historyData: 'Показать записанные значения', historyDate: 'Дата', historyRemaining: 'Осталось', historyTotal: 'Всего',
  chart: (start: string, end: string) => `Оставшиеся задачи с ${start} по ${end}`,
});

function DistributionRow({ label, total, done, maximum, note, state }: {
  label: string;
  total: number;
  done: number;
  maximum: number;
  note?: string;
  state?: string;
}) {
  const t = useText(text);
  const lang = useLang();
  const amount = (value: number) => new Intl.NumberFormat(locale(lang), { maximumFractionDigits: 2 }).format(value);
  const width = maximum ? Math.min(100, total / maximum * 100) : 0;
  const completedWidth = total ? Math.min(100, done / total * 100) : 0;
  return <div className="planning-stat-row">
    <span className="planning-stat-label" title={label}>{label}</span>
    <span className="planning-stat-value">{amount(done)} / {amount(total)}</span>
    <div className="planning-stat-bar" role="img" aria-label={t.distribution(label, amount(done), amount(total))}>
      <span className={'planning-stat-remaining' + (state ? ` status-${statusClass(state)}` : '')} style={{ width: `${width}%` }}>
        <span className="planning-stat-done" style={{ width: `${completedWidth}%` }} />
      </span>
    </div>
    {note && <span className="planning-stat-note">{note}</span>}
  </div>;
}

function taskDistribution(cards: CatalogCard[], getKey: (card: CatalogCard) => string, effort = false): PlanningDistribution[] {
  const groups = new Map<string, CatalogCard[]>();
  for (const card of cards) {
    const key = getKey(card);
    const group = groups.get(key) ?? [];
    group.push(card);
    groups.set(key, group);
  }
  return [...groups].map(([key, grouped]) => ({ key,
    total: effort ? metrics(grouped).effort : grouped.length,
    done: effort ? metrics(grouped).doneEffort : metrics(grouped).done,
    ...(effort ? { unestimated: metrics(grouped).unestimated } : {}),
  }));
}

function Burndown({ history }: { history: PlanningHistoryPoint[] }) {
  const t = useText(text);
  const lang = useLang();
  const points = [...new Map(history.map(point => [point.date, point])).values()].sort((first, second) => first.date.localeCompare(second.date));
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return <figure className="planning-burndown"><h3>{t.burndown}</h3><p className="planning-stat-note">{t.noHistory}</p></figure>;
  const amount = (value: number) => new Intl.NumberFormat(locale(lang)).format(value);
  const maximum = Math.max(1, ...points.map(point => point.tasks - point.done));
  const span = Math.max(1, dayDistance(first.date, last.date));
  const horizontal = (point: PlanningHistoryPoint) => 26 + dayDistance(first.date, point.date) / span * 270;
  const vertical = (point: PlanningHistoryPoint) => 112 - (point.tasks - point.done) / maximum * 96;
  return <figure className="planning-burndown">
    <h3>{t.burndown}</h3>
    <svg viewBox="0 0 310 130" role="img" aria-label={t.chart(first.date, last.date)}>
      <line className="planning-burndown-axis" x1="26" y1="16" x2="26" y2="112" />
      <line className="planning-burndown-axis" x1="26" y1="112" x2="296" y2="112" />
      <text className="planning-burndown-label" x="20" y="20" textAnchor="end">{amount(maximum)}</text>
      <text className="planning-burndown-label" x="20" y="115" textAnchor="end">{amount(0)}</text>
      <polyline className="planning-burndown-line" points={points.map(point => `${horizontal(point)},${vertical(point)}`).join(' ')} />
      {points.map(point => <circle key={point.date} className="planning-burndown-point" cx={horizontal(point)} cy={vertical(point)} r="3"><title>{`${point.date}: ${amount(point.tasks - point.done)}`}</title></circle>)}
    </svg>
    <figcaption><span>{formatPlanningDate(first.date, lang)}</span><span>{formatPlanningDate(last.date, lang)}</span></figcaption>
    <p className="planning-stat-note">{t.observed}</p>
    <details><summary>{t.historyData}</summary><table className="planning-history-table"><thead><tr><th scope="col">{t.historyDate}</th><th scope="col">{t.historyRemaining}</th><th scope="col">{t.historyTotal}</th></tr></thead>
      <tbody>{points.map(point => <tr key={point.date}><td>{point.date}</td><td>{amount(point.tasks - point.done)}</td><td>{amount(point.tasks)}</td></tr>)}</tbody></table></details>
  </figure>;
}

/** Finished Runs use their immutable completion snapshot, not cards remaining after carry-over (2026-11-05). */
export function PlanningStats({ cards, catalog, comparisonTotal, comparisonEffort, run, milestoneId, history }: {
  cards: CatalogCard[];
  catalog: CatalogView;
  comparisonTotal?: number;
  comparisonEffort?: number;
  run?: RunRecord;
  milestoneId?: string;
  history?: PlanningHistoryPoint[];
}) {
  const t = useText(text);
  const lang = useLang();
  const amount = (value: number) => new Intl.NumberFormat(locale(lang), { maximumFractionDigits: 2 }).format(value);
  const tasks = cards.filter(card => card.kind === 'task' && !card.archived && !card.deleted);
  const snapshot = run?.finishedAt ? run.statistics : undefined;
  const summary = snapshot ? { ...snapshot, percent: snapshot.tasks ? Math.round(snapshot.done / snapshot.tasks * 100) : 0 } : metrics(tasks);
  const maximum = Math.max(comparisonTotal ?? 0, summary.tasks);
  const states = snapshot?.states ?? taskDistribution(tasks, card => card.state ?? 'not-started');
  const owners = snapshot?.owners ?? taskDistribution(tasks, card => card.owner ?? '');
  const decks = snapshot?.decks ?? taskDistribution(tasks, card => card.deckId ?? '', true);
  const priorities = snapshot?.priorities ?? taskDistribution(tasks, card => card.priority ?? '');
  const through = snapshot?.date ?? run?.finishedAt?.slice(0, 10) ?? localDay();
  const velocity = run ? runVelocityEffort(catalog, run, through) : null;
  let historyKey: string | undefined;
  if (run) historyKey = `run:${run.id}`;
  else if (milestoneId) historyKey = `milestone:${milestoneId}`;
  const machineHistory = historyKey ? catalog.planningHistory?.[historyKey] ?? [] : [];
  const observedHistory = [...new Map([...(history ?? []), ...machineHistory].map(point => [point.date, point])).values()];

  return <div className="planning-stats">
    {snapshot && <p className="planning-snapshot-note">{t.saved(new Intl.DateTimeFormat(locale(lang), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(snapshot.capturedAt)))}</p>}
    <dl className="planning-stats-summary">
      <div><dt>{t.tasksDone}</dt><dd>{amount(summary.done)} / {amount(summary.tasks)} <span>{amount(summary.percent)}%</span></dd></div>
      <div><dt>{t.effortDone}</dt><dd>{amount(summary.doneEffort)} / {amount(summary.effort)}</dd></div>
      <div><dt>{t.effortRemaining}</dt><dd>{amount(summary.effort - summary.doneEffort)}</dd></div>
      <div><dt>{t.unestimated}</dt><dd>{amount(summary.unestimated)}</dd></div>
      {velocity !== null && <div><dt>{t.velocity}</dt><dd>{amount(velocity)}</dd><p className="planning-stat-note">{run?.configurationId ? t.velocityThrough(formatPlanningDate(through, lang)) : t.standaloneVelocityThrough(formatPlanningDate(through, lang))}</p></div>}
    </dl>
    <progress className="planning-stats-progress" max={Math.max(summary.tasks, 1)} value={summary.done} aria-label={t.completion} />
    {!summary.tasks && <p className="planning-stat-note">{t.empty}</p>}
    {(history !== undefined || historyKey) && <Burndown history={observedHistory} />}
    {summary.tasks > 0 && <>
      <section className="planning-stats-section"><h3>{t.states}</h3>
        {[...states].sort((first, second) => boardColumns.findIndex(column => column.id === first.key) - boardColumns.findIndex(column => column.id === second.key)).map(row =>
          <DistributionRow key={row.key} label={stateLabel(row.key, lang)} total={row.total}
            done={row.done} maximum={maximum} state={row.key} />)}
      </section>
      <section className="planning-stats-section"><h3>{t.priority}</h3>
        {[...priorities].sort((first, second) => ['high', 'medium', 'low', ''].indexOf(first.key) - ['high', 'medium', 'low', ''].indexOf(second.key)).map(row =>
          <DistributionRow key={row.key} label={row.key === 'high' || row.key === 'medium' || row.key === 'low' ? priorityLabel(row.key, lang) : t.noPriority}
            total={row.total} done={row.done} maximum={maximum} />)}
      </section>
      <section className="planning-stats-section"><h3>{t.owners}</h3>
        {[...owners].sort((first, second) => first.key.localeCompare(second.key, locale(lang))).map(row => <DistributionRow key={row.key} label={row.key || t.noOwner}
          total={row.total} done={row.done} maximum={maximum} />)}
      </section>
      <section className="planning-stats-section"><h3>{t.effortDecks}</h3>
        {decks.map(row => {
          const title = catalog.decks.find(deck => deck.id === row.key)?.title ?? t.noDeck;
          return <DistributionRow key={row.key} label={title} total={row.total} done={row.done}
            maximum={Math.max(comparisonEffort ?? 0, summary.effort)} note={t.remaining(amount(row.total - row.done), row.unestimated ? amount(row.unestimated) : '')} />;
        })}
      </section>
    </>}
  </div>;
}
