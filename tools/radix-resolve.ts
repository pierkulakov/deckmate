import { createRequire } from 'node:module';

// 2026-11-13: nested Radix copies otherwise own independent stacks: a departing tooltip can consume a dialog's Escape.
// Resolve from Dialog so the shared layer also supports the dismissable surfaces its installed version requires.
const require = createRequire(import.meta.url);
const dialogRequire = createRequire(require.resolve('@radix-ui/react-dialog'));
export const radixLayerAlias = { '@radix-ui/react-dismissable-layer': dialogRequire.resolve('@radix-ui/react-dismissable-layer') };
