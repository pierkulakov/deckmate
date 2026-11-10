import { afterEach, describe, expect, it } from 'vitest';
import { openHeadlessBrowser, type HeadlessPage } from '../tools/layout-capture.ts';
import { browserFixtureUrl } from './browser-fixture.ts';
import { requireBrowser } from './browser-environment.ts';
import { waitForLayout } from './browser-layout.ts';
import { readDurationMs } from '../client/motion.ts';

const browserPath = requireBrowser();
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

interface SourceDropFrame {
  x: number;
  progress: number;
  overlay: boolean;
  visible: boolean;
  duration: number;
}

interface NeighborSlideFrame {
  x: number;
  progress: number;
  motion: number | null;
  released: boolean;
}

interface NeighborSlideMotion {
  kind: 'sort' | 'settle';
  from: number;
  to: number;
  duration: number;
}

interface NeighborSlides {
  origin: number;
  target: number;
  frames: NeighborSlideFrame[];
  motions: NeighborSlideMotion[];
  release: NeighborSlideFrame | null;
}

describe.skipIf(!browserPath)('Hand pointer drag work (browser)', () => {
  let page: HeadlessPage | undefined;
  let motionDuration: number;
  afterEach(async () => {
    try {
      expect(page?.consoleErrors ?? []).toEqual([]);
      if (page) expect(await page.evaluate('window.handDragTest?.result().opened ?? []')).toEqual([]);
    }
    finally { await page?.close(); }
  });

  async function openHand({ reducedMotion = false, queue = false, width = 1440 } = {}) {
    page = await openHeadlessBrowser({ width, height: 900, scale: 1 });
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reducedMotion ? 'reduce' : 'no-preference' }] });
    await page.send('Page.navigate', { url: browserFixtureUrl('hand-drag-performance') + (queue ? '?queue' : '') });
    for (let attempt = 0; attempt < 300; attempt++) {
      if (await page.evaluate(`document.querySelectorAll('.hand-slots .hand-slot.is-filled').length === 7`)) break;
      await delay(50);
    }
    expect(await page.evaluate(`document.querySelectorAll('.hand-slots .hand-slot.is-filled').length`)).toBe(7);
    await waitForLayout(page.evaluate, '.hand-slots');
    motionDuration = await page.evaluate(`(${readDurationMs})('--motion-material')`);
    return page;
  }

  async function pointOf(selector: string) {
    return page!.callFunction(`function(selector) {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }`, selector);
  }

  async function recordSourceDrop() {
    await page!.evaluate(`(() => {
      const slot = document.querySelector('.hand-slot.is-drag-source');
      const start = performance.now();
      const frames = [];
      let stable = 0;
      window.handSourceDropFrames = new Promise((resolve, reject) => {
        function sample() {
          const face = document.querySelector('.card-drag-face');
          const source = face ?? slot;
          const motion = face?.parentElement.getAnimations().find(animation =>
            animation.effect.getKeyframes().some(key => key.transform));
          const style = getComputedStyle(source);
          frames.push({ x: source.getBoundingClientRect().left,
            progress: face ? motion?.effect.getComputedTiming().progress ?? 0 : 1,
            duration: motion?.effect.getComputedTiming().duration ?? 0,
            overlay: !!face, visible: source.isConnected && style.visibility === 'visible' && Number(style.opacity) >= .99 });
          stable = face ? 0 : stable + 1;
          if (stable >= 3) return resolve(frames);
          if (performance.now() - start > 5000) return reject(new Error('Source drop did not finish'));
          requestAnimationFrame(sample);
        }
        sample();
      });
    })()`);
  }

  function expectContinuousSourceDrop(frames: SourceDropFrame[]) {
    const start = frames[0].x;
    const end = frames.at(-1)!.x;
    expect(frames[0].overlay).toBe(true);
    expect(frames.at(-1)!.overlay).toBe(false);
    expect(start - end).toBeCloseTo(16, 1);
    // 2026-11-10: one long frame can span the whole effect; require its duration, not an intermediate frame count.
    expect(frames.some(frame => frame.duration === motionDuration), JSON.stringify(frames)).toBe(true);
    // 2026-11-10: a 33ms frame travels 10.4px along the same curve as a 16ms frame's 6.4px.
    // Subtract WAAPI's eased travel, not elapsed frame count, so a missing overlay or a handoff snap still fails.
    let previousError = 0;
    for (const frame of frames) {
      expect(frame.visible).toBe(true);
      if (frame.duration) expect(frame.duration).toBe(motionDuration);
      const error = frame.x - (start + (end - start) * frame.progress);
      expect(Math.abs(error), JSON.stringify(frame)).toBeLessThanOrEqual(1);
      expect(Math.abs(error - previousError), JSON.stringify(frame)).toBeLessThanOrEqual(1);
      previousError = error;
    }
  }

  async function recordHandDrag(pointerX: number) {
    await page!.callFunction(`function(pointerX) {
      window.handDragTest.reset();
      const recording = window.handDragTest.record(pointerX);
      const face = document.querySelector('.hand-slots [data-card-id="card:hand-1"]');
      const slot = face.closest('.hand-slot');
      const origin = face.getBoundingClientRect().left;
      const target = document.querySelector('.hand-slot.is-drag-source').getBoundingClientRect().left;
      const frames = [], motions = [], identities = new Map();
      let release = null, frame;
      // 2026-11-10: activation can transition from none to translate(0); that must not trigger an early release.
      const isSlide = animation => {
        const keys = animation.effect.getKeyframes();
        return keys[0].transform && keys.at(-1).transform
          && new DOMMatrixReadOnly(keys[0].transform).m41 !== new DOMMatrixReadOnly(keys.at(-1).transform).m41;
      };
      function sample() {
        const active = [slot, face].map(element => ({ element, animation: element.getAnimations().find(isSlide) }))
          .find(motion => motion.animation);
        const { element, animation } = active ?? {};
        const x = face.getBoundingClientRect().left;
        if (animation && !identities.has(animation)) {
          const keys = animation.effect.getKeyframes();
          const base = x - new DOMMatrixReadOnly(getComputedStyle(element).transform).m41;
          identities.set(animation, motions.length);
          motions.push({ kind: element === slot ? 'sort' : 'settle',
            from: base + new DOMMatrixReadOnly(keys[0].transform).m41,
            to: base + new DOMMatrixReadOnly(keys.at(-1).transform).m41,
            duration: animation.effect.getComputedTiming().duration });
        }
        const snapshot = { x, progress: animation?.effect.getComputedTiming().progress ?? 1,
          motion: animation ? identities.get(animation) : null, released: release !== null };
        frames.push(snapshot);
        return snapshot;
      }
      // 2026-11-10: the release coordinate must be read before React replaces the sortable transition with FLIP.
      const captureRelease = () => { release = sample(); };
      window.addEventListener('pointerup', captureRelease, true);
      const tick = () => { sample(); frame = requestAnimationFrame(tick); };
      tick();
      window.handDragRecording = {
        phase: value => recording.phase(value),
        whenSliding: () => new Promise(resolve => {
          function check() {
            const current = frames.at(-1);
            if (current.motion !== null && current.progress > 0 && current.progress < 1) {
              recording.phase('drop');
              resolve();
            } else requestAnimationFrame(check);
          }
          check();
        }),
        finish: () => {
          cancelAnimationFrame(frame);
          window.removeEventListener('pointerup', captureRelease, true);
          sample();
          return { ...recording.finish(), neighborSlides: { origin, target, frames, motions, release } };
        }
      };
    }`, pointerX);
  }

  function expectContinuousNeighborSlides(slides: NeighborSlides, earlyDrop = false) {
    const { origin, target, frames, motions, release } = slides;
    const expected: Omit<NeighborSlideMotion, 'duration'>[] = [{ kind: 'sort', from: origin, to: target }];
    if (earlyDrop) {
      expect(release).not.toBeNull();
      expect(release!.motion).toBe(0);
      expect(release!.progress).toBeGreaterThan(0);
      expect(release!.progress).toBeLessThan(1);
      expect(release!.x - origin).toBeGreaterThan(1);
      expect(target - release!.x).toBeGreaterThan(1);
      expected.push({ kind: 'settle', from: release!.x, to: target });
    } else {
      expected.push({ kind: 'sort', from: target, to: origin }, { kind: 'sort', from: origin, to: target });
    }
    expect(motions, JSON.stringify({ motions, release })).toHaveLength(expected.length);
    for (const [index, motion] of motions.entries()) {
      expect(motion.kind).toBe(expected[index].kind);
      expect(Math.abs(motion.from - expected[index].from), JSON.stringify(motion)).toBeLessThanOrEqual(1);
      expect(Math.abs(motion.to - expected[index].to), JSON.stringify(motion)).toBeLessThanOrEqual(1);
      expect(motion.duration).toBe(motionDuration);
    }
    // 2026-11-10: long frames legitimately cover most of a slot; only travel unexplained by eased progress is a jump.
    // Independent endpoints, including pointerup's position, also reject a full restart or a skipped handoff.
    let destination = origin, previousError = 0;
    const progress = motions.map(() => 0);
    for (const frame of frames) {
      let x = destination;
      if (frame.motion !== null) {
        const motion = expected[frame.motion];
        expect(frame.progress, JSON.stringify(frame)).toBeGreaterThanOrEqual(progress[frame.motion]);
        progress[frame.motion] = frame.progress;
        x = motion.from + (motion.to - motion.from) * frame.progress;
        destination = motion.to;
        if (motion.kind === 'settle') expect(frame.released).toBe(true);
      }
      const error = frame.x - x;
      expect(Math.abs(error), JSON.stringify(frame)).toBeLessThanOrEqual(1);
      expect(Math.abs(error - previousError), JSON.stringify(frame)).toBeLessThanOrEqual(1);
      previousError = error;
    }
    expect(Math.abs(frames.at(-1)!.x - target)).toBeLessThanOrEqual(1);
  }

  async function dragBetween(start: { x: number; y: number }, end: { x: number; y: number }, touch = false) {
    const send = async (type: 'start' | 'move' | 'end', point: typeof start) => {
      if (touch) {
        const names = { start: 'touchStart', move: 'touchMove', end: 'touchEnd' };
        await page!.send('Input.dispatchTouchEvent', { type: names[type], touchPoints: type === 'end' ? [] : [{ ...point, id: 1 }] });
      } else {
        const names = { start: 'mousePressed', move: 'mouseMoved', end: 'mouseReleased' };
        await page!.send('Input.dispatchMouseEvent', { type: names[type], ...point, button: 'left', buttons: type === 'end' ? 0 : 1, clickCount: 1 });
      }
    };
    await send('start', start);
    for (let step = 1; step <= 20; step++) {
      await send('move', { x: start.x + (end.x - start.x) * step / 20, y: start.y + (end.y - start.y) * step / 20 });
      await delay(20);
    }
    await delay(250);
    await send('end', end);
    await delay(350);
  }

  it.each([false, true])('makes room once per slow boundary crossing and stays still in the dead zone (reduced motion: %s)', async reducedMotion => {
    page = await openHand({ reducedMotion });
    const points = await page.evaluate(`(() => {
      const slots = document.querySelectorAll('.hand-slot.is-filled');
      const source = slots[2].querySelector('.deck-card-open').getBoundingClientRect();
      const neighbor = slots[1].getBoundingClientRect();
      const own = slots[2].getBoundingClientRect();
      return { start: { x: source.x + source.width / 2, y: source.y + source.height / 2 },
        boundary: (neighbor.x + neighbor.width / 2 + own.x + own.width / 2) / 2, end: neighbor.x + neighbor.width / 2 };
    })()`);
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...points.start });
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...points.start, button: 'left', buttons: 1, clickCount: 1 });
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: points.start.x - 12, y: points.start.y, buttons: 1 });
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: points.start.x - 14, y: points.start.y, buttons: 1 });
    await waitForLayout(page.evaluate, '.hand-slots');
    await recordHandDrag(points.start.x - 14);
    let x = points.start.x - 14;
    const moveTo = async (target: number) => {
      const start = x;
      const steps = Math.ceil(Math.abs(target - start) / 2);
      for (let step = 1; step <= steps; step++) {
        x = start + (target - start) * step / steps;
        await page!.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: points.start.y, buttons: 1 });
        await delay(1000 / 60);
      }
    };
    for (const [phase, direction] of [['left', -1], ['right', 1], ['left-again', -1]] as const) {
      await page.callFunction('function(value) { window.handDragRecording.phase(value); }', phase);
      await moveTo(points.boundary + direction * 20);
      for (let cycle = 0; cycle < 3; cycle++) {
        await moveTo(points.boundary + 3);
        await moveTo(points.boundary - 3);
      }
      await moveTo(points.boundary + direction * 20);
      await delay(250);
    }
    await moveTo(points.end + 16);
    await delay(250);
    // 2026-11-10: a throttled drop may exceed 50ms without extra work; pointer moves must never reformat card dates.
    expect.soft((await page.evaluate('window.handDragTest.result()')).dateFormats).toBe(0);
    await page.evaluate(`window.handDragRecording.phase('drop')`);
    if (!reducedMotion) await recordSourceDrop();
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y: points.start.y, button: 'left', buttons: 0, clickCount: 1 });
    if (!reducedMotion) expectContinuousSourceDrop(await page.evaluate('window.handSourceDropFrames'));
    await waitForLayout(page.evaluate, '.hand-slots');
    const { neighborSlides, ...metrics }: { neighborSlides: NeighborSlides; [key: string]: any } = await page.evaluate('window.handDragRecording.finish()');
    console.info('Hand slow drag:', JSON.stringify(metrics));
    for (const phase of ['left', 'right', 'left-again']) expect.soft(metrics.changes[phase], JSON.stringify(metrics)).toBe(1);
    expect.soft(metrics.positions).toMatchObject({ left: 1, right: 0, 'left-again': 1, drop: 1 });
    expect.soft(metrics.emptyFrames).toBe(0);
    expect.soft(metrics.outlinedFrames).toBe(0);
    expect.soft(metrics.classChanges).toBe(0);
    if (reducedMotion) {
      expect.soft(metrics.movingFrames).toBe(0);
      expect(neighborSlides.motions).toEqual([]);
      for (const frame of neighborSlides.frames.filter(frame => frame.released)) {
        expect(Math.abs(frame.x - neighborSlides.target), JSON.stringify(frame)).toBeLessThanOrEqual(1);
      }
    } else {
      expectContinuousNeighborSlides(neighborSlides);
      expect.soft(metrics.sourceDropSteps.every((step: number) => step < 0)).toBe(true);
    }
    // 2026-11-10: CDP and React may land either side of rAF; allow two 2px input samples, never a slot reset.
    expect.soft(metrics.maxPointerError).toBeLessThan(4.1);
    expect((await page.evaluate('window.handDragTest.result()')).reorder).toEqual([0, 2, 1, 3, 4, 5, 6].map(index => `card:hand-${index}`));
  }, 30000);

  it('continues the neighbor slide when dropped before it has finished', async () => {
    page = await openHand();
    const start = await pointOf('.hand-slots [data-card-id="card:hand-2"] .deck-card-open');
    const neighbor = await pointOf('.hand-slots [data-card-id="card:hand-1"]');
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...start, button: 'left', buttons: 1, clickCount: 1 });
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x - 12, y: start.y, buttons: 1 });
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x - 14, y: start.y, buttons: 1 });
    await waitForLayout(page.evaluate, '.hand-slots');
    await recordHandDrag(start.x - 14);
    const end = { x: (start.x + neighbor.x) / 2 - 10, y: start.y };
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...end, buttons: 1 });
    await page.evaluate('window.handDragRecording.whenSliding()');
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...end, button: 'left', buttons: 0, clickCount: 1 });
    await waitForLayout(page.evaluate, '.hand-slots');
    const { neighborSlides, ...metrics } = await page.evaluate('window.handDragRecording.finish()');
    console.info('Hand early drop:', JSON.stringify(metrics));
    expectContinuousNeighborSlides(neighborSlides, true);
    expect(metrics.emptyFrames).toBe(0);
    expect(metrics.outlinedFrames).toBe(0);
    expect(metrics.classChanges).toBe(0);
    expect((await page.evaluate('window.handDragTest.result()')).reorder).toEqual([0, 2, 1, 3, 4, 5, 6].map(index => `card:hand-${index}`));
  }, 10000);

  it('keeps keyboard reorder and Escape cancellation on the handle', async () => {
    page = await openHand();
    const focusHero = () => page!.evaluate(`document.querySelector('.hand-slots [data-card-id="card:hand-2"]').closest('.hand-slot').querySelector('.hand-slot-handle').focus()`);
    const key = async (code: string, key: string, windowsVirtualKeyCode: number) => {
      await page!.send('Input.dispatchKeyEvent', { type: 'keyDown', code, key, windowsVirtualKeyCode });
      await page!.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key, windowsVirtualKeyCode });
      await delay(250);
    };
    await focusHero();
    await key('Space', ' ', 32);
    await key('ArrowLeft', 'ArrowLeft', 37);
    await key('Space', ' ', 32);
    expect((await page.evaluate('window.handDragTest.result()')).reorder).toEqual([0, 2, 1, 3, 4, 5, 6].map(index => `card:hand-${index}`));
    await focusHero();
    await key('Space', ' ', 32);
    await key('ArrowRight', 'ArrowRight', 39);
    await key('Escape', 'Escape', 27);
    expect((await page.evaluate('window.handDragTest.result()')).writes).toBe(1);
    expect(await page.evaluate(`Boolean(document.querySelector('.is-drag-source'))`)).toBe(false);
  }, 15000);

  it('preserves slot/queue transfers, touch queue handles and touch scrolling on faces', async () => {
    page = await openHand({ queue: true });
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    await dragBetween(await pointOf('.hand-slots [data-card-id="card:hand-2"] .deck-card-open'), await pointOf('.hand-slots [data-card-id="card:hand-1"]'), true);
    expect((await page.evaluate('window.handDragTest.result()')).writes).toBe(0);
    await dragBetween(await pointOf('.hand-queue li:first-child .hand-queue-handle'), await pointOf('.hand-slots [data-card-id="card:hand-5"]'));
    expect((await page.evaluate('window.handDragTest.result()')).reorder).toEqual([0, 1, 2, 3, 4, 7, 5, 6, 8].map(index => `card:hand-${index}`));
    await dragBetween(await pointOf('.hand-slots [data-card-id="card:hand-5"] .deck-card-open'), await pointOf('.hand-queue li:last-child .hand-queue-handle'));
    expect((await page.evaluate('window.handDragTest.result()')).reorder).toEqual([0, 1, 2, 3, 4, 7, 6, 8, 5].map(index => `card:hand-${index}`));
    await dragBetween(await pointOf('.hand-queue li:first-child .hand-queue-handle'), await pointOf('.hand-queue li:last-child .hand-queue-handle'), true);
    expect((await page.evaluate('window.handDragTest.result()')).reorder).toEqual([0, 1, 2, 3, 4, 7, 6, 5, 8].map(index => `card:hand-${index}`));
    expect((await page.evaluate('window.handDragTest.result()')).writes).toBe(3);
  }, 20000);

  it('keeps Done Cards outside ordering and reorders across wrapped tile rows', async () => {
    page = await openHand({ width: 600 });
    const start = await pointOf('.hand-slots [data-card-id="card:hand-2"] .deck-card-open');
    await dragBetween(start, await pointOf('.hand-slot-done'));
    expect((await page.evaluate('window.handDragTest.result()')).writes).toBe(0);
    expect(await page.evaluate(`document.querySelector('.hand-slot-done-count').textContent`)).toBe('1');
    await dragBetween(start, await pointOf('.hand-slots [data-card-id="card:hand-5"]'));
    expect((await page.evaluate('window.handDragTest.result()')).reorder).toEqual([0, 1, 3, 4, 5, 2, 6].map(index => `card:hand-${index}`));
    expect(await page.evaluate(`document.querySelectorAll('.hand-slots .hand-slot.is-filled').length`)).toBe(7);
  }, 15000);

  it.each(['face', 'handle'])('keeps disabled deck-transfer faces out of per-move renders when dragging by %s', async activator => {
    page = await openHand();
    const points = await page.callFunction(`function(activator) {
      const slots = document.querySelectorAll('.hand-slot.is-filled');
      const source = (activator === 'handle' ? slots[0].querySelector('.hand-slot-handle') : slots[0].querySelector('.deck-card-open')).getBoundingClientRect();
      const target = slots[5].getBoundingClientRect();
      return { start: { x: source.x + source.width / 2, y: source.y + source.height / 2 }, end: { x: target.x + target.width / 2, y: target.y + target.height / 2 } };
    }`, activator);
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...points.start });
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...points.start, button: 'left', buttons: 1, clickCount: 1 });
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: points.start.x + 12, y: points.start.y, buttons: 1 });
    await delay(150);
    expect(await page.evaluate(`Boolean(document.querySelector('.hand-slot.is-drag-source'))`)).toBe(true);
    await page.evaluate('window.handDragTest.reset()');
    for (let step = 1; step <= 30; step++) {
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', buttons: 1,
        x: points.start.x + 12 + (points.end.x - points.start.x - 12) * step / 30,
        y: points.start.y + (points.end.y - points.start.y) * step / 30 });
      await delay(1000 / 60);
    }
    const during = await page.evaluate('window.handDragTest.result()');
    // 2026-11-10: allow enter/leave at six slot boundaries, not fresh Intl work on all 30 moves.
    // A deterministic work budget avoids frame-time limits dependent on other builds on the host.
    expect(during.dateFormats, JSON.stringify(during)).toBeLessThanOrEqual(16);
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...points.end, button: 'left', buttons: 0, clickCount: 1 });
    await delay(250);
    expect((await page.evaluate('window.handDragTest.result()')).reorder).toEqual([1, 2, 3, 4, 5, 0, 6].map(index => `card:hand-${index}`));
  }, 30000);
});
