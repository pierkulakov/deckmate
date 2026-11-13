import { lazy, Suspense, useRef } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { moveFocus } from '../focus.ts';
import { useText } from '../i18n.ts';
import type { ShortcutScreen } from '../keyboard-shortcuts.ts';
import { prepareEntrance, usePreparedEntrance } from '../prepared-motion.ts';
import { preparedResource } from '../prepared-resource.ts';
import { Button } from './ui/button.tsx';
import { shortcutsHelpText } from './shortcuts-help-text.ts';

export const shortcutsHelpResource = preparedResource(() => import('./ShortcutsHelpContent.tsx').then(module => ({ default: module.ShortcutsHelpContent })));
const ShortcutsHelpContent = lazy(shortcutsHelpResource.load);

export function ShortcutsHelpDialog({ open, screens, writable, vision, opener, onClose }: {
  open: boolean; screens: readonly ShortcutScreen[]; writable: boolean; vision: boolean; opener: HTMLElement | null; onClose: () => void;
}) {
  const t = useText(shortcutsHelpText);
  const content = useRef<HTMLDivElement>(null);
  const attachContent = usePreparedEntrance(content);
  // 2026-11-13: the shell owns focus and Radix dismissal immediately, including while its contents are loading.
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
        <Suspense fallback={null}><ShortcutsHelpContent screens={screens} writable={writable} vision={vision} /></Suspense>
        <footer className="shortcuts-panel-foot dialog-foot">
          Deckmate · {t.license} · <a href="https://github.com/pierkulakov/deckmate" target="_blank" rel="noreferrer noopener">{t.sourceCode}</a>
        </footer>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
