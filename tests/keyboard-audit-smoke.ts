import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { initializeDemo } from '../server/demo.ts';
import { createApp } from '../server/app.ts';
import { openHeadlessBrowser, type HeadlessPage } from '../tools/layout-capture.ts';

const temporary = path.join(tmpdir(), 'opencode');
await mkdir(temporary, { recursive: true });
const root = await mkdtemp(path.join(temporary, 'keyboard-smoke-'));
await initializeDemo(path.join(root, 'demo'));
const project = path.join(root, 'project');
await cp(path.join(root, 'demo'), project, { recursive: true });
process.env.DECKMATE_INDEX = path.join(root, 'index');
const reserve = net.createServer();
await new Promise<void>(resolve => reserve.listen(0, '127.0.0.1', resolve));
const port = (reserve.address() as net.AddressInfo).port;
await new Promise<void>(resolve => reserve.close(() => resolve()));
assert.notEqual(port, 4320);
const app = await createApp({ editMode: 'direct', dataRoot: project, writeRoot: project, projectName: 'Keyboard smoke', port, host: '127.0.0.1', python: 'python' });
let page: HeadlessPage | undefined;
const shots = path.join(root, 'screenshots');
await mkdir(shots);
try {
  await app.listen({ port, host: '127.0.0.1' });
  page = await openHeadlessBrowser({ width: 1700, height: 1100, scale: 1 });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: "localStorage.setItem('deckmate-language', 'ru');" });
  async function wait(expression: string) {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (await page!.evaluate(`Boolean(${expression})`)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Timed out: ' + expression + '\n' + await page!.evaluate('document.body.innerText.slice(0, 4000)'));
  }
  async function navigate(view: string) {
    await page!.send('Page.navigate', { url: `http://127.0.0.1:${port}/?view=${view}` });
    await wait("document.documentElement.lang === 'ru' && document.querySelector('.workspace-main')");
  }
  async function screenshot(name: string) {
    await page!.evaluate('new Promise(resolve => setTimeout(resolve, 400))');
    const shot = await page!.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(path.join(shots, name + '.png'), Buffer.from(shot.result.data, 'base64'));
  }
  await navigate('vision');
  await wait("document.querySelector('.vision-canvas .excalidraw')");
  await page.evaluate(`(() => { const canvas = document.querySelector('.vision-canvas .excalidraw'); canvas.focus(); canvas.dispatchEvent(new KeyboardEvent('keydown', { key: '?', code: 'Slash', shiftKey: true, bubbles: true, cancelable: true })); })()`);
  await wait("document.querySelector('.excalidraw .Modal')");
  assert.equal(await page.evaluate("document.querySelectorAll('.shortcuts-panel').length"), 0);
  assert.equal(await page.evaluate("document.querySelectorAll('.excalidraw .Modal').length"), 1);
  await screenshot('vision-canvas-help');
  console.log('PASS: ? on Vision opens only Excalidraw help');
  await navigate('vision');
  await wait("document.querySelector('.vision-canvas .excalidraw')");
  await page.evaluate(`(() => { const outside = document.querySelector('.vision-toolbar-actions button'); outside.focus(); outside.dispatchEvent(new KeyboardEvent('keydown', { key: '?', code: 'Slash', shiftKey: true, bubbles: true, cancelable: true })); })()`);
  await wait("document.querySelector('.shortcuts-panel')");
  assert.equal(await page.evaluate("document.querySelectorAll('.excalidraw .Modal').length"), 0);
  await screenshot('vision-deckmate-help');
  console.log('PASS: ? outside canvas opens only Deckmate help');
  await navigate('deck');
  await wait("document.querySelector('[data-deck-cover]')");
  await page.evaluate("document.querySelector('[data-deck-cover]').click()");
  await wait("document.querySelector('[data-deck-panel=info]')");
  if (await page.evaluate("document.querySelector('[data-deck-panel=info]').getAttribute('aria-pressed') === 'true'")) {
    await page.evaluate("document.querySelector('[data-deck-panel=info]').click()");
    await wait("document.querySelector('[data-deck-panel=info]').getAttribute('aria-pressed') === 'false'");
  }
  await page.evaluate("document.activeElement.blur(); document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Ь', code: 'KeyM', shiftKey: true, bubbles: true, cancelable: true }))");
  await wait("document.querySelector('[data-deck-panel=info]').getAttribute('aria-pressed') === 'true'");
  await page.evaluate("document.activeElement.blur(); document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Ш', code: 'KeyI', shiftKey: true, bubbles: true, cancelable: true }))");
  await wait("document.querySelector('[data-deck-panel=activity]').getAttribute('aria-pressed') === 'true'");
  await screenshot('russian-activity');
  console.log('PASS: Shift+M and Shift+I open panels in Russian');
  await page.evaluate("document.activeElement.blur(); document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'т', code: 'KeyN', bubbles: true, cancelable: true }))");
  await wait("document.querySelector('textarea.card-edit-text')");
  await page.evaluate(`(() => {
    const field = document.querySelector('textarea.card-edit-text'); field.focus();
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, 'Пример');
    field.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await wait("document.querySelector('textarea.card-edit-text').value === 'Пример'");
  await page.evaluate(`(() => { const field = document.querySelector('textarea.card-edit-text'); field.setSelectionRange(0, field.value.length); field.dispatchEvent(new KeyboardEvent('keydown', { key: 'и', code: 'KeyB', ctrlKey: true, bubbles: true, cancelable: true })); })()`);
  await wait("document.querySelector('textarea.card-edit-text').value === '**Пример**'");
  await screenshot('russian-bold');
  console.log('PASS: Ctrl+B with key=и/code=KeyB makes selected text bold');
  console.log('Console errors:', JSON.stringify(page.consoleErrors));
  console.log('Screenshots:', shots);
} finally {
  await page?.close();
  await app.close();
  console.log('Stopped own browser and server on port', port);
}
