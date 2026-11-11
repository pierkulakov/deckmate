import { Component, lazy, startTransition, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, ChevronDown, FileUp, GitBranch, Languages, Layers, LoaderCircle, Moon, Power, RefreshCw, Sun, UserRound, X } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import { defineText, setLang, useLang, useText } from './i18n.ts';
import { useWorkspace } from './useWorkspace.ts';
import type { DataSource } from '../src/workspace-contracts.ts';
import { ServerStatus } from './components/ServerStatus.tsx';
import { LevelBadge } from './components/LevelBadge.tsx';
import { emitSignal } from './onboarding/signals.ts';
import { Button } from './components/ui/button.tsx';
import { GlobalSearch } from './components/GlobalSearch.tsx';
import { QuickCapture } from './components/QuickCapture.tsx';
import { Notifications } from './components/Notifications.tsx';
import { DocumentPreviewProvider } from './components/DocumentPreview.tsx';
import { ProjectTile } from './RecentProjects.tsx';
import { WorkspaceProjects } from './WorkspaceProjects.tsx';
import { desktopBoard, hasWorkspace, useDesktopDirty } from './desktop-bridge.ts';
import './workspace.css';
import { DeckmateMark } from './components/DeckmateMark.tsx';
import { matchShortcut, shortcutTargetBlocked } from './keyboard-shortcuts.ts';
import { cardNavigation, viewNavigation, type View } from './app-navigation.ts';
import { afterFirstScreen, browserWarmupEnvironment, WarmupQueue } from './first-screen-warmup.ts';
import { preparedNavigation, preparedResource, type PreparedResource } from './prepared-resource.ts';
import { warmInterfaceFonts, warmVisibleImages } from './warmup-assets.ts';
import { prepareEntrance } from './prepared-motion.ts';
import { currentSourceLabels, readOnlyAccess } from './source-access.ts';
import { ErrorState } from './components/ErrorState.tsx';
import { moveFocus } from './focus.ts';
import { useSelectEscapeGuard } from './select-escape.ts';

const deckResource = preparedResource(() => import('./components/Deck.tsx').then(module => ({ default: module.Deck })));
const handResource = preparedResource(() => import('./components/Hand.tsx').then(module => ({ default: module.Hand })));
const timelineResource = preparedResource(() => import('./components/TimelineView.tsx').then(module => ({ default: module.TimelineView })));
const visionResource = preparedResource(() => import('./components/Vision.tsx'));
const membersResource = preparedResource(() => import('./components/MembersEditor.tsx').then(module => ({ default: module.MembersEditor })));
const csvResource = preparedResource(() => import('./components/CsvImport.tsx').then(module => ({ default: module.CsvImport })));
const templatesResource = preparedResource(() => import('./components/ProjectTemplates.tsx').then(module => ({ default: module.ProjectTemplates })));
const Deck = lazy(deckResource.load);
const Hand = lazy(handResource.load);
const TimelineView = lazy(timelineResource.load);
const Vision = lazy(visionResource.load);
const MembersEditor = lazy(membersResource.load);
const CsvImport = lazy(csvResource.load);
const ProjectTemplates = lazy(templatesResource.load);
const viewResources = { deck: deckResource, hand: handResource, timeline: timelineResource, vision: visionResource };
// 2026-11-10: intent preloads must not replace lazy's error handling when a cached interface has stale chunk URLs.
function preload(resource: PreparedResource<unknown>) { void resource.load().catch(() => {}); }
const tabs: readonly View[] = ['hand', 'deck', 'timeline', 'vision'];
function locationView(): View {
  const selected = new URLSearchParams(location.search).get('view');
  if (selected === 'sprint') return 'timeline';
  return tabs.includes(selected as View) ? selected as View : 'deck';
}
const text = defineText({
  hand: 'Hand', deck: 'Decks', timeline: 'Timeline', vision: 'Vision',
  sectionFailedTitle: 'This section could not be opened',
  sectionFailedDescription: 'The interface may have been updated on the server. Reload the app.',
  reloadInterface: 'Reload interface',
  stoppedTitle: 'Deckmate is stopped',
  stoppedDescription: 'To return, start it again from its shortcut or with npx deckmate.',
  loading: 'Opening page…',
  project: 'Project',
  liveChanges: 'Changes appear immediately',
  disconnected: 'No connection to the server',
  openMenu: 'Main menu',
  closeMenu: 'Close menu',
  modeDirect: 'Edits the project files directly',
  modeReadOnly: 'Read only',
  lightTheme: 'Light theme',
  darkTheme: 'Dark theme',
  appMenu: 'App menu',
  members: 'Members…',
  membersCaption: 'Registry of people and agents',
  importCsv: 'Import CSV…',
  importCaption: 'Cards from a spreadsheet',
  projectTemplates: 'Start from template…',
  refreshPage: 'Refresh page',
  stop: 'Stop Deckmate',
  projectSections: 'Project sections',
  refresh: 'Refresh',
  otherLanguage: 'Русский',
  interfaceLanguage: 'Interface language',
}, {
  hand: 'Hand', deck: 'Decks', timeline: 'Timeline', vision: 'Vision',
  sectionFailedTitle: 'Не удалось открыть раздел',
  sectionFailedDescription: 'Интерфейс мог обновиться на сервере. Перезагрузите приложение.',
  reloadInterface: 'Обновить интерфейс',
  stoppedTitle: 'Deckmate остановлен',
  stoppedDescription: 'Чтобы вернуться, запустите его снова ярлыком или командой npx deckmate.',
  loading: 'Открываем страницу…',
  project: 'Проект',
  liveChanges: 'Изменения видны сразу',
  disconnected: 'Нет связи с сервером',
  openMenu: 'Главное меню',
  closeMenu: 'Закрыть меню',
  modeDirect: 'Правит файлы проекта напрямую',
  modeReadOnly: 'Только чтение',
  lightTheme: 'Светлая тема',
  darkTheme: 'Тёмная тема',
  appMenu: 'Меню приложения',
  members: 'Участники…',
  membersCaption: 'Реестр людей и агентов',
  importCsv: 'Импорт CSV…',
  importCaption: 'Карточки из таблицы',
  projectTemplates: 'Начать с шаблона…',
  refreshPage: 'Обновить страницу',
  stop: 'Остановить Deckmate',
  projectSections: 'Разделы проекта',
  refresh: 'Обновить',
  otherLanguage: 'English',
  interfaceLanguage: 'Язык интерфейса',
});

class WorkspaceBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <WorkspaceFailure />;
    return this.props.children;
  }
}

function WorkspaceFailure() {
  const t = useText(text);
  return <div className="empty-state"><h2>{t.sectionFailedTitle}</h2><p>{t.sectionFailedDescription}</p><Button onClick={() => location.reload()}>{t.reloadInterface}</Button></div>;
}

export default function App() {
  useSelectEscapeGuard();
  const workspace = useWorkspace();
  const [navigation] = useState(preparedNavigation);
  const warmup = useRef<WarmupQueue | null>(null);
  useEffect(() => () => navigation.cancel(), [navigation]);
  const [legacySprint, setLegacySprint] = useState(() => new URLSearchParams(location.search).get('view') === 'sprint');
  const [view, setView] = useState(locationView);
  // 2026-11-10: the selected screen stays critical; speculative work waits for its first useful paint.
  useEffect(() => { preload(viewResources[view]); }, [view]);
  useEffect(() => {
    const source = workspace.snapshot?.source;
    if (!source) return;
    const cancel = afterFirstScreen(() => {
      const queue = new WarmupQueue(browserWarmupEnvironment());
      warmup.current = queue;
      warmInterfaceFonts(queue);
      queue.add({ key: 'visible-images', priority: 1, run: () => warmVisibleImages(queue) });
      const resources = [deckResource, handResource, timelineResource, membersResource, csvResource, templatesResource, visionResource];
      resources.forEach((resource, index) => queue.add({ key: 'section:' + index, priority: 10 + index, run: resource.load }));
      queue.add({ key: 'card-controls', priority: 20, run: async signal => {
        const { warmCardControls } = await import('./warmup-controls.tsx');
        if (!signal.aborted) await warmCardControls(source, signal);
      } });
      queue.add({ key: 'vision-canvas', priority: 30, run: async signal => {
        const module = await visionResource.load();
        if (!signal.aborted) await module.warmVisionCanvas(signal);
      } });
    });
    return () => { cancel(); warmup.current?.dispose(); warmup.current = null; };
  }, [workspace.snapshot?.source]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [globalPanel, setGlobalPanel] = useState<'notifications' | 'level' | null>(null);
  function changeGlobalPanel(panel: 'notifications' | 'level', open: boolean) {
    // A departing surface can dismiss after the next one has already received focus.
    setGlobalPanel(current => {
      if (open) return panel;
      return current === panel ? null : current;
    });
  }
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const panelOpener = useRef<HTMLElement | null>(null);
  function openPanel(resource: PreparedResource<unknown>, show: () => void, opener = document.activeElement) {
    panelOpener.current = opener instanceof HTMLElement ? opener : null;
    navigation.run(resource, show);
  }
  const restorePanelFocus = useCallback((event: Event) => {
    event.preventDefault();
    const opener = panelOpener.current;
    moveFocus(opener?.isConnected && opener !== document.body ? opener : menuTrigger.current, { preventScroll: true });
  }, []);
  const [narrowHeader, setNarrowHeader] = useState(() => matchMedia('(max-width: 860px)').matches);
  const [phoneHeader, setPhoneHeader] = useState(() => matchMedia('(max-width: 480px)').matches);
  // 2026-11-11: the portal target survives responsive relocation, preserving open planning forms and their anchors.
  const [viewActions] = useState(() => {
    const slot = document.createElement('div');
    slot.id = 'topbar-view-actions';
    slot.className = 'topbar-view-actions';
    return slot;
  });
  const attachViewActions = useCallback((host: HTMLDivElement | null) => { host?.append(viewActions); }, [viewActions]);
  const topbar = useRef<HTMLElement>(null);
  useEffect(() => {
    const narrow = matchMedia('(max-width: 860px)'), phone = matchMedia('(max-width: 480px)');
    const update = () => { setNarrowHeader(narrow.matches); setPhoneHeader(phone.matches); };
    narrow.addEventListener('change', update); phone.addEventListener('change', update);
    return () => { narrow.removeEventListener('change', update); phone.removeEventListener('change', update); };
  }, []);
  useLayoutEffect(() => {
    const header = topbar.current;
    if (!header) return;
    const update = () => document.documentElement.style.setProperty('--topbar-height', `${header.getBoundingClientRect().height}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(header);
    return () => { observer.disconnect(); document.documentElement.style.removeProperty('--topbar-height'); };
  }, []);
  const [navigationKey, setNavigationKey] = useState(0);
  const focusAfterNavigation = useRef(false);
  const main = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (!focusAfterNavigation.current) return;
    focusAfterNavigation.current = false;
    moveFocus(main.current, { preventScroll: true });
  }, [navigationKey]);
  const [editing, setEditing] = useState(false);
  useEffect(() => { navigation.cancel(); }, [navigation, editing, workspace.source]);
  const [stopped, setStopped] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [mountedPanels, setMountedPanels] = useState({ members: false, csv: false });
  // 2026-11-10: defer closed panels on startup, but retain their drafts after their first opening.
  useEffect(() => {
    if (!membersOpen && !importOpen) return;
    setMountedPanels(previous => ({ members: previous.members || membersOpen, csv: previous.csv || importOpen }));
  }, [membersOpen, importOpen]);
  const [importDeckId, setImportDeckId] = useState<string | null>(null);
  // English is the default; the app menu also offers Russian (2026-11-05).
  const lang = useLang();
  const t = useText(text);
  const sourceLabels = currentSourceLabels();
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const onEditing = useCallback((value: boolean) => {
    if (value) navigation.cancel();
    setEditing(value);
  }, [navigation]);
  const snapshot = workspace.snapshot;
  // 2026-11-11: workspace rows already include the current project, so its summary needs no repeated tile.
  const board = desktopBoard();
  const workspaceAvailable = Boolean(board && hasWorkspace(board));
  // The browser tab names the project first, so several open projects tell apart (2026-11-05).
  const projectName = snapshot?.projectName.trim();
  useEffect(() => { document.title = projectName ? `${projectName} — Deckmate` : 'Deckmate'; }, [projectName]);
  useEffect(() => {
    if (!legacySprint) return;
    const url = new URL(location.href);
    url.searchParams.set('view', 'timeline');
    history.replaceState(null, '', url);
  }, [legacySprint]);
  const [renderedAt, setRenderedAt] = useState(0);
  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => setRenderedAt(Date.now()));
    return () => cancelAnimationFrame(frame);
  }, [snapshot]);
  useDesktopDirty(editing);
  useEffect(() => {
    if (!editing) return;
    const protectDraft = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', protectDraft);
    return () => window.removeEventListener('beforeunload', protectDraft);
  }, [editing]);
  const navigate = useCallback((next: View) => {
    navigation.run(viewResources[next], () => {
      const destination = viewNavigation(location.href, view, next, workspace.source);
      startTransition(() => {
        setLegacySprint(false);
        setView(next);
        if (destination.changed) setNavigationKey(value => value + 1);
      });
      history.replaceState(history.state, '', destination.url);
      emitSignal({ type: 'view', view: next });
    });
  }, [navigation, view, workspace.source]);
  useEffect(() => {
    // 2026-11-10: a card scope adds browser history; Back must also restore its tab after the person leaves Decks.
    function restoreTab() {
      const next = locationView();
      if (next === view) return;
      if (editing) { history.forward(); return; }
      navigate(next);
    }
    window.addEventListener('popstate', restoreTab);
    return () => window.removeEventListener('popstate', restoreTab);
  }, [view, editing, navigate]);
  useEffect(() => {
    function switchTab(event: KeyboardEvent) {
      if (editing || shortcutTargetBlocked(event)) return;
      const shortcut = matchShortcut(event);
      const next = tabs.find(tab => shortcut?.id === 'view-' + tab);
      if (!next) return;
      event.preventDefault();
      navigate(next);
    }
    window.addEventListener('keydown', switchTab);
    return () => window.removeEventListener('keydown', switchTab);
  }, [editing, navigate]);
  function openCard(id: string) {
    if (editing) return;
    navigation.run(deckResource, () => {
      const destination = cardNavigation(location.href, id, workspace.source);
      if (destination.href !== location.href) history.pushState(null, '', destination);
      startTransition(() => {
        setLegacySprint(false);
        setView('deck');
        setNavigationKey(value => value + 1);
      });
    });
  }
  function openDeck(id: string) {
    if (editing) return;
    navigation.run(deckResource, () => {
      const query = new URLSearchParams({ view: 'deck', catalogSource: workspace.source, deck: id });
      history.pushState(null, '', `/?${query}`);
      focusAfterNavigation.current = true;
      startTransition(() => { setLegacySprint(false); setView('deck'); setNavigationKey(value => value + 1); });
    });
  }
  function selectSource(source: DataSource) {
    // 2026-11-10: a ready import can settle before the source-change effect gets its turn.
    navigation.cancel();
    workspace.setSource(source);
  }
  function changeTheme() {
    document.documentElement.classList.toggle('dark', !dark);
    document.documentElement.style.colorScheme = dark ? 'light' : 'dark';
    try { localStorage.setItem('deckmate-theme', dark ? 'light' : 'dark'); } catch {}
    setDark(!dark);
    emitSignal({ type: 'preference', name: 'theme' });
  }

  function renderContent() {
    if (stopped) return <div className="empty-state"><Power size={28} /><h1>{t.stoppedTitle}</h1><p>{t.stoppedDescription}</p></div>;
    if (!snapshot && workspace.failure) return <ErrorState message={workspace.failure.message} onRetry={async () => { workspace.clearFailure(); await workspace.refresh(); }} />;
    if (!snapshot) return <div className="loading-state" aria-live="polite"><LoaderCircle className="spin" size={22} /><p>{t.loading}</p></div>;
    if (view === 'deck') return <Deck snapshot={snapshot} refreshKey={workspace.updatedAt} onEditing={onEditing} onStartFromTemplate={() => openPanel(templatesResource, () => setTemplatesOpen(true))} onImportCsv={deckId => openPanel(csvResource, () => { setImportDeckId(deckId); setImportOpen(true); })} />;
    if (view === 'hand') return <Hand key={snapshot.source} snapshot={snapshot} refreshKey={workspace.updatedAt} onOpenCard={openCard} onOpenMembers={() => openPanel(membersResource, () => setMembersOpen(true))} />;
    if (view === 'timeline') return <TimelineView key={snapshot.source} snapshot={snapshot} refreshKey={workspace.updatedAt} selectCurrentRun={legacySprint} onOpenCard={openCard} onEditing={onEditing} />;
    // 2026-11-06: no fallback text: Vision shows its own «Opening board…» plate in the canvas; a second one here sat above the toolbar
    // line without the spinner, so the same words jumped down when the chunk arrived.
    return <Suspense fallback={null}><Vision snapshot={snapshot} refreshKey={workspace.updatedAt} dark={dark} onEditing={onEditing} onOpenCard={openCard} /></Suspense>;
  }

  const readOnly = snapshot && !snapshot.writable ? readOnlyAccess(snapshot) : null;
  const tabNavigation = <nav className="global-tabs" aria-label={t.projectSections}>{tabs.map(tab => <button key={tab} disabled={editing} className={view === tab ? 'selected' : ''} aria-current={view === tab ? 'page' : undefined} onPointerEnter={() => preload(viewResources[tab])} onFocus={() => preload(viewResources[tab])} onClick={() => navigate(tab)}>{t[tab]}</button>)}</nav>;
  return <DocumentPreviewProvider><div className="app-shell global-shell" data-event-latency={workspace.eventLatency} data-updated-at={workspace.updatedAt} data-rendered-at={renderedAt}>
    <Dialog.Root open={sidebarOpen} onOpenChange={open => { if (!open) navigation.cancel(); setSidebarOpen(open); }}>
      <Dialog.Portal><Dialog.Overlay ref={prepareEntrance} className="mission-control-overlay" />
        <Dialog.Content ref={prepareEntrance} className="mission-control" aria-describedby={undefined}
          onCloseAutoFocus={event => { event.preventDefault(); if (!membersOpen && !importOpen && !templatesOpen) moveFocus(menuTrigger.current, { preventScroll: true }); }} onEscapeKeyDown={event => {
          if (document.querySelector('.mission-control [role="menu"][data-state="open"]')) event.preventDefault();
        }}>
          <header className="mission-control-head dialog-head"><DeckmateMark /><Dialog.Title className="dialog-title">Deckmate</Dialog.Title><span className="mission-control-version page-number">v{__DECKMATE_VERSION__}</span>
            <Dialog.Close asChild><Button variant="ghost" size="icon" aria-label={t.closeMenu}><X size={17} /></Button></Dialog.Close></header>
          <section className="mission-control-project" aria-label={t.project}><h2>{t.project}</h2>
            <div className={`mission-control-project-row${workspaceAvailable ? ' is-workspace-summary' : ''}`}>
              {!workspaceAvailable && board && <ProjectTile name={snapshot?.projectName ?? 'Deckmate'} />}
              {!board && <span className="mission-control-avatar" aria-hidden="true">{snapshot?.projectName.slice(0, 1) ?? 'D'}</span>}
              <div><strong title={snapshot?.projectName ?? t.project}>{snapshot?.projectName ?? t.project}</strong><span>{!snapshot ? '' : snapshot.editMode === 'direct' ? t.modeDirect
                : snapshot.editMode === 'sandbox' ? (workspace.source === 'sandbox' ? sourceLabels.testCopy : sourceLabels.original) + ' · ' + (snapshot.writable ? sourceLabels.editable : sourceLabels.readOnly)
                : t.modeReadOnly}</span></div></div>
            <WorkspaceProjects open={sidebarOpen} disabled={editing} />
          </section>
          <nav className="mission-control-menu" aria-label={t.appMenu}>
            <button type="button" disabled={editing || !snapshot} onPointerEnter={() => preload(templatesResource)} onFocus={() => preload(templatesResource)} onClick={event => openPanel(templatesResource, () => { setSidebarOpen(false); setTemplatesOpen(true); }, event.currentTarget)}><Layers size={18} aria-hidden="true" /><span>{t.projectTemplates}</span></button>
            <button type="button" disabled={editing || !snapshot} onPointerEnter={() => preload(membersResource)} onFocus={() => preload(membersResource)} onClick={event => openPanel(membersResource, () => { setSidebarOpen(false); setMembersOpen(true); }, event.currentTarget)}><UserRound size={18} aria-hidden="true" /><span>{t.members}<small>{t.membersCaption}</small></span></button>
            <button type="button" disabled={editing || !snapshot} onPointerEnter={() => preload(csvResource)} onFocus={() => preload(csvResource)} onClick={event => openPanel(csvResource, () => { setSidebarOpen(false); setImportDeckId(null); setImportOpen(true); }, event.currentTarget)}><FileUp size={18} aria-hidden="true" /><span>{t.importCsv}<small>{t.importCaption}</small></span></button>
            <button type="button" onClick={() => { setLang(lang === 'en' ? 'ru' : 'en'); emitSignal({ type: 'preference', name: 'language' }); }}><Languages size={18} aria-hidden="true" /><span>{t.otherLanguage}<small>{t.interfaceLanguage}</small></span></button>
            <button type="button" onClick={() => { setSidebarOpen(false); void workspace.refresh(); }}><RefreshCw size={18} aria-hidden="true" /><span>{t.refreshPage}</span></button>
            <button type="button" className="is-destructive" disabled={editing} onClick={() => { setSidebarOpen(false); void workspace.shutdown().then(closed => { if (closed) setStopped(true); }); }}><Power size={18} aria-hidden="true" /><span>{t.stop}</span></button>
            {phoneHeader && <button type="button" onClick={changeTheme}>{dark ? <Sun size={18} /> : <Moon size={18} />}<span>{dark ? t.lightTheme : t.darkTheme}</span></button>}
          </nav>
          <footer className={`mission-control-foot is-${workspace.connection}`}>{phoneHeader ? <ServerStatus connection={workspace.connection} snapshot={snapshot} updatedAt={workspace.updatedAt} /> : <><span className="server-status-dot" aria-hidden="true" />{workspace.connected ? t.liveChanges : t.disconnected}</>}</footer>
        </Dialog.Content></Dialog.Portal>
    </Dialog.Root>
    {/* 2026-11-11: narrow navigation follows the tools in both reading and keyboard order. */}
    <div className="workspace"><header ref={topbar} className="topbar global-topbar"><div className="breadcrumb"><Button ref={menuTrigger} variant="ghost" size="icon" className="mission-control-trigger" aria-label={t.openMenu} aria-haspopup="dialog" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(true)}><DeckmateMark /></Button>{!phoneHeader && <ServerStatus connection={workspace.connection} snapshot={snapshot} updatedAt={workspace.updatedAt} />}</div>
      {!narrowHeader && tabNavigation}<div className="topbar-actions">
      {!phoneHeader && <div className="topbar-view-slot" ref={attachViewActions} />}
      {snapshot ? <GlobalSearch snapshot={snapshot} refreshKey={workspace.updatedAt} onOpenCard={openCard} onOpenDeck={openDeck} disabled={editing} />
        : <div className="global-search" inert aria-hidden="true"><div className="global-search-field control-field"><input disabled /></div></div>}
      {snapshot ? <QuickCapture snapshot={snapshot} refreshKey={workspace.updatedAt} onOpenCard={openCard} />
        : <Button variant="ghost" size="icon" className="quick-capture-trigger" disabled aria-hidden="true" style={{ visibility: 'hidden' }} />}
      {snapshot && !stopped && <Notifications key={snapshot.source} snapshot={snapshot} refreshKey={workspace.updatedAt} onOpenCard={openCard}
        open={globalPanel === 'notifications'} onOpenChange={open => changeGlobalPanel('notifications', open)} />}
      {/* 2026-11-10: only sandbox projects have a source switch; an empty reserved slot would leave a permanent gap in direct projects. */}
      {snapshot?.editMode === 'sandbox' && <DropdownMenu.Root><DropdownMenu.Trigger className={`source-switch ${workspace.source === 'sandbox' ? 'sandbox' : ''}`} aria-label={workspace.source === 'sandbox' ? sourceLabels.testCopy : sourceLabels.original} disabled={editing}><GitBranch size={14} /><span>{workspace.source === 'sandbox' ? sourceLabels.testCopy : sourceLabels.original}</span><ChevronDown size={12} /></DropdownMenu.Trigger>
        <DropdownMenu.Portal><DropdownMenu.Content ref={prepareEntrance} className="dropdown" align="end" sideOffset={8}><DropdownMenu.Label className="dropdown-label">{sourceLabels.source}</DropdownMenu.Label>
          <DropdownMenu.RadioGroup value={workspace.source} onValueChange={value => selectSource(value as DataSource)}>
            <DropdownMenu.RadioItem value="sandbox" className="dropdown-item">{sourceLabels.testCopy}<span className="menu-caption">{sourceLabels.editable}</span><DropdownMenu.ItemIndicator className="menu-check"><Check size={14} /></DropdownMenu.ItemIndicator></DropdownMenu.RadioItem>
            <DropdownMenu.RadioItem value="live" className="dropdown-item">{sourceLabels.original}<span className="menu-caption">{sourceLabels.readOnly}</span><DropdownMenu.ItemIndicator className="menu-check"><Check size={14} /></DropdownMenu.ItemIndicator></DropdownMenu.RadioItem>
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>}
      <div id="topbar-shortcuts" className="topbar-shortcuts button-size-icon" />
      {!phoneHeader && <Button variant="ghost" size="icon" aria-label={dark ? t.lightTheme : t.darkTheme} onClick={changeTheme}>{dark ? <Sun size={17} /> : <Moon size={17} />}</Button>}
      {snapshot ? <LevelBadge snapshot={snapshot} refreshKey={workspace.updatedAt} onNavigate={navigate}
        open={globalPanel === 'level'} onOpenChange={open => changeGlobalPanel('level', open)} />
        : <span className="level-badge" inert aria-hidden="true" style={{ visibility: 'hidden' }}><span className="level-badge-card" /><span className="level-badge-bar" /></span>}
    </div>{narrowHeader && tabNavigation}</header>
      {phoneHeader && <div className="workspace-view-actions" ref={attachViewActions} />}
      {readOnly && <div className="readonly-banner">{readOnly.description}{readOnly.action && <button onClick={() => selectSource('sandbox')}>{readOnly.action}</button>}</div>}
      {snapshot && workspace.failure && !editing && !stopped && <div className="error-banner" role="alert">{workspace.failure.message}<Button variant="ghost" size="sm" onClick={() => { workspace.clearFailure(); void workspace.refresh(); }}>{t.refresh}</Button></div>}
      <main ref={main} tabIndex={-1} className="workspace-main board-main">
        <WorkspaceBoundary key={`${view}-${workspace.source}-${navigationKey}`}><Suspense fallback={<div className="loading-state" role="status" style={{ width: '100%', height: '100%' }}><LoaderCircle className="spin" size={22} /><p>{t.loading}</p></div>}>{renderContent()}</Suspense></WorkspaceBoundary>
      </main>
    </div>
    <WorkspaceBoundary><Suspense fallback={null}>
    {snapshot && (membersOpen || mountedPanels.members) && <MembersEditor snapshot={snapshot} refreshKey={workspace.updatedAt} open={membersOpen} onOpenChange={setMembersOpen} onCloseAutoFocus={restorePanelFocus} />}
    {snapshot && (importOpen || mountedPanels.csv) && <CsvImport snapshot={snapshot} refreshKey={workspace.updatedAt} open={importOpen} initialDeckId={importDeckId} onOpenChange={setImportOpen} onCloseAutoFocus={restorePanelFocus} />}
    {snapshot && templatesOpen && <ProjectTemplates key={snapshot.source} snapshot={snapshot} refreshKey={workspace.updatedAt} onClose={() => setTemplatesOpen(false)} onApplied={() => { setTemplatesOpen(false); navigate('deck'); }} onCloseAutoFocus={restorePanelFocus}
      testCopy={{ notice: readOnly?.description || sourceLabels.originalReadOnly, action: readOnly?.action || sourceLabels.openTestCopy, open: () => selectSource('sandbox') }} />}
    </Suspense></WorkspaceBoundary>
  </div></DocumentPreviewProvider>;
}
