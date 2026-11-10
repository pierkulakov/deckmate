import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openHeadlessBrowser, type HeadlessPage } from '../tools/layout-capture.ts';
import { browserFixtureUrl } from './browser-fixture.ts';
import { requireBrowser } from './browser-environment.ts';

const browserPath = requireBrowser();
describe.skipIf(!browserPath)('card preview loading (real browser)', () => {
  let page: HeadlessPage;
  async function until(expression: string) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (await page.evaluate(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error(expression + '\n' + page.consoleErrors.join('\n'));
  }
  async function open() {
    await page.send('Page.navigate', { url: browserFixtureUrl('card-preview-loading') });
    await until('Boolean(window.loadingTest)');
    await page.evaluate('localStorage.clear()');
    await until(`document.querySelector('.card-preview-title')?.textContent === 'File First'`);
  }
  const click = (selector: string) => page.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  beforeAll(async () => {
    page = await openHeadlessBrowser({ width: 1280, height: 900, scale: 1 });
    await page.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  }, 90000);
  afterAll(async () => { await page?.close(); }, 20000);

  function measureSwitches(forward: string, backward: string) {
    return page.evaluate(`new Promise(resolve => {
      const frames = [], start = performance.now();
      let switched = false, returned = false;
      function sample(now) {
        const footer = document.querySelector('.card-content-reading-footer');
        const edit = footer?.querySelector('.card-content-edit-action');
        const status = footer?.querySelector('.card-content-save-status');
        const box = footer?.getBoundingClientRect();
        frames.push({ at: now - start, loading: [...document.querySelectorAll('[role="status"]')].some(node => node.textContent.includes('Loading content')),
          disabled: !edit || edit.disabled, dim: edit ? Number(getComputedStyle(edit).opacity) : 0,
          calm: Boolean(status?.classList.contains('is-calm')), height: box?.height, top: box?.top });
        if (!switched && now - start > 50) { switched = true; ${forward} }
        if (!returned && now - start > 450) { returned = true; ${backward} }
        if (now - start < 850) requestAnimationFrame(sample);
        else resolve({ frames: frames.length, loading: frames.filter(frame => frame.loading).length,
          disabled: frames.filter(frame => frame.disabled).length, dim: frames.filter(frame => frame.dim < 1).length,
          notCalm: frames.filter(frame => !frame.calm).length,
          heightShift: Math.max(...frames.map(frame => frame.height)) - Math.min(...frames.map(frame => frame.height)),
          topShift: Math.max(...frames.map(frame => frame.top)) - Math.min(...frames.map(frame => frame.top)) });
      }
      requestAnimationFrame(sample);
    })`);
  }
  function expectCalm(measurements: Awaited<ReturnType<typeof measureSwitches>>) {
    console.log('card-preview-loading RAF:', JSON.stringify(measurements));
    expect(measurements.frames).toBeGreaterThan(10);
    expect(measurements).toMatchObject({ loading: 0, disabled: 0, dim: 0, notCalm: 0, heightShift: 0, topShift: 0 });
  }
  it('keeps every animation frame calm and Edit enabled on normal card switches', async () => {
    await open();
    expectCalm(await measureSwitches('window.loadingTest.select(1);', 'window.loadingTest.select(0);'));
  });

  it.each(['deck', 'all', 'hand'])('keeps click, arrow and next/previous navigation calm in %s', async context => {
    await page.send('Page.navigate', { url: browserFixtureUrl('card-preview-loading') + '?context=' + context });
    await until(`Boolean(document.querySelector('.deck-card-open'))`);
    await click('.deck-card-open');
    await until(`document.querySelector('.card-preview-title')?.textContent === 'File First'`);
    const first = `.catalog-results [data-card-id="card:loading-0"] .deck-card-open`;
    const second = `.catalog-results [data-card-id="card:loading-1"] .deck-card-open`;
    const press = (key: string, code: string) => `window.dispatchEvent(new KeyboardEvent('keydown', { key: '${key}', code: '${code}', bubbles: true }));`;
    expectCalm(await measureSwitches(`document.querySelector('${second}').click();`, `document.querySelector('${first}').click();`));
    expectCalm(await measureSwitches(press('j', 'KeyJ'), press('k', 'KeyK')));
    const arrow = (from: string, to: string) => `{
      const from = document.querySelector('${from}'), to = document.querySelector('${to}');
      const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
      let key = b.top > a.top ? 'ArrowDown' : 'ArrowUp';
      if (Math.abs(b.left - a.left) > Math.abs(b.top - a.top)) key = b.left > a.left ? 'ArrowRight' : 'ArrowLeft';
      from.focus(); from.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true }));
    }`;
    expectCalm(await measureSwitches(arrow(first, second), arrow(second, first)));
    expect(await page.evaluate('window.loadingTest.requests.length')).toBe(7);
    expect(page.consoleErrors).toEqual([]);
  });

  it.each(['300ms', '0.45s'])('delays visible and spoken busy state by %s and queues Edit with the file baseline', async token => {
    await open();
    await page.callFunction('function(token) { document.documentElement.style.setProperty("--busy-dim-delay", token); }', token);
    const measurement = await page.evaluate(`new Promise(resolve => {
      const start = performance.now();
      let firstBusy = null, clickedAt = null, disabled = 0, switched = false;
      window.loadingTest.delay = 750;
      function sample() {
        const edit = document.querySelector('.card-content-edit-action');
        const busy = [...document.querySelectorAll('[role="status"]')].some(node => node.textContent.includes('Loading content'));
        if (busy && firstBusy === null) firstBusy = performance.now() - window.loadingTest.startedAt;
        if (edit?.disabled) disabled++;
        if (!switched) { switched = true; window.loadingTest.select(1); }
        if (clickedAt === null && window.loadingTest.requests.length === 2 && edit) {
          clickedAt = performance.now() - window.loadingTest.startedAt;
          edit.click();
        }
        const editor = document.querySelector('.card-edit-text');
        if (editor || performance.now() - start > 3000) resolve({ firstBusy, clickedAt, disabled, value: editor?.value,
          openedAt: performance.now() - window.loadingTest.startedAt, fileArrivedAt: window.loadingTest.finishedAt - window.loadingTest.startedAt });
        else requestAnimationFrame(sample);
      }
      requestAnimationFrame(sample);
    })`);
    console.log('card-preview-loading slow RAF:', token, JSON.stringify(measurement));
    const threshold = token === '300ms' ? 300 : 450;
    expect(measurement.firstBusy).toBeGreaterThanOrEqual(threshold - 2);
    expect(measurement.firstBusy).toBeLessThan(700);
    expect(measurement.clickedAt).toBeLessThan(300);
    expect(measurement.disabled).toBe(0);
    expect(measurement.openedAt).toBeGreaterThanOrEqual(measurement.fileArrivedAt);
    expect(measurement.value).toBe('File Second\n\nFile body Second\n');
    await page.send('Input.insertText', { text: 'Edited ' });
    await click('.card-edit-save');
    await until('window.loadingTest.saves.length === 1');
    expect(await page.evaluate('window.loadingTest.saves[0]')).toMatchObject({ action: 'update-card-content', cardId: 'card:loading-1',
      title: 'Edited File Second', markdown: 'File body Second\n', sourceHash: 'index-1-0', manifestHash: 'manifest' });
  });

  it('cancels queued Edit on navigation and ignores the abandoned response', async () => {
    await open();
    await page.evaluate('window.loadingTest.delay = 700; window.loadingTest.select(1)');
    await until('window.loadingTest.requests.length === 2');
    await click('.card-content-edit-action');
    await page.evaluate('window.loadingTest.delay = 50; window.loadingTest.select(0)');
    await until(`document.querySelector('.card-preview-title')?.textContent === 'File First'`);
    await new Promise(resolve => setTimeout(resolve, 800));
    expect(await page.evaluate(`document.querySelector('.card-edit-text')`)).toBe(null);
    expect(await page.evaluate(`document.querySelector('.card-preview-title').textContent`)).toBe('File First');
  });

  it('keeps queued Edit through a watcher revision and uses the refreshed file hash', async () => {
    await open();
    await page.evaluate('window.loadingTest.delay = 550; window.loadingTest.select(1)');
    await until('window.loadingTest.requests.length === 2');
    await click('.card-content-edit-action');
    await page.evaluate('window.loadingTest.refresh()');
    await until(`Boolean(document.querySelector('.card-edit-text'))`);
    expect(await page.evaluate(`document.querySelector('.card-edit-text').value`)).toBe('File Second\n\nFile body Second\n');
    await page.send('Input.insertText', { text: 'Fresh ' });
    await click('.card-edit-save');
    await until('window.loadingTest.saves.length === 1');
    expect(await page.evaluate('window.loadingTest.saves[0]')).toMatchObject({ sourceHash: 'index-1-1', title: 'Fresh File Second' });
  });

  it('keeps load failures and Retry without opening a queued editor from indexed text', async () => {
    await open();
    await page.evaluate('window.loadingTest.fail = true; window.loadingTest.select(1)');
    await until('window.loadingTest.requests.length === 2');
    await click('.card-content-edit-action');
    await until(`document.querySelector('.card-content-notice')?.textContent.includes('Test load failure')`);
    expect(await page.evaluate(`document.querySelector('.card-edit-text')`)).toBe(null);
    expect(await page.evaluate(`document.querySelector('.card-content-edit-action').disabled`)).toBe(true);
    await page.evaluate('window.loadingTest.fail = false');
    await click('.card-content-notice button');
    await until(`document.querySelector('.card-preview-title')?.textContent === 'File Second'`);
    expect(await page.evaluate(`document.querySelector('.card-content-notice')`)).toBe(null);
    await click('.card-content-edit-action');
    await until(`Boolean(document.querySelector('.card-edit-text'))`);
    expect(await page.evaluate(`document.querySelector('.card-edit-text').value`)).toBe('File Second\n\nFile body Second\n');
  });

  it('opens Focus Mode during a load with file text, not the indexed copy', async () => {
    await open();
    await page.evaluate('window.loadingTest.delay = 550; window.loadingTest.select(1)');
    await until('window.loadingTest.requests.length === 2');
    await page.evaluate('window.loadingTest.focus()');
    expect(await page.evaluate(`document.querySelector('.card-edit-text')`)).toBe(null);
    await until(`Boolean(document.querySelector('.card-edit-text'))`);
    expect(await page.evaluate(`document.querySelector('.card-edit-text').value`)).toBe('File Second\n\nFile body Second\n');
  });

  it('preserves an open draft and its hash when the watcher changes the revision', async () => {
    await open();
    await click('.card-content-edit-action');
    await until(`Boolean(document.querySelector('.card-edit-text'))`);
    await page.send('Input.insertText', { text: 'My draft ' });
    const value = await page.evaluate(`document.querySelector('.card-edit-text').value`);
    await page.evaluate('window.loadingTest.refresh()');
    await until(`Boolean(document.querySelector('.card-content-conflict'))`);
    expect(await page.evaluate(`document.querySelector('.card-edit-text').value`)).toBe(value);
    expect(await page.evaluate(`document.querySelector('.card-edit-save').disabled`)).toBe(true);
    expect(await page.evaluate('window.loadingTest.saves')).toEqual([]);
    await until(`document.querySelector('.card-content-conflict-columns > section:last-child pre')?.textContent.includes('File body')`);
    await click('.card-content-conflict-actions button');
    await until(`!document.querySelector('.card-content-conflict')`);
    expect(await page.evaluate(`document.querySelector('.card-edit-text').value`)).toBe(value);
    await click('.card-edit-save');
    await until('window.loadingTest.saves.length === 1');
    expect(await page.evaluate('window.loadingTest.saves[0]')).toMatchObject({ sourceHash: 'index-0-1', manifestHash: 'manifest', title: 'My draft File First' });
  });

  it('continues a browser draft when Edit was requested during the file reload', async () => {
    await open();
    await click('.card-content-edit-action');
    await until(`Boolean(document.querySelector('.card-edit-text'))`);
    await page.send('Input.insertText', { text: 'Browser draft ' });
    const value = await page.evaluate(`document.querySelector('.card-edit-text').value`);
    await page.evaluate('window.loadingTest.delay = 550');
    await click('.card-edit-link.is-cancel');
    await until(`Boolean(document.querySelector('.card-draft-banner'))`);
    await click('.card-content-edit-action');
    expect(await page.evaluate(`document.querySelector('.card-edit-text')`)).toBe(null);
    await until(`Boolean(document.querySelector('.card-edit-text'))`);
    expect(await page.evaluate(`document.querySelector('.card-edit-text').value`)).toBe(value);
    expect(await page.evaluate(`document.querySelector('.card-draft-banner')`)).toBe(null);
    await click('.card-edit-save');
    await until('window.loadingTest.saves.length === 1');
    expect(await page.evaluate('window.loadingTest.saves[0]')).toMatchObject({ sourceHash: 'index-0-0', title: 'Browser draft File First' });
  });

  it('does not expose editing on read-only cards, including while loading', async () => {
    await open();
    await click('button:nth-child(2)');
    await until(`Boolean(document.querySelector('.card-content-readonly'))`);
    await page.evaluate('window.loadingTest.select(1)');
    await until('window.loadingTest.requests.length === 2');
    expect(await page.evaluate(`document.querySelector('.card-content-edit-action')`)).toBe(null);
    expect(await page.evaluate(`document.querySelector('.card-title-edit')`)).toBe(null);
  });
});
