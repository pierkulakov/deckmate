import { existsSync } from 'node:fs';

export const missingBrowserReason = 'Chrome/Edge/Chromium not found; set DECKMATE_BROWSER to its executable';

export function findBrowser(environment: NodeJS.ProcessEnv = process.env, exists = existsSync): string | undefined {
  // 2026-11-10: an explicit path is authoritative, so a broken CI setting cannot silently select another browser.
  const explicit = environment.DECKMATE_BROWSER || environment.BROWSER;
  if (explicit) return exists(explicit) ? explicit : undefined;
  return [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].find(candidate => exists(candidate));
}

export function requireBrowser(environment: NodeJS.ProcessEnv = process.env, exists = existsSync): string | undefined {
  const browser = findBrowser(environment, exists);
  const ci = Boolean(environment.CI && !['0', 'false'].includes(environment.CI.toLowerCase()));
  if (!browser && (ci || environment.DECKMATE_REQUIRE_BROWSER === '1')) {
    throw new Error(`Browser tests are required: ${missingBrowserReason}. Configured path: ${environment.DECKMATE_BROWSER || environment.BROWSER || '(automatic discovery)'}`);
  }
  return browser;
}
