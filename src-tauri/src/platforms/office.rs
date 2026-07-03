use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Command;
use std::sync::OnceLock;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OfficeStatus {
    pub installed: bool,
    pub word: OfficeAppStatus,
    pub powerpoint: OfficeAppStatus,
    pub wps: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OfficeAppStatus {
    pub available: bool,
    pub install_path: Option<String>,
    pub startup_path: Option<String>,
    pub version: Option<String>,
    pub plugin_installed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegisterResult {
    pub success: bool,
    pub message: String,
}

// Cached Office status — computed once, reused for all calls
static CACHED_STATUS: OnceLock<OfficeStatus> = OnceLock::new();

#[tauri::command]
pub async fn detect_office() -> OfficeStatus {
    tauri::async_runtime::spawn_blocking(detect_office_cached)
        .await
        .unwrap_or_else(|_| OfficeStatus {
            installed: false,
            word: OfficeAppStatus {
                available: false,
                install_path: None,
                startup_path: Some(word_startup_dir()),
                version: None,
                plugin_installed: false,
            },
            powerpoint: OfficeAppStatus {
                available: false,
                install_path: None,
                startup_path: Some(word_startup_dir()),
                version: None,
                plugin_installed: false,
            },
            wps: false,
        })
}

pub(crate) fn detect_office_cached() -> OfficeStatus {
    CACHED_STATUS.get_or_init(|| detect_office_impl()).clone()
}

fn detect_office_impl() -> OfficeStatus {
    let word_status = detect_word();
    let ppt_status = detect_powerpoint();
    let wps = detect_wps();

    OfficeStatus {
        installed: word_status.available || ppt_status.available || wps,
        word: word_status,
        powerpoint: ppt_status,
        wps,
    }
}

fn detect_word() -> OfficeAppStatus {
    let mut status = OfficeAppStatus {
        available: false,
        install_path: None,
        startup_path: None,
        version: None,
        plugin_installed: false,
    };

    // Try ClickToRun (Office 365 / 2016+)
    if let Some(path) = query_reg(
        r"HKLM\SOFTWARE\Microsoft\Office\ClickToRun\Configuration",
        "InstallationPath",
    ) {
        status.available = true;
        status.install_path = Some(path);
        status.version = query_reg(
            r"HKLM\SOFTWARE\Microsoft\Office\ClickToRun\Configuration",
            "ProductReleaseIds",
        );
    }

    // Try MSI install
    if !status.available {
        if let Some(path) = query_reg(
            r"HKLM\SOFTWARE\Microsoft\Office\16.0\Word\InstallRoot",
            "Path",
        ) {
            status.available = true;
            status.install_path = Some(path);
        }
    }

    // Try Office 15 (2013)
    if !status.available {
        if let Some(path) = query_reg(
            r"HKLM\SOFTWARE\Microsoft\Office\15.0\Word\InstallRoot",
            "Path",
        ) {
            status.available = true;
            status.install_path = Some(path);
            status.version = Some("2013".to_string());
        }
    }

    // Detect STARTUP folder
    let startup = word_startup_dir();
    status.startup_path = Some(startup.clone());
    status.plugin_installed = office_addin_registered("Word");

    status
}

fn detect_powerpoint() -> OfficeAppStatus {
    let mut status = OfficeAppStatus {
        available: false,
        install_path: None,
        startup_path: None,
        version: None,
        plugin_installed: false,
    };

    if query_reg(
        r"HKLM\SOFTWARE\Microsoft\Office\ClickToRun\Configuration",
        "InstallationPath",
    )
    .is_some()
    {
        status.available = true;
        status.install_path = query_reg(
            r"HKLM\SOFTWARE\Microsoft\Office\ClickToRun\Configuration",
            "InstallationPath",
        );
        status.version = query_reg(
            r"HKLM\SOFTWARE\Microsoft\Office\ClickToRun\Configuration",
            "ProductReleaseIds",
        );
    }

    if !status.available {
        if let Some(path) = query_reg(
            r"HKLM\SOFTWARE\Microsoft\Office\16.0\PowerPoint\InstallRoot",
            "Path",
        ) {
            status.available = true;
            status.install_path = Some(path);
        }
    }

    status.startup_path = Some(word_startup_dir());
    status.plugin_installed = office_addin_registered("PowerPoint");

    status
}

fn detect_wps() -> bool {
    // Check registry
    if query_reg(r"HKLM\SOFTWARE\Kingsoft\Office", "InstallPath").is_some() {
        return true;
    }
    // Check common installation paths
    let appdata = dirs_next::data_dir().unwrap_or_default();
    let paths = [
        PathBuf::from(&appdata).join("kingsoft"),
        PathBuf::from(r"C:\Program Files\Kingsoft\Office6"),
        PathBuf::from(r"C:\Program Files (x86)\Kingsoft\Office6"),
        PathBuf::from(r"C:\Users\Public\Kingsoft\Office6"),
    ];
    for p in &paths {
        if p.exists() {
            return true;
        }
    }
    // Check for WPS JS API plugin
    let wps_addin = PathBuf::from(&appdata)
        .join("kingsoft")
        .join("wps")
        .join("addin");
    wps_addin.exists()
}

fn word_startup_dir() -> String {
    dirs_next::data_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("Microsoft")
        .join("Word")
        .join("STARTUP")
        .to_string_lossy()
        .to_string()
}

fn query_reg(key: &str, value_name: &str) -> Option<String> {
    let output = Command::new("reg")
        .args(["query", key, "/v", value_name])
        .output()
        .ok()?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    if !output.status.success() || !stdout.contains(value_name) {
        return None;
    }

    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with(value_name) {
            let parts: Vec<&str> = trimmed.splitn(3, "  ").collect();
            if parts.len() >= 3 {
                return Some(parts[2].trim().to_string());
            }
        }
    }
    None
}

fn office_addin_registered(app: &str) -> bool {
    let names = [
        "LaTeXSnipper.OfficePlugin.WordVstoAddIn",
        "LaTeXSnipper.OfficePlugin.PowerPointVstoAddIn",
        "LaTeXSnipper.Office",
        "LaTeXSnipper.OfficePlugin",
        "LaTeXSnipper-Office",
    ];
    names.iter().any(|name| {
        let key = format!(r"HKCU\Software\Microsoft\Office\{}\Addins\{}", app, name);
        Command::new("reg")
            .args(["query", &key])
            .output()
            .map(|out| out.status.success())
            .unwrap_or(false)
    })
}

#[tauri::command]
pub async fn register_office() -> RegisterResult {
    let result = tauri::async_runtime::spawn_blocking(|| {
        super::integrations::install_platform_integration_sync("office".to_string())
    })
    .await
    .unwrap_or_else(|err| super::integrations::PlatformIntegrationResult {
        success: false,
        platform: "office".to_string(),
        mode: "command".to_string(),
        message: format!("Office installation task failed: {err}"),
        restart_required: false,
    });
    RegisterResult {
        success: result.success,
        message: result.message,
    }
}

#[tauri::command]
pub async fn unregister_office() -> RegisterResult {
    let result = tauri::async_runtime::spawn_blocking(|| {
        super::integrations::uninstall_platform_integration_sync("office".to_string())
    })
    .await
    .unwrap_or_else(|err| super::integrations::PlatformIntegrationResult {
        success: false,
        platform: "office".to_string(),
        mode: "command".to_string(),
        message: format!("Office uninstallation task failed: {err}"),
        restart_required: false,
    });
    RegisterResult {
        success: result.success,
        message: result.message,
    }
}

#[tauri::command]
pub async fn check_office_registration() -> RegisterResult {
    let result = tauri::async_runtime::spawn_blocking(|| {
        super::integrations::check_platform_integration_sync("office".to_string())
    })
    .await
    .unwrap_or_else(|err| super::integrations::PlatformIntegrationResult {
        success: false,
        platform: "office".to_string(),
        mode: "command".to_string(),
        message: format!("Office check task failed: {err}"),
        restart_required: false,
    });
    RegisterResult {
        success: result.success,
        message: result.message,
    }
}

#[tauri::command]
pub fn write_pending_formula(
    latex: String,
    font_color: Option<String>,
    font_style: Option<String>,
) -> RegisterResult {
    let path = std::env::temp_dir().join("latexsnipper_pending.txt");
    let data = serde_json::json!({
        "latex": latex,
        "fontColor": font_color.unwrap_or_default(),
        "fontStyle": font_style.unwrap_or_default(),
    });
    match std::fs::write(&path, data.to_string()) {
        Ok(_) => RegisterResult {
            success: true,
            message: "Formula sent".into(),
        },
        Err(e) => RegisterResult {
            success: false,
            message: format!("Failed: {}", e),
        },
    }
}
