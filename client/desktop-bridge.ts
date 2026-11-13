import { useEffect } from 'react';

/**
 * 2026-11-09: Deckmate Desktop exposes this narrow bridge on the board page so the project menu can switch between
 * workspace projects. It is absent in a browser (CLI, Docker), and the menu then shows only the current project.
 * The board renders project content, so the shell answers only from the top frame of the current server origin
 * and switches only to folders already in its workspace or recent list.
 */
export type DesktopRecentProject = DesktopWorkspaceProject & {
  /** ISO time of the last opening. */
  lastOpened: string;
};

export type DesktopResult = { ok: true } | { ok: false; code: string; message?: string };
export type DesktopFailure = Extract<DesktopResult, { ok: false }>;
export type ThemePreference = 'light' | 'dark' | 'system';

export interface DesktopPreferences {
  readonly theme?: ThemePreference;
  readonly language?: 'en' | 'ru';
  setTheme?(theme: ThemePreference): Promise<DesktopResult>;
  setLanguage?(lang: 'en' | 'ru'): Promise<DesktopResult>;
}

export type DesktopWorkspaceProject = {
  path: string;
  name: string;
  current: boolean;
  missing: boolean;
};

export type DesktopWorkspaceSource = { kind: 'dialog' } | { kind: 'current' } | { kind: 'recent'; path: string };
export interface DesktopProjectsSnapshot<Project extends DesktopWorkspaceProject = DesktopWorkspaceProject> {
  ok: true;
  projects: Project[];
  /** 2026-11-13: the open folder can be absent from the returned list; the start screen has no current project. */
  current: string | null;
}
export type DesktopProjectsResult<Project extends DesktopWorkspaceProject = DesktopWorkspaceProject> =
  DesktopProjectsSnapshot<Project> | Extract<DesktopResult, { ok: false }>;

export type DesktopBoardBridge = DesktopPreferences & {
  /** Recent projects, most recent first, the current one included and marked. */
  recentProjects(): Promise<DesktopProjectsResult<DesktopRecentProject>>;
  workspaceProjects(): Promise<DesktopProjectsResult>;
  addToWorkspace(source: DesktopWorkspaceSource): Promise<DesktopProjectsResult>;
  removeFromWorkspace(path: string): Promise<DesktopProjectsResult>;
  moveInWorkspace(path: string, index: number): Promise<DesktopProjectsResult>;
  /** Opens a folder from the workspace or recent list; the page is replaced on success. */
  switchProject(path: string): Promise<DesktopResult>;
  /** Shows the start screen, where another folder can be opened or created. */
  showStartScreen(): Promise<DesktopResult>;
  /** 2026-11-09: optional for boards served by older shells. */
  setDirty?(dirty: boolean): Promise<DesktopResult>;
  /** 2026-11-13: the opening scene keeps the splash's project name and tile before the snapshot arrives. */
  readonly projectName?: string;
};

export type DesktopState = DesktopProjectsSnapshot & {
  recent: DesktopRecentProject[];
  lastProject: string | null;
  version: string;
  deckmateVersion: string;
  locale: string;
  language: 'en' | 'ru';
  theme: ThemePreference;
};

export type DesktopStatus = {
  phase: 'starting' | 'ready' | 'error';
  path?: string;
  code?: string;
  message?: string;
};

export interface DesktopShell extends DesktopPreferences {
  getState(options?: { refresh?: boolean }): Promise<DesktopState | DesktopFailure>;
  chooseFolder(): Promise<string | null | DesktopFailure>;
  openProject(folder: string): Promise<DesktopResult>;
  createProject(options: { folder: string }): Promise<DesktopResult>;
  removeRecent(folder: string): Promise<DesktopProjectsResult<DesktopRecentProject>>;
  addToWorkspace(folder: string): Promise<DesktopProjectsResult>;
  removeFromWorkspace(folder: string): Promise<DesktopProjectsResult>;
  moveInWorkspace(folder: string, index: number): Promise<DesktopProjectsResult>;
  setLanguage(lang: 'en' | 'ru'): Promise<DesktopResult>;
  setTheme(theme: ThemePreference): Promise<DesktopResult>;
  onStatus(callback: (status: DesktopStatus) => void): () => void;
}

declare global {
  interface Window { deckmateBoard?: DesktopBoardBridge; deckmateDesktop?: DesktopShell }
}

export function desktopBoard(): DesktopBoardBridge | undefined {
  return typeof window === 'undefined' ? undefined : window.deckmateBoard;
}

export function desktopPreferences(): DesktopPreferences | undefined {
  return typeof window === 'undefined' ? undefined : window.deckmateBoard ?? window.deckmateDesktop;
}

const dirtyEditors = new Set<symbol>();

export function useDesktopDirty(dirty: boolean): void {
  useEffect(() => {
    const board = desktopBoard();
    if (!dirty || !board?.setDirty) return;
    // 2026-11-09: nested editors must not clear each other's unsaved-work guard on save or unmount.
    const editor = Symbol();
    dirtyEditors.add(editor);
    const report = () => { void board.setDirty!(dirtyEditors.size > 0).catch(error => console.error(error)); };
    report();
    return () => { dirtyEditors.delete(editor); report(); };
  }, [dirty]);
}
