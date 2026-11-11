// 2026-11-11: the implementation lives in tools/free-port.ts; this test-side name keeps the import surface of the
// suites that start a real server until the test-infrastructure cleanup switches them to the tools module.
export { freePort } from '../tools/free-port.ts';
