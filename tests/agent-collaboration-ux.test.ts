import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { FastifyInstance } from 'fastify';
import { createServer, type ViteDevServer } from 'vite';
import { createApp } from '../server/app.ts';
import { initializeDemo } from '../server/demo.ts';
import { readProjectCatalog } from '../server/catalog.ts';
import { createManagedMarkdown } from '../server/native-cards.ts';
import { appendActivity } from '../server/activity.ts';
import { openHeadlessBrowser, type HeadlessPage } from '../tools/layout-capture.ts';
import { requireBrowser } from './browser-environment.ts';
import { freePort } from './free-port.ts';

const execute = promisify(execFile);
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const browserPath = requireBrowser();

// 2026-11-10: the real routing, identity picker and question form must agree; mocks of their handlers hide F1/F2.
describe.skipIf(!browserPath)('agent collaboration on a private demo (browser + CLI)', () => {
  let root: string;
  let cache: string;
  let app: FastifyInstance | undefined;
  let vite: ViteDevServer | undefined;
  let page: HeadlessPage | undefined;
  let origin: string;
  const docId = 'card:' + randomUUID();
  const returnedId = 'card:' + randomUUID();
  const reviewIds: string[] = [];
  const reason = 'Путь к причалу перекрыт. Исправить коллизию и приложить видеопроверку.';
  const after = process.env.DECKMATE_UX_AFTER;

  async function until(expression: string) {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (await page!.evaluate(expression)) return;
      await delay(50);
    }
    throw new Error('Timed out: ' + expression + '\n' + page!.consoleErrors.join('\n'));
  }
  async function navigate(query: Record<string, string>) {
    await page!.send('Page.navigate', { url: origin + '/?' + new URLSearchParams({ view: 'deck', catalogSource: 'sandbox', ...query }) });
    await until(`Boolean(document.querySelector('.deck-view, .hand-view'))`);
  }
  async function click(selector: string) {
    await page!.callFunction(`function(selector) { const node = document.querySelector(selector); if (!node) throw new Error(selector); node.click(); }`, selector);
    await delay(100);
  }
  async function select(selector: string, value: string) {
    await page!.callFunction(`function(selector, value) { const node = document.querySelector(selector); node.value = value; node.dispatchEvent(new Event('change', { bubbles: true })); }`, selector, value);
    await delay(100);
  }
  async function capture(name: string) {
    if (!after) return;
    // 2026-11-10: an intermediate opening animation makes a correct opaque menu look transparent in evidence.
    await delay(650);
    await mkdir(after, { recursive: true });
    const image = await page!.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(path.join(after, name + '.png'), Buffer.from(image.result.data, 'base64'));
  }
  // 2026-11-12: questions live in the card's Questions panel, opened from the card rail, not in the card text.
  async function openQuestions() {
    await until(`Boolean(document.querySelector('.card-preview-open-questions:not(:disabled)'))`);
    if (await page!.evaluate(`document.querySelector('.card-preview-open-questions').getAttribute('aria-pressed') !== 'true'`)) await click('.card-preview-open-questions');
    await until(`Boolean(document.querySelector('.open-question-answer-action:not(:disabled)'))`);
  }
  async function cli(args: string[]) {
    return execute(process.execPath, ['tools/project.ts', ...args, '--data', root], {
      cwd: process.cwd(), windowsHide: true,
      env: { ...process.env, DECKMATE_DATA: root, DECKMATE_WRITE: '', DECKMATE_PORT: String(app!.server.address() && (app!.server.address() as { port: number }).port) },
    });
  }

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'deckmate-agent-ux-'));
    cache = await mkdtemp(path.join(tmpdir(), 'deckmate-agent-vite-'));
    await initializeDemo(root);
    for (const deckId of ['world', 'engineering', 'production', null]) {
      const id = randomUUID();
      reviewIds.push('card:' + id);
      await createManagedMarkdown(root, `cards/${id}.md`, { deckmate: 'card', schema: 1, id, kind: 'task', title: 'Agent review ' + (deckId ?? 'no deck'),
        state: 'review', owner: 'Build Agent', deckId, parentId: null, trackIds: [] }, '# Synthetic agent report\n\nChecked a demo scenario; not real game development.');
    }
    await createManagedMarkdown(root, `cards/${docId.slice(5)}.md`, { deckmate: 'card', schema: 1, id: docId.slice(5), kind: 'doc', title: 'Agent acceptance rules',
      state: null, owner: null, deckId: 'knowledge', parentId: null, trackIds: [] }, '# Agent acceptance rules\n\nRead the evidence before accepting.');
    await createManagedMarkdown(root, `cards/${returnedId.slice(5)}.md`, { deckmate: 'card', schema: 1, id: returnedId.slice(5), kind: 'task', title: 'Returned collision check',
      state: 'review', owner: 'Build Agent', deckId: 'engineering', parentId: null, trackIds: [] }, '# Synthetic collision check');
    await appendActivity(root, { schema: 1, id: randomUUID(), at: '2020-01-01T12:00:00.000Z', action: 'set-card-state', actor: 'Deckmate', actorMemberId: 'build-agent',
      cards: [{ id: reviewIds[0], title: 'Agent review world' }], deckIds: ['world'], summary: 'Review requested', details: [],
      transitions: [{ cardId: reviewIds[0], from: 'started', to: 'review' }] }, 'en');
    const port = await freePort();
    app = await createApp({ editMode: 'direct', dataRoot: root, writeRoot: root, projectName: 'Moonwake Studio', port, python: 'python' });
    await app.listen({ host: '127.0.0.1', port });
    await cli(['next', 'build-agent']);
    await cli(['brief', reviewIds[1]]);
    await cli(['ask', docId, 'Which build should we accept?', '--member', 'build-agent', '--to', 'leo']);
    await cli(['ask', docId, 'Which scene should we check?', '--member', 'research-agent', '--to', 'leo']);
    await cli(['state', returnedId, 'started', '--member', 'maya', '--reason', reason]);
    const target = `http://127.0.0.1:${port}`;
    vite = await createServer({ configFile: 'app.vite.config.ts', cacheDir: cache, logLevel: 'error',
      server: { port: 0, strictPort: false, proxy: {
        '^/api/': { target, changeOrigin: true, ws: true, configure(proxy) {
          proxy.on('proxyReq', request => request.setHeader('origin', target));
          proxy.on('proxyReqWs', request => request.setHeader('origin', target));
        } },
        '^/r/': { target, changeOrigin: true },
      } } });
    await vite.listen();
    origin = vite.resolvedUrls!.local[0].replace(/\/$/u, '');
    page = await openHeadlessBrowser({ width: 1280, height: 1000, scale: 1 });
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('deckmate-language', 'ru'); localStorage.setItem('deckmate-theme', 'dark');` });
    await navigate({});
    await until(`Boolean(document.querySelector('.project-pulse-value'))`);
  }, 120000);

  afterAll(async () => {
    await page?.close();
    await vite?.close();
    await app?.close();
    if (root) await rm(root, { recursive: true, force: true });
    if (cache) await rm(cache, { recursive: true, force: true });
  }, 30000);

  it('opens exactly the project-wide review count, across decks and without a deck', async () => {
    const pulse = (await app!.inject({ url: '/api/project-pulse?source=sandbox', headers: { host: new URL(app!.listeningOrigin).host } })).json();
    expect(pulse.review.deckId).toBe('world');
    await capture('01-overview-review-ru');
    expect(await page!.evaluate(`Number(document.querySelectorAll('.project-pulse-value')[1].childNodes[0].textContent)`)).toBe(pulse.review.count);
    await click('.project-pulse-segment:nth-child(2)');
    await until(`Boolean(document.querySelector('.card-filter-bar'))`);
    const query = await page!.evaluate(`location.search`);
    expect(new URLSearchParams(query).get('scope')).toBe('all');
    expect(query).toContain('state');
    const summary = await page!.evaluate(`document.querySelector('.card-filter-count').innerText`);
    expect(summary).toContain(String(pulse.review.count));
    const titles = await page!.evaluate(`Array.from(document.querySelectorAll('.catalog-results .deck-card-title, .catalog-results .catalog-table-title > span')).map(node => node.textContent)`);
    // The rendered list, not just its summary, must include every reviewed card.
    const expected = (await readProjectCatalog(root)).cards.filter(card => card.kind === 'task' && card.state === 'review' && !card.archived && !card.deleted);
    expect(titles).toHaveLength(expected.length);
    for (const card of expected) expect(titles).toContain(card.title);
    await capture('02-all-review-ru');
  }, 30000);

  it('returns to Decks with browser Back after leaving the pulse results for another tab', async () => {
    await navigate({});
    await until(`Boolean(document.querySelector('[data-pulse="review"]:not(:disabled)'))`);
    await click('[data-pulse="review"]');
    await until(`Boolean(document.querySelector('.card-filter-bar'))`);
    await click('.global-tabs button:first-child');
    await until(`Boolean(document.querySelector('.hand-view'))`);
    await page!.evaluate('history.back()');
    await until(`Boolean(document.querySelector('.deck-gallery .project-pulse'))`);
    expect(await page!.evaluate(`document.querySelector('.global-tabs [aria-current="page"]').textContent`)).toBe('Decks');
    await page!.evaluate('history.forward()');
    await until(`Boolean(document.querySelector('.hand-view'))`);
    expect(await page!.evaluate(`document.querySelector('.global-tabs [aria-current="page"]').textContent`)).toBe('Hand');
  });

  it('shows Leo in the form and records the same human in Markdown and activity', async () => {
    await navigate({ card: docId });
    await click('.notifications-trigger');
    await until(`Boolean(document.querySelector('select[aria-label="Действующий участник"]'))`);
    await select('select[aria-label="Действующий участник"]', 'leo');
    await until(`localStorage.getItem('deckmate-current-member') === 'leo'`);
    await click('.notifications-close');
    await openQuestions();
    await click('.open-question-answer-action');
    expect(await page!.evaluate(`document.querySelector('.open-question-answer select').value`)).toBe('leo');
    await capture('03-answer-leo-ru');
    await page!.callFunction(`function() { const field = document.querySelector('.open-question-answer textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, 'Use the checked build.'); field.dispatchEvent(new Event('input', { bubbles: true })); }`);
    await click('.open-question-answer-footer button:last-child');
    await until(`!document.querySelector('.open-question-answer')`);
    const markdown = await readFile(path.join(root, `cards/${docId.slice(5)}.md`), 'utf8');
    expect(markdown).toContain('Use the checked build. — Leo Park,');
    expect(markdown).not.toContain('— Maya Chen');
    const history = (await app!.inject({ url: `/api/card-activity?source=sandbox&cardId=${encodeURIComponent(docId)}`, headers: { host: new URL(app!.listeningOrigin).host } })).json();
    expect(history.events.find((event: { action: string }) => event.action === 'record-decision')).toMatchObject({ actorMemberId: 'leo' });
    await capture('04-decision-recorded-ru');
  }, 30000);

  it('does not change authorship when viewing an agent Hand and requires a human author for an agent or no selection', async () => {
    await navigate({ view: 'hand', handMember: 'leo' });
    await until(`Boolean(document.querySelector('.hand-member-picker select'))`);
    await select('.hand-member-picker select', 'build-agent');
    expect(await page!.evaluate(`localStorage.getItem('deckmate-current-member')`)).toBe('leo');
    expect(await page!.evaluate(`new URLSearchParams(location.search).get('handMember')`)).toBe('build-agent');
    await capture('05-agent-hand-not-actor-ru');
    for (const actor of ['build-agent', '']) {
      await page!.callFunction(`function(actor) { if (actor) localStorage.setItem('deckmate-current-member', actor); else localStorage.removeItem('deckmate-current-member'); }`, actor);
      await navigate({ card: docId });
      await openQuestions();
      await click('.open-question-answer-action');
      const author = await page!.evaluate(`document.querySelector('.open-question-answer select').value`);
      expect(author).toBe('');
      expect(await page!.evaluate(`document.querySelector('.open-question-author').innerText`)).toContain('От имени:');
      expect(await page!.evaluate(`Array.from(document.querySelector('.open-question-answer select').options, option => option.value)`)).not.toContain('build-agent');
      await page!.callFunction(`function() { const field = document.querySelector('.open-question-answer textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, 'Use the verified scene.'); field.dispatchEvent(new Event('input', { bubbles: true })); }`);
      expect(await page!.evaluate(`document.querySelector('.open-question-answer-footer button:last-child').disabled`)).toBe(true);
      await select('.open-question-answer select', 'leo');
      expect(await page!.evaluate(`document.querySelector('.open-question-answer-footer button:last-child').disabled`)).toBe(false);
      await capture(actor ? '06-agent-needs-human-ru' : '07-unselected-needs-human-ru');
    }
    await page!.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 1000, deviceScaleFactor: 1, mobile: false });
    await delay(200);
    await page!.evaluate(`document.querySelector('.open-question-answer').scrollIntoView({ block: 'center', behavior: 'instant' })`);
    await delay(200);
    expect(await page!.evaluate(`document.querySelector('.open-question-answer').scrollWidth <= document.querySelector('.open-question-answer').clientWidth`)).toBe(true);
    await capture('08-human-prompt-375-ru');
    await click('.open-question-answer-footer button:last-child');
    await until(`!document.querySelector('.open-question-answer')`);
    const markdown = await readFile(path.join(root, `cards/${docId.slice(5)}.md`), 'utf8');
    expect(markdown).toContain('Use the verified scene. — Leo Park,');
    await page!.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
  }, 30000);

  it('shows full author, member kind and return reason in both history surfaces', async () => {
    await navigate({ deck: 'engineering' });
    await until(`Boolean(document.querySelector('[aria-label="Активность"]'))`);
    await click('[aria-label="Активность"]');
    await until(`Boolean(document.querySelector('.deck-activity .activity-attribution'))`);
    const feed = await page!.evaluate(`document.querySelector('.deck-activity').innerText`);
    expect(feed).toContain('Maya Chen · Человек');
    expect(feed).toContain(reason);
    await capture('09-deck-activity-author-ru');
    await navigate({ card: returnedId });
    await until(`Boolean(document.querySelector('[data-card-family]'))`);
    await click('[data-card-family]');
    await until(`Boolean(document.querySelector('[title="История изменений открытой карточки"]'))`);
    await click('[title="История изменений открытой карточки"]');
    await until(`Boolean(document.querySelector('.card-history .activity-attribution'))`);
    const history = await page!.evaluate(`document.querySelector('.card-history').innerText`);
    expect(history).toContain('Maya Chen · Человек');
    expect(history).toContain(reason);
    await capture('10-card-history-author-reason-ru');
  }, 30000);

  it('explains agent assignment and queueing in context and keeps deck automation separate from models', async () => {
    await navigate({ card: returnedId });
    await until(`Boolean(document.querySelector('.card-preview-owner-shortcut'))`);
    await click('.card-preview-owner-shortcut');
    await until(`Boolean(document.querySelector('.card-quick-settings'))`);
    expect(await page!.evaluate(`document.querySelector('.card-quick-settings').innerText`)).toContain('Назначение не запускает агента');
    await page!.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 1000, deviceScaleFactor: 1, mobile: false });
    await delay(200);
    expect(await page!.evaluate(`document.querySelector('.deck-picker-popover').scrollWidth <= document.querySelector('.deck-picker-popover').clientWidth`)).toBe(true);
    await capture('11-owner-queue-hint-375-ru');
    await page!.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
    await navigate({ deck: 'engineering' });
    await until(`Boolean(document.querySelector('.deck-table-check, .catalog-card-checkbox'))`);
    await click('.deck-table-check, .catalog-card-checkbox');
    await page!.evaluate(`document.querySelector('.bulk-actions [aria-label="Ещё действия"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
    await until(`Boolean(document.querySelector('.bulk-more-menu'))`);
    await page!.evaluate(`Array.from(document.querySelectorAll('.bulk-more-item')).find(node => node.textContent === 'Hand').click()`);
    await until(`Boolean(document.querySelector('.bulk-pick-option'))`);
    await page!.evaluate(`Array.from(document.querySelectorAll('.bulk-pick-option')).find(node => node.textContent.includes('Build Agent')).click()`);
    await until(`document.querySelector('.bulk-dialog-body').innerText.includes('Карточка попадёт в очередь агента')`);
    await capture('12-agent-hand-queue-hint-ru');
    await navigate({ deck: 'engineering' });
    await until(`Boolean(document.querySelector('.deck-actions-toggle'))`);
    await click('.deck-actions-toggle');
    await until(`Boolean(document.querySelector('.deck-automation-toggle'))`);
    expect(await page!.evaluate(`document.querySelector('.deck-automation-toggle').getAttribute('aria-label')`)).toContain('Теги и шаблон колоды');
    const point = await page!.evaluate(`(() => { const r = document.querySelector('.deck-automation-toggle').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await page!.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await page!.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    await until(`Boolean(document.querySelector('.deck-automation-menu'))`);
    expect(await page!.evaluate(`document.querySelector('.deck-automation-menu').innerText`)).toContain('Эти правила не запускают агентов.');
    await capture('13-deck-tags-template-ru');
    expect(page!.consoleErrors).toEqual([]);
  }, 30000);
});
