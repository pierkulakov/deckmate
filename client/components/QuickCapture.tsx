// Quick capture stores ideas, bugs and agent findings as Task cards in Inbox for later triage.
// Like CardComposer, it uses create-card through useCatalog so hashes, conflicts and errors share one path.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Check, LoaderCircle, Plus, X } from 'lucide-react';
import type { WorkspaceSnapshot } from '../../src/workspace-contracts.ts';
import { useCatalog } from '../useCatalog.ts';
import { catalogStore } from '../catalog-store.ts';
import { defineText, useText } from '../i18n.ts';
import { Button } from './ui/button.tsx';
import { ErrorState } from './ErrorState.tsx';
import { moveFocus } from '../focus.ts';
import '../surface.css';
import '../quick-capture.css';
import { prepareEntrance } from '../prepared-motion.ts';

const text = defineText({
  quickCapture: 'Quick capture to Inbox',
  closeQuickCapture: 'Close quick capture',
  close: 'Close',
  description: 'A raw idea, bug, or agent finding becomes a Task card in the Inbox deck. Inbox is for triage, not work.',
  titleRequired: 'Enter a title; the card cannot be saved without one.',
  limits: 'The title is limited to 1000 characters and the text to 200000 characters.',
  createInboxFirst: 'Create an Inbox deck first.',
  noSpaces: 'First create a space in Decks.',
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
  readOnly: 'This source is read-only. Open the test copy from the source menu in the top bar; quick capture saves cards there.',
  loading: 'Opening catalog…',
  missingInbox: 'There is no Inbox deck yet. It will be created in the first tasks space (or the first space).',
  createInbox: 'Create Inbox deck',
  inboxDescription: 'Raw ideas, bugs, and findings — for triage only',
  deck: (title: string) => `Deck “${title}”`,
  space: (title: string) => ` · space “${title}”`,
  shortcutHint: 'Enter — save · Esc — close',
  save: 'Save',
}, {
  quickCapture: 'Быстрая запись в Inbox',
  closeQuickCapture: 'Закрыть быструю запись',
  close: 'Закрыть',
  description: 'Сырая идея, баг или находка агента станет Task-карточкой в колоде Inbox. В Inbox не работают — только разбирают.',
  titleRequired: 'Введите название — без него карточку не сохранить.',
  limits: 'Название ограничено 1000 знаками, текст — 200000 знаками.',
  createInboxFirst: 'Сначала создайте колоду Inbox.',
  noSpaces: 'Сначала создайте пространство в Decks.',
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
  readOnly: 'Источник открыт только для чтения. Откройте тестовую копию через меню источника в верхней полосе — быстрая запись сохраняет карточки туда.',
  loading: 'Открываем каталог…',
  missingInbox: 'Колоды Inbox пока нет. Она появится в первом пространстве типа tasks (или в первом пространстве).',
  createInbox: 'Создать колоду Inbox',
  inboxDescription: 'Сырые идеи, баги и находки — только разбирать',
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
        <header className="quick-capture-header dialog-head">
          <Dialog.Title className="dialog-title">{t.quickCapture}</Dialog.Title>
          <Dialog.Close asChild>
            <Button variant="ghost" size="icon" className="quick-capture-close" aria-label={t.closeQuickCapture} title={t.close}><X size={17} /></Button>
          </Dialog.Close>
        </header>
        <div className="quick-capture-body dialog-body">
          <Dialog.Description className="quick-capture-caption">{t.description}</Dialog.Description>
          <QuickCaptureForm snapshot={snapshot} refreshKey={refreshKey} onOpenCard={onOpenCard} />
        </div>
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
  const [localError, setLocalError] = useState<'' | 'titleRequired' | 'limits' | 'createInboxFirst' | 'noSpaces'>('');
  const titleInput = useRef<HTMLInputElement>(null);
  const checkButton = useRef<HTMLButtonElement>(null);
  const openButton = useRef<HTMLButtonElement>(null);
  const inFlight = useRef(false);
  const checkingInFlight = useRef(false);

  const canWrite = snapshot.source === 'sandbox' && snapshot.writable;
  const spaces = catalog.catalog?.spaces ?? [];
  // Match Inbox case-insensitively; the first matching deck wins.
  const inboxDeck = catalog.catalog?.decks.find(deck => deck.title.trim().toLowerCase() === 'inbox');
  const inboxSpace = inboxDeck ? spaces.find(space => space.id === inboxDeck.spaceId) : undefined;
  const error = localError ? t[localError] : catalog.error || '';
  const locked = saving || checking || catalog.pending || !canWrite || Boolean(notice?.unresolved);

  useEffect(() => {
    // Radix gives initial focus to the first focusable node (the close button); the title field is the real entry point.
    if (savedCardId) moveFocus(openButton.current);
    else if (notice?.unresolved) moveFocus(checkButton.current);
    else moveFocus(titleInput.current);
  }, [savedCardId, notice?.unresolved]);

  async function save() {
    if (inFlight.current || locked || savedCardId || !catalog.catalog) return;
    const draftTitle = title.trim();
    if (!draftTitle) { setLocalError('titleRequired'); return; }
    if (draftTitle.length > 1000 || markdown.length > 200000) { setLocalError('limits'); return; }
    if (!inboxDeck) { setLocalError(spaces.length ? 'createInboxFirst' : 'noSpaces'); return; }
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

  async function createInboxDeck() {
    if (inFlight.current || locked) return;
    const target = spaces.find(space => space.kind === 'tasks') ?? spaces[0];
    if (!target) { setLocalError('noSpaces'); return; }
    setLocalError('');
    await catalog.edit({ action: 'create-deck', title: 'Inbox', spaceId: target.id, kind: 'task', icon: 'tasks',
      color: '#5258b9', description: t.inboxDescription, style: 'symbol' });
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
    <div className="quick-capture-saved">
      <span className="quick-capture-saved-mark" aria-hidden="true"><Check size={15} /></span>
      <span className="quick-capture-saved-text"><strong>{t.saved}</strong>«{savedTitle}»</span>
    </div>
    {/* Actions sit at the end of a footer row, the primary one last, as in every dialog. */}
    <footer className="quick-capture-footer dialog-foot">
      <Button variant="ghost" size="sm" onClick={startAnother}>{t.captureAnother}</Button>
      <Dialog.Close asChild><Button ref={openButton} size="sm" onClick={() => onOpenCard(savedCardId)}>{t.open}</Button></Dialog.Close>
    </footer>
  </div>;

  return <div className="quick-capture-form" onKeyDown={handleKeys}>
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
    {!canWrite && <p className="quick-capture-note">{t.readOnly}</p>}
    {canWrite && !catalog.catalog && !catalog.error && catalog.loading && <p className="quick-capture-note" role="status"><LoaderCircle size={12} className="spin" /> {t.loading}</p>}
    {canWrite && catalog.catalog && !inboxDeck && <div className="quick-capture-missing">
      <p className="quick-capture-note">{spaces.length ? t.missingInbox : t.noSpaces}</p>
      {spaces.length > 0 && <Button size="sm" disabled={locked} onClick={() => void createInboxDeck()}>{t.createInbox}</Button>}
    </div>}
    {inboxDeck && <p className="quick-capture-note">{t.deck(inboxDeck.title)}{inboxSpace ? t.space(inboxSpace.title) : ''}</p>}
    <footer className="quick-capture-footer dialog-foot">
      <span className="quick-capture-hint">{t.shortcutHint}</span>
      <Button size="sm" disabled={locked || !title.trim() || !inboxDeck} onClick={() => void save()}>
        {saving ? <LoaderCircle size={13} className="spin" /> : <Check size={13} />}{t.save}
      </Button>
    </footer>
  </div>;
}
