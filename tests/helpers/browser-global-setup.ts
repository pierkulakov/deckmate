import type { PreviewServer } from 'vite';
import type { TestProject } from 'vitest/node';
import { requireBrowser } from '../browser-environment.ts';
import { startSharedHeadlessBrowser } from '../../tools/headless-browser.ts';
import { buildBrowserFixtures, startBrowserFixturePreview } from './browser-fixtures.ts';

export default async function setup(project: TestProject) {
  const browserPath = requireBrowser();
  if (!browserPath) return;
  let built: Awaited<ReturnType<typeof buildBrowserFixtures>> | undefined;
  let server: PreviewServer | undefined;
  const browsers: Awaited<ReturnType<typeof startSharedHeadlessBrowser>>[] = [];
  let closing: Promise<void> | undefined;
  const cleanup = () => closing ??= (async () => {
    process.off('SIGTERM', terminate);
    const results = await Promise.allSettled([...browsers.map(browser => browser.close()), server?.close()]);
    await built?.close();
    const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
    if (errors.length) throw new AggregateError(errors, 'Browser fixture cleanup failed');
  })();
  const terminate = () => {
    // 2026-11-12: POSIX shards own detached browser groups, which must close before coordinator termination.
    void cleanup().catch(error => console.error(error)).finally(() => process.exit(143));
  };
  try {
    const sharedBuild = process.env.DECKMATE_TEST_FIXTURE_BUILD;
    if (!sharedBuild) built = await buildBrowserFixtures();
    server = await startBrowserFixturePreview(sharedBuild ?? built!.directory);
    if (!server.resolvedUrls) throw new Error('Browser fixture server did not publish a local URL');
    project.provide('browserFixtureOrigin', server.resolvedUrls.local[0]);
    const started = performance.now();
    // 2026-11-12: preserve both feature-flag configurations without paying their startup/profile cost per page.
    for (const extraArgs of [[], ['--disable-features=OverlayScrollbar']]) {
      browsers.push(await startSharedHeadlessBrowser({ browserPath, extraArgs }));
    }
    project.provide('sharedHeadlessBrowsers', browsers.map(browser => browser.connection));
    project.provide('browserFixtureTiming', { buildMs: built?.durationMs ?? 0, browserMs: performance.now() - started,
      previewPort: Number(new URL(server.resolvedUrls.local[0]).port) });
    process.once('SIGTERM', terminate);
    return cleanup;
  } catch (error) {
    try { await cleanup(); } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Browser fixture setup and cleanup failed');
    }
    throw error;
  }
}
