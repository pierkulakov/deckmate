import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBrowserSession } from './browser-session.ts';
import { requireBrowser } from './browser-environment.ts';
import { waitForLayout } from './browser-layout.ts';
import { desktopErrorText } from '../client/desktop-errors.ts';

const browserPath = requireBrowser();
const row = '.mission-control-workspace-open';
const path = (name: string) => `D:\\Projects\\${name}`;
const ready = `Boolean(document.querySelector('#launcher:not([aria-busy])'))`;

it.each(['en', 'ru'] as const)('explains every desktop failure distinctly in %s', lang => {
  const codes = ['not-empty', 'missing', 'invalid-path', 'not-in-workspace', 'workspace-full', 'not-recent', 'forbidden',
    'start-failed', 'create-failed', 'timeout', 'load-failed', 'save-failed', 'invalid-language', 'invalid-theme', 'cancelled', 'superseded', 'closed', 'unknown'];
  const explanations = codes.map(code => desktopErrorText(code, lang));
  expect(explanations.every(explanation => explanation.length > 10)).toBe(true);
  expect(new Set(explanations).size).toBe(codes.length);
  expect(desktopErrorText('unrecognized', lang)).toBe(desktopErrorText('unknown', lang));
  for (const code of codes) expect(desktopErrorText(code, 'en')).not.toBe(desktopErrorText(code, 'ru'));
});

describe.skipIf(!browserPath)('React desktop start screen', () => {
  const session = createBrowserSession();
  const { send, evaluate, until } = session;
  beforeAll(async () => { await session.open(browserPath!); await session.navigate('launcher', ready); }, 90000);
  afterAll(() => session.close(), 20000);
  async function render(options: object = {}, wait = true) {
    await evaluate(`window.launcherTest.hidden(false); window.launcherTest.render(${JSON.stringify(options)})`);
    if (wait) await until(ready);
  }
  const click = (selector: string) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const focus = (selector: string) => evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
  const active = () => evaluate(`document.activeElement.dataset.path || document.activeElement.id`);
  const text = (selector: string) => evaluate(`document.querySelector(${JSON.stringify(selector)}).textContent`);
  const calls = (method: string) => evaluate(`window.launcherTest.calls.filter(call => call.method === ${JSON.stringify(method)}).map(call => call.args)`);
  const reply = (method: string, value: unknown) => evaluate(`window.launcherTest.reply(${JSON.stringify(method)}, ${JSON.stringify(value)})`);
  const emit = (value: unknown) => evaluate(`window.launcherTest.emit(${JSON.stringify(value)})`);
  const status = (phase: string) => until(`document.querySelector('#status').dataset.phase === '${phase}'`);
  async function key(name: string, modifiers = 0) {
    const codes: Record<string, number> = { ArrowUp: 38, ArrowDown: 40, Home: 36, End: 35, Delete: 46, Backspace: 8, Enter: 13, Escape: 27, Tab: 9 };
    for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: name, code: name, modifiers,
      windowsVirtualKeyCode: codes[name] ?? name.toUpperCase().charCodeAt(0), text: type === 'keyDown' && name === 'Enter' ? '\r' : undefined });
  }
  async function language(lang: string) {
    if (await evaluate(`document.documentElement.lang !== '${lang}'`)) await click('.language-toggle');
    await until(`document.documentElement.lang === '${lang}'`);
  }

  it('presents last, recent and workspace in order without duplicate recents, with initial focus on Open', async () => {
    await render();
    expect(await evaluate(`['last-list','recent-list','workspace-list'].map(id => [...document.querySelectorAll('#'+id+' ${row}')].map(node => node.dataset.path))`))
      .toEqual([[path('Last')], [path('Other')], [path('Pinned'), path('Missing')]]);
    expect(await evaluate(`document.querySelector('#actions').firstElementChild.querySelector('button').id`)).toBe('open-folder');
    expect(await active()).toBe('open-folder');
    expect(await text('#version')).toBe('Deckmate 0.8.1');
  });
  it('makes Create first on first run and explains Markdown ownership and the demo/template boundary', async () => {
    await render({ empty: true });
    expect(await active()).toBe('create-project');
    expect(await evaluate(`document.querySelector('#actions').firstElementChild.querySelector('button').id`)).toBe('create-project');
    expect(await evaluate(`!document.querySelector('#welcome').hidden && document.querySelector('#recent').hidden && document.querySelector('#workspace').hidden`)).toBe(true);
    await language('ru');
    expect(await text('.ownership')).toContain('Markdown');
    expect(await text('.template-help')).toContain('всегда создаётся демо');
  });
  it('keeps the dev mock on the native snapshot contract for state and every list mutation', async () => {
    await render({ demo: true });
    const results = await evaluate(`(async () => {
      const bridge = window.deckmateDesktop;
      return [await bridge.getState(), await bridge.addToWorkspace('C:/Demo'), await bridge.moveInWorkspace('C:/Demo', 0),
        await bridge.removeFromWorkspace('C:/Demo'), await bridge.removeRecent('C:/Demo')];
    })()`);
    for (const result of results) {
      expect(result).toMatchObject({ ok: true, current: null });
      expect(Array.isArray(result.projects)).toBe(true);
      expect(result).not.toHaveProperty('workspace');
      for (const entry of result.projects) expect(entry).toMatchObject({ current: false, missing: expect.any(Boolean) });
    }
  });
  it('supports arrows, Home/End, Delete/Backspace, Alt+arrows and mouse ordering through the same IPC', async () => {
    await render(); await focus(`#last-list ${row}`);
    await key('ArrowDown'); expect(await active()).toBe(path('Other'));
    await key('ArrowUp'); expect(await active()).toBe(path('Last'));
    await key('End'); expect(await active()).toBe(path('Missing'));
    await key('Home'); expect(await active()).toBe(path('Last'));
    await focus(`#workspace-list ${row}`); await key('ArrowDown', 1);
    await until(`document.querySelectorAll('#workspace-list ${row}')[1].dataset.path === ${JSON.stringify(path('Pinned'))}`);
    expect(await active()).toBe(path('Pinned'));
    await click('#workspace-list li:nth-child(2) .project-list-up');
    await until(`document.querySelector('#workspace-list ${row}').dataset.path === ${JSON.stringify(path('Pinned'))}`);
    expect(await calls('moveInWorkspace')).toEqual([[path('Pinned'), 1], [path('Pinned'), 0]]);
    await key('Delete'); await until(`document.querySelectorAll('#workspace-list li').length === 1`);
    expect(await active()).toBe(path('Missing'));
    await key('Backspace'); await until(`document.querySelectorAll('#workspace-list li').length === 0`);
    expect(await active()).toBe('workspace-add');
    await focus(`#recent-list ${row}`); await key('Delete'); await status('success');
    await until(`document.querySelectorAll('#recent-list li').length === 0`);
    expect(await active()).toBe('open-folder');
    expect(await text('#status-text')).toContain('not deleted');
  });
  it('opens Ctrl+1…9 in stored order and leaves native accelerators to the shell', async () => {
    const projects = Array.from({ length: 10 }, (_, index) => ({ path: path(`Project ${index + 1}`), name: `Project ${index + 1}`, missing: false, current: false }));
    await render({ snapshot: { projects } });
    for (let index = 1; index <= 9; index++) { await key(String(index), 2); await status('error'); }
    expect(await calls('openProject')).toEqual(projects.slice(0, 9).map(project => [project.path]));
    await render({ native: true }); await key('1', 2);
    expect(await calls('openProject')).toEqual([]);
    await key('o', 2); expect(await calls('chooseFolder')).toEqual([]);
  });
  it.each([false, true])('F08: delayed state preserves creation focus and Escape (first run=%s)', async empty => {
    for (const target of ['create-heading', 'create-confirm', 'create-back']) {
      await render({ empty, delayState: true }, false);
      await click('#create-project'); await until(`!document.querySelector('#create-panel').hidden`);
      expect(await active()).toBe('create-heading'); await focus('#' + target);
      await evaluate('window.launcherTest.releaseState()'); await until(ready);
      expect(await active()).toBe(target);
      expect(await text('#create-folder')).toBe(path('New project'));
      expect(await calls('createProject')).toEqual([]);
      await key('Escape'); await until(`document.querySelector('#create-panel').hidden`);
      expect(await active()).toBe('create-project');
    }
  });
  it.each([false, true])('F08: delayed state and font preparation respect a chosen action (first run=%s)', async empty => {
    for (const stage of ['state', 'prepare']) {
      await render({ empty, delayState: stage === 'state', delayPrepare: stage === 'prepare' }, false);
      await focus(empty ? '#open-folder' : '#create-project');
      if (stage === 'prepare') await until(`window.launcherTest.calls.some(call => call.method === 'getState')`);
      await evaluate(stage === 'state' ? 'window.launcherTest.releaseState()' : 'window.launcherTest.releasePrepare()');
      await until(ready); expect(await active()).toBe(empty ? 'open-folder' : 'create-project');
    }
    await render({ empty, delayState: true }, false);
    await evaluate('window.launcherTest.releaseState()'); await until(ready);
    expect(await active()).toBe(empty ? 'create-project' : 'open-folder');
  });
  it('confirms before writing, sends only {folder}, and supports Back, cancellation and failed dialogs', async () => {
    await render(); await click('#create-project'); await until(`!document.querySelector('#create-panel').hidden`);
    expect(await calls('createProject')).toEqual([]);
    await click('#create-back'); await until(`document.querySelector('#create-panel').hidden`);
    expect(await active()).toBe('create-project');
    await click('#create-project'); await until(`!document.querySelector('#create-panel').hidden`);
    await click('#create-confirm'); await status('error');
    expect(await calls('createProject')).toEqual([[{ folder: path('New project') }]]);
    expect(await text('#status-retry')).toBe('Choose folder…');
    await click('#status-retry'); await until(`!document.querySelector('#create-panel').hidden`);
    await click('#create-back');
    await reply('chooseFolder', null); await click('#create-project');
    expect(await evaluate(`document.querySelector('#create-panel').hidden`)).toBe(true);
    expect(await calls('createProject')).toEqual([[{ folder: path('New project') }]]);
    await reply('chooseFolder', { throw: 'dialog failure' }); await click('#open-folder'); await status('error');
    expect(await text('#status-technical')).toBe('dialog failure');
    await reply('chooseFolder', { ok: false, code: 'invalid-path' }); await click('#workspace-add');
    await until(`document.querySelector('#status-text').textContent.includes('path is not available')`);
    expect(await calls('addToWorkspace')).toEqual([]);
  });
  it('uses authoritative mutation snapshots, preserving current/missing and pinning through the folder dialog', async () => {
    await render();
    const returned = [{ path: path('Returned'), name: 'Returned', current: true, missing: true }];
    await reply('addToWorkspace', { ok: true, projects: returned, current: returned[0].path });
    await click('#workspace-add'); await status('success');
    expect(await calls('addToWorkspace')).toEqual([[path('New project')]]);
    expect(await evaluate(`document.querySelector('#workspace-list li').className`)).toContain('is-current is-missing');
    await reply('removeRecent', { ok: true, projects: [{ ...returned[0], path: path('Returned recent'), lastOpened: '2026-11-13T10:00:00Z' }], current: path('Returned recent') });
    await click('#recent-list .project-list-remove'); await until(`document.querySelector('#recent-list ${row}')?.dataset.path === ${JSON.stringify(path('Returned recent'))}`);
    expect(await evaluate(`document.querySelector('#recent-list li').className`)).toContain('is-current is-missing');
    await render(); await click('#recent-list .project-list-pin'); await status('success');
    expect(await calls('addToWorkspace')).toEqual([[path('Other')]]);
    expect(await evaluate(`document.querySelectorAll('#recent-list li').length`)).toBe(0);
  });
  it('keeps failed settings mutations intact and retries them with localized diagnostics', async () => {
    await render(); await language('ru');
    await reply('removeRecent', { ok: false, code: 'save-failed', message: 'EACCES' });
    await click('#recent-list .project-list-remove'); await status('error');
    expect(await evaluate(`document.querySelectorAll('#recent-list li').length`)).toBe(1);
    expect(await text('#status-text')).toContain('Не удалось сохранить настройки');
    expect(await text('#status-technical')).toBe('EACCES');
    await click('#status-retry'); await status('success');
    expect(await calls('removeRecent')).toEqual([[path('Other')], [path('Other')]]);
  });
  it.each(['#workspace-add', '#recent-list .project-list-pin'])('recovers failed pinning from %s by adding the newly chosen folder', async selector => {
    for (const code of ['missing', 'invalid-path']) {
      await render(); await reply('addToWorkspace', { ok: false, code });
      await click(selector); await status('error');
      expect(await text('#status-retry')).toBe('Choose folder…');
      await reply('chooseFolder', path('Replacement')); await click('#status-retry'); await status('success');
      expect(await calls('addToWorkspace')).toEqual([[path(selector === '#workspace-add' ? 'New project' : 'Other')], [path('Replacement')]]);
      expect(await calls('openProject')).toEqual([]);
      expect(await calls('createProject')).toEqual([]);
    }
  });
  it.each(['en', 'ru'] as const)('explains the workspace limit in %s without offering an opening action', async lang => {
    const projects = Array.from({ length: 30 }, (_, index) => ({ path: path(`Pinned ${index}`), name: `Pinned ${index}`, current: false, missing: false }));
    for (const selector of ['#workspace-add', '#recent-list .project-list-pin']) {
      await render({ snapshot: { projects, language: lang } });
      await reply('addToWorkspace', { ok: false, code: 'invalid-path', message: 'native limit' });
      await click(selector); await status('error');
      expect(await text('#status-text')).toBe(lang === 'en'
        ? 'The workspace holds up to 30 projects. Remove one to add another.'
        : 'В пространстве может быть до 30 проектов. Уберите один, чтобы добавить другой.');
      expect(await text('#status-technical')).toBe('native limit');
      expect(await evaluate(`document.querySelector('#status-retry').hidden`)).toBe(true);
      expect(await calls('openProject')).toEqual([]);
      await click('#workspace-list .project-list-remove'); await status('success');
      await click('#workspace-add'); await status('success');
      expect((await calls('addToWorkspace')).length).toBe(2);
      expect(await evaluate(`document.querySelectorAll('#workspace-list li').length`)).toBe(30);
    }
  });
  it.each(['en', 'ru'] as const)('replays a deferred native error after subscribing and keeps error recovery in %s', async lang => {
    await render({ snapshot: { language: lang }, replay: { phase: 'error', code: 'load-failed', path: path('Last'), message: '<script>Native failure</script>' } });
    await status('error');
    expect(await text('#status-text')).toBe(desktopErrorText('load-failed', lang));
    expect(await text('#status-technical')).toBe('<script>Native failure</script>');
    expect(await evaluate(`window.launcherTest.calls.slice(0,2).map(call => call.method)`)).toEqual(['onStatus', 'getState']);
    expect(await evaluate(`document.querySelector('#status-technical script') === null`)).toBe(true);
    await language(lang === 'en' ? 'ru' : 'en');
    expect(await text('#status-text')).toBe(desktopErrorText('load-failed', lang === 'en' ? 'ru' : 'en'));
    await click('#status-details summary'); expect(await evaluate(`document.querySelector('#status-details').open`)).toBe(true);
    await click('#status-retry'); await status('error'); expect(await calls('openProject')).toEqual([[path('Last')]]);
    await until(`document.querySelector('#status-details').hidden`);
    expect(await evaluate(`document.querySelector('#status-details').open`)).toBe(false);
  });
  it.each(['missing', 'invalid-path', 'not-empty', 'create-failed', 'start-failed', 'timeout', 'load-failed'])('%s offers the correct Retry or Choose folder', async code => {
    await render(); await emit({ phase: 'error', path: path('Last'), code, message: 'diagnostic' }); await status('error');
    expect(await text('#status-text')).toBe(desktopErrorText(code, 'en'));
    const choose = ['missing', 'invalid-path', 'not-empty', 'create-failed'].includes(code);
    expect(await text('#status-retry')).toBe(choose ? 'Choose folder…' : 'Try again');
    await click('#status-retry');
    if (['not-empty', 'create-failed'].includes(code)) {
      await until(`!document.querySelector('#create-panel').hidden`); expect(await calls('createProject')).toEqual([]);
    } else await until(`window.launcherTest.calls.some(call => call.method === 'openProject')`);
    expect((await calls('chooseFolder')).length).toBe(choose ? 1 : 0);
  });
  it('allows superseding opens, ignores stale status and replies, and leaves no busy state after cancellation', async () => {
    await render(); await evaluate(`window.launcherTest.hold('openProject')`);
    await click(`#last-list ${row}`); await status('starting');
    expect(await evaluate(`!document.querySelector('#open-folder').disabled && document.querySelector('#create-project').disabled && document.querySelector('#last-list ${row}').getAttribute('aria-busy') === 'true'`)).toBe(true);
    await click(`#recent-list ${row}`);
    await evaluate(`window.launcherTest.resolve('openProject',{ok:false,code:'missing'}); window.launcherTest.emit({phase:'error',code:'missing',path:${JSON.stringify(path('Last'))}})`);
    expect(await text('#status-text')).toContain('Other'); await status('starting');
    await evaluate(`window.launcherTest.resolve('openProject',{ok:false,code:'timeout'})`); await status('error');
    expect(await text('#status-text')).toContain('20 seconds');
    for (const code of ['cancelled', 'closed', 'superseded']) {
      await render(); await reply('openProject', { ok: false, code }); await click(`#last-list ${row}`);
      await until(`!document.querySelector('#create-project').disabled && !document.querySelector('#status').dataset.phase`);
    }
  });
  it.each(['superseded', 'missing'])('keeps native launch progress when the prior opening replies with %s', async code => {
    await render({ native: true }); await evaluate(`window.launcherTest.hold('openProject')`);
    await click(`#last-list ${row}`); await status('starting');
    await emit({ phase: 'starting', path: path('Pinned') });
    await until(`document.querySelector('#status-text').textContent.includes('Starting Pinned')`);
    await evaluate(`window.launcherTest.resolve('openProject', ${JSON.stringify({ ok: false, code })})`);
    for (const phase of ['ready', 'error']) await emit({ phase, path: path('Last'), code: phase === 'error' ? 'missing' : undefined });
    await status('starting');
    expect(await text('#status-text')).toContain('Starting Pinned');
    expect(await evaluate(`document.querySelector('#create-project').disabled && document.querySelector('#workspace-add').disabled
      && document.querySelector('#workspace-list ${row}').getAttribute('aria-busy') === 'true'
      && document.querySelector('#last-list ${row}').getAttribute('aria-busy') === 'false'
      && !document.querySelector('#last-list li').classList.contains('is-missing')`)).toBe(true);
    await emit({ phase: 'ready', path: path('Pinned') }); await status('ready');
    expect(await evaluate(`document.querySelector('#create-project').disabled`)).toBe(true);
    await emit({ phase: 'error', path: path('Pinned'), code: 'timeout' }); await status('error');
    expect(await evaluate(`document.querySelector('#create-project').disabled`)).toBe(false);
    await click('#status-retry'); await status('starting');
    expect(await calls('openProject')).toEqual([[path('Last')], [path('Pinned')]]);
    await evaluate(`window.launcherTest.resolve('openProject', {ok:false,code:'cancelled'})`);
  });
  it('replaces creation progress with a native opening and accepts a launch after supersession has already replied', async () => {
    await render(); await evaluate(`window.launcherTest.hold('createProject')`);
    await click('#create-project'); await until(`!document.querySelector('#create-panel').hidden`);
    await click('#create-confirm'); await status('starting');
    await emit({ phase: 'starting', path: path('Other') });
    await evaluate(`window.launcherTest.resolve('createProject', {ok:false,code:'superseded'})`);
    await status('starting');
    expect(await text('#status-text')).toContain('Starting Other');
    expect(await text('#status-text')).not.toContain('Creating');
    expect(await evaluate(`document.querySelector('#create-project').disabled`)).toBe(true);
    await render(); await reply('openProject', { ok: false, code: 'superseded' });
    await click(`#last-list ${row}`); await until(`!document.querySelector('#status').dataset.phase`);
    await emit({ phase: 'starting', path: path('Pinned') }); await status('starting');
    expect(await text('#status-text')).toContain('Starting Pinned');
    expect(await evaluate(`document.querySelector('#create-project').disabled`)).toBe(true);
  });
  it('selects the full path without opening or dragging, and still reorders from the project tile', async () => {
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await render();
    await evaluate(`document.querySelector('#workspace-list').scrollIntoView({block:'center'})`);
    await waitForLayout(evaluate, '#workspace-list');
    const rect = await evaluate(`(() => {
      const range = document.createRange(); range.selectNodeContents(document.querySelector('#workspace-list .mission-control-workspace-path bdi'));
      return range.getBoundingClientRect().toJSON();
    })()`);
    const start = { x: rect.left + 1, y: rect.top + rect.height / 2 }, end = { x: rect.right - 1, y: start.y };
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...start });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...start, button: 'left', buttons: 1, clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...end, button: 'left', buttons: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...end, button: 'left', buttons: 0, clickCount: 1 });
    expect(await evaluate(`getSelection().toString()`)).toBe(path('Pinned'));
    expect(await evaluate(`document.querySelector('.is-dragging') === null`)).toBe(true);
    expect(await calls('openProject')).toEqual([]); expect(await calls('moveInWorkspace')).toEqual([]);
    await evaluate(`getSelection().removeAllRanges()`);
    const points = await evaluate(`[...document.querySelectorAll('#workspace-list ${row}')].map(node => {const r=node.getBoundingClientRect();return {x:r.left+20,y:r.top+r.height/2}})`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...points[0], button: 'left', buttons: 1, clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: points[0].x, y: points[0].y + 10, buttons: 1 });
    await until(`Boolean(document.querySelector('#workspace-list .is-dragging'))`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...points[1], buttons: 1 });
    await waitForLayout(evaluate, '#workspace-list li');
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...points[1], button: 'left', buttons: 0, clickCount: 1 });
    await status('success');
    expect(await calls('moveInWorkspace')).toEqual([[path('Pinned'), 1]]);
    expect(await calls('openProject')).toEqual([]);
    await until(`document.querySelector('#workspace-list ul').getAttribute('aria-busy') === 'false'`);
    await waitForLayout(evaluate, '#workspace-list li');
  });
  it('S4–S6: rechecks missing folders, marks lost paths, restores availability in place, and keeps removal reachable', async () => {
    await render(); await language('ru');
    await evaluate(`void (window.savedRow = document.querySelector('#workspace-list li.is-missing'))`);
    await click(`#workspace-list .is-missing ${row}`); await status('error');
    expect(await calls('openProject')).toEqual([[path('Missing')]]);
    expect(await text('#status-text')).toContain('Подключите диск');
    await reply('openProject', { ok: true }); await click(`#workspace-list .is-missing ${row}`);
    await emit({ phase: 'starting', path: path('Missing') });
    await until(`!window.savedRow.classList.contains('is-missing')`);
    expect(await evaluate(`window.savedRow.isConnected && window.savedRow.querySelector('${row}').getAttribute('aria-disabled') === 'false'`)).toBe(true);
    await emit({ phase: 'error', path: path('Missing'), code: 'timeout' }); await status('error');
    await click('#workspace-list li:nth-child(2) .project-list-remove'); await status('success');
    expect(await calls('removeFromWorkspace')).toEqual([[path('Missing')]]);
    await click(`#recent-list ${row}`); await status('error');
    expect(await evaluate(`document.querySelector('#recent-list li').classList.contains('is-missing')`)).toBe(true);
    await click('#recent-list .project-list-remove'); await status('success');
    expect(await calls('removeRecent')).toEqual([[path('Other')]]);
  });
  it('refreshes shared aliases without replacing rows, focus, labels or explicit failure feedback', async () => {
    await render({ snapshot: { projects: [{ path: path('Last'), name: 'Workspace alias', current: false, missing: false }] } });
    await focus(`#recent-list ${row}`);
    await evaluate(`window.savedRow = document.querySelector('#last-list li'); window.savedLabel = window.savedRow.querySelector('.mission-control-workspace-missing');
      window.launcherTest.snapshot({recent:window.launcherTest.initial.recent.map(entry=>({...entry,missing:true})),projects:[]}); window.dispatchEvent(new Event('focus'))`);
    await until(`document.querySelector('#workspace-list li').classList.contains('is-missing')`);
    for (const lang of ['ru', 'en']) {
      await language(lang);
      expect(await evaluate(`window.savedRow.isConnected && window.savedLabel === window.savedRow.querySelector('.mission-control-workspace-missing')`)).toBe(true);
      expect(await evaluate(`document.querySelector('#workspace-list ${row}').getAttribute('aria-label')`)).toContain('Workspace alias:');
    }
    await render(); await evaluate(`window.launcherTest.hold('getState'); window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('focus'))`);
    expect((await calls('getState')).length).toBe(2);
    await click(`#recent-list ${row}`); await status('error');
    await evaluate(`window.launcherTest.resolve('getState',window.launcherTest.initial)`);
    expect(await evaluate(`document.querySelector('#recent-list li').classList.contains('is-missing')`)).toBe(true);
    expect(await text('#status-text')).toContain('Reconnect');
  });
  it.each([375, 1440])('updates dates and translations in place, pauses while hidden, and centers dates with actions at %s px', async width => {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await render(); await language('ru'); await focus(`#recent-list ${row}`);
    await waitForLayout(evaluate, '#recent-list');
    const geometry = `(() => {const row=document.querySelector('#recent-list li');return [row,...row.querySelectorAll('button,time')].map(node=>{const r=node.getBoundingClientRect();return [r.x,r.y,r.width,r.height]})})()`;
    const before = await evaluate(geometry);
    await evaluate(`window.dateNode = document.querySelector('#recent-list time'); void (window.dateValue = window.dateNode.querySelector('.reserved-text > span'))`);
    const beforeCalls = (await calls('getState')).length;
    for (const [delta, value] of [[1, '1 минуту назад'], [1, '2 минуты назад'], [3, '5 минут назад'], [16, '21 минуту назад'], [1, '22 минуты назад'], [3, '25 минут назад']] as const) {
      await evaluate(`window.launcherTest.advance(${delta})`); await until(`window.dateNode.textContent === '${value}'`);
    }
    expect(await evaluate(geometry)).toEqual(before);
    expect(await evaluate(`window.dateNode === document.querySelector('#recent-list time') && window.dateValue === window.dateNode.querySelector('.reserved-text > span')`)).toBe(true);
    expect(await active()).toBe(path('Other'));
    expect((await calls('getState')).length).toBe(beforeCalls);
    if (width > 760) {
      const centers = await evaluate(`[...document.querySelectorAll('#recent-list time, #recent-list .mission-control-workspace-remove')].map(node=>{const r=node.getBoundingClientRect();return r.y+r.height/2})`);
      expect(Math.max(...centers) - Math.min(...centers)).toBeLessThan(1);
    } else {
      // 2026-11-13: at phone width the date wraps under the path so long names keep the full line.
      const [path, date] = await evaluate(`['.mission-control-workspace-path', 'time .reserved-text'].map(selector => { const r = document.querySelector('#recent-list li ' + selector).getBoundingClientRect(); return [r.left, r.top, r.bottom]; })`) as number[][];
      expect(Math.abs(date[0] - path[0])).toBeLessThan(1);
      expect(date[1]).toBeGreaterThanOrEqual(path[2]);
    }
    await language('en'); expect(await text('#recent-list time')).toBe('25 minutes ago');
    await evaluate(`window.launcherTest.hidden(true); window.launcherTest.advance(60)`);
    expect(await evaluate('window.launcherTest.timers')).toBe(0);
    expect(await text('#recent-list time')).toBe('25 minutes ago');
    await evaluate(`window.launcherTest.hidden(false)`); await until(`window.dateNode.textContent === '1 hour ago'`);
    expect(await evaluate('window.launcherTest.timers')).toBe(2);
    await evaluate(`window.dispatchEvent(new Event('pagehide'))`); expect(await evaluate('window.launcherTest.timers')).toBe(0);
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 820, deviceScaleFactor: 1, mobile: false });
  });
  it('saves language/theme before applying, preserves failed saves and native changes, and retains system choice', async () => {
    await render(); await evaluate(`localStorage.setItem('deckmate-language','ru'); localStorage.setItem('deckmate-theme','dark'); window.launcherTest.hold('setLanguage')`);
    await click('.language-toggle'); expect(await evaluate('document.documentElement.lang')).toBe('en');
    await evaluate(`window.launcherTest.resolve('setLanguage',{ok:true})`); await until(`document.documentElement.lang === 'ru'`);
    await click('.language-toggle'); await evaluate(`window.launcherTest.resolve('setLanguage',{ok:false,code:'save-failed',message:'EACCES'})`); await status('error');
    expect(await evaluate('document.documentElement.lang')).toBe('ru');
    await evaluate(`window.dispatchEvent(new CustomEvent('deckmate:display',{detail:{language:'en',theme:'dark'}}))`);
    await until(`document.documentElement.lang === 'en' && document.documentElement.classList.contains('dark')`);
    expect((await calls('setLanguage')).length).toBe(2);
    await evaluate(`window.launcherTest.hold('setTheme')`);
    async function theme(index: number) {
      await until(`!!document.querySelector('.bar-tools [aria-haspopup="menu"]:not(:disabled)') && !document.querySelector('.theme-toggle-choice')`);
      await focus('.bar-tools [aria-haspopup="menu"]'); await key('Enter');
      await until(`document.querySelectorAll('.theme-toggle-choice').length === 3`);
      await click(`.theme-toggle-choice:nth-child(${index})`);
    }
    await theme(1); expect(await evaluate(`document.documentElement.classList.contains('dark')`)).toBe(true);
    await evaluate(`window.launcherTest.resolve('setTheme',{ok:true})`); await until(`!document.documentElement.classList.contains('dark')`);
    await theme(2); await evaluate(`window.launcherTest.resolve('setTheme',{ok:false,code:'save-failed'})`); await status('error');
    expect(await evaluate(`document.documentElement.classList.contains('dark')`)).toBe(false);
    await theme(3); await evaluate(`window.launcherTest.resolve('setTheme',{ok:true})`);
    await until(`document.documentElement.dataset.shellTheme === 'system'`);
    for (const theme of ['dark', 'light']) {
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
      await until(`document.documentElement.classList.contains('dark') === ${theme === 'dark'}`);
    }
    expect(await evaluate(`localStorage.getItem('deckmate-theme')`)).toBe('dark');
    expect(await evaluate(`document.documentElement.dataset.shellTheme`)).toBe('system');
    await send('Emulation.setEmulatedMedia', { features: [] });
  });
  it.each(['en', 'ru'])('renders the same fixture rows as Mission Control in %s, including order, full paths, current and missing', async language => {
    const projects = [
      { path: path('Current'), name: 'Current', current: true, missing: false },
      { path: `D:\\${'Длинная папка\\'.repeat(10)}🎲 Мой проект`, name: `🎲 ${'очень длинное название '.repeat(10)}`, current: false, missing: true },
      { path: path('Other'), name: 'Other', current: false, missing: false },
    ];
    await render({ snapshot: { language, projects } });
    const rows = `([...document.querySelectorAll('.project-list--workspace li')].map(node => ({text:node.textContent, current:node.classList.contains('is-current'),missing:node.classList.contains('is-missing'), path:node.querySelector('${row}').dataset.path, label:node.querySelector('${row}').getAttribute('aria-label')})))`;
    const launcher = await evaluate(rows);
    expect(launcher[1].text).toContain(projects[1].path);
    expect(launcher[1].text).toContain(projects[1].name);
    expect(launcher[1].label).toBe(`${projects[1].name}: ${projects[1].path} — ${language === 'ru' ? 'Папка не найдена' : 'Folder not found'}`);
    await evaluate(`window.launcherTest.mission('${language}')`); await until(`document.querySelectorAll('.project-list--workspace li').length === 3`);
    expect(await evaluate(rows)).toEqual(launcher);
    expect(session.errors).toEqual([]);
  });
});
