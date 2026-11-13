import { useEffect, useState } from 'react';
import { desktopPreferences, type DesktopResult, type ThemePreference } from './desktop-bridge.ts';
import { readStoredValue } from './storage.ts';

const changeEvent = 'deckmate:theme';
export function readThemePreference(): ThemePreference {
  let saved = desktopPreferences()?.theme ?? document.documentElement.getAttribute('data-shell-theme');
  if (!saved) {
    try { saved = readStoredValue(localStorage, 'deckmate-theme'); } catch {}
  }
  return saved === 'light' || saved === 'dark' ? saved : 'system';
}

function applyTheme(theme: ThemePreference) {
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
}

export async function changeTheme(theme: ThemePreference): Promise<DesktopResult> {
  const shell = desktopPreferences();
  if (shell?.setTheme) {
    const result = await shell.setTheme(theme);
    if (!result.ok) return result;
    document.documentElement.setAttribute('data-shell-theme', theme);
  } else {
    try { localStorage.setItem('deckmate-theme', theme); } catch {}
  }
  applyTheme(theme);
  window.dispatchEvent(new CustomEvent(changeEvent, { detail: theme }));
  return { ok: true };
}

export function useTheme() {
  const [theme, setTheme] = useState(readThemePreference);
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    let preference = readThemePreference();
    const update = (next: ThemePreference) => {
      preference = next;
      applyTheme(next);
      setTheme(next);
      setDark(document.documentElement.classList.contains('dark'));
    };
    const systemChanged = () => { if (preference === 'system') update('system'); };
    const changed = (event: Event) => update((event as CustomEvent<ThemePreference>).detail);
    const shellChanged = (event: Event) => {
      const next = (event as CustomEvent<{ theme?: ThemePreference }>).detail?.theme;
      if (next === 'light' || next === 'dark' || next === 'system') {
        document.documentElement.setAttribute('data-shell-theme', next);
        update(next);
      }
    };
    // 2026-11-13: native menu scripts can update the root class before the preference event arrives.
    const observer = new MutationObserver(() => setDark(document.documentElement.classList.contains('dark')));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    media.addEventListener('change', systemChanged);
    window.addEventListener(changeEvent, changed);
    window.addEventListener('deckmate:display', shellChanged);
    // 2026-11-13: the blocking theme script already painted the document; mounting controls must not repaint it.
    setTheme(preference);
    setDark(document.documentElement.classList.contains('dark'));
    return () => {
      observer.disconnect(); media.removeEventListener('change', systemChanged);
      window.removeEventListener(changeEvent, changed); window.removeEventListener('deckmate:display', shellChanged);
    };
  }, []);
  return { theme, dark };
}
