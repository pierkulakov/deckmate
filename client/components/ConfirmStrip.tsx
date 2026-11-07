import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import '../confirm-strip.css';

/**
 * The in-form replacement for window.confirm (2026-11-05): a close or delete attempt first shows this strip inside the
 * same form, popover, dialog or heading row, and the buttons make the decision. The safe button is primary and focused;
 * Escape on the strip presses it. The strip itself is view only — the ask/answer state lives in useConfirmStrip.
 */
export function ConfirmStrip({ question, keepLabel, confirmLabel, danger = false, onEscape, onKeep, onConfirm }: {
  question: string;
  /** The primary safe action: keep the edit, do not delete. */
  keepLabel: string;
  /** The confirming action: discard the edit, delete the zone. */
  confirmLabel: string;
  /** The confirming action is irreversible: it reads in --danger. */
  danger?: boolean;
  /** Non-dialog contexts (a zone heading) route their Escape here; dialogs let Escape reach their own handler. */
  onEscape?: () => void;
  onKeep: () => void;
  onConfirm: () => void;
}) {
  const root = useRef<HTMLElement>(null);
  const keepButton = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef<Element | null>(null);
  const escapeHandler = useRef(onEscape);
  escapeHandler.current = onEscape;
  useLayoutEffect(() => {
    // The strip arrives with the decision: the safe button takes focus, and gives it back where it came from.
    restoreFocus.current = document.activeElement;
    keepButton.current?.focus({ preventScroll: true });
    return () => {
      const restore = restoreFocus.current;
      if (restore instanceof HTMLElement && restore.isConnected && root.current?.contains(document.activeElement)) restore.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    // Outside a dialog a click away from the strip is the safe answer too (zone headings).
    if (!onEscape) return;
    function away(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) escapeHandler.current?.();
    }
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [onEscape]);
  return <section ref={root} className="confirm-strip" aria-label={question}
    onKeyDown={event => {
      if (event.key !== 'Escape' || !onEscape) return;
      // The strip answers Escape itself so host dialogs and editors do not also react to it.
      event.preventDefault();
      event.stopPropagation();
      onEscape();
    }}>
    <p className="confirm-strip-question">{question}</p>
    <div className="confirm-strip-actions">
      <button ref={keepButton} type="button" className="ui-button button-default button-size-sm confirm-strip-keep" onClick={onKeep}>{keepLabel}</button>
      <button type="button" className={'ui-button button-outline button-size-sm confirm-strip-confirm' + (danger ? ' is-danger' : '')} onClick={onConfirm}>{confirmLabel}</button>
    </div>
  </section>;
}

/**
 * The ask-and-answer state behind ConfirmStrip. A guarded close becomes an attempt: request() shows the strip and
 * returns false; the decision buttons settle it. Escape presses the safe button but keeps the right to leave:
 * one more attempt closes without asking again, as Cancel did before the strip.
 */
export function useConfirmStrip() {
  const [confirming, setConfirming] = useState(false);
  // The strip was declined by an Escape-pressed close attempt: the next attempt proceeds without asking again.
  const declinedByEscape = useRef(false);
  function request(): boolean {
    if (declinedByEscape.current) { declinedByEscape.current = false; return true; }
    setConfirming(true);
    return false;
  }
  /** Escape: show the strip, press its safe button, then leave on the next attempt. */
  function escape(): boolean {
    if (confirming) { declinedByEscape.current = true; setConfirming(false); return false; }
    return request();
  }
  /** The safe button: stay; a later attempt asks again. */
  function keep(): void {
    declinedByEscape.current = false;
    setConfirming(false);
  }
  /** The decision is made, or the form closed by other means: start over. */
  function settle(): void {
    declinedByEscape.current = false;
    setConfirming(false);
  }
  return { confirming, request, escape, keep, settle };
}
