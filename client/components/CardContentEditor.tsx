import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { FileCheck2, Pencil, Play, RefreshCw, Trash2 } from 'lucide-react';
import type { CardContent, CatalogCard, CatalogView } from '../../src/catalog-contracts.ts';
import type { WorkspaceSnapshot } from '../../src/workspace-contracts.ts';
import type { CatalogAction } from '../useCatalog.ts';
import { parseEditorMarkdown, toggleEditorChecklist } from '../editor-checklists.ts';
import { readCardDraft, removeCardDraft, writeCardDraft } from '../card-drafts.ts';
import { useScrollportFitHeight } from '../scrollport-fit.ts';
import { readDurationMs } from '../motion.ts';
import { Markdown } from './Markdown.tsx';
import { splitJourneyStepLink } from './journey-step-link.ts';
import { TagTitlePrefix } from './CardTags.tsx';
import { CardEditForm, composeDraft, splitDraft } from './CardEditForm.tsx';
import { CardFocusMode } from './CardFocusMode.tsx';
import { CatalogReferenceLink } from './JourneyPanel.tsx';
import { Button } from './ui/button.tsx';
import { defineText, textNow, useText } from '../i18n.ts';
import { moveFocus } from '../focus.ts';
import { questionReadingTree } from './OpenQuestions.tsx';
import '../card-editor.css';

const text = defineText({
  loadFailed: 'Could not load card content.',
  invalidResponse: 'The server returned invalid card content.',
  conflictLoadFailed: 'The conflict is preserved. Could not load the current text; the draft remains in the editor.',
  unsaved: 'This card has unsaved changes',
  continueEditing: 'Continue editing',
  discardChanges: 'Discard changes',
  draftNotKept: 'The browser could not keep the draft. Save it or cancel again to discard it.',
  rebased: 'Your draft is unchanged. Saving will replace the file text; external changes will not be merged automatically.',
  rebaseFailed: 'Could not load the current version. The draft and conflict are preserved.',
  titleRequired: 'Enter the card title.',
  tooLong: 'The title is limited to 1000 characters, the content to 200000 characters.',
  notConfirmed: 'Changes not confirmed. The draft is preserved; check the catalog message.',
  saveUnconfirmed: 'Could not confirm the save. The draft remains in the editor; try again after checking the source.',
  editTitle: 'Edit title and content',
  readOnly: 'This project is read-only.',
  originalReadOnly: 'The original is read-only. Open the test copy to edit.',
  unsavedText: 'Unsaved text — save explicitly to write to the file',
  savingToFile: 'Saving to file…',
  savedToFile: 'Saved to file',
  browserDraft: 'Draft in this browser — not saved to file',
  saveMyText: 'Save my text',
  loading: 'Loading content from Markdown…',
  documentReadOnly: 'The document is read-only. ',
  indexVersion: 'Showing the indexed version; editing is unavailable. ',
  retry: 'Retry loading',
  empty: 'Add a card description in Markdown using Edit.',
  conflict: 'Content conflict',
  conflictDescription: 'The file or catalog changed. Your draft is preserved. File changes will not be merged automatically. Compare and combine the text before continuing; the next save will replace the file text with your draft.',
  yourDraft: 'Your draft',
  currentText: 'Current text',
  useCurrentBase: 'Continue with my draft',
  edit: 'Edit',
  editCard: 'Edit Card',
}, {
  loadFailed: 'Не удалось загрузить содержимое карточки.',
  invalidResponse: 'Сервер вернул некорректное содержимое карточки.',
  conflictLoadFailed: 'Конфликт сохранён. Не удалось загрузить текущий текст; черновик остался в редакторе.',
  unsaved: 'В карточке есть несохранённые изменения',
  continueEditing: 'Продолжить правку',
  discardChanges: 'Отменить изменения',
  draftNotKept: 'Браузер не смог сохранить черновик. Сохраните его или нажмите «Отмена» ещё раз, чтобы отменить.',
  rebased: 'Ваш черновик не изменён. Сохранение заменит текст в файле; внешние изменения не добавятся автоматически.',
  rebaseFailed: 'Не удалось загрузить актуальную версию. Черновик и конфликт сохранены.',
  titleRequired: 'Введите название карточки.',
  tooLong: 'Название ограничено 1000 знаками, содержимое — 200000 знаками.',
  notConfirmed: 'Сохранение не подтверждено. Черновик остался в редакторе. Проверьте карточку и сообщение об ошибке перед повтором.',
  saveUnconfirmed: 'Не удалось подтвердить сохранение. Черновик остался в редакторе; повторите после проверки источника.',
  editTitle: 'Редактировать название и содержимое',
  readOnly: 'Проект открыт только для чтения.',
  originalReadOnly: 'Оригинал открыт только для чтения. Для правки откройте тестовую копию.',
  unsavedText: 'Есть несохранённый текст — запишите его кнопкой «Сохранить»',
  savingToFile: 'Сохраняем в файл…',
  savedToFile: 'Сохранено в файле',
  browserDraft: 'Черновик в этом браузере — не записан в файл',
  saveMyText: 'Записать мой текст',
  loading: 'Загружаем содержимое из Markdown…',
  documentReadOnly: 'Документ доступен только для чтения. ',
  indexVersion: 'Показана версия из индекса; редактирование недоступно. ',
  retry: 'Повторить загрузку',
  empty: 'Добавьте описание карточки в Markdown через «Правку».',
  conflict: 'Конфликт содержимого',
  conflictDescription: 'Файл или каталог изменился. Черновик сохранён. Изменения из файла не добавятся автоматически. Сравните и объедините текст перед продолжением: следующее сохранение заменит текст в файле вашим черновиком.',
  yourDraft: 'Ваш черновик',
  currentText: 'Текущий текст',
  useCurrentBase: 'Продолжить с моим текстом',
  edit: 'Правка',
  editCard: 'Редактировать карточку',
});

interface ContentBaseline extends CardContent { manifestHash: string }
interface LoadFailure extends Error { status: number }
interface ContentResource {
  key: string;
  content: CardContent | null;
  loading: boolean;
  slow: boolean;
  failure: LoadFailure | Error | null;
}

export function cardReadOnlyDescription(snapshot: WorkspaceSnapshot): string {
  const t = textNow(text);
  return snapshot.editMode === 'sandbox' && snapshot.source === 'live' ? t.originalReadOnly : t.readOnly;
}

// 2026-11-08: the reading column measures the card shell that carries it; in Focus Mode the portal has no shell.
const cardPreviewShell = (from: HTMLElement) => from.closest<HTMLElement>('.card-preview');
// 2026-11-10: the section column and the Sub Cards panel beside the card end at the card's visible bottom too.
const cardPreviewColumns = (shell: HTMLElement) => shell.closest<HTMLElement>('.catalog-content-layout');

async function fetchCardContent(cardId: string, source: WorkspaceSnapshot['source'], signal?: AbortSignal): Promise<CardContent> {
  const response = await fetch(`/api/card-content?source=${source}&cardId=${encodeURIComponent(cardId)}`, { cache: 'no-store', signal });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = result && typeof result === 'object' && 'message' in result ? String(result.message) : textNow(text).loadFailed;
    const failure = new Error(message) as LoadFailure;
    failure.status = response.status;
    throw failure;
  }
  if (!result || typeof result !== 'object' || !('cardId' in result) || !('title' in result) || !('markdown' in result) || !('sourceHash' in result)) {
    throw new Error(textNow(text).invalidResponse);
  }
  return result as CardContent;
}

export function CardContentEditor({ card, catalog, snapshot, writable, pending, blocked, headingRef, onEdit, onEditingChange, onEditorOpenChange, onCancelEdit, titleActions, footerActions, footerTarget, bodyAfter, onOpenCard, focusMode = false, onFocusModeExit, hideJourneyStepLink = false }: {
  card: CatalogCard;
  catalog: CatalogView;
  snapshot: WorkspaceSnapshot;
  writable: boolean;
  pending: boolean;
  blocked: boolean;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onEdit: (action: CatalogAction) => Promise<boolean>;
  onEditingChange: (editing: boolean) => void;
  onEditorOpenChange?: (open: boolean) => void;
  onCancelEdit?: () => void;
  titleActions?: ReactNode;
  footerActions?: ReactNode;
  /** 2026-11-10: where the reading footer (save status, card actions, Edit) is pinned; inside the article when absent. */
  footerTarget?: HTMLElement | null;
  /** Read mode only: shown under the text, inside the sheet. */
  bodyAfter?: ReactNode;
  /** True where a Journey step note replaces the trailing Markdown step link. */
  hideJourneyStepLink?: boolean;
  /** Read mode only: a click on a card reference chip opens that card. */
  onOpenCard?: (card: CatalogCard) => void;
  /** Focus Mode shares this reading and edit state across the whole viewport (CardFocusMode). */
  focusMode?: boolean;
  onFocusModeExit?: () => void;
}) {
  const baseline = useRef<ContentBaseline | null>(null);
  const t = useText(text);
  // The card shell keeps its height within the actually visible workspace space, so the material band stays in view.
  const shell = useScrollportFitHeight(cardPreviewShell, '--preview-height', cardPreviewColumns);
  const inFlight = useRef(false);
  const latestRevision = useRef({ sourceHash: card.sourceHash, manifestHash: catalog.manifestHash });
  // 2026-11-10: edit intent follows watcher refreshes of this card, but must not follow navigation to another card.
  const cardKey = JSON.stringify([snapshot.source, card.id]);
  const resourceKey = JSON.stringify([snapshot.source, card.id, card.sourceHash]);
  const [resource, setResource] = useState<ContentResource>({ key: resourceKey, content: null, loading: true, slow: false, failure: null });
  const currentResource = resource.key === resourceKey ? resource : null;
  const content = currentResource?.content ?? null;
  const loading = !currentResource || currentResource.loading;
  const loadFailure = currentResource?.failure ?? null;
  const loadingVisible = loading && Boolean(currentResource?.slow);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [editRequest, setEditRequest] = useState<string | null>(null);
  useEffect(() => { setEditRequest(null); }, [cardKey]);
  const [currentContent, setCurrentContent] = useState<CardContent | null>(null);
  const [editing, setEditing] = useState(false);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusToEdit = useRef(false);
  // The whole card is one plain Markdown text; its first line is the title.
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [submittedContent, setSubmittedContent] = useState<{ cardKey: string; content: CardContent } | null>(null);
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState('');
  // A draft kept by Cancel; the card shows the unsaved-changes banner until it is continued or discarded.
  const [stashed, setStashed] = useState(() => readCardDraft(snapshot.source, card.id) !== null);
  useEffect(() => { setStashed(readCardDraft(snapshot.source, card.id) !== null); }, [snapshot.source, card.id]);
  latestRevision.current = { sourceHash: card.sourceHash, manifestHash: catalog.manifestHash };

  const fallbackContent = useMemo<CardContent>(() => ({ cardId: card.id, title: card.title, markdown: card.markdown, sourceHash: card.sourceHash }), [card.id, card.title, card.markdown, card.sourceHash]);
  // 2026-11-05: use this card's catalog copy until the file loads, preventing stale text and a one-frame layout collapse.
  // 2026-11-13: a save's catalog and content responses settle separately; keep the submitted reading text through that handoff.
  const shownContent = submittedContent?.cardKey === cardKey ? submittedContent.content : content ?? fallbackContent;
  // 2026-11-08: reading hides the server's trailing Journey step link (a prefix, so checklist offsets stay valid);
  // the editor and the file keep the full text.
  const readingMarkdown = useMemo(() => hideJourneyStepLink ? splitJourneyStepLink(shownContent.markdown, card.journey).body : shownContent.markdown,
    [hideJourneyStepLink, shownContent.markdown, card.journey]);
  const questionsShown = !focusMode;
  const tree = useMemo(() => {
    const parsed = parseEditorMarkdown(readingMarkdown);
    return questionsShown ? questionReadingTree(parsed) : parsed;
  }, [readingMarkdown, questionsShown]);
  const base = baseline.current;
  const contentDirty = editing && base !== null && draft !== composeDraft(base.title, base.markdown);
  const revisionChanged = editing && base !== null
    && (base.sourceHash !== card.sourceHash || base.manifestHash !== catalog.manifestHash);
  const hasConflict = editing && (conflict || revisionChanged);
  // 2026-11-10: reading already has the indexed file text; only a slow refresh deserves a visible or spoken status.
  let saveStatus = loadFailure ? '' : t.savedToFile;
  if (loadingVisible) saveStatus = t.loading;
  if (stashed) saveStatus = t.browserDraft;
  if (contentDirty || hasConflict) saveStatus = t.unsavedText;
  if (saving) saveStatus = t.savingToFile;

  useEffect(() => {
    // 2026-11-03: watcher revisions refresh reading, but never replace an open draft.
    if (editing || saving) return;
    const controller = new AbortController();
    let active = true;
    // 2026-11-10: a Retry keeps the failure notice (and its focused button) until the new answer arrives.
    setResource(previous => {
      const same = previous.key === resourceKey;
      return { key: resourceKey, content: same ? previous.content : null, loading: true, slow: false, failure: same ? previous.failure : null };
    });
    const delayMs = readDurationMs('--busy-dim-delay');
    const timer = window.setTimeout(() => {
      if (active) setResource(previous => ({ ...previous, slow: true }));
    }, delayMs);
    fetchCardContent(card.id, snapshot.source, controller.signal).then(result => {
      if (active) {
        setResource({ key: resourceKey, content: result, loading: false, slow: false, failure: null });
        setSubmittedContent(null);
      }
    }).catch((failure: unknown) => {
      if (active && !controller.signal.aborted) setResource({ key: resourceKey, content: null, loading: false, slow: false,
        failure: failure instanceof Error ? failure : new Error(String(failure)) });
    }).finally(() => window.clearTimeout(timer));
    return () => { active = false; window.clearTimeout(timer); controller.abort(); };
  }, [resourceKey, card.id, snapshot.source, editing, saving, loadAttempt]);

  useEffect(() => { onEditingChange(contentDirty || saving); }, [contentDirty, saving, onEditingChange]);
  useEffect(() => () => onEditingChange(false), [onEditingChange]);
  useEffect(() => { onEditorOpenChange?.(editing); return () => onEditorOpenChange?.(false); }, [editing, onEditorOpenChange]);

  // Focus Mode opens the card's editor once per entry; Save or Cancel returns to the rendered card.
  // Layout phase: the reading view never flashes before the text box.
  const editOnFocusEntry = useRef(false);
  const wasFocusMode = useRef(focusMode);
  const wasEditing = useRef(editing);
  useLayoutEffect(() => { editOnFocusEntry.current = focusMode; }, [focusMode]);
  useLayoutEffect(() => {
    if (!focusMode || !editOnFocusEntry.current || loading) return;
    editOnFocusEntry.current = false;
    if (!editing) startEditing();
  }, [focusMode, loading, editing]);
  useLayoutEffect(() => {
    if (editRequest !== cardKey || loading) return;
    setEditRequest(null);
    startEditing();
  }, [editRequest, cardKey, loading]);
  useEffect(() => {
    // Focus never drops to <body> when the text box closes in Focus Mode or Focus Mode closes on the reading view:
    // it goes to the title. An edit that stays open autofocuses its own text.
    const textClosedInFocusMode = focusMode && wasEditing.current && !editing;
    const focusModeClosedOnReading = wasFocusMode.current && !focusMode && !editing;
    if (textClosedInFocusMode || focusModeClosedOnReading) moveFocus(headingRef.current, { preventScroll: true });
    wasFocusMode.current = focusMode;
    wasEditing.current = editing;
  }, [focusMode, editing, headingRef]);

  useEffect(() => {
    if (!revisionChanged) return;
    setConflict(true);
    const controller = new AbortController();
    fetchCardContent(card.id, snapshot.source, controller.signal).then(setCurrentContent).catch(() => {
      if (!controller.signal.aborted) setNotice(textNow(text).conflictLoadFailed);
    });
    return () => controller.abort();
  }, [revisionChanged, card.id, card.sourceHash, snapshot.source]);

  function startEditing() {
    if (loadFailure || !writable || pending || saving || inFlight.current || blocked) return;
    // 2026-11-10: accept the intent immediately, but never build a write baseline from the catalog or another card.
    if (loading) { setEditRequest(cardKey); return; }
    if (!content) return;
    if (stashed) { continueEditing(); return; }
    baseline.current = { ...content, manifestHash: catalog.manifestHash };
    setDraft(composeDraft(content.title, content.markdown));
    setCurrentContent(null);
    setConflict(false);
    setNotice('');
    setEditing(true);
  }

  function editFromBody(event: MouseEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.detail > 1) return;
    if (event.target instanceof Element && event.target.closest('a, button, input, textarea, select, label, summary, audio, video, [role="button"], [contenteditable]')) return;
    if (window.getSelection()?.isCollapsed === false) return;
    startEditing();
  }

  function setContent(content: CardContent) {
    setResource(previous => ({ ...previous, key: resourceKey, content }));
  }

  function finishEditing() {
    baseline.current = null;
    setEditing(false);
    setConflict(false);
    setCurrentContent(null);
  }

  async function cancelEditing() {
    if (!editing || saving || pending) return;
    // 2026-11-05: Cancel never asks. Changed text stays as a draft behind the unsaved-changes banner; a second Cancel
    // after the browser refused to store it discards, as the notice says.
    if (contentDirty && base && notice !== t.draftNotKept) {
      if (!writeCardDraft(snapshot.source, card.id, { draft, baseline: base })) { setNotice(t.draftNotKept); return; }
      setStashed(true);
    }
    // Discard optimistic checkbox content even if reloading the source later fails.
    if (base) setContent({ cardId: base.cardId, title: base.title, markdown: base.markdown, sourceHash: base.sourceHash });
    setSubmittedContent(null);
    finishEditing();
    setNotice('');
    // 2026-11-10: wait for the textarea to unmount; cancelling must not strand keyboard focus on body.
    requestAnimationFrame(() => {
      if (!focusMode && onCancelEdit) onCancelEdit();
      else moveFocus(headingRef.current, { preventScroll: true });
    });
  }

  function continueEditing() {
    const stored = readCardDraft(snapshot.source, card.id);
    if (!stored) { setStashed(false); return; }
    if (loading || !writable || pending || saving || inFlight.current || blocked) return;
    // The draft keeps its own base revision: a file changed meanwhile opens as the usual content conflict.
    baseline.current = stored.baseline;
    setDraft(stored.draft);
    setCurrentContent(null);
    setConflict(false);
    setNotice('');
    setEditing(true);
    removeCardDraft(snapshot.source, card.id);
    setStashed(false);
  }

  function discardDraft() {
    removeCardDraft(snapshot.source, card.id);
    setStashed(false);
  }

  function leaveFocusMode() {
    // Back never discards: an untouched draft closes, a changed one stays open in the card's editor.
    if (editing && !saving && !contentDirty) finishEditing();
    onFocusModeExit?.();
  }

  async function rebase() {
    if (saving || pending) return;
    try {
      const latest = await fetchCardContent(card.id, snapshot.source);
      // 2026-11-03: only this explicit action may replace the write revision; the draft stays untouched.
      baseline.current = { ...latest, manifestHash: latestRevision.current.manifestHash };
      setContent(latest);
      setCurrentContent(latest);
      setConflict(false);
      setNotice(t.rebased);
    } catch {
      setNotice(t.rebaseFailed);
    }
  }

  async function save() {
    const base = baseline.current;
    if (!editing || !base || !writable || pending || saving || inFlight.current || hasConflict) return;
    inFlight.current = true;
    const { title: draftTitle, markdown: draftMarkdown } = splitDraft(draft, base.markdown);
    if (!draftTitle) { setNotice(t.titleRequired); inFlight.current = false; return; }
    if (draftTitle.length > 1000 || draftMarkdown.length > 200000) { setNotice(t.tooLong); inFlight.current = false; return; }
    await persistContent(base, draftTitle, draftMarkdown);
  }

  async function toggleTask(itemOffset: number, checked: boolean) {
    if (!content || editing || loading || loadFailure || !writable || pending || saving || inFlight.current || blocked) return;
    const draftMarkdown = toggleEditorChecklist(content.markdown, itemOffset, checked);
    if (draftMarkdown === null || draftMarkdown === content.markdown) return;
    const base = { ...content, manifestHash: catalog.manifestHash };
    baseline.current = base;
    setDraft(composeDraft(content.title, draftMarkdown));
    setContent({ ...content, markdown: draftMarkdown });
    setCurrentContent(null);
    setConflict(false);
    inFlight.current = true;
    await persistContent(base, content.title, draftMarkdown);
  }

  async function persistContent(base: ContentBaseline, draftTitle: string, draftMarkdown: string) {
    const returnToEdit = editing;
    setSubmittedContent({ cardKey, content: { cardId: card.id, title: draftTitle, markdown: draftMarkdown, sourceHash: base.sourceHash } });
    setSaving(true);
    setNotice('');
    try {
      const saved = await onEdit({ action: 'update-card-content', cardId: card.id, title: draftTitle,
        markdown: draftMarkdown, sourceHash: base.sourceHash, manifestHash: base.manifestHash });
      if (saved) {
        finishEditing();
        // Only closing the full editor returns to Edit; saving a reading-mode checklist keeps its own focus.
        if (returnToEdit && !focusMode) returnFocusToEdit.current = true;
      } else {
        setSubmittedContent(null);
        // 2026-11-03: a failed quick checkbox edit becomes an explicit draft instead of disappearing.
        setEditing(true);
        const latest = latestRevision.current;
        if (latest.sourceHash !== base.sourceHash || latest.manifestHash !== base.manifestHash) setConflict(true);
        else setNotice(t.notConfirmed);
      }
    } catch {
      setSubmittedContent(null);
      setEditing(true);
      setNotice(t.saveUnconfirmed);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  // 2026-11-13: a frame callback could run before the commit that clears `saving`, and a disabled button refuses
  // focus; Edit takes focus back only once it is enabled again.
  const editDisabled = Boolean(loadFailure) || pending || saving || blocked;
  useLayoutEffect(() => {
    if (!returnFocusToEdit.current || editing || editDisabled) return;
    returnFocusToEdit.current = false;
    // Focus the person has already moved elsewhere stays where it is.
    if (document.activeElement && document.activeElement !== document.body) return;
    moveFocus(editButtonRef.current, { preventScroll: true });
  }, [editing, editDisabled]);

  // 2026-11-10: at rest the file is simply saved, so that state is a quiet icon with its words for tooltips and screen
  // readers; loading, saving, an unsaved text or a browser draft say so in words.
  const calmStatus = saveStatus === t.savedToFile;
  const readingFooter = <footer className="card-content-reading-footer">
    <CatalogReferenceLink kind="c" id={card.id} source={snapshot.source} />
    {saveStatus && <span className={'card-content-save-status' + (calmStatus ? ' is-calm' : '')} role="status" title={saveStatus}>
      {calmStatus ? <><FileCheck2 size={14} aria-hidden="true" /><span className="visually-hidden">{saveStatus}</span></> : saveStatus}</span>}
    <div className="card-content-reading-actions">{footerActions}
      {writable && <Button ref={editButtonRef} type="button" size="sm" className="card-content-edit-action" aria-label={t.editCard} disabled={editDisabled} onClick={startEditing}><Pencil size={14} />{t.edit}</Button>}
    </div>
  </footer>;
  const comparison = currentContent ?? fallbackContent;
  // Focus Mode shows only the card text: the sheet's actions, links and footer stay on the card.
  const article = <article ref={shell} className={'card-preview-reading card-content-reading' + (editing ? ' is-editing' : '')}>
    {!editing && <>
      {stashed && <section className="card-draft-banner" aria-label={t.unsaved}>
        <p>{t.browserDraft}</p>
        <div className="card-draft-banner-actions">
          <Button type="button" size="sm" disabled={loading || !writable || pending || saving || blocked} onClick={continueEditing}><Play size={14} aria-hidden="true" />{t.continueEditing}</Button>
          <Button type="button" size="sm" disabled={pending || saving} onClick={discardDraft}><Trash2 size={14} aria-hidden="true" />{t.discardChanges}</Button>
        </div>
      </section>}
      <div className="card-content-heading"><h2 className="card-preview-title" ref={headingRef} tabIndex={-1}>{writable && !loadFailure ? <button type="button" className="card-title-edit" disabled={pending || saving || blocked} onClick={startEditing} title={t.editTitle}><TagTitlePrefix tags={card.tags} definitions={catalog.projectTags} />{shownContent.title}</button> : <><TagTitlePrefix tags={card.tags} definitions={catalog.projectTags} />{shownContent.title}</>}</h2>
        {!focusMode && titleActions}
      </div>
      {!writable && !card.deleted && <p className="card-content-readonly">{cardReadOnlyDescription(snapshot)}</p>}
      {focusMode && loadingVisible && <p className="card-content-save-status" role="status">{t.loading}</p>}
      {loadFailure && <div className="card-content-notice" role="status">
        <p>{'status' in loadFailure && loadFailure.status === 422 ? t.documentReadOnly : t.indexVersion}{loadFailure.message}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => setLoadAttempt(attempt => attempt + 1)}><RefreshCw size={14} />{t.retry}</Button>
      </div>}
      <div className="card-preview-document" onClick={editFromBody}>
        {readingMarkdown.trim() ? <Markdown projectTags={catalog.projectTags} rawMarkdown={readingMarkdown} tree={tree} source={snapshot.source} path={card.path} members={catalog.members} showChecklistCount
          cards={catalog.cards} onOpenCard={onOpenCard}
          onTaskToggle={content && writable && !loadFailure ? (offset, checked) => void toggleTask(offset, checked) : undefined}
          taskToggleDisabled={loading || pending || saving || blocked} /> : <p className="card-content-empty">{t.empty}</p>}
      </div>
      {!focusMode && bodyAfter}
      {notice && <p className="card-content-notice" role="status">{notice}</p>}
      {!focusMode && !footerTarget && readingFooter}
    </>}
    {editing && <CardEditForm draft={draft} onDraftChange={setDraft} catalog={catalog} source={snapshot.source} path={card.path} cardId={card.id}
      writable={writable} busy={pending || saving} saving={saving} blocked={hasConflict} hintActions={focusMode ? undefined : titleActions} notice={notice}
      saveLabel={notice === t.rebased ? t.saveMyText : undefined} footerTarget={focusMode ? undefined : footerTarget}
       onSave={() => void save()} onCancel={() => void cancelEditing()}>
       {saveStatus && <p className="card-content-save-status" role="status">{saveStatus}</p>}
      {hasConflict && <section className="card-content-conflict" aria-label={t.conflict}>
        <p role="alert">{t.conflictDescription}</p>
        <div className="card-content-conflict-columns">
          <section><h3>{t.yourDraft}</h3><pre>{draft}</pre></section>
          <section><h3>{t.currentText}</h3><pre>{comparison.title + '\n\n' + comparison.markdown}</pre></section>
        </div>
        <div className="card-content-conflict-actions"><Button type="button" variant="outline" size="sm" disabled={pending || saving} onClick={() => void rebase()}><RefreshCw size={14} />{t.useCurrentBase}</Button></div>
      </section>}
    </CardEditForm>}
  </article>;
  // The state above stays in this component, so a draft survives moving between the sheet and Focus Mode.
  if (focusMode) return <CardFocusMode title={shownContent.title} onBack={leaveFocusMode}>{article}</CardFocusMode>;
  // The pinned footer belongs to reading: while the text is edited the form's own Save and Cancel take over.
  return <>{article}{footerTarget && !editing && createPortal(readingFooter, footerTarget)}</>;
}
