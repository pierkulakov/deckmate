// Journey lessons live at the end of the step text under the lessons marker («Lessons»/«Грабли»), without a separate field.
// Each item is `- <text> — <author>, <YYYY-MM-DD> ($c-<source card>)`.
// The step panel shows the section as written; apply-journey copies it to each new Task for that step.
import type { Root } from 'mdast';
import { markdownParser } from './markdown-model.ts';
import { appendSectionLine } from './open-questions.ts';
import { shortReference } from './references.ts';
import { defaultLang, defineText, type Lang } from './i18n.ts';
import { markerWords, writeMarker, type FormatLanguage } from './format-vocabulary.ts';

const messages = defineText({
  empty: 'The lesson is empty.',
  tooLong: (limit: number) => `A lesson must be one line, up to ${limit} characters.`,
  invalidDate: 'The lesson date must use YYYY-MM-DD.',
}, {
  empty: 'Текст грабель пустой.',
  tooLong: (limit: number) => `Грабли — одна строка до ${limit} символов.`,
  invalidDate: 'Дата грабель — в виде ГГГГ-ММ-ДД.',
});

export const lessonMaxLength = 500;

/** Collapse line breaks and repeated spaces; reject empty or overlong lessons. */
export function lessonText(text: string, lang: Lang = defaultLang): string {
  const line = text.replace(/\s+/gu, ' ').trim();
  if (!line) throw new Error(messages[lang].empty);
  if (line.length > lessonMaxLength) throw new Error(messages[lang].tooLong(lessonMaxLength));
  return line;
}

/**
 * Append a lesson to the lessons section, creating it at the end of the text if missing.
 * An existing section is found under either language's marker; a new heading is written in the project's format language.
 * An identical line (text, author, date, and card) is a no-op, so retries do not create duplicates.
 */
export function appendJourneyLesson(markdown: string, text: string, author: string, date: string, cardId: string, lang: Lang = defaultLang,
  formatLanguage: FormatLanguage): string {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) throw new Error(messages[lang].invalidDate);
  const eol = markdown.includes('\r\n') ? '\r\n' : '\n';
  const item = `- ${lessonText(text, lang)} — ${author}, ${date} ($${shortReference('c', cardId)})`;
  if (markdown.split(/\r?\n/u).includes(item)) return markdown;
  const appended = appendSectionLine(markdown, markdownParser.parse(markdown) as Root, markerWords('lessons'), item + eol);
  if (appended !== null) return appended;
  const separator = !markdown || markdown.endsWith(eol + eol) ? '' : markdown.endsWith('\n') ? eol : eol + eol;
  return `${markdown}${separator}## ${writeMarker('lessons', formatLanguage)}${eol}${eol}${item}${eol}`;
}
