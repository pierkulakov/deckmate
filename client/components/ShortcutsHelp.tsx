import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Tooltip from '@radix-ui/react-tooltip';
import { Info, Keyboard, X } from 'lucide-react';
import { defineText, useText } from '../i18n.ts';
import { matchShortcut, shortcutGroupsFor, shortcutTargetBlocked, type ShortcutDefinition, type ShortcutScreen } from '../keyboard-shortcuts.ts';
import { emitSignal } from '../onboarding/signals.ts';
import { DeckHeaderHint } from './Deck.tsx';
import { Button } from './ui/button.tsx';
import '../shortcuts-help.css';

const text = defineText({
  hint: 'See currently available shortcuts',
  show: 'See shortcuts',
  title: 'Available shortcuts',
  close: 'Close',
  description: 'This is a list of all available shortcuts for the current screen. Open this menu on another screen to see more shortcuts.',
}, {
  hint: 'Посмотреть доступные комбинации клавиш',
  show: 'Комбинации клавиш',
  title: 'Доступные комбинации клавиш',
  close: 'Закрыть',
  description: 'Это список всех комбинаций клавиш текущего экрана. Откройте меню на другом экране, чтобы увидеть больше.',
});

interface ShortcutsHelpProps {
  /** Show only shortcuts for the user's current screens. */
  screens: readonly ShortcutScreen[];
  /** Editing permission: shortcuts that mutate data stay hidden and inactive without it. */
  writable: boolean;
}

/** Shortcuts with the same label (O and Enter) share one row with two key chips. */
function rowsOf(items: readonly ShortcutDefinition[]) {
  const rows: { label: string; keys: string[] }[] = [];
  for (const item of items) {
    const last = rows.at(-1);
    if (last?.label === item.label) last.keys.push(item.keys);
    else rows.push({ label: item.label, keys: [item.keys] });
  }
  return rows;
}

// The keyboard button sits at the bottom left after page content; "?" toggles the dialog and Escape closes it.
// The dialog uses keyboard-shortcuts.ts as the single registry and shows only the current screen's shortcuts.
export function ShortcutsHelp({ screens, writable }: ShortcutsHelpProps) {
  const t = useText(text);
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function toggle(event: KeyboardEvent) {
      if (matchShortcut(event)?.id !== 'shortcuts-overview') return;
      // The open panel is a dialog itself, so the shared «dialog open» check would swallow the closing «?».
      if (open ? event.repeat : shortcutTargetBlocked(event)) return;
      event.preventDefault();
      if (!open) opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setOpen(!open);
    }
    window.addEventListener('keydown', toggle);
    return () => window.removeEventListener('keydown', toggle);
  }, [open]);
  // 2026-11-05: the transition to open is the person asking for shortcuts; closing and re-renders stay silent.
  useEffect(() => { if (open) emitSignal({ type: 'panel-opened', panel: 'shortcuts' }); }, [open]);
  const groups = shortcutGroupsFor(screens, writable);
  return <>
    <div className="shortcuts-corner">
      <Tooltip.Provider delayDuration={200}>
        <DeckHeaderHint side="right" label={t.hint} keys={['?']}>
          <Button type="button" variant="ghost" size="icon" className="shortcuts-corner-button" aria-label={t.show} aria-haspopup="dialog" aria-expanded={open}
            onClick={event => { opener.current = event.currentTarget; setOpen(true); }}><Keyboard size={20} aria-hidden="true" /></Button>
        </DeckHeaderHint>
      </Tooltip.Provider>
    </div>
    <Dialog.Root open={open} onOpenChange={next => { if (!next) setOpen(false); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="shortcuts-panel-overlay" />
        <Dialog.Content ref={content} className="shortcuts-panel" tabIndex={-1}
          onOpenAutoFocus={event => { event.preventDefault(); content.current?.focus(); }}
          onCloseAutoFocus={event => { event.preventDefault(); if (opener.current?.isConnected) opener.current.focus({ preventScroll: true }); }}>
          <header className="shortcuts-panel-header">
            <Dialog.Title>{t.title}</Dialog.Title>
            <Dialog.Close asChild><Button type="button" variant="ghost" size="icon" className="shortcuts-panel-close" aria-label={t.close}><X size={20} /></Button></Dialog.Close>
          </header>
          <div className="shortcuts-panel-body">
            <Dialog.Description asChild>
              <div className="shortcuts-panel-note"><Info size={20} aria-hidden="true" /><span>{t.description}</span></div>
            </Dialog.Description>
            {groups.map(group => <section className="shortcuts-panel-group" key={group.id} aria-labelledby={'shortcuts-group-' + group.id}>
              <h3 id={'shortcuts-group-' + group.id}>{group.title}</h3>
              <ul>
                {rowsOf(group.items).map(row => <li key={row.label}>
                  <span className="shortcuts-panel-keys">{row.keys.map(keys => <kbd className="shortcuts-panel-key" key={keys}>{keys}</kbd>)}</span>
                  <span className="shortcuts-panel-label">{row.label}</span>
                </li>)}
              </ul>
            </section>)}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </>;
}
