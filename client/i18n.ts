// Interface language in the browser: one stored choice, React re-renders on switch, the server gets it by cookie.
import { useSyncExternalStore } from 'react';
import { defaultLang, langCookie, localeOf, parseLang, type Lang } from '../src/i18n.ts';
import { readStoredValue } from './storage.ts';

export { defineText, type Lang } from '../src/i18n.ts';

const storageKey = 'deckmate-language';
const changeEvent = 'deckmate:language';

function storedLang(): Lang {
  try { return parseLang(readStoredValue(localStorage, storageKey)); } catch { return defaultLang; }
}

let current: Lang = storedLang();
applyToDocument(current);

function applyToDocument(lang: Lang): void {
  document.documentElement.lang = lang;
  // A year: the choice outlives the session; SameSite keeps it on this local origin only.
  document.cookie = `${langCookie}=${lang}; path=/; max-age=31536000; SameSite=Strict`;
}

export function currentLang(): Lang {
  return current;
}

export function setLang(lang: Lang): void {
  if (lang === current) return;
  current = lang;
  try { localStorage.setItem(storageKey, lang); } catch { /* without storage the choice lives until reload */ }
  applyToDocument(lang);
  window.dispatchEvent(new Event(changeEvent));
}

function subscribe(listener: () => void): () => void {
  window.addEventListener(changeEvent, listener);
  return () => window.removeEventListener(changeEvent, listener);
}

/** The language for render; the component re-renders when it switches. */
export function useLang(): Lang {
  return useSyncExternalStore(subscribe, currentLang, currentLang);
}

/** A module's strings for render. */
export function useText<T>(text: Record<Lang, T>): T {
  return text[useLang()];
}

/** A module's strings outside render (helpers, handlers, menus built once): read at call time. */
export function textNow<T>(text: Record<Lang, T>): T {
  return text[current];
}

/** Locale tag for Intl formatters; pass the language from useLang() in render so formatting follows the switch. */
export function locale(lang: Lang = current): string {
  return localeOf(lang);
}
