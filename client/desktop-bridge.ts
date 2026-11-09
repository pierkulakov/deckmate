/**
 * 2026-11-09: Deckmate Desktop exposes this narrow bridge on the board page so the project menu can switch between
 * workspace projects. It is absent in a browser (CLI, Docker), and the menu then shows only the current project.
 * The board renders project content, so the shell answers only from the top frame of the current server origin
 * and switches only to folders already in its workspace or recent list.
 */
export type DesktopRecentProject = {
  /** Absolute folder path as the shell stores it. */
  path: string;
  /** Folder name shown in the list. */
  name: string;
  /** ISO time of the last opening. */
  lastOpened: string;
  /** True for the project open in this window. */
  current: boolean;
};

export type DesktopResult = { ok: true } | { ok: false; code: string; message?: string };

export type DesktopWorkspaceProject = {
  path: string;
  name: string;
  current: boolean;
  missing: boolean;
};

export type DesktopWorkspaceSource = { kind: 'dialog' } | { kind: 'current' } | { kind: 'recent'; path: string };
export type DesktopWorkspaceResult = { ok: true; projects: DesktopWorkspaceProject[] } | Extract<DesktopResult, { ok: false }>;

export type DesktopBoardBridge = {
  /** Recent projects, most recent first, the current one included and marked. */
  recentProjects(): Promise<DesktopRecentProject[]>;
  /** Optional as a group: older shells keep their recent-project menu. */
  workspaceProjects?(): Promise<DesktopWorkspaceProject[]>;
  addToWorkspace?(source: DesktopWorkspaceSource): Promise<DesktopWorkspaceResult>;
  removeFromWorkspace?(path: string): Promise<DesktopWorkspaceResult>;
  moveInWorkspace?(path: string, index: number): Promise<DesktopWorkspaceResult>;
  /** Opens a folder from the workspace or recent list; the page is replaced on success. */
  switchProject(path: string): Promise<DesktopResult>;
  /** Shows the start screen, where another folder can be opened or created. */
  showStartScreen(): Promise<DesktopResult>;
};

export type DesktopWorkspaceBridge = DesktopBoardBridge & Required<Pick<DesktopBoardBridge,
  'workspaceProjects' | 'addToWorkspace' | 'removeFromWorkspace' | 'moveInWorkspace'>>;

export function hasWorkspace(board: DesktopBoardBridge): board is DesktopWorkspaceBridge {
  return typeof board.workspaceProjects === 'function' && typeof board.addToWorkspace === 'function'
    && typeof board.removeFromWorkspace === 'function' && typeof board.moveInWorkspace === 'function';
}

declare global {
  interface Window { deckmateBoard?: DesktopBoardBridge }
}

export function desktopBoard(): DesktopBoardBridge | undefined {
  return typeof window === 'undefined' ? undefined : window.deckmateBoard;
}
