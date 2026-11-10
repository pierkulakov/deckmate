import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBrowserSession } from './browser-session.ts';
import { requireBrowser } from './browser-environment.ts';
import { expectPageStateDuring, waitForLayout } from './browser-layout.ts';

const browserPath = requireBrowser();
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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
    await session.navigate('client-audit-regressions', `Boolean(window.audit) && document.querySelectorAll('.card-attachment-indicator').length === 2`);
  }, 90000);
  afterAll(async () => {
    await session.close();
  }, 20000);

  it('refreshes only its card registry or reconnect, ignores indexedAt, and retains confirmed counts on failure', async () => {
    const initial = await evaluate('({...audit.state.reads})');
    await evaluate(`audit.state.revision='updated';audit.render();audit.change(0,'deckmate','live')`);
    await expectPageStateDuring(evaluate, `JSON.stringify(audit.state.reads) === ${JSON.stringify(JSON.stringify(initial))}`, 150);
    expect(await evaluate('audit.state.reads')).toEqual(initial);
    await evaluate(`audit.state.counts[0]=3;audit.change(0,'freetion')`);
    await until(`document.querySelector('.card-attachment-indicator strong')?.textContent === '3'`);
    const changed = await evaluate('({...audit.state.reads})');
    const ids = await evaluate('audit.cards.map(card=>card.id)');
    expect(changed[ids[0]]).toBe(initial[ids[0]] + 1);
    expect(changed[ids[1]]).toBe(initial[ids[1]]);
    await evaluate('audit.state.fail=true;audit.change(0)');
    await until(`audit.state.reads[audit.cards[0].id] === ${changed[ids[0]] + 1}`);
    await expectPageStateDuring(evaluate, `document.querySelector('.card-attachment-indicator strong').textContent === '3'`, 100);
    expect(await evaluate(`document.querySelector('.card-attachment-indicator strong').textContent`)).toBe('3');
    await evaluate('audit.state.fail=false;audit.change()');
    await until(`audit.state.reads[audit.cards[1].id] === ${changed[ids[1]] + 1}`);
  });

  it('does not overwrite a newer confirmed count with a delayed read', async () => {
    const reads = await evaluate('audit.state.reads[audit.cards[0].id]');
    await evaluate('audit.state.hold=true;audit.state.counts[0]=4;audit.change(0)');
    await until(`audit.state.reads[audit.cards[0].id] === ${reads + 1}`);
    await evaluate('audit.state.hold=false;audit.state.counts[0]=5;audit.change(0)');
    await until(`document.querySelector('.card-attachment-indicator strong')?.textContent === '5'`);
    await evaluate('audit.state.release()');
    await expectPageStateDuring(evaluate, `document.querySelector('.card-attachment-indicator strong').textContent === '5'`, 100);
    expect(await evaluate(`document.querySelector('.card-attachment-indicator strong').textContent`)).toBe('5');
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
    expect(await evaluate(`document.activeElement.classList.contains('hand-slot-handle')`)).toBe(true);
    await until(`getComputedStyle(document.activeElement).opacity === '1'`);
    expect(await evaluate(`getComputedStyle(document.activeElement).touchAction`)).toBe('auto');
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
