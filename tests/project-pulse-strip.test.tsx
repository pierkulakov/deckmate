import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ProjectPulse } from '../src/pulse-contracts.ts';
import { ProjectPulseStrip } from '../client/components/ProjectPulse.tsx';
import { rememberProjectPulse } from '../client/pulse-cache.ts';
import { setLang } from '../client/i18n.ts';

vi.hoisted(() => {
  vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
});

beforeEach(() => {
  vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
  vi.stubGlobal('window', Object.assign(new EventTarget(), { location: { origin: 'http://localhost' } }));
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
  setLang('en');
});

afterEach(() => vi.unstubAllGlobals());

function pulse(count: number): ProjectPulse {
  return {
    inProgress: { count, ownerIds: [] },
    review: { count: 0, oldestSince: null, deckId: null },
    accepted: { days: Array(14).fill(0), total: 0 },
    run: null,
    withoutDeck: 0,
  };
}

// Effects never run under renderToStaticMarkup, so this asserts exactly what the first paint shows: with a
// cached pulse the strip paints numbers immediately instead of the loading skeleton (2026-11-10).
function renderStrip(source: 'live' | 'sandbox') {
  return renderToStaticMarkup(<ProjectPulseStrip source={source} refreshKey={0} members={[]} disabled={false}
    onInProgress={() => {}} onReview={() => {}} onWithoutDeck={() => {}} onRun={() => {}} />);
}

describe('ProjectPulseStrip stale-while-revalidate cache', () => {
  it('shows the loading skeleton on the very first load of a source', () => {
    const html = renderStrip('sandbox');
    expect(html).toContain('project-pulse-loading');
    expect(html).not.toContain('project-pulse-value');
  });

  it('renders the cached numbers on the first render of a remount, without the skeleton', () => {
    rememberProjectPulse('sandbox', pulse(3));
    const html = renderStrip('sandbox');
    expect(html).not.toContain('project-pulse-loading');
    expect(html).toContain('project-pulse-value');
    expect(html).toContain('>3<');
  });

  it('keeps pulses isolated per source', () => {
    rememberProjectPulse('sandbox', pulse(3));
    const uncached = renderStrip('live');
    expect(uncached).toContain('project-pulse-loading');
    expect(uncached).not.toContain('project-pulse-value');
    rememberProjectPulse('live', pulse(7));
    const cached = renderStrip('live');
    expect(cached).not.toContain('project-pulse-loading');
    expect(cached).toContain('>7<');
    // The sandbox cache must not leak into the live render.
    expect(cached).not.toContain('>3<');
  });
});
