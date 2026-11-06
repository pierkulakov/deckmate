/**
 * Words of the project file format in two languages (2026-11-05).
 *
 * Inside the code a card state is always its English id. Project files speak one language: readers accept the words of
 * both languages everywhere, writers use the project's own. A project created on or after 2026-11-05 records
 * `formatLanguage: en` in its manifest; a manifest without the field predates it and is Russian; a folder without a
 * manifest is new and writes English.
 */
export const formatLanguages = ['en', 'ru'] as const;
export type FormatLanguage = typeof formatLanguages[number];

// 'wont-do' marks work that was decided against; it is not a board column (2026-11-05, kept from the legacy «не делаем» mark).
export const cardStates = ['not-started', 'discussing', 'in-iteration', 'started', 'review', 'done', 'wont-do'] as const;
export type CardState = typeof cardStates[number];

const stateWords: Record<FormatLanguage, Record<CardState, string>> = {
  en: { 'not-started': 'not-started', discussing: 'discussing', 'in-iteration': 'in-iteration', started: 'started', review: 'review', done: 'done', 'wont-do': 'wont-do' },
  ru: { 'not-started': 'план', discussing: 'обсуждаем', 'in-iteration': 'итерация', started: 'в работе', review: 'приёмка', done: 'принято', 'wont-do': 'не делаем' },
};

const stateByWord = new Map<string, CardState>([
  ...formatLanguages.flatMap(language => cardStates.map(state => [stateWords[language][state], state] as const)),
  // Legacy slice headings predate the six-state vocabulary.
  ['сделано', 'done'] as const,
]);

/** Every accepted heading spelling, including legacy aliases. */
export function cardStateMarkWords(): string[] {
  // The old Russian grammar leaves "(план)" in a slice title; an unmarked slice is already not-started.
  return [...stateByWord.keys()].filter(word => word !== stateWords.ru['not-started']);
}

/** A state written in either language, or undefined for any other text. */
export function readCardState(word: string): CardState | undefined {
  return stateByWord.get(word.trim().toLowerCase());
}

/** The word a project of this language stores for the state. */
export function writeCardState(state: CardState, language: FormatLanguage): string {
  return stateWords[language][state];
}

/** Every stored spelling of the state, for search keywords and validation messages. */
export function cardStateWords(state: CardState): string[] {
  return formatLanguages.map(language => stateWords[language][state]);
}

/**
 * Markdown markers the format recognizes: the open-questions section of a Doc, the decision task title, a workflow assignment,
 * the section of recorded answers in a rule Doc, and the lessons section of a Journey step (the last two since 2026-11-05).
 */
export const formatMarkers = {
  openQuestions: { en: 'Open questions', ru: 'Открыто' },
  decision: { en: 'Decision:', ru: 'Решение:' },
  assignment: { en: 'Assignment:', ru: 'Задание:' },
  decided: { en: 'Decided', ru: 'Решено' },
  lessons: { en: 'Lessons', ru: 'Грабли' },
} as const satisfies Record<string, Record<FormatLanguage, string>>;
export type FormatMarker = keyof typeof formatMarkers;

/** All spellings a reader accepts for the marker. */
export function markerWords(marker: FormatMarker): string[] {
  return formatLanguages.map(language => formatMarkers[marker][language]);
}

/** The spelling a writer uses in a project of this language. */
export function writeMarker(marker: FormatMarker, language: FormatLanguage): string {
  return formatMarkers[marker][language];
}

/** The project's language from its manifest; `undefined` means no manifest yet, which is a new project. */
export function projectFormatLanguage(manifest: { formatLanguage?: unknown } | undefined): FormatLanguage {
  if (!manifest) return 'en';
  return manifest.formatLanguage === 'en' ? 'en' : 'ru';
}
