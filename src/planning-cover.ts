/** Shared cover contract for planning forms and registry validation, 2026-11-05. */
export function validPlanningCover(value: string): boolean {
  if (value.length > 2000 || /[\u0000-\u0020\\]/u.test(value)) return false;
  if (!value) return true;
  if (/^https:\/\//iu.test(value)) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password;
    } catch { return false; }
  }
  return !/^(?:\/|[a-z][a-z\d+.-]*:)/iu.test(value)
    && value.split('/').every(part => Boolean(part) && part !== '..' && part !== '.');
}
