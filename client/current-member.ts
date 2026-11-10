import { readStoredValue } from './storage.ts';
import type { CatalogMember } from '../src/catalog-contracts.ts';

// 2026-11-10: only the explicit acting-member picker changes authorship; viewing another Hand does not.
// General edits retain the registry fallback; a human decision requires an explicit choice in its form.
const storageKey = 'deckmate-current-member';
const changeEvent = 'deckmate:current-member';

export function storedMemberId(): string | null {
  try { return readStoredValue(localStorage, storageKey); } catch { return null; }
}

export function rememberMember(memberId: string): void {
  try { localStorage.setItem(storageKey, memberId); } catch { /* Without localStorage, the choice lasts until reload. */ }
  window.dispatchEvent(new CustomEvent<string>(changeEvent, { detail: memberId }));
}

export function onMemberChange(listener: (memberId: string) => void): () => void {
  const handle = (event: Event) => listener((event as CustomEvent<string>).detail);
  window.addEventListener(changeEvent, handle);
  return () => window.removeEventListener(changeEvent, handle);
}

export function currentMember<Member extends Pick<CatalogMember, 'id' | 'kind'>>(members: Member[]): Member | null {
  const stored = storedMemberId();
  return members.find(member => member.id === stored) ?? members.find(member => member.kind === 'human') ?? members[0] ?? null;
}

/** Mutations name their author, so the journal tells one's own changes from others' and notifications skip them. */
export function actorHeaders(members?: Pick<CatalogMember, 'id' | 'kind'>[]): Record<string, string> {
  const memberId = members ? currentMember(members)?.id : storedMemberId();
  return memberId ? { 'x-deckmate-actor': memberId } : {};
}
