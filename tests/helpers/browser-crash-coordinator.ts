import { startSharedHeadlessBrowser } from '../../tools/headless-browser.ts';

const browser = await startSharedHeadlessBrowser({ browserPath: process.argv[2] });
process.send?.({ profile: browser.profile, pid: browser.pid });
process.once('message', () => { void browser.close().finally(() => process.disconnect?.()); });
