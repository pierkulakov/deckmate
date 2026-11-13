import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../client/theme.js', import.meta.url), 'utf8');
function choose(readSaved: () => string | null, systemDark: () => boolean): boolean {
  const context = vm.createContext({ readSaved, systemDark,
    document: { documentElement: { getAttribute: () => null, classList: { toggle() {}, contains: () => true }, style: {} }, addEventListener() {} },
    window: {},
    localStorage: { getItem: () => null } });
  vm.runInContext(source, context);
  return vm.runInContext('deckmateDarkTheme(readSaved, systemDark)', context) as boolean;
}

describe('shared blocking theme script', () => {
  it.each([['dark', false, true], ['light', true, false], [null, true, true], [null, false, false], ['invalid', false, false], ['system', false, false]] as const)
    ('chooses saved=%s, systemDark=%s', (saved, systemDark, expected) => {
      expect(choose(() => saved, () => systemDark)).toBe(expected);
    });
  it('uses the system when accessing localStorage throws', () => {
    expect(choose(() => { throw new Error('SecurityError'); }, () => false)).toBe(false);
  });
  it('does not consult system preferences when a saved theme exists', () => {
    expect(choose(() => 'light', () => { throw new Error('unavailable'); })).toBe(false);
  });
  it('defaults to dark if the system preference cannot be read', () => {
    expect(choose(() => null, () => { throw new Error('unavailable'); })).toBe(true);
  });
  it('loads a synchronous same-origin script before styles in every entry point', () => {
    for (const entry of ['../client/index.html', '../client/desktop/index.html', '../client/desktop/startup.html', '../client/desktop/whats-new.html']) {
      const html = readFileSync(new URL(entry, import.meta.url), 'utf8');
      expect(html).toMatch(/<script src="\/?theme\.js"><\/script>/u);
      const stylesheet = html.indexOf('rel="stylesheet"');
      if (stylesheet !== -1) expect(html.indexOf('src="theme.js"')).toBeLessThan(stylesheet);
      const style = html.indexOf('<style>');
      if (style !== -1) expect(html.indexOf('src="theme.js"')).toBeLessThan(style);
    }
  });
});

function loadTheme(options: { shell?: string; boardTheme?: string; saved?: string; legacy?: string; systemDark?: boolean; storageBlocked?: boolean; board?: boolean } = {}) {
  let dark = false;
  const loaded: (() => void)[] = [];
  const setTheme = vi.fn(async (_theme: string) => ({ ok: true }));
  const readStorage = vi.fn((key: string) => {
    if (options.storageBlocked) throw new Error('SecurityError');
    return (key === 'deckmate-theme' ? options.saved : options.legacy) ?? null;
  });
  const root = {
    getAttribute: () => options.shell ?? null,
    classList: { contains: () => dark, toggle: (_name: string, value: boolean) => { dark = value; } },
    style: { removeProperty() {} },
  };
  vm.runInNewContext(source, {
    document: { documentElement: root, addEventListener: (_event: string, callback: () => void) => loaded.push(callback) },
    window: { deckmateBoard: options.board ? { theme: options.boardTheme, setTheme } : undefined },
    localStorage: { getItem: readStorage },
    matchMedia: () => ({ matches: options.systemDark ?? false }),
    console,
  });
  loaded.forEach(callback => callback());
  return { dark: () => dark, setTheme, readStorage };
}

describe('desktop theme handoff', () => {
  it('uses saved shell data ahead of the separate launcher storage and system preference', () => {
    expect(loadTheme({ shell: 'light', saved: 'dark', systemDark: true }).dark()).toBe(false);
    expect(loadTheme({ shell: 'dark', saved: 'light' }).dark()).toBe(true);
    expect(loadTheme({ shell: 'system', saved: 'dark' }).dark()).toBe(false);
    expect(loadTheme({ shell: 'light', storageBlocked: true, systemDark: true }).dark()).toBe(false);
  });

  it.each(['light', 'dark', 'system'])('uses shell preference %s on the board without reading or reporting stale origin storage', boardTheme => {
    for (const systemDark of [false, true]) {
      const page = loadTheme({ boardTheme, board: true, saved: boardTheme === 'dark' ? 'light' : 'dark', systemDark });
      expect(page.dark()).toBe(boardTheme === 'dark' || (boardTheme === 'system' && systemDark));
      expect(page.readStorage).not.toHaveBeenCalled();
      expect(page.setTheme).not.toHaveBeenCalled();
    }
  });

  it('keeps browser and older-shell saved choices, legacy fallback and blocked-storage defaults', () => {
    expect(loadTheme({ saved: 'light', legacy: 'dark', systemDark: true }).dark()).toBe(false);
    expect(loadTheme({ legacy: 'light', board: true, systemDark: true }).dark()).toBe(false);
    expect(loadTheme({ storageBlocked: true, systemDark: false }).dark()).toBe(false);
    expect(loadTheme({ board: true, boardTheme: 'light', storageBlocked: true, systemDark: true }).dark()).toBe(false);
  });

  it('never imports either local page storage into the shell', () => {
    for (const shell of ['light', 'dark', 'system']) {
      const page = loadTheme({ shell, saved: 'dark', legacy: 'light' });
      expect(page.readStorage).not.toHaveBeenCalled();
      expect(page.setTheme).not.toHaveBeenCalled();
    }
  });
});
