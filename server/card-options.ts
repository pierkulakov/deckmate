import { defineText, serverText } from './i18n.ts';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { isMap, isScalar, isSeq, parseDocument, stringify, type Node, type YAMLMap } from 'yaml';
import type { CardOptions } from '../src/bulk-contracts.ts';
import type { FormatLanguage } from '../src/format-vocabulary.ts';
import { projectLanguage } from './project-language.ts';
import { createManagedMarkdown, readProjectMarkdown, replaceProjectMarkdown } from './native-cards.ts';
import { isPlainRecord, parseYamlFrontMatter } from './yaml-front-matter.ts';
import type { CatalogCard, CatalogMember } from '../src/catalog-contracts.ts';
import { memberIdForOwner } from '../src/members.ts';

const messages = defineText({
  invalidOptionsId: "Invalid card ID in Card Options.",
  invalidOptionsUuid: "Invalid card UUID in Card Options.",
  optionsObjectRequired: "Card Options must be an object.",
  invalidOptionsField: "Invalid Card Options field: ",
  booleanRequired: ": a boolean is required.",
  uniqueListRequired: ": a unique list of up to 100 short strings is required.",
  invalidDueDate: "dueDate: a valid YYYY-MM-DD date is required.",
  invalidDoneAt: "doneAt: a valid YYYY-MM-DD date is required.",
  invalidHandOrder: "handOrder: map each member to a slot number (integer 0–100000).",
  invalidKindOverride: "kindOverride accepts task/doc/hero for legacy cards only.",
  boundedStringRequired: ": a string of 1–200 characters is required.",
  optionsHeaderMissing: "Card Options has no YAML frontmatter.",
  invalidOptionsYaml: "Invalid Card Options YAML.",
  optionsAliasesUnsupported: "Card Options does not support YAML aliases.",
  invalidOptionsSchema: "Card Options requires schema: 1 and a cards map (up to 100000 cards).",
  optionsMapRangeMissing: "The Card Options map has no source range.",
  optionsExplicitValueRequired: "A Card Options field must have an explicit value.",
  optionsStringsRequired: "A Card Options list must contain strings.",
  optionsCardsMapRequired: "Card Options cards must be an explicit map.",
  optionsCardMapRequired: "A card's Card Options must be an explicit map.",
  invalidOptionsValue: "Invalid Card Options value.",
  optionsHashRequired: "Editing card options needs their current version. Refresh the catalog and try again.",
  tooManyOptionsChanges: "Card Options accepts up to 1000 changes at a time.",
  optionsChangesData: "The Card Options edit would change unrelated data.",
}, {
  invalidOptionsId: "Некорректный ID карточки в Card Options.",
  invalidOptionsUuid: "Некорректный UUID карточки в Card Options.",
  optionsObjectRequired: "Card Options должны быть объектом.",
  invalidOptionsField: "Недопустимое поле Card Options: ",
  booleanRequired: ": требуется boolean.",
  uniqueListRequired: ": требуется уникальный список до 100 коротких строк.",
  invalidDueDate: "dueDate: требуется настоящая дата YYYY-MM-DD.",
  invalidDoneAt: "doneAt: требуется настоящая дата YYYY-MM-DD.",
  invalidHandOrder: "handOrder: требуется карта участник → номер слота (целое 0–100000).",
  invalidKindOverride: "kindOverride допускает task/doc/hero только для legacy-карточек.",
  boundedStringRequired: ": требуется строка длиной 1–200.",
  optionsHeaderMissing: "В Card Options отсутствует YAML-шапка.",
  invalidOptionsYaml: "Некорректный YAML Card Options.",
  optionsAliasesUnsupported: "Card Options не поддерживает YAML aliases.",
  invalidOptionsSchema: "Card Options требует schema: 1 и cards map (до 100000 карточек).",
  optionsMapRangeMissing: "Card Options map не имеет исходного диапазона.",
  optionsExplicitValueRequired: "Поле Card Options должно быть явным значением.",
  optionsStringsRequired: "Список Card Options должен содержать строки.",
  optionsCardsMapRequired: "Card Options cards должен быть явным map.",
  optionsCardMapRequired: "Card Options карточки должен быть явным map.",
  invalidOptionsValue: "Некорректное значение Card Options.",
  optionsHashRequired: "Для правки опций нужна их актуальная версия. Обновите каталог и повторите действие.",
  tooManyOptionsChanges: "Card Options принимает до 1000 изменений за раз.",
  optionsChangesData: "Правка Card Options изменила бы посторонние данные.",
});


export const cardOptionsPath = 'tasks/deckmate-card-options.md';
export const maximumCardOptionsChanges = 1000;
export type CardOptionsPatch = { [Key in keyof CardOptions]?: CardOptions[Key] | null };
export interface CardOptionsSource { hash: string; options: Record<string, CardOptions> }
export interface CardOptionsPlan {
  changed: boolean;
  nextHash: string;
  publish(beforePublish?: () => Promise<void>): Promise<void>;
}

const fields = new Set(['handMemberIds', 'bookmarked', 'tags', 'run', 'milestone', 'dueDate', 'archived', 'deleted', 'kindOverride', 'handOrder', 'doneAt', 'previousOwnerIds']);
const flags = new Set(['bookmarked', 'archived', 'deleted']);
const lists = new Set(['handMemberIds', 'tags', 'previousOwnerIds']);
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
// 2026-11-06: a new registry gets its header in the project's format language; field names are identifiers and never
// translate. Readers take only the YAML, so the header text never affects parsing.
const registryBriefs = {
  en: '# Card options\n\nProject-local planning metadata for native and legacy cards.\n'
    + 'The YAML cards map is keyed by the canonical card ID; omitted values, null, false and [] mean no option.\n'
    + 'handMemberIds assigns cards to hands; bookmarked, tags, run, milestone and dueDate describe planning.\n'
    + 'handOrder keeps the card slot per member hand (2026-11-04); doneAt is the acceptance date written by state changes.\n'
    + 'archived and deleted hide cards without deleting source Markdown. kindOverride applies only to legacy cards.\n'
    + 'Agents: read the selected card entry and its source Markdown; SQLite is only a rebuildable index.\n',
  ru: '# Параметры карточек\n\nЛокальные метаданные планирования проекта для собственных карточек Deckmate и legacy-карточек.\n'
    + 'В YAML-карте cards ключ — канонический ID карточки; пропущенное значение, null, false и [] означают, что параметра нет.\n'
    + 'handMemberIds кладёт карточки в Hand участников; bookmarked, tags, run, milestone и dueDate описывают планирование.\n'
    + 'handOrder хранит место карточки в Hand каждого участника (2026-11-04); doneAt — дата приёмки, её записывает смена статуса.\n'
    + 'archived и deleted скрывают карточки, не удаляя исходный Markdown. kindOverride действует только на legacy-карточки.\n'
    + 'Агентам: читайте запись нужной карточки и её исходный Markdown; SQLite — только перестраиваемый индекс.\n',
} as const satisfies Record<FormatLanguage, string>;

export function boundedText(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= limit
    && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value);
}

function validateId(id: string): void {
  if (!boundedText(id, 1000) || !/^(card|task|hero|doc):\S/u.test(id)) throw new Error(serverText(messages).invalidOptionsId);
  if (id.startsWith('card:') && !/^card:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(id)) {
    throw new Error(serverText(messages).invalidOptionsUuid);
  }
}

export function validDate(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

/** 2026-11-03: cleared values stay representable in YAML, but are absent from the projection. */
function validateOptions(value: unknown, cardId: string): CardOptions {
  if (!isPlainRecord(value)) throw new Error(serverText(messages).optionsObjectRequired);
  const result: Record<string, unknown> = {};
  for (const [key, option] of Object.entries(value)) {
    if (!fields.has(key)) throw new Error(serverText(messages).invalidOptionsField + key);
    if (option === null) continue;
    if (flags.has(key)) {
      if (typeof option !== 'boolean') throw new Error(key + serverText(messages).booleanRequired);
      if (option) result[key] = true;
    } else if (lists.has(key)) {
      const limit = key === 'tags' ? 80 : 200;
      if (!Array.isArray(option) || option.length > 100 || option.some(item => !boundedText(item, limit)) || new Set(option).size !== option.length) {
        throw new Error(key + serverText(messages).uniqueListRequired);
      }
      if (option.length) result[key] = [...option];
    } else if (key === 'dueDate') {
      if (!validDate(option)) throw new Error(serverText(messages).invalidDueDate);
      result[key] = option;
    } else if (key === 'doneAt') {
      // 2026-11-04: state changes set the acceptance date used by the done pile and auto-archiving.
      if (!validDate(option)) throw new Error(serverText(messages).invalidDoneAt);
      result[key] = option;
    } else if (key === 'handOrder') {
      // 2026-11-04: map each member to the card's hand slot; omit empty maps.
      if (!isPlainRecord(option) || Object.keys(option).length > 200 || Object.entries(option).some(([memberId, slot]) =>
        !boundedText(memberId, 80) || typeof slot !== 'number' || !Number.isInteger(slot) || slot < 0 || slot > 100000)) {
        throw new Error(serverText(messages).invalidHandOrder);
      }
      if (Object.keys(option).length) result[key] = { ...option };
    } else if (key === 'kindOverride') {
      if (cardId.startsWith('card:') || typeof option !== 'string' || !['task', 'doc', 'hero'].includes(option)) throw new Error(serverText(messages).invalidKindOverride);
      result[key] = option;
    } else {
      if (!boundedText(option, 200)) throw new Error(key + serverText(messages).boundedStringRequired);
      result[key] = option;
    }
  }
  return result as CardOptions;
}

interface ParsedOptions extends CardOptionsSource {
  text: string;
  yaml: string;
  yamlStart: number;
  yamlEnd: number;
  newline: string;
  metadata: Record<string, unknown> & { schema: 1; cards: Record<string, Record<string, unknown>> };
}

function parseOptions(bytes: Buffer): ParsedOptions {
  const { text, yaml, yamlStart, yamlEnd, newline, document } = parseYamlFrontMatter(bytes, {
    headerError: serverText(messages).optionsHeaderMissing, yamlError: serverText(messages).invalidOptionsYaml,
    aliases: 'reject', aliasError: serverText(messages).optionsAliasesUnsupported,
  });
  const metadata: unknown = document.toJS({ maxAliasCount: 0 });
  if (!isPlainRecord(metadata) || metadata.schema !== 1 || !isPlainRecord(metadata.cards) || Object.keys(metadata.cards).length > 100000) {
    throw new Error(serverText(messages).invalidOptionsSchema);
  }
  const options: Record<string, CardOptions> = {};
  for (const [id, value] of Object.entries(metadata.cards)) {
    validateId(id);
    const normalized = validateOptions(value, id);
    if (Object.keys(normalized).length) options[id] = normalized;
  }
  return { hash: digest(bytes), options, text, yaml, yamlStart, yamlEnd,
    newline, metadata: metadata as ParsedOptions['metadata'] };
}

async function readBytes(root: string): Promise<Buffer | null> {
  try { return await readProjectMarkdown(root, cardOptionsPath); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}

export async function readCardOptions(root: string): Promise<CardOptionsSource> {
  const bytes = await readBytes(root);
  if (!bytes) return { hash: '', options: {} };
  const { hash, options } = parseOptions(bytes);
  return { hash, options };
}

export function previousOwnerPatch(card: CatalogCard, members: CatalogMember[], nextOwner: string | null): Pick<CardOptions, 'previousOwnerIds'> | null {
  if (card.owner === nextOwner) return null;
  const ownerId = memberIdForOwner(card.owner, members) ?? members.find(member => member.id === card.owner)?.id;
  if (!ownerId || card.previousOwnerIds?.includes(ownerId)) return null;
  return { previousOwnerIds: [...card.previousOwnerIds ?? [], ownerId] };
}

function insertEntry(yaml: string, map: YAMLMap, key: string, value: unknown, newline: string): string {
  if (!map.range) throw new Error(serverText(messages).optionsMapRangeMissing);
  const entry = JSON.stringify(key) + ': ' + JSON.stringify(value);
  const position = map.range[0] + (map.flow ? 1 : 0);
  const column = position - (yaml.lastIndexOf('\n', position - 1) + 1);
  const inserted = map.flow ? entry + (map.items.length ? ', ' : '') : entry + newline + ' '.repeat(column);
  return yaml.slice(0, position) + inserted + yaml.slice(position);
}

interface CommentToken { offset: number; source: string }
export function sourceComments(token: unknown, found: CommentToken[] = []): CommentToken[] {
  if (!token || typeof token !== 'object') return found;
  if ('type' in token && token.type === 'comment' && 'offset' in token && typeof token.offset === 'number' && 'source' in token && typeof token.source === 'string') {
    found.push({ offset: token.offset, source: token.source });
  } else for (const child of Object.values(token)) {
    if (Array.isArray(child)) child.forEach(item => sourceComments(item, found));
    else if (child && typeof child === 'object') sourceComments(child, found);
  }
  return found;
}

function replaceValue(yaml: string, node: Node, value: unknown, newline: string): string {
  if (!node.range || (!isScalar(node) && !isSeq(node) && !isMap(node))) throw new Error(serverText(messages).optionsExplicitValueRequired);
  if (isMap(node)) {
    // 2026-11-04: replace handOrder as one value to update all members' slots together.
    const [start, end] = node.range;
    const trailing = yaml.slice(start, end).match(/\r?\n$/u)?.[0] ?? '';
    return yaml.slice(0, start) + JSON.stringify(value) + trailing + yaml.slice(end);
  }
  if (isSeq(node) && Array.isArray(value) && node.items.length === value.length) {
    // Preserve sequence layout and every comment when only its scalar values change.
    let updated = yaml;
    for (let index = node.items.length - 1; index >= 0; index--) {
      const item = node.items[index];
      if (!isScalar(item) || !item.range) throw new Error(serverText(messages).optionsStringsRequired);
      if (item.value !== value[index]) updated = updated.slice(0, item.range[0]) + JSON.stringify(value[index]) + updated.slice(item.range[1]);
    }
    return updated;
  }
  const [start, end] = node.range;
  const column = start - (yaml.lastIndexOf('\n', start - 1) + 1);
  const comments = sourceComments(node.srcToken).filter(comment => comment.offset >= start && comment.offset < end).sort((first, second) => first.offset - second.offset);
  let inserted = (start === end && yaml[start - 1] === ':' ? ' ' : '') + JSON.stringify(value);
  if (start === end && yaml[end] === '#') inserted += ' ';
  if (comments.length) inserted += newline + comments.map(comment => ' '.repeat(column) + comment.source).join(newline);
  if (/\r?\n$/u.test(yaml.slice(start, end))) inserted += newline;
  else if (comments.length) inserted += newline + ' '.repeat(column);
  return yaml.slice(0, start) + inserted + yaml.slice(end);
}

function patchField(yaml: string, id: string, key: string, value: unknown, newline: string): string {
  const document = parseDocument(yaml, { keepSourceTokens: true });
  const cards = document.get('cards', true);
  if (document.errors.length || !isMap(cards)) throw new Error(serverText(messages).optionsCardsMapRequired);
  const entry = cards.get(id, true);
  if (entry === undefined) return insertEntry(yaml, cards, id, { [key]: value }, newline);
  if (!isMap(entry)) throw new Error(serverText(messages).optionsCardMapRequired);
  if (!entry.has(key)) return insertEntry(yaml, entry, key, value, newline);
  const current = entry.get(key, true);
  if (!isScalar(current) && !isSeq(current) && !isMap(current)) throw new Error(serverText(messages).invalidOptionsValue);
  return replaceValue(yaml, current, value, newline);
}

/** 2026-11-03: prepare has no writes; each publication rechecks the full-file revision. */
export async function prepareCardOptionsPatch(root: string, expectedHash: string, changes: Record<string, CardOptionsPatch>): Promise<CardOptionsPlan> {
  if (typeof expectedHash !== 'string' || (expectedHash !== '' && !/^[0-9a-f]{64}$/u.test(expectedHash))) throw new Error(serverText(messages).optionsHashRequired);
  if (!isPlainRecord(changes) || Object.keys(changes).length > maximumCardOptionsChanges) throw new Error(serverText(messages).tooManyOptionsChanges);
  for (const [id, patch] of Object.entries(changes)) { validateId(id); validateOptions(patch, id); }
  const previousBytes = await readBytes(root);
  const previousHash = previousBytes ? digest(previousBytes) : '';
  if (previousHash !== expectedHash) throw new Error('CARD_OPTIONS_CONFLICT');
  const source = previousBytes ? parseOptions(previousBytes) : null;
  const metadata = structuredClone(source?.metadata ?? { schema: 1 as const, cards: {} as Record<string, Record<string, unknown>> });
  let yaml = source?.yaml ?? '';
  let changed = false;
  for (const [id, patch] of Object.entries(changes)) {
    const normalized = validateOptions(patch, id) as Record<string, unknown>;
    const previous = source?.options[id] as Record<string, unknown> | undefined;
    for (const key of Object.keys(patch)) {
      if (isDeepStrictEqual(previous?.[key], normalized[key])) continue;
      const value = normalized[key] ?? (flags.has(key) ? false : lists.has(key) ? [] : null);
      metadata.cards[id] ??= {};
      metadata.cards[id][key] = value;
      if (source) yaml = patchField(yaml, id, key, value, source.newline);
      changed = true;
    }
  }
  // Read once: nextHash must describe the very bytes that publish creates.
  const brief = changed && !source ? registryBriefs[await projectLanguage(root)] : '';
  const nextBytes = changed ? Buffer.from(source
    ? source.text.slice(0, source.yamlStart) + yaml + source.text.slice(source.yamlEnd)
    : '---\n' + stringify(metadata, { lineWidth: 0 }) + '---\n' + brief) : previousBytes;
  if (changed && (!nextBytes || !isDeepStrictEqual(parseOptions(nextBytes).metadata, metadata))) throw new Error(serverText(messages).optionsChangesData);
  const nextHash = nextBytes ? digest(nextBytes) : '';
  async function assertFresh() {
    const bytes = await readBytes(root);
    if ((bytes ? digest(bytes) : '') !== expectedHash) throw new Error('CARD_OPTIONS_CONFLICT');
  }
  return { changed, nextHash, async publish(beforePublish) {
    await assertFresh();
    const guard = async () => { await beforePublish?.(); await assertFresh(); };
    if (!changed) { await guard(); return; }
    if (previousBytes) await replaceProjectMarkdown(root, cardOptionsPath, expectedHash, nextBytes!, guard);
    else if (!await createManagedMarkdown(root, cardOptionsPath, metadata, brief, guard)) throw new Error('CARD_OPTIONS_CONFLICT');
  } };
}
