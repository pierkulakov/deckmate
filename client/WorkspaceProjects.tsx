import { moveFocus } from './focus.ts';
import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ChevronDown, FolderOpen, LoaderCircle, Plus } from 'lucide-react';
import { desktopBoard, type DesktopFailure, type DesktopRecentProject, type DesktopBoardBridge, type DesktopWorkspaceProject, type DesktopProjectsResult, type DesktopWorkspaceSource } from './desktop-bridge.ts';
import { defineText, useText } from './i18n.ts';
import { compactPath, OpenStartScreen, ProjectTile, useProjectNavigation } from './RecentProjects.tsx';
import { ProjectList } from './ProjectList.tsx';
import { ProjectListFeedback } from './ProjectListFeedback.tsx';
import { projectPathKey } from './project-path.ts';

const text = defineText({
  workspace: 'Workspace', add: 'Add project',
  addCurrent: 'Add current project', chooseFolder: 'Choose folder…', fromRecent: 'From recent',
  empty: 'Pin the projects you work on and switch between them in one click.',
  loading: 'Loading projects…', saving: 'Saving workspace…',
  loadFailed: 'Could not load the workspace. Try again.', recentFailed: 'Could not load recent projects.',
  noRecent: 'No other recent projects to add.', retry: 'Try again',
  changeFailed: 'Could not update the workspace. Try again.',
  limit: 'The workspace holds up to 30 projects. Remove one to add another.',
  added: 'Project added to workspace.', removed: 'Project removed from workspace.',
}, {
  workspace: 'Рабочее пространство', add: 'Добавить проект',
  addCurrent: 'Добавить текущий проект', chooseFolder: 'Выбрать папку…', fromRecent: 'Из недавних',
  empty: 'Закрепите проекты, с которыми работаете, — переключаться между ними можно в один клик.',
  loading: 'Загружаем проекты…', saving: 'Сохраняем пространство…',
  loadFailed: 'Не удалось загрузить рабочее пространство. Попробуйте ещё раз.', recentFailed: 'Не удалось загрузить недавние проекты.',
  noRecent: 'Других недавних проектов для добавления нет.', retry: 'Повторить',
  changeFailed: 'Не удалось обновить рабочее пространство. Попробуйте ещё раз.',
  limit: 'В пространстве может быть до 30 проектов. Уберите один, чтобы добавить другой.',
  added: 'Проект добавлен в рабочее пространство.', removed: 'Проект убран из пространства.',
});

export function WorkspaceProjects({ open, disabled }: { open: boolean; disabled: boolean }) {
  const board = desktopBoard();
  if (!board) return null;
  return <Workspace board={board} open={open} disabled={disabled} />;
}

function Workspace({ board, open, disabled }: { board: DesktopBoardBridge; open: boolean; disabled: boolean }) {
  const t = useText(text);
  const [projects, setProjects] = useState<DesktopWorkspaceProject[] | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [loadFailure, setLoadFailure] = useState<DesktopFailure | null>(null);
  const [revision, setRevision] = useState(0);
  const [failure, setFailure] = useState<DesktopFailure | null>(null);
  const [pending, setPending] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const navigation = useProjectNavigation(board);
  const locked = useRef(false);
  const addButton = useRef<HTMLButtonElement>(null);
  const focusAdd = useRef(false);
  const retryChange = useRef<() => void>(() => {});
  const generation = useRef(0);
  const headingId = useId();
  const busy = disabled || pending || navigation.busy || projects === null;

  useEffect(() => {
    if (!open) return;
    let active = true;
    setProjects(null);
    setLoadFailure(null);
    setFailure(null);
    Promise.resolve().then(() => board.workspaceProjects()).then(
      next => {
        if (!active) return;
        if (next.ok) { setProjects(next.projects); setCurrent(next.current); }
        else setLoadFailure(next);
      },
      error => { if (active) setLoadFailure({ ok: false, code: 'unknown', message: error instanceof Error ? error.message : undefined }); },
    );
    return () => { active = false; generation.current++; };
  }, [board, open, revision]);

  useLayoutEffect(() => {
    if (pending || !focusAdd.current) return;
    focusAdd.current = false;
    moveFocus(addButton.current);
  });

  async function change(action: () => Promise<DesktopProjectsResult>, announcement = ''): Promise<boolean> {
    if (busy || locked.current) return false;
    generation.current++;
    locked.current = true;
    setPending(true);
    setFailure(null);
    navigation.clearFailure();
    try {
      const result = await action();
      if (result.ok) { setProjects(result.projects); setCurrent(result.current); setAnnouncement(announcement); return true; }
      if (result.code !== 'cancelled') setFailure(result);
    } catch (error) { setFailure({ ok: false, code: 'unknown', message: error instanceof Error ? error.message : undefined }); }
    finally { locked.current = false; setPending(false); }
    retryChange.current = () => { void change(action, announcement); };
    return false;
  }

  const add = (source: DesktopWorkspaceSource) => {
    focusAdd.current = true;
    void change(() => board.addToWorkspace(source), t.added);
  };
  async function refreshAvailability() {
    const before = generation.current;
    const result = await board.workspaceProjects();
    if (!result.ok || before !== generation.current) return;
    setProjects(previous => previous?.map(project => {
      const updated = result.projects.find(entry => projectPathKey(entry.path) === projectPathKey(project.path));
      return updated ? { ...project, missing: updated.missing } : project;
    }) ?? null);
  }
  async function openProject(path: string) {
    generation.current++;
    setFailure(null);
    const result = await navigation.switchTo(path);
    if (result?.code === 'missing') setProjects(previous => previous?.map(project => project.path === path ? { ...project, missing: true } : project) ?? null);
  }
  const entries = projects ?? [];
  const full = entries.length >= 30;

  return <section className="mission-control-workspace" aria-labelledby={headingId}>
    <h3 id={headingId}>{t.workspace}</h3>
    {projects === null && !loadFailure && <p className="mission-control-workspace-message" role="status"><LoaderCircle size={14} className="spin" aria-hidden="true" />{t.loading}</p>}
    <ProjectListFeedback failure={loadFailure} fallback={{ en: text.en.loadFailed, ru: text.ru.loadFailed }} onRetry={() => setRevision(value => value + 1)} />
    {projects?.length === 0 && <p className="mission-control-workspace-empty">{t.empty}</p>}
    {projects && <ProjectList projects={entries} disabled={busy} pending={pending} switching={navigation.switching} shortcuts="native"
      onOpen={path => void openProject(path)} onRemove={path => change(() => board.removeFromWorkspace(path), t.removed)}
      onMove={(path, index) => change(() => board.moveInWorkspace(path, index))} onRefresh={refreshAvailability}
      onDraggingChange={setDragging} fallbackFocusRef={addButton} />}
    <ProjectListFeedback failure={failure ?? navigation.failure} disabled={busy}
      fallback={failure ? { en: text.en.changeFailed, ru: text.ru.changeFailed } : navigation.fallback}
      onRetry={() => {
        if (failure?.code === 'not-in-workspace') setRevision(value => value + 1);
        else if (failure) retryChange.current();
        else { generation.current++; navigation.retry(); }
      }} />
    <div className="mission-control-workspace-actions">
      <WorkspaceAddMenu board={board} projects={entries} current={current} disabled={busy || dragging || full} triggerRef={addButton} onAdd={add} />
      {pending && <LoaderCircle className="spin" size={14} aria-label={t.saving} />}
    </div>
    {full && <p className="mission-control-workspace-note">{t.limit}</p>}
    <OpenStartScreen disabled={disabled || pending || navigation.busy || dragging} busy={navigation.openingStart} onOpen={() => { generation.current++; setFailure(null); void navigation.openStart(); }} />
    <span className="sr-only" role="status">{announcement}</span>
  </section>;
}

function WorkspaceAddMenu({ board, projects, current, disabled, triggerRef, onAdd }: {
  board: DesktopBoardBridge; projects: DesktopWorkspaceProject[]; current: string | null; disabled: boolean;
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
      next => {
        if (!active) return;
        if (next.ok) setRecent(next.projects);
        else setFailed(true);
      },
      () => { if (active) setFailed(true); },
    );
    return () => { active = false; };
  }, [board, open, revision]);
  const paths = new Set(projects.map(project => projectPathKey(project.path)));
  const available = recent?.filter(project => !project.current && !paths.has(projectPathKey(project.path))) ?? [];
  const select = (source: DesktopWorkspaceSource) => { setOpen(false); onAdd(source); };
  return <DropdownMenu.Root modal={false} open={open} onOpenChange={next => setOpen(next && !disabled)}>
    <DropdownMenu.Trigger ref={triggerRef} type="button" className="mission-control-workspace-add control" disabled={disabled}>
      <Plus size={15} aria-hidden="true" />{t.add}<ChevronDown size={13} aria-hidden="true" />
    </DropdownMenu.Trigger>
    {/* Keep the menu inside the sheet's modal focus boundary. Popper still positions it over the rows. */}
    <DropdownMenu.Content className="dropdown mission-control-workspace-menu" align="start" sideOffset={6} collisionPadding={16}
      onEscapeKeyDown={event => { event.preventDefault(); event.stopPropagation(); setOpen(false); }}>
      {current && !projects.some(project => project.current) && <DropdownMenu.Item className="dropdown-item" onSelect={() => select({ kind: 'current' })}><Plus size={15} aria-hidden="true" />{t.addCurrent}</DropdownMenu.Item>}
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
