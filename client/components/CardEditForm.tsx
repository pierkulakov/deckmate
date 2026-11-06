import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { LoaderCircle } from 'lucide-react';
import type { CatalogView } from '../../src/catalog-contracts.ts';
import type { DataSource } from '../../src/workspace-contracts.ts';
import { parseEditorMarkdown, toggleEditorChecklist } from '../editor-checklists.ts';
import { Markdown } from './Markdown.tsx';
import { EditorCommandMenu } from './EditorCommandMenu.tsx';

// Title and body travel as one text while editing; a leading '#' on the title line is optional.
export function composeDraft(title: string, markdown: string): string {
  return title + '\n\n' + markdown;
}

export function splitDraft(text: string): { title: string; markdown: string } {
  const newline = text.search(/\r?\n/u);
  const first = newline < 0 ? text : text.slice(0, newline);
  const rest = newline < 0 ? '' : text.slice(newline).replace(/^(?:[ \t]*\r?\n)+/u, '');
  return { title: first.replace(/^#{1,6}[ \t]+/u, '').trim(), markdown: rest };
}

// Cards and Journey steps share the same text editor:
// hint row, one monospace Markdown box with the «/», «$», «#», «@» menus, footer Preview · Cancel Esc · Save Ctrl+Enter.
export function CardEditForm({ draft, onDraftChange, catalog, source, path, writable, busy, saving = false, blocked = false,
  saveLabel = 'Save', textLabel, maxLength, hintActions, notice, cancelButton = true, confirmStrip, children, onSave, onCancel }: {
  draft: string;
  onDraftChange: (value: string) => void;
  catalog: CatalogView;
  source: DataSource;
  path?: string;
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
  /** Shown between the hint row and the text box. */
  children?: ReactNode;
  onSave: () => void;
  onCancel: () => void;
}) {
  const [preview, setPreview] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  useTextFitsCard(formRef, draft, preview);
  const parts = splitDraft(draft);
  const textDisabled = !writable || busy || Boolean(confirmStrip);
  // The strip replaces the footer, so the button focus came from is gone; after Keep the edit continues in the text box.
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current && !confirmStrip) formRef.current?.querySelector<HTMLTextAreaElement>('.card-edit-text')?.focus({ preventScroll: true });
    asked.current = Boolean(confirmStrip);
  }, [confirmStrip]);

  function handleKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    // Menus inside the box consume their own Escape with stopPropagation. defaultPrevented is no signal here:
    // a host dialog prevents Escape only to stay open and leaves the edit to this form.
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); onCancel(); }
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); onSave(); }
  }

  return <form ref={formRef} className="card-edit" onKeyDown={handleKeyDown} onSubmit={event => { event.preventDefault(); onSave(); }}>
    <div className="card-edit-hint-row"><span className="card-edit-hint">Type <kbd>/</kbd> <kbd>Enter</kbd> to see commands.</span>{hintActions}</div>
    {children}
    <div className="card-edit-box">
      {preview ? <div className="card-edit-preview"><h2 className="card-preview-title">{parts.title}</h2><Markdown tree={parseEditorMarkdown(parts.markdown)} rawMarkdown={parts.markdown} projectTags={catalog.projectTags} source={source} path={path} members={catalog.members} showChecklistCount cards={catalog.cards}
        taskToggleDisabled={textDisabled} onTaskToggle={(offset, checked) => {
          const updated = toggleEditorChecklist(parts.markdown, offset, checked);
          if (updated !== null) onDraftChange(draft.slice(0, draft.length - parts.markdown.length) + updated);
        }} /></div>
        : <EditorCommandMenu value={draft} onChange={onDraftChange} catalog={catalog} disabled={textDisabled} label={textLabel} maxLength={maxLength} />}
    </div>
    {notice && <p className="card-content-notice" role="status">{notice}</p>}
    {confirmStrip ?? <footer className="card-edit-footer">
      {/* Empty text has nothing to preview, so Preview stays disabled. */}
      <button type="button" className="card-edit-link" disabled={busy || !draft.trim()} aria-pressed={preview} onClick={() => setPreview(value => !value)}>{preview ? 'Edit' : 'Preview'}</button>
      {cancelButton && <button type="button" className="card-edit-link is-cancel" disabled={busy} onClick={onCancel}>Cancel <kbd>Esc</kbd></button>}
      <span className="card-edit-save-group"><span className="card-edit-save-hint"><kbd>Ctrl</kbd>+<kbd>Enter</kbd></span>
        <button type="submit" className="card-edit-save" disabled={!writable || busy || blocked || !parts.title}>{saving ? <><LoaderCircle size={14} className="spin" aria-hidden="true" /><span className="visually-hidden">{saveLabel}</span></> : saveLabel}</button></span>
    </footer>}
  </form>;
}

const minimumTextHeight = 144;

/**
 * The text box grows with the text until the card meets the bottom of its own scroll area (the card preview), then
 * scrolls inside, so Save, the tags and the Effort/Priority strip stay in view (2026-11-05, as in the reference editor).
 * Without a scroll area of its own inside the page (narrow screens, New Card at the page end) the box simply grows.
 */
function useTextFitsCard(formRef: RefObject<HTMLFormElement | null>, draft: string, preview: boolean) {
  const fit = useCallback(() => {
    const form = formRef.current;
    const text = form?.querySelector<HTMLTextAreaElement>('.card-edit-text');
    if (!form || !text) return;
    const scroller = cardScroller(form);
    text.style.maxHeight = '';
    if (!scroller) return;
    const excess = scroller.scrollHeight - scroller.clientHeight;
    if (excess > 0) text.style.maxHeight = `${Math.max(minimumTextHeight, text.offsetHeight - excess)}px`;
  }, [formRef]);
  useLayoutEffect(fit, [fit, draft, preview]);
  useEffect(() => {
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [fit]);
}

/** The nearest scrolling ancestor below the page itself. */
function cardScroller(form: HTMLElement): HTMLElement | null {
  for (let element = form.parentElement; element && !element.classList.contains('workspace-main'); element = element.parentElement) {
    if (/^(auto|scroll)$/u.test(getComputedStyle(element).overflowY)) return element;
  }
  return null;
}
