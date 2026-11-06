import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import type { CatalogMember } from '../../src/catalog-contracts.ts';
import type { ProjectPulse } from '../../src/pulse-contracts.ts';
import type { DataSource } from '../../src/workspace-contracts.ts';
import { failureMessage } from '../failure-message.ts';
import { defineText, locale, textNow, useLang, useText, type Lang } from '../i18n.ts';
import { formatPlanningDate } from '../planning-metrics.ts';
import { CardOwnerAvatar } from './CardOwnerAvatar.tsx';
import '../project-pulse.css';

const text = defineText({
  pulse: 'Project pulse',
  loading: 'Loading project pulse…',
  refreshing: 'Refreshing project pulse…',
  loadFailed: 'Could not load project pulse.',
  loadFailedStatus: (status: number) => `Could not load project pulse (${status}).`,
  invalidPulse: 'The server returned an invalid project pulse.',
  retry: 'Try again',
  inProgress: 'In progress',
  review: 'In review',
  accepted: 'Accepted · last 14 days',
  currentRun: 'Current Run',
  withoutDeck: 'Without a deck',
  taskNoun: (count: number): string => new Intl.PluralRules('en-US').select(count) === 'one' ? 'task' : 'tasks',
  cardNoun: (count: number): string => new Intl.PluralRules('en-US').select(count) === 'one' ? 'card' : 'cards',
  owners: 'Owners of started tasks',
  noOwners: 'No assigned owners',
  noStarted: 'Nothing started',
  noReview: 'Nothing waiting',
  oldestUnknown: 'Oldest age unknown',
  oldestLessThanDay: 'Oldest <1 day',
  oldestDays: (count: number) => `Oldest ${count.toLocaleString('en-US')} ${new Intl.PluralRules('en-US').select(count) === 'one' ? 'day' : 'days'}`,
  openReview: 'Open review',
  acceptedToday: (count: string) => `+${count} today`,
  acceptedChart: 'Accepted tasks per day, oldest first',
  today: 'Today',
  yesterday: 'Yesterday',
  daysAgo: (count: number) => `${count.toLocaleString('en-US')} days ago`,
  acceptedDay: (day: string, count: number) => `${day}: ${count.toLocaleString('en-US')} accepted ${new Intl.PluralRules('en-US').select(count) === 'one' ? 'task' : 'tasks'}`,
  runProgress: (title: string, done: string, total: string, percent: string) => `${title}: ${done} of ${total} tasks accepted, ${percent}%`,
  ends: (date: string) => `Ends ${date}`,
  noRun: 'No current Run',
  sortIntoDecks: 'Sort into decks',
}, {
  pulse: 'Пульс проекта',
  loading: 'Загружаем пульс проекта…',
  refreshing: 'Обновляем пульс проекта…',
  loadFailed: 'Не удалось загрузить пульс проекта.',
  loadFailedStatus: (status: number) => `Не удалось загрузить пульс проекта (${status}).`,
  invalidPulse: 'Сервер вернул некорректный пульс проекта.',
  retry: 'Повторить',
  inProgress: 'В работе',
  review: 'На ревью',
  accepted: 'Принято · 14 дней',
  currentRun: 'Текущий Run',
  withoutDeck: 'Без колоды',
  taskNoun: (count: number) => {
    const rule = new Intl.PluralRules('ru-RU').select(count);
    if (rule === 'one') return 'задача';
    return rule === 'few' ? 'задачи' : 'задач';
  },
  cardNoun: (count: number) => {
    const rule = new Intl.PluralRules('ru-RU').select(count);
    if (rule === 'one') return 'карточка';
    return rule === 'few' ? 'карточки' : 'карточек';
  },
  owners: 'Исполнители задач в работе',
  noOwners: 'Без исполнителей',
  noStarted: 'Нет задач в работе',
  noReview: 'Ничего не ждёт',
  oldestUnknown: 'Возраст неизвестен',
  oldestLessThanDay: 'Ждёт <1 дня',
  oldestDays: (count: number) => {
    const rule = new Intl.PluralRules('ru-RU').select(count);
    let unit = 'дней';
    if (rule === 'one') unit = 'день';
    else if (rule === 'few') unit = 'дня';
    return `Ждёт ${count.toLocaleString('ru-RU')} ${unit}`;
  },
  openReview: 'Открыть ревью',
  acceptedToday: (count: string) => `+${count} сегодня`,
  acceptedChart: 'Принятые задачи по дням, от старых к новым',
  today: 'Сегодня',
  yesterday: 'Вчера',
  daysAgo: (count: number) => `${count.toLocaleString('ru-RU')} дн. назад`,
  acceptedDay: (day: string, count: number) => `${day}: принято задач — ${count.toLocaleString('ru-RU')}`,
  runProgress: (title: string, done: string, total: string, percent: string) => `${title}: принято ${done} из ${total} задач, ${percent}%`,
  ends: (date: string) => `До ${date}`,
  noRun: 'Нет текущего Run',
  sortIntoDecks: 'Разложить по колодам',
});

export interface ProjectPulseStripProps {
  source: DataSource;
  refreshKey: string | number;
  members: CatalogMember[];
  disabled: boolean;
  onInProgress: () => void;
  onReview: (deckId: string | null) => void;
  onWithoutDeck: () => void;
  onRun: (id: string) => void;
}

interface PulseState {
  source: DataSource;
  key: string;
  status: 'loading' | 'ready' | 'error';
  pulse: ProjectPulse | null;
  error: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isMoment(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isDay(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`));
}

function isProjectPulse(value: unknown): value is ProjectPulse {
  if (!isRecord(value)) return false;
  const progress = value.inProgress;
  const review = value.review;
  const accepted = value.accepted;
  const run = value.run;
  if (!isRecord(progress) || !isRecord(review) || !isRecord(accepted)) return false;
  const validRun = run === null || (isRecord(run)
    && typeof run.id === 'string' && typeof run.title === 'string' && isDay(run.end)
    && isCount(run.done) && isCount(run.total) && run.done <= run.total);
  return isCount(progress.count) && Array.isArray(progress.ownerIds) && progress.ownerIds.length <= 6 && progress.ownerIds.every(id => typeof id === 'string')
    && isCount(review.count) && (review.oldestSince === null || isMoment(review.oldestSince))
    && (review.deckId === null || typeof review.deckId === 'string')
    && Array.isArray(accepted.days) && accepted.days.length === 14 && accepted.days.every(isCount) && isCount(accepted.total)
    && validRun && isCount(value.withoutDeck);
}

async function readProjectPulse(response: Response): Promise<ProjectPulse> {
  const t = textNow(text);
  const result: unknown = await response.json();
  if (!response.ok) {
    let message = t.loadFailedStatus(response.status);
    if (isRecord(result) && typeof result.message === 'string') message = result.message;
    else if (isRecord(result) && typeof result.error === 'string') message = result.error;
    throw new Error(message);
  }
  if (!isProjectPulse(result)) throw new Error(t.invalidPulse);
  return result;
}

function loadingState(source: DataSource, key: string): PulseState {
  return { source, key, status: 'loading', pulse: null, error: null };
}

function relativeDay(offset: number, lang: Lang): string {
  const t = text[lang];
  if (offset === 0) return t.today;
  if (offset === 1) return t.yesterday;
  return t.daysAgo(offset);
}

export function ProjectPulseStrip({ source, refreshKey, members, disabled, onInProgress, onReview, onWithoutDeck, onRun }: ProjectPulseStripProps) {
  const t = useText(text);
  const lang = useLang();
  const key = JSON.stringify([source, refreshKey, lang]);
  const [state, setState] = useState<PulseState>(() => loadingState(source, key));
  const requestNumber = useRef(0);
  const requestController = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    const request = ++requestNumber.current;
    setState(previous => previous.source === source
      ? { ...previous, key, status: 'loading', error: null }
      : loadingState(source, key));
    try {
      const parameters = new URLSearchParams({ source });
      const response = await fetch(`/api/project-pulse?${parameters}`, { signal: controller.signal, cache: 'no-store' });
      const pulse = await readProjectPulse(response);
      if (controller.signal.aborted || request !== requestNumber.current) return;
      setState({ source, key, status: 'ready', pulse, error: null });
    } catch (failure) {
      if (controller.signal.aborted || request !== requestNumber.current) return;
      const fallback = textNow(text).loadFailed;
      const message = failure instanceof SyntaxError ? textNow(text).invalidPulse : failureMessage(failure, fallback);
      setState({ source, key, status: 'error', pulse: null, error: message });
    }
  }, [key, source]);

  useEffect(() => {
    void load();
    return () => {
      requestNumber.current += 1;
      requestController.current?.abort();
    };
  }, [load]);

  const current = state.source === source && (state.key === key || state.pulse !== null) ? state : loadingState(source, key);
  if (current.status === 'error') {
    return <section className="project-pulse project-pulse-error" aria-label={t.pulse}>
      <div><strong>{t.pulse}</strong><p role="alert">{current.error}</p></div>
      <button type="button" className="project-pulse-retry" disabled={disabled} onClick={() => void load()}>{t.retry}</button>
    </section>;
  }

  const pulse = current.pulse;
  if (!pulse) {
    return <section className="project-pulse project-pulse-grid project-pulse-loading" aria-label={t.pulse} aria-busy="true">
      {Array.from({ length: 5 }, (_, index) => <div className="project-pulse-segment" key={index}>
        {index === 0 && <span className="visually-hidden" role="status">{t.loading}</span>}
        <span className="project-pulse-skeleton is-label" aria-hidden="true" /><span className="project-pulse-skeleton is-value" aria-hidden="true" /><span className="project-pulse-skeleton is-detail" aria-hidden="true" />
      </div>)}
    </section>;
  }

  const numberFormat = new Intl.NumberFormat(locale(lang));
  const amount = (value: number) => numberFormat.format(value);
  const loading = current.status === 'loading';
  const owners = pulse.inProgress.ownerIds.map(id => ({ id, label: members.find(member => member.id === id)?.label ?? id }));
  let reviewAge = t.noReview;
  if (pulse.review.count > 0 && !pulse.review.oldestSince) reviewAge = t.oldestUnknown;
  if (pulse.review.count > 0 && pulse.review.oldestSince) {
    const days = Math.floor(Math.max(0, Date.now() - Date.parse(pulse.review.oldestSince)) / 86_400_000);
    reviewAge = days === 0 ? t.oldestLessThanDay : t.oldestDays(days);
  }
  const oldestTitle = pulse.review.oldestSince
    ? new Intl.DateTimeFormat(locale(lang), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(pulse.review.oldestSince))
    : undefined;
  const acceptedDays = pulse.accepted.days;
  const acceptedMaximum = Math.max(1, ...acceptedDays);
  const todayAccepted = acceptedDays.at(-1) ?? 0;
  const run = pulse.run;
  const runPercent = run && run.total > 0 ? Math.round(run.done / run.total * 100) : 0;

  const ownerNames = owners.map(owner => owner.label).join(', ');
  const progressLabel = `${t.inProgress}: ${amount(pulse.inProgress.count)} ${t.taskNoun(pulse.inProgress.count)}`;

  return <section className="project-pulse project-pulse-grid" aria-label={t.pulse} aria-busy={loading}>
    <button type="button" className="project-pulse-segment" disabled={disabled} onClick={onInProgress}
      aria-label={ownerNames ? `${progressLabel}; ${t.owners}: ${ownerNames}` : progressLabel}>
      <span className="project-pulse-label">{t.inProgress}</span>
      <span className="project-pulse-value">{amount(pulse.inProgress.count)}<small>{t.taskNoun(pulse.inProgress.count)}</small></span>
      {owners.length > 0 ? <span className="project-pulse-owners" aria-hidden="true">
        {owners.map(owner => <span className="project-pulse-owner" key={owner.id} title={owner.label}><CardOwnerAvatar owner={owner.id} members={members} /></span>)}
      </span> : <span className="project-pulse-detail">{pulse.inProgress.count > 0 ? t.noOwners : t.noStarted}</span>}
    </button>

    <button type="button" className="project-pulse-segment" disabled={disabled} onClick={() => onReview(pulse.review.deckId)} title={oldestTitle}
      aria-label={`${t.review}: ${amount(pulse.review.count)} ${t.taskNoun(pulse.review.count)}; ${reviewAge}`}>
      <span className="project-pulse-label">{t.review}</span>
      <span className="project-pulse-value">{amount(pulse.review.count)}<small>{reviewAge}</small></span>
      <span className="project-pulse-detail">{t.openReview}<ArrowRight size={13} aria-hidden="true" /></span>
    </button>

    <div className="project-pulse-segment project-pulse-accepted">
      {loading && <span className="visually-hidden" role="status">{t.refreshing}</span>}
      <span className="project-pulse-label">{t.accepted}</span>
      <span className="project-pulse-value">{amount(pulse.accepted.total)}<small>{t.acceptedToday(amount(todayAccepted))}</small></span>
      <ol className="project-pulse-days" aria-label={t.acceptedChart}>
        {acceptedDays.map((count, index) => {
          const label = t.acceptedDay(relativeDay(acceptedDays.length - 1 - index, lang), count);
          const height = count > 0 ? Math.max(10, count / acceptedMaximum * 100) : 6;
          return <li key={index} title={label}>
            <span className="visually-hidden">{label}</span>
            <span className={'project-pulse-day-bar' + (index === acceptedDays.length - 1 ? ' is-today' : '')} style={{ height: `${height}%` }} aria-hidden="true" />
          </li>;
        })}
      </ol>
    </div>

    {run ? <button type="button" className="project-pulse-segment project-pulse-run" disabled={disabled} onClick={() => onRun(run.id)}
      aria-label={t.runProgress(run.title, amount(run.done), amount(run.total), amount(runPercent))}>
      <span className="project-pulse-label" title={run.title}>{t.currentRun} · {run.title}</span>
      <span className="project-pulse-value">{amount(runPercent)}%<small>{amount(run.done)} / {amount(run.total)}</small></span>
      <span className="project-pulse-run-bottom">
        <progress max={Math.max(run.total, 1)} value={run.done} aria-hidden="true" />
        <small>{t.ends(formatPlanningDate(run.end, lang))}</small>
      </span>
    </button> : <div className="project-pulse-segment project-pulse-run">
      <span className="project-pulse-label">{t.currentRun}</span>
      <span className="project-pulse-value">—<small>{t.noRun}</small></span>
      <span className="project-pulse-detail" />
    </div>}

    <button type="button" className={'project-pulse-segment project-pulse-without-deck' + (pulse.withoutDeck > 0 ? ' is-warning' : '')}
      disabled={disabled} onClick={onWithoutDeck}>
      <span className="project-pulse-label">{t.withoutDeck}</span>
      <span className="project-pulse-value">{amount(pulse.withoutDeck)}<small>{t.cardNoun(pulse.withoutDeck)}</small></span>
      <span className="project-pulse-detail">{t.sortIntoDecks}<ArrowRight size={13} aria-hidden="true" /></span>
    </button>
  </section>;
}
