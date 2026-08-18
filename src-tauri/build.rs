#[cfg(target_os = "windows")]
use std::path::PathBuf;
use std::process::Command;

fn main() {
    emit_build_provenance();
    tauri_build::build();

    // The ort crate downloads DirectML.dll to its cache, but the Tauri bundler
    // does not discover that Windows runtime dependency automatically.
    #[cfg(target_os = "windows")]
    copy_directml_dll();
}

fn git_commit(path: &std::path::Path) -> Option<String> {
    let output = Command::new("git")
        .args(["-C", path.to_str()?, "rev-parse", "HEAD"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let commit = String::from_utf8(output.stdout).ok()?.trim().to_lowercase();
    (commit.len() == 40 && commit.chars().all(|value| value.is_ascii_hexdigit())).then_some(commit)
}

fn emit_build_provenance() {
    println!("cargo:rerun-if-env-changed=GITHUB_SHA");
    let manifest = std::path::PathBuf::from(
        std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".to_owned()),
    );
    let repository = manifest.parent().unwrap_or(&manifest);
    let source_commit = std::env::var("GITHUB_SHA")
        .ok()
        .map(|value| value.trim().to_lowercase())
        .filter(|value| value.len() == 40 && value.chars().all(|c| c.is_ascii_hexdigit()))
        .or_else(|| git_commit(repository))
        .unwrap_or_else(|| "unknown".to_owned());
    let core_commit =
        git_commit(&manifest.join("latexsnipper-core")).unwrap_or_else(|| "unknown".to_owned());
    println!("cargo:rustc-env=LATEXSNIPPER_SOURCE_COMMIT={source_commit}");
    println!("cargo:rustc-env=LATEXSNIPPER_CORE_COMMIT={core_commit}");
}

/// Locate the directory where `latexsnipper-office.exe` will be placed.
#[cfg(target_os = "windows")]
fn exe_output_dir() -> Option<PathBuf> {
    // OUT_DIR resembles target/release/build/<crate>/out.
    let out_dir = std::env::var("OUT_DIR").ok()?;
    let out = PathBuf::from(out_dir);
    for ancestor in out.ancestors() {
        let release = ancestor.join("release");
        let debug = ancestor.join("debug");
        if release.exists() {
            return Some(release);
        }
        if debug.exists() {
            return Some(debug);
        }
    }
    None
}

#[cfg(target_os = "windows")]
fn copy_directml_dll() {
    let Some(exe_dir) = exe_output_dir() else {
        println!("cargo:warning=Could not determine exe output directory");
        return;
    };

    let dest = exe_dir.join("DirectML.dll");
    if dest.exists() {
        return;
    }

    // Prefer the ORT download cache under LOCALAPPDATA.
    if let Some(local_appdata) = std::env::var_os("LOCALAPPDATA") {
        let ort_cache = PathBuf::from(local_appdata)
            .join("ort.pyke.io")
            .join("dfbin");
        if let Ok(entries) = std::fs::read_dir(&ort_cache) {
            for entry in entries.flatten() {
                let hash_dir = entry.path();
                if !hash_dir.is_dir() {
                    continue;
                }
                let dll = hash_dir.join("DirectML.dll");
                if dll.exists() && std::fs::copy(&dll, &dest).is_ok() {
                    println!("cargo:warning=Copied DirectML.dll from ORT cache");
                    return;
                }
            }
        }
    }

    // Fall back to the explicitly staged Windows resource.
    let manifest_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap_or_default());
    let resources_dll = manifest_dir.join("resources").join("DirectML.dll");
    if resources_dll.exists() && std::fs::copy(&resources_dll, &dest).is_ok() {
        println!("cargo:warning=Copied DirectML.dll from resources/");
        return;
    }

    println!(
        "cargo:warning=DirectML.dll not found; ONNX Runtime DirectML backend will fail at runtime"
    );
}
