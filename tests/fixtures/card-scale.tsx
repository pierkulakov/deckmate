import { createRoot } from 'react-dom/client';
import App from '../../client/App.tsx';
import { setLang } from '../../client/i18n.ts';
import type { CatalogCard, CatalogView } from '../../src/catalog-contracts.ts';
import '../../client/styles.css';
import '../../client/motion.css';
import '../../client/card-material.css';
import '../../client/surface.css';

const query = new URLSearchParams(location.search);
setLang('ru');
document.documentElement.classList.toggle('dark', query.get('theme') !== 'light');
// 2026-11-10: exercise migration from the old width; each viewport starts without a saved v6 override.
localStorage.setItem('deckmate-left-panel-width-v5', '503');
if (!query.has('keepWidth')) localStorage.removeItem('deckmate-left-panel-width-v6');
localStorage.setItem('deckmate-timeline:sandbox:card-scale', JSON.stringify({ kind: 'run', id: 'run' }));
const titles = ['Звуки порта', 'Подготовить звуки шагов для деревянного причала', 'Проверить звук волн',
  'Описание звукового окружения', 'Музыка', 'Оченьдлинноенеразрывноерусскоеназваниекарточки', 'Без колоды'];
const markdown = 'Звуки помогают почувствовать пространство и движение. Проверяем тихие и громкие шаги.\n\n- [ ] Записать шаги\n- [x] Проверить громкость\n- [ ] Сохранить результат';
const longMarkdown = [markdown, ...Array.from({ length: 60 }, (_, index) => `Запись ${index + 1}. Слушаем шаги на причале и проверяем громкость звукового окружения.`)].join('\n\n');
const cards: CatalogCard[] = Array.from({ length: query.has('many') ? 256 : titles.length }, (_, index) => ({
  id: `card:scale-${index}`, kind: 'task', title: titles[index] ?? `Проверить звук ${index}`, path: `cards/${index}.md`, version: null,
  state: 'started', owner: 'Анна Иванова', sourceHash: `hash-${index}`, range: null,
  markdown: query.has('long') ? longMarkdown : markdown,
  deckId: index === 6 ? null : 'audio', trackIds: [], parentId: index === 1 ? 'card:scale-0' : null,
  effort: 2, priority: index < 3 ? 'medium' : 'low', tags: ['звук'], dueDate: '2026-11-15',
  handMemberIds: ['anna'], handOrder: { anna: index }, run: 'run', milestone: 'release',
}));
cards[0].kind = 'hero';
cards[3].kind = 'doc';
cards[4].kind = 'hero';
const catalog: CatalogView = {
  rootIdentity: 'card-scale', configured: true, formatLanguage: 'en', manifestHash: 'hash', optionsHash: 'hash', indexedAt: '',
  documents: [], cards, spaces: [{ id: 'space', title: 'Проект' }],
  decks: [{ id: 'audio', title: 'Аудио', kind: 'mixed', spaceId: 'space', description: 'Звуковое окружение', color: '#607d98', icon: 'box' }],
  tracks: [], warnings: [], members: [{ id: 'anna', label: 'Анна Иванова', kind: 'human', aliases: [] }],
  runs: [{ id: 'run', number: 1, goal: 'Звуки', start: '2026-11-01', end: '2026-11-20' }],
  milestones: [{ id: 'release', title: 'Выпуск', date: '2026-11-20', color: '#9258e5' }], projectTags: [], journeys: [],
};
if (query.has('journey')) {
  cards[1].journey = { journeyId: 'sound', instanceId: 'sound-run', stepId: 'record', version: 1 };
  catalog.journeys = [{ id: 'sound', title: 'Звуки причала', version: 1, deckId: 'audio', path: 'journeys/sound/index.md', fileHash: 'journey-hash',
    steps: [{ id: 'record', title: 'Записать шаги', markdown: '', deckId: 'audio', owner: null, dependsOn: [] }] }];
}
class FixtureSocket {
  onopen: (() => void) | null = null;
  constructor() { setTimeout(() => this.onopen?.(), 0); }
  close() {}
}
window.WebSocket = FixtureSocket as unknown as typeof WebSocket;
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(String(input), location.href);
  if (!url.pathname.startsWith('/api/')) return realFetch(input, init);
  if (url.pathname === '/api/snapshot') return Response.json({ projectName: 'Масштаб карточек', source: 'sandbox',
    writable: true, editMode: 'direct', token: 'test', iteration: { number: 1, goal: '', start: '' } });
  if (url.pathname === '/api/catalog') return Response.json(catalog);
  if (url.pathname === '/api/card-content') {
    const card = cards.find(item => item.id === url.searchParams.get('cardId'))!;
    return Response.json({ cardId: card.id, title: card.title, markdown: card.markdown, sourceHash: card.sourceHash });
  }
  if (url.pathname === '/api/notifications') return Response.json({ source: 'sandbox', member: null, members: [], stacks: [], total: 0, watching: [], warnings: [] });
  if (url.pathname === '/api/project-pulse') return Response.json({ inProgress: { count: 0, ownerIds: [] }, review: { count: 0, oldestSince: null, deckId: null }, accepted: { days: Array(14).fill(0), total: 0 }, run: null, withoutDeck: 1 });
  return Response.json({ files: [], events: [], nextCursor: null, warnings: [] });
};
createRoot(document.getElementById('root')!).render(<App />);
