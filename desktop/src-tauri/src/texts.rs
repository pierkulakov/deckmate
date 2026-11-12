pub fn text(language: &str, key: &str) -> &'static str {
    let (en, ru) = match key {
        "file" => ("File", "Файл"),
        "openFolder" => ("Open folder…", "Открыть папку…"),
        "recentProjects" => ("Recent projects", "Недавние проекты"),
        "workspace" => ("Workspace", "Рабочее пространство"),
        "noWorkspace" => ("No projects", "Нет проектов"),
        "addCurrentToWorkspace" => (
            "Add current project to workspace",
            "Добавить текущий проект в пространство",
        ),
        "noRecent" => ("No recent projects", "Нет недавних проектов"),
        "clearRecent" => ("Clear list", "Очистить список"),
        "revealProject" => ("Reveal project folder", "Показать папку проекта"),
        "switchProject" => ("Switch project…", "Сменить проект…"),
        "closeProject" => ("Close project", "Закрыть проект"),
        "reload" => ("Reload", "Перезагрузить"),
        "wait" => ("Wait", "Подождать"),
        "startScreen" => ("Start screen", "Стартовый экран"),
        "rendererCrashedRepeatedly" => (
            "The Deckmate page crashed again. Reload it or return to the start screen?",
            "Страница Deckmate снова закрылась с ошибкой. Перезагрузить её или вернуться на стартовый экран?",
        ),
        "rendererUnresponsive" => (
            "The page is not responding. Reload it?",
            "Страница не отвечает. Перезагрузить её?",
        ),
        "unsavedChanges" => (
            "You have unsaved changes. Leave anyway?",
            "Есть несохранённые изменения. Всё равно уйти?",
        ),
        "shutdownUnsaved" => (
            "You have unsaved changes. Cancel shutdown to save your work.",
            "У вас есть несохранённые изменения. Отмените завершение работы, чтобы сохранить их.",
        ),
        "leave" => ("Leave", "Уйти"),
        "stay" => ("Stay", "Остаться"),
        "leaveCancelled" => (
            "Action cancelled to keep unsaved changes.",
            "Действие отменено, чтобы не потерять несохранённые изменения.",
        ),
        "saveFailedTitle" => ("Could not save settings", "Не удалось сохранить настройки"),
        "saveFailed" => ("Could not save settings: {error}", "Не удалось сохранить настройки: {error}"),
        "fatalTitle" => ("Deckmate could not continue", "Deckmate не может продолжить работу"),
        "fatalError" => (
            "Deckmate encountered an error and must close. Details were written to server.log.\n\n{error}",
            "Deckmate закроется из-за ошибки. Подробности записаны в server.log.\n\n{error}",
        ),
        "webviewMissing" => (
            "Microsoft Edge WebView2 Runtime is missing. Install it, then open Deckmate again:\nhttps://developer.microsoft.com/microsoft-edge/webview2/",
            "Не установлен Microsoft Edge WebView2 Runtime. Установите его и снова откройте Deckmate:\nhttps://developer.microsoft.com/microsoft-edge/webview2/",
        ),
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
            "Обновление Deckmate {version} можно установить",
        ),
        "installAndRestart" => ("Restart and update", "Перезапустить и обновить"),
        "continueUpdate" => ("Continue update", "Продолжить обновление"),
        "mcpUpdateWarning" => (
            "MCP sessions open: {count}. Postpone the update and stop the agents, or continue: their work will be interrupted.",
            "Открыто сеансов MCP: {count}. Отложите обновление и завершите работу агентов или продолжите: работа сеансов прервётся.",
        ),
        "mcpUpdateInProgress" => (
            "Deckmate is preparing or installing an update. MCP cannot start. Wait for the update to finish and reconnect.",
            "Deckmate готовит или устанавливает обновление. MCP не может запуститься. Дождитесь завершения обновления и подключитесь снова.",
        ),
        "later" => ("Later", "Позже"),
        "skipVersion" => ("Skip this version", "Пропустить эту версию"),
        "installPending" => (
            "Restart and install {version}…",
            "Перезапустить и установить {version}…",
        ),
        "upToDate" => ("You're up to date", "Установлена последняя версия"),
        "updateCheckFailed" => (
            "Could not check for updates",
            "Не удалось проверить обновления",
        ),
        "updateTooLarge" => (
            "The update download exceeds the {limit} byte safety limit.",
            "Размер загружаемого обновления превышает безопасный предел {limit} байт.",
        ),
        "updateFailed" => ("Could not install the update", "Не удалось установить обновление"),
        "installUnavailable" => (
            "Automatic installation is unavailable in this build. Download the installer from the release page.",
            "Автоматическая установка недоступна в этой сборке. Скачайте установщик со страницы выпусков.",
        ),
        "updateNotApplied" => (
            "The update to {version} was not installed",
            "Обновление до {version} не установилось",
        ),
        "openDownloads" => ("Open download page", "Открыть страницу загрузки"),
        "portableUpdates" => (
            "Deckmate {version} is available",
            "Вышла версия Deckmate {version}",
        ),
        "portableUpdatePending" => (
            "Deckmate {version} is available…",
            "Вышла версия Deckmate {version}…",
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
            "Не удалось прочитать список изменений: {error}",
        ),
        "whatsNewOpenFailed" => (
            "Could not open What's new: {error}",
            "Не удалось открыть окно «Что нового»: {error}",
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
            "Launch cancelled because another action started.",
            "Запуск отменён: началось другое действие.",
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
            "Choose a folder in the dialog, or select the current project or a recent project. The workspace holds up to 30 projects.",
            "Выберите папку в диалоге, текущий проект или проект из недавних. В рабочем пространстве может быть до 30 проектов.",
        ),
        "mcpStartFailed" => (
            "Could not start Deckmate MCP: {error}. Check the reported error and try again.",
            "Не удалось запустить Deckmate MCP: {error}. Проверьте указанную ошибку и повторите запуск.",
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
            "Could not enable WebView2 security checks. The board will not open: {error}",
            "Не удалось включить защиту WebView2. Доска не откроется: {error}",
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
        "initTimeout" => (
            "Project creation did not finish in 60 s and was stopped. Check the folder and try again.",
            "Создание проекта не завершилось за 60 с и было остановлено. Проверьте папку и повторите попытку.",
        ),
        "createFailedTitle" => ("Could not create the project", "Не удалось создать проект"),
        "initPartial" => (
            "The folder may have been created partially and has not been deleted: {path}",
            "Папка могла быть создана частично и не была удалена: {path}",
        ),
        "openInExplorer" => ("Open folder in Explorer", "Открыть папку в Проводнике"),
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
