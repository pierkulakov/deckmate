import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';

type VisionViewport = Pick<ExcalidrawImperativeAPI, 'getAppState' | 'getSceneElements' | 'scrollToContent'>;

/** 2026-11-08: saved desktop zoom does not fit a phone; wait for the loaded scene and measured canvas before fitting once. */
export function fitVisionOnOpen(api: VisionViewport): boolean {
  const { width, height, isLoading } = api.getAppState();
  if (isLoading || width <= 0 || height <= 0) return false;
  const elements = api.getSceneElements().filter(element => !element.isDeleted);
  if (width <= 760 && elements.length) {
    api.scrollToContent(elements, {
      fitToViewport: true, viewportZoomFactor: 0.9, maxZoom: 1, animate: false,
      canvasOffsets: { left: 24, right: 56, top: 80, bottom: 64 },
    });
  }
  return true;
}
