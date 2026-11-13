import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { installStartBridge } from './start-bridge.ts';
import { StartScreen } from './StartScreen.tsx';

declare const __DECKMATE_START_DEV__: boolean;
declare global {
  interface Window {
    prepareDeckmatePage(): Promise<unknown>;
    deckmatePageReady: Promise<unknown>;
  }
}

let bridge = installStartBridge();
let shortcuts: 'native' | 'local' = 'native';
if (__DECKMATE_START_DEV__ && !bridge) {
  bridge = (await import('./start-mock.ts')).installStartMock();
  shortcuts = 'local';
}
// 2026-11-13: the native window may show on document load, before React's scheduled first commit.
flushSync(() => createRoot(document.getElementById('root')!).render(<StartScreen bridge={bridge} shortcuts={shortcuts} />));
