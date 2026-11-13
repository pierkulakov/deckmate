import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { build, preview, type Manifest } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { browserFixtures } from '../browser-files.ts';
import packageInfo from '../../package.json' with { type: 'json' };
import { createBrowserTemp, removeBrowserTemp, retainBrowserTemp } from '../../tools/browser-temp.ts';
import { radixLayerAlias } from '../../tools/radix-resolve.ts';

export async function buildBrowserFixtures() {
  const directory = await createBrowserTemp('deckmate-browser-fixtures-');
  const close = () => removeBrowserTemp(directory);
  try {
    const started = performance.now();
    // 2026-11-12: the caller owns this build until all shards exit; a persistent cache could serve stale fixtures.
    await build({ configFile: false, root: process.cwd(), plugins: [tailwindcss()],
      resolve: { alias: radixLayerAlias },
      define: { __DECKMATE_VERSION__: JSON.stringify(packageInfo.version) }, logLevel: 'error',
      // 2026-11-13: this fresh directory already contains the live-owner marker needed by concurrent sweeps.
      build: { outDir: directory, emptyOutDir: false, manifest: true, minify: false,
        rollupOptions: { input: Object.fromEntries(Object.keys(browserFixtures).map(name => [name, `tests/fixtures/${name}.tsx`])) } },
    });
    // 2026-11-13: launcher checks need the same transformed assets as Tauri, isolated from desktop/dist and other invocations.
    await build({ configFile: path.resolve('desktop.vite.config.ts'), logLevel: 'error',
      build: { outDir: path.join(directory, 'desktop'), emptyOutDir: false } });
    return { directory, durationMs: performance.now() - started, close };
  } catch (error) {
    await close();
    throw error;
  }
}

export async function startBrowserFixturePreview(directory: string) {
  const release = await retainBrowserTemp(directory);
  try {
    const manifest = JSON.parse(await readFile(path.join(directory, '.vite/manifest.json'), 'utf8')) as Manifest;
    const stylesFor = (key: string, seen = new Set<string>()): string[] => {
      if (seen.has(key)) return [];
      seen.add(key);
      const chunk = manifest[key];
      return [...(chunk.imports ?? []).flatMap(imported => stylesFor(imported, seen)), ...(chunk.css ?? [])];
    };
    const server = await preview({ configFile: false, root: process.cwd(), logLevel: 'error', build: { outDir: directory },
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
    const close = server.close.bind(server);
    server.close = async () => { try { await close(); } finally { await release(); } };
    return server;
  } catch (error) {
    await release();
    throw error;
  }
}
