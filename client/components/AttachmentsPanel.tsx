import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ArrowDownUp, Check, Copy, Download, Eye, FileText, Filter, Image as ImageIcon, LoaderCircle, Trash2 } from 'lucide-react';
import type { CardAttachment, CardAttachments, CatalogCard, CatalogView } from '../../src/catalog-contracts.ts';
import type { CatalogAction } from '../useCatalog.ts';
import { Button } from './ui/button.tsx';
import { AttachmentImageViewer } from './AttachmentImageViewer.tsx';
import { CardOwnerAvatar } from './CardQuickSettings.tsx';
import {
  attachmentAddedByLabel, attachmentFileUrl, attachmentSource,
  fetchCardAttachments, formatAttachmentDate, formatAttachmentSize, readAttachmentAsDataUrl,
  readAttachmentSortOrder, sortAttachmentFiles, validateAttachmentFile, writeAttachmentSortOrder,
  type AttachmentSortOrder, type AttachmentTypeFilter,
} from '../attachments.ts';
import { defineText, textNow, useText } from '../i18n.ts';
import { failureMessage } from '../failure-message.ts';
import { attachmentMarkdown, removeAttachmentLinks } from '../attachment-markdown.ts';
import { subscribeCardAttachments } from '../card-attachment-events.ts';
import { ErrorState } from './ErrorState.tsx';
import { LoadingState } from './LoadingState.tsx';
import { EmptyState } from './EmptyState.tsx';
import '../attachments-panel.css';

const text = defineText({
  loadFailed: 'Could not load attachments.',
  loading: 'Loading attachments…',
  empty: 'No attachments yet.',
  attachments: 'Attachments',
  pasteFailed: 'The attachment was saved, but the image could not be inserted into the text because the card text changed. Paste it again.',
  readFailed: 'Could not read the file.',
  notSaved: (name: string) => `“${name}”: attachment not saved. Check that the list is current and try again.`,
  notRemoved: 'Attachment not removed. Refresh the list and try again.',
  linksNotRemoved: 'Nothing was deleted: the card text changed. Try again.',
  usedInText: (count: number) => count === 1 ? 'This file is inserted in the card text. Remove the link from the text too?'
    : `This file is inserted in the card text ${count} times. Remove the links from the text too?`,
  removeWithLinks: 'Delete and remove from text',
  removeKeepText: 'Delete, keep text',
  cancel: 'Cancel',
  heading: (count: number) => `${count} attached ${new Intl.PluralRules('en-US').select(count) === 'one' ? 'file' : 'files'}`,
  previousNewest: 'Previous image (newer)',
  previousOldest: 'Previous image (older)',
  nextNewest: 'Next image (older)',
  nextOldest: 'Next image (newer)',
  panel: (title: string) => `Card attachments ${title}`,
  uploadHint: 'PNG, JPEG, WebP, GIF, PDF · up to 10 MB · Ctrl+V — paste',
  saving: 'Saving…',
  copyLink: 'Copy link for the card text',
  copied: 'Copied',
  copyFailed: 'Could not copy',
  download: (name: string) => `Download ${name}`,
  remove: (name: string) => `Delete ${name}`,
  removeAttachment: 'Delete attachment',
  view: (name: string) => `View ${name}`,
  missing: 'file missing',
  emptyFilter: 'No attachments of this type.',
  allFiles: 'All files',
  images: 'Images',
  documents: 'Documents',
  newestFirst: 'Newest first',
  oldestFirst: 'Oldest first',
  filterByType: 'Filter by type',
  sort: 'Sort',
  addAttachments: 'Add attachments',
  dropAttachmentOr: 'Drop attachment or',
  browse: 'browse',
}, {
  loadFailed: 'Не удалось загрузить вложения.',
  loading: 'Загружаем вложения…',
  empty: 'Вложений пока нет.',
  attachments: 'Вложения',
  pasteFailed: 'Вложение сохранено, но вставить картинку в текст не удалось — текст карточки изменился. Повторите вставку.',
  readFailed: 'Не удалось прочитать файл.',
  notSaved: (name: string) => `«${name}»: вложение не сохранено. Проверьте актуальность списка и повторите.`,
  notRemoved: 'Вложение не удалено. Обновите список и повторите действие.',
  linksNotRemoved: 'Ничего не удалено: текст карточки изменился. Повторите действие.',
  usedInText: (count: number) => count === 1 ? 'Файл вставлен в текст карточки. Убрать ссылку из текста тоже?'
    : `Файл вставлен в текст карточки (${count}). Убрать ссылки из текста тоже?`,
  removeWithLinks: 'Удалить и убрать из текста',
  removeKeepText: 'Удалить, текст оставить',
  cancel: 'Отмена',
  heading: (count: number) => {
    const rule = new Intl.PluralRules('ru-RU').select(count);
    const noun = { one: 'вложение', few: 'вложения', many: 'вложений', zero: 'вложений', two: 'вложения', other: 'вложения' }[rule]!;
    return `${count} ${noun}`;
  },
  previousNewest: 'Предыдущее изображение (новее)',
  previousOldest: 'Предыдущее изображение (старее)',
  nextNewest: 'Следующее изображение (старее)',
  nextOldest: 'Следующее изображение (новее)',
  panel: (title: string) => `Вложения карточки ${title}`,
  uploadHint: 'PNG, JPEG, WebP, GIF, PDF · до 10 МБ · Ctrl+V — вставка из буфера',
  saving: 'Сохранение…',
  copyLink: 'Скопировать ссылку для текста',
  copied: 'Скопировано',
  copyFailed: 'Не удалось скопировать',
  download: (name: string) => `Скачать ${name}`,
  remove: (name: string) => `Удалить ${name}`,
  removeAttachment: 'Удалить вложение',
  view: (name: string) => `Просмотреть ${name}`,
  missing: 'файл отсутствует',
  emptyFilter: 'Вложений этого типа нет.',
  allFiles: 'Все файлы',
  images: 'Изображения',
  documents: 'Документы',
  newestFirst: 'Сначала новые',
  oldestFirst: 'Сначала старые',
  filterByType: 'Фильтр по типу',
  sort: 'Сортировка',
  addAttachments: 'Добавить вложения',
  dropAttachmentOr: 'Перетащите вложение или',
  browse: 'выберите файл',
});

export interface AttachmentsPanelProps {
  card: CatalogCard;
  catalog: CatalogView;
  writable: boolean;
  onEdit: (action: CatalogAction) => Promise<boolean>;
}

type UploadOrigin = 'browse' | 'drop' | 'paste';

/** Attachments sidebar with type and order filters, file metadata, Markdown links, download, and deletion.
 *  Image previews open the viewer. Uploads support browsing, dropping onto the panel, and Ctrl+V.
 *  Mounted only while the panel is open. */
export function AttachmentsPanel({ card, catalog, writable, onEdit }: AttachmentsPanelProps) {
  const t = useText(text);
  const [view, setView] = useState<CardAttachments | null>(null);
  const [listFailure, setListFailure] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filter, setFilter] = useState<AttachmentTypeFilter>('all');
  const [sortOrder, setSortOrder] = useState<AttachmentSortOrder>(readAttachmentSortOrder);
  const [dragActive, setDragActive] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<{ file: string; count: number } | null>(null);
  const viewRef = useRef<CardAttachments | null>(null);
  const operationInFlight = useRef(false);
  const reloadPending = useRef(false);
  const loadEpoch = useRef(0);
  const mounted = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLElement>(null);

  const source = attachmentSource();
  const identity = source + ':' + card.id;
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const sortedFiles = view ? sortAttachmentFiles(view.files, sortOrder) : [];
  const images = sortedFiles.filter(file => file.kind === 'image' && !file.missing);
  const visibleFiles = sortedFiles.filter(file => filter === 'all' || file.kind === filter);
  const members = catalog.members ?? [];
  const filterOptions: { key: AttachmentTypeFilter; label: string }[] = [
    { key: 'all', label: t.allFiles },
    { key: 'image', label: t.images },
    { key: 'pdf', label: t.documents },
  ];
  // Sort direction controls whether the newest or oldest file appears first.
  const sortOptions: { key: AttachmentSortOrder; label: string }[] = [
    { key: 'newest', label: t.newestFirst },
    { key: 'oldest', label: t.oldestFirst },
  ];

  const load = useCallback(async () => {
    if (!mounted.current || currentIdentity.current !== identity) return;
    const epoch = ++loadEpoch.current;
    setLoading(true);
    try {
      const next = await fetchCardAttachments(source, card.id);
      if (epoch !== loadEpoch.current) return;
      viewRef.current = next;
      setView(next);
      setListFailure('');
    } catch (failure) {
      if (epoch !== loadEpoch.current) return;
      setListFailure(failureMessage(failure, textNow(text).loadFailed));
    } finally {
      if (epoch === loadEpoch.current) setLoading(false);
    }
  }, [card.id, source, identity]);

  useEffect(() => { viewRef.current = view; }, [view]);
  useEffect(() => {
    mounted.current = true;
    const unsubscribe = subscribeCardAttachments(source, card.id, () => {
      if (operationInFlight.current) { reloadPending.current = true; return; }
      void load();
    });
    viewRef.current = null;
    setView(null);
    setListFailure('');
    reloadPending.current = false;
    void load();
    return () => { mounted.current = false; loadEpoch.current += 1; unsubscribe(); };
  }, [card.id, source, load]);

  function finishOperation() {
    operationInFlight.current = false;
    setBusy(false);
    setLoading(false);
    if (reloadPending.current) {
      reloadPending.current = false;
      void load();
    }
  }

  /** Pasting also inserts the uploaded images into the card text; every pasted link is collected
   *  and written in a single edit, because each write replaces the text and would drop earlier links. */
  async function uploadFiles(selected: File[], origin: UploadOrigin) {
    if (!writable || operationInFlight.current || selected.length === 0) return;
    operationInFlight.current = true;
    loadEpoch.current += 1;
    setBusy(true);
    setError('');
    setNotice('');
    const pastedImages: string[] = [];
    try {
      for (const file of selected) {
        const problem = validateAttachmentFile(file);
        if (problem) { setError(problem); continue; }
        let dataUrl: string;
        try { dataUrl = await readAttachmentAsDataUrl(file); }
        catch (failure) { setError(failure instanceof Error ? failure.message : t.readFailed); continue; }
        const saved = await onEdit({ action: 'upload-attachment', cardId: card.id, attachmentsHash: viewRef.current?.hash ?? '',
          dataUrl, fileName: file.name, addedBy: null }); // The server sets the author from x-deckmate-actor.
        if (!saved) { setError(t.notSaved(file.name)); continue; }
        await load();
        if (origin === 'paste' && file.type !== 'application/pdf') {
          const newest = viewRef.current ? sortAttachmentFiles(viewRef.current.files, 'newest')[0] : null;
          if (newest && newest.kind === 'image') pastedImages.push(attachmentMarkdown(card.path, newest));
        }
      }
      if (!pastedImages.length) return;
      const markdown = `${card.markdown.replace(/\s+$/u, '')}\n\n${pastedImages.join('\n')}\n`;
      const inserted = await onEdit({ action: 'update-card-content', cardId: card.id, sourceHash: card.sourceHash, title: card.title, markdown });
      if (!inserted) setNotice(t.pasteFailed);
    } finally {
      finishOperation();
    }
  }

  /** An attachment inserted into the card text asks first: deleting it alone would leave a broken image there. */
  function requestRemoval(file: CardAttachment) {
    if (!view || operationInFlight.current) return;
    const { count } = removeAttachmentLinks(card.markdown, card.path, file.file);
    if (count) setPendingRemoval({ file: file.file, count });
    else void removeAttachment(file.file, false);
  }

  async function removeAttachment(file: string, dropLinks: boolean) {
    if (!view || operationInFlight.current) return;
    operationInFlight.current = true;
    loadEpoch.current += 1;
    setPendingRemoval(null);
    setBusy(true);
    setError('');
    setNotice('');
    try {
      // The text goes first: if it changed meanwhile, nothing is deleted and the person can retry on fresh text.
      if (dropLinks) {
        const { markdown } = removeAttachmentLinks(card.markdown, card.path, file);
        const cleaned = await onEdit({ action: 'update-card-content', cardId: card.id, sourceHash: card.sourceHash, title: card.title, markdown });
        if (!cleaned) { setError(t.linksNotRemoved); return; }
      }
      const saved = await onEdit({ action: 'remove-attachment', cardId: card.id, attachmentsHash: view.hash, file });
      if (saved) await load();
      else setError(t.notRemoved);
    } finally { finishOperation(); }
  }

  function changeSortOrder(next: AttachmentSortOrder) {
    setSortOrder(next);
    writeAttachmentSortOrder(next);
  }

  useEffect(() => {
    if (!writable) return;
    const onPaste = (event: ClipboardEvent) => {
      // 2026-11-07: the listener is on document so a screenshot pasted onto the open card lands here even with no focus;
      // a paste into some other text field belongs to that field and must not become an attachment.
      const target = event.target instanceof HTMLElement ? event.target : null;
      const editingElsewhere = target !== null && (target.isContentEditable || target.matches('input, textarea, select'));
      if (editingElsewhere && !panel.current?.contains(target)) return;
      const files = Array.from(event.clipboardData?.files ?? []);
      if (files.length === 0) return;
      event.preventDefault();
      void uploadFiles(files, 'paste');
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [writable, card, onEdit]);

  const uploadDisabled = !writable || busy;
  const count = sortedFiles.length;
  // Empty panels invite uploads; populated panels show the attached file count.
  let heading = t.attachments;
  if (view) heading = count === 0 && writable ? t.addAttachments : t.heading(count);
  const hasMessages = Boolean(error || notice || (view && view.warnings.length > 0));
  const previousImageLabel = sortOrder === 'newest' ? t.previousNewest : t.previousOldest;
  const nextImageLabel = sortOrder === 'newest' ? t.nextNewest : t.nextOldest;

  return <section ref={panel} className={'attachments-panel' + (dragActive ? ' is-drop-target' : '')} aria-label={t.panel(card.title)} aria-busy={busy || loading}
    onDragOver={event => { if (!uploadDisabled) { event.preventDefault(); setDragActive(true); } }}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false); }}
    onDrop={event => { event.preventDefault(); setDragActive(false); if (!uploadDisabled) void uploadFiles(Array.from(event.dataTransfer.files), 'drop'); }}>
    <header className="attachments-heading">
      <h2>{heading}</h2>
      {count > 0 && <div className="attachments-tools">
        <AttachmentsMenu label={t.filterByType} icon={<Filter size={16} />} active={filter !== 'all'} value={filter} options={filterOptions} onChange={setFilter} />
        <AttachmentsMenu label={t.sort} icon={<ArrowDownUp size={16} />} active={false} value={sortOrder} options={sortOptions} onChange={changeSortOrder} />
      </div>}
    </header>
    {(writable || hasMessages) && <div className="attachments-add">
      {writable && <div className="attachments-drop">
        <input ref={fileInput} type="file" multiple hidden accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
          onChange={(event) => { void uploadFiles(Array.from(event.target.files ?? []), 'browse'); event.target.value = ''; }} />
        <span className="attachments-drop-text">{t.dropAttachmentOr} <button type="button" className="attachments-browse" disabled={uploadDisabled}
          title={t.uploadHint} onClick={() => fileInput.current?.click()}>{t.browse}</button></span>
        {busy && <LoaderCircle size={14} className="spin attachments-busy" aria-label={t.saving} />}
      </div>}
      {error && <p className="attachments-message is-error" role="alert">{error}</p>}
      {notice && <p className="attachments-message" role="status">{notice}</p>}
      {view !== null && view.warnings.length > 0 && <p className="attachments-message" role="status">{view.warnings.join(' · ')}</p>}
    </div>}
    <ErrorState variant="inline" className="attachments-message is-error" message={listFailure} pending={loading} onRetry={load} />
    {loading && !view && !listFailure && <LoadingState variant="skeleton" message={t.loading} />}
    <LoadingState variant="keep-data" active={loading && Boolean(view)} message={t.loading} />
    <ul className="attachments-list">
      {visibleFiles.map(file => {
        const viewable = file.kind === 'image' && !file.missing;
        const author = attachmentAddedByLabel(catalog, file.addedBy);
        return <li key={file.file} className="attachments-row">
          <div className="attachments-row-head">
            <CardOwnerAvatar owner={file.addedBy} members={members} />
            <span className="attachments-row-author" title={author}>{author}</span>
            <time className="attachments-row-when" dateTime={file.addedAt}>{formatAttachmentDate(file.addedAt)}</time>
            <span className="attachments-row-size">{formatAttachmentSize(file.bytes)}</span>
            <div className="attachments-row-actions">
              {viewable && <Button type="button" variant="ghost" size="icon" aria-label={t.view(file.name)} title={t.view(file.name)}
                onClick={() => setViewerIndex(images.indexOf(file))}><Eye size={16} /></Button>}
              <AttachmentCopyButton cardPath={card.path} attachment={file} />
              {!file.missing && <a className="ui-button button-ghost button-size-icon" href={attachmentFileUrl(source, file.file)} download={file.name} aria-label={t.download(file.name)} title={t.download(file.name)}><Download size={16} /></a>}
              {writable && <Button type="button" variant="ghost" size="icon" className="attachments-remove" aria-label={t.remove(file.name)} title={t.removeAttachment} disabled={busy} onClick={() => requestRemoval(file)}><Trash2 size={16} /></Button>}
            </div>
          </div>
          {pendingRemoval?.file === file.file && <div className="attachments-confirm" role="alertdialog" aria-label={t.removeAttachment}>
            <p>{t.usedInText(pendingRemoval.count)}</p>
            <div className="attachments-confirm-actions">
              <Button type="button" size="sm" autoFocus onClick={() => void removeAttachment(file.file, true)}>{t.removeWithLinks}</Button>
              <Button type="button" size="sm" variant="outline" onClick={() => void removeAttachment(file.file, false)}>{t.removeKeepText}</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setPendingRemoval(null)}>{t.cancel}</Button>
            </div>
          </div>}
          {viewable
            ? <button type="button" className="attachments-preview" aria-label={t.view(file.name)} title={file.name} onClick={() => setViewerIndex(images.indexOf(file))}><img src={attachmentFileUrl(source, file.file)} alt="" loading="lazy" /></button>
            : <div className="attachments-file">{file.kind === 'image' ? <ImageIcon size={16} /> : <FileText size={16} />}<span title={file.name}>{file.name}</span>{file.missing && <small>{t.missing}</small>}</div>}
        </li>;
      })}
    </ul>
    {view && count === 0 && !loading && !listFailure && <EmptyState message={t.empty} />}
    {count > 0 && visibleFiles.length === 0 && <EmptyState variant="filtered" message={t.emptyFilter} onReset={() => setFilter('all')} />}
    {viewerIndex !== null && images[viewerIndex] && <AttachmentImageViewer images={images} index={viewerIndex} source={source}
      previousLabel={previousImageLabel} nextLabel={nextImageLabel} onIndexChange={setViewerIndex} onClose={() => setViewerIndex(null)} />}
  </section>;
}

/** Panel dropdown button shared visually with the Sub Cards order and filter controls. */
function AttachmentsMenu<T extends string>({ label, icon, active, value, options, onChange }: {
  label: string; icon: ReactNode; active: boolean; value: T; options: { key: T; label: string }[]; onChange: (value: T) => void;
}) {
  const current = options.find(option => option.key === value)?.label ?? '';
  return <DropdownMenu.Root modal={false}>
    <DropdownMenu.Trigger asChild><Button type="button" variant="ghost" size="icon" className={active ? 'is-active' : undefined} aria-label={label} title={label + ' · ' + current}>{icon}</Button></DropdownMenu.Trigger>
    <DropdownMenu.Portal><DropdownMenu.Content className="dropdown attachments-menu" align="end" sideOffset={6} collisionPadding={12}>
      <DropdownMenu.Label className="dropdown-label">{label}</DropdownMenu.Label>
      <DropdownMenu.RadioGroup value={value} onValueChange={next => onChange(next as T)}>
        {options.map(option => <DropdownMenu.RadioItem key={option.key} value={option.key} className="dropdown-item">
          <span className="attachments-menu-check"><DropdownMenu.ItemIndicator><Check size={14} /></DropdownMenu.ItemIndicator></span>{option.label}
        </DropdownMenu.RadioItem>)}
      </DropdownMenu.RadioGroup>
    </DropdownMenu.Content></DropdownMenu.Portal>
  </DropdownMenu.Root>;
}

function AttachmentCopyButton({ cardPath, attachment }: { cardPath: string; attachment: CardAttachment }) {
  const [feedback, setFeedback] = useState<'' | 'copied' | 'failed'>('');
  const t = useText(text);
  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(''), 1400);
    return () => window.clearTimeout(timer);
  }, [feedback]);
  async function copyLink() {
    try { await navigator.clipboard.writeText(attachmentMarkdown(cardPath, attachment)); setFeedback('copied'); }
    catch { setFeedback('failed'); }
  }
  return <span className="attachment-copy-control">
    <Button type="button" variant="ghost" size="icon" aria-label={t.copyLink} title={t.copyLink} data-copied={feedback === 'copied' || undefined}
      onClick={() => void copyLink()}><Copy size={16} /></Button>
    <span className="card-id-feedback attachment-copy-feedback" role="status" data-state={feedback || undefined}>
      {feedback === 'copied' && <><Check size={12} aria-hidden="true" />{t.copied}</>}{feedback === 'failed' && t.copyFailed}
    </span>
  </span>;
}
