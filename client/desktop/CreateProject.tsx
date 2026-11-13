import { useLayoutEffect, useRef } from 'react';
import { defineText } from '../i18n.ts';
import { moveFocus } from '../focus.ts';
import { ReservedText } from '../ReservedText.tsx';

const text = defineText({
  title: 'Create a demo project', summary: 'Deckmate will add example Markdown files and open the board in this folder:',
  next: 'The folder must be new or empty. Start by opening a sample card; project templates and their optional samples are available later in the board’s project menu.',
  confirm: 'Create and open', back: 'Back',
}, {
  title: 'Создание демо-проекта', summary: 'Deckmate добавит примеры Markdown-файлов и откроет доску в этой папке:',
  next: 'Нужна новая или пустая папка. Начните с открытия примера карточки; шаблоны проектов и их необязательные примеры доступны затем в меню проекта на доске.',
  confirm: 'Создать и открыть', back: 'Назад',
});

export function CreateProject({ folder, busy, onConfirm, onBack }: {
  folder: string | null; busy: boolean; onConfirm(): void; onBack(): void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => { if (folder) moveFocus(heading.current); }, [folder]);
  const label = (key: keyof typeof text.en) => <ReservedText values={{ en: text.en[key], ru: text.ru[key] }} />;
  return <section className="create-panel" id="create-panel" aria-labelledby="create-heading" hidden={!folder}
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onBack(); } }}>
    <h2 ref={heading} id="create-heading" tabIndex={-1}>{label('title')}</h2>
    <p>{label('summary')}</p><p className="chosen-folder" id="create-folder" dir="auto">{folder}</p><p>{label('next')}</p>
    <div className="create-actions">
      <button type="button" className="button button-primary" id="create-confirm" disabled={busy} onClick={onConfirm}>{label('confirm')}</button>
      <button type="button" className="button button-secondary" id="create-back" onClick={onBack}>{label('back')}</button>
    </div>
  </section>;
}
