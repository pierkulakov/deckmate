import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, Maximize, Minimize } from 'lucide-react';
import { defineText, useText } from '../i18n.ts';
import '../card-focus-mode.css';

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

// Focus Mode fills the viewport with the card face color, Back at top left, Full Screen at top right,
// and one centered text column; deck navigation and sheet chrome stay outside this view.
// Not a Radix modal: it would switch off pointer events for the editor's «/» «$» «#» «@» menus, portalled to <body>.
export function CardFocusMode({ title, onBack, children }: { title: string; onBack: () => void; children: ReactNode }) {
  const t = useText(text);
  const layer = useRef<HTMLDivElement>(null);
  const enteredFullScreen = useRef(false);
  const [fullScreen, setFullScreen] = useState(() => Boolean(document.fullscreenElement));

  // Layout phase on purpose: the background leaves `inert` before a returning card editor autofocuses its text.
  useLayoutEffect(() => {
    const element = layer.current;
    if (!element) return;
    const background = [...document.body.children].filter((child): child is HTMLElement => child instanceof HTMLElement && child !== element && !child.inert);
    for (const child of background) child.inert = true;
    if (!element.contains(document.activeElement)) element.focus({ preventScroll: true });
    return () => {
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
  return createPortal(<div ref={layer} className="card-focus-mode" role="dialog" aria-modal="true" aria-label={t.dialogLabel(title)} tabIndex={-1}>
    <button type="button" className="card-focus-mode-back" aria-label={t.exit} title={t.exit} onClick={onBack}><ChevronLeft size={14} aria-hidden="true" /></button>
    <button type="button" className="card-focus-mode-screen" aria-label={fullScreenLabel} title={fullScreenLabel} onClick={toggleFullScreen}>
      {fullScreen ? <Minimize size={16} aria-hidden="true" /> : <Maximize size={16} aria-hidden="true" />}
    </button>
    <div className="card-focus-mode-column">{children}</div>
  </div>, document.body);
}
