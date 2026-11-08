import { useEffect, useId, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Flag, Gauge, Layers, LayoutGrid, Play, UserRound } from 'lucide-react';
import { deckAcceptsCard, type CardPriority, type CatalogCard, type CatalogView } from '../../src/catalog-contracts.ts';
import type { DataSource } from '../../src/workspace-contracts.ts';
import type { CatalogAction } from '../useCatalog.ts';
import type { CardQuickSettingsTab } from '../keyboard-shortcuts.ts';
import { CardOwnerAvatar, memberForOwner } from './CardOwnerAvatar.tsx';
import { deckChoices } from './DeckChoices.tsx';
import { QuickSettingsList, QuickSettingsPopover, type QuickSettingsChoice } from './QuickSettingsList.tsx';
import { defineText, textNow, useText } from '../i18n.ts';
import { priorityLabel } from '../locales/common.ts';
import { orderedRunChoices, runChoiceLabel } from '../run-label.ts';
import '../card-quick-settings.css';

const text = defineText({
  none: 'None',
  noDeck: 'No deck',
  unassigned: 'Unassigned',
  stale: 'Change not saved. Check the updated data and try again.',
  connection: 'Could not save. Check the connection and try again.',
  docProperties: 'Doc cards have no Priority or Effort.',
  quickSettings: 'Quick Settings',
  deck: 'Deck', owner: 'Owner', run: 'Run', milestone: 'Milestone', priority: 'Priority', effort: 'Effort',
}, {
  none: 'Нет',
  noDeck: 'Без колоды',
  unassigned: 'Без исполнителя',
  stale: 'Изменение не сохранено. Проверьте обновлённые данные и повторите выбор.',
  connection: 'Не удалось сохранить. Проверьте соединение и повторите выбор.',
  docProperties: 'У Doc нет приоритета и оценки.',
  quickSettings: 'Быстрые настройки',
  deck: 'Колода', owner: 'Исполнитель', run: 'Run', milestone: 'Milestone', priority: 'Приоритет', effort: 'Оценка',
});

export { CardOwnerAvatar, OwnerAvatar } from './CardOwnerAvatar.tsx';
export type { CardQuickSettingsTab } from '../keyboard-shortcuts.ts';
const tabs = [
  { id: 'deck', icon: LayoutGrid }, { id: 'owner', icon: UserRound },
  { id: 'run', icon: Play }, { id: 'milestone', icon: Flag },
  { id: 'priority', icon: Layers }, { id: 'effort', icon: Gauge },
] as const;
export const cardPriorityOptions: { value: CardPriority | null }[] = [
  { value: null }, { value: 'low' }, { value: 'medium' }, { value: 'high' },
];
export const cardEffortPresets = [0, 1, 2, 3, 5, 8] as const;

function choicesFor(tab: CardQuickSettingsTab, card: CatalogCard, catalog: CatalogView, source?: DataSource, projectName?: string): QuickSettingsChoice[] {
  const t = textNow(text);
  const none = { key: '', label: t.none };
  const today = new Date().toISOString().slice(0, 10);
  if (tab === 'deck') return deckChoices(catalog, catalog.decks.filter(deck => deckAcceptsCard(deck.kind, card.kind)), source, projectName, t.noDeck);
  if (tab === 'owner') {
    const members = catalog.members ?? [];
    const choices: QuickSettingsChoice[] = [{ key: '', label: t.unassigned, icon: <CardOwnerAvatar owner={null} members={members} /> },
      ...members.map(member => ({ key: member.label, label: member.label, search: [member.id, ...member.aliases].join(' '), icon: <CardOwnerAvatar owner={member.label} members={members} /> }))];
    if (card.owner && !memberForOwner(card.owner, members)) choices.push({ key: card.owner, label: card.owner, icon: <CardOwnerAvatar owner={card.owner} members={members} /> });
    return choices;
  }
  if (tab === 'run') return [none, ...orderedRunChoices(catalog.runs ?? []).map(run => ({ key: run.id, label: runChoiceLabel(run) }))];
  if (tab === 'milestone') return [none, ...(catalog.milestones ?? []).slice().sort((first, second) => Number(second.date >= today) - Number(first.date >= today) || first.date.localeCompare(second.date)).map(milestone => ({ key: milestone.id, label: milestone.title }))];
  if (tab === 'priority') return cardPriorityOptions.map(option => ({ key: option.value ?? '', label: option.value ? priorityLabel(option.value) : t.none, icon: <Layers size={16} strokeWidth={option.value === 'high' ? 2.5 : 1.5} /> }));
  // 2026-11-05: the catalog has no project scale; keep a stored custom estimate selectable as well.
  const efforts = new Set<number>(cardEffortPresets);
  if (card.effort != null) efforts.add(card.effort);
  return [none, ...[...efforts].sort((first, second) => first - second).map(effort => ({ key: String(effort), label: String(effort) }))];
}

function currentChoice(tab: CardQuickSettingsTab, card: CatalogCard, catalog: CatalogView): string {
  if (tab === 'deck') return card.deckId ?? '';
  if (tab === 'owner') return memberForOwner(card.owner, catalog.members ?? [])?.label ?? card.owner ?? '';
  return String(card[tab] ?? '');
}

function choiceAction(tab: CardQuickSettingsTab, key: string, card: CatalogCard, catalog: CatalogView): CatalogAction {
  const revision = { cardId: card.id, sourceHash: card.sourceHash, manifestHash: catalog.manifestHash };
  if (tab === 'deck') return { ...revision, action: 'assign-deck', deckId: key || null };
  if (tab === 'run' || tab === 'milestone') return { action: 'bulk-edit-cards', manifestHash: catalog.manifestHash, optionsHash: catalog.optionsHash ?? '',
    cards: [{ cardId: card.id, sourceHash: card.sourceHash }], change: { kind: 'options', patch: { [tab]: key || null } } };
  const properties = { owner: card.owner, priority: card.priority ?? null, effort: card.effort ?? null };
  if (tab === 'owner') properties.owner = key || null;
  if (tab === 'priority') properties.priority = (key || null) as CardPriority | null;
  if (tab === 'effort') properties.effort = key === '' ? null : Number(key);
  return { ...revision, action: 'set-card-properties', ...properties };
}

export function CardQuickSettings({ card, catalog, source, projectName, tab, onTabChange, disabled, anchor, onEdit, onClose, onSavingChange }: {
  card: CatalogCard; catalog: CatalogView; source?: DataSource; projectName?: string;
  tab: CardQuickSettingsTab; onTabChange: (tab: CardQuickSettingsTab) => void; disabled: boolean; anchor?: HTMLElement | null;
  onEdit: (action: CatalogAction) => Promise<boolean>; onClose: () => void; onSavingChange?: (saving: boolean) => void;
}) {
  const [initialOpener] = useState(() => document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const opener = anchor ?? initialOpener;
  const t = useText(text);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const id = useId();
  const current = catalog.cards.find(candidate => candidate.id === card.id);
  const value = current ?? card;
  const unavailable = disabled || saving || !current || Boolean(value.deleted);
  const propertyUnavailable = value.kind === 'doc' && (tab === 'priority' || tab === 'effort');
  const selectedTab = tabs.find(item => item.id === tab)!;

  useEffect(() => { onSavingChange?.(saving); }, [saving, onSavingChange]);
  useEffect(() => () => onSavingChange?.(false), [onSavingChange]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  async function choose(key: string) {
    if (unavailable || propertyUnavailable || inFlight.current) return;
    if (key === currentChoice(tab, value, catalog)) { onClose(); return; }
    inFlight.current = true; setSaving(true); setError('');
    try {
      const saved = await onEdit(choiceAction(tab, key, value, catalog));
      if (!mounted.current) return;
      if (saved) onClose();
      else setError(t.stale);
    } catch { if (mounted.current) setError(t.connection); }
    finally { inFlight.current = false; if (mounted.current) setSaving(false); }
  }

  function changeTab(next: CardQuickSettingsTab) { if (!saving) { setError(''); onTabChange(next); } }

  return <QuickSettingsPopover anchor={opener} busy={saving} onClose={onClose}>
    <div className="card-quick-settings" data-tab={tab} onKeyDown={event => {
      if (event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault(); event.stopPropagation();
      const index = tabs.findIndex(item => item.id === tab);
      changeTab(tabs[(index + (event.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length].id);
    }}>
      <div className="card-quick-tabs" role="tablist" aria-label={t.quickSettings}>
        {tabs.map(item => <button key={item.id} type="button" role="tab" id={id + '-' + item.id} aria-label={t[item.id]} title={t[item.id]}
          aria-controls={id + '-panel'} aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1} disabled={saving}
          onClick={() => changeTab(item.id)}><item.icon size={16} aria-hidden="true" /></button>)}
      </div>
      <div id={id + '-panel'} role="tabpanel" aria-labelledby={id + '-' + tab} className="card-quick-panel">
        <QuickSettingsList key={tab} title={t[selectedTab.id]} titleAs={Dialog.Title} tabs choices={choicesFor(tab, value, catalog, source, projectName)}
          current={currentChoice(tab, value, catalog)} disabled={unavailable || propertyUnavailable} searchDisabled={unavailable} onChoose={key => void choose(key)} />
      </div>
      {propertyUnavailable && <p className="card-quick-message">{t.docProperties}</p>}
      {error && <p className="card-quick-message" role="alert">{error}</p>}
    </div>
  </QuickSettingsPopover>;
}
