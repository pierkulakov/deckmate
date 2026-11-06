import { createHash } from 'node:crypto';
import { isAlias, isMap, parseDocument, visit } from 'yaml';
import type { MilestoneRecord } from '../src/catalog-contracts.ts';
import { validDate } from './card-options.ts';
import { readProjectMarkdown } from './native-cards.ts';
import { milestonesPath } from '../src/planning-files.ts';
import { defineText, serverText } from './i18n.ts';
import { invalidPlanning, validatePlanningDetails } from './run-model.ts';

/** 2026-11-04: Milestones record key project dates in one registry, like Card Options. */

const milestoneText = defineText({
  sizeLimit: "The Milestone registry is larger than 1 MB.",
  yamlHeader: "The Milestone registry needs a YAML header.",
  invalidYaml: "Invalid Milestone registry YAML.",
  noAliases: "The Milestone registry does not support YAML aliases.",
  schema: "The registry needs schema: 1 and a milestones list with up to 1000 entries.",
  fields: "Milestone fields: id, title, date, color, projectSpecific?, description?, cover?, history?.",
  identifier: "Duplicate or invalid Milestone ID.",
  title: (value: Record<string, unknown>) => `Milestone title must be a string of up to 120 characters: ${value.id}`,
  date: (value: Record<string, unknown>) => `Milestone date must be a valid YYYY-MM-DD date: ${value.id}`,
  color: (value: Record<string, unknown>) => `Milestone color must be a hex color: ${value.id}`,
}, {
  sizeLimit: "Реестр Milestone больше 1 МБ.",
  yamlHeader: "Реестру Milestone нужна YAML-шапка.",
  invalidYaml: "Некорректный YAML реестра Milestone.",
  noAliases: "Реестр Milestone не поддерживает YAML aliases.",
  schema: "Нужен реестр schema: 1 и список milestones до 1000 записей.",
  fields: "Поля Milestone: id, title, date, color, projectSpecific?, description?, cover?, history?.",
  identifier: "Повтор или некорректный ID Milestone.",
  title: (value: Record<string, unknown>) => `Название Milestone — строка до 120 символов: ${value.id}`,
  date: (value: Record<string, unknown>) => `date Milestone — настоящая дата YYYY-MM-DD: ${value.id}`,
  color: (value: Record<string, unknown>) => `color Milestone — hex-цвет: ${value.id}`,
});

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

export interface MilestonesSource { hash: string; milestones: MilestoneRecord[]; warnings: string[] }

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

export function parseMilestones(bytes: Buffer): MilestoneRecord[] {
  if (bytes.length > 1024 * 1024) throw new Error(serverText(milestoneText).sizeLimit);
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  const match = /^(?:\uFEFF)?---(\r?\n)([\s\S]*?)^---[ \t]*(?:\r?\n|$)/mu.exec(text);
  if (!match || match.index !== 0) throw new Error(serverText(milestoneText).yamlHeader);
  const document = parseDocument(match[2]);
  if (document.errors.length || !isMap(document.contents)) throw new Error(serverText(milestoneText).invalidYaml);
  visit(document, (_key, node) => { if (isAlias(node)) throw new Error(serverText(milestoneText).noAliases); });
  const metadata: unknown = document.toJS({ maxAliasCount: 0 });
  if (!record(metadata) || metadata.schema !== 1 || !Array.isArray(metadata.milestones) || metadata.milestones.length > 1000) {
    throw new Error(serverText(milestoneText).schema);
  }
  const identifiers = new Set<string>();
  const milestones = metadata.milestones.map((value: unknown) => {
    if (!record(value) || Object.keys(value).some(key => !['id', 'title', 'date', 'color', 'projectSpecific', 'description', 'cover', 'history'].includes(key))) {
      throw new Error(serverText(milestoneText).fields);
    }
    if (typeof value.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/u.test(value.id) || identifiers.has(value.id)) throw new Error(serverText(milestoneText).identifier);
    identifiers.add(value.id);
    if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 120) throw new Error(serverText(milestoneText).title(value));
    if (typeof value.date !== 'string' || !validDate(value.date)) throw new Error(serverText(milestoneText).date(value));
    if (typeof value.color !== 'string' || !/^#[\da-f]{6}$/iu.test(value.color)) throw new Error(serverText(milestoneText).color(value));
    if (value.projectSpecific !== undefined && typeof value.projectSpecific !== 'boolean') invalidPlanning('projectSpecific');
    validatePlanningDetails(value);
    return { id: value.id, title: value.title.trim(), date: value.date, color: value.color.toLowerCase(),
      ...(value.projectSpecific ? { projectSpecific: true } : {}),
      ...(value.description !== undefined ? { description: value.description as string } : {}),
      ...(value.cover !== undefined ? { cover: value.cover as string } : {}),
      ...(value.history !== undefined ? { history: value.history as MilestoneRecord['history'] } : {}) } satisfies MilestoneRecord;
  });
  return milestones.sort((first, second) => first.date === second.date ? first.id.localeCompare(second.id) : first.date < second.date ? -1 : 1);
}

/** Invalid registries produce warnings; the catalog remains usable with the other data. */
export async function readMilestones(root: string): Promise<MilestonesSource> {
  let bytes: Buffer;
  try { bytes = await readProjectMarkdown(root, milestonesPath); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { hash: '', milestones: [], warnings: [] };
    throw error;
  }
  try {
    return { hash: digest(bytes), milestones: parseMilestones(bytes), warnings: [] };
  } catch (error) {
    return { hash: '', milestones: [], warnings: [`${milestonesPath}: ${error instanceof Error ? error.message : String(error)}`] };
  }
}
