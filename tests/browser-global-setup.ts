import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build, preview, type Manifest, type PreviewServer } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import type { TestProject } from 'vitest/node';
import { browserFixtures } from './browser-files.ts';
import { requireBrowser } from './browser-environment.ts';
import { version } from '../package.json';

export default async function setup(project: TestProject) {
  if (!requireBrowser()) return;
  const temporary = await mkdtemp(path.join(tmpdir(), 'deckmate-browser-fixtures-'));
  let server: PreviewServer | undefined;
  const cleanup = async () => {
    await server?.close();
    await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  };
  try {
    const started = performance.now();
    // 2026-11-10: none of these fixtures tests HMR. Build their shared imports once before workers start,
    // avoiding per-file cold dependency optimizers, 504 reload races and concurrent Vite/Chrome startup storms.
    await build({ configFile: false, root: process.cwd(), plugins: [tailwindcss()],
      define: { __DECKMATE_VERSION__: JSON.stringify(version) }, logLevel: 'error',
      build: { outDir: temporary, emptyOutDir: true, manifest: true, minify: false,
        rollupOptions: { input: Object.fromEntries(Object.keys(browserFixtures).map(name => [name, `tests/fixtures/${name}.tsx`])) } },
    });
    console.info(`Browser fixtures built once in ${((performance.now() - started) / 1000).toFixed(2)} s`);
    const manifest = JSON.parse(await readFile(path.join(temporary, '.vite/manifest.json'), 'utf8')) as Manifest;
    const stylesFor = (key: string, seen = new Set<string>()): string[] => {
      if (seen.has(key)) return [];
      seen.add(key);
      const chunk = manifest[key];
      return [...(chunk.imports ?? []).flatMap(imported => stylesFor(imported, seen)), ...(chunk.css ?? [])];
    };
    server = await preview({ configFile: false, root: process.cwd(), logLevel: 'error', build: { outDir: temporary },
      preview: { host: '127.0.0.1', port: 0, open: false }, plugins: [{ name: 'browser-fixtures', configurePreviewServer(vite) {
        vite.middlewares.use((request, response, next) => {
          const name = request.url?.split('?')[0].split('/')[1];
          if (!name || !Object.hasOwn(browserFixtures, name)) return next();
          const key = `tests/fixtures/${name}.tsx`;
          const entry = manifest[key];
          // 2026-11-10: a fixture must not inherit another fixture's motion/layout styles merely because the build is shared.
          const css = [...new Set(stylesFor(key))].map(file => `<link rel="stylesheet" href="/${file}">`).join('');
          const slots = name === 'interface-states' ? '<div id="topbar-view-actions"></div>' : '';
          response.setHeader('Content-Type', 'text/html; charset=utf-8');
          response.end(`<!doctype html><html><head>${css}</head><body>${slots}<div id="root"></div><script type="module" src="/${entry.file}"></script></body></html>`);
        });
      } }],
    });
    if (!server.resolvedUrls) throw new Error('Browser fixture server did not publish a local URL');
    project.provide('browserFixtureOrigin', server.resolvedUrls.local[0]);
    return cleanup;
  } catch (error) {
    await cleanup();
    throw error;
  }
}
