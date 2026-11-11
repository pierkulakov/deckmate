import { useEffect, useState } from 'react';
import { failureMessage } from '../failure-message.ts';
import { RotateCcw } from 'lucide-react';
import type { CatalogJourneyStep, JourneyMetrics, JourneyStepMetrics } from '../../src/catalog-contracts.ts';
import type { DataSource } from '../../src/workspace-contracts.ts';
import { journeyStepLabel } from './JourneyMiniCard.tsx';
import { currentLang, defineText, formatNumber, locale, useLang, type Lang } from '../i18n.ts';
import { stateLabel } from '../locales/common.ts';
import { Button } from './ui/button.tsx';
import '../journey-metrics.css';

const text = defineText({
  lessThanHour: '<1 h',
  hours: (value: string) => `${value} h`,
  days: (value: string) => `${value} d`,
  stepCards: (instances: string, accepted: string, done: string) => `Step cards: ${instances} · ${done.toLocaleLowerCase(locale('en'))}: ${accepted}`,
  returns: (count: string) => `Returns from Review: ${count}`,
  cycle: (median: string, average: string, samples: string, started: string, done: string) => `“${started}” → “${done}” cycle: median ${median}, average ${average} (cards: ${samples})`,
  owners: (owners: string) => `Owners: ${owners}`,
  ownersColumn: 'Owners',
  statusActors: (actors: string) => `Changed status: ${actors}`,
  statusActorsColumn: 'Changed status',
  lastReturnReasons: 'Latest return reasons:',
  metricsFailed: 'Journey metrics failed to load.',
  loading: 'Updating metrics…',
  stale: 'The displayed metrics may be out of date.',
  retry: 'Try again',
  empty: 'No step metrics yet.',
  cycleMedian: (cycle: string) => `cycle median: ${cycle}`,
  metrics: 'Journey step metrics',
  step: 'Step',
  cards: 'Cards',
  returnsColumn: 'Returns',
  cycleColumns: 'Cycle: median · average',
  lastReturnsColumn: 'Latest return reasons',
  removedStep: (id: string) => `${id} (step removed)`,
  note: 'Counts use the journal since 2026-11-04: earlier entries have no status transitions and are not included.',
}, {
  lessThanHour: '<1 ч',
  hours: (value: string) => `${value} ч`,
  days: (value: string) => `${value} д`,
  stepCards: (instances: string, accepted: string, done: string) => `Карточек шага: ${instances} · ${done.toLocaleLowerCase(locale('ru'))}: ${accepted}`,
  returns: (count: string) => `Возвратов с приёмки: ${count}`,
  cycle: (median: string, average: string, samples: string, started: string, done: string) => `Цикл «${started.toLocaleLowerCase(locale('ru'))}» → «${done.toLocaleLowerCase(locale('ru'))}»: медиана ${median}, среднее ${average} (карточек: ${samples})`,
  owners: (owners: string) => `Исполнители: ${owners}`,
  ownersColumn: 'Исполнители',
  statusActors: (actors: string) => `Меняли статус: ${actors}`,
  statusActorsColumn: 'Меняли статус',
  lastReturnReasons: 'Последние причины возврата:',
  metricsFailed: 'Метрики Journey не загрузились.',
  loading: 'Обновляем метрики…',
  stale: 'Показанные метрики могут быть неактуальны.',
  retry: 'Повторить',
  empty: 'Метрик шагов пока нет.',
  cycleMedian: (cycle: string) => `медиана цикла: ${cycle}`,
  metrics: 'Метрики шагов Journey',
  step: 'Шаг',
  cards: 'Карточек',
  returnsColumn: 'Возвраты',
  cycleColumns: 'Цикл: медиана · среднее',
  lastReturnsColumn: 'Последние причины возврата',
  removedStep: (id: string) => `${id} (шаг убран)`,
  note: 'Счёт — по журналу с 2026-11-04: более ранние записи не хранят переходов статуса и не учтены.',
});

// Step metrics reveal bottlenecks. Show a badge only when return or cycle data exists;
// the full table opens from the editor's Metrics button.

export function formatJourneyDuration(hours: number, lang: Lang = currentLang()): string {
  const t = text[lang];
  if (hours < 1) return t.lessThanHour;
  if (hours < 24) return t.hours(formatNumber(Math.round(hours), 1, lang));
  const days = hours / 24;
  return t.days(days < 10 ? formatNumber(days, 1, lang) : formatNumber(Math.round(days), 1, lang));
}

function localDate(at: string, lang: Lang): string {
  return new Intl.DateTimeFormat(locale(lang)).format(new Date(at));
}

function stepSummary(metrics: JourneyStepMetrics, lang: Lang): string[] {
  const t = text[lang];
  const done = stateLabel('done', lang);
  const lines = [t.stepCards(formatNumber(metrics.instances, 1, lang), formatNumber(metrics.accepted, 1, lang), done), t.returns(formatNumber(metrics.returns, 1, lang))];
  if (metrics.cycleHours) lines.push(t.cycle(formatJourneyDuration(metrics.cycleHours.median, lang), formatJourneyDuration(metrics.cycleHours.average, lang), formatNumber(metrics.cycleHours.samples, 1, lang), stateLabel('started', lang), done));
  if (metrics.owners.length) lines.push(t.owners(metrics.owners.join(', ')));
  if (metrics.actors.length) lines.push(t.statusActors(metrics.actors.join(', ')));
  if (metrics.lastReturns.length) lines.push(t.lastReturnReasons, ...metrics.lastReturns.map(item => `${localDate(item.at, lang)} — ${item.reason}`));
  return lines;
}

/** Refresh metrics when the Journey or its card membership and states (revision) change. */
export function useJourneyMetrics(source: DataSource, journeyId: string | null, revision: string): { metrics: JourneyMetrics | null; error: string; loading: boolean; retry: () => void } {
  const lang = useLang();
  const key = journeyId ? `${source}:${journeyId}` : '';
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ key: string; metrics: JourneyMetrics | null; error: string; loading: boolean }>({ key: '', metrics: null, error: '', loading: false });
  useEffect(() => {
    if (!journeyId) { setState({ key: '', metrics: null, error: '', loading: false }); return; }
    const controller = new AbortController();
    setState(previous => ({ key, metrics: previous.key === key ? previous.metrics : null, error: '', loading: true }));
    void (async () => {
      try {
        const response = await fetch(`/api/journey-metrics?source=${source}&journeyId=${journeyId}`, { cache: 'no-store', signal: controller.signal });
        const result = await response.json() as JourneyMetrics & { message?: string };
        if (!response.ok) throw new Error(result.message ?? text[lang].metricsFailed);
        if (result.journeyId !== journeyId) throw new Error(text[lang].metricsFailed);
        if (!controller.signal.aborted) setState({ key, metrics: result, error: '', loading: false });
      } catch (failure) {
        if (!controller.signal.aborted) setState(previous => ({ key, metrics: previous.key === key ? previous.metrics : null, error: failureMessage(failure, text[lang].metricsFailed), loading: false }));
      }
    })();
    return () => controller.abort();
  }, [source, journeyId, revision, lang, attempt, key]);
  const visible = state.key === key ? state : { metrics: null, error: '', loading: Boolean(journeyId) };
  return { metrics: visible.metrics, error: visible.error, loading: visible.loading, retry: () => setAttempt(value => value + 1) };
}

/** The step badge shows review returns and median cycle time, such as "↺2 · 3 d"; omit it when neither exists. */
export function JourneyStepMetricsBadge({ metrics }: { metrics: JourneyStepMetrics | undefined }) {
  const lang = useLang();
  if (!metrics || (!metrics.returns && !metrics.cycleHours)) return null;
  const cycle = metrics.cycleHours ? formatJourneyDuration(metrics.cycleHours.median, lang) : null;
  const spoken = [metrics.returns ? text[lang].returns(formatNumber(metrics.returns, 1, lang)) : null, cycle ? text[lang].cycleMedian(cycle) : null].filter(Boolean).join(', ');
  return <span className="journey-mini-metrics" title={stepSummary(metrics, lang).join('\n')}>
    <span aria-hidden="true">{metrics.returns > 0 && <RotateCcw size={11} />}{[metrics.returns ? formatNumber(metrics.returns, 1, lang) : null, cycle].filter(Boolean).join(' · ')}</span>
    <span className="visually-hidden">{spoken}</span>
  </span>;
}

export function JourneyMetricsTable({ metrics, error, loading, onRetry, steps }: { metrics: JourneyMetrics | null; error: string; loading: boolean; onRetry: () => void; steps: CatalogJourneyStep[] }) {
  const lang = useLang();
  const t = text[lang];
  return <section className="journey-metrics glass-panel" aria-label={t.metrics}>
    <header className="panel-head"><h3 className="panel-title">{t.metrics}</h3></header>
    {loading && <p className="journey-metrics-note" role="status">{t.loading}</p>}
    {error && <p className="journey-metrics-error" role="alert">{error}</p>}
    {error && <Button type="button" variant="outline" size="sm" onClick={onRetry}>{t.retry}</Button>}
    {metrics && (loading || error) && <p className="journey-metrics-note">{t.stale}</p>}
    {!loading && !error && metrics?.steps.length === 0 && <p className="journey-metrics-note">{t.empty}</p>}
    {metrics && metrics.steps.length > 0 && <div className="journey-metrics-scroll" tabIndex={0}><table>
      <thead><tr><th scope="col">{t.step}</th><th scope="col">{t.cards}</th><th scope="col">{stateLabel('done', lang)}</th><th scope="col">{t.returnsColumn}</th><th scope="col">{t.cycleColumns}</th><th scope="col">{t.ownersColumn}</th><th scope="col">{t.statusActorsColumn}</th><th scope="col">{t.lastReturnsColumn}</th></tr></thead>
      <tbody>{metrics.steps.map(step => {
        const definition = steps.find(candidate => candidate.id === step.stepId);
        return <tr key={step.stepId}>
          <th scope="row">{definition ? journeyStepLabel(definition.title) : t.removedStep(step.stepId)}</th>
          <td>{formatNumber(step.instances, 1, lang)}</td>
          <td>{formatNumber(step.accepted, 1, lang)}</td>
          <td>{formatNumber(step.returns, 1, lang)}</td>
          <td>{step.cycleHours ? `${formatJourneyDuration(step.cycleHours.median, lang)} · ${formatJourneyDuration(step.cycleHours.average, lang)}` : '—'}</td>
          <td>{step.owners.join(', ') || '—'}</td>
          <td>{step.actors.join(', ') || '—'}</td>
          <td>{step.lastReturns.length ? <ul>{step.lastReturns.map(item => <li key={item.at + item.cardId}><time dateTime={item.at}>{localDate(item.at, lang)}</time> {item.reason}</li>)}</ul> : '—'}</td>
        </tr>;
      })}</tbody>
    </table></div>}
    {metrics?.warnings.map(warning => <p key={warning} className="journey-metrics-error" role="status">{warning}</p>)}
    <p className="journey-metrics-note">{t.note}</p>
  </section>;
}
