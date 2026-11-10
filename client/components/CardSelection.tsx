import { defineText, locale, textNow, useLang, useText } from '../i18n.ts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, Copy, Layers, LoaderCircle, Route, X } from 'lucide-react';
import type { CatalogCard, CatalogView } from '../../src/catalog-contracts.ts';
import { deckAcceptsCard } from '../../src/catalog-contracts.ts';
import { shortReference } from '../../src/references.ts';
import type { DataSource } from '../../src/workspace-contracts.ts';
import type { BulkChange } from '../../src/bulk-contracts.ts';
import { BulkActions } from './BulkActions.tsx';
import { Button } from './ui/button.tsx';
import { ALL_SHORTCUTS, BULK_SHORTCUTS, matchShortcut, resolveHoveredCardShortcut, shortcutTargetBlocked } from '../keyboard-shortcuts.ts';
import { failureMessage } from '../failure-message.ts';
import '../card-selection.css';

const text = defineText({
  noTracks: "No Tracks in this project yet",
  overLimit: "Limit: 1,000 cards per action. Select fewer cards.",
  copiedCount: (count: string) => `Links copied: ${count}`,
  copyFailed: "Could not copy links. Check clipboard access and try again.",
  saveUnconfirmed: "Save not confirmed. Check the catalog message and current selection.",
  saveFailed: "Could not save changes. Your card selection was kept.",
  actions: "Selected card actions",
  clear: "Clear selection",
  clearHint: "Clear selection · Escape",
  selectedHint: (count: string, total: string) => `${count} of ${total} shown selected`,
  selectAllHint: "Select all shown cards · Ctrl/Cmd+A",
  selectionActions: "Selection actions",
  limit: "Limit: 1,000 cards",
  compatibleDecks: "Decks compatible with all selected cards are shown.",
  noDeck: "No deck",
  trackHint: "Adds a link and keeps existing Tracks.",
  copied: "Links copied",
  moveCount: (count: number) => `Move ${new Intl.NumberFormat(locale("en")).format(count)} ${new Intl.PluralRules(locale("en")).select(count) === "one" ? "card" : "cards"} to Deck`,
  trackCount: (count: number) => `Add ${new Intl.NumberFormat(locale("en")).format(count)} ${new Intl.PluralRules(locale("en")).select(count) === "one" ? "card" : "cards"} to Track`,
  selected: (count: number): string => new Intl.PluralRules(locale("en")).select(count) === "one" ? "card selected" : "cards selected",
  uiAddToTrack: "Add to Track",
  uiSelectAll: "Select all",
  uiMoveToDeck: "Move to Deck",
  uiCopyRefs: "Copy refs"
}, {
  noTracks: "В проекте ещё нет треков",
  overLimit: "Лимит — 1000 карточек за операцию. Уменьшите выделение.",
  copiedCount: (count: string) => `Скопировано ссылок: ${count}`,
  copyFailed: "Не удалось скопировать ссылки. Проверьте доступ к буферу обмена и повторите.",
  saveUnconfirmed: "Сохранение не подтверждено. Проверьте сообщение каталога и актуальный выбор.",
  saveFailed: "Не удалось сохранить изменения. Выбор карточек сохранён.",
  actions: "Действия с выбранными карточками",
  clear: "Снять выбор",
  clearHint: "Снять выбор · Escape",
  selectedHint: (count: string, total: string) => `Выбрано ${count} из ${total} показанных`,
  selectAllHint: "Выбрать все показанные карточки · Ctrl/Cmd+A",
  selectionActions: "Действия с выделением",
  limit: "Лимит — 1000 карточек",
  compatibleDecks: "Показаны колоды, совместимые со всеми выбранными карточками.",
  noDeck: "Без колоды",
  trackHint: "Добавляет связь, сохраняя существующие треки.",
  copied: "Ссылки скопированы",
  moveCount: (count: number) => {
    const rule = new Intl.PluralRules(locale("ru")).select(count);
    const noun = { one: 'карточку', few: 'карточки', many: 'карточек', zero: 'карточек', two: 'карточки', other: 'карточки' }[rule]!;
    return `Переместить ${new Intl.NumberFormat(locale("ru")).format(count)} ${noun} в колоду`;
  },
  trackCount: (count: number) => {
    const rule = new Intl.PluralRules(locale("ru")).select(count);
    const noun = { one: 'карточку', few: 'карточки', many: 'карточек', zero: 'карточек', two: 'карточки', other: 'карточки' }[rule]!;
    return `Добавить ${new Intl.NumberFormat(locale("ru")).format(count)} ${noun} в трек`;
  },
  selected: (count: number) => {
    const rule = new Intl.PluralRules(locale("ru")).select(count);
    return { one: 'карточка выбрана', few: 'карточки выбраны', many: 'карточек выбрано', zero: 'карточек выбрано', two: 'карточки выбраны', other: 'карточки выбраны' }[rule]!;
  },
  uiAddToTrack: "Добавить в трек",
  uiSelectAll: "Выбрать все",
  uiMoveToDeck: "Переместить в колоду",
  uiCopyRefs: "Скопировать ссылки"
});


const selectionShortcutIds = new Set(['close-stepwise', 'bulk-select-all', 'bulk-invert', 'hover-select', 'open-metrics', 'open-recent-activity']);
const selectionShortcuts = ALL_SHORTCUTS.filter(shortcut => selectionShortcutIds.has(shortcut.id));
const bulkMoveShortcut = BULK_SHORTCUTS.find(shortcut => shortcut.id === 'bulk-deck');

interface SelectionState {
  scopeKey: string;
  ids: Set<string>;
  anchor: string | null;
}

function emptySelection(scopeKey: string): SelectionState {
  return { scopeKey, ids: new Set(), anchor: null };
}

export function useCardSelection(orderedIds: readonly string[], scopeKey: string, locked = false) {
  const [selection, setSelection] = useState<SelectionState>(() => emptySelection(scopeKey));
  const orderedKey = JSON.stringify(orderedIds);
  const visibleIds = useMemo(() => new Set(orderedIds), [orderedKey]);
  // Derive the safe set during render: a changed view must never expose the old bulk targets (2026-11-03).
  const selectedIds = useMemo(() => {
    if (selection.scopeKey !== scopeKey) return new Set<string>();
    return new Set([...selection.ids].filter(id => visibleIds.has(id)));
  }, [selection, scopeKey, visibleIds]);

  useEffect(() => {
    setSelection(previous => {
      if (previous.scopeKey !== scopeKey) return emptySelection(scopeKey);
      const ids = new Set([...previous.ids].filter(id => visibleIds.has(id)));
      const anchor = previous.anchor && visibleIds.has(previous.anchor) ? previous.anchor : null;
      if (ids.size === previous.ids.size && anchor === previous.anchor) return previous;
      return { scopeKey, ids, anchor };
    });
  }, [scopeKey, visibleIds]);

  const clear = useCallback(() => {
    if (!locked) setSelection(emptySelection(scopeKey));
  }, [scopeKey, locked]);

  const selectAllShown = useCallback(() => {
    if (locked) return;
    setSelection({ scopeKey, ids: new Set(orderedIds), anchor: orderedIds[0] ?? null });
  }, [scopeKey, orderedKey, locked]);

  const toggle = useCallback((id: string, shiftKey = false) => {
    if (locked || !visibleIds.has(id)) return;
    setSelection(previous => {
      const current = previous.scopeKey === scopeKey ? previous : emptySelection(scopeKey);
      const ids = new Set([...current.ids].filter(value => visibleIds.has(value)));
      const shouldSelect = !ids.has(id);
      const anchorIndex = current.anchor ? orderedIds.indexOf(current.anchor) : -1;
      const targetIndex = orderedIds.indexOf(id);
      const range = shiftKey && anchorIndex >= 0
        ? orderedIds.slice(Math.min(anchorIndex, targetIndex), Math.max(anchorIndex, targetIndex) + 1)
        : [id];
      for (const candidate of range) {
        if (shouldSelect) ids.add(candidate);
        else ids.delete(candidate);
      }
      const anchor = shiftKey && anchorIndex >= 0 ? current.anchor : id;
      return { scopeKey, ids, anchor };
    });
  }, [scopeKey, orderedKey, visibleIds, locked]);

  const toggleGroup = useCallback((groupIds: readonly string[]) => {
    if (locked) return;
    const targets = [...new Set(groupIds)].filter(id => visibleIds.has(id));
    if (targets.length === 0) return;
    setSelection(previous => {
      const current = previous.scopeKey === scopeKey ? previous : emptySelection(scopeKey);
      const ids = new Set([...current.ids].filter(id => visibleIds.has(id)));
      const shouldSelect = !targets.every(id => ids.has(id));
      for (const id of targets) {
        if (shouldSelect) ids.add(id);
        else ids.delete(id);
      }
      return { scopeKey, ids, anchor: targets[0] };
    });
  }, [scopeKey, visibleIds, locked]);

  useEffect(() => {
    if (locked) return;
    function onSelectionKey(event: KeyboardEvent) {
      if (shortcutTargetBlocked(event, 'selection')) return;
      const shortcut = matchShortcut(event, selectionShortcuts);
      if (!shortcut) return;
      if (shortcut.id === 'open-metrics' || shortcut.id === 'open-recent-activity') {
        const panel = shortcut.id === 'open-metrics' ? 'info' : 'activity';
        const button = [...document.querySelectorAll<HTMLButtonElement>(`.deck-action-rail [data-deck-panel="${panel}"]`)]
          .find(candidate => candidate.getClientRects().length > 0 && !candidate.disabled);
        if (!button) return;
        event.preventDefault();
        // Repeating Shift+M or Shift+I keeps the panel open.
        if (button.getAttribute('aria-pressed') !== 'true') button.click();
        return;
      }
      const hovered = shortcut.id === 'hover-select' ? resolveHoveredCardShortcut(event)?.cardId : undefined;
      if (shortcut.id === 'hover-select' && (!hovered || !visibleIds.has(hovered))) return;
      if (shortcut.id === 'close-stepwise' && selectedIds.size === 0) return;
      if (orderedIds.length === 0) return;
      event.preventDefault();
      if (shortcut.id === 'bulk-select-all') selectAllShown();
      else if (shortcut.id === 'bulk-invert') setSelection({ scopeKey, ids: new Set(orderedIds.filter(id => !selectedIds.has(id))), anchor: null });
      else if (hovered) toggle(hovered);
      else if (shortcut.id === 'close-stepwise') clear();
    }
    window.addEventListener('keydown', onSelectionKey);
    return () => window.removeEventListener('keydown', onSelectionKey);
  }, [selectedIds, scopeKey, orderedKey, locked, clear, selectAllShown, toggle]);

  return { selectedIds, toggle, toggleGroup, selectAllShown, clear, retain: (ids: string[]) => setSelection({ scopeKey, ids: new Set(ids.filter(id => visibleIds.has(id))), anchor: null }) };
}

type SelectionAction = (id: string) => Promise<boolean> | boolean;

export interface SelectionToolbarProps {
  selectedCards: CatalogCard[];
  source: DataSource;
  catalog: CatalogView;
  totalShown: number;
  pending: boolean;
  writable: boolean;
  onClear: () => void;
  onSelectAll: () => void;
  onMove: (deckId: string | null) => Promise<boolean> | boolean;
  onAddTrack: SelectionAction;
  onAction: (change: BulkChange) => Promise<boolean>;
}

export function SelectionToolbar({ selectedCards, source, catalog, totalShown, pending, writable, onClear, onSelectAll, onMove, onAddTrack, onAction }: SelectionToolbarProps) {
  const t = useText(text);
  const lang = useLang();
  const amount = (value: number) => new Intl.NumberFormat(locale(lang)).format(value);
  const [openMenu, setOpenMenu] = useState<'move' | 'track' | null>(null);
  const [running, setRunning] = useState<'move' | 'track' | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const [copyCount, setCopyCount] = useState(0);
  const [actionErrorMessage, setActionError] = useState<string | (() => string)>('');
  const actionError = typeof actionErrorMessage === 'function' ? actionErrorMessage() : actionErrorMessage;
  const inFlight = useRef(false);
  const selected = useMemo(() => [...new Map(selectedCards.map(card => [card.id, card])).values()], [selectedCards]);
  const selectedKey = JSON.stringify(selected.map(card => card.id));
  const exceedsBulkLimit = selected.length > 1000;
  const compatibleDecks = catalog.decks.filter(deck => selected.every(card => deckAcceptsCard(deck.kind, card.kind)));
  const busy = pending || running !== null;
  const canWrite = writable && source === 'sandbox';
  const mutationDisabled = busy || exceedsBulkLimit;
  const trackActionTitle = catalog.tracks.length > 0 ? t.uiAddToTrack : t.noTracks;
  let feedback = actionError;
  if (exceedsBulkLimit && canWrite) feedback = t.overLimit;
  else if (!feedback && copyState === 'copied') feedback = t.copiedCount(amount(copyCount));
  else if (!feedback && copyState === 'error') feedback = t.copyFailed;

  useEffect(() => {
    if (inFlight.current) return;
    setOpenMenu(null);
    setActionError('');
  }, [selectedKey, source]);

  useEffect(() => {
    if (copyState === 'idle') return;
    const timer = window.setTimeout(() => setCopyState('idle'), 3000);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  async function copyReferences() {
    if (busy || selected.length === 0) return;
    setActionError('');
    const text = selected.map(card => `${card.title.replace(/\s+/gu, ' ').trim()} — ${location.origin}/r/${shortReference('c', card.id)}?source=${source}`).join('\n');
    try { await navigator.clipboard.writeText(text); setCopyCount(selected.length); setCopyState('copied'); }
    catch { setCopyState('error'); }
  }

  async function runAction(kind: 'move' | 'track', target: string | null) {
    if (inFlight.current || busy || !writable || source !== 'sandbox' || selected.length === 0 || exceedsBulkLimit) return;
    if (kind === 'move' && ((target !== null && !compatibleDecks.some(deck => deck.id === target)) || selected.every(card => card.deckId === target))) return;
    if (kind === 'track' && (!target || !catalog.tracks.some(track => track.id === target) || selected.every(card => card.trackIds.includes(target)))) return;
    inFlight.current = true;
    setRunning(kind);
    setActionError('');
    try {
      const saved = kind === 'move' ? await onMove(target) : await onAddTrack(target!);
      if (saved) setOpenMenu(null);
      else setActionError(() => () => textNow(text).saveUnconfirmed);
    } catch (error) {
      setActionError(() => failureMessage(error, textNow(text).saveFailed));
    } finally {
      inFlight.current = false;
      setRunning(null);
    }
  }

  if (selected.length === 0) return null;
  return <section className="card-selection-toolbar card-selection-bar" aria-label={t.actions} aria-busy={busy}>
    <div className="card-selection-core">
      <Button type="button" variant="ghost" size="icon" className="card-selection-clear" disabled={busy} onClick={onClear} aria-label={t.clear} title={t.clearHint}><X size={17} /></Button>
      <strong className="card-selection-count" aria-live="polite" title={t.selectedHint(amount(selected.length), amount(totalShown))}><span>{amount(selected.length)}</span> {t.selected(selected.length)}</strong>
      <Button type="button" variant="outline" size="sm" className="card-selection-all" disabled={busy || selected.length >= totalShown} onClick={onSelectAll} aria-keyshortcuts="Control+A Meta+A" title={t.selectAllHint}>{t.uiSelectAll}</Button>
      <span className="card-selection-divider" aria-hidden="true" />
      <div className="card-selection-buttons" role="group" aria-label={t.selectionActions}>
        {canWrite && <DropdownMenu.Root modal={false} open={openMenu === 'move'} onOpenChange={open => { setOpenMenu(open ? 'move' : null); if (open) setActionError(''); }}>
          <DropdownMenu.Trigger asChild><Button type="button" variant="ghost" size="icon" disabled={mutationDisabled} aria-label={t.uiMoveToDeck} aria-keyshortcuts={bulkMoveShortcut?.keys} title={exceedsBulkLimit ? t.limit : t.uiMoveToDeck + ' · ' + (bulkMoveShortcut?.keys ?? '')}>{running === 'move' ? <LoaderCircle className="spin" size={17} /> : <Layers size={17} />}</Button></DropdownMenu.Trigger>
          <DropdownMenu.Portal><DropdownMenu.Content className="card-selection-menu" align="start" sideOffset={7} collisionPadding={12} aria-label={t.uiMoveToDeck} onEscapeKeyDown={event => { event.preventDefault(); setOpenMenu(null); }}>
            <DropdownMenu.Label className="card-selection-menu-heading">{t.moveCount(selected.length)}</DropdownMenu.Label>
            <p className="card-selection-menu-hint">{t.compatibleDecks}</p>
            <DropdownMenu.Item className="card-selection-menu-item" disabled={mutationDisabled || selected.every(card => card.deckId === null)} onSelect={event => { event.preventDefault(); void runAction('move', null); }}><Layers size={15} /><span>{t.noDeck}</span>{selected.every(card => card.deckId === null) && <Check size={14} />}</DropdownMenu.Item>
            {catalog.spaces.map(space => {
              const decks = compatibleDecks.filter(deck => deck.spaceId === space.id);
              return decks.length > 0 ? <DropdownMenu.Group key={space.id}><DropdownMenu.Label className="card-selection-menu-group">{space.title}</DropdownMenu.Label>{decks.map(deck => {
                const current = selected.every(card => card.deckId === deck.id);
                return <DropdownMenu.Item key={deck.id} className="card-selection-menu-item" disabled={mutationDisabled || current} onSelect={event => { event.preventDefault(); void runAction('move', deck.id); }}><Layers size={15} /><span>{deck.title}</span>{current && <Check size={14} />}</DropdownMenu.Item>;
              })}</DropdownMenu.Group> : null;
            })}
            {actionError && <p className="card-selection-menu-error" role="alert">{actionError}</p>}
          </DropdownMenu.Content></DropdownMenu.Portal>
        </DropdownMenu.Root>}
        <BulkActions cards={selected} catalog={catalog} source={source} writable={canWrite} pending={busy || openMenu !== null} onAction={onAction} onOpenDeck={canWrite ? () => { if (!mutationDisabled) setOpenMenu('move'); } : undefined} />
        {canWrite && <DropdownMenu.Root modal={false} open={openMenu === 'track'} onOpenChange={open => { setOpenMenu(open ? 'track' : null); if (open) setActionError(''); }}>
          <DropdownMenu.Trigger asChild><Button type="button" variant="ghost" size="icon" disabled={mutationDisabled || catalog.tracks.length === 0} aria-label={t.uiAddToTrack} title={exceedsBulkLimit ? t.limit : trackActionTitle}>{running === 'track' ? <LoaderCircle className="spin" size={17} /> : <Route size={17} />}</Button></DropdownMenu.Trigger>
          <DropdownMenu.Portal><DropdownMenu.Content className="card-selection-menu" align="start" sideOffset={7} collisionPadding={12} aria-label={t.uiAddToTrack} onEscapeKeyDown={event => { event.preventDefault(); setOpenMenu(null); }}>
            <DropdownMenu.Label className="card-selection-menu-heading">{t.trackCount(selected.length)}</DropdownMenu.Label>
            <p className="card-selection-menu-hint">{t.trackHint}</p>
            {catalog.tracks.map(track => {
              const included = selected.every(card => card.trackIds.includes(track.id));
              return <DropdownMenu.Item key={track.id} className="card-selection-menu-item" disabled={mutationDisabled || included} onSelect={event => { event.preventDefault(); void runAction('track', track.id); }}><Route size={15} /><span>{track.title}</span>{included && <Check size={14} />}</DropdownMenu.Item>;
            })}
            {actionError && <p className="card-selection-menu-error" role="alert">{actionError}</p>}
          </DropdownMenu.Content></DropdownMenu.Portal>
        </DropdownMenu.Root>}
        <Button type="button" variant="ghost" size="icon" disabled={busy} onClick={() => void copyReferences()} aria-label={copyState === 'copied' ? t.copied : t.uiCopyRefs} title={t.uiCopyRefs}>{copyState === 'copied' ? <Check size={17} /> : <Copy size={17} />}</Button>
      </div>
    </div>
    <span className="card-selection-status" role={actionError && !openMenu ? 'alert' : 'status'} title={feedback}>{feedback}</span>
  </section>;
}
