use std::{env, io, path::PathBuf};

#[derive(Clone)]
pub struct Programs {
    pub node: PathBuf,
    pub server: PathBuf,
    pub cli: PathBuf,
    pub package: PathBuf,
}

impl Programs {
    pub fn resolve(resources: Option<PathBuf>) -> io::Result<Self> {
        let root = if cfg!(debug_assertions) {
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
        } else {
            resources
                .unwrap_or(env::current_exe()?.parent().unwrap().to_owned())
                .join("deckmate")
        };
        let node = if cfg!(debug_assertions) {
            env::var_os("DECKMATE_DESKTOP_NODE")
                .map(PathBuf::from)
                .unwrap_or_else(|| "node".into())
        } else {
            env::current_exe()?.with_file_name("node.exe")
        };
        let server = match (
            cfg!(debug_assertions),
            env::var_os("DECKMATE_DESKTOP_SERVER"),
        ) {
            (true, Some(path)) => std::path::absolute(path)?,
            _ => root.join("dist/server/main.js"),
        };
        Ok(Self {
            node,
            server,
            cli: root.join("bin/deckmate.mjs"),
            package: root.join("package.json"),
        })
    }

    pub fn deckmate_version(&self) -> String {
        std::fs::read(&self.package)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
            .and_then(|value| value["version"].as_str().map(str::to_owned))
            .unwrap_or_else(|| "—".into())
    }
}

pub fn settings_dir() -> io::Result<PathBuf> {
    if let Some(folder) = debug_settings_dir() {
        return Ok(folder);
    }
    env::var_os("APPDATA")
        .map(|root| PathBuf::from(root).join("Deckmate"))
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "APPDATA is not set"))
}

/// 2026-11-09: DECKMATE_DESKTOP_SETTINGS_DIR relocates settings, log and search index so an
/// automated smoke run of the shell (tools/desktop-smoke.ts) never touches the real
/// %APPDATA%\Deckmate. Debug-only by compilation: release builds replace this body with None,
/// so a release binary never reads the variable.
#[cfg(debug_assertions)]
fn debug_settings_dir() -> Option<PathBuf> {
    env::var_os("DECKMATE_DESKTOP_SETTINGS_DIR")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

#[cfg(not(debug_assertions))]
fn debug_settings_dir() -> Option<PathBuf> {
    None
}

pub fn debug_webview_dir() -> Option<PathBuf> {
    // 2026-11-11: isolated shell checks must not change the user's WebView2 profile.
    debug_settings_dir().map(|directory| directory.join("webview"))
}

pub fn is_network_path(path: &str) -> bool {
    classify_network_path(path, remote_drive, |path| {
        std::fs::canonicalize(path)
            .ok()
            .map(|path| path.to_string_lossy().into_owned())
    })
}

fn has_device_prefix(path: &str) -> bool {
    let mut chars = path.chars();
    matches!(chars.next(), Some('/' | '\\')) && matches!(chars.next(), Some('/' | '\\'))
}

fn drive_root(path: &str) -> Option<String> {
    let bytes = path.as_bytes();
    (bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':')
        .then(|| format!("{}:\\", bytes[0] as char))
}

fn remote_drive(root: &str) -> bool {
    use windows::{core::PCWSTR, Win32::Storage::FileSystem::GetDriveTypeW};
    const DRIVE_REMOTE: u32 = 4;
    let root: Vec<u16> = root.encode_utf16().chain(Some(0)).collect();
    // 2026-11-09: querying the root catches mapped drives before touching a remote directory.
    unsafe { GetDriveTypeW(PCWSTR(root.as_ptr())) == DRIVE_REMOTE }
}

fn classify_network_path(
    path: &str,
    remote: impl Fn(&str) -> bool,
    canonical: impl Fn(&str) -> Option<String>,
) -> bool {
    if has_device_prefix(path) || drive_root(path).is_some_and(|root| remote(&root)) {
        return true;
    }
    // 2026-11-09: the nearest existing parent also protects creation below a junction.
    let mut candidate = Some(std::path::Path::new(path));
    while let Some(path) = candidate {
        if let Some(resolved) = canonical(&path.to_string_lossy()) {
            // 2026-11-09: canonicalize adds this prefix to ordinary local DOS paths too.
            let dos = resolved.strip_prefix(r"\\?\").filter(|rest| {
                let bytes = rest.as_bytes();
                bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
            });
            let resolved = dos.unwrap_or(&resolved);
            return has_device_prefix(resolved)
                || drive_root(resolved).is_some_and(|root| remote(&root));
        }
        candidate = path.parent();
    }
    false
}

pub fn is_absolute(path: &str) -> bool {
    if path.starts_with(['/', '\\']) {
        return true;
    }
    let bytes = path.as_bytes();
    bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'/' | b'\\')
}

pub fn resolve(path: &str) -> io::Result<String> {
    std::path::absolute(path).map(|path| path.to_string_lossy().into_owned())
}

pub fn same_path(a: &str, b: &str) -> bool {
    let normalize = |path: &str| {
        resolve(path)
            .unwrap_or_else(|_| path.into())
            .replace('/', "\\")
            .trim_end_matches('\\')
            .to_lowercase()
    };
    normalize(a) == normalize(b)
}

pub fn project_name(path: &str) -> String {
    let path = path.trim_end_matches(['/', '\\']);
    // 2026-11-09: a drive root has no folder name; the drive ("Z:") keeps the title and recent entry readable.
    if path.len() == 2 && path.ends_with(':') {
        return path.to_uppercase();
    }
    path.rsplit(['/', '\\']).next().unwrap_or(path).into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drive_roots_are_named_after_the_drive() {
        assert_eq!(project_name("Z:\\"), "Z:");
        assert_eq!(project_name("c:"), "C:");
        assert_eq!(project_name("C:\\Games\\Моя игра\\"), "Моя игра");
    }

    #[test]
    fn network_and_device_paths_require_dialog_trust() {
        for path in [
            r"\\server\share",
            "//server/share",
            r"\\?\C:\demo",
            r"\\.\pipe\test",
            r"\/host",
        ] {
            assert!(classify_network_path(path, |_| false, |_| None), "{path}");
            assert!(is_absolute(path));
        }
        for path in [
            r"C:\demo", "C:/demo", "/demo", r"\demo", "relative", "C:demo",
        ] {
            assert!(!classify_network_path(path, |_| false, |_| None), "{path}");
        }
        assert!(!is_absolute("C:demo"));
        assert!(!is_absolute("relative"));
    }

    #[test]
    fn classifies_mapped_subst_and_canonical_aliases_without_io() {
        assert!(classify_network_path(
            r"Z:\demo",
            |root| root == r"Z:\",
            |_| panic!("remote drive must short circuit")
        ));
        for target in [
            r"\\?\UNC\host\share",
            r"\\.\device",
            r"\\?\Volume{test}\demo",
            r"\\host\share",
            r"\\?\Z:\demo",
        ] {
            assert!(
                classify_network_path(r"C:\alias", |root| root == r"Z:\", |_| Some(target.into())),
                "{target}"
            );
        }
        for target in [r"\\?\C:\demo", r"C:\demo"] {
            assert!(!classify_network_path(
                r"C:\alias",
                |_| false,
                |_| Some(target.into())
            ));
        }
        assert!(classify_network_path(
            r"C:\alias\new",
            |_| false,
            |path| { (path == r"C:\alias").then(|| r"\\?\UNC\host\share".into()) }
        ));
        assert!(!classify_network_path(r"C:\missing", |_| false, |_| None));
    }

    #[test]
    fn compares_windows_paths_without_case_or_separator_differences() {
        assert!(same_path(r"C:\Projects\Demo\", "c:/projects/demo"));
        assert!(same_path(r"C:\Projects\other\..\Demo", "c:/projects/demo"));
        assert!(!same_path(r"C:\Projects\Demo", r"C:\Projects\Demo2"));
    }

    #[test]
    fn debug_settings_dir_override_relocates_settings() {
        // 2026-11-09: only this test reads DECKMATE_DESKTOP_SETTINGS_DIR, so mutating the
        // process environment is safe under cargo's parallel test runner.
        let original = env::var_os("DECKMATE_DESKTOP_SETTINGS_DIR");
        env::set_var("DECKMATE_DESKTOP_SETTINGS_DIR", r"C:\smoke\settings");
        assert_eq!(settings_dir().unwrap(), PathBuf::from(r"C:\smoke\settings"));
        assert_eq!(
            debug_webview_dir(),
            Some(PathBuf::from(r"C:\smoke\settings\webview"))
        );
        env::set_var("DECKMATE_DESKTOP_SETTINGS_DIR", "");
        assert_ne!(settings_dir().unwrap(), PathBuf::from(r"C:\smoke\settings"));
        assert!(debug_webview_dir().is_none());
        match original {
            Some(value) => env::set_var("DECKMATE_DESKTOP_SETTINGS_DIR", value),
            None => env::remove_var("DECKMATE_DESKTOP_SETTINGS_DIR"),
        }
    }
}
