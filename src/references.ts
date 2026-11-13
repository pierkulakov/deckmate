// 2026-11-03: compact references are deterministic aliases, never authorization tokens.
// Resolve against the catalog and reject ambiguity; full IDs remain canonical in files.
import { defaultLang, defineText, type Lang } from './i18n.ts';
import type { DataSource } from './workspace-contracts.ts';

const text = defineText({ ambiguous: 'The short reference is ambiguous. Use the full ID.' },
  { ambiguous: 'Короткая ссылка неоднозначна. Используйте полный ID.' });

export function cardLink(ref: string, source: DataSource, fragment?: string): string {
  return `/r/${ref}?source=${source}${fragment ? `#${fragment}` : ''}`;
}

export function cardReferenceQuery(query: string): string {
  return query.match(/\bc-[a-z0-9]{10}\b/u)?.[0] ?? query;
}

export function shortReference(kind: 'c' | 'p' | 'v', id: string): string {
  let hash = 14695981039346656037n;
  for (const byte of new TextEncoder().encode(id)) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 1099511628211n);
  return `${kind}-${hash.toString(36).padStart(13, '0').slice(-10)}`;
}

export function resolveReference<T extends { id: string }>(items: T[], kind: 'c' | 'p' | 'v', reference: string, lang: Lang = defaultLang): T | null {
  const exact = items.find(item => item.id === reference);
  if (exact) return exact;
  const matches = items.filter(item => shortReference(kind, item.id) === reference);
  if (matches.length > 1) throw new Error(text[lang].ambiguous);
  return matches[0] ?? null;
}
