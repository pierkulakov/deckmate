import { defineText } from '../i18n.ts';

export const shortcutsHelpText = defineText({
  hint: 'See currently available shortcuts',
  show: 'See shortcuts',
  title: 'Available shortcuts',
  close: 'Close',
  description: 'Deckmate shortcuts for the current screen. Open this menu on another screen to see more shortcuts.',
  license: 'AGPL-3.0',
  sourceCode: 'Source code',
  canvasHelp: (key: string) => `The Vision canvas has its own shortcuts: focus the canvas and press ${key} for its help.`,
  desktopPalette: (palette: string, project: string) => `Canvas command palette: ${palette}. In the app, ${project} switches projects.`,
  desktopZoom: (plus: string, minus: string, zero: string, wheel: string) => `In the app, ${plus}, ${minus} and ${zero} zoom the whole window. Zoom the canvas with ${wheel} or its zoom buttons.`,
  arrows: 'Arrows', space: 'Space', selectAllKeys: 'Ctrl/Cmd+A',
  wheelKeys: 'Ctrl+mouse wheel',
}, {
  hint: 'Посмотреть доступные комбинации клавиш',
  show: 'Комбинации клавиш',
  title: 'Доступные комбинации клавиш',
  close: 'Закрыть',
  description: 'Комбинации клавиш Deckmate для текущего экрана. Откройте меню на другом экране, чтобы увидеть больше.',
  license: 'Лицензия AGPL-3.0',
  sourceCode: 'Исходный код',
  canvasHelp: (key: string) => `У холста Vision своя справка по клавишам: поставьте фокус на холст и нажмите ${key}.`,
  desktopPalette: (palette: string, project: string) => `Палитра команд холста — ${palette}. В приложении ${project} переключает проекты.`,
  desktopZoom: (plus: string, minus: string, zero: string, wheel: string) => `В приложении ${plus}, ${minus} и ${zero} меняют масштаб всего окна. Масштаб холста — ${wheel} или кнопки масштаба.`,
  arrows: 'Стрелки', space: 'Пробел', selectAllKeys: 'Ctrl/Cmd+A',
  wheelKeys: 'колесо с Ctrl',
});
