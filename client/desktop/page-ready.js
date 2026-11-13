(() => {
  'use strict';
  const root = document.documentElement;
  root.setAttribute('data-paint-pending', '');
  let resolvePaint;
  window.deckmatePageReady = new Promise(resolve => { resolvePaint = resolve; });
  let preparing;
  window.prepareDeckmatePage = () => preparing ??= (async () => {
    // 2026-11-13: CSS backgrounds need decoding too; load/DOMContentLoaded do not promise usable pixels or final font metrics.
    const images = new Set();
    for (const element of document.querySelectorAll('.cover-art, .fan-card')) {
      if (!element.getClientRects().length) continue;
      for (const match of getComputedStyle(element).backgroundImage.matchAll(/url\(["']?(.*?)["']?\)/g)) images.add(match[1]);
    }
    document.body.getBoundingClientRect();
    await Promise.allSettled([
      // 2026-11-13: FontFace.loaded waits for decoding, without FontFaceSet.ready's extra hidden-window layout cycle.
      ...[...document.fonts].filter(face => face.status === 'loading').map(face => face.loaded),
      ...[...images].map(src => { const image = new Image(); image.src = src; return image.decode(); }),
    ]);
    root.removeAttribute('data-paint-pending');
    // 2026-11-13: final metrics are prepared before native show; waiting for a hidden WebView's animation clock adds startup latency.
    document.body.getBoundingClientRect();
    performance.mark('deckmate-local-page-prepared');
    resolvePaint(true);
  })();
})();
