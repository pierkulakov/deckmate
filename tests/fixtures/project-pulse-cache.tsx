import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import type { ProjectPulse } from '../../src/pulse-contracts.ts';
import { ProjectPulseStrip } from '../../client/components/ProjectPulse.tsx';

// 2026-11-10: drive the strip like the Decks home does — one fetch per mount, a refreshKey bump on file changes —
// and let the test flip the served numbers to prove the stale-while-revalidate cache.
let pulseCount = 3;
let pulseFail = false;
const pulseRequests: string[] = [];

function servedPulse(): ProjectPulse {
  return {
    inProgress: { count: pulseCount, ownerIds: [] },
    review: { count: 0, oldestSince: null, deckId: null },
    accepted: { days: Array(14).fill(0), total: 0 },
    run: null,
    withoutDeck: 0,
  };
}

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(String(input), location.href);
  if (url.pathname !== '/api/project-pulse') return realFetch(input, init);
  pulseRequests.push(url.search);
  if (pulseFail) return Response.json({ message: 'pulse unavailable' }, { status: 500 });
  return Response.json(servedPulse());
};

function Host() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [mounted, setMounted] = useState(true);
  // Returning from an open deck remounts the gallery; the frame gap is the moment a skeleton would flash.
  const remount = () => { setMounted(false); requestAnimationFrame(() => setMounted(true)); };
  return <>
    <button type="button" className="pulse-refresh" onClick={() => setRefreshKey(key => key + 1)}>refresh</button>
    <button type="button" className="pulse-remount" onClick={remount}>remount</button>
    {mounted && <ProjectPulseStrip source="sandbox" refreshKey={refreshKey} members={[]} disabled={false}
      onInProgress={() => {}} onReview={() => {}} onWithoutDeck={() => {}} onRun={() => {}} />}
  </>;
}

createRoot(document.getElementById('root')!).render(<Host />);

(window as unknown as { pulseTest: unknown }).pulseTest = {
  setCount: (count: number) => { pulseCount = count; },
  setFail: (fail: boolean) => { pulseFail = fail; },
  pulseRequests,
};
