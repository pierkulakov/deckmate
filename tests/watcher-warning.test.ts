import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createBrowserSession } from './browser-session.ts';
import { requireBrowser } from './browser-environment.ts';
import { waitForLayout } from './browser-layout.ts';

const browserPath = requireBrowser();
describe.skipIf(!browserPath)('file watching warning (browser)', () => {
  const session = createBrowserSession();
  const { evaluate, send, until } = session;
  const warning = '.watcher-warning';
  async function render(options: object = {}, width = 1440) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await evaluate(`watcherTest.render(${JSON.stringify(options)})`);
    await until(`watcherTest.connected && Boolean(document.querySelector('.catalog-view'))`);
    await waitForLayout(evaluate, '.workspace-main');
  }
  async function screenshot(name: string) {
    if (!process.env.DECKMATE_WATCHER_SHOTS) return;
    const directory = process.env.DECKMATE_WATCHER_SHOTS;
    await mkdir(directory, { recursive: true });
    const image = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(path.join(directory, name + '.png'), Buffer.from(image.data, 'base64'));
  }
  beforeAll(async () => {
    await session.open(browserPath!);
    await session.navigate('watcher-warning', `Boolean(window.watcherTest && document.querySelector('.catalog-view'))`);
  }, 90000);
  afterAll(async () => { await session.close(); }, 20000);

  it.each([375, 1440])('shows watcher-error on an empty board without moving or covering first-run actions at %s px', async width => {
    for (const theme of ['light', 'dark']) {
      await render({ theme }, width);
      const positions = `(() => [...document.querySelectorAll('.catalog-heading, .catalog-start, .catalog-view button')]
        .filter(element => element.getBoundingClientRect().height > 0)
        .map(element => { const { x, y, width, height } = element.getBoundingClientRect(); return { x, y, width, height }; }))()`;
      const before = await evaluate(positions);
      expect(before.length).toBeGreaterThan(0);
      await evaluate('watcherTest.stop()');
      await until(`Boolean(document.querySelector('${warning}'))`);
      await waitForLayout(evaluate, warning);
      expect(await evaluate(positions)).toEqual(before);
      const layout = await evaluate(`(() => {
        const notice = document.querySelector('${warning}');
        const box = notice.getBoundingClientRect();
        const text = notice.querySelector('span'), button = notice.querySelector('button');
        const range = document.createRange(); range.selectNodeContents(text);
        const textBox = range.getBoundingClientRect(), buttonBox = button.getBoundingClientRect();
        const main = document.querySelector('.workspace-main').getBoundingClientRect();
        return { text: text.textContent, action: button.textContent, role: notice.getAttribute('role'),
          visible: notice.checkVisibility() && box.bottom <= innerHeight && box.top >= main.bottom,
          fits: notice.scrollWidth <= notice.clientWidth && box.left >= 0 && box.right <= innerWidth,
          fullText: text.scrollHeight <= text.clientHeight && textBox.top >= box.top && textBox.bottom <= box.bottom,
          actionVisible: buttonBox.top >= box.top && buttonBox.bottom <= box.bottom && button.contains(document.elementFromPoint(buttonBox.x + buttonBox.width / 2, buttonBox.y + buttonBox.height / 2)),
          overflow: document.documentElement.scrollWidth > innerWidth };
      })()`);
      expect(layout).toEqual({
        text: 'Автоматическое наблюдение за файлами остановилось. Обновляйте данные вручную или перезапустите Deckmate, чтобы восстановить автоматические обновления.',
        action: 'Обновить данные', role: 'status', visible: true, fits: true, fullText: true, actionVisible: true, overflow: false,
      });
      await screenshot(`empty-${theme}-${width}-ru`);
      const reads = await evaluate('watcherTest.reads["/api/catalog"]');
      await evaluate(`document.querySelector('${warning} button').click()`);
      await until(`watcherTest.reads['/api/catalog'] > ${reads} && document.querySelector('${warning} button').getAttribute('aria-disabled') === 'false'`);
      expect(await evaluate(`document.querySelector('${warning}').checkVisibility()`)).toBe(true);
      expect(session.errors).toEqual([]);
    }
  });

  it.each(['deck', 'cards'])('keeps the same warning and refresh available in a %s board', async scene => {
    await render({ scene }, 375);
    await until(`Boolean(document.querySelector(${JSON.stringify(scene === 'deck' ? '.deck-empty button' : '[data-deck-card="card:watcher"], .deck-table-row')}))`);
    await waitForLayout(evaluate, '.catalog-workbench');
    const before = await evaluate(`document.querySelector('.catalog-workbench').getBoundingClientRect().top`);
    await evaluate('watcherTest.stop()');
    await until(`Boolean(document.querySelector('${warning}'))`);
    expect(await evaluate(`document.querySelector('.catalog-workbench').getBoundingClientRect().top`)).toBe(before);
    if (scene === 'deck') {
      await evaluate(`document.querySelector('.deck-empty button').scrollIntoView({ block: 'center' })`);
      expect(await evaluate(`(() => {
        const button = document.querySelector('.deck-empty button'), box = button.getBoundingClientRect();
        return button.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
      })()`)).toBe(true);
      await evaluate(`document.querySelector('.deck-empty button').click()`);
      await until(`Boolean(document.querySelector('.card-composer textarea'))`);
      expect(await evaluate(`document.querySelector('${warning}').checkVisibility()`)).toBe(true);
    }
  });

  it('shows a replayed startup failure before the first catalog arrives and retains it after loading', async () => {
    await render({ failed: true, holdCatalog: true });
    await until(`Boolean(document.querySelector('${warning}'))`);
    expect(await evaluate(`document.querySelectorAll('.catalog-view [data-deck-card]').length`)).toBe(0);
    expect(await evaluate(`document.querySelector('${warning}').checkVisibility()`)).toBe(true);
    await screenshot('loading-dark-1440-ru');
    await evaluate(`watcherTest.release('/api/catalog')`);
    await until(`document.querySelector('.deck-gallery')?.dataset.state === 'empty'`);
    expect(await evaluate(`document.querySelector('.gallery-resolution:not([hidden]) button').disabled`)).toBe(false);
    expect(await evaluate(`document.querySelector('${warning}').checkVisibility()`)).toBe(true);
  });

  it('retains the watcher failure across failed reads and retries, but clears it for a new server session', async () => {
    await render();
    await evaluate('watcherTest.failSnapshot(true); watcherTest.stop()');
    await until(`Boolean(document.querySelector('.error-banner'))`);
    expect(await evaluate(`document.querySelector('${warning}').checkVisibility()`)).toBe(true);
    await evaluate(`watcherTest.failSnapshot(false); watcherTest.hold('/api/snapshot'); document.querySelector('${warning} button').click()`);
    await until(`document.querySelector('${warning} button').getAttribute('aria-disabled') === 'true'`);
    const reads = await evaluate(`watcherTest.reads['/api/snapshot']`);
    await evaluate(`document.querySelector('${warning} button').click()`);
    expect(await evaluate(`watcherTest.reads['/api/snapshot']`)).toBe(reads);
    await evaluate(`watcherTest.release('/api/snapshot')`);
    await until(`!document.querySelector('.error-banner') && document.querySelector('${warning} button').getAttribute('aria-disabled') === 'false'`);
    expect(await evaluate(`document.querySelector('${warning}').checkVisibility()`)).toBe(true);
    await evaluate(`watcherTest.restart(); document.querySelector('${warning} button').click()`);
    await until(`!document.querySelector('${warning}')`);
  });

  it('remembers an inactive source failure without warning for the healthy source', async () => {
    await render({ twoSources: true });
    await evaluate(`watcherTest.stop('live')`);
    expect(await evaluate(`Boolean(document.querySelector('${warning}'))`)).toBe(false);
    for (const source of ['live', 'sandbox', 'live']) {
      await evaluate(`document.querySelector('.source-switch').focus()`);
      for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      await until(`Boolean(document.querySelector('[role="menuitemradio"][data-state="unchecked"]'))`);
      await evaluate(`document.querySelector('[role="menuitemradio"][data-state="unchecked"]').click()`);
      await until(`new URLSearchParams(location.search).get('catalogSource') === '${source}' && document.querySelector('.deck-gallery')?.dataset.state === 'empty'`);
      expect(await evaluate(`Boolean(document.querySelector('${warning}'))`)).toBe(source === 'live');
    }
    expect(session.errors).toEqual([]);
  });
});
