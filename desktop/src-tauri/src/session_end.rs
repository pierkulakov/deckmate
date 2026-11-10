use crate::{app, texts, window};
use std::{cell::Cell, sync::atomic::Ordering, time::Duration};
use tauri::{AppHandle, Manager, WebviewWindow};
use windows::{
    core::{BOOL, HSTRING},
    Win32::{
        Foundation::{HWND, LPARAM, LRESULT, WPARAM},
        System::{
            Shutdown::{ShutdownBlockReasonCreate, ShutdownBlockReasonDestroy},
            Threading::GetCurrentThreadId,
        },
        UI::{
            Shell::{DefSubclassProc, GetWindowSubclass, RemoveWindowSubclass, SetWindowSubclass},
            WindowsAndMessaging::{
                EnumThreadWindows, GetClassNameW, WM_ENDSESSION, WM_NCDESTROY, WM_QUERYENDSESSION,
            },
        },
    },
};

// 2026-11-09: reserve 100 ms of the two-second ceiling for Windows timer granularity and returning to tao;
// Windows' own roughly five-second wait must also leave time for WebView2 to close.
const STOP_BUDGET: Duration = Duration::from_millis(1900);
const SUBCLASS_ID: usize = 0x444D_5345;

#[derive(Clone, Copy, Debug)]
enum Event {
    Query,
    Cancel,
    End,
    Cleaned,
}

#[derive(Debug, PartialEq)]
enum Action {
    Pass,
    Block,
    Clear,
    Shutdown,
}

fn action(event: Event, dirty: bool, blocked: bool) -> Action {
    match event {
        Event::End => Action::Shutdown,
        Event::Query if dirty => Action::Block,
        Event::Cancel if blocked => Action::Clear,
        Event::Query | Event::Cleaned if blocked && !dirty => Action::Clear,
        _ => Action::Pass,
    }
}

struct Context {
    app: AppHandle,
    blocked: Cell<bool>,
    thread_target: bool,
}

pub fn install(window: &WebviewWindow) -> tauri::Result<()> {
    install_hwnd(window.app_handle(), window.hwnd()?, false)?;
    if window.label() == "main" {
        let mut target = HWND::default();
        unsafe {
            let _ = EnumThreadWindows(
                GetCurrentThreadId(),
                Some(find_thread_target),
                LPARAM(&mut target as *mut HWND as isize),
            );
        }
        if target.is_invalid() {
            return Err(std::io::Error::other("tao session window not found").into());
        }
        install_hwnd(window.app_handle(), target, true)?;
        watch_dirty(window.app_handle().clone());
    }
    Ok(())
}

unsafe extern "system" fn find_thread_target(hwnd: HWND, data: LPARAM) -> BOOL {
    let mut class = [0; 64];
    let length = GetClassNameW(hwnd, &mut class) as usize;
    if class[..length] == "Tao Thread Event Target".encode_utf16().collect::<Vec<_>>() {
        *(data.0 as *mut HWND) = hwnd;
        return BOOL(0);
    }
    BOOL(1)
}

fn install_hwnd(app: &AppHandle, hwnd: HWND, thread_target: bool) -> tauri::Result<()> {
    let context = Box::new(Context {
        app: app.clone(),
        blocked: Cell::new(false),
        thread_target,
    });
    let data = Box::into_raw(context);
    // 2026-11-09: both callers install on the HWND's owning thread; NCDESTROY releases the context.
    if !unsafe { SetWindowSubclass(hwnd, Some(subclass), SUBCLASS_ID, data as usize) }.as_bool() {
        unsafe { drop(Box::from_raw(data)) };
        return Err(std::io::Error::other("SetWindowSubclass failed").into());
    }
    Ok(())
}

fn watch_dirty(app: AppHandle) {
    let shell = app::state(&app);
    tauri::async_runtime::spawn(async move {
        loop {
            shell.unsaved.dirty.wait_until_cleaned().await;
            let dispatch = app.clone();
            if app
                .run_on_main_thread(move || {
                    unsafe { apply_to_windows(&dispatch, Event::Cleaned) };
                })
                .is_err()
            {
                break;
            }
        }
    });
}

unsafe fn apply_to_windows(app: &AppHandle, event: Event) -> bool {
    let mut blocked = false;
    for window in app.webview_windows().values() {
        let Ok(hwnd) = window.hwnd() else {
            continue;
        };
        let mut data = 0;
        if GetWindowSubclass(hwnd, Some(subclass), SUBCLASS_ID, Some(&mut data)).as_bool() {
            blocked |= apply(hwnd, &*(data as *const Context), event);
        }
    }
    blocked
}

unsafe fn clear(hwnd: HWND, context: &Context) {
    if context.blocked.replace(false) {
        if let Err(error) = ShutdownBlockReasonDestroy(hwnd) {
            app::state(&context.app)
                .log
                .write(format!("Windows shutdown reason cleanup failed: {error}"));
        }
    }
}

unsafe fn apply(hwnd: HWND, context: &Context, event: Event) -> bool {
    let shell = app::state(&context.app);
    match action(
        event,
        shell.unsaved.dirty.load(Ordering::SeqCst),
        context.blocked.get(),
    ) {
        Action::Block => {
            let reason = HSTRING::from(texts::text(&shell.language(), "shutdownUnsaved"));
            match ShutdownBlockReasonCreate(hwnd, &reason) {
                Ok(()) => context.blocked.set(true),
                Err(error) => shell
                    .log
                    .write(format!("Windows shutdown reason failed: {error}")),
            }
            true
        }
        Action::Clear => {
            clear(hwnd, context);
            false
        }
        Action::Shutdown => {
            shutdown(&context.app);
            false
        }
        Action::Pass => false,
    }
}

unsafe extern "system" fn subclass(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _: usize,
    data: usize,
) -> LRESULT {
    let context = &*(data as *const Context);
    let event = match message {
        // 2026-11-09: Restart Manager's ENDSESSION_CLOSEAPP has the same unsaved-work policy.
        WM_QUERYENDSESSION if context.thread_target => {
            // 2026-11-09: a query to tao's hidden target must register reasons on visible windows.
            if apply_to_windows(&context.app, Event::Query) {
                return LRESULT(0);
            }
            None
        }
        WM_QUERYENDSESSION => Some(Event::Query),
        WM_ENDSESSION if wparam.0 == 0 => {
            if context.thread_target {
                apply_to_windows(&context.app, Event::Cancel);
            }
            Some(Event::Cancel)
        }
        WM_ENDSESSION => Some(Event::End),
        WM_NCDESTROY => {
            clear(hwnd, context);
            let _ = RemoveWindowSubclass(hwnd, Some(subclass), SUBCLASS_ID);
            let result = DefSubclassProc(hwnd, message, wparam, lparam);
            drop(Box::from_raw(data as *mut Context));
            return result;
        }
        _ => None,
    };
    if event.is_some_and(|event| apply(hwnd, context, event)) {
        return LRESULT(0);
    }
    let exit = matches!(event, Some(Event::End)) && !context.thread_target;
    let app = context.app.clone();
    // 2026-11-09: tao exits here only for its hidden thread target, which may receive the broadcast first.
    let result = DefSubclassProc(hwnd, message, wparam, lparam);
    if exit {
        // 2026-11-09: Restart Manager can target a visible HWND without notifying tao's hidden window.
        app.exit(0);
    }
    result
}

fn shutdown(app: &AppHandle) {
    let deadline = tokio::time::Instant::now() + STOP_BUDGET;
    let shell = app::state(app);
    shell.log.write("Windows session ending");
    if shell.quit_ready.swap(true, Ordering::SeqCst) {
        return;
    }
    shell.closing.store(true, Ordering::SeqCst);
    shell.quit_requested.store(true, Ordering::SeqCst);
    window::save_on_exit(app);
    let process = shell
        .current
        .lock()
        .unwrap()
        .as_ref()
        .map(|current| current.process.clone());
    shell.next_launch();
    // 2026-11-09: include an in-flight project operation in the same deadline, not a second wait.
    let stopped = tauri::async_runtime::block_on(async {
        tokio::time::timeout_at(deadline, async {
            let _guard = shell.lifecycle.lock().await;
            shell.stop().await;
            if let Some(process) = process {
                let exit = process.exited().await;
                shell.log.write(format!(
                    "Windows session ending: server stopped; code={}, forced={}",
                    crate::server::exit_code(exit.code),
                    exit.forced
                ));
            }
        })
        .await
    });
    if stopped.is_err() {
        shell.log.write(
            "Windows session ending: server cleanup deadline reached; Job Object will reap it",
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn queries_block_only_unsaved_work_without_a_dialog() {
        for blocked in [false, true] {
            assert_eq!(action(Event::Query, true, blocked), Action::Block);
        }
        assert_eq!(action(Event::Query, false, false), Action::Pass);
        assert_eq!(action(Event::Query, false, true), Action::Clear);
    }

    #[test]
    fn cancellation_and_clean_work_release_only_existing_reasons() {
        for dirty in [false, true] {
            assert_eq!(action(Event::Cancel, dirty, true), Action::Clear);
            assert_eq!(action(Event::Cancel, dirty, false), Action::Pass);
        }
        assert_eq!(action(Event::Cleaned, false, true), Action::Clear);
        assert_eq!(action(Event::Cleaned, true, true), Action::Pass);
        assert_eq!(action(Event::Cleaned, false, false), Action::Pass);
    }

    #[test]
    fn forced_session_end_always_cleans_up_even_with_unsaved_work() {
        for dirty in [false, true] {
            for blocked in [false, true] {
                assert_eq!(action(Event::End, dirty, blocked), Action::Shutdown);
            }
        }
    }
}
