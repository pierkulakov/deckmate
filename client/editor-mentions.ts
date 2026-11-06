import type { CatalogMember } from '../src/catalog-contracts.ts';

export function editorMentionNames(members: CatalogMember[]) {
  const names = new Map<string, CatalogMember | null>();
  for (const member of members) {
    for (const name of [member.label, member.id, ...member.aliases]) {
      const normalized = name.trim().toLocaleLowerCase();
      if (!normalized) continue;
      const existing = names.get(normalized);
      names.set(normalized, existing !== undefined && existing?.id !== member.id ? null : member);
    }
  }
  return [...names].filter((entry): entry is [string, CatalogMember] => entry[1] !== null).sort((left, right) => right[0].length - left[0].length);
}

export function splitEditorMentions(text: string, names: ReturnType<typeof editorMentionNames>): (string | CatalogMember)[] {
  const parts: (string | CatalogMember)[] = [];
  const lower = text.toLocaleLowerCase();
  let cursor = 0;
  let plainStart = 0;
  while (cursor < text.length) {
    if (text[cursor] !== '@' || (cursor > 0 && /[\p{L}\p{N}_@./\\-]/u.test(text[cursor - 1]))) { cursor++; continue; }
    const match = names.find(([name]) => lower.startsWith(name, cursor + 1) && !/[\p{L}\p{N}_-]/u.test(text[cursor + name.length + 1] ?? ''));
    if (!match) { cursor++; continue; }
    parts.push(text.slice(plainStart, cursor), match[1]);
    cursor += match[0].length + 1;
    plainStart = cursor;
  }
  parts.push(text.slice(plainStart));
  return parts;
}
