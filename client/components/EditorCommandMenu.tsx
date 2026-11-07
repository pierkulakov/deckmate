import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Bold, Italic, Strikethrough, Hash, Smile, Image, Code, Heading1, Heading2, Heading3, Link, List, ListOrdered, Minus, Quote, SquareCheck, Table2, UserRound, type LucideIcon } from 'lucide-react';
import type { CatalogView } from '../../src/catalog-contracts.ts';
import { editorPastedCardLink, getEditorOptions, getEditorTrigger, insertEditorCommand, measureEditorCaret, type EditorCommand } from '../editor-commands.ts';
import { formatEditorSelection, moveEditorLines, type EditorFormat, type EditorReplacement } from '../editor-formatting.ts';
import { CardOwnerAvatar } from './CardQuickSettings.tsx';
import { EditorMediaInsert } from './EditorMediaInsert.tsx';
import { cardIcons } from './CatalogCardTile.tsx';
import { TagBadge } from './CardTags.tsx';
import { defineText, useLang, useText } from '../i18n.ts';
import '../editor-commands.css';

const text = defineText({
  bold: 'Bold',
  italic: 'Italic',
  strike: 'Strikethrough',
  code: 'Code',
  link: 'Link',
  defaultLabel: 'Card text: first line is the title',
  cards: 'Cards',
  members: 'Members',
  commands: 'Commands',
  projectTags: 'Project tags',
  personalTag: 'Personal tag',
  media: 'Images and videos in the text',
  formatSelection: 'Format selected text',
  newTag: 'New tag: keep typing and finish with a space.',
  noMatches: 'No matches. Change the query.',
  noMedia: 'There are no images or videos in the text yet. Paste a file or drag it into the field.',
  choose: '↑↓ select',
  insert: 'Enter / Tab insert',
  close: 'Esc close',
}, {
  bold: 'Жирный',
  italic: 'Курсив',
  strike: 'Зачёркнутый',
  code: 'Код',
  link: 'Ссылка',
  defaultLabel: 'Текст карточки: первая строка — название',
  cards: 'Карты',
  members: 'Участники',
  commands: 'Команды',
  projectTags: 'Теги проекта',
  personalTag: 'Личный тег',
  media: 'Картинки и видео в тексте',
  formatSelection: 'Форматирование выделенного текста',
  newTag: 'Новый тег: продолжайте ввод и завершите пробелом.',
  noMatches: 'Совпадений нет. Измените запрос.',
  noMedia: 'В тексте ещё нет картинок и видео. Вставьте файл из буфера или перетащите его в поле.',
  choose: '↑↓ выбор',
  insert: 'Enter / Tab вставить',
  close: 'Esc закрыть',
});

const commandIcons: Record<string, LucideIcon> = { 'heading-1': Heading1, 'heading-2': Heading2, 'heading-3': Heading3,
  'bullet-list': List, 'numbered-list': ListOrdered, checkbox: SquareCheck, quote: Quote, code: Code, divider: Minus, table: Table2, link: Link, member: UserRound, tag: Hash, emoji: Smile, media: Image };

const formats: { id: EditorFormat; label: keyof (typeof text)['en']; shortcut: string; Icon: LucideIcon }[] = [
  { id: 'bold', label: 'bold', shortcut: 'Ctrl/⌘+B', Icon: Bold },
  { id: 'italic', label: 'italic', shortcut: 'Ctrl/⌘+I', Icon: Italic },
  { id: 'strike', label: 'strike', shortcut: 'Ctrl/⌘+Shift+X', Icon: Strikethrough },
  { id: 'code', label: 'code', shortcut: 'Ctrl/⌘+E', Icon: Code },
  { id: 'link', label: 'link', shortcut: 'Ctrl/⌘+K', Icon: Link },
];
const formatKeys: Partial<Record<string, EditorFormat>> = { b: 'bold', i: 'italic', e: 'code', k: 'link' };

interface MenuPosition { left: number; top?: number; bottom?: number; width: number; maxHeight: number }

export function EditorCommandMenu({ value, onChange, catalog, disabled, label: textLabel, maxLength = 201002 }: {
  value: string;
  onChange: (value: string) => void;
  catalog: CatalogView;
  disabled: boolean;
  label?: string;
  maxLength?: number;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const t = useText(text);
  const lang = useLang();
  const menuRef = useRef<HTMLDivElement>(null);
  const pendingSelection = useRef<{ start: number; end: number } | null>(null);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [selected, setSelected] = useState(0);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const [mediaRequest, setMediaRequest] = useState<{ files: File[]; start: number; end: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const menuId = useId();
  const trigger = useMemo(() => getEditorTrigger(value, selection.start, selection.end), [value, selection]);
  const options = useMemo(() => trigger ? getEditorOptions(trigger, catalog, value) : [], [trigger, catalog, value, lang]);
  const active = Boolean(trigger && focused && !disabled && !dismissed);
  const formatting = focused && !disabled && selection.start !== selection.end && !mediaRequest;
  const selectedIndex = Math.min(selected, Math.max(0, options.length - 1));

  useEffect(() => { setSelected(0); }, [trigger?.kind, trigger?.start, trigger?.query]);

  useLayoutEffect(() => {
    const requested = pendingSelection.current;
    if (!requested || !textareaRef.current) return;
    pendingSelection.current = null;
    textareaRef.current.focus();
    textareaRef.current.setSelectionRange(requested.start, requested.end);
    setSelection(requested);
  }, [value]);

  useLayoutEffect(() => {
    if (!active && !formatting) { setPosition(null); return; }
    const textarea = textareaRef.current;
    if (!textarea) return;
    function updatePosition() {
      if (!textarea) return;
      const caret = measureEditorCaret(textarea);
      const box = textarea.getBoundingClientRect();
      let visibleTop = Math.max(0, box.top);
      let visibleBottom = Math.min(window.innerHeight, box.bottom);
      for (let ancestor = textarea.parentElement; ancestor; ancestor = ancestor.parentElement) {
        if (!/(auto|scroll|hidden|clip)/u.test(getComputedStyle(ancestor).overflowY)) continue;
        const bounds = ancestor.getBoundingClientRect();
        visibleTop = Math.max(visibleTop, bounds.top);
        visibleBottom = Math.min(visibleBottom, bounds.bottom);
      }
      if (caret.top + caret.height < visibleTop || caret.top > visibleBottom) { setPosition(null); return; }
      const width = Math.min(formatting ? 190 : 360, window.innerWidth - 16);
      const below = window.innerHeight - caret.top - caret.height - 12;
      const above = caret.top - 12;
      const openAbove = formatting ? above > 44 : below < 180 && above > below;
      const maxHeight = Math.min(360, Math.max(80, openAbove ? above : below));
      setPosition({ left: Math.max(8, Math.min(caret.left, window.innerWidth - width - 8)),
        ...(openAbove ? { bottom: window.innerHeight - caret.top + 4 } : { top: Math.max(8, caret.top + caret.height + 4) }), width, maxHeight });
    }
    updatePosition();
    const observer = new ResizeObserver(updatePosition);
    observer.observe(textarea);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [active, formatting, value, selection, options.length]);

  useEffect(() => {
    menuRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex, options, position !== null]);

  function readSelection(textarea: HTMLTextAreaElement) {
    setSelection({ start: textarea.selectionStart, end: textarea.selectionEnd });
  }

  function insert(command: EditorCommand) {
    if (!trigger || !textareaRef.current) return;
    const replacement = insertEditorCommand(value, trigger, command);
    setDismissed(!['mention', 'tag', 'emoji', 'media'].includes(command.id));
    setSelected(0);
    applyReplacement(replacement);
  }

  function applyReplacement(replacement: EditorReplacement) {
    const textarea = textareaRef.current;
    if (!textarea || replacement.value.length > textarea.maxLength) return;
    if (replacement.value === value) return;
    pendingSelection.current = replacement;
    textarea.focus();
    // 2026-11-04: browser editing keeps keyboard undo for formatting and picker insertions.
    let start = 0;
    while (start < value.length && start < replacement.value.length && value[start] === replacement.value[start]) start++;
    let oldEnd = value.length;
    let newEnd = replacement.value.length;
    while (oldEnd > start && newEnd > start && value[oldEnd - 1] === replacement.value[newEnd - 1]) { oldEnd--; newEnd--; }
    textarea.setSelectionRange(start, oldEnd);
    if (!document.execCommand('insertText', false, replacement.value.slice(start, newEnd))) onChange(replacement.value);
  }

  function formatSelection(format: EditorFormat) {
    setDismissed(true);
    const textarea = textareaRef.current;
    const actual = textarea ? { start: textarea.selectionStart, end: textarea.selectionEnd } : selection;
    applyReplacement(formatEditorSelection(value, actual, format));
  }

  function requestMedia(files: File[]) {
    const media = files.filter(file => /^(?:image|video)\//u.test(file.type));
    if (!media.length || disabled) return;
    setDismissed(true);
    setMediaRequest({ files: media, ...selection });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (disabled || mediaRequest) return;
    if (event.nativeEvent.isComposing) return;
    if ((event.ctrlKey || event.metaKey) && !event.altKey) {
      const key = event.key.toLowerCase();
      let format: EditorFormat | undefined;
      if (!event.shiftKey) format = formatKeys[key];
      if (event.shiftKey && key === 'x') format = 'strike';
      if (format) { event.preventDefault(); event.stopPropagation(); formatSelection(format); return; }
    }
    if (event.altKey && !event.ctrlKey && !event.metaKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault(); event.stopPropagation();
      applyReplacement(moveEditorLines(value, { start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd }, event.key === 'ArrowUp' ? -1 : 1));
      return;
    }
    if (!active || !position || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setDismissed(true);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      if (options.length) setSelected((selectedIndex + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length);
    } else if ((event.key === 'Enter' || (event.key === 'Tab' && !event.shiftKey)) && options[selectedIndex]) {
      event.preventDefault();
      event.stopPropagation();
      insert(options[selectedIndex]);
    }
  }

  const visible = active && position !== null;
  const labels = { card: t.cards, member: t.members, command: t.commands, tag: t.projectTags, emoji: 'Emoji', media: t.media };
  const label = trigger ? labels[trigger.kind] : t.commands;
  return <>
    <textarea ref={textareaRef} className={'card-edit-text' + (dragging ? ' is-dragging-media' : '')} aria-label={textLabel ?? t.defaultLabel} autoFocus spellCheck={false}
      value={value} maxLength={maxLength} disabled={disabled} readOnly={Boolean(mediaRequest)} aria-autocomplete="list" aria-haspopup="listbox"
      aria-expanded={visible} aria-controls={visible ? menuId : undefined}
      aria-activedescendant={visible && options.length ? `${menuId}-${selectedIndex}` : undefined}
      onChange={event => { setDismissed(false); readSelection(event.currentTarget); onChange(event.currentTarget.value); }}
      onPaste={event => {
        if (mediaRequest) { event.preventDefault(); return; }
        const files = Array.from(event.clipboardData.files);
        if (files.some(file => /^(?:image|video)\//u.test(file.type))) { event.preventDefault(); requestMedia(files); return; }
        const link = editorPastedCardLink(event.clipboardData.getData('text/plain'), catalog);
        if (link) { event.preventDefault(); applyReplacement({ value: value.slice(0, selection.start) + link + value.slice(selection.end), start: selection.start + link.length, end: selection.start + link.length }); }
      }}
      onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDragging(true); event.dataTransfer.dropEffect = 'copy'; } }}
      onDragLeave={() => setDragging(false)}
      onDrop={event => { if (event.dataTransfer.files.length) { event.preventDefault(); setDragging(false); requestMedia(Array.from(event.dataTransfer.files)); } }}
      onSelect={event => readSelection(event.currentTarget)} onKeyDown={handleKeyDown}
      onFocus={event => { setFocused(true); readSelection(event.currentTarget); }} onBlur={event => {
        if (event.relatedTarget instanceof Element && event.relatedTarget.closest('.editor-format-toolbar')) return;
        setFocused(false); setDismissed(false);
      }} />
    {mediaRequest && <EditorMediaInsert files={mediaRequest.files} disabled={disabled}
      onCancel={() => { setMediaRequest(null); textareaRef.current?.focus(); }}
      onInsert={markdown => {
        applyReplacement({ value: value.slice(0, mediaRequest.start) + markdown + value.slice(mediaRequest.end), start: mediaRequest.start + markdown.length, end: mediaRequest.start + markdown.length });
        setMediaRequest(null);
      }} />}
    {formatting && position && createPortal(<div className="editor-format-toolbar" role="toolbar" aria-label={t.formatSelection}
      style={{ left: position.left, top: position.top, bottom: position.bottom }} onPointerDown={event => event.preventDefault()}>
      {formats.map(({ id, label: formatLabel, shortcut, Icon }) => <button key={id} type="button" title={`${t[formatLabel]} · ${shortcut}`} aria-label={t[formatLabel]} onClick={() => formatSelection(id)}><Icon size={16} /></button>)}
    </div>, document.body)}
    {visible && createPortal(<div ref={menuRef} className="editor-command-menu" style={position} onPointerDown={event => event.preventDefault()}>
      <div className="editor-command-heading">{label}<span>{options.length}</span></div>
      <div id={menuId} role="listbox" aria-label={label} className="editor-command-options">
        {options.map((option, index) => {
          const Icon = option.cardKind ? cardIcons[option.cardKind] : commandIcons[option.icon];
          const isTag = trigger?.kind === 'tag';
          const tagDefinition = isTag ? catalog.projectTags?.find(tag => tag.name === option.id) : undefined;
          const detail = isTag && !tagDefinition ? t.personalTag : option.detail;
          return <button type="button" role="option" tabIndex={-1} id={`${menuId}-${index}`} key={option.id} aria-selected={index === selectedIndex}
            className="editor-command-option" title={`${option.label} · ${detail}`} onPointerMove={() => setSelected(index)} onClick={() => insert(option)}>
            {!isTag && (option.memberId ? <CardOwnerAvatar owner={option.label} members={catalog.members ?? []} /> : <Icon size={16} aria-hidden="true" />)}
            {option.emoji && <span className="editor-command-emoji" aria-hidden="true">{option.emoji}</span>}
            <span className="editor-command-label">{isTag ? <TagBadge name={option.id} definition={tagDefinition} /> : option.label}</span>
            <span className={option.cardKind ? 'editor-command-deck' : 'editor-command-detail'}>{detail}</span>
          </button>;
        })}
        {!options.length && <p className="editor-command-empty" role="status">{trigger?.kind === 'tag' ? t.newTag : t.noMatches}</p>}
        {trigger?.kind === 'media' && !options.length && <p className="editor-command-empty">{t.noMedia}</p>}
      </div>
      <div className="editor-command-footer"><span>{t.choose}</span><span>{t.insert}</span><span>{t.close}</span></div>
    </div>, document.body)}
  </>;
}
