import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from 'react';
import { loadInterfaceFonts } from './warmup-assets.ts';
import { OpeningScreen } from './OpeningScreen.tsx';
import './first-screen.css';

const InitialScreenReady = createContext<(() => void) | undefined>(undefined);

export function useInitialScreenReady() {
  return useContext(InitialScreenReady);
}

export function FirstScreen({ children, projectName }: { children: ReactNode; projectName?: string }) {
  const [contentReady, setContentReady] = useState(false);
  const [fontsReady, setFontsReady] = useState(false);
  const [reveal] = useState(() => () => setContentReady(true));
  useLayoutEffect(() => {
    let active = true;
    // 2026-11-13: CSS is installed before this commit; preloaded bytes alone do not make font metrics ready.
    void loadInterfaceFonts().then(() => { if (active) setFontsReady(true); });
    return () => { active = false; };
  }, []);
  const ready = fontsReady && contentReady;
  // 2026-11-13: lay out the real screen once behind the page background, then reveal chrome and content together.
  return <InitialScreenReady value={reveal}>
    <div className="first-screen" data-state={ready ? 'ready' : 'loading'} inert={!ready} aria-hidden={!ready || undefined}>{children}</div>
    <div className="first-screen-status" data-state={ready ? 'ready' : 'loading'} aria-hidden={ready || undefined}>
      <OpeningScreen projectName={projectName} />
    </div>
  </InitialScreenReady>;
}
