import { afterEach, expect, it, vi } from 'vitest';
import { deferredVisionScene, visionSceneSignature, type VisionSceneInput } from '../client/vision-scene.ts';

function scene(): VisionSceneInput {
  return {
    elements: Array.from({ length: 10 }, (_, index) => ({ id: `element-${index}`, version: 1, versionNonce: index, x: index })),
    appState: { viewBackgroundColor: '#ffffff', gridSize: null, selectedElementIds: {} },
    files: { a: { dataURL: 'image-a' }, b: { dataURL: 'image-b' }, c: { dataURL: 'image-c' } },
  };
}

afterEach(() => vi.useRealTimers());

it('tracks element revisions, order, file IDs, background and grid, but not pointer or selection state', () => {
  const input = scene();
  const signature = visionSceneSignature(input);
  const different = (next: VisionSceneInput) => expect(visionSceneSignature(next)).not.toBe(signature);
  different({ ...input, elements: input.elements.map((element, index) => index ? element : { ...element, version: 2 }) });
  different({ ...input, elements: input.elements.map((element, index) => index ? element : { ...element, versionNonce: 100 }) });
  different({ ...input, elements: [...input.elements].reverse() });
  different({ ...input, files: { ...input.files, d: {} } });
  different({ ...input, files: { a: input.files.a, b: input.files.b } });
  different({ ...input, appState: { ...input.appState, viewBackgroundColor: '#000000' } });
  different({ ...input, appState: { ...input.appState, gridSize: 20 } });
  different({ ...input, appState: { ...input.appState, gridStep: 10 } });
  different({ ...input, appState: { ...input.appState, gridModeEnabled: true } });
  expect(visionSceneSignature({ ...input, appState: { ...input.appState, cursorX: 100, selectedElementIds: { 'element-1': true }, scrollX: 80, zoom: { value: 2 } } })).toBe(signature);
  expect(visionSceneSignature({ ...input, files: { c: {}, b: {}, a: {} } })).toBe(signature);
});

it('never reads image payloads when computing the signature', () => {
  const input = scene();
  input.files = { a: Object.defineProperty({}, 'dataURL', { get() { throw new Error('base64 read'); } }) };
  expect(() => visionSceneSignature(input)).not.toThrow();
});

it('coalesces changed scenes and forces the latest complete input before saving', () => {
  vi.useFakeTimers();
  const serialize = vi.fn();
  const deferred = deferredVisionScene(serialize);
  const input = scene();
  deferred.reset(input);
  for (let version = 2; version <= 1001; version++) {
    deferred.update({ ...input, elements: [{ ...input.elements[0], version }] });
  }
  expect(serialize).not.toHaveBeenCalled();
  deferred.flush();
  expect(serialize).toHaveBeenCalledExactlyOnceWith({ ...input, elements: [{ ...input.elements[0], version: 1001 }] });
  vi.runAllTimers();
  expect(serialize).toHaveBeenCalledTimes(1);
});

it('flushes once after the debounce and discards a pending draft when another scene is displayed', () => {
  vi.useFakeTimers();
  const serialize = vi.fn();
  const deferred = deferredVisionScene(serialize);
  const input = scene();
  deferred.reset(input);
  deferred.update({ ...input, elements: [] });
  vi.advanceTimersByTime(32);
  expect(serialize).toHaveBeenCalledTimes(1);
  deferred.update(input);
  deferred.reset(input);
  vi.runAllTimers();
  deferred.flush();
  expect(serialize).toHaveBeenCalledTimes(1);
});
