import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openHeadlessBrowser, type HeadlessPage } from '../tools/layout-capture.ts';
import { browserFixtureUrl } from './browser-fixture.ts';
import { requireBrowser } from './browser-environment.ts';

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
    await until('Boolean(window.statesTest)');
    await page.evaluate(`statesTest.setLang('en');localStorage.setItem('deckmate-current-member','builder');statesTest.state.fail=${JSON.stringify(fail)};statesTest.state.hold=${JSON.stringify(hold)};statesTest.render(${JSON.stringify(screen)})`);
  }
  beforeAll(async () => {
    // 2026-11-10: recovery tests reuse built fixtures; per-file dependency optimization adds no coverage.
    page = await openHeadlessBrowser({ width: 1280, height: 1000, scale: 1 });
    await reset();
  }, 90000);
  afterAll(async () => {
    await page?.close();
  }, 20000);

  it.each(['en', 'ru'])('renders all variants, roles and default copy in %s', async lang => {
    await reset();
    await page.evaluate(`statesTest.setLang('${lang}')`);
    await until(`document.documentElement.lang === '${lang}'`);
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

  it.each([
    { editMode: 'sandbox', source: 'sandbox', writable: true, description: '', action: null },
    { editMode: 'direct', source: 'sandbox', writable: true, description: '', action: null },
    { editMode: 'sandbox', source: 'live', writable: false, description: 'The original is open for reading only.', action: 'Open test copy →' },
    { editMode: 'sandbox', source: 'sandbox', writable: false, description: 'The original is open for reading only.', action: 'Open test copy →' },
    { editMode: 'direct', source: 'live', writable: false, description: 'This project is open for reading only.', action: null },
    { editMode: 'read-only', source: 'live', writable: false, description: 'This project is open for reading only.', action: null },
    { editMode: 'read-only', source: 'sandbox', writable: false, description: 'This project is open for reading only.', action: null },
  ])('describes read-only access once for $editMode/$source/writable=$writable', async row => {
    await reset();
    const snapshot = { projectName: 'Interface states', token: 'test-token', iteration: { number: 1, goal: '', start: '' },
      editMode: row.editMode, source: row.source, writable: row.writable };
    expect(await page.evaluate(`statesTest.sourceAccess.readOnlyAccess(${JSON.stringify(snapshot)})`))
      .toEqual({ description: row.description, action: row.action });
    expect(await page.evaluate(`statesTest.sourceAccess.readOnlyDescription(${JSON.stringify(snapshot)})`)).toBe(row.description);
    await page.evaluate(`statesTest.setLang('ru')`);
    const access = await page.evaluate(`statesTest.sourceAccess.readOnlyAccess(${JSON.stringify(snapshot)})`) as { description: string; action: string | null };
    let expectedRu = '';
    if (row.description === 'The original is open for reading only.') expectedRu = 'Оригинал открыт только для чтения.';
    else if (row.description === 'This project is open for reading only.') expectedRu = 'Проект открыт только для чтения.';
    expect(access.description).toBe(expectedRu);
    expect(access.action).toBe(row.action === null ? null : 'Открыть тестовую копию →');
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

  it.each(['timeline', 'search', 'members'])('recovers %s from a failed catalog request', async screen => {
    await reset(screen, ['/api/catalog']);
    if (screen === 'search') await page.evaluate(`statesTest.input('.global-search input','Recovered')`);
    await until(`Boolean(document.querySelector('.ui-error[role=alert]'))`);
    await page.evaluate(`statesTest.state.fail=[];statesTest.state.hold=['/api/catalog'];window.retryButton=document.querySelector('.ui-error[role=alert] button');retryButton.focus();retryButton.click();retryButton.click()`);
    await until(`statesTest.state.reads['/api/catalog'] === 2`);
    expect(await page.evaluate('document.activeElement === retryButton')).toBe(true);
    await page.evaluate(`statesTest.state.releases['/api/catalog']()`);
    await until(`!document.querySelector('.ui-error[role=alert]')`);
    expect(await page.evaluate(`Boolean(document.querySelector(${JSON.stringify(screen === 'timeline' ? '.timeline-canvas' : screen === 'search' ? '.global-search-row' : '.members-editor-list')}))`)).toBe(true);
    expect(await page.evaluate('document.activeElement !== document.body')).toBe(true);
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
    await until(`Boolean(document.querySelector('.notifications-corner [role=status]'))`);
    expect(await page.evaluate(`document.querySelector('.notifications-corner').innerText`)).toContain('Loading notifications');
    await page.evaluate(`statesTest.state.fail=['/api/notifications'];statesTest.state.releases['/api/notifications']()`);
    await until(`Boolean(document.querySelector('.notifications-corner [role=alert]'))`);
    await page.evaluate(`statesTest.state.fail=[];statesTest.state.hold=[];document.querySelector('.notifications-corner .ui-error button').focus();document.querySelector('.notifications-corner .ui-error button').click()`);
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

  it('shows failed quest refresh without losing progress and recovers on retry', async () => {
    await reset('quests', ['/api/onboarding-facts']);
    await until(`Boolean(document.querySelector('.level-badge'))`);
    await page.evaluate(`document.querySelector('.level-badge').click()`);
    await until(`Boolean(document.querySelector('.level-panel .ui-error[role=alert]'))`);
    expect(await page.evaluate(`document.querySelector('.level-panel .ui-error').textContent`)).toContain('last known progress');
    await page.evaluate(`statesTest.state.fail=[];document.querySelector('.level-panel .ui-error button').focus();document.querySelector('.level-panel .ui-error button').click()`);
    await until(`!document.querySelector('.level-panel .ui-error[role=alert]')`);
    expect(await page.evaluate('document.activeElement !== document.body')).toBe(true);
    expect(await page.evaluate(`document.querySelectorAll('.level-quest').length`)).toBeGreaterThan(0);
  });

  it('retains the notification focus surface when a retry returns no notifications', async () => {
    await reset('notifications', ['/api/notifications']);
    await until(`Boolean(document.querySelector('.notifications-corner .ui-error[role=alert]'))`);
    await page.evaluate(`statesTest.state.fail=[];statesTest.state.notificationsEmpty=true;document.querySelector('.ui-error button').focus();document.querySelector('.ui-error button').click()`);
    await until(`Boolean(document.querySelector('.notifications-note[role=status]'))`);
    expect(await page.evaluate(`document.activeElement.classList.contains('notifications-corner')`)).toBe(true);
    await page.evaluate(`document.activeElement.blur()`);
    await until(`!document.querySelector('.notifications-corner')`);
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
