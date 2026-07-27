use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotBeginRequest {
    pub target_session_id: Option<String>,
    pub target_host: Option<String>,
    pub document_context: Option<String>,
    #[serde(default)]
    pub auto_insert: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotBeginResult {
    pub session_id: String,
    pub monitor_count: usize,
    pub capture_ms: u128,
    pub encode_ms: u128,
    pub webview_build_ms: u128,
    pub ready_wait_ms: u128,
    pub peak_memory_estimate: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenPosition {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotOverlayInit {
    pub session_id: String,
    pub monitor_id: String,
    pub physical_width: u32,
    pub physical_height: u32,
    pub preview_width: u32,
    pub preview_height: u32,
    pub scale_factor: f64,
    pub logical_position: ScreenPosition,
    pub physical_position: ScreenPosition,
    pub preview_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotFailure {
    pub operation_id: String,
    pub stage: String,
    pub host: String,
    pub session_id: String,
    pub document_context: Option<String>,
    pub elapsed_ms: u128,
    pub success: bool,
    pub error_code: String,
    pub error_message: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotCommitRequest {
    pub window_label: String,
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotCaptured {
    pub path: String,
    pub width: u32,
    pub height: u32,
    pub target_session_id: Option<String>,
    pub target_host: Option<String>,
    pub document_context: Option<String>,
    pub auto_insert: bool,
}
