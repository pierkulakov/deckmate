use crate::{log::Log, paths, settings, texts};
use std::{
    backtrace::Backtrace,
    sync::atomic::{AtomicBool, Ordering},
};
use windows::{
    core::{HSTRING, PCWSTR, PWSTR},
    Win32::{
        Foundation::ERROR_FILE_NOT_FOUND,
        UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK},
    },
};

pub fn install_hook() {
    std::panic::set_hook(Box::new(|panic| {
        static REPORTING: AtomicBool = AtomicBool::new(false);
        if !REPORTING.swap(true, Ordering::SeqCst) {
            report(&panic.to_string(), false);
        }
        // 2026-11-09: a panic in a background task must not leave a broken shell silently running.
        std::process::exit(1);
    }));
}

fn runtime_missing() -> bool {
    let mut version = PWSTR::null();
    let result = unsafe {
        webview2_com::Microsoft::Web::WebView2::Win32::GetAvailableCoreWebView2BrowserVersionString(
            PCWSTR::null(),
            &mut version,
        )
    };
    if !version.is_null() {
        let _ = webview2_com::take_pwstr(version);
    }
    result.is_err_and(|error| {
        error.code() == windows::core::HRESULT::from_win32(ERROR_FILE_NOT_FOUND.0)
    })
}

pub fn startup(error: &dyn std::fmt::Display) -> ! {
    report(&error.to_string(), runtime_missing());
    std::process::exit(1);
}

fn report(error: &str, missing_runtime: bool) {
    let locale = settings::system_locale();
    let mut language = settings::Settings::normalize(serde_json::Value::Null, &locale).language;
    if let Ok(directory) = paths::settings_dir() {
        // 2026-11-09: use an independent handle: the panic may own a shell mutex already.
        let log = Log::open(&directory);
        language = settings::Settings::load(&directory, &locale, &log).language;
        log.write(format!("fatal: {error}\n{}", Backtrace::force_capture()));
    }
    let message = if missing_runtime {
        texts::text(&language, "webviewMissing").into()
    } else {
        texts::format(&language, "fatalError", "error", error)
    };
    unsafe {
        let _ = MessageBoxW(
            None,
            &HSTRING::from(message),
            &HSTRING::from(texts::text(&language, "fatalTitle")),
            MB_OK | MB_ICONERROR,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fatal_and_missing_runtime_messages_cover_both_languages() {
        for language in ["en", "ru"] {
            assert!(texts::format(language, "fatalError", "error", "detail").contains("detail"));
            assert!(texts::text(language, "webviewMissing")
                .contains("https://developer.microsoft.com/microsoft-edge/webview2/"));
        }
        assert_ne!(
            texts::text("en", "fatalTitle"),
            texts::text("ru", "fatalTitle")
        );
    }
}
