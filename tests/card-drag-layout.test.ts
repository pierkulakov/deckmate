import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBrowserSession } from './browser-session.ts';
import { requireBrowser } from './browser-environment.ts';
import { waitForLayout } from './browser-layout.ts';

const browserPath = requireBrowser();
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// 2026-11-09: exercise pointer transfer with the real Deck and trusted CDP mouse input.
describe.skipIf(!browserPath)('card drag layout (browser)', () => {
  const session = createBrowserSession({ attempts: 200 });
  const { send, evaluate } = session;
  const until = (expression: string, attempts = 200) => session.until(`Boolean(${expression})`, attempts);
  async function move(point: { x: number; y: number }, buttons: 0 | 1) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point, button: buttons ? 'left' : 'none', buttons, pointerType: 'mouse' });
  }

  beforeAll(async () => {
    await session.open(browserPath!, { viewport: { width: 800, height: 850, scale: 1 }, extraArgs: ['--disable-features=OverlayScrollbar'] });
    await session.navigate('card-drag-layout', `Boolean(document.querySelector('.card-preview') && document.querySelector('[data-card-id="card:ferry"]'))`, 600);
    await waitForLayout(evaluate, '.card-preview, .catalog-card-group, .workspace-main');
  }, 90000);

  afterAll(async () => {
    await session.close();
  }, 20000);

  it('keeps CardPreview and every scroll ancestor stationary from High to the empty part of Low', async () => {
    const contentHeight = await evaluate(`document.querySelector('.workspace-main').scrollHeight`);
    await send('Emulation.setDeviceMetricsOverride', { width: 800, height: contentHeight + 20, deviceScaleFactor: 1, mobile: false });
    await until(`innerHeight === ${contentHeight + 20}`);
    await waitForLayout(evaluate, '.card-preview, .catalog-card-group, .workspace-main');
    const points = await evaluate(`(() => {
      const source = document.querySelector('[data-card-id="card:ferry"][data-card-transfer-enabled]').getBoundingClientRect();
      const low = document.querySelector('.catalog-card-group[aria-label="Low"]').getBoundingClientRect();
      return { start: { x: source.x + source.width / 2, y: source.y + source.height / 2 },
        end: { x: low.right - 24, y: low.bottom - 12 } };
    })()`);
    await evaluate(`(() => {
      const preview = document.querySelector('.card-preview');
      const initial = preview.getBoundingClientRect();
      const origins = [preview, document.querySelector('[data-card-id="card:ferry"]'), document.querySelector('.catalog-card-group[aria-label="Low"]')];
      const scrollers = new Set([document.scrollingElement]);
      for (const origin of origins) for (let node = origin?.parentElement; node; node = node.parentElement) scrollers.add(node);
      const scrollInitial = [...scrollers].map(element => [element, element?.scrollLeft ?? 0, element?.scrollTop ?? 0]);
      const recorder = window.dragLayoutRecorder = { maximum: 0, scrollMaximum: 0, initial: initial.toJSON(), worst: null, running: true,
        initialWorkspace: { width: document.querySelector('.workspace-main').clientWidth, gutter: getComputedStyle(document.querySelector('.workspace-main')).scrollbarGutter } };
      const sample = () => {
        if (!recorder.running) return;
        const box = preview.getBoundingClientRect();
        for (const key of ['left', 'top', 'width', 'height']) {
          const delta = Math.abs(box[key] - initial[key]);
          if (delta > recorder.maximum) { recorder.maximum = delta; recorder.worst = { key, before: initial[key], after: box[key] }; }
        }
        for (const [element, left, top] of scrollInitial) {
          if (!element) continue;
          recorder.scrollMaximum = Math.max(recorder.scrollMaximum, Math.abs(element.scrollLeft - left), Math.abs(element.scrollTop - top));
        }
        requestAnimationFrame(sample);
      };
      sample();
    })()`);
    await move(points.start, 0);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...points.start, button: 'left', buttons: 1, clickCount: 1, pointerType: 'mouse' });
    for (let step = 1; step <= 16; step++) {
      await move({ x: points.start.x + (points.end.x - points.start.x) * step / 16,
        y: points.start.y + (points.end.y - points.start.y) * step / 16 }, 1);
      await delay(25);
    }
    await until(`document.querySelector('.catalog-card-group[aria-label="Low"]').classList.contains('is-drop-over')`);
    await waitForLayout(evaluate, '.card-preview, .catalog-card-group');
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...points.end, button: 'left', buttons: 0, clickCount: 1, pointerType: 'mouse' });
    await until(`document.querySelector('.catalog-card-group[aria-label="Low"] [data-card-id="card:ferry"]')`);
    await until(`!document.querySelector('.is-drop-over, .is-dragging')`);
    await waitForLayout(evaluate, '.card-preview, .catalog-card-group, .workspace-main');
    const result = await evaluate(`(() => { const recorder = window.dragLayoutRecorder; recorder.running = false;
      return { maximum: recorder.maximum, scrollMaximum: recorder.scrollMaximum, initial: recorder.initial, initialWorkspace: recorder.initialWorkspace, worst: recorder.worst,
        final: document.querySelector('.card-preview').getBoundingClientRect().toJSON(),
        workspace: { width: document.querySelector('.workspace-main').clientWidth, scrollWidth: document.querySelector('.workspace-main').scrollWidth,
          height: document.querySelector('.workspace-main').clientHeight, scrollHeight: document.querySelector('.workspace-main').scrollHeight } }; })()`);
    expect(result.workspace.scrollHeight, JSON.stringify(result)).toBeGreaterThan(result.workspace.height);
    expect(result.scrollMaximum, JSON.stringify(result)).toBeLessThanOrEqual(1);
    expect(result.maximum, JSON.stringify(result)).toBeLessThanOrEqual(1);
  }, 20000);
});
