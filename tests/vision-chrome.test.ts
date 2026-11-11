import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openHeadlessBrowser, type HeadlessPage } from '../tools/layout-capture.ts';
import { browserFixtureUrl } from './browser-fixture.ts';
import { requireBrowser } from './browser-environment.ts';
import { waitForLayout } from './browser-layout.ts';

const browserPath = requireBrowser();
describe.skipIf(!browserPath)('Vision tab chrome (browser)', () => {
  let page: HeadlessPage;
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  async function until(expression: string) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (await page.evaluate(expression)) return;
      await delay(25);
    }
    throw new Error('Timed out: ' + expression + '\n' + page.consoleErrors.join('\n'));
  }
  async function open(theme: 'dark' | 'light', lang = 'en', warm = '') {
    await page.send('Page.navigate', { url: `${browserFixtureUrl('vision-chrome')}?theme=${theme}&lang=${lang}&warm=${warm}&instance=${Math.random()}` });
    await until(`Boolean(document.querySelector('.vision-canvas .excalidraw')) && ['Saved', 'Сохранено'].includes(document.querySelector('.vision-save-state').textContent)`);
  }
  beforeAll(async () => {
    page = await openHeadlessBrowser({ width: 1440, height: 900, scale: 1 });
  }, 90000);
  afterAll(async () => { await page?.close(); }, 20000);

  it.each(['dark', 'light'] as const)('builds the toolbar and sidebar from the shared surface grammar in the %s theme', async theme => {
    await open(theme);
    expect(await page.evaluate(`document.querySelector('.vision-workspace').className`)).toBe('vision-workspace page-light');
    expect(await page.evaluate(`document.querySelector('.vision-toolbar').className`)).toBe('vision-toolbar page-head');
    const measured = await page.evaluate(`(() => {
      const name = getComputedStyle(document.querySelector('.vision-board-name'));
      const picker = getComputedStyle(document.querySelector('.vision-board-picker'));
      // 2026-11-10: the sidebar is one glass sheet (4px --glass-radius) whose panels are sections split by seams.
      const sheet = getComputedStyle(document.querySelector('.vision-stack.glass-sheet'));
      const sections = [...document.querySelectorAll('.vision-stack > .glass-panel')].map(node => getComputedStyle(node));
      const title = getComputedStyle(document.querySelector('.panel-title'));
      const radiusProbe = document.createElement('i'); document.body.append(radiusProbe);
      radiusProbe.style.borderRadius = 'var(--control-radius)'; const controlRadius = getComputedStyle(radiusProbe).borderRadius;
      radiusProbe.style.borderRadius = 'var(--glass-radius)'; const glassRadius = getComputedStyle(radiusProbe).borderRadius;
      radiusProbe.remove();
      return { name: name.fontSize + '/' + name.fontWeight, nameColor: name.color, picker: picker.borderRadius + '/' + picker.height,
        panel: sheet.borderRadius, sections: sections.map(style => style.borderRadius + '/' + style.borderTopWidth), panelTitle: title.fontSize + '/' + title.fontWeight,
        caption: document.querySelector('.page-caption').textContent.trim(), access: Boolean(document.querySelector('.vision-access')),
        controlRadius, glassRadius };
    })()`);
    // 2026-11-10: the Foil Rule — page title 26/600 (was 26/700), controls 2px --control-radius, glass 4px --glass-radius.
    expect(measured.name).toBe('26px/600');
    expect(measured.picker).toBe(`${measured.controlRadius}/30px`);
    expect(measured.panel).toBe(measured.glassRadius);
    expect(measured.sections[0]).toBe('0px/0px');
    expect(measured.sections.slice(1).every((value: string) => value === '0px/1px')).toBe(true);
    expect(measured.panelTitle).toBe('15px/600');
    expect(measured.caption).toContain('Saved');
    expect(measured.access).toBe(true);
    const control = await page.evaluate(`(() => {
      const button = document.querySelector('.vision-access');
      button.style.transition = 'none';
      const idle = getComputedStyle(button);
      // 2026-11-10: the Foil Rule — a resting control shows the quiet --control-line (full --button-line only on hover).
      const edgeProbe = document.createElement('span'); edgeProbe.style.border = '1px solid var(--control-line)'; document.body.append(edgeProbe);
      const expectedEdge = getComputedStyle(edgeProbe).borderTopColor; edgeProbe.remove();
      const radiusProbe = document.createElement('span'); radiusProbe.style.borderRadius = 'var(--control-radius)'; document.body.append(radiusProbe);
      const expectedRadius = getComputedStyle(radiusProbe).borderRadius; radiusProbe.remove();
      const before = { radius: idle.borderRadius, width: parseFloat(idle.borderTopWidth), edge: idle.borderTopColor,
        expectedEdge, expectedRadius, face: idle.backgroundColor };
      button.setAttribute('aria-pressed', 'true');
      const pressed = getComputedStyle(button).backgroundColor;
      // 2026-11-10: the chosen state is --mark over --mark-tint, never a filled --violet-fill pill.
      const probe = document.createElement('span'); probe.style.backgroundColor = 'var(--mark-tint)'; document.body.append(probe);
      const expectedPressed = getComputedStyle(probe).backgroundColor; probe.remove(); button.removeAttribute('aria-pressed');
      return { ...before, pressed, expectedPressed };
    })()`);
    // 2026-11-10: the Foil Rule — the control is a 2px --control-radius rectangle (was 4px), compared against the token.
    expect(control.radius).toBe(control.expectedRadius);
    expect(control.width).toBeGreaterThan(0);
    expect(control.edge).toBe(control.expectedEdge);
    expect(control.face).toBe('rgba(0, 0, 0, 0)');
    expect(control.pressed).toBe(control.expectedPressed);
    expect(measured.nameColor).toBe(theme === 'dark' ? 'rgb(237, 238, 242)' : 'rgb(47, 36, 64)');
    // The one creating action sits beside the name with its label at desktop width (it collapses to 30px on phones).
    expect(await page.evaluate(`(() => { const mint = document.querySelector('.vision-new-board'); const r = mint.getBoundingClientRect();
      const label = mint.querySelector('span').getBoundingClientRect();
      return Math.round(r.height) + ':' + Math.round(r.width) + ':' + Math.round(label.width); })()`))
      .toMatch(/^30:1[0-9]{2}:[1-9][0-9]+$/);
  });

  it('explains empty panels through the shared EmptyState and counts linked cards', async () => {
    await open('dark');
    expect(await page.evaluate(`document.querySelectorAll('.vision-panel .ui-empty[role=status]').length`)).toBe(1);
    expect(await page.evaluate(`document.querySelector('.vision-panel .ui-empty').textContent`))
      .toBe('There are no references in text nodes yet.');
    expect(await page.evaluate(`document.querySelector('.vision-linked-list button')?.textContent ?? ''`)).toContain('One');
    expect(await page.evaluate(`document.querySelector('.vision-panel .panel-count').textContent`)).toBe('1');
  });

  it('keeps 375px free of horizontal scroll with the collapsed creating action', async () => {
    await open('dark');
    await page.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: false });
    await waitForLayout(page.evaluate, '.vision-toolbar, .vision-links, .vision-canvas');
    const phone = await page.evaluate(`(() => {
      const doc = document.documentElement;
      const clipped = [...document.querySelectorAll('.vision-toolbar *, .vision-links *')].filter(el => {
        const r = el.getBoundingClientRect(); return r.width && r.right > doc.clientWidth + 0.5; }).length;
      const name = getComputedStyle(document.querySelector('.vision-board-name'));
      const mint = document.querySelector('.vision-new-board').getBoundingClientRect();
      return { overflow: doc.scrollWidth - doc.clientWidth, clipped, name: name.fontSize,
        mint: Math.round(mint.width) + 'x' + Math.round(mint.height) };
    })()`);
    expect(phone.overflow).toBe(0);
    expect(phone.clipped).toBe(0);
    expect(phone.name).toBe('22px');
    expect(phone.mint).toBe('30x30');
  });

  it.each(['en', 'ru'] as const)('%s stays consistent on cold, warm and repeated entry', async lang => {
    for (const warm of ['', 'before']) {
      await open('dark', lang, warm);
      await until(`document.documentElement.lang.split('-')[0] === '${lang}'`);
      const labels = await page.evaluate(`Array.from(document.querySelectorAll('.excalidraw [aria-label]'), node => node.getAttribute('aria-label')).filter(Boolean)`);
      await page.evaluate('window.visionTest.warm()');
      expect(await page.evaluate(`document.documentElement.lang.split('-')[0]`)).toBe(lang);
      expect(await page.evaluate(`Array.from(document.querySelectorAll('.excalidraw [aria-label]'), node => node.getAttribute('aria-label')).filter(Boolean)`)).toEqual(labels);
      expect(await page.evaluate(`document.querySelector('.vision-save-state').textContent`)).toBe(lang === 'ru' ? 'Сохранено' : 'Saved');
    }
  });

  it('keeps the full title on focus, with reachable overview, 100% and selection controls on touch', async () => {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 600, deviceScaleFactor: 1, mobile: false });
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    await open('light', 'ru');
    const fullTitle = 'Очень длинное название доски с полным контекстом проекта';
    await page.evaluate(`(() => {
      const input = document.querySelector('.vision-board-name');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(fullTitle)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await until(`document.querySelector('.vision-title-full').textContent === ${JSON.stringify(fullTitle)}`);
    expect(await page.evaluate(`getComputedStyle(document.querySelector('.vision-board-name')).textOverflow`)).toBe('ellipsis');
    await page.evaluate(`document.querySelector('.vision-board-name').focus()`);
    const measured = await page.evaluate(`(() => {
      const full = document.querySelector('.vision-title-full'); const r = full.getBoundingClientRect();
      return { full: full.textContent, visible: getComputedStyle(full).display !== 'none', fits: r.left >= 0 && r.right <= innerWidth,
        controls: [...document.querySelectorAll('.vision-viewport-tools button')].map(button => { const r = button.getBoundingClientRect(); return {width:r.width,height:r.height,left:r.left,right:r.right}; }) };
    })()`);
    expect(measured.full).toBe(fullTitle);
    expect(measured.visible && measured.fits).toBe(true);
    expect(measured.controls).toHaveLength(3);
    expect(measured.controls.every((r: { width: number; height: number; left: number; right: number }) => r.width >= 44 && r.height >= 44 && r.left >= 0 && r.right <= 375)).toBe(true);
    await page.evaluate(`document.querySelector('.vision-board-name').blur(); document.querySelector('[data-vision-viewport="overview"]').click()`);
    await until(`document.querySelector('.deckmate-vision-card').getBoundingClientRect().width < 100`);
    const point = await page.evaluate(`(() => { const r=document.querySelector('.deckmate-vision-card').getBoundingClientRect(); return {x:r.left+5,y:r.top+5}; })()`);
    await page.send('Input.dispatchMouseEvent', { type:'mousePressed', button:'left', clickCount:1, ...point });
    await page.send('Input.dispatchMouseEvent', { type:'mouseReleased', button:'left', clickCount:1, ...point });
    await until(`!document.querySelector('[data-vision-viewport="selection"]').disabled`);
    await page.evaluate(`document.querySelector('[data-vision-viewport="selection"]').click()`);
    await until(`document.querySelector('.deckmate-vision-card').getBoundingClientRect().width > 200`);
    await page.evaluate(`document.querySelector('[data-vision-viewport="actual"]').click()`);
    await until(`(() => { const node=document.querySelector('.deckmate-vision-card'); return node.offsetWidth > 0 && Math.abs(node.getBoundingClientRect().width / node.offsetWidth - 1) < 0.01; })()`);
  });

  it.each(['dark', 'light'] as const)('keeps the document header, table and keyboard return usable at 375×600 in %s', async theme => {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 600, deviceScaleFactor: 1, mobile: false });
    await page.send('Page.navigate', { url: `${browserFixtureUrl('vision-chrome')}?theme=${theme}&lang=ru&mode=document` });
    await until(`Boolean(document.querySelector('#document-opener'))`);
    await page.evaluate(`document.querySelector('#document-opener').focus(); document.querySelector('#document-opener').click()`);
    await until(`Boolean(document.querySelector('.document-preview-article h1'))`);
    const reading = await page.evaluate(`(() => {
      const pane=document.querySelector('.document-preview-pane'), header=document.querySelector('.document-preview-header'), body=document.querySelector('.document-preview-body');
      const p=pane.getBoundingClientRect(), h=header.getBoundingClientRect(), b=body.getBoundingClientRect();
      return { headerFits:h.top >= p.top && h.bottom <= p.bottom, bodyHeight:b.height, scrolls:body.scrollHeight>body.clientHeight,
        font:getComputedStyle(document.querySelector('.document-preview-article .markdown')).fontWeight,
        overflow:document.documentElement.scrollWidth-innerWidth, cells:document.querySelectorAll('.markdown th[scope="col"]').length,
        tableFocusable:document.querySelector('.table-scroll').tabIndex === 0 };
    })()`);
    expect(reading.headerFits).toBe(true);
    expect(reading.bodyHeight).toBeGreaterThan(300);
    expect(reading.scrolls && reading.tableFocusable).toBe(true);
    expect(reading.font).toBe('400');
    expect(reading.overflow).toBe(0);
    expect(reading.cells).toBe(2);
    await page.evaluate(`document.querySelector('.document-preview-body').scrollTop = 10000`);
    expect(await page.evaluate(`document.querySelector('[aria-label="Закрыть документ"]').getBoundingClientRect().top >= 12`)).toBe(true);
    await page.send('Input.dispatchKeyEvent', {type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await page.send('Input.dispatchKeyEvent', {type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await until(`!document.querySelector('.document-preview-pane')`);
    await until(`document.activeElement.id === 'document-opener'`);
    expect(await page.evaluate('document.activeElement.id')).toBe('document-opener');
  });

  it.each(['dark', 'light'] as const)('fits long card metadata, attention and zero effort inside the established footprints in %s', async theme => {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await page.send('Page.navigate', { url: `${browserFixtureUrl('vision-chrome')}?theme=${theme}&lang=ru&mode=nodes` });
    await until(`document.querySelectorAll('[data-node-case]').length === 18`);
    await page.evaluate('document.fonts.ready');
    const nodes = await page.evaluate(`Array.from(document.querySelectorAll('[data-node-case]'), host => {
      const node=host.firstElementChild, r=node.getBoundingClientRect();
      const metadata=[...node.querySelectorAll('.vision-lane-main, .deckmate-card-title, .card-face-state, .card-face-due, .deckmate-card-effort, .deckmate-card-properties')].map(item => item.getBoundingClientRect());
      const tags=node.querySelector('.card-tags'), tag=tags.querySelector('.tag-badge'), tagRect=tags.getBoundingClientRect();
      return { name:host.dataset.nodeCase, width:r.width, height:r.height, overflowX:node.scrollWidth-node.clientWidth, overflowY:node.scrollHeight-node.clientHeight,
        metadataFits:metadata.every(m => m.left >= r.left && m.right <= r.right && m.top >= r.top && m.bottom <= r.bottom), text:node.textContent,
        tagFits:tagRect.left >= r.left && tagRect.right <= r.right && tagRect.top >= r.top && tagRect.bottom <= r.bottom,
        tagWidth:tag.getBoundingClientRect().width, tagTitle:tag.title,
        accessible:node.querySelector('.deckmate-card-opener').getAttribute('aria-label') };
    })`);
    const sizes = new Map([['lane', [280, 44]], ['mini', [280, 110]], ['full', [300, 230]]]);
    for (const node of nodes) {
      const view = node.name.split('-')[0];
      expect([node.width, node.height], node.name).toEqual(sizes.get(view));
      expect([node.overflowX, node.overflowY, node.metadataFits], node.name).toEqual([0, 0, true]);
      expect(node.tagFits, node.name).toBe(true);
      expect(node.tagWidth, node.name).toBeGreaterThan(0);
      expect(node.tagTitle, node.name).toBe('Очень длинное название русского тега для проверки локализации');
      if (node.name.endsWith('blocked')) expect(node.text).toContain('Просрочено');
      if (node.name.endsWith('questions')) {
        expect(node.text).toContain('Заблокирована');
        expect(node.accessible).toContain('Ждёт 1');
        expect(node.accessible).toContain('Вопросов: 1');
      }
      if (node.name.endsWith('questions-only')) expect(node.text).toContain('Вопросов: 1');
      // A Doc Card carries no metrics; every other node shows its estimate, a zero included.
      const estimate = /(?:Оц\. |Оценка: |Оценка: своя и Sub Cards — )0/u;
      if (node.text.startsWith('Doc')) expect(node.text).not.toMatch(estimate);
      else if (view !== 'lane') expect(node.text).toMatch(estimate);
    }
  });

  it.each(['dark', 'light'] as const)('shows priority in each task and Hero node without overflowing in %s', async theme => {
    await page.send('Page.navigate', { url: `${browserFixtureUrl('vision-chrome')}?theme=${theme}&lang=ru&mode=nodes` });
    await until(`document.querySelectorAll('[data-node-case]').length === 18`);
    await page.evaluate('document.fonts.ready');
    const nodes = await page.evaluate(`Array.from(document.querySelectorAll('[data-node-case]'), host => {
      const node = host.firstElementChild, icon = node.querySelector('.vision-card-priority-icon svg');
      const r = node.getBoundingClientRect(), p = icon?.getBoundingClientRect();
      return { name: host.dataset.nodeCase, doc: node.classList.contains('kind-doc'), label: node.querySelector('.deckmate-card-opener').getAttribute('aria-label'), hasIcon: !!icon,
        fits: !icon || (p.width >= 16 && p.left >= r.left && p.right <= r.right && p.top >= r.top && p.bottom <= r.bottom),
        overflowX: node.scrollWidth - node.clientWidth, overflowY: node.scrollHeight - node.clientHeight };
    })`);
    for (const node of nodes) {
      if (node.doc) expect(node.hasIcon).toBe(false);
      else {
        expect(node.hasIcon, node.name).toBe(true);
        expect(node.label, node.name).toContain('Приоритет: Высокий');
      }
      expect([node.fits, node.overflowX, node.overflowY], node.name).toEqual([true, 0, 0]);
    }
  });

  it.each(['dark', 'light'] as const)('carries the started and review state metals on both node sizes in %s', async theme => {
    await page.send('Page.navigate', { url: `${browserFixtureUrl('vision-chrome')}?theme=${theme}&lang=ru&mode=nodes` });
    await until(`document.querySelectorAll('[data-node-case]').length === 18`);
    await page.evaluate('document.fonts.ready');
    const measured = await page.evaluate(`(() => {
      const probe = document.createElement('span');
      const tokenColor = name => { probe.style.color = 'var(--' + name + ')'; document.body.append(probe); const color = getComputedStyle(probe).color; probe.remove(); return color; };
      // 2026-11-11: a Task node in progress or on review carries the tile band's state metal on its footer row.
      return ['mini', 'full'].flatMap(view => [
        ['started', 'started-metal', 'started-metal-ink', 'В работе'],
        ['on-review', 'review-metal', 'review-metal-ink', 'Приёмка'],
      ].map(([id, metal, ink, word]) => {
        const host = document.querySelector('[data-node-case="' + view + '-' + id + '"]');
        const node = host.firstElementChild;
        const band = node.querySelector('.is-state-band');
        const wordElement = node.querySelector('.deckmate-card-state-word');
        const r = node.getBoundingClientRect(), b = band.getBoundingClientRect();
        return { name: view + '-' + id, size: Math.round(r.width) + 'x' + Math.round(r.height),
          overflowX: node.scrollWidth - node.clientWidth, overflowY: node.scrollHeight - node.clientHeight,
          bandFits: b.left >= r.left && b.right <= r.right && b.top >= r.top && b.bottom <= r.bottom,
          bandBottomGap: Math.round(r.bottom - b.bottom), bandMetal: getComputedStyle(band).backgroundColor, expectedMetal: tokenColor(metal),
          wordInk: getComputedStyle(wordElement).color, expectedInk: tokenColor(ink), word: wordElement.textContent,
          faceWord: node.querySelector('.card-face-state')?.textContent ?? '' };
      })).concat([(() => {
        const lane = document.querySelector('[data-node-case="lane-started"]');
        return { name: 'lane-started', laneBand: Boolean(lane.querySelector('.is-state-band')),
          laneWord: lane.querySelector('.card-face-state').textContent, overflowY: lane.firstElementChild.scrollHeight - lane.firstElementChild.clientHeight };
      })()]);
    })()`);
    for (const node of measured) {
      if (node.name === 'lane-started') {
        expect(node.laneBand).toBe(false);
        expect(node.laneWord).toBe('В работе');
        expect(node.overflowY).toBe(0);
        continue;
      }
      expect(node.size, node.name).toBe(node.name.startsWith('mini') ? '280x110' : '300x230');
      expect([node.overflowX, node.overflowY, node.bandFits], node.name).toEqual([0, 0, true]);
      expect(node.bandBottomGap, node.name).toBeLessThanOrEqual(1);
      expect(node.bandMetal, node.name).toBe(node.expectedMetal);
      expect(node.wordInk, node.name).toBe(node.expectedInk);
      expect(node.word, node.name).toBe(node.name.endsWith('started') ? 'В работе' : 'Приёмка');
      expect(node.faceWord, node.name).toBe('');
    }
  });

  it('keeps each bounded tag list separate from the node opener', async () => {
    await page.send('Page.navigate', { url: `${browserFixtureUrl('vision-chrome')}?theme=dark&lang=ru&mode=nodes` });
    await until(`document.querySelectorAll('[data-node-case]').length === 18`);
    expect(await page.evaluate(`Array.from(document.querySelectorAll('[data-node-case] .card-tags'), tags => Boolean(tags.closest('button, [role="button"]'))).every(nested => !nested)`)).toBe(true);
    await page.evaluate(`document.querySelector('[data-node-case="mini-blocked"]').setAttribute('role', 'button')`);
    await page.evaluate(`(() => { const tags = document.querySelector('[data-node-case="mini-blocked"] .card-tags'); const control = document.createElement('button'); tags.append(control); control.click(); control.remove(); })()`);
    expect(await page.evaluate('window.visionTest.nodeOpened')).toEqual([]);
    await page.evaluate(`document.querySelector('[data-node-case="mini-blocked"] .card-tags').click()`);
    expect(await page.evaluate('window.visionTest.nodeOpened')).toEqual(['blocked']);
    await page.evaluate(`document.querySelector('[data-node-case="mini-blocked"] .deckmate-card-opener').click()`);
    expect(await page.evaluate('window.visionTest.nodeOpened')).toEqual(['blocked', 'blocked']);
  });

  it('does not emit runtime or invalid nesting errors', () => {
    expect(page.consoleErrors).toEqual([]);
  });
});
