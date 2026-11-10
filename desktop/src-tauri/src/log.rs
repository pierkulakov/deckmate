use chrono::Utc;
use regex::Regex;
use std::{
    fs::{self, File, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
};

#[derive(Clone)]
pub struct Log(Arc<Mutex<Writer>>);

struct Writer {
    path: PathBuf,
    file: Option<File>,
}

const MAX_LOG_BYTES: u64 = 5 * 1024 * 1024;

impl Writer {
    fn open(&mut self) {
        self.file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
            .ok();
    }

    fn rotate(&mut self) -> io::Result<()> {
        if !fs::metadata(&self.path).is_ok_and(|stat| stat.len() > MAX_LOG_BYTES) {
            return Ok(());
        }
        // 2026-11-09: close the Windows handle before renaming; retain the failure in one previous log.
        self.file.take();
        let previous = self.path.with_file_name("server.log.1");
        let result = (|| {
            match fs::remove_file(&previous) {
                Ok(()) => (),
                Err(error) if error.kind() == io::ErrorKind::NotFound => (),
                Err(error) => return Err(error),
            }
            fs::rename(&self.path, previous)
        })();
        self.open();
        result
    }
}

impl Log {
    pub fn open(directory: &Path) -> Self {
        let _ = fs::create_dir_all(directory);
        let mut writer = Writer {
            path: directory.join("server.log"),
            file: None,
        };
        writer.open();
        let _ = writer.rotate();
        Self(Arc::new(Mutex::new(writer)))
    }

    pub fn write(&self, line: impl AsRef<str>) {
        static TOKEN: OnceLock<Regex> = OnceLock::new();
        let safe = TOKEN
            .get_or_init(|| Regex::new("(?i)token=[0-9a-f]{16,}").unwrap())
            .replace_all(line.as_ref(), "token=***");
        let mut writer = self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(file) = writer.file.as_mut() {
            let _ = writeln!(file, "{} {safe}", Utc::now().to_rfc3339());
        }
        let _ = writer.rotate();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rotates_on_open_and_during_writes_preserving_one_previous_log() {
        let directory =
            std::env::temp_dir().join(format!("deckmate-log-limit-{}", std::process::id()));
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join("server.log");
        fs::write(&path, vec![b'x'; MAX_LOG_BYTES as usize + 1]).unwrap();
        let log = Log::open(&directory);
        assert_eq!(fs::metadata(&path).unwrap().len(), 0);
        let previous = directory.join("server.log.1");
        assert_eq!(
            fs::read(&previous).unwrap(),
            vec![b'x'; MAX_LOG_BYTES as usize + 1]
        );
        log.write(format!("failure {}", "y".repeat(MAX_LOG_BYTES as usize)));
        assert_eq!(fs::metadata(&path).unwrap().len(), 0);
        assert!(fs::read_to_string(&previous).unwrap().contains("failure y"));
        log.write("token=1234567890abcdef");
        let output = fs::read_to_string(&path).unwrap();
        assert!(output.contains("token=***"));
        assert!(!output.contains("1234567890abcdef"));
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 2);
        drop(log);
        fs::remove_dir_all(directory).unwrap();
    }
}
