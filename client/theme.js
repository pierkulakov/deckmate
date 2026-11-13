// 2026-11-13: all entry points resolve the theme before CSS without inline scripts or an asynchronous IPC round trip.
function deckmateDarkTheme(readSavedTheme, systemDark) {
  try {
    const saved = readSavedTheme();
    if (saved === 'light') return false;
    if (saved === 'dark') return true;
  } catch {}
  try { return systemDark(); } catch { return true; }
}

document.documentElement.classList.toggle('dark', deckmateDarkTheme(
  () => document.documentElement.getAttribute('data-shell-theme')
    ?? window.deckmateBoard?.theme
    ?? localStorage.getItem('deckmate-theme') ?? localStorage.getItem('freetion-theme'),
  () => typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)').matches : true,
));
document.documentElement.style.colorScheme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
document.documentElement.style.background = 'var(--canvas)';
document.addEventListener('DOMContentLoaded', () => document.documentElement.style.removeProperty('color-scheme'), { once: true });
