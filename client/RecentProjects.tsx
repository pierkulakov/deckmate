// 2026-11-08: in Deckmate Desktop the shell exposes the board bridge (client/desktop-bridge.ts), and the project
// menu lists the other recent projects under the current one, one click switching the window to that folder.
// In a browser (CLI, Docker) there is no bridge: this renders nothing and the section keeps its single row.
// The labels live in App.tsx's shared text object, so both languages stay keyed together.
import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { FolderOpen, LoaderCircle } from 'lucide-react';
import { desktopBoard, type DesktopBoardBridge, type DesktopRecentProject } from './desktop-bridge.ts';
import { useLang, type Lang } from './i18n.ts';
import { tileColor } from './project-tile.ts';
import { relativeTimeAgo } from './relative-time.ts';

export type RecentProjectsLabels = {
  openAnotherFolder: string;
  recentFailed: string;
  switchNotRecent: string;
  switchMissing: string;
  switchTimeout: string;
  switchStartFailed: string;
  switchFailed: string;
};

/** Shell switch failures that get their own wording; unknown codes and thrown bridges use the general line. */
const switchFailures: Partial<Record<string, keyof RecentProjectsLabels>> = {
  'not-recent': 'switchNotRecent',
  missing: 'switchMissing',
  timeout: 'switchTimeout',
  'start-failed': 'switchStartFailed',
};

export function switchFailureText(labels: RecentProjectsLabels, code: string | undefined): string {
  return labels[(code ? switchFailures[code] : undefined) ?? 'switchFailed'];
}

/** Middle truncation keeps the drive and the folder name visible where an end ellipsis would hide both. */
export function compactPath(path: string, limit = 30): string {
  if (path.length <= limit) return path;
  const head = Math.ceil((limit - 1) / 2);
  const tail = limit - 1 - head;
  return `${path.slice(0, head)}…${path.slice(-tail)}`;
}

/** The menu shows the current project above the list, so the list keeps only the others. */
export function otherProjects(projects: DesktopRecentProject[]): DesktopRecentProject[] {
  return projects.filter(project => !project.current);
}

/** One switch attempt: null while the shell replaces the page, otherwise the failure code for the list. */
export async function attemptSwitch(board: DesktopBoardBridge, path: string): Promise<string | undefined | null> {
  try {
    const result = await board.switchProject(path);
    return result.ok ? null : result.code;
  } catch {
    return undefined;
  }
}

type RecentFailure = { kind: 'load' } | { kind: 'switch'; code: string | undefined };

/** The miniature deck cover of the launcher's recent list (desktop/launcher/launcher.css .recent-tile): the same
 *  165deg cast over the project's stable tile color, scaled down for the narrow menu panel. The current project row
 *  in the menu reuses it when the Desktop bridge is there, so both rows read as one system. */
export function ProjectTile({ name, children }: { name: string; children?: ReactNode }) {
  return <span className="mission-control-recent-tile" aria-hidden="true" style={{ '--tile': tileColor(name) } as CSSProperties}>{children}</span>;
}

/** Loads the list on every menu opening — the shell reorders its recent list on each switch. */
export function useRecentProjects(board: DesktopBoardBridge | undefined, open: boolean) {
  const [others, setOthers] = useState<DesktopRecentProject[]>([]);
  const [switching, setSwitching] = useState<string | null>(null);
  const [failure, setFailure] = useState<RecentFailure | null>(null);

  useEffect(() => {
    if (!open || !board) return;
    let current = true;
    board.recentProjects().then(
      projects => { if (current) { setOthers(otherProjects(projects)); setSwitching(null); setFailure(null); } },
      () => { if (current) { setOthers([]); setSwitching(null); setFailure({ kind: 'load' }); } },
    );
    return () => { current = false; };
  }, [board, open]);

  const switchTo = useCallback(async (path: string) => {
    if (!board) return;
    setSwitching(path);
    setFailure(null);
    const code = await attemptSwitch(board, path);
    // ok:true replaces the page from the shell, so the row keeps its loading state until then.
    if (code !== null) {
      setSwitching(null);
      setFailure({ kind: 'switch', code });
    }
  }, [board]);

  return { others, switching, failure, switchTo };
}

/** The list, the failure line and the start-screen link. Takes everything as props: no hooks, so it renders
 *  to static markup in tests with the same props the wrapper passes in the menu. */
export function RecentProjectsList({ projects, switching, failureText, disabled, labels, lang, onSwitch, onOpenStart }: {
  projects: DesktopRecentProject[];
  switching: string | null;
  failureText: string | null;
  disabled: boolean;
  labels: RecentProjectsLabels;
  lang: Lang;
  onSwitch: (path: string) => void;
  onOpenStart: () => void;
}) {
  const busy = switching !== null;
  return <>
    <div className="mission-control-recent-viewport" data-more={projects.length > 5 || undefined}><ul className="mission-control-recent-list"
      onScroll={event => {
        const list = event.currentTarget;
        list.parentElement?.toggleAttribute('data-more', list.scrollTop + list.clientHeight < list.scrollHeight - 1);
      }}>
      {projects.map(project => {
        const switchingThis = switching === project.path;
        return <li key={project.path}>
          <button type="button" className="mission-control-project-row mission-control-recent-row" title={project.path}
            disabled={disabled || busy} aria-busy={switchingThis} onClick={() => onSwitch(project.path)}>
            <ProjectTile name={project.name}>{switchingThis && <LoaderCircle className="spin" size={16} />}</ProjectTile>
            <div><div className="mission-control-recent-heading"><strong>{project.name}</strong>
              <time className="mission-control-recent-time" dateTime={project.lastOpened}>{relativeTimeAgo(project.lastOpened, lang)}</time></div>
              <span className="mission-control-recent-path">{compactPath(project.path)}</span></div>
          </button>
        </li>;
      })}
    </ul></div>
    {failureText && <p className="mission-control-recent-failure" role="alert">{failureText}</p>}
    <button type="button" className="mission-control-recent-open" disabled={disabled || busy} onClick={onOpenStart}>
      <FolderOpen size={14} aria-hidden="true" />{labels.openAnotherFolder}
    </button>
  </>;
}

export function RecentProjects({ open, disabled, labels }: {
  open: boolean;
  disabled: boolean;
  labels: RecentProjectsLabels;
}) {
  const board = desktopBoard();
  const lang = useLang();
  const { others, switching, failure, switchTo } = useRecentProjects(board, open);
  // No bridge — a browser served by the CLI or Docker: the section keeps exactly its old markup.
  if (!board) return null;
  // Nothing else to switch to: no empty headings, the section looks like today's.
  if (others.length === 0 && !failure) return null;
  const failureText = failure ? (failure.kind === 'load' ? labels.recentFailed : switchFailureText(labels, failure.code)) : null;
  return <div className="mission-control-recent">
    <RecentProjectsList projects={others} switching={switching} failureText={failureText} disabled={disabled}
      labels={labels} lang={lang} onSwitch={path => void switchTo(path)} onOpenStart={() => void board.showStartScreen()} />
  </div>;
}
