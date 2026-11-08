// 2026-11-08: runs before first paint so the launcher never flashes the wrong surface; CSP forbids inline scripts.
try { if (localStorage.getItem('deckmate-theme') === 'light') document.documentElement.classList.remove('dark'); } catch {}
