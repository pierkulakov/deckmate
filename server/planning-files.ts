import { defineText, serverText } from './i18n.ts';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { isMap, isSeq, parseDocument, stringify, type YAMLSeq } from 'yaml';
import type { MilestoneRecord, RunConfiguration, RunRecord } from '../src/catalog-contracts.ts';
import type { PlanningEdit } from '../src/planning-files.ts';
import type { FormatLanguage } from '../src/format-vocabulary.ts';
import { milestonesPath, runsPath } from '../src/planning-files.ts';
import { cardOptionsPath, prepareCardOptionsPatch, readCardOptions } from './card-options.ts';
import { catalogPath, preparePinnedMilestone, readManifest } from './catalog.ts';
import { projectLanguage } from './project-language.ts';
import { createManagedMarkdown, readProjectMarkdown, replaceProjectMarkdown } from './native-cards.ts';
import { parseRunRegistry } from './runs.ts';
import { parseMilestones } from './milestones.ts';
import { invalidPlanning } from './run-model.ts';

const messages = defineText({
  explicitList: (kind: string) => `The ${kind} registry must be an explicit YAML list.`,
  revisionRequired: "The edit needs the registry's current version. Refresh Timeline and try again.",
  frontMatter: "The planning registry needs YAML front matter.",
  invalidYaml: "Invalid planning registry YAML.",
  listEntry: "The registry entry must be an explicit YAML list item.",
  rangeMissing: "The registry entry has no source range.",
  separatorMissing: "Registry entry separator not found.",
  milestoneMissing: "Milestone not found.",
  runMissing: "Run not found.",
  configurationMissing: "Run schedule not found.",
  otherData: "The registry edit would change unrelated data.",
  partSaved: "Milestone deletion was partially saved. Refresh Timeline before continuing; external changes were preserved.",
  cancelled: "Milestone deletion was cancelled; the original files were restored.",
  unknownAction: "Unknown planning action.",
}, {
  explicitList: (kind: string) => `Реестр ${kind} должен быть явным YAML-списком.`,
  revisionRequired: "Для правки нужна актуальная версия реестра. Обновите Timeline и повторите действие.",
  frontMatter: "Реестру планирования нужна YAML-шапка.",
  invalidYaml: "Некорректный YAML реестра планирования.",
  listEntry: "Запись реестра должна быть явным элементом YAML-списка.",
  rangeMissing: "У записи реестра нет исходного диапазона.",
  separatorMissing: "Не найден разделитель записей реестра.",
  milestoneMissing: "Веха не найдена.",
  runMissing: "Run не найден.",
  configurationMissing: "Расписание Run не найдено.",
  otherData: "Правка реестра изменила бы посторонние данные.",
  partSaved: "Удаление Milestone сохранено не полностью. Обновите Timeline перед продолжением; чужие изменения не перезаписаны.",
  cancelled: "Удаление Milestone отменено; исходные файлы восстановлены.",
  unknownAction: "Неизвестное действие планирования.",
});


// Project files of the planning registries (2026-11-04): app data, never ordinary Markdown documents or cards.
export { milestonesPath, runsPath } from '../src/planning-files.ts';

type RegistryKind = 'runs' | 'milestones' | 'configurations';
type PlanningRecord = RunRecord | MilestoneRecord | RunConfiguration;
function missingRecord(kind: RegistryKind): string {
  const text = serverText(messages);
  if (kind === 'runs') return text.runMissing;
  return kind === 'configurations' ? text.configurationMissing : text.milestoneMissing;
}
const digest = (bytes: Buffer | null) => bytes ? createHash('sha256').update(bytes).digest('hex') : '';

// 2026-11-06: a new registry gets its heading in the project's format language; parsers take only the YAML.
// Run keeps its Latin spelling in Russian, as in the interface.
const registryBriefs = {
  milestones: { en: '\n# Milestones\n', ru: '\n# Вехи\n' },
  runs: { en: '\n# Runs\n', ru: '\n# Run\n' },
} as const satisfies Record<'milestones' | 'runs', Record<FormatLanguage, string>>;

export async function readOptionalPlanning(root: string, relative: string): Promise<Buffer | null> {
  try { return await readProjectMarkdown(root, relative); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
const readOptional = readOptionalPlanning;

async function assertRevision(root: string, relative: string, expected: string): Promise<void> {
  if (typeof expected !== 'string' || !/^(?:[0-9a-f]{64})?$/u.test(expected)) throw new Error(serverText(messages).revisionRequired);
  if (digest(await readOptional(root, relative)) !== expected) throw new Error('PLANNING_CONFLICT');
}

function registryMetadata(bytes: Buffer) {
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  const match = /^(?:\uFEFF)?---(\r?\n)([\s\S]*?)^---[ \t]*(?:\r?\n|$)/mu.exec(text);
  if (!match || match.index !== 0) throw new Error(serverText(messages).frontMatter);
  const yaml = match[2];
  const start = text.indexOf('\n') + 1;
  const document = parseDocument(yaml);
  if (document.errors.length || !isMap(document.contents)) throw new Error(serverText(messages).invalidYaml);
  return { text, yaml, start, end: start + yaml.length, newline: match[1], document };
}

function blockItemStart(yaml: string, itemStart: number): number {
  const line = yaml.lastIndexOf('\n', itemStart - 1) + 1;
  if (!/^[ \t]*-[ \t]+/u.test(yaml.slice(line, itemStart + 1))) throw new Error(serverText(messages).listEntry);
  return line;
}

function removeEntry(yaml: string, sequence: YAMLSeq, index: number): string {
  const entry = sequence.items[index];
  if (!isMap(entry) || !entry.range || !sequence.range) throw new Error(serverText(messages).rangeMissing);
  if (sequence.items.length === 1) {
    const [start, end] = sequence.range;
    const ending = yaml.slice(start, end).match(/\r?\n$/u)?.[0] ?? '';
    return yaml.slice(0, start) + '[]' + ending + yaml.slice(end);
  }
  if (sequence.flow) {
    let start = entry.range[0];
    let end = entry.range[1];
    if (index < sequence.items.length - 1) {
      const comma = yaml.indexOf(',', end);
      const next = sequence.items[index + 1];
      if (comma < 0 || !isMap(next) || !next.range || comma >= next.range[0]) throw new Error(serverText(messages).separatorMissing);
      end = comma + 1;
    } else {
      const comma = yaml.lastIndexOf(',', start);
      const previous = sequence.items[index - 1];
      if (!isMap(previous) || !previous.range || comma < previous.range[1]) throw new Error(serverText(messages).separatorMissing);
      start = comma;
    }
    return yaml.slice(0, start) + yaml.slice(end);
  }
  const start = blockItemStart(yaml, entry.range[0]);
  // 2026-11-05: the removed record owns its value span; comments before the next record survive.
  let end = entry.range[1];
  if (yaml.slice(end, end + 2) === '\r\n') end += 2;
  else if (yaml[end] === '\n') end += 1;
  return yaml.slice(0, start) + yaml.slice(end);
}

function patchRegistry(bytes: Buffer, kind: RegistryKind, entry: PlanningRecord | null, removedId?: string, updating = false): Buffer {
  const source = registryMetadata(bytes);
  const sequence = source.document.get(kind, true);
  const metadata = source.document.toJS({ maxAliasCount: 0 }) as Record<string, unknown> & Record<RegistryKind, PlanningRecord[]>;
  if (sequence === undefined && kind === 'configurations' && entry && isMap(source.document.contents) && source.document.contents.range) {
    const position = source.document.contents.range[0] + (source.document.contents.flow ? 1 : 0);
    const inserted = `configurations: ${JSON.stringify([entry])}${source.document.contents.flow ? ', ' : source.newline}`;
    const yaml = source.yaml.slice(0, position) + inserted + source.yaml.slice(position);
    const next = Buffer.from(source.text.slice(0, source.start) + yaml + source.text.slice(source.end));
    if (!isDeepStrictEqual(registryMetadata(next).document.toJS({ maxAliasCount: 0 }), { ...metadata, configurations: [entry] })) throw new Error(serverText(messages).otherData);
    return next;
  }
  if (!isSeq(sequence) || !sequence.range) throw new Error(serverText(messages).explicitList(kind));
  const current = metadata[kind];
  let yaml: string;
  let desired: PlanningRecord[];
  if (entry && updating) {
    const index = current.findIndex(candidate => candidate.id === entry.id);
    const node = sequence.items[index];
    if (index < 0 || !isMap(node) || !node.range) throw new Error(missingRecord(kind));
    const [start, end] = node.range;
    const ending = source.yaml.slice(start, end).match(/\r?\n$/u)?.[0] ?? '';
    yaml = source.yaml.slice(0, start) + JSON.stringify(entry) + ending + source.yaml.slice(end);
    desired = current.map(candidate => candidate.id === entry.id ? entry : candidate);
  } else if (entry) {
    const position = sequence.range[0] + (sequence.flow ? 1 : 0);
    const column = position - (source.yaml.lastIndexOf('\n', position - 1) + 1);
    const inserted = sequence.flow ? JSON.stringify(entry) + (sequence.items.length ? ', ' : '')
      : '- ' + JSON.stringify(entry) + source.newline + ' '.repeat(column);
    yaml = source.yaml.slice(0, position) + inserted + source.yaml.slice(position);
    desired = [entry, ...current];
  } else {
    const index = current.findIndex(candidate => candidate.id === removedId);
    if (index < 0) throw new Error(missingRecord(kind));
    yaml = removeEntry(source.yaml, sequence, index);
    desired = current.filter(candidate => candidate.id !== removedId);
  }
  const next = Buffer.from(source.text.slice(0, source.start) + yaml + source.text.slice(source.end));
  const roundtrip = registryMetadata(next).document.toJS({ maxAliasCount: 0 });
  if (!isDeepStrictEqual(roundtrip, { ...metadata, [kind]: desired })) throw new Error(serverText(messages).otherData);
  return next;
}

async function prepareRegistry(root: string, kind: 'milestones', expectedHash: string, entry: MilestoneRecord | null, removedId?: string, updating = false) {
  const relative = milestonesPath;
  const parse = parseMilestones;
  await assertRevision(root, relative, expectedHash);
  const previousBytes = await readOptional(root, relative);
  if (digest(previousBytes) !== expectedHash) throw new Error('PLANNING_CONFLICT');
  if (previousBytes) parse(previousBytes); // A corrupt registry must never be mistaken for a missing one.
  const metadata = { schema: 1, [kind]: entry ? [entry] : [] };
  const body = previousBytes ? '' : registryBriefs.milestones[await projectLanguage(root)];
  if (!previousBytes && !entry) throw new Error(serverText(messages).milestoneMissing);
  const nextBytes = previousBytes ? patchRegistry(previousBytes, kind, entry, removedId, updating)
    : Buffer.from('---\n' + stringify(metadata, { lineWidth: 0 }) + '---\n' + body);
  parse(nextBytes);
  return { relative, previousBytes, nextBytes, nextHash: digest(nextBytes), async publish(beforePublish?: () => Promise<void>) {
    const verify = async () => { await beforePublish?.(); await assertRevision(root, relative, expectedHash); };
    if (previousBytes) await replaceProjectMarkdown(root, relative, expectedHash, nextBytes, verify);
    else if (!await createManagedMarkdown(root, relative, metadata, body, verify)) throw new Error('PLANNING_CONFLICT');
  } };
}

async function createMilestoneEntry(root: string, expectedHash: string, entry: MilestoneRecord): Promise<void> {
  for (const key of ['configurationId', 'finishedAt', 'statistics', 'history']) if (key in entry) invalidPlanning(key);
  const bytes = await readOptional(root, milestonesPath);
  const existing = bytes ? parseMilestones(bytes) : [];
  const requested = parseMilestones(Buffer.from('---\n' + stringify({ schema: 1, milestones: [entry] }, { lineWidth: 0 }) + '---\n'))[0];
  const matching = existing.find(candidate => candidate.id === requested.id);
  // 2026-11-05: a lost HTTP response may be retried with its original ID and revision.
  if (matching && isDeepStrictEqual(matching, requested)) return;
  await (await prepareRegistry(root, 'milestones', expectedHash, entry)).publish();
}

/** Patch each changed YAML record, leaving all other records and the Markdown body byte-identical. */
export async function prepareRunRegistry(root: string, expectedHash: string, runs: RunRecord[], configurations: RunConfiguration[]) {
  await assertRevision(root, runsPath, expectedHash);
  const previousBytes = await readOptional(root, runsPath);
  if (digest(previousBytes) !== expectedHash) throw new Error('PLANNING_CONFLICT');
  const previous = previousBytes ? parseRunRegistry(previousBytes) : { runs: [], configurations: [] };
  const metadata = { schema: 1, runs, ...(configurations.length ? { configurations } : {}) };
  const body = previousBytes ? '' : registryBriefs.runs[await projectLanguage(root)];
  let nextBytes = previousBytes ?? Buffer.from('---\n' + stringify(metadata, { lineWidth: 0 }) + '---\n' + body);
  if (previousBytes) {
    for (const kind of ['configurations', 'runs'] as const) {
      const desired = kind === 'runs' ? runs : configurations;
      for (const old of previous[kind]) if (!desired.some(entry => entry.id === old.id)) nextBytes = patchRegistry(nextBytes, kind, null, old.id);
      for (const entry of desired) {
        const old = previous[kind].find(candidate => candidate.id === entry.id);
        if (!isDeepStrictEqual(old, entry)) nextBytes = patchRegistry(nextBytes, kind, entry, undefined, Boolean(old));
      }
    }
  }
  parseRunRegistry(nextBytes);
  return { previousBytes, nextBytes, nextHash: digest(nextBytes), changed: !previousBytes?.equals(nextBytes), async publish(beforePublish?: () => Promise<void>) {
    const verify = async () => { await beforePublish?.(); await assertRevision(root, runsPath, expectedHash); };
    if (previousBytes) {
      if (!previousBytes.equals(nextBytes)) await replaceProjectMarkdown(root, runsPath, expectedHash, nextBytes, verify);
      else await verify();
    } else if (!await createManagedMarkdown(root, runsPath, metadata, body, verify)) throw new Error('PLANNING_CONFLICT');
  } };
}

async function updateRegistryEntry(root: string, edit: Extract<PlanningEdit, { action: 'update-run' | 'update-milestone' }>): Promise<void> {
  const isRun = edit.action === 'update-run';
  await assertRevision(root, isRun ? runsPath : milestonesPath, isRun ? edit.runsHash : edit.milestonesHash);
  const bytes = await readOptional(root, isRun ? runsPath : milestonesPath);
  if (!bytes) throw new Error(missingRecord(isRun ? 'runs' : 'milestones'));
  if (isRun) {
    const registry = parseRunRegistry(bytes);
    const previous = registry.runs.find(run => run.id === edit.run.id);
    if (!previous) throw new Error(serverText(messages).runMissing);
    for (const key of ['configurationId', 'finishedAt', 'statistics', 'history'] as const) {
      if (!isDeepStrictEqual(edit.run[key], previous[key])) invalidPlanning(key);
    }
    // Recurring dates are owned by their schedule, not the description editor.
    if ((previous.configurationId || previous.finishedAt) && (edit.run.start !== previous.start || edit.run.end !== previous.end || edit.run.number !== previous.number)) invalidPlanning('scheduled Run dates');
    const runs = registry.runs.map(run => run.id === edit.run.id ? edit.run : run);
    await (await prepareRunRegistry(root, edit.runsHash, runs, registry.configurations)).publish();
  } else {
    const previous = parseMilestones(bytes).find(milestone => milestone.id === edit.milestone.id);
    if (!previous) throw new Error(serverText(messages).milestoneMissing);
    if (!isDeepStrictEqual(edit.milestone.history, previous.history)) invalidPlanning('history');
    await (await prepareRegistry(root, 'milestones', edit.milestonesHash, edit.milestone, undefined, true)).publish();
  }
}

async function pinMilestone(root: string, edit: Extract<PlanningEdit, { action: 'pin-milestone' }>): Promise<void> {
  await assertRevision(root, milestonesPath, edit.milestonesHash);
  if (edit.milestoneId !== null) {
    const bytes = await readOptional(root, milestonesPath);
    if (!bytes || !parseMilestones(bytes).some(milestone => milestone.id === edit.milestoneId)) throw new Error(serverText(messages).milestoneMissing);
  }
  const plan = await preparePinnedMilestone(root, edit.manifestHash, edit.milestoneId);
  await plan.publish(() => assertRevision(root, milestonesPath, edit.milestonesHash));
}

async function deleteMilestone(root: string, edit: Extract<PlanningEdit, { action: 'delete-milestone' }>): Promise<void> {
  const registry = await prepareRegistry(root, 'milestones', edit.milestonesHash, null, edit.milestoneId);
  const manifest = await readManifest(root);
  if (digest(manifest.bytes) !== edit.manifestHash) throw new Error('CATALOG_CONFLICT');
  const pin = await preparePinnedMilestone(root, edit.manifestHash,
    manifest.manifest.pinnedMilestoneId === edit.milestoneId ? null : manifest.manifest.pinnedMilestoneId ?? null);
  const options = await readCardOptions(root);
  if (options.hash !== edit.optionsHash) throw new Error('CARD_OPTIONS_CONFLICT');
  const previousOptions = await readOptional(root, cardOptionsPath);
  if (digest(previousOptions) !== edit.optionsHash) throw new Error('CARD_OPTIONS_CONFLICT');
  const affected = Object.entries(options.options).filter(([, value]) => value.milestone === edit.milestoneId).map(([id]) => id);
  let optionsHash = edit.optionsHash;
  const optionsRevisions = new Set([edit.optionsHash]);
  let manifestHash = edit.manifestHash;
  const verify = async () => {
    await assertRevision(root, milestonesPath, edit.milestonesHash);
    await assertRevision(root, catalogPath, manifestHash);
    await assertRevision(root, cardOptionsPath, optionsHash);
  };
  try {
    // 2026-11-05: include archived, deleted and orphaned option entries, so restoring a card cannot revive a deleted milestone.
    for (let offset = 0; offset < affected.length; offset += 1000) {
      const changes = Object.fromEntries(affected.slice(offset, offset + 1000).map(id => [id, { milestone: null }]));
      const patch = await prepareCardOptionsPatch(root, optionsHash, changes);
      optionsRevisions.add(patch.nextHash);
      await patch.publish(verify);
      optionsHash = patch.nextHash;
    }
    await pin.publish(verify);
    manifestHash = pin.nextHash;
    await registry.publish(verify);
  } catch (error) {
    // Roll back only our exact revisions; external file edits always win over cleanup.
    let restored = false;
    try {
      restored = digest(await readOptional(root, milestonesPath)) === edit.milestonesHash;
      if (restored) {
        const currentManifest = await readOptional(root, catalogPath);
        if (pin.changed && digest(currentManifest) === pin.nextHash && pin.previousBytes) {
          await replaceProjectMarkdown(root, catalogPath, pin.nextHash, pin.previousBytes);
        } else if (digest(currentManifest) !== edit.manifestHash) restored = false;
        const currentOptions = await readOptional(root, cardOptionsPath);
        if (digest(currentOptions) !== edit.optionsHash && previousOptions) {
          const currentHash = digest(currentOptions);
          if (!optionsRevisions.has(currentHash)) restored = false;
          else await replaceProjectMarkdown(root, cardOptionsPath, currentHash, previousOptions);
        }
      }
    } catch { restored = false; }
    if (!restored) throw Object.assign(new Error(serverText(messages).partSaved), { saved: true });
    if (error && typeof error === 'object' && 'saved' in error && error.saved === true) {
      throw new Error(serverText(messages).cancelled);
    }
    throw error;
  }
}

/** 2026-11-05: the caller authorizes writes through CatalogService.recordMutation and shares its queue. */
export async function applyPlanningEdit(root: string, edit: PlanningEdit): Promise<void> {
  if (edit.action === 'create-milestone') await createMilestoneEntry(root, edit.milestonesHash, edit.milestone);
  else if (edit.action === 'pin-milestone') await pinMilestone(root, edit);
  else if (edit.action === 'delete-milestone') await deleteMilestone(root, edit);
  else if (edit.action === 'update-run' || edit.action === 'update-milestone') await updateRegistryEntry(root, edit);
  else if (['save-run-configuration', 'finish-run', 'delete-run', 'resume-runs'].includes(edit.action)) {
    const { applyRunLifecycleEdit } = await import('./run-lifecycle.ts');
    await applyRunLifecycleEdit(root, edit as Extract<PlanningEdit, { action: 'save-run-configuration' | 'finish-run' | 'delete-run' | 'resume-runs' }>);
  }
  else throw new Error(serverText(messages).unknownAction);
}
