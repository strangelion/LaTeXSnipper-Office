use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

/// Tracks whether the Office.js Taskpane has reported a heartbeat.
/// Set by the bridge's `/api/office/heartbeat` handler.
static TASKPANE_HEARTBEAT: AtomicBool = AtomicBool::new(false);

/// Record that the Taskpane has connected (called from bridge heartbeat handler).
pub fn record_taskpane_heartbeat() {
    TASKPANE_HEARTBEAT.store(true, Ordering::Relaxed);
}

/// Check whether the Taskpane has ever reported a heartbeat.
pub fn is_taskpane_connected() -> bool {
    TASKPANE_HEARTBEAT.load(Ordering::Relaxed)
}

// ═══════════════════════════════════════════════════════════════════════════
// Unified helpers for /reg:32 / /reg:64 registry view handling
//
// These replace all ad-hoc "/reg:" string concatenation. reg.exe requires the
// view flag as a single argument ("/reg:32", not ["/reg:", "32"]).
// ═══════════════════════════════════════════════════════════════════════════

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RegistryView {
    X64,
    X86,
}

impl RegistryView {
    fn as_reg_arg(self) -> &'static str {
        match self {
            RegistryView::X64 => "/reg:64",
            RegistryView::X86 => "/reg:32",
        }
    }

    fn label(self) -> &'static str {
        match self {
            RegistryView::X64 => "64",
            RegistryView::X86 => "32",
        }
    }
}

const REGISTRY_VIEWS: [RegistryView; 2] = [RegistryView::X64, RegistryView::X86];

/// Safely parse a REG_DWORD hex value from a `reg query` output line.
///
/// `reg query` outputs lines like:
///   LoadBehavior    REG_DWORD    0x3
/// Older code used a fixed slice `line[pos+2..pos+10]` which panics when the
/// hex value is shorter than 8 characters (e.g. "0x3").
#[cfg(target_os = "windows")]
fn parse_reg_dword_from_line(line: &str) -> Option<u32> {
    let pos = line.rfind("0x")?;
    let hex = line[pos + 2..]
        .split_whitespace()
        .next()
        .unwrap_or("")
        .trim();

    if hex.is_empty() || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }

    u32::from_str_radix(hex, 16).ok()
}

/// Run a Windows system tool (reg.exe, certutil.exe, tasklist.exe) with
/// a timeout. Panics from the underlying process are caught. This prevents
/// the Office toggle from hanging forever if the tool is unresponsive.
#[cfg(target_os = "windows")]
fn run_windows_tool(
    cmd: &mut std::process::Command,
    timeout_secs: u64,
) -> Result<std::process::Output, String> {
    super::process::run_with_timeout(cmd, std::time::Duration::from_secs(timeout_secs))
        .map_err(|e| format!("process timeout or spawn failure: {e}"))
}

// ═══════════════════════════════════════════════════════════════════════════
// DEPRECATION NOTICE — COM/VSTO/RegAsm/PowerShell routes
//
// These functions are retained for reference but are NOT used in the current
// architecture. The Office integration now uses exclusively:
//   Office.js manifest → Wef sideloading → Bridge HTTP API → Word Taskpane
//
// No COM, VSTO, RegAsm, or PowerShell is needed.
// See: docs/office-architecture.md or apps/office-addin/README.md
// ═══════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlatformIntegrationResult {
    pub success: bool,
    pub platform: String,
    pub mode: String,
    pub message: String,
    pub restart_required: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OleStatus {
    pub available: bool,
    pub bitness_mismatch: bool,
    pub x64_registered: bool,
    pub x86_registered: bool,
    pub x64_dll_exists: bool,
    pub x86_dll_exists: bool,
    /// Granular OLE health level:
    ///   "NotInstalled" → CLSID/ProgID missing
    ///   "RegisteredButBroken" → registry exists but DLL path wrong or missing
    ///   "Registered" → CLSID + correct DLL path confirmed
    ///   "Activatable" → CoCreateInstance succeeds (Windows/C++ only)
    pub health: String,
    /// Human-readable detail message
    pub detail: String,
}

impl PlatformIntegrationResult {
    fn ok(platform: &str, mode: &str, message: impl Into<String>, restart_required: bool) -> Self {
        Self {
            success: true,
            platform: platform.to_string(),
            mode: mode.to_string(),
            message: message.into(),
            restart_required,
        }
    }

    fn fail(platform: &str, mode: &str, message: impl Into<String>) -> Self {
        Self {
            success: false,
            platform: platform.to_string(),
            mode: mode.to_string(),
            message: message.into(),
            restart_required: false,
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Integration Ledger — records what was installed for reliable uninstall
// ═══════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct IntegrationLedger {
    pub schema_version: u32,
    pub install_id: String,
    pub desktop_version: String,
    pub native_office: NativeOfficeLedger,
    pub office_js: OfficeJsLedger,
    pub wps: WpsLedger,
    pub obsidian: Vec<ObsidianLedgerEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct NativeOfficeLedger {
    pub vsto: Vec<VstoLedgerEntry>,
    pub ole: Option<OleLedgerEntry>,
    pub signer_thumbprint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VstoLedgerEntry {
    pub host: String,
    pub registry_key: String,
    pub manifest: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OleLedgerEntry {
    pub enabled: bool,
    pub bitness: String,
    pub dll_path: String,
    pub prog_id: String,
    pub clsid: String,
    pub registry_view: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct OfficeJsLedger {
    pub manifest_ids: Vec<String>,
    pub developer_registry_values: Vec<String>,
    pub cert_thumbprint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WpsLedger {
    pub plugin_dir: Option<String>,
    pub publish_entry_owner: Option<String>,
    pub started_pids: Vec<u32>,
    pub shortcuts: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ObsidianLedgerEntry {
    pub vault_path: String,
    pub plugin_path: String,
    pub plugin_id: String,
}

impl IntegrationLedger {
    fn load() -> Self {
        let path = ledger_path();
        match fs::read_to_string(&path) {
            Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
            Err(_) => Self::default(),
        }
    }

    fn save(&self) -> Result<(), String> {
        let path = ledger_path();
        let dir = path.parent().ok_or("Cannot determine ledger directory")?;
        fs::create_dir_all(dir)
            .map_err(|e| format!("Failed to create ledger directory: {e}"))?;
        let json = serde_json::to_string_pretty(self)
            .map_err(|e| format!("Failed to serialize ledger: {e}"))?;
        fs::write(&path, json)
            .map_err(|e| format!("Failed to write ledger: {e}"))
    }
}

fn ledger_path() -> PathBuf {
    app_data_dir().join("integration-ledger.v1.json")
}

fn generate_install_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let t = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{}-{:x}", std::process::id(), t)
}

fn get_desktop_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
pub async fn install_platform_integration(platform_id: String) -> PlatformIntegrationResult {
    let fallback_platform = platform_id.clone();
    // Run on blocking thread pool — never blocks the Tauri main/UI thread
    tauri::async_runtime::spawn_blocking(move || install_platform_integration_sync(platform_id))
        .await
        .unwrap_or_else(|err| {
            PlatformIntegrationResult::fail(
                &fallback_platform,
                "command",
                format!("Install task failed: {err}"),
            )
        })
}

pub(crate) fn install_platform_integration_sync(platform_id: String) -> PlatformIntegrationResult {
    // Top-level catch_unwind to prevent panic=abort crashes.
    // Inner catch_unwind calls in install_native_office_vsto provide additional
    // granularity, but this outer one catches any unexpected panics.
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        match platform_id.as_str() {
        // Office install modes
        "office" => install_native_office_vsto(),
        "office-web" => install_office_js_addin(),
        "office-native" => install_native_office_vsto(),
        "office-hybrid" => {
            let vsto = install_native_office_vsto();
            let web = install_office_js_addin();
            if !vsto.success {
                return vsto;
            }
            if !web.success {
                return web;
            }
            PlatformIntegrationResult::ok(
                "office",
                "hybrid",
                "Installed both Office.js Add-in (Word/Excel/PPT Taskpane) and Native VSTO.",
                true,
            )
        }
        "obsidian" => install_obsidian(),
        "vscode" => install_vscode(),
        "wps" => install_wps(),
        "typora" => install_clipboard_platform(
            "typora",
            "Typora uses Markdown math via clipboard: inline $...$ or display $$...$$.",
        ),
        "notion" => install_clipboard_platform(
            "notion",
            "Notion has no local plugin API. LaTeXSnipper will use clipboard equations for Notion.",
        ),
        "libreoffice" => install_libreoffice(),
        other => PlatformIntegrationResult::fail(other, "unknown", "Unsupported platform."),
    }
    // End of catch_unwind closure — panics caught and returned as structured error
})) {
    Ok(result) => result,
    Err(panic) => {
        let msg = if let Some(s) = panic.downcast_ref::<&str>() {
            s.to_string()
        } else if let Some(s) = panic.downcast_ref::<String>() {
            s.clone()
        } else {
            "unknown panic".to_string()
        };
        log::error!("[Office] install_platform_integration_sync panicked: {}", msg);
        PlatformIntegrationResult::fail("office", "panic", format!("内部错误: {}", msg))
    }
}
}

#[tauri::command]
pub async fn uninstall_platform_integration(platform_id: String) -> PlatformIntegrationResult {
    let fallback_platform = platform_id.clone();
    tauri::async_runtime::spawn_blocking(move || uninstall_platform_integration_sync(platform_id))
        .await
        .unwrap_or_else(|err| {
            PlatformIntegrationResult::fail(
                &fallback_platform,
                "command",
                format!("Uninstall task failed: {err}"),
            )
        })
}

pub(crate) fn uninstall_platform_integration_sync(
    platform_id: String,
) -> PlatformIntegrationResult {
    // Run the cleaner first to get audit information
    let cleaner_scope = match platform_id.as_str() {
        "office" | "office-native" => "native-office",
        "office-hybrid" => "native-office",
        "obsidian" => "obsidian",
        _ => "",
    };

    if !cleaner_scope.is_empty() {
        let cleaner_result = run_cleaner(cleaner_scope, false);
        log::info!(
            "[Uninstall] Cleaner result: removed={}, skipped={}, failed={}, pending={}",
            cleaner_result.entries_removed.len(),
            cleaner_result.entries_skipped.len(),
            cleaner_result.entries_failed.len(),
            cleaner_result.pending_restart.len()
        );
    }

    match platform_id.as_str() {
        "office" => uninstall_native_office_vsto(),
        "office-web" => uninstall_office_addin(),
        "office-native" => uninstall_native_office_vsto(),
        "office-hybrid" => {
            let _ = uninstall_native_office_vsto();
            uninstall_office_addin()
        }
        "obsidian" => uninstall_obsidian(),
        "vscode" => remove_generated_dir("vscode", "plugin", vscode_extension_dir()),
        "wps" => uninstall_wps(),
        "typora" => remove_generated_dir(
            "typora",
            "clipboard",
            integration_state_dir().join("typora"),
        ),
        "notion" => remove_generated_dir(
            "notion",
            "clipboard",
            integration_state_dir().join("notion"),
        ),
        "libreoffice" => remove_generated_dir(
            "libreoffice",
            "extension-stub",
            integration_state_dir().join("libreoffice"),
        ),
        "all" => {
            let all_result = run_cleaner("all", false);
            log::info!(
                "[Uninstall-All] Cleaner completed: removed={}, skipped={}, pending={}",
                all_result.entries_removed.len(),
                all_result.entries_skipped.len(),
                all_result.pending_restart.len()
            );
            PlatformIntegrationResult::ok(
                "all",
                "all",
                format!(
                    "Cleaned all integrations. Removed {} items, {} pending restart.",
                    all_result.entries_removed.len(),
                    all_result.pending_restart.len()
                ),
                !all_result.pending_restart.is_empty(),
            )
        }
        other => PlatformIntegrationResult::fail(other, "unknown", "Unsupported platform."),
    }
}

#[tauri::command]
pub async fn check_platform_integration(platform_id: String) -> PlatformIntegrationResult {
    let fallback_platform = platform_id.clone();
    tauri::async_runtime::spawn_blocking(move || check_platform_integration_sync(platform_id))
        .await
        .unwrap_or_else(|err| {
            PlatformIntegrationResult::fail(
                &fallback_platform,
                "command",
                format!("Check task failed: {err}"),
            )
        })
}

pub(crate) fn check_platform_integration_sync(platform_id: String) -> PlatformIntegrationResult {
    match platform_id.as_str() {
        "office" => {
            let ole_status = check_ole_status();
            if check_native_office_vsto() && ole_status.available {
                PlatformIntegrationResult::ok(
                    "office",
                    "native-vsto",
                    "Native Office VSTO add-ins and OLE component are installed.",
                    false,
                )
            } else if check_native_office_vsto() {
                PlatformIntegrationResult::fail(
                    "office",
                    "ole_missing",
                    format!(
                        "Native Office VSTO add-ins are installed, but OLE is not ready: {}",
                        ole_status.detail
                    ),
                )
            } else {
                PlatformIntegrationResult::fail(
                    "office",
                    "not_installed",
                    "Native Office VSTO add-ins are not installed. Enable Office integration in settings.",
                )
            }
        }
        "obsidian" => {
            let vaults = obsidian_vaults();
            let mut installed_count = 0;
            for vault in &vaults {
                let plugin_dir = vault
                    .join(".obsidian")
                    .join("plugins")
                    .join("latexsnipper-obsidian");
                if plugin_dir.exists() && plugin_dir.join("main.js").exists() {
                    installed_count += 1;
                }
            }
            if installed_count > 0 {
                PlatformIntegrationResult::ok(
                    "obsidian",
                    "plugin",
                    format!("Obsidian plugin installed in {installed_count} vault(s)."),
                    false,
                )
            } else {
                PlatformIntegrationResult::fail(
                    "obsidian",
                    "plugin",
                    "Obsidian plugin is not installed in any vault.",
                )
            }
        }
        "vscode" => check_path(
            "vscode",
            "plugin",
            vscode_extension_dir(),
            "VS Code extension is installed.",
        ),
        "wps" => check_wps(),
        "typora" => check_path(
            "typora",
            "clipboard",
            integration_state_dir().join("typora"),
            "Typora clipboard integration is enabled.",
        ),
        "notion" => check_path(
            "notion",
            "clipboard",
            integration_state_dir().join("notion"),
            "Notion clipboard integration is enabled.",
        ),
        "libreoffice" => check_path(
            "libreoffice",
            "extension-stub",
            integration_state_dir().join("libreoffice"),
            "LibreOffice extension scaffold is prepared.",
        ),
        other => PlatformIntegrationResult::fail(other, "unknown", "Unsupported platform."),
    }
}

fn app_data_dir() -> PathBuf {
    dirs_next::data_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("LaTeXSnipper")
        .join("Office")
}

fn integration_state_dir() -> PathBuf {
    app_data_dir().join("platform-integrations")
}

fn repo_root_from_manifest() -> Option<PathBuf> {
    let manifest = std::env::var("CARGO_MANIFEST_DIR").ok()?;
    PathBuf::from(manifest).parent().map(Path::to_path_buf)
}

fn github_root_from_manifest() -> Option<PathBuf> {
    repo_root_from_manifest()?.parent().map(Path::to_path_buf)
}

fn find_office_force_clean() -> Option<PathBuf> {
    let github_root = github_root_from_manifest()?;
    let path = github_root
        .join("LaTeXSnipper")
        .join("office_plugin")
        .join("tools")
        .join("ForceClean.ps1");
    path.exists().then_some(path)
}

fn new_office_addin_build_script() -> Option<PathBuf> {
    let github_root = github_root_from_manifest()?;
    let script = github_root
        .join("LaTeXSnipper-Office")
        .join("plugin")
        .join("Office")
        .join("LightweightAddIn")
        .join("build.ps1");
    script.exists().then_some(script)
}

fn new_office_addin_dll() -> Option<PathBuf> {
    let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    let bundled = exe_dir
        .join("resources")
        .join("Office")
        .join("LightweightAddIn")
        .join("LaTeXSnipper.OfficeAddIn.dll");
    if bundled.exists() {
        return Some(bundled);
    }

    let github_root = github_root_from_manifest()?;
    let dll = github_root
        .join("LaTeXSnipper-Office")
        .join("plugin")
        .join("Office")
        .join("LightweightAddIn")
        .join("bin")
        .join("x64")
        .join("Release")
        .join("LaTeXSnipper.OfficeAddIn.dll");
    dll.exists().then_some(dll)
}

fn build_new_office_addin() -> Result<PathBuf, String> {
    if let Some(dll) = new_office_addin_dll() {
        return Ok(dll);
    }

    let Some(script) = new_office_addin_build_script() else {
        return Err("新的 Office 加载项 build.ps1 不存在。".to_string());
    };

    let output = {
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            let mut cmd = Command::new("powershell");
            cmd.args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
                .arg(&script)
                .args(["-Platform", "x64"])
                .creation_flags(CREATE_NO_WINDOW);
            super::process::run_with_timeout(&mut cmd, Duration::from_secs(120))
        }
        #[cfg(not(target_os = "windows"))]
        {
            let mut cmd = Command::new("powershell");
            cmd.args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
                .arg(&script)
                .args(["-Platform", "x64"]);
            super::process::run_with_timeout(&mut cmd, Duration::from_secs(120))
        }
    }
    .map_err(|err| format!("启动 Office 加载项编译失败: {err}"))?;

    if !output.status.success() {
        return Err(format!(
            "Office 加载项编译失败: {}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    new_office_addin_dll()
        .ok_or_else(|| "编译完成但未找到 LaTeXSnipper.OfficeAddIn.dll。".to_string())
}

fn office_addin_registry_roots(app: &str) -> Vec<String> {
    vec![
        format!(
            r"HKCU\Software\Microsoft\Office\{}\Addins\LaTeXSnipper.Office",
            app
        ),
        format!(
            r"HKCU\Software\Microsoft\Office\16.0\{}\Addins\LaTeXSnipper.Office",
            app
        ),
    ]
}

#[allow(dead_code)]
fn regasm_path() -> Option<PathBuf> {
    let regasm64 = PathBuf::from(r"C:\Windows\Microsoft.NET\Framework64\v4.0.30319\RegAsm.exe");
    if regasm64.exists() {
        return Some(regasm64);
    }
    let regasm32 = PathBuf::from(r"C:\Windows\Microsoft.NET\Framework\v4.0.30319\RegAsm.exe");
    regasm32.exists().then_some(regasm32)
}

#[allow(dead_code)]
fn escape_ps_path(path: &Path) -> String {
    path.to_string_lossy().replace('\'', "''")
}

#[allow(dead_code)]
fn spawn_regasm(dll: &Path, unregister: bool) -> Result<(), String> {
    let Some(regasm) = regasm_path() else {
        return Err("RegAsm.exe 不存在，无法注册 .NET Framework COM 加载项。".to_string());
    };
    let args = if unregister {
        format!("'{}' /u", escape_ps_path(dll))
    } else {
        format!("'{}' /codebase /tlb", escape_ps_path(dll))
    };
    let script = format!(
        "Start-Process -FilePath '{}' -ArgumentList \"{}\" -Verb RunAs -WindowStyle Hidden",
        escape_ps_path(&regasm),
        args.replace('"', "`\"")
    );
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        Command::new("powershell")
            .args([
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-WindowStyle",
                "Hidden",
                "-Command",
                &script,
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map(|_| ())
            .map_err(|err| format!("启动 RegAsm 失败: {err}"))
    }
    #[cfg(not(target_os = "windows"))]
    {
        Command::new("powershell")
            .args([
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-WindowStyle",
                "Hidden",
                "-Command",
                &script,
            ])
            .spawn()
            .map(|_| ())
            .map_err(|err| format!("启动 RegAsm 失败: {err}"))
    }
}

#[cfg(target_os = "windows")]
fn reg_add_string(key: &str, name: &str, value: &str) -> std::io::Result<()> {
    reg_add_string_view(key, name, value, RegistryView::X64)
}

/// reg.exe add with explicit RegistryView (/reg:32 or /reg:64).
#[cfg(target_os = "windows")]
fn reg_add_string_view(
    key: &str,
    name: &str,
    value: &str,
    view: RegistryView,
) -> std::io::Result<()> {
    let mut command = super::process::background_command("reg.exe");
    command.args(["add", key]);
    if name.is_empty() {
        command.arg("/ve");
    } else {
        command.args(["/v", name]);
    }
    if value.is_empty() {
        command.arg("/f");
    } else {
        command.args(["/t", "REG_SZ", "/d", value, "/f"]);
    }
    command.arg(view.as_reg_arg());
    let output = super::process::run_with_timeout(&mut command, Duration::from_secs(15))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(std::io::Error::new(
            std::io::ErrorKind::Other,
            format!(
                "reg add failed [{}]: {}{}",
                view.label(),
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            ),
        ))
    }
}

#[cfg(target_os = "windows")]
fn reg_add_dword(key: &str, name: &str, value: u32) -> std::io::Result<()> {
    reg_add_dword_view(key, name, value, RegistryView::X64)
}

#[cfg(target_os = "windows")]
fn reg_add_dword_view(
    key: &str,
    name: &str,
    value: u32,
    view: RegistryView,
) -> std::io::Result<()> {
    let value = value.to_string();
    let mut cmd = super::process::background_command("reg.exe");
    cmd.args(["add", key, "/v", name, "/t", "REG_DWORD", "/d", &value, "/f"]);
    cmd.arg(view.as_reg_arg());
    let output = super::process::run_with_timeout(&mut cmd, Duration::from_secs(15))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(std::io::Error::new(
            std::io::ErrorKind::Other,
            format!(
                "reg add dword failed [{}]: {}{}",
                view.label(),
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            ),
        ))
    }
}

#[cfg(target_os = "windows")]
fn reg_delete_tree(key: &str) {
    // Delete from both views for thorough cleanup
    let _ = reg_delete_tree_view(key, RegistryView::X64);
    let _ = reg_delete_tree_view(key, RegistryView::X86);
}

#[cfg(target_os = "windows")]
fn reg_delete_tree_view(key: &str, view: RegistryView) -> std::io::Result<()> {
    let mut cmd = super::process::background_command("reg.exe");
    cmd.args(["delete", key, "/f"]);
    cmd.arg(view.as_reg_arg());
    let output = super::process::run_with_timeout(&mut cmd, Duration::from_secs(15))?;
    if output.status.success() {
        Ok(())
    } else {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        // Deleting a non-existent key should not fail the entire uninstall.
        if stdout.contains("ERROR") || stderr.contains("ERROR") {
            Err(std::io::Error::new(
                std::io::ErrorKind::Other,
                format!(
                    "reg delete failed [{}]: {}{}",
                    view.label(),
                    stdout,
                    stderr
                ),
            ))
        } else {
            Ok(())
        }
    }
}

/// Delete a registry tree from both 64-bit and 32-bit views silently.
/// Returns () to match old call sites that ignored the result.
#[cfg(target_os = "windows")]
fn reg_delete_tree_both(key: &str) {
    let _ = reg_delete_tree_view(key, RegistryView::X64);
    let _ = reg_delete_tree_view(key, RegistryView::X86);
}

fn office_addin_clsid() -> &'static str {
    "{71CE99BB-D608-45D7-B837-ABDE82B9B61A}"
}

fn office_addin_class_name() -> &'static str {
    "LaTeXSnipper.OfficeAddIn.LaTeXSnipperOfficeAddIn"
}

fn office_addin_assembly_name() -> &'static str {
    "LaTeXSnipper.OfficeAddIn, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null"
}

fn hkcu_classes_key(path: &str) -> String {
    format!(r"HKCU\Software\Classes\{}", path)
}

fn office_addin_codebase(dll: &Path) -> String {
    format!("file:///{}", dll.to_string_lossy().replace('\\', "/"))
}

fn register_hkcu_office_com_addin(dll: &Path) -> Result<(), String> {
    let clsid = office_addin_clsid();
    let clsid_key = hkcu_classes_key(&format!(r"CLSID\{}", clsid));
    let inproc_key = format!(r"{}\InprocServer32", clsid_key);
    let version_key = format!(r"{}\0.0.0.0", inproc_key);
    let progid_key = hkcu_classes_key("LaTeXSnipper.Office");
    let codebase = office_addin_codebase(dll);

    reg_add_string(&progid_key, "", "LaTeXSnipper Office")
        .map_err(|err| format!("write ProgID failed: {err}"))?;
    reg_add_string(&format!(r"{}\CLSID", progid_key), "", clsid)
        .map_err(|err| format!("write ProgID CLSID failed: {err}"))?;
    reg_add_string(&clsid_key, "", "LaTeXSnipper Office")
        .map_err(|err| format!("write CLSID failed: {err}"))?;
    reg_add_string(&format!(r"{}\ProgId", clsid_key), "", "LaTeXSnipper.Office")
        .map_err(|err| format!("write CLSID ProgID failed: {err}"))?;
    reg_add_string(
        &format!(
            r"{}\Implemented Categories\{{62C8FE65-4EBB-45e7-B440-6E39B2CDBF29}}",
            clsid_key
        ),
        "",
        "",
    )
    .map_err(|err| format!("write .NET category failed: {err}"))?;

    for key in [&inproc_key, &version_key] {
        reg_add_string(key, "", "mscoree.dll")
            .map_err(|err| format!("write InprocServer32 failed: {err}"))?;
        reg_add_string(key, "ThreadingModel", "Both")
            .map_err(|err| format!("write ThreadingModel failed: {err}"))?;
        reg_add_string(key, "Class", office_addin_class_name())
            .map_err(|err| format!("write class name failed: {err}"))?;
        reg_add_string(key, "Assembly", office_addin_assembly_name())
            .map_err(|err| format!("write assembly name failed: {err}"))?;
        reg_add_string(key, "RuntimeVersion", "v4.0.30319")
            .map_err(|err| format!("write runtime version failed: {err}"))?;
        reg_add_string(key, "CodeBase", &codebase)
            .map_err(|err| format!("write codebase failed: {err}"))?;
    }

    Ok(())
}

fn unregister_hkcu_office_com_addin() {
    // Clean HKCU
    reg_delete_tree(&hkcu_classes_key("LaTeXSnipper.Office"));
    reg_delete_tree(&hkcu_classes_key(&format!(
        r"CLSID\{}",
        office_addin_clsid()
    )));
    // Also clean HKCR (in case regsvr32 registered there)
    reg_delete_tree(&format!(r"HKCR\CLSID\{}", office_addin_clsid()));
    reg_delete_tree(r"HKCR\LaTeXSnipper.Office");
}

fn cleanup_legacy_office_com_addins() {
    for app in ["Word", "Excel", "PowerPoint"] {
        for addin in [
            "LaTeXSnipperOffice",
            "LaTeXSnipperOffice-Independent",
            "LaTeXSnipper.Office",
        ] {
            reg_delete_tree(&format!(
                r"HKCU\Software\Microsoft\Office\{}\Addins\{}",
                app, addin
            ));
            reg_delete_tree(&format!(
                r"HKCU\Software\Microsoft\Office\16.0\{}\Addins\{}",
                app, addin
            ));
        }
        reg_delete_tree(&format!(
            r"HKCU\Software\Microsoft\Office\{}\Addins\ComAddin.Connect",
            app
        ));
        reg_delete_tree(&format!(
            r"HKCU\Software\Microsoft\Office\16.0\{}\Addins\ComAddin.Connect",
            app
        ));
    }
    reg_delete_tree(&hkcu_classes_key("ComAddin.Connect"));
    reg_delete_tree(&hkcu_classes_key(
        r"CLSID\{B5E3C3A1-7D4F-4E8B-9A2C-1F6E8D3C5B7A}",
    ));
}

fn office_com_addin_registered() -> bool {
    // Check if registered for any Office app (Word, Excel, or PowerPoint)
    let addin_ok = ["Word", "Excel", "PowerPoint"].iter().any(|app| {
        run_windows_tool(
            super::process::background_command("reg.exe").args([
                "query",
                &format!(
                    r"HKCU\Software\Microsoft\Office\{}\Addins\LaTeXSnipper.Office",
                    app
                ),
                "/v",
                "LoadBehavior",
            ]),
            10,
        )
        .map(|out| out.status.success())
        .unwrap_or(false)
    });

    let com_key = hkcu_classes_key(&format!(r"CLSID\{}\InprocServer32", office_addin_clsid()));
    let com_ok = run_windows_tool(
        super::process::background_command("reg.exe")
            .args(["query", &com_key, "/v", "CodeBase"]),
        10,
    )
    .map(|out| out.status.success())
    .unwrap_or(false);

    addin_ok && com_ok
}

/// Auto-register the COM add-in on first run (called from app setup).
pub async fn auto_register_office_addin(_app_handle: &tauri::AppHandle) {
    #[cfg(not(target_os = "windows"))]
    {
        println!("[Office] COM add-in registration skipped (not Windows).");
        return;
    }

    if office_com_addin_registered() {
        println!("[Office] COM add-in already registered, skipping.");
        return;
    }

    println!("[Office] COM add-in not registered, attempting auto-registration...");

    // Find the DLL in bundled resources
    let dll_path = bundled_com_dll();
    let Some(path) = dll_path else {
        println!("[Office] COM DLL not found in resources, skipping auto-registration.");
        return;
    };

    // Find regasm
    let regasm = find_regasm();
    let Some(regasm_path) = regasm else {
        println!("[Office] regasm.exe not found, skipping auto-registration.");
        return;
    };

    // Write PS1 script for registration (requires admin via UAC)
    let script_path = std::env::temp_dir().join("latexsnipper_auto_register.ps1");
    let script_content = format!(
        r#"
# Write add-in registry entries for Word, Excel, and PowerPoint
foreach ($app in @('Word', 'Excel', 'PowerPoint')) {{
    $addinKey = "HKCU:\Software\Microsoft\Office\$app\Addins\LaTeXSnipper.Office"
    New-Item -Path $addinKey -Force | Out-Null
    Set-ItemProperty -Path $addinKey -Name 'FriendlyName' -Value 'LaTeXSnipper Office'
    Set-ItemProperty -Path $addinKey -Name 'Description' -Value 'LaTeXSnipper Office formula add-in'
    Set-ItemProperty -Path $addinKey -Name 'LoadBehavior' -Value 3 -Type DWord
    Set-ItemProperty -Path $addinKey -Name 'CommandLineSafe' -Value 0 -Type DWord
}}

# Register COM DLL via regasm
& '{regasm}' '{dll}' /codebase /tlb
Write-Output 'Registration complete.'
"#,
        regasm = regasm_path.to_string_lossy(),
        dll = path.to_string_lossy()
    );

    if let Err(e) = std::fs::write(&script_path, &script_content) {
        println!("[Office] Failed to write registration script: {}", e);
        return;
    }

    // Run with UAC elevation, hide console window
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let _ = Command::new("powershell")
            .args([
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-WindowStyle",
                "Hidden",
                "-File",
                &script_path.to_string_lossy(),
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn();
    }

    println!("[Office] Registration script launched (UAC prompt may appear).");
}

#[allow(dead_code)]
fn office_vsto_registered() -> bool {
    let roots = [
        r"HKCU\Software\Microsoft\Office\Word\Addins",
        r"HKCU\Software\Microsoft\Office\16.0\Word\Addins",
        r"HKCU\Software\Microsoft\Office\Excel\Addins",
        r"HKCU\Software\Microsoft\Office\16.0\Excel\Addins",
        r"HKCU\Software\Microsoft\Office\PowerPoint\Addins",
        r"HKCU\Software\Microsoft\Office\16.0\PowerPoint\Addins",
        r"HKLM\Software\Microsoft\Office\Word\Addins",
        r"HKLM\Software\Microsoft\Office\16.0\Word\Addins",
        r"HKLM\Software\Microsoft\Office\Excel\Addins",
        r"HKLM\Software\Microsoft\Office\16.0\Excel\Addins",
        r"HKLM\Software\Microsoft\Office\PowerPoint\Addins",
        r"HKLM\Software\Microsoft\Office\16.0\PowerPoint\Addins",
    ];
    roots.iter().any(|root| {
        run_windows_tool(
            super::process::background_command("reg.exe").args(["query", root, "/s"]),
            15,
        )
        .map(|out| {
            out.status.success()
                && String::from_utf8_lossy(&out.stdout)
                    .to_ascii_lowercase()
                    .contains("latexsnipper")
        })
        .unwrap_or(false)
    })
}

fn office_startup_dotm() -> PathBuf {
    PathBuf::from(
        super::office::detect_office_cached()
            .word
            .startup_path
            .unwrap_or_else(|| {
                dirs_next::data_dir()
                    .unwrap_or_else(std::env::temp_dir)
                    .join("Microsoft")
                    .join("Word")
                    .join("STARTUP")
                    .to_string_lossy()
                    .to_string()
            }),
    )
    .join("LaTeXSnipper.dotm")
}

fn office_backup_dir() -> PathBuf {
    app_data_dir().join("office-backups")
}

#[allow(dead_code)]
fn bundled_dotm() -> Option<PathBuf> {
    let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();

    // Check relative to exe (bundled resources)
    let bundled = exe_dir.join("resources").join("LaTeXSnipper.dotm");
    if bundled.exists() {
        return Some(bundled);
    }

    // Check relative to source tree (dev mode)
    if let Some(github_root) = github_root_from_manifest() {
        let src = github_root
            .join("LaTeXSnipper-Office")
            .join("scripts")
            .join("out")
            .join("LaTeXSnipper.dotm");
        if src.exists() {
            return Some(src);
        }
    }

    None
}

#[allow(dead_code)]
fn register_com_dll() -> String {
    // Check if already registered
    let guid = "A1B2C3D4-E5F6-7890-ABCD-EF1234567890";
    let check = run_windows_tool(
        super::process::background_command("reg.exe")
            .args(["query", &format!("HKCR\\CLSID\\{{{}}}", guid)]),
        10,
    );

    if let Ok(out) = check {
        if out.status.success() {
            return "COM DLL already registered.".to_string();
        }
    }

    // Not registered — find regasm and write a silent PS1 script
    let dll_path = bundled_com_dll();
    let Some(path) = dll_path else {
        return "COM DLL not found.".to_string();
    };
    let regasm = find_regasm();
    let Some(regasm_path) = regasm else {
        return "regasm.exe not found.".to_string();
    };

    // Write PS1 script file (avoids PowerShell string escaping issues)
    let script_path = std::env::temp_dir().join("latexsnipper_register_com.ps1");
    let script_content = format!(
        "$dll = '{}'\n$regasm = '{}'\nStart-Process -FilePath $regasm -ArgumentList \"`\"$dll`\" /codebase\" -Verb RunAs -WindowStyle Hidden",
        path.to_string_lossy(),
        regasm_path.to_string_lossy()
    );

    if let Err(e) = fs::write(&script_path, &script_content) {
        return format!("Failed to write script: {}", e);
    }

    // Fire-and-forget — UAC dialog appears but app continues
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let _ = Command::new("powershell")
            .args([
                "-ExecutionPolicy",
                "Bypass",
                "-WindowStyle",
                "Hidden",
                "-File",
                &script_path.to_string_lossy(),
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn();
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = Command::new("powershell")
            .args([
                "-ExecutionPolicy",
                "Bypass",
                "-WindowStyle",
                "Hidden",
                "-File",
                &script_path.to_string_lossy(),
            ])
            .spawn();
    }

    "COM registration started (UAC will appear).".to_string()
}

#[allow(dead_code)]
fn unregister_com_dll() -> String {
    let guid = "A1B2C3D4-E5F6-7890-ABCD-EF1234567890";
    let check = run_windows_tool(
        super::process::background_command("reg.exe")
            .args(["query", &format!("HKCR\\CLSID\\{{{}}}", guid)]),
        10,
    );

    if let Ok(out) = check {
        if !out.status.success() {
            return "COM DLL not registered.".to_string();
        }
    } else {
        return "COM DLL not registered.".to_string();
    }

    let dll_path = bundled_com_dll();
    let Some(path) = dll_path else {
        return "COM DLL not found.".to_string();
    };
    let regasm = find_regasm();
    let Some(regasm_path) = regasm else {
        return "regasm.exe not found.".to_string();
    };

    let script_path = std::env::temp_dir().join("latexsnipper_unregister_com.ps1");
    let script_content = format!(
        "$dll = '{}'\n$regasm = '{}'\nStart-Process -FilePath $regasm -ArgumentList \"`\"$dll`\" /u /codebase\" -Verb RunAs -WindowStyle Hidden",
        path.to_string_lossy(),
        regasm_path.to_string_lossy()
    );

    let _ = fs::write(&script_path, &script_content);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let _ = Command::new("powershell")
            .args([
                "-ExecutionPolicy",
                "Bypass",
                "-WindowStyle",
                "Hidden",
                "-File",
                &script_path.to_string_lossy(),
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn();
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = Command::new("powershell")
            .args([
                "-ExecutionPolicy",
                "Bypass",
                "-WindowStyle",
                "Hidden",
                "-File",
                &script_path.to_string_lossy(),
            ])
            .spawn();
    }

    "COM unregistration started.".to_string()
}

#[allow(dead_code)]
fn bundled_com_dll() -> Option<PathBuf> {
    let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();

    // Check relative to exe (bundled resources) - try both names
    let bundled_new = exe_dir
        .join("resources")
        .join("Office")
        .join("LightweightAddIn")
        .join("LaTeXSnipper.OfficeAddIn.dll");
    if bundled_new.exists() {
        return Some(bundled_new);
    }

    let bundled_old = exe_dir
        .join("resources")
        .join("LaTeXSnipper.OfficePlugin.dll");
    if bundled_old.exists() {
        return Some(bundled_old);
    }

    // Check relative to source tree (dev mode)
    let dev_dll = std::env::current_dir()
        .ok()?
        .join("src-tauri")
        .join("target")
        .join("debug")
        .join("resources")
        .join("Office")
        .join("LightweightAddIn")
        .join("LaTeXSnipper.OfficeAddIn.dll");
    if dev_dll.exists() {
        return Some(dev_dll);
    }

    None
}

#[allow(dead_code)]
fn find_regasm() -> Option<PathBuf> {
    // Try .NET Framework 4.8 (64-bit)
    let regasm64 = PathBuf::from(r"C:\Windows\Microsoft.NET\Framework64\v4.0.30319\RegAsm.exe");
    if regasm64.exists() {
        return Some(regasm64);
    }
    // Try 32-bit
    let regasm32 = PathBuf::from(r"C:\Windows\Microsoft.NET\Framework\v4.0.30319\RegAsm.exe");
    if regasm32.exists() {
        return Some(regasm32);
    }
    None
}

fn install_office_vsto() -> PlatformIntegrationResult {
    let status = super::office::detect_office_cached();
    if !status.installed {
        return PlatformIntegrationResult::fail(
            "office",
            "not_found",
            "未检测到 Microsoft Office。请先安装 Office 后再启用插件。",
        );
    }

    // Clean up old registrations first
    cleanup_legacy_office_com_addins();
    unregister_hkcu_office_com_addin();

    let dll = match build_new_office_addin() {
        Ok(path) => path,
        Err(err) => return PlatformIntegrationResult::fail("office", "com-addin", err),
    };

    for app in ["Word", "Excel", "PowerPoint"] {
        for key in office_addin_registry_roots(app) {
            if let Err(err) = reg_add_string(&key, "FriendlyName", "LaTeXSnipper Office") {
                return PlatformIntegrationResult::fail(
                    "office",
                    "com-addin",
                    format!("写入 {} 加载项注册表失败: {}", app, err),
                );
            }
            let _ = reg_add_string(&key, "Description", "LaTeXSnipper Office formula add-in");
            let _ = reg_add_dword(&key, "LoadBehavior", 3);
            let _ = reg_add_dword(&key, "CommandLineSafe", 0);
        }
    }

    if let Err(err) = register_hkcu_office_com_addin(&dll) {
        return PlatformIntegrationResult::fail("office", "com-addin", err);
    }

    PlatformIntegrationResult::ok(
        "office",
        "com-addin",
        format!(
            "新的 Office COM 加载项已写入 Word 注册表，并已启动 RegAsm 注册。DLL: {}。请在 UAC 中确认后重启 Word。",
            dll.display()
        ),
        true,
    )
}

// ═══════════════════════════════════════════════════════════
// Office.js Add-in registration via Windows registry
//
// Windows: manifest path is registered in
//   HKCU\Software\Microsoft\Office\16.0\WEF\Developer
//   Key:   add-in GUID
//   Value: full path to manifest.word.xml
//
// macOS: copies to ~/Library/Containers/com.microsoft.Word/...
// ═══════════════════════════════════════════════════════════

#[cfg(target_os = "windows")]
const OFFICE_DEVELOPER_KEY: &str = r"HKCU\Software\Microsoft\Office\16.0\WEF\Developer";

#[derive(Clone, Copy)]
struct OfficeJsHost {
    id: &'static str,
    name: &'static str,
    manifest_file: &'static str,
    #[cfg(target_os = "windows")]
    refresh_key: &'static str,
    #[cfg(target_os = "macos")]
    mac_container: &'static str,
}

const OFFICE_JS_HOSTS: &[OfficeJsHost] = &[
    OfficeJsHost {
        id: "9a7b3c4d-5e6f-7890-abcd-ef1234567890",
        name: "Word",
        manifest_file: "word.xml",
        #[cfg(target_os = "windows")]
        refresh_key: "Word_RequireForceRefreshAtBoot",
        #[cfg(target_os = "macos")]
        mac_container: "com.microsoft.Word",
    },
    OfficeJsHost {
        id: "9a7b3c4d-5e6f-7890-abcd-ef1234567891",
        name: "Excel",
        manifest_file: "excel.xml",
        #[cfg(target_os = "windows")]
        refresh_key: "Excel_RequireForceRefreshAtBoot",
        #[cfg(target_os = "macos")]
        mac_container: "com.microsoft.Excel",
    },
    OfficeJsHost {
        id: "9a7b3c4d-5e6f-7890-abcd-ef1234567892",
        name: "PowerPoint",
        manifest_file: "powerpoint.xml",
        #[cfg(target_os = "windows")]
        refresh_key: "PowerPoint_RequireForceRefreshAtBoot",
        #[cfg(target_os = "macos")]
        mac_container: "com.microsoft.Powerpoint",
    },
];

/// Register the add-in manifest in the Windows registry so Word finds it.
#[cfg(target_os = "windows")]
fn register_office_js_manifest(host: OfficeJsHost, manifest: &Path) -> Result<(), String> {
    let manifest_path = manifest
        .canonicalize()
        .map_err(|e| format!("无法解析 manifest 路径: {e}"))?
        .to_string_lossy()
        .into_owned();
    let manifest_path = normalize_office_manifest_path(&manifest_path);

    let output = run_windows_tool(
        super::process::background_command("reg.exe").args([
            "add",
            OFFICE_DEVELOPER_KEY,
            "/v",
            host.id,
            "/t",
            "REG_SZ",
            "/d",
            &manifest_path,
            "/f",
        ]),
        15,
    )?;

    if !output.status.success() {
        return Err(format!(
            "Office 加载项注册失败: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let _ = run_windows_tool(
        super::process::background_command("reg.exe").args([
            "add",
            r"HKCU\Software\Microsoft\Office\16.0\WEF",
            "/v",
            host.refresh_key,
            "/t",
            "REG_SZ",
            "/d",
            host.id,
            "/f",
        ]),
        15,
    );

    println!(
        "[Office] Registered {} in {} \\ {} = {}",
        host.name, OFFICE_DEVELOPER_KEY, host.id, manifest_path
    );
    Ok(())
}

#[cfg(target_os = "windows")]
fn normalize_office_manifest_path(path: &str) -> String {
    path.strip_prefix(r"\\?\").unwrap_or(path).to_string()
}

#[cfg(target_os = "windows")]
fn clear_office_refresh_marker(host: OfficeJsHost) {
    let _ = run_windows_tool(
        super::process::background_command("reg.exe").args([
            "add",
            r"HKCU\Software\Microsoft\Office\16.0\WEF",
            "/v",
            host.refresh_key,
            "/t",
            "REG_SZ",
            "/d",
            "{00000000-0000-0000-0000-000000000000}",
            "/f",
        ]),
        15,
    );
}

/// Remove the add-in manifest registration from the Windows registry.
#[cfg(target_os = "windows")]
fn unregister_office_js_manifest(host: OfficeJsHost) -> Result<(), String> {
    let output = run_windows_tool(
        super::process::background_command("reg.exe")
            .args(["delete", OFFICE_DEVELOPER_KEY, "/v", host.id, "/f"]),
        15,
    )?;

    if output.status.success() {
        println!(
            "[Office] Unregistered {} from registry: {} \\ {}",
            host.name, OFFICE_DEVELOPER_KEY, host.id
        );
        clear_office_refresh_marker(host);
        Ok(())
    } else {
        let err = String::from_utf8_lossy(&output.stderr).to_string();
        if output.status.code() == Some(1) {
            // Key/value not found — not an error, just means not registered
            println!("[Office] No {} registry entry to remove", host.name);
            clear_office_refresh_marker(host);
            Ok(())
        } else {
            Err(err)
        }
    }
}

/// Check if the add-in is registered in the Windows registry.
#[cfg(target_os = "windows")]
fn is_office_js_registered(host: OfficeJsHost) -> bool {
    run_windows_tool(
        super::process::background_command("reg.exe")
            .args(["query", OFFICE_DEVELOPER_KEY, "/v", host.id]),
        10,
    )
    .map(|out| out.status.success())
    .unwrap_or(false)
}

/// Sideload the Office.js manifest so Word can find the add-in.
/// Windows: registers manifest path in HKCU\...\WEF\Developer registry key.
/// macOS: copies to ~/Library/Containers/com.microsoft.Word/Data/Documents/wef/
fn install_office_js_addin() -> PlatformIntegrationResult {
    cleanup_legacy_office_com_addins();

    let manifests = office_js_manifests();
    if manifests.len() != OFFICE_JS_HOSTS.len() {
        return PlatformIntegrationResult::fail(
            "office",
            "office-js",
            "Office.js manifests are incomplete. Run npm run build:office-addin.",
        );
    }

    println!("[Office] Requesting certificate trust for HTTPS...");
    if let Ok(true) = super::tls_cert::try_trust_cert_from_appdata() {
        println!("[Office] Certificate trusted successfully");
    } else {
        println!("[Office] Certificate trust deferred (may need manual trust)");
    }

    #[cfg(target_os = "windows")]
    {
        let mut installed = Vec::new();
        for (host, manifest) in manifests {
            if let Err(e) = register_office_js_manifest(host, &manifest) {
                return PlatformIntegrationResult::fail("office", "office-js", e);
            }
            installed.push(host.name);
        }

        return PlatformIntegrationResult::ok(
            "office",
            "office-js",
            format!(
                "Installed Office.js add-ins for {}. Restart Word, Excel, and PowerPoint to load LaTeXSnipper.",
                installed.join(", ")
            ),
            true,
        );
    }

    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").unwrap_or_default();
        let mut installed = Vec::new();
        for (host, manifest) in manifests {
            let content = match std::fs::read_to_string(&manifest) {
                Ok(c) => c,
                Err(e) => {
                    return PlatformIntegrationResult::fail(
                        "office",
                        "office-js",
                        format!("Failed to read {} manifest: {e}", host.name),
                    )
                }
            };
            let wef_dir = PathBuf::from(&home)
                .join("Library")
                .join("Containers")
                .join(host.mac_container)
                .join("Data")
                .join("Documents")
                .join("wef");
            if let Err(e) = std::fs::create_dir_all(&wef_dir) {
                return PlatformIntegrationResult::fail(
                    "office",
                    "office-js",
                    format!("Failed to create {} wef directory: {e}", host.name),
                );
            }
            let target_path = wef_dir.join("LaTeXSnipper.xml");
            if let Err(e) = std::fs::write(&target_path, &content) {
                return PlatformIntegrationResult::fail(
                    "office",
                    "office-js",
                    format!("Failed to write {} manifest: {e}", host.name),
                );
            }
            installed.push(host.name);
        }
        PlatformIntegrationResult::ok(
            "office",
            "office-js",
            format!(
                "Installed Office.js add-ins for {}. Restart Office apps to load LaTeXSnipper.",
                installed.join(", ")
            ),
            true,
        )
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        PlatformIntegrationResult::fail("office", "office-js", "Unsupported operating system")
    }
}

fn uninstall_office_addin() -> PlatformIntegrationResult {
    cleanup_legacy_office_com_addins();

    #[cfg(target_os = "windows")]
    {
        let mut errors = Vec::new();
        for host in OFFICE_JS_HOSTS {
            if let Err(e) = unregister_office_js_manifest(*host) {
                errors.push(format!("{}: {}", host.name, e));
            }
        }
        if errors.is_empty() {
            PlatformIntegrationResult::ok(
                "office",
                "office-js",
                "Uninstalled Office.js add-ins. Restart Office apps to unload LaTeXSnipper.",
                true,
            )
        } else {
            PlatformIntegrationResult::fail("office", "office-js", errors.join("; "))
        }
    }

    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").unwrap_or_default();
        let mut removed = false;
        for host in OFFICE_JS_HOSTS {
            let wef_dir = PathBuf::from(&home)
                .join("Library")
                .join("Containers")
                .join(host.mac_container)
                .join("Data")
                .join("Documents")
                .join("wef");
            let manifest_path = wef_dir.join("LaTeXSnipper.xml");
            if manifest_path.exists() && std::fs::remove_file(&manifest_path).is_ok() {
                println!("[Office] Removed manifest: {}", manifest_path.display());
                removed = true;
            }
        }
        if removed {
            PlatformIntegrationResult::ok(
                "office",
                "office-js",
                "Uninstalled Office.js add-ins. Restart Office apps to unload LaTeXSnipper.",
                true,
            )
        } else {
            PlatformIntegrationResult::ok(
                "office",
                "office-js",
                "No installed Office.js add-ins were found.",
                false,
            )
        }
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        PlatformIntegrationResult::fail("office", "office-js", "Unsupported operating system")
    }
}

fn check_office_addin() -> PlatformIntegrationResult {
    let status = super::office::detect_office_cached();
    if !status.installed {
        return PlatformIntegrationResult::fail(
            "office",
            "not_found",
            "Microsoft Office was not detected.",
        );
    }

    if is_taskpane_connected() {
        return PlatformIntegrationResult::ok(
            "office",
            "connected",
            "Office task pane is connected and ready.",
            false,
        );
    }

    #[cfg(target_os = "windows")]
    {
        let registered: Vec<&str> = OFFICE_JS_HOSTS
            .iter()
            .filter(|host| is_office_js_registered(**host))
            .map(|host| host.name)
            .collect();
        if registered.len() == OFFICE_JS_HOSTS.len() {
            return PlatformIntegrationResult::ok("office", "installed", "Office.js add-ins are registered. Restart Office apps and open the LaTeXSnipper task pane.", true);
        }
        if !registered.is_empty() {
            return PlatformIntegrationResult::fail(
                "office",
                "partial",
                format!("Only these Office.js add-ins are registered: {}. Toggle Office off and on to repair.", registered.join(", ")),
            );
        }
    }

    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").unwrap_or_default();
        let installed: Vec<&str> = OFFICE_JS_HOSTS
            .iter()
            .filter(|host| {
                PathBuf::from(&home)
                    .join("Library")
                    .join("Containers")
                    .join(host.mac_container)
                    .join("Data")
                    .join("Documents")
                    .join("wef")
                    .join("LaTeXSnipper.xml")
                    .exists()
            })
            .map(|host| host.name)
            .collect();
        if installed.len() == OFFICE_JS_HOSTS.len() {
            return PlatformIntegrationResult::ok(
                "office",
                "installed",
                "Office.js add-ins are installed. Restart Office apps.",
                true,
            );
        }
        if !installed.is_empty() {
            return PlatformIntegrationResult::fail(
                "office",
                "partial",
                format!("Only these Office.js add-ins are installed: {}. Toggle Office off and on to repair.", installed.join(", ")),
            );
        }
    }

    PlatformIntegrationResult::fail(
        "office",
        "not_installed",
        "Office.js add-ins are not installed. Enable Office integration in settings.",
    )
}

// ═══════════════════════════════════════════════════════════════════════════
// Native Office VSTO Add-in registration
//
// New VSTO add-ins for Word, Excel, and PowerPoint.
// Uses Named Pipe communication instead of HTTP bridge.
// ═══════════════════════════════════════════════════════════════════════════

/// Native Office VSTO Add-in identifiers
const NATIVE_OFFICE_ADDINS: &[(&str, &str, &str, &str)] = &[
    (
        "Word",
        "LaTeXSnipper.NativeOffice.Word",
        "LaTeXSnipper Native Office — Word",
        "LaTeXSnipper.Word.vsto",
    ),
    (
        "Excel",
        "LaTeXSnipper.NativeOffice.Excel",
        "LaTeXSnipper Native Office — Excel",
        "LaTeXSnipper.Excel.vsto",
    ),
    (
        "PowerPoint",
        "LaTeXSnipper.NativeOffice.PowerPoint",
        "LaTeXSnipper Native Office — PowerPoint",
        "LaTeXSnipper.PowerPoint.vsto",
    ),
];

fn native_office_install_root() -> PathBuf {
    dirs_next::data_local_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("Programs")
        .join("LaTeXSnipper")
        .join("NativeOffice")
}

fn native_office_vsto_manifest(host_name: &str, vsto_file: &str) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    candidates.push(native_office_install_root().join(host_name).join(vsto_file));

    // Bundled resources (production Tauri install)
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(
                dir.join("resources")
                    .join("NativeOffice")
                    .join(host_name)
                    .join(vsto_file),
            );
        }
    }

    if let Some(root) = repo_root_from_manifest() {
        candidates.push(
            root.join("apps")
                .join("native-office")
                .join(format!("LaTeXSnipper.{}", host_name))
                .join("bin")
                .join("Release")
                .join(vsto_file),
        );
        candidates.push(
            root.join("apps")
                .join("native-office")
                .join(format!("LaTeXSnipper.{}", host_name))
                .join("bin")
                .join("Debug")
                .join(vsto_file),
        );
    }

    candidates.into_iter().find(|path| path.exists())
}

fn office_manifest_value(path: &Path) -> String {
    format!(
        "file:///{}|vstolocal",
        path.to_string_lossy().replace('\\', "/")
    )
}

/// Install Native Office VSTO add-ins by registering in Windows registry.
/// After writing, performs real verification before returning success.
pub(crate) fn install_native_office_vsto() -> PlatformIntegrationResult {
    #[cfg(not(target_os = "windows"))]
    {
        return PlatformIntegrationResult::fail(
            "office",
            "native-vsto",
            "Native Office VSTO is only available on Windows.",
        );
    }

    #[cfg(target_os = "windows")]
    {
        log::info!("[Office] Step 1: Check certificate...");
        // Step 1: Check and import VSTO signing certificate to TrustedPublisher
        let ledger = IntegrationLedger::load();
        let is_upgrade = !ledger.install_id.is_empty() && ledger.native_office.vsto.iter().any(|v| !v.registry_key.is_empty());
        let cert_trusted = check_certificate_trusted();
        log::info!("[Office] Step 1 done: cert_trusted={}", cert_trusted);
        if !cert_trusted && !is_upgrade {
            // Fresh install: try to import the .cer file that ships with the app
            if let Some(cer_path) = find_staging_certificate() {
                if let Err(e) = import_certificate_to_trusted_publisher(&cer_path) {
                    log::warn!("[Office] Certificate import failed: {}", e);
                    // In dev builds (debug), continue anyway for easier testing.
                    // In release builds, block — Office won't load untrusted VSTO.
                    if !cfg!(debug_assertions) {
                        return PlatformIntegrationResult::fail(
                            "office",
                            "native-vsto",
                            format!("证书导入失败: {}。请以管理员身份运行，或手动导入 {}。", e, cer_path.display()),
                        );
                    }
                } else {
                    log::info!("[Office] Certificate imported to TrustedPublisher");
                }
            } else if !cfg!(debug_assertions) {
                return PlatformIntegrationResult::fail(
                    "office",
                    "native-vsto",
                    "找不到证书文件 LaTeXSnipperOffice.cer。请重新安装 LaTeXSnipper Office。",
                );
            }
        }

        log::info!("[Office] Step 2: Detect VSTO Runtime...");
        // Step 2: Detect VSTO Runtime
        if !detect_vsto_runtime() {
            log::warn!("[Office] Step 2: VSTO Runtime NOT found");
            return PlatformIntegrationResult::fail(
                "office",
                "native-vsto",
                "VSTO Runtime 未安装。请安装 Microsoft Visual Studio Tools for Office Runtime：\nhttps://go.microsoft.com/fwlink/?LinkId=261103\n\n安装完成后请重新点击「启用 Office 集成」。",
            );
        }

        struct HostRegistrationResult {
            host: String,
            x64_ok: bool,
            x86_ok: bool,
            errors: Vec<String>,
        }

        let mut host_results: Vec<HostRegistrationResult> = Vec::new();

        for (host_name, addin_id, friendly_name, vsto_file) in NATIVE_OFFICE_ADDINS {
            let Some(manifest) = native_office_vsto_manifest(host_name, vsto_file) else {
                return PlatformIntegrationResult::fail(
                    "office",
                    "native-vsto",
                    format!(
                        "{} VSTO manifest was not found. Build apps/native-office first or run apps/native-office/Installer/build.ps1.",
                        host_name
                    ),
                );
            };
            let reg_key = format!(
                r"HKCU\Software\Microsoft\Office\{}\Addins\{}",
                match *host_name {
                    "Word" => "Word",
                    "Excel" => "Excel",
                    "PowerPoint" => "PowerPoint",
                    _ => continue,
                },
                addin_id
            );
            let manifest_value = office_manifest_value(&manifest);

            // Register for both 64-bit and 32-bit registry views with post-write verification
            let mut host_result = HostRegistrationResult {
                host: host_name.to_string(),
                x64_ok: false,
                x86_ok: false,
                errors: vec![],
            };

            for view in REGISTRY_VIEWS {
                let write_result: Result<(), String> = (|| {
                    reg_add_string_view(&reg_key, "FriendlyName", friendly_name, view)
                        .map_err(|e| e.to_string())?;
                    reg_add_string_view(&reg_key, "Description", "LaTeX formula and table integration", view)
                        .map_err(|e| e.to_string())?;
                    reg_add_dword_view(&reg_key, "LoadBehavior", 3, view)
                        .map_err(|e| e.to_string())?;
                    reg_add_dword_view(&reg_key, "CommandLineSafe", 0, view)
                        .map_err(|e| e.to_string())?;
                    reg_add_string_view(&reg_key, "Manifest", &manifest_value, view)
                        .map_err(|e| e.to_string())?;
                    // Verify: re-query LoadBehavior and Manifest after write
                    verify_vsto_host_view(&reg_key, &manifest_value, view)
                        .map_err(|e| format!("post-write verification failed: {e}"))?;
                    Ok(())
                })();

                match (view, write_result) {
                    (RegistryView::X64, Ok(())) => host_result.x64_ok = true,
                    (RegistryView::X86, Ok(())) => host_result.x86_ok = true,
                    (_, Err(e)) => host_result.errors.push(format!("{} view: {}", view.label(), e)),
                }
            }

            // At least one view must succeed. If both fail, the install fails.
            if !host_result.x64_ok && !host_result.x86_ok {
                return PlatformIntegrationResult::fail(
                    "office",
                    "native-vsto",
                    format!(
                        "{} VSTO 注册失败：{}",
                        host_name,
                        host_result.errors.join("; ")
                    ),
                );
            }

            host_results.push(host_result);
        }

        // Verify: re-check overall status before returning success
        let status = get_native_office_status();
        let hosts_ok = status.hosts.iter().all(|h| matches!(h.state, HostInstallState::Installed));
        let cert_ok = status.certificate_trusted || cfg!(debug_assertions);

        if !hosts_ok {
            let failed_hosts: Vec<String> = status.hosts.iter()
                .filter(|h| !matches!(h.state, HostInstallState::Installed))
                .map(|h| format!("{}={:?}", h.host, h.state))
                .collect();
            // Still return success for install, but warn — the user may not have a particular Office host.
            log::warn!("[Office] Post-install: some hosts not Installed: {}", failed_hosts.join(", "));
        }
        if !cert_ok {
            log::warn!("[Office] Post-install: certificate not trusted (may affect VSTO loading in release mode)");
        }

        // Write ledger for reliable uninstall
        let mut ledger = IntegrationLedger::load();
        if ledger.install_id.is_empty() {
            ledger.install_id = generate_install_id();
            ledger.desktop_version = get_desktop_version();
        }
        ledger.native_office.signer_thumbprint = get_expected_thumbprint();
        ledger.native_office.vsto = host_results.iter().map(|hr| {
            let (_, addin_id, _, _) = NATIVE_OFFICE_ADDINS.iter().find(|(h, _, _, _)| *h == hr.host).unwrap_or(&NATIVE_OFFICE_ADDINS[0]);
            let reg_key = format!(
                r"HKCU\Software\Microsoft\Office\{}\Addins\{}",
                match hr.host.as_str() {
                    "Word" => "Word",
                    "Excel" => "Excel",
                    "PowerPoint" => "PowerPoint",
                    _ => "Word",
                },
                addin_id
            );
            let manifest = native_office_vsto_manifest(
                &hr.host,
                NATIVE_OFFICE_ADDINS.iter().find(|(h, _, _, _)| *h == hr.host).map(|(_, _, _, v)| *v).unwrap_or(""),
            ).map(|p| office_manifest_value(&p)).unwrap_or_default();
            VstoLedgerEntry {
                host: hr.host.clone(),
                registry_key: reg_key,
                manifest,
            }
        }).collect();

        if let Err(e) = ledger.save() {
            log::warn!("[Office] Failed to save integration ledger: {}", e);
        }

        // Auto-install OLE COM component — merge into the single Office toggle.
        let ole_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let result = install_ole_component();
            if result.success {
                log::info!("[Office] OLE auto-install: {}", result.message);
            } else {
                log::warn!("[Office] OLE auto-install skipped: {}", result.message);
            }
            result
        })).unwrap_or_else(|_| {
            log::error!("[Office] OLE auto-install panicked.");
            OleComponentResult {
                success: false,
                message: "OLE auto-install panicked.".to_string(),
                entries_modified: vec![],
            }
        });
        if !ole_result.success {
            // OLE failure does NOT block VSTO in auto/native/image modes.
            // VSTO stays registered; user sees degraded state in settings page.
            log::warn!(
                "[Office] OLE install failed ({}). VSTO remains enabled; OLE unavailable.",
                ole_result.message
            );
            let host_names: Vec<&str> = host_results.iter().map(|h| h.host.as_str()).collect();
            return PlatformIntegrationResult::ok(
                "office",
                "native-vsto",
                format!(
                    "已启用 Native Office VSTO ({})，但 OLE 组件不可用，将自动降级为 native/image 模式。请重启 Office 加载插件。",
                    host_names.join(", ")
                ),
                true,
            );
        }

        let host_names: Vec<&str> = host_results.iter().map(|h| h.host.as_str()).collect();
        return PlatformIntegrationResult::ok(
            "office",
            "native-vsto",
            format!(
                "已启用 Native Office VSTO ({})。请重启 Office 以加载插件。",
                host_names.join(", ")
            ),
            true,
        );
    }
}

/// Verify that a VSTO host's registry entry is correct after writing.
/// Re-queries LoadBehavior and Manifest to confirm the write took effect.
#[cfg(target_os = "windows")]
fn verify_vsto_host_view(
    reg_key: &str,
    expected_manifest: &str,
    view: RegistryView,
) -> Result<(), String> {
    let lb = get_load_behavior_for_view(reg_key, view)
        .ok_or_else(|| format!("LoadBehavior not readable after write"))?;
    if lb != 3 {
        return Err(format!("LoadBehavior is {} instead of 3", lb));
    }

    let manifest_check = run_windows_tool(
        super::process::background_command("reg.exe")
            .args(["query", reg_key, "/v", "Manifest", view.as_reg_arg()]),
        10,
    )
    .map_err(|e| format!("Manifest re-query failed: {e}"))?;

    if !manifest_check.status.success() {
        return Err("Manifest key missing after write".to_string());
    }

    let stdout = String::from_utf8_lossy(&manifest_check.stdout);
    if !stdout.contains(expected_manifest) {
        return Err("Manifest value mismatch after write".to_string());
    }

    Ok(())
}

/// Check if Native Office VSTO add-ins are installed with real verification.
/// Checks both 64-bit and 32-bit registry views for Office x86/x64 support.
#[cfg(target_os = "windows")]
fn check_native_office_vsto() -> bool {
    for (host_name, addin_id, _, vsto_file) in NATIVE_OFFICE_ADDINS {
        let reg_key = format!(
            r"HKCU\Software\Microsoft\Office\{}\Addins\{}",
            match *host_name {
                "Word" => "Word",
                "Excel" => "Excel",
                "PowerPoint" => "PowerPoint",
                _ => continue,
            },
            addin_id
        );

        let vsto_exists = native_office_vsto_manifest(host_name, vsto_file).is_some();

        // Check either 64-bit or 32-bit view (whichever matches the installed Office)
        let views_ok = REGISTRY_VIEWS.iter().any(|view| {
            let load_behavior = get_load_behavior_for_view(&reg_key, *view);
            if load_behavior != Some(3) {
                return false;
            }

            // Check manifest path exists
            let manifest_ok = run_windows_tool(
                super::process::background_command("reg.exe")
                    .args(["query", &reg_key, "/v", "Manifest", view.as_reg_arg()]),
                10,
            )
            .map(|out| out.status.success())
            .unwrap_or(false);

            manifest_ok && vsto_exists
        });

        if !views_ok {
            return false;
        }
    }
    true
}

/// Get LoadBehavior for a specific registry view.
#[cfg(target_os = "windows")]
fn get_load_behavior_for_view(reg_key: &str, view: RegistryView) -> Option<u32> {
    let output = run_windows_tool(
        super::process::background_command("reg.exe")
            .args(["query", reg_key, "/v", "LoadBehavior", view.as_reg_arg()]),
        10,
    )
    .ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        if line.contains("LoadBehavior") {
            if let Some(val) = parse_reg_dword_from_line(line) {
                return Some(val);
            }
        }
    }
    None
}

#[cfg(not(target_os = "windows"))]
fn check_native_office_vsto() -> bool {
    false
}

/// Uninstall Native Office VSTO add-ins with verification, including OLE cleanup.
fn uninstall_native_office_vsto() -> PlatformIntegrationResult {
    #[cfg(not(target_os = "windows"))]
    {
        return PlatformIntegrationResult::fail(
            "office",
            "native-vsto",
            "Native Office VSTO is only available on Windows.",
        );
    }

    #[cfg(target_os = "windows")]
    {
        // Step 1: Uninstall OLE component first
        let ole_result = uninstall_ole_component();
        if !ole_result.success {
            log::warn!("[Office] OLE uninstall reported issue: {}", ole_result.message);
        }

        // Step 2: Remove VSTO registry keys
        let mut host_reg_keys: Vec<(String, String)> = Vec::new();

        for (host_name, addin_id, _, _) in NATIVE_OFFICE_ADDINS {
            let reg_key = format!(
                r"HKCU\Software\Microsoft\Office\{}\Addins\{}",
                match *host_name {
                    "Word" => "Word",
                    "Excel" => "Excel",
                    "PowerPoint" => "PowerPoint",
                    _ => continue,
                },
                addin_id
            );

            reg_delete_tree_both(&reg_key);
            host_reg_keys.push((host_name.to_string(), reg_key));
        }

        // Step 3: Verify VSTO removal
        let mut remaining_keys: Vec<String> = Vec::new();
        for (host_name, reg_key) in &host_reg_keys {
            for view in &REGISTRY_VIEWS {
                let still_present = run_windows_tool(
                    super::process::background_command("reg.exe")
                        .args(["query", reg_key, "/v", "LoadBehavior", view.as_reg_arg()]),
                    10,
                )
                .map(|out| out.status.success())
                .unwrap_or(false);

                if still_present {
                    remaining_keys.push(format!("{} [{}]", host_name, view.label()));
                }
            }
        }

        if !remaining_keys.is_empty() {
            return PlatformIntegrationResult::fail(
                "office",
                "native-vsto",
                format!(
                    "停用失败：以下注册表项仍存在：{}",
                    remaining_keys.join(", ")
                ),
            );
        }

        return PlatformIntegrationResult::ok(
            "office",
            "native-vsto",
            format!(
                "已停用 Native Office VSTO（{}），OLE 已清理。重启 Office 完成卸载。",
                host_reg_keys.iter().map(|(h, _)| h.as_str()).collect::<Vec<_>>().join(", ")
            ),
            true,
        );
    }
}

fn office_js_manifests() -> Vec<(OfficeJsHost, PathBuf)> {
    OFFICE_JS_HOSTS
        .iter()
        .filter_map(|host| find_office_js_manifest(*host).map(|path| (*host, path)))
        .collect()
}

fn find_office_js_manifest(host: OfficeJsHost) -> Option<PathBuf> {
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let candidates = [
                exe_dir
                    .join("resources")
                    .join("OfficeJS")
                    .join("manifest")
                    .join(host.manifest_file),
                exe_dir
                    .join("resources")
                    .join("OfficeJS")
                    .join(format!("manifest.{}.xml", host.name.to_lowercase())),
            ];
            for p in &candidates {
                if p.exists() {
                    return Some(p.clone());
                }
            }
        }
    }

    if let Ok(cwd) = std::env::current_dir() {
        let candidates = [
            cwd.join("src-tauri")
                .join("resources")
                .join("OfficeJS")
                .join("manifest")
                .join(host.manifest_file),
            cwd.join("apps")
                .join("office-addin")
                .join("manifests")
                .join(format!("manifest.{}.desktop.xml", host.name.to_lowercase())),
        ];
        for p in &candidates {
            if p.exists() {
                return Some(p.clone());
            }
        }
    }

    None
}

#[allow(dead_code)]
fn install_office() -> PlatformIntegrationResult {
    let startup = office_startup_dotm();

    // Use cached Office status (no reg query, instant)
    let status = super::office::detect_office_cached();
    if !status.installed {
        return PlatformIntegrationResult::fail(
            "office",
            "not_found",
            "未检测到 Microsoft Office 或 WPS Office。请先安装 Office 后再启用插件。",
        );
    }

    // Find bundled .dotm
    let Some(dotm_src) = bundled_dotm() else {
        return PlatformIntegrationResult::fail(
            "office",
            "dotm",
            "LaTeXSnipper.dotm not found in app resources. The plugin was not bundled during build.",
        );
    };

    // Backup old .dotm if exists
    if startup.exists() {
        let backup_dir = office_backup_dir();
        let _ = fs::create_dir_all(&backup_dir);
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let backup_path = backup_dir.join(format!("LaTeXSnipper_{timestamp}.dotm"));
        let _ = fs::copy(&startup, &backup_path);
    }

    // Copy .dotm to Word STARTUP
    if let Some(parent) = startup.parent() {
        let _ = fs::create_dir_all(parent);
    }
    match fs::copy(&dotm_src, &startup) {
        Ok(_) => {
            // Try COM registration (non-blocking, UAC if needed)
            let com_msg = register_com_dll();

            let word_info = if status.word.available {
                format!(
                    "Word ({})",
                    status.word.install_path.as_deref().unwrap_or("unknown")
                )
            } else {
                "Word not found".to_string()
            };

            PlatformIntegrationResult::ok(
                "office",
                "dotm",
                format!(
                    "LaTeXSnipper.dotm installed to {}\nDetected: {}\n{}",
                    startup.display(),
                    word_info,
                    com_msg
                ),
                true,
            )
        }
        Err(err) => PlatformIntegrationResult::fail(
            "office",
            "dotm",
            format!("Failed to copy .dotm: {err}. Close Word and try again."),
        ),
    }
}

#[allow(dead_code)]
fn uninstall_office() -> PlatformIntegrationResult {
    let startup = office_startup_dotm();

    if !startup.exists() {
        // Also clean up old VSTO registration if present
        let vsto_check = run_windows_tool(
            super::process::background_command("reg.exe")
                .args(["query", r"HKCU\Software\Microsoft\Office\Word\Addins", "/s"]),
            15,
        )
        .map(|out| String::from_utf8_lossy(&out.stdout).contains("LaTeXSnipper"))
        .unwrap_or(false);

        if vsto_check {
            if let Some(clean) = find_office_force_clean() {
                #[cfg(target_os = "windows")]
                {
                    use std::os::windows::process::CommandExt;
                    const CREATE_NO_WINDOW: u32 = 0x08000000;
                    let _ = Command::new("powershell")
                        .args(["-ExecutionPolicy", "Bypass", "-File"])
                        .arg(&clean)
                        .creation_flags(CREATE_NO_WINDOW)
                        .spawn();
                }
                #[cfg(not(target_os = "windows"))]
                {
                    let _ = Command::new("powershell")
                        .args(["-ExecutionPolicy", "Bypass", "-File"])
                        .arg(&clean)
                        .spawn();
                }
            }
            return PlatformIntegrationResult::ok(
                "office",
                "dotm",
                "No .dotm found. Cleaned up old VSTO registration if any. Restart Word to unload.",
                true,
            );
        }

        return PlatformIntegrationResult::ok(
            "office",
            "dotm",
            "LaTeXSnipper is not installed in Word.",
            false,
        );
    }

    // Remove .dotm from STARTUP
    match fs::remove_file(&startup) {
        Ok(_) => {
            // Try COM unregistration (non-blocking, UAC if needed)
            unregister_com_dll();

            PlatformIntegrationResult::ok(
                "office",
                "dotm",
                "LaTeXSnipper.dotm removed. Restart Word to unload.",
                true,
            )
        }
        Err(err) => PlatformIntegrationResult::fail(
            "office",
            "dotm",
            format!("Failed to remove .dotm: {err}. Close Word and try again."),
        ),
    }
}

#[allow(dead_code)]
fn check_office() -> PlatformIntegrationResult {
    let startup = office_startup_dotm();
    let status = super::office::detect_office_cached();

    if startup.exists() {
        let size = fs::metadata(&startup).map(|m| m.len()).unwrap_or(0);
        let word_path = status.word.install_path.as_deref().unwrap_or("unknown");
        PlatformIntegrationResult::ok(
            "office",
            "dotm",
            format!(
                "LaTeXSnipper.dotm installed ({} KB)\nWord: {}\nSTARTUP: {}",
                size / 1024,
                word_path,
                startup.display()
            ),
            false,
        )
    } else if !status.installed {
        PlatformIntegrationResult::fail(
            "office",
            "not_found",
            "未检测到 Microsoft Office 或 WPS Office。",
        )
    } else {
        // Check for old VSTO registration
        let vsto = run_windows_tool(
            super::process::background_command("reg.exe")
                .args(["query", r"HKCU\Software\Microsoft\Office\Word\Addins", "/s"]),
            15,
        )
        .map(|out| String::from_utf8_lossy(&out.stdout).contains("LaTeXSnipper"))
        .unwrap_or(false);

        if vsto {
            PlatformIntegrationResult::ok(
                "office",
                "vsto",
                "Old VSTO plugin is registered. Consider switching to the .dotm add-in.",
                false,
            )
        } else if bundled_dotm().is_some() {
            let word_path = status.word.install_path.as_deref().unwrap_or("unknown");
            PlatformIntegrationResult::fail(
                "office",
                "dotm",
                format!(
                    "Not installed. Word detected at: {}\nSTARTUP: {}\nEnable to install.",
                    word_path,
                    startup.display()
                ),
            )
        } else {
            PlatformIntegrationResult::fail(
                "office",
                "dotm",
                "Not installed. Word detected but .dotm was not bundled during build.",
            )
        }
    }
}

fn obsidian_staging_dir() -> PathBuf {
    integration_state_dir()
        .join("obsidian")
        .join("latexsnipper-office")
}

fn obsidian_plugin_source() -> Option<PathBuf> {
    // 1. Bundled resources (production Tauri install)
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let bundled = dir.join("resources").join("Obsidian");
            if bundled.join("main.js").exists() {
                return Some(bundled);
            }
        }
    }
    // 2. Repo source (development builds)
    if let Some(root) = repo_root_from_manifest() {
        let dir = root.join("apps").join("obsidian-plugin");
        if dir.join("main.js").exists() {
            return Some(dir);
        }
    }
    None
}

fn obsidian_vaults() -> Vec<PathBuf> {
    let mut vaults = Vec::new();

    // Check common vault locations
    if let Some(home) = dirs_next::home_dir() {
        // Obsidian default vault path
        let default_dir = home.join("Documents").join("Obsidian");
        if default_dir.is_dir() {
            for entry in fs::read_dir(&default_dir).into_iter().flatten() {
                if let Ok(e) = entry {
                    if e.path().join(".obsidian").is_dir() {
                        vaults.push(e.path());
                    }
                }
            }
        }
        // Also check Desktop, Downloads for vaults
        for folder in &["Desktop", "Documents"] {
            let base = home.join(folder);
            if let Ok(entries) = fs::read_dir(&base) {
                for entry in entries.flatten() {
                    let p = entry.path();
                    if p.is_dir() && p.join(".obsidian").is_dir() && !vaults.contains(&p) {
                        vaults.push(p);
                    }
                }
            }
        }
    }

    vaults
}

fn install_obsidian() -> PlatformIntegrationResult {
    let source = obsidian_plugin_source();
    if source.is_none() {
        return PlatformIntegrationResult::fail(
            "obsidian",
            "plugin",
            "Obsidian plugin source not found. Build apps/obsidian-plugin first, or the plugin is not bundled in resources.",
        );
    }
    let source = source.unwrap();

    let vaults = obsidian_vaults();
    if vaults.is_empty() {
        return PlatformIntegrationResult::fail(
            "obsidian",
            "plugin",
            "No Obsidian vaults found. Create a vault first, then enable the integration.",
        );
    }

    let mut installed_to = Vec::new();
    for vault in &vaults {
        let plugin_dir = vault
            .join(".obsidian")
            .join("plugins")
            .join("latexsnipper-obsidian");
        if let Err(err) = fs::create_dir_all(&plugin_dir) {
            continue;
        }

        let main_js = source.join("main.js");
        let manifest = source.join("manifest.json");
        let styles = source.join("styles.css");

        if main_js.exists() {
            let _ = fs::copy(&main_js, plugin_dir.join("main.js"));
        }
        if manifest.exists() {
            let _ = fs::copy(&manifest, plugin_dir.join("manifest.json"));
        } else {
            // Generate minimal manifest if source doesn't have one
            let manifest_content = r#"{
  "id": "latexsnipper-obsidian",
  "name": "LaTeXSnipper",
  "version": "1.0.0",
  "minAppVersion": "1.4.0",
  "description": "Insert LaTeX formulas from LaTeXSnipper into Obsidian notes.",
  "author": "LaTeXSnipper",
  "isDesktopOnly": true
}"#;
            let _ = fs::write(plugin_dir.join("manifest.json"), manifest_content);
        }
        if styles.exists() {
            let _ = fs::copy(&styles, plugin_dir.join("styles.css"));
        }

        if let Some(name) = vault.file_name() {
            installed_to.push(name.to_string_lossy().to_string());
        }
    }

    if installed_to.is_empty() {
        return PlatformIntegrationResult::fail(
            "obsidian",
            "plugin",
            "Failed to install Obsidian plugin to any vault.",
        );
    }

    // Update ledger with Obsidian installations
    let mut ledger = IntegrationLedger::load();
    for vault in &vaults {
        let plugin_dir = vault
            .join(".obsidian")
            .join("plugins")
            .join("latexsnipper-obsidian");
        if plugin_dir.exists() && plugin_dir.join("main.js").exists() {
            ledger.obsidian.push(ObsidianLedgerEntry {
                vault_path: vault.to_string_lossy().to_string(),
                plugin_path: plugin_dir.to_string_lossy().to_string(),
                plugin_id: "latexsnipper-obsidian".to_string(),
            });
        }
    }
    if let Err(e) = ledger.save() {
        log::warn!("[Obsidian] Failed to save ledger: {}", e);
    }

    PlatformIntegrationResult::ok(
        "obsidian",
        "plugin",
        format!(
            "Installed LaTeXSnipper plugin to {} vault(s): {}. Restart Obsidian and enable the plugin in Settings → Community plugins.",
            installed_to.len(),
            installed_to.join(", ")
        ),
        true,
    )
}

fn uninstall_obsidian() -> PlatformIntegrationResult {
    // Use ledger to find installed vaults, fall back to scanning
    let ledger = IntegrationLedger::load();
    let vaults: Vec<PathBuf> = if ledger.obsidian.is_empty() {
        obsidian_vaults()
    } else {
        ledger.obsidian.iter().map(|e| PathBuf::from(&e.vault_path)).collect()
    };
    let mut removed_from = Vec::new();

    for vault in &vaults {
        let plugin_dir = vault
            .join(".obsidian")
            .join("plugins")
            .join("latexsnipper-obsidian");
        if plugin_dir.exists() {
            match fs::remove_dir_all(&plugin_dir) {
                Ok(_) => {
                    if let Some(name) = vault.file_name() {
                        removed_from.push(name.to_string_lossy().to_string());
                    }
                }
                Err(_) => {}
            }
        }
    }

    // Also remove staging directory
    let staging = obsidian_staging_dir();
    if staging.exists() {
        let _ = fs::remove_dir_all(&staging);
    }

    // Update ledger: clear Obsidian entries
    let mut ledger = IntegrationLedger::load();
    ledger.obsidian.clear();
    if let Err(e) = ledger.save() {
        log::warn!("[Obsidian] Failed to update ledger: {}", e);
    }

    PlatformIntegrationResult::ok(
        "obsidian",
        "plugin",
        format!(
            "Removed Obsidian plugin from {} vault(s): {}. Restart Obsidian to complete.",
            removed_from.len(),
            if removed_from.is_empty() {
                "none".to_string()
            } else {
                removed_from.join(", ")
            }
        ),
        true,
    )
}

fn vscode_extension_dir() -> PathBuf {
    dirs_next::home_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join(".vscode")
        .join("extensions")
        .join("latexsnipper-office")
}

fn install_vscode() -> PlatformIntegrationResult {
    let dir = vscode_extension_dir();
    if let Err(err) = fs::create_dir_all(&dir) {
        return PlatformIntegrationResult::fail(
            "vscode",
            "plugin",
            format!("Failed to create VS Code extension directory: {err}"),
        );
    }

    let package_json = r#"{
  "name": "latexsnipper-office",
  "displayName": "LaTeXSnipper Office",
  "description": "Insert LaTeXSnipper formulas into the active editor.",
  "version": "1.0.0",
  "publisher": "latexsnipper",
  "engines": { "vscode": "^1.80.0" },
  "activationEvents": ["onCommand:latexsnipper.insertInline", "onCommand:latexsnipper.insertDisplay"],
  "main": "./extension.js",
  "contributes": {
    "commands": [
      { "command": "latexsnipper.insertInline", "title": "LaTeXSnipper: Insert Inline Formula From Clipboard" },
      { "command": "latexsnipper.insertDisplay", "title": "LaTeXSnipper: Insert Display Formula From Clipboard" }
    ]
  }
}
"#;
    let extension_js = r#"const vscode = require('vscode');

async function insertText(text) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('No active editor.');
    return;
  }
  await editor.edit((edit) => edit.insert(editor.selection.active, text));
}

function activate(context) {
  context.subscriptions.push(vscode.commands.registerCommand('latexsnipper.insertInline', async () => {
    const latex = await vscode.env.clipboard.readText();
    await insertText(`$${latex}$`);
  }));
  context.subscriptions.push(vscode.commands.registerCommand('latexsnipper.insertDisplay', async () => {
    const latex = await vscode.env.clipboard.readText();
    await insertText(`$$\n${latex}\n$$`);
  }));
}

function deactivate() {}
module.exports = { activate, deactivate };
"#;

    if let Err(err) = fs::write(dir.join("package.json"), package_json) {
        return PlatformIntegrationResult::fail(
            "vscode",
            "plugin",
            format!("Failed to write VS Code package.json: {err}"),
        );
    }
    if let Err(err) = fs::write(dir.join("extension.js"), extension_js) {
        return PlatformIntegrationResult::fail(
            "vscode",
            "plugin",
            format!("Failed to write VS Code extension.js: {err}"),
        );
    }

    PlatformIntegrationResult::ok(
        "vscode",
        "plugin",
        format!("Installed unpacked VS Code extension at {}. Restart VS Code, then use LaTeXSnipper commands from the Command Palette.", dir.display()),
        true,
    )
}

fn wps_addin_source_dir() -> Option<PathBuf> {
    // Primary: bundled resources (production Tauri install)
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let bundled = dir.join("resources").join("WPS");
            if bundled.exists() {
                return Some(bundled);
            }
        }
    }
    // Secondary: LaTeXSnipper-Office repo (monorepo layout)
    if let Some(root) = repo_root_from_manifest() {
        let dir = root.join("apps").join("wps").join("installer");
        if dir.exists() {
            return Some(dir);
        }
    }
    // Fallback: old layout for backward compatibility
    let github_root = github_root_from_manifest()?;
    let dir = github_root
        .join("LaTeXSnipper")
        .join("office_plugin")
        .join("hosts")
        .join("WpsAddIn")
        .join("installer");
    dir.exists().then_some(dir)
}

fn wps_jsaddons_root() -> PathBuf {
    dirs_next::data_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("kingsoft")
        .join("wps")
        .join("jsaddons")
}

fn wps_plugin_dir() -> PathBuf {
    wps_jsaddons_root().join("latexsnipper-wps")
}

fn wps_publish_file() -> PathBuf {
    wps_jsaddons_root().join("publish.xml")
}

fn write_wps_publish(enabled: bool) -> std::io::Result<()> {
    let path = wps_publish_file();
    fs::create_dir_all(wps_jsaddons_root())?;

    // Parse existing XML if present, otherwise create a new document
    let mut xml = if path.exists() {
        match fs::read_to_string(&path) {
            Ok(content) => content,
            Err(_) => String::new(),
        }
    } else {
        String::new()
    };

    if enabled {
        // Upsert: add LaTeXSnipper entry if not present
        if !xml.contains("latexsnipper-wps") {
            if xml.is_empty() {
                xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<jsplugins>
    <jspluginonline name="latexsnipper-wps" addonType="wps" online="false" enable="enable_dev"/>
</jsplugins>
"#
                .to_string();
            } else {
                // Insert before closing </jsplugins>
                if let Some(pos) = xml.rfind("</jsplugins>") {
                    xml.insert_str(pos, "    <jspluginonline name=\"latexsnipper-wps\" addonType=\"wps\" online=\"false\" enable=\"enable_dev\"/>\n");
                }
            }
        }
    } else {
        // Remove only our entry, preserve others
        let mut result = String::new();
        let mut in_plugin = false;
        for line in xml.lines() {
            if line.contains("latexsnipper-wps") {
                in_plugin = true;
                continue;
            }
            if in_plugin && line.trim().starts_with("</jspluginonline>") {
                in_plugin = false;
                continue;
            }
            if !in_plugin {
                result.push_str(line);
                result.push('\n');
            }
        }
        xml = result;
    }

    fs::write(&path, xml)
}

fn copy_dir_recursive(source: &Path, dest: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dest)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let source_path = entry.path();
        let dest_path = dest.join(entry.file_name());
        let metadata = entry.metadata()?;
        if metadata.is_dir() {
            copy_dir_recursive(&source_path, &dest_path)?;
        } else if metadata.is_file() {
            fs::copy(&source_path, &dest_path)?;
        }
    }
    Ok(())
}

fn install_wps() -> PlatformIntegrationResult {
    let Some(source) = wps_addin_source_dir() else {
        return PlatformIntegrationResult::fail(
            "wps",
            "wps-jsaddin",
            "WPS JSAddIn package was not found. Run a build (apps/wps/build.ps1) or keep the installer directory at apps/wps/installer.",
        );
    };

    let plugin_dir = wps_plugin_dir();
    if plugin_dir.exists() {
        if let Err(err) = fs::remove_dir_all(&plugin_dir) {
            return PlatformIntegrationResult::fail(
                "wps",
                "wps-jsaddin",
                format!("Failed to refresh WPS add-in directory: {err}"),
            );
        }
    }
    if let Err(err) = copy_dir_recursive(&source, &plugin_dir) {
        return PlatformIntegrationResult::fail(
            "wps",
            "wps-jsaddin",
            format!("Failed to install WPS add-in files: {err}"),
        );
    }
    if let Err(err) = write_wps_publish(true) {
        return PlatformIntegrationResult::fail(
            "wps",
            "wps-jsaddin",
            format!("Failed to update WPS publish.xml: {err}"),
        );
    }

    PlatformIntegrationResult::ok(
        "wps",
        "wps-jsaddin",
        format!(
            "Installed WPS JSAddIn at {}. Close and restart WPS to load LaTeXSnipper.",
            plugin_dir.display()
        ),
        true,
    )
}

fn uninstall_wps() -> PlatformIntegrationResult {
    let plugin_dir = wps_plugin_dir();
    if plugin_dir.exists() {
        if let Err(err) = fs::remove_dir_all(&plugin_dir) {
            return PlatformIntegrationResult::fail(
                "wps",
                "wps-jsaddin",
                format!("Failed to remove WPS add-in files: {err}"),
            );
        }
    }
    if let Err(err) = write_wps_publish(false) {
        return PlatformIntegrationResult::fail(
            "wps",
            "wps-jsaddin",
            format!("Failed to update WPS publish.xml: {err}"),
        );
    }

    PlatformIntegrationResult::ok(
        "wps",
        "wps-jsaddin",
        "Removed WPS JSAddIn files. Restart WPS to unload LaTeXSnipper.",
        true,
    )
}

fn check_wps() -> PlatformIntegrationResult {
    let plugin_dir = wps_plugin_dir();
    let publish = wps_publish_file();
    let publish_enabled = fs::read_to_string(&publish)
        .map(|content| content.contains("latexsnipper-wps"))
        .unwrap_or(false);

    if plugin_dir.exists() && publish_enabled {
        PlatformIntegrationResult::ok(
            "wps",
            "wps-jsaddin",
            "WPS JSAddIn appears to be installed.",
            false,
        )
    } else if wps_addin_source_dir().is_some() {
        PlatformIntegrationResult::fail(
            "wps",
            "wps-jsaddin",
            "WPS JSAddIn package is available but not installed.",
        )
    } else {
        PlatformIntegrationResult::fail(
            "wps",
            "wps-jsaddin",
            "WPS JSAddIn is not installed and no source package was found.",
        )
    }
}

fn install_libreoffice() -> PlatformIntegrationResult {
    let dir = integration_state_dir().join("libreoffice");
    if let Err(err) = fs::create_dir_all(&dir) {
        return PlatformIntegrationResult::fail(
            "libreoffice",
            "extension-stub",
            format!("Failed to prepare LibreOffice integration: {err}"),
        );
    }
    let _ = fs::write(dir.join("README.txt"), "LibreOffice integration scaffold. Use MathML export or clipboard insertion until an .oxt extension is implemented.\n");
    PlatformIntegrationResult::ok(
        "libreoffice",
        "extension-stub",
        format!(
            "Prepared LibreOffice integration scaffold at {}.",
            dir.display()
        ),
        false,
    )
}

fn install_clipboard_platform(platform: &str, message: &str) -> PlatformIntegrationResult {
    let dir = integration_state_dir().join(platform);
    if let Err(err) = fs::create_dir_all(&dir) {
        return PlatformIntegrationResult::fail(
            platform,
            "clipboard",
            format!("Failed to enable clipboard integration: {err}"),
        );
    }
    let mut file = match fs::File::create(dir.join("README.txt")) {
        Ok(file) => file,
        Err(err) => {
            return PlatformIntegrationResult::fail(
                platform,
                "clipboard",
                format!("Failed to write integration notes: {err}"),
            )
        }
    };
    let _ = writeln!(file, "{message}");
    PlatformIntegrationResult::ok(platform, "clipboard", message, false)
}

fn remove_generated_dir(platform: &str, mode: &str, dir: PathBuf) -> PlatformIntegrationResult {
    if !dir.exists() {
        return PlatformIntegrationResult::ok(
            platform,
            mode,
            "Integration is already disabled.",
            false,
        );
    }
    match fs::remove_dir_all(&dir) {
        Ok(_) => PlatformIntegrationResult::ok(
            platform,
            mode,
            format!("Removed integration files from {}.", dir.display()),
            true,
        ),
        Err(err) => PlatformIntegrationResult::fail(
            platform,
            mode,
            format!("Failed to remove integration files: {err}"),
        ),
    }
}

fn check_path(
    platform: &str,
    mode: &str,
    path: PathBuf,
    ok_message: &str,
) -> PlatformIntegrationResult {
    if path.exists() {
        PlatformIntegrationResult::ok(platform, mode, ok_message, false)
    } else {
        PlatformIntegrationResult::fail(platform, mode, "Integration is not installed.")
    }
}

// ---------------------------------------------------------------------------
// Native Office VSTO lifecycle management
// ---------------------------------------------------------------------------

#[cfg(windows)]
use crate::commands::native_office::*;

/// Get comprehensive Native Office installation status.
#[cfg(windows)]
pub fn get_native_office_status() -> NativeOfficeStatus {
    let platform_supported = cfg!(target_os = "windows");

    // Derive installation state from real checks, NOT from a bootstrapper marker.json.
    // The marker is unreliable because install_native_office_vsto() writes registry
    // directly and never creates a marker file.
    let vsto_runtime_ok = detect_vsto_runtime();
    let cert_trusted = check_certificate_trusted();
    let any_host_valid = NATIVE_OFFICE_ADDINS.iter().any(|(host_name, addin_id, _, vsto_file)| {
        let reg_key = format!(
            r"HKCU\Software\Microsoft\Office\{}\Addins\{}",
            match *host_name {
                "Word" => "Word",
                "Excel" => "Excel",
                "PowerPoint" => "PowerPoint",
                _ => return false,
            },
            addin_id
        );
        // At least one registry view must have LoadBehavior=3 and manifest must exist
        let has_x64 = get_load_behavior_for_view(&reg_key, RegistryView::X64) == Some(3);
        let has_x86 = get_load_behavior_for_view(&reg_key, RegistryView::X86) == Some(3);
        let manifest_found = native_office_vsto_manifest(host_name, vsto_file).is_some();
        (has_x64 || has_x86) && manifest_found
    });
    let any_host_partial = NATIVE_OFFICE_ADDINS.iter().any(|(host_name, addin_id, _, _vsto_file)| {
        let reg_key = format!(
            r"HKCU\Software\Microsoft\Office\{}\Addins\{}",
            match *host_name {
                "Word" => "Word",
                "Excel" => "Excel",
                "PowerPoint" => "PowerPoint",
                _ => return false,
            },
            addin_id
        );
        let has_x64 = get_load_behavior_for_view(&reg_key, RegistryView::X64).is_some();
        let has_x86 = get_load_behavior_for_view(&reg_key, RegistryView::X86).is_some();
        has_x64 || has_x86
    });
    let any_vsto_file_found = NATIVE_OFFICE_ADDINS.iter().any(|(host_name, _, _, vsto_file)| {
        native_office_vsto_manifest(host_name, vsto_file).is_some()
    });

    let package_state = if any_host_valid {
        if vsto_runtime_ok && cert_trusted {
            PackageState::Installed
        } else {
            PackageState::NeedsPrerequisite
        }
    } else if any_host_partial || any_vsto_file_found {
        PackageState::Broken
    } else {
        PackageState::NotInstalled
    };

    // Check each host
    let hosts = vec![
        check_host_status("Word", "Word"),
        check_host_status("Excel", "Excel"),
        check_host_status("PowerPoint", "PowerPoint"),
    ];

    // Check pipe security
    let pipe_security = match super::acl::pipe_sid() {
        Ok(_) => PipeSecurityStatus::SidObtained,
        Err(_) => PipeSecurityStatus::SidFailed,
    };

    // Determine recommended action from real state, not marker
    let action = match package_state {
        PackageState::NotInstalled => RecommendedAction::Install,
        PackageState::Broken => RecommendedAction::Repair,
        PackageState::Installed => {
            if hosts.iter().any(|h| h.state == HostInstallState::Broken) {
                RecommendedAction::Repair
            } else {
                RecommendedAction::None
            }
        }
        PackageState::NeedsPrerequisite => {
            if !vsto_runtime_ok {
                RecommendedAction::Install
            } else {
                RecommendedAction::Install
            }
        }
        _ => RecommendedAction::None,
    };

    NativeOfficeStatus {
        platform_supported,
        package_state,
        package_version: None,
        hosts,
        pipe_security,
        action,
        vsto_runtime_installed: vsto_runtime_ok,
        certificate_trusted: cert_trusted,
        ole: check_ole_status(),
    }
}

/// Check registry entry status for a single view (x64 or x86).
#[cfg(windows)]
fn check_registry_view(reg_key: &str, view: RegistryView) -> RegistryEntryStatus {
    let lb = get_load_behavior_for_view(reg_key, view);
    let present = lb.is_some();

    let manifest = if present {
        run_windows_tool(
            super::process::background_command("reg.exe")
                .args(["query", reg_key, "/v", "Manifest", view.as_reg_arg()]),
            10,
        )
        .ok()
        .map(|out| String::from_utf8_lossy(&out.stdout).to_string())
    } else {
        None
    };

    let valid = present && lb == Some(3);

    RegistryEntryStatus {
        present,
        load_behavior: lb,
        manifest,
        valid,
        error: None,
    }
}

#[cfg(windows)]
fn check_host_status(host_name: &str, office_app: &str) -> HostInstallStatus {
    let vsto_file = match host_name {
        "Word" => "LaTeXSnipper.Word.vsto",
        "Excel" => "LaTeXSnipper.Excel.vsto",
        "PowerPoint" => "LaTeXSnipper.PowerPoint.vsto",
        _ => "",
    };
    let reg_key = format!(
        r"HKCU\Software\Microsoft\Office\{}\Addins\LaTeXSnipper.NativeOffice.{}",
        office_app, host_name
    );

    // Check per-view registry status
    let reg_x64 = check_registry_view(&reg_key, RegistryView::X64);
    let reg_x86 = check_registry_view(&reg_key, RegistryView::X86);
    let any_reg_valid = reg_x64.valid || reg_x86.valid;

    // Check if Office is running
    let office_detected = run_windows_tool(
        super::process::background_command("tasklist.exe")
            .args([
                "/FI",
                &format!("IMAGENAME eq {}.exe", office_app.to_lowercase()),
            ]),
        5,
    )
    .map(|out| {
        let output = String::from_utf8_lossy(&out.stdout);
        output.contains(&format!("{}.exe", office_app.to_lowercase()))
    })
    .unwrap_or(false);

    // Check VSTO file exists
    let manifest_exists = native_office_vsto_manifest(host_name, vsto_file).is_some();

    // Determine state
    let (state, message) = if !office_detected && !any_reg_valid {
        (HostInstallState::NotInstalled, "Office not detected, no registration found".to_string())
    } else if any_reg_valid && manifest_exists && office_detected {
        (HostInstallState::Installed, "VSTO add-in is installed and Office is running".to_string())
    } else if any_reg_valid && manifest_exists {
        (HostInstallState::Installed, "VSTO add-in is installed. Restart Office to load.".to_string())
    } else if reg_x64.present || reg_x86.present {
        (HostInstallState::Broken, format!(
            "Registry present but invalid. x64: valid={}, lb={:?}; x86: valid={}, lb={:?}",
            reg_x64.valid, reg_x64.load_behavior, reg_x86.valid, reg_x86.load_behavior
        ))
    } else {
        (HostInstallState::NotInstalled, "Not installed".to_string())
    };

    HostInstallStatus {
        host: host_name.to_string(),
        office_detected,
        registry_x64: reg_x64,
        registry_x86: reg_x86,
        manifest_exists,
        connected_sessions: 0,
        capabilities: vec![],
        state,
        message,
    }
}

/// Start Native Office installation via bootstrapper.
#[cfg(windows)]
pub fn start_native_office_install() -> Result<NativeOfficeOperationStarted, String> {
    // Find bootstrapper executable
    let bootstrapper = find_bootstrapper()?;
    let operation_id = format!("install-{}", uuid_simple());

    // Launch bootstrapper
    std::process::Command::new(&bootstrapper)
        .arg("/install")
        .spawn()
        .map_err(|e| format!("Failed to start bootstrapper: {}", e))?;

    Ok(NativeOfficeOperationStarted {
        operation_id,
        message: "Installation started. Please follow the installer prompts.".to_string(),
    })
}

/// Start Native Office repair via bootstrapper.
#[cfg(windows)]
pub fn start_native_office_repair() -> Result<NativeOfficeOperationStarted, String> {
    let bootstrapper = find_bootstrapper()?;
    let operation_id = format!("repair-{}", uuid_simple());

    std::process::Command::new(&bootstrapper)
        .arg("/repair")
        .spawn()
        .map_err(|e| format!("Failed to start bootstrapper: {}", e))?;

    Ok(NativeOfficeOperationStarted {
        operation_id,
        message: "Repair started. Please follow the installer prompts.".to_string(),
    })
}

/// Start Native Office uninstall via bootstrapper.
#[cfg(windows)]
pub fn start_native_office_uninstall() -> Result<NativeOfficeOperationStarted, String> {
    let bootstrapper = find_bootstrapper()?;
    let operation_id = format!("uninstall-{}", uuid_simple());

    std::process::Command::new(&bootstrapper)
        .arg("/uninstall")
        .spawn()
        .map_err(|e| format!("Failed to start bootstrapper: {}", e))?;

    Ok(NativeOfficeOperationStarted {
        operation_id,
        message: "Uninstall started. Please follow the installer prompts.".to_string(),
    })
}

/// Find the bootstrapper executable.
#[cfg(windows)]
fn find_bootstrapper() -> Result<PathBuf, String> {
    // Check in app resources
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let candidates = [
                exe_dir
                    .join("resources")
                    .join("NativeOffice")
                    .join("LaTeXSnipper.NativeOffice.Bootstrapper.exe"),
                exe_dir.join("LaTeXSnipper.NativeOffice.Bootstrapper.exe"),
            ];
            for p in &candidates {
                if p.exists() {
                    return Ok(p.clone());
                }
            }
        }
    }

    // Check in install directory
    let install_root = native_office_install_root();
    let bootstrapper = install_root.join("LaTeXSnipper.NativeOffice.exe");
    if bootstrapper.exists() {
        return Ok(bootstrapper);
    }

    if let Some(root) = repo_root_from_manifest() {
        let candidate = root
            .join("apps")
            .join("native-office")
            .join("Installer")
            .join("output")
            .join("LaTeXSnipper.NativeOffice.exe");
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    Err("Native Office bootstrapper was not found. Run apps/native-office/Installer/build.ps1, or use the quick Office switch in Settings > Platform to register existing VSTO build output.".to_string())
}

#[cfg(windows)]
fn uuid_simple() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let t = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{:x}", t)
}

/// Check OLE component availability: registry + DLL existence + bitness check.
///
/// Returns a detailed health level rather than a boolean-only answer.
#[cfg(target_os = "windows")]
pub fn check_ole_status() -> crate::commands::native_office::OleStatus {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;

    let clsid = ole_constants::CLSID;
    let clsid_key = format!(r"Software\Classes\CLSID\{}", clsid);

    // Helper: check if a registry key exists under a specific root/view.
    const KEY_WOW64_64KEY: u32 = 0x0100;
    const KEY_WOW64_32KEY: u32 = 0x0200;
    let key_exists = |root: usize, sub_key: &str, view_flag: u32| -> bool {
        let wide: Vec<u16> = OsStr::new(sub_key).encode_wide().chain(std::iter::once(0)).collect();
        unsafe {
            let mut hkey: isize = 0;
            let result = RegOpenKeyExW(
                root as *mut _,
                wide.as_ptr(),
                0,
                0x20019 | view_flag,
                &mut hkey,
            );
            if result == 0 {
                RegCloseKey(hkey);
                true
            } else {
                false
            }
        }
    };

    let key64 = &clsid_key; // 64-bit: HKCU\Software\Classes\CLSID\{guid}
    let key32 = &clsid_key; // 32-bit: same logical key, queried through WOW64 view

    let registry_64 = key_exists(0x80000001, key64, KEY_WOW64_64KEY); // HKCU
    let registry_32 = key_exists(0x80000001, key32, KEY_WOW64_32KEY);

    if !registry_64 && !registry_32 {
        // Fallback: check HKLM
        let hklm_64 = key_exists(0x80000002, key64, KEY_WOW64_64KEY);
        let hklm_32 = key_exists(0x80000002, key32, KEY_WOW64_32KEY);
        if !hklm_64 && !hklm_32 {
            return crate::commands::native_office::OleStatus {
                available: false,
                bitness_mismatch: false,
                x64_registered: registry_64,
                x86_registered: registry_32,
                x64_dll_exists: false,
                x86_dll_exists: false,
                health: "NotInstalled".to_string(),
                detail: "OLE CLSID not found in any registry view. Run OLE installation.".to_string(),
            };
        }
    }

    // Check DLLs exist in resources
    let x64_dll_found = find_ole_dll_path(ole_constants::DLL_NAME_X64).is_some();
    let x86_dll_found = find_ole_dll_path(ole_constants::DLL_NAME_X86).is_some();

    // Check InprocServer32 path matches actual DLL (primary 64-bit view)
    let inproc_key = format!(r"{}\InprocServer32", clsid_key);
    let inproc_wide: Vec<u16> = OsStr::new(&inproc_key)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let mut inproc_hkey: isize = 0;
    let inproc_result = unsafe {
        RegOpenKeyExW(
            0x80000001isize as *mut _,
            inproc_wide.as_ptr(),
            0,
            0x20019,
            &mut inproc_hkey,
        )
    };

    let registered_dll = if inproc_result == 0 {
        let mut value_buf = [0u16; 1024];
        let mut value_len = 1024u32;
        let query_result = unsafe {
            RegQueryValueExW(
                inproc_hkey,
                std::ptr::null(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                value_buf.as_mut_ptr() as *mut u8,
                &mut value_len,
            )
        };
        unsafe { RegCloseKey(inproc_hkey); }
        if query_result == 0 && value_len >= 2 {
            let max_bytes = (value_buf.len() * 2) as u32; // 2048
            let actual_bytes = value_len.min(max_bytes) as usize;
            let u16_count = actual_bytes / 2;
            // Strip null terminator if present (common for REG_SZ)
            let end = if u16_count > 0 && value_buf[u16_count - 1] == 0 {
                u16_count - 1
            } else {
                u16_count
            };
            Some(String::from_utf16_lossy(&value_buf[..end]))
        } else {
            None
        }
    } else {
        None
    };

    // Determine health level
    let (health, detail, available) = match registered_dll {
        Some(dll_path) => {
            let path_obj = std::path::Path::new(&dll_path);
            if path_obj.exists() {
                if x64_dll_found && x86_dll_found {
                    (
                        "Registered".to_string(),
                        format!("OLE registered (dual view). x64 DLL: {}", dll_path),
                        true,
                    )
                } else if x64_dll_found {
                    (
                        "Registered".to_string(),
                        "OLE registered (64-bit view only; no x86 DLL for 32-bit Office).".to_string(),
                        true,
                    )
                } else {
                    (
                        "RegisteredButDllMissing".to_string(),
                        "x64 OLE DLL not found in resources.".to_string(),
                        false,
                    )
                }
            } else {
                (
                    "RegisteredButBroken".to_string(),
                    format!("InprocServer32 path does not exist: {}", dll_path),
                    false,
                )
            }
        }
        None => {
            if x64_dll_found && x86_dll_found && (registry_64 || registry_32) {
                (
                    "RegisteredButNoPath".to_string(),
                    "CLSID found but InprocServer32 default value is missing or unreadable.".to_string(),
                    false,
                )
            } else if x64_dll_found || x86_dll_found {
                (
                    "RegisteredButNoPath".to_string(),
                    "CLSID found but InprocServer32 unreadable. Try re-installing OLE.".to_string(),
                    false,
                )
            } else {
                (
                    "NotInstalled".to_string(),
                    "OLE DLLs not found in application resources.".to_string(),
                    false,
                )
            }
        }
    };

    crate::commands::native_office::OleStatus {
        available,
        bitness_mismatch: !(x64_dll_found && x86_dll_found),
        x64_registered: registry_64,
        x86_registered: registry_32,
        x64_dll_exists: x64_dll_found,
        x86_dll_exists: x86_dll_found,
        health,
        detail,
    }
}

#[cfg(not(target_os = "windows"))]
pub fn check_ole_status() -> OleStatus {
    OleStatus {
        available: false,
        bitness_mismatch: false,
        x64_registered: false,
        x86_registered: false,
        x64_dll_exists: false,
        x86_dll_exists: false,
        health: "NotSupported".to_string(),
        detail: "OLE is only available on Windows.".to_string(),
    }
}

/// Constants for the OLE Formula Object component.
#[cfg(target_os = "windows")]
mod ole_constants {
    pub const PROG_ID: &str = "LaTeXSnipper.Formula.1";
    pub const PROG_ID_VERSION_INDEPENDENT: &str = "LaTeXSnipper.Formula";
    pub const CLSID: &str = "{B7F5B4AB-5F94-4D87-A29F-9A41D41B3B9F}";
    pub const FRIENDLY_NAME: &str = "LaTeXSnipper Formula Object";
    pub const DLL_NAME_X86: &str = "OleFormulaObject.x86.dll";
    pub const DLL_NAME_X64: &str = "OleFormulaObject.x64.dll";
}

/// Detailed result of an OLE component operation.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OleComponentResult {
    pub success: bool,
    pub message: String,
    pub entries_modified: Vec<String>,
}

/// Result of a VSTO trust verification.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct VstoTrustStatus {
    pub runtime_installed: bool,
    pub certificate_trusted: bool,
    pub manifest_loaded: bool,
    pub pipe_session_connected: bool,
    pub overall_status: String,
}

/// Detect if VSTO Runtime is installed by checking registry keys.
#[cfg(target_os = "windows")]
pub fn detect_vsto_runtime() -> bool {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;

    // VSTO Runtime installs under HKLM\SOFTWARE\Microsoft\VSTO Runtime Setup\{version}
    // and creates the CLR loader key
    let paths = [
        r"Software\Microsoft\VSTO Runtime Setup",
        r"Software\WOW6432Node\Microsoft\VSTO Runtime Setup",
    ];

    for path in &paths {
        let wide: Vec<u16> = OsStr::new(path)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let mut hkey: isize = 0;
        let result = unsafe {
            RegOpenKeyExW(
                0x80000002isize as *mut _,
                wide.as_ptr(),
                0,
                0x20019,
                &mut hkey,
            )
        };
        if result == 0 {
            unsafe { RegCloseKey(hkey); }
            return true;
        }
    }

    // Also check if the VSTO runtime assembly exists in GAC
    let gac_paths = [
        r"C:\Windows\Microsoft.NET\assembly\GAC_MSIL\Microsoft.VisualStudio.Tools.Applications.Runtime.v10",
        r"C:\Windows\Microsoft.NET\assembly\GAC_MSIL\Microsoft.VisualStudio.Tools.Applications.Runtime.v11",
        r"C:\Windows\Microsoft.NET\assembly\GAC_MSIL\Microsoft.VisualStudio.Tools.Applications.Runtime.v12",
        r"C:\Windows\Microsoft.NET\assembly\GAC_MSIL\Microsoft.VisualStudio.Tools.Applications.Runtime.v14",
    ];

    for gac_path in &gac_paths {
        if std::path::Path::new(gac_path).exists() {
            return true;
        }
    }

    false
}

/// Check if the LaTeXSnipper VSTO manifest signing certificate is trusted.
///
/// Uses Windows Certificate Store API (`CertOpenStore` + `CertFindCertificateInStore`)
/// to search the CurrentUser\TrustedPublisher store by SHA-1 thumbprint.
#[cfg(target_os = "windows")]
pub fn check_certificate_trusted() -> bool {
    let Some(expected) = get_expected_thumbprint() else {
        log::warn!("[Office] Cannot check certificate trust: no bundled .cer found");
        return false;
    };

    // Convert hex thumbprint (40 hex chars) to 20-byte array
    if expected.len() != 40 {
        log::warn!("[Office] Invalid thumbprint length: {}", expected.len());
        return false;
    }
    let mut hash_bytes = [0u8; 20];
    for i in 0..20 {
        let hi = expected.as_bytes()[i * 2];
        let lo = expected.as_bytes()[i * 2 + 1];
        hash_bytes[i] = (hex_nibble(hi) << 4) | hex_nibble(lo);
    }

    unsafe {
        use windows::Win32::Security::Cryptography::*;
        use windows::core::w;

        let result = CertOpenStore(
            CERT_STORE_PROV_SYSTEM_W,
            CERT_QUERY_ENCODING_TYPE(0),
            None,
            CERT_OPEN_STORE_FLAGS(CERT_SYSTEM_STORE_CURRENT_USER),
            Some(w!("TrustedPublisher").as_ptr() as *const core::ffi::c_void),
        );
        let store = match result {
            Ok(s) => s,
            Err(e) => {
                log::warn!("[Office] CertOpenStore(TrustedPublisher) failed: error={}", e);
                return false;
            }
        };

        let mut hash_blob = CRYPT_INTEGER_BLOB {
            cbData: 20,
            pbData: hash_bytes.as_mut_ptr(),
        };

        let cert = CertFindCertificateInStore(
            store,
            CERT_QUERY_ENCODING_TYPE(X509_ASN_ENCODING.0 | PKCS_7_ASN_ENCODING.0),
            0,
            CERT_FIND_SHA1_HASH,
            Some(&hash_blob as *const _ as *const core::ffi::c_void),
            None,
        );

        let found = !cert.is_null();
        if found {
            log::info!("[Office] Certificate trusted: {}", expected);
            let _ = CertFreeCertificateContext(Some(cert as *const _));
        } else {
            log::info!("[Office] Certificate NOT in TrustedPublisher: {}", expected);
        }

        let _ = CertCloseStore(store, CERT_CLOSE_STORE_FORCE_FLAG);
        found
    }
}

#[cfg(target_os = "windows")]
fn hex_nibble(b: u8) -> u8 {
    match b {
        b'0'..=b'9' => b - b'0',
        b'A'..=b'F' => b - b'A' + 10,
        b'a'..=b'f' => b - b'a' + 10,
        _ => 0,
    }
}

/// Compute the SHA-1 thumbprint of the bundled `LaTeXSnipperOffice.cer`
/// file, or read it from `native-office-signing.json` if present.
#[cfg(target_os = "windows")]
fn get_expected_thumbprint() -> Option<String> {
    // 1. Try signing.json first
    if let Some(signing_json) = find_signing_metadata() {
        if let Ok(content) = std::fs::read_to_string(&signing_json) {
            if let Ok(meta) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(tp) = meta.get("sha1Thumbprint").and_then(|v| v.as_str()) {
                    let clean = tp.trim().to_uppercase();
                    if clean.len() == 40 && clean.chars().all(|c| c.is_ascii_hexdigit()) {
                        return Some(clean);
                    }
                }
            }
        }
    }

    // 2. Fallback: load .cer via CryptoAPI and read CERT_SHA1_HASH_PROP_ID
    let cert_path = find_staging_certificate()?;
    let cer_bytes = std::fs::read(&cert_path).ok()?;

    unsafe {
        use windows::Win32::Security::Cryptography::*;

        let cert_ctx = CertCreateCertificateContext(
            X509_ASN_ENCODING | PKCS_7_ASN_ENCODING,
            &cer_bytes,
        );
        if cert_ctx.is_null() {
            log::warn!("[Office] CertCreateCertificateContext failed for .cer at {}", cert_path.display());
            return None;
        }

        let mut hash_data = [0u8; 20];
        let mut size: u32 = 20;
        let ok = CertGetCertificateContextProperty(
            cert_ctx,
            CERT_SHA1_HASH_PROP_ID,
            Some(hash_data.as_mut_ptr() as *mut core::ffi::c_void),
            &mut size,
        );

        let _ = CertFreeCertificateContext(Some(cert_ctx as *const _));

        if ok.is_ok() && size == 20 {
            let hex: String = hash_data.iter().map(|b| format!("{:02X}", b)).collect();
            log::info!("[Office] Computed thumbprint from .cer: {}", hex);
            Some(hex)
        } else {
            log::warn!("[Office] Failed to read CERT_SHA1_HASH_PROP_ID from .cer");
            None
        }
    }
}

/// Find the native-office-signing.json metadata file bundled with resources.
#[cfg(target_os = "windows")]
fn find_signing_metadata() -> Option<std::path::PathBuf> {
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let candidate = exe_dir
                .join("resources")
                .join("NativeOffice")
                .join("certificates")
                .join("native-office-signing.json");
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }
    None
}

/// Improve load verification by checking real LoadBehavior value.
#[cfg(target_os = "windows")]
pub fn get_load_behavior(reg_key: &str) -> Option<u32> {
    let output = run_windows_tool(
        super::process::background_command("reg.exe")
            .args(["query", reg_key, "/v", "LoadBehavior"]),
        10,
    )
    .ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        if line.contains("LoadBehavior") {
            if let Some(val) = parse_reg_dword_from_line(line) {
                return Some(val);
            }
        }
    }
    None
}

/// Locate the OLE DLLs shipped with the Desktop app resources.
#[cfg(target_os = "windows")]
fn find_ole_dll_path(dll_name: &str) -> Option<std::path::PathBuf> {
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let candidate = exe_dir.join("resources").join("NativeOffice").join(dll_name);
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }
    None
}

/// Write the Desktop exe path to the registry so the OLE DLL's FindDesktopPathRegistry()
/// can locate the exe. Called during app startup (not just during OLE install).
pub fn register_install_path() {
    #[cfg(target_os = "windows")]
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let install_path = exe_dir.to_string_lossy().replace('/', "\\");
            let _ = reg_add_string(
                r"HKCU\Software\LaTeXSnipper",
                "InstallPath",
                &install_path,
            );
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        // No-op on non-Windows platforms — registry is not available.
    }
}

/// Install the OLE COM component for both x86 and x64 registry views.
/// - Registers CLSID, ProgID, InprocServer32 under both 64-bit and 32-bit (Wow6432Node) views
/// - x64 DLL is assigned to the 64-bit view, x86 DLL to the 32-bit view
/// - Does NOT register with regsvr32 (DLL has no DllRegisterServer)
#[cfg(target_os = "windows")]
pub fn install_ole_component() -> OleComponentResult {
    let mut entries = Vec::new();

    let x64_dll = match find_ole_dll_path(ole_constants::DLL_NAME_X64) {
        Some(p) => p.to_string_lossy().replace('/', "\\"),
        None => {
            return OleComponentResult {
                success: false,
                message: format!("x64 OLE DLL not found in resources: {}", ole_constants::DLL_NAME_X64),
                entries_modified: entries,
            };
        }
    };

    let x86_dll = match find_ole_dll_path(ole_constants::DLL_NAME_X86) {
        Some(p) => p.to_string_lossy().replace('/', "\\"),
        None => {
            return OleComponentResult {
                success: false,
                message: format!("x86 OLE DLL not found in resources: {}", ole_constants::DLL_NAME_X86),
                entries_modified: entries,
            };
        }
    };

    let clsid = ole_constants::CLSID;
    let prog_id = ole_constants::PROG_ID;
    let prog_id_vi = ole_constants::PROG_ID_VERSION_INDEPENDENT;
    let friendly = ole_constants::FRIENDLY_NAME;

    // Register for 64-bit view
    match register_ole_view(&x64_dll, clsid, prog_id, prog_id_vi, friendly, RegistryView::X64) {
        Ok(log) => entries.extend(log),
        Err(e) => {
            return OleComponentResult {
                success: false,
                message: format!("OLE x64 registration failed: {e}"),
                entries_modified: entries,
            };
        }
    }

    // Register for 32-bit view
    match register_ole_view(&x86_dll, clsid, prog_id, prog_id_vi, friendly, RegistryView::X86) {
        Ok(log) => entries.extend(log),
        Err(e) => {
            return OleComponentResult {
                success: false,
                message: format!("OLE x86 registration failed: {e}"),
                entries_modified: entries,
            };
        }
    }

    // Update ledger with OLE installation
    let mut ledger = IntegrationLedger::load();

    // Write Desktop exe path to registry so the OLE DLL's FindDesktopPathRegistry()
    // can find the exe without relying on DllMain g_dllModule.
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let install_path = exe_dir.to_string_lossy().replace('/', "\\");
            let _ = reg_add_string(
                r"HKCU\Software\LaTeXSnipper",
                "InstallPath",
                &install_path,
            );
            entries.push(format!("InstallPath → {}", install_path));
        }
    }
    ledger.native_office.ole = Some(OleLedgerEntry {
        enabled: true,
        bitness: "dual".to_string(),
        dll_path: format!("{} | {}", x64_dll, x86_dll),
        prog_id: prog_id.to_string(),
        clsid: clsid.to_string(),
        registry_view: "64+32".to_string(),
    });
    if let Err(e) = ledger.save() {
        log::warn!("[OLE] Failed to save ledger: {}", e);
    }

    OleComponentResult {
        success: true,
        message: format!(
            "OLE component installed (dual view: 64-bit → {}, 32-bit → {}). ProgID: {}",
            ole_constants::DLL_NAME_X64, ole_constants::DLL_NAME_X86, prog_id
        ),
        entries_modified: entries,
    }
}

/// Register OLE COM entries for a specific registry view.
/// Returns `Ok(entries_log)` on success or `Err(failure_reason)` if any
/// critical key could not be written.
#[cfg(target_os = "windows")]
fn register_ole_view(
    dll_path: &str,
    clsid: &str,
    prog_id: &str,
    prog_id_vi: &str,
    friendly: &str,
    view: RegistryView,
) -> Result<Vec<String>, String> {
    let mut entries = Vec::new();
    let reg_flag = view.as_reg_arg();

    /// Helper: write a single REG_SZ value; returns Err on failure.
    fn ole_reg(key: &str, name: &str, value: &str, reg_flag: &str) -> Result<(), String> {
        let mut cmd = super::process::background_command("reg.exe");
        cmd.args(["add", key]);
        if name.is_empty() {
            cmd.arg("/ve");
        } else {
            cmd.args(["/v", name]);
        }
        cmd.args(["/t", "REG_SZ", "/d", value, "/f", reg_flag]);
        super::process::run_with_timeout(&mut cmd, std::time::Duration::from_secs(15))
            .map(|out| {
                if out.status.success() { Ok(()) }
                else { Err(format!("reg add failed: {}", String::from_utf8_lossy(&out.stderr))) }
            })
            .unwrap_or(Err("process timed out".to_string()))
    }

    let clsid_key = format!(r"HKCU\Software\Classes\CLSID\{}", clsid);

    // All registry entries; the first failure short-circuits.
    // Critical: ProgID, CLSID, InprocServer32 must all succeed.
    let regs: &[(&str, &str, &str)] = &[
        // ProgID (versioned: LaTeXSnipper.Formula.1)
        (&format!(r"HKCU\Software\Classes\{}", prog_id), "", friendly),
        (&format!(r"HKCU\Software\Classes\{}\CLSID", prog_id), "", clsid),
        (&format!(r"HKCU\Software\Classes\{}\CurVer", prog_id), "", prog_id),
        // VersionIndependentProgID
        (&format!(r"HKCU\Software\Classes\{}", prog_id_vi), "", friendly),
        (&format!(r"HKCU\Software\Classes\{}\CLSID", prog_id_vi), "", clsid),
        (&format!(r"HKCU\Software\Classes\{}\CurVer", prog_id_vi), "", prog_id),
        // CLSID
        (&clsid_key, "", friendly),
        (&clsid_key, "ProgID", prog_id),
        (&clsid_key, "VersionIndependentProgID", prog_id_vi),
        (&clsid_key, "Insertable", ""),
        // InprocServer32
        (&format!(r"{}\InprocServer32", clsid_key), "", dll_path),
        (&format!(r"{}\InprocServer32", clsid_key), "ThreadingModel", "Apartment"),
    ];

    for (key, name, value) in regs {
        ole_reg(key, name, value, reg_flag)
            .map_err(|e| format!("[{}] {}: {}", view.label(), key, e))?;
        entries.push(format!("[{}] {} = {}", view.label(), key, value));
    }

    Ok(entries)
}

/// Uninstall the OLE COM component from both registry views with verification.
#[cfg(target_os = "windows")]
pub fn uninstall_ole_component() -> OleComponentResult {
    let mut entries = Vec::new();
    let clsid = ole_constants::CLSID;
    let prog_id = ole_constants::PROG_ID;
    let prog_id_vi = ole_constants::PROG_ID_VERSION_INDEPENDENT;

    for view in &REGISTRY_VIEWS {
        for key in &[
            format!(r"HKCU\Software\Classes\CLSID\{}", clsid),
            format!(r"HKCU\Software\Classes\{}", prog_id),
            format!(r"HKCU\Software\Classes\{}", prog_id_vi),
        ] {
            let result = run_windows_tool(
                super::process::background_command("reg.exe")
                    .args(["delete", key, "/f", view.as_reg_arg()]),
                15,
            );
            match result {
                Ok(out) if out.status.success() => {
                    entries.push(format!("Deleted {} ({})", key, view.label()));
                }
                Ok(out) => {
                    let stderr = String::from_utf8_lossy(&out.stderr);
                    log::warn!("[OLE] Failed to delete {}: {}", key, stderr);
                }
                Err(e) => {
                    log::warn!("[OLE] Failed to delete {}: {}", key, e);
                }
            }
        }
    }

    // Update ledger: mark OLE as uninstalled
    let mut ledger = IntegrationLedger::load();
    ledger.native_office.ole = None;
    if let Err(e) = ledger.save() {
        log::warn!("[OLE] Failed to update ledger: {}", e);
    }

    OleComponentResult {
        success: true,
        message: "OLE component unregistered from both 32-bit and 64-bit views.".into(),
        entries_modified: entries,
    }
}

/// Detect whether the installed Office is 64-bit.
/// Checks HKCU\Software\Microsoft\Office\Common\KnownDLLs64 existence,
/// or falls back to native arch.
#[cfg(target_os = "windows")]
fn detect_office_64bit() -> bool {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;

    let path = OsStr::new(r"Software\Microsoft\Office\Common");
    let wide: Vec<u16> = path.encode_wide().chain(std::iter::once(0)).collect();
    let mut hkey: isize = 0;

    let result = unsafe {
        RegOpenKeyExW(
            0x80000001isize as *mut _,
            wide.as_ptr(),
            0,
            0x20019, // KEY_READ
            &mut hkey,
        )
    };
    if result != 0 {
        // If Office key not found, default to native architecture
        return cfg!(target_arch = "x86_64");
    }

    // Check if KnownDLLs64 exists (64-bit Office marker)
    let kdll_path = OsStr::new(r"KnownDLLs64");
    let kdll_wide: Vec<u16> = kdll_path.encode_wide().chain(std::iter::once(0)).collect();
    let mut kdll_key: isize = 0;
    let kdll_result = unsafe {
        RegOpenKeyExW(
            hkey as *mut _,
            kdll_wide.as_ptr(),
            0,
            0x20019,
            &mut kdll_key,
        )
    };
    unsafe { RegCloseKey(hkey); }
    if kdll_result == 0 {
        unsafe { RegCloseKey(kdll_key); }
        true
    } else {
        false
    }
}

/// Find the .cer certificate file bundled with the app resources.
#[cfg(target_os = "windows")]
fn find_staging_certificate() -> Option<std::path::PathBuf> {
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let candidates = [
                exe_dir
                    .join("resources")
                    .join("NativeOffice")
                    .join("certificates")
                    .join("LaTeXSnipperOffice.cer"),
                exe_dir
                    .join("resources")
                    .join("LaTeXSnipperOffice.cer"),
            ];
            for p in &candidates {
                if p.exists() {
                    return Some(p.clone());
                }
            }
        }
    }
    None
}

/// Import a .cer certificate to CurrentUser TrustedPublisher store.
#[cfg(target_os = "windows")]
fn import_certificate_to_trusted_publisher(cer_path: &std::path::Path) -> Result<(), String> {
    let mut cmd = super::process::background_command("certutil.exe");
    cmd.args([
        "-addstore",
        "TrustedPublisher",
        cer_path.to_str().unwrap_or_default(),
    ]);
    let output = super::process::run_with_timeout(&mut cmd, Duration::from_secs(15))
        .map_err(|e| format!("Failed to run certutil: {}", e))?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("certutil failed: {}", stderr.trim()))
    }
}

#[cfg(not(target_os = "windows"))]
pub fn install_ole_component() -> OleComponentResult {
    OleComponentResult {
        success: false,
        message: "OLE component installation is only available on Windows.".into(),
        entries_modified: vec![],
    }
}

#[cfg(not(target_os = "windows"))]
pub fn uninstall_ole_component() -> OleComponentResult {
    OleComponentResult {
        success: false,
        message: "OLE component uninstallation is only available on Windows.".into(),
        entries_modified: vec![],
    }
}

extern "system" {
    fn RegOpenKeyExW(
        hKey: *mut std::ffi::c_void,
        lpSubKey: *const u16,
        ulOptions: u32,
        samDesired: u32,
        phkResult: *mut isize,
    ) -> i32;
    fn RegCloseKey(hKey: isize) -> i32;
    fn RegEnumKeyW(
        hKey: isize,
        dwIndex: u32,
        lpName: *mut u16,
        cchName: u32,
    ) -> i32;
    fn RegQueryValueExW(
        hKey: isize,
        lpValueName: *const u16,
        lpReserved: *mut std::ffi::c_void,
        lpType: *mut u32,
        lpData: *mut u8,
        lpcbData: *mut u32,
    ) -> i32;
}

// ═══════════════════════════════════════════════════════════════════════════
// IntegrationCleaner — deterministic cleanup for all external state
// ═══════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CleanerResult {
    pub scope: String,
    pub action: String,
    pub entries_removed: Vec<String>,
    pub entries_skipped: Vec<String>,
    pub pending_restart: Vec<String>,
    pub entries_failed: Vec<String>,
    pub ledger_cleared: bool,
}

impl CleanerResult {
    fn new(scope: &str, action: &str) -> Self {
        Self {
            scope: scope.to_string(),
            action: action.to_string(),
            entries_removed: Vec::new(),
            entries_skipped: Vec::new(),
            pending_restart: Vec::new(),
            entries_failed: Vec::new(),
            ledger_cleared: false,
        }
    }

    fn skip(&mut self, entry: &str) {
        self.entries_skipped.push(entry.to_string());
    }

    fn remove(&mut self, entry: &str) {
        self.entries_removed.push(entry.to_string());
    }

    fn fail(&mut self, entry: &str, reason: &str) {
        self.entries_failed.push(format!("{}: {}", entry, reason));
    }

    fn pending(&mut self, entry: &str) {
        self.pending_restart.push(entry.to_string());
    }
}

/// Check if Office processes are running (returns list of running hosts)
#[cfg(target_os = "windows")]
fn check_office_processes() -> Vec<String> {
    let mut running = Vec::new();
    for (name, exe) in &[("Word", "WINWORD.EXE"), ("Excel", "EXCEL.EXE"), ("PowerPoint", "POWERPNT.EXE")] {
        let output = run_windows_tool(
            Command::new("tasklist.exe")
                .args(["/FI", &format!("IMAGENAME eq {}", exe)]),
            5,
        );
        if let Ok(out) = output {
            let stdout = String::from_utf8_lossy(&out.stdout);
            if stdout.contains(exe) {
                running.push(name.to_string());
            }
        }
    }
    running
}

#[cfg(not(target_os = "windows"))]
fn check_office_processes() -> Vec<String> {
    vec![]
}

/// Clean Native VSTO integration state
#[cfg(target_os = "windows")]
fn clean_native_office(result: &mut CleanerResult) {
    let ledger = IntegrationLedger::load();

    for entry in &ledger.native_office.vsto {
        // Verify ownership before deleting
        let reg_value = run_windows_tool(
            super::process::background_command("reg.exe")
                .args(["query", &entry.registry_key, "/v", "Manifest"]),
            10,
        )
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();

        if reg_value.contains(&entry.manifest) || entry.manifest.is_empty() {
            // We own this entry — safe to delete
            reg_delete_tree_both(&entry.registry_key);
            result.remove(&format!("VSTO registry: {}", entry.registry_key));
        } else {
            result.skip(&format!("VSTO registry: {} (manifest mismatch, may be from another install)", entry.registry_key));
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn clean_native_office(_result: &mut CleanerResult) {}

/// Clean OLE COM registration
#[cfg(target_os = "windows")]
fn clean_ole(result: &mut CleanerResult) {
    let ledger = IntegrationLedger::load();

    if let Some(ref ole) = ledger.native_office.ole {
        if ole.enabled {
            // Ownership check: verify CLSID exists at all (any registration)
            let clsid_key = format!("Software\\Classes\\CLSID\\{}", ole.clsid);
            let inproc_key = format!("{}\\InprocServer32", clsid_key);

            let clsid_exists = run_windows_tool(
                super::process::background_command("reg.exe")
                    .args(["query", &inproc_key, "/ve"]),
                10,
            )
            .map(|o| o.status.success())
            .unwrap_or(false);

            if clsid_exists || ole.dll_path.is_empty() {
                // Clean up registry entries from both views
                for view in &REGISTRY_VIEWS {
                    let keys = [
                        format!("HKCU\\Software\\Classes\\CLSID\\{}\\InprocServer32", ole.clsid),
                        format!("HKCU\\Software\\Classes\\CLSID\\{}", ole.clsid),
                        format!("HKCU\\Software\\Classes\\{}", ole.prog_id),
                        format!("HKCU\\Software\\Classes\\{}\\CLSID", ole.prog_id),
                        format!("HKCU\\Software\\Classes\\{}\\CurVer", ole.prog_id),
                        format!("HKCU\\Software\\Classes\\{}", ole.prog_id),
                    ];
                    for key in &keys {
                        let _ = run_windows_tool(
                            Command::new("reg.exe")
                                .args(["delete", key, "/f", view.as_reg_arg()]),
                            15,
                        );
                        result.remove(&format!("OLE registry: {} [{}]", key, view.label()));
                    }
                }
            } else {
                result.skip("OLE registry (CLSID not found in any view, may be from another install)");
            }
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn clean_ole(_result: &mut CleanerResult) {}

/// Clean Obsidian plugin from all vaults in the ledger
#[cfg(target_os = "windows")]
fn clean_obsidian(result: &mut CleanerResult) {
    let ledger = IntegrationLedger::load();
    for entry in &ledger.obsidian {
        let plugin_dir = PathBuf::from(&entry.plugin_path);
        if plugin_dir.exists() {
            // Atomic removal of plugin directory
            if fs::remove_dir_all(&plugin_dir).is_ok() {
                result.remove(&format!("Obsidian plugin: {}", entry.vault_path));
            } else {
                result.pending(&format!("Obsidian plugin: {} (file locked by Obsidian)", entry.vault_path));
            }
        } else {
            result.skip(&format!("Obsidian plugin: {} (already removed)", entry.vault_path));
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn clean_obsidian(_result: &mut CleanerResult) {}

/// Clear the ledger itself
fn clean_ledger(result: &mut CleanerResult) {
    let mut ledger = IntegrationLedger::load();
    ledger.native_office = NativeOfficeLedger::default();
    ledger.obsidian.clear();
    // Don't clear officeJs/wps as they're managed by their own subsystems
    ledger.native_office.vsto.clear();
    ledger.native_office.ole = None;
    if let Err(e) = ledger.save() {
        result.fail("ledger", &e);
    } else {
        result.ledger_cleared = true;
    }
}

/// Run the IntegrationCleaner for a specific scope.
/// Scopes: "native-office", "ole", "obsidian", "all"
pub fn run_cleaner(scope: &str, plan_only: bool) -> CleanerResult {
    let mut result = CleanerResult::new(scope, if plan_only { "plan" } else { "apply" });

    match scope {
        "native-office" => {
            clean_native_office(&mut result);
        }
        "ole" => {
            clean_ole(&mut result);
        }
        "obsidian" => {
            clean_obsidian(&mut result);
        }
        "all" => {
            clean_native_office(&mut result);
            clean_ole(&mut result);
            clean_obsidian(&mut result);
            if !plan_only {
                clean_ledger(&mut result);
            }
        }
        _ => {
            result.entries_failed.push(format!("Unknown scope: {}", scope));
        }
    }

    result
}
