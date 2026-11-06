import { createHash } from 'node:crypto';

import type { CatalogCard, RunCarryOver, RunConfiguration, RunRecord } from '../src/catalog-contracts.ts';
import type { PlanningEdit } from '../src/planning-files.ts';
import { runsPath } from '../src/planning-files.ts';
import { cardOptionsPath, prepareCardOptionsPatch, readCardOptions } from './card-options.ts';
import { catalogPath, readProjectCatalog, verifyCardSources } from './catalog.ts';
import { replaceProjectMarkdown } from './native-cards.ts';
import { prepareRunRegistry, readOptionalPlanning } from './planning-files.ts';
import { parseRunRegistry, readRuns, type CarryOverOutcome } from './runs.ts';
import { addRunDays, capturePlanningStatistics, isRunExpired, replenishRuns, runGoal, shouldCarryCard, validateCarryOver, validateRunConfiguration, zonedRunClock, legacyRunCarryStates } from './run-model.ts';
import { defineText, serverText } from './i18n.ts';

const text = defineText({
  missing: 'Run or configuration not found.',
  past: 'Only active or future Runs can be deleted.',
  future: 'A future Run cannot be finished before it starts.',
  noCurrent: 'There is no current Run in this schedule yet. Expired Runs and their cards were kept until a current period is available.',
  legacyNext: 'There is no following standalone Run. Legacy cards were kept in their current Run.',
  partial: 'The Run change was partially saved. Refresh Timeline; external changes were preserved.',
  restored: 'The Run change was cancelled and its original files were restored.',
  owned: 'This field is managed by the Run lifecycle.',
}, {
  missing: 'Run или настройка не найдены.',
  past: 'Удалить можно только текущий или будущий Run.',
  future: 'Будущий Run нельзя завершить до его начала.',
  noCurrent: 'В расписании ещё нет текущего Run. Просроченные периоды и их карты сохранены до начала текущего периода.',
  legacyNext: 'Следующего отдельного Run нет. Старые карты остались в своём Run.',
  partial: 'Изменение Run сохранено не полностью. Обновите Timeline; чужие изменения сохранены.',
  restored: 'Изменение Run отменено, исходные файлы восстановлены.',
  owned: 'Это поле управляется жизненным циклом Run.',
});
const digest = (bytes: Buffer | null) => bytes ? createHash('sha256').update(bytes).digest('hex') : '';
type LifecycleEdit = Extract<PlanningEdit, { action: 'save-run-configuration' | 'finish-run' | 'delete-run' | 'resume-runs' }>;

async function checkedRegistry(root: string, expected: string) {
  const bytes = await readOptionalPlanning(root, runsPath);
  if (digest(bytes) !== expected) throw new Error('PLANNING_CONFLICT');
  return bytes ? parseRunRegistry(bytes) : { runs: [], configurations: [] };
}

/** Options and the registry form one guarded operation. Rollback never overwrites a foreign revision. */
async function publishWithAssignments(root: string, expectedRuns: string, expectedOptions: string, runs: RunRecord[], configurations: RunConfiguration[], assignments: Record<string, { run: string | null }>, sourceCards: CatalogCard[] = [], expectedManifest?: string): Promise<void> {
  const registry = await prepareRunRegistry(root, expectedRuns, runs, configurations);
  const previousOptions = await readOptionalPlanning(root, cardOptionsPath);
  if (digest(previousOptions) !== expectedOptions) throw new Error('CARD_OPTIONS_CONFLICT');
  let optionsHash = expectedOptions;
  let publishedOwn = false;
  const ownedOptions = new Set([expectedOptions]);
  const verify = async () => {
    if (digest(await readOptionalPlanning(root, runsPath)) !== expectedRuns) throw new Error('PLANNING_CONFLICT');
    if (digest(await readOptionalPlanning(root, cardOptionsPath)) !== optionsHash) throw new Error('CARD_OPTIONS_CONFLICT');
    if (expectedManifest !== undefined && digest(await readOptionalPlanning(root, catalogPath)) !== expectedManifest) throw new Error('CATALOG_CONFLICT');
    await verifyCardSources(root, sourceCards);
  };
  try {
    const entries = Object.entries(assignments);
    for (let offset = 0; offset < entries.length; offset += 1000) {
      const plan = await prepareCardOptionsPatch(root, optionsHash, Object.fromEntries(entries.slice(offset, offset + 1000)));
      ownedOptions.add(plan.nextHash);
      await plan.publish(verify);
      publishedOwn = true;
      optionsHash = plan.nextHash;
    }
    await registry.publish(verify);
  } catch (error) {
    let currentRunsHash: string;
    let currentOptionsHash: string;
    try {
      currentRunsHash = digest(await readOptionalPlanning(root, runsPath));
      currentOptionsHash = digest(await readOptionalPlanning(root, cardOptionsPath));
    } catch { throw error; }
    const registryOwned = registry.changed && currentRunsHash === registry.nextHash;
    const optionsOwned = currentOptionsHash !== expectedOptions && ownedOptions.has(currentOptionsHash);
    // 2026-11-05: a pure conflict (nothing of ours landed) is a 409; ours landed and was overwritten — a partial save.
    if (!registryOwned && !optionsOwned) {
      if (publishedOwn) throw Object.assign(new Error(serverText(text).partial), { saved: true });
      throw error;
    }
    if (registryOwned || !previousOptions) throw Object.assign(new Error(serverText(text).partial), { saved: true });
    try { await replaceProjectMarkdown(root, cardOptionsPath, currentOptionsHash, previousOptions); }
    catch { throw Object.assign(new Error(serverText(text).partial), { saved: true }); }
    if (error && typeof error === 'object' && 'saved' in error && error.saved) throw new Error(serverText(text).restored);
    throw error;
  }
}

function reschedule(runs: RunRecord[], previous: RunConfiguration | undefined, configuration: RunConfiguration, now: Date): RunRecord[] {
  if (!previous) return runs;
  if (previous.startDate === configuration.startDate && previous.durationWeeks === configuration.durationWeeks && previous.labelTemplate === configuration.labelTemplate) return runs;
  const datesChanged = previous.startDate !== configuration.startDate || previous.durationWeeks !== configuration.durationWeeks;
  const own = runs.filter(run => run.configurationId === configuration.id && !run.finishedAt && !isRunExpired(run, previous, now)).sort((left, right) => left.start.localeCompare(right.start));
  let nextStart: string | null = null;
  const changed = new Map<string, RunRecord>();
  const weekday = new Date(configuration.startDate + 'T00:00:00Z').getUTCDay();
  for (const run of own) {
    let start = datesChanged ? nextStart ?? run.start : run.start;
    const currentDate = zonedRunClock(now, configuration.timeZone).date;
    if (!nextStart && run.start > currentDate && previous.startDate !== configuration.startDate) {
      const oldWeekday = new Date(start + 'T00:00:00Z').getUTCDay();
      start = addRunDays(start, nearestWeekdayShift(oldWeekday, weekday));
    }
    let end = datesChanged ? addRunDays(start, configuration.durationWeeks * 7 - 1) : run.end;
    if (datesChanged && !nextStart && run.start <= currentDate) {
      const nextWeekday = new Date(addRunDays(end, 1) + 'T00:00:00Z').getUTCDay();
      end = addRunDays(end, nearestWeekdayShift(nextWeekday, weekday));
      // 2026-11-05: the current Run ends on the first boundary of the new cadence on or after today, never in the past.
      while (end < currentDate) end = addRunDays(end, configuration.durationWeeks * 7);
    }
    const goal = run.goal === runGoal(previous, run.number, run.start) ? runGoal(configuration, run.number, start) : run.goal;
    changed.set(run.id, { ...run, start, end, goal });
    nextStart = addRunDays(end, 1);
  }
  return runs.map(run => changed.get(run.id) ?? run);
}

interface RunState { hash: string; runs: RunRecord[]; configurations: RunConfiguration[] }
interface CompletionRequest { runId: string; carryOver: RunCarryOver; optionsHash: string }

function nearestWeekdayShift(from: number, to: number): number {
  const forward = (to - from + 7) % 7;
  return forward > 3 ? forward - 7 : forward;
}

function completionSources(cards: CatalogCard[], cardsById: ReadonlyMap<string, CatalogCard>): CatalogCard[] {
  const selected = new Map(cards.map(card => [card.id, card]));
  for (const card of cards) {
    for (const dependencyId of card.dependsOn ?? []) {
      const dependency = cardsById.get(dependencyId);
      if (dependency) selected.set(dependency.id, dependency);
    }
  }
  return [...selected.values()];
}

/** 2026-11-05: all frozen scopes read one pre-carry catalog; each card receives one final assignment. */
async function completeConfiguredRuns(root: string, state: RunState, now: Date, configurationId?: string, request?: CompletionRequest): Promise<CarryOverOutcome> {
  const outcome: CarryOverOutcome = { movedCount: 0, movedFrom: [], target: null, blocked: null };
  const configurations = new Map(state.configurations.map(configuration => [configuration.id, configuration]));
  const selected = request ? state.runs.find(run => run.id === request.runId) : undefined;
  if (request && !selected) throw new Error(serverText(text).missing);
  if (selected?.finishedAt) return outcome;
  const candidates = state.runs.filter(run => {
    const configuration = configurations.get(run.configurationId ?? '');
    return configuration && (!configurationId || run.configurationId === configurationId) && !run.finishedAt
      && (run.id === selected?.id || isRunExpired(run, configuration, now));
  });
  const candidateIds = new Set(candidates.map(run => run.id));
  const generatingConfigurations = configurationId ? state.configurations.filter(configuration => configuration.id === configurationId) : state.configurations;
  // Mark an explicitly finished active period provisionally so replenishment counts its successor.
  const generating = selected ? state.runs.map(run => run.id === selected.id ? { ...run, finishedAt: now.toISOString() } : run) : state.runs;
  let runs = replenishRuns(generating, generatingConfigurations, now).map(run => selected?.id === run.id ? selected : run);
  if (!candidates.length) {
    await (await prepareRunRegistry(root, state.hash, runs, state.configurations)).publish();
    return outcome;
  }
  const catalog = await readProjectCatalog(root);
  if (request && (catalog.optionsHash ?? '') !== request.optionsHash) throw new Error('CARD_OPTIONS_CONFLICT');
  const cardsById = new Map(catalog.cards.map(card => [card.id, card]));
  const assignments: Record<string, { run: string }> = {};
  const completed = new Map<string, RunRecord>();
  const sourceCards: CatalogCard[] = [];
  for (const run of candidates) {
    const configuration = configurations.get(run.configurationId!)!;
    const clock = zonedRunClock(now, configuration.timeZone);
    const ownCards = catalog.cards.filter(card => card.run === run.id);
    sourceCards.push(...ownCards);
    const choices = run.id === selected?.id ? request!.carryOver : configuration.carryOver;
    const moving = ownCards.filter(card => shouldCarryCard(card, choices, cardsById));
    const eligible = runs.filter(candidate => candidate.configurationId === run.configurationId && !candidateIds.has(candidate.id)
      && !candidate.finishedAt && !isRunExpired(candidate, configuration, now)).sort((left, right) => left.start.localeCompare(right.start));
    let target = eligible.find(candidate => candidate.start <= clock.date) ?? null;
    const finishingActive = selected?.configurationId === configuration.id && !isRunExpired(selected, configuration, now);
    if (!target && finishingActive) target = eligible.find(candidate => candidate.start > clock.date) ?? null;
    if (moving.length && !target && !configuration.stopDate) {
      if (request) throw new Error(serverText(text).noCurrent);
      outcome.blocked = serverText(text).noCurrent;
      continue;
    }
    const statistics = capturePlanningStatistics(ownCards, now, configuration.timeZone);
    completed.set(run.id, { ...run, finishedAt: now.toISOString(), statistics });
    if (target) for (const card of moving) assignments[card.id] = { run: target.id };
    outcome.movedFrom.push(run);
    outcome.target = target ?? outcome.target;
  }
  runs = runs.map(run => completed.get(run.id) ?? run);
  runs = replenishRuns(runs, generatingConfigurations, now);
  await publishWithAssignments(root, state.hash, catalog.optionsHash ?? '', runs, state.configurations, assignments,
    completionSources(sourceCards, cardsById), catalog.manifestHash);
  outcome.movedCount = Object.keys(assignments).length;
  return outcome;
}

async function saveConfiguration(root: string, edit: Extract<LifecycleEdit, { action: 'save-run-configuration' }>): Promise<void> {
  let configuration = validateRunConfiguration(edit.configuration);
  const registry = await checkedRegistry(root, edit.runsHash);
  const previous = registry.configurations.find(candidate => candidate.id === configuration.id);
  if (configuration.stopDate !== previous?.stopDate) throw new Error(serverText(text).owned);
  const now = new Date();
  const runs = reschedule(registry.runs, previous, configuration, now);
  if (previous && (previous.startDate !== configuration.startDate || previous.durationWeeks !== configuration.durationWeeks)) {
    const first = registry.runs.filter(run => run.configurationId === configuration.id && !run.finishedAt && !isRunExpired(run, previous, now))
      .sort((left, right) => left.start.localeCompare(right.start))[0];
    const shifted = runs.find(run => run.id === first?.id);
    if (first && shifted) {
      const clock = zonedRunClock(now, configuration.timeZone);
      // 2026-11-05: a shortened current period keeps its old start; anchor recurrence to its new successor boundary.
      configuration = { ...configuration, startDate: first.start <= clock.date ? addRunDays(shifted.end, 1) : shifted.start };
    }
  }
  const configurations = [...registry.configurations.filter(candidate => candidate.id !== configuration.id), configuration];
  await completeConfiguredRuns(root, { hash: edit.runsHash, runs, configurations }, now, configuration.id);
}

/** 2026-11-05: explicit legacy Finish only moves the historical carry states to an existing period. */
async function finishLegacyRun(root: string, state: RunState, run: RunRecord, edit: Extract<LifecycleEdit, { action: 'finish-run' }>, now: Date): Promise<void> {
  const clock = zonedRunClock(now, Intl.DateTimeFormat().resolvedOptions().timeZone);
  const available = state.runs.filter(candidate => !candidate.configurationId && candidate.id !== run.id && candidate.start > run.start
    && !isRunExpired(candidate, undefined, now)).sort((left, right) => left.start.localeCompare(right.start));
  const target = available.find(candidate => candidate.start <= clock.date) ?? available[0];
  if (!target) throw new Error(serverText(text).legacyNext);
  const catalog = await readProjectCatalog(root);
  if ((catalog.optionsHash ?? '') !== edit.optionsHash) throw new Error('CARD_OPTIONS_CONFLICT');
  const cardsById = new Map(catalog.cards.map(card => [card.id, card]));
  const ownCards = catalog.cards.filter(card => card.run === run.id);
  const moving = ownCards.filter(card => legacyRunCarryStates.has(card.state ?? '') && shouldCarryCard(card, edit.carryOver, cardsById));
  await publishWithAssignments(root, state.hash, edit.optionsHash, state.runs, state.configurations,
    Object.fromEntries(moving.map(card => [card.id, { run: target.id }])), completionSources(ownCards, cardsById), catalog.manifestHash);
}

async function finishRun(root: string, edit: Extract<LifecycleEdit, { action: 'finish-run' }>): Promise<void> {
  validateCarryOver(edit.carryOver);
  const registry = await checkedRegistry(root, edit.runsHash);
  const run = registry.runs.find(candidate => candidate.id === edit.runId);
  if (!run) throw new Error(serverText(text).missing);
  const configuration = registry.configurations.find(candidate => candidate.id === run.configurationId);
  const now = new Date();
  const clock = zonedRunClock(now, configuration?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  if (run.start > clock.date) throw new Error(serverText(text).future);
  const state = { ...registry, hash: edit.runsHash };
  if (!run.configurationId) return finishLegacyRun(root, state, run, edit, now);
  await completeConfiguredRuns(root, state, now, run.configurationId, edit);
}

async function deleteRun(root: string, edit: Extract<LifecycleEdit, { action: 'delete-run' }>): Promise<void> {
  const registry = await checkedRegistry(root, edit.runsHash);
  const run = registry.runs.find(candidate => candidate.id === edit.runId);
  if (!run) throw new Error(serverText(text).missing);
  const configuration = registry.configurations.find(candidate => candidate.id === run.configurationId);
  if (isRunExpired(run, configuration)) throw new Error(serverText(text).past);
  const removed = new Set(registry.runs.filter(candidate => candidate.id === run.id || run.configurationId && candidate.configurationId === run.configurationId && candidate.start >= run.start && !candidate.finishedAt).map(candidate => candidate.id));
  const configurations = registry.configurations.map(candidate => candidate.id === configuration?.id ? { ...candidate, stopDate: run.start } : candidate);
  const options = await readCardOptions(root);
  if (options.hash !== edit.optionsHash) throw new Error('CARD_OPTIONS_CONFLICT');
  const assignments = Object.fromEntries(Object.entries(options.options).filter(([, entry]) => entry.run && removed.has(entry.run)).map(([id]) => [id, { run: null }]));
  await publishWithAssignments(root, edit.runsHash, edit.optionsHash, registry.runs.filter(candidate => !removed.has(candidate.id)), configurations, assignments);
}

export async function applyRunLifecycleEdit(root: string, edit: LifecycleEdit): Promise<void> {
  if (edit.action === 'save-run-configuration') return saveConfiguration(root, edit);
  if (edit.action === 'finish-run') return finishRun(root, edit);
  if (edit.action === 'delete-run') return deleteRun(root, edit);
  const registry = await checkedRegistry(root, edit.runsHash);
  if (!registry.configurations.some(configuration => configuration.id === edit.configurationId)) throw new Error(serverText(text).missing);
  const configurations = registry.configurations.map(configuration => {
    if (configuration.id !== edit.configurationId) return configuration;
    const { stopDate: _stopDate, ...resumed } = configuration;
    return resumed;
  });
  await completeConfiguredRuns(root, { hash: edit.runsHash, runs: registry.runs, configurations }, new Date(), edit.configurationId);
}

/**
 * 2026-11-05: a scheduled Run finishes by itself at its «Finish at», carries the chosen unfinished cards and keeps the upcoming
 * count (Runs and Milestones must work end to end without a manual Finish). The server's minute timer calls this through
 * the write queue only after runScheduleDue; GET never does.
 */
export async function maintainRecurringRuns(root: string, now = new Date()): Promise<CarryOverOutcome> {
  const source = await readRuns(root);
  if (source.warnings.length || !source.configurations.length) return { movedCount: 0, movedFrom: [], target: null, blocked: null };
  return completeConfiguredRuns(root, source, now);
}

/** Cheap check before the write: a scheduled Run has passed its «Finish at», or the schedule has fewer upcoming Runs than set. */
export function runScheduleDue(source: { runs: RunRecord[]; configurations: RunConfiguration[] }, now = new Date()): boolean {
  const configurations = new Map(source.configurations.map(configuration => [configuration.id, configuration]));
  const expired = source.runs.some(run => {
    const configuration = configurations.get(run.configurationId ?? '');
    return Boolean(configuration) && !run.finishedAt && isRunExpired(run, configuration, now);
  });
  return expired || replenishRuns(source.runs, source.configurations, now).length !== source.runs.length;
}
