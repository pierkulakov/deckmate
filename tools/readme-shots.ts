// 2026-11-05: capture real writable demo projects; no application CSS or data is faked for the camera.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { loadEnvFile } from 'node:process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { createApp } from '../server/app.ts';
import { appendActivity, describeActivity } from '../server/activity.ts';
import { prepareCardOptionsPatch, readCardOptions } from '../server/card-options.ts';
import { readProjectCatalog } from '../server/catalog.ts';
import { loadConfig } from '../server/config.ts';
import { initializeDemo } from '../server/demo.ts';
import { environmentValue } from '../server/environment.ts';
import { editNativeCardContent, editNativeCardProperties } from '../server/native-cards.ts';
import { packagePath } from '../server/package-path.ts';
import { localIsoDate } from '../src/catalog-hand.ts';
import { freePort } from './free-port.ts';
import { captureLauncherReadme } from './launcher-capture.ts';

const executeFile = promisify(execFile);
const workspace = packagePath();
// 2026-11-09: the banner reuses the committed card crop, so it can render without a client build or demo server.
const socialOnly = process.argv.includes('--social');
const skipDesktop = process.argv.includes('--skip-desktop');
const clientEntry = packagePath('dist', 'client', 'index.html');
const clientBuildHash = socialOnly ? null : createHash('sha256').update(await readFile(clientEntry)).digest('hex');
const temporary = await mkdtemp(path.join(tmpdir(), 'deckmate-readme-shots-'));
const output = packagePath('docs', 'screenshots');
// Capture records stay in the ignored runtime folder; the PNGs are the deliverable.
const evidence = packagePath('.deckmate', 'shots');
const savedEnvironment = { ...process.env };
const interruption = new AbortController();
const interrupt = () => interruption.abort();
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);
let app: Awaited<ReturnType<typeof createApp>> | undefined;
let address: string | undefined;
const captures: { file: string; width: number; height: number; bytes: number; sha256: string; consoleErrors: number }[] = [];

// 2026-11-11: the port follows the server's environment contract — .env.local loads through the same loadEnvFile
// path as the CLI (existing variables win) and PORT is read through environmentValue, which never mixes a
// DECKMATE_* shell variable with an old FREETION_PORT from the file.
function preferredPort(): number {
  try { loadEnvFile(packagePath('.env.local')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const configured = environmentValue('PORT');
  if (!configured) return 0;
  const port = Number(configured);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Screenshot port must be from 1024 to 65535.');
  return port;
}

function ready(selector: string, application = true): string {
  return `eval:(async () => {
    const deadline = Date.now() + 20000;
    while (!document.querySelector(${JSON.stringify(selector)})) {
      if (Date.now() > deadline) throw new Error('Screenshot view did not become ready');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    await document.fonts.ready;
    await Promise.all([...document.images].map(image => image.decode()));
    ${application ? `if (!document.documentElement.classList.contains('dark')) throw new Error('Expected dark theme');
    if (document.querySelector('.readonly-banner, .error-banner:not([hidden]), .source-switch')) throw new Error('Expected direct, error-free demo');` : ''}
    if (document.documentElement.lang !== 'en') throw new Error('Expected English interface');
    if (/[\\u0400-\\u04ff]/u.test(document.body.innerText)) throw new Error('Unexpected Cyrillic text in screenshot');
    if (document.documentElement.scrollWidth > innerWidth) throw new Error('Screenshot overflows horizontally');
    return ${JSON.stringify('SHOT_READY:' + selector)};
  })()`;
}

// 2026-11-05: each frame is sized to its content, so README images have no empty thirds; scrolling to the top keeps the deck strip whole.
const scrollToTop = `eval:(() => {
  for (const element of [document.scrollingElement, ...document.querySelectorAll('*')]) if (element && element.scrollTop > 0) element.scrollTop = 0;
  return 'SHOT_SCROLLED';
})()`;

interface Frame { width: number; height: number; dpr: number; after?: string[]; clip?: string; file?: string }

async function capture(name: string, url: string, selector: string, steps: string[], frame: Frame, social = false): Promise<void> {
  const destination = frame.file ?? (social ? packagePath('docs', 'social-preview.png') : path.join(output, name + '.png'));
  const prefix = path.join(temporary, name);
  const { width: viewportWidth, height: viewportHeight, dpr: pixelRatio } = frame;
  const width = viewportWidth * pixelRatio;
  const height = viewportHeight * pixelRatio;
  const args = [packagePath('tools', 'layout-capture.ts'), '--url', url, '--out', prefix,
    '--width', String(viewportWidth), '--height', String(viewportHeight),
    '--dpr', String(pixelRatio), '--wait', '2000', ...(frame.clip ? ['--clip', frame.clip] : [])];
  const frameCheck = `eval:(() => {
    for (const element of document.querySelectorAll(${JSON.stringify(selector + ', .catalog-source, .planning-cards, .card-family-row')})) {
      const bounds = element.getBoundingClientRect();
      if (bounds.width && bounds.height && (bounds.left < 0 || bounds.top < 0 || bounds.right > innerWidth + 1 || bounds.bottom > innerHeight + 1)) {
        throw new Error('Screenshot cuts off ' + element.className + ': ' + JSON.stringify({ top: Math.round(bounds.top), bottom: Math.round(bounds.bottom), right: Math.round(bounds.right), innerHeight }));
      }
    }
    const shortcuts = document.querySelector('.shortcuts-panel-body');
    if (shortcuts && shortcuts.scrollHeight > shortcuts.clientHeight) throw new Error('Shortcut list does not fit');
    return 'SHOT_FRAME_OK';
  })()`;
  for (const step of [...steps, ready(selector, !social), ...(frame.after ?? []), 'wait:1000', frameCheck]) args.push('--step', step);
  const result = await executeFile(process.execPath, args, { cwd: workspace, windowsHide: true, timeout: 60000,
    signal: interruption.signal, maxBuffer: 2 * 1024 * 1024 });
  if (!result.stdout.includes('SHOT_READY:' + selector) || !/console errors: 0\s*$/u.test(result.stdout.trim()) || result.stdout.includes('not found:')) {
    throw new Error(`Capture ${name} failed verification:\n${result.stdout}\n${result.stderr}`);
  }
  const png = await readFile(prefix + '.png');
  if (!frame.clip && (png.readUInt32BE(16) !== width || png.readUInt32BE(20) !== height)) throw new Error(`Unexpected PNG dimensions: ${name}`);
  if (!social && png.length > 600_000) throw new Error(`${name} exceeds 600 KB: ${png.length} bytes`);
  if (social && png.length >= 1024 * 1024) throw new Error('GitHub social preview must be smaller than 1 MiB.');
  await cp(prefix + '.png', destination);
  await cp(prefix + '.json', path.join(evidence, name + '.json'));
  const [savedWidth, savedHeight] = [png.readUInt32BE(16), png.readUInt32BE(20)];
  captures.push({ file: path.relative(workspace, destination).replaceAll('\\', '/'), width: savedWidth, height: savedHeight,
    bytes: png.length, sha256: createHash('sha256').update(png).digest('hex'), consoleErrors: 0 });
  console.log(`${name}: ${savedWidth}x${savedHeight}, ${png.length} bytes, console errors: 0`);
}

async function captureSocial(): Promise<void> {
  await mkdir(evidence, { recursive: true });
  await capture('social', pathToFileURL(packagePath('docs', 'social-preview.html')).href, '.stage', [], { width: 1280, height: 640, dpr: 1 }, true);
}

async function acceptDemoTasks(project: string, before: Awaited<ReturnType<typeof readProjectCatalog>>, cards: typeof before.cards): Promise<void> {
  const pending = cards.filter(card => card.state !== 'done');
  for (const card of pending) {
    await editNativeCardProperties(project, card.id, card.sourceHash, { state: 'done' }, undefined, before.formatLanguage);
  }
  if (!pending.length) return;
  const options = await readCardOptions(project);
  const changes = Object.fromEntries(pending.map(card => [card.id, { doneAt: localIsoDate() }]));
  const plan = await prepareCardOptionsPatch(project, options.hash, changes);
  await plan.publish();
  const after = await readProjectCatalog(project);
  const event = describeActivity(before, after, 'set-card-state');
  if (event) await appendActivity(project, event, after.formatLanguage);
}

async function captureDemo(): Promise<void> {
  const project = path.join(temporary, 'project');
  await initializeDemo(project);
  interruption.signal.throwIfAborted();
  // 2026-11-11: the first row needs an accepted Task beside the Hero and started Task in the social crop.
  const demo = await readProjectCatalog(project);
  const titles: Record<string, string> = {
    'Moonwake Lantern': 'Light the first bonfire',
    'Tidekeeper Ferry': 'Add a barrel roll',
    'Paint the harbor color script': 'Stack the falling blocks',
    'Shape the lighthouse silhouette': 'Tune the blue shell',
    'Block out the harbor market': 'Bake the promised cake',
  };
  for (const [original, title] of Object.entries(titles)) {
    const card = demo.cards.find(candidate => candidate.title === original);
    if (!card) throw new Error(`Demo card missing: ${original}`);
    await editNativeCardContent(project, card.id, card.sourceHash, { title });
  }
  const renamed = await readProjectCatalog(project);
  const acceptedTask = renamed.cards.find(card => card.title === 'Tune the blue shell' && card.kind === 'task');
  if (!acceptedTask) throw new Error('Demo Task for the social crop missing.');
  await acceptDemoTasks(project, renamed, [acceptedTask]);
  // 2026-11-11: one Task in review puts the amethyst band into the first row and the social crop.
  const reviewed = await readProjectCatalog(project);
  const reviewTask = reviewed.cards.find(card => card.title === 'Bake the promised cake' && card.kind === 'task');
  if (!reviewTask) throw new Error('Demo Task for the review band missing.');
  await editNativeCardProperties(project, reviewTask.id, reviewTask.sourceHash, { state: 'review' }, undefined, reviewed.formatLanguage);
  const boards = path.join(project, 'boards');
  const board = (await readdir(boards)).find(filename => filename.endsWith('.excalidraw'));
  if (!board) throw new Error('Demo Vision board missing.');
  // 2026-11-11: the short name fits the board title field without truncation in the published frame.
  const boardPath = path.join(boards, board);
  const scene = JSON.parse(await readFile(boardPath, 'utf8')) as { name: string; elements: { id: string; text?: string; originalText?: string; height: number; fontSize: number }[] };
  scene.name = 'Moonwake Vision';
  const note = scene.elements.find(element => element.id === 'north-star');
  if (!note?.text) throw new Error('Demo Vision note missing.');
  note.text += '\n$$Production';
  note.originalText = note.text;
  note.height = note.fontSize * 1.3 * note.text.split('\n').length;
  await writeFile(boardPath, JSON.stringify(scene, null, 2) + '\n');
  const port = await freePort(preferredPort());
  Object.assign(process.env, { DECKMATE_DATA: project, DECKMATE_WRITE: '', DECKMATE_READ_ONLY: '0', DECKMATE_PORT: String(port),
    DECKMATE_HOST: '127.0.0.1', DECKMATE_INDEX: path.join(temporary, 'index'), DECKMATE_PROJECT_NAME: 'Moonwake Studio' });
  // 2026-11-05: the demo follows the CLI's default direct-edit configuration without git.
  const config = await loadConfig();
  app = await createApp(config);
  address = await app.listen({ host: config.host, port });
  console.log(`Temporary demo: ${address} (direct editing)`);
  const snapshot = await (await fetch(address + '/api/snapshot?source=sandbox')).json() as { writable: boolean; editMode: string };
  if (!snapshot.writable || snapshot.editMode !== 'direct') throw new Error('Screenshot demo is not directly writable.');
  const catalog = await readProjectCatalog(project);
  if (catalog.warnings.length) throw new Error(catalog.warnings.join('\n'));
  const hero = catalog.cards.find(card => card.kind === 'hero' && card.title === 'Light the first bonfire');
  if (!hero?.deckId) throw new Error('Demo Hero missing.');
  const buildTask = catalog.cards.find(card => card.parentId === hero.id && card.journey?.stepId === 'build');
  if (!buildTask?.deckId) throw new Error('Demo production Task missing.');
  await mkdir(output, { recursive: true });
  await mkdir(evidence, { recursive: true });
  if (!skipDesktop) {
    const launcher = await captureLauncherReadme(path.join(output, 'desktop-start.png'));
    captures.push({ file: 'docs/screenshots/desktop-start.png', width: launcher.width, height: launcher.height,
      bytes: launcher.bytes, sha256: launcher.sha256, consoleErrors: 0 });
  }
  const url = (values: Record<string, string>) => address + '/?' + new URLSearchParams({ catalogSource: 'sandbox', ...values });
  const deckUrl = url({ view: 'deck', deck: hero.deckId, order: 'manual' });
  // 1280 CSS pixels at DPR 1.25 keep text legible when GitHub scales the 1600 px PNG down.
  await capture('decks', url({ view: 'deck' }), '.catalog-spaces',
    [ready('.project-pulse[aria-busy="false"] .project-pulse-run progress')], { width: 1280, height: 600, dpr: 1.25, after: [scrollToTop] });
  // 2026-11-11: viewport and DPR preserve the published PNG sizes while fitting the revised panels and card rows.
  const deckFrame = { width: 960, height: 684, dpr: 5 / 3, after: [scrollToTop] };
  await capture('deck', deckUrl, '.deck-card-space', [ready('.deck-overview'), 'click:Collapse summary'], deckFrame);
  // 2026-11-11: the resizable reading column fills the space beside the complete five-step family.
  await capture('card', url({ view: 'deck', deck: buildTask.deckId, card: buildTask.id }), '.card-family-panel, .card-preview-sheet',
    [ready('.card-preview-tags'), 'click:Hero and Sub Cards',
      'eval:document.querySelector(".catalog-resize-handle").dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }))'],
    { width: 1440, height: 1395, dpr: 10 / 9, after: [scrollToTop] });
  await capture('timeline', url({ view: 'timeline' }), '.planning-cards',
    [ready('.timeline-run'), 'click:First playable'],
    { width: 1344, height: 1281, dpr: 25 / 21, after: [scrollToTop] });
  await capture('hand', url({ view: 'hand', handMember: 'maya' }), '[aria-labelledby="hand-tab-due"]',
    [ready('.hand-view .deck-card'), 'click:Your due cards', 'click:Done Cards'],
    { width: 1280, height: 940, dpr: 1.25, after: [scrollToTop] });
  await capture('vision', url({ view: 'vision', board: board.replace('.excalidraw', '') }), '.excalidraw, .vision-stack, .deckmate-vision-card',
    [ready('.deckmate-vision-card'), 'click:Overview'], { width: 1664, height: 1170, dpr: 25 / 26 });
  // 2026-11-07: a complete row keeps card footers visible in the link preview, with no clipped second row.
  const markCards = `eval:(() => {
    const cards = [...document.querySelectorAll('.deck-card-space')].filter(tile => tile.getBoundingClientRect().width).slice(0, 5);
    if (!cards.some(tile => tile.querySelector('.catalog-card-hero')) || !cards.some(tile => tile.querySelector('.deck-state-working')) || !cards.some(tile => tile.querySelector('.deck-state-review')) || !cards.some(tile => tile.querySelector('.deck-state-accepted'))) throw new Error('Social crop needs Hero, started, review and accepted cards');
    const titles = ['Light the first bonfire', 'Add a barrel roll', 'Stack the falling blocks', 'Tune the blue shell', 'Bake the promised cake'];
    if (cards.some((tile, index) => { const title = tile.querySelector('.deck-card-title'); return !title || !title.textContent.trim().endsWith(titles[index]) || title.scrollHeight > title.clientHeight + 1; })) throw new Error('Social crop titles must fit in the expected order');
    if (!cards[0]?.querySelector('.catalog-card-hero') || !cards[3]?.querySelector('.deck-state-accepted') || !cards[4]?.querySelector('.deck-state-review')) throw new Error('Social preview cards have unexpected states');
    const tiles = cards.map(tile => tile.getBoundingClientRect());
    if (tiles.length !== 5 || tiles.some(tile => Math.abs(tile.top - tiles[0].top) > 1)) throw new Error('Expected one complete row of five demo cards');
    const box = { left: Math.min(...tiles.map(t => t.left)), top: Math.min(...tiles.map(t => t.top)), right: Math.max(...tiles.map(t => t.right)), bottom: Math.max(...tiles.map(t => t.bottom)) };
    const frame = Object.assign(document.createElement('div'), { className: 'shot-frame' });
    frame.dataset.shot = 'cards';
    Object.assign(frame.style, { position: 'fixed', pointerEvents: 'none', left: box.left - 8 + 'px', top: box.top - 8 + 'px', width: box.right - box.left + 16 + 'px', height: box.bottom - box.top + 16 + 'px' });
    document.body.append(frame);
    return 'SHOT_MARKED';
  })()`;
  await capture('social-cards', deckUrl, '.catalog-card-hero', [],
    { width: 1280, height: 912, dpr: 4, after: [scrollToTop, markCards], clip: '[data-shot="cards"]', file: packagePath('docs', 'social-cards.png') });
  await captureSocial();
  // 2026-11-11: finish a real demo family after the overview captures to show the accepted count and continuous progress.
  const current = await readProjectCatalog(project);
  const children = current.cards.filter(card => card.parentId === hero.id && card.kind === 'task');
  if (!children.length) throw new Error('Demo Hero has no task Sub Cards to accept.');
  await acceptDemoTasks(project, current, children);
  await capture('deck-accepted', deckUrl, '.catalog-card-hero.is-family-done, .deck-card-space',
    [ready('.catalog-card-hero.is-family-done .deck-card-done-medallion'), 'click:Collapse summary',
      `eval:(() => { const steps = [...document.querySelectorAll('.catalog-card-hero.is-family-done .sub-card-progress-segment')]; if (steps.length !== ${children.length} || steps.some(step => step.dataset.state !== 'accepted')) throw new Error('Expected every Hero Task to be accepted'); return 'SHOT_HERO_ACCEPTED'; })()`],
    deckFrame);
  if (createHash('sha256').update(await readFile(clientEntry)).digest('hex') !== clientBuildHash) {
    throw new Error('The client build changed during capture; rerun screenshots after the build completes.');
  }
  await writeFile(path.join(evidence, 'shots.json'), JSON.stringify({ capturedAt: new Date().toISOString(), clientBuildHash, port,
    editMode: snapshot.editMode, writable: snapshot.writable, language: 'en', theme: 'dark',
    cards: catalog.cards.length, decks: catalog.decks.length, captures }, null, 2) + '\n');
}

try {
  if (socialOnly) await captureSocial();
  else await captureDemo();
} finally {
  try {
    if (address) {
      const snapshot = await (await fetch(address + '/api/snapshot', { signal: AbortSignal.timeout(5000) })).json() as { token: string };
      const response = await fetch(address + '/api/shutdown', { method: 'POST', headers: { 'x-deckmate-token': snapshot.token }, signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error(`Screenshot server shutdown failed: ${response.status}`);
      console.log('Screenshot server shutdown requested through /api/shutdown.');
    }
  }
  finally {
    await app?.close();
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    for (const key of Object.keys(process.env)) if (!(key in savedEnvironment)) delete process.env[key];
    Object.assign(process.env, savedEnvironment);
    // 2026-11-05: never recursively remove a path that escaped this tool's temporary root.
    if (path.dirname(temporary) !== path.resolve(tmpdir()) || !path.basename(temporary).startsWith('deckmate-readme-shots-')) {
      throw new Error('Unsafe screenshot cleanup target.');
    }
    await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    console.log('Temporary capture files removed.');
  }
}
