// 2026-11-09: the launcher and board share this blocking script because the desktop CSP forbids inline scripts.
// Dark stays the default without a saved choice, as before; the system preference is only a seam for a later decision.
function deckmateDarkTheme(readSavedTheme, systemDark) {
  try {
    const saved = readSavedTheme();
    if (saved === 'light') return false;
    if (saved === 'dark') return true;
  } catch {}
  return true;
}

document.documentElement.classList.toggle('dark', deckmateDarkTheme(
  () => localStorage.getItem('deckmate-theme') ?? localStorage.getItem('freetion-theme'),
  () => typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)').matches : true,
));
document.documentElement.style.colorScheme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
document.documentElement.style.background = 'var(--canvas)';
document.addEventListener('DOMContentLoaded', () => document.documentElement.style.removeProperty('color-scheme'), { once: true });
