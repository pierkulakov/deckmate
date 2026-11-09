use crate::{app, menu, settings::Bounds, texts, window};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{Manager, WebviewWindow};
use webview2_com::{
    AcceleratorKeyPressedEventHandler, AddScriptToExecuteOnDocumentCreatedCompletedHandler,
    CallDevToolsProtocolMethodCompletedHandler, ContextMenuRequestedEventHandler,
    DevToolsProtocolEventReceivedEventHandler, Microsoft::Web::WebView2::Win32::*,
    NavigationCompletedEventHandler, NavigationStartingEventHandler,
    NewWindowRequestedEventHandler, PermissionRequestedEventHandler, ProcessFailedEventHandler,
    ZoomFactorChangedEventHandler,
};
use windows::{
    core::{Interface, BOOL, HSTRING, PWSTR},
    Win32::UI::{
        Input::KeyboardAndMouse::*,
        WindowsAndMessaging::{GetWindowPlacement, WINDOWPLACEMENT},
    },
};

pub fn normal_bounds(window: &WebviewWindow) -> Option<Bounds> {
    let mut placement = WINDOWPLACEMENT {
        length: std::mem::size_of::<WINDOWPLACEMENT>() as u32,
        ..Default::default()
    };
    unsafe {
        GetWindowPlacement(window.hwnd().ok()?, &mut placement).ok()?;
    }
    let scale = window.scale_factor().ok()?;
    let rect = placement.rcNormalPosition;
    let (offset_x, offset_y) = window
        .current_monitor()
        .ok()
        .flatten()
        .map(|monitor| {
            (
                monitor.work_area().position.x - monitor.position().x,
                monitor.work_area().position.y - monitor.position().y,
            )
        })
        .unwrap_or_default();
    Some(Bounds {
        x: (f64::from(rect.left + offset_x) / scale).round() as i32,
        y: (f64::from(rect.top + offset_y) / scale).round() as i32,
        width: (f64::from(rect.right - rect.left) / scale).round() as u32,
        height: (f64::from(rect.bottom - rect.top) / scale).round() as u32,
    })
}

pub async fn install(window: &WebviewWindow) -> Result<(), String> {
    let shell = app::state(window.app_handle());
    shell
        .webview_handlers
        .get_or_init(|| async {
            install_once(window).await.map_err(|error| {
                shell
                    .log
                    .write(format!("WebView2 handlers failed: {error}"));
                texts::format(&shell.language(), "guardsFailed", "error", error)
            })
        })
        .await
        .clone()
}

async fn install_once(window: &WebviewWindow) -> Result<(), String> {
    let window = window.clone();
    let handle = window.clone();
    let (sender, receiver) = tokio::sync::oneshot::channel();
    window
        .with_webview(move |webview| {
            let result = unsafe { install_handlers(&handle, webview.controller()) };
            let _ = sender.send(result.map_err(|error| error.to_string()));
        })
        .map_err(|error| error.to_string())?;
    receiver.await.map_err(|error| error.to_string())?
}

unsafe fn install_handlers(
    window: &WebviewWindow,
    controller: ICoreWebView2Controller,
) -> windows::core::Result<()> {
    let core = controller.CoreWebView2()?;
    core.Settings()?
        .cast::<ICoreWebView2Settings3>()?
        .SetAreBrowserAcceleratorKeysEnabled(false)?;
    install_navigation(window, &core)?;
    install_popup_and_permissions(window, &core)?;
    install_process_failures(window, &core)?;
    install_context_menu(&core)?;
    install_zoom_keys(window, &controller)?;
    install_zoom(window, &controller)?;
    install_console(window, &core)
}

#[derive(Debug, PartialEq)]
enum Recovery {
    Reload,
    Ask,
    Restart,
    None,
}

// 2026-11-09: two retries recover transient renderer exits without trapping a broken page in a loop.
const MAX_AUTOMATIC_RELOADS: u8 = 2;
// 2026-11-09: only a full quiet minute restores the budget; manual retries cannot restart the loop.
const CRASH_QUIET_PERIOD: Duration = Duration::from_secs(60);
// 2026-11-09: give WebView2 time to release the failed renderer before starting its replacement.
const RELOAD_DELAY: Duration = Duration::from_millis(500);

#[derive(Clone, Copy, Default, Debug, PartialEq)]
struct ReloadBudget {
    automatic_reloads: u8,
    last_crash: Option<Duration>,
}

fn renderer_crash(budget: ReloadBudget, now: Duration) -> (ReloadBudget, Recovery) {
    let used = match budget.last_crash {
        Some(last) if now.saturating_sub(last) < CRASH_QUIET_PERIOD => budget.automatic_reloads,
        _ => 0,
    };
    let reload = used < MAX_AUTOMATIC_RELOADS;
    let next = ReloadBudget {
        automatic_reloads: used + u8::from(reload),
        last_crash: Some(now),
    };
    let action = if reload {
        Recovery::Reload
    } else {
        Recovery::Ask
    };
    (next, action)
}

fn recovery(kind: COREWEBVIEW2_PROCESS_FAILED_KIND) -> Recovery {
    match kind {
        COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED => Recovery::Reload,
        COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE => Recovery::Ask,
        COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED => Recovery::Restart,
        _ => Recovery::None,
    }
}

async fn recover_renderer(window: &WebviewWindow, action: Recovery, crashed: bool) {
    let app = window.app_handle();
    let shell = app::state(app);
    if shell.closing.load(Ordering::SeqCst) {
        return;
    }
    let reload = if action == Recovery::Reload {
        tokio::time::sleep(RELOAD_DELAY).await;
        true
    } else if crashed {
        menu::ask(app, "rendererCrashedRepeatedly", "reload", "startScreen").await
    } else {
        menu::ask(app, "rendererUnresponsive", "reload", "wait").await
    };
    if shell.closing.load(Ordering::SeqCst) {
        return;
    }
    if reload {
        if action == Recovery::Reload {
            shell.log.write("WebView2 automatic renderer reload");
        }
        if let Err(error) = window.reload() {
            shell.log.write(format!("WebView2 reload failed: {error}"));
        }
    } else if crashed {
        if let Err(error) = app::show_launcher(app, None).await {
            shell
                .log
                .write(format!("WebView2 start screen failed: {}", error.message));
        }
    }
}

unsafe fn install_process_failures(
    window: &WebviewWindow,
    core: &ICoreWebView2,
) -> windows::core::Result<()> {
    let window = window.clone();
    let recovering = Arc::new(AtomicBool::new(false));
    let budget = Mutex::new(ReloadBudget::default());
    let started = Instant::now();
    let mut token = 0;
    core.add_ProcessFailed(
        &ProcessFailedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else {
                return Ok(());
            };
            let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND::default();
            args.ProcessFailedKind(&mut kind)?;
            let app = window.app_handle();
            let shell = app::state(app);
            let mut action = recovery(kind);
            shell.log.write(format!(
                "WebView2 process failed: kind={}, recovery={action:?}",
                kind.0
            ));
            if shell.closing.load(Ordering::SeqCst) {
                return Ok(());
            }
            let crashed = action == Recovery::Reload;
            if crashed {
                // 2026-11-09: the exited renderer took its editors with it; a stale dirty flag would block Windows
                // shutdown and ask "Leave anyway?" about work that no longer exists. The reloaded page reports again.
                shell.unsaved.dirty.store(false, Ordering::SeqCst);
                let mut budget = budget.lock().unwrap();
                let (next, next_action) = renderer_crash(*budget, started.elapsed());
                *budget = next;
                action = next_action;
            }
            match action {
                Recovery::Reload | Recovery::Ask if !recovering.swap(true, Ordering::SeqCst) => {
                    let window = window.clone();
                    let recovering = recovering.clone();
                    tauri::async_runtime::spawn(async move {
                        recover_renderer(&window, action, crashed).await;
                        recovering.store(false, Ordering::SeqCst);
                    });
                }
                Recovery::Restart => app::restart_after_browser_failure(app),
                _ => (),
            }
            Ok(())
        })),
        &mut token,
    )
}

fn editing_menu_item(name: &str) -> bool {
    matches!(name, "cut" | "copy" | "paste" | "selectAll" | "spellCheck")
}

unsafe fn filter_context_menu(
    items: &ICoreWebView2ContextMenuItemCollection,
) -> windows::core::Result<()> {
    let mut count = 0;
    items.Count(&mut count)?;
    for index in (0..count).rev() {
        let item = items.GetValueAtIndex(index)?;
        let mut name = PWSTR::null();
        item.Name(&mut name)?;
        if !editing_menu_item(&webview2_com::take_pwstr(name)) {
            items.RemoveValueAtIndex(index)?;
            continue;
        }
        let mut kind = COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND::default();
        item.Kind(&mut kind)?;
        if kind == COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_SUBMENU {
            filter_context_menu(&item.Children()?)?;
        }
    }
    Ok(())
}

unsafe fn install_context_menu(core: &ICoreWebView2) -> windows::core::Result<()> {
    let mut token = 0;
    core.cast::<ICoreWebView2_11>()?.add_ContextMenuRequested(
        &ContextMenuRequestedEventHandler::create(Box::new(|_, args| {
            let Some(args) = args else {
                return Ok(());
            };
            // 2026-11-09: keep WebView2's editing commands and spelling replacements, without browser navigation/tools.
            args.SetHandled(true)?;
            let items = args.MenuItems()?;
            filter_context_menu(&items)?;
            let mut count = 0;
            items.Count(&mut count)?;
            args.SetHandled(count == 0)
        })),
        &mut token,
    )
}

#[derive(Clone, Copy, Debug)]
struct Navigation {
    id: u64,
    launcher: bool,
    succeeded: bool,
}

fn launcher_failure_is_relevant(latest: Option<Navigation>, completed: u64) -> bool {
    // 2026-11-09: Source already names the replacement document when an older navigation aborts.
    // This also discards CONNECTION_ABORTED/OPERATION_CANCELED after a newer start or success.
    latest.is_some_and(|latest| latest.id == completed && latest.launcher && !latest.succeeded)
}

unsafe fn install_navigation(
    window: &WebviewWindow,
    core: &ICoreWebView2,
) -> windows::core::Result<()> {
    let mut token = 0;
    let latest = Arc::new(Mutex::new(None::<Navigation>));
    let starting = latest.clone();
    let navigation_window = window.clone();
    core.add_NavigationStarting(
        &NavigationStartingEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else {
                return Ok(());
            };
            args.SetCancel(true)?;
            let mut uri = PWSTR::null();
            args.Uri(&mut uri)?;
            let uri = webview2_com::take_pwstr(uri);
            let Ok(url) = tauri::Url::parse(&uri) else {
                return Ok(());
            };
            if !window::allow_navigation(navigation_window.app_handle(), &url) {
                return Ok(());
            }
            let mut navigation = 0;
            args.NavigationId(&mut navigation)?;
            *starting.lock().unwrap() = Some(Navigation {
                id: navigation,
                launcher: window::is_launcher_url(&url),
                succeeded: false,
            });
            args.SetCancel(false)?;
            let shell = app::state(navigation_window.app_handle());
            let mut loading = shell.loading.lock().unwrap();
            if let Some(load) = loading
                .as_mut()
                .filter(|load| uri == load.url || uri.starts_with(&format!("{}/", load.url)))
            {
                load.navigation = Some(navigation);
            }
            Ok(())
        })),
        &mut token,
    )?;
    let frame_app = window.app_handle().clone();
    core.add_FrameNavigationStarting(
        &NavigationStartingEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else {
                return Ok(());
            };
            args.SetCancel(true)?;
            let mut uri = PWSTR::null();
            args.Uri(&mut uri)?;
            let uri = webview2_com::take_pwstr(uri);
            if tauri::Url::parse(&uri)
                .is_ok_and(|url| window::is_server_url(&app::state(&frame_app), &url))
            {
                args.SetCancel(false)?;
            }
            Ok(())
        })),
        &mut token,
    )?;
    let load_window = window.clone();
    core.add_NavigationCompleted(
        &NavigationCompletedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else {
                return Ok(());
            };
            let mut navigation = 0;
            args.NavigationId(&mut navigation)?;
            let mut success = BOOL::default();
            args.IsSuccess(&mut success)?;
            if success.as_bool() {
                if let Some(latest) = latest
                    .lock()
                    .unwrap()
                    .as_mut()
                    .filter(|latest| latest.id == navigation)
                {
                    latest.succeeded = true;
                }
                window::finish_load(&load_window, navigation, Ok(()));
                return Ok(());
            }
            let shell = app::state(load_window.app_handle());
            let mut code = COREWEBVIEW2_WEB_ERROR_STATUS::default();
            args.WebErrorStatus(&mut code)?;
            let latest = *latest.lock().unwrap();
            shell.log.write(format!(
                "WebView2 navigation failed: navigation={navigation}, latest={latest:?}, code={}",
                code.0
            ));
            if launcher_failure_is_relevant(latest, navigation)
                && shell.current.lock().unwrap().is_none()
            {
                window::launcher_error(
                    &load_window,
                    &texts::format(&shell.language(), "launcherFailed", "code", code.0),
                );
            }
            window::finish_load(
                &load_window,
                navigation,
                Err(texts::format(
                    &shell.language(),
                    "loadFailed",
                    "code",
                    code.0,
                )),
            );
            Ok(())
        })),
        &mut token,
    )?;
    Ok(())
}

unsafe fn install_popup_and_permissions(
    window: &WebviewWindow,
    core: &ICoreWebView2,
) -> windows::core::Result<()> {
    let mut token = 0;
    let app = window.app_handle().clone();
    // 2026-11-09: register all guards here so a failed HRESULT blocks board startup through install().
    core.add_NewWindowRequested(
        &NewWindowRequestedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else {
                return Ok(());
            };
            args.SetHandled(true)?;
            let mut uri = PWSTR::null();
            args.Uri(&mut uri)?;
            if let Ok(url) = tauri::Url::parse(&webview2_com::take_pwstr(uri)) {
                window::open_external(&app, &url);
            }
            Ok(())
        })),
        &mut token,
    )?;
    core.add_PermissionRequested(
        &PermissionRequestedEventHandler::create(Box::new(|_, args| {
            let Some(args) = args else {
                return Ok(());
            };
            args.SetState(COREWEBVIEW2_PERMISSION_STATE_DENY)?;
            let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
            args.PermissionKind(&mut kind)?;
            if kind == COREWEBVIEW2_PERMISSION_KIND_NOTIFICATIONS {
                args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)?;
            }
            Ok(())
        })),
        &mut token,
    )?;
    Ok(())
}

unsafe fn install_zoom_keys(
    window: &WebviewWindow,
    controller: &ICoreWebView2Controller,
) -> windows::core::Result<()> {
    let mut token = 0;
    let key_window = window.clone();
    controller.add_AcceleratorKeyPressed(
        &AcceleratorKeyPressedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else {
                return Ok(());
            };
            let mut kind = COREWEBVIEW2_KEY_EVENT_KIND::default();
            args.KeyEventKind(&mut kind)?;
            if kind != COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN {
                return Ok(());
            }
            if GetKeyState(i32::from(VK_CONTROL.0)) >= 0
                || GetKeyState(i32::from(VK_MENU.0)) < 0
                || GetKeyState(i32::from(VK_LWIN.0)) < 0
                || GetKeyState(i32::from(VK_RWIN.0)) < 0
            {
                return Ok(());
            }
            let mut key = 0;
            args.VirtualKey(&mut key)?;
            let action = match VIRTUAL_KEY(key as u16) {
                VK_OEM_PLUS | VK_ADD => Some(0.1),
                VK_OEM_MINUS | VK_SUBTRACT => Some(-0.1),
                VK_0 | VK_NUMPAD0 => Some(0.0),
                _ => None,
            };
            if let Some(delta) = action {
                args.SetHandled(true)?;
                let app = key_window.app_handle().clone();
                let dispatch = app.clone();
                let _ = app.run_on_main_thread(move || {
                    if delta == 0.0 {
                        window::set_zoom(&dispatch, 1.0);
                    } else {
                        window::change_zoom(&dispatch, delta);
                    }
                });
            }
            Ok(())
        })),
        &mut token,
    )?;
    Ok(())
}

unsafe fn install_zoom(
    window: &WebviewWindow,
    controller: &ICoreWebView2Controller,
) -> windows::core::Result<()> {
    let mut token = 0;
    let zoom_window = window.clone();
    controller.add_ZoomFactorChanged(
        &ZoomFactorChangedEventHandler::create(Box::new(move |controller, _| {
            if let Some(controller) = controller {
                let mut factor = 1.0;
                controller.ZoomFactor(&mut factor)?;
                let app = zoom_window.app_handle();
                let stored = app::state(app).settings.lock().unwrap().zoom_factor;
                if stored != factor {
                    window::set_zoom(app, factor);
                }
            }
            Ok(())
        })),
        &mut token,
    )?;
    Ok(())
}

unsafe fn install_console(
    window: &WebviewWindow,
    core: &ICoreWebView2,
) -> windows::core::Result<()> {
    let receiver =
        core.GetDevToolsProtocolEventReceiver(&HSTRING::from("Runtime.consoleAPICalled"))?;
    let log = app::state(window.app_handle()).log.clone();
    let mut token = 0;
    receiver.add_DevToolsProtocolEventReceived(
        &DevToolsProtocolEventReceivedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else {
                return Ok(());
            };
            let mut parameters = PWSTR::null();
            args.ParameterObjectAsJson(&mut parameters)?;
            let parameters = webview2_com::take_pwstr(parameters);
            let Ok(value) = serde_json::from_str::<serde_json::Value>(&parameters) else {
                return Ok(());
            };
            if !matches!(value["type"].as_str(), Some("warning" | "error")) {
                return Ok(());
            }
            let arguments = value["args"]
                .as_array()
                .map(|args| {
                    args.iter()
                        .map(|arg| {
                            arg["value"]
                                .as_str()
                                .or_else(|| arg["description"].as_str())
                                .map(str::to_owned)
                                .unwrap_or_else(|| arg["value"].to_string())
                        })
                        .collect::<Vec<_>>()
                        .join(" ")
                })
                .unwrap_or_default();
            log.write(format!(
                "[renderer {}] {arguments}",
                value["type"].as_str().unwrap_or("error")
            ));
            Ok(())
        })),
        &mut token,
    )?;
    core.CallDevToolsProtocolMethod(
        &HSTRING::from("Runtime.enable"),
        &HSTRING::from("{}"),
        &CallDevToolsProtocolMethodCompletedHandler::create(Box::new(|result, _| result)),
    )
}

pub async fn board_script(window: &WebviewWindow, origin: Option<String>) -> Result<(), String> {
    let shell = app::state(window.app_handle());
    let (sender, receiver) = tokio::sync::oneshot::channel();
    window
        .with_webview(move |webview| {
            let result = (|| unsafe {
                let core = webview.controller().CoreWebView2()?;
                if let Some(previous) = shell.board_script.lock().unwrap().take() {
                    core.RemoveScriptToExecuteOnDocumentCreated(&HSTRING::from(previous))?;
                }
                Ok::<_, windows::core::Error>(core)
            })();
            let core = match result {
                Ok(core) => core,
                Err(error) => {
                    let _ = sender.send(Err(error.to_string()));
                    return;
                }
            };
            let Some(origin) = origin else {
                let _ = sender.send(Ok(()));
                return;
            };
            let script = format!(
                r#"(() => {{
          if (window.top !== window || location.origin !== {}) return;
          const invoke = window.__TAURI_INTERNALS__.invoke;
          let leaveApproved = false;
          addEventListener('deckmate:leave-approved', () => {{ leaveApproved = true; }});
          addEventListener('beforeunload', event => {{ if (leaveApproved) event.stopImmediatePropagation(); }}, true);
          void invoke('board_set_dirty', {{ dirty: false }}).catch(console.error);
          Object.defineProperty(window, 'deckmateBoard', {{ value: Object.freeze({{
            recentProjects: () => invoke('board_recent_projects'),
            workspaceProjects: () => invoke('board_workspace_projects'),
            addToWorkspace: source => invoke('board_add_to_workspace', {{ source }}),
            removeFromWorkspace: folder => invoke('board_remove_from_workspace', {{ folder }}),
            moveInWorkspace: (folder, index) => invoke('board_move_in_workspace', {{ folder, index }}),
            switchProject: folder => invoke('board_switch_project', {{ folder }}),
            showStartScreen: () => invoke('board_show_start_screen'),
            setDirty: dirty => invoke('board_set_dirty', {{ dirty }})
          }}) }});
        }})();"#,
                serde_json::to_string(&origin).unwrap()
            );
            let sender = std::sync::Arc::new(std::sync::Mutex::new(Some(sender)));
            let callback_sender = sender.clone();
            let callback = AddScriptToExecuteOnDocumentCreatedCompletedHandler::create(Box::new(
                move |error, id| {
                    let result = error.map_err(|error| error.to_string());
                    if result.is_ok() {
                        *shell.board_script.lock().unwrap() = Some(id);
                    }
                    if let Some(sender) = callback_sender.lock().unwrap().take() {
                        let _ = sender.send(result);
                    }
                    Ok(())
                },
            ));
            if let Err(error) = unsafe {
                core.AddScriptToExecuteOnDocumentCreated(&HSTRING::from(script), &callback)
            } {
                if let Some(sender) = sender.lock().unwrap().take() {
                    let _ = sender.send(Err(error.to_string()));
                }
            }
        })
        .map_err(|error| error.to_string())?;
    receiver.await.map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stale_navigation_failure_is_ignored_while_the_next_launcher_loads() {
        let latest = Some(Navigation {
            id: 12,
            launcher: true,
            succeeded: false,
        });
        assert!(!launcher_failure_is_relevant(latest, 11));
    }

    #[test]
    fn interrupted_navigation_is_ignored_after_the_next_launcher_succeeds() {
        let latest = Some(Navigation {
            id: 12,
            launcher: true,
            succeeded: true,
        });
        // 2026-11-09: CONNECTION_ABORTED (9) and OPERATION_CANCELED (14) have the same relevance rule.
        assert!(!launcher_failure_is_relevant(latest, 11));
        assert!(!launcher_failure_is_relevant(latest, 12));
    }

    #[test]
    fn a_real_failure_of_the_current_launcher_is_shown() {
        assert!(launcher_failure_is_relevant(
            Some(Navigation {
                id: 12,
                launcher: true,
                succeeded: false,
            }),
            12
        ));
    }

    #[test]
    fn board_and_untracked_failures_are_not_launcher_failures() {
        assert!(!launcher_failure_is_relevant(
            Some(Navigation {
                id: 12,
                launcher: false,
                succeeded: false,
            }),
            12
        ));
        assert!(!launcher_failure_is_relevant(None, 12));
    }

    #[test]
    fn renderer_budget_allows_two_reloads_then_keeps_asking_during_a_crash_loop() {
        let (budget, action) = renderer_crash(ReloadBudget::default(), Duration::ZERO);
        assert_eq!(action, Recovery::Reload);
        let (mut budget, action) = renderer_crash(budget, Duration::from_secs(1));
        assert_eq!(action, Recovery::Reload);
        for second in 2..180 {
            let (next, action) = renderer_crash(budget, Duration::from_secs(second));
            assert_eq!(action, Recovery::Ask);
            assert_eq!(next.automatic_reloads, MAX_AUTOMATIC_RELOADS);
            budget = next;
        }
    }

    #[test]
    fn renderer_budget_resets_only_after_sixty_seconds_without_a_crash() {
        let budget = ReloadBudget {
            automatic_reloads: MAX_AUTOMATIC_RELOADS,
            last_crash: Some(Duration::from_secs(10)),
        };
        let (updated, action) = renderer_crash(budget, Duration::from_millis(69999));
        assert_eq!(action, Recovery::Ask);
        assert_eq!(updated.last_crash, Some(Duration::from_millis(69999)));
        let (reset, action) = renderer_crash(budget, Duration::from_secs(70));
        assert_eq!(action, Recovery::Reload);
        assert_eq!(reset.automatic_reloads, 1);
        assert_eq!(
            renderer_crash(reset, Duration::from_secs(71)).1,
            Recovery::Reload
        );
    }

    #[test]
    fn process_recovery_distinguishes_crash_hang_and_browser_exit() {
        assert_eq!(
            recovery(COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED),
            Recovery::Reload
        );
        assert_eq!(
            recovery(COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE),
            Recovery::Ask
        );
        assert_eq!(
            recovery(COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED),
            Recovery::Restart
        );
        assert_eq!(
            recovery(COREWEBVIEW2_PROCESS_FAILED_KIND_GPU_PROCESS_EXITED),
            Recovery::None
        );
    }

    #[test]
    fn context_menu_allows_only_editing_and_spelling() {
        for name in ["cut", "copy", "paste", "selectAll", "spellCheck"] {
            assert!(editing_menu_item(name));
        }
        for name in [
            "reload",
            "print",
            "saveAs",
            "inspectElement",
            "back",
            "openLinkInNewWindow",
            "custom",
            "",
        ] {
            assert!(!editing_menu_item(name));
        }
    }
}
