import { sanitizeBoardScene } from '../src/board-scene-safety.ts';

export type VisionSceneInput = {
  elements: readonly Record<string, unknown>[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
};

// 2026-11-10: sanitize only at trust boundaries, not on pointer events; image serialization remains deferred.
export function sanitizeVisionScene(input: VisionSceneInput) {
  return sanitizeBoardScene({ type: 'excalidraw', version: 2, ...input });
}

const unversionedElements = new WeakMap<object, number>();
let nextElementIdentity = 0;

function elementVersion(element: Record<string, unknown>): unknown {
  if (element.version !== undefined) return element.version;
  // 2026-11-10: unversioned imports still need distinct identities before Excalidraw restores their revision fields.
  if (!unversionedElements.has(element)) unversionedElements.set(element, ++nextElementIdentity);
  return unversionedElements.get(element);
}

export function visionSceneSignature({ elements, appState, files }: VisionSceneInput): string {
  return JSON.stringify({
    elements: elements.map(element => [element.id, elementVersion(element), element.versionNonce]),
    files: Object.keys(files).sort(),
    background: appState.viewBackgroundColor,
    gridSize: appState.gridSize,
    gridStep: appState.gridStep,
    gridModeEnabled: appState.gridModeEnabled,
  });
}

export function deferredVisionScene(serialize: (input: VisionSceneInput) => void) {
  let signature = '';
  let pending: VisionSceneInput | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function cancel() {
    clearTimeout(timer);
    timer = undefined;
    pending = null;
  }

  function flush() {
    const input = pending;
    cancel();
    if (input) serialize(input);
  }

  return {
    flush,
    reset(input: VisionSceneInput) { cancel(); signature = visionSceneSignature(input); },
    update(input: VisionSceneInput): boolean {
      const nextSignature = visionSceneSignature(input);
      if (nextSignature === signature) {
        if (pending) pending = input;
        return false;
      }
      signature = nextSignature;
      pending = input;
      // 2026-11-10: pointer and selection events must never repeatedly copy image data; bursts share one serialization.
      timer ??= setTimeout(flush, 32);
      return true;
    },
    get signature() { return signature; },
  };
}
