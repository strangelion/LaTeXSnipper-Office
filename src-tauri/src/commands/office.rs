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

# Write pending formula for VBA to pick up
$pendingPath = Join-Path $env:TEMP 'latexsnipper_pending.txt'
$pendingData = '{{"latex":"' + $latex.Replace('\', '\\').Replace('"', '\"') + '","fontColor":"","fontStyle":"tex"}}'
[System.IO.File]::WriteAllText($pendingPath, $pendingData, [System.Text.Encoding]::UTF8)

# Get Word application
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
if ($word.Documents.Count -eq 0) {{
  [void]$word.Documents.Add()
}}

# Try to run VBA macro
$display = $formulaType -ne 'inline'
$macroName = if ($display) {{ "LaTeXSnipper.LaTeXInsertDisplayFormula" }} else {{ "LaTeXSnipper.LaTeXInsertInlineFormula" }}
try {{
  $word.Run($macroName)
  Write-Output 'Inserted via VBA'
}} catch {{
  Write-Warning "VBA macro failed: $($_.Exception.Message)"
  Write-Output 'Pending formula saved'
}}
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
    Logger::info("Loading selection via PowerShell VBA...");

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

# Try to run VBA macro for loading selection
try {
  $word.Run("LaTeXSnipper.LaTeXLoadSelectionXml")
  Write-Output 'Selection loaded via VBA'
} catch {
  Write-Warning "VBA load failed: $($_.Exception.Message)"
  
  # Fallback: try to find OMML in selection directly
  $selection = $word.Selection
  $range = $selection.Range
  
  try {
    $math = $range.OMaths
    $mathCount = $math.Count
    if ($mathCount -gt 0) {
      $mathItem = $math.Item(1)
      $mathRange = $mathItem.Range
      $xml = $mathRange.WordOpenXML
      if ($xml -match '<m:oMath') {
        $body = '{"omml":"' + ($xml -replace '"', '\"') + '"}'
        try {
          Invoke-WebRequest -Uri 'http://127.0.0.1:19876/api/office/load-selection-omml' -Method POST -Body $body -ContentType 'application/json' -TimeoutSec 5 | Out-Null
          Write-Output 'Selection loaded'
        } catch {
          Write-Warning "Bridge load failed: $($_.Exception.Message)"
          Write-Output 'No formula found'
        }
      }
    }
  } catch {
    Write-Warning "Math search failed: $($_.Exception.Message)"
    Write-Output 'No formula found'
  }
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
    #[cfg(not(target_os = "windows"))]
    return Err("此功能仅支持 Windows 系统".to_string());
    #[cfg(target_os = "windows")]
    tauri::async_runtime::spawn_blocking(|| {
        run_com_addin_method("[void]$addin.Object.DeleteSelection()", "已删除选中的公式")
    })
    .await
    .map_err(|err| format!("Task failed: {err}"))?
}

#[command]
pub async fn convert_to_ole() -> Result<OfficeCommandResponse, String> {
    Logger::info("Converting to OLE...");
    // OLE conversion requires native DLL support - not yet implemented
    Ok(OfficeCommandResponse {
        success: false,
        message: "OLE 转换需要原生 DLL 支持，将在后续版本实现".to_string(),
    })
}

#[command]
pub async fn convert_to_word() -> Result<OfficeCommandResponse, String> {
    Logger::info("Converting to Word...");
    // Word native format conversion - not yet implemented
    Ok(OfficeCommandResponse {
        success: false,
        message: "Word 原生格式转换将在后续版本实现".to_string(),
    })
}

#[command]
pub async fn insert_reference() -> Result<OfficeCommandResponse, String> {
    Logger::info("Inserting reference...");
    // Cross-reference insertion - not yet implemented
    Ok(OfficeCommandResponse {
        success: false,
        message: "交叉引用插入将在后续版本实现".to_string(),
    })
}

#[command]
pub async fn add_number() -> Result<OfficeCommandResponse, String> {
    Logger::info("Adding number...");
    #[cfg(not(target_os = "windows"))]
    return Err("此功能仅支持 Windows 系统".to_string());
    #[cfg(target_os = "windows")]
    tauri::async_runtime::spawn_blocking(|| {
        run_com_addin_method("[void]$addin.Object.AutoNumberSelected()", "已添加编号")
    })
    .await
    .map_err(|err| format!("Task failed: {err}"))?
}

#[command]
pub async fn renumber() -> Result<OfficeCommandResponse, String> {
    Logger::info("Renumbering...");
    #[cfg(not(target_os = "windows"))]
    return Err("此功能仅支持 Windows 系统".to_string());
    #[cfg(target_os = "windows")]
    tauri::async_runtime::spawn_blocking(|| {
        run_com_addin_method("[void]$addin.Object.RenumberAll()", "已重新编号")
    })
    .await
    .map_err(|err| format!("Task failed: {err}"))?
}

#[command]
pub async fn insert_chapter_separator() -> Result<OfficeCommandResponse, String> {
    Logger::info("Inserting chapter separator...");
    #[cfg(not(target_os = "windows"))]
    return Err("此功能仅支持 Windows 系统".to_string());
    #[cfg(target_os = "windows")]
    tauri::async_runtime::spawn_blocking(|| {
        run_com_addin_method("[void]$addin.Object.InsertChapterSeparator()", "已插入章分隔符")
    })
    .await
    .map_err(|err| format!("Task failed: {err}"))?
}

#[command]
pub async fn insert_section_separator() -> Result<OfficeCommandResponse, String> {
    Logger::info("Inserting section separator...");
    #[cfg(not(target_os = "windows"))]
    return Err("此功能仅支持 Windows 系统".to_string());
    #[cfg(target_os = "windows")]
    tauri::async_runtime::spawn_blocking(|| {
        run_com_addin_method("[void]$addin.Object.InsertSectionSeparator()", "已插入节分隔符")
    })
    .await
    .map_err(|err| format!("Task failed: {err}"))?
}

#[command]
pub async fn format_selection() -> Result<OfficeCommandResponse, String> {
    Logger::info("Formatting selection...");
    #[cfg(not(target_os = "windows"))]
    return Err("此功能仅支持 Windows 系统".to_string());
    #[cfg(target_os = "windows")]
    tauri::async_runtime::spawn_blocking(|| {
        run_com_addin_method("[void]$addin.Object.FormatSelected()", "已格式化选中的公式")
    })
    .await
    .map_err(|err| format!("Task failed: {err}"))?
}

#[command]
pub async fn format_all() -> Result<OfficeCommandResponse, String> {
    Logger::info("Formatting all formulas...");
    #[cfg(not(target_os = "windows"))]
    return Err("此功能仅支持 Windows 系统".to_string());
    #[cfg(target_os = "windows")]
    tauri::async_runtime::spawn_blocking(|| {
        run_com_addin_method("[void]$addin.Object.FormatAll()", "已格式化所有公式")
    })
    .await
    .map_err(|err| format!("Task failed: {err}"))?
}

#[command]
pub async fn toggle_status_pane() -> Result<OfficeCommandResponse, String> {
    Logger::info("Toggling status pane...");
    // UI toggle - handled by frontend
    Ok(OfficeCommandResponse {
        success: true,
        message: "状态窗格已切换".to_string(),
    })
}

#[command]
pub async fn open_settings() -> Result<OfficeCommandResponse, String> {
    Logger::info("Opening settings...");
    // Settings - handled by frontend
    Ok(OfficeCommandResponse {
        success: true,
        message: "设置已打开".to_string(),
    })
}

#[command]
pub async fn show_help() -> Result<OfficeCommandResponse, String> {
    Logger::info("Showing help...");
    // Help - handled by frontend
    Ok(OfficeCommandResponse {
        success: true,
        message: "帮助已打开".to_string(),
    })
}

#[command]
pub async fn load_table() -> Result<OfficeCommandResponse, String> {
    Logger::info("Loading table...");
    #[cfg(not(target_os = "windows"))]
    return Err("此功能仅支持 Windows 系统".to_string());
    #[cfg(target_os = "windows")]
    tauri::async_runtime::spawn_blocking(|| {
        let script = r#"$ErrorActionPreference = 'Stop'
$word = $null
try {
  $word = [Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')
} catch {
  throw 'Word is not running. Please open Word first, then try again.'
}
if ($null -eq $word) {
  throw 'Word.Application is not available.'
}
$word.Visible = $true
if ($word.Documents.Count -eq 0) {
  [void]$word.Documents.Add()
}
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
$result = $addin.Object.LoadTable()
Write-Output $result
"#;

        let script_path = std::env::temp_dir().join(format!(
            "latexsnipper_load_table_{}.ps1",
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

        let json = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(OfficeCommandResponse {
            success: true,
            message: json,
        })
    })
    .await
    .map_err(|err| format!("Task failed: {err}"))?
}

// Logger implementation
struct Logger;

impl Logger {
    fn info(message: impl std::fmt::Display) {
        let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
        println!("[{}] [INFO] [Office] {}", timestamp, message);
    }

    fn warn(message: impl std::fmt::Display) {
        let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
        eprintln!("[{}] [WARN] [Office] {}", timestamp, message);
    }

    fn error(message: impl std::fmt::Display) {
        let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
        eprintln!("[{}] [ERROR] [Office] {}", timestamp, message);
    }
}

/// Generate and run a PowerShell script that calls a COM add-in method.
fn run_com_addin_method(method_call: &str, success_msg: &str) -> Result<OfficeCommandResponse, String> {
    let script = format!(
        r#"$ErrorActionPreference = 'Stop'
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
{method_call}
Write-Output 'OK'
"#
    );

    let script_path = std::env::temp_dir().join(format!(
        "latexsnipper_com_{}.ps1",
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
        message: success_msg.to_string(),
    })
}
