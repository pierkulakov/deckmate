import { useEffect, useId, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Flag, LayoutGrid, Play, UserRound } from 'lucide-react';
import { deckAcceptsCard, type CardPriority, type CatalogCard, type CatalogView } from '../../src/catalog-contracts.ts';
import type { DataSource } from '../../src/workspace-contracts.ts';
import type { CatalogAction } from '../useCatalog.ts';
import type { CardQuickSettingsTab } from '../keyboard-shortcuts.ts';
import { CardOwnerAvatar, memberForOwner } from './CardOwnerAvatar.tsx';
import { deckChoices } from './DeckChoices.tsx';
import { QuickSettingsList, QuickSettingsPopover, type QuickSettingsChoice } from './QuickSettingsList.tsx';
import { defineText, formatNumber, textNow, useLang, useText } from '../i18n.ts';
import { priorityLabel } from '../locales/common.ts';
import { orderedRunChoices, runChoiceLabel } from '../run-label.ts';
import { AgentQueueHint } from './AgentQueueHint.tsx';
import { PriorityIcon } from './PriorityIcon.tsx';
import { EffortIcon } from './EffortIcon.tsx';
import { navigateTabs } from '../tab-navigation.ts';
import { moveFocus } from '../focus.ts';
import { subCardWeight } from '../sub-card-state.ts';
import '../card-quick-settings.css';

const text = defineText({
  none: 'None',
  noDeck: 'No deck',
  unassigned: 'Unassigned',
  stale: 'Change not saved. Check the updated data and try again.',
  connection: 'Could not save. Check the connection and try again.',
  docProperties: 'Doc cards have no Priority or Effort.',
  quickSettings: 'Quick Settings',
  ownEffort: 'Own effort',
  totalEffort: (value: string) => `Total effort incl. Sub Cards: ${value}`,
  deck: 'Deck', owner: 'Owner', run: 'Run', milestone: 'Milestone', priority: 'Priority', effort: 'Effort',
}, {
  none: 'Нет',
  noDeck: 'Без колоды',
  unassigned: 'Без исполнителя',
  stale: 'Изменение не сохранено. Проверьте обновлённые данные и повторите выбор.',
  connection: 'Не удалось сохранить. Проверьте соединение и повторите выбор.',
  docProperties: 'У Doc нет приоритета и оценки.',
  quickSettings: 'Быстрые настройки',
  ownEffort: 'Своя оценка',
  totalEffort: (value: string) => `Суммарная оценка с Sub Cards: ${value}`,
  deck: 'Колода', owner: 'Исполнитель', run: 'Run', milestone: 'Milestone', priority: 'Приоритет', effort: 'Оценка',
});

export { CardOwnerAvatar } from './CardOwnerAvatar.tsx';
export type { CardQuickSettingsTab } from '../keyboard-shortcuts.ts';
const tabs = [
  { id: 'deck', icon: LayoutGrid }, { id: 'owner', icon: UserRound },
  { id: 'run', icon: Play }, { id: 'milestone', icon: Flag },
  { id: 'priority', icon: PriorityIcon }, { id: 'effort', icon: EffortIcon },
] as const;
export const cardPriorityOptions: { value: CardPriority | null }[] = [
  { value: null }, { value: 'low' }, { value: 'medium' }, { value: 'high' },
];
export const cardEffortPresets = [0, 1, 2, 3, 5, 8] as const;

export function cardHeroEffort(card: CatalogCard, catalog: Pick<CatalogView, 'cards'>): number | null {
  if (card.kind !== 'hero') return null;
  const children = catalog.cards.filter(candidate => candidate.parentId === card.id && candidate.kind === 'task' && !candidate.archived && !candidate.deleted);
  if (!children.length && card.effort == null) return null;
  // 2026-11-11: a Hero's own estimate is additional work; an unestimated Sub Card counts one point.
  return (card.effort ?? 0) + children.reduce((total, child) => total + subCardWeight(child), 0);
}

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
  if (tab === 'priority') return cardPriorityOptions.map(option => ({ key: option.value ?? '', label: option.value ? priorityLabel(option.value) : t.none, icon: <span aria-hidden="true"><PriorityIcon priority={option.value} /></span> }));
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
  const lang = useLang();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const tabList = useRef<HTMLDivElement>(null);
  const keyboardTabChange = useRef(false);
  const id = useId();
  const current = catalog.cards.find(candidate => candidate.id === card.id);
  const value = current ?? card;
  const unavailable = disabled || saving || !current || Boolean(value.deleted);
  const propertyUnavailable = value.kind === 'doc' && (tab === 'priority' || tab === 'effort');
  const selectedTab = tabs.find(item => item.id === tab)!;
  const heroEffort = tab === 'effort' && value.kind === 'hero' ? cardHeroEffort(value, catalog) : null;

  useEffect(() => { onSavingChange?.(saving); }, [saving, onSavingChange]);
  useEffect(() => () => onSavingChange?.(false), [onSavingChange]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    // 2026-11-11: a newly mounted search focuses itself; arrow navigation must keep focus with the selected tab.
    if (!keyboardTabChange.current) return;
    keyboardTabChange.current = false;
    moveFocus(tabList.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]'));
  }, [tab]);

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
    <div className="card-quick-settings" data-tab={tab}>
      <div ref={tabList} className="card-quick-tabs" role="tablist" aria-label={t.quickSettings} onKeyDown={event => {
        navigateTabs(event);
        keyboardTabChange.current = event.defaultPrevented;
      }}>
        {tabs.map(item => <button key={item.id} type="button" role="tab" id={id + '-' + item.id} aria-label={t[item.id]} title={t[item.id]}
          aria-controls={id + '-panel'} aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1} disabled={saving}
          onClick={() => changeTab(item.id)}>{item.id === 'priority'
            ? <span aria-hidden="true"><PriorityIcon priority={value.priority} /></span>
            : <item.icon size={16} aria-hidden="true" />}</button>)}
      </div>
      <div id={id + '-panel'} role="tabpanel" aria-labelledby={id + '-' + tab} className="card-quick-panel">
        {tab === 'effort' && value.kind === 'hero' && <p className="card-quick-total">{t.totalEffort(heroEffort == null ? '—' : formatNumber(heroEffort, 20, lang))}</p>}
        <QuickSettingsList key={tab} title={tab === 'effort' && value.kind === 'hero' ? t.ownEffort : t[selectedTab.id]} titleAs={Dialog.Title} choices={choicesFor(tab, value, catalog, source, projectName)}
          current={currentChoice(tab, value, catalog)} disabled={unavailable || propertyUnavailable} searchDisabled={unavailable} onChoose={key => void choose(key)} />
      </div>
      {propertyUnavailable && <p className="card-quick-message">{t.docProperties}</p>}
      {tab === 'owner' && catalog.members?.some(member => member.kind === 'agent') && <AgentQueueHint />}
      {error && <p className="card-quick-message" role="alert">{error}</p>}
    </div>
  </QuickSettingsPopover>;
}
