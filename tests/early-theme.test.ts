import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../desktop/launcher/theme.js', import.meta.url), 'utf8');
function choose(readSaved: () => string | null, systemDark: () => boolean): boolean {
  const context = vm.createContext({ readSaved, systemDark,
    document: { documentElement: { classList: { toggle() {}, contains: () => true }, style: {} }, addEventListener() {} },
    localStorage: { getItem: () => null } });
  vm.runInContext(source, context);
  return vm.runInContext('deckmateDarkTheme(readSaved, systemDark)', context) as boolean;
}

describe('shared blocking theme script', () => {
  it.each([['dark', false, true], ['light', true, false], [null, true, true], [null, false, true], ['invalid', false, true]] as const)
    ('chooses saved=%s, systemDark=%s', (saved, systemDark, expected) => {
      expect(choose(() => saved, () => systemDark)).toBe(expected);
    });
  it('defaults to dark when accessing localStorage throws, without consulting the system', () => {
    expect(choose(() => { throw new Error('SecurityError'); }, () => { throw new Error('must not run'); })).toBe(true);
  });
  it('does not consult system preferences when a saved theme exists', () => {
    expect(choose(() => 'light', () => { throw new Error('unavailable'); })).toBe(false);
  });
  it('defaults to dark if the system preference cannot be read', () => {
    expect(choose(() => null, () => { throw new Error('unavailable'); })).toBe(true);
  });
  it('loads a synchronous external script before styles in both entry points', () => {
    for (const entry of ['../client/index.html', '../desktop/launcher/index.html']) {
      const html = readFileSync(new URL(entry, import.meta.url), 'utf8');
      expect(html).toMatch(/<script src="\/?theme\.js"><\/script>/u);
      const stylesheet = html.indexOf('rel="stylesheet"');
      if (stylesheet !== -1) expect(html.indexOf('src="theme.js"')).toBeLessThan(stylesheet);
    }
  });
});
