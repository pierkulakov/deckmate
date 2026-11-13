import { useEffect, useRef, useState } from 'react';
import { FolderOpen, House, Palette, Plus } from 'lucide-react';
import type { DesktopFailure, DesktopProjectsResult, DesktopResult, DesktopShell, DesktopState, DesktopStatus } from '../desktop-bridge.ts';
import { DeckmateMark } from '../components/DeckmateMark.tsx';
import { Keys } from '../components/Keys.tsx';
import { defineText, setLang } from '../i18n.ts';
import { moveFocus } from '../focus.ts';
import { ProjectList } from '../ProjectList.tsx';
import { projectName, projectPathKey } from '../project-path.ts';
import { ReservedText } from '../ReservedText.tsx';
import { ThemeToggle } from '../ThemeToggle.tsx';
import { LanguageToggle } from '../LanguageToggle.tsx';
import { CreateProject } from './CreateProject.tsx';
import { FirstRun } from './FirstRun.tsx';
import { StatusLine, type StartStatus } from './StatusLine.tsx';

const text = defineText({
  tagline: 'A project board for your Markdown files.',
  ownership: 'Your files stay yours: plain Markdown in your folder. No account or cloud required.',
  openFolder: 'Open folder…', openHint: 'Choose an existing folder. Network folders must be selected in the folder dialog.',
  createProject: 'Create project…', createHint: 'Choose a new or empty folder for a demo project. Existing files are never replaced.',
  lastProject: 'Last project', recent: 'Recent projects', workspace: 'Workspace', addProject: 'Add project…',
  recentEmpty: 'Nothing opened yet. Projects you open appear here.', recentEmptyOther: 'No other recent projects. Open another folder to add it here.',
  workspaceEmpty: 'Pin the projects you work on and switch between them in one click.',
  reorderHint: 'Move with Alt+Arrow Up or Down',
}, {
  tagline: 'Доска задач и заметок на ваших Markdown-файлах.',
  ownership: 'Файлы остаются вашими: обычный Markdown в вашей папке. Без аккаунта и облака.',
  openFolder: 'Открыть папку…', openHint: 'Выберите существующую папку. Сетевые папки нужно выбирать через диалог.',
  createProject: 'Создать проект…', createHint: 'Выберите новую или пустую папку для демо-проекта. Существующие файлы не заменяются.',
  lastProject: 'Последний проект', recent: 'Недавние проекты', workspace: 'Рабочее пространство', addProject: 'Добавить проект…',
  recentEmpty: 'Пока ничего не открыто. Открытые проекты появятся здесь.', recentEmptyOther: 'Других недавних проектов пока нет. Откройте другую папку, чтобы добавить её сюда.',
  workspaceEmpty: 'Закрепите проекты, с которыми работаете, — переключаться между ними можно в один клик.',
  reorderHint: 'Переместить: Alt+стрелка вверх или вниз',
});

type Projects = Pick<DesktopState, 'recent' | 'projects' | 'current' | 'lastProject' | 'version' | 'deckmateVersion'>;
type FolderAction = 'open' | 'create' | 'add';
const empty: Projects = { recent: [], projects: [], current: null, lastProject: null, version: '', deckmateVersion: '' };
const samePath = (a: string, b: string) => projectPathKey(a) === projectPathKey(b);
const failureOf = (error: unknown): DesktopFailure => ({ ok: false, code: 'unknown', message: error instanceof Error ? error.message : undefined });
const cancelled = (code?: string) => ['superseded', 'closed', 'cancelled'].includes(code ?? '');

export function StartScreen({ bridge, shortcuts = 'native' }: { bridge?: DesktopShell; shortcuts?: 'native' | 'local' }) {
  const [state, setState] = useState<Projects>(empty);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<StartStatus>(null);
  const [chosenFolder, setChosenFolder] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [readyToPrepare, setReadyToPrepare] = useState(false);
  const finishInitial = useRef<() => Promise<void>>(async () => {});
  const activeFolder = useRef<string | null>(null);
  const operation = useRef({ busy: false, folder: null as string | null, creating: false, generation: 0 });
  const openButton = useRef<HTMLButtonElement>(null);
  const createButton = useRef<HTMLButtonElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const sections = useRef<HTMLDivElement>(null);
  const refreshLock = useRef(false);
  const firstRun = !state.recent.length && !state.projects.length;
  const label = (key: keyof typeof text.en) => <ReservedText values={{ en: text.en[key], ru: text.ru[key] }} />;
  function fail(failure: DesktopFailure, retry?: () => void, folderAction?: FolderAction) {
    if (folderAction && ['missing', 'invalid-path', 'not-empty', 'create-failed'].includes(failure.code)) {
      setStatus({ phase: 'error', failure, recovery: { label: 'chooseFolder', action: () => void choose(folderAction) } });
    } else setStatus({ phase: 'error', failure, recovery: retry ? { label: 'retry', action: retry } : undefined });
  }

  function lock(value: boolean, folder: string | null = null, creating = false) {
    Object.assign(operation.current, { busy: value, folder, creating });
    setBusy(value); setOpening(folder);
  }
  function availability(folder: string, missing: boolean) {
    setState(previous => ({ ...previous,
      recent: previous.recent.map(entry => samePath(entry.path, folder) ? { ...entry, missing } : entry),
      projects: previous.projects.map(entry => samePath(entry.path, folder) ? { ...entry, missing } : entry),
    }));
  }
  async function refresh() {
    if (!bridge || operation.current.busy || refreshLock.current || document.hidden) return;
    refreshLock.current = true;
    const generation = operation.current.generation;
    try {
      const snapshot = await bridge.getState({ refresh: true });
      if (!snapshot.ok || operation.current.busy || generation !== operation.current.generation) return;
      for (const entry of [...snapshot.recent, ...snapshot.projects]) availability(entry.path, entry.missing);
    } finally { refreshLock.current = false; }
  }
  async function run(folder: string, action: () => Promise<DesktopResult>, creating = false) {
    if (operation.current.busy && !operation.current.folder) return;
    const generation = ++operation.current.generation;
    activeFolder.current = folder;
    setChosenFolder(null);
    lock(true, folder, creating);
    setStatus({ phase: 'starting', name: projectName(folder), creating });
    const retry = creating ? () => void choose('create') : () => void open(folder);
    try {
      const result = await action();
      if (generation !== operation.current.generation || result.ok) return;
      lock(false);
      if (cancelled(result.code)) { setStatus(null); return; }
      if (result.code === 'missing') availability(folder, true);
      fail(result, retry, creating ? 'create' : 'open');
    } catch (error) {
      if (generation !== operation.current.generation) return;
      lock(false); fail(failureOf(error), retry);
    }
  }
  const open = (folder: string) => bridge && run(folder, () => bridge.openProject(folder));
  function handleStatus(event: DesktopStatus) {
    const current = operation.current;
    if (cancelled(event.code)) return;
    const name = event.path ? projectName(event.path) : '';
    if (event.phase === 'starting') {
      const nativeLaunch = event.path && (!activeFolder.current || !samePath(activeFolder.current, event.path));
      // 2026-11-13: native menu launches bypass run; their starting event supersedes the pending IPC reply.
      if (nativeLaunch) { current.generation++; setChosenFolder(null); }
      const creating = !nativeLaunch && current.creating;
      activeFolder.current = event.path ?? activeFolder.current;
      if (event.path) availability(event.path, false);
      lock(true, event.path ?? current.folder, creating);
      setStatus({ phase: 'starting', name, creating });
      return;
    }
    if (activeFolder.current && event.path && !samePath(activeFolder.current, event.path)) return;
    if (event.phase === 'ready') setStatus({ phase: 'ready', name });
    else {
      const creating = current.creating || ['not-empty', 'create-failed'].includes(event.code ?? '');
      lock(false);
      if (event.path && event.code === 'missing') availability(event.path, true);
      fail({ ok: false, code: event.code ?? 'unknown', message: event.message }, event.path ? () => void open(event.path!) : undefined, creating ? 'create' : 'open');
    }
  }
  async function change(action: () => Promise<DesktopProjectsResult>, kind: 'workspace' | 'recent' | 'add', removed?: string): Promise<boolean> {
    if (operation.current.busy) return false;
    const generation = ++operation.current.generation;
    const retry = () => void change(action, kind, removed);
    lock(true);
    try {
      const result = await action();
      if (generation !== operation.current.generation) return false;
      if (!result.ok) {
        if (kind === 'add' && result.code === 'invalid-path' && state.projects.length >= 30) fail({ ...result, code: 'workspace-full' });
        else if (!cancelled(result.code)) fail(result, retry, kind === 'add' ? 'add' : undefined);
        return false;
      }
      setState(previous => {
        if (kind !== 'recent') return { ...previous, projects: result.projects, current: result.current };
        return { ...previous, recent: result.projects as DesktopState['recent'], current: result.current,
          lastProject: removed && samePath(previous.lastProject ?? '', removed) ? null : previous.lastProject };
      });
      setStatus({ phase: 'success', notice: kind === 'recent' ? 'removed' : 'updated' });
      return true;
    } catch (error) {
      if (generation === operation.current.generation) fail(failureOf(error), retry);
      return false;
    } finally { if (generation === operation.current.generation) lock(false); }
  }
  async function choose(kind: FolderAction) {
    if (!bridge || (operation.current.busy && (kind !== 'open' || !operation.current.folder))) return;
    try {
      const folder = await bridge.chooseFolder();
      if (!folder) return;
      if (typeof folder !== 'string') { if (!cancelled(folder.code)) fail(folder, () => void choose(kind), kind); return; }
      if (kind === 'open') await open(folder);
      else if (kind === 'create') setChosenFolder(folder);
      else await change(() => bridge.addToWorkspace(folder), 'add');
    } catch (error) { fail(failureOf(error), () => void choose(kind)); }
  }
  useEffect(() => {
    let active = true;
    let interacted = false;
    const initialFocus = document.activeElement;
    const interaction = () => { interacted = true; };
    for (const name of ['pointerdown', 'keydown', 'focusin']) document.addEventListener(name, interaction, true);
    const unsubscribe = bridge?.onStatus(handleStatus);
    const setInitialized = (initial: Projects) => {
      finishInitial.current = async () => {
        await window.prepareDeckmatePage?.();
        if (!active) return;
        setReady(true);
        const untouched = document.activeElement === document.body || document.activeElement === initialFocus;
        if (!interacted && untouched) moveFocus(initial.recent.length || initial.projects.length ? openButton.current : createButton.current);
      };
      setReadyToPrepare(true);
    };
    void (async () => {
      let initial = empty;
      try {
        if (!bridge) throw new Error('Desktop bridge unavailable');
        const snapshot = await bridge.getState();
        if (!active) return;
        if (snapshot.ok) {
          initial = snapshot;
          setState(snapshot);
          if (snapshot.language === 'en' || snapshot.language === 'ru') setLang(snapshot.language);
          window.dispatchEvent(new CustomEvent('deckmate:display', { detail: { theme: snapshot.theme } }));
        } else fail(snapshot);
      } catch (error) { if (active) fail(failureOf(error)); }
      if (!active) return;
      // 2026-11-13: wait for React's data commit before decoding the artwork and revealing the native window.
      setInitialized(initial);
    })();
    return () => {
      active = false; unsubscribe?.(); operation.current.generation++;
      for (const name of ['pointerdown', 'keydown', 'focusin']) document.removeEventListener(name, interaction, true);
    };
  }, [bridge]);
  useEffect(() => { if (readyToPrepare) void finishInitial.current(); }, [readyToPrepare]);

  const pinned = new Set(state.projects.map(entry => projectPathKey(entry.path)));
  const recentLast = state.recent.find(entry => samePath(entry.path, state.lastProject ?? ''));
  const pinnedLast = state.projects.find(entry => samePath(entry.path, state.lastProject ?? ''));
  let last = recentLast ?? pinnedLast;
  if (last) last = { ...last, missing: !!(recentLast?.missing || pinnedLast?.missing) };
  const recent = state.recent.filter(entry => !samePath(entry.path, state.lastProject ?? '') && !pinned.has(projectPathKey(entry.path)));
  const common = { disabled: busy && !opening, actionsDisabled: busy, switching: opening, navigationRef: sections, onOpen: (folder: string) => void open(folder) };
  const recentProps = { ...common, kind: 'recent' as const, fallbackFocusRef: openButton,
    onRemove: (folder: string) => change(() => bridge!.removeRecent(folder), 'recent', folder),
    onPin: (folder: string) => change(() => bridge!.addToWorkspace(folder), 'add') };
  const actions = [
    <div className="action" key="open"><button ref={openButton} type="button" className={`button button-${firstRun ? 'secondary' : 'primary'}`} id="open-folder" disabled={busy && !opening} onClick={() => void choose('open')}>
      <FolderOpen className="icon" aria-hidden="true" />{label('openFolder')}<Keys className="shortcut" combo={{ key: 'KeyO', modifiers: ['control'] }} ariaHidden />
    </button><p className="hint" id="open-hint">{label('openHint')}</p></div>,
    <div className="action" key="create"><button ref={createButton} type="button" className={`button button-${firstRun ? 'primary' : 'secondary'}`} id="create-project" disabled={busy} onClick={() => void choose('create')}>
      <Plus className="icon" aria-hidden="true" />{label('createProject')}
    </button><p className="hint" id="create-hint">{label('createHint')}</p></div>,
  ];
  if (firstRun) actions.reverse();
  return <main className={`launcher${firstRun ? ' is-first-run' : ''}`} id="launcher" aria-busy={ready ? undefined : true}>
    <section className="intro">
      <header className="brand"><DeckmateMark size={40} /><h1 className="wordmark">Deckmate</h1></header>
      <p className="tagline">{label('tagline')}</p><p className="ownership">{label('ownership')}</p>
      <div className="actions" id="actions">{actions}</div>
      <div className="table" aria-hidden="true"><div className="shelf">
        <div className="cover cover-art-deck"><span className="cover-backdrop" /><span className="cover-art" /><span className="cover-medallion"><Palette className="icon" /></span><span className="cover-title">Art</span><span className="cover-foot"><span className="cover-count">12</span></span></div>
        <div className="cover cover-buildings-deck"><span className="cover-backdrop" /><span className="cover-art" /><span className="cover-medallion"><House className="icon" /></span><span className="cover-title">Buildings</span><span className="cover-foot"><span className="cover-count">7</span></span></div>
      </div><div className="fan"><div className="fan-card fan-card-review" /><div className="fan-card fan-card-task" /><div className="fan-card fan-card-hero" /></div></div>
    </section>
    <div className="project-sections" ref={sections}>
      <FirstRun hidden={!firstRun || !!chosenFolder} />
      <CreateProject folder={chosenFolder} busy={busy} onBack={() => { setChosenFolder(null); moveFocus(createButton.current); }}
        onConfirm={() => { if (chosenFolder && !busy && bridge) void run(chosenFolder, () => bridge.createProject({ folder: chosenFolder }), true); }} />
      <section className="last-project" id="last-project" aria-labelledby="last-heading" hidden={!last}>
        <div className="recent-head"><h2 id="last-heading">{label('lastProject')}</h2></div>
        <div id="last-list"><ProjectList {...recentProps} projects={last ? [{ ...last, pinned: pinned.has(projectPathKey(last.path)) }] : []} /></div>
      </section>
      <section className="recent" id="recent" aria-labelledby="recent-heading" hidden={firstRun}>
        <div className="recent-head"><h2 id="recent-heading">{label('recent')}</h2><span className="count" id="recent-count" hidden={!recent.length}>{recent.length}</span></div>
        <div id="recent-list"><ProjectList {...recentProps} projects={recent} /></div>
        <p className="recent-empty" id="recent-empty" hidden={!!recent.length}>{label(state.recent.length ? 'recentEmptyOther' : 'recentEmpty')}</p>
      </section>
      <section className="workspace" id="workspace" aria-labelledby="workspace-heading" hidden={firstRun}>
        <div className="recent-head"><h2 id="workspace-heading">{label('workspace')}</h2><span className="count" id="workspace-count" hidden={!state.projects.length}>{state.projects.length}</span>
          <button ref={addButton} type="button" className="workspace-add" id="workspace-add" disabled={busy} onClick={() => void choose('add')}>{label('addProject')}</button></div>
        <p className="workspace-hint" id="workspace-hint" hidden={!state.projects.length}>{label('reorderHint')}</p>
        <div id="workspace-list"><ProjectList {...common} moveButtons projects={state.projects} shortcuts={shortcuts} fallbackFocusRef={firstRun ? openButton : addButton}
          onRemove={folder => change(() => bridge!.removeFromWorkspace(folder), 'workspace')}
          onMove={(folder, index) => change(() => bridge!.moveInWorkspace(folder, index), 'workspace')} onRefresh={refresh} /></div>
        <p className="workspace-empty" id="workspace-empty" hidden={!!state.projects.length}>{label('workspaceEmpty')}</p>
      </section>
    </div>
    <footer className="bar"><StatusLine status={status} />
      <div className="bar-tools"><LanguageToggle className="language-toggle" onError={fail} /><ThemeToggle onError={fail} />
        <span className="version" id="version">Deckmate {state.deckmateVersion || '—'}{state.version && state.version !== state.deckmateVersion ? ` · Desktop ${state.version}` : ''}</span>
      </div>
    </footer>
  </main>;
}
