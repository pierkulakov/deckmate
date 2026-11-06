import { useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowRight, Check, Crown, Layers, Link2, LoaderCircle, RefreshCw, Search, UserRound, X } from 'lucide-react';
import type { CatalogCard, CatalogView } from '../src/catalog-contracts.ts';
import { shortReference } from '../src/references.ts';
import { StatusBadge } from './components/StatusMenu.tsx';
import { Button } from './components/ui/button.tsx';
import { defineText, locale, useLang, useText } from './i18n.ts';
import './attach-subcards.css';

const text = defineText({
  parentUnavailable: 'Parent unavailable',
  noParent: 'No parent',
  refreshedRemoved: (count: number) => `Selection updated. Removed ${count} already attached or unavailable cards. Check the rest.`,
  refreshed: 'Selection updated. Check the current Heroes before attaching.',
  attached: (attached: number, total: number, remaining: number) => `Attached ${attached} of ${total}. Remaining in selection: ${remaining}.`,
  incomplete: 'Attaching was only partially completed. Refresh the selection before retrying.',
  failed: 'Could not confirm attaching. Refresh the selection before retrying.',
  descriptionStart: 'Choose existing Task or Doc Cards for',
  descriptionEnd: '. Card decks are preserved.',
  close: 'Close Attach Sub Cards',
  search: 'Search existing Sub Cards',
  searchPlaceholder: 'Title, link, deck or owner',
  cardDeck: 'Card deck',
  noDeck: 'No deck',
  allShown: 'All shown',
  selected: (count: number, hidden: number) => `Selected ${count}${hidden > 0 ? ` · ${hidden} outside the filter` : ''}`,
  clear: 'Clear selection',
  sandboxOnly: 'Attaching is available in the project test copy.',
  invalidHero: 'The parent card is unavailable for attaching. Choose an active Hero or Doc Card without its own parent.',
  refreshTitle: 'Check the updated data',
  refreshDescription: 'The selection is preserved. Refresh it before the next attach attempt.',
  refresh: 'Refresh selection',
  existing: 'Existing Task and Doc Cards',
  attach: (title: string) => `Attach: ${title}`,
  deckUnavailable: 'Deck unavailable',
  journeyLocked: 'Link set by Journey',
  noMatching: 'No matching cards',
  noAvailable: 'No available Sub Cards',
  changeQuery: 'Try another title, link or deck.',
  availableHint: 'An active Task or Doc Card without its own Sub Cards can be attached.',
  reparenting: 'Parent change',
  confirmReparenting: (count: number, hero: string) => `Move these ${count} ${new Intl.PluralRules('en-US').select(count) === 'one' ? 'card' : 'cards'} from their current parents to “${hero}”`,
  tooMany: 'Choose no more than 1000 cards per operation.',
}, {
  parentUnavailable: 'Родитель недоступен',
  noParent: 'Без родителя',
  refreshedRemoved: (count: number) => `Выбор обновлён. Убрано ${count} уже прикреплённых или недоступных карт. Проверьте оставшиеся.`,
  refreshed: 'Выбор обновлён. Проверьте текущих Hero перед прикреплением.',
  attached: (attached: number, total: number, remaining: number) => `Прикреплено ${attached} из ${total}. Осталось в выборе: ${remaining}.`,
  incomplete: 'Прикрепление завершилось не полностью. Обновите выбор перед повтором.',
  failed: 'Не удалось подтвердить прикрепление. Обновите выбор перед повтором.',
  descriptionStart: 'Выберите существующие Task или Doc Cards для',
  descriptionEnd: '. Колоды карточек сохранятся.',
  close: 'Закрыть Attach Sub Cards',
  search: 'Поиск существующих Sub Cards',
  searchPlaceholder: 'Название, ссылка, колода или исполнитель',
  cardDeck: 'Колода карточек',
  noDeck: 'Без колоды',
  allShown: 'Все показанные',
  selected: (count: number, hidden: number) => `Выбрано ${count}${hidden > 0 ? ` · ${hidden} вне фильтра` : ''}`,
  clear: 'Снять выбор',
  sandboxOnly: 'Прикрепление доступно в тестовой копии проекта.',
  invalidHero: 'Родительская карта недоступна для прикрепления. Выберите активную Hero или Doc Card без собственного родителя.',
  refreshTitle: 'Проверьте обновлённые данные',
  refreshDescription: 'Выбор сохранён. Обновите его перед следующей попыткой прикрепления.',
  refresh: 'Обновить выбор',
  existing: 'Существующие Task и Doc Cards',
  attach: (title: string) => `Прикрепить: ${title}`,
  deckUnavailable: 'Колода недоступна',
  journeyLocked: 'Связь задана Journey',
  noMatching: 'Нет подходящих карточек',
  noAvailable: 'Нет доступных Sub Cards',
  changeQuery: 'Попробуйте другое название, ссылку или колоду.',
  availableHint: 'Прикрепить можно активную Task или Doc Card без собственных Sub Cards.',
  reparenting: 'Смена родителя',
  confirmReparenting: (count: number, hero: string) => `Перенести эти ${count} карты от текущих родителей к «${hero}»`,
  tooMany: 'Выберите не более 1000 карточек за одну операцию.',
});

export interface AttachSubCardsRequest {
  heroId: string;
  heroSourceHash: string;
  manifestHash: string;
  cards: Array<{ cardId: string; sourceHash: string; expectedParentId: string | null }>;
}

type SelectedCard = AttachSubCardsRequest['cards'][number] & {
  title: string;
};

interface AttachSubCardsProps {
  hero: CatalogCard;
  catalog: CatalogView;
  pending: boolean;
  writable: boolean;
  onAttach: (request: AttachSubCardsRequest) => Promise<{ attachedIds: string[]; error?: string }>;
  onClose: () => void;
}

const isChildCard = (card: CatalogCard) => (card.kind === 'task' || card.kind === 'doc') && !card.archived && !card.deleted;
const unassignedDeck = '__unassigned__';

export function AttachSubCards({ hero, catalog, pending, writable, onAttach, onClose }: AttachSubCardsProps) {
  const searchField = useRef<HTMLInputElement>(null);
  const t = useText(text);
  const lang = useLang();
  const languageTag = locale(lang);
  const opener = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const inFlight = useRef(false);
  const [search, setSearch] = useState('');
  const [deckId, setDeckId] = useState('');
  const [withoutHero, setWithoutHero] = useState(false);
  const [selected, setSelected] = useState<Map<string, SelectedCard>>(() => new Map());
  const [base, setBase] = useState(() => ({ heroId: hero.id, heroSourceHash: hero.sourceHash, manifestHash: catalog.manifestHash }));
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const busy = pending || running;
  const cardById = useMemo(() => new Map(catalog.cards.map(card => [card.id, card])), [catalog.cards]);
  const deckById = useMemo(() => new Map(catalog.decks.map(deck => [deck.id, deck])), [catalog.decks]);
  const currentHero = cardById.get(hero.id);
  const parentsWithChildren = useMemo(() => new Set(catalog.cards.map(card => card.parentId).filter(Boolean)), [catalog.cards]);
  const validHero = Boolean(currentHero && (currentHero.kind === 'hero' || currentHero.kind === 'doc')
    && !currentHero.parentId && !currentHero.journey && !currentHero.archived && !currentHero.deleted);
  const heroTitle = currentHero?.title ?? hero.title;
  const parentTitle = (id: string | null) => id ? cardById.get(id)?.title ?? t.parentUnavailable : t.noParent;
  const attachable = (card: CatalogCard) => isChildCard(card) && card.id !== hero.id && card.parentId !== hero.id && !card.journey && !parentsWithChildren.has(card.id);
  const candidates = useMemo(() => catalog.cards.filter(card => isChildCard(card) && card.id !== hero.id && !parentsWithChildren.has(card.id)).map(card => ({
    card,
    reference: shortReference('c', card.id),
    search: [card.title, card.id, shortReference('c', card.id), card.owner, deckById.get(card.deckId ?? '')?.title,
      cardById.get(card.parentId ?? '')?.title].join(' ').toLocaleLowerCase(languageTag),
  })).sort((first, second) => first.card.title.localeCompare(second.card.title, languageTag, { numeric: true }) || first.card.id.localeCompare(second.card.id)), [catalog.cards, deckById, cardById, hero.id, parentsWithChildren, languageTag]);
  const query = search.trim().toLocaleLowerCase(languageTag);
  const tokens = (query.match(/\bc-[a-z0-9]{10}\b/u)?.[0] ?? query).split(/\s+/u).filter(Boolean);
  const shown = candidates.filter(({ card, search: text }) => (!deckId || (deckId === unassignedDeck ? card.deckId === null : card.deckId === deckId))
    && (!withoutHero || card.parentId === null) && tokens.every(token => text.includes(token)));
  const selectableShown = shown.filter(({ card }) => attachable(card));
  const selectedShown = selectableShown.filter(({ card }) => selected.has(card.id)).length;
  const shownIds = new Set(shown.map(({ card }) => card.id));
  const hiddenSelected = [...selected.keys()].filter(id => !shownIds.has(id)).length;
  const entries = [...selected.values()];
  const reparenting = entries.filter(card => card.expectedParentId !== null && card.expectedParentId !== hero.id);
  const confirmationKey = JSON.stringify([hero.id, reparenting.map(card => [card.cardId, card.expectedParentId]).sort()]);
  const confirmed = confirmation === confirmationKey;
  const stale = selected.size > 0 && (base.heroId !== hero.id || base.heroSourceHash !== currentHero?.sourceHash || base.manifestHash !== catalog.manifestHash
    || entries.some(entry => {
      const card = cardById.get(entry.cardId);
      return !card || !attachable(card) || card.sourceHash !== entry.sourceHash || card.parentId !== entry.expectedParentId;
    }));
  const needsRefresh = refreshRequired || stale;
  const canAttach = writable && validHero && selected.size > 0 && selected.size <= 1000 && !busy && !needsRefresh && (!reparenting.length || confirmed);

  function capture(card: CatalogCard): SelectedCard {
    return { cardId: card.id, sourceHash: card.sourceHash, expectedParentId: card.parentId, title: card.title };
  }

  function prepareSelection() {
    if (selected.size === 0 && !refreshRequired && currentHero) {
      setBase({ heroId: hero.id, heroSourceHash: currentHero.sourceHash, manifestHash: catalog.manifestHash });
    }
    setConfirmation(null);
    setError('');
    setNotice('');
  }

  function toggle(card: CatalogCard) {
    if (busy || !writable || !validHero || !attachable(card)) return;
    prepareSelection();
    setSelected(previous => {
      const next = new Map(previous);
      if (next.has(card.id)) next.delete(card.id);
      else next.set(card.id, capture(card));
      return next;
    });
  }

  function toggleShown() {
    if (busy || !writable || !validHero || !selectableShown.length) return;
    prepareSelection();
    setSelected(previous => {
      const next = new Map(previous);
      const remove = selectableShown.every(({ card }) => previous.has(card.id));
      for (const { card } of selectableShown) {
        if (remove) next.delete(card.id);
        else if (!next.has(card.id)) next.set(card.id, capture(card));
      }
      return next;
    });
  }

  function refreshSelection() {
    if (busy || !currentHero || !validHero) return;
    const next = new Map<string, SelectedCard>();
    for (const entry of selected.values()) {
      const card = cardById.get(entry.cardId);
      if (card && attachable(card)) next.set(card.id, capture(card));
    }
    const removed = selected.size - next.size;
    setSelected(next);
    setBase({ heroId: hero.id, heroSourceHash: currentHero.sourceHash, manifestHash: catalog.manifestHash });
    setRefreshRequired(false);
    setConfirmation(null);
    setError('');
    setNotice(removed ? t.refreshedRemoved(removed) : t.refreshed);
  }

  function close() { if (!busy && !inFlight.current) onClose(); }

  async function attach() {
    if (!canAttach || inFlight.current) return;
    inFlight.current = true;
    setRunning(true);
    setError('');
    setNotice('');
    const request: AttachSubCardsRequest = { ...base, cards: entries.map(({ cardId, sourceHash, expectedParentId }) => ({ cardId, sourceHash, expectedParentId })) };
    try {
      const result = await onAttach(request);
      const successful = new Set(result.attachedIds.filter(id => selected.has(id)));
      const remaining = entries.filter(card => !successful.has(card.cardId));
      setSelected(new Map(remaining.map(card => [card.cardId, card])));
      setConfirmation(null);
      if (!remaining.length && !result.error) { onClose(); return; }
      setRefreshRequired(true);
      setNotice(t.attached(successful.size, entries.length, remaining.length));
      setError(result.error ?? t.incomplete);
    } catch (failure) {
      setRefreshRequired(true);
      setConfirmation(null);
      setError(failure instanceof Error ? failure.message : t.failed);
    } finally {
      inFlight.current = false;
      setRunning(false);
    }
  }

  return <Dialog.Root open onOpenChange={next => { if (!next) close(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="attach-subcards-overlay" />
      <Dialog.Content className="attach-subcards-dialog" aria-busy={busy}
        onOpenAutoFocus={event => { event.preventDefault(); searchField.current?.focus(); }}
        onCloseAutoFocus={event => { event.preventDefault(); if (opener.current?.isConnected) opener.current.focus(); }}
        onEscapeKeyDown={event => { if (busy || inFlight.current) event.preventDefault(); }}
        onPointerDownOutside={event => { if (busy || inFlight.current) event.preventDefault(); }}>
        <header className="attach-subcards-header">
          <span className="attach-subcards-icon"><Link2 size={20} /></span>
          <div><Dialog.Title>Attach Sub Cards</Dialog.Title><Dialog.Description>{t.descriptionStart}{' '}<strong>{heroTitle}</strong>{t.descriptionEnd}</Dialog.Description></div>
          <Button type="button" variant="ghost" size="icon" disabled={busy} onClick={close} aria-label={t.close}><X size={18} /></Button>
        </header>
        <form className="attach-subcards-form" onSubmit={event => { event.preventDefault(); void attach(); }}>
          <fieldset className="attach-subcards-filters" disabled={busy}>
            <label className="attach-subcards-search"><Search size={17} /><span className="visually-hidden">{t.search}</span><input ref={searchField} type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={t.searchPlaceholder} /></label>
            <div><label className="attach-subcards-deck"><Layers size={14} /><span className="visually-hidden">{t.cardDeck}</span><select value={deckId} onChange={event => setDeckId(event.target.value)}><option value="">All decks</option><option value={unassignedDeck}>{t.noDeck}</option>{catalog.decks.map(deck => <option key={deck.id} value={deck.id}>{deck.title}</option>)}</select></label>
              <label className="attach-subcards-without"><input type="checkbox" checked={withoutHero} onChange={event => setWithoutHero(event.target.checked)} />{t.noParent}</label></div>
          </fieldset>
          <div className="attach-subcards-selection">
            <label><input type="checkbox" checked={selectableShown.length > 0 && selectedShown === selectableShown.length} ref={input => { if (input) input.indeterminate = selectedShown > 0 && selectedShown < selectableShown.length; }} disabled={busy || !writable || !validHero || !selectableShown.length} onChange={toggleShown} />{t.allShown} <span>{shown.length}</span></label>
            <span role="status">{t.selected(selected.size, hiddenSelected)}</span>
            {selected.size > 0 && <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => { setSelected(new Map()); setConfirmation(null); }}>{t.clear}</Button>}
          </div>
          <div className="attach-subcards-scroll">
            {!writable && <p className="attach-subcards-message" role="status">{t.sandboxOnly}</p>}
            {!validHero && <p className="attach-subcards-message is-error" role="alert">{t.invalidHero}</p>}
            {needsRefresh && <div className="attach-subcards-refresh" role="status"><div><strong>{t.refreshTitle}</strong><p>{t.refreshDescription}</p></div><Button type="button" variant="outline" size="sm" disabled={busy || !validHero} onClick={refreshSelection}><RefreshCw size={14} />{t.refresh}</Button></div>}
            {notice && <p className="attach-subcards-message" role="status">{notice}</p>}
            {error && <p className="attach-subcards-message is-error" role="alert">{error}</p>}
            <div className="attach-subcards-list" role="group" aria-label={t.existing}>{shown.map(({ card, reference }) => {
              const alreadyAttached = card.parentId === hero.id;
              const journeyLocked = Boolean(card.journey) && !alreadyAttached;
              const checked = alreadyAttached || selected.has(card.id);
              return <label key={card.id} className={'attach-subcards-row' + (checked ? ' is-selected' : '') + (alreadyAttached || journeyLocked ? ' is-unavailable' : '')}>
                <input type="checkbox" checked={checked} disabled={busy || !writable || alreadyAttached || journeyLocked || !validHero} onChange={() => toggle(card)} aria-label={t.attach(card.title)} />
                <span className="attach-subcards-card"><span className="attach-subcards-card-title"><strong>{card.title}</strong>{card.state && <StatusBadge state={card.state} />}</span>
                  <span className="attach-subcards-card-meta"><span><Layers size={12} />{card.deckId ? deckById.get(card.deckId)?.title ?? t.deckUnavailable : t.noDeck}</span><span><UserRound size={12} />{card.owner ?? 'Unassigned'}</span><code>{reference}</code></span>
                  <span className="attach-subcards-parent"><Crown size={12} />{parentTitle(card.parentId)}{alreadyAttached && <span className="attach-subcards-attached"><Check size={12} />Already attached</span>}{journeyLocked && <span className="attach-subcards-locked">{t.journeyLocked}</span>}</span>
                </span>
              </label>;
            })}</div>
            {shown.length === 0 && <div className="attach-subcards-empty"><Search size={24} /><strong>{candidates.length ? t.noMatching : t.noAvailable}</strong><p>{candidates.length ? t.changeQuery : t.availableHint}</p></div>}
          </div>
          <footer className="attach-subcards-footer">
            {reparenting.length > 0 && <div className="attach-subcards-reparent"><strong>{t.reparenting} · {reparenting.length}</strong><ul>{reparenting.map(card => <li key={card.cardId}><strong>{card.title}</strong><span>{parentTitle(card.expectedParentId)}<ArrowRight size={12} />{heroTitle}</span></li>)}</ul>
              <label><input type="checkbox" checked={confirmed && !needsRefresh} disabled={busy || needsRefresh || !writable} onChange={event => setConfirmation(event.target.checked ? confirmationKey : null)} />{t.confirmReparenting(reparenting.length, heroTitle)}</label></div>}
            {selected.size > 1000 && <p className="attach-subcards-message is-error" role="alert">{t.tooMany}</p>}
            <div className="attach-subcards-actions"><span><Crown size={14} /><strong>{heroTitle}</strong></span><Button type="button" variant="ghost" disabled={busy} onClick={close}>Cancel</Button><Button type="submit" disabled={!canAttach}>{busy ? <LoaderCircle size={15} className="spin" /> : <Link2 size={15} />}Attach{selected.size > 0 && ` ${selected.size}`}</Button></div>
          </footer>
        </form>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
