import { defineText, type Lang } from '../src/i18n.ts';

const text = defineText({
  'not-empty': 'The folder is not empty. Choose a new or empty folder, or use “Open folder” to open its existing files.',
  missing: 'The folder was not found. Reconnect the drive or network, or choose its new location with “Open folder”.',
  'invalid-path': 'This path is not available. Choose a readable folder in the folder dialog (required for network folders). If the path is too long, try a shorter location.',
  'not-in-workspace': 'That project is no longer in the workspace. Add it again with “Add project”.',
  'workspace-full': 'The workspace holds up to 30 projects. Remove one to add another.',
  'not-recent': 'That project is no longer in the recent list. Select it with “Open folder”.',
  forbidden: 'This action is not allowed from this window. Return to the start screen and try again.',
  'start-failed': 'The local server could not start. Try again; if it fails again, open Help → Open logs folder.',
  'create-failed': 'The project could not be created. Check write access and free disk space, then choose an empty folder. Some files may have been created; check them before retrying.',
  timeout: 'The server did not respond within 20 seconds. Reconnect the drive if needed, then try again or open another project.',
  'load-failed': 'The project window could not load. Try opening it again. If this repeats, open Help → Open logs folder.',
  'save-failed': 'Settings could not be saved. Check free disk space and access to the Deckmate settings folder, then repeat the action. Project files were not deleted.',
  'invalid-language': 'Choose English or Russian.',
  'invalid-theme': 'Choose a light, dark or system theme.',
  cancelled: 'Action cancelled.',
  superseded: 'Another project is being opened.',
  closed: 'Deckmate is closing.',
  unknown: 'The action could not be completed. Try again or choose another folder. Technical details may help diagnose the problem.',
}, {
  'not-empty': 'Папка не пуста. Выберите новую или пустую папку либо нажмите «Открыть папку», чтобы открыть существующие файлы.',
  missing: 'Папка не найдена. Подключите диск или сеть либо выберите её новое расположение через «Открыть папку».',
  'invalid-path': 'Этот путь недоступен. Выберите папку с доступом на чтение через диалог (для сетевых папок это обязательно). Если путь слишком длинный, попробуйте более короткий.',
  'not-in-workspace': 'Этого проекта больше нет в рабочем пространстве. Добавьте его заново через «Добавить проект».',
  'workspace-full': 'В пространстве может быть до 30 проектов. Уберите один, чтобы добавить другой.',
  'not-recent': 'Этого проекта больше нет в списке недавних. Выберите его через «Открыть папку».',
  forbidden: 'Это действие недоступно из текущего окна. Вернитесь на стартовый экран и повторите попытку.',
  'start-failed': 'Не удалось запустить локальный сервер. Повторите попытку; если ошибка повторится, откройте «Справка → Открыть папку журналов».',
  'create-failed': 'Не удалось создать проект. Проверьте права на запись и свободное место, затем выберите пустую папку. Часть файлов могла быть создана — проверьте их перед повтором.',
  timeout: 'Сервер не ответил за 20 секунд. При необходимости подключите диск, затем повторите попытку или откройте другой проект.',
  'load-failed': 'Не удалось загрузить окно проекта. Откройте его ещё раз. Если ошибка повторится, откройте «Справка → Открыть папку журналов».',
  'save-failed': 'Не удалось сохранить настройки. Проверьте свободное место и доступ к папке настроек Deckmate, затем повторите действие. Файлы проекта не удалены.',
  'invalid-language': 'Выберите английский или русский язык.',
  'invalid-theme': 'Выберите светлую, тёмную или системную тему.',
  cancelled: 'Действие отменено.',
  superseded: 'Открывается другой проект.',
  closed: 'Deckmate закрывается.',
  unknown: 'Не удалось выполнить действие. Повторите попытку или выберите другую папку. Технические подробности помогут выяснить причину.',
});

export function desktopErrorText(code: string | undefined, lang: Lang, fallback = text[lang].unknown): string {
  return code && code !== 'unknown' && Object.hasOwn(text[lang], code) ? text[lang][code as keyof typeof text.en] : fallback;
}
