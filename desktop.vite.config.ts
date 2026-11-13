import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { classicScriptsPlugin, earlyThemePlugin } from './tools/classic-scripts.ts';
import { radixLayerAlias } from './tools/radix-resolve.ts';
import { thirdPartyNoticesPlugin } from './tools/third-party-notices.ts';

const source = (file: string) => new URL(`./client/desktop/${file}`, import.meta.url);
// 2026-11-13: Vite canonicalizes its root; HTML entry paths must use the same spelling through Windows directory aliases.
const root = realpathSync.native(fileURLToPath(source('')));

export default defineConfig(({ command }) => ({
  root,
  base: './',
  publicDir: false,
  resolve: { alias: radixLayerAlias },
  define: { __DECKMATE_START_DEV__: command === 'serve' },
  plugins: [
    thirdPartyNoticesPlugin({ subset: true }),
    earlyThemePlugin(),
    classicScriptsPlugin({
      'focus.js': new URL('./client/focus.js', import.meta.url),
      ...Object.fromEntries(['page-ready.js', 'whats-new.js'].map(file => [file, source(file)])),
    }),
    {
      name: 'deckmate-local-styles',
      transformIndexHtml: {
        order: 'post',
        // 2026-11-13: bundled local pages use same-origin stylesheets and do not need anonymous-CORS requests.
        handler: html => html.replaceAll('<link rel="stylesheet" crossorigin ', '<link rel="stylesheet" '),
      },
    },
  ],
  build: {
    outDir: '../../desktop/dist', emptyOutDir: true,
    // 2026-11-13: the local CSP accepts same-origin fonts and artwork, not inlined font data.
    assetsInlineLimit: 0,
    license: { fileName: 'third-party-licenses.md' },
    rolldownOptions: {
      onwarn(warning, defaultHandler) {
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE' && warning.message.includes('"use client"')) return;
        defaultHandler(warning);
      },
      input: Object.fromEntries(['index.html', 'startup.html', 'whats-new.html'].map(file => [file, path.join(root, file)])),
      output: {
        assetFileNames: asset => {
          // 2026-11-13: local pages keep styles beside their HTML for relative custom-property artwork URLs.
          if (asset.names.some(name => name.endsWith('.css'))) return '[name]-[hash][extname]';
          // 2026-11-13: screenshot checks identify theme-specific artwork by its source filename.
          if (asset.names.some(name => /\.(?:png|webp)$/u.test(name))) return 'art/[name][extname]';
          return 'assets/[name]-[hash][extname]';
        },
      },
    },
  },
}));
