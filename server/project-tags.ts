import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { isAlias, isMap, isScalar, parseDocument, stringify, visit, type YAMLMap } from 'yaml';
import { sanitizeTagSvg, validateProjectTag, type ProjectTag } from '../src/project-tags.ts';
import type { FormatLanguage } from '../src/format-vocabulary.ts';
import { createManagedMarkdown, readProjectMarkdown, replaceProjectMarkdown } from './native-cards.ts';
import { projectLanguage } from './project-language.ts';
import { defineText, serverText, serverLang } from './i18n.ts';

const tagText = defineText({
  sizeLimit: "The tag registry is larger than 4 MB.",
  yamlHeader: "The tag registry needs a YAML header.",
  invalidYaml: "Invalid tag registry YAML.",
  noAliases: "The tag registry does not support YAML aliases.",
  schema: "The registry needs schema: 1 and a tags map with up to 1000 tags.",
  properties: "Invalid tag properties.",
  yamlRange: "The tag YAML range is missing.",
  tagsMap: "tags must be an explicit YAML map.",
  propertiesMap: "Tag properties must be a YAML map.",
  propertyScalar: "A tag property must be a scalar.",
  currentHash: "Editing tags needs the registry's current version. Refresh the catalog and try again.",
  unrelatedTags: "The tag edit would change unrelated tags.",
}, {
  sizeLimit: "Реестр тегов больше 4 МБ.",
  yamlHeader: "Реестру тегов нужна YAML-шапка.",
  invalidYaml: "Некорректный YAML реестра тегов.",
  noAliases: "Реестр тегов не поддерживает YAML aliases.",
  schema: "Нужен реестр schema: 1 и tags map до 1000 тегов.",
  properties: "Некорректные свойства тега.",
  yamlRange: "Отсутствует диапазон YAML тега.",
  tagsMap: "tags должен быть явным YAML map.",
  propertiesMap: "Свойства тега должны быть YAML map.",
  propertyScalar: "Свойство тега должно быть скаляром.",
  currentHash: "Для правки тегов нужна актуальная версия реестра. Обновите каталог и повторите действие.",
  unrelatedTags: "Правка тегов изменила бы посторонние теги.",
});


export const projectTagsPath = 'tasks/deckmate-tags.md';
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
// 2026-11-06: a new registry gets its header in the project's format language; tag and field names never translate.
// Readers take only the YAML, so the header text never affects parsing.
const registryBriefs = {
  en: '# Project tags\n\nTag names are exact card.tags strings. Color, emoji and SVG describe appearance only.\n'
    + 'Assignments remain in deckmate-card-options.md; editing this registry never renames them.\n',
  ru: '# Теги проекта\n\nИмена тегов — точные строки card.tags. Цвет, эмодзи и SVG задают только внешний вид.\n'
    + 'Назначения остаются в deckmate-card-options.md; правка этого реестра их не переименовывает.\n',
} as const satisfies Record<FormatLanguage, string>;
function record(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }

function parseTags(bytes: Buffer) {
  if (bytes.length > 4 * 1024 * 1024) throw new Error(serverText(tagText).sizeLimit);
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  const match = /^(?:\uFEFF)?---(\r?\n)([\s\S]*?)^---[ \t]*(?:\r?\n|$)/mu.exec(text);
  if (!match || match.index !== 0) throw new Error(serverText(tagText).yamlHeader);
  const document = parseDocument(match[2]);
  if (document.errors.length || !isMap(document.contents)) throw new Error(serverText(tagText).invalidYaml);
  visit(document, (_key, node) => { if (isAlias(node)) throw new Error(serverText(tagText).noAliases); });
  const metadata: unknown = document.toJS({ maxAliasCount: 0 });
  if (!record(metadata) || metadata.schema !== 1 || !record(metadata.tags) || Object.keys(metadata.tags).length > 1000) throw new Error(serverText(tagText).schema);
  const tags = Object.entries(metadata.tags).map(([name, properties]) => {
    if (!record(properties) || Object.keys(properties).some(key => !['color', 'emoji', 'iconSvg', 'cardId'].includes(key))) throw new Error(serverText(tagText).properties);
    return validateProjectTag({ name, ...properties }, serverLang());
  });
  const yamlStart = text.indexOf('\n') + 1;
  return { tags, text, yaml: match[2], yamlStart, yamlEnd: yamlStart + match[2].length, newline: match[1] };
}
async function readBytes(root: string) {
  try { return await readProjectMarkdown(root, projectTagsPath); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
export async function readProjectTags(root: string): Promise<{ hash: string; tags: ProjectTag[] }> {
  const bytes = await readBytes(root);
  return bytes ? { hash: digest(bytes), tags: parseTags(bytes).tags } : { hash: '', tags: [] };
}
function insertField(yaml: string, map: YAMLMap, name: string, value: unknown, newline: string) {
  if (!map.range) throw new Error(serverText(tagText).yamlRange);
  const position = map.range[0] + (map.flow ? 1 : 0);
  const column = position - (yaml.lastIndexOf('\n', position - 1) + 1);
  const entry = JSON.stringify(name) + ': ' + JSON.stringify(value);
  return yaml.slice(0, position) + entry + (map.flow ? (map.items.length ? ', ' : '') : newline + ' '.repeat(column)) + yaml.slice(position);
}
function patchTag(yaml: string, tag: ProjectTag, newline: string) {
  for (const [key, value] of Object.entries({ color: tag.color, emoji: tag.emoji ?? null, iconSvg: tag.iconSvg ?? null, cardId: tag.cardId ?? null })) {
    const document = parseDocument(yaml);
    const tags = document.get('tags', true);
    if (!isMap(tags)) throw new Error(serverText(tagText).tagsMap);
    const entry = tags.get(tag.name, true);
    if (!entry) return insertField(yaml, tags, tag.name, { color: tag.color, ...(tag.emoji ? { emoji: tag.emoji } : {}), ...(tag.iconSvg ? { iconSvg: tag.iconSvg } : {}), ...(tag.cardId ? { cardId: tag.cardId } : {}) }, newline);
    if (!isMap(entry)) throw new Error(serverText(tagText).propertiesMap);
    if (!entry.has(key)) { if (value !== null) yaml = insertField(yaml, entry, key, value, newline); continue; }
    const field = entry.get(key, true);
    if (!isScalar(field) || !field.range) throw new Error(serverText(tagText).propertyScalar);
    if (field.value === value) continue;
    // 2026-11-04: appearance edits preserve hand-authored SVG bytes when its canonical value is unchanged.
    if (key === 'iconSvg' && typeof field.value === 'string' && sanitizeTagSvg(field.value, serverLang()) === value) continue;
    const [start, end] = field.range;
    const suffix = /\r?\n$/u.test(yaml.slice(start, end)) ? newline : '';
    yaml = yaml.slice(0, start) + JSON.stringify(value) + suffix + yaml.slice(end);
  }
  return yaml;
}

export async function prepareProjectTag(root: string, expectedHash: string, value: unknown) {
  if (typeof expectedHash !== 'string' || !/^(?:[0-9a-f]{64})?$/u.test(expectedHash)) throw new Error(serverText(tagText).currentHash);
  const tag = validateProjectTag(value, serverLang());
  const before = await readBytes(root);
  if ((before ? digest(before) : '') !== expectedHash) throw new Error('PROJECT_TAGS_CONFLICT');
  const source = before ? parseTags(before) : null;
  const existing = source?.tags.find(item => item.name === tag.name);
  const changed = !isDeepStrictEqual(existing, tag);
  const metadata = { schema: 1, tags: { [tag.name]: { color: tag.color, ...(tag.emoji ? { emoji: tag.emoji } : {}), ...(tag.iconSvg ? { iconSvg: tag.iconSvg } : {}), ...(tag.cardId ? { cardId: tag.cardId } : {}) } } };
  // Read once: nextHash must describe the very bytes that publish creates.
  const brief = changed && !source ? registryBriefs[await projectLanguage(root)] : '';
  const next = !changed ? before! : Buffer.from(source
    ? source.text.slice(0, source.yamlStart) + patchTag(source.yaml, tag, source.newline) + source.text.slice(source.yamlEnd)
    : '---\n' + stringify(metadata, { lineWidth: 0 }) + '---\n' + brief);
  if (changed) {
    const expected = [...source?.tags.filter(item => item.name !== tag.name) ?? [], tag].sort((left, right) => left.name.localeCompare(right.name));
    const parsed = parseTags(next).tags.sort((left, right) => left.name.localeCompare(right.name));
    if (!isDeepStrictEqual(parsed, expected)) throw new Error(serverText(tagText).unrelatedTags);
  }
  async function assertFresh() { const bytes = await readBytes(root); if ((bytes ? digest(bytes) : '') !== expectedHash) throw new Error('PROJECT_TAGS_CONFLICT'); }
  return { changed, nextHash: digest(next), async publish(beforePublish?: () => Promise<void>) {
    const guard = async () => { await beforePublish?.(); await assertFresh(); };
    await guard();
    if (!changed) return;
    if (before) await replaceProjectMarkdown(root, projectTagsPath, expectedHash, next, guard);
    else if (!await createManagedMarkdown(root, projectTagsPath, metadata, brief, guard)) throw new Error('PROJECT_TAGS_CONFLICT');
  } };
}
