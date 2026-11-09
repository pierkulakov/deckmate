use crate::{
    log::Log,
    menu,
    paths::{self, Programs},
    server::{self, Failure, Server},
    settings::{PendingUpdate, Settings},
    texts, unsaved, updater, whats_new, window,
};
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{oneshot, watch};

#[derive(Clone)]
pub struct Session {
    pub launch: u64,
    pub folder: String,
    pub url: Option<String>,
    pub process: Server,
}

pub struct Loading {
    pub url: String,
    pub navigation: Option<u64>,
    pub sender: oneshot::Sender<Result<(), String>>,
}

pub struct Shell {
    pub directory: PathBuf,
    pub programs: Programs,
    pub deckmate_version: String,
    pub locale: String,
    pub settings: Mutex<Settings>,
    pub log: Log,
    pub current: Mutex<Option<Session>>,
    pub dialog_folder: Mutex<Option<String>>,
    pub pending_status: Mutex<Option<Value>>,
    pub launch: watch::Sender<u64>,
    pub lifecycle: tokio::sync::Mutex<()>,
    pub closing: AtomicBool,
    pub quit_requested: AtomicBool,
    pub quit_ready: AtomicBool,
    pub unsaved: unsaved::State,
    pub bounds_generation: AtomicU64,
    pub board_script: Mutex<Option<String>>,
    pub loading: Mutex<Option<Loading>>,
    pub webview_handlers: tokio::sync::OnceCell<Result<(), String>>,
    pub updates: updater::State,
    pub whats_new: whats_new::State,
    pub startup_project: Option<String>,
    pub first_show: window::FirstShow,
}

pub fn state(app: &AppHandle) -> Arc<Shell> {
    app.state::<Arc<Shell>>().inner().clone()
}

impl Shell {
    pub fn new(resources: Option<PathBuf>) -> std::io::Result<Self> {
        let directory = paths::settings_dir()?;
        let programs = Programs::resolve(resources)?;
        let locale = crate::settings::system_locale();
        let log = Log::open(&directory);
        let settings = Settings::load(&directory, &locale, &log);
        let startup_project = settings
            .last_project
            .clone()
            .filter(|folder| !paths::is_network_path(folder) && Path::new(folder).is_dir());
        let first_show = window::FirstShow::new(startup_project.is_some());
        Ok(Self {
            deckmate_version: programs.deckmate_version(),
            directory,
            programs,
            locale,
            settings: Mutex::new(settings),
            log,
            current: Mutex::new(None),
            dialog_folder: Mutex::new(None),
            pending_status: Mutex::new(None),
            launch: watch::channel(0).0,
            lifecycle: tokio::sync::Mutex::new(()),
            closing: AtomicBool::new(false),
            quit_requested: AtomicBool::new(false),
            quit_ready: AtomicBool::new(false),
            unsaved: unsaved::State::default(),
            bounds_generation: AtomicU64::new(0),
            board_script: Mutex::new(None),
            loading: Mutex::new(None),
            webview_handlers: tokio::sync::OnceCell::new(),
            updates: updater::State::default(),
            whats_new: whats_new::State::default(),
            startup_project,
            first_show,
        })
    }

    pub fn language(&self) -> String {
        self.settings.lock().unwrap().language.clone()
    }

    pub fn failure(&self, code: &str, key: &str) -> Failure {
        Failure::new(code, texts::text(&self.language(), key))
    }

    pub fn update_settings<T>(
        &self,
        update: impl FnOnce(&mut Settings) -> Result<T, Failure>,
    ) -> Result<T, Failure> {
        // 2026-11-09: hold the lock across clone, validation and rename so writers cannot persist stale snapshots.
        let mut settings = self.settings.lock().unwrap();
        let mut next = settings.clone();
        let output = update(&mut next)?;
        next.save(&self.directory).map_err(|error| {
            self.log.write(format!("settings save failed: {error}"));
            Failure::new(
                "save-failed",
                texts::format(&next.language, "saveFailed", "error", error),
            )
        })?;
        *settings = next;
        Ok(output)
    }

    pub fn save(&self) -> Result<(), Failure> {
        self.update_settings(|_| Ok(()))
    }

    fn begin_quit(&self) -> bool {
        // 2026-11-09: closing also covers install/recovery, so retain the user's quit separately.
        self.quit_requested.store(true, Ordering::SeqCst);
        !self.closing.swap(true, Ordering::SeqCst)
    }

    pub fn next_launch(&self) -> u64 {
        let mut next = 0;
        self.launch.send_modify(|counter| {
            *counter += 1;
            next = *counter;
        });
        if let Some(current) = self.current.lock().unwrap().as_ref() {
            current.process.request_stop();
        }
        next
    }

    pub fn replaced(&self, launch: u64) -> bool {
        *self.launch.borrow() != launch
    }

    fn require_launch(&self, launch: u64) -> Result<(), Failure> {
        if self.closing.load(Ordering::SeqCst) {
            return Err(self.failure("closed", "closed"));
        }
        if self.replaced(launch) {
            return Err(self.failure("superseded", "superseded"));
        }
        Ok(())
    }

    pub fn check_folder(&self, input: &Value) -> Result<String, Failure> {
        let folder = input
            .as_str()
            .filter(|folder| paths::is_absolute(folder))
            .ok_or_else(|| self.failure("invalid-path", "absolutePath"))?;
        if paths::is_network_path(folder)
            && self.dialog_folder.lock().unwrap().as_deref() != Some(folder)
        {
            return Err(self.failure("invalid-path", "networkPath"));
        }
        paths::resolve(folder).map_err(|error| Failure::new("invalid-path", error.to_string()))
    }

    pub fn status(&self, app: &AppHandle, value: Value) {
        *self.pending_status.lock().unwrap() = Some(value.clone());
        if self
            .current
            .lock()
            .unwrap()
            .as_ref()
            .is_none_or(|current| current.url.is_none())
        {
            let _ = app.emit_to("main", "desktop://status", value);
        }
    }

    pub fn replay_status(&self, app: &AppHandle) {
        if let Some(status) = self.pending_status.lock().unwrap().clone() {
            let _ = app.emit_to("main", "desktop://status", status);
        }
    }

    pub async fn stop(&self) {
        let current = self.current.lock().unwrap().take();
        if let Some(current) = current {
            current.process.stop().await;
        }
    }
}

pub fn ok() -> Value {
    json!({"ok": true})
}
pub fn result(result: Result<(), Failure>) -> Value {
    match result {
        Ok(()) => ok(),
        Err(error) => json!(error),
    }
}

async fn launcher_locked(app: &AppHandle, shell: &Shell, status: Option<Value>) {
    if let Some(status) = status.as_ref().filter(|status| status["phase"] == "error") {
        shell.log.write(format!(
            "project launch failed: {}: {}",
            status["code"], status["message"]
        ));
    }
    unsaved::leave(app);
    shell.stop().await;
    *shell.pending_status.lock().unwrap() = status;
    menu::rebuild(app);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_title("Deckmate");
        if let Err(error) = window::navigate_launcher(&window).await {
            shell.log.write(format!("launcher load failed: {error}"));
        }
    }
}

pub async fn show_launcher(app: &AppHandle, status: Option<Value>) -> Result<(), Failure> {
    let shell = state(app);
    if shell.closing.load(Ordering::SeqCst) {
        return Err(shell.failure("closed", "closed"));
    }
    unsaved::confirm(app).await?;
    unsaved::leave(app);
    let launch = shell.next_launch();
    let _guard = shell.lifecycle.lock().await;
    shell.require_launch(launch)?;
    launcher_locked(app, &shell, status).await;
    Ok(())
}

fn error_status(folder: &str, failure: &Failure) -> Value {
    json!({"phase":"error", "path":folder, "code":failure.code, "message":failure.message})
}

pub async fn open_project(app: &AppHandle, folder: String) -> Result<(), Failure> {
    let shell = state(app);
    if shell.closing.load(Ordering::SeqCst) {
        return Err(shell.failure("closed", "closed"));
    }
    let folder =
        paths::resolve(&folder).map_err(|error| Failure::new("invalid-path", error.to_string()))?;
    if !Path::new(&folder).is_dir() {
        return Err(Failure::new(
            "missing",
            texts::format(&shell.language(), "missing", "path", &folder),
        ));
    }
    unsaved::confirm(app).await?;
    unsaved::leave(app);
    let launch = shell.next_launch();
    let _guard = shell.lifecycle.lock().await;
    shell.require_launch(launch)?;
    shell.stop().await;
    shell.require_launch(launch)?;
    shell.status(app, json!({"phase":"starting", "path":folder}));
    let started = start_project(app, &shell, &folder, launch).await;
    match started {
        Ok(()) => Ok(()),
        Err(_) if shell.closing.load(Ordering::SeqCst) => Err(shell.failure("closed", "closed")),
        Err(_) if shell.replaced(launch) => Err(shell.failure("superseded", "superseded")),
        Err(error) => {
            launcher_locked(app, &shell, Some(error_status(&folder, &error))).await;
            Err(error)
        }
    }
}

async fn start_project(
    app: &AppHandle,
    shell: &Shell,
    folder: &str,
    launch: u64,
) -> Result<(), Failure> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| shell.failure("closed", "closed"))?;
    crate::webview::install(&window)
        .await
        .map_err(|error| Failure::new("load-failed", error))?;
    let saved_port = shell.settings.lock().unwrap().server_port;
    let port = server::choose_port(saved_port)
        .map_err(|error| Failure::new("start-failed", error.to_string()))?;
    if saved_port != Some(port) {
        shell.update_settings(|settings| {
            settings.server_port = Some(port);
            Ok(())
        })?;
    }
    let (process, ready) = server::start_on_port(
        &shell.programs,
        &shell.directory,
        folder,
        shell.log.clone(),
        shell.language(),
        port,
    )
    .map_err(|error| Failure::new("start-failed", error.to_string()))?;
    *shell.current.lock().unwrap() = Some(Session {
        launch,
        folder: folder.into(),
        url: None,
        process: process.clone(),
    });
    if shell.replaced(launch) {
        process.request_stop();
    }
    let url = ready
        .await
        .map_err(|error| Failure::new("start-failed", error.to_string()))??;
    if shell.replaced(launch) {
        process.stop().await;
        return Err(shell.failure("superseded", "superseded"));
    }
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| shell.failure("closed", "closed"))?;
    shell.status(app, json!({"phase":"ready", "path":folder}));
    if let Some(current) = shell.current.lock().unwrap().as_mut() {
        current.url = Some(url.clone());
    }
    shell.update_settings(|settings| {
        settings.remember(folder);
        Ok(())
    })?;
    menu::rebuild(app);
    let _ = window.set_title(&format!("Deckmate — {}", paths::project_name(folder)));
    // 2026-11-09: finish registering the script before cancellation can hand this webview to another launch.
    crate::webview::board_script(&window, Some(url.clone()))
        .await
        .map_err(|error| Failure::new("load-failed", error))?;
    let mut cancellation = shell.launch.subscribe();
    cancellation.borrow_and_update();
    if shell.replaced(launch) {
        return Err(shell.failure("superseded", "superseded"));
    }
    let loaded = tokio::select! {
        result = window::navigate_board(&window, &url) => result.map_err(|error| Failure::new("load-failed", error)),
        _ = cancellation.changed() => Err(shell.failure("superseded", "superseded")),
        exit = process.exited() => Err(Failure::new("start-failed", texts::format(&shell.language(), "serverStopped", "code", server::exit_code(exit.code)))),
    };
    shell.loading.lock().unwrap().take();
    loaded?;
    watch_exit(app.clone(), process, launch, folder.into());
    Ok(())
}

fn watch_exit(app: AppHandle, process: Server, launch: u64, folder: String) {
    tauri::async_runtime::spawn(async move {
        let exit = process.exited().await;
        let shell = state(&app);
        let _guard = shell.lifecycle.lock().await;
        if exit.expected || shell.replaced(launch) {
            return;
        }
        if shell
            .current
            .lock()
            .unwrap()
            .as_ref()
            .is_none_or(|current| current.launch != launch)
        {
            return;
        }
        let failure = Failure::new(
            "start-failed",
            texts::format(
                &shell.language(),
                "serverStopped",
                "code",
                server::exit_code(exit.code),
            ),
        );
        shell.next_launch();
        launcher_locked(&app, &shell, Some(error_status(&folder, &failure))).await;
    });
}

pub async fn create_project(app: &AppHandle, options: Value) -> Result<(), Failure> {
    let shell = state(app);
    if shell.closing.load(Ordering::SeqCst) {
        return Err(shell.failure("closed", "closed"));
    }
    let launch = *shell.launch.borrow();
    // 2026-11-09: init owns a Job too; install and quit must wait for its writes to finish.
    let guard = shell.lifecycle.lock().await;
    shell.require_launch(launch)?;
    let folder = shell.check_folder(&options["folder"])?;
    match std::fs::read_dir(&folder) {
        Ok(mut entries) => match entries.next() {
            Some(Ok(_)) => {
                return Err(Failure::new(
                    "not-empty",
                    texts::format(&shell.language(), "notEmpty", "path", &folder),
                ))
            }
            Some(Err(error)) => return Err(Failure::new("invalid-path", error.to_string())),
            None => (),
        },
        Err(_) if Path::new(&folder).is_file() => {
            return Err(Failure::new(
                "not-empty",
                texts::format(&shell.language(), "notEmpty", "path", &folder),
            ))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
        Err(_) => {
            return Err(Failure::new(
                "invalid-path",
                texts::format(&shell.language(), "unreadable", "path", &folder),
            ))
        }
    }
    server::initialize(&shell.programs, &folder, &shell.language(), &shell.log).await?;
    shell.require_launch(launch)?;
    drop(guard);
    open_project(app, folder).await
}

pub async fn startup(app: AppHandle) {
    let shell = state(&app);
    let last = shell.settings.lock().unwrap().last_project.clone();
    if let Some(last) = last {
        if paths::is_network_path(&last) {
            return;
        }
        if !Path::new(&last).is_dir() {
            let _ = shell.update_settings(|settings| {
                settings.last_project = None;
                Ok(())
            });
            let failure = Failure::new(
                "missing",
                texts::format(&shell.language(), "missing", "path", &last),
            );
            shell.status(&app, error_status(&last, &failure));
        } else if shell.startup_project.as_deref() == Some(&last) {
            shell.status(&app, json!({"phase":"ready", "path":last}));
            let _ = open_project(&app, last).await;
        }
    }
    window::finish_startup(&app);
}

pub fn request_quit(app: &AppHandle) {
    let shell = state(app);
    if shell.closing.load(Ordering::SeqCst) {
        shell.quit_requested.store(true, Ordering::SeqCst);
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if unsaved::confirm(&app).await.is_err() || !shell.begin_quit() {
            return;
        }
        window::save_on_exit(&app);
        shell.next_launch();
        let _guard = shell.lifecycle.lock().await;
        shell.stop().await;
        shell.quit_ready.store(true, Ordering::SeqCst);
        app.exit(0);
    });
}

pub fn restart_after_browser_failure(app: &AppHandle) {
    let shell = state(app);
    if shell.closing.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = shell.save();
        shell.next_launch();
        let _guard = shell.lifecycle.lock().await;
        shell.stop().await;
        shell.quit_ready.store(true, Ordering::SeqCst);
        app.restart();
    });
}

pub async fn install_update(
    app: &AppHandle,
    ready: Arc<updater::ReadyUpdate>,
) -> Result<(), String> {
    let shell = state(app);
    if !updater::enabled() || updater::portable().map_err(|error| error.to_string())? {
        return Err(texts::text(&shell.language(), "installUnavailable").into());
    }
    if unsaved::confirm(app).await.is_err() {
        return Ok(());
    }
    if shell.closing.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    if let Some(window) = app.get_webview_window("main") {
        window::capture_bounds(&window);
    }
    shell.bounds_generation.fetch_add(1, Ordering::SeqCst);
    if let Err(error) = shell.save() {
        shell.closing.store(false, Ordering::SeqCst);
        return Err(error.message);
    }
    unsaved::leave(app);
    let launch = shell.next_launch();
    let _guard = shell.lifecycle.lock().await;
    let restore = recovery_folder(shell.current.lock().unwrap().as_ref());
    shell.log.write(format!(
        "updater stopping project before installing {}",
        ready.update.version
    ));
    shell.stop().await;
    shell.log.write("updater project stopped");
    let dry_run = updater::dry_run();
    let saved = shell
        .update_settings(|settings| {
            settings.updates.pending = Some(PendingUpdate {
                version: ready.update.version.clone(),
                from: app.package_info().version.to_string(),
                extra: Default::default(),
            });
            Ok(())
        })
        .map_err(|error| error.message);
    let result = match saved {
        Ok(()) => {
            shell.log.write(format!(
                "updater pending saved; installing {}",
                ready.update.version
            ));
            // 2026-11-09: Windows exits inside install, bypassing request_quit and Rust destructors.
            let log = shell.log.clone();
            tauri::async_runtime::spawn_blocking(move || {
                if dry_run {
                    ready.update.verify(&ready.bytes)?;
                    log.write(format!(
                        "updater dry run verified {} {}",
                        ready.update.version,
                        ready.bytes.len()
                    ));
                    Ok(())
                } else {
                    ready.update.install(&ready.bytes)
                }
            })
            .await
            .map_err(|error| error.to_string())
            .and_then(|result| result.map_err(|error| error.to_string()))
        }
        Err(error) => Err(error),
    };
    if result.is_ok() && !dry_run {
        shell.quit_ready.store(true, Ordering::SeqCst);
        app.exit(0);
        return result;
    }
    let _ = shell.update_settings(|settings| {
        settings.updates.pending = None;
        Ok(())
    });
    shell.log.write(if dry_run && result.is_ok() {
        "updater dry run finished; pending cleared, restoring project"
    } else {
        "updater install returned an error; pending cleared, restoring project"
    });
    if let Some(last) = restore.filter(|_| !shell.quit_requested.load(Ordering::SeqCst)) {
        if let Err(error) = start_project(app, &shell, &last, launch).await {
            shell.log.write(format!(
                "updater project recovery failed: {}",
                error.message
            ));
            launcher_locked(app, &shell, Some(error_status(&last, &error))).await;
        }
    }
    shell.closing.store(false, Ordering::SeqCst);
    if shell.quit_requested.load(Ordering::SeqCst) {
        request_quit(app);
    }
    result
}

fn recovery_folder(current: Option<&Session>) -> Option<String> {
    current
        .filter(|session| session.url.is_some())
        .map(|session| session.folder.clone())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use tauri::Url;

    pub(crate) struct Sandbox(pub(crate) std::path::PathBuf);

    impl Sandbox {
        pub(crate) fn new() -> Self {
            static NEXT: AtomicU64 = AtomicU64::new(0);
            let path = std::env::temp_dir().join(format!(
                "deckmate-app-test-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for Sandbox {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    pub(crate) fn shell(directory: &std::path::Path, dialog_folder: Option<&str>) -> Shell {
        Shell {
            directory: directory.into(),
            programs: Programs {
                node: "node".into(),
                server: "server.js".into(),
                cli: "cli.mjs".into(),
                package: "package.json".into(),
            },
            deckmate_version: String::new(),
            locale: "en-US".into(),
            settings: Mutex::new(Settings::normalize(Value::Null, "en")),
            log: Log::open(directory),
            current: Mutex::new(None),
            dialog_folder: Mutex::new(dialog_folder.map(String::from)),
            pending_status: Mutex::new(None),
            launch: watch::channel(0).0,
            lifecycle: tokio::sync::Mutex::new(()),
            closing: AtomicBool::new(false),
            quit_requested: AtomicBool::new(false),
            quit_ready: AtomicBool::new(false),
            unsaved: unsaved::State::default(),
            bounds_generation: AtomicU64::new(0),
            board_script: Mutex::new(None),
            loading: Mutex::new(None),
            webview_handlers: tokio::sync::OnceCell::new(),
            updates: updater::State::default(),
            whats_new: whats_new::State::default(),
            startup_project: None,
            first_show: window::FirstShow::default(),
        }
    }

    fn session(url: Option<&str>) -> Session {
        Session {
            launch: 1,
            folder: r"C:\Demo".into(),
            url: url.map(String::from),
            process: Server::idle(),
        }
    }

    #[test]
    fn failed_settings_update_keeps_memory_and_can_be_retried() {
        let sandbox = Sandbox::new();
        let shell = shell(&sandbox.0, None);
        shell
            .settings
            .lock()
            .unwrap()
            .extra
            .insert("future".into(), json!({"electron":{"preserve":true}}));
        let path = sandbox.0.join("desktop.json");
        std::fs::create_dir(&path).unwrap();
        let response = result(shell.update_settings(|settings| {
            settings.language = "ru".into();
            Ok(())
        }));
        assert_eq!(response["ok"], false);
        assert_eq!(response["code"], "save-failed");
        assert!(response["message"]
            .as_str()
            .unwrap()
            .contains("Не удалось сохранить настройки"));
        assert_eq!(shell.language(), "en");
        std::fs::remove_dir(&path).unwrap();
        assert_eq!(
            result(shell.update_settings(|settings| {
                settings.language = "ru".into();
                Ok(())
            })),
            ok()
        );
        assert_eq!(shell.language(), "ru");
        let saved = Settings::load(&sandbox.0, "en", &shell.log);
        assert_eq!(saved.language, "ru");
        assert_eq!(saved.extra["future"], json!({"electron":{"preserve":true}}));
    }

    #[test]
    fn recovery_restores_only_a_project_that_was_open() {
        assert_eq!(recovery_folder(None), None);
        assert_eq!(recovery_folder(Some(&session(None))), None);
        assert_eq!(
            recovery_folder(Some(&session(Some("http://127.0.0.1:3141")))),
            Some(r"C:\Demo".into())
        );
    }

    #[test]
    fn quit_during_install_or_recovery_is_retained() {
        let sandbox = Sandbox::new();
        let shell = shell(&sandbox.0, None);
        shell.closing.store(true, Ordering::SeqCst);
        assert!(!shell.begin_quit());
        assert!(shell.quit_requested.load(Ordering::SeqCst));
        shell.closing.store(false, Ordering::SeqCst);
        assert!(shell.begin_quit());
        assert!(!shell.begin_quit());
    }

    #[test]
    fn network_folders_are_trusted_only_from_the_dialog() {
        let sandbox = Sandbox::new();
        let plain = shell(&sandbox.0, None);
        for input in [json!("relative"), json!(42), Value::Null] {
            assert_eq!(plain.check_folder(&input).unwrap_err().code, "invalid-path");
        }
        assert_eq!(
            plain
                .check_folder(&json!(r"\\server\share"))
                .unwrap_err()
                .code,
            "invalid-path"
        );
        assert_eq!(plain.check_folder(&json!(r"C:\demo")).unwrap(), r"C:\demo");
        let from_dialog = shell(&sandbox.0, Some(r"\\server\share"));
        assert_eq!(
            from_dialog.check_folder(&json!(r"\\server\share")).unwrap(),
            r"\\server\share"
        );
        assert_eq!(
            from_dialog
                .check_folder(&json!(r"\\server\other"))
                .unwrap_err()
                .code,
            "invalid-path"
        );
    }

    #[test]
    fn board_commands_answer_only_the_current_server_origin() {
        let sandbox = Sandbox::new();
        let shell = shell(&sandbox.0, None);
        *shell.current.lock().unwrap() = Some(session(Some("http://127.0.0.1:3141")));
        let url = |value: &str| Url::parse(value).unwrap();
        assert!(window::is_server_url(
            &shell,
            &url("http://127.0.0.1:3141/board?deck=one")
        ));
        assert!(!window::is_server_url(
            &shell,
            &url("http://localhost:3141/board")
        ));
        assert!(!window::is_server_url(
            &shell,
            &url("http://127.0.0.1:3142/board")
        ));
        assert!(!window::is_server_url(
            &shell,
            &url("https://127.0.0.1:3141/board")
        ));
        assert!(!window::is_server_url(&shell, &window::launcher_url()));
        // A session that is still starting, no session at all and a malformed URL never match.
        *shell.current.lock().unwrap() = Some(session(None));
        assert!(!window::is_server_url(
            &shell,
            &url("http://127.0.0.1:3141/")
        ));
        *shell.current.lock().unwrap() = None;
        assert!(!window::is_server_url(
            &shell,
            &url("http://127.0.0.1:3141/")
        ));
        *shell.current.lock().unwrap() = Some(session(Some("not a URL")));
        assert!(!window::is_server_url(
            &shell,
            &url("http://127.0.0.1:3141/")
        ));
    }
}
