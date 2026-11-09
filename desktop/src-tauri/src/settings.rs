use crate::{
    log::Log,
    paths::{is_absolute, project_name, same_path},
};
use chrono::{DateTime, NaiveDate, NaiveDateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::{
    fs,
    io::{self, Read},
    path::Path,
    sync::atomic::{AtomicU64, Ordering},
};

const MAX_RECENT: usize = 10;
const MAX_SETTINGS_BYTES: u64 = 1024 * 1024;
static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Recent {
    pub path: String,
    pub name: String,
    pub last_opened: Option<String>,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq)]
pub struct Bounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub last_project: Option<String>,
    pub recent: Vec<Recent>,
    pub language: String,
    pub zoom_factor: f64,
    pub window_bounds: Option<Bounds>,
    pub window_maximized: bool,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

pub fn clamp_zoom(factor: f64) -> f64 {
    if !factor.is_finite() {
        return 1.0;
    }
    (factor.clamp(0.5, 2.0) * 10.0).round() / 10.0
}

pub fn valid_bounds(value: &Value) -> Option<Bounds> {
    let x = value["x"].as_f64()?;
    let y = value["y"].as_f64()?;
    let width = value["width"].as_f64()?;
    let height = value["height"].as_f64()?;
    if width <= 0.0 || height <= 0.0 {
        return None;
    }
    Some(Bounds {
        x: (x + 0.5).floor() as i32,
        y: (y + 0.5).floor() as i32,
        width: width.round() as u32,
        height: height.round() as u32,
    })
}

fn valid_date(date: &str) -> bool {
    DateTime::parse_from_rfc3339(date).is_ok()
        || DateTime::parse_from_rfc2822(date).is_ok()
        || [
            "%Y-%m-%dT%H:%M:%S%.f",
            "%Y-%m-%d %H:%M:%S%.f",
            "%Y-%m-%dT%H:%M",
        ]
        .iter()
        .any(|format| NaiveDateTime::parse_from_str(date, format).is_ok())
        || ["%Y-%m-%d", "%Y/%m/%d", "%m/%d/%Y", "%b %d %Y", "%B %d, %Y"]
            .iter()
            .any(|format| NaiveDate::parse_from_str(date, format).is_ok())
}

pub fn normalize_recent(value: &Value) -> Vec<Recent> {
    let mut recent: Vec<Recent> = Vec::new();
    let Some(entries) = value.as_array() else {
        return recent;
    };
    for entry in entries {
        let Some(path) = entry["path"].as_str().filter(|path| is_absolute(path)) else {
            continue;
        };
        if recent.iter().any(|other| same_path(&other.path, path)) {
            continue;
        }
        recent.push(Recent {
            path: path.into(),
            name: entry["name"]
                .as_str()
                .map(str::to_owned)
                .unwrap_or_else(|| project_name(path)),
            last_opened: entry["lastOpened"]
                .as_str()
                .filter(|date| valid_date(date))
                .map(str::to_owned),
        });
        if recent.len() == MAX_RECENT {
            break;
        }
    }
    recent
}

impl Settings {
    pub fn normalize(value: Value, locale: &str) -> Self {
        let mut extra = value.as_object().cloned().unwrap_or_default();
        for key in [
            "lastProject",
            "recent",
            "language",
            "zoomFactor",
            "windowBounds",
            "windowMaximized",
        ] {
            extra.remove(key);
        }
        Self {
            last_project: value["lastProject"]
                .as_str()
                .filter(|path| is_absolute(path))
                .map(str::to_owned),
            recent: normalize_recent(&value["recent"]),
            language: match value["language"].as_str() {
                Some(language @ ("en" | "ru")) => language.into(),
                _ if locale.to_lowercase().starts_with("ru") => "ru".into(),
                _ => "en".into(),
            },
            zoom_factor: clamp_zoom(value["zoomFactor"].as_f64().unwrap_or(1.0)),
            window_bounds: valid_bounds(&value["windowBounds"]),
            window_maximized: value["windowMaximized"] == true,
            extra,
        }
    }

    pub fn load(directory: &Path, locale: &str, log: &Log) -> Self {
        let value = read_settings(&directory.join("desktop.json"))
            .inspect_err(|error| {
                if error.kind() == io::ErrorKind::FileTooLarge {
                    log.write("desktop.json exceeds 1 MiB; keeping the file and using defaults");
                }
            })
            .ok()
            .and_then(|text| serde_json::from_str(text.trim_start_matches('\u{feff}')).ok())
            .unwrap_or(Value::Null);
        Self::normalize(value, locale)
    }

    pub fn save(&self, directory: &Path) -> io::Result<()> {
        // 2026-11-09: automatic bounds saves must not overwrite a rejected settings file.
        if fs::metadata(directory.join("desktop.json"))
            .is_ok_and(|stat| stat.len() > MAX_SETTINGS_BYTES)
        {
            return Ok(());
        }
        fs::create_dir_all(directory)?;
        let temporary = directory.join(format!(
            "desktop.json.tmp-{}-{}",
            std::process::id(),
            TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        let result = (|| {
            let text = serde_json::to_string_pretty(self)? + "\n";
            fs::write(&temporary, text)?;
            fs::rename(&temporary, directory.join("desktop.json"))
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        result
    }

    pub fn remember(&mut self, folder: &str) {
        self.recent.retain(|entry| !same_path(&entry.path, folder));
        self.recent.insert(
            0,
            Recent {
                path: folder.into(),
                name: project_name(folder),
                last_opened: Some(Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)),
            },
        );
        self.recent.truncate(MAX_RECENT);
        self.last_project = Some(folder.into());
    }

    pub fn remove_recent(&mut self, folder: &str) {
        self.recent.retain(|entry| !same_path(&entry.path, folder));
        if self
            .last_project
            .as_ref()
            .is_some_and(|last| same_path(last, folder))
        {
            self.last_project = None;
        }
    }
}

fn read_settings(path: &Path) -> io::Result<String> {
    let file = fs::File::open(path)?;
    if file.metadata()?.len() > MAX_SETTINGS_BYTES {
        return Err(io::ErrorKind::FileTooLarge.into());
    }
    // 2026-11-09: cap the read too, in case another process grows the file after metadata.
    let mut bytes = Vec::new();
    file.take(MAX_SETTINGS_BYTES + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_SETTINGS_BYTES {
        return Err(io::ErrorKind::FileTooLarge.into());
    }
    String::from_utf8(bytes).map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))
}

pub fn system_locale() -> String {
    #[cfg(windows)]
    {
        let mut buffer = [0u16; 85];
        let length =
            unsafe { windows::Win32::Globalization::GetUserDefaultLocaleName(&mut buffer) };
        if length > 1 {
            return String::from_utf16_lossy(&buffer[..length as usize - 1]);
        }
    }
    "en-US".into()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn normalization_and_unknown_fields_round_trip() {
        let value = json!({ "language": null, "lastProject": "relative", "zoomFactor": 9,
            "windowMaximized": "true", "windowBounds": {"x": -1.5, "y": 2, "width": 1280.4, "height": 820},
            "future": {"keep": [1, 2]} });
        let settings = Settings::normalize(value, "ru-RU");
        assert_eq!(settings.language, "ru");
        assert_eq!(settings.zoom_factor, 2.0);
        assert!(settings.last_project.is_none());
        assert!(!settings.window_maximized);
        assert_eq!(settings.window_bounds.unwrap().x, -1);
        let serialized = serde_json::to_value(&settings).unwrap();
        assert_eq!(serialized["future"], json!({"keep": [1, 2]}));
        assert_eq!(
            serde_json::to_value(Settings::normalize(serialized.clone(), "en")).unwrap(),
            serialized
        );
    }

    #[test]
    fn recent_deduplicates_limits_and_moves_to_front() {
        let mut entries = vec![
            json!({"path":"relative"}),
            json!({"path":"C:/Demo", "lastOpened":"bad"}),
            json!({"path":"c:\\demo", "name":"duplicate"}),
        ];
        entries.extend((0..15).map(
            |i| json!({"path":format!("C:/project-{i}"), "lastOpened":"2026-11-09T12:00:00Z"}),
        ));
        let mut settings = Settings::normalize(json!({"recent":entries}), "en");
        assert_eq!(settings.recent.len(), 10);
        assert_eq!(settings.recent[0].name, "Demo");
        assert_eq!(settings.recent[0].last_opened, None);
        settings.remember("c:/PROJECT-3");
        assert_eq!(settings.recent.len(), 10);
        assert_eq!(settings.recent[0].path, "c:/PROJECT-3");
        settings.remove_recent("C:/project-3");
        assert!(settings.last_project.is_none());
        assert_eq!(settings.recent.len(), 9);
    }

    #[test]
    fn reads_bom_and_atomically_replaces_existing_settings() {
        let directory =
            std::env::temp_dir().join(format!("deckmate-settings-test-{}", std::process::id()));
        fs::create_dir_all(&directory).unwrap();
        fs::write(directory.join("desktop.json"), "\u{feff}{\"future\":42}").unwrap();
        let log = Log::open(&directory);
        let mut settings = Settings::load(&directory, "en", &log);
        settings.save(&directory).unwrap();
        settings.language = "ru".into();
        settings.save(&directory).unwrap();
        let reloaded = Settings::load(&directory, "en", &log);
        assert_eq!(reloaded.extra["future"], 42);
        assert_eq!(reloaded.language, "ru");
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 2);
        drop(log);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn oversized_settings_use_defaults_and_keep_the_original() {
        let directory =
            std::env::temp_dir().join(format!("deckmate-settings-limit-{}", std::process::id()));
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join("desktop.json");
        let original = format!(
            "{{\"language\":\"ru\",\"padding\":\"{}\"}}",
            "x".repeat(MAX_SETTINGS_BYTES as usize)
        );
        fs::write(&path, &original).unwrap();
        let log = Log::open(&directory);
        let settings = Settings::load(&directory, "en", &log);
        assert_eq!(settings.language, "en");
        settings.save(&directory).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), original);
        let output = fs::read_to_string(directory.join("server.log")).unwrap();
        assert_eq!(output.lines().count(), 1);
        assert!(output.contains("exceeds 1 MiB"));
        fs::write(
            &path,
            format!("{{}}{}", " ".repeat(MAX_SETTINGS_BYTES as usize - 2)),
        )
        .unwrap();
        assert!(read_settings(&path).is_ok());
        drop(log);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn zoom_and_invalid_settings() {
        assert_eq!(clamp_zoom(0.0), 0.5);
        assert_eq!(clamp_zoom(2.5), 2.0);
        assert_eq!(clamp_zoom(1.26), 1.3);
        assert_eq!(clamp_zoom(f64::NAN), 1.0);
        assert!(valid_bounds(&json!({"x":0,"y":0,"width":0,"height":600})).is_none());
        assert_eq!(Settings::normalize(Value::Null, "de-DE").zoom_factor, 1.0);
    }
}
