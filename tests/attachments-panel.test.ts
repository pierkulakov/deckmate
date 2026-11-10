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
});
