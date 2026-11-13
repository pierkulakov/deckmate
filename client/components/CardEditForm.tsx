import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { FileText, Image, LoaderCircle, Paperclip } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import type { CardAttachment, CatalogView } from '../../src/catalog-contracts.ts';
import type { DataSource } from '../../src/workspace-contracts.ts';
import { attachmentMarkdown } from '../attachment-markdown.ts';
import { fetchCardAttachments, formatAttachmentSize } from '../attachments.ts';
import { parseEditorMarkdown, toggleEditorChecklist } from '../editor-checklists.ts';
import { Markdown } from './Markdown.tsx';
import { EditorCommandMenu, type EditorCommandHandle } from './EditorCommandMenu.tsx';
import { defineText, useText } from '../i18n.ts';
import { moveFocus } from '../focus.ts';
import { primaryModifierPressed } from '../shortcut-format.ts';
import { Keys } from './Keys.tsx';

const text = defineText({
  commandHintStart: 'Type ',
  commandHintEnd: ' to see commands.',
  edit: 'Edit',
  preview: 'Preview',
  cancel: 'Cancel',
  save: 'Save',
  insertAttachment: 'Insert attachment',
  attachmentsLoading: 'Loading attachments…',
  attachmentsEmpty: 'No attachments — add them in the attachments panel',
  attachmentsFailed: 'Could not load attachments.',
  retry: 'Try again',
  attachmentMissing: 'File missing',
}, {
  commandHintStart: 'Нажмите ',
  commandHintEnd: ' — появятся команды.',
  edit: 'Правка',
  preview: 'Предпросмотр',
  cancel: 'Отмена',
  save: 'Сохранить',
  insertAttachment: 'Вставить вложение',
  attachmentsLoading: 'Загружаем вложения…',
  attachmentsEmpty: 'Вложений нет — добавьте их в панели вложений',
  attachmentsFailed: 'Не удалось загрузить вложения.',
  retry: 'Повторить',
  attachmentMissing: 'Файл отсутствует',
});

// Title and body travel as one text while editing; a leading '#' on the title line is optional.
export function composeDraft(title: string, markdown: string): string {
  return title + '\n\n' + markdown;
}

export function splitDraft(text: string, originalMarkdown?: string): { title: string; markdown: string } {
  const newline = text.search(/\r?\n/u);
  const first = newline < 0 ? text : text.slice(0, newline);
  // 2026-11-11: only the title break and the editor's separator belong to the form; subsequent blank lines are body bytes.
  const rest = newline < 0 ? '' : text.slice(newline).replace(/^\r?\n(?:\r?\n)?/u, '');
  // 2026-11-11: textarea input normalizes CRLF; a title-only edit must still send the original body bytes.
  const unchangedBody = originalMarkdown !== undefined && rest.replace(/\r\n/gu, '\n') === originalMarkdown.replace(/\r\n/gu, '\n');
  return { title: first.replace(/^#{1,6}[ \t]+/u, '').trim(), markdown: unchangedBody ? originalMarkdown : rest };
}

// Cards and Journey steps share the same text editor:
// hint row, one monospace Markdown box with the «/», «$», «#», «@» menus, footer Preview · Cancel Esc · Save Ctrl+Enter.
export function CardEditForm({ draft, onDraftChange, catalog, source, path, cardId, writable, busy, saving = false, blocked = false,
  saveLabel, textLabel, maxLength, hintActions, notice, cancelButton = true, confirmStrip, footerTarget, children, onSave, onCancel }: {
  draft: string;
  onDraftChange: (value: string) => void;
  catalog: CatalogView;
  source: DataSource;
  path?: string;
  /** Only persisted cards have an attachment list; New Card and Journey instructions omit it. */
  cardId?: string;
  writable: boolean;
  /** A write is in flight: the text and the footer wait for it. */
  busy: boolean;
  saving?: boolean;
  /** Save stays disabled, e.g. while a conflict is unresolved. */
  blocked?: boolean;
  saveLabel?: string;
  textLabel?: string;
  maxLength?: number;
  hintActions?: ReactNode;
  notice?: string;
  /** New Card omits the footer Cancel button: Escape and Close leave it. Escape still calls onCancel. */
  cancelButton?: boolean;
  /** A pending discard question: the strip stands in place of the footer, and the text waits for the answer. */
  confirmStrip?: ReactNode;
  footerTarget?: HTMLElement | null;
  /** Shown between the hint row and the text box. */
  children?: ReactNode;
  onSave: () => void;
  onCancel: () => void;
}) {
  const [preview, setPreview] = useState(false);
  const t = useText(text);
  const resolvedSaveLabel = saveLabel ?? t.save;
  const formRef = useRef<HTMLFormElement>(null);
  const formId = useId();
  const editorRef = useRef<EditorCommandHandle>(null);
  useTextFitsCard(formRef, draft, preview);
  const parts = splitDraft(draft);
  const textDisabled = !writable || busy || Boolean(confirmStrip);
  // The strip replaces the footer, so the button focus came from is gone; after Keep the edit continues in the text box.
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current && !confirmStrip) moveFocus(formRef.current?.querySelector<HTMLTextAreaElement>('.card-edit-text'), { preventScroll: true });
    asked.current = Boolean(confirmStrip);
  }, [confirmStrip]);

  function handleKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    // Menus inside the box consume their own Escape with stopPropagation. defaultPrevented is no signal here:
    // a host dialog prevents Escape only to stay open and leaves the edit to this form.
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); onCancel(); }
    if (primaryModifierPressed(event) && event.key === 'Enter') { event.preventDefault(); onSave(); }
  }

  const footer = confirmStrip ?? <footer className="card-edit-footer">
    <button type="button" className="card-edit-link" disabled={busy || !draft.trim()} aria-pressed={preview} onClick={() => setPreview(value => !value)}>{preview ? t.edit : t.preview}</button>
    {cancelButton && <button type="button" className="card-edit-link is-cancel" disabled={busy} onClick={onCancel}>{t.cancel} <Keys combo={{ key: 'Escape' }} /></button>}
    <span className="card-edit-save-group"><Keys className="card-edit-save-hint" variant="separate" combo={{ key: 'Enter', modifiers: ['primary'] }} />
      <button type="submit" form={formId} className="card-edit-save" disabled={!writable || busy || blocked || !parts.title}>{saving ? <><LoaderCircle size={14} className="spin" aria-hidden="true" /><span className="visually-hidden">{resolvedSaveLabel}</span></> : resolvedSaveLabel}</button></span>
  </footer>;
  return <form id={formId} ref={formRef} className="card-edit" onKeyDown={handleKeyDown} onSubmit={event => { event.preventDefault(); onSave(); }}>
    <div className="card-edit-hint-row"><div className="card-edit-hints"><span className="card-edit-hint">{t.commandHintStart}<Keys combo={{ key: '/' }} /> <Keys combo={{ key: 'Enter' }} />{t.commandHintEnd}</span>
      {cardId && path && <AttachmentInsertMenu key={`${source}:${cardId}`} source={source} cardId={cardId} disabled={textDisabled || preview}
        onInsert={attachment => editorRef.current?.insert(attachmentMarkdown(path, attachment))} onFocusText={() => editorRef.current?.focus()} />}
    </div>{hintActions}</div>
    {children}
    <div className="card-edit-box">
      {preview ? <div className="card-edit-preview"><h2 className="card-preview-title">{parts.title}</h2><Markdown tree={parseEditorMarkdown(parts.markdown)} rawMarkdown={parts.markdown} projectTags={catalog.projectTags} source={source} path={path} members={catalog.members} showChecklistCount cards={catalog.cards}
        taskToggleDisabled={textDisabled} onTaskToggle={(offset, checked) => {
          const updated = toggleEditorChecklist(parts.markdown, offset, checked);
          if (updated !== null) onDraftChange(draft.slice(0, draft.length - parts.markdown.length) + updated);
        }} /></div>
        : <EditorCommandMenu ref={editorRef} value={draft} onChange={onDraftChange} catalog={catalog} disabled={textDisabled} label={textLabel} maxLength={maxLength} />}
    </div>
    {notice && <p className="card-content-notice" role="status">{notice}</p>}
    {footerTarget ? createPortal(footer, footerTarget) : footer}
  </form>;
}

function AttachmentInsertMenu({ source, cardId, disabled, onInsert, onFocusText }: {
  source: DataSource; cardId: string; disabled: boolean;
  onInsert: (attachment: CardAttachment) => void; onFocusText: () => void;
}) {
  const t = useText(text);
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<CardAttachment[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const restoreTextFocus = useRef(true);
  const visible = open && !disabled;
  useEffect(() => {
    if (!visible) return;
    let active = true;
    setFiles(null);
    setFailed(false);
    // 2026-11-09: reload on every opening so uploads made in the attachment panel appear without reopening the editor.
    fetchCardAttachments(source, cardId).then(result => { if (active) setFiles(result.files); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [visible, source, cardId, attempt]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  return <DropdownMenu.Root modal={false} open={visible} onOpenChange={next => {
    if (next) { setFiles(null); setFailed(false); restoreTextFocus.current = true; }
    setOpen(next);
  }}>
    <DropdownMenu.Trigger asChild><button type="button" className="card-edit-link card-edit-insert" disabled={disabled} title={t.insertAttachment}>
      <Paperclip size={14} aria-hidden="true" />{t.insertAttachment}
    </button></DropdownMenu.Trigger>
    <DropdownMenu.Portal><DropdownMenu.Content className="dropdown card-edit-attachments" align="start" sideOffset={6} collisionPadding={12}
      aria-label={t.insertAttachment} onKeyDown={event => event.stopPropagation()}
      onEscapeKeyDown={event => { event.preventDefault(); event.stopPropagation(); setOpen(false); }}
      onInteractOutside={() => { restoreTextFocus.current = false; }}
      onCloseAutoFocus={event => { event.preventDefault(); if (restoreTextFocus.current) onFocusText(); }}>
      <DropdownMenu.Label className="dropdown-label">{t.insertAttachment}</DropdownMenu.Label>
      {failed ? <><p className="card-edit-attachments-status" role="alert">{t.attachmentsFailed}</p>
        <DropdownMenu.Item className="dropdown-item" onSelect={event => { event.preventDefault(); setAttempt(value => value + 1); }}>{t.retry}</DropdownMenu.Item></>
        : <>{files === null && <p className="card-edit-attachments-status" role="status">{t.attachmentsLoading}</p>}
          {files?.length === 0 && <p className="card-edit-attachments-status" role="status">{t.attachmentsEmpty}</p>}
          {files?.map(attachment => <DropdownMenu.Item key={attachment.file} className="dropdown-item card-edit-attachment" disabled={attachment.missing}
            textValue={attachment.name} onSelect={() => onInsert(attachment)}>
            {attachment.kind === 'image' ? <Image size={16} aria-hidden="true" /> : <FileText size={16} aria-hidden="true" />}
            <span className="card-edit-attachment-info"><span className="card-edit-attachment-name">{attachment.name}</span>
              <span className="card-edit-attachment-meta">{attachment.mime} · {formatAttachmentSize(attachment.bytes)}{attachment.missing && ` · ${t.attachmentMissing}`}</span></span>
          </DropdownMenu.Item>)}
        </>}
    </DropdownMenu.Content></DropdownMenu.Portal>
  </DropdownMenu.Root>;
}

const minimumTextHeight = 144;

/**
 * The text box grows with the text until the card meets the bottom of its own scroll area (the card preview), then
 * scrolls inside, so Save, the tags and the Effort/Priority strip stay in view (2026-11-05).
 * Without a scroll area of its own inside the page (narrow screens, New Card at the page end) the box simply grows.
 */
function useTextFitsCard(formRef: RefObject<HTMLFormElement | null>, draft: string, preview: boolean) {
  const fit = useCallback(() => {
    const form = formRef.current;
    const text = form?.querySelector<HTMLTextAreaElement>('.card-edit-text');
    if (!form || !text) return;
    const scroller = cardScroller(form);
    text.style.maxHeight = '';
    text.style.minHeight = '';
    if (!scroller) return;
    const excess = scroller.scrollHeight - scroller.clientHeight;
    if (excess > 0) {
      // 2026-11-10: status text and wrapped card chrome can leave less than 144px; keep Save inside the scrollport.
      const height = Math.max(0, text.offsetHeight - excess);
      text.style.minHeight = `${Math.min(minimumTextHeight, height)}px`;
      text.style.maxHeight = `${height}px`;
    }
  }, [formRef]);
  useLayoutEffect(fit, [fit, draft, preview]);
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    let frame = 0;
    function schedule() {
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; fit(); });
    }
    // 2026-11-08: the shell's measured cap can settle after the draft, and footer wrapping can change without a resize.
    // Observe the panels even while mobile overflow is visible, so crossing the breakpoint uses the same fit.
    const observer = new ResizeObserver(schedule);
    const scroller = form.closest('.card-preview-panels') ?? cardScroller(form);
    if (scroller) observer.observe(scroller);
    observer.observe(form);
    window.addEventListener('resize', schedule);
    return () => {
      observer.disconnect(); cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
    };
  }, [fit, formRef]);
}

/** The nearest scrolling ancestor below the page itself. */
function cardScroller(form: HTMLElement): HTMLElement | null {
  for (let element = form.parentElement; element && !element.classList.contains('workspace-main'); element = element.parentElement) {
    if (/^(auto|scroll)$/u.test(getComputedStyle(element).overflowY)) return element;
  }
  return null;
}
