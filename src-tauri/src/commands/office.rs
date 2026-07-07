use serde::{Deserialize, Serialize};
use tauri::command;

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
    Logger::info(format!(
        "Insert formula requested (via taskpane): {}={}",
        request.formula_type, request.latex
    ));
    Ok(OfficeCommandResponse {
        success: true,
        message: "请在 Word 任务窗格中粘贴公式并点击「插入」按钮。".to_string(),
    })
}

#[command]
pub async fn load_selection() -> Result<OfficeCommandResponse, String> {
    Logger::info("Load selection requested (via taskpane)");
    Ok(OfficeCommandResponse {
        success: true,
        message: "请选中 Word 中的公式，然后在任务窗格中点击「加载公式」。".to_string(),
    })
}

#[command]
pub async fn delete_selection() -> Result<OfficeCommandResponse, String> {
    Logger::info("Delete selection requested (use taskpane)");
    Ok(OfficeCommandResponse {
        success: true,
        message: "请选中公式后在 Word 任务窗格中点击「删除」。".to_string(),
    })
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
    Logger::info("Add number requested (use taskpane)");
    Ok(OfficeCommandResponse {
        success: true,
        message: "请在插入公式时选择「编号」模式。".to_string(),
    })
}

#[command]
pub async fn renumber() -> Result<OfficeCommandResponse, String> {
    Logger::info("Renumber requested (use taskpane)");
    Ok(OfficeCommandResponse {
        success: true,
        message: "请通过 Word 任务窗格操作公式编号。".to_string(),
    })
}

#[command]
pub async fn insert_chapter_separator() -> Result<OfficeCommandResponse, String> {
    Logger::info("Insert chapter separator (use taskpane)");
    Ok(OfficeCommandResponse {
        success: true,
        message: "请通过 Word 任务窗格插入章分隔符。".to_string(),
    })
}

#[command]
pub async fn insert_section_separator() -> Result<OfficeCommandResponse, String> {
    Logger::info("Insert section separator (use taskpane)");
    Ok(OfficeCommandResponse {
        success: true,
        message: "请通过 Word 任务窗格插入节分隔符。".to_string(),
    })
}

#[command]
pub async fn format_selection() -> Result<OfficeCommandResponse, String> {
    Logger::info("Format selection (use taskpane)");
    Ok(OfficeCommandResponse {
        success: true,
        message: "格式调整请在 LaTeXSnipper 编辑器中完成。".to_string(),
    })
}

#[command]
pub async fn format_all() -> Result<OfficeCommandResponse, String> {
    Logger::info("Format all (use taskpane)");
    Ok(OfficeCommandResponse {
        success: true,
        message: "格式调整请在 LaTeXSnipper 编辑器中完成。".to_string(),
    })
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
    Ok(OfficeCommandResponse {
        success: false,
        message: "Word 表格读取尚未实现。请通过任务窗格操作。".to_string(),
    })
}

#[allow(dead_code)]
/// DEPRECATED: Previously used PowerShell + COMAddIn to call Word VBA methods.
/// Now all document operations go through Office.js taskpane via the Bridge API.
fn run_com_addin_method(
    method_call: &str,
    success_msg: &str,
) -> Result<OfficeCommandResponse, String> {
    eprintln!(
        "[Office] WARNING: run_com_addin_method is deprecated. Use Office.js taskpane instead."
    );
    eprintln!("[Office] Method was: {}", method_call);
    Ok(OfficeCommandResponse {
        success: true,
        message: success_msg.to_string(),
    })
}

// Logger implementation
struct Logger;

impl Logger {
    fn info(message: impl std::fmt::Display) {
        println!("[Office] {}", message);
    }
}
