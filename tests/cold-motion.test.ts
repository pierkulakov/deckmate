import { describe, expect, it } from 'vitest';
import { openHeadlessBrowser } from '../tools/headless-browser.ts';
import { browserFixtureUrl } from './browser-fixture.ts';
import { requireBrowser } from './browser-environment.ts';
import { waitForLayout } from './browser-layout.ts';
import { motionMetrics, replayPathError, sampleMotion, untilMotionReady, type MotionSample } from './helpers/motion-sampling.ts';
import { handSlotDrag } from './helpers/cold-motion-actions.ts';

const browserPath = requireBrowser();
const click = (selector: string) => `document.querySelector(${JSON.stringify(selector)}).click()`;
const cover = '.deck-transition-ghost [data-deck-cover="top"] || .deck-view [data-deck-cover="top"] .catalog-deck-cover || .deck-view [data-deck-cover="top"]';

async function coldPage(rate: number, query = '') {
  const page = await openHeadlessBrowser({ width: 1700, height: 1000, scale: 1 });
  await page.send('Network.enable');
  await page.send('Network.setCacheDisabled', { cacheDisabled: true });
  await page.send('Emulation.setCPUThrottlingRate', { rate });
  await page.send('Page.navigate', { url: browserFixtureUrl('cold-motion') + '?view=deck&catalogSource=sandbox' + query });
  await untilMotionReady(page, `document.querySelector('${query.includes('entrance') ? '#show' : '[data-deck-cover]'}')`);
  return page;
}

function expectSameLanding(first: MotionSample, repeat: MotionSample) {
  const a = motionMetrics(first), b = motionMetrics(repeat);
  expect(a.frames).toBeGreaterThan(3);
  expect(b.frames).toBeGreaterThan(3);
  for (let axis = 0; axis < 4; axis++) expect(Math.abs(a.lastBox![axis] - b.lastBox![axis])).toBeLessThanOrEqual(2);
  expect(replayPathError(first, repeat)).toBeLessThanOrEqual(2);
}

function expectDeckPath(sample: MotionSample) {
  const from = sample.frames[0].box!, to = sample.frames.at(-1)!.box!;
  const moving = sample.frames.filter(frame => frame.progress !== null && frame.progress > 0 && frame.progress < 1);
  expect(moving.length).toBeGreaterThanOrEqual(5);
  for (const frame of moving) for (let axis = 0; axis < 4; axis++) {
    const expected = from[axis] + (to[axis] - from[axis]) * frame.progress!;
    expect(Math.abs(frame.box![axis] - expected), `axis ${axis} at ${frame.time}ms`).toBeLessThanOrEqual(2);
  }
  expect(motionMetrics(sample).activeMaxFrameMs).toBeLessThanOrEqual(50);
}

describe.skipIf(!browserPath)('cold motion matches replay (browser)', () => {
  it.each([1, 4])('keeps deck travel, clipping and reveal on one prepared clock, CPU ×%s', async rate => {
    const page = await coldPage(rate);
    try {
      await waitForLayout(page.evaluate, '.deck-view');
      await page.evaluate(`document.documentElement.style.setProperty('--motion-feedback', '.15s')`);
      const opening: MotionSample[] = [], closing: MotionSample[] = [];
      for (let replay = 0; replay < 2; replay++) {
        opening.push(await sampleMotion(page, cover, `${click('.catalog-cover-item [data-deck-cover="top"]')};
          requestAnimationFrame(() => { window.revealTiming = document.querySelector('.catalog-workbench').getAnimations().map(a => a.effect.getTiming()); });`));
        const reveal = await page.evaluate(`window.revealTiming.find(timing => timing.delay >= 200)`);
        expect(reveal.duration).toBe(150);
        closing.push(await sampleMotion(page, cover, click('.deck-open-toolbar button')));
      }
      for (const sample of [...opening, ...closing]) expectDeckPath(sample);
      expectSameLanding(...opening as [MotionSample, MotionSample]);
      expectSameLanding(...closing as [MotionSample, MotionSample]);
      expect(page.consoleErrors).toEqual([]);
    } finally { await page.close(); }
  }, 30000);

  it.each([1, 4])('keeps preview layout, section columns and Hero return stable from first use, CPU ×%s', async rate => {
    const page = await coldPage(rate, '&deck=top&layout=cards');
    try {
      await untilMotionReady(page, `document.querySelector('[data-card-id="card:0"] .deck-card-open')`);
      await waitForLayout(page.evaluate, '.catalog-results');
      expect(await page.evaluate(`getComputedStyle(document.querySelector('.catalog-results-body')).display`)).toBe('contents');
      const previous = new Map<string, MotionSample>();
      async function record(name: string, selector: string, action: string) {
        const sample = await sampleMotion(page, selector, action);
        const last = previous.get(name);
        if (last) expectSameLanding(last, sample);
        previous.set(name, sample);
        return sample;
      }
      for (let replay = 0; replay < 2; replay++) {
        const preview = await record('preview', '.card-preview-panel[data-panel="content"]', click('[data-card-id="card:0"] .deck-card-open'));
        const frames = preview.frames.filter(frame => frame.box);
        const landing = frames.at(-1)!.box!;
        for (const frame of frames) {
          expect(frame.box![0]).toBeGreaterThanOrEqual(landing[0] - .1);
          expect(frame.box![0]).toBeLessThanOrEqual(landing[0] + 5.1);
          expect(Math.abs(frame.box![1] - landing[1])).toBeLessThanOrEqual(2);
        }
        expect(motionMetrics(preview).activeMaxFrameMs).toBeLessThanOrEqual(50);
        await untilMotionReady(page, `document.querySelector('.card-title-edit:not(:disabled)')`);
        for (const panel of ['properties', 'attachments', 'dependencies', 'questions', 'history']) {
          const action = click(`.card-preview-action-rail button[aria-controls$="-${panel}"]`);
          const sample = await record(panel, '.card-properties-slot:not([hidden])', action);
          const boxes = sample.frames.flatMap(frame => frame.box ? [frame.box] : []);
          for (const box of boxes) expect(Math.max(...box.map((value, index) => Math.abs(value - boxes.at(-1)![index])))).toBeLessThanOrEqual(2);
          await page.evaluate(action);
        }
        // 2026-11-13: the shell jumps by the parent strip; the content panel owns the entrance and comparable progress.
        const child = await record('child', '.card-preview-panel[data-panel="content"]', click('[data-journey-card-id="card:1"]'));
        const returned = await record('return', '.card-preview-panel[data-panel="content"]', click('.card-preview-parent'));
        for (const sample of [child, returned]) expect(sample.frames.filter(frame => frame.progress !== null && frame.progress > 0 && frame.progress < 1).length).toBeGreaterThanOrEqual(5);
        await page.evaluate(`Object.defineProperty(navigator, 'clipboard', {configurable:true, value:{writeText: async () => {}}})`);
        const toast = await record('toast', '.card-id-feedback:not(:empty)', click('.card-id-chip'));
        expect(toast.frames.filter(frame => frame.progress !== null && frame.progress > 0 && frame.progress < 1).length).toBeGreaterThanOrEqual(5);
        expect(motionMetrics(toast).activeMaxFrameMs).toBeLessThanOrEqual(50);
        await page.evaluate(click('.card-preview-tools button'));
        await waitForLayout(page.evaluate, '.catalog-results');
      }
      expect(page.consoleErrors).toEqual([]);
    } finally { await page.close(); }
  }, 30000);

  it('holds the actual animated layer until a cold font is ready, then restores its layer hint', async () => {
    const page = await coldPage(4, '&entrance');
    try {
      await page.send('Network.emulateNetworkConditions', { offline: false, latency: 350, downloadThroughput: 1_000_000, uploadThroughput: 1_000_000 });
      const sample = await sampleMotion(page, '#entrance-target', click('#show'), 1200);
      expect(sample.frames.some(frame => frame.box && !frame.fontsReady)).toBe(true);
      const moving = sample.frames.filter(frame => frame.progress !== null && frame.progress > 0 && frame.progress < 1);
      expect(moving.length).toBeGreaterThan(5);
      expect(moving.every(frame => frame.fontsReady)).toBe(true);
      const width = moving.at(-1)!.box![2];
      expect(moving.every(frame => Math.abs(frame.box![2] - width) <= 2)).toBe(true);
      expect(await page.evaluate(`document.querySelector('#entrance-target').style.willChange`)).toBe('');
      expect(await page.evaluate(`document.querySelector('#entrance-root').style.willChange`)).toBe('');
    } finally { await page.close(); }
  });

  it.each([1, 4])('replays the Hand lift and expansion without a new path, CPU ×%s', async rate => {
    const page = await coldPage(rate);
    try {
      await page.evaluate(click('.global-tabs button:first-child'));
      await untilMotionReady(page, `document.querySelector('.hand-slot.is-filled')`);
      await waitForLayout(page.evaluate, '.hand-panel');
      const lift: MotionSample[] = [], expansion: MotionSample[] = [];
      for (let replay = 0; replay < 2; replay++) {
        expansion.push(await sampleMotion(page, '.hand-done-list', click('.hand-slot-done')));
        await page.evaluate(click('.hand-slot-done'));
        lift.push(await sampleMotion(page, '.hand-slot.is-filled .deck-card', `
          const element = document.querySelector('.hand-slot.is-filled .deck-card-space'), box = element.getBoundingClientRect();
          element.dispatchEvent(new PointerEvent('pointermove', {bubbles:true, pointerType:'mouse', clientX:box.right - 10, clientY:box.top + 10}));`));
        await page.evaluate(`document.querySelector('.hand-slot.is-filled .deck-card-space').dispatchEvent(new PointerEvent('pointerout', {bubbles:true, pointerType:'mouse'}))`);
        await waitForLayout(page.evaluate, '.hand-panel');
      }
      expectSameLanding(...lift as [MotionSample, MotionSample]);
      expectSameLanding(...expansion as [MotionSample, MotionSample]);
      for (const sample of lift) expect(motionMetrics(sample).activeMaxFrameMs).toBeLessThanOrEqual(50);
      expect(page.consoleErrors).toEqual([]);
    } finally { await page.close(); }
  }, 20000);

  it('cancels preparation on unmount and honors reduced motion on the first opening', async () => {
    const page = await coldPage(1, '&entrance');
    try {
      await page.send('Network.emulateNetworkConditions', { offline: false, latency: 350, downloadThroughput: 1_000_000, uploadThroughput: 1_000_000 });
      await page.evaluate(click('#show'));
      await untilMotionReady(page, `document.querySelector('#entrance-target')`);
      await page.evaluate(`window.removedEntrance = document.querySelector('#entrance-target'); ${click('#hide')}`);
      await untilMotionReady(page, `!document.querySelector('#entrance-target') && document.fonts.status === 'loaded'`);
      expect(await page.evaluate(`window.removedEntrance.style.willChange`)).toBe('');
      expect(await page.evaluate(`window.removedEntrance.getAnimations().some(a => a.playState === 'running')`)).toBe(false);
      await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      const sample = await sampleMotion(page, '#entrance-target', click('#show'));
      expect(sample.frames.some(frame => frame.progress !== null && frame.progress > 0 && frame.progress < 1)).toBe(false);
      expect(await page.evaluate(`document.querySelector('#entrance-target').style.willChange`)).toBe('');
      expect(page.consoleErrors).toEqual([]);
    } finally { await page.close(); }
  });

  it.each([1, 4])('keeps the first Hand drag/drop on its replay path, CPU ×%s', async rate => {
    const page = await coldPage(rate);
    try {
      await page.evaluate(click('.global-tabs button:first-child'));
      await untilMotionReady(page, `document.querySelector('.hand-slot.is-filled')`);
      await waitForLayout(page.evaluate, '.hand-panel');
      const samples: MotionSample[] = [];
      for (let replay = 0; replay < 2; replay++) {
        const sample = await sampleMotion(page, '.card-drag-face || .hand-slot [data-card-id="card:2"]', handSlotDrag, 1200);
        samples.push(sample);
        expect(await page.evaluate('window.dragSeen')).toBe(true);
        const drop = sample.frames.filter(frame => frame.progress !== null && frame.progress > 0 && frame.progress < 1);
        expect(drop.length).toBeGreaterThanOrEqual(5);
        for (const frame of drop) {
          const expected = sample.frames[0].box![0] + 30 * (1 - frame.progress!);
          expect(Math.abs(frame.box![0] - expected)).toBeLessThanOrEqual(2);
        }
        expect(motionMetrics(sample).activeMaxFrameMs).toBeLessThanOrEqual(50);
        await waitForLayout(page.evaluate, '.hand-panel');
      }
      expectSameLanding(...samples as [MotionSample, MotionSample]);
      expect(page.consoleErrors).toEqual([]);
    } finally { await page.close(); }
  }, 20000);
});
