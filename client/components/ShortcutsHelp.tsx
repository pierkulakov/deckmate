import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as Tooltip from '@radix-ui/react-tooltip';
import { Keyboard } from 'lucide-react';
import { useText } from '../i18n.ts';
import { matchShortcut, shortcutTargetBlocked, type ShortcutScreen } from '../keyboard-shortcuts.ts';
import { emitSignal } from '../onboarding/signals.ts';
import { preparedResource, preload } from '../prepared-resource.ts';
import { DeckHeaderHint } from './DeckHeaderHint.tsx';
import { Button } from './ui/button.tsx';
import { shortcutsHelpText } from './shortcuts-help-text.ts';
import '../surface.css';
import '../shortcuts-help.css';

const dialogResource = preparedResource(() => import('./ShortcutsHelpDialog.tsx').then(module => ({ default: module.ShortcutsHelpDialog })));
const ShortcutsHelpDialog = lazy(dialogResource.load);

interface ShortcutsHelpProps {
  /** Show only shortcuts for the user's current screens. */
  screens: readonly ShortcutScreen[];
  /** Editing permission: shortcuts that mutate data stay hidden and inactive without it. */
  writable: boolean;
  vision?: boolean;
}

// 2026-11-06: each screen supplies its shortcuts; the launcher shares one slot in the app header.
// The dialog uses keyboard-shortcuts.ts as the single registry and shows only the current screen's shortcuts.
export function ShortcutsHelp({ screens, writable, vision = false }: ShortcutsHelpProps) {
  const t = useText(shortcutsHelpText);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [launcherSlot, setLauncherSlot] = useState<HTMLElement | null>(null);
  useEffect(() => setLauncherSlot(document.getElementById('topbar-shortcuts')), []);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    function toggle(event: KeyboardEvent) {
      if (matchShortcut(event)?.id !== 'shortcuts-overview') return;
      if (event.target instanceof Element && event.target.closest('.vision-canvas .excalidraw')) return;
      // The open panel is a dialog itself, so the shared «dialog open» check would swallow the closing «?».
      if (open ? event.repeat : shortcutTargetBlocked(event)) return;
      event.preventDefault();
      if (!open) { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setMounted(true); }
      setOpen(!open);
    }
    window.addEventListener('keydown', toggle);
    return () => window.removeEventListener('keydown', toggle);
  }, [open]);
  // 2026-11-05: the transition to open is the person asking for shortcuts; closing and re-renders stay silent.
  useEffect(() => { if (open) emitSignal({ type: 'panel-opened', panel: 'shortcuts' }); }, [open]);
  return <>
    {launcherSlot && createPortal(<>
      <Tooltip.Provider delayDuration={200}>
        <DeckHeaderHint side="bottom" label={t.hint} combo={{ key: '?' }}>
          <Button type="button" variant="ghost" size="icon" className="shortcuts-help-trigger" aria-label={t.show} aria-haspopup="dialog" aria-expanded={open}
            onPointerEnter={() => preload(dialogResource)} onFocus={() => preload(dialogResource)} onClick={event => { opener.current = event.currentTarget; setMounted(true); setOpen(true); }}><Keyboard size={18} aria-hidden="true" /></Button>
        </DeckHeaderHint>
      </Tooltip.Provider>
    </>, launcherSlot)}
    {mounted && <Suspense fallback={null}><ShortcutsHelpDialog open={open} screens={screens} writable={writable} vision={vision} opener={opener.current} onClose={() => setOpen(false)} /></Suspense>}
  </>;
}
