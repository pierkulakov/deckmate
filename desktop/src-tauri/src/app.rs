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
use tauri_plugin_dialog::{MessageDialogButtons, MessageDialogKind, MessageDialogResult};
use tauri_plugin_opener::OpenerExt;
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
    pub menus: menu::State,
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
        let startup_project = settings.last_project.clone();
        log.milestone("settings-loaded");
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
            menus: menu::State::default(),
            whats_new: whats_new::State::default(),
            startup_project,
            first_show: window::FirstShow::default(),
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

    async fn cancelled(&self, launch: u64) -> Failure {
        let mut cancellation = self.launch.subscribe();
        loop {
            if let Err(failure) = self.require_launch(launch) {
                return failure;
            }
            let _ = cancellation.changed().await;
        }
    }

    async fn while_current<T>(
        &self,
        launch: u64,
        operation: impl std::future::Future<Output = T>,
    ) -> Result<T, Failure> {
        let mut cancellation = self.launch.subscribe();
        if self.replaced(launch) {
            return Err(self.failure("superseded", "superseded"));
        }
        // 2026-11-12: quit must release a startup wait; update recovery intentionally runs while closing.
        tokio::select! {
            biased;
            _ = cancellation.changed() => Err(self.failure("superseded", "superseded")),
            result = operation => Ok(result),
        }
    }

    async fn initialize_project<F: std::future::Future<Output = ()>>(
        &self,
        folder: &str,
        launch: u64,
        guard: tokio::sync::MutexGuard<'_, ()>,
        warn: impl FnOnce(Failure) -> F,
    ) -> Result<(), Failure> {
        let language = self.language();
        let initialized = server::initialize(
            &self.programs,
            folder,
            &language,
            &self.log,
            self.cancelled(launch),
        )
        .await
        .and_then(|()| {
            self.require_launch(launch)
                .map_err(|failure| server::init_failure(failure, folder, &language))
        });
        if initialized.is_err() {
            let mut trusted = self.dialog_folder.lock().unwrap();
            if trusted
                .as_deref()
                .is_some_and(|path| paths::same_path(path, folder))
            {
                trusted.take();
            }
        }
        // 2026-11-10: quit must wait for child reaping, never for acknowledgement of a native dialog.
        drop(guard);
        if let Err(failure) = &initialized {
            self.log.write(format!(
                "project initialization failed: {}",
                failure.message
            ));
            if !self.closing.load(Ordering::SeqCst) {
                warn(failure.clone()).await;
            }
        }
        initialized
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
    let launch = *shell.launch.borrow();
    if let Some(status) = status.as_ref().filter(|status| status["phase"] == "error") {
        shell.log.write(format!(
            "project launch failed: {}: {}",
            status["code"], status["message"]
        ));
    }
    unsaved::leave(app);
    shell.stop().await;
    *shell.pending_status.lock().unwrap() = status;
    menu::sync(app);
    if shell
        .while_current(launch, window::wait_until_shown(app))
        .await
        .is_err()
    {
        return;
    }
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
    open_project_launch(app, &shell, folder, launch).await
}

async fn open_project_launch(
    app: &AppHandle,
    shell: &Shell,
    folder: String,
    launch: u64,
) -> Result<(), Failure> {
    let _guard = shell.lifecycle.lock().await;
    shell.require_launch(launch)?;
    shell.stop().await;
    shell.require_launch(launch)?;
    shell.status(app, json!({"phase":"starting", "path":folder}));
    let started = start_project(app, shell, &folder, launch).await;
    match started {
        Ok(()) => Ok(()),
        Err(_) if shell.closing.load(Ordering::SeqCst) => Err(shell.failure("closed", "closed")),
        Err(_) if shell.replaced(launch) => Err(shell.failure("superseded", "superseded")),
        Err(error) => {
            launcher_locked(app, shell, Some(error_status(&folder, &error))).await;
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
    let saved_port = shell.settings.lock().unwrap().server_port;
    let mut port = server::choose_port(saved_port)
        .map_err(|error| Failure::new("start-failed", error.to_string()))?;
    let mut retries = server::PortRetries::default();
    let (process, url) = loop {
        if shell.replaced(launch) {
            return Err(shell.failure("superseded", "superseded"));
        }
        if shell.settings.lock().unwrap().server_port != Some(port) {
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
        match ready
            .await
            .map_err(|error| Failure::new("start-failed", error.to_string()))?
        {
            Ok(url) => break (process, url),
            Err(error) => {
                process.exited().await;
                if shell.replaced(launch) {
                    return Err(shell.failure("superseded", "superseded"));
                }
                match retries
                    .next(&error)
                    .map_err(|error| Failure::new("start-failed", error.to_string()))?
                {
                    Some(next) => {
                        shell
                            .log
                            .write(format!("server port {port} was taken; retrying on {next}"));
                        port = next;
                    }
                    None => return Err(error),
                }
            }
        }
    };
    if shell.replaced(launch) {
        process.stop().await;
        return Err(shell.failure("superseded", "superseded"));
    }
    // 2026-11-12: only navigation needs a loaded local document; Node starts while WebView2 is being created.
    shell
        .while_current(launch, window::wait_until_shown(app))
        .await?;
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
    menu::sync(app);
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
    let language = shell.language();
    let loaded = tokio::select! {
        biased;
        _ = cancellation.changed() => Err(shell.failure("superseded", "superseded")),
        failure = process.failed(&language) => Err(failure.unwrap_or_else(|| shell.failure("closed", "closed"))),
        result = window::navigate_board(&window, &url) => result.map_err(|error| Failure::new("load-failed", error)),
    };
    shell.loading.lock().unwrap().take();
    loaded?;
    watch_failure(app.clone(), process, launch, folder.into());
    Ok(())
}

fn watch_failure(app: AppHandle, process: Server, launch: u64, folder: String) {
    tauri::async_runtime::spawn(async move {
        let shell = state(&app);
        let Some(failure) = process.failed(&shell.language()).await else {
            return;
        };
        let _guard = shell.lifecycle.lock().await;
        if shell.closing.load(Ordering::SeqCst) || shell.replaced(launch) {
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
        shell.next_launch();
        launcher_locked(&app, &shell, Some(error_status(&folder, &failure))).await;
    });
}

pub async fn create_project(app: &AppHandle, options: Value) -> Result<(), Failure> {
    let shell = state(app);
    if shell.closing.load(Ordering::SeqCst) {
        return Err(shell.failure("closed", "closed"));
    }
    let launch = shell.next_launch();
    // 2026-11-09: cancellation reaps init before releasing the lifecycle lock to quit or a newer launch.
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
    shell
        .initialize_project(&folder, launch, guard, |failure| {
            warn_incomplete_project(app, &folder, failure)
        })
        .await?;
    open_project(app, folder).await
}

async fn warn_incomplete_project(app: &AppHandle, folder: &str, failure: Failure) {
    let shell = state(app);
    if shell.closing.load(Ordering::SeqCst) {
        return;
    }
    let language = shell.language();
    let reveal = texts::text(&language, "openInExplorer");
    let choice = menu::dialog(
        app,
        texts::text(&language, "createFailedTitle"),
        &failure.message,
        MessageDialogButtons::OkCancelCustom(reveal.into(), texts::text(&language, "ok").into()),
        MessageDialogKind::Warning,
    )
    .await;
    if !shell.closing.load(Ordering::SeqCst)
        && matches!(choice, MessageDialogResult::Custom(label) if label == reveal)
    {
        if let Some(target) = Path::new(folder).ancestors().find(|path| path.is_dir()) {
            if let Err(error) = app
                .opener()
                .open_path(target.to_string_lossy(), None::<&str>)
            {
                shell
                    .log
                    .write(format!("could not reveal incomplete project: {error}"));
            }
        }
    }
}

pub async fn startup(app: AppHandle, launch: u64) {
    let shell = state(&app);
    let Some(last) = shell.startup_project.clone() else {
        return;
    };
    if shell.require_launch(launch).is_err() {
        return;
    }
    let folder = last.clone();
    // 2026-11-12: filesystem/network classification must not delay the native window or be repeated at auto-open.
    let candidate = tauri::async_runtime::spawn_blocking(move || {
        if paths::is_network_path(&folder) {
            None
        } else {
            Some(Path::new(&folder).is_dir())
        }
    })
    .await;
    if shell.require_launch(launch).is_err() {
        return;
    }
    if matches!(candidate, Ok(Some(true))) {
        let _ = open_project_launch(&app, &shell, last, launch).await;
        return;
    }
    let _guard = shell.lifecycle.lock().await;
    if shell.require_launch(launch).is_err() {
        return;
    }
    let failure = match candidate {
        Ok(Some(false)) => {
            let _ = shell.update_settings(|settings| {
                settings.last_project = None;
                Ok(())
            });
            Some(Failure::new(
                "missing",
                texts::format(&shell.language(), "missing", "path", &last),
            ))
        }
        Err(error) => Some(Failure::new("invalid-path", error.to_string())),
        _ => None,
    };
    launcher_locked(
        &app,
        &shell,
        failure.map(|error| error_status(&last, &error)),
    )
    .await;
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
    let installation =
        tauri::async_runtime::spawn_blocking(crate::mcp_sessions::Installation::begin)
            .await
            .map_err(|error| error.to_string())?
            .map_err(|error| {
                if error.kind() == std::io::ErrorKind::WouldBlock {
                    texts::text(&shell.language(), "mcpUpdateInProgress").into()
                } else {
                    error.to_string()
                }
            })?;
    if !updater::confirm_mcp_sessions(app, installation.sessions).await {
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
        // 2026-11-12: installation remains gated until process exit, including an asynchronous app.exit.
        std::mem::forget(installation);
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
            menus: menu::State::default(),
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

    #[tokio::test]
    async fn startup_wait_is_cancelled_before_or_during_window_creation() {
        let sandbox = Sandbox::new();
        let shell = shell(&sandbox.0, None);
        let startup = shell.next_launch();
        let waiting = shell.while_current(startup, std::future::pending::<()>());
        let selection = async {
            tokio::task::yield_now().await;
            shell.next_launch();
        };
        let (result, ()) = tokio::join!(waiting, selection);
        assert_eq!(result.unwrap_err().code, "superseded");
        assert_eq!(
            shell
                .while_current(startup, async { panic!("stale navigation") })
                .await
                .unwrap_err()
                .code,
            "superseded"
        );
    }

    #[tokio::test]
    async fn window_wait_allows_update_recovery_but_quit_cancels_it() {
        let sandbox = Sandbox::new();
        let shell = shell(&sandbox.0, None);
        shell.closing.store(true, Ordering::SeqCst);
        let recovery = shell.next_launch();
        assert!(shell.while_current(recovery, async {}).await.is_ok());
        shell.next_launch();
        assert!(shell.while_current(recovery, async {}).await.is_err());
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

    #[tokio::test]
    async fn failed_init_preserves_contents_without_remembering_or_trusting_the_folder() {
        let sandbox = Sandbox::new();
        let cli = sandbox.0.join("init.cjs");
        std::fs::write(
            &cli,
            r#"
            const fs = require('fs'), path = require('path');
            fs.mkdirSync(process.argv[3], { recursive: true });
            fs.writeFileSync(path.join(process.argv[3], 'partial.md'), 'keep partial project');
            process.exitCode = 7;
        "#,
        )
        .unwrap();
        let mut shell = shell(&sandbox.0, None);
        shell.programs.cli = cli;
        shell
            .update_settings(|settings| {
                settings.remember("C:/Existing");
                Ok(())
            })
            .unwrap();
        let previous = shell.settings.lock().unwrap().clone();
        for (name, language) in [("missing", "en"), ("empty", "ru")] {
            let folder = sandbox.0.join(name);
            if name == "empty" {
                std::fs::create_dir(&folder).unwrap();
            }
            let folder = folder.to_string_lossy().into_owned();
            shell.settings.lock().unwrap().language = language.into();
            *shell.dialog_folder.lock().unwrap() = Some(folder.clone());
            let launch = shell.next_launch();
            let guard = shell.lifecycle.lock().await;
            let error = shell
                .initialize_project(&folder, launch, guard, |failure| {
                    assert!(shell.lifecycle.try_lock().is_ok());
                    assert!(failure.message.contains(&folder));
                    assert!(failure.message.contains(&texts::format(
                        language,
                        "initPartial",
                        "path",
                        &folder
                    )));
                    async {}
                })
                .await
                .unwrap_err();
            assert_eq!(error.code, "create-failed");
            assert_eq!(
                std::fs::read(Path::new(&folder).join("partial.md")).unwrap(),
                b"keep partial project"
            );
            assert!(shell.dialog_folder.lock().unwrap().is_none());
            let saved = Settings::load(&sandbox.0, "en", &shell.log);
            assert_eq!(saved.recent, previous.recent);
            assert_eq!(saved.last_project, previous.last_project);
            let memory = shell.settings.lock().unwrap();
            assert_eq!(memory.recent, previous.recent);
            assert_eq!(memory.last_project, previous.last_project);
        }
    }

    #[tokio::test]
    async fn pending_init_warning_does_not_hold_lifecycle_against_quit() {
        let sandbox = Sandbox::new();
        let cli = sandbox.0.join("init.cjs");
        std::fs::write(&cli, "process.exitCode = 7;").unwrap();
        let mut shell = shell(&sandbox.0, None);
        shell.programs.cli = cli;
        let shell = Arc::new(shell);
        let running = shell.clone();
        let launch = shell.next_launch();
        let (shown, warning_shown) = oneshot::channel();
        let (dismiss, dismissed) = oneshot::channel();
        let task = tokio::spawn(async move {
            let guard = running.lifecycle.lock().await;
            running
                .initialize_project(
                    &running.directory.to_string_lossy(),
                    launch,
                    guard,
                    |_| async {
                        let _ = shown.send(());
                        let _ = dismissed.await;
                    },
                )
                .await
        });
        tokio::time::timeout(std::time::Duration::from_secs(5), warning_shown)
            .await
            .unwrap()
            .unwrap();
        assert!(shell.begin_quit());
        shell.next_launch();
        let guard = tokio::time::timeout(std::time::Duration::from_secs(1), shell.lifecycle.lock())
            .await
            .unwrap();
        assert!(!task.is_finished());
        drop(guard);
        let _ = dismiss.send(());
        assert_eq!(task.await.unwrap().unwrap_err().code, "create-failed");
    }

    #[tokio::test]
    async fn quit_and_superseding_launch_cancel_hung_init_before_taking_lifecycle() {
        for quitting in [true, false] {
            let sandbox = Sandbox::new();
            let cli = sandbox.0.join("init.cjs");
            std::fs::write(&cli, r#"
                const child = require('child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: ['ignore', 'inherit', 'inherit'] });
                require('fs').writeFileSync(require('path').join(__dirname, 'descendant-pid'), String(child.pid));
                require('fs').writeFileSync(require('path').join(__dirname, 'pid'), String(process.pid));
                setInterval(() => {}, 1000);
            "#).unwrap();
            let mut shell = shell(&sandbox.0, None);
            shell.programs.cli = cli;
            let shell = Arc::new(shell);
            let launch = shell.next_launch();
            let running = shell.clone();
            let warned = Arc::new(AtomicBool::new(false));
            let warning = warned.clone();
            let task = tokio::spawn(async move {
                let guard = running.lifecycle.lock().await;
                running
                    .initialize_project(
                        &running.directory.to_string_lossy(),
                        launch,
                        guard,
                        |_| async {
                            warning.store(true, Ordering::SeqCst);
                        },
                    )
                    .await
            });
            tokio::time::timeout(std::time::Duration::from_secs(5), async {
                while !sandbox.0.join("pid").exists() {
                    tokio::time::sleep(std::time::Duration::from_millis(10)).await;
                }
            })
            .await
            .unwrap();
            if quitting {
                assert!(shell.begin_quit());
            }
            shell.next_launch();
            let guard =
                tokio::time::timeout(std::time::Duration::from_secs(3), shell.lifecycle.lock())
                    .await
                    .unwrap();
            drop(guard);
            let failure = task.await.unwrap().unwrap_err();
            assert_eq!(failure.code, if quitting { "closed" } else { "superseded" });
            assert_eq!(warned.load(Ordering::SeqCst), !quitting);
            assert!(failure.message.contains("partially"));
            assert!(failure.message.contains(sandbox.0.to_str().unwrap()));
            assert!(shell.settings.lock().unwrap().recent.is_empty());
            assert!(shell.settings.lock().unwrap().last_project.is_none());
            crate::server::tests::assert_child_reaped(&sandbox.0.join("pid")).await;
            crate::server::tests::assert_child_reaped(&sandbox.0.join("descendant-pid")).await;
        }
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
