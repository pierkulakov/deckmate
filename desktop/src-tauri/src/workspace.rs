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

fn project_snapshot(path: &str, name: &str, current: Option<&str>) -> Value {
    json!({"path":path,"name":name,"missing":!Path::new(path).is_dir(),
        "current":current.is_some_and(|folder| paths::same_path(folder, path))})
}

pub fn recent_projects(settings: &Settings, current: Option<&str>) -> Value {
    json!(settings
        .recent
        .iter()
        .map(|entry| {
            let mut project = project_snapshot(&entry.path, &entry.name, current);
            project["lastOpened"] = json!(entry.last_opened);
            project
        })
        .collect::<Vec<_>>())
}

pub fn projects(settings: &Settings, current: Option<&str>) -> Value {
    json!(settings
        .workspace
        .iter()
        .map(|entry| project_snapshot(&entry.path, &entry.name, current))
        .collect::<Vec<_>>())
}

pub fn result(projects: Value, current: Option<&str>) -> Value {
    json!({"ok":true,"projects":projects,"current":current})
}

pub fn snapshot(app: &AppHandle, list: fn(&Settings, Option<&str>) -> Value) -> Value {
    let shell = app::state(app);
    let current = shell
        .current
        .lock()
        .unwrap()
        .as_ref()
        .map(|current| current.folder.clone());
    let settings = shell.settings.lock().unwrap();
    result(list(&settings, current.as_deref()), current.as_deref())
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
) -> Value {
    let shell = app::state(app);
    let saved = update(&shell, change);
    if let Err(error) = &saved {
        if error.code != "save-failed" {
            return json!(error);
        }
    }
    crate::menu::sync(app);
    if let Err(error) = saved {
        return json!(error);
    }
    snapshot(app, projects)
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
    changed(app, |settings| {
        board_addition(
            settings,
            &json!({"kind":"current"}),
            current.as_deref(),
            None,
        )
        .and_then(|folder| settings.add_to_workspace(&folder))
    })
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
    fn recent_and_workspace_snapshots_follow_folder_removal_and_restoration() {
        let sandbox = app::tests::Sandbox::new();
        let folder = sandbox.0.join("project");
        let path = folder.to_string_lossy();
        let mut settings = Settings::normalize(Value::Null, "en");
        settings.remember(&path);
        settings.add_to_workspace(&path).unwrap();
        let saved = serde_json::to_value(&settings).unwrap();

        let check = |missing: bool| {
            let recent = recent_projects(&settings, None);
            assert_eq!(recent[0]["missing"], missing);
            assert_eq!(recent[0]["path"], saved["recent"][0]["path"]);
            assert_eq!(recent[0]["name"], saved["recent"][0]["name"]);
            assert_eq!(recent[0]["lastOpened"], saved["recent"][0]["lastOpened"]);
            assert_eq!(projects(&settings, None)[0]["missing"], missing);
            assert_eq!(serde_json::to_value(&settings).unwrap(), saved);
        };
        check(true);
        std::fs::create_dir(&folder).unwrap();
        check(false);
        std::fs::remove_dir(&folder).unwrap();
        check(true);
        std::fs::write(&folder, "not a directory").unwrap();
        check(true);
        std::fs::remove_file(&folder).unwrap();
        std::fs::create_dir(&folder).unwrap();
        check(false);
        assert!(saved["recent"][0].get("missing").is_none());
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
        let board = projects(&settings, Some(&existing));
        assert_eq!(board[0]["current"], true);
        assert_eq!(board[0]["missing"], false);
        assert_eq!(board[1]["current"], false);
        assert_eq!(board[1]["missing"], true);
        assert_eq!(projects(&settings, None)[0]["current"], false);
        let saved = serde_json::to_value(settings).unwrap();
        assert!(saved["workspace"][0].get("current").is_none());
        assert!(saved["workspace"][0].get("missing").is_none());
    }

    #[test]
    fn launcher_and_board_lists_share_the_result_contract() {
        let sandbox = app::tests::Sandbox::new();
        let existing = sandbox.0.to_string_lossy();
        let missing = sandbox.0.join("missing").to_string_lossy().into_owned();
        let mut settings = Settings::normalize(Value::Null, "en");
        for path in [&*existing, &missing] {
            settings.remember(path);
            settings.add_to_workspace(path).unwrap();
        }
        for current in [None, Some(&*existing), Some("C:/Unpinned")] {
            for list in [projects, recent_projects] {
                let reply = result(list(&settings, current), current);
                assert_eq!(reply.as_object().unwrap().len(), 3);
                assert_eq!(reply["ok"], true);
                assert_eq!(reply["current"], json!(current));
                let entries = reply["projects"].as_array().unwrap();
                assert_eq!(entries.len(), 2);
                for entry in entries {
                    let path = entry["path"].as_str().unwrap();
                    assert_eq!(entry["missing"], path == missing);
                    assert_eq!(entry["current"], current == Some(path));
                }
            }
        }
        assert_eq!(
            result(json!([]), None),
            json!({"ok":true,"projects":[],"current":null})
        );
    }
}
