import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import type { RunConfiguration } from '../src/catalog-contracts.ts';
import { emptyManifest, renderCatalogManifest } from '../server/catalog.ts';
import { applyPlanningEdit } from '../server/planning-files.ts';
import { createManagedMarkdown, type NativeCardMetadata } from '../server/native-cards.ts';
import { prepareCardOptionsPatch, readCardOptions } from '../server/card-options.ts';
import * as cardOptions from '../server/card-options.ts';
import { carryOverExpiredRuns, readRuns } from '../server/runs.ts';
import { maintainRecurringRuns, runScheduleDue } from '../server/run-lifecycle.ts';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  for (const root of roots.splice(0)) {
    if (path.dirname(path.resolve(root)) !== path.resolve(tmpdir()) || !path.basename(root).startsWith('deckmate-run-lifecycle-')) throw new Error('Unsafe fixture cleanup');
    await rm(root, { recursive: true, force: true });
  }
});
function configuration(id = 'team', overrides: Partial<RunConfiguration> = {}): RunConfiguration {
  return { id, shortName: id.slice(0, 5), color: '#9258e5', labelTemplate: 'Cycle %RUN_NR% · W%CALENDAR_WEEK%',
    startDate: '2026-11-02', durationWeeks: 1, upcomingCount: 2, finishTime: '24:00', timeZone: 'UTC',
    carryOver: { review: true, blocked: true, other: true }, ...overrides };
}
async function fixture() {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-05T12:00:00Z'));
  const root = await mkdtemp(path.join(tmpdir(), 'deckmate-run-lifecycle-'));
  roots.push(root);
  await mkdir(path.join(root, 'tasks'));
  await writeFile(path.join(root, 'tasks/deckmate.md'), renderCatalogManifest(emptyManifest()));
  return root;
}
async function save(root: string, config: RunConfiguration) {
  await applyPlanningEdit(root, { action: 'save-run-configuration', configuration: config, runsHash: (await readRuns(root)).hash });
}
async function card(root: string, state: string, run: string, extra: Partial<NativeCardMetadata> = {}, options: { archived?: boolean; doneAt?: string } = {}) {
  const id = randomUUID();
  await createManagedMarkdown(root, `cards/${id}.md`, { deckmate: 'card', schema: 1, id, kind: 'task', title: state,
    state, owner: null, effort: 3, priority: 'high', deckId: null, trackIds: [], parentId: null, ...extra }, 'Keep this Markdown byte-identical.\n');
  const current = await readCardOptions(root);
  await (await prepareCardOptionsPatch(root, current.hash, { ['card:' + id]: { run, ...options } })).publish();
  return 'card:' + id;
}

it('finishes with selected categories, preserves the frozen statistics, and never crosses configurations', async () => {
  const root = await fixture();
  await save(root, configuration());
  await save(root, configuration('other'));
  const review = await card(root, 'приёмка', 'team-1');
  const prerequisite = await card(root, 'в работе', 'other-1');
  const blocked = await card(root, 'в работе', 'team-1', { dependsOn: [prerequisite] });
  const planned = await card(root, 'план', 'team-1');
  const accepted = await card(root, 'принято', 'team-1', {}, { doneAt: '2026-11-04' });
  const cancelled = await card(root, 'не делаем', 'team-1');
  const archived = await card(root, 'в работе', 'team-1', {}, { archived: true });
  const separate = await card(root, 'приёмка', 'other-1');
  const originalCard = await readFile(path.join(root, 'cards', review.slice(5) + '.md'));
  const originalCancelled = await readFile(path.join(root, 'cards', cancelled.slice(5) + '.md'));
  const before = await readRuns(root);
  await applyPlanningEdit(root, { action: 'finish-run', runId: 'team-1', runsHash: before.hash, optionsHash: (await readCardOptions(root)).hash,
    carryOver: { review: true, blocked: false, other: true } });
  const options = (await readCardOptions(root)).options;
  expect(options[review].run).toBe('team-2');
  expect(options[planned].run).toBe('team-2');
  for (const id of [blocked, accepted, cancelled, archived]) expect(options[id].run).toBe('team-1');
  expect(options[separate].run).toBe('other-1');
  const finished = (await readRuns(root)).runs.find(run => run.id === 'team-1')!;
  expect(finished.statistics).toMatchObject({ tasks: 5, done: 1, effort: 15, doneEffort: 3 });
  expect(finished.statistics?.completedEffort).toContainEqual({ cardId: accepted, date: '2026-11-04', effort: 3 });
  expect(finished.history).toBeUndefined();
  expect((await readRuns(root)).runs.filter(run => run.configurationId === 'team' && !run.finishedAt)).toHaveLength(2);
  await carryOverExpiredRuns(root);
  expect((await readRuns(root)).runs.find(run => run.id === 'team-1')?.statistics).toEqual(finished.statistics);
  expect(await readFile(path.join(root, 'cards', review.slice(5) + '.md'))).toEqual(originalCard);
  expect(await readFile(path.join(root, 'cards', cancelled.slice(5) + '.md'))).toEqual(originalCancelled);
});

it('respects the configured zone/time and carries only when the following period is current', async () => {
  const root = await fixture();
  await save(root, configuration('zone', { finishTime: '00:00', timeZone: 'Pacific/Honolulu' }));
  const moving = await card(root, 'план', 'zone-1');
  const prerequisite = await card(root, 'в работе', 'zone-1');
  const cancelled = await card(root, 'не делаем', 'zone-1', { dependsOn: [prerequisite] });
  const originalCancelled = await readFile(path.join(root, 'cards', cancelled.slice(5) + '.md'));
  vi.setSystemTime(new Date('2026-11-08T09:59:00Z'));
  await maintainRecurringRuns(root);
  expect((await readRuns(root)).runs.find(run => run.id === 'zone-1')?.finishedAt).toBeUndefined();
  vi.setSystemTime(new Date('2026-11-08T10:00:00Z'));
  const gap = await maintainRecurringRuns(root);
  expect(gap.blocked).not.toBeNull();
  expect((await readRuns(root)).runs.find(run => run.id === 'zone-1')?.finishedAt).toBeUndefined();
  expect((await readCardOptions(root)).options[moving].run).toBe('zone-1');
  vi.setSystemTime(new Date('2026-11-09T10:00:00Z'));
  await maintainRecurringRuns(root);
  const after = await readRuns(root);
  expect(after.runs.map(run => run.id)).toEqual(['zone-1', 'zone-2', 'zone-3']);
  expect(after.runs[0].finishedAt).toBe('2026-11-09T10:00:00.000Z');
  const options = (await readCardOptions(root)).options;
  expect(options[moving].run).toBe('zone-2');
  expect(options[prerequisite].run).toBe('zone-2');
  expect(options[cancelled].run).toBe('zone-1');
  expect(await readFile(path.join(root, 'cards', cancelled.slice(5) + '.md'))).toEqual(originalCancelled);
  await maintainRecurringRuns(root);
  expect((await readRuns(root)).runs).toEqual(after.runs);
});

it('deletes this and subsequent Runs, preserves cards and unrelated schedules, then resumes without duplicates', async () => {
  const root = await fixture();
  await save(root, configuration('team', { upcomingCount: 3 }));
  await save(root, configuration('other'));
  const active = await card(root, 'в работе', 'team-1');
  const future = await card(root, 'план', 'team-2');
  const archived = await card(root, 'принято', 'team-3', {}, { archived: true });
  const before = await readRuns(root);
  await applyPlanningEdit(root, { action: 'delete-run', runId: 'team-2', runsHash: before.hash, optionsHash: (await readCardOptions(root)).hash });
  const deleted = await readRuns(root);
  expect(deleted.runs.map(run => run.id)).toEqual(expect.arrayContaining(['team-1', 'other-1', 'other-2']));
  expect(deleted.runs.filter(run => run.configurationId === 'team')).toHaveLength(1);
  expect(deleted.configurations.find(config => config.id === 'team')?.stopDate).toBe('2026-11-09');
  const options = (await readCardOptions(root)).options;
  expect(options[active].run).toBe('team-1');
  expect(options[future]?.run).toBeUndefined();
  expect(options[archived]?.run).toBeUndefined();
  await expect(applyPlanningEdit(root, { action: 'resume-runs', configurationId: 'team', runsHash: before.hash })).rejects.toThrow('CONFLICT');
  await carryOverExpiredRuns(root);
  expect((await readRuns(root)).runs.filter(run => run.configurationId === 'team')).toHaveLength(1);
  await applyPlanningEdit(root, { action: 'resume-runs', configurationId: 'team', runsHash: (await readRuns(root)).hash });
  const resumed = await readRuns(root);
  expect(resumed.runs.filter(run => run.configurationId === 'team').map(run => run.id)).toEqual(['team-1', 'team-2', 'team-3']);
  expect(resumed.configurations.find(config => config.id === 'team')?.stopDate).toBeUndefined();
  expect(await readFile(path.join(root, 'cards', future.slice(5) + '.md'), 'utf8')).toContain('Keep this Markdown byte-identical.');
});

it.each(['runs', 'options'] as const)('keeps a foreign %s revision as a pure conflict before the first own publication', async kind => {
  const root = await fixture();
  await save(root, configuration());
  const moving = await card(root, 'приёмка', 'team-1');
  const before = await readRuns(root);
  const beforeOptions = await readCardOptions(root);
  const filename = path.join(root, 'tasks', kind === 'runs' ? 'deckmate-runs.md' : 'deckmate-card-options.md');
  const foreignBytes = Buffer.concat([await readFile(filename), Buffer.from('\nExternal writer kept this note.\n')]);
  const prepare = cardOptions.prepareCardOptionsPatch;
  let injected = false;
  vi.spyOn(cardOptions, 'prepareCardOptionsPatch').mockImplementationOnce(async (...args) => {
    const plan = await prepare(...args);
    return { ...plan, async publish(verify) {
      injected = true;
      await writeFile(filename, foreignBytes);
      await plan.publish(verify);
    } };
  });
  const failure = await applyPlanningEdit(root, { action: 'finish-run', runId: 'team-1', runsHash: before.hash,
    optionsHash: beforeOptions.hash, carryOver: { review: true, blocked: true, other: true } }).catch(error => error);
  expect(injected).toBe(true);
  expect(failure).toBeInstanceOf(Error);
  expect(failure.message).toContain('CONFLICT');
  expect(failure.saved).not.toBe(true);
  expect(await readFile(filename)).toEqual(foreignBytes);
  expect((await readCardOptions(root)).options[moving].run).toBe('team-1');
  expect((await readRuns(root)).runs.find(run => run.id === 'team-1')?.statistics).toBeUndefined();
});

it('rolls back its own options write when a foreign runs revision lands between the two publications', async () => {
  const root = await fixture();
  await save(root, configuration());
  const moving = await card(root, 'приёмка', 'team-1');
  const before = await readRuns(root);
  const beforeOptions = await readCardOptions(root);
  const runsFile = path.join(root, 'tasks', 'deckmate-runs.md');
  const optionsFile = path.join(root, 'tasks', 'deckmate-card-options.md');
  const foreignRuns = Buffer.concat([await readFile(runsFile), Buffer.from('\nExternal writer kept this note.\n')]);
  const optionsBytes = await readFile(optionsFile);
  const prepare = cardOptions.prepareCardOptionsPatch;
  let injected = false;
  // 2026-11-10: the foreign revision must land after our options write, before runs publication.
  vi.spyOn(cardOptions, 'prepareCardOptionsPatch').mockImplementationOnce(async (...args) => {
    const plan = await prepare(...args);
    return { ...plan, async publish(verify) {
      await plan.publish(verify);
      injected = true;
      await writeFile(runsFile, foreignRuns);
    } };
  });
  const failure = await applyPlanningEdit(root, { action: 'finish-run', runId: 'team-1', runsHash: before.hash,
    optionsHash: beforeOptions.hash, carryOver: { review: true, blocked: true, other: true } }).catch(error => error);
  expect(injected).toBe(true);
  expect(failure).toBeInstanceOf(Error);
  expect(failure.message).toContain('CONFLICT');
  expect(failure.saved).not.toBe(true);
  // The foreign registry wins; our already-published options assignment is restored, not overwritten on top of it.
  expect(await readFile(runsFile)).toEqual(foreignRuns);
  expect(await readFile(optionsFile)).toEqual(optionsBytes);
  expect((await readCardOptions(root)).options[moving].run).toBe('team-1');
  expect((await readRuns(root)).runs.find(run => run.id === 'team-1')?.statistics).toBeUndefined();
});

it('freezes each overdue scope before carrying its cards once into the current period after an offline gap', async () => {
  const root = await fixture();
  await save(root, configuration());
  const first = await card(root, 'в работе', 'team-1');
  const second = await card(root, 'приёмка', 'team-2');
  vi.setSystemTime(new Date('2026-11-26T12:00:00Z'));
  const patches = vi.spyOn(cardOptions, 'prepareCardOptionsPatch');
  const outcome = await maintainRecurringRuns(root);
  const registry = await readRuns(root);
  const current = registry.runs.find(run => run.start === '2026-11-23')!;
  expect(outcome.movedCount).toBe(2);
  expect(patches).toHaveBeenCalledTimes(1);
  expect(patches.mock.calls[0][2]).toEqual({ [first]: { run: current.id }, [second]: { run: current.id } });
  for (const runId of ['team-1', 'team-2']) {
    expect(registry.runs.find(run => run.id === runId)?.statistics).toMatchObject({ tasks: 1, done: 0, effort: 3 });
    expect(registry.runs.find(run => run.id === runId)?.history).toBeUndefined();
  }
  expect(registry.runs.some(run => run.start === '2026-11-16')).toBe(false);
  expect(registry.runs.filter(run => !run.finishedAt).map(run => run.start)).toEqual(['2026-11-23', '2026-11-30']);
  const bytes = await readFile(path.join(root, 'tasks/deckmate-runs.md'));
  await maintainRecurringRuns(root);
  expect(await readFile(path.join(root, 'tasks/deckmate-runs.md'))).toEqual(bytes);
  expect(patches).toHaveBeenCalledTimes(1);
});

it('creates and resumes only current/upcoming periods without backfilling missed time', async () => {
  const root = await fixture();
  await save(root, configuration('past', { startDate: '2019-01-07', timeZone: 'Pacific/Honolulu' }));
  let registry = await readRuns(root);
  expect(registry.runs.map(run => run.start)).toEqual(['2026-11-02', '2026-11-09']);
  expect(registry.runs.every(run => !run.finishedAt && !run.statistics && !run.history)).toBe(true);
  await applyPlanningEdit(root, { action: 'delete-run', runId: registry.runs[0].id, runsHash: registry.hash,
    optionsHash: (await readCardOptions(root)).hash });
  expect((await readRuns(root)).runs).toEqual([]);
  vi.setSystemTime(new Date('2026-11-26T12:00:00Z'));
  await applyPlanningEdit(root, { action: 'resume-runs', configurationId: 'past', runsHash: (await readRuns(root)).hash });
  registry = await readRuns(root);
  expect(registry.runs.map(run => run.start)).toEqual(['2026-11-23', '2026-11-30']);
  expect(registry.runs.every(run => !run.finishedAt && !run.statistics && !run.history)).toBe(true);
});

it('keeps legacy registries byte-identical during reads and preserves their original carry states', async () => {
  const root = await fixture();
  const runs = Buffer.from('\uFEFF---\r\nschema: 1\r\n# User comment\r\nruns:\r\n  - {id: old-1, number: 1, start: 2026-10-01, end: 2026-10-07, goal: First}\r\n  - {id: old-2, number: 2, start: 2026-10-08, end: 2026-10-14, goal: Second}\r\n  - {id: old-3, number: 3, start: 2026-11-02, end: 2026-11-08, goal: Current}\r\n---\r\nKeep the original body.\r\n');
  const milestones = Buffer.from('---\nschema: 1\nmilestones:\n  - id: later\n    title: Keep my case\n    date: 2026-12-01\n    color: "#AABBCC"\n    projectSpecific: false\n---\nOriginal milestone body.\n');
  await writeFile(path.join(root, 'tasks/freetion-runs.md'), runs);
  await writeFile(path.join(root, 'tasks/freetion-milestones.md'), milestones);
  const doing = await card(root, 'в работе', 'old-1');
  const discussing = await card(root, 'обсуждаем', 'old-2');
  const reviewing = await card(root, 'приёмка', 'old-1');
  const planned = await card(root, 'план', 'old-1');
  const iteration = await card(root, 'итерация', 'old-2');
  await readRuns(root);
  await maintainRecurringRuns(root);
  await carryOverExpiredRuns(root);
  const options = (await readCardOptions(root)).options;
  for (const id of [doing, discussing, reviewing]) expect(options[id].run).toBe('old-3');
  expect(options[planned].run).toBe('old-1');
  expect(options[iteration].run).toBe('old-2');
  expect(await readFile(path.join(root, 'tasks/freetion-runs.md'))).toEqual(runs);
  expect(await readFile(path.join(root, 'tasks/freetion-milestones.md'))).toEqual(milestones);
  expect((await readRuns(root)).runs.every(run => !run.finishedAt && !run.statistics && !run.history)).toBe(true);
});

it('wakes the server timer only when a scheduled Run has ended or the upcoming count is short', async () => {
  const root = await fixture();
  await save(root, configuration());
  expect(runScheduleDue(await readRuns(root))).toBe(false);
  vi.setSystemTime(new Date('2026-11-09T00:00:00Z'));
  expect(runScheduleDue(await readRuns(root))).toBe(true);
  await maintainRecurringRuns(root);
  const advanced = await readRuns(root);
  expect(advanced.runs.find(run => run.id === 'team-1')?.finishedAt).toBe('2026-11-09T00:00:00.000Z');
  expect(runScheduleDue(advanced)).toBe(false);
  expect(runScheduleDue({ ...advanced, runs: advanced.runs.filter(run => run.id !== 'team-3') })).toBe(true);
});
