use crate::{
    app::{self, Shell},
    paths,
    settings::{clamp_zoom, Bounds},
    webview,
};
#[cfg(debug_assertions)]
use std::env;
use std::{
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};
use tauri::{
    webview::PageLoadEvent, AppHandle, Manager, Url, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_opener::OpenerExt;

pub fn launcher_url() -> Url {
    "http://tauri.localhost/index.html".parse().unwrap()
}

pub fn is_launcher_url(url: &Url) -> bool {
    is_app_page_url(url, "index.html")
}

pub fn is_app_page_url(url: &Url, page: &str) -> bool {
    let mut url = url.clone();
    url.set_query(None);
    url.set_fragment(None);
    // 2026-11-09: Tauri initially serves App("index.html") at the root URL.
    if page == "index.html" && url.path() == "/" {
        url.set_path("/index.html");
    }
    let mut expected = launcher_url();
    expected.set_path(page);
    url == expected
}

pub fn is_server_url(shell: &Shell, url: &Url) -> bool {
    shell
        .current
        .lock()
        .unwrap()
        .as_ref()
        .and_then(|current| current.url.as_ref())
        .and_then(|server| Url::parse(server).ok())
        .is_some_and(|server| server.origin() == url.origin())
}

pub fn open_external(app: &AppHandle, url: &Url) {
    if matches!(url.scheme(), "http" | "https")
        && url.origin() != launcher_url().origin()
        && !is_server_url(&app::state(app), url)
        && !record_external(url)
    {
        let _ = app.opener().open_url(url.as_str(), None::<&str>);
    }
}

/// 2026-11-09: the window smoke (tools/desktop-smoke.ts) checks that external links leave the app; with
/// DECKMATE_DESKTOP_EXTERNAL_LOG a debug build appends them to that file instead of opening the user's browser on
/// every run. Release builds compile this to `false` and never read the variable.
#[cfg(debug_assertions)]
fn record_external(url: &Url) -> bool {
    use std::io::Write;
    let Some(file) = env::var_os("DECKMATE_DESKTOP_EXTERNAL_LOG").filter(|value| !value.is_empty())
    else {
        return false;
    };
    let _ = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(file)
        .and_then(|mut log| writeln!(log, "{url}"));
    true
}

#[cfg(not(debug_assertions))]
fn record_external(_: &Url) -> bool {
    false
}

pub fn allow_navigation(app: &AppHandle, url: &Url) -> bool {
    let shell = app::state(app);
    let returning_to_launcher = is_launcher_url(url)
        && shell
            .current
            .lock()
            .unwrap()
            .as_ref()
            .is_some_and(|current| current.url.is_some());
    if returning_to_launcher {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            app::show_launcher(&app, None).await;
        });
        return false;
    }
    let allowed = is_launcher_url(url) || is_server_url(&shell, url);
    if !allowed {
        open_external(app, url);
    }
    allowed
}

#[derive(Default)]
pub struct FirstShow {
    bounds_ready: AtomicBool,
    loaded: AtomicBool,
    shown: AtomicBool,
    visible: AtomicBool,
    wait_for_board: AtomicBool,
    notified: tokio::sync::Notify,
}

impl FirstShow {
    pub fn new(wait_for_board: bool) -> Self {
        Self {
            wait_for_board: AtomicBool::new(wait_for_board),
            ..Self::default()
        }
    }

    fn claim(&self, fallback: bool) -> bool {
        self.bounds_ready.load(Ordering::SeqCst)
            && (fallback || self.loaded.load(Ordering::SeqCst))
            && (fallback || !self.wait_for_board.load(Ordering::SeqCst))
            && !self.shown.swap(true, Ordering::SeqCst)
    }

    fn show(&self, window: &WebviewWindow, fallback: bool) {
        if self.claim(fallback) {
            #[cfg(debug_assertions)]
            if let Ok(url) = window.url() {
                app::state(window.app_handle())
                    .log
                    .write(format!("main first show: {url}"));
            }
            let _ = window.as_ref().show();
            let _ = window.show();
            self.visible.store(true, Ordering::SeqCst);
            self.notified.notify_waiters();
        }
    }
}

pub async fn wait_until_shown(app: &AppHandle) {
    let shell = app::state(app);
    loop {
        let notified = shell.first_show.notified.notified();
        if shell.first_show.visible.load(Ordering::SeqCst) {
            return;
        }
        notified.await;
    }
}

pub fn finish_startup(app: &AppHandle) {
    let shell = app::state(app);
    shell
        .first_show
        .wait_for_board
        .store(false, Ordering::SeqCst);
    if let Some(window) = app.get_webview_window("main") {
        shell.first_show.show(&window, false);
    }
}

pub fn launcher_error(window: &WebviewWindow, message: &str) {
    let app = window.app_handle();
    app::state(app).status(
        app,
        serde_json::json!({"phase":"error", "code":"load-failed", "message":message}),
    );
    // 2026-11-09: failed launcher assets must leave a visible error, not an invisible process.
    let _ = window.eval(format!(
        "if (!document.getElementById('launcher') && document.body) document.body.textContent = {};",
        serde_json::to_string(message).unwrap()
    ));
}

pub fn title(app: &AppHandle) -> String {
    app::state(app)
        .current
        .lock()
        .unwrap()
        .as_ref()
        .filter(|current| current.url.is_some())
        .map(|current| format!("Deckmate — {}", paths::project_name(&current.folder)))
        .unwrap_or_else(|| "Deckmate".into())
}

/// 2026-11-09: WebView2 forwards Chromium switches from additional browser arguments, so a debug
/// build can expose a CDP port (DECKMATE_DESKTOP_CDP_PORT) for tools/desktop-smoke.ts to drive
/// the real window. Setting additional_browser_args replaces the wry default
/// (--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection), so the debug string keeps
/// those switches and appends the port. Debug-only by compilation: release builds replace this
/// body with None, so a release binary never reads the variable.
#[cfg(debug_assertions)]
fn debug_browser_args() -> Option<String> {
    let port: u16 = env::var("DECKMATE_DESKTOP_CDP_PORT").ok()?.parse().ok()?;
    if port == 0 {
        return None;
    }
    Some(format!(
        "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --remote-debugging-port={port}"
    ))
}

#[cfg(not(debug_assertions))]
fn debug_browser_args() -> Option<String> {
    None
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let shell = app::state(app);
    // 2026-11-09: decide before build: the launcher's first load can beat app::startup.
    if let Some(folder) = &shell.startup_project {
        shell.status(app, serde_json::json!({"phase":"ready", "path":folder}));
    }
    let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("Deckmate")
        .inner_size(1280.0, 820.0)
        .min_inner_size(960.0, 600.0)
        .visible(false)
        .background_color(tauri::window::Color(23, 24, 27, 255))
        .zoom_hotkeys_enabled(false)
        .on_document_title_changed(|window, _| {
            let _ = window.set_title(&title(window.app_handle()));
        })
        .on_page_load(move |window, payload| {
            if payload.event() != PageLoadEvent::Finished {
                return;
            }
            let app = window.app_handle();
            apply_zoom(&window);
            let _ = window.set_title(&title(app));
            let shell = app::state(app);
            shell.first_show.loaded.store(true, Ordering::SeqCst);
            if !is_server_url(&shell, payload.url()) {
                shell.first_show.show(&window, false);
            }
        });
    // 2026-11-09: a first-document sample lets smoke verify hidden-until-load without a CDP attach race.
    #[cfg(debug_assertions)]
    let builder = builder.initialization_script(
        "window.__deckmateFirstLoadVisibility = { initial: document.visibilityState };\
         addEventListener('load', () => { window.__deckmateFirstLoadVisibility.atLoad = document.visibilityState; }, { once: true });"
    );
    // 2026-11-09: additional_browser_args replaces the wry defaults, so the debug string keeps
    // them instead of the replacement dropping the feature switches they disable.
    let window = match debug_browser_args() {
        Some(args) => builder.additional_browser_args(&args),
        None => builder,
    }
    .build()?;
    // 2026-11-09: hiding the HWND alone does not update WebView2's document.visibilityState.
    window.as_ref().hide()?;
    restore_bounds(&window)?;
    shell.first_show.bounds_ready.store(true, Ordering::SeqCst);
    shell.first_show.show(&window, false);
    let guarded_window = window.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = webview::install(&guarded_window).await {
            let app = guarded_window.app_handle();
            app::state(app).status(
                app,
                serde_json::json!({"phase":"error", "code":"load-failed", "message":error}),
            );
        }
    });
    let events_window = window.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            app::request_quit(events_window.app_handle());
        }
        WindowEvent::Moved(_) | WindowEvent::Resized(_) => schedule_bounds_save(&events_window),
        _ => (),
    });
    apply_zoom(&window);
    let fallback_window = window.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(2)).await;
        let first_show = &shell.first_show;
        if first_show.wait_for_board.load(Ordering::SeqCst)
            && first_show.loaded.load(Ordering::SeqCst)
            && fallback_window.url().is_ok_and(|url| is_launcher_url(&url))
        {
            let status = shell.pending_status.lock().unwrap().clone();
            if let Some(mut status) = status.filter(|status| status["phase"] == "starting") {
                status["phase"] = "ready".into();
                shell.status(fallback_window.app_handle(), status);
            }
            shell.replay_status(fallback_window.app_handle());
            first_show.show(&fallback_window, true);
        }
        tokio::time::sleep(Duration::from_secs(3)).await;
        if !first_show.loaded.load(Ordering::SeqCst)
            && fallback_window.url().is_ok_and(|url| is_launcher_url(&url))
        {
            let app = fallback_window.app_handle();
            let shell = app::state(app);
            let message = crate::texts::text(&shell.language(), "launcherTimeout");
            launcher_error(&fallback_window, message);
            first_show.show(&fallback_window, true);
        }
    });
    Ok(())
}

pub fn visible_on(bounds: Bounds, area: Bounds) -> bool {
    let overlap_width = (i64::from(bounds.x) + i64::from(bounds.width))
        .min(i64::from(area.x) + i64::from(area.width))
        - i64::from(bounds.x.max(area.x));
    let overlap_height = (i64::from(bounds.y) + i64::from(bounds.height))
        .min(i64::from(area.y) + i64::from(area.height))
        - i64::from(bounds.y.max(area.y));
    overlap_width >= 120 && overlap_height >= 60
}

fn restore_bounds(window: &WebviewWindow) -> tauri::Result<()> {
    let shell = app::state(window.app_handle());
    let settings = shell.settings.lock().unwrap().clone();
    if let Some(bounds) = settings.window_bounds {
        let monitors = window.available_monitors()?;
        let areas = monitors
            .iter()
            .map(|monitor| {
                let area = monitor.work_area();
                let position = area.position.to_logical::<i32>(monitor.scale_factor());
                let size = area.size.to_logical::<u32>(monitor.scale_factor());
                Bounds {
                    x: position.x,
                    y: position.y,
                    width: size.width,
                    height: size.height,
                }
            })
            .collect::<Vec<_>>();
        let monitor_index = areas.iter().position(|area| visible_on(bounds, *area));
        let visible = monitor_index.is_some();
        if let Some(index) = monitor_index {
            let scale = monitors[index].scale_factor();
            window.set_position(tauri::PhysicalPosition::new(
                (f64::from(bounds.x) * scale).round() as i32,
                (f64::from(bounds.y) * scale).round() as i32,
            ))?;
        }
        let size = match (visible, areas.first()) {
            (false, Some(area)) => (bounds.width.min(area.width), bounds.height.min(area.height)),
            _ => (bounds.width, bounds.height),
        };
        let scale = window.scale_factor()?;
        let outer = window.outer_size()?.to_logical::<u32>(scale);
        let inner = window.inner_size()?.to_logical::<u32>(scale);
        window.set_size(tauri::LogicalSize::new(
            size.0.saturating_sub(outer.width - inner.width).max(960),
            size.1.saturating_sub(outer.height - inner.height).max(600),
        ))?;
    }
    if settings.window_maximized {
        window.maximize()?;
    }
    Ok(())
}

pub fn capture_bounds(window: &WebviewWindow) {
    if window.is_minimized().unwrap_or(true) || window.is_fullscreen().unwrap_or(true) {
        return;
    }
    let shell = app::state(window.app_handle());
    let maximized = window.is_maximized().unwrap_or(false);
    let mut settings = shell.settings.lock().unwrap();
    settings.window_maximized = maximized;
    if let Some(bounds) = webview::normal_bounds(window) {
        settings.window_bounds = Some(bounds);
    }
}

fn schedule_bounds_save(window: &WebviewWindow) {
    capture_bounds(window);
    let shell = app::state(window.app_handle());
    let generation = shell.bounds_generation.fetch_add(1, Ordering::SeqCst) + 1;
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(300)).await;
        if shell.bounds_generation.load(Ordering::SeqCst) == generation
            && !shell.closing.load(Ordering::SeqCst)
        {
            shell.save();
        }
    });
}

pub fn apply_zoom(window: &WebviewWindow) {
    let factor = app::state(window.app_handle())
        .settings
        .lock()
        .unwrap()
        .zoom_factor;
    let _ = window.set_zoom(factor);
}

pub fn set_zoom(app: &AppHandle, factor: f64) {
    let shell = app::state(app);
    let factor = clamp_zoom(factor);
    let changed = {
        let mut settings = shell.settings.lock().unwrap();
        let changed = settings.zoom_factor != factor;
        settings.zoom_factor = factor;
        changed
    };
    if let Some(window) = app.get_webview_window("main") {
        apply_zoom(&window);
    }
    if changed {
        shell.save();
    }
}

pub fn change_zoom(app: &AppHandle, delta: f64) {
    let factor = app::state(app).settings.lock().unwrap().zoom_factor;
    set_zoom(app, factor + delta);
}

pub fn finish_load(window: &WebviewWindow, navigation: u64, result: Result<(), String>) {
    let shell = app::state(window.app_handle());
    let mut loading = shell.loading.lock().unwrap();
    if loading
        .as_ref()
        .is_some_and(|load| load.navigation == Some(navigation))
    {
        if let Some(load) = loading.take() {
            // 2026-11-09: Wry's Finished also fires for failed navigations; only success may reveal the board.
            if result.is_ok() {
                shell
                    .first_show
                    .wait_for_board
                    .store(false, Ordering::SeqCst);
                shell.first_show.loaded.store(true, Ordering::SeqCst);
                shell.first_show.show(window, false);
            }
            let _ = load.sender.send(result);
        }
    }
}

pub async fn navigate_launcher(window: &WebviewWindow) -> Result<(), String> {
    webview::board_script(window, None).await?;
    let shell = app::state(window.app_handle());
    if !shell.first_show.shown.load(Ordering::SeqCst) {
        shell.first_show.loaded.store(false, Ordering::SeqCst);
    }
    window
        .navigate(launcher_url())
        .map_err(|error| error.to_string())
}

pub async fn navigate_board(window: &WebviewWindow, url: &str) -> Result<(), String> {
    webview::install(window).await?;
    let shell = app::state(window.app_handle());
    let (sender, receiver) = tokio::sync::oneshot::channel();
    *shell.loading.lock().unwrap() = Some(app::Loading {
        url: url.into(),
        navigation: None,
        sender,
    });
    window
        .navigate(Url::parse(url).map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())?;
    match tokio::time::timeout(Duration::from_secs(20), receiver).await {
        Ok(result) => result.map_err(|error| error.to_string())?,
        Err(_) => Err(crate::texts::text(&shell.language(), "loadTimeout").into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn first_show_waits_for_bounds_and_load_or_timeout_and_runs_once() {
        let show = FirstShow::default();
        assert!(!show.claim(false));
        show.loaded.store(true, Ordering::SeqCst);
        assert!(!show.claim(false));
        show.bounds_ready.store(true, Ordering::SeqCst);
        assert!(show.claim(false));
        assert!(!show.claim(false));
        assert!(!show.claim(true));
        let fallback = FirstShow::default();
        assert!(!fallback.claim(true));
        fallback.bounds_ready.store(true, Ordering::SeqCst);
        assert!(!fallback.claim(false));
        assert!(fallback.claim(true));
        fallback.loaded.store(true, Ordering::SeqCst);
        assert!(!fallback.claim(false));
    }
    #[test]
    fn auto_open_ignores_launcher_load_until_board_or_fallback() {
        let show = FirstShow::new(true);
        show.bounds_ready.store(true, Ordering::SeqCst);
        show.loaded.store(true, Ordering::SeqCst);
        assert!(!show.claim(false));
        show.wait_for_board.store(false, Ordering::SeqCst);
        assert!(show.claim(false));
        let slow = FirstShow::new(true);
        slow.bounds_ready.store(true, Ordering::SeqCst);
        assert!(slow.claim(true));
    }
    #[test]
    fn debug_cdp_port_keeps_wry_defaults_and_rejects_bad_ports() {
        // 2026-11-09: only this test reads DECKMATE_DESKTOP_CDP_PORT, so mutating the process
        // environment is safe under cargo's parallel test runner.
        let original = env::var_os("DECKMATE_DESKTOP_CDP_PORT");
        env::set_var("DECKMATE_DESKTOP_CDP_PORT", "9777");
        let args = debug_browser_args().expect("a valid port parses");
        assert!(args.starts_with("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection "));
        assert!(args.ends_with("--remote-debugging-port=9777"));
        for invalid in ["", "0", "not-a-port", "70000"] {
            env::set_var("DECKMATE_DESKTOP_CDP_PORT", invalid);
            assert!(debug_browser_args().is_none(), "{invalid:?}");
        }
        match original {
            Some(value) => env::set_var("DECKMATE_DESKTOP_CDP_PORT", value),
            None => env::remove_var("DECKMATE_DESKTOP_CDP_PORT"),
        }
    }
    #[test]
    fn restore_requires_a_visible_title_sized_area() {
        let area = Bounds {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        };
        assert!(visible_on(
            Bounds {
                x: 1800,
                y: 1020,
                width: 1280,
                height: 820
            },
            area
        ));
        assert!(!visible_on(
            Bounds {
                x: 1801,
                y: 1020,
                width: 1280,
                height: 820
            },
            area
        ));
        assert!(!visible_on(
            Bounds {
                x: 1800,
                y: 1021,
                width: 1280,
                height: 820
            },
            area
        ));
    }
    #[test]
    fn launcher_url_does_not_accept_other_bundled_pages() {
        assert!(is_launcher_url(&"http://tauri.localhost/".parse().unwrap()));
        assert!(is_launcher_url(
            &"http://tauri.localhost/index.html?x#test".parse().unwrap()
        ));
        assert!(!is_launcher_url(
            &"http://tauri.localhost/other.html".parse().unwrap()
        ));
        assert!(!is_launcher_url(
            &"http://tauri.localhost.evil/index.html".parse().unwrap()
        ));
    }
}
