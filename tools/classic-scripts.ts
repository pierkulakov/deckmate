import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

// 2026-11-13: theme resolution must block first paint; the static desktop pages also depend on classic script order and scope.
export function classicScriptsPlugin(sources: Record<string, URL>): Plugin {
  return {
    name: 'deckmate-classic-scripts',
    buildStart() {
      for (const source of Object.values(sources)) this.addWatchFile(fileURLToPath(source));
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        for (const name of Object.keys(sources)) html = html.replaceAll(`<script src="${name}">`, `<script vite-ignore src="${name}">`);
        return html;
      },
    },
    generateBundle() {
      for (const [fileName, source] of Object.entries(sources)) this.emitFile({ type: 'asset', fileName, source: readFileSync(source) });
    },
    configureServer(server) {
      for (const [name, source] of Object.entries(sources)) {
        server.middlewares.use(`/${name}`, (_request, response) => {
          response.setHeader('Content-Type', 'text/javascript');
          response.end(readFileSync(source));
        });
      }
    },
  };
}

export function earlyThemePlugin(): Plugin {
  return classicScriptsPlugin({ 'theme.js': new URL('../client/theme.js', import.meta.url) });
}
