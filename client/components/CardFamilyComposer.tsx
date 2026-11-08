import { readStoredValue } from '../storage.ts';
import { useEffect, useRef, useState } from 'react';
import { Layers, LoaderCircle, Plus } from 'lucide-react';
import { deckAcceptsCard, newCardDeckId, type CatalogCard, type CatalogEdit, type CatalogView } from '../../src/catalog-contracts.ts';
import { Button } from './ui/button.tsx';
import { defineText, useText } from '../i18n.ts';
import { failureMessage } from '../failure-message.ts';
import '../card-family.css';

const text = defineText({
  formLabel: 'New Sub Card',
  invalidContent: 'The first line is a title of up to 1000 characters. Description — up to 200000 characters.',
  notConfirmed: 'Creation not confirmed. The text and ID are preserved; check the catalog message and try again.',
  createFailed: 'Could not create the Sub Card. The draft is preserved.',
  recentDecks: 'Recent decks',
  placeholder: 'Card title\nWork description in Markdown',
  contentHint: 'The first line is the title. The rest is the work description.',
  autoInbox: (deck: string) => `Auto: Inbox → ${deck}`,
  noDeckChoice: 'No deck (Unassigned)',
  parentUnavailable: 'The parent card is no longer available for new Sub Cards. The draft is preserved.',
  conflict: 'The parent or catalog changed. The text is preserved; check the selected deck.',
  useCurrent: 'Use current data',
  discardQuestion: 'Discard the Sub Card draft?',
  keep: 'Keep editing',
  discard: 'Discard',
  createCardIn: 'Create Card in',
  content: 'Content',
  cancel: 'Cancel',
  create: 'Create',
}, {
  formLabel: 'Новая Sub Card',
  invalidContent: 'Первая строка — название до 1000 знаков. Описание — до 200000 знаков.',
  notConfirmed: 'Создание не подтверждено. Текст и ID сохранены; проверьте сообщение каталога и повторите.',
  createFailed: 'Не удалось создать Sub Card. Черновик сохранён.',
  recentDecks: 'Недавние колоды',
  placeholder: 'Название карточки\nОписание работы в Markdown',
  contentHint: 'Первая строка — название. Дальше — описание работы.',
  autoInbox: (deck: string) => `Авто: Inbox → ${deck}`,
  noDeckChoice: 'Без колоды',
  parentUnavailable: 'Родительская карточка больше не доступна для новых Sub Cards. Черновик сохранён.',
  conflict: 'Родитель или каталог изменился. Текст сохранён; проверьте выбранную колоду.',
  useCurrent: 'Использовать актуальные данные',
  discardQuestion: 'Отбросить черновик Sub Card?',
  keep: 'Продолжить',
  discard: 'Отбросить',
  createCardIn: 'Создать карточку в',
  content: 'Содержимое',
  cancel: 'Отмена',
  create: 'Создать',
});

export type CreateFamilyCardAction = Extract<CatalogEdit, { action: 'create-card' }>;
export interface CardFamilyComposerProps {
  parent: CatalogCard;
  catalog: CatalogView;
  initialDeckId?: string;
  active?: boolean;
  pending: boolean;
  readOnly?: boolean;
  onCreate: (action: CreateFamilyCardAction) => Promise<boolean>;
  onCancel: () => void;
  onCreated: (cardId: string, deckId: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
}

export function CardFamilyComposer({ parent, catalog, initialDeckId, active = true, pending, readOnly = false, onCreate, onCancel, onCreated, onDirtyChange }: CardFamilyComposerProps) {
  const t = useText(text);
  const [recent] = useState<string[]>(() => {
    try {
      const value: unknown = JSON.parse(readStoredValue(localStorage, 'deckmate:recent-decks:' + catalog.rootIdentity) ?? '[]');
      return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === 'string'))].slice(0, 3) : [];
    } catch { return []; }
  });
  const availableDecks = catalog.decks.filter(deck => deckAcceptsCard(deck.kind, 'task') || deckAcceptsCard(deck.kind, 'doc'));
  // 2026-11-08: a Sub Card always has somewhere to land — the project Inbox when it takes Tasks, else no deck (deckId: null).
  const inboxDeck = catalog.decks.find(deck => deck.id === catalog.inboxDeckId);
  const autoDeckId = newCardDeckId(null, catalog.inboxDeckId, catalog.decks, 'task');
  // Default choice: the deck the panel opened in (never the Hero deck — it does not take Tasks), the last used deck,
  // the Inbox, then the first Task deck; «no deck» closes the chain so creation is never blocked.
  const [deckId, setDeckId] = useState(() => availableDecks.find(deck => deck.id === initialDeckId)?.id
    ?? recent.find(id => availableDecks.some(deck => deck.id === id))
    ?? (autoDeckId ? '' : undefined)
    ?? availableDecks.find(deck => deckAcceptsCard(deck.kind, 'task'))?.id ?? '');
  const originalDeckId = useRef(deckId);
  const [cardId] = useState(() => 'card:' + crypto.randomUUID());
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [discarding, setDiscarding] = useState(false);
  const [base, setBase] = useState(() => ({ manifestHash: catalog.manifestHash, parentHash: parent.sourceHash }));
  const inFlight = useRef(false);
  const contentField = useRef<HTMLTextAreaElement>(null);
  const busy = pending || saving;
  const dirty = Boolean(content) || deckId !== originalDeckId.current;
  const selectedDeck = availableDecks.find(deck => deck.id === deckId);
  const currentParent = catalog.cards.find(card => card.id === parent.id);
  const parentValid = Boolean(currentParent && (currentParent.kind === 'hero' || currentParent.kind === 'doc')
    && !currentParent.parentId && !currentParent.journey && !currentParent.archived && !currentParent.deleted);
  const conflict = base.manifestHash !== catalog.manifestHash || base.parentHash !== currentParent?.sourceHash;
  const firstBreak = content.search(/[\r\n]/u);
  const title = (firstBreak < 0 ? content : content.slice(0, firstBreak)).trim();
  const markdown = firstBreak < 0 ? '' : content.slice(firstBreak).replace(/^(?:\r\n|\r|\n)/u, '');
  const validContent = title.length > 0 && title.length <= 1000 && !title.includes('\u0000') && markdown.length <= 200000;
  const recentDecks = recent.flatMap(id => availableDecks.filter(deck => deck.id === id));

  useEffect(() => { if (active) contentField.current?.focus({ preventScroll: true }); }, [active]);
  useEffect(() => { onDirtyChange?.(dirty || saving); }, [dirty, saving, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  function cancel() {
    if (busy || inFlight.current) return;
    if (dirty) setDiscarding(true); else onCancel();
  }

  async function create() {
    if (busy || readOnly || inFlight.current || (deckId !== '' && !selectedDeck) || !parentValid || conflict) return;
    if (!validContent) { setError(t.invalidContent); return; }
    inFlight.current = true; setSaving(true); setError('');
    const kind = selectedDeck?.kind === 'knowledge' ? 'doc' : 'task';
    try {
      // Without an explicit deck the request names none: the server routes the card to the Inbox, or to no deck at all.
      const saved = await onCreate({ action: 'create-card', cardId, manifestHash: base.manifestHash,
        kind, title, markdown, deckId: selectedDeck?.id ?? null,
        parentId: parent.id, trackIds: [], owner: null, effort: null, priority: null });
      if (!saved) { setError(t.notConfirmed); return; }
      if (selectedDeck) {
        try {
          const key = 'deckmate:recent-decks:' + catalog.rootIdentity;
          const value: unknown = JSON.parse(readStoredValue(localStorage, key) ?? '[]');
          const previous = Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
          localStorage.setItem(key, JSON.stringify([...new Set([selectedDeck.id, ...previous])].slice(0, 3)));
        } catch { /* 2026-11-03: optional recents must not turn a saved card into a failed creation. */ }
      }
      onDirtyChange?.(false);
      onCreated(cardId, selectedDeck?.id ?? newCardDeckId(null, catalog.inboxDeckId, catalog.decks, kind) ?? '');
    } catch (failure) { setError(failureMessage(failure, t.createFailed)); }
    finally { inFlight.current = false; setSaving(false); }
  }

  return <form className="card-family-composer" aria-label={t.formLabel} aria-busy={busy}
    onSubmit={event => { event.preventDefault(); void create(); }}
    onKeyDown={event => {
      if (event.defaultPrevented) return;
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void create(); }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); }
    }}>
    <label className="card-family-composer-deck"><span>{t.createCardIn}</span><span><Layers size={15} />
      <select value={deckId} disabled={busy} onChange={event => { setDeckId(event.target.value); setError(''); }}>
        <option value="">{inboxDeck && autoDeckId === inboxDeck.id ? t.autoInbox(inboxDeck.title) : t.noDeckChoice}</option>
        {availableDecks.map(deck => <option key={deck.id} value={deck.id}>{deck.title} · {deck.kind === 'knowledge' ? 'Doc' : 'Task'}</option>)}
      </select>
    </span></label>
    {recentDecks.length > 0 && <div className="card-family-composer-recents" aria-label={t.recentDecks}>{recentDecks.map(deck =>
      <Button key={deck.id} type="button" variant="outline" size="sm" aria-pressed={deckId === deck.id} disabled={busy} onClick={() => setDeckId(deck.id)}>{deck.title}</Button>)}</div>}
    <label className="card-family-composer-content"><span>{t.content}</span><textarea ref={contentField} value={content} disabled={busy}
      rows={7} placeholder={t.placeholder} aria-describedby={cardId + '-hint'} onChange={event => { setContent(event.target.value); setError(''); }} /></label>
    <p className="card-family-composer-hint" id={cardId + '-hint'}>{t.contentHint}</p>
    {!parentValid && <p className="card-family-composer-error" role="alert">{t.parentUnavailable}</p>}
    {conflict && parentValid && <div className="card-family-composer-error" role="alert"><span>{t.conflict}</span>
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => { setBase({ manifestHash: catalog.manifestHash, parentHash: currentParent!.sourceHash }); setError(''); }}>{t.useCurrent}</Button></div>}
    {error && <p className="card-family-composer-error" role="alert">{error}</p>}
    {discarding && <div className="card-family-composer-discard" role="alert"><p>{t.discardQuestion}</p><div>
      <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => { setDiscarding(false); contentField.current?.focus(); }}>{t.keep}</Button>
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onCancel}>{t.discard}</Button>
    </div></div>}
    <footer><Button type="button" variant="ghost" size="sm" disabled={busy} onClick={cancel}>{t.cancel}</Button><span>Ctrl + Enter</span>
      <Button type="submit" size="sm" disabled={busy || readOnly || !validContent || (deckId !== '' && !selectedDeck) || !parentValid || conflict}>{saving ? <LoaderCircle size={14} className="spin" /> : <Plus size={14} />}{t.create}</Button>
    </footer>
  </form>;
}
