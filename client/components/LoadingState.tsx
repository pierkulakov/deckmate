import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';
import { defineText, useText } from '../i18n.ts';
import './states.css';

const text = defineText({ loading: 'Loading…', updating: 'Updating…' }, { loading: 'Загружаем…', updating: 'Обновляем…' });
// 2026-11-13: code and the screen's first data read are one wait, rather than two consecutive indicator delays.
export const InitialLoadingStarted = createContext<number | undefined>(undefined);

export function LoadingState({ variant = 'plate', active = true, message, children, delayMs = variant === 'keep-data' ? 500 : 150, className = '' }: {
  variant?: 'plate' | 'skeleton' | 'keep-data'; active?: boolean; message?: string;
  children?: ReactNode; delayMs?: number; className?: string;
}) {
  const t = useText(text);
  const started = useContext(InitialLoadingStarted);
  const [initialStart] = useState(() => variant === 'plate' ? started : undefined);
  const [visible, setVisible] = useState(() => initialStart !== undefined && performance.now() - initialStart >= delayMs);
  useEffect(() => {
    if (!active) { setVisible(false); return; }
    const remaining = initialStart === undefined ? delayMs : Math.max(0, initialStart + delayMs - performance.now());
    if (!remaining) { setVisible(true); return; }
    setVisible(false);
    const timer = setTimeout(() => setVisible(true), remaining);
    return () => clearTimeout(timer);
  }, [active, delayMs, initialStart]);
  const label = message ?? (variant === 'keep-data' ? t.updating : t.loading);
  const shown = active && visible;
  // 2026-11-13: reserve the indicator before revealing it so the delay never moves neighbouring content.
  const reserved = active && variant !== 'keep-data';
  return <div className={`ui-loading ui-loading-${variant} ${className}`} aria-busy={active}>
    {variant === 'keep-data' && children}
    {(reserved || shown) && <div className={variant === 'plate' ? 'loading-state' : 'ui-loading-indicator'} role={shown ? 'status' : undefined} style={{ visibility: shown ? undefined : 'hidden' }}>
      {variant === 'skeleton'
        ? <><span className="visually-hidden">{label}</span><span className="ui-state-skeleton" aria-hidden="true"><i /><i /><i /></span></>
        : <><LoaderCircle size={16} className={variant === 'keep-data' ? 'spin' : undefined} aria-hidden="true" /><span>{label}</span></>}
    </div>}
  </div>;
}
