import type { ReactElement } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import type { KeyCombo } from '../shortcut-format.ts';
import { Keys } from './Keys.tsx';
import '../deck-header-hint.css';

export function DeckHeaderHint({ label, combo, note, side = 'bottom', children }: { label: string; combo?: KeyCombo; note?: string; side?: 'bottom' | 'right'; children: ReactElement }) {
  return <Tooltip.Root>
    <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
    <Tooltip.Portal>
      <Tooltip.Content className={'deck-header-hint' + (combo ? ' has-keys' : '')} side={side} sideOffset={6}>
        {label}
        {combo && <Keys className="deck-header-hint-keys" variant="separate" combo={combo} />}
        {note && <span className="deck-header-hint-note">{note}</span>}
        <Tooltip.Arrow />
      </Tooltip.Content>
    </Tooltip.Portal>
  </Tooltip.Root>;
}
