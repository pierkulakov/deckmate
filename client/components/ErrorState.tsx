import { moveFocus } from '../focus.ts';
import { useEffect, useRef, useState } from 'react';
import { CircleAlert, LoaderCircle, RotateCcw } from 'lucide-react';
import { defineText, useText } from '../i18n.ts';
import { Button } from './ui/button.tsx';
import './states.css';

const text = defineText({ connection: 'Deckmate is not responding. Check that it is running, then try again.', retry: 'Retry',
  retrying: 'Retrying…', savedInput: 'Did not save. Nothing was lost — try again.' },
{ connection: 'Deckmate не отвечает. Проверьте, что он запущен, и повторите.', retry: 'Повторить',
  retrying: 'Повторяем…', savedInput: 'Не сохранилось. Ничего не потерялось — повторите.' });

export function ErrorState({ variant = 'banner', message, onRetry, pending = false, className = '', title, help, details, detailsLabel, retryLabel, retryingLabel }: {
  variant?: 'banner' | 'inline' | 'saved-input' | 'recovery'; message?: string | null; onRetry: () => void | Promise<unknown>;
  pending?: boolean; className?: string; title?: string; help?: string; details?: string; detailsLabel?: string; retryLabel?: string; retryingLabel?: string;
}) {
  const t = useText(text);
  const [retrying, setRetrying] = useState(false);
  const [retryFailure, setRetryFailure] = useState('');
  const inFlight = useRef(false);
  const button = useRef<HTMLButtonElement>(null);
  const focusedRetry = useRef(false);
  const container = useRef<HTMLElement>(null);
  const previousMessage = useRef(message);
  if (message) previousMessage.current = message;
  const shown = message !== null && message !== '' || retrying || Boolean(retryFailure);
  useEffect(() => {
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
    focusedRetry.current = focusedRetry.current || document.activeElement === button.current;
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
  const busy = shown && (pending || retrying);
  const reason = retryFailure || message || previousMessage.current || fallback;
  const retryText = variant === 'recovery' && busy ? (retryingLabel ?? t.retrying) : (retryLabel ?? t.retry);
  const retryButton = <Button ref={button} type="button" variant="outline" size={variant === 'recovery' ? 'default' : 'sm'} aria-disabled={busy}
    onFocus={() => { focusedRetry.current = true; }}
    onClick={() => { void retry(); }}>{busy ? <LoaderCircle size={13} className="spin" aria-hidden="true" /> : variant === 'recovery' && <RotateCcw size={16} aria-hidden="true" />}<span>{retryText}</span></Button>;
  // 2026-11-13: the primary catalog failure is one recovery surface; the same guarded button and focus handoff serve every variant.
  if (variant === 'recovery') return <section ref={node => { container.current = node; }} hidden={!shown} className={`catalog-space gallery-resolution ui-error ui-error-recovery ${className}`}
    role={shown ? 'alert' : undefined} aria-busy={busy || undefined}>
    <div className="ui-empty ui-empty-first-run ui-empty-scene">
      <CircleAlert className="resolution-icon" size={24} aria-hidden="true" />
      <h2>{title}</h2><p>{help}</p>
      {retryButton}
      <details><summary>{detailsLabel}</summary><p>{reason}</p></details>
      {busy && <span className="visually-hidden" role="status">{retryingLabel ?? t.retrying}</span>}
    </div>
  </section>;
  const base = variant === 'banner' ? 'catalog-error error-banner' : 'inline-error';
  // 2026-11-10: a busy Retry keeps the focused button in place and blocks the handler again; the dim and spinner
  // arrive after --busy-dim-delay, so a short retry never flickers. Busy visuals wait for the error to be shown:
  // parents can hold pending=true while their own loading state replaces this hidden banner.
  return <div ref={node => { container.current = node; }} hidden={!shown} className={`${base} ui-error ui-error-${variant} ${className}`} role={shown ? 'alert' : undefined}>
    <span>{reason}</span>
    {busy && <span className="visually-hidden" role="status">{t.retrying}</span>}
    {retryButton}
  </div>;
}
