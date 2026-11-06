import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: 'client',
  plugins: [tailwindcss()],
  build: {
    outDir: '../dist/client', emptyOutDir: true,
    // 2026-11-05: packaged init copies these covers into the demo; data URLs cannot serve as source files.
    assetsInlineLimit: filename => /[/\\]deck-art[/\\].+\.webp$/u.test(filename) ? false : undefined,
    // 2026-11-06: the npm package ships this bundle, and the MIT, ISC, BSD and Apache code inside it requires its notices.
    // A visible name outside .vite/ keeps the file in the package and easy to find.
    license: { fileName: 'third-party-licenses.md' },
  },
  server: { host: '127.0.0.1', port: 4318, strictPort: true },
});
