import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { ImageOff } from 'lucide-react';
import type { Root, RootContent, PhrasingContent } from 'mdast';
import type { DataSource } from '../../src/workspace-contracts.ts';
import type { CatalogCard, CatalogMember } from '../../src/catalog-contracts.ts';
import type { ProjectTag } from '../../src/project-tags.ts';
import { shortReference } from '../../src/references.ts';
import { editorMentionNames, splitEditorMentions } from '../editor-mentions.ts';
import { editorChecklistItems } from '../editor-checklists.ts';
import { splitMarkdownTags } from '../markdown-tags.ts';
import { CardOwnerAvatar } from './CardQuickSettings.tsx';
import { TagBadge } from './CardTags.tsx';
import { defineText, useText } from '../i18n.ts';
import { stateLabel } from '../locales/common.ts';

const text = defineText({
  missingCard: 'Card not found',
  missingCardInline: (label: string) => `${label} — card not found`,
  unavailableImage: 'Image: unavailable link',
  missingImage: 'File not found: it was deleted or moved',
  missingImageInline: (name: string) => name ? `${name} — file not found` : 'Image — file not found',
  item: 'item',
  human: 'Human',
  agent: 'Agent',
  uncheck: (label: string) => `Uncheck: ${label}`,
  check: (label: string) => `Complete: ${label}`,
  checklist: (done: number, total: number) => `Checklist: ${done} of ${total}`,
  completed: (done: number, total: number) => `${done}/${total} completed`,
  table: 'Table',
}, {
  missingCard: 'Карточка не найдена',
  missingCardInline: (label: string) => `${label} — карточка не найдена`,
  unavailableImage: 'Изображение: недоступная ссылка',
  missingImage: 'Файл не найден: его удалили или перенесли',
  missingImageInline: (name: string) => name ? `${name} — файл не найден` : 'Изображение — файл не найден',
  item: 'пункт',
  human: 'Человек',
  agent: 'Агент',
  uncheck: (label: string) => `Снять отметку: ${label}`,
  check: (label: string) => `Выполнить: ${label}`,
  checklist: (done: number, total: number) => `Чеклист: ${done} из ${total}`,
  completed: (done: number, total: number) => `${done}/${total} выполнено`,
  table: 'Таблица',
});

/** Short card ref of a safe in-app link of the shown source; links to the other source stay plain links. */
function cardReferenceOf(href: string, source: DataSource): string | undefined {
  const match = /^\/r\/(c-[a-z0-9]{10})\?source=(sandbox|live)(?:#|$)/u.exec(href);
  return match && match[2] === source ? match[1] : undefined;
}

/**
 * The reference chip shows the card's live catalog title instead of stored link text; clicking opens the card.
 * Display its short reference with a "$" prefix and without "c-".
 */
function CardReferenceChip({ reference, card, href, onOpenCard }: {
  reference: string; card: CatalogCard | undefined; href: string; onOpenCard?: (card: CatalogCard) => void;
}) {
  const label = '$' + reference.slice(2);
  const t = useText(text);
  if (!card || card.deleted) return <span className="card-reference-chip is-missing" title={t.missingCard}>{t.missingCardInline(label)}</span>;
  const target = card;
  function open(event: MouseEvent<HTMLAnchorElement>) {
    // A modified click keeps the browser's new-tab behavior of the /r/ link.
    if (!onOpenCard || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onOpenCard(target);
  }
  return <a className="card-reference-chip" href={href} target={onOpenCard ? undefined : '_blank'} rel="noreferrer"
    title={target.state ? `${target.title} · ${stateLabel(target.state)}` : target.title} onClick={open}>
    <span className="card-reference-chip-id">{label}</span> <span>{target.title}</span>
  </a>;
}

/** An image whose file is gone (a deleted attachment, a moved file) shows a quiet chip instead of the broken-image icon. */
function MarkdownImage({ src, alt }: { src: string; alt: string }) {
  const t = useText(text);
  const [failedSrc, setFailedSrc] = useState<string>();
  if (failedSrc === src) return <span className="card-reference-chip is-missing is-image" title={t.missingImage}><ImageOff size={12} aria-hidden="true" /><span>{t.missingImageInline(alt)}</span></span>;
  // No lazy loading: a lazy image that never intersects (0×0 while unloaded) never fires `error`, and the chip would not appear.
  return <img src={src} alt={alt} onError={() => setFailedSrc(src)} />;
}

function referenceLink(url: URL, source: DataSource): string | undefined {
  if (!/^\/r\/[cpv]-[a-z0-9]{10}$/u.test(url.pathname)) return undefined;
  const requestedSource = url.searchParams.get('source');
  if (requestedSource !== null && requestedSource !== 'sandbox' && requestedSource !== 'live') return undefined;
  const query = new URLSearchParams({ source: requestedSource ?? source });
  return url.pathname + '?' + query.toString() + url.hash;
}

function safeLink(url: string, source: DataSource, path: string): string | undefined {
  const value = url.trim().replaceAll('\\', '/');
  if (!value || /[\u0000-\u001f\u007f]/u.test(value)) return undefined;
  if (value.startsWith('#')) return value;
  try {
    if (/^https?:\/\//iu.test(value)) {
      const absolute = new URL(value);
      if (typeof window !== 'undefined' && absolute.origin === window.location.origin && absolute.pathname.startsWith('/r/')) {
        return referenceLink(absolute, source);
      }
      return absolute.href;
    }
    if (/^[a-z][a-z\d+.-]*:/iu.test(value) || value.startsWith('//')) return undefined;
    const base = `https://deckmate.local/${path.split('/').map(encodeURIComponent).join('/')}`;
    const normalized = new URL(value, base);
    if (normalized.origin !== 'https://deckmate.local') return undefined;
    if (normalized.pathname.startsWith('/r/')) return referenceLink(normalized, source);
    const relativePath = decodeURIComponent(normalized.pathname.slice(1));
    if (/[\u0000-\u001f\u007f]/u.test(relativePath)) return undefined;
    return `/api/file?source=${source}&path=${encodeURIComponent(relativePath)}${normalized.hash}`;
  } catch {
    return undefined;
  }
}

export function Markdown({ tree, source, path = 'features/match.md', onTaskToggle, taskToggleDisabled = false, members = [], showChecklistCount = false, cards, onOpenCard, projectTags = [], rawMarkdown }: {
  tree: Root; source: DataSource; path?: string;
  members?: CatalogMember[];
  projectTags?: readonly ProjectTag[];
  rawMarkdown?: string;
  showChecklistCount?: boolean;
  onTaskToggle?: (itemOffset: number, checked: boolean) => void;
  taskToggleDisabled?: boolean;
  /** Catalog cards of `source`: card links become reference chips. Without them card links stay plain links. */
  cards?: readonly CatalogCard[];
  onOpenCard?: (card: CatalogCard) => void;
}) {
  const t = useText(text);
  const textToggle = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(textToggle.current), []);
  const mentionNames = useMemo(() => editorMentionNames(members), [members]);
  const projectTagsByName = useMemo(() => new Map(projectTags.map(tag => [tag.name, tag])), [projectTags]);
  // Built on the first card link only: most texts have none, and hashing every card id costs milliseconds.
  const findCard = useMemo(() => {
    if (!cards) return undefined;
    let byReference: Map<string, CatalogCard> | undefined;
    return (reference: string) => {
      byReference ??= new Map(cards.map(card => [shortReference('c', card.id), card]));
      return byReference.get(reference);
    };
  }, [cards]);
  const checklist = useMemo(() => showChecklistCount ? editorChecklistItems(tree) : [], [tree, showChecklistCount]);
  const definitions = new Map(tree.children.filter(node => node.type === 'definition').map(node => [node.identifier.toLowerCase(), node]));
  function plainText(node: RootContent | PhrasingContent): string {
    if ('value' in node) return node.value;
    return 'children' in node ? node.children.map(child => plainText(child as RootContent)).join('') : '';
  }
  function link(url: string, children: ReactNode, key: number | string): ReactNode {
    const href = safeLink(url, source, path);
    if (!href) return <span key={key}>{children}</span>;
    const reference = findCard && cardReferenceOf(href, source);
    if (findCard && reference) return <CardReferenceChip key={key} reference={reference} card={findCard(reference)} href={href} onOpenCard={onOpenCard} />;
    return <a key={key} href={href} target={href.startsWith('#') ? undefined : '_blank'} rel="noreferrer">{children}</a>;
  }
  function image(url: string, alt: string, key: number | string): ReactNode {
    const src = safeLink(url, source, path);
    return src ? <MarkdownImage key={key} src={src} alt={alt} /> : <span key={key}>{alt || t.unavailableImage}</span>;
  }
  function renderText(value: string, key: number | string, rawValue?: string): ReactNode {
    return splitMarkdownTags(value, rawValue).map((part, partIndex) => {
      const partKey = `${key}-${partIndex}`;
      if (typeof part !== 'string') return <TagBadge key={partKey} name={part.name} definition={projectTagsByName.get(part.name)} />;
      return splitEditorMentions(part, mentionNames).map((mention, mentionIndex) => typeof mention === 'string' ? mention
        : <span key={`${partKey}-${mentionIndex}`} className="editor-member-mention" title={`${mention.label} · ${mention.kind === 'human' ? t.human : t.agent}`}><CardOwnerAvatar owner={mention.label} members={members} />@{mention.label}</span>);
    });
  }
  function render(node: RootContent | PhrasingContent, key: number | string, mentions = true): ReactNode {
    const childMentions = mentions && node.type !== 'link' && node.type !== 'linkReference';
    const children = 'children' in node && node.type !== 'table' ? node.children.map((child, index) => render(child as RootContent, index, childMentions)) : null;
    switch (node.type) {
      case 'text': return mentions ? renderText(node.value, key, node.position?.start.offset === undefined ? undefined
        : rawMarkdown?.slice(node.position.start.offset, node.position.end.offset)) : node.value;
      case 'paragraph': return <p key={key}>{children}</p>;
      case 'strong': return <strong key={key}>{children}</strong>;
      case 'emphasis': return <em key={key}>{children}</em>;
      case 'delete': return <del key={key}>{children}</del>;
      case 'inlineCode': return <code key={key}>{node.value}</code>;
      case 'code': return <pre key={key}><code>{node.value}</code></pre>;
      case 'break': return <br key={key} />;
      case 'thematicBreak': return <hr key={key} />;
      case 'heading': {
        const Tag = `h${node.depth}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
        return <Tag key={key}>{children}</Tag>;
      }
      case 'link': return link(node.url, children, key);
      case 'image': return image(node.url, node.alt ?? '', key);
      case 'linkReference': {
        const definition = definitions.get(node.identifier.toLowerCase());
        return definition ? link(definition.url, children, key) : <span key={key}>{children}</span>;
      }
      case 'imageReference': {
        const definition = definitions.get(node.identifier.toLowerCase());
        return definition ? image(definition.url, node.alt ?? '', key) : <span key={key}>{node.alt}</span>;
      }
      case 'definition': return null;
      case 'blockquote': return <blockquote key={key}>{children}</blockquote>;
      case 'list': return node.ordered ? <ol key={key} start={node.start ?? undefined}>{children}</ol> : <ul key={key}>{children}</ul>;
      case 'listItem': {
        const task = typeof node.checked === 'boolean';
        const offset = node.position?.start.offset;
        const editable = onTaskToggle !== undefined && offset !== undefined;
        const label = node.children[0] ? plainText(node.children[0]) : t.item;
        // The item's own text toggles it too; links, code, nested lists and text selection keep their meaning.
        const toggleFromText = task && editable && !taskToggleDisabled ? (event: MouseEvent<HTMLLIElement>) => {
          const target = event.target as Element;
          const block = target.closest('li > *');
          if (!block || block.parentElement !== event.currentTarget || block.tagName !== 'P') return;
          window.clearTimeout(textToggle.current);
          if (event.detail > 1 || target.closest('a, button, input, code')) return;
          // Wait out a possible second click: double-clicking a word selects it and must not write the file.
          textToggle.current = window.setTimeout(() => {
            if (!window.getSelection()?.toString()) onTaskToggle(offset, !node.checked);
          }, 250);
        } : undefined;
        return <li key={key} className={task ? 'check-item' + (toggleFromText ? ' is-toggleable' : '') : undefined} onClick={toggleFromText}>
          {task && <input type="checkbox" checked={node.checked ?? false} readOnly={!editable}
            disabled={!editable || taskToggleDisabled} aria-label={(node.checked ? t.uncheck(label) : t.check(label))}
            onChange={editable ? event => onTaskToggle(offset, event.target.checked) : undefined} />}{children}</li>;
      }
      case 'table': {
        const rows = node.children.map((row, rowIndex) => <tr key={rowIndex}>{row.children.map((cell, columnIndex) => {
          const Cell = rowIndex === 0 ? 'th' : 'td';
          return <Cell key={columnIndex} scope={rowIndex === 0 ? 'col' : undefined} style={{ textAlign: node.align?.[columnIndex] ?? undefined }}>
            {cell.children.map((child, index) => render(child, index, mentions))}
          </Cell>;
        })}</tr>);
        return <div className="table-scroll" key={key} tabIndex={0} role="region" aria-label={t.table}>
          <table><thead>{rows[0]}</thead><tbody>{rows.slice(1)}</tbody></table>
        </div>;
      }
      case 'html': return <code key={key}>{node.value}</code>;
      default: return children;
    }
  }
  return <div className="markdown">{checklist.length > 0 && <div className="editor-checklist-count" role="status" aria-label={t.checklist(checklist.filter(item => item.checked).length, checklist.length)}>
    {t.completed(checklist.filter(item => item.checked).length, checklist.length)}
  </div>}{tree.children.map((node, index) => render(node, index))}</div>;
}
