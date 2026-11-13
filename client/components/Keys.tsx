import { useLang } from '../i18n.ts';
import { Fragment } from 'react';
import { formatShortcut, shortcutPlatform, type KeyCombo } from '../shortcut-format.ts';
import '../keys.css';

function macGlyphs(value: string) {
  return Array.from(value, (glyph, index) => /[⌃⌥⇧⌘⏎⎋⌫]/u.test(glyph)
    ? <span className="key-mac-symbol" data-glyph={glyph} key={index}>{glyph}</span>
    : glyph);
}

export function Keys({ combo, className, variant = 'key', windowsLabel, ariaHidden = false }: {
  combo: KeyCombo; className?: string; variant?: 'key' | 'separate' | 'text'; windowsLabel?: string; ariaHidden?: boolean;
}) {
  const lang = useLang();
  const platform = shortcutPlatform();
  const formatted = formatShortcut(combo, platform, lang, windowsLabel);
  const display = formatted.display;
  const label = ariaHidden ? { 'aria-hidden': true as const } : { 'aria-label': formatted.name };
  const modifierCount = new Set(combo.modifiers).size;
  if (variant === 'text') return <span className={className} role="group" {...label}>{display}</span>;
  if (variant === 'separate') return <span className={className} role="group" {...label}>
    {formatted.parts.map((part, index) => <Fragment key={index}>{index > 0 && index <= modifierCount && platform !== 'mac' && '+'}<kbd aria-hidden="true">{platform === 'mac' ? macGlyphs(part.glyph) : part.glyph}</kbd></Fragment>)}
  </span>;
  return <kbd className={className} role={ariaHidden ? undefined : 'group'} {...label}>{platform === 'mac' ? macGlyphs(display) : display}</kbd>;
}
