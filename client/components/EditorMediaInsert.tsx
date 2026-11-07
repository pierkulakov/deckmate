import { useState } from 'react';
import { defineText, useText } from '../i18n.ts';

const text = defineText({
  section: 'Insert file link',
  help: 'Files have not been uploaded. Save them next to the card and enter the path or URL of an already published file.',
  image: 'Image',
  path: (name: string) => `Path or URL: ${name}`,
  insert: 'Insert link',
  cancel: 'Cancel',
}, {
  section: 'Вставить ссылку на файл',
  help: 'Файлы не загружены. Сохраните их рядом с картой и укажите путь или адрес уже опубликованного файла.',
  image: 'Изображение',
  path: (name: string) => `Путь или URL: ${name}`,
  insert: 'Вставить ссылку',
  cancel: 'Отмена',
});

export function EditorMediaInsert({ files, disabled, onInsert, onCancel }: {
  files: File[]; disabled: boolean; onInsert: (markdown: string) => void; onCancel: () => void;
}) {
  const [paths, setPaths] = useState(() => files.map(file => `img/${file.name || 'image.png'}`));
  const t = useText(text);
  const valid = paths.every(path => path.trim() && !/[<>\r\n]/u.test(path) && !/^(?!https?:)[a-z][a-z\d+.-]*:/iu.test(path) && !path.startsWith('//'));
  return <section className="editor-media-insert" aria-label={t.section} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel(); }
    if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); }
  }}>
    <p>{t.help}</p>
    {files.map((file, index) => <label key={index}>{file.name || t.image}<input autoFocus={index === 0} value={paths[index]} disabled={disabled}
      aria-label={t.path(file.name || t.image)} onChange={event => setPaths(current => current.map((path, itemIndex) => itemIndex === index ? event.target.value : path))} /></label>)}
    <div><button type="button" disabled={disabled || !valid} onClick={() => onInsert(files.map((file, index) => {
      const label = (file.name || t.image).replace(/([\\\[\]])/gu, '\\$1');
      return `${file.type.startsWith('image/') ? '!' : ''}[${label}](<${paths[index].trim()}>)`;
    }).join('\n'))}>{t.insert}</button><button type="button" onClick={onCancel}>{t.cancel}</button></div>
  </section>;
}
