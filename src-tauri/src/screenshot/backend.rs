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

#[cfg(target_os = "linux")]
fn linux_capability(
    session_type: Option<&str>,
    wayland_display: bool,
    x11_display: bool,
) -> ScreenshotBackendCapability {
    let session_type = session_type.unwrap_or_default().trim().to_ascii_lowercase();
    if session_type == "wayland" || wayland_display {
        return ScreenshotBackendCapability {
            backend: "xcap-wayland",
            available: false,
            experimental: true,
            implementation:
                "Wayland detected; libwayshot is not runtime-probed and Portal/PipeWire adapter is not implemented",
        };
    }
    if session_type == "x11" || x11_display {
        return ScreenshotBackendCapability {
            backend: "xcap-x11",
            available: true,
            experimental: false,
            implementation: "xcap (X11 session detected)",
        };
    }
    ScreenshotBackendCapability {
        backend: "xcap-linux-unverified",
        available: false,
        experimental: true,
        implementation:
            "Linux display session is unknown; X11 and Wayland capture are not verified",
    }
}

impl ScreenshotBackend for XcapScreenshotBackend {
    fn capability(&self) -> ScreenshotBackendCapability {
        #[cfg(target_os = "linux")]
        {
            return linux_capability(
                std::env::var("XDG_SESSION_TYPE").ok().as_deref(),
                std::env::var_os("WAYLAND_DISPLAY").is_some(),
                std::env::var_os("DISPLAY").is_some(),
            );
        }
        #[cfg(not(target_os = "linux"))]
        ScreenshotBackendCapability {
            backend: "xcap",
            available: true,
            experimental: cfg!(target_os = "macos"),
            implementation: if cfg!(target_os = "macos") {
                "xcap (Screen Recording permission required; not ScreenCaptureKit adapter)"
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
        if cfg!(target_os = "windows") {
            assert_eq!(capability.backend, "xcap");
            assert!(capability.available);
            assert!(!capability.experimental);
        } else if cfg!(target_os = "macos") {
            assert_eq!(capability.backend, "xcap");
            assert!(capability.available);
            assert!(capability.experimental);
            assert!(!capability
                .implementation
                .contains("ScreenCaptureKit adapter"));
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_sessions_fail_closed_without_a_verified_capture_path() {
        let x11 = linux_capability(Some("x11"), false, true);
        assert_eq!(x11.backend, "xcap-x11");
        assert!(x11.available);
        assert!(!x11.experimental);

        let wayland = linux_capability(Some("wayland"), true, false);
        assert_eq!(wayland.backend, "xcap-wayland");
        assert!(!wayland.available);
        assert!(wayland.experimental);
        assert!(wayland.implementation.contains("Portal/PipeWire"));

        let unknown = linux_capability(None, false, false);
        assert!(!unknown.available);
        assert!(unknown.experimental);
    }
}
