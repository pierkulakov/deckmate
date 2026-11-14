import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBrowserSession } from './browser-session.ts';
import { requireBrowser } from './browser-environment.ts';
import { expectPageStateDuring, waitForLayout } from './browser-layout.ts';
import { version } from '../package.json';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const browserPath = requireBrowser();
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe.skipIf(!browserPath)('application shell (browser)', () => {
  const session = createBrowserSession({ attempts: 150 });
  const { send, evaluate, until } = session;
  const shortcutProjects = Array.from({ length: 10 }, (_, index) => ({
    path: `C:\\Work\\Проект_${index + 1}`, name: `Длинное русское название проекта номер ${index + 1}`,
    current: index === 2, missing: false,
  }));
  const browserErrors: string[][] = [];
  async function openBrowser() {
    await session.open(browserPath!, { extraArgs: ['--disable-features=OverlayScrollbar'] });
    browserErrors.push(session.errors);
    await session.navigate('shell-ui', `Boolean(window.shellTest && document.querySelector('.global-tabs'))`);
    expect(await evaluate(`({ hover: matchMedia('(hover: hover)').matches, fine: matchMedia('(pointer: fine)').matches })`))
      .toEqual({ hover: true, fine: true });
  }
  async function inTouchMode(check: () => Promise<void>) {
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    try { await check(); } finally {
      // 2026-11-10: disabling touch restores platform pointer defaults, not --blink-settings; Linux headless loses hover.
      // Relaunch so subsequent desktop checks keep the explicit hovering, fine pointer and measure the current mark.
      await session.close();
      await openBrowser();
    }
  }
  async function click(selector: string) {
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    await delay(80);
  }
  async function key(key: string) {
    const keyCodes: Record<string, number> = { Escape: 27, Enter: 13, Tab: 9, ArrowUp: 38, ArrowDown: 40, ' ': 32 };
    for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key, code: key === ' ' ? 'Space' : key, windowsVirtualKeyCode: keyCodes[key], text: type === 'keyDown' && key === 'Enter' ? '\r' : undefined });
    await delay(100);
  }
  async function render(scene = 'app', options: object = {}, width = 375) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: width === 375 ? 812 : 800, deviceScaleFactor: 1, mobile: false });
    await evaluate(`window.shellTest.render(${JSON.stringify(scene)}, ${JSON.stringify(options)})`);
    await until(scene === 'bulk' ? `Boolean(document.querySelector('.bulk-actions'))` : `Boolean(document.querySelector('.global-search-field input') && document.querySelector('.catalog-view, .planning-view, .hand-view'))`);
    await evaluate('document.fonts.ready');
    if (scene !== 'bulk') await until(`Boolean(document.querySelector('.first-screen[data-state="ready"]'))`);
  }
  async function workspace(options: object = {}, width = 1280) {
    await render('app', { workspace: true, ...options }, width);
    await click('.mission-control-trigger');
    await until(`Boolean(document.querySelector('.mission-control-workspace-add:not(:disabled)'))`);
    await evaluate(`Promise.all(document.querySelector('.mission-control').getAnimations().map(animation => animation.finished))`);
  }
  async function search(query: string) {
    await evaluate(`(()=>{const trigger=document.querySelector('.global-search-trigger');if(trigger?.getBoundingClientRect().width && trigger.getAttribute('aria-expanded')==='false')trigger.click()})()`);
    await evaluate(`(()=>{const input=document.querySelector('.global-search input');input.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(query)});input.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    await until(`Boolean(document.querySelector('.global-search-pop'))`);
  }
  async function waitForSearchResult(selector: string) {
    // 2026-11-13: the popover commits before deferred results; Enter needs the focused combobox's active option.
    await until(`(() => {
      const input = document.querySelector('.global-search input');
      const option = document.getElementById(input.getAttribute('aria-activedescendant'));
      return document.activeElement === input && option?.getAttribute('aria-selected') === 'true'
        && Boolean(option.querySelector(${JSON.stringify(selector)}));
    })()`);
  }
  async function expectSearchClosed(width: number, query: string) {
    const target = width === 375 ? '.global-search-trigger' : '.global-search input';
    await until(`!document.querySelector('.global-search-pop')`);
    expect(await evaluate(`(() => {
      const input = document.querySelector('.global-search input');
      const active = document.activeElement;
      return { query: input.value, expanded: input.getAttribute('aria-expanded'),
        triggerExpanded: document.querySelector('.global-search-trigger').getAttribute('aria-expanded'),
        focusReturned: active.matches(${JSON.stringify(target)}), visible: active.getBoundingClientRect().width > 0,
        tabFocus: document.documentElement.hasAttribute('data-tab-focus') };
    })()`)).toEqual({ query, expanded: 'false', triggerExpanded: 'false', focusReturned: true, visible: true, tabFocus: false });
    await expectPageStateDuring(evaluate, `!document.querySelector('.global-search-pop') && document.activeElement.matches(${JSON.stringify(target)})`, 200);
  }
  async function workspaceLayoutFailures() {
    return evaluate(`(() => {
      return [...document.querySelectorAll('.mission-control-workspace-row')].flatMap((row, index) => {
        const name = row.querySelector('.mission-control-workspace-copy strong');
        const chip = row.querySelector('.shortcuts-panel-key');
        const mark = row.querySelector('.mission-control-workspace-current');
        const rects = Object.fromEntries(Object.entries({ row, name, chip, mark,
          remove: row.querySelector('.mission-control-workspace-remove') })
          .map(([key, element]) => [key, element?.getBoundingClientRect().toJSON() ?? null]));
        const conditions = {
          chipBeforeRemove: !chip || rects.chip.right <= rects.remove.left - 2,
          chipBeforeCurrent: !chip || !mark || rects.chip.right <= rects.mark.left - 2,
          nameBeforeChip: !chip || rects.name.right <= rects.chip.left + 1,
          nameHeight: rects.name.height <= 40,
          noHorizontalOverflow: row.scrollWidth <= row.clientWidth,
        };
        const failed = Object.keys(conditions).filter(key => !conditions[key]);
        return failed.length ? [{ row: index + 1, name: name.textContent,
          path: row.querySelector('.mission-control-workspace-open').dataset.path, failed, rects,
          scrollWidth: row.scrollWidth, clientWidth: row.clientWidth,
          nameFont: getComputedStyle(name).font, chipFont: chip && getComputedStyle(chip).font,
          markDisplay: mark && getComputedStyle(mark).display, hover: matchMedia('(hover: hover)').matches,
          fontStatus: document.fonts.status,
          fontFaces: [...document.fonts].filter(face => face.family === 'Source Sans 3')
            .map(face => ({ family: face.family, status: face.status, unicodeRange: face.unicodeRange })),
        }] : [];
      });
    })()`);
  }
  async function addMenu() {
    await evaluate(`document.querySelector('.mission-control-workspace-add').focus()`);
    await key('Enter');
    await until(`Boolean(document.querySelector('.mission-control-workspace-menu'))`);
    await until(`Boolean(document.activeElement.closest('.mission-control-workspace-menu'))`);
  }
  async function menuItem(label: string) {
    await evaluate(`[...document.querySelectorAll('.mission-control-workspace-menu [role="menuitem"]')].find(e => e.textContent.trim() === ${JSON.stringify(label)}).click()`);
    await delay(100);
  }
  async function altMove(direction: 'ArrowUp' | 'ArrowDown') {
    for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: direction, code: direction, modifiers: 1, windowsVirtualKeyCode: direction === 'ArrowUp' ? 38 : 40 });
    await delay(100);
  }

  beforeAll(openBrowser, 90000);

  afterAll(async () => {
    await session.close();
  }, 20000);

  it('does not fetch unused sections or editors while the gallery is idle', async () => {
    await until(`Boolean(document.querySelector('.catalog-spaces'))`);
    await expectPageStateDuring(evaluate, `!performance.getEntriesByType('resource').some(entry => ['Vision-', 'TimelineView-', 'CardPreview-', 'CardComposer-', 'JourneyEditor-'].some(prefix => entry.name.split('/').pop().startsWith(prefix)))`, 4000);
    expect(session.errors).toEqual([]);
  }, 15000);

  it('keeps the deck panel visible until the cold composer and its styles are ready', async () => {
    await render('app', { deck: true }, 1280);
    await until(`Boolean(document.querySelector('.deck-action-rail button[aria-label="New card"]'))`);
    await send('Network.enable');
    await send('Network.emulateNetworkConditions', { offline: false, latency: 350, downloadThroughput: -1, uploadThroughput: -1 });
    try {
      await evaluate(`document.querySelector('.deck-action-rail button[aria-label="New card"]').click()`);
      await expectPageStateDuring(evaluate, `(() => {
        const panel = document.querySelector('.catalog-content-layout');
        return panel && getComputedStyle(panel).display !== 'none'
          && (!panel.querySelector('.catalog-preview-slot:not([hidden])') || Boolean(panel.querySelector('.card-composer .card-edit-text')));
      })()`, 700);
      await until(`Boolean(document.querySelector('.card-composer .card-edit-text'))`);
    } finally {
      await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    }
    expect(session.errors).toEqual([]);
  });

  it.each(['preview', 'composer'])('keeps the covered phone card list in place while opening the %s sheet', async sheet => {
    await render('app', { deck: true, layout: 'cards' }, 375);
    await until(`Boolean(document.querySelector('.catalog-results .deck-card-open'))`);
    await waitForLayout(evaluate, '.catalog-results');
    const top = await evaluate(`document.querySelector('.catalog-results').getBoundingClientRect().top`);
    await click(sheet === 'preview' ? '.catalog-results .deck-card-open' : '.deck-action-rail button[aria-label="New card"]');
    await until(`Boolean(document.querySelector(${JSON.stringify(sheet === 'preview' ? '.card-focus-mode .card-preview' : '.card-composer .card-edit-text')}))`);
    await waitForLayout(evaluate, '.catalog-results');
    expect(await evaluate(`document.querySelector('.catalog-results').getBoundingClientRect().top`)).toBe(top);
  });

  it('cancels an intent warmup when New card opens without stealing editor focus', async () => {
    await render('app', { deck: true }, 1280);
    await until(`Boolean(document.querySelector('.deck-action-rail button[aria-label="New card"]'))`);
    await evaluate(`(() => { const button = document.querySelector('.deck-action-rail button[aria-label="New card"]'); button.focus(); button.click(); })()`);
    await until(`Boolean(document.querySelector('.card-composer .card-edit-text'))`);
    await until(`document.activeElement === document.querySelector('.card-composer .card-edit-text') && !document.querySelector('[data-interface-warmup]')`);
    expect(session.errors).toEqual([]);
  });

  it('centres both kinds of keycap without text-box or block alignment', async () => {
    await render('app', {}, 1280);
    await click('.shortcuts-help-trigger');
    await until(`Boolean(document.querySelector('.shortcuts-panel-key'))`);
    const result = await evaluate(`(() => {
      const removed = [];
      for (const sheet of document.styleSheets) {
        let rules;
        try { rules = sheet.cssRules; } catch { continue; }
        for (let index = rules.length - 1; index >= 0; index--) {
          const rule = rules[index];
          if (rule instanceof CSSSupportsRule && rule.conditionText.includes('text-box')) {
            removed.push({ sheet, index, css: rule.cssText }); sheet.deleteRule(index);
          }
        }
      }
      const probe = document.createElement('kbd'); probe.textContent = 'N'; document.body.append(probe);
      try {
        const measure = element => {
          const range = document.createRange(); range.selectNodeContents(element);
          const box = element.getBoundingClientRect(), text = range.getBoundingClientRect();
          return { display: getComputedStyle(element).display, offset: Math.abs((text.top + text.bottom - box.top - box.bottom) / 2) };
        };
        return { removed: removed.length, key: measure(probe), shortcut: measure(document.querySelector('.shortcuts-panel-key')) };
      } finally {
        probe.remove();
        for (const item of removed.reverse()) item.sheet.insertRule(item.css, item.index);
      }
    })()`);
    expect(result.removed).toBeGreaterThan(0);
    expect(result.key.display).toBe('inline-flex');
    expect(result.shortcut.display).toBe('flex');
    expect(result.key.offset).toBeLessThan(2);
    expect(result.shortcut.offset).toBeLessThan(2);
    await key('Escape');
  });

  it('C02 keeps notifications out of the workspace until requested and restores the entry focus', async () => {
    await render('app', { notifications: true }, 375);
    await until('window.shellTest.notificationCalls > 0');
    expect(await evaluate(`document.querySelector('.notifications-corner') === null`)).toBe(true);
    expect(await evaluate(`document.querySelector('.notifications-trigger')?.textContent.includes('9')`)).toBe(true);
    await click('.notifications-trigger');
    await until(`Boolean(document.querySelector('.notifications-panel'))`);
    await key('Escape');
    expect(await evaluate(`!document.querySelector('.notifications-panel') && document.activeElement.matches('.notifications-trigger')`)).toBe(true);
    await render('app', {}, 375);
    await until('window.shellTest.notificationCalls > 0');
    expect(await evaluate(`!document.querySelector('.notifications-panel,.notifications-corner,.notifications-trigger .page-number')`)).toBe(true);
  });

  it.each(['members', 'csv', 'notifications'])('F03 closes the %s picker before its dialog and restores focus only after the second Escape', async panel => {
    await render('app', { notifications: true, searchMetadata: true }, 375);
    const selector = { members: '.members-editor', csv: '.csv-import', notifications: '.notifications-panel' }[panel];
    const trigger = panel === 'notifications' ? '.notifications-trigger' : '.mission-control-trigger';
    async function openDialog() {
      await click(trigger);
      if (panel !== 'notifications') await click(`.mission-control-menu > button:nth-child(${panel === 'members' ? 2 : 3})`);
      await until(`Boolean(document.querySelector('${selector}'))`);
    }
    await openDialog();
    if (panel === 'csv') {
      await until(`Boolean(document.querySelector('.csv-import input[type="file"]:not(:disabled)'))`);
      await evaluate(`(() => {
        const input = document.querySelector('.csv-import input[type="file"]');
        const transfer = new DataTransfer();
        transfer.items.add(new File(['Title;Type\\nRetained import;Task'], 'escape.csv', { type: 'text/csv' }));
        input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
    }
    await until(`Boolean(document.querySelector('${selector} select:not(:disabled)'))`);
    await evaluate(`document.querySelector('${selector} select').focus()`);
    await key('Enter');
    await until(`Boolean(document.querySelector('${selector} select:open'))`);
    await key('Escape');
    expect(await evaluate(`Boolean(document.querySelector('${selector}'))`)).toBe(true);
    expect(await evaluate(`!document.querySelector('select:open') && document.activeElement.matches('${selector} select')`)).toBe(true);
    await key('Escape');
    await until(`!document.querySelector('${selector}')`);
    expect(await evaluate(`document.activeElement.matches('${trigger}')`)).toBe(true);
    if (panel === 'csv') {
      await openDialog();
      expect(await evaluate(`document.querySelector('.csv-import-preview').textContent.includes('Retained import')`)).toBe(true);
      await key('Escape');
    }
  });

  it.each([375, 1440])('F04 switches global panels exclusively at %s px without returning focus to the previous entry', async width => {
    for (const theme of ['dark', 'light']) {
      await render('app', { notifications: true, theme }, width);
      await click('.level-badge');
      await until(`document.activeElement.matches('.level-panel h2')`);
      await click('.notifications-trigger');
      await until(`Boolean(document.querySelector('.notifications-panel'))`);
      expect(await evaluate(`!document.querySelector('.level-panel') && !document.documentElement.hasAttribute('data-level-panel')`)).toBe(true);
      expect(await evaluate(`Boolean(document.activeElement.closest('.notifications-panel'))`)).toBe(true);
      expect(await evaluate(`getComputedStyle(document.querySelector('.workspace-main')).marginRight`)).toBe('0px');
      await click('.level-badge');
      await until(`Boolean(document.querySelector('.level-panel'))`);
      await waitForLayout(evaluate, '.level-panel');
      expect(await evaluate(`!document.querySelector('.notifications-panel') && document.activeElement.matches('.level-panel h2')`)).toBe(true);
      for (const method of ['Escape', 'close']) {
        if (method === 'close') await click('.level-panel-head button');
        else await key('Escape');
        expect(await evaluate(`!document.querySelector('.level-panel') && document.activeElement.matches('.level-badge')`)).toBe(true);
        await click('.notifications-trigger');
        await until(`Boolean(document.querySelector('.notifications-panel'))`);
        if (method === 'close') await click('.notifications-close');
        else await key('Escape');
        await until(`!document.querySelector('.notifications-panel')`);
        expect(await evaluate(`document.activeElement.matches('.notifications-trigger')`)).toBe(true);
        if (method === 'Escape') { await click('.level-badge'); await until(`Boolean(document.querySelector('.level-panel'))`); }
      }
    }
  });

  it('A08 cancels hold-to-dismiss when keyboard focus leaves the button', async () => {
    await evaluate(`['owned', 'watching', 'due'].forEach(id => localStorage.removeItem('deckmate-notifications-' + id + '-collapsed:maya'))`);
    await render('app', { notifications: true }, 1280);
    await evaluate(`document.querySelector('.notifications-trigger')?.click()`);
    await until(`Boolean(document.querySelector('.notification-hold'))`);
    await evaluate(`window.dismissCalls=0;window.originalFetch=fetch;window.fetch=(input,init)=>{if(String(input).includes('/api/notifications/dismiss'))window.dismissCalls++;return window.originalFetch(input,init)};document.querySelector('.notification-hold').focus()`);
    try {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
      await delay(900);
      expect(await evaluate('window.dismissCalls')).toBe(0);
      await evaluate(`document.querySelector('.notification-hold').focus()`);
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
      await evaluate(`window.dispatchEvent(new Event('blur'))`);
      await delay(900);
      expect(await evaluate('window.dismissCalls')).toBe(0);
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
      await evaluate(`document.querySelector('.notification-hold').focus()`);
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
      await delay(900);
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
      expect(await evaluate('window.dismissCalls')).toBe(1);
    } finally { await evaluate('window.fetch=window.originalFetch'); }
  });

  it.each(['members', 'csv'])('A09 returns %s to the main menu trigger after Escape and close', async panel => {
    await render('app', {}, 1280);
    for (const method of ['Escape', 'close']) {
      await click('.mission-control-trigger');
      const index = panel === 'members' ? 1 : 2;
      await evaluate(`(()=>{const button=document.querySelectorAll('.mission-control-menu > button')[${index}];button.focus();button.click()})()`);
      const selector = panel === 'members' ? '.members-editor' : '.csv-import';
      await until(`Boolean(document.querySelector('${selector}'))`);
      if (method === 'Escape') await key('Escape');
      else await click(selector + ' .dialog-head button');
      await until(`!document.querySelector('${selector}')`);
      expect(await evaluate(`document.activeElement.matches('.mission-control-trigger')`)).toBe(true);
    }
  });

  it.each([375, 1440])('focus F03 closes search from the field and retains visible header focus at %s px', async width => {
    for (const theme of ['dark', 'light']) for (const query of ['Task 2', 'kind:task Task 2']) {
      await render('app', { theme }, width);
      await search(query);
      await waitForSearchResult('.global-search-row[title$=": Task 2"]');
      await key('Escape');
      await expectSearchClosed(width, query);
    }
  });

  it.each([375, 1440])('focus F04 closes search from tabbable results, tags and controls at %s px', async width => {
    for (const theme of ['dark', 'light']) for (const [query, target] of [
      ['Task 2', '.global-search-row[title$=": Task 2"]'],
      ['gd:tasks', '.global-search-nav'],
      ['#ar', '.global-search-tag-suggestion'],
      ['kind:task Task 2', '.global-search-pill'],
      ['Unmatched search query', '.global-search-syntax button'],
    ]) {
      await render('app', { theme, searchMetadata: true }, width);
      await search(query);
      await until(`Boolean(document.querySelector(${JSON.stringify(target)}))`);
      for (let step = 0; step < 6; step++) {
        if (await evaluate(`document.activeElement.matches(${JSON.stringify(target)})`)) break;
        await key('Tab');
      }
      expect(await evaluate(`document.activeElement.matches(${JSON.stringify(target)}) && document.documentElement.hasAttribute('data-tab-focus')`)).toBe(true);
      await key('Escape');
      await expectSearchClosed(width, query);
    }
  });

  it.each(['', 'Task 1'])('search opens the current query when Enter immediately follows input, after %j', async previous => {
    await render('app', {}, 1280);
    if (previous) {
      await search(previous);
      await waitForSearchResult('.global-search-row[title$=": Task 1"]');
      await key('ArrowDown');
    }
    // 2026-11-13: one browser task prevents deferred results from settling between input and Enter.
    const activeTitle = await evaluate(`(() => {
      const input = document.querySelector('.global-search input');
      input.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Task 2');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const active = document.getElementById(input.getAttribute('aria-activedescendant'));
      const title = active?.querySelector('.global-search-row').title ?? null;
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
      return title;
    })()`);
    if (previous) expect(activeTitle).toMatch(/: Task 1/);
    else expect(activeTitle).toBeNull();
    await until(`new URLSearchParams(location.search).get('card') === 'card:shell-2'`);
    await until(`Boolean(document.querySelector('.card-preview'))`);
  });

  it.each(['change', 'close', 'no matches'])('search cancels pending Enter on %s', async action => {
    await render('app', {}, 1280);
    await evaluate(`(() => {
      const input = document.querySelector('.global-search input');
      const type = value => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const press = key => input.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true }));
      input.focus();
      type(${JSON.stringify(action === 'no matches' ? 'Unmatched search query' : 'Task 2')});
      press('Enter');
      if (${JSON.stringify(action)} === 'change') { type('Task 3'); type('Task 2'); }
      if (${JSON.stringify(action)} === 'close') press('Escape');
    })()`);
    if (action === 'change') await waitForSearchResult('.global-search-row[title$=": Task 2"]');
    else if (action === 'close') {
      await expectSearchClosed(1280, 'Task 2');
      await evaluate(`document.querySelector('.global-tabs button').focus(); document.querySelector('.global-search input').focus()`);
      await waitForSearchResult('.global-search-row[title$=": Task 2"]');
    } else await until(`Boolean(document.querySelector('.global-search-empty.ui-empty'))`);
    await expectPageStateDuring(evaluate, `!new URLSearchParams(location.search).has('card') && !document.querySelector('.card-preview')`, 200);
    if (action === 'no matches') {
      await search('Task 2');
      await waitForSearchResult('.global-search-row[title$=": Task 2"]');
      await expectPageStateDuring(evaluate, `!new URLSearchParams(location.search).has('card')`, 200);
    }
    await key('Enter');
    await until(`new URLSearchParams(location.search).get('card') === 'card:shell-2'`);
  });

  it.each(['en', 'ru'])('search uses the card status, owner name and one tag location in %s', async lang => {
    await render('app', { searchMetadata: true, lang }, 1280);
    await search('Task 0');
    await waitForSearchResult('.global-search-row[title$=": Task 0"]');
    const row = await evaluate(`(()=>{const row=[...document.querySelectorAll('.global-search-row')].find(e=>e.title.endsWith(': Task 0'));return {text:row.textContent,states:[...row.querySelectorAll('.card-face-state')].map(e=>e.textContent),statusTitle:row.querySelector('.card-face-status')?.title,due:row.querySelector('.card-face-due')?.textContent,tags:row.querySelectorAll('.card-tags').length,prefix:row.querySelectorAll('.tag-title-prefix').length}})()`);
    expect(row.states).toContain(lang === 'ru' ? 'Заблокирована' : 'Blocked');
    expect(row.statusTitle).toContain(lang === 'ru' ? 'Ждёт 1' : 'Waiting: 1');
    expect(row.due).toBe(lang === 'ru' ? 'Просрочено' : 'Overdue');
    expect(row.text).toContain('Maya Chen');
    expect(row.tags).toBe(1);
    expect(row.prefix).toBe(0);
    await key('Enter');
    await until(`new URLSearchParams(location.search).get('card') === 'card:shell-0'`);
  });

  it.each(['en', 'ru'])('search shows the shared Hero total from unfiltered children in %s', async lang => {
    await render('app', {}, 1440);
    await evaluate(`window.metricsFetch = window.fetch; window.fetch = async (...args) => {
      const response = await window.metricsFetch(...args);
      if (new URL(String(args[0]), location.href).pathname !== '/api/catalog') return response;
      const data = await response.json();
      const hero = data.cards[1];
      data.decks = data.decks.map(deck => deck.id === hero.deckId ? { ...deck, title: 'Очень длинное русское название колоды с окружением' } : deck);
      data.cards = data.cards.map((card, index) => {
        if (index === 1) return { ...card, kind: 'hero', title: 'Metrics Hero', effort: null };
        if (index === 2) return { ...card, parentId: hero.id, effort: 3 };
        if (index === 3) return { ...card, parentId: hero.id, effort: null };
        if (index === 4) return { ...card, parentId: hero.id, effort: 99, archived: true };
        return card;
      });
      return Response.json(data);
    }`);
    try {
      for (const width of [375, 1440]) for (const theme of ['dark', 'light']) {
        await render('app', { searchMetadata: true, lang, theme }, width);
        await search('Metrics Hero');
        await until(`Boolean(document.querySelector('.global-search-row .card-metrics-effort'))`);
        const result = await evaluate(`(() => { const row = document.querySelector('.global-search-row'); const effort = row.querySelector('.card-metrics-effort'); const deck = row.querySelector('.global-search-deck'); return { label: effort.getAttribute('aria-label'), icon: !!effort.querySelector('.effort-icon'), count: document.querySelectorAll('.global-search-row').length, overflow: row.scrollWidth > row.clientWidth, deckWrap: getComputedStyle(deck).whiteSpace, deckOverflow: deck.scrollWidth > deck.clientWidth }; })()`);
        expect(result.label).toBe(lang === 'en' ? 'Effort: own and Sub Cards — 4' : 'Оценка: своя и Sub Cards — 4');
        expect(result.icon).toBe(true);
        expect(result.count).toBe(1);
        expect(result.overflow).toBe(false);
        expect(result.deckWrap).toBe('normal');
        expect(result.deckOverflow).toBe(false);
      }
    } finally {
      await evaluate('window.fetch = window.metricsFetch; delete window.metricsFetch');
      await render('app');
    }
  });

  it.each(['en', 'ru'])('tag search suggests decorated prefixes and commits with the keyboard in %s', async lang => {
    await render('app', { searchMetadata: true, lang }, 1280);
    for (const query of ['ar', '#ar']) {
      await search(query);
      await waitForSearchResult('.global-search-tag-suggestion');
      expect(await evaluate(`(()=>{const row=document.querySelector('.global-search-tag-suggestion');return {name:row.querySelector('.tag-badge-name').textContent,glyph:row.querySelector('.tag-badge-glyph').textContent,count:row.querySelector('.page-number').textContent}})()`))
        .toEqual({ name: 'art', glyph: '🎨', count: '1' });
      await key('Enter');
      await until(`document.querySelector('.global-search input').value === '#art '`);
      expect(await evaluate(`document.querySelector('.global-search input').getAttribute('aria-expanded')`)).toBe('true');
      await until(`document.querySelectorAll('.global-search-results .global-search-row').length === 1`);
      expect(await evaluate(`document.querySelector('.global-search-results .tag-badge-name').textContent`)).toBe('art');
    }
  });

  it('tag panel separates showing from selection, keeps counts stable and resets zero matches', async () => {
    await render('app', { deck: true, searchMetadata: true, lang: 'ru' }, 1440);
    await click('.deck-action-rail [aria-label="Теги"]');
    await until(`Boolean(document.querySelector('.deck-tags-panel'))`);
    expect(await evaluate(`document.querySelector('.deck-tags-purpose [aria-pressed="true"]').textContent`)).toBe('Показать');
    await click('.deck-tag-row.is-project');
    await until(`document.querySelectorAll('.deck-table-row').length === 1`);
    expect(await evaluate(`document.querySelector('.deck-tags-summary').textContent`)).toContain('Показано 1 из 40');
    expect(await evaluate(`document.querySelector('.card-selection-toolbar') === null`)).toBe(true);
    await click('.deck-tag-row:not(.is-project)');
    await until(`document.querySelectorAll('.deck-table-row').length === 0`);
    expect(await evaluate(`document.querySelector('.deck-tags-summary').textContent`)).toContain('Показано 0 из 40');
    await click('.deck-tags-modes button:last-child');
    await until(`document.querySelectorAll('.deck-table-row').length === 40`);
    expect(await evaluate(`[...document.querySelectorAll('.deck-tags-modes button')].map(button=>button.textContent)`)).toEqual(['Все', 'Любой']);
    await click('.deck-tags-purpose button:last-child');
    await until(`document.querySelectorAll('.deck-table-row.is-multi-selected').length === 40`);
    expect(await evaluate(`document.querySelector('.deck-tags-summary').textContent`)).toContain('Выделено 40');
    await click('.deck-tags-reset');
    await until(`document.querySelectorAll('.deck-table-row.is-multi-selected').length === 0`);
    expect(await evaluate(`document.querySelectorAll('.deck-table-row').length`)).toBe(40);
    await click('.deck-tags-purpose button:first-child');
    await click('.deck-tag-row.is-project');
    await until(`document.querySelectorAll('.deck-table-row').length === 1`);
    await click('.deck-tags-purpose button:last-child');
    await until(`document.querySelectorAll('.deck-table-row.is-multi-selected').length === 1`);
    expect(await evaluate(`document.querySelectorAll('.deck-table-row').length`)).toBe(40);
    await click('.card-selection-clear');
    await until(`document.querySelector('.deck-tags-summary').textContent.includes('Выделено 0')`);
    expect(await evaluate(`document.querySelector('.deck-tag-row.is-project').getAttribute('aria-pressed')`)).toBe('false');
    await click('.deck-action-rail [aria-label="Порядок"]');
    expect(await evaluate(`document.querySelector('.card-ordering-rows').textContent`)).toContain('По первому тегу');
    await click('.card-ordering [aria-label="По первому тегу: Теги проекта"]');
    await until(`Boolean(document.querySelector('.catalog-group-filter .tag-badge-glyph'))`);
    expect(await evaluate(`document.querySelector('.deck-table-tags .tag-badge-glyph').textContent`)).toBe('🎨');
  });

  it('Hand card navigation preserves the viewed member and a browser return step', async () => {
    await render('app', { view: 'hand', searchMetadata: true }, 1280);
    await evaluate(`history.replaceState(history.state,'',location.href+'&handMember=maya&hands=all');window.actingMemberBefore=localStorage.getItem('deckmate-current-member')`);
    await search('Task 0');
    await waitForSearchResult('.global-search-row[title$=": Task 0"]');
    await key('Enter');
    await until(`new URLSearchParams(location.search).get('card') === 'card:shell-0'`);
    await until(`Boolean(document.querySelector('.card-preview'))`);
    expect(await evaluate(`new URLSearchParams(location.search).get('handMember')`)).toBe('maya');
    await evaluate('history.back()');
    await until(`document.querySelector('.hand-view') && new URLSearchParams(location.search).get('view') === 'hand'`);
    expect(await evaluate(`new URLSearchParams(location.search).get('hands')`)).toBe('all');
    expect(await evaluate(`localStorage.getItem('deckmate-current-member')===window.actingMemberBefore`)).toBe(true);
  });

  it.each([600, 900])('C06 keeps the shortcuts heading, scrollable body and close control inside a %s px phone window', async height => {
    await render('app', { deck: true, lang: 'ru' }, 375);
    await send('Emulation.setDeviceMetricsOverride', { width: 375, height, deviceScaleFactor: 1, mobile: false });
    await click('.shortcuts-help-trigger');
    await until(`Boolean(document.querySelector('.shortcuts-panel'))`);
    await waitForLayout(evaluate, '.shortcuts-panel');
    expect(await evaluate(`(()=>{const panel=document.querySelector('.shortcuts-panel').getBoundingClientRect(),title=document.querySelector('.shortcuts-panel .dialog-title').getBoundingClientRect(),close=document.querySelector('.shortcuts-panel-close').getBoundingClientRect(),body=document.querySelector('.shortcuts-panel-body');return panel.top>=8 && panel.bottom<=innerHeight-8 && title.top>=panel.top && title.bottom<=panel.bottom && close.top>=panel.top && close.bottom<=panel.bottom && body.clientHeight>200 && body.scrollHeight>body.clientHeight})()`)).toBe(true);
    await key('Escape');
    expect(await evaluate(`document.activeElement.matches('.shortcuts-help-trigger')`)).toBe(true);
  });

  it.each([false, true])('C01 keeps the phone header within two rows with deck=%s', async deck => {
    await inTouchMode(async () => {
      await render('app', { deck, lang: 'ru', notifications: true, editMode: 'sandbox' }, 375);
      expect(await evaluate(`document.querySelector('.global-topbar').getBoundingClientRect().height`)).toBeLessThanOrEqual(96);
      expect(await evaluate(`(()=>{const items=[...document.querySelectorAll('.global-topbar button')].filter(e=>e.getBoundingClientRect().width);return items.every(e=>{const r=e.getBoundingClientRect();return r.width>=44 && r.height>=44 && r.right<=innerWidth && r.left>=0})})()`)).toBe(true);
      expect(await evaluate(`Boolean(document.querySelector('.notifications-panel'))`)).toBe(false);
    });
  });

  it('reserves touch targets for header tools and short search results above the phone breakpoint', async () => {
    await inTouchMode(async () => {
      for (const width of [820, 1700]) {
        await render('app', { lang: 'ru', notifications: true }, width);
        await until(`Boolean(document.querySelector('.topbar-shortcuts button'))`);
        const layout = await evaluate(`(() => {
          const tools = [...document.querySelectorAll('.topbar-actions > button, .topbar-shortcuts, .global-search')]
            .map(el => el.getBoundingClientRect()).filter(r => r.width > 0);
          return { targets: tools.every(r => r.width >= 44 && r.height >= 44),
            separated: tools.every((r, i) => tools.slice(i + 1).every(s => r.right <= s.left || s.right <= r.left || r.bottom <= s.top || s.bottom <= r.top)),
            tabs: [...document.querySelectorAll('.global-tabs button')].every(el => el.getBoundingClientRect().height >= 44) };
        })()`);
        expect(layout).toEqual({ targets: true, separated: true, tabs: true });
        await search('gd:tasks');
        await until(`Boolean(document.querySelector('.global-search-nav'))`);
        await waitForLayout(evaluate, '.global-search-pop');
        expect(await evaluate(`(() => {
          const row = document.querySelector('.global-search-nav').getBoundingClientRect();
          const field = document.querySelector('.global-search-field').getBoundingClientRect();
          const pop = document.querySelector('.global-search-pop').getBoundingClientRect();
          return row.height >= 44 && pop.top >= field.bottom;
        })()`)).toBe(true);
        await key('Escape');
      }
    });
  });

  it('anchors quick capture below either header layout and keeps its actions visible in a short touch window', async () => {
    await inTouchMode(async () => {
      for (const width of [375, 820, 1700]) {
        await render('app', { lang: 'ru' }, width);
        await send('Emulation.setDeviceMetricsOverride', { width, height: 600, deviceScaleFactor: 1, mobile: false });
        await click('.quick-capture-trigger');
        await until(`Boolean(document.querySelector('.quick-capture-input:not(:disabled)'))`);
        await waitForLayout(evaluate, '.quick-capture-panel');
        const layout = await evaluate(`(() => {
          const box = selector => document.querySelector(selector).getBoundingClientRect();
          const panel = box('.quick-capture-panel'), head = box('.global-topbar'), foot = box('.quick-capture-footer');
          const body = document.querySelector('.quick-capture-body');
          return { clearsHeader: panel.top >= head.bottom + 8, fits: panel.bottom <= innerHeight - 12,
            actionsVisible: foot.top >= panel.top && foot.bottom <= panel.bottom,
            scrolls: body.scrollHeight > body.clientHeight, noOverflow: panel.left >= 0 && panel.right <= innerWidth };
        })()`);
        expect(layout).toEqual({ clearsHeader: true, fits: true, actionsVisible: true, scrolls: true, noOverflow: true });
        await key('Escape');
        await until(`!document.querySelector('.quick-capture-panel') && document.activeElement.matches('.quick-capture-trigger')`);
      }
    });
  });

  it('global search shares the recessed field and dialog frame at desktop and phone widths', async () => {
    for (const width of [375, 1440]) {
      for (const dark of [false, true]) {
        await render('app', { theme: dark ? 'dark' : 'light' }, width);
        await search('card');
        await until(`Boolean(document.querySelector('.global-search-pop'))`);
        const state = await evaluate(`(() => {
          const field = document.querySelector('.global-search-field');
          const pop = document.querySelector('.global-search-pop');
          const box = pop.getBoundingClientRect();
          const probe = document.createElement('i'); document.body.append(probe);
          probe.style.borderRadius = 'var(--control-radius)'; const controlRadius = getComputedStyle(probe).borderRadius;
          probe.style.borderRadius = 'var(--glass-radius)'; const glassRadius = getComputedStyle(probe).borderRadius;
          probe.remove();
          return { fieldClass: field.classList.contains('control-field'), panelClass: pop.classList.contains('dialog-panel'),
            fieldRadius: getComputedStyle(field).borderRadius, panelRadius: getComputedStyle(pop).borderRadius,
            controlRadius, glassRadius,
            fits: box.left >= 0 && box.right <= innerWidth, noOverflow: document.documentElement.scrollWidth <= innerWidth };
        })()`);
        // 2026-11-10: the Foil Rule — the recessed field is a 2px --control-radius rectangle and the popover takes the
        // 4px --glass-radius (was 4px/12px); radii are compared against the computed tokens.
        expect(state).toEqual({ fieldClass: true, panelClass: true, fieldRadius: `${state.controlRadius} ${state.controlRadius} 0px 0px`,
          panelRadius: state.glassRadius, controlRadius: state.controlRadius, glassRadius: state.glassRadius, fits: true, noOverflow: true });
        await key('Escape');
      }
    }
  });

  it.each([375, 1440])('A06 keeps the active result visible across both wraps at %s px', async width => {
    await render('app', {}, width);
    await search('kind:task');
    await until(`document.querySelectorAll('.global-search-row').length === 40`);
    const before = await evaluate(`document.querySelector('.workspace-main').scrollTop`);
    for (const direction of ['ArrowUp', 'ArrowDown']) {
      await key(direction);
      expect(await evaluate(`(()=>{const row=document.querySelector('.global-search-results [aria-selected="true"]').getBoundingClientRect();const box=document.querySelector('.global-search-sections').getBoundingClientRect();return row.top>=box.top-1 && row.bottom<=box.bottom+1})()`)).toBe(true);
      expect(await evaluate(`document.querySelector('.workspace-main').scrollTop`)).toBe(before);
    }
  });

  it.each(['deck', 'hand'])('R24 opens a deck from %s without reloading and supports Back/Forward', async view => {
    await render('app', { view, deck: view === 'deck' }, 1280);
    await evaluate(`window.searchNavigationMarker='same-document'`);
    await search('gd:neighbors');
    await waitForSearchResult('.global-search-nav[title$=": neighbors"]');
    await key('Enter');
    await until(`new URLSearchParams(location.search).get('deck') === 'neighbors' && Boolean(document.querySelector('.is-deck-open'))`);
    expect(await evaluate('window.searchNavigationMarker')).toBe('same-document');
    await until(`document.activeElement !== document.body`);
    expect(await evaluate(`new URLSearchParams(location.search).get('catalogSource')`)).toBe('sandbox');
    await evaluate('history.back()');
    await until(view === 'deck' ? `new URLSearchParams(location.search).get('deck') === 'tasks'` : `new URLSearchParams(location.search).get('view') === 'hand'`);
    await evaluate('history.forward()');
    await until(`new URLSearchParams(location.search).get('deck') === 'neighbors' && Boolean(document.querySelector('.is-deck-open'))`);
  });

  it('R24 protects an active card draft from search navigation', async () => {
    await render('app', { deck: true }, 1280);
    await click('.catalog-table-title');
    await until(`Boolean(document.querySelector('.card-title-edit:not(:disabled)'))`);
    await click('.card-title-edit');
    await until(`Boolean(document.querySelector('.card-edit-text'))`);
    await evaluate(`(()=>{const field=document.querySelector('.card-edit-text');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(field,'Unsaved card text');field.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    await until(`document.querySelector('.global-search input').disabled`);
    const before = await evaluate('location.href');
    await evaluate(`document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'/',code:'Slash',bubbles:true,cancelable:true}))`);
    expect(await evaluate('location.href')).toBe(before);
    expect(await evaluate(`document.querySelector('.card-edit-text').value`)).toBe('Unsaved card text');
    expect(await evaluate(`Boolean(document.querySelector('.global-search-pop'))`)).toBe(false);
  });

  it('A11 shows one actionable startup error and enables project actions after recovery', async () => {
    await evaluate(`window.shellTest.render('app',{failSnapshot:true})`);
    await until(`Boolean(document.querySelector('.workspace-main .ui-error[role="alert"]'))`);
    expect(await evaluate(`document.querySelectorAll('.ui-error[role="alert"]').length`)).toBe(1);
    expect(await evaluate(`Boolean(document.querySelector('.workspace-main .loading-state'))`)).toBe(false);
    await click('.mission-control-trigger');
    expect(await evaluate(`[...document.querySelectorAll('.mission-control-menu button')].slice(0,3).every(button=>button.disabled)`)).toBe(true);
    await key('Escape');
    await evaluate(`window.shellTest.setSnapshotFails(false);document.querySelector('.workspace-main .ui-error button').click()`);
    await until(`Boolean(document.querySelector('.catalog-view'))`);
    expect(await evaluate(`Boolean(document.querySelector('.ui-error[role="alert"]'))`)).toBe(false);
  });

  it('A10 opens connection details with tap, Enter and Space, preserving a separate live status', async () => {
    await render('app', {}, 1280);
    for (const action of ['tap', 'Enter', ' ']) {
      expect(await evaluate(`document.querySelector('.server-status').tagName`)).toBe('BUTTON');
      if (action === 'tap') await click('.server-status');
      else { await evaluate(`document.querySelector('.server-status').focus()`); await key(action); }
      await until(`Boolean(document.querySelector('.server-status-card'))`);
      expect(await evaluate(`document.querySelector('.server-status').getAttribute('aria-expanded')`)).toBe('true');
      expect(await evaluate(`Boolean(document.querySelector('.server-status-slot [role="status"]'))`)).toBe(true);
      await key('Escape');
      expect(await evaluate(`document.activeElement.matches('.server-status')`)).toBe(true);
    }
  });

  it.each(['en', 'ru'])('keeps every server state identifiable without color or motion and names its visible label (%s)', async lang => {
    const labels: Record<string, Record<string, [string, string]>> = {
      en: { live: ['Live', 'Live'], saving: ['Saving…', 'Saving changes…'], saved: ['Saved', 'Saved'],
        reconnecting: ['Connecting…', 'Reconnecting…'], offline: ['Offline', 'Server stopped'] },
      ru: { live: ['На связи', 'На связи'], saving: ['Сохраняю…', 'Сохраняю изменения…'], saved: ['Сохранено', 'Сохранено'],
        reconnecting: ['Подключаюсь…', 'Переподключение…'], offline: ['Нет связи', 'Сервер остановлен'] },
    };
    async function checkState(state: string) {
      for (const width of [861, 900, 1280, 375]) {
        await send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false });
        if (width === 375) {
          await until(`!document.querySelector('.breadcrumb .server-status')`);
          await click('.mission-control-trigger');
          await until(`Boolean(document.querySelector('.mission-control .server-status'))`);
        } else await until(`Boolean(document.querySelector('.breadcrumb .server-status'))`);
        for (const theme of ['light', 'dark']) {
          await evaluate(`document.documentElement.classList.toggle('dark', ${theme === 'dark'})`);
          const [chip, detail] = labels[lang][state];
          const name = chip === detail ? chip : `${chip} — ${detail}`;
          await evaluate(`window.shellTest.setLang(${JSON.stringify(lang)})`);
          // 2026-11-14: "Saved" lasts 1.6 s, shorter than the layout matrix on a slow runner; restart it per check.
          if (state === 'saved') {
            await evaluate('window.shellTest.startSave(0)');
            await until(`Boolean(document.querySelector('.server-status.is-saved'))`);
          }
          await until(`document.querySelector('.server-status')?.getAttribute('aria-label') === ${JSON.stringify(name)}`);
          const result = await evaluate(`(() => {
            const button = document.querySelector('.server-status');
            const label = button.querySelector('.server-status-labels .is-active');
            const box = button.getBoundingClientRect(), text = label.getBoundingClientRect();
            const tabs = document.querySelector('.global-tabs'), canvas = document.createElement('canvas').getContext('2d');
            const tabsFit = tabs.scrollWidth <= tabs.clientWidth && [...tabs.querySelectorAll('button')].every(tab => {
              const style = getComputedStyle(tab); canvas.font = style.font;
              return canvas.measureText(tab.textContent).width <= tab.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
            });
            return { state: button.classList.contains('is-${state}'), name: button.getAttribute('aria-label'),
              live: document.querySelector('.server-status-slot [role="status"]').textContent,
              label: label.textContent, shown: text.width > 0 && getComputedStyle(label).opacity === '1',
              fits: box.left >= 0 && box.right <= innerWidth && (!text.width || text.left >= box.left && text.right <= box.right),
              tabsFit, overflow: document.documentElement.scrollWidth > innerWidth };
          })()`);
          expect(result).toEqual({ state: true, name, live: detail, label: chip,
            shown: width === 1280 || width === 375 || state !== 'live', fits: true, tabsFit: true, overflow: false });
          if (width === 1280 && theme === 'dark') {
            const document = await send('DOM.getDocument');
            const button = await send('DOM.querySelector', { nodeId: document.root.nodeId, selector: '.server-status' });
            const tree = await send('Accessibility.getPartialAXTree', { nodeId: button.nodeId, fetchRelatives: false });
            expect(tree.nodes.find((node: { role?: { value: string } }) => node.role?.value === 'button')?.name?.value).toBe(name);
          }
          if ([900, 1280].includes(width) && lang === 'ru' && ['live', 'reconnecting', 'offline'].includes(state) && process.env.DECKMATE_A11Y_SHOTS) {
            await waitForLayout(evaluate, '.server-status');
            mkdirSync(process.env.DECKMATE_A11Y_SHOTS, { recursive: true });
            const image = await send('Page.captureScreenshot', { format: 'png' });
            writeFileSync(path.join(process.env.DECKMATE_A11Y_SHOTS, `status-${state}-${theme}-${width}.png`), Buffer.from(image.data, 'base64'));
          }
        }
        if (width === 375) await click('.mission-control-head button');
      }
      await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 800, deviceScaleFactor: 1, mobile: false });
      await until(`Boolean(document.querySelector('.breadcrumb .server-status'))`);
    }
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    try {
      await render('app', {}, 900);
      await until(`Boolean(document.querySelector('.server-status.is-live'))`);
      await checkState('live');
      // 2026-11-14: the layout matrix must finish before the simulated write settles.
      await evaluate('window.finishStatusSave = window.shellTest.startSave(null)');
      await until(`Boolean(document.querySelector('.server-status.is-saving'))`);
      await checkState('saving');
      await evaluate('window.finishStatusSave()');
      await until(`Boolean(document.querySelector('.server-status.is-saved'))`);
      await checkState('saved');
      await until(`Boolean(document.querySelector('.server-status.is-live'))`);
      await evaluate('window.shellTest.disconnect(true)');
      await until(`Boolean(document.querySelector('.server-status.is-reconnecting'))`);
      await checkState('reconnecting');
      await until(`Boolean(document.querySelector('.server-status.is-offline'))`, 220);
      await checkState('offline');
    } finally {
      await evaluate('window.finishStatusSave?.(); delete window.finishStatusSave');
      await send('Emulation.setEmulatedMedia', { features: [] });
    }
  }, 45000);

  it('gallery: formerly piled decks are ordinary covers with no pile control', async () => {
    await render('app', {}, 1280);
    await until(`Boolean(document.querySelector('[data-deck-cover="neighbors"]'))`);
    expect(await evaluate(`[...document.querySelectorAll('.catalog-deck-grid [data-deck-cover]')].map(cover => cover.dataset.deckCover)`)).toEqual(['tasks', 'neighbors']);
    expect(await evaluate(`document.querySelectorAll('.catalog-pile').length`)).toBe(0);
    expect(await evaluate(`document.querySelectorAll('.catalog-pile-decks, .is-piled').length`)).toBe(0);
    expect(await evaluate(`[...document.querySelectorAll('.catalog-deck-grid [data-deck-cover]')].every(cover => !cover.getAttribute('aria-label').includes('pile'))`)).toBe(true);
  });

  // 2026-11-10: a cover's face always has its color; selected, its glass frame fills too, without rising or growing.
  it.each([375, 1280])('gallery: hover and keyboard fill the cover frame with its color in place and keep the grid fixed at %s px in both themes', async width => {
    for (const theme of ['dark', 'light']) {
      await render('app', { theme }, width);
      await until(`Boolean(document.querySelector('.catalog-cover-item [data-deck-cover]'))`);
      await evaluate(`document.querySelector('.catalog-cover-item').scrollIntoView({ block:'center', behavior:'instant' })`);
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });
      const before = await evaluate(`(() => {
        const tiles = [...document.querySelectorAll('.catalog-cover-item')];
        const r = tiles[0].getBoundingClientRect();
        return { positions: tiles.map(t => [t.offsetLeft, t.offsetTop]), x:r.x+r.width/2, y:r.y+r.height/2 };
      })()`);
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: before.x, y: before.y });
      await until(`getComputedStyle(document.querySelector('.catalog-cover-item .catalog-cover-backdrop'), '::before').opacity === '1'`);
      await waitForLayout(evaluate, '.catalog-cover-item');
      expect(await evaluate(`(() => {
        const c = document.querySelector('.catalog-cover-item [data-deck-cover]');
        return new DOMMatrixReadOnly(getComputedStyle(c).transform).m42;
      })()`)).toBe(0);
      expect(await evaluate(`(() => { const item=document.querySelector('.catalog-cover-item'); const backdrop=item.querySelector('.catalog-cover-backdrop'); const face=getComputedStyle(backdrop,'::after').backgroundColor; return face.startsWith('rgb(') &&getComputedStyle(backdrop).getPropertyValue('--cover-c-dark').startsWith('#') && getComputedStyle(item.querySelector('[data-deck-cover]'),'::after').opacity === '1'; })()`)).toBe(true);
      expect(await evaluate(`[...document.querySelectorAll('.catalog-cover-item')].map(t => [t.offsetLeft, t.offsetTop])`)).toEqual(before.positions);
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });
      await evaluate(`document.querySelector('.catalog-cover-item [data-deck-cover]').focus()`);
      for (const modifiers of [0, 8]) for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers });
      await until(`document.activeElement.matches('[data-deck-cover]:focus-visible') && getComputedStyle(document.activeElement.closest('.catalog-cover-item').querySelector('.catalog-cover-backdrop'), '::before').opacity === '1'`);
      expect(await evaluate(`(() => { const c = document.activeElement; return c.matches('[data-deck-cover]:focus-visible') && new DOMMatrixReadOnly(getComputedStyle(c).transform).m42 === 0; })()`)).toBe(true);
      expect(await evaluate(`(() => { const p=document.querySelector('.workspace-main'); return p.scrollWidth <= p.clientWidth && document.documentElement.scrollWidth === innerWidth; })()`)).toBe(true);
    }
  });

  it('gallery: the cover lands at the full shelf face before the toolbar and cards appear', async () => {
    await render('app');
    await until(`Boolean(document.querySelector('.catalog-cover-item [data-deck-cover]'))`);
    await evaluate(`(() => {
      const native = Element.prototype.animate;
      window.galleryAnimations = [];
      window.restoreGalleryAnimate = () => Element.prototype.animate = native;
      Element.prototype.animate = function(...args) {
        const animation = native.apply(this,args);
        if (this.closest('.deck-transition-layer') || this.matches('.deck-view > *')) { animation.pause(); window.galleryAnimations.push(animation); }
        return animation;
      };
      document.querySelector('.catalog-cover-item [data-deck-cover]').click();
    })()`);
    try {
      await until(`Boolean(document.querySelector('.deck-transition-layer'))`);
      const mid = await evaluate(`(() => {
        const animations = window.galleryAnimations;
        const travel = animations.find(a => a.effect.target.matches('.deck-transition-ghost'));
        const duration = Number(travel.effect.getTiming().duration);
        animations.forEach(a => a.currentTime = duration / 2);
        return { toolbar:getComputedStyle(document.querySelector('.deck-open-toolbar')).opacity, cards:getComputedStyle(document.querySelector('.catalog-workbench')).opacity, inert:document.querySelector('.is-deck-open').inert };
      })()`);
      expect(mid).toEqual({ toolbar: '0', cards: '0', inert: true });
      expect(await evaluate(`(() => {
        const travel = window.galleryAnimations.find(a => a.effect.target.matches('.deck-transition-ghost'));
        travel.currentTime = Number(travel.effect.getTiming().duration);
        const ghost = document.querySelector('.deck-transition-ghost [data-deck-cover="tasks"]').getBoundingClientRect();
        const face = document.querySelector('.deck-neighbor-window > .catalog-deck-cover').getBoundingClientRect();
        return Math.abs(ghost.bottom - face.bottom) < 1;
      })()`)).toBe(true);
      await evaluate(`window.galleryAnimations.forEach(a => a.finish())`);
      await until(`!document.querySelector('.deck-transition-layer') && !document.querySelector('.is-deck-open').inert`);
      expect(await evaluate(`getComputedStyle(document.querySelector('.deck-open-toolbar')).opacity`)).toBe('1');
    } finally { await evaluate(`window.restoreGalleryAnimate()`); }
  });

  it('gallery: touch has no sticky elevation and exposes the settings action', async () => {
    await inTouchMode(async () => {
      await render('app', {}, 375);
      await until(`Boolean(document.querySelector('.catalog-cover-item [data-deck-cover]'))`);
      await evaluate(`document.querySelector('.catalog-cover-item').scrollIntoView({ block:'center', behavior:'instant' })`);
      const point = await evaluate(`(() => { const r=document.querySelector('.catalog-cover-item').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
      await waitForLayout(evaluate, '.catalog-cover-item');
      expect(await evaluate(`(() => {
        const c=document.querySelector('.catalog-cover-item [data-deck-cover]');
        return !matchMedia('(hover: hover)').matches && new DOMMatrixReadOnly(getComputedStyle(c).transform).m42 === 0 && getComputedStyle(c,'::before').content === 'none' && getComputedStyle(document.querySelector('.catalog-cover-settings')).opacity === '1';
      })()`)).toBe(true);
    });
  });

  it('gallery: keyboard dragging suppresses material feedback without losing the sortable handle', async () => {
    await render('app');
    await until(`Boolean(document.querySelector('.catalog-cover-item [data-deck-cover]'))`);
    await evaluate(`document.querySelector('.catalog-cover-item [data-deck-cover]').focus()`);
    for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
    await until(`Boolean(document.querySelector('.catalog-spaces.is-dragging'))`);
    expect(await evaluate(`[...document.querySelectorAll('.catalog-spaces .catalog-cover-item > .catalog-deck-cover')].every(c => getComputedStyle(c).transform === 'none' && getComputedStyle(c,'::before').content === 'none' && getComputedStyle(c,'::after').opacity === '0')`)).toBe(true);
    // 2026-11-10: dnd-kit's keyboard listener is deferred past the first drag commit; do not send Escape before the sensor is ready.
    await evaluate(`new Promise(resolve => setTimeout(resolve, 0))`);
    await waitForLayout(evaluate, '.catalog-spaces.is-dragging .catalog-cover-item');
    await key('Escape');
    await until(`!document.querySelector('.catalog-spaces.is-dragging')`);
    expect(await evaluate(`!document.querySelector('.is-deck-open') && document.querySelectorAll('.catalog-cover-item').length === 2`)).toBe(true);
  });

  it('gallery: reduced motion keeps covers still and opens without a frozen stage', async () => {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    try {
      await render('app');
      await until(`Boolean(document.querySelector('.catalog-cover-item [data-deck-cover]'))`);
      await evaluate(`document.querySelector('.catalog-cover-item [data-deck-cover]').focus()`);
      expect(await evaluate(`getComputedStyle(document.querySelector('.catalog-cover-item [data-deck-cover]')).transform`)).toBe('none');
      await click('.catalog-cover-item [data-deck-cover]');
      expect(await evaluate(`Boolean(document.querySelector('.is-deck-open')) && !document.querySelector('.deck-transition-layer') && !document.querySelector('.is-deck-open').inert`)).toBe(true);
    } finally { await send('Emulation.setEmulatedMedia', { features: [] }); }
  });

  it.each(['en', 'ru'])('%s: phone tabs and Timeline search keep their complete labels', async lang => {
    await render('app', { lang, view: 'timeline' });
    await until(`document.querySelectorAll('.timeline-actions button').length === 3`);
    expect(await evaluate(`document.querySelector('.global-topbar').getBoundingClientRect().height`)).toBeLessThanOrEqual(96);
    await search('card');
    expect(await evaluate(`(() => {
      const canvas=document.createElement('canvas').getContext('2d');
      return [...document.querySelectorAll('.global-tabs button'), document.querySelector('.global-search-field input')].every(e => {
        const s=getComputedStyle(e); canvas.font=s.font;
        return canvas.measureText(e.placeholder ?? e.textContent).width <= e.clientWidth-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight);
      });
    })()`)).toBe(true);
    expect(await evaluate(`document.querySelector('.global-tabs').scrollWidth <= document.querySelector('.global-tabs').clientWidth`)).toBe(true);
    await key('Escape');
    await click('.timeline-tool');
    await until(`Boolean(document.querySelector('.planning-calendar-panel'))`);
    await evaluate(`window.timelineAction=document.querySelector('.timeline-actions button');window.timelineCalendar=document.querySelector('.planning-calendar-panel');void 0`);
    for (const width of [1440, 375]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 812, deviceScaleFactor: 1, mobile: false });
      await until(`document.querySelector('.timeline-actions button') === window.timelineAction && window.timelineAction.isConnected`);
      expect(await evaluate(`document.querySelector('.planning-calendar-panel') === window.timelineCalendar && window.timelineCalendar.isConnected`)).toBe(true);
    }
  });

  it.each([375, 1440])('workspace: visual reference at %s px', async width => {
    for (const theme of ['light', 'dark']) for (const lang of ['en', 'ru']) {
      await workspace({ theme, lang }, width);
      await waitForLayout(evaluate, '.mission-control, .mission-control-workspace-row');
      const layout = await evaluate(`(() => {
        const panel = document.querySelector('.mission-control');
        const nodes = [...panel.querySelectorAll('.mission-control-head, .mission-control-project, .mission-control-workspace-row, .mission-control-sections, .mission-control-menu, .mission-control-foot')];
        return { fits: panel.scrollWidth <= panel.clientWidth, blocks: nodes.map(node => ({
          name: node.className, rect: node.getBoundingClientRect().toJSON(),
        })) };
      })()`);
      expect(layout.fits).toBe(true);
      if (process.env.DECKMATE_PROJECT_SHOTS) {
        const output = process.env.DECKMATE_PROJECT_SHOTS;
        mkdirSync(output, { recursive: true });
        const name = `mission-control-${theme}-${lang}-${width}`;
        const image = await send('Page.captureScreenshot', { format: 'png' });
        writeFileSync(path.join(output, name + '.png'), Buffer.from(image.data, 'base64'));
        writeFileSync(path.join(output, name + '.json'), JSON.stringify(layout, null, 2));
        if (process.env.DECKMATE_PROJECT_BASELINE) {
          const baseline = process.env.DECKMATE_PROJECT_BASELINE;
          expect(layout).toEqual(JSON.parse(readFileSync(path.join(baseline, name + '.json'), 'utf8')));
          const before = readFileSync(path.join(baseline, name + '.png')).toString('base64');
          const diff = await evaluate(`(async () => {
            const load = data => new Promise(resolve => { const image = new Image(); image.onload = () => resolve(image); image.src = 'data:image/png;base64,' + data; });
            const images = await Promise.all([load(${JSON.stringify(before)}), load(${JSON.stringify(image.data)})]);
            const canvas = document.createElement('canvas');
            canvas.width = document.querySelector('.mission-control').clientWidth; canvas.height = innerHeight;
            const context = canvas.getContext('2d', { willReadFrequently: true });
            const pixels = images.map(image => { context.clearRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0); return context.getImageData(0, 0, canvas.width, canvas.height).data; });
            let changed = 0, maxDelta = 0;
            for (let index = 0; index < pixels[0].length; index += 4) {
              const delta = Math.max(...[0, 1, 2, 3].map(channel => Math.abs(pixels[0][index + channel] - pixels[1][index + channel])));
              if (delta) changed++; maxDelta = Math.max(maxDelta, delta);
            }
            return { changed, maxDelta };
          })()`);
          writeFileSync(path.join(output, name + '-diff.json'), JSON.stringify(diff));
          expect.soft(diff, name).toEqual({ changed: 0, maxDelta: 0 });
        }
      }
    }
  });

  it.each([375, 1280])('workspace: localized rows, version and actions fit %s px in both themes', async width => {
    for (const theme of ['light', 'dark']) for (const lang of ['ru', 'en']) {
      await workspace({ theme, lang }, width);
      expect(await evaluate(`document.querySelector('.mission-control-version').textContent`)).toBe(`v${version}`);
      expect(await evaluate(`document.querySelector('.mission-control-workspace h3').textContent`)).toBe(lang === 'ru' ? 'Рабочее пространство' : 'Workspace');
      expect(await evaluate(`document.querySelectorAll('.mission-control-workspace-row').length`)).toBe(4);
      expect(await evaluate(`(() => {
        const panel = document.querySelector('.mission-control');
        const current = document.querySelector('.mission-control-project > .mission-control-project-row');
        const tile = document.querySelector('.mission-control-workspace-row .mission-control-recent-tile').getBoundingClientRect();
        return panel.scrollWidth <= panel.clientWidth && [...document.querySelectorAll('.mission-control-workspace-row')].every(row => {
          const r = row.getBoundingClientRect(), t = row.querySelector('.mission-control-recent-tile').getBoundingClientRect();
          return Math.abs(r.width - current.getBoundingClientRect().width) < 1 && t.left === tile.left && row.scrollWidth <= row.clientWidth;
        });
      })()`)).toBe(true);
      await evaluate(`document.querySelector('.mission-control-workspace-open').focus()`);
      await until(`getComputedStyle(document.querySelector('.mission-control-workspace-remove')).opacity === '1'`);
      expect(await evaluate(`getComputedStyle(document.querySelector('.mission-control-workspace-remove')).opacity`)).toBe('1');
      await click('.mission-control-workspace-open[aria-current="true"]');
      expect(await evaluate('window.shellTest.workspaceCalls')).toEqual([]);
    }
  });

  it('workspace: a scrolled phone menu keeps Close reachable and returns focus to the header', async () => {
    await inTouchMode(async () => {
      for (const theme of ['light', 'dark']) for (const lang of ['en', 'ru']) {
        await workspace({ workspace: shortcutProjects, theme, lang }, 375);
        await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 600, deviceScaleFactor: 1, mobile: false });
        await evaluate(`document.querySelector('.mission-control').scrollTop = 100000`);
        const close = await evaluate(`(() => {
          const menu = document.querySelector('.mission-control'), button = menu.querySelector('.mission-control-head button');
          const r = button.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
          return { x, y, reachable: r.top >= 0 && r.bottom <= innerHeight && button.contains(document.elementFromPoint(x, y)), scrolled: menu.scrollTop > 0 };
        })()`);
        expect(close.reachable && close.scrolled).toBe(true);
        for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: close.x, y: close.y, button: 'left', clickCount: 1 });
        await until(`!document.querySelector('.mission-control') && document.activeElement.matches('.mission-control-trigger')`);
      }
    });
  });

  it('workspace: Ctrl+1…9 label the first nine rows in list order, the current row keeping its place', async () => {
    await workspace({ workspace: shortcutProjects }, 375);
    // The shell menu pins Ctrl+N to the Nth workspace entry, and the bridge returns that order, so the Nth row wears it.
    expect(await evaluate(`[...document.querySelectorAll('.mission-control-workspace-row')]
      .map(row => row.querySelector('.shortcuts-panel-key')?.textContent ?? null)`))
      .toEqual(['Ctrl+1', 'Ctrl+2', 'Ctrl+3', 'Ctrl+4', 'Ctrl+5', 'Ctrl+6', 'Ctrl+7', 'Ctrl+8', 'Ctrl+9', null]);
    expect(await evaluate(`(() => {
      const rows = [...document.querySelectorAll('.mission-control-workspace-row')];
      return [rows[0].querySelector('.mission-control-workspace-open').getAttribute('aria-keyshortcuts'),
        rows[2].querySelector('.mission-control-workspace-open').getAttribute('aria-current'),
        rows[2].querySelector('.shortcuts-panel-key').getAttribute('aria-hidden'),
        rows[9].querySelector('.mission-control-workspace-open').getAttribute('aria-keyshortcuts')];
    })()`)).toEqual(['Control+1 Alt+ArrowUp Alt+ArrowDown', 'true', 'true', 'Alt+ArrowUp Alt+ArrowDown']);
    // The chip is the shortcuts window's keycap, and the tile windows spell the projects' initials in white.
    expect(await evaluate(`(() => {
      const chip = getComputedStyle(document.querySelector('.mission-control-workspace-row .shortcuts-panel-key'));
       const currentTile = document.querySelector('.mission-control-project > .mission-control-project-row .mission-control-recent-tile');
      const rowTile = document.querySelector('.mission-control-workspace-row .mission-control-recent-tile');
      const window = getComputedStyle(rowTile, '::before');
       return [chip.textTransform, chip.borderTopStyle, chip.backgroundImage, currentTile,
        rowTile.getAttribute('data-initials'), window.color, window.fontSize];
     })()`)).toEqual(['uppercase', 'solid', 'none', null, 'ДР', 'rgb(255, 255, 255)', '10px']);
    // Phone width: the chip clears the remove button, the current mark and the two-line clamped name.
    expect(await workspaceLayoutFailures()).toEqual([]);
    await click('.mission-control-workspace-row:nth-child(3) .mission-control-workspace-open');
    expect(await evaluate('window.shellTest.workspaceCalls')).toEqual([]);
  });

  it.each([375, 1280])('workspace: long names and wide fallback fonts keep shortcuts and the current mark clear at %s px', async width => {
    const projects = shortcutProjects.map((project, index) => ({ ...project,
      name: index % 2 ? 'WWЖЩ'.repeat(24) : project.name,
    }));
    // 2026-11-10: fallback font metrics must not let long names borrow the keycap or current mark's space.
    await evaluate(`(() => {
      const style = document.createElement('style'); style.id = 'workspace-wide-font-test';
      style.textContent = '.mission-control-workspace-row { --font-sans: "DejaVu Sans", Verdana, sans-serif; font-family: var(--font-sans); }';
      document.head.append(style);
    })()`);
    try {
      await workspace({ workspace: projects }, width);
      await waitForLayout(evaluate, '.mission-control-workspace-row');
      expect(await workspaceLayoutFailures()).toEqual([]);
    } finally { await evaluate(`document.getElementById('workspace-wide-font-test').remove()`); }
  });

  it('workspace: touch exposes remove actions in place of the current mark without overlapping phone shortcuts', async () => {
    await inTouchMode(async () => {
      await workspace({}, 375);
      expect(await evaluate(`matchMedia('(hover: none)').matches`)).toBe(true);
      expect(await evaluate(`getComputedStyle(document.querySelector('.mission-control-workspace-current')).display`)).toBe('none');
      expect(await evaluate(`[...document.querySelectorAll('.mission-control-workspace-row')].every(row => {
        const remove = row.querySelector('.mission-control-workspace-remove');
        const button = remove.getBoundingClientRect();
        const chip = row.querySelector('.shortcuts-panel-key').getBoundingClientRect();
        const name = row.querySelector('.mission-control-workspace-copy strong').getBoundingClientRect();
        return getComputedStyle(remove).opacity === '1' && chip.right <= button.left - 2
          && name.right <= chip.left + 1 && name.height <= 40 && row.scrollWidth <= row.clientWidth;
      })`)).toBe(true);
    });
  });

  it('workspace: empty state adds current, dialog and recent projects only on request', async () => {
    await workspace({ workspace: [] });
    expect(await evaluate(`document.querySelector('.mission-control-workspace-empty').textContent`)).toBe('Pin the projects you work on and switch between them in one click.');
    expect(await evaluate('window.shellTest.workspaceCalls')).toEqual([]);
    await addMenu();
    await menuItem('Add current project');
    await until(`document.querySelectorAll('.mission-control-workspace-row').length === 1`);
    await addMenu();
    expect(await evaluate(`document.querySelector('.mission-control-workspace-menu').textContent.includes('Add current project')`)).toBe(false);
    await menuItem('Choose folder…');
    await until(`document.querySelectorAll('.mission-control-workspace-row').length === 2`);
    await addMenu();
    await until(`Boolean(document.querySelector('.mission-control-workspace-recent'))`);
    await evaluate(`[...document.querySelectorAll('.mission-control-workspace-recent')].find(e => e.textContent.includes('Field Notes')).click()`);
    await until(`document.querySelectorAll('.mission-control-workspace-row').length === 3`);
    expect(await evaluate('window.shellTest.workspaceCalls')).toEqual([
      { method: 'add', args: [{ kind: 'current' }] }, { method: 'add', args: [{ kind: 'dialog' }] },
      { method: 'add', args: [{ kind: 'recent', path: 'C:\\Work\\Field Notes' }] },
    ]);
    expect(await evaluate(`document.querySelector('.mission-control-workspace-empty') === null`)).toBe(true);
    expect(await evaluate(`document.querySelector('.mission-control-workspace-menu') === null`)).toBe(true);
  });

  it('workspace: mutations render the authoritative shell list, including its order and flags', async () => {
    await workspace({ workspace: [] });
    const authoritative = [{ path: 'C:\\Returned', name: 'Returned by shell', current: false, missing: true }];
    await evaluate(`window.shellTest.setWorkspaceResult({ ok: true, projects: ${JSON.stringify(authoritative)}, current: null })`);
    await addMenu();
    await menuItem('Add current project');
    await until(`document.querySelector('.mission-control-workspace-open')?.textContent.includes('Returned by shell')`);
    expect(await evaluate(`document.querySelectorAll('.mission-control-workspace-row').length`)).toBe(1);
    expect(await evaluate(`document.querySelector('.mission-control-workspace-missing').textContent`)).toBe('Folder not found');
    expect(await evaluate(`document.querySelector('.mission-control-workspace-open').getAttribute('aria-current')`)).toBeNull();
    await addMenu();
    expect(await evaluate(`document.querySelector('.mission-control-workspace-menu').textContent.includes('Add current project')`)).toBe(false);
  });

  it('workspace: a pending native dialog disables actions and restores focus after cancellation', async () => {
    await workspace({ workspace: [] });
    await evaluate(`window.deckmateBoard.addToWorkspace = () => new Promise(resolve => { window.finishWorkspace = resolve; })`);
    await addMenu(); await menuItem('Choose folder…');
    expect(await evaluate(`document.querySelector('.mission-control-workspace-add').disabled && document.querySelector('.mission-control-recent-open').disabled`)).toBe(true);
    expect(await evaluate(`Boolean(document.querySelector('.mission-control-workspace-actions .spin'))`)).toBe(true);
    expect(await evaluate(`document.querySelector('.mission-control-workspace-menu') === null`)).toBe(true);
    await evaluate(`window.finishWorkspace({ ok: false, code: 'cancelled' })`);
    await until(`!document.querySelector('.mission-control-workspace-add').disabled`);
    expect(await evaluate(`document.activeElement === document.querySelector('.mission-control-workspace-add')`)).toBe(true);
    await addMenu();
    await key('Escape');
  });

  it('workspace: a full list stays bounded, honors reduced motion and frees a slot on removal', async () => {
    const projects = Array.from({ length: 30 }, (_, index) => ({ path: `C:\\Work\\Project ${index}`, name: `Project ${index}`, current: false, missing: false }));
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    try {
      await render('app', { workspace: projects }, 1280);
      await click('.mission-control-trigger');
      await until(`document.querySelectorAll('.mission-control-workspace-row').length === 30`);
      expect(await evaluate(`document.querySelector('.mission-control-workspace-add').disabled`)).toBe(true);
      expect(await evaluate(`getComputedStyle(document.querySelector('.mission-control')).animationName`)).toBe('none');
      expect(await evaluate(`(() => { const list = document.querySelector('.mission-control-workspace-list'); return list.scrollHeight > list.clientHeight && list.clientHeight <= 306; })()`)).toBe(true);
      await click('.mission-control-workspace-row:last-child .mission-control-workspace-remove');
      await until(`!document.querySelector('.mission-control-workspace-add').disabled`);
      expect(await evaluate(`document.querySelectorAll('.mission-control-workspace-row').length`)).toBe(29);
    } finally { await send('Emulation.setEmulatedMedia', { features: [] }); }
  });

  it('workspace: missing folders ask the shell to revalidate and can be removed with focus on the next row', async () => {
    await workspace();
    await evaluate(`window.shellTest.setNavigationFailure('missing')`);
    await click('.mission-control-workspace-row.is-missing .mission-control-workspace-open');
    expect(await evaluate('window.shellTest.workspaceCalls')).toEqual([{ method: 'switch', args: ['E:\\Archive\\Lost project'] }]);
    await click('.mission-control-workspace-row.is-missing .mission-control-workspace-remove');
    await until(`document.querySelectorAll('.mission-control-workspace-row').length === 3`);
    expect(await evaluate('window.shellTest.workspaceCalls')).toEqual([
      { method: 'switch', args: ['E:\\Archive\\Lost project'] }, { method: 'remove', args: ['E:\\Archive\\Lost project'] },
    ]);
    expect(await evaluate(`document.activeElement === document.querySelectorAll('.mission-control-workspace-open')[2]`)).toBe(true);
  });

  it('workspace: Alt+arrows reorder the focused current row and keep focus, without switching', async () => {
    await workspace();
    await evaluate(`document.querySelector('.mission-control-workspace-open').focus()`);
    await altMove('ArrowUp');
    expect(await evaluate('window.shellTest.workspaceCalls')).toEqual([]);
    await altMove('ArrowDown');
    expect(await evaluate(`document.querySelectorAll('.mission-control-workspace-open')[1].getAttribute('aria-current')`)).toBe('true');
    expect(await evaluate(`document.activeElement === document.querySelectorAll('.mission-control-workspace-open')[1]`)).toBe(true);
    await altMove('ArrowUp');
    expect(await evaluate('window.shellTest.workspaceCalls')).toEqual([
      { method: 'move', args: ['C:\\Work\\Shell test', 1] }, { method: 'move', args: ['C:\\Work\\Shell test', 0] },
    ]);
    expect(await evaluate(`[...document.querySelectorAll('.mission-control-workspace [role="status"]')].some(e => e.textContent.includes('position 1 of 4'))`)).toBe(true);
  });

  it('workspace: focus refresh restores a missing folder in place without discarding the list scroll anchor', async () => {
    await workspace();
    await evaluate(`(() => {
      const list = document.querySelector('.mission-control-workspace-list'); list.scrollTop = 100;
      window.projectScroll = list.scrollTop; window.missingProjectRow = list.querySelector('.is-missing');
      const original = window.deckmateBoard.workspaceProjects;
      window.deckmateBoard.workspaceProjects = async () => {
        const result = await original();
        return { ...result, projects: result.projects.map(project => ({ ...project, missing: false })) };
      };
      window.dispatchEvent(new Event('focus'));
    })()`);
    await until(`!window.missingProjectRow.classList.contains('is-missing')`);
    expect(await evaluate(`window.missingProjectRow.isConnected && document.querySelector('.mission-control-workspace-list').scrollTop === window.projectScroll`)).toBe(true);
    await click('.mission-control-workspace-row:last-child .mission-control-workspace-open');
    expect(await evaluate('window.shellTest.workspaceCalls')).toEqual([{ method: 'switch', args: ['E:\\Archive\\Lost project'] }]);
  });

  it('workspace: pointer dragging reorders without opening a project', async () => {
    await workspace();
    const points = await evaluate(`[...document.querySelectorAll('.mission-control-workspace-open')].slice(0, 2).map(e => { const r = e.getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 }; })`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...points[0] });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...points[0], button: 'left', buttons: 1, clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: points[0].x, y: points[0].y + 10, buttons: 1 });
    await until(`Boolean(document.querySelector('.mission-control-workspace-row.is-dragging'))`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...points[1], buttons: 1 });
    await waitForLayout(evaluate, '.mission-control-workspace-row');
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...points[1], button: 'left', buttons: 0, clickCount: 1 });
    await until(`window.shellTest.workspaceCalls.length === 1`);
    // 2026-11-13: complete the accepted move and drop animation before remounting; its sensor still suppresses the drop's click.
    await until(`document.querySelector('.mission-control-workspace-list').getAttribute('aria-busy') === 'false'`);
    await waitForLayout(evaluate, '.mission-control-workspace-row');
    expect(await evaluate(`document.querySelectorAll('.mission-control-workspace-open')[1].getAttribute('aria-current')`)).toBe('true');
    expect(await evaluate('window.shellTest.workspaceCalls')).toEqual([{ method: 'move', args: ['C:\\Work\\Shell test', 1] }]);
  });

  it('workspace: selecting a path preserves its text without reordering or switching projects', async () => {
    await workspace();
    const target = '.mission-control-workspace-row:nth-child(2) .mission-control-workspace-path';
    await evaluate(`document.querySelector('${target}').scrollIntoView({block:'center'})`);
    await waitForLayout(evaluate, target);
    const expected = await evaluate(`document.querySelector('${target}').textContent`);
    expect(await evaluate(`getComputedStyle(document.querySelector('${target}')).userSelect`)).toBe('text');
    const points = await evaluate(`(() => {
      const range = document.createRange(); range.selectNodeContents(document.querySelector('${target} bdi'));
      const rects = [...range.getClientRects()];
      return [rects[0], rects.at(-1)].map((rect, index) => ({ x: index ? rect.right - 1 : rect.left + 1, y: rect.top + rect.height / 2 }));
    })()`);
    const [start, end] = points;
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...start });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...start, button: 'left', buttons: 1, clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...end, button: 'left', buttons: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...end, button: 'left', buttons: 0, clickCount: 1 });
    expect(await evaluate(`getSelection().toString()`)).toBe(expected);
    expect(await evaluate(`document.querySelector('.mission-control-workspace-list').hasAttribute('data-dragging')`)).toBe(false);
    expect(await evaluate('window.shellTest.workspaceCalls')).toEqual([]);
    await evaluate(`getSelection().removeAllRanges()`);
  });

  it('workspace: cancel is silent, rejected edits keep the list, and retry recovers', async () => {
    await workspace({ workspace: [] });
    await evaluate(`window.shellTest.setWorkspaceResult({ ok: false, code: 'cancelled' })`);
    await addMenu(); await menuItem('Choose folder…');
    expect(await evaluate(`document.querySelector('.mission-control-workspace [role="alert"]') === null`)).toBe(true);
    await evaluate(`window.shellTest.setWorkspaceResult('throw')`);
    await addMenu(); await menuItem('Choose folder…');
    await until(`Boolean(document.querySelector('.mission-control-workspace [role="alert"]'))`);
    expect(await evaluate(`document.querySelector('.mission-control-workspace [role="alert"]').textContent`)).toContain('Could not update');
    expect(await evaluate(`Boolean(document.querySelector('.mission-control-workspace-empty'))`)).toBe(true);
    await evaluate(`window.shellTest.setWorkspaceResult(null)`);
    await addMenu(); await menuItem('Choose folder…');
    await until(`document.querySelectorAll('.mission-control-workspace-row').length === 1`);
    expect(await evaluate(`document.querySelector('.mission-control-workspace [role="alert"]') === null`)).toBe(true);
  });

  it('workspace: a failed load can retry; failed recents do not block choosing a folder', async () => {
    await render('app', { workspace: true }, 1280);
    await evaluate('window.shellTest.setWorkspaceLoadFails(true)');
    await click('.mission-control-trigger');
    await until(`Boolean(document.querySelector('.mission-control-workspace [role="alert"]'))`);
    expect(await evaluate(`document.querySelector('.mission-control-workspace-empty') === null`)).toBe(true);
    await evaluate('window.shellTest.setWorkspaceLoadFails(false)');
    await click('.mission-control-retry');
    await until(`document.querySelectorAll('.mission-control-workspace-row').length === 4`);
    await evaluate('window.shellTest.setRecentFails(true)');
    await addMenu();
    await until(`Boolean(document.querySelector('.mission-control-workspace-menu [role="alert"]'))`);
    await menuItem('Choose folder…');
    await until(`document.querySelectorAll('.mission-control-workspace-row').length === 5`);
  });

  it('workspace: recent choices deduplicate Windows paths case-insensitively and Escape restores focus', async () => {
    await workspace({ workspace: [{ path: 'c:\\work\\FIELD NOTES', name: 'Pinned notes', current: false, missing: false }] });
    await addMenu();
    await until(`Boolean(document.querySelector('.mission-control-workspace-recent'))`);
    expect(await evaluate(`document.querySelector('.mission-control-workspace-menu').textContent.includes('Field Notes')`)).toBe(false);
    await key('Escape');
    expect(await evaluate(`Boolean(document.querySelector('.mission-control')) && !document.querySelector('.mission-control-workspace-menu')`)).toBe(true);
    expect(await evaluate(`document.activeElement === document.querySelector('.mission-control-workspace-add')`)).toBe(true);
  });

  it('workspace: switching and start-screen errors recover, successful switching keeps its spinner', async () => {
    await workspace();
    await evaluate(`window.shellTest.setNavigationFailure('missing')`);
    await click('.mission-control-workspace-row:nth-child(2) .mission-control-workspace-open');
    await until(`Boolean(document.querySelector('.mission-control-workspace [role="alert"]'))`);
    expect(await evaluate(`document.querySelector('.mission-control-workspace [role="alert"]').textContent`)).toContain('not found');
    await click('.mission-control-recent-open');
    expect(await evaluate(`document.querySelector('.mission-control-workspace [role="alert"]').textContent`)).toContain('not found');
    await evaluate(`window.shellTest.setNavigationFailure('unknown')`);
    await click('.mission-control-recent-open');
    expect(await evaluate(`document.querySelector('.mission-control-workspace [role="alert"]').textContent`)).toContain('Could not open the start screen');
    await evaluate(`window.shellTest.setNavigationFailure(null)`);
    await click('.mission-control-workspace-row:nth-child(2) .mission-control-workspace-open');
    await until(`Boolean(document.querySelector('.mission-control-workspace-open[aria-busy="true"] .spin'))`);
    expect(await evaluate(`document.querySelector('.mission-control-workspace-add').disabled && document.querySelector('.mission-control-recent-open').disabled`)).toBe(true);
  });

  it('workspace: structured list failures remain retryable and never become empty successful lists', async () => {
    await render('app', { workspace: true }, 1280);
    await evaluate(`window.shellTest.setWorkspaceLoadFails('forbidden')`);
    await click('.mission-control-trigger');
    await until(`Boolean(document.querySelector('.mission-control-workspace [role="alert"]'))`);
    expect(await evaluate(`document.querySelector('.mission-control-workspace-empty') === null`)).toBe(true);
    await evaluate(`window.shellTest.setWorkspaceLoadFails(false)`);
    await click('.mission-control-retry');
    await until(`document.querySelectorAll('.mission-control-workspace-row').length === 4`);
    await evaluate(`window.shellTest.setRecentFails('forbidden')`);
    await addMenu();
    await until(`Boolean(document.querySelector('.mission-control-workspace-menu [role="alert"]'))`);
    expect(await evaluate(`document.querySelectorAll('.mission-control-workspace-recent').length`)).toBe(0);
    await evaluate(`window.shellTest.setRecentFails(false)`);
    await menuItem('Try again');
    await until(`document.querySelectorAll('.mission-control-workspace-recent').length === 1`);
  });

  it.each(['en', 'ru'])('D14: %s intentional Stop hides late reconnect failures', async lang => {
    await render('app', { lang });
    await click('.mission-control-trigger');
    await click('.mission-control-menu .is-destructive');
    await until(`Boolean(document.querySelector('.empty-state h1'))`);
    await expectPageStateDuring(evaluate, `document.querySelector('.empty-state h1') && !document.querySelector('.error-banner')`, 1800);
    expect(await evaluate(`document.querySelector('.empty-state h1').textContent`)).toBe(lang === 'en' ? 'Deckmate is stopped' : 'Deckmate остановлен');
    expect(await evaluate(`window.shellTest.shutdownCalls`)).toBe(1);
    expect(await evaluate(`document.querySelector('.error-banner') === null`)).toBe(true);
    const notificationCalls = await evaluate('window.shellTest.notificationCalls');
    await click('.mission-control-trigger');
    await evaluate(`document.querySelectorAll('.mission-control-menu button')[3].click()`);
    await click('.mission-control-head button');
    expect(await evaluate(`document.querySelector('.notifications-error') === null`)).toBe(true);
    expect(await evaluate('window.shellTest.notificationCalls')).toBe(notificationCalls);
  });

  it('D14: an unexpected disconnect and a rejected Stop remain visible errors', async () => {
    await render();
    await evaluate('window.shellTest.disconnect()');
    await until(`Boolean(document.querySelector('.error-banner'))`);
    expect(await evaluate(`document.querySelector('.error-banner').textContent`)).toContain('Could not connect to Deckmate');
    expect(await evaluate(`document.querySelector('.empty-state h1') === null`)).toBe(true);
    await render('app', { failShutdown: true });
    await click('.mission-control-trigger');
    await click('.mission-control-menu .is-destructive');
    await until(`Boolean(document.querySelector('.error-banner'))`);
    expect(await evaluate(`document.querySelector('.error-banner').textContent`)).toContain('Shutdown refused');
    expect(await evaluate(`document.querySelector('.empty-state h1') === null`)).toBe(true);
  });

  it.each(['Escape', 'close', 'cancel'])('returns focus from Run to More after %s, not to the last direct bulk action', async close => {
    await render('bulk', {}, 1280);
    await click('.bulk-action-button[aria-label="Owner"]');
    await until(`Boolean(document.querySelector('.bulk-actions-dialog'))`);
    await key('Escape');
    await until(`!document.querySelector('.bulk-actions-dialog')`);
    // A programmatic/menu activation need not deliver a focus event to the trigger.
    await evaluate(`document.querySelector('.bulk-actions button[aria-label="More actions"]').dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true}))`);
    await until(`Boolean(document.querySelector('.bulk-more-menu'))`);
    await evaluate(`[...document.querySelectorAll('.bulk-more-item')].find(e=>e.textContent==='Run').click()`);
    await until(`Boolean(document.querySelector('.bulk-actions-dialog select'))`);
    if (close === 'Escape') await key('Escape');
    else await click(close === 'close' ? '.bulk-actions-dialog button[aria-label="Close bulk action"]' : '.bulk-dialog-footer button[type="button"]');
    await until(`!document.querySelector('.bulk-actions-dialog')`);
    await until(`document.activeElement === document.querySelector('.bulk-actions button[aria-label="More actions"]')`);
    await until(`!document.querySelector('.bulk-more-menu')`);
    expect(await evaluate(`document.querySelector('.bulk-more-menu') === null`)).toBe(true);
  }, 15000);

  it('keeps four frequent selection actions and groups the rest without duplicate commands', async () => {
    await render('bulk', { selectionCount: 21 }, 1440);
    expect(await evaluate(`[...document.querySelectorAll('.card-selection-buttons button')].filter(button => button.getClientRects().length > 0).map(button => button.getAttribute('aria-label'))`))
      .toEqual(['Move to Deck', 'Owner', 'Tags', 'More actions', 'Copy refs']);
    await evaluate(`document.querySelector('.bulk-actions [aria-label="More actions"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
    await until(`Boolean(document.querySelector('.bulk-more-menu'))`);
    expect(await evaluate(`[...document.querySelectorAll('.bulk-more-heading')].map(node => node.textContent)`)).toEqual(['Organization', 'Properties', 'Export', 'Lifecycle']);
    const labels = await evaluate(`[...document.querySelectorAll('.bulk-more-item')].map(node => node.textContent)`);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).not.toContain('Owner');
    expect(labels).not.toContain('Tags');
    expect(labels).toContain('Add to Track');
  });

  it.each([1, 21, 1000])('prioritizes the full count %i at 375px and keeps overflow commands reachable', async count => {
    await render('bulk', { selectionCount: count, lang: 'ru' }, 375);
    await until(`document.querySelectorAll('.bulk-action-button').length === 0`);
    const fit = await evaluate(`(() => { const count = document.querySelector('.card-selection-count');
      const r = count.getBoundingClientRect(); const bar = document.querySelector('.card-selection-bar');
      return { text: count.textContent, clipped: count.scrollWidth > count.clientWidth, right: r.right, overflow: bar.scrollWidth - bar.clientWidth,
        allVisible: document.querySelector('.card-selection-all').getClientRects().length > 0 }; })()`);
    expect(fit.text).toBe('Выбрано ' + new Intl.NumberFormat('ru-RU').format(count));
    expect(fit.clipped).toBe(false);
    expect(fit.right).toBeLessThan(375);
    expect(fit.overflow).toBe(0);
    expect(fit.allVisible).toBe(false);
    await evaluate(`document.querySelector('.bulk-actions [aria-label="Ещё действия"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
    await until(`Boolean(document.querySelector('.bulk-more-menu'))`);
    const labels = await evaluate(`[...document.querySelectorAll('.bulk-more-item')].map(node => node.textContent)`);
    expect(labels).toContain('Выбрать все');
    expect(labels).toContain('Скопировать ссылки');
    expect(labels).toContain('Исполнитель');
  });

  it.each([true, false])('adds a Track through the shared bulk dialog and retains failed forms (%s)', async success => {
    await render('bulk', { selectionCount: 2, bulkResult: success }, 1280);
    await evaluate(`document.querySelector('.bulk-actions [aria-label="More actions"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
    await until(`Boolean(document.querySelector('.bulk-more-menu'))`);
    await evaluate(`[...document.querySelectorAll('.bulk-more-item')].find(node => node.textContent === 'Add to Track').click()`);
    await until(`Boolean(document.querySelector('.bulk-actions-dialog .bulk-pick-option'))`);
    await click('.bulk-pick-option');
    await click('.bulk-dialog-footer button[type="submit"]');
    await until('window.shellTest.bulkChanges.length === 1');
    expect(await evaluate('window.shellTest.bulkChanges')).toEqual([{ kind: 'track', trackId: 'release', mode: 'add' }]);
    expect(await evaluate(`Boolean(document.querySelector('.bulk-actions-dialog'))`)).toBe(!success);
    if (!success) expect(await evaluate(`document.querySelector('.bulk-pick-option').getAttribute('aria-pressed')`)).toBe('true');
  });

  it.each([540, 560, 580])('keeps overflow commands available at the container breakpoint (%i px)', async width => {
    await render('bulk', { selectionCount: 2 }, width);
    const visible = await evaluate(`({ all: document.querySelector('.card-selection-all').getClientRects().length > 0,
      copy: document.querySelector('.card-selection-copy').getClientRects().length > 0,
      owner: Boolean(document.querySelector('.bulk-action-button[aria-label="Owner"]')) })`);
    await evaluate(`document.querySelector('.bulk-actions [aria-label="More actions"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
    await until(`Boolean(document.querySelector('.bulk-more-menu'))`);
    const labels = await evaluate(`[...document.querySelectorAll('.bulk-more-item')].map(node => node.textContent)`);
    expect(labels.includes('Select all')).toBe(!visible.all);
    expect(labels.includes('Copy refs')).toBe(!visible.copy);
    expect(labels.includes('Owner')).toBe(!visible.owner);
  });

  it('returns focus to More if a direct dialog opener disappears after resizing', async () => {
    await render('bulk', { selectionCount: 2 }, 1280);
    await click('.bulk-action-button[aria-label="Owner"]');
    await until(`Boolean(document.querySelector('.bulk-actions-dialog'))`);
    await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: false });
    await until(`!document.querySelector('.bulk-action-button')`);
    await key('Escape');
    await until(`!document.querySelector('.bulk-actions-dialog') && document.activeElement.matches('.bulk-actions [aria-label="More actions"]')`);
  });

  it.each([375, 1440])('fills the reserved selection slot without moving results at %i px', async width => {
    for (const theme of ['light', 'dark']) {
      await render('app', { deck: true, lang: 'ru', theme }, width);
      await until(`Boolean(document.querySelector('.deck-table-select input'))`);
      await waitForLayout(evaluate, '.deck-open-toolbar, .catalog-results');
      const before = await evaluate(`document.querySelector('.catalog-results').getBoundingClientRect().top`);
      await click('.deck-table-select input');
      await until(`Boolean(document.querySelector('.deck-selection-slot .card-selection-bar'))`);
      await waitForLayout(evaluate, '.deck-open-toolbar, .card-selection-bar, .catalog-results');
      const selected = await evaluate(`(() => { const toolbar = document.querySelector('.deck-open-toolbar').getBoundingClientRect();
        const bar = document.querySelector('.card-selection-bar').getBoundingClientRect();
        return { top: bar.top - toolbar.top, bottom: toolbar.bottom - bar.bottom,
          results: document.querySelector('.catalog-results').getBoundingClientRect().top,
          overflow: document.querySelector('.card-selection-bar').scrollWidth - document.querySelector('.card-selection-bar').clientWidth }; })()`);
      expect(selected.top).toBe(0);
      expect(selected.bottom).toBe(0);
      expect(selected.overflow).toBe(0);
      expect(selected.results).toBe(before);
      await key('Escape');
      await until(`!document.querySelector('.card-selection-bar')`);
      expect(await evaluate(`document.querySelector('.catalog-results').getBoundingClientRect().top`)).toBe(before);
    }
  });

  it.each(['en', 'ru'])('shows the HTTP 422 reason and requested card names without losing selection (%s)', async lang => {
    await render('app', { deck: true, lang, bulkStateRefusal: true }, 375);
    await until(`document.querySelectorAll('.deck-table-select input').length >= 2`);
    await evaluate(`[...document.querySelectorAll('.deck-table-select input')].slice(0, 2).forEach(input => input.click())`);
    await until(`document.querySelector('.card-selection-count')?.textContent.includes('2')`);
    await evaluate(`document.querySelector('.bulk-actions [aria-label="${lang === 'ru' ? 'Ещё действия' : 'More actions'}"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
    await until(`Boolean(document.querySelector('.bulk-more-menu'))`);
    await evaluate(`[...document.querySelectorAll('.bulk-more-item')].find(node => node.textContent === '${lang === 'ru' ? 'Принять' : 'Done'}').click()`);
    await until(`Boolean(document.querySelector('.bulk-actions-dialog'))`);
    await click('.bulk-dialog-footer button[type="submit"]');
    await until(`window.shellTest.bulkChanges.length === 1 && Boolean(document.querySelector('.bulk-actions-dialog [role="alert"]'))`);
    const result = await evaluate(`({ message: document.querySelector('.bulk-actions-dialog [role="alert"]').textContent,
      checked: document.querySelectorAll('.deck-table-select input:checked').length,
      count: document.querySelector('.card-selection-count').textContent })`);
    expect(result.message).toContain(lang === 'ru' ? 'Агент не может принять собственную работу' : 'An agent cannot accept its own work');
    expect(result.message).toContain('Task 0');
    expect(result.message).toContain('Task 1');
    expect(result.checked).toBe(2);
    expect(result.count).toContain('2');
    expect(await evaluate('window.shellTest.bulkChanges')).toEqual([{ kind: 'state', state: 'done' }]);
    await key('Escape');
    expect(await evaluate(`document.querySelectorAll('.deck-table-select input:checked').length`)).toBe(2);
    expect(await evaluate(`document.activeElement.matches('.bulk-actions button')`)).toBe(true);
  });

  it.each(['light', 'dark'])('keeps the bulk header and actions inside a short touch viewport (%s)', async theme => {
    // 2026-11-11: a separate page keeps touch emulation and popup focus independent of preceding desktop dialogs.
    const touch = createBrowserSession();
    try {
      await touch.open(browserPath!, { viewport: { width: 375, height: 600, scale: 1 } });
      await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
      await touch.navigate('shell-ui', `Boolean(window.shellTest)`);
      await touch.evaluate(`window.shellTest.render('bulk', { selectionCount: 2, lang: 'ru', theme: '${theme}' })`);
      await touch.until(`Boolean(document.querySelector('.card-selection-bar'))`);
      await waitForLayout(touch.evaluate, '.card-selection-bar, .bulk-actions');
      await touch.evaluate(`document.querySelector('.bulk-actions [aria-label="Ещё действия"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
      await touch.until(`Boolean(document.querySelector('.bulk-more-menu'))`);
      await touch.evaluate(`(() => { const item = [...document.querySelectorAll('.bulk-more-item')].find(node => node.textContent === 'Экспорт CSV');
        item.scrollIntoView({ block: 'nearest' }); item.focus(); })()`);
      for (const type of ['keyDown', 'keyUp']) await touch.send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: type === 'keyDown' ? '\r' : undefined });
      await touch.until(`Boolean(document.querySelector('.bulk-actions-dialog'))`);
      await waitForLayout(touch.evaluate, '.bulk-actions-dialog');
      const fit = await touch.evaluate(`(() => { const panel = document.querySelector('.bulk-actions-dialog').getBoundingClientRect();
        const head = document.querySelector('.bulk-dialog-header').getBoundingClientRect();
        const foot = document.querySelector('.bulk-dialog-footer').getBoundingClientRect();
        const clear = document.querySelector('.card-selection-clear').getBoundingClientRect();
        return { panel: [panel.top, panel.bottom], head: [head.top, head.bottom], foot: [foot.top, foot.bottom], clear: [clear.width, clear.height],
          scrolls: document.querySelector('.bulk-dialog-body').scrollHeight > document.querySelector('.bulk-dialog-body').clientHeight }; })()`);
      expect(fit.panel[0]).toBeGreaterThanOrEqual(12);
      expect(fit.panel[1]).toBeLessThanOrEqual(588);
      expect(fit.head[0]).toBeGreaterThanOrEqual(fit.panel[0]);
      expect(fit.foot[1]).toBeLessThanOrEqual(fit.panel[1]);
      expect(fit.clear).toEqual([44, 44]);
      expect(fit.scrolls).toBe(true);
      for (const type of ['keyDown', 'keyUp']) await touch.send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await touch.until(`!document.querySelector('.bulk-actions-dialog') && document.activeElement.matches('.bulk-actions [aria-label="Ещё действия"]')`);
      expect(touch.errors).toEqual([]);
    } finally { await touch.close(); }
  });

  it('reserves a 44px repeat-creation target between Save and the band on touch', async () => {
    const touch = createBrowserSession();
    try {
      await touch.open(browserPath!, { viewport: { width: 375, height: 900, scale: 1 } });
      await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
      await touch.navigate('shell-ui', `Boolean(window.shellTest)`);
      await touch.evaluate(`window.shellTest.render('app', { deck: true, lang: 'ru' })`);
      await touch.until(`Boolean(document.querySelector('.deck-action-rail [aria-label="Новая карточка"]'))`);
      await touch.evaluate(`document.querySelector('.deck-action-rail [aria-label="Новая карточка"]').click()`);
      await touch.until(`Boolean(document.querySelector('.card-composer-again label'))`);
      await waitForLayout(touch.evaluate, '.card-composer, .card-composer-again, .card-edit-save');
      const target = await touch.evaluate(`(() => { const label = document.querySelector('.card-composer-again label').getBoundingClientRect();
        const save = document.querySelector('.card-edit-save').getBoundingClientRect();
        const band = document.querySelector('.card-composer-band').getBoundingClientRect();
        const toggle = document.querySelector('.card-composer-again [role="switch"]'), track = toggle.getBoundingClientRect();
        const face = getComputedStyle(toggle, '::before');
        return { height: label.height, saveBottom: save.bottom, top: label.top, bottom: label.bottom, bandTop: band.top,
          track: [track.width, track.height], face: [face.width, face.height], editor: document.querySelector('.card-edit-text').getBoundingClientRect().height,
          fits: document.querySelector('.card-composer-again .deck-panel-switch-row').scrollWidth <= document.querySelector('.card-composer-again .deck-panel-switch-row').clientWidth }; })()`);
      expect(target.height).toBeGreaterThanOrEqual(44);
      expect(target.top).toBeGreaterThanOrEqual(target.saveBottom);
      expect(target.bottom).toBeLessThanOrEqual(target.bandTop);
      expect(target.track).toEqual([44, 44]);
      expect(target.face).toEqual(['28px', '12px']);
      expect(target.editor).toBeGreaterThanOrEqual(360);
      expect(target.fits).toBe(true);
      await touch.evaluate(`document.querySelector('.card-composer-again label').click()`);
      expect(await touch.evaluate(`document.querySelector('.card-composer-again [role="switch"]').getAttribute('aria-checked')`)).toBe('true');
      await touch.evaluate(`document.querySelector('.card-composer .card-preview-action-rail button').click()`);
      await touch.until(`Boolean(document.querySelector('.card-composer-settings:not([hidden])'))`);
      expect(await touch.evaluate(`[...document.querySelectorAll('.card-composer-settings .catalog-field :is(select, input)')].every(field => field.getBoundingClientRect().height >= 44)`)).toBe(true);
      expect(touch.errors).toEqual([]);
    } finally { await touch.close(); }
  });

  it('NW-01/DW-02/DW-07: shelf buttons stay inside the rail and Table keeps one thin workspace scrollport', async () => {
    await render('app', { deck: true });
    await until(`Boolean(document.querySelector('.deck-neighbor-rail'))`);
    expect(await evaluate(`(() => { const rail=document.querySelector('.deck-neighbor-rail').getBoundingClientRect(); return [...document.querySelectorAll('.deck-neighbor-rail > button')].every(e=>{const r=e.getBoundingClientRect();return r.top>=rail.top && r.bottom<=rail.bottom && getComputedStyle(e.querySelector('.deck-neighbor-window')).overflow==='hidden';}); })()`)).toBe(true);
    await click('.catalog-table-title');
    await until(`Boolean(document.querySelector('.card-preview'))`);
    expect(await evaluate(`document.documentElement.scrollHeight === innerHeight`)).toBe(true);
    expect(await evaluate(`document.querySelector('.workspace-main').scrollHeight > document.querySelector('.workspace-main').clientHeight`)).toBe(true);
    expect(await evaluate(`getComputedStyle(document.querySelector('.workspace-main'),'::-webkit-scrollbar').width`)).toBe('6px');
    expect(await evaluate(`getComputedStyle(document.querySelector('.workspace-main'),'::-webkit-scrollbar-button').display`)).toBe('none');
    await click('.deck-action-rail button[aria-label="Ordering"]');
    await until(`Boolean(document.querySelector('.deck-narrow-panel'))`);
    expect(await evaluate(`document.documentElement.scrollHeight === innerHeight`)).toBe(true);
  });

  it.each([375, 1280].flatMap(width => ['light', 'dark'].flatMap(theme => ['en', 'ru'].map(lang => ({ width, theme, lang })))))
    ('keeps composer band labels and priority icon within their controls ($width px, $theme, $lang)', async ({ width, theme, lang }) => {
      await render('app', { deck: true, theme, lang }, width);
      await click(`.deck-action-rail button[aria-label="${lang === 'ru' ? 'Новая карточка' : 'New card'}"]`);
      await until(`Boolean(document.querySelector('.card-composer-band'))`);
      await waitForLayout(evaluate, '.card-composer-band');
      if (process.env.COMPOSER_CAPTURE && width === 375 && lang === 'en') {
        const image = await send('Page.captureScreenshot', { format: 'png' });
        writeFileSync(path.join(process.env.COMPOSER_CAPTURE, `${theme}.png`), Buffer.from(image.data, 'base64'));
      }
      const measure = () => evaluate(`(() => {
        const band = document.querySelector('.card-composer-band').getBoundingClientRect();
        const buttons = [...document.querySelectorAll('.card-composer-band button')];
        const boxes = buttons.map(button => button.getBoundingClientRect());
        return { labels: buttons.map((button, i) => {
          const label = button.firstElementChild, range = document.createRange(); range.selectNodeContents(label);
          const rects = [...range.getClientRects()], box = boxes[i];
          return rects.length === 1 && rects.every(r => r.left >= box.left - 1 && r.right <= box.right + 1 && r.top >= band.top && r.bottom <= band.bottom);
        }), separated: boxes[0].right <= boxes[1].left, icon: buttons[1].querySelector('svg path')?.getAttribute('d'),
          extraValue: Boolean(buttons[1].querySelector('strong')) };
      })()`);
      const unset = await measure();
      await click('.card-composer-band button:last-child');
      await until(`Boolean(document.querySelector('.card-composer-settings:not([hidden]) select'))`);
      await evaluate(`(() => { const select = [...document.querySelectorAll('.card-composer-settings select')].find(e => [...e.options].some(o => o.value === 'high')); select.value = 'high'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await until(`document.querySelector('.card-composer-band button:last-child svg path')?.getAttribute('d') === 'M3 2.5l5 3 5-3'`);
      const high = await measure();
      await evaluate(`(() => { const select = [...document.querySelectorAll('.card-composer-settings select')].find(e => [...e.options].some(o => o.value === 'high')); select.value = ''; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await until(`document.querySelector('.card-composer-band button:last-child svg path')?.getAttribute('d') === 'M5 8h6'`);
      expect({ unset, high }).toMatchObject({ unset: { labels: [true, true], separated: true, icon: 'M5 8h6', extraValue: false }, high: { labels: [true, true], separated: true, icon: 'M3 2.5l5 3 5-3', extraValue: false } });
    });

  it.each([375, 1280])('L-02/L-03/L-08: composer controls and deck search fit at %s px', async width => {
    for (const theme of ['light', 'dark']) for (const lang of ['ru', 'en']) {
      await render('app', { deck: true, theme, lang }, width);
      await until(`Boolean(document.querySelector('.deck-toolbar-search input') && document.querySelector('.deck-action-rail'))`);
      if (width <= 760) await click('.deck-tools-toggle');
      await until(`document.querySelector('.deck-toolbar-search input').clientWidth > 0`);
      await waitForLayout(evaluate, '.deck-toolbar-search');
      expect(await evaluate(`(() => {
        const input = document.querySelector('.deck-toolbar-search input');
        const style = getComputedStyle(input), canvas = document.createElement('canvas').getContext('2d');
        canvas.font = style.font;
        return canvas.measureText(input.placeholder).width <= input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
          && Boolean(input.closest('label').textContent.trim());
      })()`)).toBe(true);
      await click(`.deck-action-rail button[aria-label="${lang === 'ru' ? 'Новая карточка' : 'New card'}"]`);
      await until(`Boolean(document.querySelector('.card-composer-again label'))`);
      await waitForLayout(evaluate, '.card-composer, .card-edit-footer, .card-composer-again');
      expect(await evaluate(`(() => {
        const save = document.querySelector('.card-composer .card-edit-save');
        const footer = save.closest('.card-edit-footer').getBoundingClientRect();
        const button = save.getBoundingClientRect(), text = document.createRange();
        text.selectNodeContents(save); const ink = text.getBoundingClientRect();
        return save.textContent.trim() === ${JSON.stringify(lang === 'ru' ? 'Сохранить' : 'Save')}
          && button.left >= footer.left && button.right <= footer.right
          && ink.left >= button.left && ink.right <= button.right && ink.top >= button.top && ink.bottom <= button.bottom;
      })()`)).toBe(true);
      expect(await evaluate(`(() => {
        const label = document.querySelector('.card-composer-again label'), box = label.getBoundingClientRect();
        const range = document.createRange(); range.selectNodeContents(label);
        const style = getComputedStyle(label), left = box.left + parseFloat(style.paddingLeft), right = box.right - parseFloat(style.paddingRight);
        return label.textContent.trim() === ${JSON.stringify(lang === 'ru' ? 'Создать ещё одну' : 'Create another')}
          && box.height >= 24 && [...range.getClientRects()].every(r => r.left >= left - 1 && r.right <= right + 1 && r.top >= box.top && r.bottom <= box.bottom);
      })()`)).toBe(true);
      const target = await evaluate(`(() => {
        const label = document.querySelector('.card-composer-again label'), r = label.getBoundingClientRect();
        const x = r.left + 5, y = r.top + 1;
        return { x, y, hit: document.elementFromPoint(x, y) === label && document.elementFromPoint(x, r.bottom - 1) === label };
      })()`);
      expect(target.hit).toBe(true);
      for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: target.x, y: target.y, button: 'left', clickCount: 1 });
      await delay(80);
      expect(await evaluate(`document.querySelector('.card-composer-again [role="switch"]').getAttribute('aria-checked')`)).toBe('true');
    }
  }, 30000);

  it.each(['ru', 'en'])('L-06: %s phone stacks start compact and stay usable when expanded', async lang => {
    await evaluate(`['owned', 'watching', 'due'].forEach(id => localStorage.removeItem('deckmate-notifications-' + id + '-collapsed:maya'))`);
    await render('app', { deck: true, lang, notifications: true });
    await click('.notifications-trigger');
    await until(`document.querySelectorAll('.notification-pill').length === 3`);
    expect(await evaluate(`[...document.querySelectorAll('.notification-pill')].every(e => e.getAttribute('aria-expanded') === 'false')`)).toBe(true);
    expect(await evaluate(`(() => {
      const panel = document.querySelector('.notifications-panel').getBoundingClientRect();
      return panel.top >= document.querySelector('.global-topbar').getBoundingClientRect().bottom && panel.left >= 0 && panel.right <= innerWidth;
    })()`)).toBe(true);
    for (const title of ['Cards you own', 'Cards you watch', 'Due Cards']) {
      await click(`.notification-pill[title*="${title}"]`);
      await until(`document.activeElement?.classList.contains('notification-collapse')`);
      await until(`(() => { const body = document.querySelector('.notifications-body'); return body.scrollWidth <= body.clientWidth; })()`);
    }
    await until(`document.querySelectorAll('.notification-stack').length === 3`);
    const expanded = await evaluate(`(() => {
      const body = document.querySelector('.notifications-body'), box = document.querySelector('.notifications-panel').getBoundingClientRect();
      return { bottom: box.bottom, viewport: innerHeight, maxHeight: getComputedStyle(document.querySelector('.notifications-panel')).maxHeight,
        insideViewport: box.bottom <= innerHeight, belowHeader: box.top >= document.querySelector('.global-topbar').getBoundingClientRect().bottom,
        scrolls: body.scrollHeight > body.clientHeight, overflowY: getComputedStyle(body).overflowY };
    })()`);
    expect(expanded).toMatchObject({ insideViewport: true, belowHeader: true, scrolls: true, overflowY: 'auto' });
    for (const stack of ['owned', 'watching', 'due']) {
      expect(await evaluate(`(() => {
        const corner = document.querySelector('.notifications-body');
        const header = document.querySelector('.notification-stack-${stack} .notification-stack-header');
        header.scrollIntoView({ block: 'nearest' });
        const c = corner.getBoundingClientRect(), h = header.getBoundingClientRect();
        return h.top >= c.top - 1 && h.bottom <= c.bottom + 1;
      })()`)).toBe(true);
    }
    await click('.notification-stack-watching .notification-collapse');
    await until(`document.activeElement?.classList.contains('notification-pill') && document.activeElement.title.includes('Cards you watch')`);
    expect(await evaluate(`localStorage.getItem('deckmate-notifications-watching-collapsed:maya')`)).toBe('1');
    await click('.notification-pill[title*="Cards you watch"]');
    expect(await evaluate(`localStorage.getItem('deckmate-notifications-watching-collapsed:maya')`)).toBe('0');
  });

  it('L-06: resizing changes defaults, and the old Due Cards preference remains intact', async () => {
    await evaluate(`['owned', 'watching', 'due'].forEach(id => localStorage.removeItem('deckmate-notifications-' + id + '-collapsed:maya'))`);
    await render('app', { deck: true, notifications: true }, 1280);
    await click('.notifications-trigger');
    await until(`document.querySelectorAll('.notification-stack').length === 3`);
    await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: false });
    await until(`document.querySelectorAll('.notification-pill').length === 3`);
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await until(`document.querySelectorAll('.notification-stack').length === 3`);
    await evaluate(`localStorage.setItem('deckmate-notifications-due-collapsed:maya', '1')`);
    await render('app', { deck: true, notifications: true }, 1280);
    await click('.notifications-trigger');
    await until(`document.querySelectorAll('.notification-stack').length === 2 && Boolean(document.querySelector('.notification-pill[title*="Due Cards"]'))`);
    await click('.notification-pill[title*="Due Cards"]');
    expect(await evaluate(`localStorage.getItem('deckmate-notifications-due-collapsed:maya')`)).toBe('0');
    await render('app', { deck: true, notifications: true });
    await click('.notifications-trigger');
    await until(`document.querySelector('.notification-stack-due') && document.querySelectorAll('.notification-pill').length === 2`);
  });

  it.each([375, 1280])('keeps the deck picker and its search still while filtering at %s px', async width => {
    for (const theme of ['light', 'dark']) for (const lang of ['en', 'ru']) {
      await render('app', { deck: true, theme, lang }, width);
      await until(`Boolean(document.querySelector('.catalog-table-title'))`);
      await click('.catalog-table-title');
      await until(`Boolean(document.querySelector('.deck-picker-pill'))`);
      await click('.deck-picker-pill');
      await until(`document.querySelectorAll('.deck-choice-option').length >= 2`);
      await waitForLayout(evaluate, '.deck-picker-popover, .deck-choice-search');
      const before = await evaluate(`(() => {
        const box = document.querySelector('.deck-picker-popover').getBoundingClientRect();
        const input = document.querySelector('.deck-choice-search').getBoundingClientRect();
        return { top: box.top, height: box.height, searchTop: input.top };
      })()`);
      for (const query of ['neighbors', 'no matching deck', '']) {
        await evaluate(`(() => {
          const input = document.querySelector('.deck-choice-search');
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(query)});
          input.dispatchEvent(new Event('input', { bubbles: true }));
        })()`);
        await delay(80);
        const after = await evaluate(`(() => {
          const box = document.querySelector('.deck-picker-popover').getBoundingClientRect();
          const input = document.querySelector('.deck-choice-search').getBoundingClientRect();
          return { top: box.top, height: box.height, searchTop: input.top };
        })()`);
        expect(after.top).toBeCloseTo(before.top, 0);
        expect(after.height).toBeCloseTo(before.height, 0);
        expect(after.searchTop).toBeCloseTo(before.searchTop, 0);
      }
      expect(await evaluate(`document.activeElement === document.querySelector('.deck-choice-search')`)).toBe(true);
      await key('Escape');
      expect(await evaluate(`document.activeElement === document.querySelector('.deck-picker-pill')`)).toBe(true);
    }
  }, 30000);

  it('keeps quick settings inside the phone viewport when their shortcut anchor is offscreen', async () => {
    await render('app', { deck: true });
    await until(`Boolean(document.querySelector('.catalog-table-title'))`);
    await click('.catalog-table-title');
    await until(`Boolean(document.querySelector('.card-preview-owner-shortcut'))`);
    await evaluate(`(() => {
      const anchor = document.querySelector('.card-preview-owner-shortcut');
      anchor.style.top = '1200px';
      anchor.click();
    })()`);
    await until(`Boolean(document.querySelector('.deck-picker-popover'))`);
    await waitForLayout(evaluate, '.deck-picker-popover');
    expect(await evaluate(`(() => {
      const box = document.querySelector('.deck-picker-popover').getBoundingClientRect();
      return box.top >= 8 && box.bottom <= innerHeight - 8 && box.left >= 8 && box.right <= innerWidth - 8;
    })()`)).toBe(true);
    expect(await evaluate(`document.activeElement === document.querySelector('.deck-choice-search')`)).toBe(true);
  });

  it('removes fading card copies when filtering reverses or the workspace scrolls', async () => {
    await render('app', { deck: true, layout: 'cards' }, 375);
    await until(`document.querySelectorAll('[data-card-motion-root] [data-card-id]').length === 40`);
    await evaluate(`document.querySelector('[data-card-motion-root] [data-card-id]').scrollIntoView({ block: 'start', behavior: 'instant' })`);
    await waitForLayout(evaluate, '.workspace-main, [data-card-motion-root]');
    await send('Animation.enable');
    await send('Animation.setPlaybackRate', { playbackRate: .1 });
    const filter = async (query: string) => {
      await evaluate(`(() => {
        const input = document.querySelector('.deck-toolbar-search input');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(query)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
    };
    const copies = `document.querySelectorAll('[data-card-motion-root] [inert][aria-hidden="true"]').length`;
    try {
      await filter('Task 1');
      await until(`${copies} > 0`);
      await filter('');
      await until(`document.querySelectorAll('[data-card-motion-root] [data-card-id]').length === 40`);
      expect(await evaluate(copies)).toBe(0);
      await waitForLayout(evaluate, '[data-card-motion-root]');
      expect(await evaluate(copies)).toBe(0);
      await filter('Task 1');
      await until(`${copies} > 0`);
      await evaluate(`document.querySelector('.workspace-main').scrollTop += 80`);
      await until(`${copies} === 0`);
      await expectPageStateDuring(evaluate, `${copies} === 0`, 100);
      expect(await evaluate(copies)).toBe(0);
    } finally {
      await send('Animation.setPlaybackRate', { playbackRate: 1 });
    }
  });

  it('does not turn filtered subgrid table rows into malformed fixed copies', async () => {
    await render('app', { deck: true }, 1280);
    await until(`document.querySelectorAll('.deck-table-row[data-card-id]').length === 40`);
    await send('Animation.enable');
    await send('Animation.setPlaybackRate', { playbackRate: .1 });
    try {
      await evaluate(`(() => {
        const input = document.querySelector('.deck-toolbar-search input');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Task 1');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await until(`document.querySelectorAll('.deck-table-row[data-card-id]').length === 11`);
      expect(await evaluate(`document.querySelectorAll('.deck-table-row[inert][aria-hidden="true"]').length`)).toBe(0);
    } finally {
      await send('Animation.setPlaybackRate', { playbackRate: 1 });
    }
  });

  it.each(['light', 'dark'])('never paints two server status labels together in the %s theme', async theme => {
    await render('app', { theme }, 1280);
    await waitForLayout(evaluate, '.server-status-labels');
    expect(await evaluate(`new Promise(resolve => {
      let maximum = 0;
      const start = performance.now();
      window.shellTest.startSave();
      function sample() {
        const visible = [...document.querySelectorAll('.server-status-labels > span')]
          .filter(element => Number(getComputedStyle(element).opacity) > .001).length;
        maximum = Math.max(maximum, visible);
        if (performance.now() - start < 800) requestAnimationFrame(sample);
        else resolve(maximum);
      }
      sample();
    })`)).toBe(1);
  });

  it.each(['light', 'dark'])('keeps the server status ends round during saves in the %s theme', async theme => {
    for (const lang of ['en', 'ru']) {
      await render('app', { theme, lang }, 1280);
      await waitForLayout(evaluate, '.server-status-labels');
      const samples = await evaluate(`new Promise(resolve => {
        const button = document.querySelector('.server-status');
        const face = button.querySelector('.server-status-face');
        const middle = face.firstElementChild;
        const dot = button.querySelector('.server-status-dot');
        const result = [];
        const start = performance.now();
        window.shellTest.startSave(800);
        function sample() {
          const box = face.getBoundingClientRect(), center = middle.getBoundingClientRect();
          const left = getComputedStyle(face, '::before'), right = getComputedStyle(face, '::after');
          const matrix = new DOMMatrixReadOnly(right.transform);
          const dotBox = dot.getBoundingClientRect();
          result.push({ height: box.height, leftRadius: left.borderTopLeftRadius, rightRadius: right.borderTopRightRadius,
            capWidth: parseFloat(right.width), capScale: matrix.a, capShift: matrix.e, join: center.right - (box.right + matrix.e - 11),
            dotCenter: dotBox.y + dotBox.height / 2 - (box.y + box.height / 2) });
          if (performance.now() - start < 350) requestAnimationFrame(sample);
          else resolve(result);
        }
        requestAnimationFrame(sample);
      })`);
      expect(samples.length).toBeGreaterThan(3);
      expect(Math.max(...samples.map((sample: { capShift: number }) => sample.capShift))
        - Math.min(...samples.map((sample: { capShift: number }) => sample.capShift))).toBeGreaterThan(5);
      for (const sample of samples) {
        expect(sample.height).toBe(22);
        expect(sample.leftRadius).toBe('11px'); expect(sample.rightRadius).toBe('11px');
        expect(sample.capWidth).toBe(11); expect(sample.capScale).toBe(1);
        expect(Math.abs(sample.join)).toBeLessThan(1);
        expect(Math.abs(sample.dotCenter)).toBeLessThan(.1);
      }
      const insets = await evaluate(`(() => {
        const button = document.querySelector('.server-status'), face = button.querySelector('.server-status-face');
        const label = button.querySelector('.server-status-labels .is-active').getBoundingClientRect();
        const cap = new DOMMatrixReadOnly(getComputedStyle(face, '::after').transform);
        return { dot: button.querySelector('.server-status-dot').offsetLeft,
          label: face.getBoundingClientRect().right + cap.e - label.right };
      })()`);
      expect(insets.dot).toBe(8); expect(insets.label).toBeCloseTo(8, 0);
      await until(`Boolean(document.querySelector('.server-status.is-saved.is-pinged'))`);
      expect(await evaluate(`getComputedStyle(document.querySelector('.server-status .server-status-dot'), '::after').animationName`)).toBe('server-status-arrive');
      await evaluate('window.shellTest.startSave(200)');
      await until(`Boolean(document.querySelector('.server-status.is-saving:not(.is-pinged)'))`);
      await until(`Boolean(document.querySelector('.server-status.is-saved'))`);
      await delay(1700);
    }
  });

  it('keeps the dot-only server capsule compact and its touch target separate', async () => {
    await inTouchMode(async () => {
      for (const width of [1024, 1280, 375]) {
        await render('app', {}, width);
        if (width === 375) await click('.mission-control-trigger');
        await until(`Boolean(document.querySelector('.server-status'))`);
        await waitForLayout(evaluate, '.server-status');
        const geometry = await evaluate(`(() => {
          const button = document.querySelector('.server-status'), face = button.querySelector('.server-status-face');
          const box = button.getBoundingClientRect(), faceBox = face.getBoundingClientRect();
          const cap = new DOMMatrixReadOnly(getComputedStyle(face, '::after').transform);
          const dot = button.querySelector('.server-status-dot').getBoundingClientRect();
          const logo = document.querySelector('.mission-control-trigger').getBoundingClientRect();
          return { width: box.width, height: box.height, faceHeight: faceBox.height, faceWidth: faceBox.width + cap.e,
            dotCenter: dot.y + dot.height / 2 - (faceBox.y + faceBox.height / 2),
            separate: box.right <= logo.left || logo.right <= box.left || box.bottom <= logo.top || logo.bottom <= box.top };
        })()`);
        expect(geometry.width).toBeGreaterThanOrEqual(44); expect(geometry.height).toBeGreaterThanOrEqual(44);
        expect(geometry.faceHeight).toBe(22); expect(Math.abs(geometry.dotCenter)).toBeLessThan(.1);
        expect(geometry.separate).toBe(true);
        if (width === 1024) expect(geometry.faceWidth).toBeCloseTo(24, 1);
      }
    });
  });

  it('rehugs the server label when the responsive layout hides and restores it', async () => {
    await render('app', { lang: 'ru' }, 1280);
    for (const width of [1024, 1280]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false });
      await waitForLayout(evaluate, '.server-status');
      const geometry = await evaluate(`(() => {
        const face = document.querySelector('.server-status-face');
        const label = document.querySelector('.server-status-labels .is-active');
        const right = face.getBoundingClientRect().right + new DOMMatrixReadOnly(getComputedStyle(face, '::after').transform).e;
        return { width: right - face.getBoundingClientRect().left,
          labelShown: getComputedStyle(label.parentElement).display !== 'none', inset: right - label.getBoundingClientRect().right };
      })()`);
      if (width === 1024) {
        expect(geometry.labelShown).toBe(false);
        expect(geometry.width).toBeCloseTo(24, 1);
      } else {
        expect(geometry.labelShown).toBe(true);
        expect(geometry.inset).toBeCloseTo(8, 0);
      }
    }
  });

  it('highlights every part of the server capsule on hover', async () => {
    await render('app', {}, 1280);
    await waitForLayout(evaluate, '.server-status');
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
    const background = `(() => { const face = document.querySelector('.server-status-face');
      return [getComputedStyle(face, '::before').backgroundColor, getComputedStyle(face.firstElementChild).backgroundColor,
        getComputedStyle(face, '::after').backgroundColor]; })()`;
    const idle = await evaluate(background);
    const point = await evaluate(`(() => { const r = document.querySelector('.server-status').getBoundingClientRect(); return { x: r.left + 10, y: r.top + r.height / 2 }; })()`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    const hover = await evaluate(background);
    expect(new Set(hover).size).toBe(1);
    expect(hover[0]).not.toBe(idle[0]);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
  });

  it('honors reduced motion for the server capsule and ping', async () => {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    try {
      await render('app', {}, 1280);
      await evaluate('window.shellTest.startSave(400)');
      await until(`Boolean(document.querySelector('.server-status.is-saving'))`);
      expect(await evaluate(`getComputedStyle(document.querySelector('.server-status .server-status-dot')).animationName`)).toBe('none');
      await until(`Boolean(document.querySelector('.server-status.is-saved.is-pinged'))`);
      expect(await evaluate(`(() => {
        const face = document.querySelector('.server-status-face');
        return { cap: getComputedStyle(face, '::after').transitionDuration,
          middle: getComputedStyle(face.firstElementChild).transitionDuration,
          ping: getComputedStyle(document.querySelector('.server-status .server-status-dot'), '::after').animationName };
      })()`)).toEqual({ cap: '0s', middle: '0s', ping: 'none' });
    } finally {
      await send('Emulation.setEmulatedMedia', { features: [] });
    }
  });

  it('has no uncaught browser errors', () => { expect(browserErrors.flat()).toEqual([]); });
});
