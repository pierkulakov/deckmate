type ProjectKey = Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>;
export type ProjectListCommand = { kind: 'focus' | 'move'; index: number } | { kind: 'remove' };

export function projectListCommand(event: ProjectKey, index: number, count: number): ProjectListCommand | null {
  if (index < 0 || count === 0 || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  const direction = event.key === 'ArrowUp' ? -1 : 1;
  if (event.altKey) {
    if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return null;
    const target = index + direction;
    return target >= 0 && target < count ? { kind: 'move', index: target } : null;
  }
  if (event.key === 'Delete' || event.key === 'Backspace') return { kind: 'remove' };
  if (event.key === 'Home') return { kind: 'focus', index: 0 };
  if (event.key === 'End') return { kind: 'focus', index: count - 1 };
  if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return null;
  return { kind: 'focus', index: Math.max(0, Math.min(count - 1, index + direction)) };
}

export function projectShortcutIndex(event: ProjectKey, count: number): number | null {
  if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || !/^[1-9]$/u.test(event.key)) return null;
  const index = Number(event.key) - 1;
  return index < count ? index : null;
}
