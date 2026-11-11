// Quick capture stores ideas, bugs and agent findings as Task cards in Inbox for later triage.
// Like CardComposer, it uses create-card through useCatalog so hashes, conflicts and errors share one path.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Check, LoaderCircle, Plus, X } from 'lucide-react';
import type { WorkspaceSnapshot } from '../../src/workspace-contracts.ts';
import { deckCanBeInbox, newCardDeckId } from '../../src/catalog-contracts.ts';
import { useCatalog } from '../useCatalog.ts';
import { catalogStore } from '../catalog-store.ts';
import { defineText, useText } from '../i18n.ts';
import { Button } from './ui/button.tsx';
import { ErrorState } from './ErrorState.tsx';
import { moveFocus } from '../focus.ts';
import { readOnlyDescription } from '../source-access.ts';
import '../surface.css';
import '../quick-capture.css';
import { prepareEntrance } from '../prepared-motion.ts';

const text = defineText({
  quickCapture: 'Quick capture to Inbox',
  closeQuickCapture: 'Close quick capture',
  close: 'Close',
  description: 'Capture an idea, bug, or finding as a Task. Inbox is the deck chosen to collect cards for triage.',
  titleRequired: 'Enter a title; the card cannot be saved without one.',
  limits: 'The title is limited to 1000 characters and the text to 200000 characters.',
  chooseInboxFirst: 'Choose a deck for Inbox first.',
  noSpaces: 'First create a space and a Task or Mixed deck in Decks.',
  noCompatibleDecks: 'First create a Task or Mixed deck in Decks, then choose it as Inbox here.',
  inboxNotConfirmed: 'Inbox assignment was not confirmed. Choose the deck again and retry.',
  unconfirmed: 'The create result is not confirmed. Your draft is kept. Re-read the catalog to check before saving again.',
  savedWarning: 'The server reported a save warning. Re-read the catalog to check the card before continuing.',
  checkResult: 'Re-read and check',
  checking: 'Checking…',
  notFound: 'The card was not found after re-reading. Your draft is kept; you can save again with the same card ID.',
  saved: 'Saved to Inbox',
  open: 'Open',
  captureAnother: 'Capture another',
  title: 'Title',
  titlePlaceholder: 'What should I capture?',
  findingTitle: 'Finding title',
  optionalText: 'Text — optional',
  textPlaceholder: 'Details, reproduction steps, link…',
  findingText: 'Finding text',
  loading: 'Opening catalog…',
  missingInbox: 'Choose an existing Task or Mixed deck as the project’s Inbox. Its name does not need to be Inbox.',
  inboxDeck: 'Inbox deck',
  chooseDeck: 'Choose a deck…',
  setInbox: 'Set as Inbox',
  deck: (title: string) => `Deck “${title}”`,
  space: (title: string) => ` · space “${title}”`,
  shortcutHint: 'Enter — save · Esc — close',
  save: 'Save',
}, {
  quickCapture: 'Быстрая запись в Inbox',
  closeQuickCapture: 'Закрыть быструю запись',
  close: 'Закрыть',
  description: 'Запишите идею, баг или находку как Task. Inbox — назначенная колода для входящих карточек, которые нужно разобрать.',
  titleRequired: 'Введите название — без него карточку не сохранить.',
  limits: 'Название ограничено 1000 знаками, текст — 200000 знаками.',
  chooseInboxFirst: 'Сначала выберите колоду для Inbox.',
  noSpaces: 'Сначала создайте пространство и колоду Task или Mixed в Decks.',
  noCompatibleDecks: 'Сначала создайте колоду Task или Mixed в Decks, затем назначьте её Inbox здесь.',
  inboxNotConfirmed: 'Назначение Inbox не подтверждено. Выберите колоду ещё раз и повторите.',
  unconfirmed: 'Результат создания не подтверждён. Черновик сохранён. Перечитайте каталог для проверки перед повторным сохранением.',
  savedWarning: 'Сервер сообщил о сохранении с предупреждением. Перечитайте каталог и проверьте карточку перед продолжением.',
  checkResult: 'Перечитать и проверить',
  checking: 'Проверяем…',
  notFound: 'После перечитывания карточка не найдена. Черновик сохранён; можно сохранить снова с тем же ID карточки.',
  saved: 'Записано в Inbox',
  open: 'Открыть',
  captureAnother: 'Записать ещё',
  title: 'Название',
  titlePlaceholder: 'Что записать?',
  findingTitle: 'Название находки',
  optionalText: 'Текст — необязательно',
  textPlaceholder: 'Подробности, шаги воспроизведения, ссылка…',
  findingText: 'Текст находки',
  loading: 'Открываем каталог…',
  missingInbox: 'Назначьте существующую колоду Task или Mixed для входящих карточек проекта. Называть её Inbox необязательно.',
  inboxDeck: 'Колода для Inbox',
  chooseDeck: 'Выберите колоду…',
  setInbox: 'Назначить Inbox',
  deck: (title: string) => `Колода «${title}»`,
  space: (title: string) => ` · пространство «${title}»`,
  shortcutHint: 'Enter — сохранить · Esc — закрыть',
  save: 'Сохранить',
});

export function QuickCapture({ snapshot, refreshKey, onOpenCard }: {
  snapshot: WorkspaceSnapshot;
  refreshKey: number;
  onOpenCard: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const t = useText(text);
  return <Dialog.Root open={open} onOpenChange={setOpen}>
    <Dialog.Trigger asChild>
      <Button variant="ghost" size="icon" className="quick-capture-trigger" aria-label={t.quickCapture} title={t.quickCapture}>
        <Plus size={26} strokeWidth={2} aria-hidden="true" />
      </Button>
    </Dialog.Trigger>
    <Dialog.Portal>
      {/* 2026-11-10: the frame, head, body and foot come from the shared dialog grammar in surface.css; the panel stays
          anchored under the top-bar “+”, like the Create space popover. */}
      <Dialog.Content ref={prepareEntrance} className="quick-capture-panel dialog-panel">
        <header className="dialog-head">
          <Dialog.Title className="dialog-title">{t.quickCapture}</Dialog.Title>
          <Dialog.Close asChild>
            <Button variant="ghost" size="icon" className="quick-capture-close" aria-label={t.closeQuickCapture} title={t.close}><X size={17} /></Button>
          </Dialog.Close>
        </header>
        <QuickCaptureForm snapshot={snapshot} refreshKey={refreshKey} onOpenCard={onOpenCard} />
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

function QuickCaptureForm({ snapshot, refreshKey, onOpenCard }: {
  snapshot: WorkspaceSnapshot;
  refreshKey: number;
  onOpenCard: (id: string) => void;
}) {
  const catalog = useCatalog(snapshot, refreshKey);
  const t = useText(text);
  const [draftId, setDraftId] = useState(() => 'card:' + crypto.randomUUID());
  const [title, setTitle] = useState('');
  const [markdown, setMarkdown] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedCardId, setSavedCardId] = useState<string | null>(null);
  const [savedTitle, setSavedTitle] = useState('');
  const [notice, setNotice] = useState<{ message: string; unresolved: boolean; saved?: boolean } | null>(null);
  const [checking, setChecking] = useState(false);
  const [localError, setLocalError] = useState<'' | 'titleRequired' | 'limits' | 'chooseInboxFirst' | 'noSpaces' | 'inboxNotConfirmed'>('');
  const [inboxChoice, setInboxChoice] = useState<{ id: string; manifestHash: string } | null>(null);
  const [inboxUnconfirmed, setInboxUnconfirmed] = useState(false);
  const titleInput = useRef<HTMLInputElement>(null);
  const checkButton = useRef<HTMLButtonElement>(null);
  const openButton = useRef<HTMLButtonElement>(null);
  const inFlight = useRef(false);
  const checkingInFlight = useRef(false);
  const focusAfterAssignment = useRef(false);

  const canWrite = snapshot.source === 'sandbox' && snapshot.writable;
  const spaces = catalog.catalog?.spaces ?? [];
  const decks = catalog.catalog?.decks ?? [];
  const inboxId = newCardDeckId(null, catalog.catalog?.inboxDeckId, decks, 'task');
  const inboxDeck = decks.find(deck => deck.id === inboxId);
  const inboxChoices = decks.filter(deck => deckCanBeInbox(deck.kind));
  const inboxSpace = inboxDeck ? spaces.find(space => space.id === inboxDeck.spaceId) : undefined;
  let inboxSetupHint = t.noSpaces;
  if (inboxChoices.length) inboxSetupHint = t.missingInbox;
  else if (spaces.length) inboxSetupHint = t.noCompatibleDecks;
  const error = localError ? t[localError] : catalog.error || '';
  const locked = saving || checking || catalog.pending || !canWrite || Boolean(notice?.unresolved);

  useEffect(() => {
    // Radix gives initial focus to the first focusable node (the close button); the title field is the real entry point.
    if (savedCardId) moveFocus(openButton.current);
    else if (notice?.unresolved) moveFocus(checkButton.current);
    else moveFocus(titleInput.current);
  }, [savedCardId, notice?.unresolved]);

  useEffect(() => {
    if (saving || !focusAfterAssignment.current) return;
    focusAfterAssignment.current = false;
    moveFocus(titleInput.current);
  }, [saving]);

  async function save() {
    if (inFlight.current || locked || savedCardId || !catalog.catalog) return;
    const draftTitle = title.trim();
    if (!draftTitle) { setLocalError('titleRequired'); return; }
    if (draftTitle.length > 1000 || markdown.length > 200000) { setLocalError('limits'); return; }
    if (!inboxDeck || inboxUnconfirmed) { setLocalError(spaces.length ? 'chooseInboxFirst' : 'noSpaces'); return; }
    inFlight.current = true;
    setLocalError('');
    setNotice(null);
    setSaving(true);
    try {
      // Same payload CardComposer sends; the hook adds manifest/source hashes and conflict handling.
      const created = await catalog.edit({ action: 'create-card', cardId: draftId, kind: 'task', title: draftTitle, markdown,
        deckId: inboxDeck.id, trackIds: [], parentId: null, owner: null, effort: null, priority: null });
      // 2026-11-10: edit's boolean also accepts saved:true; read this operation's store result, not the render's stale hook.
      const result = catalogStore(snapshot.source).getSnapshot();
      if (created && !result.warning && result.catalog?.cards.some(card => card.id === draftId)) {
        setSavedTitle(draftTitle);
        setSavedCardId(draftId);
      } else {
        setNotice({ message: result.warning || t.unconfirmed, unresolved: true, saved: Boolean(result.warning) });
      }
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  async function checkResult() {
    if (checkingInFlight.current || inFlight.current) return;
    checkingInFlight.current = true;
    setChecking(true);
    try {
      await catalog.refresh();
      const result = catalogStore(snapshot.source).getSnapshot();
      if (result.error || !result.catalog) return;
      // 2026-11-10: only an explicit fresh read resolves an uncertain create; a watcher update cannot mint a new ID.
      if (result.catalog.savedWarning) {
        setNotice({ message: result.catalog.savedWarning, unresolved: true, saved: true });
        return;
      }
      const card = result.catalog.cards.find(card => card.id === draftId);
      if (card) {
        setNotice(null);
        setSavedTitle(card.title);
        setSavedCardId(card.id);
      } else {
        setNotice({ message: t.notFound, unresolved: false });
      }
    } finally {
      checkingInFlight.current = false;
      setChecking(false);
    }
  }

  async function assignInbox() {
    if (inFlight.current || locked || !inboxChoice || !inboxChoices.some(deck => deck.id === inboxChoice.id)) return;
    inFlight.current = true;
    setSaving(true);
    setLocalError('');
    try {
      const saved = await catalog.edit({ action: 'set-inbox-deck', deckId: inboxChoice.id, manifestHash: inboxChoice.manifestHash });
      const result = catalogStore(snapshot.source).getSnapshot();
      const confirmed = saved && !result.warning && result.catalog?.inboxDeckId === inboxChoice.id;
      setInboxUnconfirmed(!confirmed);
      focusAfterAssignment.current = confirmed;
      if (!confirmed) { setLocalError('inboxNotConfirmed'); setInboxChoice(null); }
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  function startAnother() {
    if (!savedCardId || notice?.unresolved || inFlight.current || checkingInFlight.current) return;
    // A new capture gets a new identity: a saved card must never be overwritten by a retry (create-card replays by id).
    setDraftId('card:' + crypto.randomUUID());
    setTitle('');
    setMarkdown('');
    setLocalError('');
    setNotice(null);
    setSavedCardId(null);
  }

  function handleKeys(event: KeyboardEvent<HTMLDivElement>) {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void save(); }
  }

  if (savedCardId) return <div className="quick-capture-form" role="status" onKeyDown={handleKeys}>
    <div className="quick-capture-body dialog-body">
    <Dialog.Description className="quick-capture-caption">{t.description}</Dialog.Description>
    <div className="quick-capture-saved">
      <span className="quick-capture-saved-mark" aria-hidden="true"><Check size={15} /></span>
      <span className="quick-capture-saved-text"><strong>{t.saved}</strong>«{savedTitle}»</span>
    </div>
    </div>
    {/* Actions sit at the end of a footer row, the primary one last, as in every dialog. */}
    <footer className="quick-capture-footer dialog-foot">
      <Button variant="ghost" size="sm" onClick={startAnother}>{t.captureAnother}</Button>
      <Dialog.Close asChild><Button ref={openButton} size="sm" onClick={() => onOpenCard(savedCardId)}>{t.open}</Button></Dialog.Close>
    </footer>
  </div>;

  return <div className="quick-capture-form" onKeyDown={handleKeys}>
    <div className="quick-capture-body dialog-body">
    <Dialog.Description className="quick-capture-caption">{t.description}</Dialog.Description>
    <label className="quick-capture-field"><span>{t.title}</span>
      <input ref={titleInput} className="control-field quick-capture-input" value={title} maxLength={1000} placeholder={t.titlePlaceholder}
        aria-label={t.findingTitle} disabled={locked}
        onChange={event => { setTitle(event.target.value); setLocalError(''); }}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void save(); } }} />
    </label>
    <label className="quick-capture-field"><span>{t.optionalText}</span>
      <textarea className="control-field quick-capture-text" value={markdown} maxLength={200000} rows={4}
        placeholder={t.textPlaceholder} aria-label={t.findingText} disabled={locked}
        onChange={event => { setMarkdown(event.target.value); setLocalError(''); }} />
    </label>
    <ErrorState variant="inline" message={!catalog.catalog ? catalog.error : null} onRetry={catalog.refresh} pending={catalog.loading} />
    {catalog.catalog && error && <p className="quick-capture-error" role="alert">{error}</p>}
    {notice && <div className="quick-capture-warning" role="status" aria-busy={checking}>
      {notice.saved && <strong>{t.savedWarning}</strong>}
      <p>{notice.message}</p>
      {notice.unresolved && <Button ref={checkButton} variant="outline" size="sm" aria-disabled={checking}
        onClick={() => void checkResult()}>{checking && <LoaderCircle size={12} className="spin" />}{checking ? t.checking : t.checkResult}</Button>}
    </div>}
    {!canWrite && <p className="quick-capture-note">{readOnlyDescription(snapshot)}</p>}
    {canWrite && !catalog.catalog && !catalog.error && catalog.loading && <p className="quick-capture-note" role="status"><LoaderCircle size={12} className="spin" /> {t.loading}</p>}
    {canWrite && catalog.catalog && (!inboxDeck || inboxUnconfirmed) && <div className="quick-capture-missing">
      <p className="quick-capture-note">{inboxSetupHint}</p>
      {inboxChoices.length > 0 && <>
        <label className="quick-capture-field"><span>{t.inboxDeck}</span>
          <select className="control-field" value={inboxChoice?.id ?? ''} disabled={locked} onChange={event => {
            setInboxChoice(event.target.value ? { id: event.target.value, manifestHash: catalog.catalog!.manifestHash } : null);
          }}><option value="">{t.chooseDeck}</option>{inboxChoices.map(deck => <option key={deck.id} value={deck.id}>{deck.title}</option>)}</select>
        </label>
        <Button variant="outline" size="sm" disabled={locked || !inboxChoices.some(deck => deck.id === inboxChoice?.id)} onClick={() => void assignInbox()}>{t.setInbox}</Button>
      </>}
    </div>}
    {inboxDeck && !inboxUnconfirmed && <p className="quick-capture-note">{t.deck(inboxDeck.title)}{inboxSpace ? t.space(inboxSpace.title) : ''}</p>}
    </div>
    <footer className="quick-capture-footer dialog-foot">
      <span className="quick-capture-hint">{t.shortcutHint}</span>
      <Button size="sm" disabled={locked || !title.trim() || !inboxDeck || inboxUnconfirmed} onClick={() => void save()}>
        {saving ? <LoaderCircle size={13} className="spin" /> : <Check size={13} />}{t.save}
      </Button>
    </footer>
  </div>;
}
