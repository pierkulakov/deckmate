// Card tile shared by the deck grid and the hand (moved out of Deck.tsx on 2026-11-04: one tile, not two copies).
import { createContext, memo, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent, RefObject } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { Check, CircleHelp, Crown, Eye, Gauge, GripVertical, Hourglass, Layers, ListChecks, NotebookText, Paperclip, Play, Archive } from 'lucide-react';
import type { CardKind, CatalogCard, CatalogMember, CatalogView } from '../../src/catalog-contracts.ts';
import { countCatalogCardWords } from '../card-word-count.ts';
import { catalogDocExcerpt, type DocExcerptBlock } from '../doc-excerpt.ts';
import { sameCardTileData, type CardTileCatalog, type CardTileLookups } from '../card-tile-equality.ts';
import { familyChildren } from '../catalog-lookups.ts';
import { HOVER_CARD_SHORTCUTS, markShortcutPropertyHover, matchShortcut, shortcutTargetBlocked } from '../keyboard-shortcuts.ts';
import { attachmentSource, fetchCardAttachments } from '../attachments.ts';
import { subscribeCardAttachments } from '../card-attachment-events.ts';
import { CardIndicators } from './CardIndicators.tsx';
import { statusClass } from './StatusMenu.tsx';
import { CardFamilyPopover, SubCardProgress } from './CardFamily.tsx';
import { useJustFinished } from '../done-impact.ts';
import { heroCountedTasks, heroFinished } from '../../src/hero-done.ts';
import { useCardTilt } from '../useCardTilt.ts';
import { cardHeroEffort } from './CardPropertiesPanel.tsx';
import { CardOwnerAvatar, type CardQuickSettingsTab } from './CardQuickSettings.tsx';
import { ownerProgressLabel } from './CardOwnerAvatar.tsx';
import { TagColorIndicator, TagTitlePrefix } from './CardTags.tsx';
import { defineText, formatNumber, textNow, useLang, useText } from '../i18n.ts';
import { kindLabel, priorityLabel, stateLabel } from '../locales/common.ts';

const text = defineText({
  docCard: 'Doc Card',
  transferCard: (title: string) => 'Move to deck: ' + title,
  transferHint: 'Move to deck · Space and arrow keys',
  transferLimit: 'You can move up to 1,000 selected cards',
  openQuestions: (count: string) => 'Open questions: ' + count,
  attachments: (count: string) => 'Attachments: ' + count,
  open: 'Open',
  deselect: 'Deselect',
  select: 'Select',
  selectCard: (title: string) => 'Select: ' + title,
  totalEffort: (effort: string) => 'Effort: own and Sub Cards — ' + effort,
  archived: 'Archived',
  effort: (effort: string) => 'Effort: ' + effort,
  priority: (priority: string) => 'Priority: ' + priority,
  noPriority: 'No priority',
  noSubCards: 'No Sub Cards',
  wordCount: (count: string) => 'Word count: ' + count,
  docWords: (count: string) => count + 'w',
  tags: (names: string) => 'tags: ' + names,
  familyDone: 'Hero done: all Sub Cards accepted',
  heroDone: 'Hero done',
}, {
  docCard: 'Doc Card',
  transferCard: (title: string) => 'Перенести в колоду: ' + title,
  transferHint: 'Перенести в колоду · Пробел и стрелки',
  transferLimit: 'Можно перенести до 1000 выбранных карточек',
  openQuestions: (count: string) => 'Открытых вопросов: ' + count,
  attachments: (count: string) => 'Вложения: ' + count,
  open: 'Открыть',
  deselect: 'Снять выбор',
  select: 'Выбрать',
  selectCard: (title: string) => 'Выбрать: ' + title,
  totalEffort: (effort: string) => 'Оценка: своя и Sub Cards — ' + effort,
  archived: 'В архиве',
  effort: (effort: string) => 'Оценка: ' + effort,
  priority: (priority: string) => 'Приоритет: ' + priority,
  noPriority: 'Без приоритета',
  noSubCards: 'Без Sub Cards',
  wordCount: (count: string) => 'Число слов: ' + count,
  docWords: (count: string) => count + ' сл.',
  tags: (names: string) => 'теги: ' + names,
  familyDone: 'Hero выполнена: все Sub Cards приняты',
  heroDone: 'Hero выполнена',
});

export const cardKinds: Record<CardKind, string> = {
  get task() { return kindLabel('task'); },
  get hero() { return kindLabel('hero'); },
  get doc() { return textNow(text).docCard; },
};
// 2026-11-09: Doc is a notebook; a plain file icon stays for files.
export const cardIcons = { task: ListChecks, hero: Crown, doc: NotebookText };
export const taskStateIcons: Record<string, typeof Hourglass> = { done: Check, started: Play, review: Eye };
export const emptyCards: CatalogCard[] = [];
const emptyExcerpt: DocExcerptBlock[] = [];

// 2026-11-10: Deck.tsx still provides indexedAt; keep its export until that caller can remove the unused provider.
export const CardAttachmentRefreshContext = createContext<string | undefined>(undefined);

export const CardTransferContext = createContext<{ available: boolean; enabled: boolean; active: boolean; canDrag: (cardId: string) => boolean; sourceIds?: ReadonlySet<string> }>({
  available: false, enabled: false, active: false, canDrag: () => false,
});

export function useCardTransferDrag(card: CatalogCard) {
  const t = useText(text);
  const context = useContext(CardTransferContext);
  const enabled = context.enabled && context.canDrag(card.id);
  const drag = useDraggable({ id: 'card-transfer:' + card.id, disabled: !enabled, data: { kind: 'card-transfer', cardId: card.id } });
  function onPointerDown(event: PointerEvent<HTMLElement>) {
    if (!enabled || event.defaultPrevented) return;
    const target = event.target as Element;
    if (target.closest('.card-tags')) return;
    const control = target.closest('button, a, input, select, textarea, [role="button"], [contenteditable]:not([contenteditable="false"])');
    // 2026-11-04: the open button is the card face; other controls retain their own actions.
    if (control && !control.matches('.deck-card-open, .catalog-table-title, .card-transfer-handle')) return;
    drag.listeners?.onPointerDown?.(event);
  }
  const handle = context.enabled ? <button type="button" ref={drag.setActivatorNodeRef} {...drag.attributes}
    className="card-transfer-handle" aria-label={t.transferCard(card.title)}
    aria-disabled={!enabled} tabIndex={enabled ? 0 : -1}
    title={enabled ? t.transferHint : t.transferLimit}
    onKeyDown={event => { if (enabled) drag.listeners?.onKeyDown?.(event); }}><GripVertical size={14} /></button> : null;
  return { ...drag, isDragging: drag.isDragging || Boolean(context.sourceIds?.has(card.id)), enabled, anyDragging: context.active, onPointerDown, handle };
}

/** Rule Doc question count from its open-questions section, shared by tiles and table rows. */
export function OpenQuestionsBadge({ card }: { card: CatalogCard }) {
  const t = useText(text);
  const lang = useLang();
  const count = card.kind === 'doc' ? card.openQuestions?.length ?? 0 : 0;
  if (!count) return null;
  const warnings = card.openQuestionWarnings ?? [];
  const formattedCount = formatNumber(count, 3, lang);
  const title = t.openQuestions(formattedCount) + (warnings.length ? '. ' + warnings.join(' ') : '');
  return <span className={'catalog-card-open-questions' + (warnings.length ? ' has-warning' : '')} title={title} aria-label={title}><CircleHelp size={12} strokeWidth={2.4} aria-hidden="true" />{formattedCount}</span>;
}

function useAttachmentCount(cardId: string, tile: RefObject<HTMLElement | null>) {
  const [count, setCount] = useState(0);
  const [nearViewport, setNearViewport] = useState(false);
  const source = attachmentSource();
  useEffect(() => {
    const element = tile.current;
    if (!element) return;
    if (!('IntersectionObserver' in window)) { setNearViewport(true); return; }
    // 2026-11-05: refresh only near the viewport; returning to a tile fetches its latest attachments.
    const observer = new IntersectionObserver(entries => {
      setNearViewport(entries.some(entry => entry.isIntersecting));
    }, { rootMargin: '300px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, [cardId, tile]);
  useEffect(() => { setCount(0); }, [cardId, source]);
  useEffect(() => {
    if (!nearViewport) return;
    let active = true;
    let epoch = 0;
    const refresh = () => {
      const request = ++epoch;
      void fetchCardAttachments(source, cardId)
        .then(attachments => { if (active && request === epoch) setCount(attachments.files.length); })
        // 2026-11-10: a failed refresh is not confirmation that the card has no attachments.
        .catch(() => undefined);
    };
    const unsubscribe = subscribeCardAttachments(source, cardId, refresh);
    refresh();
    return () => { active = false; unsubscribe(); };
  }, [cardId, source, nearViewport]);
  return count;
}

interface CatalogCardTileProps {
  card: CatalogCard;
  lookups: CardTileLookups;
  members: CatalogMember[];
  tagDefinitions?: CatalogView['projectTags'];
  catalog?: CardTileCatalog;
  currentMemberId?: string;
  calendarDay?: string;
  selected: boolean;
  checked: boolean;
  selectionActive: boolean;
  disabled: boolean;
  onOpen: (card: CatalogCard, button: HTMLButtonElement, shift: boolean) => void;
  onToggle: (cardId: string, shift: boolean) => void;
  onFamilyOpen: (card: CatalogCard, button?: HTMLButtonElement) => void;
  onStart?: () => void;
  onQuickSettings?: (cardId: string, tab: CardQuickSettingsTab, anchor: HTMLElement) => void;
  selectable?: boolean;
}

function CardAttachmentBadge({ cardId, tile }: { cardId: string; tile: RefObject<HTMLElement | null> }) {
  const t = useText(text);
  const lang = useLang();
  const count = useAttachmentCount(cardId, tile);
  const formattedCount = formatNumber(count, 3, lang);
  return count > 0 ? <span className="card-hand-indicator card-attachment-indicator" title={t.attachments(formattedCount)} aria-label={t.attachments(formattedCount)}><Paperclip size={12} aria-hidden="true" /><strong>{formattedCount}</strong></span> : null;
}

type TileTransfer = Pick<ReturnType<typeof useCardTransferDrag>, 'enabled' | 'isDragging' | 'anyDragging' | 'setNodeRef' | 'onPointerDown' | 'handle'>;
const inactiveTransfer: TileTransfer = { enabled: false, isDragging: false, anyDragging: false,
  setNodeRef: () => {}, onPointerDown: () => {}, handle: null };
const sortingTransfer: TileTransfer = { ...inactiveTransfer, anyDragging: true };

function TransferCardTile(props: CatalogCardTileProps) {
  const transfer = useCardTransferDrag(props.card);
  return <CardTileFace {...props} transfer={transfer} />;
}

// 2026-11-10: Hand already owns sorting. Even a disabled useDraggable subscribes to every DndContext move,
// rebuilding the face and its Intl indicators; only transfer-capable surfaces need that subscription.
// Keep their adapter mounted while a save disables dragging, so the owner ring updates in place.
export const CatalogCardTile = memo(function CatalogCardTile(props: CatalogCardTileProps) {
  const transfer = useContext(CardTransferContext);
  const inactive = transfer.active ? sortingTransfer : inactiveTransfer;
  return transfer.available ? <TransferCardTile {...props} /> : <CardTileFace {...props} transfer={inactive} />;
}, sameCardTileProps);

function CardTileFace({ card, lookups, members, tagDefinitions, catalog, currentMemberId, selected, checked, selectionActive, disabled, onOpen, onToggle, onFamilyOpen, onStart, onQuickSettings, selectable = true, transfer }: CatalogCardTileProps & { transfer: TileTransfer }) {
  const t = useText(text);
  const lang = useLang();
  const [familyHovered, setFamilyHovered] = useState(false);
  const [hovered, setHovered] = useState(false);
  const tileElement = useRef<HTMLElement | null>(null);
  // 2026-11-09: limit tilt to ±8deg with an 850px perspective for a restrained effect.
  const { element, tilt, reset } = useCardTilt<HTMLElement>(8, checked || disabled || familyHovered || transfer.anyDragging);
  const children = card.kind === 'hero' ? familyChildren(lookups, card.id) : emptyCards;
  const progress = card.kind === 'hero' ? { children: children.filter(child => child.kind === 'task') } : null;
  // Own effort plus Sub Cards' effort matches the table row and properties panel.
  const heroEffort = progress ? cardHeroEffort(card, { cards: progress.children }) : null;
  // A Hero whose whole family is finished wears the done band too; finishing plays the done impact once (2026-11-06).
  const familyDone = progress ? heroFinished(card, progress.children) : false;
  // 2026-11-09: a Hero without counted Task Sub Cards is done by its own mark, so the medallion says only that.
  const doneLabel = progress && heroCountedTasks(progress.children).length ? t.familyDone : t.heroDone;
  const justDone = useJustFinished(card.state === 'done' || familyDone, card.id);
  const showEffortTotal = heroEffort != null;
  const openQuestionCount = card.kind === 'doc' ? (card.openQuestions?.length ?? 0) : 0;
  const wordCount = useMemo(() => card.kind === 'doc' ? countCatalogCardWords(card) : 0, [card.kind, card.id, card.sourceHash, card.markdown]);
  const excerpt = useMemo(() => card.kind === 'doc' ? catalogDocExcerpt(card) : emptyExcerpt, [card.kind, card.id, card.sourceHash, card.markdown]);
  const Icon = cardIcons[card.kind];
  const StateIcon = taskStateIcons[card.state ?? ''] ?? Hourglass;
  const parent = card.parentId ? lookups.cardById.get(card.parentId) : undefined;
  const checklist = lookups.checklistByCard.get(card.id);
  const ownerLabel = ownerProgressLabel(card.owner, checklist, lang);
  let actionLabel = t.open;
  if (selectionActive) actionLabel = checked ? t.deselect : t.select;
  let identityValue = card.version ?? cardKinds[card.kind];
  if (showEffortTotal) identityValue = formatNumber(heroEffort, 20, lang);
  // Mono is for numbers: the kind word of a card without a number is set in the interface font.
  let identityClassName = card.version ? undefined : 'catalog-card-kind';
  if (showEffortTotal) identityClassName = 'catalog-card-effort';
  const identityTitle = showEffortTotal ? t.totalEffort(formatNumber(heroEffort, 20, lang)) : undefined;
  const effortLabel = card.effort == null ? '—' : formatNumber(card.effort, 20, lang);
  const cardPriorityLabel = card.priority ? priorityLabel(card.priority, lang) : t.noPriority;
  const cardStateLabel = stateLabel(card.state ?? 'not-started', lang);
  const style = { '--tilt-x': '0deg', '--tilt-y': '0deg', '--glare-x': '50%', '--glare-opacity': 0 } as CSSProperties;
  const canStart = card.kind === 'task' && card.state !== 'started' && Boolean(onStart) && !disabled;
  const attachmentBadge = <CardAttachmentBadge cardId={card.id} tile={tileElement} />;
  function startWithSpace(event: KeyboardEvent) {
    if (!canStart || shortcutTargetBlocked(event) || matchShortcut(event, HOVER_CARD_SHORTCUTS)?.id !== 'hover-work') return;
    const target = event.target instanceof Element ? event.target : null;
    // Space keeps its native meaning on selection, drag and tag controls; the card face is the start target.
    if (target?.closest('button:not(.deck-card-open), input, select, textarea')) return;
    event.preventDefault();
    event.stopPropagation();
    onStart?.();
  }
  useEffect(() => {
    if (!hovered || !canStart) return;
    const listener = (event: KeyboardEvent) => startWithSpace(event);
    window.addEventListener('keydown', listener, true);
    return () => window.removeEventListener('keydown', listener, true);
  }, [hovered, canStart, onStart]);
  return <div ref={node => { transfer.setNodeRef(node); tileElement.current = node; }} className={'deck-card-space' + (hovered ? ' is-hovered' : '')} data-card-id={card.id} data-card-hovered={hovered || undefined} data-card-transfer-enabled={transfer.enabled || undefined} data-card-transfer-source={transfer.isDragging || undefined} onPointerEnter={event => { if (!transfer.anyDragging) { setHovered(true); tilt(event); } }} onPointerDown={transfer.onPointerDown} onPointerMove={tilt} onPointerLeave={() => { setHovered(false); reset(); }} onKeyDown={event => { if (!hovered) startWithSpace(event.nativeEvent); }}>
    <article ref={element} className={`deck-card catalog-card-${card.kind} deck-state-${statusClass(card.kind === 'task' ? card.state ?? '' : '')}${familyDone ? ' is-family-done' : ''}${justDone ? ' is-just-done' : ''}${selected ? ' is-selected' : ''}${checked ? ' is-multi-selected' : ''}`} style={style} data-deck-card={card.id}>
      {transfer.handle}
      {selectable && <input className="catalog-card-checkbox" type="checkbox" checked={checked} disabled={disabled} aria-label={t.selectCard(card.title)} onChange={event => onToggle(card.id, Boolean((event.nativeEvent as MouseEvent).shiftKey))} />}
      {parent && <CardFamilyPopover projectTags={tagDefinitions} members={members} hero={parent} children={familyChildren(lookups, parent.id)} disabled={disabled} onOpen={onFamilyOpen} onOpenChange={setFamilyHovered} />}
      {/* 2026-11-05: property controls are siblings of the face button so keyboard focus never enters a nested button. */}
      <div className="deck-card-face" onClick={event => {
        if (disabled || !(event.target as Element).closest('.card-indicators')) return;
        const button = event.currentTarget.querySelector<HTMLButtonElement>('.deck-card-open');
        if (button) onOpen(card, button, event.shiftKey);
      }}>
        <button type="button" className="deck-card-open" onClick={event => onOpen(card, event.currentTarget, event.shiftKey)} disabled={disabled} aria-label={`${actionLabel}: ${card.title}, ${cardKinds[card.kind]}${card.version ? ` ${card.version}` : ''}${card.tags?.length ? ', ' + t.tags(card.tags.join(', ')) : ''}`} aria-pressed={selectionActive ? checked : selected}>
          <span className="deck-card-title"><TagTitlePrefix tags={card.tags} definitions={tagDefinitions} />{card.title}</span>
          {/* 2026-11-09: a Doc face opens on its own text; the button's label already names the card. */}
          {excerpt.length > 0 && <span className="deck-card-doc-excerpt" aria-hidden="true">{excerpt.map((block, index) => block.heading ? <b key={index}>{block.text}</b> : <span key={index}>{block.text}</span>)}</span>}
        </button>
        <CardIndicators card={card} lookups={lookups} members={members} catalog={catalog} currentMemberId={currentMemberId} variant="tile"
          onQuickSettings={!disabled && !card.deleted && onQuickSettings ? (tab, anchor) => onQuickSettings(card.id, tab, anchor) : undefined} />
        {/* Bottom hints place state on the left and the tag color dot on the right. */}
        <span className="deck-card-hints">
          {((card.archived && !card.deleted) || card.kind === 'task') && <span className="deck-card-state-mark" title={card.archived && !card.deleted ? t.archived : cardStateLabel}>
            {card.archived && !card.deleted && <Archive size={15} aria-label={t.archived} />}
            {card.kind === 'task' && <><StateIcon size={15} /><span className="visually-hidden">{cardStateLabel}</span></>}
          </span>}
          {/* 2026-11-09: a Doc face carries only its title; its tags show in the open card. */}
          {card.kind !== 'doc' && <TagColorIndicator tags={card.tags} definitions={tagDefinitions} />}
        </span>
      </div>
      <div className="deck-card-band">{/* 2026-11-09: a finished Hero shows a done medallion in the owner's place; the owner stays in the open card. */}
        {familyDone
          ? <span className="deck-card-owner-medallion deck-card-done-medallion" role="img" title={doneLabel} aria-label={doneLabel}><Check size={14} strokeWidth={3.25} aria-hidden="true" /></span>
          : card.owner && <span className="deck-card-owner-medallion" title={ownerLabel} aria-label={ownerLabel} role="img"><CardOwnerAvatar owner={card.owner} members={members} /></span>}
        <span className="card-material-glare" aria-hidden="true" />
        {card.kind === 'task' && <div className="deck-card-task-metrics"><span data-shortcut-property="effort" onPointerEnter={event => markShortcutPropertyHover(event.currentTarget, true)} onPointerLeave={event => markShortcutPropertyHover(event.currentTarget, false)} title={t.effort(effortLabel)}><Gauge size={18} /><strong>{effortLabel}</strong></span><span data-shortcut-property="priority" onPointerEnter={event => markShortcutPropertyHover(event.currentTarget, true)} onPointerLeave={event => markShortcutPropertyHover(event.currentTarget, false)} title={t.priority(cardPriorityLabel)}><Layers size={17} /><span className="visually-hidden">{cardPriorityLabel}</span></span>{attachmentBadge}</div>}
        {/* 2026-11-09: no attachment badge on the Hero band — it stacked above the crown and made the band taller. */}
        {card.kind === 'hero' && <div className="deck-card-identity">{showEffortTotal && <Gauge className="catalog-card-effort-icon" size={16} aria-hidden="true" data-shortcut-property="effort" onPointerEnter={event => markShortcutPropertyHover(event.currentTarget, true)} onPointerLeave={event => markShortcutPropertyHover(event.currentTarget, false)} />}<strong className={identityClassName} title={identityTitle}>{identityValue}</strong><Icon size={18} aria-hidden="true" /></div>}
        {/* 2026-11-09: one row on the Doc band — the type icon left, the word count right;
            open questions and attachments join the row only when the document has them. */}
        {card.kind === 'doc' && <div className="deck-card-identity"><span className="deck-card-doc-kind" role="img" title={cardKinds.doc} aria-label={cardKinds.doc}><Icon size={18} aria-hidden="true" /></span>{openQuestionCount > 0 && <OpenQuestionsBadge card={card} />}{attachmentBadge}{wordCount > 0 && <strong className="deck-card-doc-words" title={t.wordCount(formatNumber(wordCount, 3, lang))} aria-label={t.wordCount(formatNumber(wordCount, 3, lang))}>{t.docWords(formatNumber(wordCount, 3, lang))}</strong>}</div>}
        {progress && (children.length ? progress.children.length > 0 && <SubCardProgress cards={progress.children} cardsById={lookups.cardById} /> : <span className="catalog-card-progress">{t.noSubCards}</span>)}
      </div>
    </article>
  </div>;
}

function sameCardTileProps(previous: CatalogCardTileProps, next: CatalogCardTileProps) {
  return previous.selected === next.selected && previous.checked === next.checked
  && previous.selectionActive === next.selectionActive && previous.disabled === next.disabled
  && previous.selectable === next.selectable && previous.currentMemberId === next.currentMemberId
  && previous.calendarDay === next.calendarDay
  && previous.onOpen === next.onOpen && previous.onToggle === next.onToggle
  && previous.onFamilyOpen === next.onFamilyOpen && previous.onStart === next.onStart
  && previous.onQuickSettings === next.onQuickSettings
  && sameCardTileData(previous, next);
}
CatalogCardTile.displayName = 'CatalogCardTile';
