use crate::{
    app::{self, Shell},
    paths,
    server::Failure,
    window,
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
    json!({"recent":settings.recent,"lastProject":settings.last_project,"version":env!("CARGO_PKG_VERSION"),
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
    // 2026-11-09: an explicit recent-project click is allowed, but never auto-opens a network folder.
    let recent = input.as_str().and_then(|folder| {
        shell
            .settings
            .lock()
            .unwrap()
            .recent
            .iter()
            .find(|entry| paths::same_path(&entry.path, folder))
            .map(|entry| entry.path.clone())
    });
    let folder = match recent.map(Ok).unwrap_or_else(|| shell.check_folder(&input)) {
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
pub async fn board_switch_project(
    app: AppHandle,
    window: WebviewWindow,
    folder: Option<Value>,
) -> Value {
    let shell = app::state(&app);
    if let Err(error) = authorize(&shell, &window, true) {
        return json!(error);
    }
    let recent = folder.as_ref().and_then(Value::as_str).and_then(|folder| {
        shell
            .settings
            .lock()
            .unwrap()
            .recent
            .iter()
            .find(|entry| paths::same_path(&entry.path, folder))
            .cloned()
    });
    let Some(entry) = recent else {
        return json!(shell.failure("not-recent", "notRecent"));
    };
    if shell
        .current
        .lock()
        .unwrap()
        .as_ref()
        .is_some_and(|current| paths::same_path(&current.folder, &entry.path))
    {
        return app::ok();
    }
    app::result(app::open_project(&app, entry.path).await)
}

#[tauri::command]
pub async fn board_show_start_screen(app: AppHandle, window: WebviewWindow) -> Value {
    if let Err(error) = authorize(&app::state(&app), &window, true) {
        return json!(error);
    }
    app::show_launcher(&app, None).await;
    app::ok()
}
