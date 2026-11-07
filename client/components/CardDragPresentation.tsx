import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useDndMonitor, useDroppable } from '@dnd-kit/core';
import type { DragStartEvent } from '@dnd-kit/core';
import * as Dialog from '@radix-ui/react-dialog';
import type { CatalogDeck, CatalogView } from '../../src/catalog-contracts.ts';
import { cardTransferTargetIssue, type CardTransferBaseline } from '../card-transfer.ts';
import { defineText, useText } from '../i18n.ts';

export const cardDragText = defineText({
  hand: 'Add to hand', decks: 'Change deck', timeline: 'Timeline', vision: 'Vision',
  drop: (value: string) => `Drop to set ${value}`, groups: 'Set card group',
  noDeck: 'No deck', cancel: 'Cancel', chooseDeck: 'Choose a deck for the dragged cards',
  sameDeck: 'All dragged cards are already here', incompatible: 'This deck cannot accept all dragged card types',
  high: 'High', medium: 'Medium', low: 'Low', noPriority: 'No priority',
  handFor: (member: string) => `Add to ${member}’s hand`,
}, {
  hand: 'Добавить в руку', decks: 'Сменить колоду', timeline: 'Календарь', vision: 'Полотно',
  drop: (value: string) => `Отпустите, чтобы задать: ${value}`, groups: 'Группа карт',
  noDeck: 'Без колоды', cancel: 'Отмена', chooseDeck: 'Выберите колоду для переносимых карт',
  sameDeck: 'Все переносимые карты уже здесь', incompatible: 'Колода не принимает все переносимые типы карт',
  high: 'Высокий', medium: 'Средний', low: 'Низкий', noPriority: 'Без приоритета',
  handFor: (member: string) => `Добавить в руку: ${member}`,
});

export interface CardDragPreview { html: string; width: number; height: number; table: boolean }

export function captureCardDragPreview(event: DragStartEvent): CardDragPreview | null {
  if (event.activatorEvent instanceof KeyboardEvent) return null;
  const target = event.activatorEvent.target;
  const source = target instanceof Element ? target.closest<HTMLElement>('[data-card-transfer-enabled]') : null;
  if (!source) return null;
  const rectangle = event.active.rect.current.initial ?? source.getBoundingClientRect();
  const clone = source.cloneNode(true) as HTMLElement;
  // 2026-11-05: freeze the rendered face, including attachments, without registering a second draggable or fetching it again.
  const originals = [source, ...source.querySelectorAll<HTMLElement>('*')];
  [clone, ...clone.querySelectorAll<HTMLElement>('*')].forEach((element, index) => {
    for (const attribute of ['id', 'data-card-id', 'data-deck-card', 'data-card-transfer-source', 'data-card-transfer-enabled', 'aria-describedby']) element.removeAttribute(attribute);
    element.classList.remove('is-hovered', 'is-multi-selected', 'is-selected', 'is-opened');
    // 2026-11-06: a cell the narrow table folds away (Tags) stays folded on the face, which lives outside the table's container.
    if (element.matches('td') && getComputedStyle(originals[index]).display === 'none') element.style.display = 'none';
  });
  const table = source.tagName === 'TR';
  // Rows take their columns from the table grid (subgrid); the face keeps the table's resolved columns, so cells sit where the row's did.
  const columns = table ? getComputedStyle(source.closest('table') ?? source).gridTemplateColumns : '';
  const html = table ? `<table class="deck-table" style="grid-template-columns: ${columns}"><tbody>${clone.outerHTML}</tbody></table>` : clone.outerHTML;
  return { html, width: rectangle.width, height: rectangle.height, table };
}

export function CardDragFace({ preview, count }: { preview: CardDragPreview; count: number }) {
  return <div className={'card-drag-face' + (preview.table ? ' is-table' : '') + (count > 1 ? ' is-stack' : '')}
    style={{ width: preview.width, height: preview.height }} inert aria-hidden="true">
    <div className="card-drag-face-content" dangerouslySetInnerHTML={{ __html: preview.html }} />
    {count > 1 && <span className="card-drag-count">{count}</span>}
  </div>;
}

function DragTab({ operation, disabled = false, title, children, onNode }: {
  operation: string; disabled?: boolean; title?: string; children: ReactNode; onNode?: (node: HTMLButtonElement | null) => void;
}) {
  const drop = useDroppable({ id: operation, disabled, data: { operation, surface: 'card-navigation', label: title } });
  return <button type="button" ref={node => { drop.setNodeRef(node); onNode?.(node); }} disabled={disabled}
    tabIndex={-1} title={title} className={'card-drag-tab' + (drop.isOver ? ' is-over' : '')}>{children}</button>;
}

function DeckDestination({ baseline, deck, onChoose }: {
  baseline: CardTransferBaseline; deck: CatalogDeck | null; onChoose?: (deck: CatalogDeck | null) => void;
}) {
  const text = useText(cardDragText);
  const issue = cardTransferTargetIssue(baseline, deck);
  const label = deck?.title ?? text.noDeck;
  const drop = useDroppable({ id: 'card-menu-deck:' + (deck?.id ?? 'none'), disabled: Boolean(issue) || Boolean(onChoose),
    data: { operation: 'card-transfer', kind: 'deck', surface: 'card-deck-menu', deckId: deck?.id ?? null, label } });
  const title = issue === 'same-deck' ? text.sameDeck : issue === 'incompatible' ? text.incompatible : label;
  return <button type="button" ref={drop.setNodeRef} disabled={Boolean(issue)} title={title}
    className={'card-drag-destination' + (drop.isOver ? ' is-over' : '')} tabIndex={onChoose ? 0 : -1}
    onClick={() => onChoose?.(deck)}>{label}</button>;
}

function DeckDestinations({ baseline, catalog, onChoose }: {
  baseline: CardTransferBaseline; catalog: CatalogView; onChoose?: (deck: CatalogDeck | null) => void;
}) {
  return <><DeckDestination baseline={baseline} deck={null} onChoose={onChoose} />
    {catalog.spaces.map(space => <div key={space.id} className="card-drag-space" role="group" aria-label={space.title}>
      <span>{space.title}</span>{catalog.decks.filter(deck => deck.spaceId === space.id).map(deck =>
        <DeckDestination key={deck.id} baseline={baseline} deck={deck} onChoose={onChoose} />)}
    </div>)}</>;
}

export function CardDragTabs({ baseline, catalog, memberLabel }: {
  baseline: CardTransferBaseline; catalog: CatalogView; memberLabel?: string;
}) {
  const text = useText(cardDragText);
  const deckTab = useRef<HTMLButtonElement | null>(null);
  const menuDrop = useDroppable({ id: 'card-menu-background', data: { operation: 'card-drop-blocker', surface: 'card-deck-menu' } });
  const tabsDrop = useDroppable({ id: 'card-tabs-background', data: { operation: 'card-drop-blocker', surface: 'card-navigation' } });
  const host = document.querySelector('.global-tabs');
  useLayoutEffect(() => { tabsDrop.setNodeRef(host as HTMLElement | null); return () => tabsDrop.setNodeRef(null); }, [host, tabsDrop.setNodeRef]);
  const [menu, setMenu] = useState(false);
  const [anchor, setAnchor] = useState({ left: 0, top: 52 });
  useDndMonitor({ onDragOver({ over }) {
    const operation = over?.data.current?.operation;
    if (operation === 'card-deck-picker') {
      const rectangle = deckTab.current?.getBoundingClientRect();
      if (rectangle) setAnchor({ left: Math.max(8, Math.min(rectangle.left, window.innerWidth - 288)), top: rectangle.bottom });
      setMenu(true);
    } else if (over && !['card-navigation', 'card-deck-menu'].includes(over.data.current?.surface as string)) setMenu(false);
    else if (operation === 'card-hand') setMenu(false);
  } });
  if (!host) return null;
  return <>{createPortal(<div className="card-drag-tabs">
    <DragTab operation="card-hand" disabled={!memberLabel} title={memberLabel ? text.handFor(memberLabel) : text.hand}>{text.hand}</DragTab>
    <DragTab operation="card-deck-picker" title={text.decks} onNode={node => { deckTab.current = node; }}>{text.decks}</DragTab>
    <DragTab operation="card-timeline" disabled>{text.timeline}</DragTab>
    <DragTab operation="card-vision" disabled>{text.vision}</DragTab>
  </div>, host)}
    {menu && createPortal(<aside ref={menuDrop.setNodeRef} className="card-drag-deck-menu" style={anchor} aria-label={text.decks}>
      <DeckDestinations baseline={baseline} catalog={catalog} />
    </aside>, document.body)}
  </>;
}

export function CardDropDeckPicker({ baseline, catalog, onChoose, onClose }: {
  baseline: CardTransferBaseline; catalog: CatalogView; onChoose: (deck: CatalogDeck | null) => void; onClose: () => void;
}) {
  const text = useText(cardDragText);
  return <Dialog.Root open onOpenChange={open => { if (!open) onClose(); }}><Dialog.Portal>
    <Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="card-drop-deck-picker">
      <Dialog.Title>{text.decks}</Dialog.Title><Dialog.Description>{text.chooseDeck}</Dialog.Description>
      <div className="card-drop-deck-list"><DeckDestinations baseline={baseline} catalog={catalog} onChoose={onChoose} /></div>
      <Dialog.Close className="ui-button button-ghost">{text.cancel}</Dialog.Close>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}

export function CardGroupDropSurface({ title, groupKey }: { title: string; groupKey: string }) {
  const text = useText(cardDragText);
  const priorities: Record<string, string> = { 'priority:high': text.high, 'priority:medium': text.medium, 'priority:low': text.low, 'priority:none': text.noPriority };
  return <div className="card-group-drop-surface" aria-hidden="true"><span>{text.drop(priorities[groupKey] ?? title)}</span></div>;
}
