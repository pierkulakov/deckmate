import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openHeadlessBrowser, type HeadlessPage } from '../tools/layout-capture.ts';

// 2026-11-10: capture the actual built app, not a second mock of the workbench, for before/after review.
const phase = process.argv[2] ?? 'after';
const output = '.deckmate/inbox/ux/swarm/open-deck';
mkdirSync(output, { recursive: true });
const measurements: unknown[] = [];
async function until(page: HeadlessPage, expression: string) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await page.evaluate(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(expression + '\n' + page.consoleErrors.join('\n'));
}
for (const width of [1440, 375]) {
  const height = width === 375 ? 812 : 900;
  const page = await openHeadlessBrowser({ width, height, scale: 1 });
  try {
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `
      localStorage.setItem('deckmate-language', 'ru');
      const realFetch = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const mode = new URLSearchParams(location.search).get('captureActivity');
        if (mode && new URL(String(input), location.href).pathname === '/api/activity') {
          if (mode === 'loading') return new Promise(() => {});
          return Promise.resolve(Response.json({ message: 'Не удалось загрузить журнал. Повторите попытку.' }, { status: 503 }));
        }
        return realFetch(input, init);
      };
    ` });
    for (const theme of ['dark', 'light']) {
      async function capture(name: string) {
        await page.evaluate(`document.documentElement.classList.toggle('dark', ${theme === 'dark'}); document.querySelector('.workspace-main').scrollTop = 0; document.activeElement?.blur();`);
        await new Promise(resolve => setTimeout(resolve, 350));
        const shot = await page.send('Page.captureScreenshot', { format: 'png' });
        const file = `${phase}-${theme}-${width}-${name}.png`;
        writeFileSync(path.join(output, file), Buffer.from(shot.result.data, 'base64'));
        measurements.push({ file, ...await page.evaluate(`(() => { const root = document.querySelector('.workspace-main'); return { documentWidth: document.documentElement.scrollWidth, viewport: innerWidth, workspaceWidth: root.clientWidth, workspaceScrollWidth: root.scrollWidth, panels: [...document.querySelectorAll('.deck-overview, .deck-panel, .deck-activity')].map(el => ({ class: el.className, width: el.clientWidth, scrollWidth: el.scrollWidth })) }; })()`) });
      }
      await page.send('Page.navigate', { url: 'http://127.0.0.1:4483/?view=deck&catalogSource=sandbox' });
      await until(page, `Boolean(document.querySelector('.catalog-space'))`);
      await capture('home');
      for (const deck of ['world', 'empty']) {
        await page.send('Page.navigate', { url: `http://127.0.0.1:4483/?view=deck&catalogSource=sandbox&deck=${deck}` });
        await until(page, `Boolean(document.querySelector('.deck-action-rail'))`);
        for (const panel of ['info', 'ordering', 'tags', 'activity', 'closed']) {
          await page.callFunction(`function(panel) {
            const rail = document.querySelector('.deck-action-rail');
            const buttons = [...rail.querySelectorAll('button[aria-pressed]')];
            const target = { info: buttons[0], ordering: buttons[1], tags: buttons[2], activity: buttons[3] }[panel];
            if (panel === 'closed') buttons.find(button => button.getAttribute('aria-pressed') === 'true')?.click();
            else if (target.getAttribute('aria-pressed') !== 'true') target.click();
          }`, panel);
          await until(page, `!document.querySelector('.deck-activity-loading')`);
          await capture(`${deck}-${panel}`);
        }
        await page.evaluate(`const input = document.querySelector('.deck-toolbar-search input'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, 'несуществующая карточка'); input.dispatchEvent(new Event('input', { bubbles: true }));`);
        await capture(`${deck}-filtered`);
      }
      if (phase === 'after') for (const state of ['loading', 'error']) {
        await page.send('Page.navigate', { url: `http://127.0.0.1:4483/?view=deck&catalogSource=sandbox&deck=empty&captureActivity=${state}` });
        await until(page, `Boolean(document.querySelector('.deck-action-rail'))`);
        await page.evaluate(`const button = document.querySelector('[data-deck-panel=activity]'); if (button.getAttribute('aria-pressed') !== 'true') button.click();`);
        await until(page, `Boolean(document.querySelector('.deck-activity-${state}'))`);
        await capture(`empty-activity-${state}`);
      }
    }
    if (page.consoleErrors.length) throw new Error(page.consoleErrors.join('\n'));
  } finally { await page.close(); }
}
writeFileSync(path.join(output, `${phase}-measurements.json`), JSON.stringify(measurements, null, 2));
console.log(`${measurements.length} captures: ${output}`);
