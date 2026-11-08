import type { CardKind, CatalogView } from '../src/catalog-contracts.ts';
import { shortReference } from '../src/references.ts';
import { collectProjectTags } from '../src/project-tags.ts';
import { editorEmojis } from './editor-emoji.ts';
import { defineText, textNow } from './i18n.ts';
import { markdownParser } from '../src/markdown-model.ts';
import type { RootContent } from 'mdast';

export interface EditorTrigger {
  kind: 'command' | 'card' | 'member' | 'tag' | 'emoji' | 'media';
  start: number;
  end: number;
  query: string;
}

export interface EditorCommand {
  id: string;
  label: string;
  detail: string;
  icon: string;
  keywords?: string;
  insert: string;
  selection?: [number, number];
  cardKind?: CardKind;
  memberId?: string;
  emoji?: string;
}

const text = defineText({
  bulletDetail: '- item',
  numberedDetail: '1. item',
  quoteDetail: '> quote',
  tableDetail: '2 columns · 2 rows',
  linkDetail: '[text](url)',
  linkLabel: 'text',
  mentionDetail: '@name',
  tagDetail: '#tag',
  projectTag: 'Project tag',
  noDeck: 'No deck',
  image: 'Image',
  video: 'Video',
  heading1: 'Heading 1', heading2: 'Heading 2', heading3: 'Heading 3', bullet: 'Bulleted list', numbered: 'Numbered list',
  checkbox: 'Checkbox', quote: 'Quote', code: 'Code block', divider: 'Divider', table: 'Table 2×2', link: 'Link',
  mention: 'Mention member', tag: 'Tag', emoji: 'Emoji', media: 'Image or video', human: 'Human', agent: 'Agent',
}, {
  bulletDetail: '- пункт',
  numberedDetail: '1. пункт',
  quoteDetail: '> цитата',
  tableDetail: '2 столбца · 2 строки',
  linkDetail: '[текст](url)',
  linkLabel: 'текст',
  mentionDetail: '@имя',
  tagDetail: '#тег',
  projectTag: 'Тег проекта',
  noDeck: 'Без колоды',
  image: 'Изображение',
  video: 'Видео',
  heading1: 'Заголовок 1', heading2: 'Заголовок 2', heading3: 'Заголовок 3', bullet: 'Маркированный список', numbered: 'Нумерованный список',
  checkbox: 'Флажок', quote: 'Цитата', code: 'Блок кода', divider: 'Разделитель', table: 'Таблица 2×2', link: 'Ссылка',
  mention: 'Упомянуть участника', tag: 'Тег', emoji: 'Эмодзи', media: 'Изображение или видео', human: 'Человек', agent: 'Агент',
});

function commands(): EditorCommand[] {
  const t = textNow(text);
  return [
    { id: 'heading-1', label: t.heading1, detail: '#', icon: 'heading-1', keywords: 'heading 1 h1 заголовок', insert: '# ' },
    { id: 'heading-2', label: t.heading2, detail: '##', icon: 'heading-2', keywords: 'heading 2 h2 заголовок', insert: '## ' },
    { id: 'heading-3', label: t.heading3, detail: '###', icon: 'heading-3', keywords: 'heading 3 h3 заголовок', insert: '### ' },
    { id: 'bullet-list', label: t.bullet, detail: t.bulletDetail, icon: 'bullet-list', keywords: 'bulleted list ul список точки', insert: '- ' },
    { id: 'numbered-list', label: t.numbered, detail: t.numberedDetail, icon: 'numbered-list', keywords: 'numbered list ol список номера', insert: '1. ' },
    { id: 'checkbox', label: t.checkbox, detail: '- [ ]', icon: 'checkbox', keywords: 'checkbox todo task чекбокс задача', insert: '- [ ] ' },
    { id: 'quote', label: t.quote, detail: t.quoteDetail, icon: 'quote', keywords: 'quote blockquote цитата', insert: '> ' },
    { id: 'code', label: t.code, detail: '```', icon: 'code', keywords: 'code block код блок', insert: '```\n\n```', selection: [4, 4] },
    { id: 'divider', label: t.divider, detail: '---', icon: 'divider', keywords: 'divider hr разделитель', insert: '---\n' },
    { id: 'table', label: t.table, detail: t.tableDetail, icon: 'table', keywords: 'table 2×2 таблица', insert: '| A | B |\n| --- | --- |\n|   |   |\n|   |   |', selection: [2, 3] },
    { id: 'link', label: t.link, detail: t.linkDetail, icon: 'link', keywords: 'link url ссылка', insert: `[${t.linkLabel}](https://)`, selection: [1, t.linkLabel.length + 1] },
    { id: 'mention', label: t.mention, detail: t.mentionDetail, icon: 'member', keywords: 'mention member упоминание участник', insert: '@' },
    { id: 'tag', label: t.tag, detail: t.tagDetail, icon: 'tag', keywords: 'tag тег метка', insert: '#' },
    { id: 'emoji', label: t.emoji, detail: ':', icon: 'emoji', keywords: 'emoji эмодзи смайлик', insert: ':' },
    { id: 'media', label: t.media, detail: '!', icon: 'media', keywords: 'image or video картинка видео изображение', insert: '!' },
  ];
}

export function getEditorTrigger(value: string, start: number, end: number): EditorTrigger | null {
  if (start !== end) return null;
  const prefix = value.slice(0, start);
  const member = /(?:^|\s)(\/mention[ \t]([^\n/$]*))$/iu.exec(prefix);
  if (member) return { kind: 'member', start: start - member[1].length, end, query: member[2] };
  const match = /(?:^|[\s(])([/$@#:!])([^\s/$@#:!]*)$/u.exec(prefix);
  if (!match) return null;
  const kinds = { '/': 'command', '$': 'card', '@': 'member', '#': 'tag', ':': 'emoji', '!': 'media' } as const;
  return { kind: kinds[match[1] as keyof typeof kinds], start: start - match[2].length - 1, end, query: match[2] };
}

function matchesQuery(text: string, query: string): boolean {
  const normalized = text.toLocaleLowerCase();
  return query.toLocaleLowerCase().split(/[\s_]+/u).every(word => normalized.includes(word));
}

function escapeLinkLabel(title: string): string {
  return title.replace(/([\\`*_[\]<>])/gu, '\\$1').replace(/[\r\n]+/gu, ' ');
}

export function getEditorOptions(trigger: EditorTrigger, catalog: CatalogView, markdown = ''): EditorCommand[] {
  const t = textNow(text);
  if (trigger.kind === 'command') return commands().filter(command => matchesQuery(`${command.label} ${command.keywords}`, trigger.query));
  if (trigger.kind === 'member') return (catalog.members ?? [])
    .filter(member => matchesQuery(`${member.label} ${member.id} ${member.aliases.join(' ')}`, trigger.query))
    .map(member => ({ id: member.id, memberId: member.id, label: member.label, detail: member.kind === 'human' ? t.human : t.agent, icon: 'member', insert: `@${member.label} ` }));
  if (trigger.kind === 'tag') return collectProjectTags(catalog.cards, catalog.projectTags)
    .filter(tag => !/\s/u.test(tag.name) && matchesQuery(tag.name, trigger.query))
    .map(tag => ({ id: tag.name, label: `#${tag.name}`, detail: t.projectTag, icon: 'tag', insert: `#${tag.name} ` }));
  if (trigger.kind === 'emoji') return editorEmojis.filter(entry => matchesQuery(`${entry.name} ${entry.keywords}`, trigger.query))
    .map(entry => ({ id: entry.name, label: `:${entry.name}:`, detail: '', icon: 'emoji', emoji: entry.emoji, insert: entry.emoji }));
  if (trigger.kind === 'media') return editorMediaOptions(markdown, t).filter(option => matchesQuery(`${option.label} ${option.detail}`, trigger.query));
  const decks = new Map(catalog.decks.map(deck => [deck.id, deck.title]));
  return catalog.cards.filter(card => !card.archived && !card.deleted && matchesQuery(card.title, trigger.query))
    .map(card => ({ id: card.id, label: card.title, detail: decks.get(card.deckId ?? '') ?? t.noDeck, icon: 'card', cardKind: card.kind,
      insert: `[${escapeLinkLabel(card.title)}](/r/${shortReference('c', card.id)})` }));
}

function editorMediaOptions(markdown: string, t: (typeof text)['en']): EditorCommand[] {
  const media = new Map<string, EditorCommand>();
  function visit(nodes: RootContent[]) {
    for (const node of nodes) {
      if (node.type === 'image' || (node.type === 'link' && /\.(?:mp4|webm|ogg)(?:[?#]|$)/iu.test(node.url))) {
        const label = node.type === 'image' ? node.alt || node.url.split('/').pop() || t.image : node.url.split('/').pop() || t.video;
        const insert = `${node.type === 'image' ? '!' : ''}[${escapeLinkLabel(label)}](<${node.url.replace(/>/gu, '%3E')}>)`;
        media.set(node.url, { id: node.url, label, detail: node.type === 'image' ? t.image : t.video, icon: 'media', insert });
      }
      if ('children' in node) visit(node.children as RootContent[]);
    }
  }
  visit(markdownParser.parse(markdown).children);
  return [...media.values()];
}

export function editorPastedCardLink(text: string, catalog: CatalogView): string | null {
  try {
    const url = new URL(text.trim(), window.location.origin);
    if (url.origin !== window.location.origin || !/^\/r\/c-[a-z0-9]{10}$/u.test(url.pathname)) return null;
    const card = catalog.cards.find(candidate => `/r/${shortReference('c', candidate.id)}` === url.pathname);
    if (!card) return null;
    return `[${escapeLinkLabel(card.title)}](${url.pathname}${url.search})`;
  } catch { return null; }
}

export function insertEditorCommand(value: string, trigger: EditorTrigger, command: EditorCommand) {
  const selection = command.selection ?? [command.insert.length, command.insert.length];
  return {
    value: value.slice(0, trigger.start) + command.insert + value.slice(trigger.end),
    start: trigger.start + selection[0],
    end: trigger.start + selection[1],
  };
}

// 2026-11-04: measuring text in a mirror preserves textarea wrapping, tabs and the current font metrics.
export function measureEditorCaret(textarea: HTMLTextAreaElement) {
  const computed = getComputedStyle(textarea);
  const mirror = document.createElement('div');
  const properties = ['font-family', 'font-size', 'font-weight', 'font-style', 'font-variant', 'font-stretch', 'line-height',
    'letter-spacing', 'word-spacing', 'text-indent', 'text-align', 'text-transform', 'tab-size', 'direction',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width'];
  for (const property of properties) mirror.style.setProperty(property, computed.getPropertyValue(property));
  Object.assign(mirror.style, { position: 'fixed', visibility: 'hidden', pointerEvents: 'none', top: '0', left: '0',
    boxSizing: 'border-box', borderStyle: 'solid', whiteSpace: 'pre-wrap', overflowWrap: 'break-word',
    width: `${textarea.clientWidth + parseFloat(computed.borderLeftWidth) + parseFloat(computed.borderRightWidth)}px` });
  mirror.setAttribute('aria-hidden', 'true');
  mirror.textContent = textarea.value.slice(0, textarea.selectionStart);
  const marker = document.createElement('span');
  marker.textContent = textarea.value.slice(textarea.selectionStart) || '\u200b';
  mirror.append(marker);
  document.body.append(mirror);
  const markerBox = marker.getClientRects()[0];
  const textareaBox = textarea.getBoundingClientRect();
  const lineHeight = parseFloat(computed.lineHeight) || parseFloat(computed.fontSize) * 1.2;
  const caret = { left: textareaBox.left + markerBox.left - textarea.scrollLeft,
    top: textareaBox.top + markerBox.top - textarea.scrollTop, height: lineHeight };
  mirror.remove();
  return caret;
}
