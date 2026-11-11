import { expect, it, vi } from 'vitest';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { fitVisionContent, fitVisionOnOpen, resetVisionZoom } from '../client/vision-viewport.ts';

function viewport(width: number, height = 400, isLoading = false) {
  const elements = [{ id: 'title' }, { id: 'mini' }, { id: 'smart' }, { id: 'deleted', isDeleted: true }];
  const api = {
    getAppState: () => ({ width, height, isLoading, zoom: { value: 0.65 }, scrollX: 30, scrollY: -20, selectedElementIds: { mini: true, deleted: true } }),
    getSceneElements: () => elements,
    scrollToContent: vi.fn(),
    updateScene: vi.fn(),
  };
  return { api, elements, canvas: api as unknown as ExcalidrawImperativeAPI };
}

it.each([375, 760])('fits all live nodes on a %ipx canvas with tool clearance instead of the saved desktop zoom', width => {
  const { api, elements, canvas } = viewport(width);
  expect(fitVisionOnOpen(canvas)).toBe(true);
  expect(api.scrollToContent).toHaveBeenCalledExactlyOnceWith(elements.slice(0, 3), {
    fitToViewport: true, viewportZoomFactor: 0.9, maxZoom: 1, animate: false,
    canvasOffsets: { left: 24, right: 56, top: 80, bottom: 64 },
  });
  expect(api.getAppState().zoom.value).toBe(0.65);
  expect(elements).toHaveLength(4);
});

it('fits only the live selection, and leaves an empty selection in place', () => {
  const { api, elements, canvas } = viewport(375);
  expect(fitVisionContent(canvas, true)).toBe(true);
  expect(api.scrollToContent.mock.calls[0][0]).toEqual([elements[1]]);
  elements.splice(1, 1);
  api.scrollToContent.mockClear();
  expect(fitVisionContent(canvas, true)).toBe(false);
  expect(api.scrollToContent).not.toHaveBeenCalled();
});

it('offers a full overview on desktop without modifying scene elements', () => {
  const { api, elements, canvas } = viewport(1440);
  expect(fitVisionContent(canvas)).toBe(true);
  expect(api.scrollToContent.mock.calls[0][0]).toEqual(elements.slice(0, 3));
  expect(api.updateScene).not.toHaveBeenCalled();
});

it('returns to 100% around the same scene point, including on an empty board', () => {
  const { api, elements, canvas } = viewport(375);
  elements.length = 0;
  const before = api.getAppState();
  resetVisionZoom(canvas);
  const after = api.updateScene.mock.calls[0][0].appState;
  expect(after.zoom.value).toBe(1);
  expect(before.width / (2 * before.zoom.value) - before.scrollX).toBeCloseTo(before.width / 2 - after.scrollX);
  expect(before.height / (2 * before.zoom.value) - before.scrollY).toBeCloseTo(before.height / 2 - after.scrollY);
  expect(api.updateScene.mock.calls[0][0]).not.toHaveProperty('elements');
});

it.each([[0, 400, false], [375, 0, false], [375, 400, true]])('waits for dimensions and the restored scene (%i × %i, loading %s)', (width, height, loading) => {
  const { api, canvas } = viewport(width, height, loading);
  expect(fitVisionOnOpen(canvas)).toBe(false);
  expect(api.scrollToContent).not.toHaveBeenCalled();
});

it('leaves desktop zoom unchanged and completes initialization without fitting', () => {
  const { api, canvas } = viewport(1010, 685);
  expect(fitVisionOnOpen(canvas)).toBe(true);
  expect(api.scrollToContent).not.toHaveBeenCalled();
});

it('does not fit an empty board or deleted-only scene when opening', () => {
  const { api, elements, canvas } = viewport(375);
  elements.splice(0, 3);
  expect(fitVisionOnOpen(canvas)).toBe(true);
  elements.length = 0;
  expect(fitVisionOnOpen(canvas)).toBe(true);
  expect(api.scrollToContent).not.toHaveBeenCalled();
});
