import { useEffect, useState, type ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';
import { defineText, useText } from '../i18n.ts';
import './states.css';

const text = defineText({ loading: 'Loading…', updating: 'Updating…' }, { loading: 'Загружаем…', updating: 'Обновляем…' });

export function LoadingState({ variant = 'plate', active = true, message, children, delayMs = 500, className = '' }: {
  variant?: 'plate' | 'skeleton' | 'keep-data'; active?: boolean; message?: string;
  children?: ReactNode; delayMs?: number; className?: string;
}) {
  const t = useText(text);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    setVisible(false);
    if (!active) return;
    const timer = setTimeout(() => setVisible(true), delayMs);
    return () => clearTimeout(timer);
  }, [active, delayMs]);
  const label = message ?? (variant === 'keep-data' ? t.updating : t.loading);
  const shown = active && (variant !== 'keep-data' || visible);
  return <div className={`ui-loading ui-loading-${variant} ${className}`} aria-busy={active}>
    {variant === 'keep-data' && children}
    {shown && <div className={variant === 'plate' ? 'loading-state' : 'ui-loading-indicator'} role="status">
      {variant === 'skeleton'
        ? <><span className="visually-hidden">{label}</span><span className="ui-state-skeleton" aria-hidden="true"><i /><i /><i /></span></>
        : <><LoaderCircle size={16} className="spin" aria-hidden="true" /><span>{label}</span></>}
    </div>}
  </div>;
}
