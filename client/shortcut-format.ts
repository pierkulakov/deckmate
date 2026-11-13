import { defineText, currentLang, type Lang } from './i18n.ts';

type ShortcutPlatform = 'mac' | 'windows' | 'unknown';
export type ShortcutModifier = 'control' | 'alt' | 'shift' | 'primary';
export interface KeyCombo {
  /** KeyboardEvent.code for physical keys, or KeyboardEvent.key for character shortcuts. */
  key: string;
  modifiers?: readonly ShortcutModifier[];
}
interface KeyPart { glyph: string }

const text = defineText({
  control: 'Control', altMac: 'Option', alt: 'Alt', shift: 'Shift', command: 'Command', primary: 'Control or Command',
  backspace: 'Backspace', enterMac: 'Return', enter: 'Enter', escape: 'Escape', space: 'Space', tab: 'Tab',
  left: 'Left arrow', right: 'Right arrow', up: 'Up arrow', down: 'Down arrow', arrows: 'Arrow keys',
  digits: 'Digits 0 through 9', priorities: 'Digits 0 through 3', slash: 'Slash', question: 'Question mark',
  comma: 'Comma', period: 'Period', equals: 'Equals', minus: 'Minus', click: 'Click', wheel: 'Mouse wheel',
}, {
  control: 'Control', altMac: 'Option', alt: 'Alt', shift: 'Shift', command: 'Command', primary: 'Control или Command',
  backspace: 'Удаление назад', enterMac: 'Return', enter: 'Enter', escape: 'Escape', space: 'Пробел', tab: 'Tab',
  left: 'Стрелка влево', right: 'Стрелка вправо', up: 'Стрелка вверх', down: 'Стрелка вниз', arrows: 'Клавиши стрелок',
  digits: 'Цифры от 0 до 9', priorities: 'Цифры от 0 до 3', slash: 'Косая черта', question: 'Знак вопроса',
  comma: 'Запятая', period: 'Точка', equals: 'Равно', minus: 'Минус', click: 'Щелчок', wheel: 'Колесо мыши',
});

function identifyPlatform(value: string | undefined): ShortcutPlatform {
  if (/^(mac|iphone|ipad|ipod)/iu.test(value ?? '')) return 'mac';
  if (/^(win|linux|x11|android|cros)/iu.test(value ?? '')) return 'windows';
  return 'unknown';
}

export function shortcutPlatform(source: { platform?: string; userAgentData?: { platform?: string } } | undefined = typeof navigator === 'undefined' ? undefined : navigator): ShortcutPlatform {
  const modern = identifyPlatform(source?.userAgentData?.platform);
  return modern === 'unknown' ? identifyPlatform(source?.platform) : modern;
}

const macModifierOrder: readonly ShortcutModifier[] = ['control', 'alt', 'shift', 'primary'];
const otherModifierOrder: readonly ShortcutModifier[] = ['control', 'primary', 'alt', 'shift'];

function modifierPart(modifier: ShortcutModifier, platform: ShortcutPlatform, lang: Lang): { part: KeyPart; name: string } {
  const t = text[lang];
  if (modifier === 'control') return { part: { glyph: platform === 'mac' ? '⌃' : 'Ctrl' }, name: t.control };
  if (modifier === 'alt') return { part: { glyph: platform === 'mac' ? '⌥' : 'Alt' }, name: platform === 'mac' ? t.altMac : t.alt };
  if (modifier === 'shift') return { part: { glyph: platform === 'mac' ? '⇧' : 'Shift' }, name: t.shift };
  if (platform === 'mac') return { part: { glyph: '⌘' }, name: t.command };
  if (platform === 'windows') return { part: { glyph: 'Ctrl' }, name: t.control };
  return { part: { glyph: 'Ctrl/⌘' }, name: t.primary };
}

function keyPart(key: string, platform: ShortcutPlatform, lang: Lang): { parts: KeyPart[]; name: string } {
  const t = text[lang];
  const mac = platform === 'mac';
  const special: Record<string, [string, string]> = {
    Backspace: [mac ? '⌫' : 'Backspace', t.backspace], Enter: [mac ? '⏎' : 'Enter', mac ? t.enterMac : t.enter],
    Escape: [mac ? '⎋' : 'Esc', t.escape], Space: [t.space, t.space], Tab: ['Tab', t.tab],
    ArrowLeft: ['←', t.left], ArrowRight: ['→', t.right], ArrowUp: ['↑', t.up], ArrowDown: ['↓', t.down],
    Digit0To9: ['0–9', t.digits], Digit0To3: ['0–3', t.priorities],
    Slash: ['/', t.slash], '/': ['/', t.slash], '?': ['?', t.question], Comma: [',', t.comma], Period: ['.', t.period], '=': ['=', t.equals], '−': ['−', t.minus],
    Click: [t.click.toLowerCase(), t.click], Wheel: [t.wheel.toLowerCase(), t.wheel],
  };
  if (key === 'ArrowKeys') return { parts: ['←', '↑', '↓', '→'].map(glyph => ({ glyph })), name: t.arrows };
  if (key === 'Primary') {
    const modifier = modifierPart('primary', platform, lang);
    return { parts: [modifier.part], name: modifier.name };
  }
  const entry = special[key];
  if (entry) return { parts: [{ glyph: entry[0] }], name: entry[1] };
  const glyph = key.replace(/^Key(?=[A-Z]$)/u, '').replace(/^Digit(?=[0-9]$)/u, '');
  return { parts: [{ glyph }], name: glyph };
}

export function formatShortcut(combo: KeyCombo, platform: ShortcutPlatform = shortcutPlatform(), lang: Lang = currentLang(), windowsLabel?: string): { parts: KeyPart[]; name: string; display: string } {
  const order = platform === 'mac' ? macModifierOrder : otherModifierOrder;
  const modifiers = order.filter(modifier => combo.modifiers?.includes(modifier)).map(modifier => modifierPart(modifier, platform, lang));
  const key = keyPart(combo.key, platform, lang);
  const separator = platform === 'mac' ? '' : '+';
  const display = [...modifiers.map(modifier => modifier.part.glyph), key.parts.map(part => part.glyph).join('')].join(separator);
  return { parts: [...modifiers.map(modifier => modifier.part), ...key.parts], name: [...modifiers.map(modifier => modifier.name), key.name].join(', '),
    display: platform !== 'mac' && windowsLabel !== undefined ? windowsLabel : display };
}

export function shortcutDisplay(combo: KeyCombo, windowsLabel?: string): string {
  return formatShortcut(combo, undefined, undefined, windowsLabel).display;
}

/** Preserve both established bindings on every platform. */
export function primaryModifierPressed(event: { ctrlKey: boolean; metaKey: boolean }): boolean {
  return event.ctrlKey || event.metaKey;
}

/** ARIA uses named modifiers and physical key values, not the visual platform glyphs. */
export function shortcutAria(combo: KeyCombo): string {
  const key = combo.key.replace(/^Key(?=[A-Z]$)/u, '').replace(/^Digit(?=[0-9]$)/u, '');
  const suffix = [...(combo.modifiers ?? []).filter(modifier => modifier !== 'primary').map(modifier => ({ control: 'Control', alt: 'Alt', shift: 'Shift' })[modifier]), key].join('+');
  return combo.modifiers?.includes('primary') ? `Control+${suffix} Meta+${suffix}` : suffix;
}
