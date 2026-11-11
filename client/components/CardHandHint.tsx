import type { ReactElement } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import type { CatalogMember } from '../../src/catalog-contracts.ts';
import { defineText, useText } from '../i18n.ts';
import { CardOwnerAvatar } from './CardOwnerAvatar.tsx';
import { HandIcon } from './HandIcon.tsx';

const text = defineText({
  held: 'In the Hand of',
  empty: 'Not in Hand',
  noSlot: 'No slot',
  open: 'Click — open Hand',
  add: 'Click — add to my Hand',
  toggle: (key: string, remove: boolean) => `${key}+click — ${remove ? 'remove from' : 'add to'} my Hand`,
}, {
  held: 'В Hand у',
  empty: 'Не в Hand',
  noSlot: 'Без слота',
  open: 'Щелчок — открыть Hand',
  add: 'Щелчок — добавить в свой Hand',
  toggle: (key: string, remove: boolean) => `${key}+щелчок — ${remove ? 'сразу убрать из своего Hand' : 'сразу добавить в свой Hand'}`,
});

export function CardHandHint({ holders, members, inMyHand, unavailable, shortcut, children }: {
  holders: { id: string; label: string; slot?: number }[];
  members: CatalogMember[];
  inMyHand: boolean;
  unavailable?: string;
  shortcut?: string;
  children: ReactElement;
}) {
  const t = useText(text);
  const command = /Mac|iPhone|iPad/u.test(navigator.platform) ? 'Cmd' : 'Ctrl';
  return <Tooltip.Provider delayDuration={200}><Tooltip.Root>
    <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
    <Tooltip.Portal><Tooltip.Content className="card-hand-tooltip" side="bottom" align="end" sideOffset={6} collisionPadding={8}>
      <header><strong><HandIcon size={16} mine={inMyHand} />{holders.length ? t.held : t.empty}</strong><kbd>{shortcut}</kbd></header>
      {holders.length > 0 && <ul>{holders.map(holder => <li key={holder.id}>
        <CardOwnerAvatar owner={holder.id} members={members} /><span>{holder.label}</span><span className="card-hand-slot">{holder.slot === undefined ? t.noSlot : `#${holder.slot}`}</span>
      </li>)}</ul>}
      <div className="card-hand-hint-actions">
        {holders.length > 0 && <span>{t.open}</span>}
        {unavailable ? <span>{unavailable}</span> : <>
          {!holders.length && <span>{t.add}</span>}
          <span>{t.toggle(command, inMyHand)}</span>
        </>}
      </div>
      <Tooltip.Arrow />
    </Tooltip.Content></Tooltip.Portal>
  </Tooltip.Root></Tooltip.Provider>;
}
