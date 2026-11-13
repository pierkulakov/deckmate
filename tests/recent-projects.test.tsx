import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { setLang } from '../client/i18n.ts';
import { tileColor, tileInitials } from '../client/project-tile.ts';
import { OpenStartScreen, ProjectTile, attemptSwitch, compactPath } from '../client/RecentProjects.tsx';
import type { DesktopBoardBridge, DesktopResult } from '../client/desktop-bridge.ts';
import { WorkspaceProjects } from '../client/WorkspaceProjects.tsx';

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

const longPath = 'D:\\Очень длинный путь\\с русскими папками\\Проект альфа';

function fakeBoard(result: DesktopResult | Error): { board: DesktopBoardBridge; calls: string[] } {
  const calls: string[] = [];
  const snapshot = async () => ({ ok: true as const, projects: [], current: 'C:/Current' });
  return { calls, board: {
    recentProjects: snapshot, workspaceProjects: snapshot,
    addToWorkspace: snapshot, removeFromWorkspace: snapshot, moveInWorkspace: snapshot,
    switchProject: async (path: string) => { calls.push(path); if (result instanceof Error) throw result; return result; },
    showStartScreen: async () => ({ ok: true }),
  } };
}

describe('shared project controls', () => {
  it('renders the same colored cover and initials for workspace and current-project rows', () => {
    const html = renderToStaticMarkup(<ProjectTile name="Проект альфа" />);
    expect(html).toContain('mission-control-recent-tile');
    expect(html).toContain(`--tile:${tileColor('Проект альфа')}`);
    expect(html).toContain('data-initials="ПА"');
    expect(renderToStaticMarkup(<ProjectTile name="" />)).toContain('data-initials=""');
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

  it('localizes the start-screen action and keeps a pending navigation busy', () => {
    const render = () => renderToStaticMarkup(<OpenStartScreen disabled busy onOpen={() => {}} />);
    expect(render()).toContain('Open start screen');
    setLang('ru');
    const html = render();
    expect(html).toContain('Открыть стартовый экран');
    expect(html).toContain('disabled');
    expect(html).toContain('aria-busy="true"');
  });

  it('returns null while the shell replaces the page and retains refused-switch diagnostics', async () => {
    const fine = fakeBoard({ ok: true });
    expect(await attemptSwitch(fine.board, 'C:\\Games\\tower-defence')).toBeNull();
    expect(fine.calls).toEqual(['C:\\Games\\tower-defence']);
    const refused = fakeBoard({ ok: false, code: 'missing' });
    expect(await attemptSwitch(refused.board, longPath)).toEqual({ ok: false, code: 'missing' });
    expect(refused.calls).toEqual([longPath]);
    const thrown = fakeBoard(new Error('bridge is gone'));
    expect(await attemptSwitch(thrown.board, longPath)).toEqual({ ok: false, code: 'unknown', message: 'bridge is gone' });
  });

  it('renders no workspace in browser mode', () => {
    expect(renderToStaticMarkup(<WorkspaceProjects open disabled={false} />)).toBe('');
  });
});

describe('shared project initials', () => {
  it('preserves Unicode letters and word boundaries', () => {
    expect(tileInitials('deckmate')).toBe('D');
    expect(tileInitials('Проект альфа')).toBe('ПА');
    expect(tileInitials('tower-defence')).toBe('TD');
    expect(tileInitials('Hollow Signal')).toBe('HS');
    expect(tileInitials('举动📈 mixed')).toBe('举M');
    expect(tileInitials('Подготовка-первого-релиза')).toBe('ПП');
    expect(tileInitials('  Wide  glyphs  ')).toBe('WG');
    expect(tileInitials('')).toBe('');
  });
});
