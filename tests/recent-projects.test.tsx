import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { setLang } from '../client/i18n.ts';
import { tileColor, tilePalette } from '../client/project-tile.ts';
import {
  OpenStartScreen, RecentProjects, RecentProjectsList, attemptSwitch, compactPath, otherProjects, switchFailureText, type RecentProjectsLabels,
} from '../client/RecentProjects.tsx';
import { hasWorkspace, type DesktopBoardBridge, type DesktopRecentProject, type DesktopResult } from '../client/desktop-bridge.ts';
import { WorkspaceProjects } from '../client/WorkspaceProjects.tsx';

// 2026-11-08: the project menu lists the shell's recent projects when the Desktop bridge is present
// (a fake window.deckmateBoard), keeps the current one out of the list, switches by path and shows
// a failure line; without a bridge the section renders exactly its old single row.

vi.hoisted(() => {
  vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
});

beforeEach(() => {
  vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
  vi.stubGlobal('window', Object.assign(new EventTarget(), { location: { origin: 'http://localhost' } }));
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
  setLang('en');
});

afterEach(() => vi.unstubAllGlobals());

const labels: RecentProjectsLabels = {
  openAnotherFolder: 'Open start screen',
  recentFailed: 'Could not load recent projects.',
  switchNotRecent: 'This folder is no longer in the recent list.',
  switchMissing: 'That folder was not found on this computer.',
  switchTimeout: 'The switch took too long; try again.',
  switchStartFailed: 'Deckmate could not start in that folder.',
  switchFailed: 'Could not switch the project.',
};

const longPath = 'D:\\Очень длинный путь\\с русскими папками\\Проект альфа';
const projects: DesktopRecentProject[] = [
  { path: 'C:\\Work\\deckmate', name: 'deckmate', lastOpened: new Date(Date.now() - 10 * 60000).toISOString(), current: true },
  { path: longPath, name: 'Проект альфа', lastOpened: new Date(Date.now() - 2 * 3600000).toISOString(), current: false },
  { path: 'C:\\Games\\tower-defence', name: 'tower-defence', lastOpened: new Date(Date.now() - 3 * 24 * 3600000).toISOString(), current: false },
];

function fakeBoard(result: DesktopResult | Error): { board: DesktopBoardBridge; calls: string[] } {
  const calls: string[] = [];
  return { calls, board: {
    recentProjects: async () => projects,
    switchProject: async (path: string) => { calls.push(path); if (result instanceof Error) throw result; return result; },
    showStartScreen: async () => ({ ok: true }),
  } };
}

function renderList(overrides: Partial<Parameters<typeof RecentProjectsList>[0]> = {}): string {
  const props: Parameters<typeof RecentProjectsList>[0] = {
    projects: otherProjects(projects), switching: null, failureText: null, disabled: false,
    lang: 'en', onSwitch: () => {}, onOpenStart: () => {}, ...overrides,
  };
  return renderToStaticMarkup(<RecentProjectsList {...props} />);
}

/** The list is presentational, so tests can render it once and also walk its elements to fire click handlers. */
function buttonsOf(node: ReactNode, found: ReactElement[] = []): ReactElement[] {
  Children.forEach(node, child => {
    if (!isValidElement(child)) return;
    if (child.type === 'button') found.push(child);
    buttonsOf((child.props as { children?: ReactNode }).children, found);
  });
  return found;
}

describe('recent projects list', () => {
  it('keeps only the other projects, with the full path in the title and localized relative time', () => {
    expect(otherProjects(projects).map(project => project.path)).toEqual([longPath, 'C:\\Games\\tower-defence']);
    const html = renderList();
    expect(html).toContain('>Проект альфа</strong>');
    expect(html).toContain('>tower-defence</strong>');
    expect(html).not.toContain('>deckmate</strong>');
    expect(html).toContain(`title="${longPath}"`);
    expect(html).toContain(compactPath(longPath));
    expect(html).toContain('2 hours ago');
    expect(html).toContain('3 days ago');
    expect(html).toContain(labels.openAnotherFolder);
    setLang('ru');
    expect(renderList({ lang: 'ru' })).toContain('2 часа назад');
  });

  it('renders an empty persisted date and a non-string project name without throwing', () => {
    const malformed = {
      path: 'C:\\Work\\malformed', name: 5, lastOpened: '', current: false,
    } as unknown as DesktopRecentProject;
    const html = renderList({ projects: [malformed] });
    expect(html).toContain('>5</strong>');
    expect(html).toContain(`--tile:${tileColor('5')}`);
    expect(html).toContain('dateTime=""');
  });

  it('gives every row the launcher cover tile instead of the letter avatar, colored by project name', () => {
    const html = renderList();
    expect(html.match(/mission-control-recent-tile/g)).toHaveLength(2);
    expect(html).toContain(`--tile:${tileColor('Проект альфа')}`);
    expect(html).toContain(`--tile:${tileColor('tower-defence')}`);
    expect(html).not.toContain('mission-control-avatar');
    // The launcher's start screen picks the same hue for the same name; a letter square is gone.
    expect(tileColor('Проект альфа')).not.toBe(tileColor('tower-defence'));
  });

  it('middle-truncates long paths while short ones stay whole', () => {
    const compact = compactPath(longPath);
    expect(compact).toContain('…');
    expect(compact.length).toBe(30);
    expect(compact.startsWith('D:\\Очень')).toBe(true);
    expect(compact.endsWith('Проект альфа')).toBe(true);
    expect(compactPath('C:\\Work', 30)).toBe('C:\\Work');
  });

  it('keeps the shortened folder suffix and places time beside the name', () => {
    const path = 'D:\\Work\\Shared\\Игровая-команда\\Подготовка-первого-релиза';
    const html = renderList({ projects: [{ ...projects[1], path }] });
    expect(html).toMatch(/<strong>[^<]*<\/strong><time[^>]*>[^<]*<\/time><\/div><span class="mission-control-recent-path">[^<]*первого-релиза<\/span>/u);
    expect(html).toContain(`title="${path}"`);
    expect(compactPath(path).match(/…/gu)).toHaveLength(1);
  });

  it('marks the switching row busy and disables every button while a switch is in flight or editing', () => {
    const switching = renderList({ switching: longPath });
    expect(switching).toContain('aria-busy="true"');
    // The spinner rides inside that row's tile, so the row keeps its shape while it waits.
    expect(switching).toContain('mission-control-recent-tile');
    expect(switching).toMatch(/lucide-loader/);
    expect(switching.match(/<button[^>]*disabled/g)).toHaveLength(3);
    const editing = renderList({ disabled: true });
    expect(editing.match(/<button[^>]*disabled/g)).toHaveLength(3);
  });

  it('shows the failure line under the list and no rows when there are no other projects', () => {
    expect(renderList({ failureText: labels.switchMissing })).toContain(`role="alert">${labels.switchMissing}`);
    const empty = renderList({ projects: [] });
    expect(empty).not.toContain('mission-control-recent-row');
    expect(empty).toContain(labels.openAnotherFolder);
  });

  it('clicks a row into switchProject with its path, and the start-screen link into its own action', async () => {
    const { board, calls } = fakeBoard({ ok: true });
    const opened: string[] = [];
    const tree = RecentProjectsList({
      projects: otherProjects(projects), switching: null, failureText: null, disabled: false, lang: 'en',
      onSwitch: path => void attemptSwitch(board, path), onOpenStart: () => opened.push('start'),
    });
    const row = buttonsOf(tree).find(button => (button.props as { title?: string }).title === longPath);
    (row?.props as { onClick: () => void }).onClick();
    await Promise.resolve();
    expect(calls).toEqual([longPath]);
    const open = (tree.props.children as ReactElement[]).find(child => isValidElement(child) && child.type === OpenStartScreen);
    (open?.props as { onOpen: () => void }).onOpen();
    expect(opened).toEqual(['start']);
  });
});

describe('recent projects switching', () => {
  it('returns null while the shell replaces the page and the code of a refused switch', async () => {
    const fine = fakeBoard({ ok: true });
    expect(await attemptSwitch(fine.board, 'C:\\Games\\tower-defence')).toBeNull();
    expect(fine.calls).toEqual(['C:\\Games\\tower-defence']);
    const refused = fakeBoard({ ok: false, code: 'missing' });
    expect(await attemptSwitch(refused.board, longPath)).toBe('missing');
    expect(refused.calls).toEqual([longPath]);
    const thrown = fakeBoard(new Error('bridge is gone'));
    expect(await attemptSwitch(thrown.board, longPath)).toBeUndefined();
  });

  it('words each shell failure code, with unknown codes falling back to the general line', () => {
    expect(switchFailureText(labels, 'not-recent')).toBe(labels.switchNotRecent);
    expect(switchFailureText(labels, 'missing')).toBe(labels.switchMissing);
    expect(switchFailureText(labels, 'timeout')).toBe(labels.switchTimeout);
    expect(switchFailureText(labels, 'start-failed')).toBe(labels.switchStartFailed);
    expect(switchFailureText(labels, 'surprise')).toBe(labels.switchFailed);
    expect(switchFailureText(labels, undefined)).toBe(labels.switchFailed);
  });
});

describe('recent projects without the bridge', () => {
  it('renders nothing, so the project section keeps its single current-project row', () => {
    expect(renderToStaticMarkup(<RecentProjects open disabled={false} />)).toBe('');
    expect(renderToStaticMarkup(<WorkspaceProjects open disabled={false} />)).toBe('');
  });

  it('requires the complete workspace capability and keeps older or partial bridges usable', () => {
    const { board } = fakeBoard({ ok: true });
    expect(hasWorkspace(board)).toBe(false);
    board.workspaceProjects = async () => [];
    expect(hasWorkspace(board)).toBe(false);
    board.addToWorkspace = async () => ({ ok: true, projects: [] });
    board.removeFromWorkspace = async () => ({ ok: true, projects: [] });
    board.moveInWorkspace = async () => ({ ok: true, projects: [] });
    expect(hasWorkspace(board)).toBe(true);
  });
});

describe('project tile palette mirror', () => {
  // 2026-11-08: client/project-tile.ts mirrors tilePalette/tileColor from desktop/launcher/launcher.js by hand,
  // because the launcher is a separate build the client cannot import. This reads the launcher source as text
  // and recomputes its pick, so the two cannot quietly drift apart and recolor projects on one side only.
  it('picks the same colors as the launcher for the same names', () => {
    const source = readFileSync(fileURLToPath(new URL('../desktop/launcher/launcher.js', import.meta.url)), 'utf8');
    const colors = [...(source.match(/const tilePalette = \[([^\]]*)\]/)?.[1] ?? '').matchAll(/#[0-9a-f]{6}/gi)].map(match => match[0].toLowerCase());
    expect(colors).toEqual(tilePalette);
    const step = Number(source.match(/hash \* (\d+) \+ char\.codePointAt\(0\)/)?.[1]);
    expect(Number.isInteger(step)).toBe(true);
    const launcherColor = (name: string) => {
      let hash = 0;
      for (const char of name) hash = (hash * step + (char.codePointAt(0) ?? 0)) >>> 0;
      return colors[hash % colors.length];
    };
    for (const name of ['deckmate', 'Проект альфа', 'tower-defence', 'Hollow Signal', '举动📈 mixed', '']) {
      expect(tileColor(name)).toBe(launcherColor(name));
    }
  });
});
