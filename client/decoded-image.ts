// 2026-11-13: retain a bounded set of decoded resources so virtualized tiles can reappear without another reveal.
const decoded = new Map<string, HTMLImageElement>();
const loading = new Map<string, Promise<HTMLImageElement>>();
const capacity = 128;

function imageKey(src: string): string {
  return typeof document !== 'undefined' && document.baseURI ? new URL(src, document.baseURI).href : src;
}

export function decodedImage(src: string): HTMLImageElement | undefined {
  return decoded.get(imageKey(src));
}

export function loadDecodedImage(src: string): Promise<HTMLImageElement> {
  const ready = decodedImage(src);
  if (ready) return Promise.resolve(ready);
  const key = imageKey(src);
  let pending = loading.get(key);
  if (!pending) {
    // 2026-11-13: keep detached resources, not React-owned DOM nodes that retain an unmounted component tree.
    const image = new Image();
    image.decoding = 'async';
    image.src = src;
    pending = image.decode().then(() => {
      if (!image.naturalWidth) throw new Error('Empty image');
      decoded.set(key, image);
      if (decoded.size > capacity) decoded.delete(decoded.keys().next().value!);
      return image;
    }).finally(() => loading.delete(key));
    loading.set(key, pending);
  }
  return pending;
}
