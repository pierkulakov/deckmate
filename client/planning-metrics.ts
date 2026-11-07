import type { CatalogCard, ProjectCatalog, RunRecord } from '../src/catalog-contracts.ts';
import { locale, type Lang } from './i18n.ts';

const millisecondsPerDay = 86_400_000;

function dayTimestamp(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`);
}

/** Calendar dates have no timezone offset; UTC arithmetic avoids a 23/25-hour day at DST (2026-11-04). */
export function dayDistance(from: string, to: string): number {
  return Math.round((dayTimestamp(to) - dayTimestamp(from)) / millisecondsPerDay);
}

export function addDays(iso: string, days: number): string {
  return new Date(dayTimestamp(iso) + days * millisecondsPerDay).toISOString().slice(0, 10);
}

/** Count weekdays after the current date through the due date, inclusive (2026-11-05). */
export function workdaysUntil(from: string, to: string): number {
  if (from > to) return -workdaysUntil(to, from);
  const distance = dayDistance(from, to);
  const wholeWeeks = Math.floor(distance / 7);
  let count = wholeWeeks * 5;
  const startWeekday = (new Date(dayTimestamp(from)).getUTCDay() + 1) % 7;
  for (let offset = wholeWeeks * 7; offset < distance; offset += 1) {
    const weekday = (startWeekday + offset) % 7;
    if (weekday !== 0 && weekday !== 6) count += 1;
  }
  return count;
}

export function formatPlanningDate(iso: string, lang?: Lang): string {
  return new Intl.DateTimeFormat(locale(lang), { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(dayTimestamp(iso)));
}

export function metrics(cards: readonly CatalogCard[]) {
  const taskCards = cards.filter(card => card.kind === 'task' && !card.archived && !card.deleted);
  const estimated = taskCards.filter(card => typeof card.effort === 'number' && Number.isFinite(card.effort));
  const done = taskCards.filter(card => card.state === 'done').length;
  return {
    tasks: taskCards.length,
    done,
    effort: estimated.reduce((sum, card) => sum + card.effort!, 0),
    doneEffort: estimated.filter(card => card.state === 'done').reduce((sum, card) => sum + card.effort!, 0),
    unestimated: taskCards.length - estimated.length,
    percent: taskCards.length ? Math.round(done / taskCards.length * 100) : 0,
  };
}

/** Seven calendar days of recorded completion; snapshots replace live values for finished Runs (2026-11-05). */
export function runVelocityEffort(catalog: Pick<ProjectCatalog, 'runs' | 'cards'>, run: RunRecord, through: string): number {
  const from = addDays(through, -6);
  const family = (catalog.runs ?? []).filter(candidate => run.configurationId
    ? candidate.configurationId === run.configurationId : candidate.id === run.id);
  const recorded = new Map<string, { date: string; effort: number }>();
  const observed = (id: string, date: string, effort: number) => {
    if (date > through) return;
    const previous = recorded.get(id);
    if (!previous || previous.date <= date) recorded.set(id, { date, effort });
  };
  const snapshots = new Set(family.filter(candidate => candidate.finishedAt && candidate.statistics).map(candidate => candidate.id));
  const familyIds = new Set(family.map(candidate => candidate.id));
  for (const candidate of family) {
    if (!snapshots.has(candidate.id)) continue;
    candidate.statistics?.completedEffort.forEach((entry, index) => {
      observed(entry.cardId ?? `${candidate.id}:${index}`, entry.date.slice(0, 10), entry.effort);
    });
  }
  for (const card of catalog.cards) {
    if (card.kind !== 'task' || card.deleted || card.state !== 'done' || !card.run || !familyIds.has(card.run)
      || snapshots.has(card.run) || !card.doneAt) continue;
    observed(card.id, card.doneAt.slice(0, 10), card.effort ?? 0);
  }
  return [...recorded.values()].filter(entry => entry.date >= from && entry.date <= through)
    .reduce((sum, entry) => sum + entry.effort, 0);
}

/** First day of the month that contains `iso`, shifted by `offset` months. */
export function monthStart(iso: string, offset = 0): string {
  const date = new Date(dayTimestamp(iso));
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1)).toISOString().slice(0, 10);
}

/** ISO 8601 week number: weeks start on Monday, week 1 holds the year's first Thursday. */
export function isoWeek(iso: string): number {
  const date = new Date(dayTimestamp(iso));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  return Math.ceil(((date.getTime() - Date.UTC(date.getUTCFullYear(), 0, 1)) / millisecondsPerDay + 1) / 7);
}
