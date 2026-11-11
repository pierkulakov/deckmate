import type { CatalogCard, PlanningDistribution, PlanningHistoryPoint, PlanningStatistics, RunCarryOver, RunConfiguration, RunRecord } from '../src/catalog-contracts.ts';
import { openDependencies } from '../src/dependency-contracts.ts';
import { validPlanningCover } from '../src/planning-cover.ts';
import { isoWeek } from '../src/iso-week.ts';
import { boundedText, validDate } from './card-options.ts';
import { defineText, serverText } from './i18n.ts';

const text = defineText({
  invalid: (field: string) => `Invalid planning field: ${field}.`,
  limit: 'The Run registry is full (1000 Runs). Archive old project history before extending the schedule.',
}, {
  invalid: (field: string) => `Некорректное поле планирования: ${field}.`,
  limit: 'Реестр Run заполнен (1000 периодов). Сохраните старую историю проекта отдельно перед расширением расписания.',
});

function planningRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
export function invalidPlanning(field: string): never { throw new Error(serverText(text).invalid(field)); }
export function planningId(value: unknown): value is string { return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/u.test(value); }
export function addRunDays(date: string, count: number): string {
  const result = new Date(Date.parse(date + 'T00:00:00Z') + count * 86_400_000).toISOString().slice(0, 10);
  if (!validDate(result)) invalidPlanning('date');
  return result;
}
export function zonedRunClock(now: Date, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (key: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === key)!.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}
export function isRunExpired(run: RunRecord, configuration: RunConfiguration | undefined, now = new Date()): boolean {
  if (run.finishedAt) return true;
  const clock = zonedRunClock(now, configuration?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const finishTime = configuration?.finishTime ?? '24:00';
  const finishDay = finishTime === '24:00' ? addRunDays(run.end, 1) : run.end;
  const time = finishTime === '24:00' ? '00:00' : finishTime;
  return clock.date > finishDay || clock.date === finishDay && clock.time >= time;
}

export function validateCarryOver(value: unknown): RunCarryOver {
  if (!planningRecord(value) || Object.keys(value).length !== 3 || ['review', 'blocked', 'other'].some(key => typeof value[key] !== 'boolean')) invalidPlanning('carryOver');
  return value as unknown as RunCarryOver;
}

export function validateRunConfiguration(value: unknown): RunConfiguration {
  const allowed = ['id', 'shortName', 'color', 'projectSpecific', 'labelTemplate', 'startDate', 'durationWeeks', 'upcomingCount', 'finishTime', 'timeZone', 'carryOver', 'stopDate'];
  if (!planningRecord(value) || Object.keys(value).some(key => !allowed.includes(key))) invalidPlanning('configuration');
  if (!planningId(value.id)) invalidPlanning('configuration.id');
  if (!boundedText(value.shortName, 5)) invalidPlanning('shortName');
  if (typeof value.color !== 'string' || !/^#[0-9a-f]{6}$/iu.test(value.color)) invalidPlanning('color');
  if (value.projectSpecific !== undefined && typeof value.projectSpecific !== 'boolean') invalidPlanning('projectSpecific');
  if (!boundedText(value.labelTemplate, 160)) invalidPlanning('labelTemplate');
  if (!validDate(value.startDate) || value.stopDate !== undefined && !validDate(value.stopDate)) invalidPlanning('startDate/stopDate');
  if (!Number.isInteger(value.durationWeeks) || Number(value.durationWeeks) < 1 || Number(value.durationWeeks) > 52) invalidPlanning('durationWeeks');
  if (!Number.isInteger(value.upcomingCount) || Number(value.upcomingCount) < 1 || Number(value.upcomingCount) > 52) invalidPlanning('upcomingCount');
  if (typeof value.finishTime !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/u.test(value.finishTime)) invalidPlanning('finishTime');
  if (!boundedText(value.timeZone, 100)) invalidPlanning('timeZone');
  try { new Intl.DateTimeFormat('en', { timeZone: value.timeZone }).format(); } catch { invalidPlanning('timeZone'); }
  validateCarryOver(value.carryOver);
  return value as unknown as RunConfiguration;
}

export function validatePlanningDetails(value: Record<string, unknown>): void {
  if (value.description !== undefined && (typeof value.description !== 'string' || value.description.length > 10_000 || /[\u0000\u000b\u000c]/u.test(value.description))) invalidPlanning('description');
  if (value.cover !== undefined) {
    if (typeof value.cover !== 'string' || !validPlanningCover(value.cover)) invalidPlanning('cover');
  }
  if (value.history !== undefined) {
    if (!Array.isArray(value.history) || value.history.length > 4000) invalidPlanning('history');
    for (const point of value.history) validateHistoryPoint(point);
  }
}
function nonnegative(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0; }
function validateHistoryPoint(value: unknown): asserts value is PlanningHistoryPoint {
  if (!planningRecord(value) || !validDate(value.date) || ['tasks', 'done', 'effort', 'doneEffort'].some(key => !nonnegative(value[key]))) invalidPlanning('history');
  if (Number(value.done) > Number(value.tasks) || Number(value.doneEffort) > Number(value.effort)) invalidPlanning('history');
}
export function validatePlanningStatistics(value: unknown): asserts value is PlanningStatistics {
  validateHistoryPoint(value);
  const statistics = value as unknown as Record<string, unknown>;
  if (typeof statistics.capturedAt !== 'string' || !Number.isFinite(Date.parse(statistics.capturedAt)) || !nonnegative(statistics.unestimated)) invalidPlanning('statistics');
  for (const key of ['states', 'priorities', 'owners', 'decks']) {
    const distribution = statistics[key];
    if (!Array.isArray(distribution) || distribution.length > 100_000 || distribution.some(item => !planningRecord(item) || typeof item.key !== 'string' || item.key.length > 1000 || !nonnegative(item.total) || !nonnegative(item.done) || item.done > item.total || item.unestimated !== undefined && !nonnegative(item.unestimated))) invalidPlanning('statistics.' + key);
  }
  if (!Array.isArray(statistics.completedEffort) || statistics.completedEffort.length > 100_000 || statistics.completedEffort.some(item => !planningRecord(item) || !validDate(item.date) || !nonnegative(item.effort) || item.cardId !== undefined && typeof item.cardId !== 'string')) invalidPlanning('statistics.completedEffort');
}

export function runGoal(configuration: RunConfiguration, number: number, start: string): string {
  return configuration.labelTemplate.replaceAll('%RUN_NR%', String(number)).replaceAll('%CALENDAR_WEEK%', String(isoWeek(start)));
}

/** 2026-11-05: skip elapsed slots arithmetically; an offline/paused interval is not fabricated history. */
export function replenishRuns(runs: RunRecord[], configurations: RunConfiguration[], now = new Date()): RunRecord[] {
  const result = [...runs];
  for (const configuration of configurations) {
    if (configuration.stopDate) continue;
    const own = result.filter(run => run.configurationId === configuration.id).sort((left, right) => left.start.localeCompare(right.start));
    let upcoming = own.filter(run => !isRunExpired(run, configuration, now)).length;
    let start = own.length ? addRunDays(own.at(-1)!.end, 1) : configuration.startDate;
    let number = Math.max(0, ...own.map(run => run.number)) + 1;
    const duration = configuration.durationWeeks * 7;
    const clock = zonedRunClock(now, configuration.timeZone);
    if (start < clock.date) {
      const elapsedDays = Math.floor((Date.parse(clock.date + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z')) / 86_400_000);
      const skipped = Math.floor(elapsedDays / duration);
      start = addRunDays(start, skipped * duration);
      number += skipped;
    }
    while (upcoming < configuration.upcomingCount) {
      if (result.length >= 1000) throw new Error(serverText(text).limit);
      const run: RunRecord = { id: `${configuration.id.slice(0, 65)}-${number}`, configurationId: configuration.id, number,
        start, end: addRunDays(start, duration - 1), goal: runGoal(configuration, number, start) };
      if (result.some(existing => existing.id === run.id)) invalidPlanning('generated Run ID');
      if (!isRunExpired(run, configuration, now)) { result.push(run); upcoming += 1; }
      start = addRunDays(run.end, 1);
      number += 1;
    }
  }
  return result;
}

export function capturePlanningStatistics(cards: CatalogCard[], now = new Date(), timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone): PlanningStatistics {
  const tasks = cards.filter(card => card.kind === 'task' && !card.archived && !card.deleted);
  const done = tasks.filter(card => card.state === 'done');
  const effort = (card: CatalogCard) => card.effort ?? 0;
  function distribute(keyOf: (card: CatalogCard) => string, effortUnits = false): PlanningDistribution[] {
    const groups = new Map<string, PlanningDistribution>();
    for (const card of tasks) {
      const key = keyOf(card);
      const group = groups.get(key) ?? { key, total: 0, done: 0 };
      const units = effortUnits ? effort(card) : 1;
      group.total += units;
      if (card.state === 'done') group.done += units;
      if (effortUnits && card.effort == null) group.unestimated = (group.unestimated ?? 0) + 1;
      groups.set(key, group);
    }
    return [...groups.values()];
  }
  return { date: zonedRunClock(now, timeZone).date, capturedAt: now.toISOString(),
    tasks: tasks.length, done: done.length, effort: tasks.reduce((sum, card) => sum + effort(card), 0),
    doneEffort: done.reduce((sum, card) => sum + effort(card), 0), unestimated: tasks.filter(card => card.effort == null).length,
    states: distribute(card => card.state ?? 'not-started'), priorities: distribute(card => card.priority ?? ''), owners: distribute(card => card.owner ?? ''), decks: distribute(card => card.deckId ?? '', true),
    completedEffort: done.filter(card => card.doneAt).map(card => ({ cardId: card.id, date: card.doneAt!, effort: effort(card) })) };
}
export const legacyRunCarryStates = new Set(['discussing', 'started', 'review']);
export function shouldCarryCard(card: CatalogCard, choices: RunCarryOver, cardsById: ReadonlyMap<string, CatalogCard>): boolean {
  if (card.state === 'wont-do') return false;
  if (card.kind !== 'task' || card.state === 'done' || card.archived || card.deleted) return false;
  if (card.state === 'review') return choices.review;
  const blocked = openDependencies(card.dependsOn, cardsById).length > 0;
  return blocked ? choices.blocked : choices.other;
}
