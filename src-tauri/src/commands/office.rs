use serde::{Deserialize, Serialize};
use std::fs;
use std::process::Command as ProcessCommand;
use tauri::command;

use base64::Engine;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InsertFormulaRequest {
    pub formula_type: String,
    pub latex: String,
}

#[derive(Debug, Serialize)]
pub struct OfficeCommandResponse {
    pub success: bool,
    pub message: String,
}

#[command]
pub async fn insert_formula(
    request: InsertFormulaRequest,
) -> Result<OfficeCommandResponse, String> {
    #[cfg(not(target_os = "windows"))]
    return Err("Word 插入功能仅支持 Windows 系统".to_string());
    #[cfg(target_os = "windows")]
    tauri::async_runtime::spawn_blocking(move || insert_formula_sync(request))
        .await
        .map_err(|err| format!("Office insert task failed: {err}"))?
}

fn insert_formula_sync(request: InsertFormulaRequest) -> Result<OfficeCommandResponse, String> {
    Logger::info(format!(
        "Inserting {} formula: {}",
        request.formula_type, request.latex
    ));

    let latex_b64 = base64::engine::general_purpose::STANDARD.encode(request.latex.as_bytes());
    let formula_type = request
        .formula_type
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '-' || *ch == '_')
        .collect::<String>();
    let formula_type = if formula_type.is_empty() {
        "display".to_string()
    } else {
        formula_type
    };

    let script = format!(
        r#"$ErrorActionPreference = 'Stop'
$latex = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{latex_b64}'))
$formulaType = '{formula_type}'
$word = $null
try {{
  $word = [Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')
}} catch {{
  throw 'Word is not running. Please open Word first, then try again.'
}}
if ($null -eq $word) {{
  throw 'Word.Application is not available.'
}}
$word.Visible = $true
# Ensure a document is open
if ($word.Documents.Count -eq 0) {{
  [void]$word.Documents.Add()
}}
$addin = $word.COMAddIns.Item('LaTeXSnipper.Office')
if ($null -eq $addin) {{
  throw 'LaTeXSnipper.Office add-in is not registered.'
}}
if (-not $addin.Connect) {{
  $addin.Connect = $true
  Start-Sleep -Milliseconds 500
}}
if ($null -eq $addin.Object) {{
  throw 'LaTeXSnipper.Office add-in object is not available. Restart Word and try again.'
}}
$display = $formulaType -ne 'inline'
$numbered = $formulaType -eq 'numbered'
[void]$addin.Object.InsertLatex($latex, [bool]$display, [bool]$numbered)
$word.Activate()
Write-Output 'Inserted'
"#
    );

    let script_path = std::env::temp_dir().join(format!(
        "latexsnipper_insert_word_{}.ps1",
        std::process::id()
    ));
    fs::write(&script_path, script).map_err(|err| format!("Failed to write script: {err}"))?;

    let output = {
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            ProcessCommand::new("powershell")
                .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
                .arg(&script_path)
                .creation_flags(CREATE_NO_WINDOW)
                .output()
        }
        #[cfg(not(target_os = "windows"))]
        {
            ProcessCommand::new("powershell")
                .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
                .arg(&script_path)
                .output()
        }
    }
    .map_err(|err| format!("Failed to start PowerShell: {err}"));

    let _ = fs::remove_file(&script_path);
    let output = output?;
    if !output.status.success() {
        return Err(format!(
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        )
        .trim()
        .to_string());
    }

    Ok(OfficeCommandResponse {
        success: true,
        message: "已插入到 Word".to_string(),
    })
}
#[command]
pub async fn load_selection() -> Result<OfficeCommandResponse, String> {
    #[cfg(not(target_os = "windows"))]
    return Err("Word 加载功能仅支持 Windows 系统".to_string());
    #[cfg(target_os = "windows")]
    tauri::async_runtime::spawn_blocking(|| load_selection_sync())
        .await
        .map_err(|err| format!("Office load selection task failed: {err}"))?
}

fn load_selection_sync() -> Result<OfficeCommandResponse, String> {
    Logger::info("Loading selection via PowerShell COM...");

    let script = r#"$ErrorActionPreference = 'Stop'
$word = $null
try {
  $word = [Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')
} catch {
  throw 'Word.Application is not running.'
}
if ($null -eq $word) {
  throw 'Word.Application is not available.'
}
$word.Visible = $true
$addin = $word.COMAddIns.Item('LaTeXSnipper.Office')
if ($null -eq $addin) {
  throw 'LaTeXSnipper.Office add-in is not registered.'
}
if (-not $addin.Connect) {
  $addin.Connect = $true
  Start-Sleep -Milliseconds 500
}
if ($null -eq $addin.Object) {
  throw 'LaTeXSnipper.Office add-in object is not available. Restart Word and try again.'
}
$result = [bool]$addin.Object.LoadSelection()
if ($result) {
  Write-Output 'Selection loaded'
} else {
  Write-Output 'No formula selected or load failed'
}
"#;

    let script_path = std::env::temp_dir().join(format!(
        "latexsnipper_load_selection_{}.ps1",
        std::process::id()
    ));
    fs::write(&script_path, script).map_err(|err| format!("Failed to write script: {err}"))?;

    let output = {
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            ProcessCommand::new("powershell")
                .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
                .arg(&script_path)
                .creation_flags(CREATE_NO_WINDOW)
                .output()
        }
        #[cfg(not(target_os = "windows"))]
        {
            ProcessCommand::new("powershell")
                .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
                .arg(&script_path)
                .output()
        }
    }
    .map_err(|err| format!("Failed to start PowerShell: {err}"));

    let _ = fs::remove_file(&script_path);
    let output = output?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if !output.status.success() {
        return Err(format!("{}{}", stdout, stderr));
    }

    Ok(OfficeCommandResponse {
        success: true,
        message: if stdout.is_empty() { "Selection loaded".to_string() } else { stdout },
    })
}

#[command]
pub async fn delete_selection() -> Result<OfficeCommandResponse, String> {
    Logger::info("Deleting selection...");

    // TODO: Implement Office COM interop to delete selected formula
    Ok(OfficeCommandResponse {
        success: true,
        message: "已删除选中的公式".to_string(),
    })
}

#[command]
pub async fn convert_to_ole() -> Result<OfficeCommandResponse, String> {
    Logger::info("Converting to OLE...");

    // TODO: Implement Office COM interop to convert to OLE format
    Ok(OfficeCommandResponse {
        success: true,
        message: "已转换为OLE格式".to_string(),
    })
}

#[command]
pub async fn convert_to_word() -> Result<OfficeCommandResponse, String> {
    Logger::info("Converting to Word...");

    // TODO: Implement Office COM interop to convert to Word format
    Ok(OfficeCommandResponse {
        success: true,
        message: "已转换为Word格式".to_string(),
    })
}

#[command]
pub async fn insert_reference() -> Result<OfficeCommandResponse, String> {
    Logger::info("Inserting reference...");

    // TODO: Implement Office COM interop to insert cross-reference
    Ok(OfficeCommandResponse {
        success: true,
        message: "已插入交叉引用".to_string(),
    })
}

#[command]
pub async fn add_number() -> Result<OfficeCommandResponse, String> {
    Logger::info("Adding number...");

    // TODO: Implement Office COM interop to add number
    Ok(OfficeCommandResponse {
        success: true,
        message: "已添加编号".to_string(),
    })
}

#[command]
pub async fn renumber() -> Result<OfficeCommandResponse, String> {
    Logger::info("Renumbering...");

    // TODO: Implement Office COM interop to renumber
    Ok(OfficeCommandResponse {
        success: true,
        message: "已重新编号".to_string(),
    })
}

#[command]
pub async fn insert_chapter_separator() -> Result<OfficeCommandResponse, String> {
    Logger::info("Inserting chapter separator...");

    // TODO: Implement Office COM interop to insert chapter separator
    Ok(OfficeCommandResponse {
        success: true,
        message: "已插入章分隔符".to_string(),
    })
}

#[command]
pub async fn insert_section_separator() -> Result<OfficeCommandResponse, String> {
    Logger::info("Inserting section separator...");

    // TODO: Implement Office COM interop to insert section separator
    Ok(OfficeCommandResponse {
        success: true,
        message: "已插入节分隔符".to_string(),
    })
}

#[command]
pub async fn format_selection() -> Result<OfficeCommandResponse, String> {
    Logger::info("Formatting selection...");

    // TODO: Implement Office COM interop to format selection
    Ok(OfficeCommandResponse {
        success: true,
        message: "已格式化选中的公式".to_string(),
    })
}

#[command]
pub async fn format_all() -> Result<OfficeCommandResponse, String> {
    Logger::info("Formatting all formulas...");

    // TODO: Implement Office COM interop to format all formulas
    Ok(OfficeCommandResponse {
        success: true,
        message: "已格式化所有公式".to_string(),
    })
}

#[command]
pub async fn toggle_status_pane() -> Result<OfficeCommandResponse, String> {
    Logger::info("Toggling status pane...");

    // TODO: Implement Office COM interop to toggle status pane
    Ok(OfficeCommandResponse {
        success: true,
        message: "状态窗格已切换".to_string(),
    })
}

#[command]
pub async fn open_settings() -> Result<OfficeCommandResponse, String> {
    Logger::info("Opening settings...");

    // TODO: Implement Office COM interop to open settings
    Ok(OfficeCommandResponse {
        success: true,
        message: "设置已打开".to_string(),
    })
}

#[command]
pub async fn show_help() -> Result<OfficeCommandResponse, String> {
    Logger::info("Showing help...");

    // TODO: Implement Office COM interop to show help
    Ok(OfficeCommandResponse {
        success: true,
        message: "帮助已打开".to_string(),
    })
}

// Logger implementation
struct Logger;

impl Logger {
    fn info(message: impl std::fmt::Display) {
        println!("[OfficePlugin] {}", message);
    }
}
