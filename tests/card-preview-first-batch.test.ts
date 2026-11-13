import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openHeadlessBrowser, type HeadlessPage } from '../tools/layout-capture.ts';
import { browserFixtureUrl } from './browser-fixture.ts';
import { requireBrowser } from './browser-environment.ts';
import { waitForLayout } from './browser-layout.ts';
import { shortReference } from '../src/references.ts';
import { recordDecision } from '../src/open-questions.ts';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const browserPath = requireBrowser();
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe.skipIf(!browserPath)('open card first UX batch (real browser)', () => {
  let page: HeadlessPage;
  async function until(expression: string) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) { if (await page.evaluate(expression)) return; await delay(40); }
    throw new Error('Timed out: ' + expression + '\n' + page.consoleErrors.join('\n'));
  }
  async function click(selector: string) {
    const point = await page.callFunction(`selector => {
      const button = document.querySelector(selector);
      button.focus();
      if (button.matches('button[aria-haspopup="menu"]')) {
        const rect = button.getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      }
      button.click(); return null;
    }`, selector);
    if (point) {
      for (const type of ['mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 });
    }
    await delay(70);
  }
  async function key(key: string, code = key) {
    const virtualKey = { Escape: 27, Enter: 13, Tab: 9, Space: 32, ArrowDown: 40, KeyW: 87 }[code];
    for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: virtualKey,
      ...(type === 'keyDown' && (key === 'Enter' || key === ' ') ? { text: key === 'Enter' ? '\r' : ' ' } : {}) });
    await delay(100);
  }
  async function openReview() {
    if (!await page.evaluate(`Boolean(document.querySelector('.card-review-menu'))`)) await click('.card-state-review');
    await until(`Boolean(document.querySelector('.card-review-menu'))`);
  }
  async function requestChanges() { await openReview(); await click('.card-review-return'); }
  async function acceptReview() { await openReview(); await click('.card-review-accept'); }
  async function render(options: object = {}) {
    await page.callFunction('function(options) { window.firstBatch.render(options); }', options);
    if ('pending' in options && options.pending) await until(`Boolean(document.querySelector('.card-preview-state-actions'))`);
    else await until(`Boolean(document.querySelector('.card-content-edit-action') && !document.querySelector('.card-content-edit-action').disabled || document.querySelector('.card-content-readonly') || document.querySelector('.card-preview-lifecycle'))`);
    await delay(80);
  }
  beforeAll(async () => {
    // 2026-11-10: these interactions need no HMR; reuse the single fixture build instead of a cold optimizer.
    page = await openHeadlessBrowser({ width: 1280, height: 900, scale: 1 });
    await page.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await page.send('Page.navigate', { url: browserFixtureUrl('card-preview-first-batch') });
    await until('Boolean(window.firstBatch && document.querySelector(".card-preview"))');
    await page.evaluate(`localStorage.setItem('deckmate-current-member', 'maya')`);
  }, 90000);
  afterAll(async () => { await page?.close(); }, 20000);

  it.each(['dark', 'light'] as const)('shows tags without a heading row and opens their Properties section from a tag in %s', async theme => {
    await render({ tags: 6, theme, lang: 'ru' });
    expect(await page.evaluate(`Boolean(document.querySelector('.card-preview-tags-heading, .card-preview-tags-actions'))`)).toBe(false);
    expect(await page.evaluate(`document.querySelectorAll('.card-preview-tags .tag-badge-link').length`)).toBe(6);
    await click('.card-preview-tags .tag-badge-link');
    expect(await page.evaluate(`document.querySelectorAll('.card-properties-tag-chip').length`)).toBe(6);
    await key('Escape');
  });

  it('omits the tag block on a card without tags', async () => {
    await render({ tags: 0, writable: false });
    expect(await page.evaluate(`Boolean(document.querySelector('.card-preview-tags'))`)).toBe(false);
  });

  it.each(['task', 'hero', 'doc'])('%s backlinks exclude inactive, self, code and YAML links and guard dirty navigation', async kind => {
    await render({ kind, backlinks: 2, markdown: `[Self](/r/${shortReference('c', 'card:preview')})` });
    expect(await page.evaluate(`Boolean(document.querySelector('.card-preview-sheet .card-preview-backlinks'))`)).toBe(false);
    await click('.card-preview-action-rail button[aria-controls$="-dependencies"]');
    expect(await page.evaluate(`[...document.querySelectorAll('.card-preview-backlinks button')].map(button => button.textContent)`)).toEqual(['incoming-0', 'incoming-1']);
    await click('.card-content-edit-action');
    await until(`Boolean(document.querySelector('.card-edit-text'))`);
    await page.send('Input.insertText', { text: 'Unsaved text ' });
    await until(`document.querySelector('.card-preview-backlinks button').disabled`);
    await click('.card-preview-backlinks button');
    expect(await page.evaluate('window.firstBatch.selections')).toEqual([]);
    await click('.card-edit-link.is-cancel');
    await click('.card-draft-banner-actions button:last-child');
    await until(`!document.querySelector('.card-preview-backlinks button').disabled`);
    await click('.card-preview-backlinks button');
    await until(`document.querySelector('.card-preview-title')?.textContent === 'incoming-0'`);
    expect(await page.evaluate('window.firstBatch.selections')).toEqual(['card:incoming-0']);
  });

  it('keeps every backlink reachable from the dependency rail, including after the fiftieth', async () => {
    await render({ backlinks: 52 });
    await click('.card-preview-action-rail button[aria-controls$="-dependencies"]');
    expect(await page.evaluate(`document.querySelectorAll('.card-related-slot .card-preview-backlinks button').length`)).toBe(52);
    await click('.card-preview-backlinks li:last-child button');
    expect(await page.evaluate('window.firstBatch.selections')).toEqual(['card:incoming-51']);
  });

  it.each(['light', 'dark'])('shows exactly four state icons, fills only matching states and keeps contrast in %s', async theme => {
    const states = [null, 'not-started', 'discussing', 'in-iteration', 'started', 'review', 'done', 'wont-do'];
    const filledByState: Record<string, string> = { started: 'play', review: 'review', done: 'done' };
    const cases = [...states.map(state => ({ state, dependencies: false })), { state: 'started', dependencies: true }];
    for (const { state, dependencies } of cases) {
      await render({ state, theme, dependencies });
      const model = await page.evaluate(`(() => {
        const group = document.querySelector('.card-state-buttons'), row = group.parentElement;
        const buttons = [...group.querySelectorAll(':scope > button')];
        const filled = buttons.filter(button => button.dataset.filled === 'true');
        const rgb = value => value.match(/[\\d.]+/g).slice(0, 3).map(Number).map(channel => { channel /= 255; return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4; });
        const luminance = value => rgb(value).reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
        return { count: buttons.length, text: group.textContent, role: group.getAttribute('role'),
          dead: Boolean(row.querySelector('.status-badge, .spin, .lucide-eye, .card-state-reopen, .card-review-actions')),
          tools: Boolean(row.querySelector('.card-preview-focus') && row.querySelector('.card-preview-more')),
          filled: filled.map(button => button.className.match(/card-state-(play|review|done|blockers)/)[1]),
          contrasts: filled.map(button => { const style = getComputedStyle(button), a = luminance(style.color), b = luminance(style.backgroundColor); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); }),
          names: buttons.map(button => button.getAttribute('aria-label')), groupName: group.getAttribute('aria-label') };
      })()`);
      expect(model.count).toBe(4);
      expect(model.text).toBe('');
      expect(model.role).toBe('group');
      expect(model.dead).toBe(false);
      expect(model.tools).toBe(true);
      const filled = state && filledByState[state] ? [filledByState[state]] : [];
      if (dependencies) filled.push('blockers');
      expect(model.filled).toEqual(filled);
      expect(model.contrasts.every((contrast: number) => contrast >= 4.5)).toBe(true);
      expect(model.names.every((name: string) => name.startsWith(model.groupName.replace('State: ', '') + ' — '))).toBe(true);
    }
    expect(await page.evaluate(`[...document.querySelectorAll('.card-state-buttons [data-filled="true"]')].map(button => button.classList.contains('card-state-blockers'))`)).toEqual([false, true]);
    expect(await page.evaluate(`document.querySelector('.card-state-blockers').title`)).toBe('Dependencies and blockers (1)');
    expect(await page.evaluate(`document.querySelector('.card-state-blockers').hasAttribute('aria-pressed')`)).toBe(false);
    await click('.card-state-blockers');
    expect(await page.evaluate(`Boolean(document.querySelector('.card-dependencies'))`)).toBe(true);
    expect(await page.evaluate(`document.getElementById(document.querySelector('.card-state-blockers').getAttribute('aria-controls')) !== null`)).toBe(true);
    expect(await page.evaluate('window.firstBatch.requests')).toEqual([]);
    await key('Escape');
  });

  it('submits with [?], accepts Review with ✓ and reopens Done without losing visible focus', async () => {
    await render({ state: 'not-started' });
    expect(await page.evaluate(`document.querySelector('.card-state-review').title`)).toBe('Submit for review');
    expect(await page.evaluate(`document.querySelector('.card-state-review').hasAttribute('aria-pressed')`)).toBe(false);
    await click('.card-state-review');
    expect(await page.evaluate('window.firstBatch.requests[0]')).toMatchObject({ state: 'review' });
    await until(`document.activeElement === document.querySelector('.card-state-review')`);
    expect(await page.evaluate(`document.querySelector('.card-state-review').getAttribute('aria-haspopup')`)).toBe('menu');
    expect(await page.evaluate(`document.querySelector('.card-state-review').getAttribute('aria-expanded')`)).toBe('false');
    expect(await page.evaluate(`document.querySelector('.card-state-done').title`)).toBe('Accept review');
    await click('.card-state-done');
    expect(await page.evaluate('window.firstBatch.requests[1]')).toMatchObject({ state: 'done' });
    await until(`document.activeElement === document.querySelector('.card-state-done')`);
    await click('.card-state-done');
    expect(await page.evaluate('window.firstBatch.requests[2]')).toMatchObject({ state: 'not-started' });
    await until(`document.activeElement === document.querySelector('.card-state-play')`);
    expect(await page.evaluate(`document.activeElement.getClientRects().length > 0 && !document.activeElement.disabled`)).toBe(true);
  });

  it('does not add a saving spinner or remove the four marks while a write is in flight', async () => {
    await render({ state: 'not-started' });
    await page.evaluate('window.firstBatch.holdEdit()');
    await click('.card-state-review');
    expect(await page.evaluate(`document.querySelectorAll('.card-state-buttons > button').length`)).toBe(4);
    expect(await page.evaluate(`Boolean(document.querySelector('.card-preview-state-actions .spin'))`)).toBe(false);
    expect(await page.evaluate(`document.querySelector('.card-state-done').disabled`)).toBe(true);
    await page.evaluate('window.firstBatch.finishEdit()');
    await until(`document.activeElement === document.querySelector('.card-state-review')`);
  });

  it.each(['copy', 'watch'])('does not pass an unrelated %s notice into the request-changes dialog', async notice => {
    await render();
    await page.evaluate(`Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => {} } })`);
    await click('.card-preview-more');
    if (notice === 'copy') await click('.card-more-menu [role="menuitem"]:first-child');
    else {
      await until(`Boolean(document.querySelector('.card-more-menu [role="menuitem"]:has(.lucide-eye):not([data-disabled])'))`);
      await click('.card-more-menu [role="menuitem"]:has(.lucide-eye)');
    }
    const message = notice === 'copy' ? 'Card Markdown copied.' : 'Watch failed';
    await until(`document.querySelector('.card-preview-state-notice')?.textContent === ${JSON.stringify(message)}`);
    await requestChanges();
    expect(await page.evaluate(`Boolean(document.querySelector('.journey-return [role="alert"]'))`)).toBe(false);
    expect(await page.evaluate(`document.querySelector('.card-review-return-dialog').textContent.includes('copied')`)).toBe(false);
    expect(await page.evaluate(`Boolean(document.querySelector('.card-preview-state-notice'))`)).toBe(false);
    await key('Escape');
  });

  it.each([false, true])('requires a reason, Escape and outside click cancel, and sends the reason (%s Journey)', async journey => {
    await render({ journey });
    await requestChanges();
    await until(`Boolean(document.querySelector('.journey-return input'))`);
    expect(await page.evaluate(`document.querySelector('.journey-return-actions button:last-child').disabled`)).toBe(true);
    expect(await page.evaluate(`(() => { const input = document.querySelector('.journey-return-reason input'); return [input.required, input.maxLength, input === document.activeElement]; })()`)).toEqual([true, 500, true]);
    await key('Enter');
    expect(await page.evaluate('window.firstBatch.requests')).toEqual([]);
    await page.send('Input.insertText', { text: '   ' });
    await key('Enter');
    expect(await page.evaluate('window.firstBatch.requests')).toEqual([]);
    await key('Escape');
    await until(`!document.querySelector('.journey-return')`);
    expect(await page.evaluate('window.firstBatch.requests')).toEqual([]);
    expect(await page.evaluate(`document.activeElement === document.querySelector('.card-state-review')`)).toBe(true);
    await requestChanges();
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 5, y: 5, button: 'left', clickCount: 1 });
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 5, y: 5, button: 'left', clickCount: 1 });
    await until(`!document.querySelector('.journey-return')`);
    expect(await page.evaluate('window.firstBatch.requests')).toEqual([]);
    await requestChanges();
    await page.send('Input.insertText', { text: '  Исправить   коллизию  ' });
    await key('Enter');
    await until('window.firstBatch.requests.length > 0');
    expect(await page.evaluate('window.firstBatch.requests[0]')).toMatchObject({ action: 'set-card-state', state: 'not-started', returnReason: 'Исправить коллизию', sourceHash: 'card-hash', manifestHash: 'manifest-hash' });
    await until(`document.activeElement === document.querySelector('.card-state-play')`);
  });

  it.each([false, true])('keeps a reopened Review menu focused after delayed dialog cleanup (%s Journey)', async journey => {
    await render({ journey });
    await requestChanges();
    await until(`document.activeElement === document.querySelector('.journey-return-reason input') && document.body.style.pointerEvents === 'none'`);
    // 2026-11-10: hold the close tasks so the next pointer action precedes focus restoration on every runner.
    await page.evaluate(`(() => {
      const schedule = window.setTimeout, cancel = window.clearTimeout, tasks = new Map();
      window.setTimeout = (callback, timeout, ...args) => {
        if (timeout !== 0 || typeof callback !== 'function') return schedule(callback, timeout, ...args);
        const id = schedule(() => {}, 0);
        tasks.set(id, () => callback(...args));
        return id;
      };
      window.clearTimeout = id => { tasks.delete(id); cancel(id); };
      window.finishReturnClose = () => {
        window.setTimeout = schedule; window.clearTimeout = cancel;
        delete window.finishReturnClose;
        for (const task of tasks.values()) task();
      };
    })()`);
    try {
      for (const type of ['mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x: 5, y: 5, button: 'left', clickCount: 1 });
      await until(`!document.querySelector('.journey-return')`);
      await openReview();
      await until(`document.activeElement === document.querySelector('.card-review-menu')`);
      await page.evaluate(`(() => {
        window.finishReturnClose();
        return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      })()`);
      expect(await page.evaluate(`document.activeElement === document.querySelector('.card-review-menu')`)).toBe(true);
      expect(await page.evaluate(`document.querySelector('.card-state-review').getAttribute('aria-expanded')`)).toBe('true');
      expect(await page.evaluate('window.firstBatch.requests')).toEqual([]);
      await click('.card-review-return');
      await until(`document.activeElement === document.querySelector('.journey-return-reason input')`);
      await key('Escape');
      await until(`document.activeElement === document.querySelector('.card-state-review')`);
    } finally {
      await page.evaluate('window.finishReturnClose?.()');
    }
  });

  it.each([
    { lang: 'en', state: 'State: Review', play: 'Review in progress · decide with the review button', accept: 'Accept review', changes: 'Request changes…', why: 'What needs changing?', dependencies: 'Dependencies and blockers' },
    { lang: 'ru', state: 'Состояние: Приёмка', play: 'Идёт приёмка · решение — в кнопке приёмки', accept: 'Принять результат', changes: 'Вернуть на доработку…', why: 'Что нужно исправить?', dependencies: 'Зависимости и препятствия' },
  ])('names Review and both decisions in $lang; Play, Space and W never return or assign it', async labels => {
    await render({ lang: labels.lang, owner: 'Leo Park' });
    expect(await page.evaluate(`document.querySelector('.card-state-buttons').getAttribute('aria-label')`)).toBe(labels.state);
    expect(await page.evaluate(`document.querySelector('.card-state-play').disabled`)).toBe(true);
    expect(await page.evaluate(`document.querySelector('.card-state-play').title`)).toBe(labels.play);
    expect(await page.evaluate(`document.querySelector('.card-state-blockers').title`)).toBe(labels.dependencies);
    await click('.card-state-play');
    for (const [character, code] of [[' ', 'Space'], ['ц', 'KeyW']]) {
      await page.evaluate(`document.querySelector('.card-preview-title').focus()`);
      await key(character, code);
      const target = code === 'Space' ? '.card-review-menu' : '.card-review-accept';
      expect(await page.evaluate(`document.activeElement === document.querySelector('${target}')`)).toBe(true);
      expect(await page.evaluate(`document.querySelector('.card-review-accept').textContent`)).toBe(labels.accept);
      expect(await page.evaluate(`document.querySelector('.card-review-return').textContent`)).toBe(labels.changes);
      if (code === 'Space') {
        await key(' ', 'Space');
        expect(await page.evaluate(`document.activeElement === document.querySelector('.card-review-menu')`)).toBe(true);
      }
      expect(await page.evaluate(`Boolean(document.querySelector('.journey-return'))`)).toBe(false);
      expect(await page.evaluate('window.firstBatch.requests')).toEqual([]);
      await key('Escape');
    }
    await requestChanges();
    expect(await page.evaluate(`document.querySelector('.journey-return-reason').textContent`)).toContain(labels.why);
    await key('Escape');
    await acceptReview();
    expect(await page.evaluate('window.firstBatch.requests')).toEqual([{ action: 'set-card-state', cardId: 'card:preview', state: 'done', sourceHash: 'card-hash', manifestHash: 'manifest-hash' }]);
    await until(`document.activeElement === document.querySelector('.card-state-done')`);
  });

  it('Play starts and stops work without reassigning; Space keeps its two-step assignment outside Review', async () => {
    await render({ state: 'not-started', owner: 'Leo Park' });
    await click('.card-state-play');
    expect(await page.evaluate('window.firstBatch.requests[0]')).toMatchObject({ action: 'set-card-state', state: 'started' });
    expect(await page.evaluate(`document.querySelector('.card-state-play').getAttribute('aria-pressed')`)).toBe('true');
    expect(await page.evaluate(`document.querySelector('.card-state-play').title`)).toBe('Stop work · return to planned');
    await click('.card-state-play');
    expect(await page.evaluate('window.firstBatch.requests[1]')).toMatchObject({ action: 'set-card-state', state: 'not-started' });
    await page.evaluate(`document.querySelector('.card-preview-title').focus()`);
    await key(' ', 'Space');
    expect(await page.evaluate('window.firstBatch.requests[2]')).toMatchObject({ action: 'bulk-edit-cards', change: { kind: 'properties', owner: 'Maya Chen' } });
    await key(' ', 'Space');
    expect(await page.evaluate('window.firstBatch.requests[3]')).toMatchObject({ action: 'set-card-state', state: 'started' });
  });

  it.each(['done', 'wont-do'])('reopens %s to planned, never directly starts or assigns it', async state => {
    await render({ state, owner: 'Leo Park' });
    expect(await page.evaluate(`document.querySelector('.card-state-play').disabled`)).toBe(true);
    expect(await page.evaluate(`document.querySelectorAll('.card-state-buttons > button').length`)).toBe(4);
    await page.evaluate(`document.querySelector('.card-preview-title').focus()`);
    await key(' ', 'Space');
    expect(await page.evaluate('window.firstBatch.requests')).toEqual([]);
    if (state === 'done') await click('.card-state-done');
    else {
      await click('.card-preview-more');
      await click('.card-more-menu [role="menuitem"]:has(.lucide-rotate-ccw)');
    }
    expect(await page.evaluate('window.firstBatch.requests[0]')).toMatchObject({ action: 'set-card-state', state: 'not-started' });
    await until(`document.activeElement === document.querySelector('.card-state-play')`);
    await render({ state, lang: 'ru' });
    if (state === 'done') expect(await page.evaluate(`document.querySelector('.card-state-done').title`)).toBe('Открыть снова · вернуть в план');
    await key('ц', 'KeyW');
    expect(await page.evaluate('window.firstBatch.requests[0]')).toMatchObject({ action: 'set-card-state', state: 'not-started' });
  });

  it.each([{ writable: false }, { archived: true }, { deleted: true }, { pending: true }])('disables all Review mutations for %j', async options => {
    await render(options);
    expect(await page.evaluate(`['.card-state-play', '.card-state-done'].every(selector => document.querySelector(selector).disabled)`)).toBe(true);
    if (!('pending' in options)) {
      await openReview();
      expect(await page.evaluate(`['.card-review-accept', '.card-review-return'].every(selector => document.querySelector(selector).hasAttribute('data-disabled'))`)).toBe(true);
      await click('.card-review-accept');
      await click('.card-review-return');
      await key('Escape');
    }
    await page.evaluate(`document.querySelector('.card-preview-title').focus()`);
    await key(' ', 'Space');
    await key('w', 'KeyW');
    expect(await page.evaluate('window.firstBatch.requests')).toEqual([]);
    expect(await page.evaluate(`Boolean(document.querySelector('.journey-return'))`)).toBe(false);
  });

  it.each(['not-started', 'started', 'done', 'wont-do'])('disables %s mutations in read-only mode but still opens dependencies', async state => {
    await render({ state, writable: false, dependencies: true });
    expect(await page.evaluate(`['play', 'review', 'done'].every(action => document.querySelector('.card-state-' + action).disabled)`)).toBe(true);
    await click('.card-state-review');
    await click('.card-state-done');
    await click('.card-state-blockers');
    expect(await page.evaluate(`Boolean(document.querySelector('.card-related-slot .card-dependencies'))`)).toBe(true);
    expect(await page.evaluate('window.firstBatch.requests')).toEqual([]);
    await key('Escape');
  });

  it('bounds the feedback input at the existing 500-character contract', async () => {
    await render();
    await requestChanges();
    await page.send('Input.insertText', { text: 'я'.repeat(501) });
    expect(await page.evaluate(`document.querySelector('.journey-return-reason input').value.length`)).toBe(500);
    await click('.journey-return-actions button:last-child');
    expect(await page.evaluate('window.firstBatch.requests[0].returnReason')).toBe('я'.repeat(500));
  });

  it.each(['en', 'ru'])('keeps four icons in one narrow row and both decisions labelled in the popover (%s)', async lang => {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 900, deviceScaleFactor: 1, mobile: false });
    try {
      await render({ lang });
      const controls = await page.evaluate(`(() => {
        const row = document.querySelector('.card-preview-state-actions'), rect = row.getBoundingClientRect();
        const buttons = [...row.querySelectorAll('button')].filter(button => button.getClientRects().length);
        return { aligned: buttons.every(button => Math.abs(button.getBoundingClientRect().top - buttons[0].getBoundingClientRect().top) < 2),
          count: buttons.length, fit: rect.left >= 0 && rect.right <= innerWidth, overflow: document.documentElement.scrollWidth > innerWidth };
      })()`);
      expect(controls.aligned).toBe(true);
      expect(controls.count).toBe(6);
      expect(controls.fit).toBe(true);
      expect(controls.overflow).toBe(false);
      await openReview();
      expect(await page.evaluate(`[...document.querySelectorAll('.card-review-menu [role="menuitem"]')].map(item => item.textContent)`)).toEqual(lang === 'ru' ? ['Принять результат', 'Вернуть на доработку…'] : ['Accept review', 'Request changes…']);
      expect(await page.evaluate(`(() => { const rect = document.querySelector('.card-review-menu').getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth; })()`)).toBe(true);
      await key('Escape');
    } finally { await page.send('Emulation.clearDeviceMetricsOverride'); }
  });

  it('preserves the dependency confirmation before accepting Review', async () => {
    await render({ dependencies: true });
    await acceptReview();
    expect(await page.evaluate('window.firstBatch.requests')).toEqual([]);
    expect(await page.evaluate(`document.querySelector('.dependency-warning-actions button:last-child').textContent`)).toBe('Accept anyway');
    await click('.dependency-warning-actions button:last-child');
    expect(await page.evaluate('window.firstBatch.requests[0]')).toMatchObject({ action: 'set-card-state', state: 'done' });
  });

  it.each(['doc', 'hero'])('does not give %s the Task state row', async kind => {
    await render({ kind, state: null });
    expect(await page.evaluate(`document.querySelector('.card-preview-state-actions')`)).toBe(null);
    if (kind === 'hero') {
      await click('.card-preview-hero-mark button');
      expect(await page.evaluate('window.firstBatch.requests[0]')).toMatchObject({ action: 'set-card-state', state: 'done' });
    }
  });

  it('keeps tags visible above ID, opens their full section and restores keyboard focus', async () => {
    await render({ tags: 20 });
    expect(await page.evaluate(`Boolean(document.querySelector('.card-preview-relations, .card-preview-sheet .card-indicators'))`)).toBe(false);
    expect(await page.evaluate(`document.querySelectorAll('.card-preview-tags .tag-badge-link').length`)).toBe(20);
    expect(await page.evaluate(`document.querySelector('.card-preview-tags').getBoundingClientRect().bottom <= document.querySelector('.card-id-chip').getBoundingClientRect().top`)).toBe(true);
    await click('.card-preview-tags .tag-badge-link');
    expect(await page.evaluate(`document.querySelectorAll('.card-properties-tag-chip').length`)).toBe(20);
    expect(await page.evaluate(`document.activeElement.classList.contains('card-properties-tag-chip')`)).toBe(true);
    await key('Escape');
    expect(await page.evaluate(`document.activeElement === document.querySelector('.card-preview-tags .tag-badge-link')`)).toBe(true);
    expect(await page.evaluate('window.firstBatch.outerEscapes()')).toBe(0);
    await render();
    expect(await page.evaluate(`Boolean(document.querySelector('.card-preview-tags'))`)).toBe(false);
  });

  it.each(['conflict', 'network'])('keeps the return reason and lesson choice after %s and closes only on success', async failure => {
    await render({ journey: true });
    await page.callFunction('function(failure) { window.firstBatch.failEdit(failure); }', failure);
    await requestChanges();
    await until(`Boolean(document.querySelector('.journey-return input'))`);
    await page.send('Input.insertText', { text: 'Сохранить эту причину' });
    await click('.journey-return-lesson input');
    await click('.journey-return-actions button:last-child');
    await until(`Boolean(document.querySelector('.journey-return [role="alert"]'))`);
    expect(await page.evaluate(`document.querySelector('.journey-return-reason input').value`)).toBe('Сохранить эту причину');
    expect(await page.evaluate(`document.activeElement === document.querySelector('.journey-return-reason input')`)).toBe(true);
    expect(await page.evaluate(`document.querySelector('.journey-return-lesson input').checked`)).toBe(false);
    expect(await page.evaluate(`document.querySelector('.journey-return-actions button:last-child').disabled`)).toBe(failure === 'conflict');
    if (failure === 'conflict') await click('.card-review-return-dialog > button');
    expect(await page.evaluate(`document.querySelector('.journey-return-reason input').value`)).toBe('Сохранить эту причину');
    await page.evaluate('window.firstBatch.failEdit(null)');
    await click('.journey-return-actions button:last-child');
    await until(`!document.querySelector('.journey-return')`);
    expect(await page.evaluate('window.firstBatch.requests.at(-1)')).toMatchObject({ action: 'set-card-state', state: 'not-started', returnReason: 'Сохранить эту причину',
      sourceHash: failure === 'conflict' ? 'card-hash-refreshed' : 'card-hash' });
    expect(await page.evaluate(`window.firstBatch.requests.some(request => request.action === 'add-journey-step-lesson')`)).toBe(false);
  });

  it('registers T for the open card and focuses tags in the Russian keyboard layout', async () => {
    await render({ tags: 1, lang: 'ru' });
    await key('е', 'KeyT');
    expect(await page.evaluate(`document.activeElement.classList.contains('card-properties-tag-chip')`)).toBe(true);
    await key('Escape');
    expect(await page.evaluate(`document.querySelector('.card-properties-slot').hidden`)).toBe(true);
  });

  it('names the state accessibly without visible text and keeps long owner initials distinct', async () => {
    await render({ owner: 'Александра Константинопольская — ведущий специалист'.repeat(3), lang: 'ru' });
    expect(await page.evaluate(`document.querySelector('.card-state-buttons').getAttribute('aria-label')`)).toBe('Состояние: Приёмка');
    expect(await page.evaluate(`document.querySelector('.card-state-buttons').textContent`)).toBe('');
    expect(await page.evaluate(`document.querySelector('.card-preview-owner-initials').textContent`)).toBe('АК');
    await click('.card-preview-action-rail button');
    expect(await page.evaluate(`getComputedStyle(document.querySelector('.card-properties-owner > span:last-child')).whiteSpace`)).toBe('normal');
  });

  it.each([{ archived: true }, { deleted: true }, { archived: true, deleted: true }])('shows lifecycle status and restores without clearing the archive: %j', async options => {
    await render({ ...options, lang: 'ru' });
    expect(await page.evaluate(`document.querySelector('.card-preview-lifecycle').textContent`)).toContain(options.deleted ? 'В корзине' : 'В архиве');
    if (options.deleted) {
      expect(await page.evaluate(`document.querySelector('.card-content-edit-action')`)).toBe(null);
      await click('.card-preview-lifecycle button');
      expect(await page.evaluate('window.firstBatch.requests[0].change.patch')).toEqual({ deleted: false });
    }
  });

  it('retries the failed history cursor without throwing away earlier events', async () => {
    await render();
    await click('.card-preview-action-rail button:last-child');
    await until(`Boolean(document.querySelector('.card-history-more button'))`);
    await page.evaluate('window.firstBatch.failHistory(true)');
    await click('.card-history-more button');
    await until(`Boolean(document.querySelector('.card-history-error button'))`);
    expect(await page.evaluate(`document.querySelectorAll('.card-history-event').length`)).toBe(1);
    await page.evaluate('window.firstBatch.failHistory(false); window.firstBatch.holdHistory()');
    await click('.card-history-error button');
    expect(await page.evaluate(`document.querySelector('.card-history-error button').disabled`)).toBe(true);
    await page.evaluate('window.firstBatch.finishHistory()');
    await until(`document.querySelectorAll('.card-history-event').length === 2`);
    expect(await page.evaluate('window.firstBatch.historyCursors')).toEqual([null, 'older', 'older']);
  });

  it('limits the overview title and exposes the whole title without changing the editor', async () => {
    await render({ title: 'Очень длинное название карточки '.repeat(20) });
    await until(`Boolean(document.querySelector('.card-preview-title-toggle'))`);
    expect(await page.evaluate(`document.querySelector('.card-preview-title').getBoundingClientRect().height`)).toBeLessThanOrEqual(107);
    await click('.card-preview-title-toggle');
    expect(await page.evaluate(`document.querySelector('.card-preview-title').getBoundingClientRect().height`)).toBeGreaterThan(107);
  });

  it('keeps the preview chrome compact and the reading title full-width on a narrow Russian screen', async () => {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 900, deviceScaleFactor: 1, mobile: false });
    try {
      await render({ title: 'Очень длинное название карточки '.repeat(6), kind: 'doc', lang: 'ru' });
      const layout = await page.evaluate(`(() => {
        const rail = document.querySelector('.card-preview-action-rail button');
        const close = document.querySelector('.card-preview-tools button');
        const title = document.querySelector('.card-preview-title');
        const reading = document.querySelector('.card-preview-reading');
        const edit = document.querySelector('.card-content-edit-action');
        return { rail: rail.getBoundingClientRect().width, railRadius: getComputedStyle(rail).borderRadius,
          close: close.getAttribute('aria-label'), title: title.getBoundingClientRect().width,
          reading: reading.clientWidth, editHeight: edit.getBoundingClientRect().height,
          editRadius: getComputedStyle(edit).borderRadius, overflow: document.documentElement.scrollWidth > innerWidth,
          focusedShell: Boolean(reading.closest('.card-focus-mode')), contentTop: reading.getBoundingClientRect().top };
      })()`);
      expect(layout.rail).toBe(36);
      expect(layout.railRadius).toBe('2px');
      expect(layout.close).toBe('Закрыть карточку');
      expect(layout.title).toBeGreaterThanOrEqual(layout.reading - 33);
      expect(layout.editHeight).toBe(30);
      expect(layout.editRadius).toBe('2px');
      expect(layout.overflow).toBe(false);
      expect(layout.focusedShell).toBe(true);
      expect(layout.contentTop).toBeLessThanOrEqual(300);
    } finally {
      await page.send('Emulation.clearDeviceMetricsOverride');
    }
  });

  it.each([1440, 375])('labels only Doc previews without clipping or shifting content at %s px', async width => {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    try {
      for (const theme of ['dark', 'light']) for (const lang of ['en', 'ru']) {
        for (const kind of ['task', 'hero']) {
          await render({ kind, theme, lang });
          expect(await page.evaluate(`document.querySelector('.card-preview-kind')`)).toBe(null);
        }
        const frames = await page.callFunction(`async function(options) {
          await document.fonts.ready;
          const originalFetch = window.fetch;
          let releaseContent;
          window.fetch = (...args) => {
            const response = originalFetch(...args);
            if (!String(args[0]).startsWith('/api/card-content')) return response;
            return new Promise(resolve => { releaseContent = () => resolve(response); });
          };
          try {
            return await new Promise((resolve, reject) => {
              const frames = [], started = performance.now();
              window.firstBatch.render(options);
              function sample() {
                const preview = document.querySelector('.card-preview-doc');
                const sheet = preview?.querySelector('.card-preview-sheet').getBoundingClientRect();
                const title = preview?.querySelector('.card-preview-title');
                const body = preview?.querySelector('.card-preview-document');
                if (title && body) {
                  frames.push({ label: preview.querySelector('.card-preview-kind')?.textContent,
                    title: title.getBoundingClientRect().top - sheet.top, body: body.getBoundingClientRect().top - sheet.top });
                  if (frames.length === 3) releaseContent?.();
                  if (frames.length >= 12 && preview.querySelector('.card-content-save-status.is-calm')) return resolve(frames);
                }
                if (performance.now() - started > 5000) return reject(new Error('Doc preview did not finish loading'));
                requestAnimationFrame(sample);
              }
              requestAnimationFrame(sample);
            });
          } finally { releaseContent?.(); window.fetch = originalFetch; }
        }`, { kind: 'doc', state: null, title: 'Document preview', theme, lang }) as { label: string; title: number; body: number }[];
        expect(frames.every(frame => frame.label === 'Doc Card')).toBe(true);
        for (const key of ['title', 'body'] as const) {
          const positions = frames.map(frame => frame[key]);
          expect(Math.max(...positions) - Math.min(...positions)).toBeLessThanOrEqual(1);
        }
        await waitForLayout(page.evaluate, '.card-preview-sheet, .card-preview-kind');
        expect(await page.evaluate(`(() => {
          const label = document.querySelector('.card-preview-kind'), text = label.querySelector('span');
          const icon = label.querySelector('svg'), tools = document.querySelector('.card-preview-subcards-actions');
          const rect = label.getBoundingClientRect(), iconRect = icon.getBoundingClientRect(), textRect = text.getBoundingClientRect();
          const style = getComputedStyle(label), range = document.createRange();
          range.selectNodeContents(text);
          return { text: label.textContent, icon: icon.classList.contains('lucide-file-text'), hiddenIcon: icon.getAttribute('aria-hidden'),
            weight: style.fontWeight, muted: style.color === getComputedStyle(tools.querySelector('button')).color,
            aligned: Math.abs(iconRect.top + iconRect.height / 2 - textRect.top - textRect.height / 2) < 1,
            oneLine: range.getClientRects().length === 1, fits: rect.left >= 0 && rect.right <= tools.getBoundingClientRect().left
              && text.scrollWidth <= text.clientWidth && text.scrollHeight <= text.clientHeight,
            overflow: document.documentElement.scrollWidth > innerWidth };
        })()`)).toEqual({ text: 'Doc Card', icon: true, hiddenIcon: 'true', weight: '600', muted: true, aligned: true, oneLine: true, fits: true, overflow: false });
        if (process.env.DECKMATE_DOC_PREVIEW_SHOTS) {
          await mkdir(process.env.DECKMATE_DOC_PREVIEW_SHOTS, { recursive: true });
          const screenshot = await page.send('Page.captureScreenshot', { format: 'png' });
          await writeFile(path.join(process.env.DECKMATE_DOC_PREVIEW_SHOTS, `doc-${theme}-${lang}-${width}.png`), Buffer.from(screenshot.result.data, 'base64'));
        }
      }
      expect(page.consoleErrors).toEqual([]);
    } finally { await page.send('Emulation.clearDeviceMetricsOverride'); }
  });

  it('exposes Sub Card state and full title to readers and keyboard tooltips', async () => {
    await render({ family: true, kind: 'hero', lang: 'ru' });
    expect(await page.evaluate(`document.querySelector('.card-family-list .card-family-row-state').textContent`)).toBe('В работе');
    expect(await page.evaluate(`document.querySelector('.card-family-list .card-family-row-open').getAttribute('aria-label')`)).toContain('Полное название Sub Card '.repeat(20));
    // 2026-11-10: reveal the fixture's separate family before focusing it; Radix closes hints on ancestor scrolls.
    await key('Tab');
    await page.evaluate(`document.querySelector('.card-family-list .card-family-row-open').scrollIntoView({ block: 'center', behavior: 'instant' })`);
    await delay(60);
    const focus = await page.evaluate(`(() => {
      const button = document.querySelector('.card-family-list .card-family-row-open'), title = button.querySelector('strong');
      button.focus({ preventScroll: true });
      return { focused: document.activeElement === button, disabled: button.disabled,
        clipped: title.scrollHeight > title.clientHeight + 1 || title.scrollWidth > title.clientWidth + 1 };
    })()`);
    expect(focus).toMatchObject({ focused: true, disabled: false, clipped: true });
    // Read the tooltip in the same poll that finds it: a later evaluate could race its close.
    await until(`Boolean(document.querySelector('[role="tooltip"]')?.textContent.includes('Полное название Sub Card'))`);
    expect(page.consoleErrors).toEqual([]);
  });

  it('pins tags, Edit, save status and the blocker warning while the text scrolls', async () => {
    const markdown = Array.from({ length: 60 }, (_, index) => `Paragraph ${index + 1} keeps the card text going past the window.`).join(String.fromCharCode(10).repeat(2));
    await render({ markdown, tags: 1, dependencies: true });
    const measure = () => page.evaluate(`(() => {
      const box = selector => document.querySelector(selector)?.getBoundingClientRect();
      const shown = selector => { const r = box(selector); return Boolean(r && r.height > 0 && r.top >= 0 && r.bottom <= innerHeight); };
      const scroller = document.querySelector('.card-preview-panels');
      return { scrollable: scroller.scrollHeight - scroller.clientHeight,
        dockTop: Math.round(box('.card-preview-dock').top), gapToBand: Math.round(box('.card-preview-material-band').top - box('.card-preview-dock').bottom),
        shown: ['.card-preview-dock .card-preview-blocker-note', '.card-preview-dock .card-content-edit-action', '.card-preview-dock .card-content-save-status'].map(shown),
        inScroller: ['.card-content-edit-action', '.card-content-save-status', '.card-preview-tags'].map(selector => scroller.contains(document.querySelector(selector))),
        row: Math.round(box('.card-preview-dock-actions').height),
        dockOpaque: getComputedStyle(document.querySelector('.card-preview-dock')).backgroundColor !== 'rgba(0, 0, 0, 0)' };
    })()`);
    const top = await measure();
    expect(top.scrollable).toBeGreaterThan(400);
    expect(top.shown).toEqual([true, true, true]);
    expect(top.inScroller).toEqual([false, false, false]);
    expect(top.gapToBand).toBe(0);
    expect(top.row).toBeLessThanOrEqual(32);
    expect(top.dockOpaque).toBe(true);
    for (const position of ['half', 'end']) {
      await page.evaluate(`(() => { const scroller = document.querySelector('.card-preview-panels');
        scroller.scrollTop = ${JSON.stringify(position)} === 'half' ? (scroller.scrollHeight - scroller.clientHeight) / 2 : scroller.scrollHeight; })()`);
      await delay(60);
      const scrolled = await measure();
      expect(scrolled.dockTop).toBe(top.dockTop);
      expect(scrolled.shown).toEqual(top.shown);
    }
    // The calm save state is a quiet icon whose words stay for tooltips and screen readers.
    expect(await page.evaluate(`(() => { const status = document.querySelector('.card-preview-dock .card-content-save-status');
      return [status.classList.contains('is-calm'), status.title, status.textContent]; })()`)).toEqual([true, 'Saved to file', 'Saved to file']);
  });

  it('distinguishes saved file text from unsaved and browser-stashed drafts', async () => {
    await render({ lang: 'ru' });
    expect(await page.evaluate(`document.querySelector('.card-content-save-status').textContent`)).toBe('Сохранено в файле');
    await click('.card-content-edit-action');
    await page.send('Input.insertText', { text: 'Новый текст ' });
    await until(`document.querySelector('.card-content-save-status').textContent.includes('несохранённый')`);
    await key('Escape');
    expect(await page.evaluate(`document.querySelector('.card-draft-banner').textContent`)).toContain('Черновик в этом браузере');
    await click('.card-draft-banner-actions button');
    await click('.card-edit-save');
    await until(`document.querySelector('.card-content-save-status')?.textContent === 'Сохранено в файле'`);
    expect(await page.evaluate('window.firstBatch.requests[0].action')).toBe('update-card-content');
    await until(`document.activeElement === document.querySelector('.card-content-edit-action')`);
    expect(await page.evaluate(`getComputedStyle(document.activeElement).outlineStyle`)).toBe('none');
  });

  it.each(['light', 'dark'])('shows keyboard focus on the scrolling questions panel in %s', async theme => {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 500, deviceScaleFactor: 1, mobile: false });
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    try {
      const markdown = `## Open questions\n\n${Array.from({ length: 12 }, (_, index) => `- Question ${index + 1}?`).join('\n')}`;
      await render({ kind: 'doc', lang: 'ru', theme, markdown });
      await key('Tab');
      await page.evaluate(`document.querySelector('.card-preview-open-questions').focus({ focusVisible: true })`);
      await key('Enter');
      await until(`document.activeElement === document.querySelector('.card-related-slot')`);
      const focus = await page.evaluate(`(() => {
        const panel = document.querySelector('.card-related-slot'), style = getComputedStyle(panel);
        const rgb = value => value.match(/[\\d.]+/g).slice(0, 3).map(Number).map(value => {
          const channel = value / 255; return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
        });
        const luminance = value => { const [r, g, b] = rgb(value); return .2126 * r + .7152 * g + .0722 * b; };
        const colors = [luminance(style.outlineColor), luminance(style.backgroundColor)].sort((a, b) => b - a);
        return { focused: panel.matches(':focus-visible'), outline: style.outlineStyle, width: style.outlineWidth,
          offset: style.outlineOffset, shadow: style.boxShadow, contrast: (colors[0] + .05) / (colors[1] + .05),
          scrollable: panel.scrollHeight > panel.clientHeight && style.overflowY === 'auto' };
      })()`);
      expect(focus).toMatchObject({ focused: true, outline: 'solid', width: '2px', offset: '-2px', scrollable: true });
      expect(focus.shadow).not.toBe('none');
      expect(focus.contrast).toBeGreaterThanOrEqual(3);
      await key('ArrowDown');
      await key('ArrowDown');
      await until(`document.querySelector('.card-related-slot').scrollTop > 0`);
      expect(await page.evaluate(`document.activeElement === document.querySelector('.card-related-slot')`)).toBe(true);
      if (process.env.DECKMATE_A11Y_SHOTS) {
        await page.evaluate(`document.querySelector('.card-related-slot').scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' })`);
        await mkdir(process.env.DECKMATE_A11Y_SHOTS, { recursive: true });
        const image = await page.send('Page.captureScreenshot', { format: 'png' });
        await writeFile(path.join(process.env.DECKMATE_A11Y_SHOTS, `questions-focus-${theme}-1000.png`), Buffer.from(image.result.data, 'base64'));
      }
      await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }, { name: 'forced-colors', value: 'active' }] });
      expect(await page.evaluate(`(() => { const panel = document.querySelector('.card-related-slot'), style = getComputedStyle(panel);
        return panel.matches(':focus-visible') && style.outlineStyle === 'solid' && style.outlineWidth === '2px'; })()`)).toBe(true);
      await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      await key('Tab');
      expect(await page.evaluate(`document.activeElement.closest('.card-related-slot') !== null && document.activeElement.matches(':focus-visible')`)).toBe(true);
      await key('Escape');
      const point = await page.evaluate(`(() => { const button = document.querySelector('.card-preview-open-questions');
        button.scrollIntoView({ block: 'nearest', behavior: 'instant' });
        const box = button.getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; })()`);
      for (const type of ['mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 });
      await until(`document.activeElement === document.querySelector('.card-related-slot')`);
      expect(await page.evaluate(`(() => { const panel = document.querySelector('.card-related-slot'); return !panel.matches(':focus-visible') && getComputedStyle(panel).outlineStyle === 'none'; })()`)).toBe(true);
    } finally {
      await page.send('Emulation.setEmulatedMedia', { features: [] });
      await page.send('Emulation.clearDeviceMetricsOverride');
    }
  });

  it.each([375, 1280])('opens questions in the card panel at %ipx in both themes', async width => {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    try {
      for (const theme of ['light', 'dark']) {
        const original = 'Context\n\n## Решено\n\n- Записано. — Pier, 2026-11-12\n- Длинное решение с подробностями для всей команды и ссылкой на [задачу](https://example.com). — Ася, 2026-11-11\n\n## Открыто\n\n- Какой целевой FPS (30 → 60) — для слабых ноутбуков? — [Решение](/r/c-0123456789)\n- [ ] Длинный вопрос о том, как сохранить контекст решения для всей команды?\n- [ ] Второй вопрос\n- [ ] Третий вопрос';
        const markdown = recordDecision(original, 0, 'Какой целевой FPS (30 → 60) — для слабых ноутбуков?', '60 FPS — сначала оптимизируем самые тяжёлые сцены.', 'Pier', '2026-11-12', 'ru', 'ru');
        await render({ kind: 'doc', lang: 'ru', theme, markdown });
        expect(await page.evaluate(`document.querySelector('.card-preview-document').textContent`)).not.toContain('Длинный вопрос');
        expect(await page.evaluate(`document.querySelector('.card-preview-document').textContent`)).not.toContain('Записано.');
        await click('.card-preview-open-questions');
        expect(await page.evaluate(`document.querySelector('.card-preview-open-questions').getAttribute('aria-pressed')`)).toBe('true');
        expect(await page.evaluate(`document.querySelectorAll('.open-question-row').length`)).toBe(3);
        expect(await page.evaluate(`Array.from(document.querySelectorAll('.open-question-discuss-action'), node => node.textContent)`)).toEqual(['Скопировать ID вопроса', 'Скопировать ID вопроса', 'Скопировать ID вопроса']);
        expect(await page.evaluate(`document.querySelectorAll('.open-questions-list input[type="checkbox"]').length`)).toBe(0);
        expect(await page.evaluate(`document.querySelector('.open-questions-resolved').textContent`)).toContain('Решения');
        expect(await page.evaluate(`document.documentElement.scrollWidth <= innerWidth`)).toBe(true);
        if (process.env.DECKMATE_QUESTION_SHOTS) {
          await mkdir(process.env.DECKMATE_QUESTION_SHOTS, { recursive: true });
          const screenshot = await page.send('Page.captureScreenshot', { format: 'png' });
          await writeFile(path.join(process.env.DECKMATE_QUESTION_SHOTS, `preview-${theme}-${width}.png`), Buffer.from(screenshot.result.data, 'base64'));
          await click('.open-question-answer-action');
          const answerScreenshot = await page.send('Page.captureScreenshot', { format: 'png' });
          await writeFile(path.join(process.env.DECKMATE_QUESTION_SHOTS, `answer-${theme}-${width}.png`), Buffer.from(answerScreenshot.result.data, 'base64'));
          await key('Escape');
        }
        expect(await page.evaluate(`document.querySelector('.open-questions-resolved').textContent`)).toContain('Записано.');
        expect(await page.evaluate(`document.querySelector('.resolved-attribution').textContent`)).toContain('Pier · 2026-11-12');
        expect(await page.evaluate(`document.querySelectorAll('.resolved-question').length`)).toBe(1);
        expect(await page.evaluate(`document.querySelector('.resolved-question').textContent`)).toBe('Какой целевой FPS (30 → 60) — для слабых ноутбуков? →');
        expect(await page.evaluate(`document.querySelector('.open-questions-resolved').textContent`)).not.toContain('Исходный вопрос не записан');
        expect(await page.evaluate(`document.querySelector('.open-questions-resolved').textContent`)).not.toContain('deckmate:decision');
        expect(await page.evaluate(`document.querySelector('.resolved-decision a').getAttribute('href')`)).toBe('https://example.com/');
        expect(await page.evaluate(`document.querySelector('.card-preview-open-questions').nextElementSibling.getAttribute('aria-label')`)).toBe('История');
        expect(await page.evaluate(`document.documentElement.scrollWidth <= innerWidth`)).toBe(true);
        if (process.env.DECKMATE_QUESTION_SHOTS) {
          await page.evaluate(`document.querySelector('.open-questions-resolved').scrollIntoView({ block: 'start', behavior: 'instant' })`);
          const screenshot = await page.send('Page.captureScreenshot', { format: 'png' });
          await writeFile(path.join(process.env.DECKMATE_QUESTION_SHOTS, `resolved-${theme}-${width}.png`), Buffer.from(screenshot.result.data, 'base64'));
        }
        await key('Escape');
        expect(await page.evaluate(`document.activeElement === document.querySelector('.card-preview-open-questions')`)).toBe(true);
      }
    } finally { await page.send('Emulation.clearDeviceMetricsOverride'); }
  });

  it('shows an English legacy decision without offering a separate Task', async () => {
    const reference = shortReference('c', 'card:dependency');
    const markdown = recordDecision(`## Open questions\n\n- Which FPS? — [Decision](/r/${reference})\n`, 0, 'Which FPS?', '60 on low-end laptops.', 'Maya Chen', '2026-11-12', 'en', 'en');
    await render({ kind: 'doc', dependencies: true, markdown });
    await click('.card-preview-open-questions');
    expect(await page.evaluate(`document.querySelector('.resolved-question').textContent`)).toBe('Which FPS? →');
    expect(await page.evaluate(`document.querySelector('.resolved-decision').textContent`)).toBe('60 on low-end laptops.');
    expect(await page.evaluate(`document.querySelector('.open-questions-resolved').textContent`)).not.toContain('Original question not recorded');
    expect(await page.evaluate(`document.querySelector('.decision-status').textContent`)).toBe('to apply');
    expect(await page.evaluate('window.firstBatch.selections')).toEqual([]);
  });

  it('keeps legacy task links out of the question actions', async () => {
    const reference = shortReference('c', 'card:dependency');
    await render({ kind: 'doc', dependencies: true, markdown: `## Open questions\n\n- [ ] Which FPS? — [Decision](/r/${reference})\n- [ ] Which deck?\n` });
    await click('.card-preview-open-questions');
    expect(await page.evaluate(`document.querySelector('.open-question-text').textContent`)).toBe('Which FPS?');
    expect(await page.evaluate(`document.querySelectorAll('.open-question-assign-action, .open-question-task').length`)).toBe(0);
    expect(await page.evaluate(`document.querySelectorAll('.open-question-discuss-action').length`)).toBe(2);
  });

  it('retains rich question content and protects an unanswered draft', async () => {
    const markdown = 'Context\n\n## Open questions\n\n- Which **light**?\n  - Warm\n  - Cold\n\n## Notes\n\nKeep this paragraph.\n';
    await render({ kind: 'doc', markdown });
    await click('.card-preview-open-questions');
    expect(await page.evaluate(`document.querySelector('.open-question-text').textContent`)).toContain('Cold');
    expect(await page.evaluate(`document.querySelector('.open-question-text strong').textContent`)).toBe('light');
    await click('.open-question-answer-action');
    await page.send('Input.insertText', { text: 'Keep my answer' });
    expect(await page.evaluate(`document.querySelector('.card-content-edit-action').disabled`)).toBe(true);
    expect(await page.evaluate(`document.querySelector('.card-questions-panel-heading button').disabled`)).toBe(true);
    await key('Escape');
    await key('Escape');
    await click('.card-content-edit-action');
    expect(await page.evaluate(`document.querySelector('.card-edit-text').value`)).toContain(markdown);
    await click('.card-edit-link.is-cancel');
  });

  it.each(['answer', 'ask'])('preserves the %s draft after a press on the dimmed card list', async form => {
    await render({ deckLayout: true, markdown: '## Open questions\n\n- First question' });
    await click('.card-preview-open-questions');
    await until(`document.querySelector('.catalog-results').hasAttribute('inert')`);
    await click(`.open-question-${form}-action`);
    await page.send('Input.insertText', { text: 'Keep this draft' });
    await until(`document.querySelector('.card-questions-panel-heading button').disabled`);
    const point = await page.evaluate(`(() => {
      const box = document.querySelector('.catalog-results').getBoundingClientRect();
      return { x: box.right - 10, y: box.top + 40 };
    })()`);
    for (const type of ['mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 });
    await page.evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    expect(await page.evaluate(`document.querySelector('.open-question-${form} textarea')?.value`)).toBe('Keep this draft');
    expect(await page.evaluate('window.firstBatch.requests')).toEqual([]);
    expect(await page.evaluate(`document.querySelector('.catalog-results').hasAttribute('inert')`)).toBe(true);
    await click(`.open-question-${form} .open-question-answer-buttons button:first-child`);
    for (const type of ['mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 });
    await until(`!document.querySelector('.open-questions') && !document.querySelector('.catalog-results').hasAttribute('inert')`);
    expect(await page.evaluate(`document.activeElement === document.querySelector('.card-preview-open-questions')`)).toBe(true);
  });

  it('defaults the answering member, preserves multiline input and records with Ctrl+Enter', async () => {
    await render({ kind: 'doc', people: 2, markdown: '## Open questions\n\n- [ ] First question\n- [ ] Second question' });
    await click('.card-preview-open-questions');
    await click('.open-question-answer-action');
    expect(await page.evaluate(`document.querySelector('.open-question-answer select').value`)).toBe('maya');
    await page.send('Input.insertText', { text: 'First line' });
    await key('Enter');
    await page.send('Input.insertText', { text: 'Second line' });
    expect(await page.evaluate('window.firstBatch.requests.length')).toBe(0);
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers: 2 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers: 2 });
    await until('window.firstBatch.requests.length === 1');
    expect(await page.evaluate('window.firstBatch.requests[0]')).toMatchObject({ action: 'record-decision', questionIndex: 0, memberId: 'maya', answer: 'First line\nSecond line' });
  });

  it.each(['en', 'ru'])('shows the sole human as text and records their identity in %s', async lang => {
    await render({ kind: 'doc', people: 1, lang, markdown: '## Open questions\n\n- First question' });
    await click('.card-preview-open-questions');
    await click('.open-question-answer-action');
    expect(await page.evaluate(`document.querySelector('.open-question-author').textContent`)).toBe(lang === 'ru' ? 'От имени:Maya Chen' : 'ByMaya Chen');
    expect(await page.evaluate(`document.querySelector('.open-question-author select')`)).toBe(null);
    expect(await page.evaluate(`document.querySelector('.open-question-answer button[type="submit"]').disabled`)).toBe(true);
    await delay(500);
    expect(await page.evaluate(`getComputedStyle(document.querySelector('.open-question-answer button[type="submit"]')).opacity`)).toBe('0.5');
    await page.send('Input.insertText', { text: 'A decision' });
    await click('.open-question-answer button[type="submit"]');
    await until('window.firstBatch.requests.length === 1');
    expect(await page.evaluate('window.firstBatch.requests[0]')).toMatchObject({ action: 'record-decision', memberId: 'maya', answer: 'A decision' });
  });

  it('records the chosen author when more than one human is available', async () => {
    await render({ kind: 'doc', people: 2, markdown: '## Open questions\n\n- First question' });
    await click('.card-preview-open-questions');
    await click('.open-question-answer-action');
    await page.send('Input.insertText', { text: 'A decision' });
    await page.evaluate(`(() => { const select = document.querySelector('.open-question-author select');
      select.value = 'lee'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await click('.open-question-answer button[type="submit"]');
    await until('window.firstBatch.requests.length === 1');
    expect(await page.evaluate('window.firstBatch.requests[0]')).toMatchObject({ action: 'record-decision', memberId: 'lee', answer: 'A decision' });
  });

  it('requires an author when no acting member is selected and identifies the addressee', async () => {
    await page.evaluate(`localStorage.removeItem('deckmate-current-member')`);
    try {
      await render({ kind: 'task', people: 2, questions: [{ text: 'Who decides?', taskRef: null, assignee: 'lee' }] });
      await click('.card-preview-open-questions');
      await click('.open-question-answer-action');
      expect(await page.evaluate(`document.querySelector('.open-question-answer .open-question-hint').textContent`)).toBe('Question addressed to Lee; check the answer author below.');
      expect(await page.evaluate(`document.querySelector('.open-question-author select').value`)).toBe('');
      await page.send('Input.insertText', { text: 'An answer' });
      expect(await page.evaluate(`document.querySelector('.open-question-answer button[type="submit"]').disabled`)).toBe(true);
      await page.evaluate(`(() => { const select = document.querySelector('.open-question-author select'); select.value = 'maya'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await click('.open-question-answer button[type="submit"]');
      await until('window.firstBatch.requests.length === 1');
      expect(await page.evaluate('window.firstBatch.requests[0]')).toMatchObject({ memberId: 'maya', answer: 'An answer' });
    } finally { await page.evaluate(`localStorage.setItem('deckmate-current-member', 'maya')`); }
  });

  it('keeps question actions reachable on a coarse phone and labels the question entry point', async () => {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: false });
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    try {
      await render({ kind: 'task', lang: 'ru', theme: 'dark', people: 2 });
      expect(await page.evaluate(`(() => { const button = document.querySelector('.card-preview-questions-shortcut'); return button.getBoundingClientRect().height >= 44 && button.textContent.includes('Вопросы и решения'); })()`)).toBe(true);
      await click('.card-preview-questions-shortcut');
      await click('.open-question-ask-action');
      expect(await page.evaluate(`getComputedStyle(document.querySelector('.open-question-ask .open-question-answer-footer')).position`)).toBe('sticky');
      const layout = await page.evaluate(`(() => {
        const panel = document.querySelector('.card-related-slot').getBoundingClientRect();
        const footer = document.querySelector('.open-question-ask .open-question-answer-footer').getBoundingClientRect();
        const buttons = [...document.querySelectorAll('.open-question-ask .open-question-answer-buttons button')].map(button => button.getBoundingClientRect());
        return { visible: footer.bottom <= panel.bottom + 1 && footer.top >= panel.top, touch: buttons.every(button => button.height >= 44), overflow: document.documentElement.scrollWidth > innerWidth };
      })()`);
      expect(layout).toEqual({ visible: true, touch: true, overflow: false });
      if (process.env.DECKMATE_QUESTION_SHOTS) {
        await mkdir(process.env.DECKMATE_QUESTION_SHOTS, { recursive: true });
        const screenshot = await page.send('Page.captureScreenshot', { format: 'png' });
        await writeFile(path.join(process.env.DECKMATE_QUESTION_SHOTS, 'ask-coarse-dark-375x812.png'), Buffer.from(screenshot.result.data, 'base64'));
      }
    } finally {
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: false });
      await page.send('Emulation.clearDeviceMetricsOverride');
    }
  });

  it.each([345, 375, 1280])('keeps the answering member and actions inside the question footer at %ipx', async width => {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    try {
      for (const lang of ['en', 'ru']) for (const theme of ['light', 'dark']) {
        await render({ kind: 'doc', people: 2, lang, theme, markdown: '## Open questions\n\n- First question' });
        await click('.card-preview-open-questions');
        await click('.open-question-answer-action');
        const layout = await page.evaluate(`(() => {
          const footer = document.querySelector('.open-question-answer-footer'), author = footer.querySelector('.open-question-author');
          const actions = footer.querySelector('.open-question-answer-buttons'), buttons = [...actions.querySelectorAll('button')];
          const f = footer.getBoundingClientRect(), a = author.getBoundingClientRect(), g = actions.getBoundingClientRect();
          const b = buttons.map(button => button.getBoundingClientRect());
          return { author: author.textContent, select: author.querySelector('select').value,
            fits: document.documentElement.scrollWidth <= innerWidth && footer.scrollWidth <= footer.clientWidth + 1 && a.left >= f.left - 1 && a.right <= f.right + 1 && g.left >= f.left - 1 && g.right <= f.right + 1,
            separate: g.top >= a.bottom - 1 || g.left >= a.right - 1, right: Math.abs(g.right - f.right) < 1,
            together: Math.abs(b[0].top - b[1].top) < 1, sameRow: Math.abs(a.top - g.top) <= 2 };
        })()`);
        expect(layout.author).toContain(lang === 'ru' ? 'От имени:' : 'By');
        expect(layout.select).toBe('maya');
        expect(layout.fits && layout.separate && layout.right && layout.together).toBe(true);
        if (width >= 375) expect(layout.sameRow).toBe(true);
      }
    } finally { await page.send('Emulation.clearDeviceMetricsOverride'); }
  });

  it('keeps both footer actions together and touch-sized on a narrow screen', async () => {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 900, deviceScaleFactor: 1, mobile: false });
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    try {
      for (const lang of ['en', 'ru']) {
        await render({ kind: 'doc', people: 2, lang, markdown: '## Open questions\n\n- First question' });
        await click('.card-preview-open-questions');
        await click('.open-question-answer-action');
        const geometry = await page.evaluate(`(() => {
          const footer = document.querySelector('.open-question-answer-footer').getBoundingClientRect();
          const buttons = [...document.querySelectorAll('.open-question-answer-buttons button')].map(button => button.getBoundingClientRect());
          const select = document.querySelector('.open-question-author select').getBoundingClientRect();
          return { heights: [select.height, ...buttons.map(button => button.height)], gap: buttons[1].left - buttons[0].right,
            together: Math.abs(buttons[0].top - buttons[1].top) < 1, right: Math.abs(buttons[1].right - footer.right) < 1,
            overflow: document.documentElement.scrollWidth > innerWidth };
        })()`);
        expect(geometry.heights.every((height: number) => height >= 44)).toBe(true);
        expect(geometry.gap).toBeGreaterThanOrEqual(8);
        expect(geometry.together && geometry.right && !geometry.overflow).toBe(true);
      }
    } finally {
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: false });
      await page.send('Emulation.clearDeviceMetricsOverride');
    }
  });

  it.each([
    { form: 'answer', lang: 'en', theme: 'dark', motion: 'no-preference' },
    { form: 'answer', lang: 'ru', theme: 'light', motion: 'reduce' },
    { form: 'ask', lang: 'en', theme: 'dark', motion: 'reduce' },
    { form: 'ask', lang: 'ru', theme: 'light', motion: 'no-preference' },
  ])('keeps $form saving visually stable and prevents duplicate submissions ($lang, $motion)', async ({ form, lang, theme, motion }) => {
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: motion }] });
    try {
      await render({ kind: 'doc', people: 2, lang, theme, markdown: '## Open questions\n\n- First question' });
      await click('.card-preview-open-questions');
      await click(form === 'answer' ? '.open-question-answer-action' : '.open-question-ask-action');
      await page.send('Input.insertText', { text: 'A draft' });
      const selector = `.open-question-${form} button[type="submit"]`;
      const point = await page.callFunction(`selector => {
        const button = document.querySelector(selector); button.scrollIntoView({ block: 'nearest', behavior: 'instant' });
        const rect = button.getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      }`, selector);
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
      await delay(500);
      const before = await page.callFunction(`selector => {
        const button = document.querySelector(selector), style = getComputedStyle(button);
        window.questionSaveButton = button;
        return { background: style.backgroundColor, color: style.color, opacity: style.opacity };
      }`, selector);
      await page.evaluate('window.firstBatch.holdEdit()');
      for (const type of ['mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 });
      await until(`document.querySelector('${selector}')?.getAttribute('aria-busy') === 'true' && window.firstBatch.requests.length === 1`);
      await page.callFunction(`form => {
        const element = document.querySelector('.open-question-' + form);
        element.requestSubmit(); element.requestSubmit();
        element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      }`, form);
      const samples = await page.callFunction(`selector => new Promise(resolve => {
        const samples = [], start = performance.now();
        function sample() {
          const button = document.querySelector(selector), style = getComputedStyle(button);
          samples.push({ background: style.backgroundColor, color: style.color, opacity: style.opacity, transition: style.transition,
            disabled: button.disabled, same: button === window.questionSaveButton, animation: Boolean(button.querySelector('.spin')) });
          if (performance.now() - start < 700) requestAnimationFrame(sample); else resolve(samples);
        }
        requestAnimationFrame(sample);
      })`, selector);
      expect(before.opacity).toBe('1');
      expect(samples.length).toBeGreaterThan(2);
      expect(samples.every((sample: Record<string, unknown>) => sample.background === before.background && sample.color === before.color
        && sample.opacity === '1' && sample.transition === 'none' && sample.disabled && sample.same && !sample.animation)).toBe(true);
      expect(await page.evaluate(`document.querySelector('.open-question-${form} [role="status"]').textContent`)).toBe(lang === 'ru' ? 'Записываю…' : 'Saving…');
      expect(await page.evaluate('window.firstBatch.requests.length')).toBe(1);
      await page.evaluate('window.firstBatch.finishEdit()');
      await until(`!document.querySelector('.open-question-${form}')`);
    } finally { await page.send('Emulation.setEmulatedMedia', { features: [] }); }
  }, 15000);

  it('keeps the saving state and draft when a question changes during a failed write', async () => {
    await render({ kind: 'task', questions: [{ text: 'First question', taskRef: null, assignee: null }] });
    await click('.card-preview-open-questions');
    await click('.open-question-answer-action');
    await page.send('Input.insertText', { text: 'Keep this answer' });
    await page.evaluate(`window.firstBatch.holdEdit(); window.firstBatch.failEdit('conflict')`);
    await click('.open-question-answer button[type="submit"]');
    await until(`document.querySelector('.open-question-answer button[type="submit"]')?.getAttribute('aria-busy') === 'true'`);
    await page.evaluate('window.firstBatch.removeQuestion()');
    await until(`Boolean(document.querySelector('.open-question-orphan'))`);
    expect(await page.evaluate(`document.querySelector('.open-question-orphan button[type="submit"]').textContent`)).toBe('Saving…');
    expect(await page.evaluate(`document.querySelector('.open-question-orphan [role="alert"]')`)).toBe(null);
    await page.evaluate('window.firstBatch.finishEdit()');
    await until(`Boolean(document.querySelector('.open-question-orphan [role="alert"]'))`);
    expect(await page.evaluate(`document.querySelector('.open-question-orphan textarea').value`)).toBe('Keep this answer');
    expect(await page.evaluate(`document.querySelector('.open-question-orphan [role="alert"]').textContent`)).toContain('The question changed');
    expect(await page.evaluate(`document.querySelector('.open-question-orphan .open-question-answer-buttons button:last-child').disabled`)).toBe(true);
    expect(await page.evaluate('window.firstBatch.requests.length')).toBe(1);
  });

  it.skipIf(!process.env.DECKMATE_QUESTION_FIX2_SHOTS)('captures question form states and pending frames', async () => {
    const directory = process.env.DECKMATE_QUESTION_FIX2_SHOTS!;
    const phase = process.env.DECKMATE_QUESTION_FIX2_PHASE ?? 'after';
    await mkdir(directory, { recursive: true });
    const capture = async (name: string) => {
      const screenshot = await page.send('Page.captureScreenshot', { format: 'png' });
      await writeFile(path.join(directory, `${phase}-${name}.png`), Buffer.from(screenshot.result.data, 'base64'));
    };
    const pointerSubmit = async (selector: string) => {
      const point = await page.callFunction(`selector => {
        const button = document.querySelector(selector), rect = button.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      }`, selector);
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
      await delay(150);
      for (const type of ['mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 });
    };
    const frames = async (name: string, selector: string) => {
      const samples = [];
      for (let index = 0; index < 8; index++) {
        samples.push(await page.callFunction(`selector => {
          const button = document.querySelector(selector), style = getComputedStyle(button);
          return { time: performance.now(), text: button.textContent, disabled: button.disabled, opacity: style.opacity,
            background: style.backgroundColor, color: style.color, transition: style.transition, animation: button.querySelector('svg') && getComputedStyle(button.querySelector('svg')).animationName };
        }`, selector));
        await capture(`${name}-frame-${index}`);
        await delay(100);
      }
      await writeFile(path.join(directory, `${phase}-${name}-frames.json`), JSON.stringify(samples, null, 2));
    };
    try {
      for (const width of [345, 375]) for (const theme of ['dark', 'light']) for (const lang of ['en', 'ru']) {
        await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
        await render({ kind: 'doc', people: 2, theme, lang, markdown: '## Open questions\n\n- Which FPS?' });
        await click('.card-preview-open-questions');
        await click('.open-question-answer-action');
        await delay(500);
        const name = `answer-${lang}-${theme}-${width}`;
        await capture(`${name}-empty`);
        await page.send('Input.insertText', { text: '60 FPS' });
        await delay(180);
        await capture(`${name}-filled`);
        await page.evaluate('window.firstBatch.holdEdit()');
        await pointerSubmit('.open-question-answer button[type="submit"]');
        await until(`document.querySelector('.open-question-answer button[type="submit"]')?.disabled`);
        await capture(`${name}-saving`);
        if (width === 375 && theme === 'dark' && lang === 'en') await frames(name, '.open-question-answer button[type="submit"]');
        await page.evaluate('window.firstBatch.finishEdit()');
        await until(`!document.querySelector('.open-question-answer')`);
        if (width === 375 && theme === 'dark' && lang === 'en') {
          await click('.open-question-ask-action');
          await page.send('Input.insertText', { text: 'What about tablets?' });
          await page.evaluate(`document.querySelector('.open-question-ask button[type="submit"]').scrollIntoView({ block: 'nearest', behavior: 'instant' })`);
          await delay(100);
          await page.evaluate('window.firstBatch.holdEdit()');
          await pointerSubmit('.open-question-ask button[type="submit"]');
          await until(`document.querySelector('.open-question-ask button[type="submit"]')?.disabled`);
          await frames('ask-en-dark-375', '.open-question-ask button[type="submit"]');
          await page.evaluate('window.firstBatch.finishEdit()');
          await until(`!document.querySelector('.open-question-ask')`);
        }
        if (phase === 'after' && width === 375) {
          await render({ kind: 'doc', people: 1, theme, lang, markdown: '## Open questions\n\n- Which FPS?' });
          await click('.card-preview-open-questions');
          await click('.open-question-answer-action');
          await delay(500);
          await capture(`answer-${lang}-${theme}-${width}-single-author`);
        }
      }
    } finally { await page.send('Emulation.clearDeviceMetricsOverride'); }
  }, 60000);

  it('explains when no decision author is available and cancels from the form', async () => {
    await render({ kind: 'doc', people: 0, markdown: '## Open questions\n\n- [ ] First question' });
    await click('.card-preview-open-questions');
    await click('.open-question-answer-action');
    expect(await page.evaluate(`document.querySelector('.open-question-author').textContent`)).toContain('no person');
    expect(await page.evaluate(`document.querySelector('.open-question-answer-footer button:last-child').disabled`)).toBe(true);
    await key('Escape');
    expect(await page.evaluate(`document.activeElement === document.querySelector('.open-question-answer-action')`)).toBe(true);
  });

  it('allows the questions panel while editing, but prevents question writes', async () => {
    await render({ kind: 'doc', markdown: '## Open questions\n\n- [ ] First question' });
    await click('.card-content-edit-action');
    await click('.card-preview-open-questions');
    expect(await page.evaluate(`document.querySelector('.open-question-answer-action').disabled`)).toBe(true);
    await key('Escape');
    await click('.card-edit-link.is-cancel');
  });

  it.each([345, 375, 1280])('shows and operates the question system at %ipx in both themes', async width => {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    const target = shortReference('c', 'card:rules');
    const questionRef = shortReference('c', 'card:preview');
    const saveShot = async (name: string) => {
      if (!process.env.DECKMATE_QUESTION_SHOTS) return;
      await delay(180);
      await mkdir(process.env.DECKMATE_QUESTION_SHOTS, { recursive: true });
      const screenshot = await page.send('Page.captureScreenshot', { format: 'png' });
      await writeFile(path.join(process.env.DECKMATE_QUESTION_SHOTS, `${name}-${width}.png`), Buffer.from(screenshot.result.data, 'base64'));
    };
    try {
      for (const theme of ['light', 'dark']) {
        await render({ kind: 'task', lang: 'ru', theme, pool: true, agents: true,
          questions: [{ text: 'Как управлять камерой?', taskRef: null, assignee: 'build-agent', target: target + '#Камера' }],
          decisions: [{ index: 0, question: 'Какой темп?', answer: 'Спокойный темп.', by: 'Майя', date: '2026-11-12', target: null, applied: null },
            { index: 1, question: 'Как двигаться?', answer: 'Свободно.', by: 'Ли', date: '2026-11-11', target: target + '#Камера', applied: '2026-11-12' }] });
        expect(await page.evaluate(`document.querySelectorAll('.decision-pool li').length`)).toBe(1);
        expect(await page.evaluate(`Boolean(document.querySelector('.deck-card-pending-dot') && document.querySelector('.deck-card-face .card-questions-metric'))`)).toBe(true);
        expect(await page.evaluate(`document.querySelector('.card-preview-blocker-note').textContent`)).toBe('Ждёт ответа: @Build Agent');
        expect(await page.evaluate(`document.querySelector('.card-preview-open-questions').getAttribute('aria-label')`)).toBe('Вопросы и решения · открытых: 1 · к внесению: 1');
        expect(await page.evaluate(`document.querySelector('.card-preview-pending-count').textContent`)).toBe('1');
        expect(await page.evaluate(`document.querySelector('.decision-pool').textContent`)).toContain('Спокойный темп.');
        await saveShot('pool-' + theme);
        await click('.card-preview-open-questions');
        expect(await page.evaluate(`document.querySelector('.open-question-assignee').textContent`)).toBe('@Build Agent');
        expect(await page.evaluate(`document.querySelector('.open-question-target').textContent`)).toBe('Внести в: Правила боя § Камера');
        expect(await page.evaluate(`Boolean(document.querySelector('.open-question-assignee .card-owner-avatar.is-agent'))`)).toBe(true);
        expect(await page.evaluate(`Boolean(document.querySelector('.card-preview-question-waiting .lucide-hourglass'))`)).toBe(true);
        expect(await page.evaluate(`Boolean(document.querySelector('.decision-status.is-pending .lucide-circle-dashed') && document.querySelector('.decision-applied .lucide-circle-check'))`)).toBe(true);
        expect(await page.evaluate(`document.querySelector('.decision-status.is-pending').textContent`)).toBe('к внесению');
        expect(await page.evaluate(`document.querySelector('.pending-hint').textContent`)).toContain('Агент автоматически не запускается');
        expect(await page.evaluate(`document.querySelector('.resolved-item:last-child .resolved-attribution').textContent`)).toContain('Внесено: 2026-11-12');
        expect(await page.evaluate(`document.querySelector('.decision-applied').getAttribute('href')`)).toBe(`/r/${target}?source=sandbox#%D0%9A%D0%B0%D0%BC%D0%B5%D1%80%D0%B0`);
        expect(await page.evaluate(`document.querySelectorAll('.open-question-actions button').length`)).toBe(2);
        expect(await page.evaluate(`document.documentElement.scrollWidth <= innerWidth`)).toBe(true);
        await saveShot('questions-' + theme);
        await page.evaluate(`Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.questionCopied = value; } } })`);
        await click('.open-question-discuss-action');
        expect(await page.evaluate('window.questionCopied')).toBe(questionRef + '#1');
        expect(await page.evaluate(`document.querySelector('.open-questions [aria-live="polite"]').textContent`)).toBe('ID вопроса скопирован. Вставьте его в чат.');
        expect(await page.evaluate(`Boolean(document.querySelector('.open-question-feedback'))`)).toBe(true);
        await click('.open-question-ask-action');
        await until(`Boolean(document.querySelector('.open-question-ask textarea'))`);
        expect(await page.evaluate(`document.querySelector('.open-question-ask input[aria-describedby]').parentElement.textContent`)).toContain('working-notes');
        expect(await page.evaluate(`document.querySelectorAll('.open-question-ask button').length`)).toBe(2);
        await saveShot('ask-' + theme);
        await key('Escape');
        await click('.open-question-answer-action');
        await saveShot('answer-' + theme);
        await key('Escape');
        await click('.decision-applied');
        expect(await page.evaluate('window.firstBatch.selections')).toEqual(['card:rules']);
      }
    } finally { await page.send('Emulation.clearDeviceMetricsOverride'); }
  });

  it.each([345, 375])('captures long questions and decision states at %ipx', async width => {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    const reference = shortReference('c', 'card:rules');
    const longText = 'LongUnbrokenQuestion' + 'abcdefghij'.repeat(10);
    const longLink = 'https://example.com/' + 'abcdefghij'.repeat(10);
    const saveShot = async (name: string) => {
      if (!process.env.DECKMATE_QUESTION_SHOTS) return;
      await delay(120);
      await mkdir(process.env.DECKMATE_QUESTION_SHOTS, { recursive: true });
      const screenshot = await page.send('Page.captureScreenshot', { format: 'png' });
      await writeFile(path.join(process.env.DECKMATE_QUESTION_SHOTS, `${name}-${width}.png`), Buffer.from(screenshot.result.data, 'base64'));
    };
    try {
      for (const lang of ['en', 'ru']) for (const theme of ['light', 'dark']) {
        await render({ kind: 'task', lang, theme, pool: true, agents: true,
          markdown: `## Open questions\n\n- ${longText} [${longLink}](${longLink})\n- Camera?\n`,
          questions: [{ text: longText, taskRef: null, assignee: null }, { text: 'Camera?', taskRef: null, assignee: 'build-agent', target: reference + '#Камера' }],
          decisions: [{ index: 0, question: 'Pace?', answer: `A decision: [${longLink}](${longLink})`, by: 'Maya', date: '2026-11-12', target: null, applied: null },
            { index: 1, question: 'Movement?', answer: 'Free movement.', by: 'Lee', date: '2026-11-11', target: reference + '#Камера', applied: '2026-11-12' }] });
        await click('.card-preview-open-questions');
        expect(await page.evaluate(`document.querySelector('.open-question:first-child .open-question-meta')`)).toBe(null);
        expect(await page.evaluate(`document.querySelector('.open-question:nth-child(2) .open-question-target').textContent`)).toBe(lang === 'ru' ? 'Внести в: Правила боя § Камера' : 'Apply to: Правила боя § Камера');
        expect(await page.evaluate(`document.querySelector('.resolved-item:last-child .open-question-target').textContent`)).toBe(lang === 'ru' ? 'Внести в: Правила боя § Камера' : 'Apply to: Правила боя § Камера');
        expect(await page.evaluate(`document.querySelector('.resolved-item:first-child .open-question-target')`)).toBe(null);
        expect(await page.evaluate(`(() => {
          const elements = document.querySelectorAll('.open-questions-list, .open-question, .open-question-text, .open-question-text .markdown, .resolved-list, .resolved-item, .resolved-decision .markdown');
          return document.documentElement.scrollWidth <= innerWidth && [...elements].every(element => element.scrollWidth <= element.clientWidth + 1);
        })()`)).toBe(true);
        await saveShot(`long-${lang}-${theme}`);
        await page.evaluate(`Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => {} } })`);
        await click('.open-question-discuss-action');
        expect(await page.evaluate(`(() => {
          const tip = document.querySelector('.open-question-feedback').getBoundingClientRect();
          const button = document.querySelector('.open-question-discuss-action').getBoundingClientRect();
          return tip.left >= 0 && tip.right <= innerWidth && (Math.abs(tip.bottom - button.top) <= 8 || Math.abs(tip.top - button.bottom) <= 8);
        })()`)).toBe(true);
        await saveShot(`copied-${lang}-${theme}`);
        await click('.open-question-answer-action');
        await saveShot(`long-answer-${lang}-${theme}`);
        await key('Escape');
        await page.evaluate(`document.querySelector('.open-questions-resolved').scrollIntoView({ block: 'start', behavior: 'instant' })`);
        await saveShot(`decisions-${lang}-${theme}`);
        await key('Escape');
      }
    } finally { await page.send('Emulation.clearDeviceMetricsOverride'); }
  });

  it('anchors copy feedback to the right question, restarts its timer and preserves clipboard errors', async () => {
    await render({ kind: 'doc', markdown: '## Open questions\n\n- First question\n- Second question' });
    await click('.card-preview-open-questions');
    await page.evaluate(`(() => {
      window.copyWrites = [];
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: value => new Promise((resolve, reject) => window.copyWrites.push({ value, resolve, reject })) } });
    })()`);
    await page.evaluate(`document.querySelector('.open-question-discuss-action').focus()`);
    const spacing = () => page.evaluate(`(() => {
      const first = document.querySelector('.open-question:first-child').getBoundingClientRect();
      return document.querySelector('.open-question:nth-child(2)').getBoundingClientRect().top - first.top;
    })()`);
    const before = await spacing();
    await click('.open-question:first-child .open-question-discuss-action');
    await click('.open-question:nth-child(2) .open-question-discuss-action');
    await page.evaluate('window.copyWrites[1].resolve()');
    await until(`document.querySelector('.open-questions [aria-live="polite"]').textContent === 'Question ID copied. Paste it into a chat.'`);
    await page.evaluate('window.copyWrites[0].resolve()');
    expect(await page.evaluate(`document.querySelector('.open-question:first-child .open-question-discuss-action').hasAttribute('aria-describedby')`)).toBe(false);
    expect(await page.evaluate(`document.querySelector('.open-question:nth-child(2) .open-question-discuss-action').hasAttribute('aria-describedby')`)).toBe(true);
    expect(await spacing()).toBe(before);
    await delay(800);
    await click('.open-question:nth-child(2) .open-question-discuss-action');
    await page.evaluate('window.copyWrites[2].resolve()');
    await delay(800);
    expect(await page.evaluate(`document.querySelector('.open-questions [aria-live="polite"]').textContent`)).toBe('Question ID copied. Paste it into a chat.');
    await until(`!document.querySelector('.open-question-feedback')`);
    await page.evaluate(`document.execCommand = () => false`);
    await click('.open-question:first-child .open-question-discuss-action');
    await page.evaluate(`window.copyWrites[3].reject(new Error('denied'))`);
    await until(`document.querySelector('.open-questions [aria-live="polite"]').textContent.includes('Could not copy')`);
    expect(await page.evaluate(`Boolean(document.querySelector('.open-question-feedback'))`)).toBe(true);
    expect(await page.evaluate(`document.querySelector('.open-question-copy-reference input').value`)).toBe(shortReference('c', 'card:preview') + '#1');
    expect(await spacing()).toBeGreaterThan(before);
    await page.evaluate(`delete document.execCommand`);
  });

  it('copies through the selection fallback when Clipboard API is unavailable or denied', async () => {
    await render({ kind: 'doc', markdown: '## Open questions\n\n- First question' });
    await click('.card-preview-open-questions');
    await page.evaluate(`(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
      document.execCommand = command => { window.fallbackCopies ??= []; window.fallbackCopies.push([command, document.activeElement.value]); return true; };
    })()`);
    try {
      await click('.open-question-discuss-action');
      await until(`document.querySelector('.open-questions [aria-live="polite"]').textContent.includes('Question ID copied')`);
      expect(await page.evaluate('window.fallbackCopies')).toEqual([['copy', shortReference('c', 'card:preview') + '#1']]);
      expect(await page.evaluate(`document.activeElement === document.querySelector('.open-question-discuss-action')`)).toBe(true);
      expect(await page.evaluate(`document.querySelectorAll('textarea[aria-hidden="true"]').length`)).toBe(0);
      await page.evaluate(`Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('denied'); } } })`);
      await click('.open-question-discuss-action');
      expect(await page.evaluate('window.fallbackCopies.length')).toBe(2);
      expect(await page.evaluate(`document.querySelector('.open-question-copy-reference')`)).toBeNull();
    } finally { await page.evaluate(`delete document.execCommand`); }
  });

  it.each(['missing', 'throws'])('keeps editor formatting working when insertText is %s', async mode => {
    await render({ kind: 'task', markdown: 'Format this text.' });
    await click('.card-content-edit-action');
    await until(`Boolean(document.querySelector('.card-edit-text'))`);
    await page.evaluate(`(() => {
      const field = document.querySelector('.card-edit-text');
      const start = field.value.indexOf('Format'); field.focus(); field.setSelectionRange(start, start + 6);
      document.execCommand = ${mode === 'missing' ? 'undefined' : `() => { throw new Error('not supported'); }`};
    })()`);
    try {
      for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key: 'b', code: 'KeyB', windowsVirtualKeyCode: 66, modifiers: 2 });
      await until(`document.querySelector('.card-edit-text').value.includes('**Format**')`);
    } finally { await page.evaluate(`delete document.execCommand`); }
  });

  it('discards late copy feedback when the question disappears', async () => {
    await render({ kind: 'task', questions: [{ text: 'First question', taskRef: null, assignee: null }] });
    await click('.card-preview-open-questions');
    await page.evaluate(`Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => new Promise(resolve => { window.finishQuestionCopy = resolve; }) } })`);
    await click('.open-question-discuss-action');
    await page.evaluate('window.firstBatch.removeQuestion()');
    await until(`!document.querySelector('.open-question-discuss-action')`);
    await page.evaluate('window.finishQuestionCopy()');
    expect(await page.evaluate(`document.querySelector('.open-questions [aria-live="polite"]').textContent`)).toBe('');
    expect(await page.evaluate(`Boolean(document.querySelector('.open-question-feedback'))`)).toBe(false);
  });

  it('wraps long targets and assignees and guards target navigation while answering', async () => {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 345, height: 900, deviceScaleFactor: 1, mobile: false });
    try {
      const reference = shortReference('c', 'card:rules');
      const section = 'Camera' + 'abcdefghij'.repeat(20);
      const assignee = 'agent' + 'abcdefghij'.repeat(20);
      await render({ kind: 'task', pool: true, lang: 'ru',
        questions: [{ text: 'Camera?', taskRef: null, assignee, target: reference + '#' + section },
          { text: 'Same card?', taskRef: null, assignee: null, target: shortReference('c', 'card:preview') + '#Section' }],
        decisions: [{ index: 0, question: null, answer: 'Done', by: null, date: null, target: null, applied: '2026-11-12' }] });
      await click('.card-preview-open-questions');
      expect(await page.evaluate(`document.querySelector('.open-question:nth-child(2) .open-question-meta')`)).toBe(null);
      expect(await page.evaluate(`document.querySelector('.resolved-item .open-question-target')`)).toBe(null);
      expect(await page.evaluate(`document.querySelector('.resolved-item .decision-status').tagName`)).toBe('SPAN');
      expect(await page.evaluate(`(() => {
        const elements = document.querySelectorAll('.open-questions-list, .open-question-meta, .open-question-assignee, .open-question-target');
        return document.documentElement.scrollWidth <= innerWidth && [...elements].every(element => element.scrollWidth <= element.clientWidth + 1);
      })()`)).toBe(true);
      await click('.open-question-answer-action');
      await click('.open-question-target');
      expect(await page.evaluate('window.firstBatch.selections')).toEqual([]);
      expect(await page.evaluate(`document.querySelector('.open-question-target').getAttribute('aria-disabled')`)).toBe('true');
      expect(await page.evaluate(`document.querySelector('.open-question-target').tabIndex`)).toBe(-1);
      await page.evaluate(`document.querySelector('.open-question-answer textarea').focus()`);
      await key('Escape');
      await click('.open-question-target');
      expect(await page.evaluate('window.firstBatch.selections')).toEqual(['card:rules']);
    } finally { await page.send('Emulation.clearDeviceMetricsOverride'); }
  });

  it('wraps long decisions and target names inside the decision pool', async () => {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 345, height: 900, deviceScaleFactor: 1, mobile: false });
    try {
      const section = 'Camera' + 'abcdefghij'.repeat(30);
      await render({ kind: 'task', pool: true, decisions: [{ index: 0, question: null, answer: 'https://example.com/' + 'abcdefghij'.repeat(30), by: null, date: null,
        target: shortReference('c', 'card:rules') + '#' + section, applied: null }] });
      expect(await page.evaluate(`document.querySelector('.decision-pool-meta').textContent`)).toContain('Apply to: Правила боя § ' + section);
      expect(await page.evaluate(`(() => {
        const elements = document.querySelectorAll('.decision-pool, .decision-pool ul, .decision-pool li, .decision-pool li button, .decision-pool li span, .decision-pool li small');
        return document.documentElement.scrollWidth <= innerWidth && [...elements].every(element => element.scrollWidth <= element.clientWidth + 1);
      })()`)).toBe(true);
    } finally { await page.send('Emulation.clearDeviceMetricsOverride'); }
  });

  it('shows copy feedback without animation for reduced motion', async () => {
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    try {
      await render({ kind: 'doc', markdown: '## Open questions\n\n- First question' });
      await click('.card-preview-open-questions');
      await page.evaluate(`Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => {} } })`);
      await click('.open-question-discuss-action');
      expect(await page.evaluate(`getComputedStyle(document.querySelector('.open-question-feedback')).animationName`)).toBe('none');
      expect(await page.evaluate(`document.querySelector('.open-questions [aria-live="polite"]').textContent`)).toBe('Question ID copied. Paste it into a chat.');
    } finally { await page.send('Emulation.setEmulatedMedia', { features: [] }); }
  });

  it('asks an agent about a searched target, preserves the draft on conflict and uses the captured source hash', async () => {
    await render({ kind: 'task', pool: true, agents: true, lang: 'ru', decisions: [], questions: [] });
    await click('.card-preview-open-questions');
    await click('.open-question-ask-action');
    await page.send('Input.insertText', { text: 'Как изменить камеру?' });
    await page.evaluate(`(() => {
      const form = document.querySelector('.open-question-ask');
      const member = form.querySelector('select'); member.value = 'build-agent'; member.dispatchEvent(new Event('change', { bubbles: true }));
      const search = form.querySelector('input[type="search"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(search, 'Правила'); search.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await page.evaluate(`(() => { const selects = document.querySelectorAll('.open-question-ask select'); selects[1].value = 'card:rules'; selects[1].dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await page.evaluate(`(() => { const input = document.querySelector('.open-question-ask input:not([type="search"])'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Камера'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await page.evaluate(`window.firstBatch.failEdit('conflict')`);
    await click('.open-question-ask button[type="submit"]');
    await until(`Boolean(document.querySelector('.open-question-ask [role="alert"]'))`);
    expect(await page.evaluate(`document.querySelector('.open-question-ask textarea').value`)).toBe('Как изменить камеру?');
    expect(await page.evaluate('window.firstBatch.requests[0]')).toMatchObject({ action: 'ask-question', cardId: 'card:preview', sourceHash: 'card-hash', text: 'Как изменить камеру?', assignee: 'build-agent', target: shortReference('c', 'card:rules') + '#%D0%9A%D0%B0%D0%BC%D0%B5%D1%80%D0%B0' });
    await page.evaluate(`window.firstBatch.failEdit(null)`);
    await click('.open-question-ask button:last-child');
    await click('.open-question-ask button[type="submit"]');
    await until(`!document.querySelector('.open-question-ask')`);
    expect(await page.evaluate('window.firstBatch.requests[1].sourceHash')).toBe('card-hash-refreshed');
  });

  it('keeps an answer visible and prevents a stale write when the question disappears', async () => {
    await render({ kind: 'task', lang: 'ru', questions: [{ text: 'Как быть?', taskRef: null, assignee: 'maya' }] });
    await click('.card-preview-open-questions');
    await click('.open-question-answer-action');
    await page.send('Input.insertText', { text: 'Не потерять этот ответ' });
    await page.evaluate('window.firstBatch.removeQuestion()');
    await until(`Boolean(document.querySelector('.open-question-orphan'))`);
    expect(await page.evaluate(`document.querySelector('.open-question-orphan').textContent`)).toContain('Как быть?');
    expect(await page.evaluate(`document.querySelector('.open-question-answer textarea').value`)).toBe('Не потерять этот ответ');
    expect(await page.evaluate(`document.querySelector('.open-question-answer [role="alert"]').textContent`)).toContain('Вопрос изменился');
    expect(await page.evaluate(`document.querySelector('.open-question-answer-buttons button:last-child').disabled`)).toBe(true);
    expect(await page.evaluate('window.firstBatch.requests')).toEqual([]);
    await key('Escape');
    expect(await page.evaluate(`document.activeElement === document.querySelector('.open-question-ask-action')`)).toBe(true);
  });

  it.each(['target', 'assignee', 'position'])('does not rebind an answer when the question identity changes: %s', async identity => {
    const first = { text: 'Как быть?', taskRef: null, assignee: 'maya', target: shortReference('c', 'card:rules') + '#first' };
    const second = { ...first, ...(identity === 'assignee' ? { assignee: 'lee' } : { target: shortReference('c', 'card:rules') + '#second' }) };
    await render({ kind: 'task', lang: 'ru', questions: [first, second] });
    await click('.card-preview-open-questions');
    await click(`.open-question:nth-child(${identity === 'position' ? 2 : 1}) .open-question-answer-action`);
    await page.send('Input.insertText', { text: 'Ответ только на исходный вопрос' });
    await page.callFunction('questions => window.firstBatch.updateQuestions(questions)', [second]);
    await until(`Boolean(document.querySelector('.open-question-answer [role="alert"]'))`);
    await click('.open-question-answer-buttons button:last-child');
    await page.evaluate(`document.querySelector('.open-question-answer').requestSubmit()`);
    expect(await page.evaluate('window.firstBatch.requests')).toEqual([]);
    expect(await page.evaluate(`document.querySelector('.open-question-orphan textarea')?.value`)).toBe('Ответ только на исходный вопрос');
    expect(await page.evaluate(`document.querySelector('.open-question-answer [role="alert"]').textContent`)).toContain('Вопрос изменился');
    expect(await page.evaluate(`document.querySelector('.open-question-answer-buttons button:last-child').disabled`)).toBe(true);
  });

  it('refreshes an answer source hash only when the question identity stays the same', async () => {
    const question = { text: 'Как быть?', taskRef: null, assignee: 'maya', target: shortReference('c', 'card:rules') + '#first' };
    await render({ kind: 'task', lang: 'ru', questions: [question] });
    await click('.card-preview-open-questions');
    await click('.open-question-answer-action');
    await page.send('Input.insertText', { text: 'Сохранить этот ответ' });
    await page.callFunction('questions => window.firstBatch.updateQuestions(questions)', [question]);
    await until(`Boolean(document.querySelector('.open-question-answer [role="alert"]'))`);
    await click('.open-question-answer-buttons button:last-child');
    await click('.open-question-answer button[type="submit"]');
    expect(await page.evaluate('window.firstBatch.requests')).toEqual([{ action: 'record-decision', cardId: 'card:preview', sourceHash: 'card-hash-refreshed',
      questionIndex: 0, questionText: question.text, answer: 'Сохранить этот ответ', memberId: 'maya' }]);
  });

  it('saves title-only textarea edits without normalizing the body bytes', async () => {
    const markdown = '\r\n\r\n  Body\r\n\r\n';
    await render({ title: 'Before', markdown });
    await click('.card-content-edit-action');
    await page.evaluate(`document.querySelector('.card-edit-text').setSelectionRange(0, 6)`);
    await page.send('Input.insertText', { text: 'After' });
    expect(await page.evaluate(`document.querySelector('.card-preview-dock .card-edit-save') !== null`)).toBe(true);
    await click('.card-edit-save');
    await until(`window.firstBatch.requests.length === 1`);
    expect(await page.evaluate('window.firstBatch.requests[0]')).toMatchObject({ title: 'After', markdown, sourceHash: 'content-' + markdown });
  });

  it.each(['hero', 'task', 'doc'])('keeps a %s editor and its only Save in the phone viewport', async kind => {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 900, deviceScaleFactor: 1, mobile: false });
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    try {
      await render({ kind, lang: 'ru' });
      expect(await page.evaluate(`document.querySelector('.card-preview-document').getBoundingClientRect().top`)).toBeLessThanOrEqual(300);
      await click('.card-content-edit-action');
      const geometry = await page.evaluate(`(() => {
        const editor = document.querySelector('.card-edit-text').getBoundingClientRect();
        const save = document.querySelector('.card-edit-save').getBoundingClientRect();
        return { top: editor.top, height: editor.height, saveBottom: save.bottom, saves: document.querySelectorAll('.card-edit-save').length,
          gapToDock: document.querySelector('.card-preview-dock').getBoundingClientRect().top - document.querySelector('.card-edit-box').getBoundingClientRect().bottom,
          panelsScroll: document.querySelector('.card-preview-panels').scrollHeight - document.querySelector('.card-preview-panels').clientHeight };
      })()`);
      expect(geometry.top).toBeLessThanOrEqual(300);
      expect(geometry.height).toBeGreaterThanOrEqual(360);
      expect(geometry.saveBottom).toBeLessThanOrEqual(900);
      expect(geometry.saves).toBe(1);
      expect(geometry.gapToDock).toBeLessThanOrEqual(16);
      expect(geometry.panelsScroll).toBeLessThanOrEqual(1);
    } finally {
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: false });
      await page.send('Emulation.clearDeviceMetricsOverride');
    }
  });

  it.each([{ markdown: '', lang: 'ru', expected: '0 слов' }, { markdown: 'one', lang: 'en', expected: '1 word' }, { markdown: 'один два', lang: 'ru', expected: '2 слова' }])('shows a localized word-count unit: %j', async ({ expected, ...options }) => {
    await render({ ...options, title: '', kind: 'doc' });
    await click('.card-preview-more');
    expect(await page.evaluate(`document.querySelector('.card-more-menu .card-more-help').textContent`)).toBe(expected);
    await key('Escape');
  });

  it('opens dependencies and history directly for a read-only card without a family', async () => {
    await render({ writable: false });
    await click('.card-preview-action-rail button[aria-controls$="-dependencies"]');
    expect(await page.evaluate(`Boolean(document.querySelector('.card-related-slot .card-dependencies'))`)).toBe(true);
    await click('.card-preview-action-rail button:last-child');
    await until(`Boolean(document.querySelector('.card-related-slot .card-history-event'))`);
    expect(await page.evaluate('window.firstBatch.requests')).toEqual([]);
  });

  // 2026-11-10: the card's sections open as one full-height column beside its icon rail,
  // over whatever lies beside the card, while the card itself stays live; Escape returns focus to the rail button.
  it('opens a panel as a column right against the rail, keeps the card live and returns focus to its rail button', async () => {
    await render({ dependencies: true });
    const opener = '.card-preview-action-rail button[aria-controls$="-dependencies"]';
    const column = () => page.evaluate(`(() => {
      const slot = document.querySelector('.card-related-slot'), sheet = document.querySelector('.card-preview-sheet');
      const rail = document.querySelector('.card-preview-action-rail').getBoundingClientRect();
      if (!slot) return { open: false, cardInert: sheet.inert };
      const box = slot.getBoundingClientRect(), layout = document.querySelector('.card-preview-layout').getBoundingClientRect(), style = getComputedStyle(slot);
      // 2026-11-10: the column keeps the rail's 12px gap, the same as the sheet on the rail's other side.
      return { open: true, besideRail: Math.round(box.left - rail.right) === 12, fromTop: Math.round(box.top - layout.top),
        cardInert: sheet.inert, focusInside: slot.contains(document.activeElement), frame: [style.position, style.borderTopLeftRadius, style.borderLeftStyle], width: Math.round(box.width) };
    })()`);
    await click(opener);
    await until(`Boolean(document.querySelector('.card-related-slot .card-dependencies'))`);
    // The column appears without motion; this also waits out any running animation before measuring.
    await until(`document.querySelector('.card-related-slot').getAnimations().every(animation => animation.playState === 'finished')`);
    expect(await column()).toEqual({ open: true, besideRail: true, fromTop: -8, cardInert: false, focusInside: true, frame: ['absolute', '4px', 'solid'], width: 379 });
    await key('Escape');
    await until(`!document.querySelector('.card-related-slot')`);
    expect(await column()).toEqual({ open: false, cardInert: false });
    expect(await page.evaluate(`document.activeElement === document.querySelector('${opener}')`)).toBe(true);
  });

  it('names the attempted action and uses grammatical Russian in the dependency warning', async () => {
    await render({ dependencies: true, lang: 'ru', state: 'not-started' });
    await click('.card-preview-state-actions button:first-of-type');
    expect(await page.evaluate(`document.querySelector('.dependency-warning-title').textContent`)).toBe('Не завершены зависимости: 1. Начать работу всё равно?');
    expect(await page.evaluate(`document.querySelector('.dependency-warning-actions button:last-child').textContent`)).toBe('Начать работу всё равно');
    expect(await page.evaluate('window.firstBatch.requests')).toEqual([]);
  });
});
