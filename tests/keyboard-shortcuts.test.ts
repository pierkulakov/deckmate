import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
vi.stubGlobal('window', { dispatchEvent: () => true, addEventListener: () => undefined, removeEventListener: () => undefined });

const { setLang } = await import('../client/i18n.ts');
const { ALL_SHORTCUTS, OPEN_CARD_SHORTCUTS, matchShortcut, shortcutGroupsFor } = await import('../client/keyboard-shortcuts.ts');

beforeEach(() => setLang('en'));
afterAll(() => vi.unstubAllGlobals());

describe('shortcut labels and matching', () => {
  it('resolves labels after a language switch while preserving registry identity and matching', () => {
    const event = { code: 'KeyW', key: 'ц', altKey: false, ctrlKey: false, metaKey: false, shiftKey: false } as KeyboardEvent;
    const shortcut = matchShortcut(event, OPEN_CARD_SHORTCUTS);
    expect(shortcut?.id).toBe('open-card-done');
    expect(shortcut?.label).toBe('Set the task to Done or back to Not started');

    setLang('ru');
    expect(matchShortcut(event, OPEN_CARD_SHORTCUTS)).toBe(shortcut);
    // The Russian side now uses its arguments, so the label follows the language switch.
    expect(shortcut?.label).toBe('Перевести задачу в «Принято» или обратно в «План»');
    expect(ALL_SHORTCUTS.find(item => item.id === shortcut?.id)).toBe(shortcut);
  });

  it('keeps screen and write-permission filtering intact in both languages', () => {
    for (const lang of ['en', 'ru'] as const) {
      setLang(lang);
      const readOnly = shortcutGroupsFor(['app', 'cards'], false).flatMap(group => group.items);
      const writable = shortcutGroupsFor(['app', 'cards'], true).flatMap(group => group.items);
      expect(readOnly.every(item => !item.edits && (item.screen === 'app' || item.screen === 'cards'))).toBe(true);
      expect(readOnly.some(item => item.id === 'focus-search')).toBe(true);
      expect(readOnly.some(item => item.id === 'new-card')).toBe(false);
      expect(writable.some(item => item.id === 'new-card')).toBe(true);
      expect(writable.some(item => item.id === 'open-card-done')).toBe(false);
    }
  });
});
