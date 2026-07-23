//! Runtime management commands.
//!
//! Commands:
//! - `runtime_list` — List available runtimes and their status.
//! - `runtime_probe` — Probe the system for available runtimes.
//! - `runtime_open_directory` — Open the runtime directory in the file manager.

use serde::Serialize;
use tauri::State;

use crate::recognition::state::RecognitionState;

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

/// Information about a runtime.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInfo {
    /// Runtime kind: "onnx", "paddle", "directml", "cuda", "tensorrt", "coreml"
    pub kind: String,

    /// Human-readable name.
    pub name: String,

    /// Whether the runtime is installed/available.
    pub available: bool,

    /// Version string (if detected).
    pub version: Option<String>,

    /// Path to the runtime library (if installed).
    pub path: Option<String>,

    /// A health indicator: "ok", "missing", "error", "unknown"
    pub health: String,

    /// Additional detail message.
    pub detail: Option<String>,
}

/// Result of a runtime probe.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeProbeResult {
    /// List of all probed runtimes.
    pub runtimes: Vec<RuntimeInfo>,

    /// Recommended runtime for this system.
    pub recommended: Option<String>,
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// List all available runtimes with their current status.
#[tauri::command]
pub async fn runtime_list(state: State<'_, RecognitionState>) -> Result<Vec<RuntimeInfo>, String> {
    let runtimes_dir = &state.paths.runtimes;
    probe_runtimes(runtimes_dir)
}

/// Probe the system and runtime directory for available execution providers.
#[tauri::command]
pub async fn runtime_probe(
    state: State<'_, RecognitionState>,
) -> Result<RuntimeProbeResult, String> {
    let runtimes_dir = &state.paths.runtimes;
    let runtimes = probe_runtimes(runtimes_dir)?;

    // Recommend based on what's available
    let recommended = if cfg!(target_os = "windows") {
        // On Windows, prefer DirectML if available, else ONNX Runtime
        runtimes
            .iter()
            .find(|r| r.kind == "directml" && r.available)
            .map(|r| r.kind.clone())
            .or_else(|| {
                runtimes
                    .iter()
                    .find(|r| r.kind == "onnx" && r.available)
                    .map(|r| r.kind.clone())
            })
    } else if cfg!(target_os = "macos") {
        runtimes
            .iter()
            .find(|r| r.kind == "coreml" && r.available)
            .map(|r| r.kind.clone())
            .or_else(|| {
                runtimes
                    .iter()
                    .find(|r| r.kind == "onnx" && r.available)
                    .map(|r| r.kind.clone())
            })
    } else {
        runtimes
            .iter()
            .find(|r| r.kind == "onnx" && r.available)
            .map(|r| r.kind.clone())
    };

    Ok(RuntimeProbeResult {
        runtimes,
        recommended,
    })
}

/// Open the runtime directory in the system file manager.
#[tauri::command]
pub async fn runtime_open_directory(state: State<'_, RecognitionState>) -> Result<String, String> {
    let dir = state.paths.runtimes.to_string_lossy().to_string();

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&dir)
            .spawn()
            .map_err(|e| format!("Cannot open directory: {e}"))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&dir)
            .spawn()
            .map_err(|e| format!("Cannot open directory: {e}"))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&dir)
            .spawn()
            .map_err(|e| format!("Cannot open directory: {e}"))?;
    }

    Ok(format!("Opened runtime directory: {dir}"))
}

// ---------------------------------------------------------------------------
// Probe logic
// ---------------------------------------------------------------------------

/// Probe the runtime directory and system for available runtimes.
fn probe_runtimes(runtimes_dir: &std::path::Path) -> Result<Vec<RuntimeInfo>, String> {
    let mut runtimes = Vec::new();

    // ONNX Runtime
    runtimes.push(probe_onnx_runtime(runtimes_dir));

    // DirectML (Windows only)
    if cfg!(target_os = "windows") {
        runtimes.push(probe_directml(runtimes_dir));
    }

    // CUDA / TensorRT
    if cfg!(target_os = "windows") || cfg!(target_os = "linux") {
        runtimes.push(probe_cuda());
        runtimes.push(probe_tensorrt(runtimes_dir));
    }

    // CoreML (macOS only)
    if cfg!(target_os = "macos") {
        runtimes.push(probe_coreml());
    }

    // Paddle Inference
    runtimes.push(probe_paddle(runtimes_dir));

    Ok(runtimes)
}

fn probe_onnx_runtime(runtimes_dir: &std::path::Path) -> RuntimeInfo {
    let onnx_dir = runtimes_dir.join("onnx");

    // Look for onnxruntime.dll / libonnxruntime.so / libonnxruntime.dylib
    let lib_name = if cfg!(target_os = "windows") {
        "onnxruntime.dll"
    } else if cfg!(target_os = "macos") {
        "libonnxruntime.dylib"
    } else {
        "libonnxruntime.so"
    };

    let lib_path = onnx_dir.join(lib_name);
    let available = lib_path.exists();

    RuntimeInfo {
        kind: "onnx".to_string(),
        name: "ONNX Runtime".to_string(),
        available,
        version: None,
        path: if available {
            Some(lib_path.to_string_lossy().to_string())
        } else {
            None
        },
        health: if available {
            "ok".to_string()
        } else {
            "missing".to_string()
        },
        detail: if available {
            Some("ONNX Runtime is installed.".to_string())
        } else {
            Some("Place onnxruntime.dll in the runtimes/onnx directory.".to_string())
        },
    }
}

fn probe_directml(runtimes_dir: &std::path::Path) -> RuntimeInfo {
    let dml_dir = runtimes_dir.join("directml");
    let dll_path = dml_dir.join("DirectML.dll");
    let available = dll_path.exists();

    RuntimeInfo {
        kind: "directml".to_string(),
        name: "DirectML".to_string(),
        available,
        version: None,
        path: if available {
            Some(dll_path.to_string_lossy().to_string())
        } else {
            None
        },
        health: if available {
            "ok".to_string()
        } else {
            "missing".to_string()
        },
        detail: if available {
            Some("DirectML execution provider detected.".to_string())
        } else {
            Some("DirectML requires a DirectX 12 compatible GPU.".to_string())
        },
    }
}

fn probe_cuda() -> RuntimeInfo {
    // Check for CUDA_PATH or common CUDA locations
    let cuda_path = std::env::var("CUDA_PATH").ok();
    let available = cuda_path.is_some();

    RuntimeInfo {
        kind: "cuda".to_string(),
        name: "CUDA".to_string(),
        available,
        version: None,
        path: cuda_path,
        health: if available {
            "ok".to_string()
        } else {
            "missing".to_string()
        },
        detail: if available {
            Some("CUDA installation detected via CUDA_PATH.".to_string())
        } else {
            Some("CUDA Toolkit is not installed or CUDA_PATH is not set.".to_string())
        },
    }
}

fn probe_tensorrt(runtimes_dir: &std::path::Path) -> RuntimeInfo {
    let trt_dir = runtimes_dir.join("tensorrt");
    let available = trt_dir.exists() && trt_dir.join("lib").exists();

    RuntimeInfo {
        kind: "tensorrt".to_string(),
        name: "TensorRT".to_string(),
        available,
        version: None,
        path: if available {
            Some(trt_dir.to_string_lossy().to_string())
        } else {
            None
        },
        health: if available {
            "ok".to_string()
        } else {
            "missing".to_string()
        },
        detail: if available {
            Some("TensorRT runtime detected.".to_string())
        } else {
            Some("TensorRT requires NVIDIA GPU with CUDA.".to_string())
        },
    }
}

fn probe_coreml() -> RuntimeInfo {
    // CoreML is available on macOS 10.13+
    RuntimeInfo {
        kind: "coreml".to_string(),
        name: "CoreML".to_string(),
        available: true,
        version: None,
        path: None,
        health: "ok".to_string(),
        detail: Some("CoreML is built into macOS.".to_string()),
    }
}

fn probe_paddle(runtimes_dir: &std::path::Path) -> RuntimeInfo {
    let paddle_dir = runtimes_dir.join("paddle");
    let available = paddle_dir.exists();

    RuntimeInfo {
        kind: "paddle".to_string(),
        name: "Paddle Inference".to_string(),
        available,
        version: None,
        path: if available {
            Some(paddle_dir.to_string_lossy().to_string())
        } else {
            None
        },
        health: if available {
            "ok".to_string()
        } else {
            "missing".to_string()
        },
        detail: if available {
            Some("Paddle Inference runtime detected.".to_string())
        } else {
            Some("Place Paddle Inference libraries in the runtimes/paddle directory.".to_string())
        },
    }
}
