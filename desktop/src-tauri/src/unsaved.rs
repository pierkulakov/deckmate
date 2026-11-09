use crate::{app, menu, server::Failure};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Manager};

#[derive(Default)]
pub struct State {
    pub dirty: AtomicBool,
    confirmation: tokio::sync::Mutex<()>,
}

#[derive(Debug, PartialEq)]
enum Decision {
    Leave,
    Stay,
    Ask,
}

fn decision(dirty: bool, refuse: bool) -> Decision {
    match (dirty, refuse) {
        (false, _) => Decision::Leave,
        (true, true) => Decision::Stay,
        (true, false) => Decision::Ask,
    }
}

#[cfg(debug_assertions)]
fn refuse_dirty() -> bool {
    // 2026-11-09: CDP cannot answer native dialogs; the smoke exercises the real cancellation path.
    std::env::var("DECKMATE_DESKTOP_DIRTY_POLICY").is_ok_and(|value| value == "refuse")
}

#[cfg(not(debug_assertions))]
fn refuse_dirty() -> bool {
    false
}

pub async fn confirm(app: &AppHandle) -> Result<(), Failure> {
    let shell = app::state(app);
    let cancelled = || shell.failure("cancelled", "leaveCancelled");
    let _guard = shell
        .unsaved
        .confirmation
        .try_lock()
        .map_err(|_| cancelled())?;
    let leave = match decision(shell.unsaved.dirty.load(Ordering::SeqCst), refuse_dirty()) {
        Decision::Leave => true,
        Decision::Stay => false,
        Decision::Ask => menu::ask(app, "unsavedChanges", "leave", "stay").await,
    };
    if leave {
        Ok(())
    } else {
        shell.log.write("unsaved work: action cancelled");
        Err(cancelled())
    }
}

pub fn leave(app: &AppHandle) {
    // 2026-11-09: the native answer must not be followed by a second beforeunload after the server stops.
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.eval("dispatchEvent(new Event('deckmate:leave-approved'))");
    }
    app::state(app).unsaved.dirty.store(false, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clean_work_leaves_dirty_work_asks_and_smoke_refuses_only_dirty_work() {
        assert_eq!(decision(false, false), Decision::Leave);
        assert_eq!(decision(false, true), Decision::Leave);
        assert_eq!(decision(true, false), Decision::Ask);
        assert_eq!(decision(true, true), Decision::Stay);
    }
}
