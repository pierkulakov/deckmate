import { afterEach, describe, expect, it, vi } from 'vitest';
import { changeTheme, readThemePreference } from '../client/theme-preference.ts';

function page(options: { shell?: 'board' | 'start'; theme?: string; blocked?: boolean; fail?: boolean } = {}) {
  let dark = true;
  const attributes = new Map<string, string>();
  if (options.shell === 'start') attributes.set('data-shell-theme', options.theme ?? 'system');
  const setTheme = vi.fn(async () => options.fail ? { ok: false, code: 'save-failed' } : { ok: true });
  const storage = { getItem: vi.fn(() => { if (options.blocked) throw new Error('blocked'); return options.theme ?? null; }), setItem: vi.fn() };
  const root = { getAttribute: (name: string) => attributes.get(name) ?? null, setAttribute: (name: string, value: string) => attributes.set(name, value),
    classList: { contains: () => dark, toggle: (_name: string, value: boolean) => { dark = value; } }, style: { colorScheme: '' } };
  vi.stubGlobal('document', { documentElement: root });
  vi.stubGlobal('window', Object.assign(new EventTarget(), {
    deckmateBoard: options.shell === 'board' ? { theme: options.theme, setTheme } : undefined,
    deckmateDesktop: options.shell === 'start' ? { setTheme } : undefined,
  }));
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  return { setTheme, storage, dark: () => dark, root };
}
afterEach(() => vi.unstubAllGlobals());
describe('shared theme preference', () => {
  it.each(['board', 'start'] as const)('retains system in the %s shell instead of persisting its resolved color', async shell => {
    const app = page({ shell, theme: 'system', blocked: true });
    expect(readThemePreference()).toBe('system');
    expect(app.storage.getItem).not.toHaveBeenCalled();
    expect(app.setTheme).not.toHaveBeenCalled();
    expect(await changeTheme('system')).toEqual({ ok: true });
    expect(app.setTheme).toHaveBeenCalledExactlyOnceWith('system');
    expect(app.dark()).toBe(false);
    expect(app.root.getAttribute('data-shell-theme')).toBe('system');
    expect(app.storage.setItem).not.toHaveBeenCalled();
  });
  it('does not change the rendered theme when saving is rejected', async () => {
    const app = page({ shell: 'board', theme: 'dark', fail: true });
    expect(await changeTheme('light')).toEqual({ ok: false, code: 'save-failed' });
    expect(app.dark()).toBe(true);
    expect(app.storage.setItem).not.toHaveBeenCalled();
  });
  it('persists explicit browser choices and keeps blocked-storage defaults usable', async () => {
    const app = page({ blocked: true });
    expect(readThemePreference()).toBe('system');
    await changeTheme('system');
    expect(app.storage.setItem).toHaveBeenCalledExactlyOnceWith('deckmate-theme', 'system');
    expect(app.dark()).toBe(false);
  });
});
