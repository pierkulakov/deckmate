import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createBrowserSession } from './browser-session.ts';
import { requireBrowser } from './browser-environment.ts';

const browserPath = requireBrowser();
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const initial = 'Attachment test\n\nBefore AFTER';
const image = '![Sketch \\[v2\\].png](../deckmate-assets/cards/example/sketch.png)';
const pdf = '[Brief.pdf](../deckmate-assets/cards/example/brief.pdf)';

// Native focus, undo and the asynchronous Radix menu need the same browser editing path as the application.
describe.skipIf(!browserPath)('card attachment insertion (headless CDP)', () => {
  const session = createBrowserSession();
  const { send, evaluate, until } = session;
  let errors: string[] = [];
  async function key(key: string, modifiers = 0) {
    const codes: Record<string, number> = { Enter: 13, Escape: 27, ArrowDown: 40, ArrowUp: 38, Home: 36, End: 35, z: 90, ' ': 32 };
    for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', {
      type, key, code: key === ' ' ? 'Space' : key, modifiers, windowsVirtualKeyCode: codes[key],
      text: type === 'keyDown' && key === 'Enter' ? '\r' : undefined,
    });
    await delay(40);
  }
  async function edit(options: object = {}) {
    await evaluate(`window.attachmentEditorTest.render(${JSON.stringify(options)})`);
    await until(`Boolean(document.querySelector('.card-content-edit-action:not(:disabled)'))`);
    await evaluate(`document.querySelector('.card-content-edit-action').click()`);
    await until(`Boolean(document.querySelector('.card-edit-text'))`);
  }
  async function open(keyName = 'Enter') {
    await evaluate(`document.querySelector('.card-edit-insert').focus()`);
    await key(keyName);
    await until(`Boolean(document.querySelector('.card-edit-attachments'))`);
  }
  async function selection(start: number, end = start) {
    await evaluate(`(() => { const text = document.querySelector('.card-edit-text'); text.focus(); text.setSelectionRange(${start}, ${end}); })()`);
  }
  const value = () => evaluate(`document.querySelector('.card-edit-text').value`);
  const highlighted = () => evaluate(`document.querySelector('.card-edit-attachment[data-highlighted]')?.textContent`);

  beforeAll(async () => {
    await session.open(browserPath!);
    errors = session.errors;
    await session.navigate('card-edit-attachments', 'Boolean(window.attachmentEditorTest)', 600);
  }, 90000);

  afterAll(async () => {
    await session.close();
  }, 20000);

  beforeEach(async () => { await edit(); });

  it('inserts an image at the caret, restores focus, marks the draft dirty, and supports undo', async () => {
    const caret = initial.indexOf('AFTER');
    await selection(caret);
    await open();
    await until(`document.querySelectorAll('.card-edit-attachment').length === 2`);
    await key('ArrowDown');
    expect(await highlighted()).toContain('Sketch [v2].png');
    expect(await highlighted()).toContain('image/png · 2 KB');
    await key('Enter');
    await until(`document.activeElement?.classList.contains('card-edit-text')`);
    expect(await value()).toBe(initial.slice(0, caret) + image + initial.slice(caret));
    expect(await evaluate('document.activeElement.selectionStart')).toBe(caret + image.length);
    expect(await evaluate('document.activeElement.selectionEnd')).toBe(caret + image.length);
    expect(await evaluate('window.attachmentEditorTest.dirty.at(-1)')).toBe(true);
    expect(await evaluate('window.attachmentEditorTest.saves')).toEqual([]);
    await key('z', 2);
    await until(`document.querySelector('.card-edit-text').value === ${JSON.stringify(initial)}`);
    expect(await evaluate('window.attachmentEditorTest.dirty.at(-1)')).toBe(false);
  });

  it('replaces the selection with a PDF link, previews it, and saves through the normal editor', async () => {
    const start = initial.indexOf('Before');
    await selection(start, start + 6);
    await open('ArrowDown');
    await until(`document.querySelectorAll('.card-edit-attachment').length === 2`);
    await key('ArrowDown'); await key('ArrowDown'); await key('ArrowUp'); await key('ArrowDown');
    expect(await highlighted()).toContain('Brief.pdf');
    await key('Enter');
    await until(`document.activeElement?.classList.contains('card-edit-text')`);
    expect(await value()).toBe(initial.slice(0, start) + pdf + initial.slice(start + 6));
    await evaluate(`document.querySelector('.card-edit-footer button').click()`);
    await until(`Boolean(document.querySelector('.card-edit-preview a'))`);
    expect(await evaluate(`document.querySelector('.card-edit-preview a').getAttribute('href')`)).toBe('/api/file?source=sandbox&path=tasks%2Fdeckmate-assets%2Fcards%2Fexample%2Fbrief.pdf');
    expect(await evaluate(`document.querySelector('.card-edit-preview a').target`)).toBe('_blank');
    expect(await evaluate(`document.querySelector('.card-edit-insert').disabled`)).toBe(true);
    await evaluate(`document.querySelector('.card-edit-save').click()`);
    await until(`!document.querySelector('.card-edit-text') && window.attachmentEditorTest.saves.length === 1`);
    expect(await evaluate('window.attachmentEditorTest.saves[0]')).toMatchObject({ action: 'update-card-content', markdown: pdf + ' AFTER', sourceHash: 'original', manifestHash: 'manifest' });
  });

  it.each(['en', 'ru'])('shows the empty state in %s and Escape returns the original caret without cancelling', async lang => {
    await edit({ lang, source: 'live' });
    await evaluate('window.attachmentEditorTest.files = []');
    await selection(20);
    await open(' ');
    await until(`document.querySelector('.card-edit-attachments [role="status"]')?.textContent.includes(${JSON.stringify(lang === 'ru' ? 'Вложений нет' : 'No attachments')})`);
    expect(await evaluate(`document.querySelector('.card-edit-attachments').textContent`)).toContain(lang === 'ru'
      ? 'Вложений нет — добавьте их в панели вложений' : 'No attachments — add them in the attachments panel');
    expect(await evaluate('window.attachmentEditorTest.requests')).toEqual(['/api/attachments?source=live&cardId=card%3Aattachment-test']);
    await key('Escape');
    await until(`document.activeElement?.classList.contains('card-edit-text')`);
    expect(await value()).toBe(initial);
    expect(await evaluate('document.activeElement.selectionStart')).toBe(20);
    expect(await evaluate('window.attachmentEditorTest.dirty.at(-1)')).toBe(false);
  });

  it('retries a failed request and reloads the list after attachments change', async () => {
    await evaluate('window.attachmentEditorTest.failure = true');
    await open();
    await until(`Boolean(document.querySelector('.card-edit-attachments [role="alert"]'))`);
    await evaluate('window.attachmentEditorTest.failure = false');
    await key('ArrowDown'); await key('Enter');
    await until(`document.querySelectorAll('.card-edit-attachment').length === 2`);
    await key('Escape');
    await until(`document.activeElement?.classList.contains('card-edit-text')`);
    await evaluate('window.attachmentEditorTest.files = []');
    await open();
    await until(`document.querySelector('.card-edit-attachments').textContent.includes('No attachments')`);
    expect(await evaluate('window.attachmentEditorTest.requests.length')).toBe(3);
    await key('Escape');
    expect(errors).toEqual([]);
  });
});
