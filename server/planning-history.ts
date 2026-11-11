import { createHash } from 'node:crypto';
import type { CatalogCard, CatalogView, PlanningHistoryPoint } from '../src/catalog-contracts.ts';
import type { FormatLanguage } from '../src/format-vocabulary.ts';
import { milestonesPath, planningHistoryPath, runsPath } from '../src/planning-files.ts';
import { cardOptionsPath } from './card-options.ts';
import { catalogPath, verifyCardSources } from './catalog.ts';
import { createManagedMarkdown, replaceProjectMarkdown } from './native-cards.ts';
import { capturePlanningStatistics, isRunExpired, validatePlanningDetails, zonedRunClock } from './run-model.ts';
import { readOptionalPlanning } from './planning-files.ts';
import { defineText, serverText } from './i18n.ts';

const text = defineText({ invalid: 'Invalid planning history; existing observations were preserved.' },
  { invalid: 'Некорректная история планирования; существующие наблюдения сохранены.' });
// 2026-11-06: a new file gets its heading in the project's format language; readPlanningHistory reads only "- " lines.
const registryBriefs = { en: '\n# Planning history\n\n', ru: '\n# История планирования\n\n' } as const satisfies Record<FormatLanguage, string>;
interface Observation extends PlanningHistoryPoint { plan: string }
interface HistorySource { bytes: Buffer | null; points: Record<string, PlanningHistoryPoint[]>; warnings: string[] }
const digest = (bytes: Buffer | null) => bytes ? createHash('sha256').update(bytes).digest('hex') : '';

/** Append-only machine observations; reading never creates or repairs files (2026-11-05). */
export async function readPlanningHistory(root: string): Promise<HistorySource> {
  const bytes = await readOptionalPlanning(root, planningHistoryPath);
  const points: Record<string, PlanningHistoryPoint[]> = {};
  if (!bytes) return { bytes, points, warnings: [] };
  try {
    if (bytes.length > 16 * 1024 * 1024) throw new Error('limit');
    const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (!/^---\r?\nschema: 1\r?\n---\r?\n/u.test(content)) throw new Error('schema');
    for (const line of content.split(/\r?\n/u)) {
      if (!line.startsWith('- ')) continue;
      const observation = JSON.parse(line.slice(2)) as Observation;
      if (!observation || typeof observation.plan !== 'string' || !/^(run|milestone):[a-z0-9][a-z0-9-]{0,79}$/u.test(observation.plan)) throw new Error('plan');
      validatePlanningDetails({ history: [observation] });
      const { plan, date, tasks, done, effort, doneEffort } = observation;
      const history = points[plan] ??= [];
      if (history.some(point => point.date === date)) throw new Error('duplicate date');
      history.push({ date, tasks, done, effort, doneEffort });
    }
    return { bytes, points, warnings: [] };
  } catch { return { bytes, points: {}, warnings: [`${planningHistoryPath}: ${serverText(text).invalid}`] }; }
}

function observations(view: CatalogView, history: Record<string, PlanningHistoryPoint[]>, now: Date) {
  const pending: { observation: Observation; cards: CatalogCard[] }[] = [];
  const add = (plan: string, cards: CatalogCard[], timeZone: string) => {
    const date = zonedRunClock(now, timeZone).date;
    if (history[plan]?.some(point => point.date === date)) return;
    const { tasks, done, effort, doneEffort } = capturePlanningStatistics(cards, now, timeZone);
    pending.push({ observation: { plan, date, tasks, done, effort, doneEffort }, cards });
  };
  for (const run of view.runs ?? []) {
    const configuration = view.runConfigurations?.find(candidate => candidate.id === run.configurationId);
    if (!configuration || run.finishedAt || run.start > zonedRunClock(now, configuration.timeZone).date || isRunExpired(run, configuration, now)) continue;
    add(`run:${run.id}`, view.cards.filter(card => card.run === run.id), configuration.timeZone);
  }
  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = zonedRunClock(now, localZone).date;
  for (const milestone of view.milestones ?? []) {
    if (milestone.date >= today) add(`milestone:${milestone.id}`, view.cards.filter(card => card.milestone === milestone.id), localZone);
  }
  return pending;
}

export function needsPlanningObservation(view: CatalogView, now = new Date()): boolean {
  return observations(view, view.planningHistory ?? {}, now).length > 0;
}

/** Caller must hold the shared mutation queue and have passed assertWritable. */
export async function recordPlanningObservation(root: string, view: CatalogView, now = new Date()): Promise<boolean> {
  const source = await readPlanningHistory(root);
  if (source.warnings.length) throw new Error(source.warnings[0]);
  const pending = observations(view, source.points, now);
  if (!pending.length) return false;
  const verify = async () => {
    const revisions = [[catalogPath, view.manifestHash], [cardOptionsPath, view.optionsHash ?? ''],
      [runsPath, view.runsHash ?? ''], [milestonesPath, view.milestonesHash ?? '']] as const;
    for (const [relative, expected] of revisions) if (digest(await readOptionalPlanning(root, relative)) !== expected) throw new Error('PLANNING_CONFLICT');
    await verifyCardSources(root, pending.flatMap(entry => entry.cards));
    if (digest(await readOptionalPlanning(root, planningHistoryPath)) !== digest(source.bytes)) throw new Error('PLANNING_CONFLICT');
  };
  const lines = pending.map(entry => `- ${JSON.stringify(entry.observation)}\n`).join('');
  if (source.bytes) {
    const ending = source.bytes.at(-1) === 10 ? '' : '\n';
    await replaceProjectMarkdown(root, planningHistoryPath, digest(source.bytes), Buffer.concat([source.bytes, Buffer.from(ending + lines)]), verify);
  } else if (!await createManagedMarkdown(root, planningHistoryPath, { schema: 1 }, registryBriefs[view.formatLanguage] + lines, verify)) throw new Error('PLANNING_CONFLICT');
  return true;
}
