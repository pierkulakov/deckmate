import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.hoisted(() => {
  vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
  vi.stubGlobal('localStorage', { getItem: () => null });
});

import { formatShortcut, shortcutAria, shortcutDisplay, shortcutPlatform } from '../client/shortcut-format.ts';
import { Keys } from '../client/components/Keys.tsx';

describe('platform-aware physical keycaps', () => {
  it('prefers known userAgentData and falls back to navigator.platform', () => {
    expect(shortcutPlatform({ userAgentData: { platform: 'macOS' }, platform: 'Win32' })).toBe('mac');
    expect(shortcutPlatform({ userAgentData: { platform: 'unknown' }, platform: 'Linux x86_64' })).toBe('windows');
    expect(shortcutPlatform({ platform: 'mystery' })).toBe('unknown');
  });

  it('sorts the Mac modifiers and gives words rather than glyphs in both languages', () => {
    const combo = { key: 'KeyS', modifiers: ['primary', 'shift', 'alt', 'control'] } as const;
    expect(formatShortcut(combo, 'mac', 'en').parts.map(part => part.glyph)).toEqual(['⌃', '⌥', '⇧', '⌘', 'S']);
    expect(formatShortcut(combo, 'mac', 'en').name).toBe('Control, Option, Shift, Command, S');
    expect(formatShortcut(combo, 'mac', 'en').display).toBe('⌃⌥⇧⌘S');
    expect(formatShortcut({ key: 'ArrowLeft', modifiers: ['primary', 'alt'] }, 'mac', 'ru').name).toBe('Option, Command, Стрелка влево');
    expect(formatShortcut({ key: 'Space' }, 'mac', 'ru').name).toBe('Пробел');
  });

  it('uses native labels on Windows and a neutral primary on unknown systems', () => {
    expect(formatShortcut({ key: 'Enter', modifiers: ['shift', 'primary'] }, 'windows', 'en').parts.map(part => part.glyph)).toEqual(['Ctrl', 'Shift', 'Enter']);
    expect(formatShortcut({ key: 'Enter', modifiers: ['shift', 'primary'] }, 'windows', 'en').display).toBe('Ctrl+Shift+Enter');
    expect(formatShortcut({ key: 'Backspace' }, 'mac', 'en').parts[0].glyph).toBe('⌫');
    expect(formatShortcut({ key: 'Enter' }, 'mac', 'en').parts[0].glyph).toBe('⏎');
    expect(formatShortcut({ key: 'Escape' }, 'mac', 'en').parts[0].glyph).toBe('⎋');
    expect(formatShortcut({ key: 'Backspace' }, 'windows', 'ru')).toMatchObject({ parts: [{ glyph: 'Backspace' }], name: 'Удаление назад' });
    expect(formatShortcut({ key: 'Escape' }, 'windows', 'en').parts[0].glyph).toBe('Esc');
    expect(formatShortcut({ key: 'KeyA', modifiers: ['primary'] }, 'unknown', 'ru')).toMatchObject({ parts: [{ glyph: 'Ctrl/⌘' }, { glyph: 'A' }], name: 'Control или Command, A' });
    expect(shortcutAria({ key: 'KeyA', modifiers: ['primary'] })).toBe('Control+A Meta+A');
  });

  it('keeps the existing single-chip, separate-key and plain-text presentations', () => {
    vi.stubGlobal('navigator', { platform: 'Win32' });
    expect(renderToStaticMarkup(<Keys className="shortcuts-panel-key" combo={{ key: 'Digit1', modifiers: ['shift'] }} />))
      .toBe('<kbd class="shortcuts-panel-key" role="group" aria-label="Shift, 1">Shift+1</kbd>');
    expect(renderToStaticMarkup(<Keys variant="separate" combo={{ key: 'Enter', modifiers: ['primary'] }} />))
      .toContain('<kbd aria-hidden="true">Ctrl</kbd>+<kbd aria-hidden="true">Enter</kbd>');
    expect(renderToStaticMarkup(<Keys variant="text" combo={{ key: 'Enter', modifiers: ['primary'] }} />)).toContain('>Ctrl+Enter</span>');
    expect(shortcutDisplay({ key: 'KeyA', modifiers: ['primary'] }, 'Ctrl/Cmd+A')).toBe('Ctrl/Cmd+A');
    expect(renderToStaticMarkup(<Keys variant="text" combo={{ key: 'Enter', modifiers: ['primary'] }} windowsLabel="Ctrl/Cmd+Enter" />))
      .toBe('<span role="group" aria-label="Control, Enter">Ctrl/Cmd+Enter</span>');
    expect(renderToStaticMarkup(<Keys variant="separate" combo={{ key: 'Enter', modifiers: ['primary'] }} windowsLabel="Ctrl/Cmd+Enter" />))
      .toContain('<kbd aria-hidden="true">Ctrl</kbd>+<kbd aria-hidden="true">Enter</kbd>');
    expect(shortcutDisplay({ key: 'KeyA' }, '')).toBe('');
  });

  it('renders Mac symbols with accessible words and without plus signs', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel' });
    const html = renderToStaticMarkup(<Keys variant="separate" combo={{ key: 'Enter', modifiers: ['primary'] }} />);
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Command, Return"');
    expect(html.match(/aria-hidden="true"/gu)).toHaveLength(2);
    expect(html).toContain('⌘');
    expect(html).toContain('⏎');
    expect(html).not.toContain('+');
    const chip = renderToStaticMarkup(<Keys className="shortcuts-panel-key" combo={{ key: 'Digit1', modifiers: ['shift'] }} />);
    expect(chip).toContain('data-glyph="⇧"');
    expect(chip).not.toContain('+');
    expect(shortcutDisplay({ key: 'KeyA', modifiers: ['primary'] }, 'Ctrl/Cmd+A')).toBe('⌘A');
    expect(renderToStaticMarkup(<Keys variant="text" combo={{ key: 'KeyA', modifiers: ['primary'] }} windowsLabel="Ctrl/Cmd+A" />)).toContain('>⌘A</span>');
    vi.unstubAllGlobals();
  });
});
