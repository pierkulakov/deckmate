import { useId, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowLeft, Check, Crown, Gauge, Layers, LoaderCircle, NotebookText, Search, X } from 'lucide-react';
import { deckAcceptsCard, type CatalogCard, type CatalogView } from '../../src/catalog-contracts.ts';
import { shortReference } from '../../src/references.ts';
import { Button } from './ui/button.tsx';
import { CardOwnerAvatar } from './CardQuickSettings.tsx';
import { defineText, locale, useLang, useText } from '../i18n.ts';
import { priorityLabel } from '../locales/common.ts';
import { failureMessage } from '../failure-message.ts';
import { moveFocus } from '../focus.ts';
import '../card-family.css';

const text = defineText({
  unavailable: 'The card is no longer available. Close the window and choose an active card.',
  journeyLocked: 'The parent link is set by Journey and cannot be changed separately.',
  hasChildren: 'This card has Sub Cards. Nested families are not supported.',
  heroChild: 'A Hero Card cannot become a Sub Card.',
  promoteIncomplete: 'Not all changes were confirmed. The selected card is preserved in the form. Check the catalog message; after a partial save, reopen Select with current data.',
  promoteFailed: 'Could not promote the card to Hero. The selection is preserved.',
  deckUnavailable: 'Deck unavailable',
  noDeck: 'No deck',
  owner: (owner: string) => `Owner: ${owner}`,
  unassigned: 'Unassigned',
  chooseFailed: 'The link was not confirmed. Check the catalog message; the selected card is preserved in the form.',
  chooseError: 'Could not change the parent card.',
  title: 'Select parent card',
  description: (title: string) => `${title}: click a Hero or Doc Card to assign a parent.`,
  close: 'Close parent card picker',
  search: 'Find parent card',
  searchPlaceholder: 'Title or short link',
  stale: 'Data changed after opening. Close and reopen Select to check current links.',
  promotion: (title: string) => `The card will become a Hero and the parent of “${title}”. Its text, ID and links are preserved.`,
  leavesFamily: (title: string) => ` It will leave the “${title}” family.`,
  taskState: 'The Task state will be replaced by Sub Cards progress.',
  currentDeck: 'Current deck',
  deckRejected: (deck: string) => `“${deck}” does not accept Hero. Choose another deck or Without Deck.`,
  promotionUnavailable: 'Promotion to Hero is unavailable',
  parentCard: 'Parent card',
  noParentKeepDeck: 'No parent · deck will not change',
  noParent: 'No parent card',
  noMatches: 'No matches. Change the title or link.',
  noCandidates: 'No cards are available to assign as a parent.',
  effort: 'Effort',
  priority: 'Priority',
  promoteToHero: 'Promote to Hero',
  docCard: 'Doc Card',
  heroCard: 'Hero Card',
  heroDeck: 'Hero Deck',
  chooseHeroDeck: 'Choose Asset or Mixed Deck',
  withoutDeck: 'Without Deck',
  back: 'Back',
  promoteSelect: 'Promote & Select',
  none: 'None',
  heroCards: 'Hero Cards',
  otherCards: 'Other Cards',
  cancel: 'Cancel',
  select: 'Select',
  removeParent: 'Remove Parent',
}, {
  unavailable: 'Карточка больше недоступна. Закройте окно и выберите активную карточку.',
  journeyLocked: 'Родительская связь задана Journey и не меняется отдельно.',
  hasChildren: 'У этой карточки есть Sub Cards. Вложенные семьи не поддерживаются.',
  heroChild: 'Hero Card не может стать Sub Card.',
  promoteIncomplete: 'Не все изменения подтверждены. Выбранная карточка сохранена в форме. Проверьте сообщение каталога; после частичного сохранения заново откройте выбор с актуальными данными.',
  promoteFailed: 'Не удалось повысить карточку до Hero. Выбор сохранён.',
  deckUnavailable: 'Колода недоступна',
  noDeck: 'Без колоды',
  owner: (owner: string) => `Исполнитель: ${owner}`,
  unassigned: 'Без исполнителя',
  chooseFailed: 'Связь не подтверждена. Проверьте сообщение каталога; выбранная карточка сохранена в форме.',
  chooseError: 'Не удалось изменить родительскую карточку.',
  title: 'Выбрать родительскую карточку',
  description: (title: string) => `${title}: нажмите Hero или Doc Card, чтобы назначить родителя.`,
  close: 'Закрыть выбор родительской карточки',
  search: 'Найти родительскую карточку',
  searchPlaceholder: 'Название или короткая ссылка',
  stale: 'Данные изменились после открытия. Закройте и снова откройте выбор, чтобы проверить актуальные связи.',
  promotion: (title: string) => `Карточка станет Hero и родителем «${title}». Её текст, ID и ссылки сохранятся.`,
  leavesFamily: (title: string) => ` Она выйдет из семьи «${title}».`,
  taskState: 'Состояние Task сменится прогрессом Sub Cards.',
  currentDeck: 'Текущая колода',
  deckRejected: (deck: string) => `«${deck}» не принимает Hero. Выберите другую колоду или «Без колоды».`,
  promotionUnavailable: 'Повышение до Hero недоступно',
  parentCard: 'Родительская карточка',
  noParentKeepDeck: 'Без родителя · колода не изменится',
  noParent: 'Без родительской карточки',
  noMatches: 'Нет совпадений. Измените название или ссылку.',
  noCandidates: 'Нет доступных карточек для назначения родителя.',
  effort: 'Оценка',
  priority: 'Приоритет',
  promoteToHero: 'Повысить до Hero',
  docCard: 'Doc Card',
  heroCard: 'Hero Card',
  heroDeck: 'Колода Hero',
  chooseHeroDeck: 'Выберите Asset или Mixed колоду',
  withoutDeck: 'Без колоды',
  back: 'Назад',
  promoteSelect: 'Повысить и выбрать',
  none: 'Нет',
  heroCards: 'Hero Cards',
  otherCards: 'Другие карточки',
  cancel: 'Отмена',
  select: 'Выбрать',
  removeParent: 'Убрать родителя',
});

export interface ParentPromotionRequest {
  child: { cardId: string; sourceHash: string; expectedParentId: string | null };
  candidate: { cardId: string; sourceHash: string; expectedParentId: string | null };
  manifestHash: string;
  optionsHash: string;
  deckId: string | null;
}

export interface CardParentPickerProps {
  card: CatalogCard;
  catalog: CatalogView;
  pending: boolean;
  embedded?: boolean;
  onChoose: (parent: CatalogCard | null) => Promise<boolean>;
  onPromote?: (request: ParentPromotionRequest) => Promise<boolean>;
  onClose: () => void;
}

/** 2026-11-03: retain the inspected revisions until this picker is closed. */
export function CardParentPicker({ card, catalog, pending, embedded = false, onChoose, onPromote, onClose }: CardParentPickerProps) {
  const searchField = useRef<HTMLInputElement>(null);
  const t = useText(text);
  const lang = useLang();
  const languageTag = locale(lang);
  const opener = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const inFlight = useRef(false);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [promotion, setPromotion] = useState<CatalogCard | null>(null);
  const [promotionDeck, setPromotionDeck] = useState('');
  const [base] = useState(() => ({ cardId: card.id, sourceHash: card.sourceHash, parentId: card.parentId,
    manifestHash: catalog.manifestHash, optionsHash: catalog.optionsHash }));
  const [selected, setSelected] = useState(() => ({ id: card.parentId,
    sourceHash: catalog.cards.find(candidate => candidate.id === card.parentId)?.sourceHash ?? null }));
  const groupId = useId();
  const busy = pending || saving;
  const currentCard = catalog.cards.find(candidate => candidate.id === base.cardId);
  const hasChildren = catalog.cards.some(candidate => candidate.parentId === base.cardId);
  const unavailable = !currentCard || currentCard.deleted || currentCard.archived;
  const blocked = unavailable || currentCard?.kind === 'hero' || Boolean(currentCard?.journey) || hasChildren;
  const conflict = card.id !== base.cardId || currentCard?.sourceHash !== base.sourceHash || currentCard?.parentId !== base.parentId
    || catalog.manifestHash !== base.manifestHash || catalog.optionsHash !== base.optionsHash;
  const deckTitles = useMemo(() => new Map(catalog.decks.map(deck => [deck.id, deck.title])), [catalog.decks]);
  const candidates = useMemo(() => {
    const descendants = new Set([card.id]);
    let previousSize = -1;
    while (descendants.size !== previousSize) {
      previousSize = descendants.size;
      for (const candidate of catalog.cards) if (candidate.parentId && descendants.has(candidate.parentId)) descendants.add(candidate.id);
    }
    return catalog.cards.filter(candidate => !descendants.has(candidate.id) && !candidate.journey && !candidate.archived && !candidate.deleted
      && (candidate.kind !== 'hero' || candidate.parentId === null))
      .sort((first, second) => first.title.localeCompare(second.title, languageTag, { numeric: true }));
  }, [catalog.cards, card.id, languageTag]);
  const query = search.trim().toLocaleLowerCase(languageTag);
  const tokens = (query.match(/\bc-[a-z0-9]{10}\b/u)?.[0] ?? query).split(/\s+/u).filter(Boolean);
  const shown = candidates.filter(candidate => {
    const text = [candidate.title, candidate.id, shortReference('c', candidate.id), deckTitles.get(candidate.deckId ?? '')].join(' ').toLocaleLowerCase(languageTag);
    return tokens.every(token => text.includes(token));
  });
  const selectedParent = selected.id ? candidates.find(candidate => candidate.id === selected.id) : null;
  const staleParent = Boolean(selected.id && (!selectedParent || selectedParent.sourceHash !== selected.sourceHash));
  const changed = selected.id !== base.parentId;
  const heroDecks = catalog.decks.filter(deck => deckAcceptsCard(deck.kind, 'hero'));
  const promotionCurrent = promotion ? catalog.cards.find(candidate => candidate.id === promotion.id) : undefined;
  const stalePromotion = Boolean(promotion && (!promotionCurrent || promotionCurrent.sourceHash !== promotion.sourceHash || promotionCurrent.parentId !== promotion.parentId));
  const promotionDeckValid = promotionDeck === '__none__' || heroDecks.some(deck => 'deck:' + deck.id === promotionDeck);
  let blockedReason = '';
  if (unavailable) blockedReason = t.unavailable;
  else if (currentCard?.journey) blockedReason = t.journeyLocked;
  else if (hasChildren) blockedReason = t.hasChildren;
  else if (currentCard?.kind === 'hero') blockedReason = t.heroChild;

  function close() { if (!busy && !inFlight.current) onClose(); }

  function requiresPromotion(candidate: CatalogCard) { return candidate.kind === 'task' || candidate.parentId !== null; }

  function selectCandidate(candidate: CatalogCard) {
    if (busy || inFlight.current || blocked || conflict) return;
    setError('');
    if (requiresPromotion(candidate)) {
      if (!onPromote) return;
      setPromotion(candidate);
      const currentDeck = heroDecks.find(deck => deck.id === candidate.deckId);
      setPromotionDeck(currentDeck ? 'deck:' + currentDeck.id : '');
      setSelected({ id: candidate.id, sourceHash: candidate.sourceHash });
    } else if (embedded) void saveChoice(candidate);
    else setSelected({ id: candidate.id, sourceHash: candidate.sourceHash });
  }

  function backToCandidates() {
    if (busy || inFlight.current) return;
    setPromotion(null); setError('');
    setSelected({ id: base.parentId, sourceHash: candidates.find(candidate => candidate.id === base.parentId)?.sourceHash ?? null });
    requestAnimationFrame(() => moveFocus(searchField.current));
  }

  async function promote() {
    if (!onPromote || !promotion || busy || inFlight.current || blocked || conflict || stalePromotion || !promotionDeckValid) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    let completed = false;
    inFlight.current = true; setSaving(true); setError('');
    try {
      const saved = await onPromote({
        child: { cardId: base.cardId, sourceHash: base.sourceHash, expectedParentId: base.parentId },
        candidate: { cardId: promotion.id, sourceHash: promotion.sourceHash, expectedParentId: promotion.parentId },
        manifestHash: base.manifestHash, optionsHash: base.optionsHash ?? '',
        deckId: promotionDeck === '__none__' ? null : promotionDeck.slice('deck:'.length),
      });
      if (saved) { completed = true; onClose(); }
      else setError(t.promoteIncomplete);
    } catch (failure) { setError(failureMessage(failure, t.promoteFailed)); }
    finally {
      inFlight.current = false; setSaving(false);
      if (!completed) requestAnimationFrame(() => { if (trigger?.isConnected) moveFocus(trigger, { preventScroll: true }); });
    }
  }

  function candidateContent(candidate: CatalogCard) {
    const Icon = candidate.kind === 'hero' ? Crown : candidate.kind === 'doc' ? NotebookText : Layers;
    const priority = candidate.priority ? priorityLabel(candidate.priority, lang) : '—';
    return <><Icon className="card-parent-option-kind" size={16} /><span className="card-parent-option-content"><strong>{candidate.title}</strong>
      <span className="card-parent-option-metrics"><span title={t.effort}><Gauge size={12} />{candidate.effort ?? '—'}</span><span title={t.priority}><Layers size={12} />{priority}</span>
        <span className="card-parent-option-owner" title={t.owner(candidate.owner ?? t.unassigned)}><CardOwnerAvatar owner={candidate.owner} members={catalog.members ?? []} /><span>{candidate.owner ?? t.unassigned}</span></span></span>
      <small>{candidate.deckId ? deckTitles.get(candidate.deckId) ?? t.deckUnavailable : t.noDeck} · {requiresPromotion(candidate) ? t.promoteToHero : candidate.kind === 'doc' ? t.docCard : t.heroCard} · {shortReference('c', candidate.id)}</small>
    </span>{saving && selected.id === candidate.id ? <LoaderCircle size={15} className="spin" /> : base.parentId === candidate.id && <Check size={15} />}</>;
  }

  async function saveChoice(parent: CatalogCard | null) {
    if (busy || inFlight.current || blocked || conflict) return;
    if (parent && !candidates.some(candidate => candidate.id === parent.id && candidate.sourceHash === parent.sourceHash)) return;
    if (parent?.id === base.parentId || (!parent && base.parentId === null)) { close(); return; }
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    let completed = false;
    setSelected({ id: parent?.id ?? null, sourceHash: parent?.sourceHash ?? null });
    inFlight.current = true; setSaving(true); setError('');
    try {
      const saved = await onChoose(parent);
      if (saved) { completed = true; onClose(); }
      else setError(t.chooseFailed);
    } catch (failure) {
      setError(failureMessage(failure, t.chooseError));
    } finally {
      inFlight.current = false; setSaving(false);
      if (!completed) requestAnimationFrame(() => { if (trigger?.isConnected) moveFocus(trigger, { preventScroll: true }); });
    }
  }

  async function save() {
    if (staleParent || !changed || (selectedParent && requiresPromotion(selectedParent))) return;
    await saveChoice(selectedParent ?? null);
  }

  const picker = <Dialog.Content className={'card-parent-picker' + (embedded ? ' is-embedded' : '')} aria-busy={busy}
      onOpenAutoFocus={event => { event.preventDefault(); moveFocus(searchField.current); }}
      onCloseAutoFocus={event => {
        event.preventDefault();
        // Changing the parent remounts the family panel; its old Select trigger may no longer exist.
        requestAnimationFrame(() => {
          const target = opener.current?.isConnected ? opener.current
            : document.querySelector<HTMLButtonElement>('.card-preview-action-rail button[data-card-family]');
          moveFocus(target, { preventScroll: true });
        });
      }}
      onEscapeKeyDown={event => { if (busy || inFlight.current) event.preventDefault(); }}
      onPointerDownOutside={event => { if (embedded || busy || inFlight.current) event.preventDefault(); }}
      onInteractOutside={event => { if (embedded) event.preventDefault(); }}>
      {embedded ? <><Dialog.Title className="visually-hidden">{t.title}</Dialog.Title><Dialog.Description className="visually-hidden">{t.description(card.title)}</Dialog.Description></>
        : <header className="card-parent-picker-header"><div><Dialog.Title>{t.title}</Dialog.Title><Dialog.Description>{card.title}</Dialog.Description></div>
        <Button type="button" variant="ghost" size="icon" disabled={busy} onClick={close} aria-label={t.close}><X size={18} /></Button>
      </header>}
      <form onSubmit={event => { event.preventDefault(); if (promotion) void promote(); else if (!embedded) void save(); }}>
        {!promotion && <label className="card-family-search"><Search size={15} /><span className="visually-hidden">{t.search}</span>
          <input ref={searchField} type="search" value={search} disabled={busy} onChange={event => setSearch(event.target.value)} placeholder={t.searchPlaceholder} />
        </label>}
        {blockedReason && <p className="card-parent-picker-notice" role="alert">{blockedReason}</p>}
        {!blocked && (conflict || staleParent || stalePromotion) && <p className="card-parent-picker-notice" role="alert">{t.stale}</p>}
        {promotion ? <div className="card-parent-promotion">
          <div className="card-parent-picker-option card-parent-option-card" data-kind={promotion.kind} data-state={promotion.state ?? undefined}>{candidateContent(promotion)}</div>
          <p>{t.promotion(card.title)}{promotion.parentId && <>{t.leavesFamily(catalog.cards.find(candidate => candidate.id === promotion.parentId)?.title ?? shortReference('c', promotion.parentId))}</>}</p>
          {promotion.kind === 'task' && <p>{t.taskState}</p>}
          <label className="card-parent-promotion-deck"><span>{t.heroDeck}</span><select autoFocus value={promotionDeck} disabled={busy} onChange={event => setPromotionDeck(event.target.value)}>
            <option value="" disabled>{t.chooseHeroDeck}</option>
            {heroDecks.map(deck => <option key={deck.id} value={'deck:' + deck.id}>{deck.title}</option>)}
            <option value="__none__">{t.withoutDeck}</option>
          </select></label>
          {promotion.deckId && !heroDecks.some(deck => deck.id === promotion.deckId) && <p>{t.deckRejected(deckTitles.get(promotion.deckId) ?? t.currentDeck)}</p>}
          <div className="card-parent-promotion-actions"><Button type="button" variant="ghost" size="sm" disabled={busy} onClick={backToCandidates}><ArrowLeft size={14} />{t.back}</Button>
            <Button type="submit" size="sm" disabled={busy || blocked || conflict || stalePromotion || !promotionDeckValid}>{saving ? <LoaderCircle size={14} className="spin" /> : <Crown size={14} />}{t.promoteSelect}</Button></div>
        </div> : <fieldset className="card-parent-picker-list" disabled={busy || blocked || conflict}>
          <legend className="visually-hidden">{t.parentCard}</legend>
          {embedded ? <button type="button" className="card-parent-picker-option" aria-current={base.parentId === null ? 'true' : undefined} onClick={() => void saveChoice(null)}>
            <X size={16} /><span><strong>{t.none}</strong><small>{t.noParentKeepDeck}</small></span>{base.parentId === null && <Check size={15} />}
          </button> : <label className="card-parent-picker-option"><input type="radio" name={groupId} checked={selected.id === null} onChange={() => setSelected({ id: null, sourceHash: null })} />
            <X size={16} /><span><strong>{t.none}</strong><small>{t.noParent}</small></span>{selected.id === null && <Check size={15} />}
          </label>}
          {(['hero', 'other'] as const).map(kind => {
            const group = shown.filter(candidate => kind === 'hero' ? candidate.kind === 'hero' : candidate.kind !== 'hero');
            return group.length > 0 && <div className="card-parent-picker-group" key={kind}>
              <h3>{kind === 'hero' ? t.heroCards : t.otherCards}</h3>
              {group.map(candidate => embedded || requiresPromotion(candidate) ? <button key={candidate.id} type="button" className="card-parent-picker-option card-parent-option-card" data-kind={candidate.kind} data-state={candidate.state ?? undefined}
                aria-current={base.parentId === candidate.id ? 'true' : undefined} data-selected={selected.id === candidate.id || undefined} disabled={requiresPromotion(candidate) && !onPromote}
                title={requiresPromotion(candidate) && !onPromote ? t.promotionUnavailable : undefined} onClick={() => selectCandidate(candidate)}>
                {candidateContent(candidate)}
              </button> : <label key={candidate.id} className="card-parent-picker-option" data-selected={selected.id === candidate.id || undefined}>
                <input type="radio" name={groupId} checked={selected.id === candidate.id} onChange={() => { setSelected({ id: candidate.id, sourceHash: candidate.sourceHash }); setError(''); }} />
                {candidateContent(candidate)}
              </label>)}
            </div>;
          })}
          {!shown.length && <p className="card-family-empty">{candidates.length ? t.noMatches : t.noCandidates}</p>}
        </fieldset>}
        {error && <p className="card-parent-picker-notice" role="alert">{error}</p>}
        {!embedded && !promotion && <footer className="card-parent-picker-footer"><Button type="button" variant="ghost" size="sm" disabled={busy} onClick={close}>{t.cancel}</Button>
          <Button type="submit" size="sm" disabled={busy || blocked || conflict || staleParent || !changed}>{saving && <LoaderCircle size={14} className="spin" />}{selected.id ? t.select : t.removeParent}</Button>
        </footer>}
      </form>
    </Dialog.Content>;
  return <Dialog.Root modal={false} open onOpenChange={open => { if (!open) close(); }}>
    {embedded ? picker : <Dialog.Portal>{picker}</Dialog.Portal>}
  </Dialog.Root>;
}
