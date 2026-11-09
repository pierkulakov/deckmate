mod app;
mod bridge;
mod fatal;
mod job;
mod log;
mod menu;
mod paths;
mod self_test;
mod server;
mod settings;
mod texts;
mod unsaved;
mod updater;
mod webview;
mod whats_new;
mod window;
mod workspace;

use std::sync::{atomic::Ordering, Arc};
use tauri::Manager;

pub fn run() {
    fatal::install_hook();
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).is_some_and(|arg| arg == "--self-test") {
        #[cfg(windows)]
        unsafe {
            // 2026-11-09: the release GUI subsystem must also print self-test JSON in a parent console.
            let _ = windows::Win32::System::Console::AttachConsole(
                windows::Win32::System::Console::ATTACH_PARENT_PROCESS,
            );
        }
        let runtime = tokio::runtime::Runtime::new().expect("self-test runtime");
        let code = runtime.block_on(self_test::run(
            args.get(2).map(String::as_str).unwrap_or(""),
        ));
        std::process::exit(code);
    }
    let built = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            bridge::desktop_get_state,
            bridge::desktop_choose_folder,
            bridge::desktop_open_project,
            bridge::desktop_create_project,
            bridge::desktop_remove_recent,
            bridge::desktop_set_language,
            bridge::desktop_add_to_workspace,
            bridge::desktop_remove_from_workspace,
            bridge::desktop_move_in_workspace,
            bridge::board_recent_projects,
            bridge::board_workspace_projects,
            bridge::board_add_to_workspace,
            bridge::board_remove_from_workspace,
            bridge::board_move_in_workspace,
            bridge::board_switch_project,
            bridge::board_show_start_screen,
            bridge::board_set_dirty,
            whats_new::whats_new_get
        ])
        .setup(|app| {
            app.manage(Arc::new(app::Shell::new(app.path().resource_dir().ok())?));
            menu::rebuild(app.handle());
            window::create(app.handle())?;
            tauri::async_runtime::spawn(app::startup(app.handle().clone()));
            updater::start(app.handle().clone());
            Ok(())
        })
        .on_menu_event(menu::handle)
        .build(tauri::generate_context!());
    let app = match built {
        Ok(app) => app,
        Err(error) => fatal::startup(&error),
    };
    app.run(|handle, event| {
        if let tauri::RunEvent::ExitRequested { api, .. } = event {
            if !app::state(handle).quit_ready.load(Ordering::SeqCst) {
                api.prevent_exit();
                app::request_quit(handle);
            }
        }
    });
}
