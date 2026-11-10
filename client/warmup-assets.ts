import type { WarmupQueue } from './first-screen-warmup.ts';

// 2026-11-10: variable faces cover their entire weight range, but unicode subsets and the two fixed Geist faces
// are separate resources. Loading only the initial Latin sans face leaves the first editor/picker changing fonts.
const interfaceFonts = [
  ...[400, 500, 600, 700].map(weight => ({ font: `${weight} 14px "Source Sans 3"`, sample: 'Deckmate Карточка' })),
  ...[400, 500].map(weight => ({ font: `${weight} 14px "Geist Mono"`, sample: '0123456789' })),
  ...[400, 500, 600].map(weight => ({ font: `${weight} 14px "Roboto Mono Variable"`, sample: 'Markdown Карточка' })),
];

export function warmInterfaceFonts(queue: WarmupQueue) {
  for (const { font, sample } of interfaceFonts) queue.add({
    key: 'font:' + font, priority: 0,
    run: () => document.fonts.load(font, sample),
  });
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
