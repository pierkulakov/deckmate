import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { FocusScope } from '@radix-ui/react-focus-scope';
import { ChevronLeft, Maximize, Minimize } from 'lucide-react';
import { defineText, useText } from '../i18n.ts';
import { moveFocus } from '../focus.ts';
import '../card-focus-mode.css';
import { prepareEntrance } from '../prepared-motion.ts';

const text = defineText({
  dialogLabel: (title: string) => `Focus Mode: ${title}`,
  exit: 'Exit Focus Mode',
  fullScreen: 'Full Screen',
  exitFullScreen: 'Exit Full Screen',
}, {
  dialogLabel: (title: string) => `Фокус-режим: ${title}`,
  exit: 'Выйти из фокус-режима',
  fullScreen: 'Полный экран',
  exitFullScreen: 'Выйти из полного экрана',
});

// 2026-11-10: reuse Radix's Tab loop without its modal focus/pointer trap: editor menus portal into body.
export function CardFocusMode({ title, onBack, cardLayout = false, children }: { title: string; onBack: () => void; cardLayout?: boolean; children: ReactNode }) {
  const t = useText(text);
  const layer = useRef<HTMLDivElement>(null);
  const enteredFullScreen = useRef(false);
  const [fullScreen, setFullScreen] = useState(() => Boolean(document.fullscreenElement));
  const [returnFocus] = useState(() => ({
    opener: document.activeElement instanceof HTMLElement ? document.activeElement : null,
    cardId: new URLSearchParams(location.search).get('card'),
  }));

  // 2026-11-10: restore inert in layout cleanup before the returning editor or Radix restores focus.
  useLayoutEffect(() => {
    const element = layer.current;
    if (!element) return;
    const releasePreparation = prepareEntrance(element);
    const background = [...document.body.children].filter((child): child is HTMLElement => child instanceof HTMLElement && child !== element && !child.inert);
    for (const child of background) child.inert = true;
    return () => {
      releasePreparation?.();
      for (const child of background) child.inert = false;
      if (enteredFullScreen.current && document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    const update = () => setFullScreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);

  // Escape that nobody inside took (the command menu closes itself, the edit form cancels) leaves Focus Mode.
  // On the document, so it also works when focus is on <body>; stopped here, so the deck behind never sees it.
  const leaveOnEscape = useEffectEvent((event: globalThis.KeyboardEvent) => {
    if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    onBack();
  });
  useEffect(() => {
    document.addEventListener('keydown', leaveOnEscape);
    return () => document.removeEventListener('keydown', leaveOnEscape);
  }, []);

  function toggleFullScreen() {
    if (document.fullscreenElement) { void document.exitFullscreen().catch(() => undefined); return; }
    // The document, not this layer, goes full screen: the editor menus live outside the layer.
    enteredFullScreen.current = true;
    void document.documentElement.requestFullscreen().catch(() => { enteredFullScreen.current = false; });
  }

  const fullScreenLabel = fullScreen ? t.exitFullScreen : t.fullScreen;
  return createPortal(<FocusScope asChild loop onMountAutoFocus={event => {
    const editor = layer.current?.querySelector<HTMLElement>('textarea:not(:disabled), [contenteditable="true"], .card-title-edit:not(:disabled)');
    if (editor) { event.preventDefault(); moveFocus(editor, { preventScroll: true }); }
  }} onUnmountAutoFocus={event => {
    event.preventDefault();
    if (returnFocus.opener?.isConnected && !returnFocus.opener.closest('[inert]')) {
      moveFocus(returnFocus.opener, { preventScroll: true });
      return;
    }
    if (!returnFocus.cardId) return;
    const tile = document.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(returnFocus.cardId)}"] .deck-card-open`);
    moveFocus(tile, { preventScroll: true });
  }}><div ref={layer} className={'card-focus-mode' + (cardLayout ? ' has-card-layout' : '')} role="dialog" aria-modal="true" aria-label={t.dialogLabel(title)} tabIndex={-1} data-local-escape>
    <button type="button" className="card-focus-mode-back" aria-label={t.exit} title={t.exit} onClick={onBack}><ChevronLeft size={14} aria-hidden="true" /></button>
    <button type="button" className="card-focus-mode-screen" aria-label={fullScreenLabel} title={fullScreenLabel} onClick={toggleFullScreen}>
      {fullScreen ? <Minimize size={16} aria-hidden="true" /> : <Maximize size={16} aria-hidden="true" />}
    </button>
    <div className="card-focus-mode-column">{children}</div>
  </div></FocusScope>, document.body);
}
