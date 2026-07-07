use std::path::PathBuf;

fn main() {
    tauri_build::build();

    // The ort crate (download-binaries feature) downloads DirectML.dll to
    // $LOCALAPPDATA/ort.pyke.io/... but Tauri bundler doesn't know about it.
    // We need to copy it next to the exe so it gets bundled into the installer.
    copy_directml_dll();
}

/// Locate the directory where `latexsnipper-office.exe` will be placed.
fn exe_output_dir() -> Option<PathBuf> {
    // OUT_DIR is like target/release/build/<crate>/out
    // Walk up until we find target/release/ or target/debug/
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

fn copy_directml_dll() {
    let Some(exe_dir) = exe_output_dir() else {
        println!("cargo:warning=Could not determine exe output directory");
        return;
    };

    let dest = exe_dir.join("DirectML.dll");

    // Already present — nothing to do
    if dest.exists() {
        return;
    }

    // 1. Try the ORT download cache ($LOCALAPPDATA/ort.pyke.io/dfbin/...)
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

    // 2. Try the resources/ directory (bundled with repo)
    let manifest_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap_or_default());
    let resources_dll = manifest_dir.join("resources").join("DirectML.dll");
    if resources_dll.exists() && std::fs::copy(&resources_dll, &dest).is_ok() {
        println!("cargo:warning=Copied DirectML.dll from resources/");
        return;
    }

    println!(
        "cargo:warning=DirectML.dll not found — ONNX Runtime DirectML backend will fail at runtime"
    );
}
