import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { DndContext, MouseSensor, TouchSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Check, ChevronDown, ChevronUp, LoaderCircle, Pin, X } from 'lucide-react';
import type { DesktopWorkspaceProject } from './desktop-bridge.ts';
import { defineText, useText } from './i18n.ts';
import { moveFocus } from './focus.ts';
import { ProjectTile } from './ProjectTile.tsx';
import { ReservedText } from './ReservedText.tsx';
import { relativeTimeAgo } from './relative-time.ts';
import { Keys } from './components/Keys.tsx';
import { formatShortcut } from './shortcut-format.ts';
import { projectListCommand, projectShortcutIndex } from './project-list-navigation.ts';
import { projectName } from './project-path.ts';
import './project-list.css';

const text = defineText({
  workspace: 'Workspace', recent: 'Recent projects', missing: 'Folder not found', current: 'Current project',
  remove: 'Remove from workspace', removeRecent: 'Remove from the list', pin: 'Add to workspace',
  moveUp: 'Move up', moveDown: 'Move down',
  reorderHint: (up: string, down: string) => `Drag to reorder, or focus a project and press ${up} or ${down}.`,
  moved: (name: string, position: number, count: number) => `${name}: position ${position} of ${count}.`,
  dragging: (name: string) => `Moving ${name}.`, dragCancelled: 'Move cancelled.',
}, {
  workspace: 'Рабочее пространство', recent: 'Недавние проекты', missing: 'Папка не найдена', current: 'Текущий проект',
  remove: 'Убрать из пространства', removeRecent: 'Убрать из списка', pin: 'Добавить в пространство',
  moveUp: 'Переместить выше', moveDown: 'Переместить ниже',
  reorderHint: (up: string, down: string) => `Перетащите проект или выделите его и нажмите ${up} или ${down}.`,
  moved: (name: string, position: number, count: number) => `${name}: позиция ${position} из ${count}.`,
  dragging: (name: string) => `Перемещаем ${name}.`, dragCancelled: 'Перемещение отменено.',
});

export type ProjectListEntry = DesktopWorkspaceProject & { lastOpened?: string; pinned?: boolean };
/** 2026-11-13: focus follows only accepted changes; the owner publishes authoritative props and failure feedback. */
type ChangeResult = boolean | Promise<boolean>;
export interface ProjectListProps {
  projects: readonly ProjectListEntry[];
  kind?: 'workspace' | 'recent';
  disabled?: boolean;
  pending?: boolean;
  actionsDisabled?: boolean;
  moveButtons?: boolean;
  switching?: string | null;
  onOpen(path: string): void;
  onRemove?(path: string): ChangeResult;
  onPin?(path: string): ChangeResult;
  onMove?(path: string, index: number): ChangeResult;
  onRefresh?(): void | Promise<void>;
  onDraggingChange?(dragging: boolean): void;
  fallbackFocusRef?: RefObject<HTMLElement | null>;
  navigationRef?: RefObject<HTMLElement | null>;
  /** 2026-11-13: native accelerators already invoke IPC; page handlers would open the same project twice. */
  shortcuts?: 'local' | 'native';
}

export function ProjectList({ projects, kind = 'workspace', disabled = false, pending = false, actionsDisabled = false, moveButtons = false, switching = null,
  onOpen, onRemove, onPin, onMove, onRefresh, onDraggingChange, fallbackFocusRef, navigationRef, shortcuts = 'local' }: ProjectListProps) {
  const t = useText(text);
  const list = useRef<HTMLUListElement>(null);
  const hintId = useId();
  const [dragging, setDragging] = useState(false);
  const [changing, setChanging] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const lock = useRef(false);
  const focusAfterChange = useRef<{ path: string; index: number } | null>(null);
  const busy = disabled || pending || changing;
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }));
  useProjectRefresh(onRefresh, busy || actionsDisabled || dragging);
  useProjectClock(kind === 'recent' && projects.some(project => project.lastOpened));

  useLayoutEffect(() => {
    if (changing || pending || !focusAfterChange.current) return;
    const { path, index } = focusAfterChange.current;
    focusAfterChange.current = null;
    const rows = Array.from(list.current?.querySelectorAll<HTMLButtonElement>('.mission-control-workspace-open') ?? []);
    moveFocus(rows.find(row => row.dataset.path === path) ?? rows[Math.min(index, rows.length - 1)] ?? fallbackFocusRef?.current);
  });

  useEffect(() => {
    if (kind !== 'workspace' || shortcuts === 'native') return;
    const keydown = (event: KeyboardEvent) => {
      if (busy || dragging || event.defaultPrevented || event.repeat || event.isComposing) return;
      if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"], [role="menu"]')) return;
      const index = projectShortcutIndex(event, projects.length);
      if (index === null) return;
      event.preventDefault();
      if (!projects[index].current) onOpen(projects[index].path);
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [projects, kind, shortcuts, busy, dragging, onOpen]);

  async function change(action: () => ChangeResult, project: ProjectListEntry, index: number) {
    if (busy || actionsDisabled || lock.current) return;
    lock.current = true;
    setChanging(true);
    try {
      if (await action()) focusAfterChange.current = { path: project.path, index };
    } finally { lock.current = false; setChanging(false); }
  }
  function move(project: ProjectListEntry, index: number) {
    if (!onMove || index < 0 || index >= projects.length || projects[index].path === project.path) return;
    void change(async () => {
      const changed = await onMove(project.path, index);
      if (changed) setAnnouncement(t.moved(projectName(project.path, project.name), index + 1, projects.length));
      return changed;
    }, project, index);
  }
  function setDrag(value: boolean) { setDragging(value); onDraggingChange?.(value); }
  const dragName = (id: string | number) => {
    const project = projects.find(project => project.path === id);
    return project ? projectName(project.path, project.name) : '';
  };
  const reorderHint = t.reorderHint(formatShortcut({ key: 'ArrowUp', modifiers: ['alt'] }).name, formatShortcut({ key: 'ArrowDown', modifiers: ['alt'] }).name);
  return <>
    {onMove && <p id={hintId} className="project-list-sr-only">{reorderHint}</p>}
    <DndContext sensors={sensors} collisionDetection={closestCenter}
      accessibility={{ screenReaderInstructions: { draggable: reorderHint }, announcements: {
        onDragStart: ({ active }) => t.dragging(dragName(active.id)),
        onDragOver: ({ active, over }) => over ? t.moved(dragName(active.id), projects.findIndex(project => project.path === over.id) + 1, projects.length) : undefined,
        onDragEnd: () => undefined, onDragCancel: () => t.dragCancelled,
      } }}
      onDragStart={() => setDrag(true)} onDragCancel={() => setDrag(false)}
      onDragEnd={({ active, over }) => {
        setDrag(false);
        const project = projects.find(entry => entry.path === active.id);
        if (project && over) move(project, projects.findIndex(entry => entry.path === over.id));
      }}>
      <SortableContext items={projects.map(project => project.path)} strategy={verticalListSortingStrategy}>
        <ul ref={list} className={`mission-control-workspace-list project-list--${kind}`} aria-label={t[kind]} aria-busy={pending || changing} data-dragging={dragging || undefined}>
          {projects.map((project, index) => <ProjectRow key={project.path} project={project} disabled={busy} switching={switching === project.path}
            actionsDisabled={busy || actionsDisabled} onMoveUp={onMove && index > 0 ? () => move(project, index - 1) : undefined}
            onMoveDown={onMove && index < projects.length - 1 ? () => move(project, index + 1) : undefined}
            shortcut={kind === 'workspace' && index < 9 ? index + 1 : null} hintId={onMove ? hintId : undefined} sortable={!!onMove} moveButtons={moveButtons && !!onMove}
            kind={kind} onOpen={() => onOpen(project.path)}
            onRemove={onRemove ? () => void change(() => onRemove(project.path), project, index) : undefined}
            onPin={onPin && !project.pinned ? () => void change(() => onPin(project.path), project, index) : undefined}
            onKeyDown={event => {
              if (event.isDefaultPrevented() || event.nativeEvent.isComposing) return;
              const rows = Array.from((navigationRef?.current ?? list.current)?.querySelectorAll<HTMLButtonElement>('.mission-control-workspace-open') ?? []);
              const local = event.altKey;
              const command = projectListCommand(event, local ? index : rows.indexOf(event.currentTarget), local ? projects.length : rows.length);
              if (!command || (command.kind === 'move' && !onMove) || (command.kind === 'remove' && !onRemove)) return;
              event.preventDefault(); event.stopPropagation();
              if (command.kind === 'focus') moveFocus(rows[command.index]);
              else if (command.kind === 'move') move(project, command.index);
              else if (onRemove) void change(() => onRemove(project.path), project, index);
            }} />)}
        </ul>
      </SortableContext>
    </DndContext>
    <span className="project-list-sr-only" role="status">{announcement}</span>
  </>;
}

function ProjectRow({ project, disabled, actionsDisabled, switching, shortcut, hintId, sortable: canSort, moveButtons, kind, onOpen, onRemove, onPin, onMoveUp, onMoveDown, onKeyDown }: {
  project: ProjectListEntry; disabled: boolean; switching: boolean; shortcut: number | null; hintId?: string; sortable: boolean;
  actionsDisabled: boolean; moveButtons: boolean; onMoveUp?: () => void; onMoveDown?: () => void;
  kind: 'workspace' | 'recent'; onOpen: () => void; onRemove?: () => void; onPin?: () => void;
  onKeyDown: React.KeyboardEventHandler<HTMLButtonElement>;
}) {
  const t = useText(text);
  const name = projectName(project.path, project.name);
  const sortable = useSortable({ id: project.path, disabled: actionsDisabled || !canSort });
  const remove = kind === 'workspace' ? t.remove : t.removeRecent;
  return <li ref={sortable.setNodeRef} className={'mission-control-workspace-row' + (project.current ? ' is-current' : '')
    + (project.missing ? ' is-missing' : '') + (sortable.isDragging ? ' is-dragging' : '') + (onPin ? ' has-pin' : '') + (moveButtons ? ' has-order' : '')}
    style={{ transform: sortable.transform ? `translate3d(0, ${sortable.transform.y}px, 0)` : undefined,
      transition: sortable.transition ? 'transform var(--motion-feedback) var(--ease-out)' : undefined }}>
    <button ref={sortable.setActivatorNodeRef} type="button" className="mission-control-project-row mission-control-workspace-open"
      title={project.path} data-path={project.path} aria-disabled={disabled || project.current || project.missing}
      aria-label={`${name}: ${project.path}${project.missing ? ` — ${t.missing}` : ''}`} aria-current={project.current ? 'true' : undefined}
      aria-busy={switching} aria-describedby={hintId} aria-keyshortcuts={((shortcut ? `Control+${shortcut} ` : '') + (canSort ? 'Alt+ArrowUp Alt+ArrowDown' : '')).trim() || undefined}
      onMouseDown={event => sortable.listeners?.onMouseDown?.(event)} onTouchStart={event => sortable.listeners?.onTouchStart?.(event)}
      onClick={event => {
        const selection = window.getSelection();
        if (event.detail && selection && !selection.isCollapsed && selection.containsNode(event.currentTarget, true)) return;
        if (!disabled && !project.current && !sortable.isDragging) onOpen();
      }} onKeyDown={onKeyDown}>
      <ProjectTile name={name}>{switching && <LoaderCircle className="spin" size={16} />}</ProjectTile>
      <div className="mission-control-workspace-copy"><strong title={name}>{name}</strong>
        <span className="mission-control-workspace-path" title={project.path} onMouseDown={event => event.stopPropagation()} onTouchStart={event => event.stopPropagation()}><bdi>{project.path}</bdi></span>
        <span hidden={!project.missing}><ReservedText className="mission-control-workspace-missing" values={{ en: text.en.missing, ru: text.ru.missing }} /></span>
      </div>
      {kind === 'recent' && project.lastOpened && <time className="project-list-when" dateTime={project.lastOpened} title={project.lastOpened}>
        <ReservedText values={{ en: relativeTimeAgo(project.lastOpened, 'en', 'calendar'), ru: relativeTimeAgo(project.lastOpened, 'ru', 'calendar') }} />
      </time>}
      {shortcut && <Keys className="shortcuts-panel-key" combo={{ key: `Digit${shortcut}`, modifiers: ['control'] }} ariaHidden />}
      {project.current && <Check className="mission-control-workspace-current" size={14} aria-label={t.current} />}
    </button>
    {onPin && <button type="button" className="mission-control-workspace-remove project-list-pin control control-ghost" disabled={actionsDisabled} title={t.pin} aria-label={`${t.pin}: ${name}`} onClick={onPin}><Pin size={14} aria-hidden="true" /></button>}
    {moveButtons && <>
      <button type="button" className="mission-control-workspace-remove project-list-up control control-ghost" disabled={actionsDisabled || !onMoveUp} title={t.moveUp} aria-label={`${t.moveUp}: ${name}`} onClick={onMoveUp}><ChevronUp size={14} aria-hidden="true" /></button>
      <button type="button" className="mission-control-workspace-remove project-list-down control control-ghost" disabled={actionsDisabled || !onMoveDown} title={t.moveDown} aria-label={`${t.moveDown}: ${name}`} onClick={onMoveDown}><ChevronDown size={14} aria-hidden="true" /></button>
    </>}
    {onRemove && <button type="button" className="mission-control-workspace-remove project-list-remove control control-ghost" disabled={actionsDisabled} title={remove} aria-label={`${remove}: ${name}`} onClick={onRemove}><X size={14} aria-hidden="true" /></button>}
  </li>;
}

function useProjectClock(enabled: boolean) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let clock: ReturnType<typeof setInterval> | undefined;
    const stop = () => clearInterval(clock);
    const resume = () => {
      stop();
      if (document.hidden) return;
      tick(value => value + 1);
      clock = setInterval(() => tick(value => value + 1), 60_000);
    };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('focus', resume);
    window.addEventListener('pageshow', resume);
    window.addEventListener('pagehide', stop);
    resume();
    return () => {
      stop(); document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('focus', resume); window.removeEventListener('pageshow', resume); window.removeEventListener('pagehide', stop);
    };
  }, [enabled]);
}

function useProjectRefresh(onRefresh: ProjectListProps['onRefresh'], busy: boolean) {
  const latest = useRef({ onRefresh, busy });
  latest.current = { onRefresh, busy };
  useEffect(() => {
    let refreshing = false;
    const refresh = async () => {
      if (document.hidden || refreshing || latest.current.busy || !latest.current.onRefresh) return;
      refreshing = true;
      try { await latest.current.onRefresh(); }
      catch { /* 2026-11-13: a focus refresh must not replace feedback from an explicit action. */ }
      finally { refreshing = false; }
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, []);
}
