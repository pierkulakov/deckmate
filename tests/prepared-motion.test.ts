import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareEntrance } from '../client/prepared-motion.ts';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

function setup() {
  const frames = new Map<number, FrameRequestCallback>(); let sequence = 0;
  let ready!: () => void;
  const fonts = new Promise<void>(resolve => { ready = resolve; });
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.stubGlobal('document', { fonts: { ready: fonts } });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++sequence, callback); return sequence; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  class ElementStub {
    dataset = {};
    isConnected = true;
    style = { willChange: 'contents' };
    querySelectorAll() { return []; }
  }
  vi.stubGlobal('HTMLElement', ElementStub);
  vi.stubGlobal('SVGElement', class {});
  const element = new ElementStub() as unknown as HTMLElement;
  const target = new ElementStub() as unknown as HTMLElement;
  const animation = { playState: 'running', currentTime: 10, pause: vi.fn(function () { animation.playState = 'paused'; }),
    effect: { target, getKeyframes: () => [{ transform: 'translateY(50px)', opacity: 0 }, { transform: 'none', opacity: 1 }] },
    play: vi.fn(function () { animation.playState = 'running'; }), finished: Promise.resolve() };
  const frame = () => { const current = [...frames.values()]; frames.clear(); current.forEach(callback => callback(0)); };
  const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
  return { element, target, animation, frames, ready, frame, flush };
}

describe('preparing existing entrance animations', () => {
  it('waits for fonts and two layer frames without changing design timing, then releases will-change', async () => {
    const state = setup(); const cancel = prepareEntrance(state.element, [state.animation as unknown as Animation]);
    expect(state.animation.pause).toHaveBeenCalledOnce(); expect(state.animation.currentTime).toBe(0);
    expect(state.target.style.willChange).toBe('transform, opacity');
    expect(state.element.style.willChange).toBe('contents');
    state.frame(); expect(state.animation.play).not.toHaveBeenCalled();
    state.ready(); await state.flush(); state.frame(); expect(state.animation.play).not.toHaveBeenCalled();
    state.frame(); expect(state.animation.play).toHaveBeenCalledOnce(); await state.flush();
    expect(state.target.style.willChange).toBe('contents'); cancel?.();
  });

  it('does not restart an unmounted, cancelled or reduced-motion entrance', async () => {
    const state = setup(); const cancel = prepareEntrance(state.element, [state.animation as unknown as Animation]);
    cancel?.(); state.ready(); await state.flush(); state.frame(); state.frame(); expect(state.animation.play).not.toHaveBeenCalled();
    expect(state.frames.size).toBe(0); expect(state.target.style.willChange).toBe('contents');
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    expect(prepareEntrance(state.element, [state.animation as unknown as Animation])).toBeUndefined();
    expect(state.animation.pause).toHaveBeenCalledOnce();
  });

  it('observes fonts started by later layout effects in the same commit', async () => {
    const state = setup();
    const fonts = { ready: Promise.resolve() };
    vi.stubGlobal('document', { fonts });
    prepareEntrance(state.element, [state.animation as unknown as Animation]);
    let loaded!: () => void;
    fonts.ready = new Promise<void>(resolve => { loaded = resolve; });
    await state.flush(); state.frame(); state.frame(); expect(state.animation.play).not.toHaveBeenCalled();
    loaded(); await state.flush(); state.frame(); state.frame(); expect(state.animation.play).toHaveBeenCalledOnce();
  });

  it('caps a pending image decode without imposing the same deadline on a cold font', async () => {
    vi.useFakeTimers();
    const state = setup();
    const image = { decode: () => new Promise<void>(() => {}) };
    state.element.querySelectorAll = (() => [image]) as unknown as HTMLElement['querySelectorAll'];
    const cancel = prepareEntrance(state.element, [state.animation as unknown as Animation]);
    await vi.advanceTimersByTimeAsync(120);
    state.frame(); state.frame();
    expect(state.animation.play).not.toHaveBeenCalled();
    state.ready(); await state.flush(); state.frame(); state.frame();
    expect(state.animation.play).toHaveBeenCalledOnce();
    cancel?.();
    expect(vi.getTimerCount()).toBe(0);
  });
});
