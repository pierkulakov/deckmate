// Bundled original deck cover illustrations.
// Picking one uploads it into the project like a user file, so the data format does not change.
import { defineText, textNow } from './i18n.ts';

const text = defineText({
  units: 'Units', vehicles: 'Vehicles', buildings: 'Buildings', technologies: 'Technologies',
  maps: 'Maps', factions: 'Factions', rules: 'Rules', 'design-notes': 'Notes', research: 'Research',
  knowledge: 'Knowledge', coding: 'Code', art: 'Art', animation: 'Animation', audio: 'Audio',
  'game-design': 'Game design', ui: 'Interface', tools: 'Tools', bugs: 'Bugs and QA', inbox: 'Inbox', marketing: 'Marketing',
  characters: 'Characters', levels: 'Levels', story: 'Story', agents: 'Agents', releases: 'Releases', ideas: 'Ideas',
}, {
  units: 'Отряды', vehicles: 'Техника', buildings: 'Постройки', technologies: 'Технологии',
  maps: 'Карты', factions: 'Фракции', rules: 'Правила', 'design-notes': 'Заметки', research: 'Разборы',
  knowledge: 'Знания', coding: 'Код', art: 'Графика', animation: 'Анимация', audio: 'Звук',
  'game-design': 'Геймдизайн', ui: 'Интерфейс', tools: 'Инструменты', bugs: 'Баги и QA', inbox: 'Inbox', marketing: 'Маркетинг',
  characters: 'Персонажи', levels: 'Уровни', story: 'Сюжет', agents: 'Агенты', releases: 'Релизы', ideas: 'Идеи',
});
const urls = import.meta.glob('../assets/deck-art/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

export interface DeckArt { id: string; title: string; tone: string; url: string }

// tone = the picture's dominant color; it becomes the deck band color so art and band match.
const catalogue: readonly { id: keyof typeof text.en; tone: string }[] = [
  { id: 'units', tone: '#8D2195' },
  { id: 'vehicles', tone: '#7D8C42' },
  { id: 'buildings', tone: '#607D98' },
  { id: 'technologies', tone: '#0C767D' },
  { id: 'maps', tone: '#D6AC66' },
  { id: 'factions', tone: '#A2173B' },
  { id: 'rules', tone: '#294D88' },
  { id: 'design-notes', tone: '#A16AD4' },
  { id: 'research', tone: '#159A71' },
  { id: 'knowledge', tone: '#204BBD' },
  { id: 'coding', tone: '#5E1F8B' },
  { id: 'art', tone: '#027D84' },
  { id: 'animation', tone: '#3575CC' },
  { id: 'audio', tone: '#CF4A21' },
  { id: 'game-design', tone: '#DFAF2C' },
  { id: 'ui', tone: '#1750F6' },
  { id: 'tools', tone: '#627D92' },
  { id: 'bugs', tone: '#CE3170' },
  { id: 'inbox', tone: '#5258B9' },
  { id: 'marketing', tone: '#BF333C' },
  { id: 'characters', tone: '#985586' },
  { id: 'levels', tone: '#3A682F' },
  { id: 'story', tone: '#6953AD' },
  { id: 'agents', tone: '#438425' },
  { id: 'releases', tone: '#865238' },
  { id: 'ideas', tone: '#D7D379' },
];

export const deckArt: readonly DeckArt[] = catalogue.flatMap(item => {
  const url = urls[`../assets/deck-art/${item.id}.webp`];
  return url ? [{ ...item, get title() { return textNow(text)[item.id]; }, url }] : [];
});
