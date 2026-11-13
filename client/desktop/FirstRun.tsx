import { defineText } from '../i18n.ts';
import { ReservedText } from '../ReservedText.tsx';

const text = defineText({
  title: 'Start with a project',
  intro: 'Keep tasks, design notes and team work together, in files you can read and edit outside Deckmate.',
  folder: 'Choose an empty folder with “Create project”.',
  demo: 'Explore the demo: decks group cards, cards describe the work.',
  work: 'Open a card to edit it, or add your first task in a deck.',
  templateTitle: 'Want a project template?',
  templateHelp: 'On the board, open the project menu → Start from template. Choose Games (Platformer, RPG, Strategy and more) or Software (Web app, CLI tool and more), preview the structure and choose whether to add sample cards. Creating here always starts with the demo.',
}, {
  title: 'Начните с проекта',
  intro: 'Задачи, заметки о дизайне и работа команды — в файлах, которые можно читать и менять без Deckmate.',
  folder: 'Нажмите «Создать проект» и выберите пустую папку.',
  demo: 'Изучите демо: колоды объединяют карточки, карточки описывают работу.',
  work: 'Откройте карточку для редактирования или добавьте в колоду свою первую задачу.',
  templateTitle: 'Нужен шаблон проекта?',
  templateHelp: 'На доске откройте меню проекта → «Начать с шаблона». Выберите «Игры» (платформер, RPG, стратегия и другие) или «Софт» (веб-приложение, CLI-инструмент и другие), посмотрите структуру и решите, добавлять ли примеры карточек. Здесь всегда создаётся демо-проект.',
});

export function FirstRun({ hidden }: { hidden: boolean }) {
  const label = (key: keyof typeof text.en) => <ReservedText values={{ en: text.en[key], ru: text.ru[key] }} />;
  return <section className="welcome" id="welcome" aria-labelledby="welcome-heading" hidden={hidden}>
    <h2 id="welcome-heading">{label('title')}</h2><p>{label('intro')}</p>
    <ol className="next-steps">{(['folder', 'demo', 'work'] as const).map(key => <li key={key}>{label(key)}</li>)}</ol>
    <details className="template-help"><summary>{label('templateTitle')}</summary><p>{label('templateHelp')}</p></details>
  </section>;
}
