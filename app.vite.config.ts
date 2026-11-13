import { defineConfig, type ProxyOptions } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { rewriteProxyOrigin } from './tools/dev-proxy.ts';
import { thirdPartyNoticesPlugin } from './tools/third-party-notices.ts';
import { earlyThemePlugin } from './tools/classic-scripts.ts';
import packageInfo from './package.json' with { type: 'json' };
import { radixLayerAlias } from './tools/radix-resolve.ts';

const serverOrigin = `http://127.0.0.1:${process.env.DECKMATE_PORT ?? '4317'}`;
const devPort = 4318;
const devOrigins = new Set([`http://127.0.0.1:${devPort}`, `http://localhost:${devPort}`, `http://[::1]:${devPort}`]);

function proxyToDeckmate(webSocket = false): ProxyOptions {
  return {
    target: serverOrigin,
    changeOrigin: true,
    ws: webSocket,
    configure(proxy) {
      // 2026-11-08: Deckmate accepts only its own Origin; the loopback-only dev proxy rewrites browser HTTP and WebSocket origins.
      proxy.on('proxyReq', (request, incoming) => rewriteProxyOrigin(request, incoming, serverOrigin, devOrigins));
      proxy.on('proxyReqWs', (request, incoming) => rewriteProxyOrigin(request, incoming, serverOrigin, devOrigins));
    },
  };
}

export default defineConfig({
  root: 'client',
  resolve: { alias: radixLayerAlias },
  define: { __DECKMATE_VERSION__: JSON.stringify(packageInfo.version) },
  plugins: [tailwindcss(), thirdPartyNoticesPlugin(), earlyThemePlugin()],
  build: {
    outDir: '../dist/client', emptyOutDir: true,
    // 2026-11-05: packaged init copies these covers into the demo; data URLs cannot serve as source files.
    assetsInlineLimit: filename => /[/\\]deck-art[/\\].+\.webp$/u.test(filename) ? false : undefined,
    // 2026-11-06: the npm package ships this bundle, and the MIT, ISC, BSD and Apache code inside it requires its notices.
    // A visible name outside .vite/ keeps the file in the package and easy to find.
    // 2026-11-07: @radix-ui/*, fastdom, format and a few others carry no LICENSE in their tarball, so the
    // supplement plugin fills their empty sections from assets/third-party-notices.json, adds notices
    // for code embedded in prebuilt packages and fails on empty sections or undeclared embedded code.
    license: { fileName: 'third-party-licenses.md' },
    // 2026-11-07: Excalidraw, Mermaid and KaTeX are deliberately lazy-loaded vendor chunks of 1.1-1.8 MB,
    // so the default 500 kB warning only restates a known trade-off on every build.
    chunkSizeWarningLimit: 2000,
    // 2026-11-07: Radix packages carry "use client" for Next.js; rolldown flags each copy as
    // MODULE_LEVEL_DIRECTIVE, which is irrelevant to this app. Everything else still warns.
    rolldownOptions: {
      output: {
        // 2026-11-10: keep the critical React runtime cacheable without pulling its optional server renderer into it.
        codeSplitting: { groups: [{
          name: 'react-runtime',
          test: /[/\\]node_modules[/\\](?:react|scheduler)[/\\]|[/\\]node_modules[/\\]react-dom[/\\](?:index\.js$|client\.js$|cjs[/\\]react-dom(?:-client)?\.production\.js$)/u,
        }] },
      },
      onwarn(warning, defaultHandler) {
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE' && warning.message.includes('"use client"')) return;
        defaultHandler(warning);
      },
    },
  },
  server: {
    host: '127.0.0.1', port: devPort, strictPort: true,
    proxy: { '^/api/': proxyToDeckmate(true), '^/r/': proxyToDeckmate() },
  },
});
