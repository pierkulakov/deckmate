import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBrowserSession } from './browser-session.ts';
import { requireBrowser } from './browser-environment.ts';
import { expectPageStateDuring, waitForLayout } from './browser-layout.ts';

const browserPath = requireBrowser();

describe.skipIf(!browserPath)('client audit regressions (browser)', () => {
  const session = createBrowserSession({ attempts: 200, intervalMs: 25 });
  const { send, evaluate, until } = session;
  let errors: string[] = [];
  async function key(key: string, code = key, modifiers = 0) {
    const virtualKey = { Tab: 9, Escape: 27, ' ': 32 }[key] ?? 0;
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, modifiers, windowsVirtualKeyCode: virtualKey });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers, windowsVirtualKeyCode: virtualKey });
  }
  beforeAll(async () => {
    await session.open(browserPath!);
    errors = session.errors;
    await session.navigate('client-audit-regressions', `Boolean(window.audit) && document.querySelectorAll('.deck-card').length === 2`);
  }, 90000);
  afterAll(async () => {
    await session.close();
  }, 20000);

  it('leaves attachment reads to the open card, including registry changes and reconnects', async () => {
    expect(await evaluate('audit.state.reads')).toEqual({});
    await evaluate(`audit.state.revision='updated';audit.render();audit.change(0,'deckmate','live')`);
    await evaluate(`audit.change(0,'freetion');audit.change(1);audit.change()`);
    await expectPageStateDuring(evaluate, `Object.keys(audit.state.reads).length === 0 && document.querySelectorAll('.deck-card').length === 2`, 150);
    expect(await evaluate('audit.state.reads')).toEqual({});
    expect(await evaluate(`document.querySelectorAll('.card-attachment-indicator').length`)).toBe(0);
  });

  it('gives Hand a separate Tab-accessible drag handle, leaving face Space native and pointer dragging intact', async () => {
    await evaluate(`audit.render('hand')`);
    await until(`document.querySelectorAll('.hand-slot-handle').length === 2`);
    expect(await evaluate(`Array.from(document.querySelectorAll('.hand-slot.is-filled')).every(slot=>!slot.hasAttribute('role')&&!slot.hasAttribute('tabindex'))`)).toBe(true);
    expect(await evaluate(`document.querySelector('.hand-slot-handle').getAttribute('aria-label')`)).toBe('Move in Hand: Card 1');
    expect(await evaluate(`document.querySelector('.hand-slot-handle').getAttribute('aria-describedby')`)).toBeTruthy();
    await evaluate(`document.querySelector('.hand-slot .deck-card-open').focus()`);
    await key(' ', 'Space');
    await until('audit.state.opened === 1');
    expect(await evaluate(`Boolean(document.querySelector('.hand-slot.is-drag-source'))`)).toBe(false);
    await key('Tab');
    expect(await evaluate(`document.activeElement.classList.contains('deck-card-settings')`)).toBe(true);
    await key('Tab');
    expect(await evaluate(`document.activeElement.classList.contains('hand-slot-handle')`)).toBe(true);
    await until(`getComputedStyle(document.activeElement).opacity === '1'`);
    expect(await evaluate(`getComputedStyle(document.activeElement).touchAction`)).toBe('none');
    await key(' ', 'Space');
    await until(`Boolean(document.querySelector('.hand-slot.is-drag-source'))`);
    await until(`Array.from(document.querySelectorAll('[role="status"]')).some(node=>node.textContent.includes('Card 1'))`);
    // 2026-11-10: KeyboardSensor attaches its document listener in a timer after activation.
    await evaluate(`new Promise(resolve => setTimeout(resolve, 0))`);
    await waitForLayout(evaluate, '.hand-slot');
    await key('Escape');
    await until(`!document.querySelector('.hand-slot.is-drag-source')`);
    const point = await evaluate(`(()=>{const r=document.querySelector('.hand-slot .deck-card-open').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x + 20, y: point.y, buttons: 1 });
    await until(`Boolean(document.querySelector('.hand-slot.is-drag-source'))`);
    await key('Escape');
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x + 20, y: point.y, button: 'left', clickCount: 1 });
    await until(`!document.querySelector('.hand-slot.is-drag-source')`);
    await waitForLayout(evaluate, '.hand-slot');
  });

  it('cycles Tab both ways, accepts editor portals, respects their Escape, and restores the opener', async () => {
    await evaluate(`audit.render('focus')`);
    await until(`Boolean(document.querySelector('#opener'))`);
    await evaluate(`document.querySelector('#opener').focus();document.querySelector('#opener').click()`);
    await until(`document.activeElement.id === 'editor'`);
    expect(await evaluate(`document.querySelector('#root').inert`)).toBe(true);
    await evaluate(`document.querySelector('#last').focus()`);
    await key('Tab');
    expect(await evaluate(`document.activeElement.className`)).toBe('card-focus-mode-back');
    await key('Tab', 'Tab', 8);
    expect(await evaluate(`document.activeElement.id`)).toBe('last');
    await evaluate(`document.querySelector('#toolbar-open').click()`);
    await until(`Boolean(document.querySelector('#command'))`);
    await evaluate(`document.querySelector('#command').focus()`);
    expect(await evaluate(`document.activeElement.id`)).toBe('command');
    await evaluate(`document.querySelector('#editor').focus()`);
    await key('Escape');
    await until(`!document.querySelector('#command')`);
    expect(await evaluate(`Boolean(document.querySelector('.card-focus-mode'))`)).toBe(true);
    await evaluate(`document.querySelector('#portal-open').click()`);
    await until(`document.activeElement.id === 'setting'`);
    await evaluate(`document.querySelector('#settings-last').focus()`);
    await key('Tab');
    expect(await evaluate(`document.activeElement.id`)).toBe('setting');
    await key('Escape');
    await until(`!document.querySelector('#settings')`);
    expect(await evaluate(`Boolean(document.querySelector('.card-focus-mode'))`)).toBe(true);
    await evaluate(`document.querySelector('#editor').focus()`);
    await key('Escape');
    await until(`!document.querySelector('.card-focus-mode') && document.activeElement.id === 'opener'`);
    expect(await evaluate(`document.querySelector('#root').inert`)).toBe(false);
  });

  it('restores the same card tile when the opener disappeared', async () => {
    await evaluate(`document.querySelector('#opener').focus();document.querySelector('#opener').click()`);
    await until(`document.activeElement.id === 'editor'`);
    await evaluate(`audit.state.showOpener=false;audit.render()`);
    await until(`!document.querySelector('#opener')`);
    await key('Escape');
    await until(`!document.querySelector('.card-focus-mode') && document.activeElement.id === 'fallback'`);
    expect(errors).toEqual([]);
  });
});
