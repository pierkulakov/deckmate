import { expect, it } from 'vitest';
import { rewriteProxyOrigin } from '../tools/dev-proxy.ts';

const devOrigins = new Set(['http://127.0.0.1:4318', 'http://localhost:4318']);

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
