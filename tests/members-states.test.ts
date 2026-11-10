import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../server/app.ts';
import { emptyManifest, renderCatalogManifest } from '../server/catalog.ts';
import type { CatalogEdit, CatalogView } from '../src/catalog-contracts.ts';
import type { EditMode } from '../src/workspace-contracts.ts';
import { openHeadlessBrowser, type HeadlessPage } from '../tools/layout-capture.ts';
import { browserFixtureUrl } from './browser-fixture.ts';
import { requireBrowser } from './browser-environment.ts';
import { freePort } from './free-port.ts';

const browserPath = requireBrowser();
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const saveButton = '.members-editor-footer button:last-child';
const mayaInput = '.members-editor-name input';
const visibleError = '.members-editor .ui-error[role="alert"]';

function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

// 2026-11-10: real API writes and watcher refreshes expose stale-roster overwrites that a late-409-only mock misses.
describe.skipIf(!browserPath)('Members registry states (browser + disk/API)', () => {
  let page: HeadlessPage;
  let app: FastifyInstance | undefined;
  let root: string | undefined;
  let origin: string;
  let manifestPath: string;
  let posts: CatalogEdit[] = [];
  let responses: number[] = [];
  let getCount = 0;
  let writeGate: ReturnType<typeof gate> | undefined;
  let readGate: ReturnType<typeof gate> | undefined;
  let failRead = false;
  let savedStatus: 200 | 409 | 503 | undefined;
  const savedMessage = 'Реестр записан, но подтверждение индекса не получено. Перечитайте данные перед продолжением.';

  async function until(expression: string) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (await page.evaluate(expression)) return;
      await delay(25);
    }
    throw new Error('Timed out: ' + expression + '\n' + page.consoleErrors.join('\n'));
  }

  async function click(selector: string) {
    await page.callFunction(`selector => document.querySelector(selector).click()`, selector);
  }

  async function key(key: string, code: number) {
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: code,
      text: key === 'Enter' ? '\r' : undefined });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code });
  }

  async function focus(selector: string) {
    await page.callFunction(`selector => document.querySelector(selector).focus()`, selector);
  }

  async function editMaya(value = 'Local Maya') {
    await page.callFunction(`(selector, value) => {
      const field = document.querySelector(selector); field.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, value);
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.setSelectionRange(2, 5);
    }`, mayaInput, value);
    await until(`document.querySelector('.members-editor-hint').textContent.includes(' · ')`);
  }

  async function names() {
    return page.evaluate(`Array.from(document.querySelectorAll('.members-editor-name input'), node => node.value)`);
  }

  async function catalog() {
    const response = await fetch(origin + '/api/catalog?source=sandbox');
    expect(response.status).toBe(200);
    return await response.json() as CatalogView;
  }

  async function externalLeo() {
    const before = await readFile(manifestPath, 'utf8');
    expect(before).toContain('label: Leo Park');
    const after = before.replace('label: Leo Park', 'label: External Leo');
    await writeFile(manifestPath, after);
    return after;
  }

  async function waitForExternal() {
    await until(`membersStatesTest.state().catalog?.members.some(member => member.label === 'External Leo') && !membersStatesTest.state().loading`);
  }

  async function open(options: { lang?: 'en' | 'ru'; theme?: 'dark' | 'light'; width?: number;
    mode?: EditMode; empty?: boolean; holdRead?: boolean } = {}) {
    posts = []; responses = []; getCount = 0;
    failRead = false; savedStatus = undefined;
    writeGate = undefined; readGate = options.holdRead ? gate() : undefined;
    const temporary = path.join(tmpdir(), 'opencode');
    await mkdir(temporary, { recursive: true });
    root = await mkdtemp(path.join(temporary, 'deckmate-members-states-'));
    await mkdir(path.join(root, 'tasks'));
    const manifest = emptyManifest();
    manifest.formatLanguage = 'en';
    manifest.members = options.empty ? [] : [
      { id: 'maya', label: 'Maya Chen', kind: 'human', aliases: ['Maya'] },
      { id: 'leo', label: 'Leo Park', kind: 'human', aliases: ['Leo'] },
    ];
    manifestPath = path.join(root, 'tasks/deckmate.md');
    await writeFile(manifestPath, renderCatalogManifest(manifest));
    const port = await freePort();
    origin = `http://127.0.0.1:${port}`;
    app = await createApp({ dataRoot: root, writeRoot: root, editMode: options.mode ?? 'direct',
      projectName: 'Members states', port, python: 'python' });
    const fixture = new URL(browserFixtureUrl('members-states'));
    // 2026-11-10: serve the shared built fixture on the API origin, retaining real token/origin and socket guards.
    app.addHook('onRequest', async (request, reply) => {
      if (request.url.startsWith('/api/')) return;
      const asset = await fetch(new URL(request.url, fixture));
      return reply.code(asset.status).type(asset.headers.get('content-type') ?? 'application/octet-stream')
        .send(Buffer.from(await asset.arrayBuffer()));
    });
    app.addHook('preHandler', async (request, reply) => {
      if (request.url.split('?')[0] !== '/api/catalog') return;
      if (request.method === 'GET') {
        getCount += 1;
        await readGate?.promise;
        if (failRead) return reply.code(503).send({ message: 'Catalog read unavailable' });
        return;
      }
      if (request.method !== 'POST') return;
      posts.push(request.body as CatalogEdit);
      await writeGate?.promise;
    });
    app.addHook('onSend', async (request, reply, payload) => {
      if (request.url !== '/api/catalog' || request.method !== 'POST') return payload;
      if (reply.statusCode === 200 && savedStatus !== undefined) {
        // 2026-11-10: inject only the post-write response; disk/API assertions still prove what was actually saved.
        reply.code(savedStatus);
        if (savedStatus === 200) payload = JSON.stringify({ ...JSON.parse(String(payload)), savedWarning: savedMessage });
        else payload = JSON.stringify({ saved: true, message: savedMessage });
      }
      responses.push(reply.statusCode);
      return payload;
    });
    await app.listen({ host: '127.0.0.1', port });
    const width = options.width ?? 1440;
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: width === 375 ? 812 : 900, deviceScaleFactor: 1, mobile: false });
    await page.send('Page.navigate', { url: origin + fixture.pathname + '?' + new URLSearchParams({
      lang: options.lang ?? 'en', theme: options.theme ?? 'dark', catalogSource: options.mode === 'sandbox' ? 'live' : 'sandbox',
    }) });
    await until(`Boolean(document.querySelector('.members-editor')) && document.querySelector('[data-connection]')?.dataset.connection === 'live'`);
    if (!options.holdRead) await until(`Boolean(membersStatesTest.state().catalog) && !membersStatesTest.state().loading`);
    await page.evaluate('document.fonts.ready');
  }

  beforeAll(async () => { page = await openHeadlessBrowser({ width: 1440, height: 900, scale: 1 }); }, 60000);
  afterEach(async () => {
    writeGate?.release(); readGate?.release();
    await page?.send('Network.setBlockedURLs', { urls: [] });
    await page?.send('Page.navigate', { url: 'about:blank' });
    app?.server.closeAllConnections();
    await app?.close(); app = undefined;
    if (root) await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    root = undefined;
  }, 20000);
  afterAll(async () => { await page?.close(); }, 20000);

  it('keeps a dirty roster and its focus across a live file refresh, blocking overwrite until explicit re-read', async () => {
    await open();
    const original = await catalog();
    expect(original.members?.map(member => member.label)).toEqual(['Maya Chen', 'Leo Park']);
    await editMaya();
    const external = await externalLeo();
    await waitForExternal();
    await until(`Boolean(document.querySelector('.members-editor-conflict'))`);
    expect(await names()).toEqual(['Local Maya', 'Leo Park']);
    expect(await page.evaluate(`({ name: document.activeElement?.getAttribute('aria-label'),
      selection: [document.activeElement.selectionStart, document.activeElement.selectionEnd] })`))
      .toEqual({ name: 'Member name maya', selection: [2, 5] });
    await click(saveButton);
    expect(posts).toEqual([]);
    expect(await readFile(manifestPath, 'utf8')).toBe(external);
    expect((await catalog()).members?.map(member => member.label)).toEqual(['Maya Chen', 'External Leo']);
    await page.evaluate('membersStatesTest.refresh()');
    expect(await names()).toEqual(['Local Maya', 'Leo Park']);
    expect(await page.evaluate(`Boolean(document.querySelector('.members-editor-conflict'))`)).toBe(true);
    await focus('.members-editor-notice button');
    await key('Enter', 13);
    await until(`!document.querySelector('.members-editor-notice')`);
    expect(await names()).toEqual(['Maya Chen', 'External Leo']);
    expect(await page.evaluate(`Boolean(document.activeElement?.closest('.members-editor'))`)).toBe(true);
    expect(posts).toHaveLength(0);
    await editMaya('Reviewed Maya');
    const reviewed = await catalog();
    await click(saveButton);
    await until(`!document.querySelector('.members-editor')`);
    expect(posts).toHaveLength(1);
    expect(posts[0].manifestHash).toBe(reviewed.manifestHash);
    expect((await catalog()).members?.map(member => member.label)).toEqual(['Reviewed Maya', 'External Leo']);
    expect(await readFile(manifestPath, 'utf8')).toContain('label: External Leo');
  });

  it('takes a new baseline on a clean live refresh before editing', async () => {
    await open();
    await externalLeo();
    await waitForExternal();
    await until(`document.querySelectorAll('.members-editor-name input')[1]?.value === 'External Leo'`);
    const refreshed = await catalog();
    await editMaya();
    await click(saveButton);
    await until(`!document.querySelector('.members-editor')`);
    expect(posts[0].manifestHash).toBe(refreshed.manifestHash);
    expect((await catalog()).members?.map(member => member.label)).toEqual(['Local Maya', 'External Leo']);
  });

  it('keeps a late real 409 persistent, retains focus, and replaces the draft only after a successful explicit read', async () => {
    await open();
    const original = await catalog();
    await editMaya();
    writeGate = gate();
    await focus(saveButton);
    await page.callFunction(`selector => { const button = document.querySelector(selector); button.click(); button.click(); }`, saveButton);
    await until(`membersStatesTest.state().pending`);
    const external = await externalLeo();
    await waitForExternal();
    writeGate.release();
    await until(`Boolean(document.querySelector('.members-editor-conflict')) && !membersStatesTest.state().pending`);
    expect(posts).toHaveLength(1);
    expect(posts[0].manifestHash).toBe(original.manifestHash);
    expect(responses).toEqual([409]);
    expect(await names()).toEqual(['Local Maya', 'Leo Park']);
    expect(await page.callFunction(`selector => document.activeElement === document.querySelector(selector)`, saveButton)).toBe(true);
    expect(await readFile(manifestPath, 'utf8')).toBe(external);
    expect((await catalog()).members?.map(member => member.label)).toEqual(['Maya Chen', 'External Leo']);
    await page.evaluate('membersStatesTest.refresh()');
    expect(await page.evaluate(`Boolean(document.querySelector('.members-editor-conflict'))`)).toBe(true);
    failRead = true;
    await focus('.members-editor-notice button');
    await key('Enter', 13);
    await until(`Boolean(document.querySelector('.members-editor .ui-error[role="alert"]'))`);
    expect(await names()).toEqual(['Local Maya', 'Leo Park']);
    expect(posts).toHaveLength(1);
    failRead = false;
    readGate = gate();
    const reads = getCount;
    await focus(visibleError + ' button');
    await key('Enter', 13);
    await key('Enter', 13);
    await until(`document.querySelector('.members-editor .ui-error[role="alert"] button')?.getAttribute('aria-disabled') === 'true'`);
    expect(getCount).toBe(reads + 1);
    expect(await page.evaluate(`document.activeElement?.matches('.ui-error button')`)).toBe(true);
    readGate.release();
    await until(`!document.querySelector('.members-editor-notice') && !document.querySelector('.members-editor .ui-error[role="alert"]')`);
    expect(await names()).toEqual(['Maya Chen', 'External Leo']);
    expect(await page.evaluate(`Boolean(document.activeElement?.closest('.members-editor'))`)).toBe(true);
    expect(posts).toHaveLength(1);
  });

  it.each([409, 503, 200] as const)('shows its own persistent warning for HTTP %i after a real write, without replaying or closing', async status => {
    await open({ lang: 'ru', width: 375, theme: 'light' });
    const original = await catalog();
    const before = await readFile(manifestPath, 'utf8');
    await editMaya('Локальная Майя');
    savedStatus = status;
    await click(saveButton);
    await until(`Boolean(document.querySelector('.members-editor-warning')) && !membersStatesTest.state().pending`);
    expect(await names()).toEqual(['Локальная Майя', 'Leo Park']);
    expect(await page.evaluate(`document.querySelector('.members-editor-warning').innerText`)).toContain(savedMessage);
    expect(await page.evaluate(`document.querySelector('.members-editor-warning').getAttribute('role')`)).toBe('status');
    expect(await page.evaluate(`document.activeElement?.getAttribute('aria-label')`)).toBe('Имя участника maya');
    expect(posts).toHaveLength(1);
    expect(posts[0].manifestHash).toBe(original.manifestHash);
    expect(responses).toEqual([status]);
    const after = await readFile(manifestPath, 'utf8');
    expect(before).toContain('label: Maya Chen');
    expect(after).toContain('label: Локальная Майя');
    expect(after).toContain('label: Leo Park');
    expect((await catalog()).members?.map(member => member.label)).toEqual(['Локальная Майя', 'Leo Park']);
    await page.evaluate('membersStatesTest.dismissWarning(); membersStatesTest.refresh()');
    await until(`!membersStatesTest.state().loading`);
    expect(await page.evaluate(`document.querySelector('.members-editor-warning')?.innerText`)).toContain(savedMessage);
    await click(saveButton);
    expect(posts).toHaveLength(1);
    expect(await readFile(manifestPath, 'utf8')).toBe(after);
    await focus('.members-editor-notice button');
    await key('Enter', 13);
    await until(`!document.querySelector('.members-editor-notice')`);
    expect(await names()).toEqual(['Локальная Майя', 'Leo Park']);
    expect(await page.callFunction(`selector => document.querySelector(selector).disabled`, saveButton)).toBe(true);
    expect(posts).toHaveLength(1);
  });

  it('retains a network-failed draft after refresh; keyboard Retry retries the write once', async () => {
    await open();
    const before = await readFile(manifestPath, 'utf8');
    await editMaya();
    await page.send('Network.enable');
    await page.send('Network.setBlockedURLs', { urls: [origin + '/api/catalog'] });
    await click(saveButton);
    await until(`Boolean(document.querySelector('.members-editor .ui-error[role="alert"]')) && !membersStatesTest.state().pending`);
    expect(await names()).toEqual(['Local Maya', 'Leo Park']);
    expect(await page.evaluate(`document.querySelector('.members-editor .ui-error[role="alert"]').textContent`)).toContain('Not saved: Deckmate is not responding');
    expect(await page.evaluate(`document.activeElement?.getAttribute('aria-label')`)).toBe('Member name maya');
    expect(await readFile(manifestPath, 'utf8')).toBe(before);
    expect((await catalog()).members?.map(member => member.label)).toEqual(['Maya Chen', 'Leo Park']);
    await page.evaluate('membersStatesTest.refresh()');
    expect(await names()).toEqual(['Local Maya', 'Leo Park']);
    expect(await page.evaluate(`Boolean(document.querySelector('.members-editor .ui-error[role="alert"]'))`)).toBe(true);
    expect(posts).toHaveLength(0);
    await page.send('Network.setBlockedURLs', { urls: [] });
    writeGate = gate();
    await focus(visibleError + ' button');
    await key('Enter', 13);
    await key('Enter', 13);
    await until(`membersStatesTest.state().pending`);
    expect(posts).toHaveLength(1);
    expect(await page.evaluate(`document.activeElement?.matches('.ui-error button')`)).toBe(true);
    writeGate.release();
    await until(`!document.querySelector('.members-editor')`);
    expect((await catalog()).members?.map(member => member.label)).toEqual(['Local Maya', 'Leo Park']);
    expect(await readFile(manifestPath, 'utf8')).toContain('label: Local Maya');
  });

  it.each(['read-only', 'sandbox'] as const)('shows loading, error recovery and accurate empty read-only copy in %s mode', async mode => {
    await open({ mode, empty: true, holdRead: true, lang: 'ru', width: 375 });
    await until(`Boolean(document.querySelector('.members-editor .ui-loading'))`);
    expect(await page.evaluate(`Boolean(document.querySelector('.members-editor .ui-error[role="alert"]'))`)).toBe(false);
    failRead = true;
    readGate!.release();
    await until(`Boolean(document.querySelector('.members-editor .ui-error[role="alert"]'))`);
    expect(await page.evaluate(`Boolean(document.querySelector('.members-editor .ui-loading'))`)).toBe(false);
    failRead = false;
    await focus(visibleError + ' button');
    await key('Enter', 13);
    await until(`Boolean(document.querySelector('.members-editor .ui-empty'))`);
    const copy = await page.evaluate(`document.querySelector('.members-editor-body').innerText`);
    expect(copy).toContain('Участники появятся здесь, когда они будут в проекте.');
    if (mode === 'read-only') { expect(copy).toContain('Изменение реестра участников недоступно'); expect(copy).not.toContain('тестовую копию'); }
    else expect(copy).toContain('Переключитесь на тестовую копию');
    expect(await page.evaluate(`Boolean(document.querySelector('.members-editor-add'))`)).toBe(false);
    expect(await page.callFunction(`selector => document.querySelector(selector).disabled`, saveButton)).toBe(true);
    expect(await page.evaluate(`Boolean(document.activeElement?.closest('.members-editor'))`)).toBe(true);
    expect(posts).toHaveLength(0);
  });

  it.each(['dark', 'light'] as const)('fits persistent conflict and recovery in %s, EN/RU, 375/1440 and reduced motion', async theme => {
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    try {
      await open({ theme, width: 375, lang: 'ru' });
      await editMaya('Локальный черновик участника');
      await externalLeo();
      await waitForExternal();
      await until(`Boolean(document.querySelector('.members-editor-conflict'))`);
      for (const lang of ['en', 'ru']) for (const width of [375, 1440]) {
        await page.callFunction(`lang => membersStatesTest.setLang(lang)`, lang);
        await page.send('Emulation.setDeviceMetricsOverride', { width, height: width === 375 ? 812 : 900, deviceScaleFactor: 1, mobile: false });
        await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
        const fit = await page.evaluate(`(() => {
          const panel = document.querySelector('.members-editor');
          const notice = panel.querySelector('.members-editor-notice');
          const action = notice.querySelector('button');
          action.scrollIntoView({ block: 'nearest', behavior: 'instant' });
          const rect = action.getBoundingClientRect();
          return { page: document.documentElement.scrollWidth <= innerWidth, panel: panel.scrollWidth <= panel.clientWidth,
            notice: notice.scrollWidth <= notice.clientWidth, action: rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight,
            animation: getComputedStyle(panel).animationName, text: notice.innerText,
            bounds: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: innerWidth, height: innerHeight } };
        })()`);
        expect(fit, JSON.stringify({ lang, width, bounds: fit.bounds })).toMatchObject({ page: true, panel: true, notice: true, action: true, animation: 'none' });
        expect(fit.text).toContain(lang === 'ru' ? 'Перечитать и заменить черновик' : 'Re-read and replace draft');
      }
      expect(posts).toHaveLength(0);
      expect(page.consoleErrors).toEqual([]);
    } finally { await page.send('Emulation.setEmulatedMedia', { features: [] }); }
  });
});
