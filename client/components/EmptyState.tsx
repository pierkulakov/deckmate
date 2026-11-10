import type { ReactNode } from 'react';
import { defineText, useText } from '../i18n.ts';
import { Button } from './ui/button.tsx';
import { EmptyArt, type EmptyArtScene } from './EmptyArt.tsx';
import './states.css';

const text = defineText({ empty: 'Nothing here yet.', filtered: 'Nothing found. Try a different query or filters.', reset: 'Reset search and filters' },
  { empty: 'Здесь пока пусто.', filtered: 'Ничего не найдено. Измените запрос или фильтры.', reset: 'Сбросить поиск и фильтры' });

type Action = { label: string; onClick: () => void; disabled?: boolean };
// 2026-11-10: `art` gives a large empty area (a whole tab, a card list, a catalog) its gray pixel scene and the scene
// layout (states.css); small nested lists stay quiet and take no art.
type EmptyStateProps = { message?: ReactNode; className?: string } & (
  | { variant: 'first-run'; title: string; icon?: ReactNode; art?: EmptyArtScene; action?: Action | { hint: ReactNode }; primary?: boolean; secondary?: Action }
  | { variant: 'filtered'; onReset: () => void; art?: EmptyArtScene; title?: string }
  | { variant?: 'quiet'; action?: Action }
);

export function EmptyState(props: EmptyStateProps) {
  const t = useText(text);
  const variant = props.variant ?? 'quiet';
  const base = variant === 'first-run' ? 'empty-state' : 'catalog-empty';
  const art = props.variant === 'first-run' || props.variant === 'filtered' ? props.art : undefined;
  return <div role="status" className={`${base} ui-empty ui-empty-${variant}${art ? ' ui-empty-scene' : ''} ${props.className ?? ''}`}>
    {art && <EmptyArt scene={art} />}
    {props.variant === 'first-run' && <>{props.icon}<h2>{props.title}</h2></>}
    {props.variant === 'filtered' && props.title && <h2>{props.title}</h2>}
    <p>{props.message ?? (variant === 'filtered' ? t.filtered : t.empty)}</p>
    {props.variant === 'filtered' && <Button type="button" variant="outline" size="sm" onClick={props.onReset}>{t.reset}</Button>}
    {props.variant !== 'filtered' && props.action && ('hint' in props.action
      ? <p>{props.action.hint}</p>
      : <Button type="button" variant={props.variant === 'first-run' && props.primary ? 'default' : 'outline'} size="sm" disabled={props.action.disabled} onClick={props.action.onClick}>{props.action.label}</Button>)}
    {props.variant === 'first-run' && props.secondary && <Button type="button" variant="ghost" size="sm" disabled={props.secondary.disabled} onClick={props.secondary.onClick}>{props.secondary.label}</Button>}
  </div>;
}
