use crate::{app, log::Log, menu, settings::PendingUpdate, texts, whats_new, window};
use chrono::{DateTime, Utc};
use serde_json::Value;
use std::{
    fs, io,
    path::Path,
    sync::{atomic::Ordering, Arc, Mutex},
    time::Duration,
};
use tauri::{
    window::{ProgressBarState, ProgressBarStatus},
    AppHandle, Manager,
};
use tauri_plugin_dialog::{
    DialogExt, MessageDialogButtons, MessageDialogKind, MessageDialogResult,
};
use tauri_plugin_updater::{RemoteRelease, Update, Updater, UpdaterExt};

const DOWNLOADS_URL: &str = "https://github.com/pierkulakov/deckmate/releases/latest";
const CHECK_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);
const CACHE: &str = "update-cache";

pub struct ReadyUpdate {
    pub update: Update,
    pub bytes: Vec<u8>,
}

#[derive(Default)]
pub struct State {
    operation: tokio::sync::Mutex<()>,
    ready: Mutex<Option<Arc<ReadyUpdate>>>,
    notified_version: Mutex<Option<String>>,
    wake: tokio::sync::Notify,
}

impl State {
    pub fn busy(&self) -> bool {
        self.operation.try_lock().is_err()
    }

    pub fn ready_version(&self) -> Option<String> {
        self.ready
            .lock()
            .unwrap()
            .as_ref()
            .map(|ready| ready.update.version.clone())
    }
}

pub fn enabled() -> bool {
    !cfg!(debug_assertions) && !std::env::args_os().any(|arg| arg == "--self-test")
}

fn should_offer(current: &str, release: &RemoteRelease, skipped: Option<&str>) -> bool {
    let Ok(current) = current.parse() else {
        return false;
    };
    let skipped = skipped.and_then(|version| version.trim_start_matches('v').parse().ok());
    release.version.cmp_precedence(&current).is_gt()
        && !skipped.is_some_and(|version| release.version.cmp_precedence(&version).is_eq())
}

fn is_portable(executable: &Path) -> bool {
    !executable.with_file_name("uninstall.exe").is_file()
}

pub fn portable() -> io::Result<bool> {
    Ok(is_portable(&std::env::current_exe()?))
}

fn builder(app: &AppHandle) -> tauri_plugin_updater::Result<Updater> {
    let shell = app::state(app);
    let skipped = shell
        .settings
        .lock()
        .unwrap()
        .updates
        .skipped_version
        .clone();
    let log = shell.log.clone();
    app.updater_builder()
        .timeout(Duration::from_secs(30))
        .version_comparator(move |current, release| {
            should_offer(&current.to_string(), &release, skipped.as_deref())
        })
        // 2026-11-09: the default hook destroys Tauri resources before ShellExecuteW can fail.
        // app::install_update has saved and stopped the server; keep the UI usable for recovery.
        .on_before_exit(move || log.write("updater launching installer"))
        .build()
}

fn until_next_check(last: Option<&str>, now: DateTime<Utc>) -> Duration {
    let Some(last) = last.and_then(|value| DateTime::parse_from_rfc3339(value).ok()) else {
        return Duration::ZERO;
    };
    let elapsed = (now - last.with_timezone(&Utc))
        .to_std()
        .unwrap_or_default();
    CHECK_INTERVAL.saturating_sub(elapsed)
}

pub fn toggle_auto_check(app: &AppHandle) {
    let shell = app::state(app);
    let enabled = {
        let mut settings = shell.settings.lock().unwrap();
        settings.updates.auto_check = !settings.updates.auto_check;
        settings.updates.auto_check
    };
    shell
        .log
        .write(format!("updater automatic checks: {enabled}"));
    shell.save();
    shell.updates.wake.notify_one();
    menu::rebuild(app);
}

pub fn start(app: AppHandle) {
    if !enabled() {
        app::state(&app)
            .log
            .write("updater disabled in debug/self-test mode");
        return;
    }
    tauri::async_runtime::spawn(async move {
        let first_check = tokio::time::Instant::now() + Duration::from_secs(15);
        let shell = app::state(&app);
        let guard = shell.updates.operation.lock().await;
        menu::rebuild(&app);
        after_start(&app).await;
        cleanup_temporary(&std::env::temp_dir(), &shell.log);
        if portable().unwrap_or(true) {
            clear_cache(&shell);
        } else {
            restore_cache(&app);
        }
        drop(guard);
        menu::rebuild(&app);
        tokio::time::sleep_until(first_check).await;
        // 2026-11-09: each start gets a check even if lastCheck is recent, so Later reminds on restart.
        let automatic = shell.settings.lock().unwrap().updates.auto_check;
        if automatic {
            check(&app, false).await;
        }
        remind_cached(&app).await;
        loop {
            let delay = {
                let settings = shell.settings.lock().unwrap();
                settings
                    .updates
                    .auto_check
                    .then(|| until_next_check(settings.updates.last_check.as_deref(), Utc::now()))
            };
            match delay {
                Some(delay) => tokio::select! {
                    _ = tokio::time::sleep(delay) => check(&app, false).await,
                    _ = shell.updates.wake.notified() => (),
                },
                None => shell.updates.wake.notified().await,
            }
            if shell.closing.load(Ordering::SeqCst) {
                return;
            }
        }
    });
}

fn progress(app: &AppHandle, status: ProgressBarStatus, value: Option<u64>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_progress_bar(ProgressBarState {
            status: Some(status),
            progress: value,
        });
    }
}

pub async fn check(app: &AppHandle, manual: bool) {
    if !enabled() {
        return;
    }
    let shell = app::state(app);
    if shell.closing.load(Ordering::SeqCst) {
        return;
    }
    let guard = if manual {
        let Ok(guard) = shell.updates.operation.try_lock() else {
            return;
        };
        guard
    } else {
        shell.updates.operation.lock().await
    };
    if shell.closing.load(Ordering::SeqCst) {
        return;
    }
    if !manual && !shell.settings.lock().unwrap().updates.auto_check {
        return;
    }
    menu::rebuild(app);
    shell
        .log
        .write(format!("updater checking (manual: {manual})"));
    shell.settings.lock().unwrap().updates.last_check = Some(Utc::now().to_rfc3339());
    shell.save();
    shell.updates.wake.notify_one();
    if manual {
        progress(app, ProgressBarStatus::Indeterminate, None);
    }
    let result = check_inner(app, manual).await;
    if manual {
        progress(app, ProgressBarStatus::None, None);
    }
    if let Err(error) = result {
        shell
            .log
            .write(format!("updater check/download failed: {error}"));
        if manual && !shell.closing.load(Ordering::SeqCst) {
            show_error(app, "updateCheckFailed", &error).await;
        }
    }
    drop(guard);
    menu::rebuild(app);
}

async fn check_inner(app: &AppHandle, manual: bool) -> Result<(), String> {
    let shell = app::state(app);
    let found = builder(app)
        .map_err(|error| error.to_string())?
        .check()
        .await
        .map_err(|error| error.to_string())?;
    if shell.closing.load(Ordering::SeqCst) {
        return Ok(());
    }
    let Some(mut update) = found else {
        shell.log.write("updater no newer non-skipped version");
        if manual {
            progress(app, ProgressBarStatus::None, None);
            let lang = shell.language();
            let title = texts::text(&lang, "upToDate");
            dialog(
                app,
                title,
                title,
                MessageDialogButtons::OkCustom(texts::text(&lang, "ok").into()),
                MessageDialogKind::Info,
            )
            .await;
        }
        return Ok(());
    };
    shell.log.write(format!("updater found {}", update.version));
    if !manual && shell.updates.notified_version.lock().unwrap().as_deref() == Some(&update.version)
    {
        return Ok(());
    }
    if portable().map_err(|error| error.to_string())? {
        if manual {
            progress(app, ProgressBarStatus::None, None);
        }
        offer(app, &update, true).await;
        return Ok(());
    }
    let cached = shell.updates.ready.lock().unwrap().clone();
    let ready = if let Some(ready) = cached.filter(|ready| ready.update.version == update.version) {
        ready
    } else {
        shell
            .log
            .write(format!("updater downloading {}", update.version));
        update.timeout = Some(Duration::from_secs(10 * 60));
        let mut downloaded = 0u64;
        let mut percentage = None;
        let bytes = update
            .download(
                |chunk, total| {
                    downloaded = downloaded.saturating_add(chunk as u64);
                    if manual {
                        let next = total.filter(|total| *total > 0).map(|total| {
                            downloaded
                                .saturating_mul(100)
                                .checked_div(total)
                                .unwrap_or(0)
                                .min(100)
                        });
                        if next != percentage {
                            progress(app, ProgressBarStatus::Normal, next);
                            percentage = next;
                        }
                    }
                },
                || {},
            )
            .await
            .map_err(|error| error.to_string())?;
        shell.log.write(format!(
            "updater downloaded and signature/version verified: {} ({} bytes)",
            update.version,
            bytes.len()
        ));
        let ready = Arc::new(ReadyUpdate { update, bytes });
        save_cache(&shell, &ready);
        *shell.updates.ready.lock().unwrap() = Some(ready.clone());
        ready
    };
    if manual {
        progress(app, ProgressBarStatus::None, None);
    }
    if !shell.closing.load(Ordering::SeqCst) {
        offer(app, &ready.update, false).await;
    }
    Ok(())
}

async fn remind_cached(app: &AppHandle) {
    let shell = app::state(app);
    let guard = shell.updates.operation.lock().await;
    let ready = shell.updates.ready.lock().unwrap().clone();
    if let Some(ready) = ready.filter(|ready| {
        shell.updates.notified_version.lock().unwrap().as_deref() != Some(&ready.update.version)
    }) {
        if !shell.closing.load(Ordering::SeqCst) {
            offer(app, &ready.update, false).await;
        }
    }
    drop(guard);
    menu::rebuild(app);
}

fn notes<'a>(raw: &'a Value, fallback: Option<&'a str>, language: &str) -> &'a str {
    let russian = (language == "ru")
        .then(|| raw["notes_ru"].as_str())
        .flatten()
        .filter(|value| !value.trim().is_empty());
    russian
        .or_else(|| raw["notes"].as_str())
        .or(fallback)
        .unwrap_or("")
}

#[derive(Debug, Default, PartialEq)]
struct NotesSummary {
    titles: Vec<String>,
    fixes: usize,
}

fn extract_summary(notes: &str) -> NotesSummary {
    let mut summary = NotesSummary::default();
    let mut section = String::new();
    let mut release = false;
    let mut fence = None;
    for line in notes.lines() {
        let line = line.trim_end();
        if line.starts_with("```") || line.starts_with("~~~") {
            let marker = &line[..3];
            if fence == Some(marker) {
                fence = None;
            } else if fence.is_none() {
                fence = Some(marker);
            }
            continue;
        }
        if fence.is_some() {
            continue;
        }
        if line.starts_with("## ") {
            if release {
                break;
            }
            release = true;
            section.clear();
        } else if let Some(heading) = line.strip_prefix("### ") {
            section = heading.trim_end_matches('#').trim().to_lowercase();
        } else if let Some(item) = line.strip_prefix("- ").or_else(|| line.strip_prefix("* ")) {
            match section.as_str() {
                "added" | "changed" | "добавлено" | "изменено" => {
                    if let Some((title, _)) = item
                        .strip_prefix("**")
                        .and_then(|item| item.split_once("**"))
                    {
                        if !title.trim().is_empty() {
                            summary.titles.push(title.trim().into());
                        }
                    }
                }
                "fixed" | "исправлено" => summary.fixes += 1,
                _ => (),
            }
        }
    }
    summary
}

fn summary_text(notes: &str, language: &str) -> String {
    let summary = extract_summary(notes);
    let mut lines: Vec<String> = summary
        .titles
        .iter()
        .take(6)
        .map(|title| {
            if title.chars().count() > 120 {
                format!("{}…", title.chars().take(120).collect::<String>())
            } else {
                title.clone()
            }
        })
        .collect();
    if summary.titles.len() > 6 {
        lines.push(texts::format(
            language,
            "updateMore",
            "count",
            summary.titles.len() - 6,
        ));
    }
    if summary.fixes > 0 {
        lines.push(texts::format(
            language,
            "updateFixes",
            "count",
            summary.fixes,
        ));
    }
    lines.join("\n")
}

fn chosen(result: &MessageDialogResult, language: &str, key: &str) -> bool {
    matches!(result, MessageDialogResult::Custom(label) if label == texts::text(language, key))
}

async fn offer(app: &AppHandle, update: &Update, portable: bool) {
    let shell = app::state(app);
    let language = shell.language();
    let key = if portable {
        "portableUpdates"
    } else {
        "updateReady"
    };
    let title = texts::format(&language, key, "version", &update.version);
    let summary = summary_text(
        notes(&update.raw_json, update.body.as_deref(), &language),
        &language,
    );
    let buttons = if portable {
        MessageDialogButtons::OkCancelCustom(
            texts::text(&language, "openDownloads").into(),
            texts::text(&language, "skipVersion").into(),
        )
    } else {
        MessageDialogButtons::YesNoCancelCustom(
            texts::text(&language, "installAndRestart").into(),
            texts::text(&language, "later").into(),
            texts::text(&language, "skipVersion").into(),
        )
    };
    *shell.updates.notified_version.lock().unwrap() = Some(update.version.clone());
    shell.log.write(format!(
        "updater offering {} (portable: {portable})",
        update.version
    ));
    let result = dialog(app, &title, &summary, buttons, MessageDialogKind::Info).await;
    if chosen(&result, &language, "skipVersion") {
        shell.settings.lock().unwrap().updates.skipped_version = Some(update.version.clone());
        *shell.updates.ready.lock().unwrap() = None;
        clear_cache(&shell);
        shell.save();
        shell
            .log
            .write(format!("updater skipped {}", update.version));
    } else if portable && chosen(&result, &language, "openDownloads") {
        open_downloads(app);
    } else if !portable && chosen(&result, &language, "installAndRestart") {
        install_locked(app).await;
    } else {
        // 2026-11-09: closing the dialog is Later, never an implicit persistent skip.
        shell.log.write(format!(
            "updater deferred {} until next start",
            update.version
        ));
    }
}

pub async fn install_ready(app: &AppHandle) {
    if !enabled() {
        return;
    }
    let shell = app::state(app);
    let Ok(guard) = shell.updates.operation.try_lock() else {
        return;
    };
    menu::rebuild(app);
    install_locked(app).await;
    drop(guard);
    menu::rebuild(app);
}

async fn install_locked(app: &AppHandle) {
    let shell = app::state(app);
    let ready = shell.updates.ready.lock().unwrap().clone();
    if let Some(ready) = ready {
        if let Err(error) = app::install_update(app, ready).await {
            shell.log.write(format!("updater install failed: {error}"));
            show_error(app, "updateFailed", &error).await;
        }
    }
}

async fn dialog(
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

fn open_downloads(app: &AppHandle) {
    app::state(app).log.write("updater opening download page");
    window::open_external(app, &DOWNLOADS_URL.parse().unwrap());
}

pub async fn show_error(app: &AppHandle, key: &str, detail: &str) {
    let language = app::state(app).language();
    let result = dialog(
        app,
        texts::text(&language, key),
        detail,
        MessageDialogButtons::OkCancelCustom(
            texts::text(&language, "openDownloads").into(),
            texts::text(&language, "ok").into(),
        ),
        MessageDialogKind::Warning,
    )
    .await;
    if chosen(&result, &language, "openDownloads") {
        open_downloads(app);
    }
}

#[derive(Debug, PartialEq)]
enum PendingAfterStart {
    None,
    Applied { from: String },
    NotApplied { version: String },
}

fn pending_after_start(pending: Option<&PendingUpdate>, running: &str) -> PendingAfterStart {
    match pending {
        None => PendingAfterStart::None,
        Some(pending) if pending.version == running => PendingAfterStart::Applied {
            from: pending.from.clone(),
        },
        Some(pending) => PendingAfterStart::NotApplied {
            version: pending.version.clone(),
        },
    }
}

async fn after_start(app: &AppHandle) {
    let shell = app::state(app);
    let running = app.package_info().version.to_string();
    let pending = shell.settings.lock().unwrap().updates.pending.take();
    let decision = pending_after_start(pending.as_ref(), &running);
    if decision == PendingAfterStart::None {
        return;
    }
    shell.save();
    match decision {
        PendingAfterStart::Applied { from } => {
            shell.log.write(format!(
                "updater applied: {from} -> {running}; pending cleared"
            ));
            clear_cache(&shell);
            whats_new::open(app, Some(from)).await;
        }
        PendingAfterStart::NotApplied { version } => {
            shell.log.write(format!(
                "updater not applied: expected {version}, running {running}; pending cleared"
            ));
            let message = texts::format(&shell.language(), "updateNotApplied", "version", version);
            show_error(app, "updateFailed", &message).await;
        }
        PendingAfterStart::None => (),
    }
}

fn save_cache(shell: &app::Shell, ready: &ReadyUpdate) {
    // 2026-11-09: Later must survive an offline restart, including when auto-check is disabled.
    let directory = shell.directory.join(CACHE);
    let result = (|| -> io::Result<()> {
        fs::create_dir_all(&directory)?;
        fs::write(directory.join("package.tmp"), &ready.bytes)?;
        fs::rename(directory.join("package.tmp"), directory.join("package.bin"))?;
        fs::write(
            directory.join("manifest.tmp"),
            serde_json::to_vec(&ready.update.raw_json)?,
        )?;
        fs::rename(
            directory.join("manifest.tmp"),
            directory.join("manifest.json"),
        )
    })();
    match result {
        Ok(()) => shell
            .log
            .write(format!("updater cached {}", ready.update.version)),
        Err(error) => {
            shell
                .log
                .write(format!("updater cache save failed: {error}"));
            clear_cache(shell);
        }
    }
}

fn restore_cache(app: &AppHandle) {
    let shell = app::state(app);
    let directory = shell.directory.join(CACHE);
    if !directory.exists() {
        return;
    }
    let result = (|| -> Result<Option<ReadyUpdate>, String> {
        let bytes = fs::read(directory.join("manifest.json")).map_err(|error| error.to_string())?;
        let raw = serde_json::from_slice(&bytes).map_err(|error| error.to_string())?;
        let Some(update) = builder(app)
            .map_err(|error| error.to_string())?
            .restore_update(raw)
            .map_err(|error| error.to_string())?
        else {
            return Ok(None);
        };
        let bytes = fs::read(directory.join("package.bin")).map_err(|error| error.to_string())?;
        update.verify(&bytes).map_err(|error| error.to_string())?;
        Ok(Some(ReadyUpdate { update, bytes }))
    })();
    match result {
        Ok(Some(ready)) => {
            shell.log.write(format!(
                "updater restored and signature/version verified: {}",
                ready.update.version
            ));
            *shell.updates.ready.lock().unwrap() = Some(Arc::new(ready));
            menu::rebuild(app);
        }
        other => {
            if let Err(error) = other {
                shell.log.write(format!("updater cache rejected: {error}"));
            }
            clear_cache(&shell);
        }
    }
}

fn clear_cache(shell: &app::Shell) {
    match fs::remove_dir_all(shell.directory.join(CACHE)) {
        Ok(()) => shell.log.write("updater cache removed"),
        Err(error) if error.kind() == io::ErrorKind::NotFound => (),
        Err(error) => shell
            .log
            .write(format!("updater cache cleanup failed: {error}")),
    }
}

fn updater_temporary_name(name: &str) -> bool {
    name.strip_prefix("Deckmate-")
        .and_then(|name| name.split_once("-updater-"))
        .is_some_and(|(version, suffix)| !version.is_empty() && !suffix.is_empty())
}

fn cleanup_temporary(directory: &Path, log: &Log) {
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) => {
            log.write(format!("updater temporary cleanup failed: {error}"));
            return;
        }
    };
    for entry in entries.flatten() {
        if !updater_temporary_name(&entry.file_name().to_string_lossy())
            || !entry
                .file_type()
                .is_ok_and(|kind| kind.is_dir() && !kind.is_symlink())
        {
            continue;
        }
        let path = entry.path();
        match fs::remove_dir_all(&path) {
            Ok(()) => log.write(format!(
                "updater temporary folder removed: {}",
                path.display()
            )),
            Err(error) => log.write(format!(
                "updater temporary cleanup failed: {}: {error}",
                path.display()
            )),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn release(version: &str) -> RemoteRelease {
        serde_json::from_value(json!({"version":version, "url":DOWNLOADS_URL, "signature":"test"}))
            .unwrap()
    }

    #[test]
    fn should_offer_requires_newer_semver_and_not_skipped() {
        assert!(should_offer("0.9.0", &release("0.10.0"), None));
        assert!(should_offer(
            "1.0.0-beta.2",
            &release("1.0.0-beta.11"),
            None
        ));
        assert!(should_offer("1.0.0-rc.1", &release("1.0.0"), None));
        assert!(!should_offer("1.0.0", &release("1.0.0-rc.2"), None));
        assert!(!should_offer("1.0.0", &release("1.0.0+build.2"), None));
        assert!(!should_offer("1.0.0", &release("0.9.9"), None));
        assert!(!should_offer("0.9.0", &release("1.0.0"), Some("v1.0.0")));
        assert!(!should_offer(
            "0.9.0",
            &release("1.0.0+build.2"),
            Some("1.0.0")
        ));
        assert!(should_offer("0.9.0", &release("1.0.1"), Some("1.0.0")));
        assert!(!should_offer("bad", &release("1.0.0"), None));
    }

    #[test]
    fn portable_detection_requires_an_adjacent_uninstaller_file() {
        let root =
            std::env::temp_dir().join(format!("deckmate-portable-test-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let executable = root.join("Deckmate.exe");
        assert!(is_portable(&executable));
        fs::create_dir(root.join("uninstall.exe")).unwrap();
        assert!(is_portable(&executable));
        fs::remove_dir(root.join("uninstall.exe")).unwrap();
        fs::write(root.join("uninstall.exe"), []).unwrap();
        assert!(!is_portable(&executable));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn pending_after_start_distinguishes_success_failure_and_no_update() {
        let pending = PendingUpdate {
            version: "0.7.0".into(),
            from: "0.5.0".into(),
            extra: Default::default(),
        };
        assert_eq!(pending_after_start(None, "0.7.0"), PendingAfterStart::None);
        assert_eq!(
            pending_after_start(Some(&pending), "0.7.0"),
            PendingAfterStart::Applied {
                from: "0.5.0".into()
            }
        );
        assert_eq!(
            pending_after_start(Some(&pending), "0.5.0"),
            PendingAfterStart::NotApplied {
                version: "0.7.0".into()
            }
        );
    }

    #[test]
    fn notes_summary_extracts_titles_and_counts_top_level_fixes() {
        let notes = "## [0.6.0]\n### Added\n- **Spaces.** Long description.\n  - **Nested.** Ignore.\n- No bold title.\n### Changed\n* **Cards.** Details\n### Fixed\n- One\n  continued\n  - Nested\n* Two\n```md\n- Not a fix\n```\n### Removed\n- Old feature\n## [0.5.0]\n### Fixed\n- Old fix";
        assert_eq!(
            extract_summary(notes),
            NotesSummary {
                titles: vec!["Spaces.".into(), "Cards.".into()],
                fixes: 2
            }
        );
        assert_eq!(summary_text(notes, "en"), "Spaces.\nCards.\nFixed: 2");
        let russian = "### Добавлено\n- **Колоды.** Подробности\n### Изменено\n- **Карточки.** Ещё\n### Исправлено\n- Ошибка";
        assert_eq!(
            summary_text(russian, "ru"),
            "Колоды.\nКарточки.\nИсправлено: 1"
        );
        assert_eq!(
            extract_summary("unstructured notes"),
            NotesSummary::default()
        );
    }

    #[test]
    fn notes_language_falls_back_to_english() {
        let raw = json!({"notes":"English", "notes_ru":"Русский"});
        assert_eq!(notes(&raw, None, "ru"), "Русский");
        assert_eq!(notes(&raw, None, "en"), "English");
        assert_eq!(
            notes(&json!({"notes":"English", "notes_ru":" "}), None, "ru"),
            "English"
        );
        assert_eq!(notes(&Value::Null, Some("body"), "ru"), "body");
    }

    #[test]
    fn last_check_schedules_daily_and_handles_clock_changes() {
        let now = DateTime::parse_from_rfc3339("2026-11-09T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        assert_eq!(until_next_check(None, now), Duration::ZERO);
        assert_eq!(until_next_check(Some("bad"), now), Duration::ZERO);
        assert_eq!(
            until_next_check(Some("2026-11-08T12:00:00Z"), now),
            Duration::ZERO
        );
        assert_eq!(
            until_next_check(Some("2026-11-09T06:00:00Z"), now),
            Duration::from_secs(18 * 3600)
        );
        assert_eq!(
            until_next_check(Some("2026-11-10T12:00:00Z"), now),
            CHECK_INTERVAL
        );
    }

    #[test]
    fn temporary_cleanup_only_removes_deckmate_updater_directories() {
        let root = std::env::temp_dir().join(format!(
            "deckmate-updater-cleanup-test-{}",
            std::process::id()
        ));
        fs::create_dir_all(root.join("Deckmate-0.6.0-updater-test")).unwrap();
        fs::create_dir_all(root.join("Other-0.6.0-updater-test")).unwrap();
        fs::create_dir_all(root.join("Deckmate-updater-test")).unwrap();
        fs::write(root.join("Deckmate-0.6.0-updater-file"), []).unwrap();
        let log = Log::open(&root);
        cleanup_temporary(&root, &log);
        assert!(!root.join("Deckmate-0.6.0-updater-test").exists());
        assert!(root.join("Other-0.6.0-updater-test").exists());
        assert!(root.join("Deckmate-updater-test").exists());
        assert!(root.join("Deckmate-0.6.0-updater-file").exists());
        drop(log);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn closing_a_dialog_does_not_skip_a_version() {
        assert!(!chosen(&MessageDialogResult::Cancel, "en", "skipVersion"));
        assert!(chosen(
            &MessageDialogResult::Custom("Skip this version".into()),
            "en",
            "skipVersion"
        ));
    }
}
