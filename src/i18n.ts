// 2026-11-05: English is the default interface language; Russian is selectable.
// Shared by client and server: each module keeps its own strings next to its code, in both languages.

export type Lang = 'en' | 'ru';
export const langs: readonly Lang[] = ['en', 'ru'];
export const defaultLang: Lang = 'en';
/** The client stores the choice here as well, so server messages, journal lines and errors follow the switch. */
export const langCookie = 'deckmate-lang';

// Templates take arguments of any shape; `never[]` lets every concrete signature in while still requiring a function.
type Message = string | ((...args: never[]) => string);
type Messages = Record<string, Message>;
/** Same keys, same shapes, any wording: a Russian side that misses a key or changes a signature does not compile. */
type Translation<T extends Messages> = { [K in keyof T]: T[K] extends string ? string : T[K] };

/** One module's strings. English first — it is the default and the reference for the keys. */
export function defineText<T extends Messages>(en: T, ru: Translation<T>): Record<Lang, Translation<T>> {
  return { en: en as Translation<T>, ru };
}

export function parseLang(value: string | null | undefined): Lang {
  return value === 'ru' ? 'ru' : defaultLang;
}

/** Locale tag for Intl formatters (dates, numbers, relative time, plural rules). */
export function localeOf(lang: Lang): string {
  return lang === 'ru' ? 'ru-RU' : 'en-US';
}
