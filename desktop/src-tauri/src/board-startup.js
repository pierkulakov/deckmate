// 2026-11-12: navigation completion precedes React's data render; observe the DOM without polling the server.
(() => {
  let scheduled = false;
  const observer = new MutationObserver(painted);
  observer.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-updated-at'] });
  document.addEventListener('visibilitychange', painted);
  // An empty or failing project never paints board data; the marker is diagnostic, so stop watching after a minute.
  const giveUp = setTimeout(stop, 60000);
  function stop() {
    scheduled = true;
    clearTimeout(giveUp);
    observer.disconnect();
    document.removeEventListener('visibilitychange', painted);
  }
  function painted() {
    if (scheduled || document.visibilityState !== 'visible') return;
    const shell = document.querySelector('.app-shell');
    const main = shell?.querySelector('.workspace-main');
    if (!(Number(shell?.dataset.updatedAt) > 0) || !main?.firstElementChild || main.querySelector('.loading-state, .error-state, .catalog-empty[role="status"]')) return;
    stop();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      performance.mark('deckmate-board-data-painted');
      console.info('deckmate:board-data-painted');
    }));
  }
  painted();
})();
