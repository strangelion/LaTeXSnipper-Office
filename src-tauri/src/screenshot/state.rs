use std::{
    collections::HashMap,
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
    pub image: RgbaImage,
}

pub struct ScreenshotSession {
    pub id: String,
    #[allow(dead_code)]
    pub created_at: Instant,
    pub request: ScreenshotBeginRequest,
    pub frames: HashMap<String, ScreenshotFrame>,
}

#[derive(Default)]
pub struct ScreenshotState {
    sessions: Mutex<HashMap<String, ScreenshotSession>>,
}

impl ScreenshotState {
    pub fn insert(&self, session: ScreenshotSession) -> Result<(), String> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| "Screenshot state lock poisoned".to_string())?;

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
            .map_err(|_| "Screenshot state lock poisoned".to_string())?;

        let session = sessions
            .get(session_id)
            .ok_or_else(|| "Screenshot session not found".to_string())?;

        callback(session)
    }

    pub fn remove(&self, session_id: &str) -> Result<Option<ScreenshotSession>, String> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| "Screenshot state lock poisoned".to_string())?;

        Ok(sessions.remove(session_id))
    }
}
