use serde::{Deserialize, Serialize};
use std::fs;
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

#[tauri::command]
pub fn register_office() -> RegisterResult {
    let result = super::integrations::install_platform_integration("office".to_string());
    RegisterResult { success: result.success, message: result.message }
}

#[tauri::command]
pub fn unregister_office() -> RegisterResult {
    let result = super::integrations::uninstall_platform_integration("office".to_string());
    RegisterResult { success: result.success, message: result.message }
}

#[tauri::command]
pub fn check_office_registration() -> RegisterResult {
    let result = super::integrations::check_platform_integration("office".to_string());
    RegisterResult { success: result.success, message: result.message }
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


