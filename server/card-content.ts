import { defineText, serverLang, serverText } from './i18n.ts';
import { createHash } from 'node:crypto';
import { isMechanicPath, parseDocument } from '../src/markdown.ts';
import { markdownParser } from '../src/markdown-model.ts';
import type { ByteRange, ParsedDocument } from '../src/contracts.ts';
import type { CardContent, CatalogEdit } from '../src/catalog-contracts.ts';
import { editNativeCardContent, nativeCardPath, readNativeCard, readProjectMarkdown, replaceProjectMarkdown } from './native-cards.ts';
import { canonicalDataPath } from '../src/brand-compat.ts';
import { cardStateMarkWords } from '../src/format-vocabulary.ts';

const messages = defineText({
  catalogProtected: 'The workspace catalog (tasks/deckmate.md) is managed through Deck and Track settings, not the text editor.',
  iterationBoardProtected: 'Tools/board.py rebuilds the iteration board (tasks/iteration-board.md) from slices; edit the slices in mechanic files.',
  journeyDocumentProtected: 'Journey templates (tasks/journeys/…) contain workflow metadata; edit them through the Journey.',
  duplicateHero: (filename: string, number: string) => `Duplicate Hero number ${filename}#${number}`,
  titleTooLong: (limit: number) => `The title must be a string of up to ${limit} characters.`,
  bodyTooLong: (limit: number) => `Card text must be a string of up to ${limit} characters.`,
  mechanicParseFailed: (reason: string) => `Could not parse the mechanic file: ${reason}`,
  documentParseFailed: (reason: string) => `Could not parse the document: ${reason}`,
  editParseFailed: (reason: string) => `This edit breaks mechanic parsing: ${reason}`,
  emptyTitle: "The title cannot be empty.",
  multilineTitle: "The title must be a single line.",
  unknownCardAddress: "Unknown card address.",
  heroMechanicOnly: "Heroes belong in mechanic files only.",
  taskMechanicOnly: "Slices belong in mechanic files only.",
  multilineDocumentHeading: "Edit a multiline document heading in the page editor.",
  cardNotFound: "Card not found.",
  cardFileNotFound: "Card file not found.",
  heroNotFound: "Hero not found in the mechanic file.",
  sliceNotFoundInFile: "Slice not found in the mechanic file.",
  titleContainsState: "The slice title must not contain a state marker in parentheses.",
  structureChanged: "This edit changes slice numbers, states or parents. Add cards separately instead of editing the structure here.",
  emptyReport: "The report must contain text.",
  reportHeadings: "Legacy report headings must use #### or deeper so the report stays inside the card.",
  reportBoundary: "The report would change the card boundary or existing bytes. Check headings, code fences and line endings.",
}, {
  catalogProtected: 'Каталог рабочих пространств (tasks/deckmate.md) управляется настройками колод и треков, а не текстовым редактором.',
  iterationBoardProtected: 'Доска итераций (tasks/iteration-board.md) пересобирается Tools/board.py из срезов; меняйте срезы в файлах механик.',
  journeyDocumentProtected: 'Journey-шаблоны (tasks/journeys/…) — метаданные конвейера, а не обычный документ; изменяйте их через конвейер.',
  duplicateHero: (filename: string, number: string) => `Повтор номера эпика ${filename}#${number}`,
  titleTooLong: (limit: number) => `Название должно быть строкой до ${limit} символов.`,
  bodyTooLong: (limit: number) => `Текст карточки должен быть строкой до ${limit} символов.`,
  mechanicParseFailed: (reason: string) => `Файл механики не разбирается: ${reason}`,
  documentParseFailed: (reason: string) => `Документ не разбирается: ${reason}`,
  editParseFailed: (reason: string) => `Правка ломает разбор механики: ${reason}`,
  emptyTitle: "Название не может быть пустым.",
  multilineTitle: "Название должно быть одной строкой.",
  unknownCardAddress: "Неизвестный адрес карточки.",
  heroMechanicOnly: "Эпики живут только в файлах механик.",
  taskMechanicOnly: "Срезы живут только в файлах механик.",
  multilineDocumentHeading: "Многострочный заголовок документа изменяется через редактор страницы.",
  cardNotFound: "Карточка не найдена.",
  cardFileNotFound: "Файл карточки не найден.",
  heroNotFound: "Эпик не найден в файле механики.",
  sliceNotFoundInFile: "Срез не найден в файле механики.",
  titleContainsState: "Название среза не должно содержать пометку состояния в скобках.",
  structureChanged: "Правка меняет номера, состояния или родителей срезов. Добавляйте карточки отдельно, не редактируя структуру здесь.",
  emptyReport: "Отчёт должен содержать текст.",
  reportHeadings: "В отчёте legacy-карточки используйте заголовки #### или глубже, чтобы отчёт оставался внутри карточки.",
  reportBoundary: "Отчёт изменит границу карточки или существующие байты. Проверьте заголовки, блоки кода и переводы строк.",
});


const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const maximumTitleLength = 1000;
const maximumBodyLength = 200000;

// Slice and epic grammar comes from src/markdown.ts and Tools/board.py; these patterns
// locate byte ranges within headings, which parseDocument does not expose.
const heroHeadingPattern = /^##\s+(?:Трек\s+)?(\d+)\s*[—.:-]\s*(.+)$/iu;
const taskHeadingPrefix = /^###\s+(?:✅\s+)?(\d+\.\d+[a-z]?)\s+/u;
const stateMarkPattern = new RegExp(`\\((${cardStateMarkWords().join('|')})(?![\\p{L}\\p{N}_])([^)]*)\\)`, 'gu');

/** Protected documents use dedicated writers; the editor displays them as read-only. */
const protectedDocuments: Record<string, 'catalogProtected' | 'iterationBoardProtected'> = {
  'tasks/deckmate.md': 'catalogProtected',
  'tasks/iteration-board.md': 'iterationBoardProtected',
};

export class CardContentError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

type UpdateEdit = Extract<CatalogEdit, { action: 'update-card-content' }>;
type LegacyKind = 'doc' | 'hero' | 'task';
interface LegacyRef { kind: LegacyKind; path: string; key?: string }

export interface HeroSection {
  number: string;
  id: string;
  title: string;
  headingLine: ByteRange;
  titleRange: ByteRange;
  introRange: ByteRange;
}

interface TaskSection {
  version: string;
  title: string;
  titleRange: ByteRange;
  bodyRange: ByteRange;
}

function hasBom(bytes: Uint8Array): boolean {
  return bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
}

/** Convert mdast character offsets to file byte offsets, accounting for the BOM. */
function byteOffsetOf(document: ParsedDocument, characterOffset: number): number {
  return (hasBom(document.bytes) ? 3 : 0) + Buffer.byteLength(document.text.slice(0, characterOffset), 'utf8');
}

function lineBounds(text: string, lineStart: number): { contentEnd: number; end: number } {
  let contentEnd = lineStart;
  while (contentEnd < text.length && text[contentEnd] !== '\r' && text[contentEnd] !== '\n') contentEnd += 1;
  let end = contentEnd;
  if (text[end] === '\r') end += 1;
  if (text[end] === '\n') end += 1;
  return { contentEnd, end };
}

function fileNewline(text: string): string {
  if (text.includes('\r\n')) return '\r\n';
  return text.match(/\r|\n/u)?.[0] ?? '\n';
}

/** Epics follow readCards grammar: numbered H2 headings containing at least one slice. */
export function readHeroSections(document: ParsedDocument): HeroSection[] {
  const sections: HeroSection[] = [];
  const seen = new Set<string>();
  const headings = document.tree.children.filter(node => node.type === 'heading' && node.depth <= 3);
  for (const node of document.tree.children) {
    if (node.type !== 'heading' || node.depth !== 2) continue;
    const startCharacter = node.position!.start.offset!;
    const headingText = document.text.slice(startCharacter, node.position!.end.offset!);
    const match = heroHeadingPattern.exec(headingText);
    if (!match || !document.slices.some(slice => slice.ver.split('.')[0] === match[1])) continue;
    if (seen.has(match[1])) throw new Error(serverText(messages).duplicateHero(document.relativePath, match[1]));
    seen.add(match[1]);
    const rawTitle = match[2];
    const titleStart = startCharacter + match[0].length - rawTitle.length;
    const title = rawTitle.trimEnd();
    const bounds = lineBounds(document.text, startCharacter);
    const following = headings.find(heading => heading.position!.start.offset! > startCharacter);
    const introStart = bounds.end;
    const introEnd = following ? following.position!.start.offset! : document.text.length;
    sections.push({
      number: match[1],
      id: `hero:${document.relativePath}#${match[1]}`,
      title,
      headingLine: { start: byteOffsetOf(document, startCharacter), end: byteOffsetOf(document, bounds.end) },
      titleRange: { start: byteOffsetOf(document, titleStart), end: byteOffsetOf(document, titleStart + title.length) },
      introRange: { start: byteOffsetOf(document, introStart), end: byteOffsetOf(document, introEnd) },
    });
  }
  return sections;
}

/** Parse a slice's version, clean title, and H3/body byte ranges using parseDocument grammar. */
function readTaskSections(document: ParsedDocument): TaskSection[] {
  const sections: TaskSection[] = [];
  const sliceEnds = new Map(document.slices.map(slice => [slice.ver, slice.range.end] as const));
  for (const node of document.tree.children) {
    if (node.type !== 'heading' || node.depth !== 3) continue;
    const startCharacter = node.position!.start.offset!;
    const bounds = lineBounds(document.text, startCharacter);
    const lineText = document.text.slice(startCharacter, bounds.contentEnd);
    const prefix = taskHeadingPrefix.exec(lineText);
    if (!prefix || !sliceEnds.has(prefix[1])) continue;
    const rest = lineText.slice(prefix[0].length);
    stateMarkPattern.lastIndex = 0;
    const mark = stateMarkPattern.exec(rest);
    const title = rest.slice(0, mark ? mark.index : rest.length).trimEnd();
    const titleStart = startCharacter + prefix[0].length;
    sections.push({
      version: prefix[1],
      title,
      titleRange: { start: byteOffsetOf(document, titleStart), end: byteOffsetOf(document, titleStart + title.length) },
      bodyRange: { start: byteOffsetOf(document, bounds.end), end: sliceEnds.get(prefix[1]) ?? document.bytes.length },
    });
  }
  return sections;
}

function structureFingerprint(bytes: Uint8Array, relative: string): string {
  const document = parseDocument(relative, bytes, serverLang());
  const heroes = readHeroSections(document).map(section => section.number);
  return JSON.stringify({ heroes, slices: document.slices.map(slice => [slice.ver, slice.state, slice.ver.split('.')[0]]) });
}

function validatedTitle(title: string): string {
  if (typeof title !== 'string' || title.length > maximumTitleLength) {
    throw new CardContentError(422, serverText(messages).titleTooLong(maximumTitleLength));
  }
  const trimmed = title.trim();
  if (!trimmed) throw new CardContentError(422, serverText(messages).emptyTitle);
  if (/[\r\n]/u.test(trimmed)) throw new CardContentError(422, serverText(messages).multilineTitle);
  return trimmed;
}

function validatedBody(markdown: string): string {
  if (typeof markdown !== 'string' || markdown.length > maximumBodyLength) {
    throw new CardContentError(422, serverText(messages).bodyTooLong(maximumBodyLength));
  }
  return markdown;
}

function missing(error: unknown): boolean { return (error as NodeJS.ErrnoException).code === 'ENOENT'; }

/** null means editable; a string explains protection; undefined means this is not a catalog document. */
function protectedDocumentMessage(relative: string): string | null | undefined {
  const folded = relative.toLowerCase();
  if (folded.startsWith('tasks/journeys/')) return serverText(messages).journeyDocumentProtected;
  const protection = protectedDocuments[canonicalDataPath(folded)];
  if (protection !== undefined) return serverText(messages)[protection];
  const isCollected = (/^(?:features|docs)\//u.test(relative) && relative.endsWith('.md'))
    || (/^tasks\/[^/]+\.md$/u.test(relative));
  return isCollected ? null : undefined;
}

function parseLegacyRef(cardId: string): LegacyRef {
  const relative = cardId.slice(cardId.indexOf(':') + 1).split('#')[0];
  if (/[\\:\u0000]/u.test(relative) || relative.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/u.test(part))) {
    throw new CardContentError(404, serverText(messages).unknownCardAddress);
  }
  const hero = /^hero:(.+)#(\d+)$/u.exec(cardId);
  if (hero) {
    if (!isMechanicPath(hero[1])) throw new CardContentError(404, serverText(messages).heroMechanicOnly);
    return { kind: 'hero', path: hero[1], key: hero[2] };
  }
  const task = /^task:(.+)#(\d+\.\d+[a-z]?)$/iu.exec(cardId);
  if (task) {
    if (!isMechanicPath(task[1])) throw new CardContentError(404, serverText(messages).taskMechanicOnly);
    return { kind: 'task', path: task[1], key: task[2] };
  }
  const document = /^doc:(.+)$/u.exec(cardId);
  if (document) {
    const protection = protectedDocumentMessage(document[1]);
    if (protection !== undefined && protection !== null) throw new CardContentError(422, protection);
    if (protection === null) return { kind: 'doc', path: document[1] };
  }
  throw new CardContentError(404, serverText(messages).unknownCardAddress);
}

interface ParsedMechanic {
  document: ParsedDocument;
  heroes: HeroSection[];
  tasks: TaskSection[];
}

function parseMechanic(relative: string, bytes: Buffer): ParsedMechanic {
  try {
    const document = parseDocument(relative, bytes, serverLang());
    return { document, heroes: readHeroSections(document), tasks: readTaskSections(document) };
  } catch (error) {
    throw new CardContentError(422, serverText(messages).mechanicParseFailed(error instanceof Error ? error.message : String(error)));
  }
}

/** Manage an ordinary document's H1 title and YAML header separately from its body. */
interface DocLayout {
  title: string;
  titleRange: ByteRange | null;
  bodyRange: ByteRange;
  insertRange: ByteRange;
}

function readDocLayout(relative: string, bytes: Buffer): DocLayout {
  const bomBytes = hasBom(bytes) ? 3 : 0;
  let document: ParsedDocument;
  try { document = parseDocument(relative, bytes, serverLang()); }
  catch (error) {
    throw new CardContentError(422, serverText(messages).documentParseFailed(error instanceof Error ? error.message : String(error)));
  }
  // 2026-11-03: mdast handles empty YAML too; insertion starts after its closing fence.
  const firstBlock = document.tree.children[0];
  const frontmatterEnd = firstBlock?.type === 'yaml' && firstBlock.position?.end.offset !== undefined
    ? lineBounds(document.text, firstBlock.position.end.offset).end : 0;
  const heading = document.tree.children.find(node => node.type === 'heading' && node.depth === 1
    && (node.position?.start.offset ?? 0) >= frontmatterEnd);
  const fallbackTitle = relative.split('/').at(-1)!.replace(/\.md$/u, '');
  const insertStartOf = () => (frontmatterEnd > 0 ? byteOffsetOf(document, frontmatterEnd) : bomBytes);
  const withoutHeading = (): DocLayout => {
    const insertStart = insertStartOf();
    return { title: fallbackTitle, titleRange: null, bodyRange: { start: insertStart, end: bytes.length }, insertRange: { start: insertStart, end: insertStart } };
  };
  if (!heading || heading.position?.start.offset === undefined) return withoutHeading();
  const startCharacter = heading.position.start.offset!;
  const bounds = lineBounds(document.text, startCharacter);
  const lineText = document.text.slice(startCharacter, bounds.contentEnd);
  const prefix = /^ {0,3}#[ \t]+/u.exec(lineText);
  const headingEnd = heading.position!.end.offset!;
  const titleStart = startCharacter + (prefix?.[0].length ?? 0);
  const rawTitle = prefix ? lineText.slice(prefix[0].length).replace(/[ \t]+#+[ \t]*$/u, '') : lineText;
  const title = rawTitle.trimEnd();
  // Setext H1 keeps its underline and line endings; only the title text is replaced.
  const bodyStart = prefix ? bounds.end : lineBounds(document.text, headingEnd).end;
  if (!prefix && document.text.slice(bounds.end, headingEnd).trim().includes('\n')) {
    throw new CardContentError(422, serverText(messages).multilineDocumentHeading);
  }
  return {
    title,
    titleRange: { start: byteOffsetOf(document, titleStart), end: byteOffsetOf(document, titleStart + title.length) },
    bodyRange: { start: byteOffsetOf(document, bodyStart), end: bytes.length },
    insertRange: { start: byteOffsetOf(document, bodyStart), end: byteOffsetOf(document, bodyStart) },
  };
}

export async function readCardContent(root: string, cardId: string): Promise<CardContent> {
  if (cardId.startsWith('card:')) {
    const file = await readNativeCard(root, cardId);
    if (!file) throw new CardContentError(404, serverText(messages).cardNotFound);
    return { cardId, title: file.metadata.title, markdown: file.markdown, sourceHash: file.fileHash };
  }
  const reference = parseLegacyRef(cardId);
  let bytes: Buffer;
  try { bytes = await readProjectMarkdown(root, reference.path); }
  catch (error) { if (missing(error)) throw new CardContentError(404, serverText(messages).cardFileNotFound); throw error; }
  if (reference.kind === 'doc') {
    const layout = readDocLayout(reference.path, bytes);
    return { cardId, title: layout.title, markdown: bytes.subarray(layout.bodyRange.start).toString('utf8'), sourceHash: digest(bytes) };
  }
  const mechanic = parseMechanic(reference.path, bytes);
  if (reference.kind === 'hero') {
    const section = mechanic.heroes.find(candidate => candidate.number === reference.key);
    if (!section) throw new CardContentError(404, serverText(messages).heroNotFound);
    return { cardId, title: section.title, markdown: bytes.subarray(section.introRange.start, section.introRange.end).toString('utf8'), sourceHash: digest(bytes) };
  }
  const section = mechanic.tasks.find(candidate => candidate.version === reference.key);
  if (!section) throw new CardContentError(404, serverText(messages).sliceNotFoundInFile);
  return { cardId, title: section.title, markdown: bytes.subarray(section.bodyRange.start, section.bodyRange.end).toString('utf8'), sourceHash: digest(bytes) };
}

function rejectStatusTitle(title: string): void {
  stateMarkPattern.lastIndex = 0;
  if (stateMarkPattern.test(title)) {
    throw new CardContentError(422, serverText(messages).titleContainsState);
  }
}

/** Edits must preserve unrelated slices, epics, states, and parent links. */
function assertStructureUnchanged(relative: string, before: Buffer, after: Buffer): void {
  let previous: string;
  let next: string;
  try {
    previous = structureFingerprint(before, relative);
    next = structureFingerprint(after, relative);
  } catch (error) {
    throw new CardContentError(422, serverText(messages).editParseFailed(error instanceof Error ? error.message : String(error)));
  }
  if (previous !== next) {
    throw new CardContentError(422, serverText(messages).structureChanged);
  }
}

function patchHero(relative: string, bytes: Buffer, key: string, title: string, markdown: string, preserveBodyNewlines: boolean): Buffer {
  const mechanic = parseMechanic(relative, bytes);
  const section = mechanic.heroes.find(candidate => candidate.number === key);
  if (!section) throw new CardContentError(404, serverText(messages).heroNotFound);
  const newline = fileNewline(mechanic.document.text);
  const intro = replacementBody(bytes, section.introRange, markdown, newline, preserveBodyNewlines);
  return Buffer.concat([
    bytes.subarray(0, section.titleRange.start), Buffer.from(title),
    bytes.subarray(section.titleRange.end, section.introRange.start), intro,
    bytes.subarray(section.introRange.end),
  ]);
}

function patchTask(relative: string, bytes: Buffer, key: string, title: string, markdown: string, preserveBodyNewlines: boolean): Buffer {
  const mechanic = parseMechanic(relative, bytes);
  const section = mechanic.tasks.find(candidate => candidate.version === key);
  const slice = mechanic.document.slices.find(candidate => candidate.ver === key);
  if (!section || !slice) throw new CardContentError(404, serverText(messages).sliceNotFoundInFile);
  rejectStatusTitle(title);
  const newline = fileNewline(mechanic.document.text);
  const body = replacementBody(bytes, section.bodyRange, markdown, newline, preserveBodyNewlines);
  const headingSeparator = bodySeparator(bytes, section.bodyRange.start, body, newline);
  return Buffer.concat([
    bytes.subarray(0, section.titleRange.start), Buffer.from(title),
    bytes.subarray(section.titleRange.end, section.bodyRange.start), headingSeparator, body,
    bytes.subarray(section.bodyRange.end),
  ]);
}

function patchDocument(relative: string, bytes: Buffer, title: string, markdown: string, preserveBodyNewlines: boolean): Buffer {
  const layout = readDocLayout(relative, bytes);
  const newline = fileNewline(parseBomText(bytes));
  const body = replacementBody(bytes, layout.bodyRange, markdown, newline, preserveBodyNewlines);
  if (title === layout.title && markdown === bytes.subarray(layout.bodyRange.start).toString('utf8')) return bytes;
  if (layout.titleRange) {
    const separator = bodySeparator(bytes, layout.bodyRange.start, body, newline);
    return Buffer.concat([
      bytes.subarray(0, layout.titleRange.start), Buffer.from(title),
      bytes.subarray(layout.titleRange.end, layout.bodyRange.start), separator, body,
    ]);
  }
  // If H1 is absent, insert the managed title before the body without changing YAML or the BOM.
  const remainder = bytes.subarray(layout.insertRange.start);
  const separator = remainder.toString('utf8').trim() ? newline + newline : newline;
  const heading = `# ${title}` + separator;
  const prefix = bytes.subarray(0, layout.insertRange.start);
  const frontmatterSeparator = prefix.length > (hasBom(bytes) ? 3 : 0) && !/[\r\n]$/u.test(prefix.toString('utf8')) ? newline : '';
  return Buffer.concat([prefix, Buffer.from(frontmatterSeparator + heading), body]);
}

function replacementBody(bytes: Buffer, range: ByteRange, markdown: string, newline: string, preserveBodyNewlines: boolean): Buffer {
  const original = bytes.subarray(range.start, range.end);
  const previous = original.toString('utf8');
  if (markdown === previous) return original;
  let body = markdown;
  if (!preserveBodyNewlines) {
    let start = 0;
    while (start < previous.length && start < markdown.length && previous[start] === markdown[start]) start += 1;
    let suffix = 0;
    while (suffix < previous.length - start && suffix < markdown.length - start
      && previous[previous.length - suffix - 1] === markdown[markdown.length - suffix - 1]) suffix += 1;
    // 2026-11-11: a shared CR or LF alone is not an unchanged CRLF pair.
    if (start > 0 && (previous.slice(start - 1, start + 1) === '\r\n' || markdown.slice(start - 1, start + 1) === '\r\n')) start -= 1;
    if (suffix > 0 && (previous.slice(previous.length - suffix - 1, previous.length - suffix + 1) === '\r\n'
      || markdown.slice(markdown.length - suffix - 1, markdown.length - suffix + 1) === '\r\n')) suffix -= 1;
    const end = markdown.length - suffix;
    body = markdown.slice(0, start) + markdown.slice(start, end).replace(/\r\n|\r|\n/gu, newline) + markdown.slice(end);
  }
  // A following heading belongs to another card and must always start on its own line.
  if (range.end < bytes.length && body && !/[\r\n]$/u.test(body)) body += newline;
  return Buffer.from(body);
}

function bodySeparator(bytes: Buffer, start: number, body: Buffer, newline: string): Buffer {
  return body.length > 0 && start > 0 && bytes[start - 1] !== 10 && bytes[start - 1] !== 13 ? Buffer.from(newline) : Buffer.alloc(0);
}

function parseBomText(bytes: Buffer): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function reportBodyRange(reference: LegacyRef, bytes: Buffer): ByteRange {
  if (reference.kind === 'doc') return readDocLayout(reference.path, bytes).bodyRange;
  const mechanic = parseMechanic(reference.path, bytes);
  const range = reference.kind === 'hero'
    ? mechanic.heroes.find(section => section.number === reference.key)?.introRange
    : mechanic.tasks.find(section => section.version === reference.key)?.bodyRange;
  if (!range) throw new CardContentError(404, serverText(messages).cardNotFound);
  return range;
}

/** 2026-11-05: keep the exact published hash for a subsequent state write or a guarded rollback. */
export async function appendCardReport(root: string, relative: string,
  edit: Extract<CatalogEdit, { action: 'add-card-report' }>, actor: string, date: string,
  beforePublish: () => Promise<void>): Promise<{ paths: string[]; sourceHash: string; previousBytes: Buffer }> {
  const report = validatedBody(edit.markdown);
  if (!report.trim()) throw new CardContentError(422, serverText(messages).emptyReport);
  const previousBytes = await readProjectMarkdown(root, relative);
  if (digest(previousBytes) !== edit.sourceHash) throw new Error('CARD_CONFLICT');
  const content = await readCardContent(root, edit.cardId);
  if (content.sourceHash !== edit.sourceHash) throw new Error('CARD_CONFLICT');
  const native = edit.cardId.startsWith('card:');
  if (!native && markdownParser.parse(report).children.some(node => node.type === 'heading' && node.depth <= 3)) {
    throw new CardContentError(422, serverText(messages).reportHeadings);
  }
  let newline = fileNewline(previousBytes.toString('utf8'));
  if (native && !content.markdown.includes('\r\n')) {
    // 2026-11-05: the native writer falls back to the opening YAML delimiter, not later header lines.
    newline = fileNewline(previousBytes.subarray(0, previousBytes.indexOf(10) + 1).toString('utf8'));
  }
  let separator = newline + newline;
  if (content.markdown.endsWith(newline + newline)) separator = '';
  else if (!content.markdown || content.markdown.endsWith(newline)) separator = newline;
  const heading = `#### Report ${date} · ${actor}`;
  const addition = separator + heading + newline + newline + report.replace(/\r\n|\r|\n/gu, newline) + newline + newline;
  const markdown = validatedBody(content.markdown + addition);
  const headingOffset = content.markdown.length + separator.length;
  if (!markdownParser.parse(markdown).children.some(node => node.type === 'heading' && node.depth === 4
    && node.position?.start.offset === headingOffset)) {
    throw new CardContentError(422, serverText(messages).reportBoundary);
  }
  let candidate: Buffer;
  if (native) {
    // 2026-11-05: the shared native writer normalizes the whole body; reject a report that would rewrite old bytes.
    if (content.title !== content.title.trim() || content.markdown.replace(/\r\n|\r|\n/gu, newline) !== content.markdown) {
      throw new CardContentError(422, serverText(messages).reportBoundary);
    }
    candidate = Buffer.concat([previousBytes, Buffer.from(addition)]);
  } else {
    const reference = parseLegacyRef(edit.cardId);
    const range = reportBodyRange(reference, previousBytes);
    candidate = patchLegacyContent(reference, previousBytes, validatedTitle(content.title), markdown);
    const prefix = range.start === range.end ? bodySeparator(previousBytes, range.start, Buffer.from(addition), newline) : Buffer.alloc(0);
    const inserted = Buffer.concat([prefix, Buffer.from(addition)]);
    const appendOnly = Buffer.concat([previousBytes.subarray(0, range.end), inserted, previousBytes.subarray(range.end)]);
    const nextRange = reportBodyRange(reference, candidate);
    if (!candidate.equals(appendOnly) || !candidate.subarray(nextRange.start, nextRange.end).toString('utf8').endsWith(addition)) {
      throw new CardContentError(422, serverText(messages).reportBoundary);
    }
    if (isMechanicPath(relative)) assertStructureUnchanged(relative, previousBytes, candidate);
  }
  const paths = await updateCardContent(root, { action: 'update-card-content', manifestHash: edit.manifestHash,
    cardId: edit.cardId, sourceHash: edit.sourceHash, title: content.title, markdown }, beforePublish);
  return { paths, sourceHash: digest(candidate), previousBytes };
}

function patchLegacyContent(reference: LegacyRef, bytes: Buffer, title: string, markdown: string, preserveBodyNewlines = false): Buffer {
  if (reference.kind === 'hero') return patchHero(reference.path, bytes, reference.key!, title, markdown, preserveBodyNewlines);
  if (reference.kind === 'task') return patchTask(reference.path, bytes, reference.key!, title, markdown, preserveBodyNewlines);
  return patchDocument(reference.path, bytes, title, markdown, preserveBodyNewlines);
}

/**
 * Derive editable ranges from current file bytes on the server.
 * Return rewritten files, or an empty list for a no-op.
 * Parser-prepared local edits retain their EOLs without bypassing structure or publication guards.
 */
export async function updateCardContent(root: string, edit: UpdateEdit, beforePublish?: () => Promise<void>, preserveBodyNewlines = false): Promise<string[]> {
  const title = validatedTitle(edit.title);
  const markdown = validatedBody(edit.markdown);
  if (edit.cardId.startsWith('card:')) {
    if (!nativeCardPath(edit.cardId)) throw new CardContentError(404, serverText(messages).cardNotFound);
    const changed = await editNativeCardContent(root, edit.cardId, edit.sourceHash, { title, markdown }, beforePublish);
    return changed ? [`cards/${edit.cardId.slice(5)}.md`] : [];
  }
  const reference = parseLegacyRef(edit.cardId);
  let bytes: Buffer;
  try { bytes = await readProjectMarkdown(root, reference.path); }
  catch (error) { if (missing(error)) throw new CardContentError(404, serverText(messages).cardFileNotFound); throw error; }
  if (digest(bytes) !== edit.sourceHash) throw new Error('CARD_CONFLICT');
  const candidate = patchLegacyContent(reference, bytes, title, markdown, preserveBodyNewlines);
  if (candidate.equals(bytes)) return [];
  if (isMechanicPath(reference.path)) assertStructureUnchanged(reference.path, bytes, candidate);
  else parseBomText(candidate); // Documents outside mechanics have no slices; only validate UTF-8 readability.
  await replaceProjectMarkdown(root, reference.path, edit.sourceHash, candidate, beforePublish);
  return [reference.path];
}
