//! Persistent file logging for Desktop runtime.
//!
//! Writes all `log` crate messages to:
//!   %LOCALAPPDATA%\LaTeXSnipper\Logs\desktop\desktop.log
//!
//! Rotates at 2 MB → desktop.old.log.

#![allow(dead_code)]

use log::{LevelFilter, Log, Metadata, Record};
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

const MAX_LOG_SIZE: u64 = 2 * 1024 * 1024; // 2 MB
const LOG_FILE_NAME: &str = "desktop.log";
const OLD_LOG_FILE_NAME: &str = "desktop.old.log";

struct FileLogger {
    file: Mutex<File>,
    path: PathBuf,
    old_path: PathBuf,
}

impl FileLogger {
    fn new(log_dir: PathBuf) -> Option<Self> {
        fs::create_dir_all(&log_dir).ok()?;
        let path = log_dir.join(LOG_FILE_NAME);
        let old_path = log_dir.join(OLD_LOG_FILE_NAME);

        // Rotate if needed
        if let Ok(meta) = fs::metadata(&path) {
            if meta.len() > MAX_LOG_SIZE {
                let _ = fs::remove_file(&old_path);
                let _ = fs::rename(&path, &old_path);
            }
        }

        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .ok()?;

        Some(Self {
            file: Mutex::new(file),
            path,
            old_path,
        })
    }
}

impl Log for FileLogger {
    fn enabled(&self, _metadata: &Metadata) -> bool {
        true
    }

    fn log(&self, record: &Record) {
        if !self.enabled(record.metadata()) {
            return;
        }
        let ts = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
        let line = format!(
            "{} [{}] {} {}\n",
            ts,
            record.level(),
            record.target(),
            record.args()
        );

        if let Ok(mut file) = self.file.lock() {
            let _ = file.write_all(line.as_bytes());
            let _ = file.flush();
        }
    }

    fn flush(&self) {
        if let Ok(mut file) = self.file.lock() {
            let _ = file.flush();
        }
    }
}

/// Initialize persistent file logging for the Desktop process.
/// Must be called before any `log::info!` / `log::warn!` / `log::error!` calls.
pub fn init_file_logging(app_data_dir: &std::path::Path) {
    let log_dir = app_data_dir.join("Logs").join("desktop");

    if let Some(file_logger) = FileLogger::new(log_dir) {
        let max_level = if cfg!(debug_assertions) {
            LevelFilter::Debug
        } else {
            LevelFilter::Info
        };

        let _ = log::set_boxed_logger(Box::new(file_logger));
        log::set_max_level(max_level);
    }
}

/// Collect recent log lines into a string (for diagnostic export).
pub fn collect_recent_log(max_lines: usize) -> String {
    let data_dir = dirs_next::data_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("LaTeXSnipper");

    let log_path = data_dir
        .join("Logs")
        .join("desktop")
        .join(LOG_FILE_NAME);

    std::fs::read_to_string(&log_path)
        .unwrap_or_default()
        .lines()
        .rev()
        .take(max_lines)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join("\n")
}
