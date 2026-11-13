import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build, preview, type Manifest } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { browserFixtures } from '../browser-files.ts';
import packageInfo from '../../package.json' with { type: 'json' };

export async function buildBrowserFixtures() {
  const directory = await mkdtemp(path.join(tmpdir(), 'deckmate-browser-fixtures-'));
  const close = () => rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  try {
    const started = performance.now();
    // 2026-11-12: the caller owns this build until all shards exit; a persistent cache could serve stale fixtures.
    await build({ configFile: false, root: process.cwd(), plugins: [tailwindcss()],
      define: { __DECKMATE_VERSION__: JSON.stringify(packageInfo.version) }, logLevel: 'error',
      build: { outDir: directory, emptyOutDir: true, manifest: true, minify: false,
        rollupOptions: { input: Object.fromEntries(Object.keys(browserFixtures).map(name => [name, `tests/fixtures/${name}.tsx`])) } },
    });
    return { directory, durationMs: performance.now() - started, close };
  } catch (error) {
    await close();
    throw error;
  }
}

export async function startBrowserFixturePreview(directory: string) {
  const manifest = JSON.parse(await readFile(path.join(directory, '.vite/manifest.json'), 'utf8')) as Manifest;
  const stylesFor = (key: string, seen = new Set<string>()): string[] => {
    if (seen.has(key)) return [];
    seen.add(key);
    const chunk = manifest[key];
    return [...(chunk.imports ?? []).flatMap(imported => stylesFor(imported, seen)), ...(chunk.css ?? [])];
  };
  return preview({ configFile: false, root: process.cwd(), logLevel: 'error', build: { outDir: directory },
    // 2026-11-12: each shard has an OS-assigned port even when the immutable build is shared.
    preview: { host: '127.0.0.1', port: 0, open: false }, plugins: [{ name: 'browser-fixtures', configurePreviewServer(vite) {
      vite.middlewares.use((request, response, next) => {
        const name = request.url?.split('?')[0].split('/')[1];
        if (!name || !Object.hasOwn(browserFixtures, name)) return next();
        const key = `tests/fixtures/${name}.tsx`;
        const entry = manifest[key];
        // 2026-11-12: shared chunks must not apply another fixture's motion/layout styles.
        const css = [...new Set(stylesFor(key))].map(file => `<link rel="stylesheet" href="/${file}">`).join('');
        const slots = name === 'interface-states' ? '<div id="topbar-view-actions"></div>' : '';
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(`<!doctype html><html><head>${css}</head><body>${slots}<div id="root"></div><script type="module" src="/${entry.file}"></script></body></html>`);
      });
    } }],
  });
}
