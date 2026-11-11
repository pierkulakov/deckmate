import { moveFocus } from '../focus.ts';
import { useEffect, useRef, useState } from 'react';
import { prepareEntrance, usePreparedEntrance } from '../prepared-motion.ts';
import { createPortal } from 'react-dom';
import * as Dialog from '@radix-ui/react-dialog';
import * as Tooltip from '@radix-ui/react-tooltip';
import { Keyboard, X } from 'lucide-react';
import { defineText, useText } from '../i18n.ts';
import { matchShortcut, shortcutGroupsFor, shortcutTargetBlocked, type ShortcutDefinition, type ShortcutScreen } from '../keyboard-shortcuts.ts';
import { emitSignal } from '../onboarding/signals.ts';
import { desktopBoard } from '../desktop-bridge.ts';
import { DeckHeaderHint } from './Deck.tsx';
import { Button } from './ui/button.tsx';
import '../surface.css';
import '../shortcuts-help.css';

const text = defineText({
  hint: 'See currently available shortcuts',
  show: 'See shortcuts',
  title: 'Available shortcuts',
  close: 'Close',
  description: 'Deckmate shortcuts for the current screen. Open this menu on another screen to see more shortcuts.',
  license: 'AGPL-3.0',
  sourceCode: 'Source code',
  canvasHelp: 'The Vision canvas has its own shortcuts: focus the canvas and press ? for its help.',
  desktopPalette: 'Canvas command palette: Ctrl+/. In the app, Ctrl+Shift+P switches projects.',
  desktopZoom: 'In the app, Ctrl+=, Ctrl+− and Ctrl+0 zoom the whole window. Zoom the canvas with Ctrl+mouse wheel or its zoom buttons.',
}, {
  hint: 'Посмотреть доступные комбинации клавиш',
  show: 'Комбинации клавиш',
  title: 'Доступные комбинации клавиш',
  close: 'Закрыть',
  description: 'Комбинации клавиш Deckmate для текущего экрана. Откройте меню на другом экране, чтобы увидеть больше.',
  license: 'Лицензия AGPL-3.0',
  sourceCode: 'Исходный код',
  canvasHelp: 'У холста Vision своя справка по клавишам: поставьте фокус на холст и нажмите ?.',
  desktopPalette: 'Палитра команд холста — Ctrl+/. В приложении Ctrl+Shift+P переключает проекты.',
  desktopZoom: 'В приложении Ctrl+=, Ctrl+− и Ctrl+0 меняют масштаб всего окна. Масштаб холста — колесо с Ctrl или кнопки масштаба.',
});

interface ShortcutsHelpProps {
  /** Show only shortcuts for the user's current screens. */
  screens: readonly ShortcutScreen[];
  /** Editing permission: shortcuts that mutate data stay hidden and inactive without it. */
  writable: boolean;
  vision?: boolean;
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

// 2026-11-06: each screen supplies its shortcuts; the launcher shares one slot in the app header.
// The dialog uses keyboard-shortcuts.ts as the single registry and shows only the current screen's shortcuts.
export function ShortcutsHelp({ screens, writable, vision = false }: ShortcutsHelpProps) {
  const t = useText(text);
  const [open, setOpen] = useState(false);
  const [launcherSlot, setLauncherSlot] = useState<HTMLElement | null>(null);
  useEffect(() => setLauncherSlot(document.getElementById('topbar-shortcuts')), []);
  const opener = useRef<HTMLElement | null>(null);
  const content = useRef<HTMLDivElement>(null);
  const attachContent = usePreparedEntrance(content);
  useEffect(() => {
    function toggle(event: KeyboardEvent) {
      if (matchShortcut(event)?.id !== 'shortcuts-overview') return;
      if (event.target instanceof Element && event.target.closest('.vision-canvas .excalidraw')) return;
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
    {launcherSlot && createPortal(<>
      <Tooltip.Provider delayDuration={200}>
        <DeckHeaderHint side="bottom" label={t.hint} keys={['?']}>
          <Button type="button" variant="ghost" size="icon" className="shortcuts-help-trigger" aria-label={t.show} aria-haspopup="dialog" aria-expanded={open}
            onClick={event => { opener.current = event.currentTarget; setOpen(true); }}><Keyboard size={18} aria-hidden="true" /></Button>
        </DeckHeaderHint>
      </Tooltip.Provider>
    </>, launcherSlot)}
    <Dialog.Root open={open} onOpenChange={next => { if (!next) setOpen(false); }}>
      <Dialog.Portal>
        <Dialog.Overlay ref={prepareEntrance} className="shortcuts-panel-overlay" />
        <Dialog.Content ref={attachContent} className="shortcuts-panel dialog-panel" tabIndex={-1}
          onOpenAutoFocus={event => { event.preventDefault(); moveFocus(content.current); }}
          onCloseAutoFocus={event => { event.preventDefault(); if (opener.current?.isConnected) moveFocus(opener.current, { preventScroll: true }); }}>
          {/* 2026-11-10: the frame, head and body come from the shared dialog grammar in surface.css; the description is
              the caption under the title, and groups are panel sections with panel-title headings. */}
          <header className="dialog-head">
            <div className="shortcuts-panel-heading">
              <Dialog.Title className="dialog-title">{t.title}</Dialog.Title>
              <Dialog.Description className="shortcuts-panel-caption">{t.description}</Dialog.Description>
            </div>
            <Dialog.Close asChild><Button type="button" variant="ghost" size="icon" className="shortcuts-panel-close" aria-label={t.close}><X size={17} /></Button></Dialog.Close>
          </header>
          <div className="shortcuts-panel-body dialog-body">
            {vision && <p className="shortcuts-panel-note">{t.canvasHelp}</p>}
            {vision && desktopBoard() && <>
              <p className="shortcuts-panel-note">{t.desktopPalette}</p>
              <p className="shortcuts-panel-note">{t.desktopZoom}</p>
            </>}
            {groups.map(group => <section className="shortcuts-panel-group" key={group.id} aria-labelledby={'shortcuts-group-' + group.id}>
              <h3 className="panel-title" id={'shortcuts-group-' + group.id}>{group.title}</h3>
              <ul>
                {rowsOf(group.items).map(row => <li key={row.label}>
                  <span className="shortcuts-panel-keys">{row.keys.map(keys => <kbd className="shortcuts-panel-key" key={keys}>{keys}</kbd>)}</span>
                  <span className="shortcuts-panel-label">{row.label}</span>
                </li>)}
              </ul>
            </section>)}
          </div>
          {/* AGPL §13: the app ships no version to the client, so the foot names the app, its license and its source. */}
          <footer className="shortcuts-panel-foot dialog-foot">
            Deckmate · {t.license} · <a href="https://github.com/pierkulakov/deckmate" target="_blank" rel="noreferrer noopener">{t.sourceCode}</a>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </>;
}
