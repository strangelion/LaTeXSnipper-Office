use image::RgbaImage;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotBackendCapability {
    pub backend: &'static str,
    pub available: bool,
    pub experimental: bool,
    pub implementation: &'static str,
}

pub trait ScreenshotBackend: Send + Sync {
    fn capability(&self) -> ScreenshotBackendCapability;
    fn capture_at_point(&self, x: i32, y: i32) -> Result<RgbaImage, String>;
}

struct XcapScreenshotBackend;

impl ScreenshotBackend for XcapScreenshotBackend {
    fn capability(&self) -> ScreenshotBackendCapability {
        ScreenshotBackendCapability {
            backend: "xcap",
            available: true,
            experimental: cfg!(target_os = "macos"),
            implementation: if cfg!(target_os = "macos") {
                "xcap (Screen Recording permission required; not ScreenCaptureKit adapter)"
            } else if cfg!(target_os = "linux") {
                "xcap (X11/libwayshot)"
            } else {
                "xcap (Windows capture)"
            },
        }
    }

    fn capture_at_point(&self, x: i32, y: i32) -> Result<RgbaImage, String> {
        let monitor = xcap::Monitor::from_point(x, y)
            .map_err(|error| format!("SCREENSHOT_MONITOR_MAPPING_FAILED: {error}"))?;
        monitor
            .capture_image()
            .map_err(|error| format!("SCREENSHOT_CAPTURE_FAILED: {error}"))
    }
}

pub fn active_backend() -> impl ScreenshotBackend {
    XcapScreenshotBackend
}

#[tauri::command]
pub fn screenshot_backend_capability() -> ScreenshotBackendCapability {
    active_backend().capability()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn active_backend_truthfully_identifies_xcap() {
        let capability = screenshot_backend_capability();
        assert_eq!(capability.backend, "xcap");
        assert!(capability.available);
        if cfg!(target_os = "macos") {
            assert!(capability.experimental);
            assert!(!capability
                .implementation
                .contains("ScreenCaptureKit adapter"));
        }
    }
}
