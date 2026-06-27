use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OfficeStatus {
    pub installed: bool,
    pub word: bool,
    pub powerpoint: bool,
    pub wps: bool,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegisterResult {
    pub success: bool,
    pub message: String,
}

fn get_word_startup_dir() -> Option<PathBuf> {
    dirs_next::data_dir().map(|d| d.join("Microsoft").join("Word").join("STARTUP"))
}

fn find_dotm_source() -> Option<PathBuf> {
    let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();

    // 1. Next to exe
    let p1 = exe_dir.join("LaTeXSnipper.dotm");
    if p1.exists() { return Some(p1); }

    // 2. In resources
    let p2 = exe_dir.join("resources").join("LaTeXSnipper.dotm");
    if p2.exists() { return Some(p2); }

    // 3. Development: project scripts/out
    if let Ok(cargo) = std::env::var("CARGO_MANIFEST_DIR") {
        let p3 = PathBuf::from(cargo).join("..").join("scripts").join("out").join("LaTeXSnipper.dotm");
        if p3.exists() { return Some(p3); }
    }

    None
}

#[tauri::command]
pub fn detect_office() -> OfficeStatus {
    let mut status = OfficeStatus {
        installed: false,
        word: false, powerpoint: false, wps: false, version: None,
    };
    if let Ok(o) = Command::new("reg").args(["query", r"HKLM\SOFTWARE\Microsoft\Office\Word\InstallRoot", "/v", "Path"]).output() {
        if String::from_utf8_lossy(&o.stdout).contains("Path") { status.word = true; status.installed = true; }
    }
    if let Ok(o) = Command::new("reg").args(["query", r"HKLM\SOFTWARE\Microsoft\Office\PowerPoint\InstallRoot", "/v", "Path"]).output() {
        if String::from_utf8_lossy(&o.stdout).contains("Path") { status.powerpoint = true; status.installed = true; }
    }
    status
}

/// Register: copy .dotm to Word STARTUP folder
#[tauri::command]
pub fn register_office() -> RegisterResult {
    let startup = match get_word_startup_dir() {
        Some(d) => d,
        None => return RegisterResult { success: false, message: "Word STARTUP dir not found".into() },
    };
    let _ = fs::create_dir_all(&startup);

    let src = match find_dotm_source() {
        Some(p) => p,
        None => return RegisterResult { success: false, message: "LaTeXSnipper.dotm not found. Run scripts/build_dotm.py first.".into() },
    };

    let dest = startup.join("LaTeXSnipper.dotm");
    match fs::copy(&src, &dest) {
        Ok(_) => RegisterResult { success: true, message: format!("Installed to {}\nRestart Word to load.", dest.display()) },
        Err(e) => RegisterResult { success: false, message: format!("Copy failed: {}", e) },
    }
}

/// Unregister: remove .dotm from STARTUP
#[tauri::command]
pub fn unregister_office() -> RegisterResult {
    let startup = match get_word_startup_dir() {
        Some(d) => d,
        None => return RegisterResult { success: false, message: "Word STARTUP dir not found".into() },
    };
    let dotm = startup.join("LaTeXSnipper.dotm");
    if !dotm.exists() {
        return RegisterResult { success: true, message: "Already removed".into() };
    }
    match fs::remove_file(&dotm) {
        Ok(_) => RegisterResult { success: true, message: "Removed. Restart Word.".into() },
        Err(e) => RegisterResult { success: false, message: format!("Failed: {}", e) },
    }
}

#[tauri::command]
pub fn check_office_registration() -> RegisterResult {
    match get_word_startup_dir() {
        Some(d) => {
            let dotm = d.join("LaTeXSnipper.dotm");
            if dotm.exists() {
                RegisterResult { success: true, message: format!("Registered: {}", dotm.display()) }
            } else {
                RegisterResult { success: false, message: "Not registered".into() }
            }
        }
        None => RegisterResult { success: false, message: "Word STARTUP dir not found".into() },
    }
}

#[tauri::command]
pub fn write_pending_formula(latex: String, font_color: Option<String>, font_style: Option<String>) -> RegisterResult {
    let path = std::env::temp_dir().join("latexsnipper_pending.txt");
    let data = serde_json::json!({
        "latex": latex,
        "fontColor": font_color.unwrap_or_default(),
        "fontStyle": font_style.unwrap_or_default(),
    });
    match fs::write(&path, data.to_string()) {
        Ok(_) => RegisterResult { success: true, message: "Formula sent".into() },
        Err(e) => RegisterResult { success: false, message: format!("Failed: {}", e) },
    }
}
