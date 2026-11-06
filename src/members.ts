import type { CatalogMember } from './catalog-contracts.ts';

/** Registry member ID, the same rule as the members schema of the manifest. */
export const memberIdPattern = /^[a-z0-9][a-z0-9-]{0,79}$/u;

export function resolveMember(raw: string | null | undefined, members: CatalogMember[]): string | null {
  if (!raw?.trim()) return null;
  const text = raw.trim().toLocaleLowerCase('ru-RU');
  const matches = members.filter(member => [member.label, ...member.aliases].some(value => {
    const alias = value.trim().toLocaleLowerCase('ru-RU');
    if (!alias) return false;
    if (text === alias) return true;
    // 2026-11-03: an explicit leading assignee can have notes; mentions later in a note are not assignments.
    return text.startsWith(alias) && !/[\p{L}\p{N}_-]/u.test(text.charAt(alias.length));
  }));
  return matches.length === 1 ? matches[0].label : null;
}

/** The registry ID behind an Owner text, or null when it names no single member (notifications, the Decks pulse). */
export function memberIdForOwner(owner: string | null | undefined, members: CatalogMember[]): string | null {
  const label = resolveMember(owner, members);
  return label ? members.find(member => member.label === label)?.id ?? null : null;
}
