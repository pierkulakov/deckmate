use crate::{
    app, bridge, paths,
    texts::{self, text},
    updater, whats_new, window, workspace,
};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu},
    AppHandle, Manager,
};
use tauri_plugin_dialog::{
    DialogExt, MessageDialogButtons, MessageDialogKind, MessageDialogResult,
};
use tauri_plugin_opener::OpenerExt;

fn build(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let shell = app::state(app);
    let settings = shell.settings.lock().unwrap().clone();
    let lang = &settings.language;
    let current = shell
        .current
        .lock()
        .unwrap()
        .as_ref()
        .filter(|current| current.url.is_some())
        .map(|current| current.folder.clone());
    let project = current.is_some();
    let can_add = current.as_ref().is_some_and(|folder| {
        !settings
            .workspace
            .iter()
            .any(|entry| paths::same_path(&entry.path, folder))
    });
    let item = |key: &str, enabled: bool, accelerator: Option<&str>| {
        MenuItem::with_id(app, key, text(lang, key), enabled, accelerator)
    };
    let separator = || PredefinedMenuItem::separator(app);
    let recent = Submenu::new(app, text(lang, "recentProjects"), true)?;
    if settings.recent.is_empty() {
        recent.append(&item("noRecent", false, None)?)?;
    } else {
        for entry in &settings.recent {
            // 2026-11-09: store the path in the ID so a queued click cannot select a different reordered entry.
            let label = format!("{} — {}", entry.name, entry.path).replace('&', "&&");
            recent.append(&MenuItem::with_id(
                app,
                format!("recent:{}", entry.path),
                label,
                true,
                None::<&str>,
            )?)?;
        }
        recent.append(&separator()?)?;
        recent.append(&item("clearRecent", true, None)?)?;
    }
    let workspace_menu = Submenu::new(app, text(lang, "workspace"), true)?;
    if settings.workspace.is_empty() {
        workspace_menu.append(&item("noWorkspace", false, None)?)?;
    }
    for (index, entry) in settings.workspace.iter().enumerate() {
        let accelerator = (index < 9).then(|| format!("Ctrl+{}", index + 1));
        let label = format!("{} — {}", entry.name, entry.path).replace('&', "&&");
        workspace_menu.append(&MenuItem::with_id(
            app,
            format!("workspace:{}", entry.path),
            label,
            std::path::Path::new(&entry.path).is_dir(),
            accelerator.as_deref(),
        )?)?;
    }
    let file = Submenu::with_items(
        app,
        text(lang, "file"),
        true,
        &[
            &item("openFolder", true, Some("Ctrl+O"))?,
            &recent,
            &workspace_menu,
            &item("addCurrentToWorkspace", can_add, None)?,
            &item("revealProject", project, None)?,
            &separator()?,
            &item("switchProject", true, Some("Ctrl+Shift+P"))?,
            &item("closeProject", project, None)?,
            &separator()?,
            &item("reload", true, Some("Ctrl+R"))?,
            &item("toggleDevTools", cfg!(debug_assertions), Some("F12"))?,
            &separator()?,
            &item("quit", true, Some("Ctrl+Q"))?,
        ],
    )?;
    let edit = Submenu::with_items(
        app,
        text(lang, "edit"),
        true,
        &[
            &item("undo", true, Some("Ctrl+Z"))?,
            &item("redo", true, Some("Ctrl+Y"))?,
            &separator()?,
            &PredefinedMenuItem::cut(app, Some(text(lang, "cut")))?,
            &PredefinedMenuItem::copy(app, Some(text(lang, "copy")))?,
            &PredefinedMenuItem::paste(app, Some(text(lang, "paste")))?,
            &PredefinedMenuItem::select_all(app, Some(text(lang, "selectAll")))?,
        ],
    )?;
    let view = Submenu::with_items(
        app,
        text(lang, "view"),
        true,
        &[
            &item("zoomIn", true, Some("Ctrl+="))?,
            &item("zoomOut", true, Some("Ctrl+-"))?,
            &item("actualSize", true, Some("Ctrl+0"))?,
            &separator()?,
            &item("toggleFullScreen", true, Some("F11"))?,
        ],
    )?;
    let help = Submenu::with_items(
        app,
        text(lang, "help"),
        true,
        &[
            &item(
                "checkUpdates",
                updater::enabled() && !shell.updates.busy(),
                None,
            )?,
            &CheckMenuItem::with_id(
                app,
                "autoCheckUpdates",
                text(lang, "autoCheckUpdates"),
                true,
                settings.updates.auto_check,
                None::<&str>,
            )?,
            &item("whatsNew", true, None)?,
            &separator()?,
            &item("openLogs", true, None)?,
            &separator()?,
            &item("about", true, None)?,
        ],
    )?;
    if let Some(version) = shell.updates.ready_version() {
        help.insert(
            &MenuItem::with_id(
                app,
                "installPending",
                texts::format(
                    lang,
                    if updater::portable().unwrap_or(true) {
                        "portableUpdates"
                    } else {
                        "installPending"
                    },
                    "version",
                    version,
                ),
                !shell.updates.busy(),
                None::<&str>,
            )?,
            1,
        )?;
    }
    Menu::with_items(app, &[&file, &edit, &view, &help])
}

pub fn rebuild(app: &AppHandle) {
    if let Err(error) = build(app).and_then(|menu| app.set_menu(menu)) {
        app::state(app).log.write(format!("menu failed: {error}"));
    }
}

fn message(app: &AppHandle, key: &str, detail: &str, kind: MessageDialogKind) {
    let lang = app::state(app).language();
    let app = app.clone();
    let title = text(&lang, key).to_owned();
    let detail = detail.to_owned();
    tauri::async_runtime::spawn(async move {
        dialog(
            &app,
            &title,
            &detail,
            MessageDialogButtons::OkCustom(text(&lang, "ok").into()),
            kind,
        )
        .await;
    });
}

pub async fn dialog(
    app: &AppHandle,
    title: &str,
    detail: &str,
    buttons: MessageDialogButtons,
    kind: MessageDialogKind,
) -> MessageDialogResult {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let mut dialog = app
        .dialog()
        .message(if detail.is_empty() { title } else { detail })
        .title(title)
        .kind(kind)
        .buttons(buttons);
    if let Some(window) = app.get_webview_window("main") {
        dialog = dialog.parent(&window);
    }
    dialog.show_with_result(move |result| {
        let _ = sender.send(result);
    });
    receiver.await.unwrap_or_default()
}

fn accepted(result: MessageDialogResult, label: &str) -> bool {
    matches!(result, MessageDialogResult::Custom(value) if value == label)
}

pub async fn ask(app: &AppHandle, question: &str, yes: &str, no: &str) -> bool {
    let language = app::state(app).language();
    let yes = text(&language, yes);
    let result = dialog(
        app,
        "Deckmate",
        text(&language, question),
        MessageDialogButtons::OkCancelCustom(yes.into(), text(&language, no).into()),
        MessageDialogKind::Warning,
    )
    .await;
    accepted(result, yes)
}

async fn open(app: &AppHandle, folder: String) {
    if let Err(error) = app::open_project(app, folder).await {
        if matches!(error.code.as_str(), "missing" | "invalid-path") {
            message(
                app,
                "openFailed",
                &error.message,
                MessageDialogKind::Warning,
            );
        }
    }
}

pub fn handle(app: &AppHandle, event: MenuEvent) {
    let id = event.id().as_ref();
    let shell = app::state(app);
    let window = app.get_webview_window("main");
    match id {
        "quit" => app::request_quit(app),
        "autoCheckUpdates" => updater::toggle_auto_check(app),
        "zoomIn" => window::change_zoom(app, 0.1),
        "zoomOut" => window::change_zoom(app, -0.1),
        "actualSize" => window::set_zoom(app, 1.0),
        "addCurrentToWorkspace" => {
            let result = workspace::add_current(app);
            if result["ok"] == false {
                message(
                    app,
                    "workspace",
                    result["message"].as_str().unwrap_or(""),
                    MessageDialogKind::Warning,
                );
            }
        }
        "reload" => {
            if let Some(window) = window {
                let _ = window.reload();
            }
        }
        "toggleDevTools" =>
        {
            #[cfg(debug_assertions)]
            if let Some(window) = window {
                if window.is_devtools_open() {
                    window.close_devtools();
                } else {
                    window.open_devtools();
                }
            }
        }
        "toggleFullScreen" => {
            if let Some(window) = window {
                let _ = window.set_fullscreen(!window.is_fullscreen().unwrap_or(false));
            }
        }
        "undo" | "redo" => {
            if let Some(window) = window {
                let _ = window.eval(format!("document.execCommand('{id}')"));
            }
        }
        "revealProject" => {
            if let Some(current) = shell.current.lock().unwrap().as_ref() {
                let _ = app.opener().reveal_item_in_dir(&current.folder);
            }
        }
        "openLogs" => {
            let _ = app
                .opener()
                .open_path(shell.directory.to_string_lossy(), None::<&str>);
        }
        "about" => message(
            app,
            "about",
            &format!(
                "Deckmate {}\nDesktop {}\nTauri 2.12.5\nNode {}",
                shell.deckmate_version,
                env!("CARGO_PKG_VERSION"),
                env!("DECKMATE_BUNDLED_NODE_VERSION")
            ),
            MessageDialogKind::Info,
        ),
        "clearRecent" => {
            let project = shell
                .current
                .lock()
                .unwrap()
                .as_ref()
                .map(|current| current.folder.clone());
            {
                let mut settings = shell.settings.lock().unwrap();
                settings.recent.clear();
                settings.last_project = project;
            }
            rebuild(app);
            if let Err(error) = shell.save() {
                message(
                    app,
                    "saveFailedTitle",
                    &error.message,
                    MessageDialogKind::Error,
                );
            }
            if let Some(window) =
                window.filter(|window| window.url().is_ok_and(|url| window::is_launcher_url(&url)))
            {
                let _ = window.reload();
            }
        }
        _ => {
            let app = app.clone();
            let id = id.to_owned();
            tauri::async_runtime::spawn(async move {
                match id.as_str() {
                    "checkUpdates" => updater::check(&app, true).await,
                    "installPending" => updater::install_ready(&app).await,
                    "whatsNew" => whats_new::open(&app, None).await,
                    "openFolder" => {
                        if let Some(folder) = bridge::choose_folder(&app).await {
                            open(&app, folder).await;
                        }
                    }
                    "switchProject" | "closeProject" => {
                        let _ = app::show_launcher(&app, None).await;
                    }
                    _ => {
                        let folder = {
                            let settings = shell.settings.lock().unwrap();
                            if let Some(folder) = id.strip_prefix("workspace:") {
                                settings
                                    .workspace
                                    .iter()
                                    .find(|entry| paths::same_path(&entry.path, folder))
                                    .map(|entry| entry.path.clone())
                            } else {
                                id.strip_prefix("recent:").and_then(|folder| {
                                    settings
                                        .recent
                                        .iter()
                                        .find(|entry| paths::same_path(&entry.path, folder))
                                        .map(|entry| entry.path.clone())
                                })
                            }
                        };
                        if let Some(folder) = folder {
                            open(&app, folder).await;
                        }
                    }
                }
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_explicit_leave_accepts_the_unsaved_dialog() {
        for language in ["en", "ru"] {
            let leave = text(language, "leave");
            assert!(accepted(MessageDialogResult::Custom(leave.into()), leave));
            for result in [
                MessageDialogResult::Cancel,
                MessageDialogResult::No,
                MessageDialogResult::Custom(text(language, "stay").into()),
            ] {
                assert!(!accepted(result, leave));
            }
        }
    }
}
