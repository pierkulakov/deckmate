import type { WarmupQueue } from './first-screen-warmup.ts';

// 2026-11-12: the editor face is loaded by the editor, not by the gallery's idle work.
const interfaceFonts = [
  ...[400, 500, 600, 700].map(weight => ({ font: `${weight} 14px "Source Sans 3"`, sample: 'Deckmate Карточка' })),
  ...[400, 500].map(weight => ({ font: `${weight} 14px "Geist Mono"`, sample: '0123456789' })),
];

export function loadInterfaceFonts() {
  // 2026-11-13: first-screen text needs every UI face together; a failed face must still allow the error/retry UI.
  return Promise.allSettled(interfaceFonts.map(({ font, sample }) => document.fonts.load(font, sample)));
}

export function warmVisibleImages(queue: WarmupQueue) {
  const scheduled = new Set<string>();
  for (const image of document.images) {
    const url = image.currentSrc || image.src;
    if (!url || scheduled.has(url) || new URL(url, location.href).origin !== location.origin) continue;
    const box = image.getBoundingClientRect();
    if (!box.width || !box.height || box.bottom < -300 || box.top > innerHeight + 600) continue;
    scheduled.add(url);
    queue.add({
      key: 'image:' + url, priority: 1,
      run: async signal => {
        if (signal.aborted || !image.isConnected) return;
        image.decoding = 'async';
        // 2026-11-10: decoding the actual element also covers responsive currentSrc without another request.
        await image.decode();
      },
    });
  }
}
