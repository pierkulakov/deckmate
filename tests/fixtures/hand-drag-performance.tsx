import { createRoot } from 'react-dom/client';
import { Hand } from '../../client/components/Hand.tsx';
import { catalogStore } from '../../client/catalog-store.ts';
import { setLang } from '../../client/i18n.ts';
import type { CatalogCard, CatalogView } from '../../src/catalog-contracts.ts';
import type { WorkspaceSnapshot } from '../../src/workspace-contracts.ts';
import '../../client/styles.css';
import '../../client/card-material.css';
import '../../client/motion.css';

const queued = new URLSearchParams(location.search).has('queue');
document.documentElement.classList.add('dark');
const cards: CatalogCard[] = Array.from({ length: queued ? 9 : 7 }, (_, index) => ({
  id: `card:hand-${index}`, kind: 'task', title: `Hand task ${index}`, path: `cards/${index}.md`, version: null,
  state: 'not-started', owner: 'Leo', markdown: 'Keep the rendered face stable during sorting.', sourceHash: `hash-${index}`,
  range: null, deckId: null, trackIds: [], parentId: null, handMemberIds: ['leo'], handOrder: { leo: index },
  run: 'run', milestone: 'milestone', dueDate: '2026-11-13',
}));
cards[0].title = 'Design the map room';
cards[1].title = 'Paint the harbor color script';
Object.assign(cards[2], { title: 'Moonwake Lantern', kind: 'hero', state: null, effort: 13 });
cards.push({ ...cards[0], id: 'card:done', title: 'Done card', state: 'done', handOrder: { leo: 100 } });
const catalog: CatalogView = {
  rootIdentity: 'hand-drag-performance', documents: [], cards, spaces: [], decks: [], tracks: [], warnings: [],
  formatLanguage: 'en', manifestHash: 'manifest', optionsHash: 'options', configured: true, indexedAt: '',
  members: [{ id: 'leo', label: 'Leo', kind: 'human', aliases: [] }],
  runs: [{ id: 'run', number: 1, goal: 'Drag', start: '2026-11-01', end: '2026-11-15' }],
  milestones: [{ id: 'milestone', title: 'Release', date: '2026-11-15', color: '#9258e5' }],
};
const snapshot: WorkspaceSnapshot & { token: string } = { projectName: 'Hand drag', source: 'sandbox', writable: true, editMode: 'direct', token: 'test-token',
  iteration: { number: 1, goal: '', start: '' } };
let dateFormats = 0;
let reorder: string[] = [];
let writes = 0;
const opened: string[] = [];
Intl.DateTimeFormat = new Proxy(Intl.DateTimeFormat, {
  construct(target, args) { dateFormats++; return Reflect.construct(target, args); },
});
// 2026-11-10: sample painted positions as well as requested transforms; a render budget alone missed gap flicker.
function recordDrag(pointerX: number) {
  const slots = [...document.querySelectorAll<HTMLElement>('.hand-slots .hand-slot.is-filled')];
  const neighbor = slots[1];
  const neighborFace = neighbor.querySelector<HTMLElement>('.deck-card-space')!;
  const origin = neighbor.offsetLeft;
  const pitch = slots[2].offsetLeft - origin;
  let phase = 'lift';
  let previousPosition = neighborFace.getBoundingClientRect().left;
  let previousSlot = 0;
  let previousClasses = neighbor.className;
  let previousTime = 0;
  let previousPointer = pointerX;
  let previousSource = (document.querySelector('.card-drag-face') ?? slots[2]).getBoundingClientRect().left;
  const pointerMove = (event: PointerEvent) => { pointerX = event.clientX; };
  document.addEventListener('pointermove', pointerMove);
  let frame = 0;
  const result = { frames: 0, changes: {} as Record<string, number>, positions: {} as Record<string, number>,
    maxNeighborStep: 0, maxDropStep: 0, emptyFrames: 0, outlinedFrames: 0, classChanges: 0,
    droppedFrames: 0, maxFrameMs: 0, longTasks: [] as number[], movingFrames: 0, maxPointerError: 0,
    maxSourceDropStep: 0, sourceDropSteps: [] as number[], dropMovingFrames: 0 };
  const neighborFaces = slots.filter((_, index) => index !== 2).map(element => {
    const face = element.querySelector<HTMLElement>('.deck-card')!;
    const style = getComputedStyle(face);
    return { element, face, border: style.borderColor, shadow: style.boxShadow };
  });
  const observer = new PerformanceObserver(list => { result.longTasks.push(...list.getEntries().map(entry => entry.duration)); });
  observer.observe({ type: 'longtask' });
  function sample(time: number) {
    const position = neighborFace.getBoundingClientRect().left;
    const source = (document.querySelector('.card-drag-face') ?? slots[2]).getBoundingClientRect().left;
    if (phase !== 'drop') result.maxPointerError = Math.max(result.maxPointerError, Math.abs(source - previousSource - (pointerX - previousPointer)));
    else {
      result.maxSourceDropStep = Math.max(result.maxSourceDropStep, Math.abs(source - previousSource));
      if (Math.abs(source - previousSource) > .1) result.sourceDropSteps.push(source - previousSource);
    }
    previousSource = source;
    previousPointer = pointerX;
    const transform = new DOMMatrixReadOnly(neighbor.style.transform || undefined);
    const slot = Math.round((neighbor.offsetLeft + transform.m41 - origin) / pitch);
    if (slot !== previousSlot) result.changes[phase] = (result.changes[phase] ?? 0) + 1;
    result.positions[phase] = slot;
    if (neighbor.className !== previousClasses) result.classChanges++;
    const step = Math.abs(position - previousPosition);
    if (phase === 'drop') result.maxDropStep = Math.max(result.maxDropStep, step);
    else result.maxNeighborStep = Math.max(result.maxNeighborStep, step);
    if (Math.abs((position - slots[0].getBoundingClientRect().left) / pitch - Math.round((position - slots[0].getBoundingClientRect().left) / pitch)) > .01) {
      result.movingFrames++;
      if (phase === 'drop') result.dropMovingFrames++;
    }
    if (neighborFaces.some(({ element, face }) => {
      const style = getComputedStyle(face);
      return !element.isConnected || face.getBoundingClientRect().width === 0 || style.visibility !== 'visible' || Number(style.opacity) < .99 || Number(getComputedStyle(element).opacity) < .99;
    })) result.emptyFrames++;
    if (phase !== 'drop' && neighborFaces.some(({ element, face, border, shadow }) => {
      const style = getComputedStyle(face);
      return getComputedStyle(element).outlineStyle !== 'none' || style.outlineStyle !== 'none' || style.borderColor !== border || style.boxShadow !== shadow;
    })) result.outlinedFrames++;
    if (previousTime) {
      const elapsed = time - previousTime;
      result.maxFrameMs = Math.max(result.maxFrameMs, elapsed);
      result.droppedFrames += Math.max(0, Math.round(elapsed / (1000 / 60)) - 1);
    }
    previousTime = time;
    previousPosition = position;
    previousSlot = slot;
    previousClasses = neighbor.className;
    result.frames++;
    frame = requestAnimationFrame(sample);
  }
  frame = requestAnimationFrame(sample);
  return { phase: (value: string) => { phase = value; result.changes[value] ??= 0; }, finish: () => {
    cancelAnimationFrame(frame);
    document.removeEventListener('pointermove', pointerMove);
    result.longTasks.push(...observer.takeRecords().map(entry => entry.duration));
    observer.disconnect();
    return result;
  } };
}
Object.assign(window, { handDragTest: { reset: () => { dateFormats = 0; }, result: () => ({ dateFormats, reorder, writes, opened }), record: recordDrag } });
window.fetch = async (input, init) => {
  const url = new URL(String(input), location.origin);
  if (url.pathname === '/api/catalog') {
    if (init?.method === 'POST') {
      const action = JSON.parse(String(init.body));
      if (action.action === 'reorder-hand') {
        writes++;
        reorder = action.cards.map((entry: { cardId: string }) => entry.cardId);
        reorder.forEach((id, index) => { cards.find(card => card.id === id)!.handOrder = { leo: index }; });
        catalog.manifestHash = 'after-drop';
      }
    }
    return Response.json(catalog);
  }
  return Response.json({ files: [], warnings: [] });
};
await catalogStore('sandbox').refresh();
setLang('en');
history.replaceState(null, '', '?view=hand&handMember=leo');
createRoot(document.getElementById('root')!).render(<Hand snapshot={snapshot} refreshKey={0} onOpenCard={id => opened.push(id)} onOpenMembers={() => {}} />);
