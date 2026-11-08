import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  // 2026-11-08: local agent folders (.claude worktrees, .deckmate audits) and the desktop shell carry copies of
  // tests or their own node_modules; only tests/ of this checkout are the suite.
  test: { setupFiles: ['./tests/setup.ts'], exclude: [...configDefaults.exclude, '**/.claude/**', '**/.deckmate/**', 'desktop/**'] },
});
