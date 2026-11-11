// 2026-11-11: one browser discovery (tools/browser-environment.ts) serves the browser suites and the capture tools;
// this module keeps the import surface the suites use until the test-infrastructure cleanup switches them.
export { findBrowser, requireBrowser, missingBrowserReason } from '../tools/browser-environment.ts';
