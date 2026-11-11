import { DndContext, KeyboardSensor, PointerSensor, closestCenter, pointerWithin, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { ArrowDown, ArrowUp, GripVertical, Pencil, Plus, Trash2, Triangle } from 'lucide-react';
import { useRef, useState, type KeyboardEventHandler, type MouseEvent, type PointerEventHandler, type RefObject } from 'react';
import type { CatalogDeck, CatalogJourneyStep, CatalogJourneyZone, JourneyStepMetrics } from '../../src/catalog-contracts.ts';
import { JourneyMiniCard, JourneyWaves, journeyStepLabel } from './JourneyMiniCard.tsx';
import { JourneyStepMetricsBadge } from './JourneyMetrics.tsx';
import { Button } from './ui/button.tsx';
import { defineText, useText } from '../i18n.ts';

const text = defineText({
  addStep: 'Add step',
  selectStep: (title: string) => `Select step ${title}`,
  moveStep: (title: string) => `Move step ${title}`,
  zoneTitle: 'Zone title',
  renameZone: (title: string) => `Rename zone ${title}`,
  moveZoneUp: (title: string) => `Move zone ${title} up`,
  moveZoneDown: (title: string) => `Move zone ${title} down`,
  deleteEmptyZone: (title: string) => `Delete empty zone ${title}`,
}, {
  addStep: 'Добавить шаг',
  selectStep: (title: string) => `Выбрать шаг ${title}`,
  moveStep: (title: string) => `Переместить шаг ${title}`,
  zoneTitle: 'Название зоны',
  renameZone: (title: string) => `Переименовать зону ${title}`,
  moveZoneUp: (title: string) => `Зону ${title} вверх`,
  moveZoneDown: (title: string) => `Зону ${title} вниз`,
  deleteEmptyZone: (title: string) => `Удалить пустую зону ${title}`,
});

// The parent owns selected IDs; zones hold only the Shift-range anchor.
interface StepSelection {
  chosenIds: ReadonlySet<string>;
  toggleStep: (id: string) => void;
  clickStep: (id: string, event: MouseEvent<HTMLButtonElement>) => void;
}

// Touch dragging starts on the grip so the card face can still scroll the page.
function SortableStep({ step, decks, disabled, dragged, selection, metrics, onOpen }: {
  step: CatalogJourneyStep; decks: CatalogDeck[]; disabled: boolean; dragged: RefObject<boolean>; selection: StepSelection | null; metrics?: JourneyStepMetrics; onOpen: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: step.id, disabled, data: { zoneId: step.zoneId, kind: 'step' } });
  const t = useText(text);
  const chosen = selection?.chosenIds.has(step.id) ?? false;
  return <div ref={setNodeRef} className={'journey-sortable-step' + (isDragging ? ' is-dragging' : '')} style={{ transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined, transition }} onPointerDown={event => { if (event.pointerType === 'mouse') listeners?.onPointerDown?.(event); }}>
    <JourneyMiniCard title={step.title} effort={step.effort} priority={step.priority} deckTitle={decks.find(deck => deck.id === step.deckId)?.title ?? ''} selected={selection && selection.chosenIds.size > 0 ? chosen : undefined} badge={<JourneyStepMetricsBadge metrics={metrics} />} onClick={event => {
      // The click that ends a pointer drag lands on the dragged card; it must neither open the step sheet nor change the selection.
      if (dragged.current) return;
      if (selection) selection.clickStep(step.id, event); else onOpen(step.id);
    }} />
    {selection && <label className="journey-step-select" onPointerDown={event => event.stopPropagation()}><input type="checkbox" checked={chosen} aria-label={t.selectStep(journeyStepLabel(step.title))} title={t.selectStep(journeyStepLabel(step.title))} onChange={() => selection.toggleStep(step.id)} /></label>}
    <button type="button" ref={setActivatorNodeRef} className="journey-drag-handle" {...attributes} onPointerDown={listeners?.onPointerDown as PointerEventHandler | undefined} onKeyDown={listeners?.onKeyDown as KeyboardEventHandler | undefined} aria-label={t.moveStep(journeyStepLabel(step.title))} disabled={disabled}><GripVertical size={13} /></button>
  </div>;
}

function StepZone({ zone, steps, decks, disabled, first, last, dragged, selection, metrics, onRename, onMove, onRemove, onOpen, onAdd, canAdd }: {
  zone: CatalogJourneyZone; steps: CatalogJourneyStep[]; decks: CatalogDeck[]; disabled: boolean; first: boolean; last: boolean; dragged: RefObject<boolean>; selection: StepSelection | null; metrics?: ReadonlyMap<string, JourneyStepMetrics>;
  onRename: (title: string) => void; onMove: (direction: number) => void; onRemove: () => void; onOpen: (id: string) => void; onAdd: () => void; canAdd: boolean;
}) {
  const [renaming, setRenaming] = useState(false);
  const t = useText(text);
  const { setNodeRef, isOver } = useDroppable({ id: `zone:${zone.id}`, disabled, data: { zoneId: zone.id, kind: 'zone' } });
  return <section className="journey-zone" aria-label={zone.title}>
    <header className="journey-zone-heading"><Triangle size={14} aria-hidden="true" />
      {renaming ? <input autoFocus aria-label={t.zoneTitle} value={zone.title} maxLength={120} disabled={disabled} onChange={event => onRename(event.target.value)} onBlur={() => { if (zone.title.trim()) setRenaming(false); }} onKeyDown={event => { if (event.key === 'Enter' && zone.title.trim()) setRenaming(false); }} /> : <h3 onDoubleClick={() => { if (!disabled) setRenaming(true); }}>{zone.title}</h3>}
      <span className="journey-zone-tools">
        <Button variant="ghost" size="icon" disabled={disabled} aria-label={t.renameZone(zone.title)} onClick={() => setRenaming(true)}><Pencil size={13} /></Button>
        <Button variant="ghost" size="icon" disabled={disabled || first} aria-label={t.moveZoneUp(zone.title)} onClick={() => onMove(-1)}><ArrowUp size={14} /></Button>
        <Button variant="ghost" size="icon" disabled={disabled || last} aria-label={t.moveZoneDown(zone.title)} onClick={() => onMove(1)}><ArrowDown size={14} /></Button>
        {steps.length === 0 && !(first && last) && <Button variant="ghost" size="icon" disabled={disabled} aria-label={t.deleteEmptyZone(zone.title)} onClick={onRemove}><Trash2 size={13} /></Button>}
      </span>
    </header>
    <div ref={setNodeRef} className={'journey-zone-cards' + (isOver ? ' is-over' : '')}>
      <JourneyWaves />
      <SortableContext items={steps.map(step => step.id)} strategy={rectSortingStrategy}>
        {steps.map(step => <SortableStep key={step.id} step={step} decks={decks} disabled={disabled} dragged={dragged} selection={selection} metrics={metrics?.get(step.id)} onOpen={onOpen} />)}
      </SortableContext>
      <button type="button" className="journey-add-step" disabled={disabled || !canAdd} onClick={onAdd}><Plus size={26} strokeWidth={1.5} /><span>{t.addStep}</span></button>
    </div>
  </section>;
}

export function JourneyZones({ zones, steps, decks, disabled, selectedIds, onSelectionChange, metrics, onZonesChange, onStepsChange, onOpen, onAdd }: {
  zones: CatalogJourneyZone[]; steps: CatalogJourneyStep[]; decks: CatalogDeck[]; disabled: boolean; selectedIds?: string[]; onSelectionChange?: (ids: string[]) => void;
  /** Step metrics keyed by step ID; absent outside the Journey editor. */
  metrics?: ReadonlyMap<string, JourneyStepMetrics>;
  onZonesChange: (zones: CatalogJourneyZone[]) => void; onStepsChange: (steps: CatalogJourneyStep[]) => void; onOpen: (id: string) => void; onAdd: (zoneId: string) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  // The click that ends a pointer drag lands on the dragged card; it must not open the step sheet.
  const dragged = useRef(false);
  // Shift ranges follow visual order: zone order, then draft order within each zone.
  const visualOrderIds = zones.flatMap(zone => steps.filter(step => step.zoneId === zone.id)).map(step => step.id);
  // Keep the Shift-range anchor here; the parent owns only the ID list.
  const anchorId = useRef<string | null>(null);

  function publish(next: Set<string>) {
    if (!onSelectionChange) return;
    onSelectionChange(visualOrderIds.filter(id => next.has(id)));
  }
  function toggleStep(id: string) {
    const chosen = new Set(selectedIds ?? []);
    if (chosen.has(id)) chosen.delete(id); else chosen.add(id);
    anchorId.current = id;
    publish(chosen);
  }
  function rangeStep(id: string) {
    const current = selectedIds ?? [];
    // An empty selection clears the anchor; Shift without an anchor acts as a normal toggle.
    const anchorIndex = current.length > 0 && anchorId.current ? visualOrderIds.indexOf(anchorId.current) : -1;
    const targetIndex = visualOrderIds.indexOf(id);
    if (anchorIndex < 0 || targetIndex < 0) { toggleStep(id); return; }
    const chosen = new Set(current);
    const adding = !chosen.has(id);
    const first = Math.min(anchorIndex, targetIndex);
    const last = Math.max(anchorIndex, targetIndex);
    for (const candidate of visualOrderIds.slice(first, last + 1)) {
      if (adding) chosen.add(candidate); else chosen.delete(candidate);
    }
    publish(chosen);
  }
  function clickStep(id: string, event: MouseEvent<HTMLButtonElement>) {
    if (event.shiftKey) { rangeStep(id); return; }
    if (event.ctrlKey || event.metaKey) { toggleStep(id); return; }
    // Match deck selection: a click toggles the step while a selection is active, otherwise it opens the step.
    if ((selectedIds ?? []).length > 0) toggleStep(id); else onOpen(id);
  }
  const selection = onSelectionChange ? { chosenIds: new Set(selectedIds ?? []), toggleStep, clickStep } : null;

  function finishDrag({ active, over }: DragEndEvent) {
    window.setTimeout(() => { dragged.current = false; }, 0);
    if (disabled || !over || active.id === over.id) return;
    const moving = steps.find(step => step.id === active.id);
    const zoneId = over.data.current?.zoneId as string | undefined;
    if (!moving || !zoneId || !zones.some(zone => zone.id === zoneId)) return;
    const next = steps.filter(step => step.id !== active.id);
    let insertion = next.findIndex(step => step.id === over.id);
    if (insertion < 0) {
      const lastIndex = next.findLastIndex(step => step.zoneId === zoneId);
      insertion = lastIndex < 0 ? next.length : lastIndex + 1;
    } else if (moving.zoneId === zoneId && steps.indexOf(moving) < steps.findIndex(step => step.id === over.id)) insertion += 1;
    next.splice(insertion, 0, { ...moving, zoneId });
    onStepsChange(next);
  }
  function moveZone(index: number, direction: number) {
    const next = [...zones];
    const [moving] = next.splice(index, 1);
    next.splice(index + direction, 0, moving!);
    onZonesChange(next);
  }
  return <DndContext sensors={sensors} collisionDetection={arguments_ => { const hits = pointerWithin(arguments_); return hits.length ? hits : closestCenter(arguments_); }} onDragStart={() => { dragged.current = true; }} onDragCancel={() => { window.setTimeout(() => { dragged.current = false; }, 0); }} onDragEnd={finishDrag}>
    {zones.map((zone, index) => <StepZone key={zone.id} zone={zone} steps={steps.filter(step => step.zoneId === zone.id)} decks={decks} disabled={disabled} first={index === 0} last={index === zones.length - 1} dragged={dragged} selection={selection} metrics={metrics}
      onRename={title => onZonesChange(zones.map(candidate => candidate.id === zone.id ? { ...candidate, title } : candidate))} onMove={direction => moveZone(index, direction)} onRemove={() => onZonesChange(zones.filter(candidate => candidate.id !== zone.id))}
      onOpen={onOpen} onAdd={() => onAdd(zone.id)} canAdd={steps.length < 30} />)}
  </DndContext>;
}
