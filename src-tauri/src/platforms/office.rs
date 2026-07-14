use serde::{Deserialize, Serialize};
#[cfg(any(target_os = "windows", target_os = "macos"))]
use std::path::PathBuf;
use std::sync::Mutex;
#[cfg(target_os = "windows")]
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OfficeStatus {
    pub installed: bool,
    pub word: OfficeAppStatus,
    pub excel: OfficeAppStatus,
    pub powerpoint: OfficeAppStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OfficeAppStatus {
    pub available: bool,
    pub install_path: Option<String>,
    pub startup_path: Option<String>,
    pub version: Option<String>,
    pub plugin_installed: bool,
}

impl OfficeAppStatus {
    fn unavailable() -> Self {
        Self {
            available: false,
            install_path: None,
            startup_path: None,
            version: None,
            plugin_installed: false,
        }
    }
}

impl OfficeStatus {
    fn unavailable() -> Self {
        Self {
            installed: false,
            word: OfficeAppStatus::unavailable(),
            excel: OfficeAppStatus::unavailable(),
            powerpoint: OfficeAppStatus::unavailable(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegisterResult {
    pub success: bool,
    pub message: String,
}

// Cached Office status — computed once, can be invalidated after install/uninstall.
// Using Mutex instead of OnceLock so the cache can be cleared when Office integration
// is toggled, preventing stale status from persisting across toggle cycles.
static CACHED_STATUS: Mutex<Option<OfficeStatus>> = Mutex::new(None);

#[tauri::command]
pub async fn detect_office() -> OfficeStatus {
    tauri::async_runtime::spawn_blocking(detect_office_cached)
        .await
        .unwrap_or_else(|_| OfficeStatus::unavailable())
}

/// Clear the cached Office status so the next `detect_office()` call re-detects.
/// Called from the frontend after enable/disable Office integration.
#[tauri::command]
pub async fn invalidate_office_cache() {
    if let Ok(mut cache) = CACHED_STATUS.lock() {
        *cache = None;
    }
    log::info!("[Office] Cache invalidated");
}

pub(crate) fn detect_office_cached() -> OfficeStatus {
    if let Ok(mut cache) = CACHED_STATUS.lock() {
        if let Some(ref cached) = *cache {
            return cached.clone();
        }
        let detected = detect_office_impl();
        *cache = Some(detected.clone());
        detected
    } else {
        // Mutex poisoned — fall back to uncached detection
        detect_office_impl()
    }
}

fn detect_office_impl() -> OfficeStatus {
    #[cfg(target_os = "windows")]
    let detected = detect_windows_office();

    #[cfg(target_os = "macos")]
    let detected = detect_macos_office();

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let detected = OfficeStatus::unavailable();

    detected
}

#[cfg(target_os = "windows")]
fn detect_windows_office() -> OfficeStatus {
    let word_status = detect_word();
    let excel_status = detect_excel();
    let ppt_status = detect_powerpoint();

    OfficeStatus {
        installed: word_status.available || excel_status.available || ppt_status.available,
        word: word_status,
        excel: excel_status,
        powerpoint: ppt_status,
    }
}

#[cfg(target_os = "macos")]
fn detect_macos_office() -> OfficeStatus {
    let word_status = detect_macos_app("Microsoft Word.app", "com.microsoft.Word");
    let excel_status = detect_macos_app("Microsoft Excel.app", "com.microsoft.Excel");
    let ppt_status = detect_macos_app("Microsoft PowerPoint.app", "com.microsoft.Powerpoint");

    OfficeStatus {
        installed: word_status.available || excel_status.available || ppt_status.available,
        word: word_status,
        excel: excel_status,
        powerpoint: ppt_status,
    }
}

#[cfg(target_os = "macos")]
fn detect_macos_app(app_bundle: &str, container_id: &str) -> OfficeAppStatus {
    let home = dirs_next::home_dir().unwrap_or_default();
    let candidates = [
        PathBuf::from("/Applications").join(app_bundle),
        home.join("Applications").join(app_bundle),
    ];
    let install_path = candidates
        .iter()
        .find(|path| path.is_dir())
        .map(|path| path.to_string_lossy().to_string());
    let manifest = home
        .join("Library")
        .join("Containers")
        .join(container_id)
        .join("Data")
        .join("Documents")
        .join("wef")
        .join("LaTeXSnipper.xml");

    OfficeAppStatus {
        available: install_path.is_some(),
        install_path,
        startup_path: None,
        version: None,
        plugin_installed: manifest.is_file(),
    }
}

#[cfg(target_os = "windows")]
fn detect_excel() -> OfficeAppStatus {
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
            r"HKLM\SOFTWARE\Microsoft\Office\16.0\Excel\InstallRoot",
            "Path",
        ) {
            status.available = true;
            status.install_path = Some(path);
        }
    }

    // Try Office 15 (2013)
    if !status.available {
        if let Some(path) = query_reg(
            r"HKLM\SOFTWARE\Microsoft\Office\15.0\Excel\InstallRoot",
            "Path",
        ) {
            status.available = true;
            status.install_path = Some(path);
            status.version = Some("2013".to_string());
        }
    }

    // Check plugin registration
    status.plugin_installed = office_addin_registered("Excel");

    status
}

#[cfg(target_os = "windows")]
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

#[cfg(target_os = "windows")]
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

#[allow(dead_code, reason = "Reserved for standalone WPS diagnostics")]
#[cfg(target_os = "windows")]
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

#[cfg(target_os = "windows")]
fn word_startup_dir() -> String {
    dirs_next::data_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("Microsoft")
        .join("Word")
        .join("STARTUP")
        .to_string_lossy()
        .to_string()
}

#[cfg(target_os = "windows")]
fn query_reg(key: &str, value_name: &str) -> Option<String> {
    for view in ["/reg:64", "/reg:32"] {
        if let Ok(output) = super::process::run_with_timeout(
            super::process::background_command("reg.exe")
                .args(["query", key, "/v", value_name, view]),
            Duration::from_secs(10),
        ) {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if output.status.success() && stdout.contains(value_name) {
                // Parse "    LoadBehavior    REG_DWORD    0x3"
                for line in stdout.lines() {
                    let trimmed = line.trim();
                    if trimmed.starts_with(value_name) {
                        // Use whitespace splitting instead of fixed slice
                        let parts: Vec<&str> = trimmed.split_whitespace().collect();
                        if parts.len() >= 3 {
                            return Some(parts[parts.len() - 1].to_string());
                        }
                    }
                }
            }
        }
    }
    None
}

#[cfg(target_os = "windows")]
fn office_addin_registered(app: &str) -> bool {
    let names = [
        "LaTeXSnipper.OfficePlugin.WordVstoAddIn",
        "LaTeXSnipper.OfficePlugin.PowerPointVstoAddIn",
        "LaTeXSnipper.Office",
        "LaTeXSnipper.OfficePlugin",
        "LaTeXSnipper-Office",
    ];
    let views = ["/reg:64", "/reg:32"];
    names.iter().any(|name| {
        let key = format!(r"HKCU\Software\Microsoft\Office\{}\Addins\{}", app, name);
        views.iter().any(|view| {
            super::process::background_command("reg.exe")
                .args(["query", &key, view])
                .output()
                .map(|out| out.status.success())
                .unwrap_or(false)
        })
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
        details: None,
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
        details: None,
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
        details: None,
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
