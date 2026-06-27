use axum::{
    extract::State,
    response::IntoResponse,
    routing::post,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::process::Command;
use std::sync::Arc;
use tauri::Emitter;
use tokio::net::TcpListener;
use tokio::sync::{oneshot, Mutex};

pub const BRIDGE_PORT: u16 = 19876;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConvertRequest {
    pub latex: String,
    #[serde(default)]
    pub display: bool,
    #[serde(default)]
    pub font_style: Option<String>,
    #[serde(default)]
    pub font_color: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoadSelectionRequest {
    pub text: String,
}

#[derive(Debug, Serialize)]
pub struct ConvertResponse {
    pub success: bool,
    pub omml: String,
}

#[derive(Debug, Serialize)]
pub struct OfficeResponse {
    pub success: bool,
    pub message: String,
}

#[derive(Clone)]
struct BridgeState {
    app_handle: tauri::AppHandle,
    pending_renders: Arc<Mutex<HashMap<String, oneshot::Sender<String>>>>,
}

// ═══════════════════════════════════════════
// MathML → OMML via Python lxml + MML2OMML.XSL
// ═══════════════════════════════════════════

fn find_mml2omml_xsl() -> Option<String> {
    let prog_files = std::env::var("ProgramFiles").unwrap_or_default();
    let prog_x86 = std::env::var("ProgramFiles(x86)").unwrap_or_default();
    for base in &[prog_files, prog_x86] {
        for sub in &[
            r"Microsoft Office\root\Office16\MML2OMML.XSL",
            r"Microsoft Office\Office16\MML2OMML.XSL",
            r"Microsoft Office\root\Office15\MML2OMML.XSL",
            r"Microsoft Office\Office15\MML2OMML.XSL",
        ] {
            let p = format!("{}\\{}", base, sub);
            if std::path::Path::new(&p).exists() {
                return Some(p);
            }
        }
    }
    None
}

fn mathml_to_omml(mathml: &str, font_color: &Option<String>, font_style: &Option<String>) -> Option<String> {
    let xsl_path = find_mml2omml_xsl()?;
    let python_paths = ["C:\\Users\\WangWenXuan\\miniconda3\\python.exe", "python"];

    let color_arg = font_color.clone().unwrap_or_default();
    let style_arg = font_style.clone().unwrap_or_default();

    let script = format!(
        r#"
import sys
from lxml import etree

mathml_data = sys.stdin.buffer.read()
tree = etree.fromstring(mathml_data)

xslt = etree.parse(r'{}')
omml = etree.XSLT(xslt)(tree)

sys.stdout.buffer.write(etree.tostring(omml, encoding='utf-8', xml_declaration=True))
"#,
        xsl_path.replace('\\', "\\\\")
    );

    for python_path in &python_paths {
        let output = Command::new(python_path)
            .arg("-c")
            .arg(&script)
            .arg(&color_arg)
            .arg(&style_arg)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn();

        match output {
            Ok(mut child) => {
                if let Some(mut stdin) = child.stdin.take() {
                    use std::io::Write;
                    let _ = stdin.write_all(mathml.as_bytes());
                }
                if let Ok(result) = child.wait_with_output() {
                    if result.status.success() {
                        let omml = String::from_utf8_lossy(&result.stdout).to_string();
                        if !omml.is_empty() {
                            return Some(omml);
                        }
                    }
                }
            }
            Err(_) => continue,
        }
    }
    None
}

// ═══════════════════════════════════════════
// Bridge Server
// ═══════════════════════════════════════════

pub async fn start_bridge_server(app_handle: tauri::AppHandle) {
    let state = BridgeState {
        app_handle: app_handle.clone(),
        pending_renders: Arc::new(Mutex::new(HashMap::new())),
    };

    let app = Router::new()
        .route("/api/office/convert", post(handle_convert))
        .route("/api/office/render-formula", post(handle_render_formula))
        .route("/api/office/render-result", post(handle_render_result))
        .route("/api/office/load-selection", post(handle_load_selection))
        .route("/api/office/show-app", post(handle_show_app))
        .layer(
            tower_http::cors::CorsLayer::permissive()
                .allow_origin(tower_http::cors::Any)
                .allow_methods(tower_http::cors::Any)
                .allow_headers(tower_http::cors::Any),
        )
        .with_state(Arc::new(state));

    // Poll for file-based communication from VBA
    let poll_handle = app_handle;
    tokio::spawn(async move {
        let selection_xml = std::env::temp_dir().join("latexsnipper_selection.xml");
        let selection_txt = std::env::temp_dir().join("latexsnipper_selection.txt");
        let mut xml_seen = false;
        let mut txt_seen = false;
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;

            if let Ok(meta) = fs::metadata(&selection_xml) {
                if meta.len() > 0 && !xml_seen {
                    xml_seen = true;
                    if let Ok(raw) = fs::read_to_string(&selection_xml) {
                        let omml = raw.trim_start_matches('\u{FEFF}').trim().to_string();
                        if !omml.is_empty() {
                            println!("[Bridge] File poll: OMML selection ({}b)", omml.len());
                            let _ = poll_handle.emit("office-load-selection-omml", serde_json::json!({
                                "omml": omml,
                            }));
                            let _ = poll_handle.emit("office-show-app", ());
                        }
                    }
                    let _ = fs::remove_file(&selection_xml);
                }
            } else {
                xml_seen = false;
            }

            if let Ok(meta) = fs::metadata(&selection_txt) {
                if meta.len() > 0 && !txt_seen {
                    txt_seen = true;
                    if let Ok(text) = fs::read_to_string(&selection_txt) {
                        let trimmed = text.trim_start_matches('\u{FEFF}').trim().to_string();
                        if !trimmed.is_empty() {
                            println!("[Bridge] File poll: text selection ({}b)", trimmed.len());
                            let _ = poll_handle.emit("office-load-selection", serde_json::json!({
                                "text": trimmed,
                            }));
                            let _ = poll_handle.emit("office-show-app", ());
                        }
                    }
                    let _ = fs::remove_file(&selection_txt);
                }
            } else {
                txt_seen = false;
            }
        }
    });

    let listener = match TcpListener::bind(format!("0.0.0.0:{}", BRIDGE_PORT)).await {
        Ok(l) => l,
        Err(e) => {
            println!("[Bridge] Failed to bind port {}: {}", BRIDGE_PORT, e);
            return;
        }
    };

    println!("[Bridge] Listening on port {}", BRIDGE_PORT);
    if let Err(e) = axum::serve(listener, app).await {
        println!("[Bridge] Server error: {}", e);
    }
}

async fn handle_convert(
    State(state): State<Arc<BridgeState>>,
    Json(req): Json<ConvertRequest>,
) -> impl IntoResponse {
    println!("[Bridge] Convert: {}", req.latex);

    // Step 1: Frontend converts LaTeX → MathML via Temml
    let mathml = render_mathml(&state, &req.latex).await;

    if mathml.is_empty() {
        return Json(ConvertResponse { success: false, omml: String::new() });
    }

    println!("[Bridge] MathML received ({}b)", mathml.len());

    // Step 2: Python lxml converts MathML → OMML via MML2OMML.XSL
    let font_color = req.font_color.clone();
    let font_style = req.font_style.clone();
    let omml = tokio::task::spawn_blocking(move || {
        mathml_to_omml(&mathml, &font_color, &font_style)
    }).await.unwrap_or(None);

    match &omml {
        Some(o) => println!("[Bridge] OMML generated ({}b)", o.len()),
        None => println!("[Bridge] OMML conversion failed"),
    }

    Json(ConvertResponse {
        success: omml.is_some(),
        omml: omml.unwrap_or_default(),
    })
}

async fn handle_render_formula(
    State(state): State<Arc<BridgeState>>,
    Json(req): Json<ConvertRequest>,
) -> impl IntoResponse {
    let mathml = render_mathml(&state, &req.latex).await;
    Json(serde_json::json!({
        "success": !mathml.is_empty(),
        "mathml": mathml,
    }))
}

async fn handle_render_result(
    State(state): State<Arc<BridgeState>>,
    Json(req): Json<serde_json::Value>,
) -> impl IntoResponse {
    let id = req["id"].as_str().unwrap_or("");
    let result = req["mathml"].as_str().unwrap_or("");
    let mut pending = state.pending_renders.lock().await;
    if let Some(tx) = pending.remove(id) {
        let _ = tx.send(result.to_string());
    }
    Json(serde_json::json!({"success": true}))
}

async fn handle_load_selection(
    State(state): State<Arc<BridgeState>>,
    Json(req): Json<LoadSelectionRequest>,
) -> impl IntoResponse {
    println!("[Bridge] Load selection: {}", req.text);

    // Write to temp file for app to read (more reliable than events)
    let path = std::env::temp_dir().join("latexsnipper_selection.txt");
    let _ = fs::write(&path, &req.text);

    let _ = state.app_handle.emit("office-load-selection", serde_json::json!({
        "text": req.text,
    }));

    Json(OfficeResponse { success: true, message: "ok".into() })
}

async fn handle_show_app(
    State(state): State<Arc<BridgeState>>,
) -> impl IntoResponse {
    let _ = state.app_handle.emit("office-show-app", ());
    Json(OfficeResponse { success: true, message: "ok".into() })
}

async fn render_mathml(state: &BridgeState, latex: &str) -> String {
    let (tx, rx) = oneshot::channel::<String>();
    let request_id = format!("rnd_{}", std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis());

    {
        let mut pending = state.pending_renders.lock().await;
        pending.insert(request_id.clone(), tx);
    }

    let _ = state.app_handle.emit("office-render-formula", serde_json::json!({
        "id": request_id,
        "latex": latex,
    }));

    match tokio::time::timeout(std::time::Duration::from_secs(10), rx).await {
        Ok(Ok(m)) => {
            let _ = state.pending_renders.lock().await.remove(&request_id);
            m
        }
        _ => {
            let _ = state.pending_renders.lock().await.remove(&request_id);
            String::new()
        }
    }
}
