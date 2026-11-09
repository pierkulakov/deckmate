import { readStoredValue } from './storage.ts';
import { Component, lazy, Suspense, useCallback, useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, ChevronDown, FileUp, GitBranch, Languages, Layers, LoaderCircle, Moon, Power, RefreshCw, Sun, UserRound, X } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import { defineText, setLang, useLang, useText } from './i18n.ts';
import { useWorkspace } from './useWorkspace.ts';
import type { DataSource } from '../src/workspace-contracts.ts';
import { ServerStatus } from './components/ServerStatus.tsx';
import { Deck } from './components/Deck.tsx';
import { LevelBadge } from './components/LevelBadge.tsx';
import { emitSignal } from './onboarding/signals.ts';
import { Button } from './components/ui/button.tsx';
import { TimelineView } from './components/TimelineView.tsx';
import { Hand } from './components/Hand.tsx';
import { GlobalSearch } from './components/GlobalSearch.tsx';
import { QuickCapture } from './components/QuickCapture.tsx';
import { Notifications } from './components/Notifications.tsx';
import { MembersEditor } from './components/MembersEditor.tsx';
import { CsvImport } from './components/CsvImport.tsx';
import { ProjectTemplates } from './components/ProjectTemplates.tsx';
import { DocumentPreviewProvider } from './components/DocumentPreview.tsx';
import { ProjectTile } from './RecentProjects.tsx';
import { WorkspaceProjects } from './WorkspaceProjects.tsx';
import { desktopBoard } from './desktop-bridge.ts';
import './workspace.css';
import { DeckmateMark } from './components/DeckmateMark.tsx';
import { matchShortcut, shortcutTargetBlocked } from './keyboard-shortcuts.ts';

const Vision = lazy(() => import('./components/Vision.tsx'));
const sourceText = defineText({
  testCopy: 'Test copy', original: 'Original', source: 'Page source', editable: 'Editable', readOnly: 'Read only',
  originalReadOnly: 'The original is open for reading only.', projectReadOnly: 'This project is open for reading only.',
  openTestCopy: 'Open test copy →',
}, {
  testCopy: 'Тестовая копия', original: 'Оригинал', source: 'Источник страницы', editable: 'Можно править', readOnly: 'Только чтение',
  originalReadOnly: 'Оригинал открыт только для чтения.', projectReadOnly: 'Проект открыт только для чтения.',
  openTestCopy: 'Открыть тестовую копию →',
});
type View = 'deck' | 'hand' | 'timeline' | 'vision';
const tabs: readonly View[] = ['hand', 'deck', 'timeline', 'vision'];
const text = defineText({
  hand: 'Hand', deck: 'Decks', timeline: 'Timeline', vision: 'Vision',
  sectionFailedTitle: 'This section could not be opened',
  sectionFailedDescription: 'The interface may have been updated on the server. Reload the app.',
  reloadInterface: 'Reload interface',
  stoppedTitle: 'Deckmate is stopped',
  stoppedDescription: 'To return, start it again from its shortcut or with npx deckmate.',
  loading: 'Opening page…',
  retryLoad: 'Reload',
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
  retryLoad: 'Повторить загрузку',
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
  const workspace = useWorkspace();
  const [legacySprint, setLegacySprint] = useState(() => new URLSearchParams(location.search).get('view') === 'sprint');
  const [view, setView] = useState<View>(() => {
    const selected = new URLSearchParams(location.search).get('view');
    if (selected === 'sprint') return 'timeline';
    return ['hand', 'timeline', 'vision'].includes(selected ?? '') ? selected as View : 'deck';
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [navigationKey, setNavigationKey] = useState(0);
  const [editing, setEditing] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [importDeckId, setImportDeckId] = useState<string | null>(null);
  // English is the default; the app menu also offers Russian (2026-11-05).
  const lang = useLang();
  const t = useText(text);
  const sourceLabels = sourceText[lang];
  const [dark, setDark] = useState(() => { const enabled = readStoredValue(localStorage, 'deckmate-theme') !== 'light'; document.documentElement.classList.toggle('dark', enabled); return enabled; });
  const onEditing = useCallback((value: boolean) => setEditing(value), []);
  const snapshot = workspace.snapshot;
  // 2026-11-09: with the Desktop bridge the current project row wears the same tile as the project list below it;
  // in a browser there is no bridge and the row keeps its plain avatar.
  const board = desktopBoard();
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
  useEffect(() => {
    if (!editing) return;
    const protectDraft = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', protectDraft);
    return () => window.removeEventListener('beforeunload', protectDraft);
  }, [editing]);
  const navigate = useCallback((next: View) => {
    setLegacySprint(false);
    setView(next);
    setNavigationKey(value => value + 1);
    history.replaceState(null, '', `/?view=${next}&catalogSource=${workspace.source}`);
    emitSignal({ type: 'view', view: next });
  }, [workspace.source]);
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
    setLegacySprint(false);
    history.replaceState(null, '', `/?view=deck&catalogSource=${workspace.source}&scope=all&card=${encodeURIComponent(id)}`);
    setView('deck');
    setNavigationKey(value => value + 1);
  }
  function changeTheme() { document.documentElement.classList.toggle('dark', !dark); localStorage.setItem('deckmate-theme', dark ? 'light' : 'dark'); setDark(!dark); emitSignal({ type: 'preference', name: 'theme' }); }

  function renderContent() {
    if (stopped) return <div className="empty-state"><Power size={28} /><h1>{t.stoppedTitle}</h1><p>{t.stoppedDescription}</p></div>;
    if (!snapshot) return <div className="loading-state" aria-live="polite"><LoaderCircle className="spin" size={22} /><p>{t.loading}</p><Button variant="ghost" onClick={() => void workspace.refresh()}>{t.retryLoad}</Button></div>;
    if (view === 'deck') return <Deck snapshot={snapshot} refreshKey={workspace.updatedAt} onEditing={onEditing} onStartFromTemplate={() => setTemplatesOpen(true)} onImportCsv={deckId => { setImportDeckId(deckId); setImportOpen(true); }} />;
    if (view === 'hand') return <Hand key={snapshot.source} snapshot={snapshot} refreshKey={workspace.updatedAt} onOpenCard={openCard} onOpenMembers={() => setMembersOpen(true)} />;
    if (view === 'timeline') return <TimelineView key={snapshot.source} snapshot={snapshot} refreshKey={workspace.updatedAt} selectCurrentRun={legacySprint} onOpenCard={openCard} onEditing={onEditing} />;
    // 2026-11-06: no fallback text: Vision shows its own «Opening board…» plate in the canvas; a second one here sat above the toolbar
    // line without the spinner, so the same words jumped down when the chunk arrived.
    return <Suspense fallback={null}><Vision snapshot={snapshot} refreshKey={workspace.updatedAt} dark={dark} onEditing={onEditing} onOpenCard={openCard} /></Suspense>;
  }

  return <DocumentPreviewProvider><div className="app-shell global-shell" data-event-latency={workspace.eventLatency} data-updated-at={workspace.updatedAt} data-rendered-at={renderedAt}>
    <Dialog.Root open={sidebarOpen} onOpenChange={setSidebarOpen}>
      <Dialog.Portal><Dialog.Overlay className="mission-control-overlay" />
        <Dialog.Content className="mission-control" aria-describedby={undefined} onEscapeKeyDown={event => {
          if (document.querySelector('.mission-control [role="menu"][data-state="open"]')) event.preventDefault();
        }}>
          <header className="mission-control-head"><DeckmateMark /><Dialog.Title>Deckmate</Dialog.Title><span className="mission-control-version">v{__DECKMATE_VERSION__}</span>
            <Dialog.Close asChild><Button variant="ghost" size="icon" aria-label={t.closeMenu}><X size={17} /></Button></Dialog.Close></header>
          <section className="mission-control-project" aria-label={t.project}><h2>{t.project}</h2>
            <div className="mission-control-project-row">{board
              ? <ProjectTile name={snapshot?.projectName ?? 'Deckmate'} />
              : <span className="mission-control-avatar" aria-hidden="true">{snapshot?.projectName.slice(0, 1) ?? 'D'}</span>}
              <div><strong title={snapshot?.projectName ?? t.project}>{snapshot?.projectName ?? t.project}</strong><span>{!snapshot ? '' : snapshot.editMode === 'direct' ? t.modeDirect
                : snapshot.editMode === 'sandbox' ? (workspace.source === 'sandbox' ? sourceLabels.testCopy : sourceLabels.original) + ' · ' + (snapshot.writable ? sourceLabels.editable : sourceLabels.readOnly)
                : t.modeReadOnly}</span></div></div>
            <WorkspaceProjects open={sidebarOpen} disabled={editing} />
          </section>
          <nav className="mission-control-menu" aria-label={t.appMenu}>
            <button type="button" disabled={editing || !snapshot} onClick={() => { setSidebarOpen(false); setTemplatesOpen(true); }}><Layers size={18} aria-hidden="true" /><span>{t.projectTemplates}</span></button>
            <button type="button" disabled={editing} onClick={() => { setSidebarOpen(false); setMembersOpen(true); }}><UserRound size={18} aria-hidden="true" /><span>{t.members}<small>{t.membersCaption}</small></span></button>
            <button type="button" disabled={editing} onClick={() => { setSidebarOpen(false); setImportDeckId(null); setImportOpen(true); }}><FileUp size={18} aria-hidden="true" /><span>{t.importCsv}<small>{t.importCaption}</small></span></button>
            <button type="button" onClick={() => { setLang(lang === 'en' ? 'ru' : 'en'); emitSignal({ type: 'preference', name: 'language' }); }}><Languages size={18} aria-hidden="true" /><span>{t.otherLanguage}<small>{t.interfaceLanguage}</small></span></button>
            <button type="button" onClick={() => { setSidebarOpen(false); void workspace.refresh(); }}><RefreshCw size={18} aria-hidden="true" /><span>{t.refreshPage}</span></button>
            <button type="button" className="is-destructive" disabled={editing} onClick={() => { setSidebarOpen(false); void workspace.shutdown().then(closed => { if (closed) setStopped(true); }); }}><Power size={18} aria-hidden="true" /><span>{t.stop}</span></button>
          </nav>
          <footer className={`mission-control-foot is-${workspace.connection}`}><span className="server-status-dot" aria-hidden="true" />{workspace.connected ? t.liveChanges : t.disconnected}</footer>
        </Dialog.Content></Dialog.Portal>
    </Dialog.Root>
    {/* DOM order is the visual order, so Tab walks rail → tabs → actions; the notification corner is fixed and comes after the page. */}
    <div className="workspace"><header className="topbar global-topbar"><div className="breadcrumb"><Button variant="ghost" size="icon" className="mission-control-trigger" aria-label={t.openMenu} aria-haspopup="dialog" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(true)}><DeckmateMark /></Button><ServerStatus connection={workspace.connection} snapshot={snapshot} updatedAt={workspace.updatedAt} /></div>
      <nav className="global-tabs" aria-label={t.projectSections}>{tabs.map(tab => <button key={tab} disabled={editing} className={view === tab ? 'selected' : ''} aria-current={view === tab ? 'page' : undefined} onClick={() => navigate(tab)}>{t[tab]}</button>)}</nav><div className="topbar-actions">
      <div id="topbar-view-actions" className="topbar-view-actions" />
      {snapshot && <GlobalSearch snapshot={snapshot} refreshKey={workspace.updatedAt} onOpenCard={openCard} />}
      {snapshot && <QuickCapture snapshot={snapshot} refreshKey={workspace.updatedAt} onOpenCard={openCard} />}
      {snapshot?.editMode === 'sandbox' && <DropdownMenu.Root><DropdownMenu.Trigger className={`source-switch ${workspace.source === 'sandbox' ? 'sandbox' : ''}`} aria-label={workspace.source === 'sandbox' ? sourceLabels.testCopy : sourceLabels.original} disabled={editing}><GitBranch size={14} /><span>{workspace.source === 'sandbox' ? sourceLabels.testCopy : sourceLabels.original}</span><ChevronDown size={12} /></DropdownMenu.Trigger>
        <DropdownMenu.Portal><DropdownMenu.Content className="dropdown" align="end" sideOffset={8}><DropdownMenu.Label className="dropdown-label">{sourceLabels.source}</DropdownMenu.Label>
          <DropdownMenu.RadioGroup value={workspace.source} onValueChange={value => workspace.setSource(value as DataSource)}>
            <DropdownMenu.RadioItem value="sandbox" className="dropdown-item">{sourceLabels.testCopy}<span className="menu-caption">{sourceLabels.editable}</span><DropdownMenu.ItemIndicator className="menu-check"><Check size={14} /></DropdownMenu.ItemIndicator></DropdownMenu.RadioItem>
            <DropdownMenu.RadioItem value="live" className="dropdown-item">{sourceLabels.original}<span className="menu-caption">{sourceLabels.readOnly}</span><DropdownMenu.ItemIndicator className="menu-check"><Check size={14} /></DropdownMenu.ItemIndicator></DropdownMenu.RadioItem>
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>}
      <div id="topbar-shortcuts" className="topbar-shortcuts" />
      <Button variant="ghost" size="icon" aria-label={dark ? t.lightTheme : t.darkTheme} onClick={changeTheme}>{dark ? <Sun size={17} /> : <Moon size={17} />}</Button>
      {snapshot && <LevelBadge snapshot={snapshot} refreshKey={workspace.updatedAt} onNavigate={navigate} />}
    </div></header>
      {snapshot && !snapshot.writable && <div className="readonly-banner">{snapshot.editMode === 'sandbox' ? sourceLabels.originalReadOnly : sourceLabels.projectReadOnly}{snapshot.editMode === 'sandbox' && <button onClick={() => workspace.setSource('sandbox')}>{sourceLabels.openTestCopy}</button>}</div>}
      {workspace.failure && !editing && !stopped && <div className="error-banner" role="alert">{workspace.failure.message}<Button variant="ghost" size="sm" onClick={() => { workspace.clearFailure(); void workspace.refresh(); }}>{t.refresh}</Button></div>}
      <main className="workspace-main board-main">
        <WorkspaceBoundary key={`${view}-${workspace.source}-${navigationKey}`}>{renderContent()}</WorkspaceBoundary>
      </main>
      {snapshot && !stopped && <Notifications snapshot={snapshot} refreshKey={workspace.updatedAt} onOpenCard={openCard} />}
    </div>
    {snapshot && <MembersEditor snapshot={snapshot} refreshKey={workspace.updatedAt} open={membersOpen} onOpenChange={setMembersOpen} />}
    {snapshot && <CsvImport snapshot={snapshot} refreshKey={workspace.updatedAt} open={importOpen} initialDeckId={importDeckId} onOpenChange={setImportOpen} />}
    {snapshot && templatesOpen && <ProjectTemplates key={snapshot.source} snapshot={snapshot} refreshKey={workspace.updatedAt} onClose={() => setTemplatesOpen(false)} onApplied={() => { setTemplatesOpen(false); navigate('deck'); }}
      testCopy={{ notice: sourceLabels.originalReadOnly, action: sourceLabels.openTestCopy, open: () => workspace.setSource('sandbox') }} />}
  </div></DocumentPreviewProvider>;
}
