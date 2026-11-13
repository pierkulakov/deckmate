import './shell-ui.tsx';
import { convertToExcalidrawElements } from '@excalidraw/excalidraw';
import type { CatalogView } from '../../src/catalog-contracts.ts';

// 2026-11-13: the real shell and scrollable data expose locale reflow that empty views cannot exercise.
const originalFetch = window.fetch;
const today = new Date().toISOString().slice(0, 10);
const board = { id: 'layout', title: 'Board', hash: 'board-hash', path: 'boards/layout.excalidraw',
  linkedCardIds: ['card:layout-0'], updatedAt: '', access: 'editable', warnings: [],
  scene: { type: 'excalidraw', version: 2, elements: convertToExcalidrawElements([
    { id: 'linked', type: 'rectangle', x: 0, y: 0, width: 280, height: 110, link: 'deckmate://card/card:layout-0',
      customData: { deckmateCardId: 'card:layout-0', deckmateCardView: 'mini' } },
  ], { regenerateIds: false }).map(element => ({ ...element, type: 'embeddable' })), appState: {}, files: {} } };
window.fetch = async (input, init) => {
  const pathname = new URL(String(input), location.href).pathname;
  if (pathname === '/api/catalog' && !init?.method) {
    const response = await originalFetch(input, init);
    const catalog = await response.json() as CatalogView;
    return Response.json({ ...catalog,
      spaces: Array.from({ length: 6 }, (_, index) => ({ id: `space-${index}`, title: `Space ${index}` })),
      decks: Array.from({ length: 24 }, (_, index) => ({ ...catalog.decks[0], id: index ? `deck-${index}` : 'tasks',
        title: `Deck ${index}`, spaceId: `space-${Math.floor(index / 4)}` })),
      cards: Array.from({ length: 240 }, (_, index) => ({ ...catalog.cards[index % catalog.cards.length],
        id: `card:layout-${index}`, title: `Task ${index}`, owner: 'Maya', bookmarked: true,
        handMemberIds: index < 10 ? ['maya'] : [], handOrder: { maya: index }, run: 'run', dueDate: today })),
      members: [{ id: 'maya', label: 'Maya', kind: 'human', aliases: [] }],
      runs: [{ id: 'run', number: 1, goal: 'Release', start: today, end: today }],
      milestones: [{ id: 'milestone', title: 'Release', date: today, color: '#9258e5' }],
    } satisfies CatalogView);
  }
  if (pathname === '/api/boards/layout') return Response.json(board);
  if (pathname === '/api/boards') return Response.json([board]);
  if (pathname === '/api/project-pulse') return Response.json({
    inProgress: { count: 12, ownerIds: ['maya'] }, review: { count: 3, oldestSince: today, deckId: 'tasks' },
    accepted: { days: Array(14).fill(1), total: 14 },
    run: { id: 'run', title: 'Run 1 · Release', end: today, total: 24, done: 6 }, withoutDeck: 0,
  });
  return originalFetch(input, init);
};
localStorage.setItem('deckmate-current-member', 'maya');
localStorage.setItem('deckmate-vision-board-sandbox', 'layout');
