import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBrowserSession } from './browser-session.ts';
import { requireBrowser } from './browser-environment.ts';

const browserPath = requireBrowser();

// 2026-11-09: exercise the real panel buttons, clipboard failures and short feedback without a DOM shim.
describe.skipIf(!browserPath)('attachment row actions (browser)', () => {
  const session = createBrowserSession();
  const { evaluate, until } = session;
  let errors: string[] = [];
  const copyButton = '.attachment-copy-control button';

  async function render(options: object = {}) {
    await evaluate(`window.attachmentsTest.render(${JSON.stringify(options)})`);
    await until(`document.querySelectorAll('.attachments-row').length === 3`);
  }
  async function copy(index: number) {
    await evaluate(`document.querySelectorAll(${JSON.stringify(copyButton)})[${index}].click()`);
  }

  beforeAll(async () => {
    await session.open(browserPath!, { viewport: { width: 1280, height: 1000, scale: 1 } });
    errors = session.errors;
    await session.navigate('attachments-panel', `Boolean(window.attachmentsTest) && document.querySelectorAll('.attachments-row').length === 3`, 600);
  }, 90000);

  afterAll(async () => {
    await session.close();
  }, 20000);

  it.each([
    { lang: 'en', theme: 'dark', writable: true, label: 'Copy link for the card text', copied: 'Copied' },
    { lang: 'en', theme: 'light', writable: false, label: 'Copy link for the card text', copied: 'Copied' },
    { lang: 'ru', theme: 'dark', writable: false, label: 'Скопировать ссылку для текста', copied: 'Скопировано' },
    { lang: 'ru', theme: 'light', writable: true, label: 'Скопировать ссылку для текста', copied: 'Скопировано' },
  ])('copies image, PDF and missing-file Markdown: $lang/$theme, writable=$writable', async options => {
    await render(options);
    expect(await evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(copyButton)}), button => [button.title, button.getAttribute('aria-label'), button.disabled])`))
      .toEqual(Array.from({ length: 3 }, () => [options.label, options.label, false]));
    expect(await evaluate(`document.querySelectorAll('.attachments-cover, input[type="range"]').length`)).toBe(0);
    for (const index of [0, 1, 2]) {
      await copy(index);
      await until(`document.querySelectorAll('.attachment-copy-feedback')[${index}].textContent.includes(${JSON.stringify(options.copied)})`);
    }
    const base = '../deckmate-assets/cards/ca1d0000-0000-4000-8000-000000000001/';
    expect(await evaluate('window.attachmentsTest.state.copies')).toEqual([
      `![Silhouette \\[v2\\].png](${base}00000000-0000-4000-8000-000000000001.png)`,
      `[Brief.pdf](${base}00000000-0000-4000-8000-000000000002.pdf)`,
      `![Missing.png](${base}00000000-0000-4000-8000-000000000003.png)`,
    ]);
    expect(await evaluate('window.attachmentsTest.state.actions')).toEqual([]);
    expect(await evaluate(`(() => { const panel = document.querySelector('.attachments-panel').getBoundingClientRect();
      return Array.from(document.querySelectorAll('.attachments-row-actions, .attachment-copy-feedback:not(:empty)'), element => {
        const box = element.getBoundingClientRect(); return box.left >= panel.left && box.right <= panel.right;
      }).every(Boolean); })()`)).toBe(true);
    await until(`Array.from(document.querySelectorAll('.attachment-copy-feedback')).every(element => element.textContent.trim() === '')`);
  });

  it('reports clipboard failure without claiming a successful copy', async () => {
    await render({ lang: 'ru' });
    await evaluate('window.attachmentsTest.state.failCopy = true');
    await copy(0);
    await until(`document.querySelector('.attachment-copy-feedback').textContent.includes('Не удалось скопировать')`);
    expect(await evaluate('window.attachmentsTest.state.copies')).toEqual([]);
    expect(await evaluate(`document.querySelector(${JSON.stringify(copyButton)}).hasAttribute('data-copied')`)).toBe(false);
  });

  it('uses the eye for image viewing, even read-only, without writing a cover', async () => {
    await render({ writable: false });
    await evaluate(`document.querySelector('.attachments-row-actions button[title="View Silhouette [v2].png"]').click()`);
    await until(`Boolean(document.querySelector('.attachment-viewer'))`);
    expect(await evaluate('window.attachmentsTest.state.actions')).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('recentres a panned image slot when zoom returns to 100%', async () => {
    await render({ writable: false });
    await evaluate(`document.querySelector('.attachments-row-actions button[title="View Silhouette [v2].png"]').click()`);
    await until(`Boolean(document.querySelector('.attachment-viewer'))`);
    await evaluate(`document.querySelector('.attachment-viewer [aria-label="Zoom in"]').click()`);
    await until(`document.querySelector('.attachment-viewer-zoom').textContent === '125%'`);
    const point = await evaluate(`(() => { const r=document.querySelector('.attachment-viewer-pan').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}; })()`);
    await session.send('Input.dispatchMouseEvent', { type:'mousePressed', button:'left', clickCount:1, ...point });
    await until(`document.querySelector('.attachment-viewer-pan').classList.contains('is-dragging')`);
    // 2026-11-11: Edge releases capture before mousemove when the held button is omitted from the CDP command.
    await session.send('Input.dispatchMouseEvent', { type:'mouseMoved', button:'left', buttons:1, x:point.x+80, y:point.y+40 });
    // 2026-11-11: pointer coordinates can be subpixel; compare translation numerically before releasing capture.
    await until(`(() => { const transform = new DOMMatrix(getComputedStyle(document.querySelector('.attachment-viewer-pan > :is(img, .image-fallback)')).transform);
      return Math.abs(transform.m41 - 80) < 0.01 && Math.abs(transform.m42 - 40) < 0.01; })()`);
    await session.send('Input.dispatchMouseEvent', { type:'mouseReleased', button:'left', clickCount:1, x:point.x+80, y:point.y+40 });
    await evaluate(`document.querySelector('.attachment-viewer [aria-label="Zoom out"]').click()`);
    await until(`document.querySelector('.attachment-viewer-zoom').textContent === '100%'`);
    expect(await evaluate(`document.querySelector('.attachment-viewer-pan > :is(img, .image-fallback)').style.transform`)).toBe('translate(0px, 0px) scale(1)');
  });

  it('returns keyboard focus to the image opener after Escape', async () => {
    await render({ writable: false });
    await evaluate(`(() => {const button=document.querySelector('.attachments-row-actions button[title="View Silhouette [v2].png"]');button.focus();button.click();})()`);
    await until(`Boolean(document.querySelector('.attachment-viewer'))`);
    await session.send('Input.dispatchKeyEvent', { type:'keyDown', key:'Escape', code:'Escape', windowsVirtualKeyCode:27 });
    await session.send('Input.dispatchKeyEvent', { type:'keyUp', key:'Escape', code:'Escape', windowsVirtualKeyCode:27 });
    await until(`!document.querySelector('.attachment-viewer')`);
    await until(`document.activeElement.title === 'View Silhouette [v2].png'`);
    expect(await evaluate('document.activeElement.title')).toBe('View Silhouette [v2].png');
  });

  it('keeps a malformed attachment response recoverable through Retry', async () => {
    await evaluate(`window.attachmentsTest.render({ malformed: true, lang: 'ru' })`);
    await until(`Boolean(document.querySelector('.attachments-message.is-error:not([hidden]) button'))`);
    expect(await evaluate(`document.querySelectorAll('.attachments-row').length`)).toBe(0);
    await evaluate(`window.attachmentsTest.state.malformed = false; document.querySelector('.attachments-message.is-error button').click()`);
    await until(`document.querySelectorAll('.attachments-row').length === 3`);
    expect(await evaluate(`document.querySelector('.attachments-message.is-error').hidden`)).toBe(true);
    expect(errors).toEqual([]);
  });

  it.each([
    { theme: 'light', writable: false }, { theme: 'dark', writable: false },
    { theme: 'light', writable: true }, { theme: 'dark', writable: true },
  ])('shows project files at 375px: $theme, writable=$writable, and opens/reveals without a catalog edit', async ({ theme, writable }) => {
    await session.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 1000, deviceScaleFactor: 1, mobile: false });
    await evaluate(`window.attachmentsTest.render({ links: true, writable: ${writable}, lang: 'ru', theme: ${JSON.stringify(theme)} })`);
    await until(`document.querySelectorAll('.attachments-row').length === 5`);
    expect(await evaluate(`document.querySelector('.attachments-project-path').textContent`)).toBe('ArtSource/Props/Birch/Birch.blend');
    expect(await evaluate(`document.querySelector('.attachments-row-size').textContent`)).toBe('32,0 МБ');
    expect(await evaluate(`document.querySelectorAll('.attachments-row')[1].textContent.includes('Файл не найден')`)).toBe(true);
    expect(await evaluate(`document.querySelectorAll('.attachments-row')[1].querySelectorAll('.attachments-project-actions button').length`)).toBe(0);
    for (const index of [0, 1]) {
      await evaluate(`document.querySelectorAll('.attachments-project-actions button')[${index}].click()`);
      await until(`window.attachmentsTest.state.requests.length === ${index + 1} && !document.querySelector('.attachments-panel').getAttribute('aria-busy').includes('true')`);
    }
    expect(await evaluate('window.attachmentsTest.state.requests')).toEqual(['open', 'reveal'].map(action => ({
      url: `/api/attachments/${action}`, headers: { 'content-type': 'application/json', 'x-deckmate-token': 'test-token' },
      body: { source: 'sandbox', cardId: 'card:test', file: 'ArtSource/Props/Birch/Birch.blend' },
    })));
    expect(await evaluate(`document.documentElement.scrollWidth <= innerWidth`)).toBe(true);
    expect(await evaluate(`Array.from(document.querySelectorAll('.attachments-project-path, .attachments-project-actions button, .attachments-project-form input'), element => element.getBoundingClientRect().right <= innerWidth).every(Boolean)`)).toBe(true);
    expect(errors).toEqual([]);
  });

  it('attaches a project path through the catalog action, without uploading bytes', async () => {
    await render({ lang: 'ru' });
    await evaluate(`(() => { const input = document.querySelector('.attachments-project-form input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'ArtSource/Props/Birch/Birch.blend');
      input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await until(`!document.querySelector('.attachments-project-form button').disabled`);
    await evaluate(`document.querySelector('.attachments-project-form button').click()`);
    await until(`window.attachmentsTest.state.actions.length === 1`);
    expect(await evaluate('window.attachmentsTest.state.actions')).toEqual([{
      action: 'attach-project-file', cardId: 'card:test', attachmentsHash: 'attachment-hash', file: 'ArtSource/Props/Birch/Birch.blend',
    }]);
  });

  it.each([
    { lang: 'ru', reveal: 'Показать в папке', message: 'Открытие этого типа заблокировано; доступно «Показать в папке».' },
    { lang: 'en', reveal: 'Show in folder', message: 'Opening this file type is blocked; use Show in folder instead.' },
  ])('hides unsafe open, explains the policy and keeps reveal without a confirmation: $lang', async options => {
    await evaluate(`window.attachmentsTest.render({ links: true, blocked: true, writable: false, lang: ${JSON.stringify(options.lang)} })`);
    await until(`document.querySelectorAll('.attachments-row').length === 6`);
    const row = `Array.from(document.querySelectorAll('.attachments-row')).find(row => row.querySelector('.attachments-project-path')?.textContent === 'ArtSource/invoice.pdf.exe')`;
    expect(await evaluate(`(() => { const row = ${row}; return { buttons: Array.from(row.querySelectorAll('.attachments-project-actions button'), button => [button.textContent, button.disabled]),
      message: row.querySelector('.attachments-message').textContent }; })()`)).toEqual({ buttons: [[options.reveal, false]], message: options.message });
    await evaluate(`(${row}).querySelector('.attachments-project-actions button').click()`);
    await until(`window.attachmentsTest.state.requests.length === 1 && !document.querySelector('.attachments-panel').getAttribute('aria-busy').includes('true')`);
    expect(await evaluate(`window.attachmentsTest.state.requests[0].url`)).toBe('/api/attachments/reveal');
    expect(await evaluate(`window.attachmentsTest.state.requests[0].body.file`)).toBe('ArtSource/invoice.pdf.exe');
    expect(await evaluate(`document.querySelectorAll('[role="alertdialog"]').length`)).toBe(0);
    expect(await evaluate('window.attachmentsTest.state.actions')).toEqual([]);
    expect(await evaluate(`document.documentElement.scrollWidth <= innerWidth`)).toBe(true);
    expect(errors).toEqual([]);
  });

  it('refreshes a disappeared project file after a failed open and removes its launch buttons', async () => {
    await evaluate(`window.attachmentsTest.render({ links: true, lang: 'ru' })`);
    await until(`document.querySelectorAll('.attachments-row').length === 5`);
    await evaluate(`window.attachmentsTest.state.launchMissing = true; document.querySelector('.attachments-project-actions button').click()`);
    await until(`document.querySelectorAll('.attachments-project-actions button').length === 0`);
    expect(await evaluate(`document.querySelector('.attachments-message.is-error').textContent`)).toContain('File not found');
    await evaluate(`document.querySelector('.attachments-row button[aria-label="Открепить ссылку"]').click()`);
    await until(`window.attachmentsTest.state.actions.length === 1`);
    expect(await evaluate(`window.attachmentsTest.state.actions[0].action`)).toBe('detach-project-file');
  });
});
