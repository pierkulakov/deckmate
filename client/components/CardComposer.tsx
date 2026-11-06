import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Gauge, Layers, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { deckAcceptsCard, type CardKind, type CardPriority, type CatalogDeck, type CatalogView } from '../../src/catalog-contracts.ts';
import type { WorkspaceSnapshot } from '../../src/workspace-contracts.ts';
import type { CatalogAction } from '../useCatalog.ts';
import { readNewCardDraft, removeNewCardDraft, writeNewCardDraft, type NewCardDraft } from '../card-drafts.ts';
import { MemberOptions } from './JourneyPanel.tsx';
import { CardEditForm, splitDraft } from './CardEditForm.tsx';
import { Switch } from './CardOrdering.tsx';
import { DeckPicker } from './DeckPicker.tsx';
import { Button } from './ui/button.tsx';
import { defineText, useLang, useText } from '../i18n.ts';
import { kindLabel, priorityLabel } from '../locales/common.ts';
import '../card-composer.css';

const text = defineText({
  restored: 'Your unsaved card is back.',
  discardDraft: 'Discard draft',
  sandboxOnly: 'Cards can only be created in sandbox.',
  titleRequired: 'Enter the card title on the first line.',
  tooLong: 'The title is limited to 1000 characters, the content to 200000 characters.',
  chooseDeck: 'Choose a deck or assign an Inbox destination deck.',
  incompatible: (kind: string, deck: string) => `${kind} is not compatible with deck “${deck}”.`,
  chooseCompatible: 'Choose an existing compatible Deck.',
  invalidParent: 'Choose an active Hero or Doc Card without a parent or Journey, or leave the field empty.',
  nestedFamily: 'The card has its own Sub Cards: nested families are unavailable.',
  ownerUnavailable: 'Owner is no longer available. Choose another member or Unassigned.',
  invalidEffort: 'Effort must be a non-negative number.',
  notConfirmed: 'Creation not confirmed. The draft and ID are preserved; check the catalog message and try again.',
  closeNew: 'Close New Card',
  newCardPanel: 'New Card',
  propertiesButton: 'Properties',
  close: 'Close',
  content: 'New card text',
  writeSandbox: 'Writing is only available in sandbox.',
  properties: 'New card Properties',
  subCardKind: 'A Sub Card can be a Task or Doc. The parent link is preserved.',
  mixedKind: 'This deck accepts Task, Hero and Doc.',
  kindFromDeck: (kind: string, deck: string) => `${kind} · type set by deck “${deck}”`,
  memberUnavailable: 'Member unavailable',
  noParent: 'No parent',
  parentUnavailable: 'Parent unavailable',
  notSet: 'not set',
  priorityNotSet: 'Not set',
  effortLabel: (value: string) => `Effort: ${value}`,
  priorityLabel: (value: string) => `Priority: ${value}`,
  editEffort: 'Edit Effort',
  editPriority: 'Edit Priority',
  panels: 'New card panels',
}, {
  restored: 'Несохранённая карточка вернулась.',
  discardDraft: 'Отбросить черновик',
  sandboxOnly: 'Создание карточек доступно только в sandbox.',
  titleRequired: 'Введите название карточки первой строкой.',
  tooLong: 'Название ограничено 1000 знаками, содержимое — 200000 знаками.',
  chooseDeck: 'Выберите колоду или назначьте колоду-приёмник Inbox.',
  incompatible: (kind: string, deck: string) => `Тип ${kind} не подходит колоде «${deck}».`,
  chooseCompatible: 'Выберите существующую совместимую Deck.',
  invalidParent: 'Выберите активную Hero или Doc Card без родителя и Journey либо оставьте поле пустым.',
  nestedFamily: 'У карты есть собственные Sub Cards: вложенные семьи недоступны.',
  ownerUnavailable: 'Owner больше недоступен. Выберите другого участника или Unassigned.',
  invalidEffort: 'Effort должен быть неотрицательным числом.',
  notConfirmed: 'Создание не подтверждено. Черновик и ID сохранены; проверьте сообщение каталога и повторите.',
  closeNew: 'Закрыть New Card',
  newCardPanel: 'Новая карточка',
  propertiesButton: 'Свойства',
  close: 'Закрыть',
  content: 'Текст новой карточки',
  writeSandbox: 'Запись доступна только в sandbox.',
  properties: 'Properties новой карточки',
  subCardKind: 'Sub Card может быть Task или Doc. Родительская связь сохранится.',
  mixedKind: 'Эта колода принимает Task, Hero и Doc.',
  kindFromDeck: (kind: string, deck: string) => `${kind} · тип задаётся колодой «${deck}»`,
  memberUnavailable: 'Участник недоступен',
  noParent: 'Без родителя',
  parentUnavailable: 'Родитель недоступен',
  notSet: 'не задан',
  priorityNotSet: 'Не задан',
  effortLabel: (value: string) => `Effort: ${value}`,
  priorityLabel: (value: string) => `Priority: ${value}`,
  editEffort: 'Изменить Effort',
  editPriority: 'Изменить Priority',
  panels: 'Панели новой карточки',
});

function defaultCardKind(deck: CatalogDeck | undefined): CardKind {
  if (deck?.kind === 'asset') return 'hero';
  if (deck?.kind === 'knowledge') return 'doc';
  return 'task';
}

function useComposerViewport() {
  const composer = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const element = composer.current;
    if (!element) return;
    const scrollport = element.closest<HTMLElement>('.workspace-main');
    const viewport = window.visualViewport;
    let frame = 0;
    function measure() {
      const bounds = element!.getBoundingClientRect();
      const scale = element!.offsetWidth > 0 ? bounds.width / element!.offsetWidth : 1;
      if (scale <= 0) return;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight);
      const scrollportBounds = scrollport?.getBoundingClientRect();
      const top = Math.max(bounds.top, viewportTop, scrollportBounds?.top ?? viewportTop);
      const bottom = Math.min(viewportBottom, scrollportBounds?.bottom ?? viewportBottom);
      // 2026-11-04: clamp to visible scrollport space; scrolling a static slot above it must not grow the form.
      const height = Math.max(0, Math.floor((bottom - top) / scale - 12));
      const value = height + 'px';
      if (element!.style.getPropertyValue('--composer-height') !== value) element!.style.setProperty('--composer-height', value);
    }
    function schedule() {
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; measure(); });
    }
    const observer = new ResizeObserver(schedule);
    for (const node of [element, scrollport, element.closest('.catalog-view')]) if (node) observer.observe(node);
    measure();
    scrollport?.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, { passive: true });
    viewport?.addEventListener('resize', schedule);
    viewport?.addEventListener('scroll', schedule);
    return () => {
      observer.disconnect(); cancelAnimationFrame(frame);
      scrollport?.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule);
      viewport?.removeEventListener('resize', schedule);
      viewport?.removeEventListener('scroll', schedule);
    };
  }, []);
  return composer;
}

// New Card shares CardEditForm with the card sheet's edit mode:
// first line — title, the rest Markdown; Save Card to Deck / Ctrl+Enter; «Create another card after this one»; Effort/Priority band.
export function CardComposer({ catalog, snapshot, initialDeckId, initialParentId = null, initialPriority = null, initialZoneId = null, pending, onEdit, onClose, onCreated, onDirtyChange }: {
  catalog: CatalogView;
  snapshot: WorkspaceSnapshot;
  initialDeckId: string;
  initialParentId?: string | null;
  initialPriority?: CardPriority | null;
  initialZoneId?: string | null;
  pending: boolean;
  onEdit: (action: CatalogAction) => Promise<boolean>;
  onClose: () => void;
  onCreated: (cardId: string, deckId: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const composer = useComposerViewport();
  // 2026-11-06: Escape and Close left keyboard focus on <body>; with focus inside at unmount it returns to the control that
  // opened New Card (the rail button, a group's +). Layout phase: the panel is still in the document.
  const opener = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  useLayoutEffect(() => () => {
    const panel = composer.current;
    const target = opener.current;
    if (panel?.contains(document.activeElement) && target?.isConnected && !panel.contains(target)) target.focus({ preventScroll: true });
  }, [composer]);
  const t = useText(text);
  const lang = useLang();
  const initialDeck = catalog.decks.find(deck => deck.id === initialDeckId)
    ?? (initialDeckId === '' ? catalog.decks.find(deck => deck.id === catalog.inboxDeckId) : undefined);
  const initialDeckIdRef = useRef(initialDeckId);
  const initialParentIdRef = useRef(initialParentId);
  const startingPriority = useRef<CardPriority | ''>(initialPriority ?? '');
  const startingKind = useRef<CardKind>(defaultCardKind(initialDeck));
  const effortInput = useRef<HTMLInputElement>(null);
  const priorityInput = useRef<HTMLSelectElement>(null);
  const focusProperty = useRef<'effort' | 'priority' | null>(null);
  const focusNewDraft = useRef(false);
  const inFlight = useRef(false);
  // Closing keeps an unsaved card as a draft of this deck and parent instead of asking (2026-11-05); the next New Card brings it back.
  const draftPlace = initialDeckId + '|' + (initialParentId ?? '');
  const [stash] = useState(() => readNewCardDraft(snapshot.source, draftPlace));
  const [stashShown, setStashShown] = useState(stash !== null);
  const [draftId, setDraftId] = useState(() => 'card:' + crypto.randomUUID());
  const [deckId, setDeckId] = useState(stash?.deckId ?? initialDeckId);
  const [kind, setKind] = useState<CardKind>(stash?.kind ?? startingKind.current);
  // Title and body travel as one text, as in Edit: the first line is the title.
  const [draft, setDraft] = useState(stash?.draft ?? '');
  const [owner, setOwner] = useState<string | null>(stash?.owner ?? null);
  const [parentId, setParentId] = useState<string | null>(initialParentId);
  const [trackIds, setTrackIds] = useState<string[]>(stash?.trackIds ?? []);
  const [effort, setEffort] = useState(stash?.effort ?? '');
  const [priority, setPriority] = useState<CardPriority | ''>(stash?.priority ?? startingPriority.current);
  const [zoneId, setZoneId] = useState<string | null>(initialZoneId);
  const [createAnother, setCreateAnother] = useState(false);
  const [panel, setPanel] = useState<'content' | 'properties'>('content');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const selectedDeck = catalog.decks.find(deck => deck.id === deckId);
  // Without an explicit deck, cards land in the project's default Inbox.
  const inboxDeck = catalog.decks.find(deck => deck.id === (catalog.inboxDeckId ?? null));
  const targetDeck = selectedDeck ?? (deckId === '' ? inboxDeck : undefined);
  const availableDecks = catalog.decks.filter(deck => !parentId || deckAcceptsCard(deck.kind, 'task') || deckAcceptsCard(deck.kind, 'doc'));
  const parentCards = catalog.cards.filter(card => (card.kind === 'hero' || card.kind === 'doc')
    && card.id !== draftId && !card.parentId && !card.journey && !card.archived && !card.deleted);
  const effortNumber = effort.trim() ? Number(effort) : null;
  const effortValid = effortNumber === null || (Number.isFinite(effortNumber) && effortNumber >= 0);
  const canWrite = snapshot.source === 'sandbox' && snapshot.writable;
  const busy = pending || saving;
  const dirty = Boolean(draft.trim() || owner || trackIds.length || effort) || priority !== startingPriority.current
    || deckId !== initialDeckIdRef.current || kind !== startingKind.current || parentId !== initialParentIdRef.current;

  useEffect(() => {
    onDirtyChange?.(dirty || saving);
    return () => onDirtyChange?.(false);
  }, [dirty, saving, onDirtyChange]);

  // Every way out (Close, Escape, another deck or tab) passes through unmount: an unsaved card stays as the draft, an empty one clears it.
  const latest = useRef<NewCardDraft | null>(null);
  latest.current = dirty ? { deckId, kind, draft, owner, trackIds, effort, priority } : null;
  const created = useRef(false);
  useEffect(() => () => {
    if (created.current) return;
    if (latest.current) writeNewCardDraft(snapshot.source, draftPlace, latest.current);
    else removeNewCardDraft(snapshot.source, draftPlace);
  }, [snapshot.source, draftPlace]);

  useEffect(() => {
    // «Create another»: the fresh text box mounts while the save is still in flight (disabled), so its autofocus misses.
    if (focusNewDraft.current && !busy) {
      composer.current?.querySelector<HTMLTextAreaElement>('.card-edit-text')?.focus();
      focusNewDraft.current = false;
    }
  }, [draftId, busy, composer]);

  useEffect(() => {
    if (panel !== 'properties' || !focusProperty.current) return;
    const input = focusProperty.current === 'effort' ? effortInput.current : priorityInput.current;
    input?.focus({ preventScroll: true });
    focusProperty.current = null;
  }, [panel]);

  function chooseKind(nextKind: CardKind) {
    if (targetDeck?.kind !== 'mixed' || (parentId && nextKind === 'hero')) return;
    setKind(nextKind);
    setError('');
  }

  function chooseDeck(nextDeckId: string) {
    const nextDeck = catalog.decks.find(deck => deck.id === nextDeckId);
    const nextTarget = nextDeck ?? (nextDeckId === '' ? inboxDeck : undefined);
    if (nextDeck && parentId && !deckAcceptsCard(nextDeck.kind, 'task') && !deckAcceptsCard(nextDeck.kind, 'doc')) return;
    setDeckId(nextDeckId);
    setZoneId(null);
    if (nextTarget && nextTarget.kind !== 'mixed') setKind(defaultCardKind(nextTarget));
    setError('');
  }

  // Properties swaps with the text and back, as the card's Properties rail button does.
  function toggleProperties(field?: 'effort' | 'priority') {
    if (busy) return;
    if (panel === 'properties' && field) (field === 'effort' ? effortInput.current : priorityInput.current)?.focus({ preventScroll: true });
    else if (panel === 'properties') setPanel('content');
    else { focusProperty.current = field ?? null; setPanel('properties'); }
  }

  function requestClose() {
    if (busy) return;
    onClose();
  }

  function discardStash() {
    removeNewCardDraft(snapshot.source, draftPlace);
    setStashShown(false);
    setDraftId('card:' + crypto.randomUUID());
    setDeckId(initialDeckIdRef.current);
    setKind(startingKind.current);
    setParentId(initialParentIdRef.current);
    setDraft('');
    setOwner(null);
    setTrackIds([]);
    setEffort('');
    setPriority(startingPriority.current);
    setError('');
  }

  function validate(draftTitle: string, draftMarkdown: string): string {
    if (!canWrite) return t.sandboxOnly;
    if (!draftTitle) return t.titleRequired;
    if (draftTitle.length > 1000 || draftMarkdown.length > 200000) return t.tooLong;
    if (!deckId && !inboxDeck) return t.chooseDeck;
    if (!targetDeck || !deckAcceptsCard(targetDeck.kind, kind)) return targetDeck ? t.incompatible(kind, targetDeck.title) : t.chooseCompatible;
    if (parentId && (kind === 'hero' || !parentCards.some(parent => parent.id === parentId))) return t.invalidParent;
    if (parentId && catalog.cards.some(card => card.parentId === draftId)) return t.nestedFamily;
    if (owner && !catalog.members?.some(member => member.label === owner)) return t.ownerUnavailable;
    if (!effortValid) return t.invalidEffort;
    return '';
  }

  function resetDraft() {
    focusNewDraft.current = true;
    const nextParentId = kind === 'hero' ? null : parentId;
    initialDeckIdRef.current = deckId;
    initialParentIdRef.current = nextParentId;
    startingKind.current = kind;
    setDraftId('card:' + crypto.randomUUID());
    setDraft('');
    setOwner(null);
    setTrackIds([]);
    setEffort('');
    setPriority(startingPriority.current);
    setPanel('content');
    focusProperty.current = null;
    setParentId(nextParentId);
    setError('');
  }

  async function save() {
    if (busy || inFlight.current) return;
    inFlight.current = true;
    const { title: draftTitle, markdown: draftMarkdown } = splitDraft(draft);
    const validationError = validate(draftTitle, draftMarkdown);
    // Errors show under the text box, so a save from Properties brings the text back.
    if (validationError) { setError(validationError); setPanel('content'); inFlight.current = false; return; }
    setSaving(true);
    setError('');
    try {
      // An empty body and unset properties stay empty: the server fills them from the deck's Template Card and adds its auto-tag.
      const saved = await onEdit({ action: 'create-card', cardId: draftId, kind, title: draftTitle, markdown: draftMarkdown,
        deckId: deckId || null, trackIds, parentId, owner, zoneId,
        effort: effortNumber, priority: priority || null });
      if (!saved) { setError(t.notConfirmed); setPanel('content'); return; }
      removeNewCardDraft(snapshot.source, draftPlace);
      setStashShown(false);
      if (createAnother) resetDraft();
      else { created.current = true; onCreated(draftId, deckId || inboxDeck?.id || ''); }
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  // Outside the text box (Properties, deck picker, band) the same keys work; the edit form handles its own and prevents them.
  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.defaultPrevented || event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); requestClose(); }
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void save(); }
  }

  return <aside ref={composer} className="card-preview has-action-rail card-composer" aria-label={t.newCardPanel} onKeyDown={handleKeyDown}>
    <div className="card-preview-main card-composer-main">
      <header className="card-preview-header">
        <div className="card-preview-context card-composer-context">
          <h2>New Card</h2>
          <DeckPicker catalog={catalog} projectName={snapshot.projectName} source={snapshot.source} decks={availableDecks} current={deckId || null}
            noneLabel={inboxDeck ? `Inbox · ${inboxDeck.title}` : undefined} shown={targetDeck}
            text={selectedDeck?.title ?? (!deckId && inboxDeck ? `Inbox · ${inboxDeck.title}` : 'Choose Deck')} disabled={busy} onChoose={nextDeckId => chooseDeck(nextDeckId ?? '')} />
        </div>
        <div className="card-preview-tools"><Button type="button" variant="ghost" size="icon" disabled={busy} onClick={requestClose} aria-label={t.closeNew} title={t.close}><X size={19} /></Button></div>
      </header>
      <div className="card-preview-sheet card-composer-sheet">
        {stashShown && <section className="card-draft-banner" aria-label={t.restored}>
          <p>{t.restored}</p>
          <div className="card-draft-banner-actions"><Button type="button" size="sm" disabled={busy} onClick={discardStash}><Trash2 size={14} aria-hidden="true" />{t.discardDraft}</Button></div>
        </section>}
        <section id={draftId + '-content'} className="card-composer-panel card-composer-content" hidden={panel !== 'content'} aria-label={t.content}>
          <CardEditForm key={draftId} draft={draft} onDraftChange={value => { setDraft(value); setError(''); }} catalog={catalog} source={snapshot.source}
            path={'cards/' + draftId.slice(5) + '.md'} writable={canWrite} busy={busy} saving={saving} blocked={!(deckId || inboxDeck) || !effortValid}
            saveLabel="Save Card to Deck" notice={error || (canWrite ? '' : t.writeSandbox)} cancelButton={false}
            onSave={() => void save()} onCancel={requestClose} />
          <div className="card-composer-again"><Switch label="Create another card after this one" checked={createAnother} disabled={busy} onChange={setCreateAnother} /></div>
        </section>
        <section id={draftId + '-properties'} className="card-composer-panel card-composer-settings" hidden={panel !== 'properties'} aria-label={t.properties}>
          <header><SlidersHorizontal size={16} /><h3>Properties</h3></header>
          <fieldset disabled={busy || !canWrite}>
            {targetDeck?.kind === 'mixed' ? <label className="catalog-field">Type<select value={kind} onChange={event => chooseKind(event.target.value as CardKind)}>{(['task', 'hero', 'doc'] as CardKind[]).map(cardKind => <option key={cardKind} value={cardKind} disabled={Boolean(parentId) && cardKind === 'hero'}>{kindLabel(cardKind, lang)}</option>)}</select><small>{parentId ? t.subCardKind : t.mixedKind}</small></label> : <p className="card-composer-kind-context">{t.kindFromDeck(kindLabel(kind, lang), targetDeck?.title ?? (inboxDeck ? 'Inbox · ' + inboxDeck.title : 'Choose Deck'))}</p>}
            <label className="catalog-field">Owner<select value={owner ?? ''} onChange={event => setOwner(event.target.value || null)}><option value="">Unassigned</option><MemberOptions members={catalog.members ?? []} />{owner && !catalog.members?.some(member => member.label === owner) && <option value={owner} disabled>{t.memberUnavailable}</option>}</select></label>
            {kind !== 'hero' && <label className="catalog-field"><span>Parent Card (optional)</span><select value={parentId ?? ''} onChange={event => setParentId(event.target.value || null)}><option value="">{t.noParent}</option>{parentCards.map(parent => <option key={parent.id} value={parent.id}>{parent.title} · {kindLabel(parent.kind, lang)}</option>)}{parentId && !parentCards.some(parent => parent.id === parentId) && <option value={parentId} disabled>{t.parentUnavailable}</option>}</select></label>}
            <div className="card-composer-settings-pair">
              <label className="catalog-field">Effort<input ref={effortInput} type="text" inputMode="decimal" value={effort} placeholder="—" aria-invalid={!effortValid} onChange={event => setEffort(event.target.value)} /></label>
              <label className="catalog-field">Priority<select ref={priorityInput} value={priority} onChange={event => setPriority(event.target.value as CardPriority | '')}><option value="">{t.priorityNotSet}</option><option value="high">{priorityLabel('high', lang)}</option><option value="medium">{priorityLabel('medium', lang)}</option><option value="low">{priorityLabel('low', lang)}</option></select></label>
            </div>
            {!effortValid && <p className="card-composer-field-error" role="alert">{t.invalidEffort}</p>}
            {catalog.tracks.length > 0 && <fieldset className="card-composer-tracks"><legend>Tracks</legend>{catalog.tracks.map(track => <label key={track.id}><input type="checkbox" checked={trackIds.includes(track.id)} onChange={event => setTrackIds(previous => event.target.checked ? [...previous, track.id] : previous.filter(id => id !== track.id))} /><span>{track.title}</span></label>)}</fieldset>}
          </fieldset>
        </section>
        <footer className="card-preview-material-band card-composer-band">
          <Button type="button" variant="ghost" size="sm" className="card-preview-property-shortcut" disabled={busy} aria-label={t.effortLabel(effort || t.notSet)} title={t.editEffort} onClick={() => toggleProperties('effort')}><span>Effort</span><Gauge size={19} /><strong>{effort || '—'}</strong></Button>
          <Button type="button" variant="ghost" size="sm" className="card-preview-property-shortcut" disabled={busy} aria-label={t.priorityLabel(priority ? priorityLabel(priority, lang) : t.notSet)} title={t.editPriority} onClick={() => toggleProperties('priority')}><span>Priority</span><Layers size={18} /><strong>{priority ? priorityLabel(priority, lang) : '—'}</strong></Button>
        </footer>
      </div>
    </div>
    <nav className="card-preview-action-rail" aria-label={t.panels}>
      <Button type="button" variant="ghost" size="icon" aria-label={t.propertiesButton} title={t.propertiesButton} aria-pressed={panel === 'properties'} aria-controls={draftId + '-properties'} disabled={busy} onClick={() => toggleProperties()}><SlidersHorizontal size={17} /></Button>
    </nav>
  </aside>;
}
