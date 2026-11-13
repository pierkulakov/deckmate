import { createHash } from 'node:crypto';
import type { CatalogView, RunConfiguration, RunRecord } from '../src/catalog-contracts.ts';
import { invalidPlanning, legacyRunCarryStates, planningId, validatePlanningDetails, validatePlanningStatistics, validateRunConfiguration } from './run-model.ts';
import { boundedText, prepareCardOptionsPatch, validDate } from './card-options.ts';
import { appendActivity, describeRunCarryOver } from './activity.ts';
import { readProjectCatalog } from './catalog.ts';
import { localIsoDate } from '../src/catalog-hand.ts';
import { readPlanningHistory } from './planning-history.ts';
import { readMilestones } from './milestones.ts';
import { milestonesPath } from '../src/planning-files.ts';
import { readProjectMarkdown } from './native-cards.ts';
import { runsPath } from '../src/planning-files.ts';
import { defineText, serverText } from './i18n.ts';
import { isPlainRecord, parseYamlFrontMatter } from './yaml-front-matter.ts';

/**
 * 2026-11-04: a Run is a recurring work period with dates.
 * Keep all Runs in one registry, as with Card Options, to avoid a separate file per period.
 */

const runText = defineText({
  sizeLimit: "The Run registry is larger than 1 MB.",
  yamlHeader: "The Run registry needs a YAML header.",
  invalidYaml: "Invalid Run registry YAML.",
  noAliases: "The Run registry does not support YAML aliases.",
  schema: "The registry needs schema: 1 and a runs list with up to 1000 entries.",
  fields: "Run fields: id, number, start, end, goal, configurationId?, description?, cover?, finishedAt?, statistics?, history?.",
  missingNextRun: (listed: string) => `Expired ${listed}: there is no current or following Run for unfinished work. Assign it explicitly to an existing Run.`,
  expiredRun: (number: number, end: string) => `Run ${number} (ended ${end})`,
  identifier: "Duplicate or invalid Run ID.",
  number: (value: Record<string, unknown>) => `Run number must be a unique integer of at least 1: ${value.id}`,
  dates: (value: Record<string, unknown>) => `Run dates must be valid YYYY-MM-DD dates: ${value.id}`,
  dateOrder: (value: Record<string, unknown>) => `Run ${value.id}: start must be before end.`,
  goal: (value: Record<string, unknown>) => `Run goal must be 1 to 200 characters without surrounding spaces: ${value.id}`,
  missingReference: (entry: { label: string; value: string; file: string; count: number; example: string }) => `${entry.label} “${entry.value}” is missing from ${entry.file}; cards: ${entry.count} (example: “${entry.example}”).`,
}, {
  sizeLimit: "Реестр Run больше 1 МБ.",
  yamlHeader: "Реестру Run нужна YAML-шапка.",
  invalidYaml: "Некорректный YAML реестра Run.",
  noAliases: "Реестр Run не поддерживает YAML aliases.",
  schema: "Нужен реестр schema: 1 и список runs до 1000 записей.",
  fields: "Поля Run: id, number, start, end, goal, configurationId?, description?, cover?, finishedAt?, statistics?, history?.",
  missingNextRun: (listed: string) => `Истекли ${listed}: нет текущего или следующего Run для незавершённой работы. Назначьте её в существующий Run явно.`,
  expiredRun: (number: number, end: string) => `Run ${number} (закончился ${end})`,
  identifier: "Повтор или некорректный ID Run.",
  number: (value: Record<string, unknown>) => `number Run — уникальное целое от 1: ${value.id}`,
  dates: (value: Record<string, unknown>) => `Даты Run — настоящие даты YYYY-MM-DD: ${value.id}`,
  dateOrder: (value: Record<string, unknown>) => `Run ${value.id}: start должен быть раньше end.`,
  goal: (value: Record<string, unknown>) => `goal Run — строка 1–200 без краевых пробелов: ${value.id}`,
  missingReference: (entry: { label: string; value: string; file: string; count: number; example: string }) => `${entry.label} «${entry.value}» отсутствует в ${entry.file}; карточек: ${entry.count} (пример: «${entry.example}»).`,
});

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

export interface RunsSource { hash: string; runs: RunRecord[]; configurations: RunConfiguration[]; warnings: string[] }

export function parseRunRegistry(bytes: Buffer): { runs: RunRecord[]; configurations: RunConfiguration[] } {
  if (bytes.length > 1024 * 1024) throw new Error(serverText(runText).sizeLimit);
  const { document } = parseYamlFrontMatter(bytes, {
    headerError: serverText(runText).yamlHeader, yamlError: serverText(runText).invalidYaml,
    aliases: 'reject', aliasError: serverText(runText).noAliases,
  });
  const metadata: unknown = document.toJS({ maxAliasCount: 0 });
  if (!isPlainRecord(metadata) || metadata.schema !== 1 || !Array.isArray(metadata.runs) || metadata.runs.length > 1000) {
    throw new Error(serverText(runText).schema);
  }
  const identifiers = new Set<string>();
  const numbers = new Set<string>();
  const configurations = metadata.configurations === undefined ? [] : metadata.configurations;
  if (!Array.isArray(configurations) || configurations.length > 100) invalidPlanning('configurations');
  const parsedConfigurations = configurations.map(validateRunConfiguration);
  if (new Set(parsedConfigurations.map(configuration => configuration.id)).size !== parsedConfigurations.length) invalidPlanning('configurations.id');
  const runs = metadata.runs.map((value: unknown) => {
    if (!isPlainRecord(value) || Object.keys(value).some(key => !['id', 'number', 'start', 'end', 'goal', 'configurationId', 'description', 'cover', 'finishedAt', 'statistics', 'history'].includes(key))) {
      throw new Error(serverText(runText).fields);
    }
    if (typeof value.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/u.test(value.id) || identifiers.has(value.id)) throw new Error(serverText(runText).identifier);
    identifiers.add(value.id);
    const numberKey = `${value.configurationId ?? ''}:${value.number}`;
    if (!Number.isInteger(value.number) || Number(value.number) < 1 || numbers.has(numberKey)) throw new Error(serverText(runText).number(value));
    numbers.add(numberKey);
    if (typeof value.start !== 'string' || typeof value.end !== 'string' || !validDate(value.start) || !validDate(value.end)) throw new Error(serverText(runText).dates(value));
    if (!(value.start < value.end)) throw new Error(serverText(runText).dateOrder(value));
    if (!boundedText(value.goal, 200)) throw new Error(serverText(runText).goal(value));
    if (value.configurationId !== undefined && (!planningId(value.configurationId) || !parsedConfigurations.some(configuration => configuration.id === value.configurationId))) invalidPlanning('configurationId');
    validatePlanningDetails(value);
    if (value.finishedAt !== undefined && (typeof value.finishedAt !== 'string' || !Number.isFinite(Date.parse(value.finishedAt)))) invalidPlanning('finishedAt');
    if (value.statistics !== undefined) validatePlanningStatistics(value.statistics);
    return { ...value } as unknown as RunRecord;
  });
  return { configurations: parsedConfigurations, runs: runs.sort((first, second) => first.start === second.start
    ? first.number - second.number
    : first.start < second.start ? -1 : 1) };
}

/** Invalid registries produce warnings; Sprint and Timeline remain usable. */
export async function readRuns(root: string): Promise<RunsSource> {
  let bytes: Buffer;
  try { bytes = await readProjectMarkdown(root, runsPath); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { hash: '', runs: [], configurations: [], warnings: [] };
    throw error;
  }
  try {
    return { hash: digest(bytes), ...parseRunRegistry(bytes), warnings: [] };
  } catch (error) {
    return { hash: '', runs: [], configurations: [], warnings: [`${runsPath}: ${error instanceof Error ? error.message : String(error)}`] };
  }
}

/**
 * 2026-11-04: run and milestone remain free-form Card Options strings;
 * references absent from their registries produce catalog warnings rather than failing reads.
 */
function planningReferenceWarnings(cards: { title: string; run?: string | null; milestone?: string | null }[],
  runs: RunRecord[], milestones: { id: string }[]): string[] {
  const unknown = new Map<string, { label: string; value: string; count: number; example: string; file: string }>();
  const knownRuns = new Set(runs.map(run => run.id));
  const knownMilestones = new Set(milestones.map(milestone => milestone.id));
  for (const card of cards) {
    const references: { label: 'Run' | 'Milestone'; value: string | null | undefined; registry: Set<string>; file: string }[] = [
      { label: 'Run', value: card.run, registry: knownRuns, file: runsPath },
      { label: 'Milestone', value: card.milestone, registry: knownMilestones, file: milestonesPath },
    ];
    for (const reference of references) {
      if (!reference.value || reference.registry.has(reference.value)) continue;
      const key = reference.label + ':' + reference.value;
      const entry = unknown.get(key) ?? { label: reference.label, value: reference.value, count: 0, example: card.title, file: reference.file };
      entry.count += 1;
      unknown.set(key, entry);
    }
  }
  return [...unknown.values()].map(entry =>
    serverText(runText).missingReference(entry));
}

/**
 * Add Run and Milestone registries after readProjectCatalog, where both registries and Card Options
 * are available, as ProjectCatalog.runs/milestones.
 */
export async function attachPlanningRegistries(view: CatalogView, root: string): Promise<void> {
  const [runsSource, milestonesSource] = await Promise.all([readRuns(root), readMilestones(root)]);
  view.runs = runsSource.runs;
  view.runConfigurations = runsSource.configurations;
  view.milestones = milestonesSource.milestones;
  view.runsHash = runsSource.hash;
  view.milestonesHash = milestonesSource.hash;
  const history = await readPlanningHistory(root);
  view.planningHistory = history.points;
  view.warnings.push(...history.warnings);
  view.warnings.push(...runsSource.warnings, ...milestonesSource.warnings,
    ...planningReferenceWarnings(view.cards, runsSource.runs, milestonesSource.milestones));
}

export interface CarryOverOutcome {
  movedCount: number;
  movedFrom: RunRecord[];
  target: RunRecord | null;
  blocked: string | null;
}

/** 2026-11-05: legacy housekeeping only moves the original three states; never edits registries. */
export async function carryOverExpiredRuns(root: string): Promise<CarryOverOutcome> {
  const source = await readRuns(root);
  const runs = source.runs.filter(run => !run.configurationId);
  const idle: CarryOverOutcome = { movedCount: 0, movedFrom: [], target: null, blocked: null };
  const today = localIsoDate();
  const expired = runs.filter(run => run.end < today);
  if (!expired.length) return idle;
  // 2026-11-05: standalone Runs are no longer created, so the current scheduled Run also takes their unfinished work.
  const target = runs.find(run => run.start <= today && today <= run.end) ?? runs.find(run => run.start > today)
    ?? source.runs.find(run => run.configurationId && !run.finishedAt && run.start <= today && today <= run.end) ?? null;
  const before = await readProjectCatalog(root);
  const expiredIds = new Set(expired.map(run => run.id));
  const moving = before.cards.filter(card => card.kind === 'task' && typeof card.run === 'string' && expiredIds.has(card.run)
    && legacyRunCarryStates.has(card.state ?? '') && !card.archived && !card.deleted);
  if (!moving.length) return { ...idle, movedFrom: expired, target };
  if (!target) return { ...idle, movedFrom: expired, blocked: serverText(runText).missingNextRun(expired.filter(run => moving.some(card => card.run === run.id)).map(run => serverText(runText).expiredRun(run.number, run.end)).join(', ')) };
  const plan = await prepareCardOptionsPatch(root, before.optionsHash ?? '',
    Object.fromEntries(moving.map(card => [card.id, { run: target.id }])));
  await plan.publish();
  const after = await readProjectCatalog(root);
  for (const run of expired) {
    const event = describeRunCarryOver(before, after, run, target);
    if (event) await appendActivity(root, event, after.formatLanguage);
  }
  return { movedCount: moving.length, movedFrom: expired, target, blocked: null };
}
