import { moveFocus } from './focus.ts';

// The temporary field stays inside a focus-trapped dialog when the action starts there.
function copyWithSelection(value: string): boolean {
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const host = previous?.closest<HTMLElement>('[role="dialog"]') ?? document.body;
  const field = document.createElement('textarea');
  field.value = value;
  field.readOnly = true;
  field.setAttribute('aria-hidden', 'true');
  Object.assign(field.style, { position: 'fixed', left: '-9999px', top: '0' });
  host.append(field);
  try {
    moveFocus(field, { preventScroll: true, quiet: true });
    field.select();
    return typeof document.execCommand === 'function' && document.execCommand('copy');
  } catch {
    return false;
  } finally {
    field.remove();
    if (previous?.isConnected) moveFocus(previous, { preventScroll: true });
  }
}

export async function copyText(value: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return copyWithSelection(value);
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return copyWithSelection(value);
  }
}
