use crate::{
    app::{self, Shell},
    paths,
    server::Failure,
    settings::{Language, Theme},
    window, workspace,
};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

fn authorize(shell: &Shell, window: &WebviewWindow, board: bool) -> Result<(), Failure> {
    let allowed = window.label() == "main"
        && window.url().is_ok_and(|url| {
            if board {
                window::is_server_url(shell, &url)
            } else {
                window::is_launcher_url(&url)
            }
        });
    if allowed {
        Ok(())
    } else {
        Err(shell.failure(
            "forbidden",
            if board { "boardOnly" } else { "launcherOnly" },
        ))
    }
}

pub async fn choose_folder(app: &AppHandle) -> Option<String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let mut dialog = app.dialog().file();
    if let Some(window) = tauri::Manager::get_webview_window(app, "main") {
        dialog = dialog.set_parent(&window);
    }
    dialog.pick_folder(move |folder| {
        let _ = sender.send(
            folder
                .and_then(|path| path.into_path().ok())
                .map(|path| path.to_string_lossy().into_owned()),
        );
    });
    let folder = receiver.await.unwrap_or(None);
    *app::state(app).dialog_folder.lock().unwrap() = folder.clone();
    folder
}

#[tauri::command]
pub fn desktop_get_state(app: AppHandle, window: WebviewWindow, refresh: Option<bool>) -> Value {
    let shell = app::state(&app);
    if let Err(error) = authorize(&shell, &window, false) {
        return json!(error);
    }
    // 2026-11-13: a focus refresh must not replay an earlier launch error over current feedback.
    if refresh != Some(true) {
        shell.replay_status(&app);
    }
    let mut result = workspace::snapshot(&app, workspace::projects);
    let settings = shell.settings.lock().unwrap();
    let recent = workspace::recent_projects(&settings, result["current"].as_str());
    result.as_object_mut().unwrap().extend(
        json!({"recent":recent,"lastProject":settings.last_project,"version":env!("CARGO_PKG_VERSION"),
            "deckmateVersion":shell.deckmate_version,"locale":shell.locale,"language":settings.language,"theme":settings.theme})
        .as_object().unwrap().clone(),
    );
    result
}

#[tauri::command]
pub async fn desktop_choose_folder(app: AppHandle, window: WebviewWindow) -> Value {
    if let Err(error) = authorize(&app::state(&app), &window, false) {
        return json!(error);
    }
    json!(choose_folder(&app).await)
}

#[tauri::command]
pub async fn desktop_open_project(
    app: AppHandle,
    window: WebviewWindow,
    folder: Option<Value>,
) -> Value {
    let shell = app::state(&app);
    if let Err(error) = authorize(&shell, &window, false) {
        return json!(error);
    }
    let input = folder.unwrap_or(Value::Null);
    // 2026-11-09: explicit listed-project clicks are trusted; startup still refuses network folders.
    let listed = input
        .as_str()
        .and_then(|folder| shell.settings.lock().unwrap().listed_project(folder));
    let folder = match listed.map(Ok).unwrap_or_else(|| shell.check_folder(&input)) {
        Ok(folder) => folder,
        Err(error) => return json!(error),
    };
    app::result(app::open_project(&app, folder).await)
}

#[tauri::command]
pub async fn desktop_create_project(
    app: AppHandle,
    window: WebviewWindow,
    options: Option<Value>,
) -> Value {
    if let Err(error) = authorize(&app::state(&app), &window, false) {
        return json!(error);
    }
    app::result(app::create_project(&app, options.unwrap_or(Value::Null)).await)
}

#[tauri::command]
pub fn desktop_remove_recent(
    app: AppHandle,
    window: WebviewWindow,
    folder: Option<Value>,
) -> Value {
    let shell = app::state(&app);
    if let Err(error) = authorize(&shell, &window, false) {
        return json!(error);
    }
    let Some(Value::String(folder)) =
        folder.filter(|folder| folder.as_str().is_some_and(paths::is_absolute))
    else {
        return json!(shell.failure("invalid-path", "absolutePath"));
    };
    let listed = shell
        .settings
        .lock()
        .unwrap()
        .recent
        .iter()
        .any(|entry| paths::same_path(&entry.path, &folder));
    if paths::is_network_path(&folder) && !listed {
        return json!(shell.failure("invalid-path", "networkPath"));
    }
    let saved = shell.update_settings(|settings| {
        settings.remove_recent(&folder);
        Ok(())
    });
    crate::menu::sync(&app);
    if let Err(error) = saved {
        return json!(error);
    }
    workspace::snapshot(&app, workspace::recent_projects)
}

#[tauri::command]
pub async fn desktop_set_language(
    app: AppHandle,
    window: WebviewWindow,
    lang: Option<Value>,
) -> Value {
    set_language_command(&app, &window, lang, false).await
}

#[tauri::command]
pub async fn board_set_language(
    app: AppHandle,
    window: WebviewWindow,
    lang: Option<Value>,
) -> Value {
    set_language_command(&app, &window, lang, true).await
}

async fn set_language_command(
    app: &AppHandle,
    window: &WebviewWindow,
    lang: Option<Value>,
    board: bool,
) -> Value {
    let shell = app::state(app);
    if let Err(error) = authorize(&shell, window, board) {
        return json!(error);
    }
    let Some(language) = Language::from_ipc(lang.as_ref()) else {
        return json!(shell.failure("invalid-language", "language"));
    };
    app::result(
        set_display(
            app,
            window,
            DisplayPreference::Language(language),
            Some(board),
        )
        .await,
    )
}

pub async fn set_language(app: &AppHandle, language: Language) -> Result<(), Failure> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| app::state(app).failure("closed", "closed"))?;
    set_display(app, &window, DisplayPreference::Language(language), None).await
}

#[tauri::command]
pub fn board_recent_projects(app: AppHandle, window: WebviewWindow) -> Value {
    let shell = app::state(&app);
    if let Err(error) = authorize(&shell, &window, true) {
        return json!(error);
    }
    workspace::snapshot(&app, workspace::recent_projects)
}

#[tauri::command]
pub fn desktop_add_to_workspace(
    app: AppHandle,
    window: WebviewWindow,
    folder: Option<Value>,
) -> Value {
    let shell = app::state(&app);
    if let Err(error) = authorize(&shell, &window, false) {
        return json!(error);
    }
    let dialog = shell.dialog_folder.lock().unwrap().clone();
    let folder = folder.unwrap_or(Value::Null);
    workspace::changed(&app, |settings| {
        workspace::launcher_addition(settings, &folder, dialog.as_deref())
            .and_then(|folder| settings.add_to_workspace(&folder))
    })
}

#[tauri::command]
pub fn desktop_remove_from_workspace(
    app: AppHandle,
    window: WebviewWindow,
    folder: Option<Value>,
) -> Value {
    change_workspace(&app, &window, folder, None, false)
}

#[tauri::command]
pub fn desktop_move_in_workspace(
    app: AppHandle,
    window: WebviewWindow,
    folder: Option<Value>,
    index: Option<Value>,
) -> Value {
    change_workspace(
        &app,
        &window,
        folder,
        Some(index.unwrap_or(Value::Null)),
        false,
    )
}

#[tauri::command]
pub fn board_workspace_projects(app: AppHandle, window: WebviewWindow) -> Value {
    if let Err(error) = authorize(&app::state(&app), &window, true) {
        return json!(error);
    }
    workspace::snapshot(&app, workspace::projects)
}

#[tauri::command]
pub async fn board_add_to_workspace(
    app: AppHandle,
    window: WebviewWindow,
    source: Option<Value>,
) -> Value {
    let shell = app::state(&app);
    if let Err(error) = authorize(&shell, &window, true) {
        return json!(error);
    }
    let source = source.unwrap_or(Value::Null);
    if source["kind"] == "current" {
        return workspace::add_current(&app);
    }
    let dialog = if source["kind"] == "dialog" {
        choose_folder(&app).await
    } else {
        None
    };
    // 2026-11-09: a native dialog can outlive navigation or a project switch.
    if let Err(error) = authorize(&shell, &window, true) {
        return json!(error);
    }
    workspace::changed(&app, |settings| {
        workspace::board_addition(settings, &source, None, dialog.as_deref())
            .and_then(|folder| settings.add_to_workspace(&folder))
    })
}

#[tauri::command]
pub fn board_remove_from_workspace(
    app: AppHandle,
    window: WebviewWindow,
    folder: Option<Value>,
) -> Value {
    change_workspace(&app, &window, folder, None, true)
}

#[tauri::command]
pub fn board_move_in_workspace(
    app: AppHandle,
    window: WebviewWindow,
    folder: Option<Value>,
    index: Option<Value>,
) -> Value {
    change_workspace(
        &app,
        &window,
        folder,
        Some(index.unwrap_or(Value::Null)),
        true,
    )
}

fn change_workspace(
    app: &AppHandle,
    window: &WebviewWindow,
    folder: Option<Value>,
    index: Option<Value>,
    board: bool,
) -> Value {
    let shell = app::state(app);
    if let Err(error) = authorize(&shell, window, board) {
        return json!(error);
    }
    let folder = folder
        .as_ref()
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned();
    workspace::changed(app, |settings| match index {
        Some(index) => index
            .as_i64()
            .ok_or("invalid-path")
            .and_then(|index| settings.move_in_workspace(&folder, index)),
        None => settings.remove_from_workspace(&folder),
    })
}

#[tauri::command]
pub async fn board_switch_project(
    app: AppHandle,
    window: WebviewWindow,
    folder: Option<Value>,
) -> Value {
    let shell = app::state(&app);
    if let Err(error) = authorize(&shell, &window, true) {
        return json!(error);
    }
    let listed = folder
        .as_ref()
        .and_then(Value::as_str)
        .and_then(|folder| shell.settings.lock().unwrap().listed_project(folder));
    let Some(folder) = listed else {
        return json!(shell.failure("not-recent", "notListed"));
    };
    if shell
        .current
        .lock()
        .unwrap()
        .as_ref()
        .is_some_and(|current| paths::same_path(&current.folder, &folder))
    {
        return app::ok();
    }
    app::result(app::open_project(&app, folder).await)
}

#[tauri::command]
pub async fn board_show_start_screen(app: AppHandle, window: WebviewWindow) -> Value {
    if let Err(error) = authorize(&app::state(&app), &window, true) {
        return json!(error);
    }
    app::result(app::show_launcher(&app, None).await)
}

#[tauri::command]
pub fn board_set_dirty(app: AppHandle, window: WebviewWindow, dirty: bool) -> Value {
    let shell = app::state(&app);
    if let Err(error) = authorize(&shell, &window, true) {
        return json!(error);
    }
    shell
        .unsaved
        .dirty
        .store(dirty, std::sync::atomic::Ordering::SeqCst);
    app::ok()
}

#[tauri::command]
pub async fn desktop_set_theme(
    app: AppHandle,
    window: WebviewWindow,
    theme: Option<Value>,
) -> Value {
    set_theme(&app, &window, theme, false).await
}

#[tauri::command]
pub async fn board_set_theme(app: AppHandle, window: WebviewWindow, theme: Option<Value>) -> Value {
    set_theme(&app, &window, theme, true).await
}

async fn set_theme(
    app: &AppHandle,
    window: &WebviewWindow,
    theme: Option<Value>,
    board: bool,
) -> Value {
    let shell = app::state(app);
    if let Err(error) = authorize(&shell, window, board) {
        return json!(error);
    }
    let Some(theme) = Theme::from_ipc(theme.as_ref()) else {
        return json!(shell.failure("invalid-theme", "theme"));
    };
    app::result(set_display(app, window, DisplayPreference::Theme(theme), Some(board)).await)
}

enum DisplayPreference {
    Theme(Theme),
    Language(Language),
}

async fn set_display(
    app: &AppHandle,
    window: &WebviewWindow,
    preference: DisplayPreference,
    board: Option<bool>,
) -> Result<(), Failure> {
    let shell = app::state(app);
    // 2026-11-13: navigation must not capture display settings halfway through saving and refreshing the preload.
    let _guard = shell.lifecycle.lock().await;
    if let Some(board) = board {
        authorize(&shell, window, board)?;
    }
    let previous = shell.settings.lock().unwrap().clone();
    let changed = match preference {
        DisplayPreference::Theme(theme) => previous.theme != theme,
        DisplayPreference::Language(language) => previous.language != language.as_str(),
    };
    // 2026-11-13: an explicit language choice must persist even when it matches the unsaved system default.
    if changed || matches!(preference, DisplayPreference::Language(_)) {
        shell.update_settings(|settings| {
            match preference {
                DisplayPreference::Theme(theme) => settings.theme = theme,
                DisplayPreference::Language(language) => {
                    settings.language = language.as_str().into()
                }
            }
            Ok(())
        })?;
    }
    if let Ok(url) = window.url() {
        if window::is_server_url(&shell, &url) {
            crate::webview::board_script(window, Some(url.origin().ascii_serialization()))
                .await
                .map_err(|error| Failure::new("load-failed", error))?;
        }
    }
    let settings = shell.settings.lock().unwrap().clone();
    let _ = window.set_background_color(Some(window::background_color(
        settings.theme,
        window::system_dark(),
    )));
    window
        .eval(format!(
            "window.dispatchEvent(new CustomEvent('deckmate:display', {{ detail: {} }}));",
            json!({"theme": settings.theme, "language": settings.language})
        ))
        .map_err(|error| Failure::new("load-failed", error.to_string()))?;
    if matches!(preference, DisplayPreference::Language(_)) {
        crate::menu::sync(app);
        if changed {
            crate::whats_new::refresh_language(app);
        }
    }
    Ok(())
}
