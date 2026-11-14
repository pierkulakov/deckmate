import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openHeadlessBrowser, type HeadlessPage } from '../tools/layout-capture.ts';
import { browserFixtureUrl } from './browser-fixture.ts';
import { requireBrowser } from './browser-environment.ts';
import { expectPageStateDuring, waitForLayout } from './browser-layout.ts';

const browserPath = requireBrowser();
describe.skipIf(!browserPath)('shared interface states and recovery (browser)', () => {
  let page: HeadlessPage;
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  async function until(expression: string) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (await page.evaluate(expression)) return;
      await delay(25);
    }
    throw new Error('Timed out: ' + expression + '\n' + page.consoleErrors.join('\n'));
  }
  async function reset(screen = 'components', fail: string[] = [], hold: string[] = []) {
    await page.send('Page.navigate', { url: browserFixtureUrl('interface-states') + '?instance=' + Math.random() });
    await until('Boolean(window.statesTest) && document.hasFocus()');
    await page.evaluate(`statesTest.setLang('en');localStorage.setItem('deckmate-current-member','builder');statesTest.state.fail=${JSON.stringify(fail)};statesTest.state.hold=${JSON.stringify(hold)};statesTest.render(${JSON.stringify(screen)})`);
  }
  async function openCalendar() {
    await reset('planning-probe');
    await until('Boolean(window.planningTest)');
    await page.evaluate(`planningTest.setMode('calendar')`);
    await until(`document.activeElement.closest('[data-date]')?.dataset.date === '2026-11-23'`);
  }
  beforeAll(async () => {
    // 2026-11-10: recovery tests reuse built fixtures; per-file dependency optimization adds no coverage.
    page = await openHeadlessBrowser({ width: 1280, height: 1000, scale: 1 });
    // 2026-11-10: an inactive headless page changes activeElement without firing focus events, so Retry cannot track its focus.
    await page.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await reset();
  }, 90000);
  afterAll(async () => {
    await page?.close();
  }, 20000);

  it.each(['en', 'ru'])('renders all variants, roles and default copy in %s', async lang => {
    await reset();
    await page.evaluate(`statesTest.setLang('${lang}')`);
    await until(`document.documentElement.lang === '${lang}'`);
    await until(`Boolean(document.querySelector('.ui-loading-plate [role=status]'))`);
    expect(await page.evaluate(`document.querySelectorAll('.ui-empty[role=status]').length`)).toBe(3);
    expect(await page.evaluate(`document.querySelectorAll('.ui-error[role=alert]').length`)).toBe(3);
    const body = await page.evaluate('document.body.innerText');
    expect(body).toContain(lang === 'en' ? 'Nothing found.' : 'Ничего не найдено.');
    expect(body).toContain(lang === 'en' ? 'Nothing was lost' : 'Ничего не потерялось');
    expect(body).toContain(lang === 'en' ? 'Deckmate is not responding' : 'Deckmate не отвечает');
    expect(body).toContain(lang === 'en' ? 'Loading…' : 'Загружаем…');
    await page.evaluate(`document.querySelector('.ui-empty-filtered button').click()`);
    expect(await page.evaluate('statesTest.state.resets')).toBe(1);
  });

  it('delays the keep-data indicator, retains content and cancels it when inactive', async () => {
    await reset();
    await until(`Boolean(document.querySelector('#retained'))`);
    await delay(300);
    expect(await page.evaluate(`Boolean(document.querySelector('.ui-loading-keep-data [role=status]'))`)).toBe(false);
    await until(`Boolean(document.querySelector('.ui-loading-keep-data [role=status]'))`);
    expect(await page.evaluate(`document.querySelector('#retained').textContent`)).toBe('Confirmed data');
    await page.evaluate(`statesTest.state.active=false;statesTest.render('components')`);
    await delay(600);
    expect(await page.evaluate(`Boolean(document.querySelector('.ui-loading-keep-data [role=status]'))`)).toBe(false);
  });

  it.each(['banner', 'inline', 'saved-input'])('retries %s once and keeps keyboard focus during failure', async variant => {
    await reset();
    await page.evaluate(`statesTest.state.retryFail=true;window.retryButton=document.querySelector('.ui-error-${variant} button');retryButton.focus();retryButton.click();retryButton.click()`);
    await until('statesTest.state.retries === 1');
    expect(await page.evaluate('document.activeElement === retryButton')).toBe(true);
    await page.evaluate('statesTest.state.releaseRetry()');
    await until(`retryButton.getAttribute('aria-disabled') === 'false'`);
    expect(await page.evaluate('document.activeElement === retryButton')).toBe(true);
    expect(await page.evaluate(`document.querySelector('input[aria-label="Draft"]').value`)).toBe('Preserved draft');
  });

  it('marks a slow Retry as busy: one run for click and Enter, spinner and retrying message, focus back on the saved surface', async () => {
    await reset();
    await page.evaluate(`statesTest.state.retryFail=false;window.retryButton=document.querySelector('.ui-error-banner button');retryButton.focus();retryButton.click()`);
    await until(`retryButton.getAttribute('aria-disabled') === 'true'`);
    expect(await page.evaluate(`Boolean(retryButton.querySelector('.spin'))`)).toBe(true);
    expect(await page.evaluate(`document.querySelector('.ui-error-banner [role=status]').textContent`)).toBe('Retrying…');
    await page.evaluate(`retryButton.click()`);
    await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await delay(400);
    expect(await page.evaluate('statesTest.state.retries')).toBe(1);
    expect(await page.evaluate('document.activeElement === retryButton')).toBe(true);
    expect(parseFloat(await page.evaluate(`getComputedStyle(retryButton).opacity`))).toBeLessThan(0.7);
    await page.evaluate('statesTest.state.releaseRetry()');
    await until(`!document.querySelector('.ui-error-banner[role=alert]')`);
    expect(await page.evaluate('statesTest.state.retries')).toBe(1);
    expect(await page.evaluate(`document.activeElement === retryButton.closest('main') && document.activeElement.tagName === 'MAIN'`)).toBe(true);
  });

  it('does not dim or announce a short retry', async () => {
    await reset();
    try {
      await page.evaluate(`statesTest.state.retryFail=false;statesTest.state.fastRetry=true;window.retryButton=document.querySelector('.ui-error-banner button');retryButton.focus();retryButton.click()`);
      await until(`retryButton.getAttribute('aria-disabled') === 'false'`);
      await delay(100);
      expect(await page.evaluate(`getComputedStyle(retryButton).opacity`)).toBe('1');
      expect(await page.evaluate(`Boolean(document.querySelector('.ui-error-banner [role=status]'))`)).toBe(false);
      expect(await page.evaluate('statesTest.state.retries')).toBe(1);
      expect(await page.evaluate(`!document.querySelector('.ui-error-banner[role=alert]')`)).toBe(true);
    } finally {
      await page.evaluate(`statesTest.state.fastRetry=false`);
    }
  });

  it('keeps the busy Retry usable and announced under reduced motion', async () => {
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    try {
      await reset();
      await page.evaluate(`statesTest.state.retryFail=false;window.retryButton=document.querySelector('.ui-error-banner button');retryButton.focus();retryButton.click()`);
      await until(`retryButton.getAttribute('aria-disabled') === 'true'`);
      expect(await page.evaluate(`Boolean(retryButton.querySelector('.spin'))`)).toBe(true);
      expect(await page.evaluate(`Boolean(document.querySelector('.ui-error-banner [role=status]'))`)).toBe(true);
      await page.evaluate('statesTest.state.releaseRetry()');
      await until(`!document.querySelector('.ui-error-banner[role=alert]')`);
      expect(await page.evaluate('document.activeElement !== document.body')).toBe(true);
    } finally {
      await page.send('Emulation.setEmulatedMedia', { features: [] });
    }
  });

  it('fits a long Russian error message with its Retry at 375 px', async () => {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: false });
    try {
      await reset();
      await page.evaluate(`statesTest.setLang('ru')`);
      await until(`document.documentElement.lang === 'ru'`);
      const longRu = 'Не удалось сохранить изменения, потому что сервер долго не отвечает и соединение было прервано. Ваши правки никуда не делись — попробуйте ещё раз.';
      await page.evaluate(`statesTest.state.longMessage=${JSON.stringify(longRu)};statesTest.render('components')`);
      await until(`Boolean(document.querySelector('.ui-error-banner'))`);
      expect(await page.evaluate(`document.body.innerText`)).toContain(longRu);
      expect(await page.evaluate(`document.documentElement.scrollWidth <= innerWidth`)).toBe(true);
      expect(await page.evaluate(`(() => { const button=document.querySelector('.ui-error-banner button').getBoundingClientRect(); return button.left >= 0 && button.right <= innerWidth; })()`)).toBe(true);
    } finally {
      await page.evaluate(`statesTest.state.longMessage=null;statesTest.setLang('en')`);
      await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
    }
  });

  it.each([
    { screen: 'timeline', content: '.timeline-canvas', surface: '.planning-view' },
    { screen: 'search', content: '.global-search-row', surface: '.global-search-pop' },
    { screen: 'members', content: '.members-editor-list', surface: '.members-editor-body' },
  ])('recovers $screen from a failed catalog request', async ({ screen, content, surface }) => {
    await reset(screen, ['/api/catalog']);
    if (screen === 'search') await page.evaluate(`statesTest.input('.global-search input','Recovered')`);
    await until(`Boolean(document.querySelector('.ui-error[role=alert]'))`);
    await page.evaluate(`statesTest.state.fail=[];statesTest.state.hold=['/api/catalog'];window.retryButton=document.querySelector('.ui-error[role=alert] button');retryButton.focus();retryButton.click();retryButton.click()`);
    await until(`statesTest.state.reads['/api/catalog'] === 2`);
    expect(await page.evaluate('document.activeElement === retryButton')).toBe(true);
    await page.evaluate(`statesTest.state.releases['/api/catalog']()`);
    await until(`!document.querySelector('.ui-error[role=alert]')`);
    expect(await page.evaluate(`Boolean(document.querySelector(${JSON.stringify(content)}))`)).toBe(true);
    expect(await page.evaluate(`document.activeElement === document.querySelector(${JSON.stringify(surface)})`)).toBe(true);
  });

  it('shows an actionable first-run Timeline overview', async () => {
    await reset('timeline');
    await until(`Boolean(document.querySelector('.timeline-canvas'))`);
    await page.evaluate(`document.querySelector('button[aria-label="Milestones overview"]').click()`);
    await until(`Boolean(document.querySelector('.ui-empty-first-run button'))`);
    expect(await page.evaluate(`Boolean(document.querySelector('.planning-overview .ui-empty-scene .empty-art'))`)).toBe(true);
    await page.evaluate(`document.querySelector('.ui-empty-first-run button').click()`);
    await until(`Boolean(document.querySelector('.planning-calendar-panel'))`);
    expect(await page.evaluate('document.body.innerText')).toContain('Milestone');
  });

  it('resets the activity group filter without hiding Show more', async () => {
    await reset('activity');
    await until(`Boolean(document.querySelector('.deck-activity-chip'))`);
    await page.evaluate(`Array.from(document.querySelectorAll('.deck-activity-chip')).find(button => button.textContent === 'Links').click()`);
    await until(`Boolean(document.querySelector('.deck-activity .ui-empty-filtered button'))`);
    expect(await page.evaluate(`document.querySelector('.deck-activity .ui-empty-filtered').textContent`)).toContain('No loaded events match the filters.');
    expect(await page.evaluate(`document.querySelector('.deck-activity-more').textContent`)).toContain('Show more');
    await page.evaluate(`document.querySelector('.deck-activity .ui-empty-filtered button').click()`);
    await until(`Boolean(document.querySelector('.deck-activity-event'))`);
    expect(await page.evaluate(`Boolean(document.querySelector('.deck-activity .ui-empty-filtered'))`)).toBe(false);
  });

  it('explains when no cards are shown in the tags panel', async () => {
    await reset('tags-empty');
    await until(`Boolean(document.querySelector('.deck-tags-panel .ui-empty-quiet'))`);
    expect(await page.evaluate(`document.querySelector('.deck-tags-panel .ui-empty').textContent`)).toContain('No cards are shown, so there are no tags to pick.');
  });

  it('shows a read-only empty members registry with a team scene', async () => {
    await reset('members-readonly-empty');
    await until(`Boolean(document.querySelector('.members-editor .ui-empty-scene'))`);
    const message = await page.evaluate(`document.querySelector('.members-editor .ui-empty').textContent`);
    expect(message).toContain('No members yet');
    expect(message).toContain('Members appear here once the project has them.');
    expect(message).not.toContain('Add people');
    expect(await page.evaluate(`Boolean(document.querySelector('.members-editor .ui-empty button'))`)).toBe(false);
  });

  it('shows a calm read-only Timeline overview with its scene', async () => {
    await reset('timeline-readonly');
    await until(`Boolean(document.querySelector('.timeline-canvas'))`);
    await page.evaluate(`document.querySelector('button[aria-label="Milestones overview"]').click()`);
    await until(`Boolean(document.querySelector('.planning-overview .ui-empty-scene .empty-art'))`);
    expect(await page.evaluate(`document.querySelector('.planning-overview .ui-empty').textContent`)).toContain('Runs and Milestones appear here once the plan has them.');
    expect(await page.evaluate(`Boolean(document.querySelector('.planning-overview .ui-empty button'))`)).toBe(false);
  });

  it('resets both My cards and search in an empty filtered plan', async () => {
    await reset('planning-scope');
    await until(`Boolean(document.querySelector('.planning-mine'))`);
    await page.evaluate(`document.querySelector('.planning-mine').click()`);
    await until(`Boolean(document.querySelector('.planning-cards .ui-empty-filtered .empty-art'))`);
    expect(await page.evaluate(`Boolean(document.querySelector('.planning-cards .ui-empty-filtered button'))`)).toBe(true);
    await page.evaluate(`statesTest.input('.planning-search input','absent')`);
    await until(`document.querySelector('.planning-search input').value === 'absent'`);
    await page.evaluate(`document.querySelector('.planning-cards .ui-empty-filtered button').click()`);
    await until(`!document.querySelector('.planning-cards .ui-empty-filtered')`);
    expect(await page.evaluate(`document.querySelector('.planning-search input').value`)).toBe('');
    expect(await page.evaluate(`document.querySelector('.planning-mine').getAttribute('aria-pressed')`)).toBe('false');
    expect(await page.evaluate(`document.querySelector('.planning-cards').textContent`)).toContain('Recovered card');
  });

  it('planning: opens a card, selects a visual Shift range, clears with Escape and prunes hidden selection', async () => {
    await reset('planning-probe');
    await until(`Boolean(document.querySelector('.planning-card-grid .deck-card-open'))`);
    await page.evaluate(`document.querySelector('.planning-card-grid .deck-card-open').click()`);
    expect(await page.evaluate('planningTest.state.opened')).toEqual(['card:0']);
    await page.evaluate(`document.querySelectorAll('.planning-card-grid .deck-card-open')[0].dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true}));document.querySelectorAll('.planning-card-grid .deck-card-open')[3].dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true}))`);
    await until(`document.querySelectorAll('.planning-card-grid .is-multi-selected').length === 4`);
    await page.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true,cancelable:true}))`);
    await until(`document.querySelectorAll('.planning-card-grid .is-multi-selected').length === 0`);
    await page.evaluate(`document.querySelector('.planning-card-grid .deck-card-open').dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true}))`);
    await until(`document.querySelectorAll('.planning-card-grid .is-multi-selected').length === 1`);
    await page.evaluate(`statesTest.input('.planning-search input','absent')`);
    await until(`Boolean(document.querySelector('.planning-cards .ui-empty-filtered'))`);
    await page.evaluate(`statesTest.input('.planning-search input','')`);
    await until(`document.querySelectorAll('.planning-card-grid .deck-card-open').length === 6`);
    expect(await page.evaluate(`document.querySelectorAll('.planning-card-grid .is-multi-selected').length`)).toBe(0);
  });

  it('planning: opens the lazy composer and restores an unsaved draft', async () => {
    await reset('planning-scope');
    await until(`Boolean(document.querySelector('.planning-rail [aria-label="Add card to plan"]:not(:disabled)'))`);
    await page.send('Network.enable');
    await page.send('Network.emulateNetworkConditions', { offline: false, latency: 350, downloadThroughput: -1, uploadThroughput: -1 });
    try {
      await page.evaluate(`document.querySelector('.planning-rail [aria-label="Add card to plan"]').click()`);
      await expectPageStateDuring(page.evaluate, `Boolean(document.querySelector('.planning-collection-body')) && ![...document.querySelectorAll('.planning-details')].some(panel => !panel.childElementCount)`, 700);
      await until(`Boolean(document.querySelector('.card-composer .card-edit-text'))`);
    } finally {
      await page.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    }
    await page.evaluate(`statesTest.input('.card-composer .card-edit-text', 'Planning draft')`);
    await page.evaluate(`document.querySelector('.card-composer [aria-label="Close New Card"]').click()`);
    await until(`!document.querySelector('.card-composer') && !document.querySelector('.planning-rail [aria-label="Add card to plan"]').disabled`);
    await page.evaluate(`document.querySelector('.planning-rail [aria-label="Add card to plan"]').click()`);
    await until(`document.querySelector('.card-composer .card-edit-text')?.value === 'Planning draft'`);
    expect(await page.evaluate(`Boolean(document.querySelector('.card-composer .card-draft-banner'))`)).toBe(true);
    await page.evaluate(`document.querySelector('.card-composer .card-draft-banner button').click()`);
    expect(page.consoleErrors).toEqual([]);
  });

  it('planning: a Milestone conflict keeps the draft and blocks a second write until saved fields and hash are loaded together', async () => {
    await reset('planning-probe');
    await page.evaluate(`planningTest.setMode('form');planningTest.state.conflict=true`);
    await until(`Boolean(document.querySelector('.planning-popover-form'))`);
    await page.evaluate(`statesTest.input('.planning-popover-form input[maxlength="120"]','Local draft')`);
    await page.evaluate(`document.querySelector('.planning-popover-form').requestSubmit()`);
    await until(`planningTest.state.saves.length === 1`);
    expect(await page.evaluate(`document.querySelector('.planning-popover-form button[type="submit"]').disabled`)).toBe(true);
    expect(await page.evaluate(`document.querySelector('.planning-popover-form input[maxlength="120"]').value`)).toBe('Local draft');
    expect(await page.evaluate(`document.querySelector('.planning-popover-form [role="alert"]').innerText`)).toContain('File changed');
    await page.evaluate(`document.querySelector('.planning-popover-form').requestSubmit()`);
    expect(await page.evaluate('planningTest.state.saves.length')).toBe(1);
    await page.evaluate(`Array.from(document.querySelectorAll('.planning-popover-form button')).find(b=>b.textContent.includes('Load saved')).click()`);
    await until(`document.querySelector('.planning-popover-form input[maxlength="120"]').value === 'External'`);
    await page.evaluate(`statesTest.input('.planning-popover-form input[maxlength="120"]','Reviewed edit')`);
    await page.evaluate(`document.querySelector('.planning-popover-form').requestSubmit()`);
    await until(`planningTest.state.saves.length === 2`);
    expect(await page.evaluate('planningTest.state.saves[1]')).toMatchObject({ milestonesHash: 'external', milestone: { title: 'Reviewed edit', description: 'External description' } });
  });

  it('planning: a network failure is visible inside the Milestone form and retry keeps the draft', async () => {
    await reset('planning-probe');
    await page.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 600, deviceScaleFactor: 1, mobile: false });
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    try {
      await page.evaluate(`planningTest.setCatalog({...planningTest.catalog,milestones:[planningTest.catalog.milestones[0]]});planningTest.setMode('calendar');planningTest.state.fail=true`);
      await until(`Boolean(document.querySelector('.planning-calendar-milestone'))`);
      await page.evaluate(`document.querySelector('.planning-calendar-milestone').click()`);
      await until(`Boolean(document.querySelector('.planning-popover-form'))`);
      await page.evaluate(`statesTest.input('.planning-popover-form input[maxlength="120"]','Retry draft')`);
      await page.evaluate(`document.querySelector('.planning-popover-form').requestSubmit()`);
      await until(`planningTest.state.saves.length === 1`);
      expect(await page.evaluate(`document.querySelector('.planning-popover-form [role="alert"]')?.textContent`)).toContain('Offline');
      expect(await page.evaluate(`(()=>{const alert=document.querySelector('.planning-popover-form [role="alert"]').getBoundingClientRect();const footer=document.querySelector('.planning-popover-form footer').getBoundingClientRect();return alert.top>=0&&alert.bottom<=footer.top&&footer.bottom<=innerHeight})()`)).toBe(true);
      await page.evaluate(`planningTest.state.fail=false;document.querySelector('.planning-popover-form').requestSubmit()`);
      await until(`planningTest.state.saves.length === 2`);
      expect(await page.evaluate('planningTest.state.saved.title')).toBe('Retry draft');
    } finally {
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: false });
      await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
    }
  });

  // 2026-11-14: each date change renders a three-year grid; independent cases keep the keyboard matrix within its budget.
  it.each([
    ['PageDown', '2026-11-23', '2026-12-23'], ['End', '2026-12-23', '2026-12-27'],
    ['PageUp', '2026-12-27', '2026-11-27'], ['Home', '2026-11-27', '2026-11-23'],
    ['ArrowRight', '2026-11-23', '2026-11-24'], ['Home', '2026-11-24', '2026-11-23'],
  ])('planning: calendar %s moves from %s to %s with one date Tab stop', async (key, from, to) => {
    await openCalendar();
    await page.evaluate(`document.querySelector('[data-date="${from}"] button').focus()`);
    await until(`document.activeElement.closest('[data-date]')?.dataset.date === '${from}' && document.activeElement.tabIndex === 0`);
    await page.evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'${key}',bubbles:true,cancelable:true}))`);
    await until(`document.activeElement.closest('[data-date]')?.dataset.date === '${to}' && document.activeElement.tabIndex === 0`);
    expect(await page.evaluate(`Array.from(document.querySelectorAll('[data-date] button')).filter(b=>b.tabIndex===0).length`)).toBe(1);
  });

  it('planning: the calendar starts at today with one date Tab stop and exposes every Milestone of a day', async () => {
    await openCalendar();
    expect(await page.evaluate(`Array.from(document.querySelectorAll('[data-date] button')).filter(b=>b.tabIndex===0).length`)).toBe(1);
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await until(`document.querySelectorAll('.timeline-cluster-menu [role="menuitem"]').length === 4`);
    await page.evaluate(`document.querySelectorAll('.timeline-cluster-menu [role="menuitem"]')[2].click()`);
    await until(`Boolean(document.querySelector('.planning-popover-form'))`);
    expect(await page.evaluate(`document.querySelector('.planning-popover-form input[maxlength="120"]').value`)).toBe('Milestone 3');
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await until(`!document.querySelector('.planning-popover')`);
    expect(await page.evaluate(`document.activeElement.closest('[data-date]')?.dataset.date`)).toBe('2026-11-23');
  });

  it('planning: calendar colors retain 4.5:1 contrast in both themes and touch targets fit a phone', async () => {
    await reset('planning-probe');
    await page.evaluate(`planningTest.setCatalog({...planningTest.catalog,milestones:['#7b7b7b','#777777',...planningTest.planningColors].map((color,index)=>({id:String(index),title:color,date:'2026-11-'+String(index+10),color}))});planningTest.setMode('calendar')`);
    await until(`document.querySelectorAll('.planning-calendar-milestone').length === 9`);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(`document.documentElement.classList.toggle('dark','${theme}'==='dark')`);
      const ratios = await page.evaluate(`Array.from(document.querySelectorAll('.planning-calendar-milestone')).map(button=>{
        const context=document.createElement('canvas').getContext('2d');
        const luminance=color=>{context.fillStyle=color;context.fillRect(0,0,1,1);const channels=Array.from(context.getImageData(0,0,1,1).data).slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722};
        const style=getComputedStyle(button);const a=luminance(style.color);const b=luminance(style.backgroundColor);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
      })`);
      expect(Math.min(...ratios)).toBeGreaterThanOrEqual(4.5);
    }
    await page.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 600, deviceScaleFactor: 1, mobile: false });
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    try {
      await waitForLayout(page.evaluate, '.planning-calendar-panel, .planning-calendar-day, .planning-calendar-milestone');
      expect(await page.evaluate(`Array.from(document.querySelectorAll('.planning-calendar-day,.planning-calendar-milestone')).every(button=>{const r=button.getBoundingClientRect();return r.width>=44&&r.height>=44&&r.left>=0&&r.right<=innerWidth})`)).toBe(true);
    } finally {
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: false });
      await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
    }
  });

  it.each(['en', 'ru'])('planning: a %s Milestone summary stays inside the phone on keyboard focus and hover', async lang => {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: false });
    try {
      await reset('planning-probe');
      await page.evaluate(`statesTest.setLang('${lang}');planningTest.setCatalog({...planningTest.catalog,milestones:[{...planningTest.catalog.milestones[0],title:'Проверка готовности интерфейса к выпуску и приёмке командой'}]});planningTest.setMode('calendar')`);
      await until(`Boolean(document.querySelector('.planning-calendar-milestone'))`);
      await waitForLayout(page.evaluate, '.planning-calendar-panel, .planning-calendar-milestone');
      for (const key of ['ArrowRight', 'ArrowLeft']) {
        const windowsVirtualKeyCode = key === 'ArrowRight' ? 39 : 37;
        for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode });
      }
      await until(`document.activeElement.classList.contains('planning-calendar-milestone')`);
      const expectSummaryInside = async () => {
        await until(`Boolean(document.querySelector('.planning-milestone-card'))`);
        await waitForLayout(page.evaluate, '.planning-milestone-card');
        expect(await page.evaluate(`(() => {
          const card = document.querySelector('.planning-milestone-card');
          const box = card.getBoundingClientRect();
          return box.left >= 12 && box.right <= innerWidth - 12 && box.top >= 12 && box.bottom <= innerHeight - 12
            && card.scrollWidth <= card.clientWidth;
        })()`)).toBe(true);
      };
      await expectSummaryInside();
      await page.evaluate(`document.activeElement.blur()`);
      await until(`!document.querySelector('.planning-milestone-card')`);
      const point = await page.evaluate(`(() => { const box=document.querySelector('.planning-calendar-milestone').getBoundingClientRect();return {x:box.x+box.width/2,y:box.y+box.height/2}; })()`);
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
      await expectSummaryInside();
      expect(page.consoleErrors).toEqual([]);
    } finally {
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
      await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
    }
  });

  it('planning: the calendar returns focus to the surviving create-menu opener', async () => {
    await reset('timeline');
    await until(`Boolean(document.querySelector('.timeline-create'))`);
    await page.evaluate(`document.querySelector('.timeline-create').focus()`);
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await until(`Boolean(document.querySelector('.planning-create-menu [role="menuitem"]'))`);
    await page.evaluate(`document.querySelector('.planning-create-menu [role="menuitem"]').click()`);
    await until(`Boolean(document.querySelector('.planning-popover'))`);
    await page.evaluate(`document.querySelector('.planning-popover-close').click()`);
    await until(`!document.querySelector('.planning-popover')`);
    await page.evaluate(`document.querySelector('.planning-calendar-close').click()`);
    await until(`!document.querySelector('.planning-calendar-panel')`);
    expect(await page.evaluate(`document.activeElement===document.querySelector('.timeline-create')`)).toBe(true);
  });

  it('planning: switches observed burndown units, including fractions, zero and gaps, without substituting live cards', async () => {
    await reset('planning-probe');
    await page.evaluate(`planningTest.setMode('stats')`);
    await until(`Boolean(document.querySelector('.planning-burndown'))`);
    expect(await page.evaluate(`document.querySelectorAll('.planning-burndown circle').length`)).toBe(3);
    await page.evaluate(`document.querySelector('button[aria-label="Known Effort"]').click()`);
    await until(`document.querySelector('.planning-burndown svg').getAttribute('aria-label').includes('Effort')`);
    expect(await page.evaluate(`Array.from(document.querySelectorAll('.planning-history-table tbody tr')).map(tr=>Array.from(tr.cells).map(td=>td.textContent))`)).toEqual([
      ['2026-11-02', '3', '3'], ['2026-11-05', '2.5', '3'], ['2026-11-09', '0', '3'],
    ]);
    expect(await page.evaluate(`document.querySelector('.planning-burndown').textContent`)).toContain('without estimates');
    await page.evaluate(`planningTest.setCatalog({...planningTest.catalog,cards:[],runs:[{...planningTest.run,finishedAt:'2026-11-09T12:00:00Z',history:[planningTest.run.history[2]],statistics:{date:'2026-11-09',capturedAt:'2026-11-09T12:00:00Z',tasks:4,done:4,effort:3,doneEffort:3,unestimated:1,states:[],owners:[],decks:[],priorities:[],completedEffort:[]}}]})`);
    await until(`document.querySelectorAll('.planning-burndown circle').length === 1`);
    expect(await page.evaluate(`document.querySelector('.planning-history-table tbody').textContent`)).toBe('2026-11-0903');
    expect(await page.evaluate(`document.querySelector('.planning-stats-summary').textContent`)).toContain('4 / 4');
  });

  it('planning: remembers grouping per project/source/kind/id and handles corrupt or denied storage', async () => {
    await reset('planning-probe');
    const showGrouping = async () => {
      await page.evaluate(`document.querySelector('button[aria-label="Grouping"]').click()`);
      await until(`Boolean(document.querySelector('[aria-label="Group cards in plan"]'))`);
    };
    await showGrouping();
    await page.evaluate(`let select=document.querySelector('[aria-label="Group cards in plan"]');select.value='milestone';select.dispatchEvent(new Event('change',{bubbles:true}))`);
    await until(`document.querySelector('[aria-label="Group cards in plan"]').value === 'milestone'`);
    await page.evaluate(`planningTest.setTarget({kind:'run',id:'other'})`);
    await until(`document.querySelector('[aria-label="Group cards in plan"]').value === 'manual'`);
    await page.evaluate(`planningTest.setTarget({kind:'run',id:'same'})`);
    await until(`document.querySelector('[aria-label="Group cards in plan"]').value === 'milestone'`);
    await page.evaluate(`statesTest.input('.planning-search input','absent')`);
    await until(`Boolean(document.querySelector('.planning-cards .ui-empty-filtered'))`);
    expect(await page.evaluate(`document.querySelectorAll('.planning-card-group').length`)).toBe(0);
    for (const change of [
      `planningTest.setTarget({kind:'milestone',id:'same'})`,
      `planningTest.setSource('live')`,
      `planningTest.setCatalog({...planningTest.catalog,rootIdentity:'another-project'})`,
    ]) {
      await page.evaluate(change);
      await until(`document.querySelector('[aria-label="Group cards in plan"]').value === 'manual'`);
    }
    await page.evaluate(`localStorage.setItem('deckmate-planning:'+JSON.stringify(['planning-probe','sandbox','run','same'])+':grouping','invalid')`);
    await reset('planning-probe'); await showGrouping();
    expect(await page.evaluate(`document.querySelector('[aria-label="Group cards in plan"]').value`)).toBe('manual');
    await page.evaluate(`Storage.prototype.getItem=()=>{throw new Error('denied')};Storage.prototype.setItem=()=>{throw new Error('denied')};planningTest.setTarget({kind:'run',id:'other'})`);
    await until(`document.querySelector('[aria-label="Group cards in plan"]').value === 'manual'`);
    expect(page.consoleErrors).toEqual([]);
  });

  it('planning: visible group Effort counts only estimated tasks and retains zero and fractional values', async () => {
    await reset('planning-probe');
    await until(`Boolean(document.querySelector('.planning-group-effort'))`);
    expect(await page.evaluate(`document.querySelector('.planning-group-effort').getAttribute('aria-label')`)).toContain('0.5 / 3; Without estimates: 1');
    await page.evaluate(`statesTest.input('.planning-search input','One')`);
    await until(`document.querySelectorAll('.planning-card-grid .deck-card-open').length === 1`);
    expect(await page.evaluate(`document.querySelector('.planning-group-effort').getAttribute('aria-label')`)).toContain('0 / 0; Without estimates: 0');
  });

  it.each(['en', 'ru'])('keeps Timeline controls and empty state usable on a phone in %s', async lang => {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: false });
    try {
      await reset('timeline');
      await page.evaluate(`statesTest.setLang('${lang}')`);
      await until(`Boolean(document.querySelector('.timeline-scroll'))`);
      expect(await page.evaluate(`Boolean(document.querySelector('.timeline-axis-panel.glass-panel') && document.querySelector('.timeline-nothing .ui-empty-first-run'))`)).toBe(true);
      expect(await page.evaluate(`(() => { const panel = document.querySelector('.timeline-nothing').getBoundingClientRect(); const art = document.querySelector('.timeline-nothing .empty-art').getBoundingClientRect(); return art.left >= panel.left && art.right <= panel.right && Math.abs((art.left + art.right - panel.left - panel.right) / 2) < 2; })()`)).toBe(true);
      expect(await page.evaluate(`document.documentElement.scrollWidth <= innerWidth`)).toBe(true);
      expect(await page.evaluate(`(() => { const axis = document.querySelector('.timeline-scroll'); const before = axis.scrollLeft; axis.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); return axis.scrollLeft > before; })()`)).toBe(true);
    } finally {
      await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
    }
  });

  it('distinguishes notification loading from empty and really retries', async () => {
    await reset('notifications', [], ['/api/notifications']);
    await until(`Boolean(document.querySelector('.notifications-trigger'))`);
    await page.evaluate(`document.querySelector('.notifications-trigger').click()`);
    await until(`Boolean(document.querySelector('.notifications-panel [role=status]'))`);
    expect(await page.evaluate(`document.querySelector('.notifications-panel').innerText`)).toContain('Loading notifications');
    await page.evaluate(`statesTest.state.fail=['/api/notifications'];statesTest.state.releases['/api/notifications']()`);
    await until(`Boolean(document.querySelector('.notifications-panel [role=alert]'))`);
    await page.evaluate(`statesTest.state.fail=[];statesTest.state.hold=[];document.querySelector('.notifications-panel .ui-error button').focus();document.querySelector('.notifications-panel .ui-error button').click()`);
    await until(`Boolean(document.querySelector('.notification-card'))`);
    expect(await page.evaluate(`statesTest.state.reads['/api/notifications']`)).toBe(2);
    expect(await page.evaluate('document.activeElement !== document.body')).toBe(true);
  });

  it('distinguishes attachment loading from empty, retries, and retains confirmed files on failure', async () => {
    await reset('attachments', [], ['/api/attachments']);
    await until(`Boolean(document.querySelector('.ui-loading-skeleton [role=status]'))`);
    expect(await page.evaluate(`Boolean(document.querySelector('.ui-empty'))`)).toBe(false);
    await page.evaluate(`statesTest.state.fail=['/api/attachments'];statesTest.state.releases['/api/attachments']()`);
    await until(`Boolean(document.querySelector('.ui-error[role=alert]'))`);
    await page.evaluate(`statesTest.state.fail=[];statesTest.state.hold=[];document.querySelector('.ui-error button').click()`);
    await until(`Boolean(document.querySelector('.attachments-file'))`);
    expect(await page.evaluate(`document.querySelector('.attachments-file').textContent`)).toBe('Recovered.pdf');
    await page.evaluate(`statesTest.state.hold=['/api/attachments'];statesTest.changeAttachments()`);
    await until(`Boolean(document.querySelector('.ui-loading-keep-data [role=status]'))`);
    expect(await page.evaluate(`document.querySelector('.attachments-file').textContent`)).toBe('Recovered.pdf');
    await page.evaluate(`statesTest.state.fail=['/api/attachments'];statesTest.state.releases['/api/attachments']()`);
    await until(`Boolean(document.querySelector('.ui-error[role=alert]'))`);
    expect(await page.evaluate(`document.querySelector('.attachments-file').textContent`)).toBe('Recovered.pdf');
    await page.evaluate(`statesTest.state.fail=[];statesTest.state.hold=[];statesTest.state.files=[];document.querySelector('.ui-error button').click()`);
    await until(`Boolean(document.querySelector('.ui-empty[role=status]'))`);
    expect(await page.evaluate(`Boolean(document.querySelector('.ui-loading-skeleton [role=status]'))`)).toBe(false);
  });

  it.each(['quick', 'tag-picker', 'editor'])('distinguishes an empty %s selector from no matches and resets the query', async screen => {
    await reset(screen);
    if (screen === 'editor') {
      await until(`Boolean(document.querySelector('textarea'))`);
      expect(await page.evaluate(`document.querySelector('textarea').getAttribute('role')`)).toBe('combobox');
      expect(await page.evaluate(`document.querySelector('textarea').getAttribute('aria-expanded')`)).toBe('false');
      await page.evaluate(`document.querySelector('textarea').focus()`);
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'End', code: 'End', windowsVirtualKeyCode: 35 });
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'End', code: 'End', windowsVirtualKeyCode: 35 });
    }
    await until(`Boolean(document.querySelector('.ui-empty-quiet'))`);
    const selector = screen === 'editor' ? 'textarea' : 'input';
    await page.evaluate(`statesTest.input('${selector}', ${JSON.stringify(screen === 'editor' ? '@absent' : 'absent')})`);
    if (screen === 'editor') {
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'End', code: 'End', windowsVirtualKeyCode: 35 });
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'End', code: 'End', windowsVirtualKeyCode: 35 });
    }
    await until(`Boolean(document.querySelector('.ui-empty-filtered'))`);
    if (screen === 'editor') expect(await page.evaluate(`document.querySelector('textarea').getAttribute('aria-expanded')`)).toBe('true');
    if (screen === 'quick') {
      expect(await page.evaluate(`document.querySelector('.ui-empty-filtered button').getBoundingClientRect().bottom <= document.querySelector('.deck-choice-list').getBoundingClientRect().bottom`)).toBe(true);
    }
    await page.evaluate(`document.querySelector('.ui-empty-filtered button').click()`);
    await until(`Boolean(document.querySelector('.ui-empty-quiet'))`);
    expect(await page.evaluate(`document.querySelector('${selector}').value`)).toBe(screen === 'editor' ? '@' : '');
  });

  it('toggles only the exact My Cards query with physical Q, including Russian layout', async () => {
    await reset('search');
    await until(`statesTest.state.reads['/api/catalog'] === 1`);
    await page.evaluate(`document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'й',code:'KeyQ',bubbles:true,cancelable:true}))`);
    await until(`document.querySelector('.global-search input').value === '@builder'`);
    const cancelled = await page.evaluate(`!document.querySelector('.global-search input').dispatchEvent(new KeyboardEvent('keydown',{key:'й',code:'KeyQ',bubbles:true,cancelable:true}))`);
    expect(cancelled).toBe(true);
    await until(`document.querySelector('.global-search input').value === ''`);
    for (const query of ['@builder extra', ' @builder', '@builder ', 'some query']) {
      await page.evaluate(`statesTest.input('.global-search input',${JSON.stringify(query)});document.querySelector('.global-search input').focus()`);
      expect(await page.evaluate(`document.querySelector('.global-search input').dispatchEvent(new KeyboardEvent('keydown',{key:'й',code:'KeyQ',bubbles:true,cancelable:true}))`)).toBe(true);
      expect(await page.evaluate(`document.querySelector('.global-search input').value`)).toBe(query);
    }
    await page.evaluate(`statesTest.input('.global-search input','');document.querySelector('.global-search input').blur();window.dispatchEvent(new CustomEvent('deckmate:current-member',{detail:'missing-member'}))`);
    await delay(30);
    await page.evaluate(`document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'q',code:'KeyQ',bubbles:true,cancelable:true}))`);
    expect(await page.evaluate(`document.querySelector('.global-search input').value`)).toBe('');
  });

  it('R23 removes one trailing filter with Backspace and preserves free text, selection and IME', async () => {
    await reset('search');
    await until(`Boolean(document.querySelector('.global-search input'))`);
    for (const [query, expected] of [['words !kind:task', 'words'], ['#tag @builder', '#tag'], ['kind:task ', ''], ['kind:task', '']]) {
      await page.evaluate(`statesTest.input('.global-search input',${JSON.stringify(query)})`);
      await until(`document.querySelector('.global-search input').value === ${JSON.stringify(query)}`);
      await page.evaluate(`(()=>{const input=document.querySelector('.global-search input');input.focus();input.setSelectionRange(input.value.length,input.value.length)})()`);
      for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
      expect(await page.evaluate(`document.querySelector('.global-search input').value`)).toBe(expected);
    }
    for (const [query, start, end, composing] of [['kind:task words', 15, 15, false], ['kind:task', 3, 3, false], ['kind:task', 0, 9, false], ['kind:task', 9, 9, true], ['', 0, 0, false]] as const) {
      await page.evaluate(`statesTest.input('.global-search input',${JSON.stringify(query)})`);
      await until(`document.querySelector('.global-search input').value === ${JSON.stringify(query)}`);
      expect(await page.evaluate(`(()=>{const input=document.querySelector('.global-search input');input.setSelectionRange(${start},${end});return input.dispatchEvent(new KeyboardEvent('keydown',{key:'Backspace',code:'Backspace',bubbles:true,cancelable:true,isComposing:${composing}}))})()`)).toBe(true);
      expect(await page.evaluate(`document.querySelector('.global-search input').value`)).toBe(query);
    }
  });

  it.each(['en', 'ru'])('R25 explains read-only notifications accurately in %s for direct and sandbox projects', async lang => {
    for (const editMode of ['direct', 'sandbox']) {
      await reset('notifications');
      await page.evaluate(`statesTest.setLang('${lang}');statesTest.state.notificationAccess={source:'live',writable:false,editMode:'${editMode}',projectName:'Read only'};statesTest.render('notifications')`);
      await until(`Boolean(document.querySelector('.notifications-trigger'))`);
      await page.evaluate(`document.querySelector('.notifications-trigger').click()`);
      await until(`Boolean(document.querySelector('.notification-stack-owned'))`);
      const copy = await page.evaluate(`document.querySelector('.notifications-panel').textContent`);
      const expected = editMode === 'sandbox'
        ? (lang === 'ru' ? 'Оригинал открыт только для чтения.' : 'The original is open for reading only.')
        : (lang === 'ru' ? 'Проект открыт только для чтения.' : 'This project is open for reading only.');
      expect(copy).toContain(expected);
      expect(copy).toContain(lang === 'ru' ? 'источнике с разрешённой записью' : 'source with write access');
      expect(await page.evaluate(`document.querySelector('.notification-hold').disabled && !document.querySelector('.notification-stack-due .notification-hold')`)).toBe(true);
    }
  });

  it('A10 reveals offline recovery instructions on a touch tap with a 44px target', async () => {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: false });
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    try {
      await reset('status-offline');
      await until(`Boolean(document.querySelector('.server-status.is-offline'))`);
      const point = await page.evaluate(`(()=>{const button=document.querySelector('.server-status'),r=button.getBoundingClientRect(),face=button.querySelector('.server-status-face').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+2,width:r.width,height:r.height,aboveFace:r.y+2<face.top}})()`);
      expect(point.width).toBeGreaterThanOrEqual(44); expect(point.height).toBeGreaterThanOrEqual(44);
      expect(point.aboveFace).toBe(true);
      expect(await page.evaluate(`document.querySelector('.server-status-face').getBoundingClientRect().height`)).toBe(22);
      await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: point.x, y: point.y }] });
      await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await until(`Boolean(document.querySelector('.server-status-card'))`);
      expect(await page.evaluate(`document.querySelector('.server-status-detail').textContent`)).toContain('npx deckmate');
      expect(await page.evaluate(`document.querySelector('.server-status').getAttribute('aria-expanded')`)).toBe('true');
      expect(await page.evaluate(`getComputedStyle(document.querySelector('.server-status-labels')).display`)).toBe('grid');
    } finally {
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: false });
      await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
    }
  });

  it('does not mistake an unstarted tag-card search for an empty project', async () => {
    await reset('tag-editor');
    await until(`Boolean(document.querySelector('.card-tag-open'))`);
    await page.evaluate(`document.querySelector('.card-tag-open').click()`);
    await until(`Boolean(document.querySelector('.tag-picker-dialog'))`);
    await page.evaluate(`document.querySelector('.tag-create').click()`);
    await until(`Boolean(document.querySelector('.tag-card-link input'))`);
    expect(await page.evaluate(`Boolean(document.querySelector('.tag-card-link .ui-empty'))`)).toBe(false);
    await page.evaluate(`statesTest.input('.tag-card-link input','absent')`);
    await until(`Boolean(document.querySelector('.tag-card-link .ui-empty-filtered'))`);
    await page.evaluate(`document.querySelector('.tag-card-link .ui-empty-filtered button').click()`);
    await until(`!document.querySelector('.tag-card-link .ui-empty')`);
  });

  it.each(['dark', 'light'])('submits the tag editor from its visible touch footer and restores focus (%s)', async theme => {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 600, deviceScaleFactor: 1, mobile: false });
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    try {
      await reset('tag-editor');
      await until(`Boolean(document.querySelector('.card-tag-open'))`);
      await page.evaluate(`statesTest.setLang('ru');document.documentElement.classList.toggle('dark', ${theme === 'dark'});document.querySelector('.card-tag-open').click()`);
      await until(`Boolean(document.querySelector('.tag-create'))`);
      await page.evaluate(`document.querySelector('.tag-create').click()`);
      await until(`Boolean(document.querySelector('.tag-editor'))`);
      await page.evaluate(`statesTest.input('.tag-editor fieldset > label input','Проверка тега');document.querySelectorAll('.tag-icon-tabs [role="radio"]')[2].click()`);
      await until(`Boolean(document.querySelector('.tag-symbol-choice'))`);
      await page.evaluate(`document.querySelector('.tag-symbol-choice').click()`);
      const controls = await page.evaluate(`(() => {
        const panel = document.querySelector('.tag-picker-dialog'), body = panel.querySelector('.dialog-body');
        const save = panel.querySelector('button[type="submit"]'), r = save.getBoundingClientRect();
        return { scrolls:body.scrollHeight > body.clientHeight, overflow:panel.scrollWidth > panel.clientWidth,
          visible:r.top >= 0 && r.bottom <= innerHeight, height:r.height, width:r.width, form:save.form === panel.querySelector('form'), x:r.x+r.width/2, y:r.y+r.height/2 };
      })()`);
      expect(controls).toMatchObject({ scrolls: true, overflow: false, visible: true, form: true });
      expect(controls.height).toBeGreaterThanOrEqual(44);
      expect(controls.width).toBeGreaterThanOrEqual(44);
      for (const type of ['mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x: controls.x, y: controls.y, button: 'left', clickCount: 1 });
      await until(`!document.querySelector('.tag-editor') && document.querySelector('.tag-feedback')?.textContent.includes('Тег создан')`);
      await page.evaluate(`document.querySelector('.tag-picker-heading button').click()`);
      await until(`!document.querySelector('.tag-picker-dialog') && document.activeElement === document.querySelector('.card-tag-open')`);
    } finally {
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: false });
      await page.send('Emulation.clearDeviceMetricsOverride', {});
    }
  });

  it('shows failed quest refresh without losing progress and recovers on retry', async () => {
    await reset('quests', ['/api/onboarding-facts']);
    await until(`Boolean(document.querySelector('.level-badge'))`);
    await page.evaluate(`document.querySelector('.level-badge').click()`);
    await until(`Boolean(document.querySelector('.level-panel .ui-error[role=alert]'))`);
    expect(await page.evaluate(`document.querySelector('.level-panel .ui-error').textContent`)).toContain('last known progress');
    await page.evaluate(`statesTest.state.fail=[];document.querySelector('.level-panel .ui-error button').focus();document.querySelector('.level-panel .ui-error button').click()`);
    await until(`!document.querySelector('.level-panel .ui-error[role=alert]')`);
    expect(await page.evaluate(`document.activeElement === document.querySelector('.level-panel-body')`)).toBe(true);
    expect(await page.evaluate(`document.querySelectorAll('.level-quest').length`)).toBeGreaterThan(0);
  });

  it('starts with one recommended quest and lets the person open other chapters', async () => {
    await reset('quests');
    await until(`Boolean(document.querySelector('.level-badge'))`);
    await page.evaluate(`document.querySelector('.level-badge').click()`);
    await until(`Boolean(document.querySelector('.level-panel'))`);
    expect(await page.evaluate(`document.querySelectorAll('.level-chapter-head[aria-expanded="true"]').length`)).toBe(1);
    expect(await page.evaluate(`document.querySelectorAll('.level-quest-row[aria-expanded="true"]').length`)).toBe(1);
    expect(await page.evaluate(`document.querySelectorAll('.level-chapter-progress').length`)).toBeGreaterThan(1);
    await page.evaluate(`document.querySelectorAll('.level-chapter-head')[1].click()`);
    expect(await page.evaluate(`document.querySelectorAll('.level-chapter-head[aria-expanded="true"]').length`)).toBe(2);
  });

  // 2026-11-11: a project with no decks has no cover to click; the first quest names an action that exists there,
  // and «Show me» rings that action instead of searching for a missing cover. The components screen loads no
  // catalog, so the flag is set before the quests screen makes the badge's first catalog read.
  it('points the first quest at creating a deck when the project has no decks', async () => {
    await reset('components');
    await page.evaluate(`statesTest.state.catalogEmpty=true;statesTest.render('quests')`);
    await until(`Boolean(document.querySelector('.level-badge'))`);
    await page.evaluate(`document.querySelector('.level-badge').click()`);
    await until(`Boolean(document.querySelector('.level-panel'))`);
    expect(await page.evaluate(`document.querySelector('.level-quest-hint p').textContent`)).toContain('Create space');
    await page.evaluate(`window.action=document.createElement('button');action.type='button';action.className='deck-gallery-add';action.textContent='Create space';document.body.append(action)`);
    await page.evaluate(`document.querySelector('.level-quest-hint .ui-button').click()`);
    await until(`Boolean(document.querySelector('.deck-gallery-add.show-me-ring'))`);
    await page.evaluate(`action.remove()`);
    await page.evaluate(`statesTest.setLang('ru')`);
    await until(`document.documentElement.lang === 'ru'`);
    expect(await page.evaluate(`document.querySelector('.level-quest-hint p').textContent`)).toContain('Создать пространство');
  });

  it('retains the notification focus surface when a retry returns no notifications', async () => {
    await reset('notifications', ['/api/notifications']);
    await until(`Boolean(document.querySelector('.notifications-trigger'))`);
    await page.evaluate(`document.querySelector('.notifications-trigger').click()`);
    await until(`Boolean(document.querySelector('.notifications-panel .ui-error[role=alert]'))`);
    await page.evaluate(`statesTest.state.fail=[];statesTest.state.notificationsEmpty=true;document.querySelector('.ui-error button').focus();document.querySelector('.ui-error button').click()`);
    await until(`Boolean(document.querySelector('.notifications-note[role=status]'))`);
    expect(await page.evaluate(`document.activeElement.classList.contains('notifications-body')`)).toBe(true);
    await page.evaluate(`document.querySelector('.notifications-close').click()`);
    await until(`!document.querySelector('.notifications-panel')`);
    expect(await page.evaluate(`document.activeElement.classList.contains('notifications-trigger')`)).toBe(true);
  });

  it('never reports successful card creation as failure when recent-deck storage is unavailable', async () => {
    await reset('composer');
    await until(`Boolean(document.querySelector('textarea'))`);
    await page.evaluate(`Storage.prototype.setItem=function(){throw new Error('Storage full')};statesTest.input('textarea','Saved Sub Card')`);
    await page.evaluate(`document.querySelector('form').requestSubmit()`);
    await until(`Boolean(document.querySelector('.card-family-composer .ui-empty'))`);
    expect(await page.evaluate('statesTest.state.created')).toBe(1);
    expect(await page.evaluate(`document.querySelector('.ui-empty').textContent`)).toContain('The card is saved');
    expect(await page.evaluate(`Boolean(document.querySelector('.card-family-composer-error'))`)).toBe(false);
    await page.evaluate(`document.querySelector('form').requestSubmit();document.querySelector('.ui-empty button').click()`);
    expect(await page.evaluate('statesTest.state.created')).toBe(1);
    expect(await page.evaluate('statesTest.state.opened')).toBe(1);
  });
});
