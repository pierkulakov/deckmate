// Card tile shared by the deck grid and the hand (moved out of Deck.tsx on 2026-11-04: one tile, not two copies).
import { createContext, memo, useContext, useEffect, useMemo, useState } from 'react';
import type { CSSProperties, PointerEvent } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { Check, CircleHelp, Crown, Ellipsis, Eye, GripVertical, Hourglass, ListChecks, NotebookText, Play } from 'lucide-react';
import type { CardKind, CatalogCard, CatalogMember, CatalogView } from '../../src/catalog-contracts.ts';
import { openDependencies } from '../../src/dependency-contracts.ts';
import { catalogDocExcerpt, type DocExcerptBlock } from '../doc-excerpt.ts';
import { sameCardTileData, type CardTileCatalog, type CardTileLookups } from '../card-tile-equality.ts';
import { familyChildren } from '../catalog-lookups.ts';
import { HOVER_CARD_SHORTCUTS, markShortcutPropertyHover, matchShortcut, shortcutTargetBlocked } from '../keyboard-shortcuts.ts';
import { CardFaceStatus, cardFaceStatus } from './CardIndicators.tsx';
import { statusClass } from './StatusMenu.tsx';
import { CardFamilyPopover, SubCardProgress } from './CardFamily.tsx';
import { useJustFinished } from '../done-impact.ts';
import { heroCountedTasks, heroFinished } from '../../src/hero-done.ts';
import { useCardTilt } from '../useCardTilt.ts';
import type { CardQuickSettingsTab } from './CardQuickSettings.tsx';
import { CardOwnerAvatar, memberForOwner, ownerProgressLabel } from './CardOwnerAvatar.tsx';
import { CardTagSummary } from './CardTags.tsx';
import { defineText, formatNumber, textNow, useLang, useText } from '../i18n.ts';
import { kindLabel, priorityLabel, stateLabel } from '../locales/common.ts';

const text = defineText({
  docCard: 'Doc Card',
  transferCard: (title: string) => 'Move to deck: ' + title,
  transferHint: 'Move to deck · Space and arrow keys',
  transferLimit: 'You can move up to 1,000 selected cards',
  openQuestions: (count: string) => 'Open questions: ' + count,
  open: 'Open',
  deselect: 'Deselect',
  select: 'Select',
  selectCard: (title: string) => 'Select: ' + title,
  effort: (effort: string) => 'Effort: ' + effort,
  effortShort: 'Est.',
  priority: (priority: string) => 'Priority: ' + priority,
  tags: (names: string) => 'tags: ' + names,
  heroDone: 'Hero done',
  acceptedCount: (done: string, total: string) => `${done} of ${total}`,
  progress: (count: string) => `${count} accepted; segment length is Sub Card effort`,
  quickSettings: (title: string) => 'Quick Settings: ' + title,
}, {
  docCard: 'Doc Card',
  transferCard: (title: string) => 'Перенести в колоду: ' + title,
  transferHint: 'Перенести в колоду · Пробел и стрелки',
  transferLimit: 'Можно перенести до 1000 выбранных карточек',
  openQuestions: (count: string) => 'Открытых вопросов: ' + count,
  open: 'Открыть',
  deselect: 'Снять выбор',
  select: 'Выбрать',
  selectCard: (title: string) => 'Выбрать: ' + title,
  effort: (effort: string) => 'Оценка: ' + effort,
  effortShort: 'Оц.',
  priority: (priority: string) => 'Приоритет: ' + priority,
  tags: (names: string) => 'теги: ' + names,
  heroDone: 'Hero выполнена',
  acceptedCount: (done: string, total: string) => `${done} из ${total}`,
  progress: (count: string) => `${count} принято; длина сегмента — оценка Sub Card`,
  quickSettings: (title: string) => 'Быстрые настройки: ' + title,
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
    onKeyDown={event => { if (enabled) drag.listeners?.onKeyDown?.(event); }}><GripVertical size={14} aria-hidden="true" /></button> : null;
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

interface CatalogCardTileProps {
  card: CatalogCard;
  lookups: CardTileLookups;
  members: CatalogMember[];
  tagDefinitions?: CatalogView['projectTags'];
  catalog?: CardTileCatalog;
  currentMemberId?: string;
  calendarDay?: string;
  groupedBy?: 'state' | 'priority';
  /** 2026-11-11: only the parent knows which tags are shared by every card in the visible group. */
  sharedTags?: readonly string[];
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
// Keep their adapter mounted while a save disables dragging, so the owner label updates in place.
export const CatalogCardTile = memo(function CatalogCardTile(props: CatalogCardTileProps) {
  const transfer = useContext(CardTransferContext);
  const inactive = transfer.active ? sortingTransfer : inactiveTransfer;
  return transfer.available ? <TransferCardTile {...props} /> : <CardTileFace {...props} transfer={inactive} />;
}, sameCardTileProps);

function CardTileFace({ card, lookups, members, tagDefinitions, groupedBy, sharedTags, selected, checked, selectionActive, disabled, onOpen, onToggle, onFamilyOpen, onStart, onQuickSettings, selectable = true, transfer }: CatalogCardTileProps & { transfer: TileTransfer }) {
  const t = useText(text);
  const lang = useLang();
  const [familyHovered, setFamilyHovered] = useState(false);
  const [hovered, setHovered] = useState(false);
  // 2026-11-09: limit tilt to ±8deg with an 850px perspective for a restrained effect.
  const { element, tilt, reset } = useCardTilt<HTMLElement>(8, checked || disabled || familyHovered || transfer.anyDragging);
  const children = card.kind === 'hero' ? familyChildren(lookups, card.id) : emptyCards;
  const tasks = heroCountedTasks(children);
  const familyDone = card.kind === 'hero' && heroFinished(card, children);
  const justDone = useJustFinished(card.state === 'done' || familyDone, card.id);
  const excerpt = useMemo(() => card.kind === 'doc' ? catalogDocExcerpt(card) : emptyExcerpt, [card.kind, card.id, card.sourceHash, card.markdown]);
  const parent = card.parentId ? lookups.cardById.get(card.parentId) : undefined;
  const checklist = lookups.checklistByCard.get(card.id);
  const owner = memberForOwner(card.owner, members)?.label ?? card.owner;
  const ownerLabel = ownerProgressLabel(owner, checklist, lang);
  const status = cardFaceStatus(card, lookups, lang);
  const active = !card.archived && !card.deleted;
  const effortLabel = card.effort == null ? '' : formatNumber(card.effort, 20, lang);
  const highPriority = active && card.kind === 'task' && card.priority === 'high' && groupedBy !== 'priority';
  const progressCount = t.acceptedCount(formatNumber(tasks.filter(child => child.state === 'done').length, 0, lang), formatNumber(tasks.length, 0, lang));
  const progressLabel = tasks.length ? t.progress(progressCount) : '';
  let familyLabel = cardKinds.hero;
  if (tasks.length) familyLabel = progressCount;
  else if (familyDone) familyLabel = stateLabel('done', lang);
  const canConfigure = active && Boolean(onQuickSettings) && !selectionActive;
  const ownerFace = active && owner ? <span className="deck-card-owner" title={ownerLabel} aria-label={ownerLabel}>
    <CardOwnerAvatar owner={card.owner} members={members} />
  </span> : null;
  const settingsLabel = [t.quickSettings(card.title), owner ? ownerLabel : ''].filter(Boolean).join(', ');
  let actionLabel = t.open;
  if (selectionActive) actionLabel = checked ? t.deselect : t.select;
  const accessibleName = [actionLabel + ': ' + card.title, cardKinds[card.kind], card.version, status.accessible,
    owner ? ownerLabel : '', progressLabel, familyDone ? t.heroDone : '', effortLabel ? t.effort(effortLabel) : '',
    card.kind === 'task' && card.priority ? t.priority(priorityLabel(card.priority, lang)) : '',
    card.tags?.length ? t.tags(card.tags.join(', ')) : ''].filter(Boolean).join(', ');
  const style = { '--tilt-x': '0deg', '--tilt-y': '0deg', '--glare-x': '50%', '--glare-opacity': 0 } as CSSProperties;
  const canStart = active && card.kind === 'task' && card.state !== 'started' && Boolean(onStart) && !disabled;
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
  return <div ref={transfer.setNodeRef} className={'deck-card-space' + (hovered ? ' is-hovered' : '')} data-card-id={card.id} data-card-hovered={hovered || undefined} data-card-transfer-enabled={transfer.enabled || undefined} data-card-transfer-source={transfer.isDragging || undefined} onPointerEnter={event => { if (!transfer.anyDragging) { setHovered(true); tilt(event); } }} onPointerDown={transfer.onPointerDown} onPointerMove={tilt} onPointerLeave={() => { setHovered(false); reset(); }} onKeyDown={event => { if (!hovered) startWithSpace(event.nativeEvent); }}>
    <article ref={element} className={`deck-card is-text-face catalog-card-${card.kind} deck-state-${statusClass(card.kind === 'task' ? card.state ?? '' : '')}${familyDone ? ' is-family-done' : ''}${justDone ? ' is-just-done' : ''}${selected ? ' is-selected' : ''}${checked ? ' is-multi-selected' : ''}`} style={style} data-deck-card={card.id}>
      {transfer.handle}
      {selectable && <input className="catalog-card-checkbox" type="checkbox" checked={checked} disabled={disabled} aria-label={t.selectCard(card.title)} onChange={event => onToggle(card.id, Boolean((event.nativeEvent as MouseEvent).shiftKey))} />}
      {parent && <CardFamilyPopover projectTags={tagDefinitions} members={members} hero={parent} children={familyChildren(lookups, parent.id)} disabled={disabled} onOpen={onFamilyOpen} onOpenChange={setFamilyHovered} />}
      {/* 2026-11-05: property controls are siblings of the face button so keyboard focus never enters a nested button. */}
      <div className="deck-card-face">
        <button type="button" className="deck-card-open" onClick={event => onOpen(card, event.currentTarget, event.shiftKey)} disabled={disabled} aria-label={accessibleName} aria-pressed={selectionActive ? checked : selected}>
          <span className="deck-card-title">{card.title}</span>
          {/* 2026-11-09: a Doc face opens on its own text; the button's label already names the card. */}
          {excerpt.length > 0 && <span className="deck-card-doc-excerpt" aria-hidden="true">{excerpt.map((block, index) => block.heading ? <b key={index}>{block.text}</b> : <span key={index}>{block.text}</span>)}</span>}
          {ownerFace}
        </button>
        {active && <div className={'deck-card-context' + (owner || onQuickSettings ? ' has-controls' : '')}>
          <CardTagSummary tags={card.tags} definitions={tagDefinitions} sharedTags={sharedTags} />
          {highPriority && <span className="deck-card-priority" title={t.priority(priorityLabel('high', lang))}>{priorityLabel('high', lang)}</span>}
        </div>}
        {canConfigure && <button type="button" className="deck-card-settings" title={settingsLabel} aria-label={settingsLabel}
          aria-haspopup="dialog" aria-expanded={false} disabled={disabled} onClick={event => onQuickSettings?.(card.id, 'owner', event.currentTarget)}>
          {!owner && <Ellipsis size={16} aria-hidden="true" />}
        </button>}
      </div>
      <div className="deck-card-band">
        <span className="card-material-glare" aria-hidden="true" />
        <CardFaceStatus status={status} hideWorkflow={groupedBy === 'state'}>
          {active && card.kind === 'task' && card.effort != null && <span className="deck-card-effort" data-shortcut-property="effort"
            onPointerEnter={event => markShortcutPropertyHover(event.currentTarget, true)} onPointerLeave={event => markShortcutPropertyHover(event.currentTarget, false)}
            title={t.effort(effortLabel)}>{t.effortShort} <b>{effortLabel}</b></span>}
        </CardFaceStatus>
        {active && card.kind === 'hero' && <>
          <span className="deck-card-family-count" title={progressLabel || cardKinds.hero}><Crown size={16} aria-hidden="true" />{familyLabel}</span>
          {tasks.length > 0 && <div title={progressLabel}><SubCardProgress cards={tasks} cardsById={lookups.cardById} /></div>}
        </>}
        {active && card.kind === 'doc' && <span className="deck-card-kind-name">{kindLabel('doc', lang)}</span>}
      </div>
    </article>
  </div>;
}

function sameCardTileProps(previous: CatalogCardTileProps, next: CatalogCardTileProps) {
  return previous.selected === next.selected && previous.checked === next.checked
  && previous.selectionActive === next.selectionActive && previous.disabled === next.disabled
  && previous.selectable === next.selectable && previous.currentMemberId === next.currentMemberId
  && previous.calendarDay === next.calendarDay
  && previous.groupedBy === next.groupedBy
  && previous.sharedTags === next.sharedTags
  && previous.onOpen === next.onOpen && previous.onToggle === next.onToggle
  && previous.onFamilyOpen === next.onFamilyOpen && previous.onStart === next.onStart
  && previous.onQuickSettings === next.onQuickSettings
  && (previous.lookups === next.lookups || openDependencies(previous.card.dependsOn, previous.lookups.cardById).length === openDependencies(next.card.dependsOn, next.lookups.cardById).length)
  && sameCardTileData(previous, next);
}
CatalogCardTile.displayName = 'CatalogCardTile';
