import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { setLang } from '../client/i18n.ts';
import { JourneyTrack, journeyTrackModels, orderJourneySteps } from '../client/components/JourneyTrack.tsx';
import { JourneyStepNote } from '../client/components/JourneyStepNote.tsx';
import { splitJourneyStepLink } from '../client/components/journey-step-link.ts';
import { journeyStepTitle } from '../client/components/journey-step-title.ts';
import type { CatalogCard, CatalogJourneyStep } from '../src/catalog-contracts.ts';
import { freePort } from './free-port.ts';
import { waitForPageTarget } from './browser-target.ts';

vi.hoisted(() => {
  vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
});

function stepCard(id: string, title: string, state: CatalogCard['state'], stepId: string, dependsOn: string[] = []): CatalogCard {
  return {
    id, kind: 'task', path: `cards/${id}.md`, version: null, title, state, owner: null, deckId: 'production',
    trackIds: [], parentId: 'card:hero', markdown: '', sourceHash: 'hash', range: null, dependsOn,
    journey: { journeyId: 'production-journey', version: 1, stepId, instanceId: 'instance-1' },
  };
}

const stepDependencies: Record<string, string[]> = {
  design: [], build: ['design'], review: ['design'], polish: [], integrate: ['build'],
};
const steps: CatalogJourneyStep[] = ['design', 'build', 'review', 'polish', 'integrate'].map(id => ({
  id, title: `${id[0].toUpperCase()}${id.slice(1)}: %PARENT_TITLE%`, markdown: '', deckId: 'production', owner: null, dependsOn: stepDependencies[id],
}));
const design = stepCard('card:design', 'Design prop', 'done', 'design');
const build = stepCard('card:build', 'Build prop', 'started', 'build', ['card:design']);
const review = stepCard('card:review', 'Review prop', 'review', 'review', ['card:design']);
const polish = stepCard('card:polish', 'Polish prop', 'not-started', 'polish');
const integrate = stepCard('card:integrate', 'Integrate prop', 'not-started', 'integrate', ['card:build']);
const run = [integrate, polish, design, review, build];
const props = { title: 'Prop production', version: 1, cards: run, steps };
const done = run.map(card => ({ ...card, state: 'done' as const }));
const waiting = [design, integrate];

function renderTrack(cards: CatalogCard[] = run, overrides: Partial<Parameters<typeof JourneyTrack>[0]> = {}): string {
  return renderToStaticMarkup(<JourneyTrack {...props} cards={cards}
    cardsById={new Map([...run, ...cards].map(card => [card.id, card]))} {...overrides} />);
}

describe('Journey mini-cards', () => {
  beforeEach(() => {
    vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
    vi.stubGlobal('window', Object.assign(new EventTarget(), { location: { origin: 'http://localhost' } }));
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
    setLang('en');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('follows template order and makes the complete template title a menu trigger beside the quiet version', () => {
    const html = renderTrack();
    const labels = [...html.matchAll(/aria-label="(\d\. [^"]+)"/gu)].map(match => match[1].split(' — ')[0]);
    expect(labels).toEqual(['1. Design prop', '2. Build prop', '3. Review prop', '4. Polish prop', '5. Integrate prop']);
    expect(html).toContain('class="journey-track-title-button"');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-label="Prop production: steps"');
    expect(html).toContain('<span class="journey-track-title">Prop production</span>');
    expect(html).toContain('</button><span class="journey-track-version">v1</span>');
    expect(html).not.toContain('Journey: Prop production');
    setLang('ru');
    expect(renderTrack()).toContain('aria-label="Prop production: шаги"');
  });

  it('uses a hidden accepted description beside the aria-hidden counter', () => {
    const html = renderTrack();
    expect(html).toContain('aria-hidden="true">1/5</span>');
    expect(html).toContain('class="visually-hidden">1 of 5 accepted</span>');
    expect(html).not.toContain('journey-track-count is-done');
    setLang('ru');
    expect(renderTrack()).toContain('1 из 5 принято');
  });

  it('marks only the first available step and uses its template name in Next', () => {
    const html = renderTrack();
    expect(html.match(/data-next="true"/gu)).toHaveLength(1);
    expect(html).toContain('data-state="working" data-next="true"');
    expect(html).toContain('aria-label="Build prop">Build</button>');
    expect(html).toContain('· started</span>');
    expect(html).not.toContain('%PARENT_TITLE%');
    expect(renderTrack([polish])).not.toContain('journey-track-state');
  });

  it('announces completion without Next and enters the row at its last card', () => {
    setLang('ru');
    const html = renderTrack(done);
    expect(html).not.toContain('data-next');
    expect(html).toContain('Все шаги приняты');
    expect(html).toContain('journey-track-count is-done');
    expect(html).toContain('aria-hidden="true">5/5</span>');
    expect(html.match(/tabindex="0"/gu)).toHaveLength(1);
    expect(html).toContain('tabindex="0" aria-label="5. Integrate prop');
  });

  it('names the open dependency when all remaining steps wait, in both languages', () => {
    const html = renderTrack(waiting);
    expect(html).not.toContain('data-next');
    expect(html).toContain('Waiting on:</span>');
    expect(html).toContain('class="journey-track-wait" title="Build prop">Build prop</strong>');
    expect(html).toContain('Blocked by dependency (waiting on: Build prop)');
    expect(html).toContain('tabindex="0" aria-label="2. Integrate prop');
    setLang('ru');
    const russian = renderTrack(waiting);
    expect(russian).toContain('Ждёт:</span>');
    expect(russian).toContain('заблокировано зависимостью (ждёт: Build prop)');
    expect(russian.match(/aria-label="Исполнение Journey"/gu)).toHaveLength(2);
  });

  it('falls back to the card title for absent or empty template labels', () => {
    expect(renderTrack([build], { steps: [] })).toContain('aria-label="Build prop">Build prop</button>');
    expect(renderTrack([build], { steps: [{ ...steps[1], title: ' — %PARENT_TITLE% : ' }] }))
      .toContain('aria-label="Build prop">Build prop</button>');
  });

  it.each([
    ['Sound: %PARENT_TITLE%', 'Sound'], ['%PARENT_TITLE% — Build – ', 'Build'],
    [' , · - Design: %PARENT_TITLE% — ', 'Design'], ['Plan sound for %PARENT_TITLE%', 'Plan sound for'],
    ['%PARENT_TITLE%', 'Full card'], [' ', 'Full card'],
  ])('cleans the compact template label %s', (title, expected) => {
    expect(journeyStepTitle(title, '', 'Full card')).toBe(expected);
  });

  it('retains the dialog Hero substitution and unnamed-step fallback', () => {
    expect(journeyStepTitle('Sound: %PARENT_TITLE%', '‹Hero›', 'New step')).toBe('Sound: ‹Hero›');
    expect(journeyStepTitle('Sound: %PARENT_TITLE%', 'Tidekeeper Ferry')).toBe('Sound: Tidekeeper Ferry');
    expect(journeyStepTitle('', '‹Hero›', 'New step')).toBe('New step');
  });

  it('keeps unmatched cards in family order and renders no empty execution block', () => {
    const stray = stepCard('card:stray', 'Stray card', 'not-started', 'gone-step');
    expect(orderJourneySteps([stray, build, design], steps).map(card => card.id))
      .toEqual(['card:design', 'card:build', 'card:stray']);
    expect(orderJourneySteps([build, design], []).map(card => card.id)).toEqual(['card:build', 'card:design']);
    expect(renderTrack([])).toBe('');
  });

  it('builds the step models the row renders, with the run counters', () => {
    const cardsById = new Map(run.map(card => [card.id, card]));
    const { models, nextIndex, accepted } = journeyTrackModels(run, steps, cardsById, 'en');
    expect(models.map(model => model.title)).toEqual(['Design', 'Build', 'Review', 'Polish', 'Integrate']);
    expect(models.map(model => model.state)).toEqual(['accepted', 'working', 'review', 'planned', 'blocked']);
    expect(models.map(model => model.card.id)).toEqual([design.id, build.id, review.id, polish.id, integrate.id]);
    expect(nextIndex).toBe(1);
    expect(accepted).toBe(1);
    expect(models.find(model => model.next)?.card.id).toBe(build.id);
    expect(models.find(model => model.state === 'blocked')?.stateLabel).toBe('Waiting: Build');
  });

  it('splits the server-written step link off a Sub Card body for display only', () => {
    const link = (eol: string) => `Do the thing.${eol}${eol}---${eol}${eol}Journey step: [review](../tasks/journeys/production-journey/steps/review.md)${eol}`;
    const journey = { journeyId: 'production-journey', stepId: 'review' };
    expect(splitJourneyStepLink(link('\n'), journey)).toEqual({ body: 'Do the thing.', hasLink: true });
    expect(splitJourneyStepLink(link('\r\n'), journey)).toEqual({ body: 'Do the thing.', hasLink: true });
    expect(splitJourneyStepLink(link('\n'), { ...journey, journeyId: 'other-journey' })).toEqual({ body: link('\n'), hasLink: false });
    expect(splitJourneyStepLink(link('\n'), { ...journey, stepId: 'build' })).toEqual({ body: link('\n'), hasLink: false });
    expect(splitJourneyStepLink(link('\n') + 'tail text', journey)).toEqual({ body: link('\n') + 'tail text', hasLink: false });
    expect(splitJourneyStepLink(link('\n'), null)).toEqual({ body: link('\n'), hasLink: false });
    expect(splitJourneyStepLink(link('\n'))).toEqual({ body: link('\n'), hasLink: false });
    expect(splitJourneyStepLink('No link at all.', journey)).toEqual({ body: 'No link at all.', hasLink: false });
  });

  it('renders the step note with its position, step name, journey title and step state', () => {
    const html = renderToStaticMarkup(<JourneyStepNote {...props} card={review}
      cardsById={new Map(run.map(card => [card.id, card]))} />);
    expect(html).toContain('Step 3 of 5 · <strong>Review</strong> · Prop production <span class="journey-step-note-version">v1</span>');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('data-step-state="review"');
    expect(html).toContain('title="Prop production v1 · Step 3 of 5 · Review · Review"');
    const stray = { ...review, journey: undefined };
    expect(renderToStaticMarkup(<JourneyStepNote {...props} card={stray} cardsById={new Map()} />)).toBe('');
    setLang('ru');
    expect(renderToStaticMarkup(<JourneyStepNote {...props} card={review}
      cardsById={new Map(run.map(card => [card.id, card]))} />)).toContain('Шаг 3 из 5');
  });
});

const browserPath = [process.env.DECKMATE_BROWSER, process.env.BROWSER,
  'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
  .find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// 2026-11-08: native Enter, focus and Radix tooltips need a real browser, not a server-rendered event-handler inspection.
describe.skipIf(!browserPath)('Journey navigation (headless CDP)', () => {
  let server: ViteDevServer | undefined;
  let browser: ChildProcess | undefined;
  let temporary: string | undefined;
  let socket: WebSocket | undefined;
  let sequence = 0;
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  const errors: string[] = [];
  function send(method: string, params: object = {}): Promise<any> {
    const id = ++sequence;
    return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); socket!.send(JSON.stringify({ id, method, params })); });
  }
  async function evaluate(expression: string): Promise<any> {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result?.value;
  }
  async function until(expression: string, attempts = 100) {
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (await evaluate(expression)) return;
      await delay(50);
    }
    throw new Error('Timed out: ' + expression + '\n' + errors.join('\n'));
  }
  async function render(overrides: object = {}) {
    await evaluate(`window.journeyTrackTest.render(${JSON.stringify({ ...props, dependencies: run, ...overrides })})`);
    await delay(80);
  }
  async function openMenu() {
    const center = await evaluate(`(() => { const box = document.querySelector('.journey-track-title-button').getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 }; })()`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...center, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...center, button: 'left', clickCount: 1 });
    await until(`Boolean(document.querySelector('[role="menu"]'))`);
  }
  async function threadGeometry() {
    return evaluate(`[...document.querySelectorAll('.journey-track-menu-step')].map((item, index, items) => {
      const box = item.getBoundingClientRect();
      const face = item.querySelector('.journey-track-face').getBoundingClientRect();
      const next = items[index + 1]?.querySelector('.journey-track-face')?.getBoundingClientRect();
      const thread = getComputedStyle(item, '::before');
      return { content: thread.content, x: box.left + parseFloat(thread.left) + parseFloat(thread.width) / 2,
        top: box.top + parseFloat(thread.top), bottom: box.bottom - parseFloat(thread.bottom),
        cardCenter: face.left + face.width / 2, cardBottom: face.bottom, nextCardTop: next?.top };
    })`);
  }
  async function key(key: string) {
    const codes: Record<string, number> = { Tab: 9, Enter: 13, Escape: 27, ArrowLeft: 37, ArrowRight: 39, ArrowDown: 40, Home: 36, End: 35, ' ': 32 };
    for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', {
      type, key, code: key === ' ' ? 'Space' : key, windowsVirtualKeyCode: codes[key],
      text: type === 'keyDown' && (key === 'Enter' || key === ' ') ? (key === 'Enter' ? '\r' : ' ') : undefined,
    });
    await delay(40);
  }
  const focused = () => evaluate(`document.activeElement.getAttribute('aria-label')`);

  beforeAll(async () => {
    vi.unstubAllGlobals();
    temporary = await mkdtemp(path.join(tmpdir(), 'journey-test-'));
    server = await createServer({ configFile: false, root: process.cwd(), cacheDir: path.join(temporary, 'vite'),
      plugins: [tailwindcss(), { name: 'journey-fixture', configureServer(vite) {
        vite.middlewares.use((request, response, next) => {
          if (request.url !== '/') return next();
          response.setHeader('Content-Type', 'text/html');
          response.end('<!doctype html><html><body><div id="root"></div><script type="module" src="/tests/fixtures/journey-track.tsx"></script></body></html>');
        });
      } }], server: { host: '127.0.0.1', port: 0 }, optimizeDeps: { entries: ['tests/fixtures/journey-track.tsx'] }, logLevel: 'error' });
    await server.listen();
    await server.warmupRequest('/tests/fixtures/journey-track.tsx');
    const port = await freePort();
    browser = spawn(browserPath!, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(temporary, 'profile')}`, 'about:blank'], { stdio: 'ignore' });
    const target = await waitForPageTarget(port, browser!);
    socket = new WebSocket(target);
    await new Promise(resolve => socket!.addEventListener('open', resolve, { once: true }));
    socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const request = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) request?.reject(new Error(JSON.stringify(message.error)));
        else request?.resolve(message.result);
      }
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    });
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Page.navigate', { url: server.resolvedUrls!.local[0] });
    await until('Boolean(window.journeyTrackTest)', 600);
  }, 90000);

  afterAll(async () => {
    if (socket?.readyState === WebSocket.OPEN) { await send('Browser.close').catch(() => {}); socket.close(); }
    if (browser?.pid && browser.exitCode === null) {
      const command = process.platform === 'win32' ? spawn('taskkill', ['/T', '/F', '/PID', String(browser.pid)], { stdio: 'ignore' }) : browser;
      if (process.platform !== 'win32') browser.kill();
      await new Promise(resolve => { if (command.exitCode !== null) resolve(null); else command.once('exit', resolve); });
    }
    await server?.close();
    if (temporary) await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }, 20000);

  beforeEach(async () => {
    if (await evaluate(`Boolean(document.querySelector('[role="menu"]'))`)) await key('Escape');
    await render();
  });

  it('opens each mini-card with its own Sub Card and Next with the next card', async () => {
    await evaluate(`document.querySelectorAll('.journey-track-open').forEach(button => button.click()); document.querySelector('.journey-track-next').click()`);
    expect(await evaluate('window.journeyTrackTest.opened')).toEqual([design.id, build.id, review.id, polish.id, integrate.id, build.id]);
  });

  it('uses one Tab stop and moves it with arrows, Home and End; Enter opens it', async () => {
    await evaluate(`document.querySelector('.journey-track-title-button').focus()`);
    await key('Tab');
    expect(await focused()).toContain('2. Build prop');
    for (const [press, name] of [['ArrowRight', '3. Review prop'], ['ArrowLeft', '2. Build prop'], ['Home', '1. Design prop'], ['End', '5. Integrate prop']]) {
      await key(press);
      expect(await focused()).toContain(name);
      expect(await evaluate(`document.querySelectorAll('.journey-track-open[tabindex="0"]').length`)).toBe(1);
    }
    await key('Enter');
    expect(await evaluate('window.journeyTrackTest.opened')).toEqual([integrate.id]);
    // The run sits before Next in the plate's second row, so Tab leaves the cards for Next, then the block.
    await key('Tab');
    expect(await evaluate(`document.activeElement.classList.contains('journey-track-next')`)).toBe(true);
    await key('Tab');
    expect(await evaluate('document.activeElement.id')).toBe('after');
    expect(await evaluate(`document.querySelector('.journey-track-open[tabindex="0"]').getAttribute('aria-label')`)).toContain('2. Build prop');
  });

  it.each([[waiting, '2. Integrate prop'], [done, '5. Integrate prop']])('enters waiting or completed runs at the proper card', async (cards, label) => {
    await render({ cards });
    await evaluate(`document.querySelector('.journey-track-title-button').focus()`);
    await key('Tab');
    expect(await focused()).toContain(label);
  });

  it('blocks activation and Tab stops while disabled, without dimming cards', async () => {
    // Tips open from keyboard navigation, not from a programmatic focus.
    await evaluate(`document.querySelector('.journey-track-title-button').focus()`);
    await key('Tab');
    await until(`Boolean(document.querySelector('[role="tooltip"]'))`);
    await render({ disabled: true });
    await until(`!document.querySelector('[role="tooltip"]')`);
    await evaluate(`document.querySelectorAll('.card-preview-journey-progress button').forEach(button => button.click())`);
    expect(await evaluate('window.journeyTrackTest.opened')).toEqual([]);
    expect(await evaluate(`document.querySelectorAll('.journey-track-open[tabindex="0"]').length`)).toBe(0);
    expect(await evaluate(`getComputedStyle(document.querySelector('.journey-track-open')).opacity`)).toBe('1');
    await evaluate(`document.querySelector('#before').focus()`);
    await key('Tab');
    expect(await evaluate('document.activeElement.id')).toBe('after');
  });

  it('opens the path menu with its description, progress, cleaned steps, owners, dependencies and states', async () => {
    const ownedCards = run.map(card => card.id === build.id ? { ...card, owner: 'builder' } : card);
    const ownedSteps = steps.map(step => step.id === 'design' ? { ...step, owner: 'maya' } : step);
    await render({
      cards: ownedCards, steps: ownedSteps, description: 'A reusable path from silhouette to a playable harbor asset.', onOpenJourney: true,
      members: [{ id: 'maya', label: 'Maya Chen', kind: 'human', aliases: [] }, { id: 'builder', label: 'Build Agent', kind: 'agent', aliases: [] }],
    });
    await openMenu();
    expect(await evaluate(`document.querySelector('.journey-track-menu-title').textContent`)).toContain('Prop production');
    expect(await evaluate(`document.querySelector('.journey-track-menu-description').textContent`)).toBe('A reusable path from silhouette to a playable harbor asset.');
    expect(await evaluate(`document.querySelector('.journey-track-menu-count').textContent`)).toBe('1/5 accepted');
    expect(await evaluate(`document.querySelectorAll('.journey-track-menu-progress > span.is-accepted').length`)).toBe(1);
    expect(await evaluate(`[...document.querySelectorAll('.journey-track-menu-step-name')].map(item => item.textContent)`))
      .toEqual(['1. Design', '2. Build', '3. Review', '4. Polish', '5. Integrate']);
    expect(await evaluate(`[...document.querySelectorAll('.journey-track-menu-step-state')].map(item => item.textContent)`))
      .toEqual(['Done', 'Started', 'Review', 'Not started', 'Waiting: Build']);
    expect(await evaluate(`[...document.querySelectorAll('.journey-track-menu-step-meta')].map(item => item.textContent)`))
      .toEqual(['Maya Chen', 'Build Agent · after Design', 'No owner · after Design', 'No owner', 'No owner · after Build']);
    expect(await evaluate(`document.querySelectorAll('.journey-track-menu-step').length`)).toBe(5);
    expect(await evaluate(`document.querySelector('.journey-track-menu-open').textContent`)).toBe('Open Journey');
  });

  it('selects a Sub Card or the full Journey and closes the menu', async () => {
    await render({ onOpenJourney: true });
    await openMenu();
    await evaluate(`document.querySelectorAll('.journey-track-menu-step')[1].click()`);
    await until(`!document.querySelector('[role="menu"]')`);
    expect(await evaluate('window.journeyTrackTest.opened')).toEqual([build.id]);
    // Radix returns focus to the trigger after the close; reopening before that lets the late focus close the new menu.
    await until(`document.activeElement?.classList.contains('journey-track-title-button')`);
    await openMenu();
    await evaluate(`document.querySelector('.journey-track-menu-open').click()`);
    await until(`!document.querySelector('[role="menu"]')`);
    expect(await evaluate('window.journeyTrackTest.journeyOpened')).toBe(1);
  }, 15000);

  it('supports Enter, Space and ArrowDown, then Escape restores focus to the title', async () => {
    await evaluate(`document.querySelector('.journey-track-title-button').focus()`);
    await key('Enter');
    await until(`Boolean(document.querySelector('[data-highlighted] .journey-track-menu-step-name'))`);
    expect(await evaluate(`document.querySelector('[data-highlighted] .journey-track-menu-step-name').textContent`)).toBe('1. Design');
    await key('ArrowDown');
    await until(`document.querySelector('[data-highlighted] .journey-track-menu-step-name')?.textContent === '2. Build'`);
    expect(await evaluate(`document.querySelector('[data-highlighted] .journey-track-menu-step-name').textContent`)).toBe('2. Build');
    await key('Escape');
    await until(`!document.querySelector('[role="menu"]')`);
    expect(await focused()).toBe('Prop production: steps');
    await key('ArrowDown');
    await until(`Boolean(document.querySelector('[role="menu"]'))`);
    await key('Escape');
    await key(' ');
    await until(`Boolean(document.querySelector('[role="menu"]'))`);
    await key('Escape');
    expect(await focused()).toBe('Prop production: steps');
  });

  // 2026-11-09: the note hides the body's "Journey step:" link, so its menu must lead to the step instruction instead.
  it('offers the step instruction as an /api/file link that DocumentPreview opens, only with a Journey path', async () => {
    const note = { ...props, card: review, dependencies: run, source: 'sandbox', journeyPath: 'tasks/journeys/production-journey/index.md' };
    await evaluate(`window.journeyTrackTest.renderNote(${JSON.stringify(note)})`);
    await delay(80);
    // Stands in for DocumentPreviewProvider: it captures the click (preventDefault + stopPropagation), then its dialog
    // takes focus. The menu must close on that focus and must not pull focus back to the note.
    await evaluate(`window.openedLink = null; const dialog = document.createElement('div'); dialog.id = 'fake-preview'; dialog.setAttribute('role', 'dialog');
      dialog.tabIndex = -1; document.body.append(dialog); window.linkTrap = event => { const link = event.target.closest?.('a[href]'); if (!link) return;
      event.preventDefault(); event.stopPropagation(); window.openedLink = link.getAttribute('href'); dialog.focus(); };
      document.addEventListener('click', window.linkTrap, true); true`);
    await evaluate(`document.querySelector('.journey-step-note-button').focus()`);
    await key('Enter');
    await until(`Boolean(document.querySelector('.journey-track-menu-instruction'))`);
    expect(await evaluate(`document.querySelector('.journey-track-menu-instruction').textContent`)).toBe('Open step instruction');
    await evaluate(`document.querySelector('.journey-track-menu-instruction').focus()`);
    await key('Enter');
    await until(`!document.querySelector('[role="menu"]')`);
    expect(await evaluate('window.openedLink')).toBe('/api/file?source=sandbox&path=tasks%2Fjourneys%2Fproduction-journey%2Fsteps%2Freview.md');
    await delay(100);
    expect(await evaluate('document.activeElement.id')).toBe('fake-preview');
    await evaluate(`document.removeEventListener('click', window.linkTrap, true); document.getElementById('fake-preview').remove(); true`);
    await evaluate(`window.journeyTrackTest.renderNote(${JSON.stringify({ ...props, card: review, dependencies: run })})`);
    await delay(80);
    await evaluate(`document.querySelector('.journey-step-note-button').focus()`);
    await key('Enter');
    await until(`Boolean(document.querySelector('[role="menu"]'))`);
    expect(await evaluate(`document.querySelectorAll('.journey-track-menu-instruction').length`)).toBe(0);
    await key('Escape');
  }, 15000);

  it('opens the step note menu by pointer, then Escape restores focus and Enter reopens it for the step select', async () => {
    await evaluate(`window.journeyTrackTest.renderNote(${JSON.stringify({ ...props, card: review, dependencies: run })})`);
    await delay(80);
    const center = await evaluate(`(() => { const box = document.querySelector('.journey-step-note-button').getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 }; })()`);
    for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, ...center, button: 'left', clickCount: 1 });
    await until(`Boolean(document.querySelector('[role="menu"]'))`);
    expect(await evaluate(`document.querySelectorAll('.journey-track-menu-step').length`)).toBe(5);
    await key('Escape');
    await until(`!document.querySelector('[role="menu"]')`);
    expect(await evaluate(`document.activeElement === document.querySelector('.journey-step-note-button')`)).toBe(true);
    await evaluate(`document.querySelector('.journey-step-note-button').focus()`);
    await key('Enter');
    await until(`Boolean(document.querySelector('[role="menu"]'))`);
    await evaluate(`document.querySelectorAll('.journey-track-menu-step')[2].click()`);
    await until(`!document.querySelector('[role="menu"]')`);
    expect(await evaluate('window.journeyTrackTest.opened')).toEqual([review.id]);
  }, 20000);

  it('keeps every thread segment centred between its mini-cards, including the translated next card', async () => {
    await openMenu();
    const geometry = await threadGeometry();
    expect(geometry).toHaveLength(5);
    for (const [index, segment] of geometry.entries()) {
      if (index === geometry.length - 1) {
        expect(segment.content).toBe('none');
        continue;
      }
      expect(Math.abs(segment.x - segment.cardCenter)).toBeLessThanOrEqual(.5);
      expect(segment.top).toBeGreaterThanOrEqual(segment.cardBottom - 1);
      expect(segment.bottom).toBeLessThanOrEqual(segment.nextCardTop + 1);
    }
  });

  it('wraps long names without horizontal overflow, state collisions or broken thread geometry', async () => {
    const longSteps = steps.map(step => step.id === 'design' || step.id === 'build'
      ? { ...step, title: `${step.id === 'design' ? 'D'.repeat(80) : 'B'.repeat(80)}: %PARENT_TITLE%` } : step);
    const longCards = run.map(card => card.id === integrate.id ? { ...card, owner: 'O'.repeat(40) } : card);
    await render({ cards: longCards, steps: longSteps });
    await openMenu();
    expect(await evaluate(`document.querySelector('.journey-track-menu').scrollWidth <= document.querySelector('.journey-track-menu').clientWidth`)).toBe(true);
    const boxes = await evaluate(`[...document.querySelectorAll('.journey-track-menu-step')].map(item => {
      const name = item.querySelector('.journey-track-menu-step-name').getBoundingClientRect();
      const state = item.querySelector('.journey-track-menu-step-state').getBoundingClientRect();
      return { nameRight: name.right, stateLeft: state.left };
    })`);
    for (const box of boxes) expect(box.nameRight).toBeLessThanOrEqual(box.stateLeft + .5);
    const geometry = await threadGeometry();
    for (const [index, segment] of geometry.entries()) {
      if (index === geometry.length - 1) continue;
      expect(Math.abs(segment.x - segment.cardCenter)).toBeLessThanOrEqual(.5);
      expect(segment.top).toBeGreaterThanOrEqual(segment.cardBottom - 1);
      expect(segment.bottom).toBeLessThanOrEqual(segment.nextCardTop + 1);
    }
  });

  it('shows a Radix tooltip with the complete card title, state and dependency', async () => {
    await evaluate(`document.querySelector('.journey-track-title-button').focus()`);
    await key('Tab');
    await key('End');
    await until(`(document.querySelector('[role="tooltip"]')?.textContent ?? '').includes('5. Integrate prop')`);
    expect(await evaluate(`document.querySelector('[role="tooltip"]').textContent`)).toContain('5. Integrate prop');
    expect(await evaluate(`document.querySelector('[role="tooltip"]').textContent`)).toContain('waiting on: Build prop');
    expect(errors).toEqual([]);
  });

  // 2026-11-08: Radix kept card 2's wide tooltip open while the
  // pointer stayed in its grace area, which covers the neighbouring cards. The hovered card always wins over focus.
  it('names the hovered card, not the focused one, and closes when the pointer leaves the row', async () => {
    const tooltips = `[...document.querySelectorAll('[role="tooltip"]')].map(tip => tip.textContent).join('|')`;
    const center = (index: number) => evaluate(`(() => { const box = document.querySelectorAll('.journey-track-open')[${index}].getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 }; })()`);
    const move = async (x: number, y: number) => { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); await delay(20); };
    // A long title widens the tooltip over the neighbouring cards.
    await render({ cards: run.map(card => card.id === build.id ? { ...card, title: 'Build prop for the evening harbor crossing' } : card) });
    const [first, second] = [await center(0), await center(1)];
    await evaluate(`document.querySelector('.journey-track-open[data-next]').focus()`);
    await move(second.x, second.y);
    await until(`${tooltips}.includes('2. Build prop')`, 40);
    for (let x = second.x; x > first.x; x -= 3) await move(x, first.y);
    await move(first.x, first.y);
    await until(`${tooltips}.startsWith('1. Design prop')`, 40);
    expect(await evaluate(tooltips)).not.toContain('2. Build prop');
    await move(first.x, first.y + 160);
    await until(`!document.querySelector('[role="tooltip"]')`, 40);
  }, 20000);

  // 2026-11-08: Radix opened tooltips on any focus a pointer did not cause, including restored focus.
  const tips = `[...document.querySelectorAll('[role="tooltip"]')].map(tip => tip.textContent).join('|')`;
  const cardCenter = (index: number) => evaluate(`(() => { const box = document.querySelectorAll('.journey-track-open')[${index}].getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 }; })()`);
  const pointer = async (x: number, y: number, pause = 20) => { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); if (pause) await delay(pause); };
  async function click(x: number, y: number) {
    for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
    await delay(60);
  }

  it('opens tips for the hovered card and after keyboard navigation, never for a restored focus', async () => {
    const third = await cardCenter(2);
    await pointer(third.x, third.y);
    await until(`${tips}.startsWith('3. Review prop')`, 40);
    await click(third.x, third.y);
    expect(await evaluate('window.journeyTrackTest.opened')).toEqual([review.id]);
    await pointer(4, 4);
    await until(`!document.querySelector('[role="tooltip"]')`, 40);
    // As after closing the Sub Card with Esc: focus comes back to the card without a pointer or a navigation key.
    await key('Escape');
    await evaluate(`document.querySelector('#after').focus(); document.querySelectorAll('.journey-track-open')[2].focus()`);
    await delay(600);
    expect(await evaluate(tips)).toBe('');
    await evaluate(`document.querySelector('.journey-track-title-button').focus()`);
    await key('Tab');
    await until(`${tips}.startsWith('2. Build prop')`, 40);
    await key('ArrowRight');
    await until(`${tips}.startsWith('3. Review prop')`, 40);
    expect((await evaluate(tips)).split('|')).toHaveLength(1);
  }, 20000);

  it('follows fast and slow sweeps to the card under the pointer and lets the pointer reach Next', async () => {
    const centers = await Promise.all([0, 1, 2, 3].map(cardCenter));
    for (let x = centers[0].x; x <= centers[3].x; x += 4) await pointer(x, centers[0].y, 0);
    await pointer(centers[3].x, centers[3].y);
    await until(`${tips}.startsWith('4. Polish prop')`, 40);
    expect((await evaluate(tips)).split('|')).toHaveLength(1);
    expect(await evaluate(`getComputedStyle(document.querySelector('[data-radix-popper-content-wrapper]')).pointerEvents`)).toBe('none');
    for (let x = centers[3].x; x >= centers[1].x; x -= 2) await pointer(x, centers[1].y, 8);
    await until(`${tips}.startsWith('2. Build prop')`, 40);
    const next = await evaluate(`(() => { const box = document.querySelector('.journey-track-next').getBoundingClientRect(); return { x: box.left + 4, y: box.top + box.height / 2 }; })()`);
    await pointer(centers[1].x, centers[1].y - 14);
    await pointer(next.x, next.y);
    await until(`!document.querySelector('[role="tooltip"]')`, 40);
    await click(next.x, next.y);
    expect(await evaluate('window.journeyTrackTest.opened')).toEqual([build.id]);
  }, 20000);
});
