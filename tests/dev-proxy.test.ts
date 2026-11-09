import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { afterEach, expect, it, vi } from 'vitest';
import { rewriteProxyOrigin } from '../tools/dev-proxy.ts';
import { freePort } from './free-port.ts';

const devOrigins = new Set(['http://127.0.0.1:4318', 'http://localhost:4318']);
const closers: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
  vi.unstubAllEnvs();
});

function rewritten(origin: string | undefined): [string, string][] {
  const headers: [string, string][] = [];
  rewriteProxyOrigin(
    { setHeader: (name, value) => { headers.push([name, value]); } },
    { headers: origin === undefined ? {} : { origin } },
    'http://127.0.0.1:4317',
    devOrigins,
  );
  return headers;
}

it('replaces the dev server Origin with the Deckmate server origin', () => {
  expect(rewritten('http://127.0.0.1:4318')).toEqual([['Origin', 'http://127.0.0.1:4317']]);
  expect(rewritten('http://localhost:4318')).toEqual([['Origin', 'http://127.0.0.1:4317']]);
});

it('does not add an Origin when the incoming request has none', () => {
  expect(rewritten(undefined)).toEqual([]);
});

it('leaves a foreign Origin for the server to reject', () => {
  expect(rewritten('https://example.com')).toEqual([]);
  expect(rewritten('http://127.0.0.1:5173')).toEqual([]);
});

it('sends only /api/ and /r/ requests to Deckmate and serves root client modules itself', async () => {
  const forwarded: string[] = [];
  const deckmate = createServer((request, response) => {
    forwarded.push(request.url ?? '');
    response.end('deckmate');
  });
  await new Promise<void>(resolve => deckmate.listen(0, '127.0.0.1', resolve));
  closers.push(() => new Promise<void>(resolve => deckmate.close(() => resolve())));
  vi.stubEnv('DECKMATE_PORT', String((deckmate.address() as AddressInfo).port));
  const port = await freePort();
  // 2026-11-08: the real config and proxy table, on a free port so a running `npm run dev` keeps 4318; without
  // dependency discovery the test does not pre-bundle client packages into node_modules/.vite.
  const vite = await createViteServer({
    configFile: fileURLToPath(new URL('../app.vite.config.ts', import.meta.url)),
    logLevel: 'silent', optimizeDeps: { noDiscovery: true }, server: { port },
  });
  closers.push(() => vite.close());
  await vite.listen();
  const get = async (path: string) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`);
    return { status: response.status, type: response.headers.get('content-type') ?? '', body: await response.text() };
  };
  const links = [await get('/r/c-abcdefghij?source=live'), await get('/api/health')];
  const runLabel = await get('/run-label.ts');
  // 2026-11-08: Vite serves client/ at the URL root, so module names can start like the proxied routes;
  // /api-client.ts stands for a future module.
  for (const path of ['/relative-time.ts', '/refresh-batch.ts', '/api-client.ts']) await get(path);
  expect(forwarded).toEqual(['/r/c-abcdefghij?source=live', '/api/health']);
  expect(links.map(link => link.body)).toEqual(['deckmate', 'deckmate']);
  expect(runLabel).toMatchObject({ status: 200, type: expect.stringMatching(/javascript/u) });
});
