import type { ExcalidrawImperativeAPI, NormalizedZoomValue } from '@excalidraw/excalidraw/types';

type VisionViewport = Pick<ExcalidrawImperativeAPI, 'getAppState' | 'getSceneElements' | 'scrollToContent'>;

export function fitVisionContent(api: VisionViewport, selectionOnly = false): boolean {
  const { width, height, isLoading, selectedElementIds } = api.getAppState();
  if (isLoading || width <= 0 || height <= 0) return false;
  const elements = api.getSceneElements().filter(element => !element.isDeleted && (!selectionOnly || selectedElementIds[element.id]));
  if (!elements.length) return false;
  api.scrollToContent(elements, {
    fitToViewport: true, viewportZoomFactor: 0.9, maxZoom: 1, animate: false,
    canvasOffsets: { left: 24, right: 56, top: 80, bottom: 64 },
  });
  return true;
}

/** 2026-11-11: keep the scene point at the viewport centre stable when returning to reading size. */
export function resetVisionZoom(api: Pick<ExcalidrawImperativeAPI, 'getAppState' | 'updateScene'>): void {
  const { width, height, zoom, scrollX, scrollY, isLoading } = api.getAppState();
  if (isLoading || width <= 0 || height <= 0) return;
  api.updateScene({ appState: { zoom: { value: 1 as NormalizedZoomValue },
    scrollX: scrollX + width / 2 - width / (2 * zoom.value),
    scrollY: scrollY + height / 2 - height / (2 * zoom.value) } });
}

/** 2026-11-08: saved desktop zoom does not fit a phone; wait for the loaded scene and measured canvas before fitting once. */
export function fitVisionOnOpen(api: VisionViewport): boolean {
  const { width, height, isLoading } = api.getAppState();
  if (isLoading || width <= 0 || height <= 0) return false;
  if (width <= 760) fitVisionContent(api);
  return true;
}
