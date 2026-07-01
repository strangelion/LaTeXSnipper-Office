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
pub fn install_platform_integration(platform_id: String) -> PlatformIntegrationResult {
    match platform_id.as_str() {
        "office" => install_office(),
        "obsidian" => install_obsidian(),
        "vscode" => install_vscode(),
        "wps" => install_wps(),
        "typora" => install_clipboard_platform("typora", "Typora uses Markdown math via clipboard: inline $...$ or display $$...$$."),
        "notion" => install_clipboard_platform("notion", "Notion has no local plugin API. LaTeXSnipper will use clipboard equations for Notion."),
        "libreoffice" => install_libreoffice(),
        other => PlatformIntegrationResult::fail(other, "unknown", "Unsupported platform."),
    }
}

#[tauri::command]
pub fn uninstall_platform_integration(platform_id: String) -> PlatformIntegrationResult {
    match platform_id.as_str() {
        "office" => uninstall_office(),
        "obsidian" => remove_generated_dir("obsidian", "plugin", obsidian_staging_dir()),
        "vscode" => remove_generated_dir("vscode", "plugin", vscode_extension_dir()),
        "wps" => uninstall_wps(),
        "typora" => remove_generated_dir("typora", "clipboard", integration_state_dir().join("typora")),
        "notion" => remove_generated_dir("notion", "clipboard", integration_state_dir().join("notion")),
        "libreoffice" => remove_generated_dir("libreoffice", "extension-stub", integration_state_dir().join("libreoffice")),
        other => PlatformIntegrationResult::fail(other, "unknown", "Unsupported platform."),
    }
}

#[tauri::command]
pub fn check_platform_integration(platform_id: String) -> PlatformIntegrationResult {
    match platform_id.as_str() {
        "office" => check_office(),
        "obsidian" => check_path("obsidian", "plugin", obsidian_staging_dir(), "Obsidian plugin package is prepared."),
        "vscode" => check_path("vscode", "plugin", vscode_extension_dir(), "VS Code extension is installed."),
        "wps" => check_wps(),
        "typora" => check_path("typora", "clipboard", integration_state_dir().join("typora"), "Typora clipboard integration is enabled."),
        "notion" => check_path("notion", "clipboard", integration_state_dir().join("notion"), "Notion clipboard integration is enabled."),
        "libreoffice" => check_path("libreoffice", "extension-stub", integration_state_dir().join("libreoffice"), "LibreOffice extension scaffold is prepared."),
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

fn office_startup_dotm() -> PathBuf {
    dirs_next::data_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("Microsoft")
        .join("Word")
        .join("STARTUP")
        .join("LaTeXSnipper.dotm")
}

fn office_backup_dir() -> PathBuf {
    app_data_dir().join("office-backups")
}

fn build_word_addin_script() -> Option<PathBuf> {
    let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();

    // Check relative to exe (bundled resources)
    let bundled = exe_dir.join("resources").join("build_word_addin.py");
    if bundled.exists() {
        return Some(bundled);
    }

    // Check relative to source tree
    if let Some(github_root) = github_root_from_manifest() {
        let src = github_root
            .join("LaTeXSnipper-Office")
            .join("scripts")
            .join("build_word_addin.py");
        if src.exists() {
            return Some(src);
        }
    }

    None
}

fn python_exe() -> Option<String> {
    // Prefer miniconda Python (has pywin32)
    let miniconda = std::env::var("USERPROFILE")
        .ok()
        .map(|p| format!("{p}\\miniconda3\\python.exe"))
        .filter(|p| std::path::Path::new(p).exists());
    if let Some(p) = miniconda {
        return Some(p);
    }
    Some("python".to_string())
}

fn install_office() -> PlatformIntegrationResult {
    let startup = office_startup_dotm();

    // Check if already installed
    if startup.exists() {
        // Backup old version
        let backup_dir = office_backup_dir();
        if let Err(err) = fs::create_dir_all(&backup_dir) {
            return PlatformIntegrationResult::fail(
                "office",
                "dotm",
                format!("Failed to create backup directory: {err}"),
            );
        }
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let backup_path = backup_dir.join(format!("LaTeXSnipper_{timestamp}.dotm"));
        if let Err(err) = fs::copy(&startup, &backup_path) {
            return PlatformIntegrationResult::fail(
                "office",
                "dotm",
                format!("Failed to backup existing .dotm: {err}"),
            );
        }
        println!("[Office] Backed up existing .dotm to {}", backup_path.display());
    }

    // Run build script
    let Some(script) = build_word_addin_script() else {
        return PlatformIntegrationResult::fail(
            "office",
            "dotm",
            "build_word_addin.py not found. Cannot build .dotm add-in.",
        );
    };
    let python = python_exe().unwrap_or_else(|| "python".to_string());

    match Command::new(&python)
        .arg(&script)
        .current_dir(script.parent().unwrap_or(std::path::Path::new(".")))
        .output()
    {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            if output.status.success() && startup.exists() {
                PlatformIntegrationResult::ok(
                    "office",
                    "dotm",
                    format!(
                        "LaTeXSnipper.dotm installed to Word STARTUP.{} Restart Word to load.",
                        if startup.exists() && !stdout.is_empty() { "" } else { "" }
                    ),
                    true,
                )
            } else {
                PlatformIntegrationResult::fail(
                    "office",
                    "dotm",
                    format!("Build failed: {stdout} {stderr}"),
                )
            }
        }
        Err(err) => PlatformIntegrationResult::fail(
            "office",
            "dotm",
            format!("Failed to run build script: {err}"),
        ),
    }
}

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
        Ok(_) => PlatformIntegrationResult::ok(
            "office",
            "dotm",
            "Removed LaTeXSnipper.dotm from Word STARTUP. Restart Word to unload.",
            true,
        ),
        Err(err) => PlatformIntegrationResult::fail(
            "office",
            "dotm",
            format!("Failed to remove .dotm: {err}. Close Word and try again."),
        ),
    }
}

fn check_office() -> PlatformIntegrationResult {
    let startup = office_startup_dotm();

    if startup.exists() {
        let size = fs::metadata(&startup).map(|m| m.len()).unwrap_or(0);
        PlatformIntegrationResult::ok(
            "office",
            "dotm",
            format!("LaTeXSnipper.dotm is installed ({} KB).", size / 1024),
            false,
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
        } else if build_word_addin_script().is_some() {
            PlatformIntegrationResult::fail(
                "office",
                "dotm",
                "LaTeXSnipper is not installed. Enable to build and install the .dotm add-in.",
            )
        } else {
            PlatformIntegrationResult::fail(
                "office",
                "dotm",
                "LaTeXSnipper is not installed and build_word_addin.py was not found.",
            )
        }
    }
}

fn obsidian_staging_dir() -> PathBuf {
    integration_state_dir().join("obsidian").join("latexsnipper-office")
}

fn install_obsidian() -> PlatformIntegrationResult {
    let dir = obsidian_staging_dir();
    if let Err(err) = fs::create_dir_all(&dir) {
        return PlatformIntegrationResult::fail("obsidian", "plugin", format!("Failed to create Obsidian plugin directory: {err}"));
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
        return PlatformIntegrationResult::fail("obsidian", "plugin", format!("Failed to write Obsidian manifest: {err}"));
    }
    if let Err(err) = fs::write(dir.join("main.js"), main_js) {
        return PlatformIntegrationResult::fail("obsidian", "plugin", format!("Failed to write Obsidian plugin: {err}"));
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
        return PlatformIntegrationResult::fail("vscode", "plugin", format!("Failed to create VS Code extension directory: {err}"));
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
        return PlatformIntegrationResult::fail("vscode", "plugin", format!("Failed to write VS Code package.json: {err}"));
    }
    if let Err(err) = fs::write(dir.join("extension.js"), extension_js) {
        return PlatformIntegrationResult::fail("vscode", "plugin", format!("Failed to write VS Code extension.js: {err}"));
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
            return PlatformIntegrationResult::fail("wps", "wps-jsaddin", format!("Failed to refresh WPS add-in directory: {err}"));
        }
    }
    if let Err(err) = copy_dir_recursive(&source, &plugin_dir) {
        return PlatformIntegrationResult::fail("wps", "wps-jsaddin", format!("Failed to install WPS add-in files: {err}"));
    }
    if let Err(err) = write_wps_publish(true) {
        return PlatformIntegrationResult::fail("wps", "wps-jsaddin", format!("Failed to update WPS publish.xml: {err}"));
    }

    PlatformIntegrationResult::ok(
        "wps",
        "wps-jsaddin",
        format!("Installed WPS JSAddIn at {}. Close and restart WPS to load LaTeXSnipper.", plugin_dir.display()),
        true,
    )
}

fn uninstall_wps() -> PlatformIntegrationResult {
    let plugin_dir = wps_plugin_dir();
    if plugin_dir.exists() {
        if let Err(err) = fs::remove_dir_all(&plugin_dir) {
            return PlatformIntegrationResult::fail("wps", "wps-jsaddin", format!("Failed to remove WPS add-in files: {err}"));
        }
    }
    if let Err(err) = write_wps_publish(false) {
        return PlatformIntegrationResult::fail("wps", "wps-jsaddin", format!("Failed to update WPS publish.xml: {err}"));
    }

    PlatformIntegrationResult::ok("wps", "wps-jsaddin", "Removed WPS JSAddIn files. Restart WPS to unload LaTeXSnipper.", true)
}

fn check_wps() -> PlatformIntegrationResult {
    let plugin_dir = wps_plugin_dir();
    let publish = wps_publish_file();
    let publish_enabled = fs::read_to_string(&publish)
        .map(|content| content.contains("latexsnipper-wps"))
        .unwrap_or(false);

    if plugin_dir.exists() && publish_enabled {
        PlatformIntegrationResult::ok("wps", "wps-jsaddin", "WPS JSAddIn appears to be installed.", false)
    } else if wps_addin_source_dir().is_some() {
        PlatformIntegrationResult::fail("wps", "wps-jsaddin", "WPS JSAddIn package is available but not installed.")
    } else {
        PlatformIntegrationResult::fail("wps", "wps-jsaddin", "WPS JSAddIn is not installed and no source package was found.")
    }
}

fn install_libreoffice() -> PlatformIntegrationResult {
    let dir = integration_state_dir().join("libreoffice");
    if let Err(err) = fs::create_dir_all(&dir) {
        return PlatformIntegrationResult::fail("libreoffice", "extension-stub", format!("Failed to prepare LibreOffice integration: {err}"));
    }
    let _ = fs::write(dir.join("README.txt"), "LibreOffice integration scaffold. Use MathML export or clipboard insertion until an .oxt extension is implemented.\n");
    PlatformIntegrationResult::ok("libreoffice", "extension-stub", format!("Prepared LibreOffice integration scaffold at {}.", dir.display()), false)
}

fn install_clipboard_platform(platform: &str, message: &str) -> PlatformIntegrationResult {
    let dir = integration_state_dir().join(platform);
    if let Err(err) = fs::create_dir_all(&dir) {
        return PlatformIntegrationResult::fail(platform, "clipboard", format!("Failed to enable clipboard integration: {err}"));
    }
    let mut file = match fs::File::create(dir.join("README.txt")) {
        Ok(file) => file,
        Err(err) => return PlatformIntegrationResult::fail(platform, "clipboard", format!("Failed to write integration notes: {err}")),
    };
    let _ = writeln!(file, "{message}");
    PlatformIntegrationResult::ok(platform, "clipboard", message, false)
}

fn remove_generated_dir(platform: &str, mode: &str, dir: PathBuf) -> PlatformIntegrationResult {
    if !dir.exists() {
        return PlatformIntegrationResult::ok(platform, mode, "Integration is already disabled.", false);
    }
    match fs::remove_dir_all(&dir) {
        Ok(_) => PlatformIntegrationResult::ok(platform, mode, format!("Removed integration files from {}.", dir.display()), true),
        Err(err) => PlatformIntegrationResult::fail(platform, mode, format!("Failed to remove integration files: {err}")),
    }
}

fn check_path(platform: &str, mode: &str, path: PathBuf, ok_message: &str) -> PlatformIntegrationResult {
    if path.exists() {
        PlatformIntegrationResult::ok(platform, mode, ok_message, false)
    } else {
        PlatformIntegrationResult::fail(platform, mode, "Integration is not installed.")
    }
}

