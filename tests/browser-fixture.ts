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

export function desktopFixtureUrl(page: 'index.html' | 'startup.html' | 'whats-new.html' = 'index.html'): string {
  if (page === 'index.html') return browserFixtureUrl('launcher');
  return new URL(`/desktop/${page}`, inject('browserFixtureOrigin')).href;
}
