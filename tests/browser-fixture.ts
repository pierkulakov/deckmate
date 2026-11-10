import { inject } from 'vitest';
import type { BrowserFixture } from './browser-files.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    browserFixtureOrigin: string;
  }
}

export function browserFixtureUrl(fixture: BrowserFixture): string {
  return new URL(`/${fixture}/`, inject('browserFixtureOrigin')).href;
}
