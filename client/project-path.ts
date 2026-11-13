export function projectName(path: string, name?: string): string {
  return name || path.replace(/[\\/]+$/u, '').split(/[\\/]/u).pop() || path;
}

/** 2026-11-13: middle truncation preserves the drive and folder name in narrow project rows. */
export function compactPath(path: string, limit = 30): string {
  if (path.length <= limit) return path;
  const head = Math.ceil((limit - 1) / 2);
  const tail = limit - 1 - head;
  return `${path.slice(0, head)}…${path.slice(-tail)}`;
}

/** 2026-11-13: Windows drive and UNC paths ignore case; Unix folder names must retain it. */
export function projectPathKey(path: string): string {
  return /^(?:[a-z]:[/\\]|\\\\)/iu.test(path) ? path.replaceAll('/', '\\').replace(/\\+$/u, '').toLowerCase() : path;
}
