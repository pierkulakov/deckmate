import { useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Shield } from 'lucide-react';
import type { CatalogDeck, CatalogMember } from '../../src/catalog-contracts.ts';
import { DeckHeaderHint } from './DeckHeaderHint.tsx';
import { Button } from './ui/button.tsx';
import { defineText, useText } from '../i18n.ts';
import { stateLabel } from '../locales/common.ts';

const text = defineText({
  guardians: 'Deck guardians',
  hint: (names: string) => 'Deck guardians' + (names ? ': ' + names : '') + ' · only a guardian can accept a card',
  label: (names: string) => 'Deck guardians: ' + (names || 'none'),
  saveFailed: 'Guardians were not saved. Check the catalog message and try again.',
  heading: 'Guardians',
  note: (state: string) => `Only a guardian can accept a card in this deck (“${state}”). Agents can be guardians too.`,
  agent: 'agent', human: 'human', sandboxOnly: 'Guardians can only be changed in the test copy.',
  saving: 'Saving…', save: 'Save',
}, {
  guardians: 'Стражи колоды',
  hint: (names: string) => 'Стражи колоды' + (names ? ': ' + names : '') + ' · принять карточку может только страж',
  label: (names: string) => 'Стражи колоды: ' + (names || 'нет'),
  saveFailed: 'Стражи не сохранены. Проверьте сообщение каталога и повторите.',
  heading: 'Стражи колоды',
  note: (state: string) => `Принять карточку этой колоды («${state.toLocaleLowerCase('ru-RU')}») может только страж. Агенты тоже могут быть стражами.`,
  agent: 'агент', human: 'человек', sandboxOnly: 'Стражи меняются только в тестовой копии.',
  saving: 'Сохраняем…', save: 'Сохранить',
});

interface DeckGuardiansProps {
  deck: CatalogDeck;
  members: CatalogMember[];
  manifestHash: string;
  pending: boolean;
  writable: boolean;
  onSave: (deckId: string, guardianIds: string[], manifestHash: string) => Promise<boolean>;
}

/** Deck header shield selects guardians from the member registry. */
export function DeckGuardians({ deck, members, manifestHash, pending, writable, onSave }: DeckGuardiansProps) {
  const t = useText(text);
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<string[]>(deck.guardianIds ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<'saveFailed' | null>(null);
  const guardianNames = (deck.guardianIds ?? []).map(id => members.find(member => member.id === id)?.label ?? id);
  const hint = t.hint(guardianNames.join(', '));

  function changeOpen(next: boolean) {
    if (saving) return;
    setOpen(next);
    if (next) { setChosen(deck.guardianIds ?? []); setError(null); }
  }

  function toggle(memberId: string) {
    setChosen(current => current.includes(memberId) ? current.filter(id => id !== memberId) : [...current, memberId]);
  }

  async function save() {
    if (saving || pending || !writable) return;
    setSaving(true);
    setError(null);
    const saved = await onSave(deck.id, chosen, manifestHash);
    setSaving(false);
    if (saved) setOpen(false);
    else setError('saveFailed');
  }

  return <DropdownMenu.Root open={open} onOpenChange={changeOpen}>
    <DeckHeaderHint label={hint}>
      <DropdownMenu.Trigger asChild>
        <Button variant="ghost" size="icon" className={'deck-guardians-toggle' + (guardianNames.length ? ' is-active' : '')}
          disabled={pending && !open} aria-label={t.label(guardianNames.join(', '))}>
          <Shield size={14} />
        </Button>
      </DropdownMenu.Trigger>
    </DeckHeaderHint>
    <DropdownMenu.Portal>
      <DropdownMenu.Content className="deck-settings-menu" align="start" sideOffset={8} collisionPadding={12} aria-busy={saving}>
        <DropdownMenu.Label className="deck-settings-heading">{t.heading}</DropdownMenu.Label>
        <p className="deck-settings-note">{t.note(stateLabel('done'))}</p>
        <div className="deck-settings-list" role="group" aria-label={t.guardians}>
          {members.map(member => <label key={member.id} className="deck-settings-option">
            <input type="checkbox" checked={chosen.includes(member.id)} disabled={!writable || saving || pending} onChange={() => toggle(member.id)} />
            <span className="deck-settings-name">{member.label}</span>
            <span className="deck-settings-kind">{member.kind === 'agent' ? t.agent : t.human}</span>
          </label>)}
        </div>
        {error && <p className="deck-settings-error" role="alert">{t[error]}</p>}
        {!writable && <p className="deck-settings-note">{t.sandboxOnly}</p>}
        <div className="deck-settings-actions">
          <Button type="button" size="sm" disabled={!writable || saving || pending} onClick={() => void save()}>{saving ? t.saving : t.save}</Button>
        </div>
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>;
}
