// 2026-11-12: questions and decisions share one grammar regardless of card kind or section depth.
import type { Definition, Heading, List, ListItem, Nodes, Paragraph, Root, RootContent, Text } from 'mdast';
import { markdownParser } from './markdown-model.ts';
import type { CatalogDecision, CatalogOpenQuestion } from './catalog-contracts.ts';
import { defaultLang, defineText, type Lang } from './i18n.ts';
import { markerWords, writeMarker, type FormatLanguage } from './format-vocabulary.ts';

const messages = defineText({
  multipleSections: 'Multiple “Open questions” sections; only the first is counted.',
  emptyItems: (count: number) => `Empty items in “Open questions”: ${count}.`,
  reusedTask: 'One decision Task is linked to multiple questions.',
  missingList: '“Open questions” contains text without a list; questions could not be recognized and need review.',
  changed: 'The question in “Open questions” changed. Refresh the Card.',
  emptyAnswer: 'The answer is empty.',
  invalidDate: 'The answer date must use YYYY-MM-DD.',
  decisionChanged: 'The recorded answer changed. Refresh the Card.',
  invalidAssignee: 'The addressee must be a member ID or null.',
  recordedVia: (name: string) => `, via ${name}`,
  appliedNote: (note: string) => `Applied: ${note}`,
}, {
  multipleSections: 'Несколько разделов «Открыто» — считается только первый.',
  emptyItems: (count: number) => `Пустых пунктов в «Открыто»: ${count}.`,
  reusedTask: 'Одна задача «Решение» привязана к нескольким вопросам.',
  missingList: 'В «Открыто» текст без списка — вопросы не распознаны, нужен разбор.',
  changed: 'Вопрос в «Открыто» изменился — обновите карточку.',
  emptyAnswer: 'Ответ пустой.',
  invalidDate: 'Дата ответа — в виде ГГГГ-ММ-ДД.',
  decisionChanged: 'Записанный ответ изменился — обновите карточку.',
  invalidAssignee: 'Адресат — ID участника или null.',
  recordedVia: (name: string) => `, через ${name}`,
  appliedNote: (note: string) => `Внесено: ${note}`,
});

const openSectionTitles = markerWords('openQuestions');
const decidedSectionTitles = markerWords('decided');
const decisionSeparator = '<!-- deckmate:decision -->';
const pendingMarker = '<!-- deckmate:pending -->';
const appliedMarker = /^<!-- deckmate:applied (\d{4}-\d{2}-\d{2}) -->$/u;
// 2026-11-06: `report` appends "#### Report YYYY-MM-DD · member" after the body. When the body ends with this section
// (a question asked on the card itself), the report's own lists must not become questions, and a later question must
// not be appended inside the report.
const reportHeading = /^Report \d{4}-\d{2}-\d{2} · (.+)$/u;

export interface OpenQuestion {
  /** First paragraph of the item, plain text, without the decision-task link. */
  text: string;
  /** Short card reference (`c-…`) of the linked decision Task, if the item has one. */
  taskRef: string | null;
  /** 2026-11-12: member ID the question is addressed to, written in the item itself as @id; null when nobody is named. */
  assignee: string | null;
  /** 2026-11-12: c-ref with an optional heading fragment; null means this card. */
  target: string | null;
  /** UTF-16 offsets of the whole item (with nested options) in the markdown. */
  start: number;
  end: number;
}

export interface OpenQuestions {
  /** null means no open-questions section. */
  questions: OpenQuestion[] | null;
  warnings: string[];
}

const taskLink = /^\/r\/(c-[0-9a-z]{10})(?:#[^\s]*)?$/u;

export function parseDecisionTarget(value: string): { ref: string; fragment: string | null } | null {
  const match = /^(?:\/r\/)?(c-[0-9a-z]{10})(?:#([^\s#()[\]<>"'\\]+))?$/u.exec(value);
  if (!match) return null;
  try { if (match[2]) decodeURIComponent(match[2]); } catch { return null; }
  return { ref: match[1], fragment: match[2] ?? null };
}

/** Whether a link in a question item is its decision-task link (the one `questionOf` reads as `taskRef`). */
export function isDecisionTaskLink(url: string): boolean {
  return taskLink.test(url);
}

function plain(node: object): string {
  if ('value' in node && typeof node.value === 'string') return node.value;
  return 'children' in node && Array.isArray(node.children) ? node.children.map(child => plain(child as object)).join('') : '';
}

/** Generated report headings share one grammar with question boundaries and acceptance checks. */
export function cardReportAuthor(node: RootContent): string | null {
  return node.type === 'heading' && node.depth === 4 ? reportHeading.exec(plain(node))?.[1] ?? null : null;
}

export function isCardSectionBoundary(node: RootContent): node is Heading {
  return node.type === 'heading' && (node.depth <= 2 || cardReportAuthor(node) !== null);
}

function isSection(node: RootContent, titles: string | readonly string[]): node is Heading {
  const title = plain(node).trim().toLowerCase();
  return node.type === 'heading' && node.depth >= 2
    && (typeof titles === 'string' ? [titles] : titles).some(candidate => candidate.toLowerCase() === title);
}

function sectionBody(root: Root, titles: string | readonly string[], depth?: number): { heading: Heading; nodes: RootContent[] } | null {
  const index = root.children.findIndex(node => isSection(node, titles) && (depth === undefined || node.depth === depth));
  if (index < 0) return null;
  const heading = root.children[index] as Heading;
  const nodes: RootContent[] = [];
  for (const node of root.children.slice(index + 1)) {
    if (node.type === 'heading' && (node.depth <= heading.depth || cardReportAuthor(node) !== null)) break;
    if (node.type === 'heading' && node.depth === 3 && /^\d+\.\d+[a-z]?\s/iu.test(plain(node))) break;
    nodes.push(node);
  }
  return { heading: root.children[index] as Heading, nodes };
}

function definitionsOf(root: Root): Map<string, Definition> {
  const definitions = new Map<string, Definition>();
  function visit(node: Nodes): void {
    if (node.type === 'definition' && !definitions.has(node.identifier)) definitions.set(node.identifier, node);
    if ('children' in node) node.children.forEach(visit);
  }
  visit(root);
  return definitions;
}

function questionParts(item: ListItem, definitions = new Map<string, Definition>()): { question: OpenQuestion; tail: Text | null } {
  const paragraph = item.children.find(child => child.type === 'paragraph');
  let taskRef: string | null = null;
  let target: string | null = null;
  const children = [...(paragraph?.children ?? [])];
  const lastChild = children.at(-1);
  let tail = lastChild?.type === 'text' ? lastChild : null;
  // 2026-11-12: only a terminal metadata chain is structural; links within a sentence remain content.
  for (;;) {
    if (children.at(-1)?.type === 'text' && !plain(children.at(-1)!).trim()) children.pop();
    const link = children.at(-1);
    const previous = children.at(-2);
    const url = link?.type === 'link' ? link.url : undefined;
    const referenceUrl = link?.type === 'linkReference' ? definitions.get(link.identifier)?.url : undefined;
    const destination = parseDecisionTarget(url ?? referenceUrl ?? '');
    const suffix = previous?.type === 'text' ? /\s+(→|[—–-])\s*$/u.exec(previous.value) : null;
    if (!destination || !suffix || previous?.type !== 'text') break;
    if (suffix[1] === '→' && target === null) target = destination.ref + (destination.fragment ? `#${destination.fragment}` : '');
    else if (suffix[1] !== '→' && taskRef === null && taskLink.test(url ?? referenceUrl ?? '')) taskRef = destination.ref;
    else break;
    children.pop();
    children[children.length - 1] = { ...previous, value: previous.value.slice(0, suffix.index) };
    tail = previous;
  }
  const last = children.at(-1);
  const addressed = last?.type === 'text' ? /(?:^|\s)@([a-z0-9][a-z0-9-]{0,79})\s*$/u.exec(last.value) : null;
  const assignee = addressed?.[1] ?? null;
  if (addressed && last?.type === 'text') children[children.length - 1] = { ...last, value: last.value.slice(0, addressed.index) };
  const text = children.map(plain).join('').replace(/\s+/gu, ' ').trim();
  return { question: { text, taskRef, assignee, target, start: item.position?.start.offset ?? 0, end: item.position?.end.offset ?? 0 }, tail };
}

function questionOf(item: ListItem, definitions?: Map<string, Definition>): OpenQuestion {
  return questionParts(item, definitions).question;
}

export interface ResolvedDecision {
  question: string | null;
  taskRef: string | null;
  answer: string;
  author: string | null;
  recordedBy: string | null;
  assignee: string | null;
  date: string | null;
  target: string | null;
  applied: string | null;
  nodes: RootContent[];
}

export function decisionAnswerText(answer: string, context = ''): string {
  const inline = answer.replace(/\s+/gu, ' ').trim();
  // 2026-11-12: answers follow an arrow in a paragraph; leading #, > or - are content, not block markers.
  return plain(markdownParser.parse(`→ ${inline}\n\n${referenceDefinitions(context)}`).children[0] ?? {}).slice(2).trim();
}

/** 2026-11-12: an inline HTML marker distinguishes saved questions from legacy answers containing arrows. */
function resolvedDecisionOf(item: ListItem, definitions?: Map<string, Definition>): ResolvedDecision {
  const first = item.children.find(child => child.type === 'paragraph');
  const entry: ResolvedDecision = { question: null, taskRef: null, assignee: null, target: null, applied: '', answer: plain(item).trim(), author: null, recordedBy: null, date: null,
    nodes: item.children as RootContent[] };
  if (first?.type !== 'paragraph') return entry;
  let children = [...first.children];
  const status = children.at(-1);
  const applied = status?.type === 'html' ? appliedMarker.exec(status.value) : null;
  const pending = status?.type === 'html' && status.value === pendingMarker;
  if (pending || applied) {
    children.pop();
    const trailing = children.at(-1);
    if (trailing?.type === 'text') children[children.length - 1] = { ...trailing, value: trailing.value.trimEnd() };
  }
  const separator = children.findIndex(node => node.type === 'html' && node.value === decisionSeparator);
  const arrow = children[separator + 1];
  if (separator >= 0 && arrow?.type === 'text' && /^\s*→\s/u.test(arrow.value)) {
    const question = questionOf({ ...item, children: [{ ...first, children: children.slice(0, separator) }] }, definitions);
    entry.question = question.text;
    entry.assignee = question.assignee;
    entry.taskRef = question.taskRef;
    entry.target = question.target;
    children = [{ ...arrow, value: arrow.value.replace(/^\s*→\s/u, '') }, ...children.slice(separator + 2)];
  }
  const last = children.at(-1);
  const signature = last?.type === 'text' ? /^(.*)\s+[—–-]\s+(.+?),\s*(\d{4}-\d{2}-\d{2})\s*$/u.exec(last.value) : null;
  if (signature && last?.type === 'text') {
    entry.author = signature[2];
    const recorder = /^(.*), (?:via|через) (.+)$/u.exec(entry.author);
    if (recorder) { entry.author = recorder[1]; entry.recordedBy = recorder[2]; }
    entry.date = signature[3];
    children = [...children.slice(0, -1), { ...last, value: signature[1].trimEnd() }];
  }
  entry.nodes = (entry.question === null ? item.children.map(child => child === first ? { ...first, children } : child)
    : [{ ...first, children }]) as RootContent[];
  entry.answer = entry.nodes.map(plain).join('').replace(/\s+/gu, ' ').trim();
  entry.applied = pending && entry.question !== null ? null : applied?.[1] ?? entry.date ?? '';
  return entry;
}

export function resolvedDecisionsOf(root: Root, depth?: number): ResolvedDecision[] {
  const definitions = definitionsOf(root);
  return sectionBody(root, decidedSectionTitles, depth)?.nodes.flatMap(node => node.type === 'list' ? node.children.map(item => resolvedDecisionOf(item, definitions)) : []) ?? [];
}

export function catalogQuestionOf(question: OpenQuestion): CatalogOpenQuestion {
  return { text: question.text, taskRef: question.taskRef, assignee: question.assignee, target: question.target };
}

/** 2026-11-12: one projection keeps saved metadata intact in both catalog and Markdown fallback readers. */
export function catalogDecisionOf(decision: ResolvedDecision, index: number): CatalogDecision {
  return { index, question: decision.question, answer: decision.answer, by: decision.author,
    ...(decision.recordedBy ? { recordedBy: decision.recordedBy } : {}),
    ...(decision.assignee ? { assignee: decision.assignee } : {}),
    date: decision.date, target: decision.target, applied: decision.applied };
}

function escapeDecisionText(value: string): string {
  return value.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/[\\`*_[\]~]/gu, '\\$&');
}

function referenceDefinitions(markdown: string): string {
  const bom = Number(markdown.startsWith('\uFEFF'));
  return [...definitionsOf(markdownParser.parse(markdown)).values()]
    .map(node => markdown.slice(node.position!.start.offset! + bom, node.position!.end.offset! + bom)).join('\n');
}

function decisionInline(value: string, context = ''): string {
  const tree = markdownParser.parse(`→ ${value}\n\n${referenceDefinitions(context)}`);
  const edits: Array<{ start: number; end: number; text: string }> = [];
  // 2026-11-12: unmatched inline delimiters must not pair across the separator and swallow it into code or emphasis.
  function visit(node: Nodes) {
    if (node.type === 'text' || (node.type === 'html'
      && (node.value === decisionSeparator || node.value === pendingMarker || appliedMarker.test(node.value)))) {
      const start = node.position!.start.offset!;
      const end = node.position!.end.offset!;
      if (end > 2) edits.push({ start: Math.max(2, start) - 2, end: end - 2,
        text: escapeDecisionText(start === 0 ? node.value.slice(2) : node.value) });
    } else if ('children' in node) node.children.forEach(visit);
  }
  if (tree.children[0]) visit(tree.children[0]);
  for (const edit of edits.reverse()) value = value.slice(0, edit.start) + edit.text + value.slice(edit.end);
  return value;
}

const lettersOf = (text: string): string[] => [...text.replace(/\P{L}+/gu, '')];
const openTitleLetters = openSectionTitles.map(title => lettersOf(title.toLowerCase()));
const questionSectionLetters = [...openTitleLetters, ...decidedSectionTitles.map(title => lettersOf(title.toLowerCase()))];

function containsInOrder(letters: readonly string[], wanted: readonly string[]): boolean {
  let found = 0;
  for (const letter of letters) if (letter === wanted[found] && ++found === wanted.length) return true;
  return wanted.length === 0;
}

/**
 * 2026-11-12: a necessary-condition scan lets cards without either section skip the full Markdown parse.
 * Root section headings are ATX H2–H6 or setext H2. Without character references, every letter in the heading's
 * plain text occurs in its source in order; any doubt falls back to the shared Markdown grammar.
 */
function mayHaveSection(markdown: string, titles = openTitleLetters): boolean {
  if (markdown.includes('&')) return true;
  const lines = markdown.replace(/^\uFEFF/u, '').split(/\r\n|\r|\n/u);
  let paragraphStart = 0;
  for (const [index, line] of lines.entries()) {
    let heading: string | null = null;
    if (/^ {0,3}#{2,6}(?:[ \t]|$)/u.test(line)) heading = line;
    else if (index > 0 && /^ {0,3}-+[ \t]*$/u.test(line)) heading = lines.slice(paragraphStart, index).join('\n');
    if (/^[ \t]*$/u.test(line)) paragraphStart = index + 1;
    if (heading === null) continue;
    const letters = lettersOf(heading.toLowerCase());
    if (titles.some(title => containsInOrder(letters, title))) return true;
  }
  return false;
}

export function parseOpenQuestions(markdown: string, lang: Lang = defaultLang, depth?: number): OpenQuestions {
  if (!mayHaveSection(markdown)) return { questions: null, warnings: [] };
  const result = openQuestionsOf(markdownParser.parse(markdown) as Root, lang, depth);
  if (!markdown.startsWith('\uFEFF')) return result;
  return { ...result, questions: result.questions?.map(question => ({ ...question, start: question.start + 1, end: question.end + 1 })) ?? null };
}

export function parseCardQuestions(markdown: string, lang: Lang = defaultLang): OpenQuestions & { decisions: ResolvedDecision[] } {
  if (!mayHaveSection(markdown, questionSectionLetters)) return { questions: null, warnings: [], decisions: [] };
  const root = markdownParser.parse(markdown);
  const result = openQuestionsOf(root, lang);
  const bom = Number(markdown.startsWith('\uFEFF'));
  return { ...result, questions: result.questions?.map(question => ({ ...question, start: question.start + bom, end: question.end + bom })) ?? null,
    decisions: resolvedDecisionsOf(root) };
}

/**
 * 2026-11-06: the same grammar over a tree the caller already parsed with markdownParser, so a mechanic file is
 * parsed once at catalog load instead of twice. Tree offsets exclude a leading BOM; string-based edits account for it.
 */
export function openQuestionsOf(root: Root, lang: Lang = defaultLang, depth?: number): OpenQuestions {
  const sections = root.children.filter(node => isSection(node, openSectionTitles) && (depth === undefined || node.depth === depth)).length;
  const section = sectionBody(root, openSectionTitles, depth);
  if (!section) return { questions: null, warnings: [] };
  const warnings: string[] = [];
  if (sections > 1) warnings.push(messages[lang].multipleSections);
  const definitions = definitionsOf(root);
  const questions = section.nodes
    .filter((node): node is List => node.type === 'list')
    .flatMap(list => list.children.map(item => questionOf(item, definitions)));
  const empty = questions.filter(question => !question.text).length;
  if (empty) warnings.push(messages[lang].emptyItems(empty));
  const refs = questions.map(question => question.taskRef).filter((ref): ref is string => ref !== null);
  if (new Set(refs).size !== refs.length) warnings.push(messages[lang].reusedTask);
  const loose = section.nodes.filter(node => node.type === 'paragraph').length;
  if (loose && !questions.length) warnings.push(messages[lang].missingList);
  return { questions, warnings };
}

function lineStart(markdown: string, offset: number): number {
  return Math.max(markdown.lastIndexOf('\n', offset - 1), markdown.lastIndexOf('\r', offset - 1)) + 1;
}

function lineEnd(markdown: string, offset: number): number {
  let end = offset;
  while (end < markdown.length && markdown[end] !== '\r' && markdown[end] !== '\n') end += 1;
  if (markdown[end] === '\r') end += 1;
  if (markdown[end] === '\n') end += 1;
  return end;
}

/**
 * 2026-11-12: inserting after the section's list keeps later reports and unrelated bytes outside the write.
 * Shared with Journey lessons; null means the section is absent.
 */
export function appendSectionLine(markdown: string, root: Root, title: string | readonly string[], line: string, depth?: number): string | null {
  const section = sectionBody(root, title, depth);
  if (!section) return null;
  const eol = line.match(/(?:\r\n|\r|\n)$/u)?.[0] ?? '\n';
  const lastList = [...section.nodes].reverse().find((node): node is List => node.type === 'list');
  const anchor = lastList ?? section.heading;
  const at = lineEnd(markdown, Math.max(anchor.position!.start.offset!, anchor.position!.end.offset! - 1) + Number(markdown.startsWith('\uFEFF')));
  // The section's last line may end the file without a line break; the new item must not glue onto it.
  const lineBreak = at === markdown.length && !/[\r\n]$/u.test(markdown) ? eol : '';
  const gap = lastList ? '' : eol;
  return markdown.slice(0, at) + lineBreak + gap + line + markdown.slice(at);
}

/** 2026-11-12: the captured text prevents an index from selecting a different question after an edit. */
function findOpenQuestion(markdown: string, index: number, expectedText: string, lang: Lang = defaultLang, depth?: number): OpenQuestion {
  const question = parseOpenQuestions(markdown, lang, depth).questions?.[index];
  if (!question || question.text !== expectedText.trim()) throw new Error(messages[lang].changed);
  return question;
}

export function appendQuestion(markdown: string, text: string, assignee: string | null, target: string | null,
  formatLanguage: FormatLanguage = 'en', depth = 2, sectionDepth?: number): string {
  const eol = markdown.match(/\r\n|\r|\n/u)?.[0] ?? '\n';
  const line = `- ${decisionInline(text, markdown)}${assignee ? ` @${assignee}` : ''}${target ? ` → [${target}](/r/${target})` : ''}${eol}`;
  const root = markdownParser.parse(markdown);
  const appended = appendSectionLine(markdown, root, openSectionTitles, line, sectionDepth);
  if (appended !== null) return appended;
  const report = root.children.find(node => cardReportAuthor(node) !== null);
  const at = report ? lineStart(markdown, report.position!.start.offset! + Number(markdown.startsWith('\uFEFF'))) : markdown.length;
  const prefix = markdown.slice(0, at);
  let gap = '';
  if (prefix.replace(/^\uFEFF/u, '') && !prefix.endsWith(eol + eol)) gap = prefix.endsWith(eol) ? eol : eol + eol;
  return prefix + gap + `${'#'.repeat(depth)} ${writeMarker('openQuestions', formatLanguage)}${eol}${eol}${line}${eol}` + markdown.slice(at);
}

export function assignQuestion(markdown: string, index: number, expectedText: string, assignee: string | null, lang: Lang = defaultLang, depth?: number): string {
  if (assignee !== null && !/^[a-z0-9][a-z0-9-]{0,79}$/u.test(assignee)) throw new Error(messages[lang].invalidAssignee);
  const question = findOpenQuestion(markdown, index, expectedText, lang, depth);
  if (question.assignee === assignee) return markdown;
  const root = markdownParser.parse(markdown);
  const item = questionItem(root, index, depth)!;
  const { tail } = questionParts(item, definitionsOf(root));
  const paragraph = item.children.find((node): node is Paragraph => node.type === 'paragraph')!;
  let at = paragraph.position!.end.offset!;
  let end = at;
  if (tail) {
    const start = tail.position!.start.offset!;
    const bom = Number(markdown.startsWith('\uFEFF'));
    const raw = markdown.slice(start + bom, tail.position!.end.offset! + bom);
    const suffix = /\s*(?:→|[—–-])?\s*$/u.exec(raw)![0];
    const content = raw.slice(0, raw.length - suffix.length);
    at = start + content.length;
    end = at;
    if (question.assignee) {
      const current = new RegExp(`(?:^|\\s)@${question.assignee}$`, 'u').exec(content);
      if (!current) throw new Error(messages[lang].changed);
      at = start + current.index;
    }
  }
  const bom = Number(markdown.startsWith('\uFEFF'));
  const updated = markdown.slice(0, at + bom) + (assignee ? ` @${assignee}` : '') + markdown.slice(end + bom);
  const parsed = findOpenQuestion(updated, index, expectedText, lang, depth);
  if (parsed.assignee !== assignee || parsed.target !== question.target || parsed.taskRef !== question.taskRef) throw new Error(messages[lang].changed);
  return updated;
}

export function applyDecision(markdown: string, index: number, expectedAnswer: string, date: string, lang: Lang = defaultLang, depth?: number, note?: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) throw new Error(messages[lang].invalidDate);
  const root = markdownParser.parse(markdown);
  const items = sectionBody(root, decidedSectionTitles, depth)?.nodes.flatMap(node => node.type === 'list' ? node.children : []) ?? [];
  const item = items[index];
  const decision = item ? resolvedDecisionOf(item, definitionsOf(root)) : null;
  if (!decision || (decision.answer !== expectedAnswer.trim() && decision.answer !== decisionAnswerText(expectedAnswer, markdown))) {
    throw new Error(messages[lang].decisionChanged);
  }
  if (decision.applied !== null) return markdown;
  const paragraph = item.children.find((node): node is Paragraph => node.type === 'paragraph')!;
  const marker = paragraph.children.at(-1)!;
  const bom = Number(markdown.startsWith('\uFEFF'));
  if (note?.trim()) {
    const eol = markdown.match(/\r\n|\r|\n/u)?.[0] ?? '\n';
    const at = item.position!.end.offset! + bom;
    const indent = ' '.repeat(Math.max(2, paragraph.position!.start.column - item.position!.start.column));
    const annotation = `${eol}${eol}${indent}${messages[lang].appliedNote(decisionInline(note.replace(/\s+/gu, ' ').trim(), markdown))}`;
    markdown = markdown.slice(0, at) + annotation + markdown.slice(at);
  }
  return markdown.slice(0, marker.position!.start.offset! + bom) + `<!-- deckmate:applied ${date} -->`
    + markdown.slice(marker.position!.end.offset! + bom);
}

/**
 * 2026-11-12: moving the full item retains options and target; pending distinguishes recording from incorporation.
 * A new decided heading matches the open section's depth so legacy card boundaries remain intact.
 */
export function recordDecision(markdown: string, index: number, expectedText: string, answer: string, author: string, date: string, lang: Lang = defaultLang,
  formatLanguage: FormatLanguage = 'ru', depth?: number, recordedBy?: string): string {
  const rule = answer.replace(/\s+/gu, ' ').trim();
  if (!rule) throw new Error(messages[lang].emptyAnswer);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) throw new Error(messages[lang].invalidDate);
  const question = findOpenQuestion(markdown, index, expectedText, lang, depth);
  const eol = markdown.match(/\r\n|\r|\n/u)?.[0] ?? '\n';
  const originalRoot = markdownParser.parse(markdown);
  const item = questionItem(originalRoot, index, depth)!;
  const paragraph = item.children.find(node => node.type === 'paragraph')!;
  const bom = Number(markdown.startsWith('\uFEFF'));
  const start = paragraph.position!.start.offset! + bom;
  const end = paragraph.position!.end.offset! + bom;
  const original = markdown.slice(start, end).replace(/\s+/gu, ' ').trim();
  const recorder = recordedBy ? messages[formatLanguage].recordedVia(escapeDecisionText(recordedBy)) : '';
  const line = markdown.slice(lineStart(markdown, question.start), start) + decisionInline(original, markdown)
    + ` ${decisionSeparator} → ${decisionInline(rule, markdown)} — ${escapeDecisionText(author)}${recorder}, ${date} ${pendingMarker}`
    + markdown.slice(end, question.end) + eol;
  const removed = markdown.slice(0, lineStart(markdown, question.start)) + markdown.slice(lineEnd(markdown, Math.max(question.start, question.end - 1)));
  const root = markdownParser.parse(removed) as Root;
  const appended = appendSectionLine(removed, root, decidedSectionTitles, line, depth);
  if (appended !== null) return appended;
  const open = sectionBody(root, openSectionTitles, depth)!.heading;
  const at = Math.max(bom, lineStart(removed, open.position!.start.offset! + bom));
  return removed.slice(0, at) + `${'#'.repeat(open.depth)} ${writeMarker('decided', formatLanguage)}${eol}${eol}${line}${eol}` + removed.slice(at);
}

function questionItem(root: Root, index: number, depth?: number): ListItem | undefined {
  return sectionBody(root, openSectionTitles, depth)?.nodes.flatMap(node => node.type === 'list' ? node.children : [])[index];
}
