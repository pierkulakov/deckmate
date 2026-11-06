import { useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowUpRight, ChevronDown } from 'lucide-react';
import type { CatalogCard, CatalogDeck, CatalogView } from '../../src/catalog-contracts.ts';
import type { DataSource } from '../../src/workspace-contracts.ts';
import type { CatalogAction } from '../useCatalog.ts';
import { CardQuickSettings, type CardQuickSettingsTab } from './CardQuickSettings.tsx';
import { DeckThumb, deckChoices } from './DeckChoices.tsx';
import { QuickSettingsList, QuickSettingsPopover } from './QuickSettingsList.tsx';
import '../deck-picker.css';

export { DeckThumb } from './DeckChoices.tsx';

export interface DeckPickerProps {
  catalog: CatalogView; projectName?: string; source?: DataSource;
  decks: readonly CatalogDeck[]; current: string | null; noneLabel?: string;
  shown: CatalogDeck | undefined; text: string; hint?: string; disabled?: boolean;
  onOpen?: () => void; openDisabled?: boolean; onChoose: (deckId: string | null) => void;
  card?: CatalogCard; onEdit?: (action: CatalogAction) => Promise<boolean>;
}

export function DeckPicker({ shown, text, hint, onOpen, openDisabled = false, disabled = false, onChoose, card, onEdit, ...list }: DeckPickerProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<CardQuickSettingsTab>('deck');
  const trigger = useRef<HTMLButtonElement>(null);
  return <div className="deck-picker">
    <button ref={trigger} type="button" className="deck-picker-pill" disabled={disabled} title={hint ?? text} aria-label={'Deck: ' + text}
      aria-haspopup="dialog" aria-expanded={open} onClick={() => { setTab('deck'); setOpen(!open); }}>
      <DeckThumb deck={shown} source={list.source} /><span className="deck-picker-name">{text}</span><ChevronDown size={16} aria-hidden="true" />
    </button>
    {open && (card && onEdit
      ? <CardQuickSettings key={card.id} card={card} catalog={list.catalog} source={list.source} projectName={list.projectName} anchor={trigger.current}
          tab={tab} onTabChange={setTab} disabled={disabled} onEdit={onEdit} onClose={() => setOpen(false)} />
      : <QuickSettingsPopover anchor={trigger.current} onClose={() => setOpen(false)}>
          <QuickSettingsList title="Deck" titleAs={Dialog.Title} choices={deckChoices(list.catalog, list.decks, list.source, list.projectName, list.noneLabel)}
            current={list.current ?? ''} disabled={disabled} onChoose={key => { setOpen(false); if ((key || null) !== list.current) onChoose(key || null); }} />
        </QuickSettingsPopover>)}
    {onOpen && <button type="button" className="deck-picker-open" disabled={openDisabled} onClick={onOpen}><ArrowUpRight size={16} aria-hidden="true" /><span>Open</span></button>}
  </div>;
}
