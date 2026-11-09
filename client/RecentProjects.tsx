// 2026-11-09: older Desktop shells retain their recent list; workspace rows share its tiles and navigation feedback.
import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { FolderOpen, LoaderCircle } from 'lucide-react';
import { desktopBoard, type DesktopBoardBridge, type DesktopRecentProject } from './desktop-bridge.ts';
import { defineText, useLang, useText, type Lang } from './i18n.ts';
import { tileColor, tileInitials } from './project-tile.ts';
import { relativeTimeAgo } from './relative-time.ts';

const text = defineText({
  openAnotherFolder: 'Open start screen',
  recentFailed: 'Could not load recent projects.',
  switchNotRecent: 'This folder is no longer in the recent list.',
  switchMissing: 'That folder was not found on this computer.',
  switchTimeout: 'The switch took too long; try again.',
  switchStartFailed: 'Deckmate could not start in that folder.',
  switchFailed: 'Could not switch the project.',
  startFailed: 'Could not open the start screen. Try again.',
}, {
  openAnotherFolder: 'Открыть стартовый экран',
  recentFailed: 'Не удалось загрузить недавние проекты.',
  switchNotRecent: 'Этой папки больше нет в списке недавних.',
  switchMissing: 'Папка не найдена на этом компьютере.',
  switchTimeout: 'Переключение заняло слишком много времени; попробуйте ещё раз.',
  switchStartFailed: 'Deckmate не удалось запустить проект в этой папке.',
  switchFailed: 'Не удалось переключить проект.',
  startFailed: 'Не удалось открыть стартовый экран. Попробуйте ещё раз.',
});

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

/** A successful navigation replaces the page, so its spinner stays until the shell finishes. */
export function useProjectNavigation(board: DesktopBoardBridge | undefined) {
  const t = useText(text);
  const [switching, setSwitching] = useState<string | null>(null);
  const [openingStart, setOpeningStart] = useState(false);
  const [failure, setFailure] = useState<{ kind: 'switch'; code: string | undefined } | { kind: 'start' } | null>(null);
  const clearFailure = useCallback(() => setFailure(null), []);
  const switchTo = async (path: string) => {
    if (!board || switching || openingStart) return;
    setSwitching(path);
    setFailure(null);
    const code = await attemptSwitch(board, path);
    if (code !== null) { setSwitching(null); setFailure({ kind: 'switch', code }); }
  };
  const openStart = async () => {
    if (!board || switching || openingStart) return;
    setOpeningStart(true);
    setFailure(null);
    try { if ((await board.showStartScreen()).ok) return; } catch { /* Same recovery as a refused shell command. */ }
    setOpeningStart(false);
    setFailure({ kind: 'start' });
  };
  let failureText: string | null = null;
  if (failure?.kind === 'start') failureText = t.startFailed;
  if (failure?.kind === 'switch') failureText = switchFailureText(t, failure.code);
  return { switching, openingStart, busy: switching !== null || openingStart, failureText, clearFailure, switchTo, openStart };
}

export function OpenStartScreen({ disabled, busy, onOpen }: { disabled: boolean; busy: boolean; onOpen: () => void }) {
  const t = useText(text);
  return <button type="button" className="mission-control-recent-open" disabled={disabled} aria-busy={busy} onClick={onOpen}>
    {busy ? <LoaderCircle className="spin" size={14} aria-hidden="true" /> : <FolderOpen size={14} aria-hidden="true" />}{t.openAnotherFolder}
  </button>;
}

/** The miniature deck cover of the launcher's recent list (desktop/launcher/launcher.css .recent-tile): the same
 *  165deg cast over the project's stable tile color, scaled down for the narrow menu panel. The current project row
 *  in the menu reuses it when the Desktop bridge is there, so both rows read as one system. The window carries the
 *  project's initials (tileInitials — the launcher's tile.dataset.initials rule) as white-on-window text. */
export function ProjectTile({ name, children }: { name: string; children?: ReactNode }) {
  return <span className="mission-control-recent-tile" aria-hidden="true" data-initials={tileInitials(name)} style={{ '--tile': tileColor(name) } as CSSProperties}>{children}</span>;
}

/** Loads the list on every menu opening — the shell reorders its recent list on each switch. */
export function useRecentProjects(board: DesktopBoardBridge | undefined, open: boolean) {
  const [others, setOthers] = useState<DesktopRecentProject[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (!open || !board) return;
    let current = true;
    Promise.resolve().then(() => board.recentProjects()).then(
      projects => { if (current) { setOthers(otherProjects(projects)); setLoadFailed(false); } },
      () => { if (current) { setOthers([]); setLoadFailed(true); } },
    );
    return () => { current = false; };
  }, [board, open]);

  return { others, loadFailed };
}

/** The list, the failure line and the start-screen link. Takes everything as props: no hooks, so it renders
 *  to static markup in tests with the same props the wrapper passes in the menu. */
export function RecentProjectsList({ projects, switching, openingStart = false, failureText, disabled, lang, onSwitch, onOpenStart }: {
  projects: DesktopRecentProject[];
  switching: string | null;
  openingStart?: boolean;
  failureText: string | null;
  disabled: boolean;
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
    <OpenStartScreen disabled={disabled || busy || openingStart} busy={openingStart} onOpen={onOpenStart} />
  </>;
}

export function RecentProjects({ open, disabled }: {
  open: boolean;
  disabled: boolean;
}) {
  const board = desktopBoard();
  const lang = useLang();
  const t = useText(text);
  const { others, loadFailed } = useRecentProjects(board, open);
  const navigation = useProjectNavigation(board);
  // No bridge — a browser served by the CLI or Docker: the section keeps exactly its old markup.
  if (!board) return null;
  // Without another project, older shells keep the single current-project row.
  if (others.length === 0 && !loadFailed) return null;
  const failureText = loadFailed ? t.recentFailed : navigation.failureText;
  return <div className="mission-control-recent">
    <RecentProjectsList projects={others} switching={navigation.switching} openingStart={navigation.openingStart} failureText={failureText} disabled={disabled || navigation.busy}
      lang={lang} onSwitch={path => void navigation.switchTo(path)} onOpenStart={() => void navigation.openStart()} />
  </div>;
}
