import type { Reporter, TestModule } from 'vitest/node';
import { findBrowser, missingBrowserReason } from './browser-environment.ts';
import { browserFiles } from './browser-files.ts';

export default class BrowserSkipReporter implements Reporter {
  onTestRunEnd(modules: ReadonlyArray<TestModule>) {
    if (findBrowser()) return;
    let skipped = 0;
    for (const module of modules) {
      if (!browserFiles.some(file => module.moduleId.replaceAll('\\', '/').endsWith('/' + file))) continue;
      for (const test of module.children.allTests()) {
        if (test.result().state === 'skipped') skipped++;
      }
    }
    // 2026-11-10: the warning label keeps this diagnostic visible through npm run quiet's success filter.
    if (skipped) console.warn(`Warning: Browser tests skipped: ${skipped} — ${missingBrowserReason}.`);
  }
}
