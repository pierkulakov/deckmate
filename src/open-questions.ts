// An open question on a Knowledge rule card is defined only by its item under openSectionTitle.
// The question badge counts those items, never Task states.
// Grammar: one top-level list item in that section = one question; nested items (options,
// recommendation) do not count; the section ends at the next H1/H2 or card report heading; code and quotes are not questions.
import type { Heading, List, ListItem, Root, RootContent } from 'mdast';
import { markdownParser } from './markdown-model.ts';
import { shortReference } from './references.ts';
import { defaultLang, defineText, type Lang } from './i18n.ts';
import { markerWords, writeMarker, type FormatLanguage } from './format-vocabulary.ts';

const messages = defineText({
  multipleSections: 'Multiple “Open questions” sections; only the first is counted.',
  emptyItems: (count: number) => `Empty items in “Open questions”: ${count}.`,
  reusedTask: 'One decision Task is linked to multiple questions.',
  missingList: '“Open questions” contains text without a list; questions could not be recognized and need review.',
  changed: 'The question in “Open questions” changed. Refresh the Card.',
  alreadyLinked: 'The question already has another decision Task.',
  emptyAnswer: 'The answer is empty.',
  invalidDate: 'The answer date must use YYYY-MM-DD.',
}, {
  multipleSections: 'Несколько разделов «Открыто» — считается только первый.',
  emptyItems: (count: number) => `Пустых пунктов в «Открыто»: ${count}.`,
  reusedTask: 'Одна задача «Решение» привязана к нескольким вопросам.',
  missingList: 'В «Открыто» текст без списка — вопросы не распознаны, нужен разбор.',
  changed: 'Вопрос в «Открыто» изменился — обновите карточку.',
  alreadyLinked: 'У вопроса уже есть другая задача «Решение».',
  emptyAnswer: 'Ответ пустой.',
  invalidDate: 'Дата ответа — в виде ГГГГ-ММ-ДД.',
});

const openSectionTitles = markerWords('openQuestions');
const decidedSectionTitles = markerWords('decided');
// 2026-11-06: `report` appends "#### Report YYYY-MM-DD · member" after the body. When the body ends with this section
// (a question asked on the card itself), the report's own lists must not become questions, and a later question must
// not be appended inside the report.
const reportHeading = /^Report \d{4}-\d{2}-\d{2} · /u;

export interface OpenQuestion {
  /** First paragraph of the item, plain text, without the decision-task link. */
  text: string;
  /** Short card reference (`c-…`) of the linked decision Task, if the item has one. */
  taskRef: string | null;
  /** UTF-16 offsets of the whole item (with nested options) in the markdown. */
  start: number;
  end: number;
}

export interface OpenQuestions {
  /** null means no open-questions section (not a rule card): show no badge. */
  questions: OpenQuestion[] | null;
  warnings: string[];
}

const taskLink = /\/r\/(c-[0-9a-z]{10})\b/u;

function plain(node: object): string {
  if ('value' in node && typeof node.value === 'string') return node.value;
  return 'children' in node && Array.isArray(node.children) ? node.children.map(child => plain(child as object)).join('') : '';
}

function isSection(node: RootContent, titles: string | readonly string[]): node is Heading {
  const title = plain(node).trim().toLowerCase();
  return node.type === 'heading' && node.depth === 2
    && (typeof titles === 'string' ? [titles] : titles).some(candidate => candidate.toLowerCase() === title);
}

function sectionBody(root: Root, titles: string | readonly string[]): { heading: Heading; nodes: RootContent[] } | null {
  const index = root.children.findIndex(node => isSection(node, titles));
  if (index < 0) return null;
  const nodes: RootContent[] = [];
  for (const node of root.children.slice(index + 1)) {
    if (node.type === 'heading' && (node.depth <= 2 || (node.depth === 4 && reportHeading.test(plain(node))))) break;
    nodes.push(node);
  }
  return { heading: root.children[index] as Heading, nodes };
}

function questionOf(item: ListItem): OpenQuestion {
  const paragraph = item.children.find(child => child.type === 'paragraph');
  let taskRef: string | null = null;
  const words: string[] = [];
  for (const child of paragraph?.children ?? []) {
    const ref = child.type === 'link' ? taskLink.exec(child.url) : null;
    if (ref) { taskRef ??= ref[1]; continue; }
    words.push(plain(child));
  }
  const text = words.join('').replace(/\s*[—–-]\s*$/u, '').replace(/\s+/gu, ' ').trim();
  return { text, taskRef, start: item.position?.start.offset ?? 0, end: item.position?.end.offset ?? 0 };
}

const lettersOf = (text: string): string[] => [...text.replace(/\P{L}+/gu, '')];
const openTitleLetters = openSectionTitles.map(title => lettersOf(title.toLowerCase()));

function containsInOrder(letters: readonly string[], wanted: readonly string[]): boolean {
  let found = 0;
  for (const letter of letters) if (letter === wanted[found] && ++found === wanted.length) return true;
  return wanted.length === 0;
}

/**
 * 2026-11-06: a necessary condition for an open-questions section, so most Docs skip the Markdown parse at catalog
 * load (230 of 290 ms over the 108 Docs of a large project). A root H2 is an ATX line `## …` or the paragraph above a
 * setext `-` underline. Without `&` (character references) every letter of its plain text is a letter of that source,
 * in order, so a title can only match where its letters appear in order. Any doubt answers true; the grammar decides.
 */
function mayHaveOpenSection(markdown: string): boolean {
  if (markdown.includes('&')) return true;
  const lines = markdown.replace(/^\uFEFF/u, '').split(/\r\n|\r|\n/u);
  let paragraphStart = 0;
  for (const [index, line] of lines.entries()) {
    let heading: string | null = null;
    if (/^ {0,3}##(?:[ \t]|$)/u.test(line)) heading = line;
    else if (index > 0 && /^ {0,3}-+[ \t]*$/u.test(line)) heading = lines.slice(paragraphStart, index).join('\n');
    if (/^[ \t]*$/u.test(line)) paragraphStart = index + 1;
    if (heading === null) continue;
    const letters = lettersOf(heading.toLowerCase());
    if (openTitleLetters.some(title => containsInOrder(letters, title))) return true;
  }
  return false;
}

export function parseOpenQuestions(markdown: string, lang: Lang = defaultLang): OpenQuestions {
  if (!mayHaveOpenSection(markdown)) return { questions: null, warnings: [] };
  return openQuestionsOf(markdownParser.parse(markdown) as Root, lang);
}

/**
 * 2026-11-06: the same grammar over a tree the caller already parsed with markdownParser, so a mechanic file is
 * parsed once at catalog load instead of twice. Positions are unaffected by a leading BOM: micromark skips it.
 */
export function openQuestionsOf(root: Root, lang: Lang = defaultLang): OpenQuestions {
  const sections = root.children.filter(node => isSection(node, openSectionTitles)).length;
  const section = sectionBody(root, openSectionTitles);
  if (!section) return { questions: null, warnings: [] };
  const warnings: string[] = [];
  if (sections > 1) warnings.push(messages[lang].multipleSections);
  const questions = section.nodes
    .filter((node): node is List => node.type === 'list')
    .flatMap(list => list.children.map(questionOf));
  const empty = questions.filter(question => !question.text).length;
  if (empty) warnings.push(messages[lang].emptyItems(empty));
  const refs = questions.map(question => question.taskRef).filter((ref): ref is string => ref !== null);
  if (new Set(refs).size !== refs.length) warnings.push(messages[lang].reusedTask);
  const loose = section.nodes.filter(node => node.type === 'paragraph').length;
  if (loose && !questions.length) warnings.push(messages[lang].missingList);
  return { questions, warnings };
}

function lineStart(markdown: string, offset: number): number {
  return markdown.lastIndexOf('\n', offset - 1) + 1;
}

function lineEnd(markdown: string, offset: number): number {
  const next = markdown.indexOf('\n', offset);
  return next < 0 ? markdown.length : next + 1;
}

/**
 * Appends `line` (ending with its line break) after the last list of the H2 section `title`, or right under its heading.
 * null means no such section. Shared by recorded decisions and Journey lessons; other bytes stay unchanged.
 */
export function appendSectionLine(markdown: string, root: Root, title: string | readonly string[], line: string): string | null {
  const section = sectionBody(root, title);
  if (!section) return null;
  const eol = line.endsWith('\r\n') ? '\r\n' : '\n';
  const lastList = [...section.nodes].reverse().find((node): node is List => node.type === 'list');
  const anchor = lastList ?? section.heading;
  const at = lineEnd(markdown, Math.max(anchor.position!.start.offset!, anchor.position!.end.offset! - 1));
  // The section's last line may end the file without a line break; the new item must not glue onto it.
  const lineBreak = at === markdown.length && !markdown.endsWith('\n') ? eol : '';
  const gap = lastList ? '' : eol;
  return markdown.slice(0, at) + lineBreak + gap + line + markdown.slice(at);
}

/** The question at `index`, checked against the text the user saw; a mismatch means the Doc changed. */
export function findOpenQuestion(markdown: string, index: number, expectedText: string, lang: Lang = defaultLang): OpenQuestion {
  const question = parseOpenQuestions(markdown, lang).questions?.[index];
  if (!question || question.text !== expectedText.trim()) throw new Error(messages[lang].changed);
  return question;
}

/** Append the decision Task's Markdown link to the question line; no-op if already linked. */
export function linkDecisionTask(markdown: string, index: number, expectedText: string, taskCardId: string, lang: Lang = defaultLang,
  formatLanguage: FormatLanguage = 'ru'): string {
  const question = findOpenQuestion(markdown, index, expectedText, lang);
  const ref = shortReference('c', taskCardId);
  if (question.taskRef === ref) return markdown;
  if (question.taskRef) throw new Error(messages[lang].alreadyLinked);
  const firstLineEnd = lineEnd(markdown, question.start);
  const eol = markdown.slice(firstLineEnd - 2, firstLineEnd) === '\r\n' ? 2 : markdown[firstLineEnd - 1] === '\n' ? 1 : 0;
  const at = firstLineEnd - eol;
  const decisionLabel = writeMarker('decision', formatLanguage).replace(/:$/u, '');
  return markdown.slice(0, at) + ` — [${decisionLabel}](/r/${ref})` + markdown.slice(at);
}

/**
 * Record `- <answer> — <author>, <date>` under the decided section (either spelling) and remove the question and its options.
 * If missing, create the section with `writeMarker('decided', formatLanguage)` directly above the open-questions section.
 */
export function recordDecision(markdown: string, index: number, expectedText: string, answer: string, author: string, date: string, lang: Lang = defaultLang,
  formatLanguage: FormatLanguage = 'ru'): string {
  const rule = answer.replace(/\s+/gu, ' ').trim();
  if (!rule) throw new Error(messages[lang].emptyAnswer);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) throw new Error(messages[lang].invalidDate);
  const question = findOpenQuestion(markdown, index, expectedText, lang);
  const eol = markdown.includes('\r\n') ? '\r\n' : '\n';
  const line = `- ${rule} — ${author}, ${date}${eol}`;
  const removed = markdown.slice(0, lineStart(markdown, question.start)) + markdown.slice(lineEnd(markdown, Math.max(question.start, question.end - 1)));
  const root = markdownParser.parse(removed) as Root;
  const appended = appendSectionLine(removed, root, decidedSectionTitles, line);
  if (appended !== null) return appended;
  const open = sectionBody(root, openSectionTitles)!.heading;
  const at = lineStart(removed, open.position!.start.offset!);
  return removed.slice(0, at) + `## ${writeMarker('decided', formatLanguage)}${eol}${eol}${line}${eol}` + removed.slice(at);
}
