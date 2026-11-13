import { useMemo } from 'react';
import { useText } from '../i18n.ts';
import { desktopBoard } from '../desktop-bridge.ts';
import { shortcutGroupsFor, type ShortcutDefinition, type ShortcutScreen } from '../keyboard-shortcuts.ts';
import { formatShortcut, shortcutDisplay, type KeyCombo } from '../shortcut-format.ts';
import { Keys } from './Keys.tsx';
import { shortcutsHelpText } from './shortcuts-help-text.ts';

function rowsOf(items: readonly ShortcutDefinition[]) {
  const rows: { label: string; keys: KeyCombo[] }[] = [];
  for (const item of items) {
    const last = rows[rows.length - 1];
    if (last?.label === item.label) last.keys.push(item.combo);
    else rows.push({ label: item.label, keys: [item.combo] });
  }
  return rows;
}

export function ShortcutsHelpContent({ screens, writable, vision }: {
  screens: readonly ShortcutScreen[]; writable: boolean; vision: boolean;
}) {
  const t = useText(shortcutsHelpText);
  const groups = useMemo(() => shortcutGroupsFor(screens, writable), [screens, writable]);
  function windowsLabel(combo: KeyCombo) {
    if (combo.key === 'ArrowKeys') return t.arrows;
    if (combo.key === 'Space') return t.space;
    if (combo.key === 'KeyA' && combo.modifiers?.includes('primary')) return t.selectAllKeys;
    return undefined;
  }
  return <div className="shortcuts-panel-body dialog-body">
    {vision && <p className="shortcuts-panel-note">{t.canvasHelp(formatShortcut({ key: '?' }).display)}</p>}
    {vision && desktopBoard() && <>
      <p className="shortcuts-panel-note">{t.desktopPalette(formatShortcut({ key: '/', modifiers: ['control'] }).display, formatShortcut({ key: 'KeyP', modifiers: ['control', 'shift'] }).display)}</p>
      <p className="shortcuts-panel-note">{t.desktopZoom(formatShortcut({ key: '=', modifiers: ['control'] }).display, formatShortcut({ key: '−', modifiers: ['control'] }).display, formatShortcut({ key: 'Digit0', modifiers: ['control'] }).display, shortcutDisplay({ key: 'Wheel', modifiers: ['control'] }, t.wheelKeys))}</p>
    </>}
    {groups.map(group => <section className="shortcuts-panel-group" key={group.id} aria-labelledby={'shortcuts-group-' + group.id}>
      <h3 className="panel-title" id={'shortcuts-group-' + group.id}>{group.title}</h3>
      <ul>
        {rowsOf(group.items).map(row => <li key={row.label}>
          <span className="shortcuts-panel-keys">{row.keys.map((combo, index) => <Keys className="shortcuts-panel-key" combo={combo} key={index} windowsLabel={windowsLabel(combo)} />)}</span>
          <span className="shortcuts-panel-label">{row.label}</span>
        </li>)}
      </ul>
    </section>)}
  </div>;
}
