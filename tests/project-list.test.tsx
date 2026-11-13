import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProjectList, type ProjectListEntry } from '../client/ProjectList.tsx';
import { ProjectListFeedback } from '../client/ProjectListFeedback.tsx';
import { projectListCommand, projectShortcutIndex } from '../client/project-list-navigation.ts';
import { projectPathKey } from '../client/project-path.ts';
import { setLang } from '../client/i18n.ts';
import { relativeTimeAgo } from '../client/relative-time.ts';

vi.hoisted(() => { vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' }); });
beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem() {} });
  setLang('en');
});
afterEach(() => vi.unstubAllGlobals());

const key = (key: string, modifiers = {}) => ({ key, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...modifiers });
const projects: ProjectListEntry[] = [
  { path: 'C:/Current', name: 'Current', current: true, missing: false },
  { path: 'C:/Lost', name: 'Lost', current: false, missing: true },
  { path: 'C:/Other', name: 'Other', current: false, missing: false },
];

describe('shared project list keyboard', () => {
  it('moves through current and missing rows, clamps edges and supports Home/End', () => {
    expect(projectListCommand(key('ArrowDown'), 0, 3)).toEqual({ kind: 'focus', index: 1 });
    expect(projectListCommand(key('ArrowUp'), 1, 3)).toEqual({ kind: 'focus', index: 0 });
    expect(projectListCommand(key('ArrowUp'), 0, 3)).toEqual({ kind: 'focus', index: 0 });
    expect(projectListCommand(key('ArrowDown'), 2, 3)).toEqual({ kind: 'focus', index: 2 });
    expect(projectListCommand(key('Home'), 2, 3)).toEqual({ kind: 'focus', index: 0 });
    expect(projectListCommand(key('End'), 0, 3)).toEqual({ kind: 'focus', index: 2 });
    expect(projectListCommand(key('End'), -1, 0)).toBeNull();
  });
  it('deletes and reorders without interpreting unrelated modified keys', () => {
    for (const name of ['Delete', 'Backspace']) expect(projectListCommand(key(name), 0, 3)).toEqual({ kind: 'remove' });
    expect(projectListCommand(key('ArrowDown', { altKey: true }), 0, 3)).toEqual({ kind: 'move', index: 1 });
    expect(projectListCommand(key('ArrowUp', { altKey: true }), 1, 3)).toEqual({ kind: 'move', index: 0 });
    expect(projectListCommand(key('ArrowUp', { altKey: true }), 0, 3)).toBeNull();
    expect(projectListCommand(key('ArrowDown', { altKey: true }), 2, 3)).toBeNull();
    for (const modifier of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey']) expect(projectListCommand(key('Delete', { [modifier]: true }), 1, 3)).toBeNull();
  });
  it('pins Ctrl+1…9 to stored order and ignores out-of-range or modified shortcuts', () => {
    for (let digit = 1; digit <= 9; digit++) expect(projectShortcutIndex(key(String(digit), { ctrlKey: true }), 10)).toBe(digit - 1);
    expect(projectShortcutIndex(key('4', { ctrlKey: true }), 3)).toBeNull();
    expect(projectShortcutIndex(key('0', { ctrlKey: true }), 10)).toBeNull();
    for (const modifier of ['altKey', 'metaKey', 'shiftKey']) expect(projectShortcutIndex(key('1', { ctrlKey: true, [modifier]: true }), 3)).toBeNull();
    expect(projectShortcutIndex(key('1'), 3)).toBeNull();
  });
});

describe('shared project list states', () => {
  it('renders current and missing state, sortable controls and busy navigation from props alone', () => {
    const html = renderToStaticMarkup(<ProjectList projects={projects} onOpen={() => {}} onRemove={() => true} onMove={() => true} switching="C:/Other" pending moveButtons />);
    expect(html).toContain('aria-current="true"');
    expect(html).toContain('is-missing');
    expect(html).toContain('Folder not found');
    expect(html).toContain('data-reserve="Папка не найдена"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Control+3 Alt+ArrowUp Alt+ArrowDown');
    expect(html.match(/disabled=""/gu)).toHaveLength(9);
  });
  it('only offers pinning to unpinned recents and preserves dates and paths', () => {
    const html = renderToStaticMarkup(<ProjectList kind="recent" projects={projects.map((entry, index) => ({ ...entry, pinned: index === 0, lastOpened: '2026-11-13T10:00:00Z' }))}
      onOpen={() => {}} onPin={() => true} onRemove={() => true} />);
    expect(html.match(/project-list-pin control/gu)).toHaveLength(2);
    expect(html.match(/<time /gu)).toHaveLength(3);
    expect(html).not.toContain('Control+1');
    expect(html).toContain('title="C:/Lost"');
    expect(projectPathKey('C:/Work/')).toBe(projectPathKey('c:\\work'));
    expect(projectPathKey('/Work')).not.toBe(projectPathKey('/work'));
  });
  it.each(['recent', 'workspace'] as const)('uses folder names for empty %s names in headings, tiles and every accessible action', kind => {
    const html = renderToStaticMarkup(<ProjectList kind={kind} projects={[
      { path: 'D:/Projects/Alpha', name: '', current: false, missing: false },
      { path: 'D:\\Projects\\Beta\\', name: '', current: false, missing: false },
      { path: '/projects/Gamma/', name: 'Saved alias', current: false, missing: false },
    ]} onOpen={() => {}} onRemove={() => true} onPin={() => true} onMove={() => true} moveButtons />);
    for (const [name, initials] of [['Alpha', 'A'], ['Beta', 'B'], ['Saved alias', 'SA']]) {
      expect(html).toContain(`<strong title="${name}">${name}</strong>`);
      expect(html).toContain(`data-initials="${initials}"`);
      for (const action of [kind === 'recent' ? 'Remove from the list' : 'Remove from workspace', 'Add to workspace', 'Move up', 'Move down'])
        expect(html).toContain(`aria-label="${action}: ${name}"`);
    }
    expect(html).toContain('aria-label="Alpha: D:/Projects/Alpha"');
    expect(html).toContain('aria-label="Beta: D:\\Projects\\Beta\\"');
    expect(html).toContain('aria-label="Saved alias: /projects/Gamma/"');
  });
  it('uses calendar project dates without changing compact notification dates', () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-13T10:00:00Z'));
    try {
      expect(relativeTimeAgo('invalid', 'en', 'calendar')).toBe('');
      expect(relativeTimeAgo('2026-11-13T09:59:20Z', 'en', 'calendar')).toBe('just now');
      expect(relativeTimeAgo('2026-11-13T09:59:20Z', 'en')).toBe('1 minute ago');
      expect(relativeTimeAgo('2026-11-13T09:38:00Z', 'ru', 'calendar')).toBe('22 минуты назад');
      expect(relativeTimeAgo('2025-11-13T10:00:00Z', 'en', 'calendar')).toBe('last year');
    } finally { vi.restoreAllMocks(); }
  });
  it('localizes failures while escaping diagnostics, retaining Retry and choose-folder recovery', () => {
    setLang('ru');
    const html = renderToStaticMarkup(<ProjectListFeedback failure={{ ok: false, code: 'missing', message: '<script>technical</script>' }} onRetry={() => {}} onChooseFolder={() => {}} />);
    expect(html).toContain('Папка не найдена');
    expect(html).toContain('Выбрать папку…');
    expect(html).toContain('Технические подробности');
    expect(html).toContain('&lt;script&gt;technical&lt;/script&gt;');
    expect(renderToStaticMarkup(<ProjectListFeedback failure={{ ok: false, code: 'timeout' }} onRetry={() => {}} />)).toContain('Повторить');
    expect(renderToStaticMarkup(<ProjectListFeedback failure={null} />)).toBe('');
  });
  it('has no runtime import path into board data or the Mission Control wrapper', () => {
    const visited = new Set<string>();
    function visit(filename: string) {
      if (visited.has(filename) || !/\.[jt]sx?$/u.test(filename)) return;
      visited.add(filename);
      const source = readFileSync(filename, 'utf8');
      expect(source, filename).not.toMatch(/fetch\s*\(\s*['"]\/api/u);
      for (const match of source.matchAll(/^(?:import|export)\s+(?!type\b)(?:[^;]*?\sfrom\s*)?['"](\.[^'"]+)['"]/gmu))
        visit(path.resolve(path.dirname(filename), match[1]));
    }
    visit(path.resolve('client/ProjectList.tsx'));
    visit(path.resolve('client/ProjectListFeedback.tsx'));
    for (const filename of visited) expect(filename).not.toMatch(/[/\\](App|useWorkspace|catalog-store|WorkspaceProjects|RecentProjects)\.[jt]sx?$/u);
  });
});
