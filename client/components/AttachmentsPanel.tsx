import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ArrowDownUp, Check, Download, Eye, FileText, Filter, Image as ImageIcon, LoaderCircle, Trash2 } from 'lucide-react';
import type { CardAttachment, CardAttachments, CatalogCard, CatalogView } from '../../src/catalog-contracts.ts';
import type { CatalogAction } from '../useCatalog.ts';
import { Button } from './ui/button.tsx';
import { AttachmentImageViewer } from './AttachmentImageViewer.tsx';
import { CardOwnerAvatar } from './CardQuickSettings.tsx';
import {
  attachmentAddedByLabel, attachmentFileUrl, attachmentMarkdownReference, attachmentSource,
  fetchCardAttachments, formatAttachmentDate, formatAttachmentSize, readAttachmentAsDataUrl,
  readAttachmentSortOrder, sortAttachmentFiles, validateAttachmentFile, writeAttachmentSortOrder,
  type AttachmentSortOrder, type AttachmentTypeFilter,
} from '../attachments.ts';
import { defineText, textNow, useText } from '../i18n.ts';
import { failureMessage } from '../failure-message.ts';
import '../attachments-panel.css';

const text = defineText({
  coverEditor: 'Image Cover Editor',
  loadFailed: 'Could not load attachments.',
  pasteFailed: 'The attachment was saved, but the image could not be inserted into the text because the card text changed. Paste it again.',
  readFailed: 'Could not read the file.',
  notSaved: (name: string) => `“${name}”: attachment not saved. Check that the list is current and try again.`,
  notRemoved: 'Attachment not removed. Refresh the list and try again.',
  coverNotSaved: 'Cover not saved. Try again.',
  heading: (count: number) => `${count} attached ${new Intl.PluralRules('en-US').select(count) === 'one' ? 'file' : 'files'}`,
  previousNewest: 'Previous image (newer)',
  previousOldest: 'Previous image (older)',
  nextNewest: 'Next image (older)',
  nextOldest: 'Next image (newer)',
  panel: (title: string) => `Card attachments ${title}`,
  uploadHint: 'PNG, JPEG, WebP, GIF, PDF · up to 10 MB · Ctrl+V — paste',
  saving: 'Saving…',
  configureCover: 'Card cover: configure',
  makeCover: 'Make card cover',
  editCover: 'Image Cover — configure',
  download: (name: string) => `Download ${name}`,
  remove: (name: string) => `Delete ${name}`,
  removeAttachment: 'Delete attachment',
  view: (name: string) => `View ${name}`,
  missing: 'file missing',
  emptyFilter: 'No attachments of this type.',
  cardTitle: 'Card title',
  position: 'Position',
  title: 'Title',
  light: 'Light',
  dark: 'Dark',
  blur: 'Blur bottom edge',
  savePosition: 'Save position',
  removeCover: 'Remove cover',
}, {
  coverEditor: 'Редактор обложки',
  loadFailed: 'Не удалось загрузить вложения.',
  pasteFailed: 'Вложение сохранено, но вставить картинку в текст не удалось — текст карточки изменился. Повторите вставку.',
  readFailed: 'Не удалось прочитать файл.',
  notSaved: (name: string) => `«${name}»: вложение не сохранено. Проверьте актуальность списка и повторите.`,
  notRemoved: 'Вложение не удалено. Обновите список и повторите действие.',
  coverNotSaved: 'Обложка не сохранена. Повторите действие.',
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
  configureCover: 'Обложка карточки: настроить',
  makeCover: 'Сделать обложкой карточки',
  editCover: 'Image Cover — настроить',
  download: (name: string) => `Скачать ${name}`,
  remove: (name: string) => `Удалить ${name}`,
  removeAttachment: 'Удалить вложение',
  view: (name: string) => `Просмотреть ${name}`,
  missing: 'файл отсутствует',
  emptyFilter: 'Вложений этого типа нет.',
  cardTitle: 'Заголовок карточки',
  position: 'Позиция',
  title: 'Заголовок',
  light: 'Светлый',
  dark: 'Тёмный',
  blur: 'Размыть нижний край',
  savePosition: 'Сохранить позицию',
  removeCover: 'Убрать обложку',
});

export interface AttachmentsPanelProps {
  card: CatalogCard;
  catalog: CatalogView;
  writable: boolean;
  onEdit: (action: CatalogAction) => Promise<boolean>;
}

type UploadOrigin = 'browse' | 'drop' | 'paste';
type CoverDraft = { position: number; titleMode: 'light' | 'dark'; blur: boolean };
const filterOptions: { key: AttachmentTypeFilter; label: string }[] = [{ key: 'all', label: 'All files' }, { key: 'image', label: 'Images' }, { key: 'pdf', label: 'Documents' }];
// Sort direction controls whether the newest or oldest file appears first.
const sortOptions: { key: AttachmentSortOrder; label: string }[] = [{ key: 'newest', label: 'Newest first' }, { key: 'oldest', label: 'Oldest first' }];

/** Attachments sidebar with type and order filters, file metadata, cover selection, download, and deletion.
 *  Image previews open the viewer. Uploads support browsing, dropping onto the panel, and Ctrl+V.
 *  Mounted only while the panel is open. */
export function AttachmentsPanel({ card, catalog, writable, onEdit }: AttachmentsPanelProps) {
  const t = useText(text);
  const [view, setView] = useState<CardAttachments | null>(null);
  const [listFailure, setListFailure] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filter, setFilter] = useState<AttachmentTypeFilter>('all');
  const [sortOrder, setSortOrder] = useState<AttachmentSortOrder>(readAttachmentSortOrder);
  const [dragActive, setDragActive] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [coverEditorFile, setCoverEditorFile] = useState<string | null>(null);
  const viewRef = useRef<CardAttachments | null>(null);
  const uploadInFlight = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const source = attachmentSource();
  const sortedFiles = view ? sortAttachmentFiles(view.files, sortOrder) : [];
  const images = sortedFiles.filter(file => file.kind === 'image' && !file.missing);
  const visibleFiles = sortedFiles.filter(file => filter === 'all' || file.kind === filter);
  const cover = view?.cover ?? null;
  const members = catalog.members ?? [];

  const load = useCallback(async () => {
    try {
      const next = await fetchCardAttachments(attachmentSource(), card.id);
      viewRef.current = next;
      setView(next);
      setListFailure('');
    } catch (failure) {
      setListFailure(failureMessage(failure, textNow(text).loadFailed));
    }
  }, [card.id]);

  useEffect(() => { viewRef.current = view; }, [view]);
  useEffect(() => { void load(); }, [load]);

  /** Pasting also inserts the uploaded image directly into the card text. */
  async function pasteImageIntoText() {
    const fresh = viewRef.current;
    const newest = fresh ? sortAttachmentFiles(fresh.files, 'newest')[0] : null;
    if (!fresh || !newest || newest.kind !== 'image') return;
    const reference = attachmentMarkdownReference(newest.file, card.path);
    const markdown = `${card.markdown.replace(/\s+$/u, '')}\n\n![${newest.name}](${reference})\n`;
    const saved = await onEdit({ action: 'update-card-content', cardId: card.id, sourceHash: card.sourceHash, title: card.title, markdown });
    if (!saved) setNotice(t.pasteFailed);
  }

  async function uploadFiles(selected: File[], origin: UploadOrigin) {
    if (!writable || uploadInFlight.current || selected.length === 0) return;
    uploadInFlight.current = true;
    setBusy(true);
    setError('');
    setNotice('');
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
        if (origin === 'paste' && file.type !== 'application/pdf') await pasteImageIntoText();
      }
    } finally {
      uploadInFlight.current = false;
      setBusy(false);
    }
  }

  async function removeAttachment(file: CardAttachment) {
    if (!view || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const saved = await onEdit({ action: 'remove-attachment', cardId: card.id, attachmentsHash: view.hash, file: file.file });
      if (saved) await load();
      else setError(t.notRemoved);
    } finally { setBusy(false); }
  }

  async function applyCover(coverFile: string | null, draft: CoverDraft): Promise<boolean> {
    if (!view || busy) return false;
    setBusy(true);
    setError('');
    try {
      const saved = await onEdit({ action: 'set-card-cover', cardId: card.id, attachmentsHash: view.hash, coverFile,
        coverPosition: draft.position, coverTitleMode: draft.titleMode, coverBlur: draft.blur });
      if (saved) await load();
      else setError(t.coverNotSaved);
      return saved;
    } finally { setBusy(false); }
  }

  /** The eye selects an image as the cover and opens its editor; on the current cover it toggles the editor. */
  async function chooseCover(file: CardAttachment) {
    if (cover?.file === file.file) { setCoverEditorFile(coverEditorFile === file.file ? null : file.file); return; }
    if (await applyCover(file.file, { position: cover?.position ?? 50, titleMode: cover?.titleMode ?? 'light', blur: cover?.blur ?? false })) setCoverEditorFile(file.file);
  }

  async function saveCover(coverFile: string | null, draft: CoverDraft) {
    if (await applyCover(coverFile, draft)) setCoverEditorFile(null);
  }

  function changeSortOrder(next: AttachmentSortOrder) {
    setSortOrder(next);
    writeAttachmentSortOrder(next);
  }

  useEffect(() => {
    if (!writable) return;
    const onPaste = (event: ClipboardEvent) => {
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
  const heading = count === 0 && writable ? 'Add attachments' : t.heading(count);
  const hasMessages = Boolean(listFailure || error || notice || (view && view.warnings.length > 0));
  const previousImageLabel = sortOrder === 'newest' ? t.previousNewest : t.previousOldest;
  const nextImageLabel = sortOrder === 'newest' ? t.nextNewest : t.nextOldest;

  return <section className={'attachments-panel' + (dragActive ? ' is-drop-target' : '')} aria-label={t.panel(card.title)} aria-busy={busy}
    onDragOver={event => { if (!uploadDisabled) { event.preventDefault(); setDragActive(true); } }}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false); }}
    onDrop={event => { event.preventDefault(); setDragActive(false); if (!uploadDisabled) void uploadFiles(Array.from(event.dataTransfer.files), 'drop'); }}>
    <header className="attachments-heading">
      <h2>{heading}</h2>
      {count > 0 && <div className="attachments-tools">
        <AttachmentsMenu label="Filter by type" icon={<Filter size={16} />} active={filter !== 'all'} value={filter} options={filterOptions} onChange={setFilter} />
        <AttachmentsMenu label="Sort" icon={<ArrowDownUp size={16} />} active={false} value={sortOrder} options={sortOptions} onChange={changeSortOrder} />
      </div>}
    </header>
    {(writable || hasMessages) && <div className="attachments-add">
      {writable && <div className="attachments-drop">
        <input ref={fileInput} type="file" multiple hidden accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
          onChange={(event) => { void uploadFiles(Array.from(event.target.files ?? []), 'browse'); event.target.value = ''; }} />
        <span className="attachments-drop-text">Drop attachment or <button type="button" className="attachments-browse" disabled={uploadDisabled}
          title={t.uploadHint} onClick={() => fileInput.current?.click()}>browse</button></span>
        {busy && <LoaderCircle size={14} className="spin attachments-busy" aria-label={t.saving} />}
      </div>}
      {listFailure && <p className="attachments-message is-error" role="alert">{listFailure}</p>}
      {error && <p className="attachments-message is-error" role="alert">{error}</p>}
      {notice && <p className="attachments-message" role="status">{notice}</p>}
      {view !== null && view.warnings.length > 0 && <p className="attachments-message" role="status">{view.warnings.join(' · ')}</p>}
    </div>}
    <ul className="attachments-list">
      {visibleFiles.map(file => {
        const isCover = cover?.file === file.file;
        const viewable = file.kind === 'image' && !file.missing;
        const author = attachmentAddedByLabel(catalog, file.addedBy);
        return <li key={file.file} className="attachments-row">
          <div className="attachments-row-head">
            <CardOwnerAvatar owner={file.addedBy} members={members} />
            <span className="attachments-row-author" title={author}>{author}</span>
            <time className="attachments-row-when" dateTime={file.addedAt}>{formatAttachmentDate(file.addedAt)}</time>
            <span className="attachments-row-size">{formatAttachmentSize(file.bytes)}</span>
            <div className="attachments-row-actions">
              {viewable && writable && <Button type="button" variant="ghost" size="icon" disabled={busy} aria-pressed={isCover}
                aria-label={isCover ? t.configureCover : t.makeCover} title={isCover ? t.editCover : t.makeCover}
                onClick={() => void chooseCover(file)}><Eye size={16} /></Button>}
              {!file.missing && <a className="ui-button button-ghost button-size-icon" href={attachmentFileUrl(source, file.file)} download={file.name} aria-label={t.download(file.name)} title={t.download(file.name)}><Download size={16} /></a>}
              {writable && <Button type="button" variant="ghost" size="icon" className="attachments-remove" aria-label={t.remove(file.name)} title={t.removeAttachment} disabled={busy} onClick={() => void removeAttachment(file)}><Trash2 size={16} /></Button>}
            </div>
          </div>
          {viewable
            ? <button type="button" className="attachments-preview" aria-label={t.view(file.name)} title={file.name} onClick={() => setViewerIndex(images.indexOf(file))}><img src={attachmentFileUrl(source, file.file)} alt="" loading="lazy" /></button>
            : <div className="attachments-file">{file.kind === 'image' ? <ImageIcon size={16} /> : <FileText size={16} />}<span title={file.name}>{file.name}</span>{file.missing && <small>{t.missing}</small>}</div>}
          {isCover && coverEditorFile === file.file && cover && <CoverEditor key={cover.file} cover={cover} source={source} busy={busy || !writable} onSave={saveCover} />}
        </li>;
      })}
    </ul>
    {count > 0 && visibleFiles.length === 0 && <p className="attachments-message">{t.emptyFilter}</p>}
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

/** Cover controls for image position, light or dark title text, and bottom blur. */
function CoverEditor({ cover, source, busy, onSave }: {
  cover: NonNullable<CardAttachments['cover']>;
  source: ReturnType<typeof attachmentSource>;
  busy: boolean;
  onSave: (coverFile: string | null, draft: CoverDraft) => void;
}) {
  const [position, setPosition] = useState(cover.position);
  const t = useText(text);
  const [titleMode, setTitleMode] = useState(cover.titleMode);
  const [blur, setBlur] = useState(cover.blur);
  const dirty = position !== cover.position || titleMode !== cover.titleMode || blur !== cover.blur;
  return <section className="attachments-cover" aria-label={t.coverEditor}>
    <h3>Image cover</h3>
    <div className={'attachments-cover-preview is-' + titleMode + (blur ? ' is-blurred' : '')}>
      <img src={attachmentFileUrl(source, cover.file)} alt="" style={{ objectPosition: `${Math.round(position)}% 50%` }} />
      <span className="attachments-cover-caption">{t.cardTitle}</span>
    </div>
    <label className="attachments-cover-field">{t.position}<span>{Math.round(position)}%</span>
      <input type="range" min={0} max={100} step={1} value={position} onChange={event => setPosition(Number(event.target.value))} disabled={busy} />
    </label>
    <label className="attachments-cover-field">{t.title}
      <select value={titleMode} onChange={event => setTitleMode(event.target.value === 'dark' ? 'dark' : 'light')} disabled={busy}>
        <option value="light">{t.light}</option>
        <option value="dark">{t.dark}</option>
      </select>
    </label>
    <label className="attachments-cover-check"><input type="checkbox" checked={blur} onChange={event => setBlur(event.target.checked)} disabled={busy} />{t.blur}</label>
    <div className="attachments-cover-actions">
      <Button type="button" size="sm" disabled={busy || !dirty} onClick={() => onSave(cover.file, { position, titleMode, blur })}>{t.savePosition}</Button>
      <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => onSave(null, { position, titleMode, blur })}>{t.removeCover}</Button>
    </div>
  </section>;
}
