//! Runtime installation-hint commands.
//!
//! These compatibility commands only report files, directories, and setup
//! hints. Provider/runtime usability is reported exclusively by Core
//! `EngineReadiness`.

use serde::Serialize;
use tauri::State;

use crate::recognition::state::RecognitionState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInfo {
    pub kind: String,
    pub name: String,

    /// Deprecated compatibility field. Always false.
    pub available: bool,

    /// A provider library file was found. This does not prove loadability.
    pub library_detected: bool,

    /// An installation directory or environment hint was found.
    pub directory_detected: bool,

    /// Human-readable setup guidance. Core readiness remains authoritative.
    pub installation_hint: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeProbeResult {
    pub runtimes: Vec<RuntimeInfo>,

    /// Deprecated compatibility field. Office does not recommend providers.
    pub recommended: Option<String>,
}

#[tauri::command]
pub async fn runtime_list(state: State<'_, RecognitionState>) -> Result<Vec<RuntimeInfo>, String> {
    collect_runtime_installation_hints(&state.paths.runtimes)
}

/// Compatibility command: refresh non-authoritative installation hints.
#[tauri::command]
pub async fn runtime_probe(
    state: State<'_, RecognitionState>,
) -> Result<RuntimeProbeResult, String> {
    Ok(RuntimeProbeResult {
        runtimes: collect_runtime_installation_hints(&state.paths.runtimes)?,
        recommended: None,
    })
}

#[tauri::command]
pub async fn runtime_open_directory(state: State<'_, RecognitionState>) -> Result<String, String> {
    let dir = state.paths.runtimes.to_string_lossy().to_string();

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&dir)
            .spawn()
            .map_err(|e| format!("RUNTIME_OPEN_DIRECTORY_FAILED: explorer: {e}"))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&dir)
            .spawn()
            .map_err(|e| format!("RUNTIME_OPEN_DIRECTORY_FAILED: open: {e}"))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&dir)
            .spawn()
            .map_err(|e| format!("RUNTIME_OPEN_DIRECTORY_FAILED: xdg-open: {e}"))?;
    }

    Ok(format!("Opened runtime directory: {dir}"))
}

pub(crate) fn collect_runtime_installation_hints(
    runtimes_dir: &std::path::Path,
) -> Result<Vec<RuntimeInfo>, String> {
    let mut runtimes = vec![detect_onnx_installation(runtimes_dir)];

    if cfg!(target_os = "windows") {
        runtimes.push(detect_directml_installation(runtimes_dir));
    }
    if cfg!(target_os = "windows") || cfg!(target_os = "linux") {
        runtimes.push(detect_cuda_installation());
        runtimes.push(detect_tensorrt_installation(runtimes_dir));
    }
    if cfg!(target_os = "macos") {
        runtimes.push(coreml_installation_hint());
    }
    runtimes.push(detect_paddle_installation(runtimes_dir));
    Ok(runtimes)
}

fn detect_onnx_installation(runtimes_dir: &std::path::Path) -> RuntimeInfo {
    let onnx_dir = runtimes_dir.join("onnx");
    let lib_name = if cfg!(target_os = "windows") {
        "onnxruntime.dll"
    } else if cfg!(target_os = "macos") {
        "libonnxruntime.dylib"
    } else {
        "libonnxruntime.so"
    };
    let library_detected = onnx_dir.join(lib_name).is_file();

    RuntimeInfo {
        kind: "onnx".to_string(),
        name: "ONNX Runtime".to_string(),
        available: false,
        library_detected,
        directory_detected: onnx_dir.is_dir(),
        installation_hint: Some(if library_detected {
            "ONNX Runtime library detected; Core provider validation is required.".to_string()
        } else {
            format!("Place {lib_name} in the runtimes/onnx directory.")
        }),
    }
}

fn detect_directml_installation(runtimes_dir: &std::path::Path) -> RuntimeInfo {
    let dml_dir = runtimes_dir.join("directml");
    let library_detected = dml_dir.join("DirectML.dll").is_file();
    RuntimeInfo {
        kind: "directml".to_string(),
        name: "DirectML".to_string(),
        available: false,
        library_detected,
        directory_detected: dml_dir.is_dir(),
        installation_hint: Some(if library_detected {
            "DirectML.dll detected; Core must still create and validate a session.".to_string()
        } else {
            "DirectML requires a DirectX 12 compatible GPU.".to_string()
        }),
    }
}

fn detect_cuda_installation() -> RuntimeInfo {
    let cuda_path = std::env::var("CUDA_PATH").ok();
    let directory_detected = cuda_path
        .as_deref()
        .is_some_and(|path| std::path::Path::new(path).is_dir());
    RuntimeInfo {
        kind: "cuda".to_string(),
        name: "CUDA".to_string(),
        available: false,
        library_detected: false,
        directory_detected,
        installation_hint: Some(if cuda_path.is_some() {
            "CUDA_PATH is set; Core provider validation is still required.".to_string()
        } else {
            "CUDA_PATH is not set.".to_string()
        }),
    }
}

fn detect_tensorrt_installation(runtimes_dir: &std::path::Path) -> RuntimeInfo {
    let trt_dir = runtimes_dir.join("tensorrt");
    let directory_detected = trt_dir.is_dir() && trt_dir.join("lib").is_dir();
    RuntimeInfo {
        kind: "tensorrt".to_string(),
        name: "TensorRT".to_string(),
        available: false,
        library_detected: false,
        directory_detected,
        installation_hint: Some(if directory_detected {
            "TensorRT directory detected; Core provider validation is required.".to_string()
        } else {
            "TensorRT requires an NVIDIA GPU and CUDA.".to_string()
        }),
    }
}

fn coreml_installation_hint() -> RuntimeInfo {
    RuntimeInfo {
        kind: "coreml".to_string(),
        name: "CoreML".to_string(),
        available: false,
        library_detected: false,
        directory_detected: false,
        installation_hint: Some(
            "macOS can host CoreML; only Core validation may mark it usable.".to_string(),
        ),
    }
}

fn detect_paddle_installation(runtimes_dir: &std::path::Path) -> RuntimeInfo {
    let paddle_dir = runtimes_dir.join("paddle");
    let directory_detected = paddle_dir.is_dir();
    RuntimeInfo {
        kind: "paddle".to_string(),
        name: "Paddle Inference".to_string(),
        available: false,
        library_detected: false,
        directory_detected,
        installation_hint: Some(if directory_detected {
            "Paddle directory detected; Core provider validation is required before use."
                .to_string()
        } else {
            "Place Paddle Inference libraries in the runtimes/paddle directory.".to_string()
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::collect_runtime_installation_hints;

    #[test]
    fn installation_hints_never_claim_runtime_availability() {
        let root = std::env::temp_dir().join(format!(
            "latexsnipper-runtime-hint-test-{:032x}",
            rand::random::<u128>()
        ));
        let onnx = root.join("onnx");
        std::fs::create_dir_all(&onnx).unwrap();
        let library = if cfg!(target_os = "windows") {
            "onnxruntime.dll"
        } else if cfg!(target_os = "macos") {
            "libonnxruntime.dylib"
        } else {
            "libonnxruntime.so"
        };
        std::fs::write(onnx.join(library), [0u8; 4]).unwrap();

        let hints = collect_runtime_installation_hints(&root).unwrap();
        let onnx = hints.iter().find(|hint| hint.kind == "onnx").unwrap();
        assert!(onnx.library_detected);
        assert!(onnx.directory_detected);
        assert!(!onnx.available);
        assert!(hints.iter().all(|hint| !hint.available));
        let _ = std::fs::remove_dir_all(root);
    }
}
