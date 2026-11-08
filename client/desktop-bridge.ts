/**
 * 2026-11-08: Deckmate Desktop exposes this narrow bridge on the board page so the project menu can switch between
 * recent projects. It is absent in a browser (CLI, Docker), and the menu then shows only the current project.
 * The board renders project content, so the shell answers only from the top frame of the current server origin
 * and switches only to folders already in its recent list; anything else still goes through the start screen.
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

export type DesktopBoardBridge = {
  /** Recent projects, most recent first, the current one included and marked. */
  recentProjects(): Promise<DesktopRecentProject[]>;
  /** Opens a folder from the recent list in this window; the page is replaced on success. */
  switchProject(path: string): Promise<DesktopResult>;
  /** Shows the start screen, where another folder can be opened or created. */
  showStartScreen(): Promise<DesktopResult>;
};

declare global {
  interface Window { deckmateBoard?: DesktopBoardBridge }
}

export function desktopBoard(): DesktopBoardBridge | undefined {
  return typeof window === 'undefined' ? undefined : window.deckmateBoard;
}
