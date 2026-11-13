import { useMemo, useRef } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { moveFocus } from '../focus.ts';
import { useText } from '../i18n.ts';
import { desktopBoard } from '../desktop-bridge.ts';
import { shortcutGroupsFor, type ShortcutDefinition, type ShortcutScreen } from '../keyboard-shortcuts.ts';
import { prepareEntrance, usePreparedEntrance } from '../prepared-motion.ts';
import { formatShortcut, shortcutDisplay, type KeyCombo } from '../shortcut-format.ts';
import { Button } from './ui/button.tsx';
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

export function ShortcutsHelpDialog({ open, screens, writable, vision, opener, onClose }: {
  open: boolean; screens: readonly ShortcutScreen[]; writable: boolean; vision: boolean; opener: HTMLElement | null; onClose: () => void;
}) {
  const t = useText(shortcutsHelpText);
  const content = useRef<HTMLDivElement>(null);
  const attachContent = usePreparedEntrance(content);
  const groups = useMemo(() => shortcutGroupsFor(screens, writable), [screens, writable]);
  function windowsLabel(combo: KeyCombo) {
    if (combo.key === 'ArrowKeys') return t.arrows;
    if (combo.key === 'Space') return t.space;
    if (combo.key === 'KeyA' && combo.modifiers?.includes('primary')) return t.selectAllKeys;
    return undefined;
  }
  return <Dialog.Root open={open} onOpenChange={next => { if (!next) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay ref={prepareEntrance} className="shortcuts-panel-overlay" />
      <Dialog.Content ref={attachContent} className="shortcuts-panel dialog-panel" tabIndex={-1}
        onOpenAutoFocus={event => { event.preventDefault(); moveFocus(content.current); }}
        onCloseAutoFocus={event => { event.preventDefault(); if (opener?.isConnected) moveFocus(opener, { preventScroll: true }); }}>
        <header className="dialog-head">
          <div className="shortcuts-panel-heading">
            <Dialog.Title className="dialog-title">{t.title}</Dialog.Title>
            <Dialog.Description className="shortcuts-panel-caption">{t.description}</Dialog.Description>
          </div>
          <Dialog.Close asChild><Button type="button" variant="ghost" size="icon" className="shortcuts-panel-close" aria-label={t.close}><X size={17} /></Button></Dialog.Close>
        </header>
        <div className="shortcuts-panel-body dialog-body">
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
        </div>
        <footer className="shortcuts-panel-foot dialog-foot">
          Deckmate · {t.license} · <a href="https://github.com/pierkulakov/deckmate" target="_blank" rel="noreferrer noopener">{t.sourceCode}</a>
        </footer>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
