// 2026-11-05: capture real writable demo projects; no application CSS or data is faked for the camera.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseEnv, promisify } from 'node:util';
import { createApp } from '../server/app.ts';
import { readProjectCatalog } from '../server/catalog.ts';
import { loadConfig } from '../server/config.ts';
import { initializeDemo } from '../server/demo.ts';
import { editNativeCardProperties } from '../server/native-cards.ts';
import { packagePath } from '../server/package-path.ts';

const executeFile = promisify(execFile);
const workspace = packagePath();
const clientEntry = packagePath('dist', 'client', 'index.html');
const clientBuildHash = createHash('sha256').update(await readFile(clientEntry)).digest('hex');
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

async function freePort(preferred: number): Promise<number> {
  const probe = createServer();
  try {
    await new Promise<void>((resolve, reject) => { probe.once('error', reject); probe.listen(preferred, '127.0.0.1', resolve); });
    const address = probe.address();
    if (!address || typeof address === 'string') throw new Error('Cannot allocate a screenshot port.');
    return address.port;
  } catch (error) {
    if (preferred && (error as NodeJS.ErrnoException).code === 'EADDRINUSE') return freePort(0);
    throw error;
  } finally {
    if (probe.listening) await new Promise<void>((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  }
}

async function preferredPort(): Promise<number> {
  let local: NodeJS.Dict<string> = {};
  try { local = parseEnv(await readFile(packagePath('.env.local'), 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const configured = process.env.DECKMATE_PORT ?? process.env.FREETION_PORT ?? local.DECKMATE_PORT ?? local.FREETION_PORT;
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
    if (document.querySelector('.readonly-banner, .error-banner, .source-switch')) throw new Error('Expected direct, error-free demo');` : ''}
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
    for (const element of document.querySelectorAll(${JSON.stringify(selector + ', .catalog-source, .planning-cards')})) {
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

try {
  const project = path.join(temporary, 'project');
  await initializeDemo(project);
  interruption.signal.throwIfAborted();
  const port = await freePort(await preferredPort());
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
  const hero = catalog.cards.find(card => card.kind === 'hero' && card.title === 'Moonwake Lantern')
    ?? catalog.cards.find(card => card.kind === 'hero');
  if (!hero?.deckId) throw new Error('Demo Hero missing.');
  const board = (await readdir(path.join(project, 'boards'))).find(filename => filename.endsWith('.excalidraw'));
  if (!board) throw new Error('Demo Vision board missing.');
  await mkdir(output, { recursive: true });
  await mkdir(evidence, { recursive: true });
  const url = (values: Record<string, string>) => address + '/?' + new URLSearchParams({ catalogSource: 'sandbox', ...values });
  const deckUrl = url({ view: 'deck', deck: hero.deckId, order: 'manual' });
  // 1280 CSS pixels at DPR 1.25 keep text legible when GitHub scales the 1600 px PNG down.
  await capture('decks', url({ view: 'deck' }), '.catalog-spaces',
    [ready('.project-pulse[aria-busy="false"] .project-pulse-run progress')], { width: 1280, height: 600, dpr: 1.25, after: [scrollToTop] });
  await capture('deck', deckUrl, '.catalog-card-hero', [], { width: 1280, height: 912, dpr: 1.25, after: [scrollToTop] });
  await capture('card', url({ view: 'deck', deck: hero.deckId, card: hero.id }), '.card-family-panel',
    [ready('[aria-label="Properties"]'), 'click:Hero and Sub Cards'], { width: 1280, height: 1240, dpr: 1.25, after: [scrollToTop] });
  await capture('timeline', url({ view: 'sprint' }), '.timeline-run',
    [ready('.planning-cards'), 'click:Description and stats'], { width: 1280, height: 928, dpr: 1.25 });
  await capture('hand', url({ view: 'hand', handMember: 'maya' }), '[aria-labelledby="hand-tab-runs"]',
    [ready('.hand-view .deck-card'), 'click:Your Runs'], { width: 1280, height: 840, dpr: 1.25 });
  await capture('vision', url({ view: 'vision', board: board.replace('.excalidraw', '') }), '.excalidraw',
    [ready('.excalidraw'), 'click:Zoom in', 'click:Zoom in'], { width: 1280, height: 900, dpr: 1.25 });
  // 2026-11-07: a complete row keeps card footers visible in the link preview, with no clipped second row.
  const markCards = `eval:(() => {
    const tiles = [...document.querySelectorAll('.deck-card-space')].map(tile => tile.getBoundingClientRect()).filter(box => box.width).slice(0, 5);
    if (tiles.length !== 5 || tiles.some(tile => Math.abs(tile.top - tiles[0].top) > 1)) throw new Error('Expected one complete row of five demo cards');
    const box = { left: Math.min(...tiles.map(t => t.left)), top: Math.min(...tiles.map(t => t.top)), right: Math.max(...tiles.map(t => t.right)), bottom: Math.max(...tiles.map(t => t.bottom)) };
    const frame = Object.assign(document.createElement('div'), { className: 'shot-frame' });
    frame.dataset.shot = 'cards';
    Object.assign(frame.style, { position: 'fixed', pointerEvents: 'none', left: box.left - 8 + 'px', top: box.top - 8 + 'px', width: box.right - box.left + 16 + 'px', height: box.bottom - box.top + 16 + 'px' });
    document.body.append(frame);
    return 'SHOT_MARKED';
  })()`;
  await capture('social-cards', deckUrl, '.catalog-card-hero', [],
    { width: 1280, height: 912, dpr: 2, after: [scrollToTop, markCards], clip: '[data-shot="cards"]', file: packagePath('docs', 'social-cards.png') });
  await capture('social', pathToFileURL(packagePath('docs', 'social-preview.html')).href, '.cards', [], { width: 1280, height: 640, dpr: 1 }, true);
  // 2026-11-09: finish a real demo family after the overview captures to show the accepted Hero's foil.
  const current = await readProjectCatalog(project);
  const children = current.cards.filter(card => card.parentId === hero.id && card.kind === 'task');
  if (!children.length) throw new Error('Demo Hero has no task Sub Cards to accept.');
  for (const child of children) {
    if (child.state !== 'done') await editNativeCardProperties(project, child.id, child.sourceHash, { state: 'done' }, undefined, current.formatLanguage);
  }
  await capture('deck-accepted', deckUrl, '.catalog-card-hero.is-family-done',
    [ready('.catalog-card-hero.is-family-done .deck-card-done-medallion')],
    { width: 1280, height: 912, dpr: 1.25, after: [scrollToTop] });
  if (createHash('sha256').update(await readFile(clientEntry)).digest('hex') !== clientBuildHash) {
    throw new Error('The client build changed during capture; rerun screenshots after the build completes.');
  }
  await writeFile(path.join(evidence, 'shots.json'), JSON.stringify({ capturedAt: new Date().toISOString(), clientBuildHash, port,
    editMode: snapshot.editMode, writable: snapshot.writable, language: 'en', theme: 'dark',
    cards: catalog.cards.length, decks: catalog.decks.length, captures }, null, 2) + '\n');
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
    console.log('Temporary server stopped; demo and index removed.');
  }
}
