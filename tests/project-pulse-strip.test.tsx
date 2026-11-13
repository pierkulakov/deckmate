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
// cached pulse the strip paints numbers immediately instead of a loading state (2026-11-10).
function renderStrip(source: 'live' | 'sandbox', rootIdentity = '') {
  return renderToStaticMarkup(<ProjectPulseStrip source={source} rootIdentity={rootIdentity} refreshKey={0} members={[]} disabled={false}
    onInProgress={() => {}} onReview={() => {}} onWithoutDeck={() => {}} onRun={() => {}} />);
}

describe('ProjectPulseStrip stale-while-revalidate cache', () => {
  it('starts collapsed with unknown counts and an accessible loading status', () => {
    const html = renderStrip('sandbox');
    expect(html).toContain('project-pulse-loading');
    expect(html).toContain('data-expanded="false"');
    expect(html).toContain('role="status">Loading project pulse');
    expect(html).toContain('shape-line shape-value');
    expect(html).not.toContain('>—<');
    expect(html).not.toContain('project-pulse-value');
  });

  it('restores expansion for the same project before its first response', () => {
    vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'deckmate-project-pulse:sandbox:one' ? 'expanded' : null });
    const html = renderStrip('sandbox', 'one');
    expect(html).toContain('project-pulse-loading');
    expect(html).toContain('data-expanded="true"');
    expect(html).toContain('aria-expanded="true"');
    expect(renderStrip('sandbox', 'two')).toContain('data-expanded="false"');
    expect(renderStrip('live', 'one')).toContain('data-expanded="false"');
  });

  it('uses the compact default if preference storage is unavailable or invalid', () => {
    vi.stubGlobal('localStorage', { getItem: () => 'unexpected' });
    expect(renderStrip('sandbox')).toContain('data-expanded="false"');
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('storage blocked'); } });
    expect(renderStrip('sandbox')).toContain('data-expanded="false"');
  });

  it('renders the cached numbers on the first render of a remount, without the loading state', () => {
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
    expect(uncached).toContain('shape-line shape-value');
    expect(uncached).not.toContain('>—<');
    expect(uncached).not.toContain('project-pulse-value');
    rememberProjectPulse('live', pulse(7));
    const cached = renderStrip('live');
    expect(cached).not.toContain('project-pulse-loading');
    expect(cached).toContain('>7<');
    // The sandbox cache must not leak into the live render.
    expect(cached).not.toContain('>3<');
  });

  it('keeps the same disclosure for empty activity, nonzero counts and a current Run', () => {
    rememberProjectPulse('sandbox', pulse(0));
    expect(renderStrip('sandbox')).toContain('data-expanded="false"');
    expect(renderStrip('sandbox')).toContain('project-pulse-value">0');
    const withoutDeck = { ...pulse(0), withoutDeck: 1 };
    rememberProjectPulse('sandbox', withoutDeck);
    expect(renderStrip('sandbox')).toContain('data-pulse="unassigned"');
    const withRun = { ...pulse(0), run: { id: 'run', title: 'Run', end: '2026-11-20', done: 0, total: 0 } };
    rememberProjectPulse('sandbox', withRun);
    expect(renderStrip('sandbox')).toContain('project-pulse-run');
    const accepted = { ...pulse(0), accepted: { days: [...Array(13).fill(0), 1], total: 1 } };
    rememberProjectPulse('sandbox', accepted);
    expect(renderStrip('sandbox')).toContain('project-pulse-accepted');
  });
});
