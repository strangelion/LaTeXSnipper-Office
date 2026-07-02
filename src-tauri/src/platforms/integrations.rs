use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;

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
        "office" => install_office_vsto(),
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
        "office" => uninstall_office_vsto(),
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
        "office" => check_office_vsto(),
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

    let output = Command::new("powershell")
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
        .arg(&script)
        .args(["-Platform", "x64"])
        .output()
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

fn reg_add_string(key: &str, name: &str, value: &str) -> std::io::Result<()> {
    let mut command = Command::new("reg");
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
    let output = Command::new("reg")
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
    let _ = Command::new("reg").args(["delete", key, "/f"]).output();
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
    reg_delete_tree(&hkcu_classes_key("LaTeXSnipper.Office"));
    reg_delete_tree(&hkcu_classes_key(&format!(
        r"CLSID\{}",
        office_addin_clsid()
    )));
}

fn cleanup_legacy_office_com_addins() {
    for app in ["Word", "PowerPoint"] {
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
    let addin_ok = Command::new("reg")
        .args([
            "query",
            r"HKCU\Software\Microsoft\Office\Word\Addins\LaTeXSnipper.Office",
            "/v",
            "LoadBehavior",
        ])
        .output()
        .map(|out| out.status.success())
        .unwrap_or(false);

    let com_key = hkcu_classes_key(&format!(r"CLSID\{}\InprocServer32", office_addin_clsid()));
    let com_ok = Command::new("reg")
        .args(["query", &com_key, "/v", "CodeBase"])
        .output()
        .map(|out| out.status.success())
        .unwrap_or(false);

    addin_ok && com_ok
}

/// Auto-register the COM add-in on first run (called from app setup).
pub async fn auto_register_office_addin(_app_handle: &tauri::AppHandle) {
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
# Write Word add-in registry entries
$addinKey = 'HKCU:\Software\Microsoft\Office\Word\Addins\LaTeXSnipper.Office'
New-Item -Path $addinKey -Force | Out-Null
Set-ItemProperty -Path $addinKey -Name 'FriendlyName' -Value 'LaTeXSnipper Office'
Set-ItemProperty -Path $addinKey -Name 'Description' -Value 'LaTeXSnipper Office formula add-in'
Set-ItemProperty -Path $addinKey -Name 'LoadBehavior' -Value 3 -Type DWord
Set-ItemProperty -Path $addinKey -Name 'CommandLineSafe' -Value 0 -Type DWord

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

    // Run with UAC elevation
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

    println!("[Office] Registration script launched (UAC prompt may appear).");
}

#[allow(dead_code)]
fn office_vsto_registered() -> bool {
    let roots = [
        r"HKCU\Software\Microsoft\Office\Word\Addins",
        r"HKCU\Software\Microsoft\Office\16.0\Word\Addins",
        r"HKCU\Software\Microsoft\Office\PowerPoint\Addins",
        r"HKCU\Software\Microsoft\Office\16.0\PowerPoint\Addins",
        r"HKLM\Software\Microsoft\Office\Word\Addins",
        r"HKLM\Software\Microsoft\Office\16.0\Word\Addins",
        r"HKLM\Software\Microsoft\Office\PowerPoint\Addins",
        r"HKLM\Software\Microsoft\Office\16.0\PowerPoint\Addins",
    ];
    roots.iter().any(|root| {
        Command::new("reg")
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
    let check = Command::new("reg")
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

    "COM registration started (UAC will appear).".to_string()
}

#[allow(dead_code)]
fn unregister_com_dll() -> String {
    let guid = "A1B2C3D4-E5F6-7890-ABCD-EF1234567890";
    let check = Command::new("reg")
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

    cleanup_legacy_office_com_addins();

    let dll = match build_new_office_addin() {
        Ok(path) => path,
        Err(err) => return PlatformIntegrationResult::fail("office", "com-addin", err),
    };

    for key in office_addin_registry_roots("Word") {
        if let Err(err) = reg_add_string(&key, "FriendlyName", "LaTeXSnipper Office") {
            return PlatformIntegrationResult::fail(
                "office",
                "com-addin",
                format!("写入 Word 加载项注册表失败: {err}"),
            );
        }
        let _ = reg_add_string(&key, "Description", "LaTeXSnipper Office formula add-in");
        let _ = reg_add_dword(&key, "LoadBehavior", 3);
        let _ = reg_add_dword(&key, "CommandLineSafe", 0);
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

fn uninstall_office_vsto() -> PlatformIntegrationResult {
    cleanup_legacy_office_com_addins();

    for app in ["Word", "PowerPoint"] {
        for key in office_addin_registry_roots(app) {
            reg_delete_tree(&key);
        }
    }

    unregister_hkcu_office_com_addin();

    let startup = office_startup_dotm();
    if startup.exists() {
        let backup_dir = office_backup_dir();
        let _ = fs::create_dir_all(&backup_dir);
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let backup_path = backup_dir.join(format!("LaTeXSnipper_legacy_{timestamp}.dotm"));
        let _ = fs::rename(&startup, &backup_path).or_else(|_| fs::remove_file(&startup));
    }

    PlatformIntegrationResult::ok(
        "office",
        "com-addin",
        "新的 Office 加载项注册已卸载，旧 .dotm 残留也已清理。请在 UAC 中确认后重启 Word。",
        true,
    )
}

fn check_office_vsto() -> PlatformIntegrationResult {
    let startup = office_startup_dotm();
    let status = super::office::detect_office_cached();

    if office_com_addin_registered() {
        PlatformIntegrationResult::ok(
            "office",
            "com-addin",
            "新的 Office COM 加载项已注册。",
            false,
        )
    } else if startup.exists() {
        PlatformIntegrationResult::fail(
            "office",
            "legacy-dotm",
            format!(
                "检测到旧 .dotm 残留: {}。关闭开关可清理旧残留。",
                startup.display()
            ),
        )
    } else if !status.installed {
        PlatformIntegrationResult::fail("office", "not_found", "未检测到 Microsoft Office。")
    } else if let Some(dll) = new_office_addin_dll() {
        PlatformIntegrationResult::fail(
            "office",
            "com-addin",
            format!("新的 Office 加载项尚未注册。DLL: {}", dll.display()),
        )
    } else {
        PlatformIntegrationResult::fail(
            "office",
            "com-addin",
            "新的 Office 加载项尚未编译。打开开关会尝试自动编译并注册。",
        )
    }
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
        let vsto_check = Command::new("reg")
            .args(["query", r"HKCU\Software\Microsoft\Office\Word\Addins", "/s"])
            .output()
            .map(|out| String::from_utf8_lossy(&out.stdout).contains("LaTeXSnipper"))
            .unwrap_or(false);

        if vsto_check {
            if let Some(clean) = find_office_force_clean() {
                let _ = Command::new("powershell")
                    .args(["-ExecutionPolicy", "Bypass", "-File"])
                    .arg(&clean)
                    .spawn();
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
        let vsto = Command::new("reg")
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
    let dir = obsidian_staging_dir();
    if let Err(err) = fs::create_dir_all(&dir) {
        return PlatformIntegrationResult::fail(
            "obsidian",
            "plugin",
            format!("Failed to create Obsidian plugin directory: {err}"),
        );
    }

    let manifest = r#"{
  "id": "latexsnipper-office",
  "name": "LaTeXSnipper Office",
  "version": "1.0.0",
  "minAppVersion": "1.4.0",
  "description": "Insert LaTeXSnipper formulas into Obsidian notes.",
  "author": "LaTeXSnipper",
  "isDesktopOnly": true
}
"#;
    let main_js = r#"const { Plugin, Notice } = require('obsidian');

module.exports = class LaTeXSnipperOfficePlugin extends Plugin {
  async onload() {
    this.addCommand({
      id: 'insert-inline-formula',
      name: 'Insert inline formula from clipboard',
      editorCallback: async (editor) => {
        const latex = await navigator.clipboard.readText();
        editor.replaceRange(`$${latex}$`, editor.getCursor());
        new Notice('Inserted inline formula');
      }
    });
    this.addCommand({
      id: 'insert-display-formula',
      name: 'Insert display formula from clipboard',
      editorCallback: async (editor) => {
        const latex = await navigator.clipboard.readText();
        editor.replaceRange(`$$\n${latex}\n$$`, editor.getCursor());
        new Notice('Inserted display formula');
      }
    });
  }
};
"#;

    if let Err(err) = fs::write(dir.join("manifest.json"), manifest) {
        return PlatformIntegrationResult::fail(
            "obsidian",
            "plugin",
            format!("Failed to write Obsidian manifest: {err}"),
        );
    }
    if let Err(err) = fs::write(dir.join("main.js"), main_js) {
        return PlatformIntegrationResult::fail(
            "obsidian",
            "plugin",
            format!("Failed to write Obsidian plugin: {err}"),
        );
    }

    PlatformIntegrationResult::ok(
        "obsidian",
        "plugin",
        format!("Prepared Obsidian plugin at {}. Copy this folder into each vault's .obsidian/plugins folder and enable it in Obsidian.", dir.display()),
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
    fs::create_dir_all(wps_jsaddons_root())?;
    let content = if enabled {
        r#"<?xml version="1.0" encoding="UTF-8"?>
<jsplugins>
    <jspluginonline name="latexsnipper-wps" addonType="wps" online="false" enable="enable_dev"/>
</jsplugins>
"#
    } else {
        r#"<?xml version="1.0" encoding="UTF-8"?>
<jsplugins>
</jsplugins>
"#
    };
    fs::write(wps_publish_file(), content)
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
            "WPS JSAddIn package was not found. Keep LaTeXSnipper/office_plugin/hosts/WpsAddIn beside this project, or bundle the WPS add-in installer files.",
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
