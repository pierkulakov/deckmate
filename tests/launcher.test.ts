import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../desktop/launcher/launcher.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../desktop/launcher/index.html', import.meta.url), 'utf8');
const launcherTokens = readFileSync(new URL('../desktop/launcher/tokens.css', import.meta.url), 'utf8');
const boardTokens = readFileSync(new URL('../client/styles.css', import.meta.url), 'utf8');

function themeTokens(css: string, dark: boolean) {
  const values = new Map<string, string>();
  const blocks = [...css.matchAll(/(:root(?:\.dark)?)\s*\{([^}]*)\}/gu)];
  for (const selector of dark ? [':root', ':root.dark'] : [':root']) {
    for (const block of blocks.filter(match => match[1] === selector)) {
      for (const variable of block[2].matchAll(/(--[\w-]+):\s*([^;]+);/gu)) values.set(variable[1], variable[2].trim());
    }
  }
  return values;
}

function rgb(hex: string): number[] { return hex.slice(1).match(/../gu)!.map(value => parseInt(value, 16) / 255); }
function contrast(first: number[], second: number[]) {
  const luminance = (values: number[]) => values.map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
  const a = luminance(first); const b = luminance(second);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}

// 2026-11-10: a small DOM seam exercises the shipped script without adding a browser dependency to unit tests.
class Element {
  children: Element[] = [];
  parentElement: Element | null = null;
  dataset: Record<string, string> = {};
  attributes: Record<string, string> = {};
  listeners: Record<string, (event: any) => unknown> = {};
  className = '';
  textContent = '';
  title = '';
  innerHTML = '';
  hidden = false;
  disabled = false;
  open = false;
  style = { setProperty: vi.fn() };
  onFocus: (node: Element) => void = () => {};
  classList = {
    contains: (name: string) => this.className.split(' ').includes(name),
    add: (name: string) => { this.classList.toggle(name, true); },
    toggle: (name: string, value?: boolean) => {
      const classes = new Set(this.className.split(' ').filter(Boolean));
      const next = value ?? !classes.has(name);
      if (next) classes.add(name); else classes.delete(name);
      this.className = [...classes].join(' ');
      return next;
    },
  };
  get firstElementChild() { return this.children[0]; }
  append(...nodes: Element[]) { for (const node of nodes) { node.parentElement = this; this.children.push(node); } }
  prepend(node: Element) { this.children = this.children.filter(child => child !== node); node.parentElement = this; this.children.unshift(node); }
  replaceChildren(...nodes: Element[]) { this.children = []; this.append(...nodes); }
  setAttribute(name: string, value: string) { this.attributes[name] = value; }
  removeAttribute(name: string) { delete this.attributes[name]; }
  addEventListener(name: string, callback: (event: any) => unknown) { this.listeners[name] = callback; }
  focus() { this.onFocus(this); }
  click() { if (!this.disabled) return this.listeners.click?.({ detail: 0, stopPropagation() {} }); }
  querySelectorAll(selector: string): Element[] {
    const all = this.children.flatMap(child => [child, ...child.querySelectorAll('*')]);
    if (selector === '*') return all;
    return all.filter(child => child.classList.contains(selector.replace(/^\./u, '')));
  }
}

const project = (name: string, extra = {}) => ({ path: `D:\\Projects\\${name}`, name, lastOpened: new Date().toISOString(), ...extra });
const fixture = { recent: [project('Last'), project('Other')], workspace: [project('Pinned'), project('Missing', { missing: true })], lastProject: project('Last').path };

async function launcher(snapshot = fixture, overrides: Record<string, unknown> = {}) {
  const nodes = new Map<string, Element>();
  let activeElement: Element;
  const create = () => { const node = new Element(); node.onFocus = value => { activeElement = value; }; return node; };
  const get = (id: string) => {
    if (!nodes.has(id)) nodes.set(id, create());
    return nodes.get(id)!;
  };
  const body = create();
  activeElement = body;
  get('create-panel').hidden = true;
  for (const id of ['open-folder', 'create-project']) {
    const action = create(); action.append(get(id)); get('actions').append(action);
  }
  const languages = ['en', 'ru'].map(lang => { const node = create(); node.dataset.lang = lang; return node; });
  const document = {
    body, documentElement: Object.assign(create(), { lang: 'en' }),
    get activeElement() { return activeElement; },
    getElementById: get, createElement: create,
    querySelectorAll(selector: string) {
      if (selector === '[data-lang]') return languages;
      if (selector === '[data-text]') return [];
      return ['last-list', 'recent-list', 'workspace-list'].flatMap(id => get(id).querySelectorAll('*'))
        .filter(node => selector.includes('button') ? node.className.startsWith('recent-') && !['recent-name', 'recent-tile', 'recent-path', 'recent-when', 'recent-missing'].includes(node.className) : node.classList.contains('recent-open'));
    },
    querySelector(selector: string) { if (selector === '.segment') return get('segment'); return this.querySelectorAll(selector)[0]; },
  };
  const bridge = {
    getState: vi.fn(async () => structuredClone(snapshot)),
    chooseFolder: vi.fn(async () => 'D:\\Projects\\New project'),
    openProject: vi.fn(async () => ({ ok: false, code: 'missing' })),
    createProject: vi.fn(async () => ({ ok: false, code: 'not-empty' })),
    removeRecent: vi.fn(async () => ({ ok: true })),
    addToWorkspace: vi.fn(async () => ({ ok: true, workspace: snapshot.workspace })),
    removeFromWorkspace: vi.fn(async () => ({ ok: true, workspace: [] })),
    moveInWorkspace: vi.fn(async () => ({ ok: true, workspace: [...snapshot.workspace].reverse() })),
    setLanguage: vi.fn(async () => ({ ok: true })),
    onStatus: vi.fn(), ...overrides,
  };
  const context = createContext({ window: { deckmateDesktop: bridge }, document, localStorage: { getItem: () => null, setItem() {} }, Intl, Date });
  runInContext(source, context);
  await vi.waitFor(() => expect(get('version').textContent).not.toBe(''));
  const evaluate = (code: string) => runInContext(code, context);
  return { get, bridge, languages, evaluate, document };
}

describe('desktop launcher', () => {
  it('keeps body, muted, primary-button and corrected error text above AA contrast in both themes', () => {
    for (const dark of [false, true]) {
      const tokens = themeTokens(launcherTokens, dark);
      const color = (role: string) => rgb(tokens.get(`--${role}`)!);
      for (const foreground of ['ink', 'muted']) {
        for (const background of ['canvas', 'ground', 'surface']) expect(contrast(color(foreground), color(background))).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast(color('button-ink'), color('accent-button'))).toBeGreaterThanOrEqual(4.5);
      const error = color('danger').map((value, index) => value * .9 + color('ink')[index] * .1);
      expect(contrast(error, color('ground'))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(color('focus'), color('canvas'))).toBeGreaterThanOrEqual(3);
    }
    expect(readFileSync(new URL('../desktop/launcher/launcher.css', import.meta.url), 'utf8')).toContain('color-mix(in srgb, var(--danger) 90%, var(--ink))');
  });

  it('keeps shared materials in sync with the board in both themes without changing its CSP', () => {
    const roles = ['font-sans', 'canvas', 'surface', 'ground', 'ink', 'muted', 'line', 'hover', 'accent', 'accent-soft', 'focus', 'danger', 'card-face', 'card-edge', 'card-metal', 'card-metal-ink', 'doc-metal', 'hero-metal', 'card-shadow', 'card-hover-shadow'];
    for (const dark of [false, true]) {
      const launcher = themeTokens(launcherTokens, dark);
      const board = themeTokens(boardTokens, dark);
      for (const role of roles) {
        expect(launcher.get(`--${role}`), `${role}, dark=${dark}`).toBe(board.get(`--${role}`));
      }
    }
    expect(html).toContain(`default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'`);
    expect(html).not.toMatch(/<script(?![^>]*src=)[^>]*>/u);
  });

  it('keeps both languages under the same keys and gives each required error a distinct recovery', async () => {
    const app = await launcher();
    expect(app.evaluate('Object.keys(texts.en).sort()')).toEqual(app.evaluate('Object.keys(texts.ru).sort()'));
    for (const lang of ['en', 'ru']) {
      const errors = app.evaluate(`lang = '${lang}'; Object.keys(errorTexts).slice(0).map(code => describeError({code}))`) as string[];
      expect(new Set(errors).size).toBe(errors.length);
      expect(errors.every(message => message.length > 30)).toBe(true);
    }
  });

  it('presents last, recent and workspace in that order, with no last-project duplicate in recent', async () => {
    const app = await launcher();
    expect(html.indexOf('id="last-project"')).toBeLessThan(html.indexOf('id="recent"'));
    expect(html.indexOf('id="recent"')).toBeLessThan(html.indexOf('id="workspace"'));
    expect(app.get('last-list').children).toHaveLength(1);
    expect(app.get('recent-list').children).toHaveLength(1);
    expect(app.get('recent-list').querySelectorAll('.recent-name')[0].textContent).toBe('Other');
  });

  it('makes creation the first action on first run and explains ownership and the real demo/template boundary', async () => {
    const app = await launcher({ recent: [], workspace: [], lastProject: null } as unknown as typeof fixture);
    expect(app.get('welcome').hidden).toBe(false);
    expect(app.get('recent').hidden).toBe(true);
    expect(app.get('actions').firstElementChild?.children[0]).toBe(app.get('create-project'));
    expect(app.evaluate('texts.ru.ownership')).toContain('Markdown');
    expect(app.evaluate('texts.ru.templateHelp')).toContain('всегда создаётся демо');
  });

  it('confirms the folder before writing, sends only the existing bridge option and allows going back', async () => {
    const app = await launcher();
    await app.get('create-project').click();
    expect(app.get('create-panel').hidden).toBe(false);
    expect(app.bridge.createProject).not.toHaveBeenCalled();
    await app.get('create-back').click();
    expect(app.get('create-panel').hidden).toBe(true);
    await app.get('create-project').click();
    await app.get('create-confirm').click();
    expect(app.bridge.createProject).toHaveBeenCalledWith({ folder: 'D:\\Projects\\New project' });
    expect(app.get('status-text').textContent).toContain('not empty');
  });

  it('does not turn a cancelled picker or rejected dialog into a write or unhandled rejection', async () => {
    const app = await launcher(fixture, { chooseFolder: vi.fn(async () => null) });
    await app.get('create-project').click();
    expect(app.get('create-panel').hidden).toBe(true);
    expect(app.bridge.createProject).not.toHaveBeenCalled();
    app.bridge.chooseFolder.mockRejectedValueOnce(new Error('dialog failure'));
    await app.get('open-folder').click();
    expect(app.get('status').dataset.phase).toBe('error');
    expect(app.get('status-technical').textContent).toBe('dialog failure');
  });

  it('keeps lists intact when saving settings fails and shows a localized explanation', async () => {
    const app = await launcher(fixture, { removeRecent: vi.fn(async () => ({ ok: false, code: 'save-failed', message: 'EACCES' })) });
    app.evaluate(`lang = 'ru'`);
    await app.evaluate(`removeRecent('D:\\\\Projects\\\\Other')`);
    expect(app.get('recent-list').children).toHaveLength(1);
    expect(app.get('status-text').textContent).toContain('Не удалось сохранить настройки');
    expect(app.get('status-technical').textContent).toBe('EACCES');
    expect(app.get('open-folder').disabled).toBe(false);
  });

  it('uses the error code for replayed native errors instead of substituting unlocalized server text', async () => {
    const app = await launcher();
    app.evaluate(`lang = 'ru'; handleStatus({phase: 'error', code: 'load-failed', path: 'D:\\\\Projects\\\\Last', message: 'Native load failed'})`);
    expect(app.get('status-text').textContent).toContain('Не удалось загрузить окно проекта');
    expect(app.get('status-text').textContent).not.toContain('Native');
    expect(app.get('status-technical').textContent).toBe('Native load failed');
  });

  it('keeps recovery translated and diagnostic text separate when the language changes', async () => {
    const app = await launcher();
    app.evaluate(`setStatus('error', {code: 'timeout', message: '<script>diagnostic</script>'}, () => {})`);
    expect(app.get('status-text').textContent).toContain('20 seconds');
    expect(app.get('status-text').textContent).not.toContain('<script>');
    await app.languages[1].click();
    expect(app.get('status').dataset.phase).toBe('error');
    expect(app.get('status-text').textContent).toContain('20 секунд');
    expect(app.get('status-technical').textContent).toBe('<script>diagnostic</script>');
    expect(app.get('status-retry').hidden).toBe(false);
  });

  it('allows another opening and ignores the old launch reply and stale status', async () => {
    const pending = new Map<string, (value: unknown) => void>();
    const app = await launcher(fixture, { openProject: vi.fn((folder: string) => new Promise(resolve => pending.set(folder, resolve))) });
    const first = app.evaluate(`openProject('D:\\\\Projects\\\\Last')`) as Promise<void>;
    expect(app.get('open-folder').disabled).toBe(false);
    expect(app.get('last-list').querySelectorAll('.recent-open')[0].attributes['aria-busy']).toBe('true');
    const second = app.evaluate(`openProject('D:\\\\Projects\\\\Other')`) as Promise<void>;
    pending.get(project('Last').path)!({ ok: false, code: 'missing' });
    await first;
    app.evaluate(`handleStatus({phase:'error', code:'missing', path:'D:\\\\Projects\\\\Last'})`);
    expect(app.get('status').dataset.phase).toBe('starting');
    expect(app.get('status-text').textContent).toContain('Other');
    pending.get(project('Other').path)!({ ok: false, code: 'timeout' });
    await second;
    expect(app.get('status-text').textContent).toContain('20 seconds');
    expect(app.get('create-project').disabled).toBe(false);
  });

  it('announces missing folders without opening them and keeps removal reachable', async () => {
    const app = await launcher();
    const row = app.get('workspace-list').children[1];
    expect(row.querySelectorAll('.recent-open')[0].attributes['aria-disabled']).toBe('true');
    await row.querySelectorAll('.recent-open')[0].click();
    expect(app.bridge.openProject).not.toHaveBeenCalled();
    expect(app.get('status-text').textContent).toContain('Reconnect');
    await row.querySelectorAll('.recent-remove').find(button => !button.classList.contains('recent-move'))!.click();
    expect(app.bridge.removeFromWorkspace).toHaveBeenCalledWith(project('Missing').path);
  });

  it('keeps mouse ordering and keyboard ordering on the same bridge path', async () => {
    const app = await launcher();
    const first = app.get('workspace-list').children[0];
    expect(first.querySelectorAll('.move-up')[0].disabled).toBe(true);
    await first.querySelectorAll('.move-down')[0].click();
    expect(app.bridge.moveInWorkspace).toHaveBeenCalledWith(project('Pinned').path, 1);
    expect(app.get('workspace-list').querySelectorAll('.recent-open')[1]).toBe(app.document.activeElement);
  });

  it('removes only the recent entry, confirms files are retained and restores keyboard focus', async () => {
    const app = await launcher();
    await app.get('recent-list').querySelectorAll('.recent-remove').find(button => !button.classList.contains('recent-pin'))!.click();
    expect(app.bridge.removeRecent).toHaveBeenCalledWith(project('Other').path);
    await vi.waitFor(() => expect(app.get('status-text').textContent).toContain('not deleted'));
    expect(app.get('open-folder')).toBe(app.document.activeElement);
  });

  it('shortens paths in the middle without losing Unicode or the original accessible path', async () => {
    const app = await launcher();
    const path = `D:\\${'Длинная папка\\'.repeat(10)}🎲 Мой проект`;
    app.evaluate(`state.recent = [{path: ${JSON.stringify(path)}, name: '🎲 Мой проект'}]; state.lastProject = null; renderRecent()`);
    const row = app.get('recent-list');
    const short = row.querySelectorAll('.recent-path')[0].children[0].textContent;
    expect(short).toContain('…');
    expect(short.endsWith('🎲 Мой проект')).toBe(true);
    expect(row.querySelectorAll('.recent-open')[0].attributes['aria-label']).toContain(path);
  });
});
