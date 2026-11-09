import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDesktopDirty } from '../client/desktop-bridge.ts';

const effects = vi.hoisted(() => [] as (() => void | (() => void))[]);
vi.mock('react', () => ({ useEffect: (effect: () => void | (() => void)) => effects.push(effect) }));

const cleanups: (() => void)[] = [];
function editor(dirty: boolean) {
  useDesktopDirty(dirty);
  const cleanup = effects.shift()!() ?? (() => {});
  cleanups.push(cleanup);
  return cleanup;
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  effects.length = 0;
  vi.unstubAllGlobals();
});

describe('desktop unsaved work', () => {
  it('does not clear a reported dirty state when a clean editor mounts', () => {
    const setDirty = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('window', { deckmateBoard: { setDirty } });
    editor(false)();
    expect(setDirty).not.toHaveBeenCalled();
  });

  it('keeps the shell dirty until every nested editor has saved or unmounted', () => {
    const setDirty = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('window', { deckmateBoard: { setDirty } });
    const first = editor(true);
    const second = editor(true);
    editor(false);
    first();
    expect(setDirty.mock.calls.every(([dirty]) => dirty === true)).toBe(true);
    second();
    expect(setDirty).toHaveBeenLastCalledWith(false);
  });

  it('leaves browser and older-shell unload protection alone', () => {
    vi.stubGlobal('window', {});
    expect(() => editor(true)()).not.toThrow();
    vi.stubGlobal('window', { deckmateBoard: {} });
    expect(() => editor(true)()).not.toThrow();
  });
});
