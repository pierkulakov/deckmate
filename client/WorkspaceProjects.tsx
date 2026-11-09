import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { DndContext, MouseSensor, TouchSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Check, ChevronDown, FolderOpen, LoaderCircle, Plus, X } from 'lucide-react';
import { desktopBoard, hasWorkspace, type DesktopRecentProject, type DesktopWorkspaceBridge, type DesktopWorkspaceProject, type DesktopWorkspaceResult, type DesktopWorkspaceSource } from './desktop-bridge.ts';
import { defineText, useText } from './i18n.ts';
import { compactPath, OpenStartScreen, ProjectTile, RecentProjects, useProjectNavigation } from './RecentProjects.tsx';

const text = defineText({
  workspace: 'Workspace', add: 'Add project', remove: 'Remove from workspace',
  removeNamed: (name: string) => `Remove from workspace: ${name}`,
  addCurrent: 'Add current project', chooseFolder: 'Choose folder…', fromRecent: 'From recent',
  empty: 'Pin the projects you work on and switch between them in one click.',
  missing: 'Folder not found', current: 'Current project', loading: 'Loading projects…', saving: 'Saving workspace…',
  loadFailed: 'Could not load the workspace. Try again.', recentFailed: 'Could not load recent projects.',
  noRecent: 'No other recent projects to add.', retry: 'Try again',
  changeFailed: 'Could not update the workspace. Try again.',
  notRecent: 'This project is no longer in recent projects. Choose its folder instead.',
  notInWorkspace: 'This project is no longer in the workspace. Reload the list.',
  invalidPath: 'Choose the project folder again.', forbidden: 'The desktop connection is unavailable. Reopen the panel and try again.',
  limit: 'The workspace holds up to 30 projects. Remove one to add another.',
  reorderHint: 'Drag to reorder, or focus a project and press Alt+Arrow Up or Alt+Arrow Down.',
  moved: (name: string, position: number, count: number) => `${name}: position ${position} of ${count}.`,
  dragging: (name: string) => `Moving ${name}.`, dragCancelled: 'Move cancelled.',
  added: 'Project added to workspace.', removed: 'Project removed from workspace.',
}, {
  workspace: 'Рабочее пространство', add: 'Добавить проект', remove: 'Убрать из пространства',
  removeNamed: (name: string) => `Убрать из пространства: ${name}`,
  addCurrent: 'Добавить текущий проект', chooseFolder: 'Выбрать папку…', fromRecent: 'Из недавних',
  empty: 'Закрепите проекты, с которыми работаете, — переключаться между ними можно в один клик.',
  missing: 'Папка не найдена', current: 'Текущий проект', loading: 'Загружаем проекты…', saving: 'Сохраняем пространство…',
  loadFailed: 'Не удалось загрузить рабочее пространство. Попробуйте ещё раз.', recentFailed: 'Не удалось загрузить недавние проекты.',
  noRecent: 'Других недавних проектов для добавления нет.', retry: 'Повторить',
  changeFailed: 'Не удалось обновить рабочее пространство. Попробуйте ещё раз.',
  notRecent: 'Этого проекта больше нет в недавних. Выберите его папку.',
  notInWorkspace: 'Этого проекта больше нет в пространстве. Обновите список.',
  invalidPath: 'Выберите папку проекта ещё раз.', forbidden: 'Нет связи с оболочкой. Откройте панель заново и повторите попытку.',
  limit: 'В пространстве может быть до 30 проектов. Уберите один, чтобы добавить другой.',
  reorderHint: 'Перетащите проект или выделите его и нажмите Alt+стрелка вверх или Alt+стрелка вниз.',
  moved: (name: string, position: number, count: number) => `${name}: позиция ${position} из ${count}.`,
  dragging: (name: string) => `Перемещаем ${name}.`, dragCancelled: 'Перемещение отменено.',
  added: 'Проект добавлен в рабочее пространство.', removed: 'Проект убран из пространства.',
});

// Windows drive and UNC paths are case-insensitive; Unix project names retain their case.
function pathKey(path: string): string {
  return /^(?:[a-z]:[/\\]|\\\\)/iu.test(path) ? path.replaceAll('/', '\\').toLowerCase() : path;
}

export function WorkspaceProjects({ open, disabled }: { open: boolean; disabled: boolean }) {
  const board = desktopBoard();
  if (!board) return null;
  if (!hasWorkspace(board)) return <RecentProjects open={open} disabled={disabled} />;
  return <Workspace board={board} open={open} disabled={disabled} />;
}

function Workspace({ board, open, disabled }: { board: DesktopWorkspaceBridge; open: boolean; disabled: boolean }) {
  const t = useText(text);
  const [projects, setProjects] = useState<DesktopWorkspaceProject[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const navigation = useProjectNavigation(board);
  const locked = useRef(false);
  const list = useRef<HTMLUListElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const focusAfterChange = useRef<string | null>(null);
  const hintId = useId();
  const headingId = useId();
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }));
  const busy = disabled || pending || navigation.busy || projects === null;

  useEffect(() => {
    if (!open) return;
    let active = true;
    setProjects(null);
    setLoadFailed(false);
    setFailure(null);
    Promise.resolve().then(() => board.workspaceProjects()).then(
      next => { if (active) setProjects(next); },
      () => { if (active) setLoadFailed(true); },
    );
    return () => { active = false; };
  }, [board, open, revision]);

  useLayoutEffect(() => {
    if (pending || focusAfterChange.current === null) return;
    const path = focusAfterChange.current;
    focusAfterChange.current = null;
    const row = Array.from(list.current?.querySelectorAll<HTMLButtonElement>('.mission-control-workspace-open') ?? [])
      .find(button => button.dataset.path === path);
    (row ?? addButton.current)?.focus();
  });

  async function change(action: () => Promise<DesktopWorkspaceResult>, success: (next: DesktopWorkspaceProject[]) => string) {
    if (busy || locked.current) return;
    locked.current = true;
    setPending(true);
    setFailure(null);
    navigation.clearFailure();
    try {
      const result = await action();
      if (result.ok) { setProjects(result.projects); setAnnouncement(success(result.projects)); }
      else if (result.code !== 'cancelled') setFailure(result.code);
    } catch { setFailure('unknown'); }
    finally { locked.current = false; setPending(false); }
  }

  const add = (source: DesktopWorkspaceSource) => {
    focusAfterChange.current = '';
    void change(() => board.addToWorkspace(source), () => t.added);
  };
  const remove = (project: DesktopWorkspaceProject, index: number) => void change(() => board.removeFromWorkspace(project.path), next => {
    focusAfterChange.current = next[Math.min(index, next.length - 1)]?.path ?? '';
    return t.removed;
  });
  const move = (project: DesktopWorkspaceProject, index: number) => {
    if (!projects || index < 0 || index >= projects.length || projects[index].path === project.path) return;
    void change(() => board.moveInWorkspace(project.path, index), next => {
      focusAfterChange.current = project.path;
      return t.moved(project.name, next.findIndex(entry => entry.path === project.path) + 1, next.length);
    });
  };
  const failureMessages: Record<string, string> = {
    'not-recent': t.notRecent, 'not-in-workspace': t.notInWorkspace, 'invalid-path': t.invalidPath,
    missing: t.missing, forbidden: t.forbidden,
  };
  const failureText = failure ? failureMessages[failure] ?? t.changeFailed : navigation.failureText;
  const entries = projects ?? [];
  const full = entries.length >= 30;
  const dragName = (id: string | number) => entries.find(project => project.path === id)?.name ?? '';

  return <section className="mission-control-workspace" aria-labelledby={headingId}>
    <h3 id={headingId}>{t.workspace}</h3>
    <p id={hintId} className="sr-only">{t.reorderHint}</p>
    {projects === null && !loadFailed && <p className="mission-control-workspace-message" role="status"><LoaderCircle size={14} className="spin" aria-hidden="true" />{t.loading}</p>}
    {loadFailed && <p className="mission-control-recent-failure" role="alert">{t.loadFailed} <button type="button" className="mission-control-retry" onClick={() => setRevision(value => value + 1)}>{t.retry}</button></p>}
    {projects?.length === 0 && <p className="mission-control-workspace-empty">{t.empty}</p>}
    {entries.length > 0 && <DndContext sensors={sensors} collisionDetection={closestCenter}
      accessibility={{ screenReaderInstructions: { draggable: t.reorderHint }, announcements: {
        onDragStart: ({ active }) => t.dragging(dragName(active.id)),
        onDragOver: ({ active, over }) => over ? t.moved(dragName(active.id), entries.findIndex(project => project.path === over.id) + 1, entries.length) : undefined,
        onDragEnd: () => undefined, onDragCancel: () => t.dragCancelled,
      } }}
      onDragStart={() => setDragging(true)} onDragCancel={() => setDragging(false)}
      onDragEnd={({ active, over }) => {
        setDragging(false);
        const project = entries.find(entry => entry.path === active.id);
        if (project && over) move(project, entries.findIndex(entry => entry.path === over.id));
      }}>
      <SortableContext items={entries.map(project => project.path)} strategy={verticalListSortingStrategy}>
        <ul ref={list} className="mission-control-workspace-list" aria-label={t.workspace} aria-busy={pending} data-dragging={dragging || undefined}>
          {entries.map((project, index) => <WorkspaceRow key={project.path} project={project} disabled={busy} hintId={hintId}
            switching={navigation.switching === project.path} onSwitch={() => { setFailure(null); void navigation.switchTo(project.path); }}
            onRemove={() => remove(project, index)} onMove={direction => move(project, index + direction)} />)}
        </ul>
      </SortableContext>
    </DndContext>}
    {failureText && <p className="mission-control-recent-failure" role="alert">{failureText}
      {failure === 'not-in-workspace' && <> <button type="button" className="mission-control-retry" onClick={() => setRevision(value => value + 1)}>{t.retry}</button></>}
    </p>}
    <div className="mission-control-workspace-actions">
      <WorkspaceAddMenu board={board} projects={entries} disabled={busy || dragging || full} triggerRef={addButton} onAdd={add} />
      {pending && <LoaderCircle className="spin" size={14} aria-label={t.saving} />}
    </div>
    {full && <p className="mission-control-workspace-note">{t.limit}</p>}
    <OpenStartScreen disabled={disabled || pending || navigation.busy || dragging} busy={navigation.openingStart} onOpen={() => { setFailure(null); void navigation.openStart(); }} />
    <span className="sr-only" role="status">{announcement}</span>
  </section>;
}

function WorkspaceRow({ project, disabled, switching, hintId, onSwitch, onRemove, onMove }: {
  project: DesktopWorkspaceProject; disabled: boolean; switching: boolean; hintId: string;
  onSwitch: () => void; onRemove: () => void; onMove: (direction: number) => void;
}) {
  const t = useText(text);
  const sortable = useSortable({ id: project.path, disabled });
  const unavailable = disabled || project.current || project.missing;
  return <li ref={sortable.setNodeRef} className={'mission-control-workspace-row' + (project.current ? ' is-current' : '')
    + (project.missing ? ' is-missing' : '') + (sortable.isDragging ? ' is-dragging' : '')}
    style={{ transform: sortable.transform ? `translate3d(0, ${sortable.transform.y}px, 0)` : undefined,
      transition: sortable.transition ? 'transform var(--motion-feedback) var(--ease-out)' : undefined }}>
    <button ref={sortable.setActivatorNodeRef} type="button" className="mission-control-project-row mission-control-workspace-open"
      title={project.path} data-path={project.path} aria-disabled={unavailable} aria-current={project.current ? 'true' : undefined}
      aria-busy={switching} aria-describedby={hintId} aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
      onMouseDown={event => sortable.listeners?.onMouseDown?.(event)} onTouchStart={event => sortable.listeners?.onTouchStart?.(event)}
      onClick={() => { if (!unavailable && !sortable.isDragging) onSwitch(); }}
      onKeyDown={event => {
        if (!event.altKey || event.ctrlKey || event.metaKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        if (!disabled) onMove(event.key === 'ArrowUp' ? -1 : 1);
      }}>
      <ProjectTile name={project.name}>{switching && <LoaderCircle className="spin" size={16} />}</ProjectTile>
      <div className="mission-control-workspace-copy"><strong title={project.name}>{project.name}</strong>
        <span className="mission-control-workspace-path">{compactPath(project.path)}</span>
        {project.missing && <span className="mission-control-workspace-missing">{t.missing}</span>}
      </div>
      {project.current && <Check className="mission-control-workspace-current" size={14} aria-label={t.current} />}
    </button>
    <button type="button" className="mission-control-workspace-remove" disabled={disabled} title={t.remove} aria-label={t.removeNamed(project.name)} onClick={onRemove}><X size={14} aria-hidden="true" /></button>
  </li>;
}

function WorkspaceAddMenu({ board, projects, disabled, triggerRef, onAdd }: {
  board: DesktopWorkspaceBridge; projects: DesktopWorkspaceProject[]; disabled: boolean;
  triggerRef: RefObject<HTMLButtonElement | null>; onAdd: (source: DesktopWorkspaceSource) => void;
}) {
  const t = useText(text);
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<DesktopRecentProject[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setRecent(null); setFailed(false);
    Promise.resolve().then(() => board.recentProjects()).then(
      next => { if (active) setRecent(next); },
      () => { if (active) setFailed(true); },
    );
    return () => { active = false; };
  }, [board, open, revision]);
  const paths = new Set(projects.map(project => pathKey(project.path)));
  const available = recent?.filter(project => !project.current && !paths.has(pathKey(project.path))) ?? [];
  const select = (source: DesktopWorkspaceSource) => { setOpen(false); onAdd(source); };
  return <DropdownMenu.Root modal={false} open={open} onOpenChange={next => setOpen(next && !disabled)}>
    <DropdownMenu.Trigger ref={triggerRef} type="button" className="mission-control-workspace-add" disabled={disabled}>
      <Plus size={15} aria-hidden="true" />{t.add}<ChevronDown size={13} aria-hidden="true" />
    </DropdownMenu.Trigger>
    {/* Keep the menu inside the sheet's modal focus boundary. Popper still positions it over the rows. */}
    <DropdownMenu.Content className="dropdown mission-control-workspace-menu" align="start" sideOffset={6} collisionPadding={16}
      onEscapeKeyDown={event => { event.preventDefault(); event.stopPropagation(); setOpen(false); }}>
      {!projects.some(project => project.current) && <DropdownMenu.Item className="dropdown-item" onSelect={() => select({ kind: 'current' })}><Plus size={15} aria-hidden="true" />{t.addCurrent}</DropdownMenu.Item>}
      <DropdownMenu.Item className="dropdown-item" onSelect={() => select({ kind: 'dialog' })}><FolderOpen size={15} aria-hidden="true" />{t.chooseFolder}</DropdownMenu.Item>
      <DropdownMenu.Separator className="mission-control-workspace-separator" />
      <DropdownMenu.Group aria-label={t.fromRecent}><DropdownMenu.Label className="dropdown-label">{t.fromRecent}</DropdownMenu.Label>
        {!recent && !failed && <p className="mission-control-workspace-note" role="status">{t.loading}</p>}
        {failed && <><p className="mission-control-recent-failure" role="alert">{t.recentFailed}</p><DropdownMenu.Item className="dropdown-item" onSelect={event => { event.preventDefault(); setRevision(value => value + 1); }}>{t.retry}</DropdownMenu.Item></>}
        {recent && available.length === 0 && <p className="mission-control-workspace-note">{t.noRecent}</p>}
        {available.map(project => <DropdownMenu.Item key={project.path} className="dropdown-item mission-control-workspace-recent" title={project.path} textValue={project.name} onSelect={() => select({ kind: 'recent', path: project.path })}>
          <ProjectTile name={project.name} /><span><strong>{project.name}</strong><small>{compactPath(project.path)}</small></span>
        </DropdownMenu.Item>)}
      </DropdownMenu.Group>
    </DropdownMenu.Content>
  </DropdownMenu.Root>;
}
