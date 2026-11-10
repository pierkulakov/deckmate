import { moveFocus } from '../focus.ts';
import { useLayoutEffect, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { defineText, useText } from '../i18n.ts';
import { Button } from './ui/button.tsx';
import './states.css';

const text = defineText({ connection: 'Deckmate is not responding. Check that it is running, then try again.', retry: 'Retry',
  retrying: 'Retrying…', savedInput: 'Did not save. Nothing was lost — try again.' },
{ connection: 'Deckmate не отвечает. Проверьте, что он запущен, и повторите.', retry: 'Повторить',
  retrying: 'Повторяем…', savedInput: 'Не сохранилось. Ничего не потерялось — повторите.' });

export function ErrorState({ variant = 'banner', message, onRetry, pending = false, className = '' }: {
  variant?: 'banner' | 'inline' | 'saved-input'; message?: string | null; onRetry: () => void | Promise<unknown>;
  pending?: boolean; className?: string;
}) {
  const t = useText(text);
  const [retrying, setRetrying] = useState(false);
  const [retryFailure, setRetryFailure] = useState('');
  const inFlight = useRef(false);
  const button = useRef<HTMLButtonElement>(null);
  const focusedRetry = useRef(false);
  const container = useRef<HTMLDivElement>(null);
  const previousMessage = useRef(message);
  if (message) previousMessage.current = message;
  const shown = message !== null && message !== '' || retrying || Boolean(retryFailure);
  useLayoutEffect(() => {
    // 2026-11-10: async callers may batch success with the retry ending; restore focus after that commit, not before it.
    if (shown || !focusedRetry.current) return;
    focusedRetry.current = false;
    if (document.activeElement !== button.current && document.activeElement !== document.body) return;
    const surface = container.current?.parentElement;
    if (!surface) return;
    const tabIndex = surface.getAttribute('tabindex');
    surface.tabIndex = -1;
    moveFocus(surface, { preventScroll: true });
    surface.addEventListener('blur', () => {
      if (tabIndex === null) surface.removeAttribute('tabindex'); else surface.setAttribute('tabindex', tabIndex);
    }, { once: true });
  }, [shown]);
  async function retry() {
    if (pending || inFlight.current) return;
    inFlight.current = true;
    setRetrying(true);
    setRetryFailure('');
    try { await onRetry(); }
    catch { setRetryFailure(t.connection); }
    finally {
      inFlight.current = false;
      setRetrying(false);
    }
  }
  let fallback = t.connection;
  if (variant === 'saved-input') fallback = t.savedInput;
  const base = variant === 'banner' ? 'catalog-error error-banner' : 'inline-error';
  // 2026-11-10: a busy Retry keeps the focused button in place and blocks the handler again; the dim and spinner
  // arrive after --busy-dim-delay, so a short retry never flickers. Busy visuals wait for the error to be shown:
  // parents can hold pending=true while their own loading state replaces this hidden banner.
  const busy = shown && (pending || retrying);
  return <div ref={container} hidden={!shown} className={`${base} ui-error ui-error-${variant} ${className}`} role={shown ? 'alert' : undefined}>
    <span>{retryFailure || message || previousMessage.current || fallback}</span>
    {busy && <span className="visually-hidden" role="status">{t.retrying}</span>}
    <Button ref={button} type="button" variant="outline" size="sm" aria-disabled={busy}
      onFocus={() => { focusedRetry.current = true; }}
      onBlur={event => { if (event.relatedTarget) focusedRetry.current = false; }}
      onClick={() => { void retry(); }}>{busy && <LoaderCircle size={13} className="spin" aria-hidden="true" />}{t.retry}</Button>
  </div>;
}
