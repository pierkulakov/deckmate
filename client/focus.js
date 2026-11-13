// 2026-11-13: Tab starts visible navigation; Escape restores reading focus without turning a shortcut into navigation.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('keydown', event => {
    if (event.key === 'Tab' && !event.altKey && !event.ctrlKey && !event.metaKey) document.documentElement.setAttribute('data-tab-focus', '');
    if (event.key === 'Escape') document.documentElement.removeAttribute('data-tab-focus');
  }, true);
  window.addEventListener('pointerdown', () => document.documentElement.removeAttribute('data-tab-focus'), true);
}
