import type { HeadlessPage } from '../../tools/headless-browser.ts';

/** 2026-11-13: Radix opens on pointer-down or a key, while click() alone bypasses the trigger's real activation. */
export async function selectPageTheme(page: HeadlessPage, theme: string): Promise<void> {
  await page.evaluate(`document.querySelector('button[aria-label="Theme"], button[aria-label="Тема"]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }))`);
  const deadline = Date.now() + 5000;
  while (!await page.evaluate(`document.querySelectorAll('.theme-toggle-choice').length === 3`)) {
    if (Date.now() >= deadline) throw new Error('Theme menu did not open');
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  await page.callFunction(`index => document.querySelectorAll('.theme-toggle-choice')[index].click()`, ['light', 'dark', 'system'].indexOf(theme));
}
