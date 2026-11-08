import { expect, it, vi } from 'vitest';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { fitVisionOnOpen } from '../client/vision-viewport.ts';

function viewport(width: number, height = 400, isLoading = false) {
  const elements = [{ id: 'title' }, { id: 'mini' }, { id: 'smart' }, { id: 'deleted', isDeleted: true }];
  const api = {
    getAppState: () => ({ width, height, isLoading, zoom: { value: 0.65 } }),
    getSceneElements: () => elements,
    scrollToContent: vi.fn(),
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
