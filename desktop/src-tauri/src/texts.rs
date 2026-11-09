pub fn text(language: &str, key: &str) -> &'static str {
    let (en, ru) = match key {
        "file" => ("File", "Файл"),
        "openFolder" => ("Open folder…", "Открыть папку…"),
        "recentProjects" => ("Recent projects", "Недавние проекты"),
        "workspace" => ("Workspace", "Рабочее пространство"),
        "noWorkspace" => ("No workspace projects", "В рабочем пространстве нет проектов"),
        "addCurrentToWorkspace" => (
            "Add current project to workspace",
            "Добавить текущий проект в рабочее пространство",
        ),
        "noRecent" => ("No recent projects", "Нет недавних проектов"),
        "clearRecent" => ("Clear recent", "Очистить список"),
        "revealProject" => ("Reveal project folder", "Показать папку проекта"),
        "switchProject" => ("Switch project", "Сменить проект"),
        "closeProject" => ("Close project", "Закрыть проект"),
        "reload" => ("Reload", "Перезагрузить"),
        "toggleDevTools" => ("Toggle DevTools", "Инструменты разработчика"),
        "quit" => ("Quit", "Выход"),
        "edit" => ("Edit", "Правка"),
        "undo" => ("Undo", "Отменить"),
        "redo" => ("Redo", "Повторить"),
        "cut" => ("Cut", "Вырезать"),
        "copy" => ("Copy", "Копировать"),
        "paste" => ("Paste", "Вставить"),
        "selectAll" => ("Select all", "Выделить всё"),
        "view" => ("View", "Вид"),
        "zoomIn" => ("Zoom in", "Увеличить"),
        "zoomOut" => ("Zoom out", "Уменьшить"),
        "actualSize" => ("Actual size", "Исходный размер"),
        "toggleFullScreen" => ("Toggle full screen", "Полноэкранный режим"),
        "help" => ("Help", "Справка"),
        "openLogs" => ("Open logs folder", "Открыть папку журналов"),
        "checkUpdates" => ("Check for updates…", "Проверить обновления…"),
        "autoCheckUpdates" => (
            "Check for updates automatically",
            "Проверять обновления автоматически",
        ),
        "updateReady" => (
            "Deckmate {version} is ready to install",
            "Deckmate {version} готов к установке",
        ),
        "installAndRestart" => ("Restart and update", "Перезапустить и обновить"),
        "later" => ("Later", "Позже"),
        "skipVersion" => ("Skip this version", "Пропустить эту версию"),
        "installPending" => (
            "Restart and install {version}",
            "Перезапустить и установить {version}",
        ),
        "upToDate" => ("You're up to date", "Установлена последняя версия"),
        "updateCheckFailed" => (
            "Could not check for updates",
            "Не удалось проверить обновления",
        ),
        "updateFailed" => ("Could not install the update", "Не удалось установить обновление"),
        "updateNotApplied" => (
            "The update to {version} was not installed",
            "Обновление до {version} не установилось",
        ),
        "openDownloads" => ("Open download page", "Открыть страницу загрузки"),
        "portableUpdates" => (
            "Deckmate {version} is available",
            "Вышла версия Deckmate {version}",
        ),
        "updateFixes" => ("Fixed: {count}", "Исправлено: {count}"),
        "updateMore" => ("More changes: {count}", "Другие изменения: {count}"),
        "whatsNew" => ("What's new", "Что нового"),
        "whatsNewTitle" => ("What's new in Deckmate", "Что нового в Deckmate"),
        "whatsNewOnly" => (
            "Only the bundled What's new window may call this.",
            "Вызов доступен только встроенному окну «Что нового».",
        ),
        "whatsNewFailed" => (
            "Could not read the changelog: {error}",
            "Не удалось прочитать журнал изменений: {error}",
        ),
        "about" => ("About Deckmate", "О программе Deckmate"),
        "ok" => ("OK", "ОК"),
        "openFailed" => ("Cannot open the project", "Не удалось открыть проект"),
        "absolutePath" => (
            "An absolute folder path is required.",
            "Требуется абсолютный путь к папке.",
        ),
        "networkPath" => (
            "Network and device paths can be opened only through the folder dialog.",
            "Сетевые пути и пути устройств можно открыть только через диалог выбора папки.",
        ),
        "missing" => ("Folder not found: {path}", "Папка не найдена: {path}"),
        "notEmpty" => (
            "The folder must be empty or not exist yet: {path}",
            "Папка должна быть пустой или ещё не существовать: {path}",
        ),
        "unreadable" => (
            "Cannot read the folder: {path}",
            "Не удалось прочитать папку: {path}",
        ),
        "superseded" => (
            "Another action replaced this launch.",
            "Запуск заменён другим действием.",
        ),
        "closed" => ("The window was closed.", "Окно было закрыто."),
        "language" => (
            "Language must be \"en\" or \"ru\".",
            "Язык должен быть \"en\" или \"ru\".",
        ),
        "launcherOnly" => (
            "Only the launcher may call this.",
            "Вызов доступен только стартовому экрану.",
        ),
        "boardOnly" => (
            "Only the main board frame of the current project may call this.",
            "Вызов доступен только основной странице доски текущего проекта.",
        ),
        "notRecent" => (
            "The project is not in the recent list.",
            "Проекта нет в списке недавних.",
        ),
        "notListed" => (
            "Only a workspace or recent project may be opened from the board.",
            "С доски можно открыть только проект рабочего пространства или недавний проект.",
        ),
        "notInWorkspace" => (
            "The project is not in the workspace.",
            "Проекта нет в рабочем пространстве.",
        ),
        "cancelled" => ("Folder selection was cancelled.", "Выбор папки отменён."),
        "workspacePath" => (
            "Choose a folder through the dialog, the current project or recent projects. The workspace holds up to 30 projects.",
            "Выберите папку через диалог, текущий проект или недавние проекты. Рабочее пространство вмещает до 30 проектов.",
        ),
        "serverExit" => (
            "Server exited with code {code}.",
            "Сервер завершился с кодом {code}.",
        ),
        "serverStopped" => (
            "The Deckmate server stopped (code {code}).",
            "Сервер Deckmate остановился (код {code}).",
        ),
        "timeout" => (
            "Server did not start in 20 s.",
            "Сервер не запустился за 20 с.",
        ),
        "loadTimeout" => (
            "The board did not finish loading in 20 s.",
            "Доска не загрузилась за 20 с.",
        ),
        "loadFailed" => (
            "Could not load the board (WebView2 error {code}).",
            "Не удалось загрузить доску (ошибка WebView2 {code}).",
        ),
        "guardsFailed" => (
            "Could not install WebView2 security guards; the board will not open: {error}",
            "Не удалось установить защиту WebView2; доска не будет открыта: {error}",
        ),
        "launcherTimeout" => (
            "The start screen did not finish loading. Reload the window to try again.",
            "Стартовый экран не загрузился. Перезагрузите окно, чтобы повторить попытку.",
        ),
        "launcherFailed" => (
            "Could not load the start screen (WebView2 error {code}). Reload the window to try again.",
            "Не удалось загрузить стартовый экран (ошибка WebView2 {code}). Перезагрузите окно, чтобы повторить попытку.",
        ),
        "initFailed" => (
            "Project initialization exited with code {code}.",
            "Создание проекта завершилось с кодом {code}.",
        ),
        _ => ("Deckmate", "Deckmate"),
    };
    if language == "ru" {
        ru
    } else {
        en
    }
}

pub fn format(
    language: &str,
    key: &str,
    placeholder: &str,
    value: impl std::fmt::Display,
) -> String {
    text(language, key).replace(&format!("{{{placeholder}}}"), &value.to_string())
}
