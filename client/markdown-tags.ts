export interface MarkdownTag { name: string }

/** 2026-11-05: source offsets preserve escaped hashtags after Markdown removes their backslashes. */
function escapedTagOffsets(value: string, rawValue?: string): Set<number> | null {
  const offsets = new Set<number>();
  if (rawValue === undefined) return offsets;
  let removed = 0;
  const unescaped = rawValue.replace(/\\([\u0021-\u002f\u003a-\u0040\u005b-\u0060\u007b-\u007e])/gu,
    (_match: string, punctuation: string, offset: number) => {
      if (punctuation === '#') offsets.add(offset - removed);
      removed += 1;
      return punctuation;
    });
  // Entities can change the offset mapping as well. Keep that text literal rather than guessing an escaped tag.
  return offsets.size > 0 && unescaped !== value ? null : offsets;
}

/** 2026-11-05: a CSS hex color in prose (#1a1a1a, #fff0, #cccccc) is not a tag. Short forms need a digit, so #bad and #fee stay tags. */
function isHexColor(name: string): boolean {
  return /^(?:[0-9a-f]{6}|[0-9a-f]{8})$/iu.test(name) || /^(?=.*\d)[0-9a-f]{3,4}$/iu.test(name);
}

export function splitMarkdownTags(value: string, rawValue?: string): Array<string | MarkdownTag> {
  const escaped = escapedTagOffsets(value, rawValue);
  if (escaped === null) return [value];
  const parts: Array<string | MarkdownTag> = [];
  const expression = /(^|[\s(])#([\p{L}\p{N}_][\p{L}\p{M}\p{N}_-]*)/gu;
  let position = 0;
  for (const match of value.matchAll(expression)) {
    const start = match.index + match[1].length;
    if (match[2].length > 80 || escaped.has(start) || isHexColor(match[2])) continue;
    if (start > position) parts.push(value.slice(position, start));
    parts.push({ name: match[2] });
    position = start + match[2].length + 1;
  }
  if (position < value.length) parts.push(value.slice(position));
  return parts;
}
