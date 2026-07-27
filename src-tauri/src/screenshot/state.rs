use std::{
    collections::{HashMap, HashSet},
    sync::Mutex,
    time::Instant,
};

use image::RgbaImage;

use super::dto::ScreenshotBeginRequest;

pub struct ScreenshotFrame {
    #[allow(dead_code)]
    pub monitor_id: String,
    pub window_label: String,
    pub scale_factor: f64,
    pub logical_x: f64,
    pub logical_y: f64,
    pub physical_x: f64,
    pub physical_y: f64,
    pub preview_width: u32,
    pub preview_height: u32,
    pub preview_path: std::path::PathBuf,
    pub image: RgbaImage,
}

pub struct ScreenshotSession {
    pub id: String,
    #[allow(dead_code)]
    pub created_at: Instant,
    pub request: ScreenshotBeginRequest,
    pub frames: HashMap<String, ScreenshotFrame>,
    pub ready_windows: HashSet<String>,
    pub preview_decode_ms: u128,
}

pub struct ScreenshotState {
    sessions: Mutex<HashMap<String, ScreenshotSession>>,
    active_session: Mutex<Option<String>>,
}

impl Default for ScreenshotState {
    fn default() -> Self {
        match super::lease::cleanup_default_root() {
            Ok(report) if report.removed_jobs > 0 => log::info!(
                "screenshotJobCleanup removedJobs={} removedBytes={} retainedBytes={}",
                report.removed_jobs,
                report.removed_bytes,
                report.retained_bytes
            ),
            Ok(_) => {}
            Err(error) => log::warn!("screenshotJobCleanup errorCode={}", error),
        }
        Self {
            sessions: Mutex::new(HashMap::new()),
            active_session: Mutex::new(None),
        }
    }
}

impl ScreenshotState {
    pub fn reserve(&self, session_id: &str) -> Result<(), String> {
        let mut active = self
            .active_session
            .lock()
            .map_err(|_| "SCREENSHOT_STATE_LOCK_FAILED: active session".to_string())?;
        if active.is_some() {
            return Err("SCREENSHOT_ALREADY_ACTIVE: another capture is in progress".to_string());
        }
        *active = Some(session_id.to_string());
        Ok(())
    }

    pub fn insert(&self, session: ScreenshotSession) -> Result<(), String> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| "SCREENSHOT_STATE_LOCK_FAILED: sessions".to_string())?;

        sessions.insert(session.id.clone(), session);
        Ok(())
    }

    pub fn with_session<T>(
        &self,
        session_id: &str,
        callback: impl FnOnce(&ScreenshotSession) -> Result<T, String>,
    ) -> Result<T, String> {
        let sessions = self
            .sessions
            .lock()
            .map_err(|_| "SCREENSHOT_STATE_LOCK_FAILED: sessions".to_string())?;

        let session = sessions
            .get(session_id)
            .ok_or_else(|| "SESSION_NOT_READY: screenshot session not found".to_string())?;

        callback(session)
    }

    pub fn mark_ready(
        &self,
        session_id: &str,
        window_label: &str,
        preview_decode_ms: u64,
    ) -> Result<bool, String> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| "SCREENSHOT_STATE_LOCK_FAILED: sessions".to_string())?;
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| "SESSION_NOT_READY: screenshot session not found".to_string())?;
        if !session
            .frames
            .values()
            .any(|frame| frame.window_label == window_label)
        {
            return Err("SCREENSHOT_UNKNOWN_OVERLAY: overlay is not part of session".to_string());
        }
        session.ready_windows.insert(window_label.to_string());
        session.preview_decode_ms = session
            .preview_decode_ms
            .saturating_add(u128::from(preview_decode_ms));
        Ok(session.ready_windows.len() == session.frames.len())
    }

    pub fn all_ready(&self, session_id: &str) -> Result<bool, String> {
        self.with_session(session_id, |session| {
            Ok(!session.frames.is_empty() && session.ready_windows.len() == session.frames.len())
        })
    }

    pub fn remove(&self, session_id: &str) -> Result<Option<ScreenshotSession>, String> {
        let removed = {
            let mut sessions = self
                .sessions
                .lock()
                .map_err(|_| "SCREENSHOT_STATE_LOCK_FAILED: sessions".to_string())?;
            sessions.remove(session_id)
        };

        self.release(session_id)?;
        Ok(removed)
    }

    pub fn release(&self, session_id: &str) -> Result<(), String> {
        let mut active = self
            .active_session
            .lock()
            .map_err(|_| "SCREENSHOT_STATE_LOCK_FAILED: active session".to_string())?;
        if active.as_deref() == Some(session_id) {
            *active = None;
        }
        Ok(())
    }
}
