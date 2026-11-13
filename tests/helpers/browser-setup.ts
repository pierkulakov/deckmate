import { afterAll, inject } from 'vitest';
import { useSharedHeadlessBrowsers, type SharedHeadlessBrowser } from '../../tools/headless-browser.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    sharedHeadlessBrowsers?: SharedHeadlessBrowser[];
    browserFixtureTiming?: { buildMs: number; browserMs: number; previewPort: number };
  }
}

const browsers = inject('sharedHeadlessBrowsers');
if (browsers) {
  // 2026-11-12: failed tests and hooks must not retain contexts, storage or permissions for the next file.
  afterAll(useSharedHeadlessBrowsers(browsers));
}
