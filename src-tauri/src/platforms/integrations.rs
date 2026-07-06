use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};

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

#[tauri::command]
pub async fn install_platform_integration(platform_id: String) -> PlatformIntegrationResult {
    let fallback_platform = platform_id.clone();
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
    match platform_id.as_str() {
        "office" => uninstall_native_office_vsto(),
        "office-web" => uninstall_office_addin(),
        "office-native" => uninstall_native_office_vsto(),
        "office-hybrid" => {
            let _ = uninstall_native_office_vsto();
            uninstall_office_addin()
        }
        "obsidian" => remove_generated_dir("obsidian", "plugin", obsidian_staging_dir()),
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
            if check_native_office_vsto() {
                PlatformIntegrationResult::ok(
                    "office",
                    "native-vsto",
                    "Native Office VSTO add-ins are installed.",
                    false,
                )
            } else {
                PlatformIntegrationResult::fail(
                    "office",
                    "not_installed",
                    "Native Office VSTO add-ins are not installed. Enable Office integration in settings.",
                )
            }
        }
        "obsidian" => check_path(
            "obsidian",
            "plugin",
            obsidian_staging_dir(),
            "Obsidian plugin package is prepared.",
        ),
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
            Command::new("powershell")
                .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
                .arg(&script)
                .args(["-Platform", "x64"])
                .creation_flags(CREATE_NO_WINDOW)
                .output()
        }
        #[cfg(not(target_os = "windows"))]
        {
            Command::new("powershell")
                .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
                .arg(&script)
                .args(["-Platform", "x64"])
                .output()
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

fn reg_add_string(key: &str, name: &str, value: &str) -> std::io::Result<()> {
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
    let output = command.output()?;
    if output.status.success() {
        Ok(())
    } else {
        Err(std::io::Error::new(
            std::io::ErrorKind::Other,
            String::from_utf8_lossy(&output.stderr).to_string(),
        ))
    }
}

fn reg_add_dword(key: &str, name: &str, value: u32) -> std::io::Result<()> {
    let value = value.to_string();
    let output = super::process::background_command("reg.exe")
        .args([
            "add",
            key,
            "/v",
            name,
            "/t",
            "REG_DWORD",
            "/d",
            &value,
            "/f",
        ])
        .output()?;
    if output.status.success() {
        Ok(())
    } else {
        Err(std::io::Error::new(
            std::io::ErrorKind::Other,
            String::from_utf8_lossy(&output.stderr).to_string(),
        ))
    }
}

fn reg_delete_tree(key: &str) {
    let _ = super::process::background_command("reg.exe").args(["delete", key, "/f"]).output();
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
    reg_delete_tree(&format!(
        r"HKCR\CLSID\{}",
        office_addin_clsid()
    ));
    reg_delete_tree(r"HKCR\LaTeXSnipper.Office");
}

fn cleanup_legacy_office_com_addins() {
    for app in ["Word", "Excel", "PowerPoint"] {
        for addin in ["LaTeXSnipperOffice", "LaTeXSnipperOffice-Independent", "LaTeXSnipper.Office"] {
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
        super::process::background_command("reg.exe")
            .args([
                "query",
                &format!(r"HKCU\Software\Microsoft\Office\{}\Addins\LaTeXSnipper.Office", app),
                "/v",
                "LoadBehavior",
            ])
            .output()
            .map(|out| out.status.success())
            .unwrap_or(false)
    });

    let com_key = hkcu_classes_key(&format!(r"CLSID\{}\InprocServer32", office_addin_clsid()));
    let com_ok = super::process::background_command("reg.exe")
        .args(["query", &com_key, "/v", "CodeBase"])
        .output()
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
        super::process::background_command("reg.exe")
            .args(["query", root, "/s"])
            .output()
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
    let check = super::process::background_command("reg.exe")
        .args(["query", &format!("HKCR\\CLSID\\{{{}}}", guid)])
        .output();

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
    let check = super::process::background_command("reg.exe")
        .args(["query", &format!("HKCR\\CLSID\\{{{}}}", guid)])
        .output();

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

    let output = super::process::background_command("reg.exe")
        .args(["add", OFFICE_DEVELOPER_KEY, "/v", host.id, "/t", "REG_SZ", "/d", &manifest_path, "/f"])
        .output()
        .map_err(|e| format!("无法写入 Office 加载项注册表: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "Office 加载项注册失败: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let _ = super::process::background_command("reg.exe")
        .args(["add", r"HKCU\Software\Microsoft\Office\16.0\WEF", "/v", host.refresh_key, "/t", "REG_SZ", "/d", host.id, "/f"])
        .output();

    println!("[Office] Registered {} in {} \\ {} = {}", host.name, OFFICE_DEVELOPER_KEY, host.id, manifest_path);
    Ok(())
}

#[cfg(target_os = "windows")]
fn normalize_office_manifest_path(path: &str) -> String {
    path.strip_prefix(r"\\?\").unwrap_or(path).to_string()
}

#[cfg(target_os = "windows")]
fn clear_office_refresh_marker(host: OfficeJsHost) {
    let _ = super::process::background_command("reg.exe")
        .args([
            "add",
            r"HKCU\Software\Microsoft\Office\16.0\WEF",
            "/v",
            host.refresh_key,
            "/t",
            "REG_SZ",
            "/d",
            "{00000000-0000-0000-0000-000000000000}",
            "/f",
        ])
        .output();
}

/// Remove the add-in manifest registration from the Windows registry.
#[cfg(target_os = "windows")]
fn unregister_office_js_manifest(host: OfficeJsHost) -> Result<(), String> {
    let output = super::process::background_command("reg.exe")
        .args(["delete", OFFICE_DEVELOPER_KEY, "/v", host.id, "/f"])
        .output()
        .map_err(|e| format!("无法移除 Office 加载项注册表: {e}"))?;

    if output.status.success() {
        println!("[Office] Unregistered {} from registry: {} \\ {}", host.name, OFFICE_DEVELOPER_KEY, host.id);
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
    super::process::background_command("reg.exe")
        .args(["query", OFFICE_DEVELOPER_KEY, "/v", host.id])
        .output()
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
                Err(e) => return PlatformIntegrationResult::fail("office", "office-js", format!("Failed to read {} manifest: {e}", host.name)),
            };
            let wef_dir = PathBuf::from(&home)
                .join("Library")
                .join("Containers")
                .join(host.mac_container)
                .join("Data")
                .join("Documents")
                .join("wef");
            if let Err(e) = std::fs::create_dir_all(&wef_dir) {
                return PlatformIntegrationResult::fail("office", "office-js", format!("Failed to create {} wef directory: {e}", host.name));
            }
            let target_path = wef_dir.join("LaTeXSnipper.xml");
            if let Err(e) = std::fs::write(&target_path, &content) {
                return PlatformIntegrationResult::fail("office", "office-js", format!("Failed to write {} manifest: {e}", host.name));
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
            PlatformIntegrationResult::ok("office", "office-js", "Uninstalled Office.js add-ins. Restart Office apps to unload LaTeXSnipper.", true)
        } else {
            PlatformIntegrationResult::ok("office", "office-js", "No installed Office.js add-ins were found.", false)
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
        return PlatformIntegrationResult::fail("office", "not_found", "Microsoft Office was not detected.");
    }

    if is_taskpane_connected() {
        return PlatformIntegrationResult::ok("office", "connected", "Office task pane is connected and ready.", false);
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
            return PlatformIntegrationResult::ok("office", "installed", "Office.js add-ins are installed. Restart Office apps.", true);
        }
        if !installed.is_empty() {
            return PlatformIntegrationResult::fail(
                "office",
                "partial",
                format!("Only these Office.js add-ins are installed: {}. Toggle Office off and on to repair.", installed.join(", ")),
            );
        }
    }

    PlatformIntegrationResult::fail("office", "not_installed", "Office.js add-ins are not installed. Enable Office integration in settings.")
}

// ═══════════════════════════════════════════════════════════════════════════
// Native Office VSTO Add-in registration
//
// New VSTO add-ins for Word, Excel, and PowerPoint.
// Uses Named Pipe communication instead of HTTP bridge.
// ═══════════════════════════════════════════════════════════════════════════

/// Native Office VSTO Add-in identifiers
const NATIVE_OFFICE_ADDINS: &[(&str, &str, &str, &str)] = &[
    ("Word", "LaTeXSnipper.NativeOffice.Word", "LaTeXSnipper Native Office — Word", "LaTeXSnipper.Word.vsto"),
    ("Excel", "LaTeXSnipper.NativeOffice.Excel", "LaTeXSnipper Native Office — Excel", "LaTeXSnipper.Excel.vsto"),
    ("PowerPoint", "LaTeXSnipper.NativeOffice.PowerPoint", "LaTeXSnipper Native Office — PowerPoint", "LaTeXSnipper.PowerPoint.vsto"),
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

    if let Some(root) = repo_root_from_manifest() {
        candidates.push(root.join("apps").join("native-office").join(format!("LaTeXSnipper.{}", host_name)).join("bin").join("Release").join(vsto_file));
        candidates.push(root.join("apps").join("native-office").join(format!("LaTeXSnipper.{}", host_name)).join("bin").join("Debug").join(vsto_file));
    }

    candidates.into_iter().find(|path| path.exists())
}

fn office_manifest_value(path: &Path) -> String {
    format!("file:///{}|vstolocal", path.to_string_lossy().replace('\\', "/"))
}

/// Install Native Office VSTO add-ins by registering in Windows registry.
fn install_native_office_vsto() -> PlatformIntegrationResult {
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
        let mut installed = Vec::new();

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

            // Write FriendlyName
            if let Err(e) = reg_add_string(&reg_key, "FriendlyName", friendly_name) {
                return PlatformIntegrationResult::fail(
                    "office",
                    "native-vsto",
                    format!("Failed to write {} FriendlyName: {}", host_name, e),
                );
            }

            // Write Description
            if let Err(e) = reg_add_string(&reg_key, "Description", "LaTeX formula and table integration") {
                return PlatformIntegrationResult::fail(
                    "office",
                    "native-vsto",
                    format!("Failed to write {} Description: {}", host_name, e),
                );
            }

            // Write LoadBehavior = 3 (load at startup)
            if let Err(e) = reg_add_dword(&reg_key, "LoadBehavior", 3) {
                return PlatformIntegrationResult::fail(
                    "office",
                    "native-vsto",
                    format!("Failed to write {} LoadBehavior: {}", host_name, e),
                );
            }

            // Write CommandLineSafe = 0
            if let Err(e) = reg_add_dword(&reg_key, "CommandLineSafe", 0) {
                return PlatformIntegrationResult::fail(
                    "office",
                    "native-vsto",
                    format!("Failed to write {} CommandLineSafe: {}", host_name, e),
                );
            }

            if let Err(e) = reg_add_string(&reg_key, "Manifest", &office_manifest_value(&manifest)) {
                return PlatformIntegrationResult::fail(
                    "office",
                    "native-vsto",
                    format!("Failed to write {} Manifest: {}", host_name, e),
                );
            }

            installed.push(*host_name);
        }

        return PlatformIntegrationResult::ok(
            "office",
            "native-vsto",
            format!(
                "已启用 Native Office VSTO ({} 个宿主)。请重启 Office 以加载插件。",
                installed.join(", ")
            ),
            true,
        );
    }
}

/// Check if Native Office VSTO add-ins are installed.
fn check_native_office_vsto() -> bool {
    #[cfg(not(target_os = "windows"))]
    {
        return false;
    }

    #[cfg(target_os = "windows")]
    {
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

            let load_behavior_ok = super::process::background_command("reg.exe")
                .args(["query", &reg_key, "/v", "LoadBehavior"])
                .output()
                .map(|out| out.status.success())
                .unwrap_or(false);

            let manifest_ok = super::process::background_command("reg.exe")
                .args(["query", &reg_key, "/v", "Manifest"])
                .output()
                .map(|out| out.status.success())
                .unwrap_or(false);

            if !load_behavior_ok || !manifest_ok || native_office_vsto_manifest(host_name, vsto_file).is_none() {
                return false;
            }
        }
        true
    }
}

/// Uninstall Native Office VSTO add-ins.
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
        let mut uninstalled = Vec::new();

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

            // Delete the registry key
            let _ = super::process::background_command("reg.exe")
                .args(["delete", &reg_key, "/f"])
                .output();

            uninstalled.push(*host_name);
        }

        return PlatformIntegrationResult::ok(
            "office",
            "native-vsto",
            format!(
                "Uninstalled Native Office VSTO add-ins for {}. Restart Word, Excel, and PowerPoint to complete removal.",
                uninstalled.join(", ")
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
        let vsto_check = super::process::background_command("reg.exe")
            .args(["query", r"HKCU\Software\Microsoft\Office\Word\Addins", "/s"])
            .output()
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
        let vsto = super::process::background_command("reg.exe")
            .args(["query", r"HKCU\Software\Microsoft\Office\Word\Addins", "/s"])
            .output()
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

fn install_obsidian() -> PlatformIntegrationResult {
    // Try to use built plugin from apps/obsidian-plugin first
    let built_main_js = repo_root_from_manifest()
        .map(|root| root.join("apps").join("obsidian-plugin").join("main.js"))
        .filter(|p| p.exists());

    let built_manifest = repo_root_from_manifest()
        .map(|root| root.join("apps").join("obsidian-plugin").join("manifest.json"))
        .filter(|p| p.exists());

    let dir = obsidian_staging_dir();
    if let Err(err) = fs::create_dir_all(&dir) {
        return PlatformIntegrationResult::fail(
            "obsidian",
            "plugin",
            format!("Failed to create Obsidian plugin directory: {err}"),
        );
    }

    // Copy built files, or generate minimal fallback
    if let Some(src) = built_main_js {
        let _ = fs::copy(&src, dir.join("main.js"));
    }
    if let Some(src) = built_manifest {
        let _ = fs::copy(&src, dir.join("manifest.json"));
    } else {
        // Fallback: generate minimal manifest
        let manifest = r#"{
  "id": "latexsnipper-obsidian",
  "name": "LaTeXSnipper",
  "version": "1.0.0",
  "minAppVersion": "1.4.0",
  "description": "Insert LaTeX formulas from LaTeXSnipper into Obsidian notes.",
  "author": "LaTeXSnipper",
  "isDesktopOnly": true
}
"#;
        let _ = fs::write(dir.join("manifest.json"), manifest);
    }

    PlatformIntegrationResult::ok(
        "obsidian",
        "plugin",
        format!("Prepared Obsidian plugin at {}. This is a staging directory — you must copy it into your vault's .obsidian/plugins/ folder manually and enable it in Obsidian settings.", dir.display()),
        false,
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
    // Primary: LaTeXSnipper-Office repo (monorepo layout)
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
"#.to_string();
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

    // Check for MSI marker
    let marker_path = dirs_next::data_local_dir()
        .unwrap_or_default()
        .join("LaTeXSnipper")
        .join("NativeOffice")
        .join("marker.json");

    let package_state = if marker_path.exists() {
        // Check if key files exist
        let install_root = dirs_next::data_local_dir()
            .unwrap_or_default()
            .join("Programs")
            .join("LaTeXSnipper")
            .join("NativeOffice");

        if install_root.exists() {
            PackageState::Installed
        } else {
            PackageState::Broken
        }
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

    // Determine recommended action
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
        _ => RecommendedAction::None,
    };

    NativeOfficeStatus {
        platform_supported,
        package_state,
        package_version: None,
        hosts,
        pipe_security,
        action,
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

    // Check registry key
    let registry_key_present = super::process::background_command("reg.exe")
        .args(["query", &reg_key, "/v", "LoadBehavior"])
        .output()
        .map(|out| out.status.success())
        .unwrap_or(false);

    // Check if Office is running
    let office_detected = super::process::background_command("tasklist.exe")
        .args(["/FI", &format!("IMAGENAME eq {}.exe", office_app.to_lowercase())])
        .output()
        .map(|out| {
            let output = String::from_utf8_lossy(&out.stdout);
            output.contains(&format!("{}.exe", office_app.to_lowercase()))
        })
        .unwrap_or(false);

    // Check VSTO file exists
    let vsto_file_exists = native_office_vsto_manifest(host_name, vsto_file).is_some();

    // Determine state
    let state = if !office_detected {
        HostInstallState::OfficeNotDetected
    } else if registry_key_present && vsto_file_exists {
        HostInstallState::Installed
    } else if registry_key_present || vsto_file_exists {
        HostInstallState::Broken
    } else {
        HostInstallState::NotInstalled
    };

    HostInstallStatus {
        host: host_name.to_string(),
        office_detected,
        registry_key_present,
        manifest_value: None,
        vsto_file_exists,
        load_behavior: if registry_key_present { Some(3) } else { None },
        connected_sessions: 0,
        state,
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
                exe_dir.join("resources").join("NativeOffice").join("LaTeXSnipper.NativeOffice.Bootstrapper.exe"),
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
