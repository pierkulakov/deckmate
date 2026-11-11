use crate::{app, menu, texts, window};
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{
    webview::{NewWindowResponse, PageLoadEvent},
    AppHandle, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};
use tauri_plugin_dialog::{MessageDialogButtons, MessageDialogKind};

pub const RELEASES_URL: &str = "https://github.com/pierkulakov/deckmate/releases";
const PAGE: &str = "whats-new.html";
const LABEL: &str = "whats-new";

#[derive(Default)]
pub struct State {
    from: Mutex<Option<String>>,
    opening: tokio::sync::Mutex<()>,
}

fn authorized(label: &str, url: &Url) -> bool {
    label == LABEL && window::is_app_page_url(url, PAGE)
}

fn changelog_path(root: &Path, language: &str) -> PathBuf {
    let russian = root.join("CHANGELOG.ru.md");
    if language == "ru" && russian.is_file() {
        russian
    } else {
        root.join("CHANGELOG.md")
    }
}

#[tauri::command]
pub fn whats_new_get(app: AppHandle, window: WebviewWindow) -> Value {
    let shell = app::state(&app);
    if !window
        .url()
        .is_ok_and(|url| authorized(window.label(), &url))
    {
        return json!(shell.failure("forbidden", "whatsNewOnly"));
    }
    let language = shell.language();
    // 2026-11-09: Programs already resolves the repository or bundled deckmate resource root.
    let root = shell.programs.package.parent().unwrap();
    let path = changelog_path(root, &language);
    let changelog = match std::fs::read_to_string(&path) {
        Ok(changelog) => changelog,
        Err(error) => {
            shell.log.write(format!(
                "changelog read failed: {}: {error}",
                path.display()
            ));
            return json!(crate::server::Failure::new(
                "read-failed",
                texts::format(&language, "whatsNewFailed", "error", error)
            ));
        }
    };
    json!({
        "language": language,
        "from": shell.whats_new.from.lock().unwrap().clone(),
        "to": app.package_info().version.to_string(),
        "changelog": changelog,
        "releasesUrl": RELEASES_URL
    })
}

async fn open_failed(app: &AppHandle, error: impl std::fmt::Display) {
    let shell = app::state(app);
    shell
        .log
        .write(format!("what's new window failed: {error}"));
    let language = shell.language();
    menu::dialog(
        app,
        texts::text(&language, "whatsNewTitle"),
        &texts::format(&language, "whatsNewOpenFailed", "error", error),
        MessageDialogButtons::OkCustom(texts::text(&language, "ok").into()),
        MessageDialogKind::Error,
    )
    .await;
}

pub async fn open(app: &AppHandle, from: Option<String>) {
    let shell = app::state(app);
    let _guard = shell.whats_new.opening.lock().await;
    *shell.whats_new.from.lock().unwrap() = from;
    let title = texts::text(&shell.language(), "whatsNewTitle");
    if let Some(window) = app.get_webview_window(LABEL) {
        if let Err(error) = window
            .set_title(title)
            .and_then(|()| window.reload())
            .and_then(|()| window.unminimize())
            .and_then(|()| window.show())
            .and_then(|()| window.set_focus())
        {
            open_failed(app, error).await;
        }
        return;
    }
    let navigation_app = app.clone();
    let popup_app = app.clone();
    let builder = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App(PAGE.into()))
        .title(title)
        .inner_size(760.0, 680.0)
        .resizable(true)
        .visible(false)
        .on_navigation(move |url| {
            let allowed = window::is_app_page_url(url, PAGE);
            if !allowed {
                window::open_external(&navigation_app, url);
            }
            allowed
        })
        .on_new_window(move |url, _| {
            window::open_external(&popup_app, &url);
            NewWindowResponse::Deny
        })
        .on_document_title_changed(|window, _| {
            let lang = app::state(window.app_handle()).language();
            let _ = window.set_title(texts::text(&lang, "whatsNewTitle"));
        })
        .on_page_load(|window, payload| {
            if payload.event() == PageLoadEvent::Finished {
                let _ = window.show();
            }
        });
    let builder = match crate::paths::debug_webview_dir() {
        Some(directory) => builder.data_directory(directory),
        None => builder,
    };
    // 2026-11-09: WebView2 windows sharing a profile require identical browser arguments, including CDP.
    let result = match window::debug_browser_args() {
        Some(args) => builder.additional_browser_args(&args),
        None => builder,
    }
    .build();
    match result {
        Ok(window) => {
            // 2026-11-09: Restart Manager can target this HWND without notifying the main window.
            let guarded = window.clone();
            let log = shell.log.clone();
            if let Err(error) = window.run_on_main_thread(move || {
                if let Err(error) = crate::session_end::install(&guarded) {
                    log.write(format!("what's new session guard failed: {error}"));
                }
            }) {
                shell
                    .log
                    .write(format!("what's new session guard failed: {error}"));
            }
            shell.log.write("what's new window opened");
        }
        Err(error) => open_failed(app, error).await,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn window_open_failure_is_localized_with_the_cause() {
        for (language, expected) in [
            ("en", "Could not open What's new: test error"),
            ("ru", "Не удалось открыть окно «Что нового»: test error"),
        ] {
            assert_eq!(
                texts::format(language, "whatsNewOpenFailed", "error", "test error"),
                expected
            );
        }
    }

    #[test]
    fn whats_new_requires_its_window_and_bundled_page() {
        let url = Url::parse("http://tauri.localhost/whats-new.html?range#version").unwrap();
        assert!(authorized(LABEL, &url));
        assert!(!authorized("main", &url));
        for url in [
            "http://tauri.localhost/",
            "http://tauri.localhost/index.html",
            "http://127.0.0.1:4318/whats-new.html",
            "https://tauri.localhost/whats-new.html",
            "http://tauri.localhost.evil/whats-new.html",
        ] {
            assert!(!authorized(LABEL, &Url::parse(url).unwrap()), "{url}");
        }
    }

    #[test]
    fn changelog_file_choice_uses_russian_only_when_present() {
        let root =
            std::env::temp_dir().join(format!("deckmate-changelog-test-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        assert_eq!(changelog_path(&root, "ru"), root.join("CHANGELOG.md"));
        std::fs::write(root.join("CHANGELOG.ru.md"), "# Изменения").unwrap();
        assert_eq!(changelog_path(&root, "ru"), root.join("CHANGELOG.ru.md"));
        assert_eq!(changelog_path(&root, "en"), root.join("CHANGELOG.md"));
        assert_eq!(changelog_path(&root, "de"), root.join("CHANGELOG.md"));
        std::fs::remove_dir_all(root).unwrap();
    }
}
