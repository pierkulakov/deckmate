import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openHeadlessBrowser, type HeadlessPage } from '../tools/layout-capture.ts';
import { browserFixtureUrl } from './browser-fixture.ts';
import { requireBrowser } from './browser-environment.ts';

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
    const virtualKey = { Escape: 27, Enter: 13, Tab: 9, Space: 32, KeyW: 87 }[code];
    for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: virtualKey });
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
  }, 90000);
  afterAll(async () => { await page?.close(); }, 20000);

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
        const buttons = [...row.querySelectorAll('button')];
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

  it('bounds 20 tags, opens the existing full section and restores keyboard focus', async () => {
    await render({ tags: 20 });
    expect(await page.evaluate(`document.querySelectorAll('.card-preview-tags .tag-badge-link').length`)).toBe(2);
    expect(await page.evaluate(`document.querySelector('.card-preview-tags > button').textContent`)).toBe('+18');
    expect(await page.evaluate(`document.querySelector('.card-preview-tags').getBoundingClientRect().height`)).toBeLessThanOrEqual(40);
    await click('.card-preview-tags > button');
    expect(await page.evaluate(`document.querySelectorAll('.card-properties-tag-chip').length`)).toBe(20);
    expect(await page.evaluate(`document.activeElement.classList.contains('card-properties-tag-chip')`)).toBe(true);
    await key('Escape');
    expect(await page.evaluate(`document.activeElement === document.querySelector('.card-preview-tags > button')`)).toBe(true);
    expect(await page.evaluate('window.firstBatch.outerEscapes()')).toBe(0);
    await render();
    expect(await page.evaluate(`document.querySelector('.card-preview-tags')`)).toBe(null);
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
          mono: getComputedStyle(document.querySelector('.card-preview-word-count .page-number')).fontFamily };
      })()`);
      expect(layout.rail).toBe(32);
      expect(layout.railRadius).toBe('2px');
      expect(layout.close).toBe('Закрыть карточку');
      expect(layout.title).toBeGreaterThanOrEqual(layout.reading - 33);
      expect(layout.editHeight).toBe(30);
      expect(layout.editRadius).toBe('2px');
      expect(layout.overflow).toBe(false);
      expect(layout.mono).toContain('Geist Mono');
    } finally {
      await page.send('Emulation.clearDeviceMetricsOverride');
    }
  });

  it('exposes Sub Card state and full title to readers and keyboard tooltips', async () => {
    await render({ family: true, kind: 'hero', lang: 'ru' });
    expect(await page.evaluate(`document.querySelector('.card-family-row-state').textContent`)).toBe('В работе');
    expect(await page.evaluate(`document.querySelector('.card-family-row-open').getAttribute('aria-label')`)).toContain('Полное название Sub Card '.repeat(20));
    // 2026-11-10: reveal the fixture's separate family before focusing it; Radix closes hints on ancestor scrolls.
    await key('Tab');
    await page.evaluate(`document.querySelector('.card-family-row-open').scrollIntoView({ block: 'center', behavior: 'instant' })`);
    await delay(60);
    const focus = await page.evaluate(`(() => {
      const button = document.querySelector('.card-family-row-open'), title = button.querySelector('strong');
      button.focus({ preventScroll: true });
      return { focused: document.activeElement === button, disabled: button.disabled,
        clipped: title.scrollHeight > title.clientHeight + 1 || title.scrollWidth > title.clientWidth + 1 };
    })()`);
    expect(focus).toMatchObject({ focused: true, disabled: false, clipped: true });
    // Read the tooltip in the same poll that finds it: a later evaluate could race its close.
    await until(`Boolean(document.querySelector('[role="tooltip"]')?.textContent.includes('Полное название Sub Card'))`);
    expect(page.consoleErrors).toEqual([]);
  });

  // 2026-11-10: actions must not scroll away with the file, and indicators must fit without consuming excessive space.
  // The dock (indicators, tags, save state, ID, Edit; a Journey step when there is one) is pinned above the band and opaque,
  // outside the scroller.
  it('pins the dock with indicators, tags, ID and Edit above the band while long text scrolls', async () => {
    const markdown = Array.from({ length: 60 }, (_, index) => `Paragraph ${index + 1} keeps the card text going past the window.`).join(String.fromCharCode(10).repeat(2));
    await render({ markdown, tags: 1, dependencies: true });
    const measure = () => page.evaluate(`(() => {
      const box = selector => document.querySelector(selector)?.getBoundingClientRect();
      const shown = selector => { const r = box(selector); return Boolean(r && r.height > 0 && r.top >= 0 && r.bottom <= innerHeight); };
      const scroller = document.querySelector('.card-preview-panels');
      return { scrollable: scroller.scrollHeight - scroller.clientHeight,
        dockTop: Math.round(box('.card-preview-dock').top), gapToBand: Math.round(box('.card-preview-material-band').top - box('.card-preview-dock').bottom),
        shown: ['.card-preview-dock .card-gate-indicator', '.card-preview-dock .tag-badge-link',
          '.card-preview-dock .card-id-chip', '.card-preview-dock .card-content-edit-action', '.card-preview-dock .card-content-save-status'].map(shown),
        inScroller: ['.card-content-edit-action', '.card-id-chip', '.card-content-save-status'].map(selector => scroller.contains(document.querySelector(selector))),
        row: Math.round(box('.card-preview-dock-row').height), indicators: Math.round(box('.card-preview-meta-row .card-indicators').height),
        dockOpaque: getComputedStyle(document.querySelector('.card-preview-dock')).backgroundColor !== 'rgba(0, 0, 0, 0)' };
    })()`);
    const top = await measure();
    expect(top.scrollable).toBeGreaterThan(400);
    expect(top.shown).toEqual([true, true, true, true, true]);
    expect(top.inScroller).toEqual([false, false, false]);
    expect(top.gapToBand).toBe(0);
    expect(top.row).toBeLessThanOrEqual(32);
    expect(top.indicators).toBeLessThanOrEqual(24);
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
  });

  it.each([{ markdown: '', lang: 'ru', expected: '0 слов' }, { markdown: 'one', lang: 'en', expected: '1 word' }, { markdown: 'один два', lang: 'ru', expected: '2 слова' }])('shows a localized word-count unit: %j', async ({ expected, ...options }) => {
    await render({ ...options, title: '', kind: 'doc' });
    expect(await page.evaluate(`document.querySelector('.card-preview-word-count').textContent`)).toBe(expected);
  });

  it('opens dependencies and history directly for a read-only card without a family', async () => {
    await render({ writable: false });
    await click('.card-preview-action-rail button:nth-last-child(2)');
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
    expect(await column()).toEqual({ open: true, besideRail: true, fromTop: -8, cardInert: false, focusInside: true, frame: ['absolute', '0px', 'solid'], width: 379 });
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
