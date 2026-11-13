import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBrowserSession } from './browser-session.ts';
import { requireBrowser } from './browser-environment.ts';
import { waitForLayout } from './browser-layout.ts';

const browserPath = requireBrowser();
describe.skipIf(!browserPath)('standalone shared project controls (browser)', () => {
  const session = createBrowserSession();
  const { send, evaluate, until } = session;
  beforeAll(async () => {
    await session.open(browserPath!);
    await session.navigate('project-list', 'Boolean(window.projectTest)');
  }, 90000);
  afterAll(() => session.close(), 20000);
  async function render(options: object = {}, width = 375) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await evaluate(`window.projectTest.render(${JSON.stringify(options)})`);
    await waitForLayout(evaluate, '.project-fixture');
  }
  async function key(key: string, modifiers = 0) {
    const codes: Record<string, number> = { ArrowUp: 38, ArrowDown: 40, Home: 36, End: 35, Delete: 46, Backspace: 8, Enter: 13, Escape: 27 };
    for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key, code: key, modifiers,
      windowsVirtualKeyCode: codes[key] ?? Number(key) + 48, text: type === 'keyDown' && key === 'Enter' ? '\r' : undefined });
  }
  const focusedPath = () => evaluate('document.activeElement.dataset.path');
  const calls = () => evaluate('window.projectTest.calls.filter(call => call.method !== "refresh")');

  it('navigates across lists, reorders, deletes, pins and restores the next or fallback focus', async () => {
    await render();
    await evaluate(`document.querySelector('.mission-control-workspace-open').focus()`);
    await key('ArrowDown'); expect(await focusedPath()).toBe('C:/Projects/Project 2');
    await key('ArrowDown'); expect(await focusedPath()).toBe('C:/Projects/Project 3');
    await key('Home'); expect(await focusedPath()).toBe('C:/Projects/Project 1');
    await key('End'); expect(await focusedPath()).toBe('D:/Old');
    await key('Home'); await key('ArrowDown', 1);
    await until(`document.activeElement === document.querySelectorAll('.project-list--workspace .mission-control-workspace-open')[1]`);
    expect(await focusedPath()).toBe('C:/Projects/Project 1');
    await key('Delete');
    // 2026-11-13: authoritative rows can commit before the accepted async change restores focus.
    await until(`document.querySelectorAll('.project-list--workspace li').length === 9 && document.querySelector('.project-list--workspace').getAttribute('aria-busy') === 'false'`);
    expect(await focusedPath()).toBe('C:/Projects/Project 3');
    await evaluate(`document.querySelector('.project-list-pin').click()`);
    await until(`document.querySelectorAll('.project-list--recent li').length === 1 && document.querySelector('.project-list--recent').getAttribute('aria-busy') === 'false'`);
    expect(await focusedPath()).toBe('D:/Old');
    await key('Backspace');
    await until(`document.querySelectorAll('.project-list--recent li').length === 0 && document.querySelector('.project-list--recent').getAttribute('aria-busy') === 'false'`);
    expect(await evaluate('document.activeElement.className')).toBe('fallback');
    expect(await calls()).toEqual([
      { method: 'move', args: ['C:/Projects/Project 1', 1] }, { method: 'remove', args: ['C:/Projects/Project 1'] },
      { method: 'pin', args: ['D:/Очень длинное название папки/Другой проект'] }, { method: 'remove-recent', args: ['D:/Old'] },
    ]);
  });

  it('opens Ctrl+1…9 in stored order but protects editors, busy actions and native accelerators', async () => {
    await render();
    await evaluate(`document.querySelector('.fallback').focus()`);
    for (const digit of ['1', '2', '9']) await key(digit, 2);
    expect(await calls()).toEqual([{ method: 'open', args: ['C:/Projects/Project 2'] }, { method: 'open', args: ['C:/Projects/Project 9'] }]);
    await evaluate(`document.querySelector('input').focus()`); await key('2', 2);
    await evaluate(`window.projectTest.setBusy(true)`);
    await until(`document.querySelector('.project-list-remove').disabled`);
    await evaluate(`document.querySelector('.mission-control-workspace-open').focus()`);
    await key('Delete'); await key('ArrowDown', 1); await key('2', 2);
    expect((await calls()).length).toBe(2);
    await render({ native: true });
    await evaluate(`document.querySelector('.fallback').focus()`); await key('2', 2);
    expect(await calls()).toEqual([]);
  });

  it('revalidates missing rows, preserves restored nodes, and offers diagnostics, choose-folder and Retry', async () => {
    await render();
    await evaluate(`window.missingRow = document.querySelector('.is-missing'); window.missingRow.querySelector('button').focus()`);
    await key('Enter');
    await until(`Boolean(document.querySelector('[role="alert"]'))`);
    expect(await evaluate(`document.querySelector('.mission-control-retry').textContent`)).toBe('Choose folder…');
    await evaluate(`document.querySelector('.project-list-details summary').click()`);
    expect(await evaluate(`document.querySelector('.project-list-details pre').textContent`)).toBe('Folder unavailable <details>');
    await evaluate(`document.querySelector('.mission-control-retry').click(); window.projectTest.restore('C:/Projects/Project 3')`);
    await until(`!window.missingRow.classList.contains('is-missing')`);
    expect(await evaluate(`window.missingRow.isConnected && window.missingRow.querySelector('button').getAttribute('aria-disabled') === 'false'`)).toBe(true);
    await evaluate(`window.missingRow.querySelector('button').click(); window.projectTest.fail({ok:false,code:'timeout',message:'Timeout details'})`);
    await until(`document.querySelector('.mission-control-retry')?.textContent === 'Try again'`);
    await evaluate(`document.querySelector('.mission-control-retry').click()`);
    await until(`!document.querySelector('[role="alert"]')`);
    expect((await calls()).map((call: { method: string }) => call.method)).toEqual(['open', 'choose', 'open', 'retry']);
  });

  it.each([375, 1440])('updates dates and language without replacing rows or shifting dates/actions at %s px', async width => {
    for (const theme of ['light', 'dark']) {
      await render({ theme }, width);
      const geometry = `(() => {
        const row = document.querySelector('.project-list--recent li');
        return [row, ...row.querySelectorAll('button, time')].map(node => {
          const r = node.getBoundingClientRect(); return [r.x, r.y, r.width, r.height];
        });
      })()`;
      const before = await evaluate(geometry);
      await evaluate(`window.dateNode = document.querySelector('time'); window.projectTest.advance(22); window.projectTest.setLang('ru')`);
      await until(`window.dateNode.textContent === '22 минуты назад'`);
      await waitForLayout(evaluate, '.project-list--recent');
      expect(await evaluate(geometry)).toEqual(before);
      expect(await evaluate(`window.dateNode === document.querySelector('time')`)).toBe(true);
      const centers = await evaluate(`(() => {
        const row = document.querySelector('.project-list--recent li');
        return [...row.querySelectorAll('time, .mission-control-workspace-remove')].map(node => {const r=node.getBoundingClientRect();return r.y+r.height/2});
      })()`);
      expect(Math.max(...centers) - Math.min(...centers)).toBeLessThan(1);
      expect(await evaluate(`document.documentElement.scrollWidth <= innerWidth`)).toBe(true);
      await evaluate(`window.projectTest.hidden(true); window.projectTest.advance(60)`);
      expect(await evaluate('window.projectTest.timers')).toBe(0);
      expect(await evaluate('window.dateNode.textContent')).toBe('22 минуты назад');
      await evaluate(`window.projectTest.hidden(false)`);
      await until(`window.dateNode.textContent === '1 час назад'`);
      expect(await evaluate('window.projectTest.timers')).toBe(1);
    }
  });

  it('retains the system theme while the OS changes and exposes all three choices', async () => {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
    await render({ theme: 'system' });
    expect(await evaluate(`document.documentElement.classList.contains('dark')`)).toBe(false);
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    await until(`document.documentElement.classList.contains('dark')`);
    expect(await evaluate(`localStorage.getItem('deckmate-theme')`)).toBe('system');
    await evaluate(`document.querySelector('[aria-haspopup="menu"]').focus()`);
    await key('Enter');
    await until(`Boolean(document.querySelector('.theme-toggle-choice[data-state="checked"]'))`);
    expect(await evaluate(`document.querySelector('.theme-toggle-choice[data-state="checked"]').textContent`)).toBe('System theme');
    await evaluate(`document.querySelector('.theme-toggle-choice').click()`);
    await until(`localStorage.getItem('deckmate-theme') === 'light' && !document.documentElement.classList.contains('dark')`);
    await send('Emulation.setEmulatedMedia', { features: [] });
    expect(session.errors).toEqual([]);
  });
});
