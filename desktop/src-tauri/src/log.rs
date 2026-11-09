use chrono::Utc;
use regex::Regex;
use std::{
    fs::{self, File, OpenOptions},
    io::{Seek, SeekFrom, Write},
    path::Path,
    sync::{Arc, Mutex, OnceLock},
};

#[derive(Clone)]
pub struct Log(Arc<Mutex<Option<File>>>);

const MAX_LOG_BYTES: u64 = 5 * 1024 * 1024;

fn trim(file: &File) {
    if file.metadata().is_ok_and(|stat| stat.len() > MAX_LOG_BYTES) {
        let _ = file.set_len(0);
    }
}

impl Log {
    pub fn open(directory: &Path) -> Self {
        let _ = fs::create_dir_all(directory);
        let path = directory.join("server.log");
        // 2026-11-09: Windows append-only handles cannot truncate; the mutex serializes seek/write/trim.
        let file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(false)
            .open(path)
            .ok();
        if let Some(file) = &file {
            trim(file);
        }
        Self(Arc::new(Mutex::new(file)))
    }

    pub fn write(&self, line: impl AsRef<str>) {
        static TOKEN: OnceLock<Regex> = OnceLock::new();
        let safe = TOKEN
            .get_or_init(|| Regex::new("(?i)token=[0-9a-f]{16,}").unwrap())
            .replace_all(line.as_ref(), "token=***");
        if let Some(file) = self.0.lock().unwrap().as_mut() {
            if file.seek(SeekFrom::End(0)).is_err() {
                return;
            }
            let _ = writeln!(file, "{} {safe}", Utc::now().to_rfc3339());
            trim(file);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trims_on_open_and_during_writes_with_the_same_limit() {
        let directory =
            std::env::temp_dir().join(format!("deckmate-log-limit-{}", std::process::id()));
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join("server.log");
        fs::write(&path, vec![b'x'; MAX_LOG_BYTES as usize + 1]).unwrap();
        let log = Log::open(&directory);
        assert_eq!(fs::metadata(&path).unwrap().len(), 0);
        log.write("x".repeat(MAX_LOG_BYTES as usize));
        assert_eq!(fs::metadata(&path).unwrap().len(), 0);
        log.write("token=1234567890abcdef");
        let output = fs::read_to_string(&path).unwrap();
        assert!(output.contains("token=***"));
        assert!(!output.contains("1234567890abcdef"));
        drop(log);
        fs::remove_dir_all(directory).unwrap();
    }
}
