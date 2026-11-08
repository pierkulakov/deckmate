/** Empty parent text makes a compact execution label; dialogs can still show their Hero placeholder or title. */
export function journeyStepTitle(title: string, parentTitle = '', fallback = title): string {
  const expanded = title.replaceAll('%PARENT_TITLE%', parentTitle);
  if (parentTitle) return expanded.trim() ? expanded : fallback;
  return expanded.replace(/^[\s:—–\-·,]+|[\s:—–\-·,]+$/gu, '') || fallback;
}
