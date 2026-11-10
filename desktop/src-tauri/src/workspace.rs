use crate::{app, paths, server::Failure, settings::Settings, texts};
use serde_json::{json, Value};
use std::path::Path;
use tauri::AppHandle;

fn recent_folder(settings: &Settings, folder: &str) -> Result<String, &'static str> {
    settings
        .recent
        .iter()
        .find(|entry| paths::same_path(&entry.path, folder))
        .map(|entry| entry.path.clone())
        .ok_or("not-recent")
}

pub fn launcher_addition(
    settings: &Settings,
    folder: &Value,
    dialog: Option<&str>,
) -> Result<String, &'static str> {
    let folder = folder
        .as_str()
        .filter(|folder| Path::new(folder).is_absolute())
        .ok_or("invalid-path")?;
    if let Some(dialog) = dialog.filter(|dialog| paths::same_path(dialog, folder)) {
        return Ok(dialog.into());
    }
    recent_folder(settings, folder).map_err(|_| "invalid-path")
}

pub fn board_addition(
    settings: &Settings,
    source: &Value,
    current: Option<&str>,
    dialog: Option<&str>,
) -> Result<String, &'static str> {
    match source["kind"].as_str() {
        Some("dialog") => dialog.map(str::to_owned).ok_or("cancelled"),
        Some("current") => current.map(str::to_owned).ok_or("invalid-path"),
        Some("recent") => recent_folder(settings, source["path"].as_str().ok_or("not-recent")?),
        _ => Err("invalid-path"),
    }
}

pub fn projects(settings: &Settings, current: Option<&str>, board: bool) -> Value {
    json!(settings.workspace.iter().map(|entry| {
        let mut project = json!({"path":entry.path,"name":entry.name,"missing":!Path::new(&entry.path).is_dir()});
        if board {
            project["current"] = json!(current.is_some_and(|folder| paths::same_path(folder, &entry.path)));
        }
        project
    }).collect::<Vec<_>>())
}

pub fn snapshot(app: &AppHandle, board: bool) -> Value {
    let shell = app::state(app);
    let current = shell
        .current
        .lock()
        .unwrap()
        .as_ref()
        .map(|current| current.folder.clone());
    let settings = shell.settings.lock().unwrap();
    projects(&settings, current.as_deref(), board)
}

fn failure_key(code: &str) -> &'static str {
    match code {
        "not-in-workspace" => "notInWorkspace",
        "not-recent" => "notRecent",
        "cancelled" => "cancelled",
        _ => "workspacePath",
    }
}

fn update(
    shell: &app::Shell,
    change: impl FnOnce(&mut Settings) -> Result<(), &'static str>,
) -> Result<(), Failure> {
    let language = shell.language();
    shell.update_settings(|settings| {
        change(settings)
            .map_err(|code| Failure::new(code, texts::text(&language, failure_key(code))))
    })
}

pub fn changed(
    app: &AppHandle,
    change: impl FnOnce(&mut Settings) -> Result<(), &'static str>,
    board: bool,
) -> Value {
    let shell = app::state(app);
    let saved = update(&shell, change);
    if let Err(error) = &saved {
        if error.code != "save-failed" {
            return json!(error);
        }
    }
    crate::menu::rebuild(app);
    if let Err(error) = saved {
        return json!(error);
    }
    let projects = snapshot(app, board);
    if board {
        json!({"ok":true,"projects":projects})
    } else {
        json!({"ok":true,"workspace":projects})
    }
}

pub fn add_current(app: &AppHandle) -> Value {
    let shell = app::state(app);
    let current = shell
        .current
        .lock()
        .unwrap()
        .as_ref()
        .filter(|current| current.url.is_some())
        .map(|current| current.folder.clone());
    changed(
        app,
        |settings| {
            board_addition(
                settings,
                &json!({"kind":"current"}),
                current.as_deref(),
                None,
            )
            .and_then(|folder| settings.add_to_workspace(&folder))
        },
        true,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failed_workspace_removal_keeps_memory_and_disk_and_can_be_retried() {
        let sandbox = app::tests::Sandbox::new();
        let shell = app::tests::shell(&sandbox.0, None);
        update(&shell, |settings| settings.add_to_workspace("C:/Demo")).unwrap();
        let path = sandbox.0.join("desktop.json");
        let original = std::fs::read_to_string(&path).unwrap();
        let temporary = sandbox.0.join("desktop.json.tmp");
        std::fs::create_dir(&temporary).unwrap();
        let failure =
            update(&shell, |settings| settings.remove_from_workspace("C:/Demo")).unwrap_err();
        assert_eq!(failure.code, "save-failed");
        assert_eq!(shell.settings.lock().unwrap().workspace.len(), 1);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), original);
        std::fs::remove_dir(&temporary).unwrap();
        update(&shell, |settings| settings.remove_from_workspace("C:/Demo")).unwrap();
        assert!(shell.settings.lock().unwrap().workspace.is_empty());
        let repeated =
            update(&shell, |settings| settings.remove_from_workspace("C:/Demo")).unwrap_err();
        assert_eq!(repeated.code, "not-in-workspace");
    }

    #[test]
    fn launcher_trusts_only_last_dialog_or_recent_and_returns_stored_paths() {
        let mut settings = Settings::normalize(Value::Null, "en");
        settings.remember(r"\\server\recent");
        assert_eq!(
            launcher_addition(&settings, &json!(r"c:\dialog"), Some("C:/Dialog")),
            Ok("C:/Dialog".into())
        );
        assert_eq!(
            launcher_addition(&settings, &json!(r"\\SERVER\RECENT"), None),
            Ok(r"\\server\recent".into())
        );
        for folder in [json!("C:/other"), json!("relative"), json!(42), Value::Null] {
            assert_eq!(
                launcher_addition(&settings, &folder, Some("C:/Dialog")),
                Err("invalid-path")
            );
        }
        settings.add_to_workspace("C:/WorkspaceOnly").unwrap();
        assert_eq!(
            launcher_addition(&settings, &json!("C:/WorkspaceOnly"), None),
            Err("invalid-path")
        );
    }

    #[test]
    fn board_trusts_dialog_current_recent_but_not_caller_supplied_paths() {
        let mut settings = Settings::normalize(Value::Null, "en");
        settings.remember("C:/Recent");
        let resolve =
            |source: Value, dialog| board_addition(&settings, &source, Some("C:/Current"), dialog);
        assert_eq!(
            resolve(
                json!({"kind":"dialog","path":"C:/Untrusted"}),
                Some(r"\\server\chosen")
            ),
            Ok(r"\\server\chosen".into())
        );
        assert_eq!(resolve(json!({"kind":"dialog"}), None), Err("cancelled"));
        assert_eq!(
            resolve(json!({"kind":"current","path":"C:/Untrusted"}), None),
            Ok("C:/Current".into())
        );
        assert_eq!(
            resolve(json!({"kind":"recent","path":"c:/RECENT"}), None),
            Ok("C:/Recent".into())
        );
        for source in [
            json!({"kind":"recent","path":"C:/other"}),
            json!({"kind":"recent"}),
        ] {
            assert_eq!(resolve(source, None), Err("not-recent"));
        }
        for source in [
            json!({"kind":"other","path":"C:/Recent"}),
            json!("C:/Current"),
            Value::Null,
        ] {
            assert_eq!(resolve(source, None), Err("invalid-path"));
        }
        assert_eq!(
            board_addition(&settings, &json!({"kind":"current"}), None, None),
            Err("invalid-path")
        );
    }

    #[test]
    fn switch_trusts_workspace_without_recent_and_uses_stored_path() {
        let mut settings = Settings::normalize(Value::Null, "en");
        settings.add_to_workspace(r"\\server\Workspace").unwrap();
        settings.remember("C:/Recent");
        assert_eq!(
            settings.listed_project(r"\\SERVER\workspace"),
            Some(r"\\server\Workspace".into())
        );
        assert_eq!(
            settings.listed_project("c:/RECENT"),
            Some("C:/Recent".into())
        );
        assert_eq!(settings.listed_project("C:/other"), None);
        settings
            .remove_from_workspace(r"\\server\Workspace")
            .unwrap();
        assert_eq!(settings.listed_project(r"\\server\Workspace"), None);
    }

    #[test]
    fn snapshots_report_missing_and_current_without_persisting_them() {
        let mut settings = Settings::normalize(Value::Null, "en");
        let existing = std::env::current_dir()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let missing = std::env::current_dir()
            .unwrap()
            .join("workspace-missing-test-folder")
            .to_string_lossy()
            .into_owned();
        settings.add_to_workspace(&existing).unwrap();
        settings.add_to_workspace(&missing).unwrap();
        let board = projects(&settings, Some(&existing), true);
        assert_eq!(board[0]["current"], true);
        assert_eq!(board[0]["missing"], false);
        assert_eq!(board[1]["current"], false);
        assert_eq!(board[1]["missing"], true);
        assert!(projects(&settings, None, false)[0].get("current").is_none());
        let saved = serde_json::to_value(settings).unwrap();
        assert!(saved["workspace"][0].get("current").is_none());
        assert!(saved["workspace"][0].get("missing").is_none());
    }
}
