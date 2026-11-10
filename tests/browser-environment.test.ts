import { expect, it } from 'vitest';
import { findBrowser, requireBrowser } from './browser-environment.ts';

it('keeps browser absence optional locally but fails in CI or when explicitly required', () => {
  const missing = () => false;
  expect(requireBrowser({}, missing)).toBeUndefined();
  expect(requireBrowser({ CI: 'false' }, missing)).toBeUndefined();
  expect(() => requireBrowser({ CI: 'true' }, missing)).toThrow('Browser tests are required');
  expect(() => requireBrowser({ DECKMATE_REQUIRE_BROWSER: '1' }, missing)).toThrow('DECKMATE_BROWSER');
});

it('honors explicit browser paths and discovers the installed runner browsers', () => {
  expect(findBrowser({ DECKMATE_BROWSER: '/missing', BROWSER: '/other' }, name => name === '/other')).toBeUndefined();
  expect(findBrowser({ DECKMATE_BROWSER: '/custom' }, name => name === '/custom')).toBe('/custom');
  for (const installed of ['/usr/bin/google-chrome', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']) {
    expect(findBrowser({}, name => name === installed)).toBe(installed);
  }
});
