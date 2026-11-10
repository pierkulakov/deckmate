import { configDefaults, defineConfig } from 'vitest/config';
import { browserFiles } from './tests/browser-files.ts';

const shared = {
  setupFiles: ['./tests/setup.ts'],
  include: ['tests/**/*.test.{ts,tsx}'],
  exclude: [...configDefaults.exclude, '**/.claude/**', '**/.deckmate/**', 'desktop/**'],
  testTimeout: 20_000,
};

export default defineConfig({
  // 2026-11-08: local agent folders (.claude worktrees, .deckmate audits) and the desktop shell carry copies of
  // tests or their own node_modules; only tests/ of this checkout are the suite.
  test: {
    ...shared,
    reporters: ['default', './tests/browser-skip-reporter.ts'],
    // 2026-11-10: unbounded workers on high-core hosts saturate filesystem scans and make even non-browser hooks time out.
    maxWorkers: 4,
    projects: [
      // 2026-11-10: extends merges include arrays, which would also schedule every unit file in the browser project.
      { extends: false, test: { ...shared, name: 'unit', maxWorkers: 4, exclude: [...shared.exclude, ...browserFiles], sequence: { groupOrder: 0 } } },
      { extends: false, test: { ...shared, name: 'browser', include: browserFiles, pool: 'forks', maxWorkers: 1,
        fileParallelism: false, globalSetup: ['./tests/browser-global-setup.ts'], sequence: { groupOrder: 1 } } },
    ],
  },
});
