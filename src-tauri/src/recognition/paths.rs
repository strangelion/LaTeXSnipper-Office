//! Recognition path resolution.
//!
//! All directories are derived from `app.path().app_local_data_dir()`
//! and never hard-coded to a specific user profile directory.

use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// Central path holder for the recognition subsystem.
#[derive(Debug, Clone)]
pub struct RecognitionPaths {
    /// Root directory: <app_local_data>/recognition
    pub root: PathBuf,
    /// Downloaded / installed model packages
    pub models: PathBuf,
    /// Runtime shared libraries (ONNX Runtime, Paddle, etc.)
    pub runtimes: PathBuf,
    /// Temporary cache directory
    pub cache: PathBuf,
    /// Per-job working directories
    pub jobs: PathBuf,
    /// Recognition logs
    pub logs: PathBuf,
    /// Settings file path
    #[allow(dead_code)]
    pub settings: PathBuf,
}

impl RecognitionPaths {
    /// Resolve all recognition paths from the Tauri app handle.
    ///
    /// Creates missing directories automatically.
    pub fn resolve(app: &AppHandle) -> Result<Self, String> {
        let root = app
            .path()
            .app_local_data_dir()
            .map_err(|error| format!("Cannot resolve application data directory: {error}"))?
            .join("recognition");

        let paths = Self {
            models: root.join("models"),
            runtimes: root.join("runtimes"),
            cache: root.join("cache"),
            jobs: root.join("jobs"),
            logs: root.join("logs"),
            settings: root.join("recognition-settings.json"),
            root,
        };

        paths.ensure()?;

        Ok(paths)
    }

    /// Ensure all directories exist.
    fn ensure(&self) -> Result<(), String> {
        for directory in [
            &self.root,
            &self.models,
            &self.runtimes,
            &self.cache,
            &self.jobs,
            &self.logs,
        ] {
            std::fs::create_dir_all(directory)
                .map_err(|error| format!("Cannot create '{}': {error}", directory.display()))?;
        }

        Ok(())
    }
}
