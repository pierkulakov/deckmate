use crate::{
    app::{self, Shell},
    paths,
    server::Failure,
    window, workspace,
};
use serde_json::{json, Value};
use tauri::{AppHandle, WebviewWindow};
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
pub fn desktop_get_state(app: AppHandle, window: WebviewWindow) -> Value {
    let shell = app::state(&app);
    if let Err(error) = authorize(&shell, &window, false) {
        return json!(error);
    }
    shell.replay_status(&app);
    let settings = shell.settings.lock().unwrap();
    json!({"recent":settings.recent,"workspace":workspace::projects(&settings, None, false),"lastProject":settings.last_project,"version":env!("CARGO_PKG_VERSION"),
        "deckmateVersion":shell.deckmate_version,"locale":shell.locale,"language":settings.language})
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
    shell.settings.lock().unwrap().remove_recent(&folder);
    crate::menu::rebuild(&app);
    shell.save();
    app::ok()
}

#[tauri::command]
pub fn desktop_set_language(app: AppHandle, window: WebviewWindow, lang: Option<Value>) -> Value {
    let shell = app::state(&app);
    if let Err(error) = authorize(&shell, &window, false) {
        return json!(error);
    }
    let Some(Value::String(lang)) = lang.filter(|lang| matches!(lang.as_str(), Some("en" | "ru")))
    else {
        return json!(shell.failure("invalid-language", "language"));
    };
    shell.settings.lock().unwrap().language = lang;
    crate::menu::rebuild(&app);
    shell.save();
    app::ok()
}

#[tauri::command]
pub fn board_recent_projects(app: AppHandle, window: WebviewWindow) -> Value {
    let shell = app::state(&app);
    if let Err(error) = authorize(&shell, &window, true) {
        return json!(error);
    }
    let current = shell
        .current
        .lock()
        .unwrap()
        .as_ref()
        .map(|current| current.folder.clone());
    let recent = shell.settings.lock().unwrap().recent.iter().map(|entry| json!({"path":entry.path,"name":entry.name,
        "lastOpened":entry.last_opened,"current":current.as_ref().is_some_and(|folder| paths::same_path(folder, &entry.path))})).collect::<Vec<_>>();
    json!(recent)
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
    let result = {
        let mut settings = shell.settings.lock().unwrap();
        workspace::launcher_addition(&settings, &folder.unwrap_or(Value::Null), dialog.as_deref())
            .and_then(|folder| settings.add_to_workspace(&folder))
    };
    workspace::changed(&app, result, false)
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
    workspace::snapshot(&app, true)
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
    let result = {
        let mut settings = shell.settings.lock().unwrap();
        workspace::board_addition(&settings, &source, None, dialog.as_deref())
            .and_then(|folder| settings.add_to_workspace(&folder))
    };
    workspace::changed(&app, result, true)
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
    let result = {
        let mut settings = shell.settings.lock().unwrap();
        let folder = folder.as_ref().and_then(Value::as_str).unwrap_or("");
        match index {
            Some(index) => index
                .as_i64()
                .ok_or("invalid-path")
                .and_then(|index| settings.move_in_workspace(folder, index)),
            None => settings.remove_from_workspace(folder),
        }
    };
    workspace::changed(app, result, board)
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
    app::show_launcher(&app, None).await;
    app::ok()
}
