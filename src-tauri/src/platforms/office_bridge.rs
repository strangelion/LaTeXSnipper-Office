use axum::{extract::State, response::IntoResponse, routing::get, routing::post, Json, Router};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::Emitter;
use tauri::Manager;
use tokio::sync::{oneshot, Mutex};
use tower_http::services::ServeDir;

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
    #[serde(default)]
    pub omml: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoadSelectionRequest {
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoadLatexRequest {
    pub latex: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoadOmmlRequest {
    pub omml: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FormulaActionRequest {
    #[serde(default)]
    pub formula_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ConvertResponse {
    pub success: bool,
    pub omml: String,
    #[serde(default)]
    pub latex: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct OfficeResponse {
    pub success: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum OfficeAction {
    InsertFormula { latex: String, mode: String },
    LoadSelection,
    DeleteFormula { id: Option<String> },
    ReplaceFormula { id: String, latex: String },
    InsertTable { table: serde_json::Value },
}

#[derive(Debug, Clone, Serialize)]
pub struct OfficeActionResponse {
    pub action: Option<OfficeAction>,
    pub action_id: Option<String>,
}

#[derive(Clone)]
struct BridgeState {
    app_handle: tauri::AppHandle,
    pending_renders: Arc<Mutex<HashMap<String, oneshot::Sender<String>>>>,
    action_queue: Arc<Mutex<VecDeque<(String, OfficeAction)>>>,
    action_counter: Arc<std::sync::atomic::AtomicU64>,
    heartbeat_received: Arc<std::sync::atomic::AtomicBool>,
}

fn fix_omml(omml: &str) -> String {
    let mut s = omml.to_string();

    // Remove XML declaration
    if let Some(pos) = s.find("<?xml") {
        if let Some(end) = s[pos..].find("?>") {
            s.replace_range(..pos + end + 2, "");
        }
    }

    // Fix empty <m:t/> and whitespace-only text
    s = s.replace("<m:t/>", "<m:t> </m:t>");

    // Fix XSLT tag typos
    s = s.replace("<m:eqAr>", "<m:eqArr>");
    s = s.replace("</m:eqAr>", "</m:eqArr>");

    // Remove mml namespace prefix remnants
    s = s.replace(" xmlns:mml=\"http://www.w3.org/1998/Math/MathML\"", "");

    // Fix double-encoded UTF-8: replace known corrupted character sequences
    s = fix_double_encoded_utf8(&s);

    // Fix: if OMML only has bare <m:r><m:t>text</m:r> without any math structure,
    // wrap each run in proper italic formatting
    if !s.contains("<m:f>")
        && !s.contains("<m:sSup>")
        && !s.contains("<m:sSub>")
        && !s.contains("<m:nary>")
        && !s.contains("<m:eqArr>")
        && !s.contains("<m:d>")
        && !s.contains("<m:rad>")
        && !s.contains("<m:acc>")
    {
        s = s.replace("<m:r><m:t>", "<m:r><m:rPr><w:rPr><w:rFonts w:ascii=\"Cambria Math\" w:h-ansi=\"Cambria Math\"/><w:i/></w:rPr></m:rPr><m:t>");
        s = s.replace("</m:t></m:r>", "</m:t></m:r>");
    }

    s.trim().to_string()
}

/// Fix double-encoded UTF-8: when each byte of a multi-byte UTF-8 character
/// is treated as a Latin-1 codepoint and re-encoded to UTF-8.
/// E.g., ∫ (E2 88 AB) becomes âˆ« (C3A2 C288 C2AB).
fn fix_double_encoded_utf8(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let chars: Vec<char> = s.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let cp = chars[i] as u32;
        // Collect consecutive chars where codepoint is in Latin-1 range (0x80..0xFF)
        if cp >= 0x80 && cp <= 0xFF {
            let mut raw_bytes = Vec::new();
            let mut j = i;
            while j < chars.len() {
                let c = chars[j] as u32;
                if c >= 0x80 && c <= 0xFF {
                    raw_bytes.push(c as u8);
                    j += 1;
                } else {
                    break;
                }
            }
            if raw_bytes.len() >= 2 {
                if let Ok(decoded) = std::str::from_utf8(&raw_bytes) {
                    result.push_str(decoded);
                    i = j;
                    continue;
                }
            }
        }
        result.push(chars[i]);
        i += 1;
    }
    result
}

/// Find the Office.js taskpane site directory.
/// Returns a directory containing `taskpane.html` and `assets/`.
fn find_office_js_dist(app_handle: &tauri::AppHandle) -> String {
    // 1. Try resource_dir/OfficeJS/site (production bundle, after npm run build:office-addin)
    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        let site_dir = resource_dir.join("OfficeJS").join("site");
        if has_office_taskpane(&site_dir) {
            return site_dir.to_string_lossy().to_string();
        }
        // Fallback: try resources/OfficeJS/site next to the exe
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                let alt = exe_dir.join("resources").join("OfficeJS").join("site");
                if has_office_taskpane(&alt) {
                    return alt.to_string_lossy().to_string();
                }
            }
        }
    }
    // 2. Try apps/office-addin/dist (dev mode, after direct Vite build)
    if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
        let addin_dist = PathBuf::from(&manifest_dir)
            .parent()
            .map(|p| p.join("apps").join("office-addin").join("dist"));
        if let Some(dir) = addin_dist {
            if has_office_taskpane(&dir) {
                return dir.to_string_lossy().to_string();
            }
        }
    }
    // 3. Fallback: root dist/
    let root_dist = PathBuf::from("dist");
    if root_dist.join("index.html").exists() {
        return root_dist.to_string_lossy().to_string();
    }
    eprintln!("[Bridge] WARNING: Office.js taskpane not found. Use build:office-addin first.");
    String::from("dist")
}

fn has_office_taskpane(dir: &std::path::Path) -> bool {
    dir.join("taskpane.html").exists() || dir.join("taskpane").join("index.html").exists()
}

fn latex_to_omml_core(latex: &str) -> Option<String> {
    latexsnipper_conversion::DocumentConverter::convert_latex_string(
        latex,
        latexsnipper_conversion::OutputFormat::OMML,
    )
    .ok()
}

// ═══════════════════════════════════════════
// Bridge Server
// ═══════════════════════════════════════════

pub async fn start_bridge_server(app_handle: tauri::AppHandle) {
    let state = BridgeState {
        app_handle: app_handle.clone(),
        pending_renders: Arc::new(Mutex::new(HashMap::new())),
        action_queue: Arc::new(Mutex::new(VecDeque::new())),
        action_counter: Arc::new(std::sync::atomic::AtomicU64::new(0)),
        heartbeat_received: Arc::new(std::sync::atomic::AtomicBool::new(false)),
    };

    // Try to serve Office.js taskpane files from resource dir
    let dist_path = find_office_js_dist(&app_handle);
    println!("[Bridge] Serving Office.js taskpane from: {}", dist_path);
    let app = Router::new()
        .route(
            "/health",
            get(|| async {
                Json(serde_json::json!({"status": "ok", "service": "latexsnipper-bridge"}))
            }),
        )
        .route("/api/office/convert", post(handle_convert))
        .route("/api/office/render-formula", post(handle_render_formula))
        .route("/api/office/render-result", post(handle_render_result))
        .route("/api/office/load-selection", post(handle_load_selection))
        .route(
            "/api/office/load-selection-latex",
            post(handle_load_selection_latex),
        )
        .route(
            "/api/office/load-selection-omml",
            post(handle_load_selection_omml),
        )
        .route("/api/office/show-app", post(handle_show_app))
        .route("/api/office/delete-formula", post(handle_delete_formula))
        .route("/api/office/auto-number", post(handle_auto_number))
        .route("/api/office/renumber", post(handle_renumber))
        .route(
            "/api/office/format-selection",
            post(handle_format_selection),
        )
        .route("/api/office/format-all", post(handle_format_all))
        .route("/api/office/load-table", post(handle_load_table))
        .route("/api/office/insert-table", post(handle_insert_table))
        .route("/api/office/insert-direct", post(handle_insert_direct))
        .route("/api/office/heartbeat", post(handle_heartbeat))
        .route("/api/office/actions/next", get(handle_actions_next))
        .route(
            "/api/office/actions/complete",
            post(handle_actions_complete),
        )
        // Serve static files at root so `/taskpane.html` and `/assets/*.js` resolve
        .fallback_service(ServeDir::new(&dist_path))
        .layer(
            tower_http::cors::CorsLayer::permissive()
                .allow_origin(tower_http::cors::Any)
                .allow_methods(tower_http::cors::Any)
                .allow_headers(tower_http::cors::Any),
        )
        .with_state(Arc::new(state));

    // Poll for file-based communication from VBA
    let poll_handle = app_handle.clone();
    tokio::spawn(async move {
        let selection_16 = std::env::temp_dir().join("latexsnipper_selection.16");
        let selection_bin = std::env::temp_dir().join("latexsnipper_selection.bin");
        let selection_b64 = std::env::temp_dir().join("latexsnipper_selection.b64");
        let selection_xml = std::env::temp_dir().join("latexsnipper_selection.xml");
        let selection_txt = std::env::temp_dir().join("latexsnipper_selection.txt");
        let mut utf16_seen = false;
        let mut bin_seen = false;
        let mut b64_seen = false;
        let mut xml_seen = false;
        let mut txt_seen = false;
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;

            // Primary: UTF-16 LE file (VBA native encoding)
            if let Ok(meta) = fs::metadata(&selection_16) {
                if meta.len() > 0 && !utf16_seen {
                    utf16_seen = true;
                    if let Ok(bytes) = fs::read(&selection_16) {
                        // Strip BOM (FF FE for UTF-16 LE)
                        let data = if bytes.len() >= 2 && bytes[0] == 0xFF && bytes[1] == 0xFE {
                            &bytes[2..]
                        } else {
                            &bytes
                        };
                        // Convert UTF-16 LE bytes to u16 slice
                        let u16s: Vec<u16> = data
                            .chunks(2)
                            .map(|chunk| {
                                if chunk.len() == 2 {
                                    u16::from_le_bytes([chunk[0], chunk[1]])
                                } else {
                                    chunk[0] as u16
                                }
                            })
                            .collect();
                        match String::from_utf16(&u16s) {
                            Ok(omml) => {
                                println!("[Bridge] File poll: UTF-16 OMML ({}b)", omml.len());
                                let _ = poll_handle.emit(
                                    "office-load-selection-omml",
                                    serde_json::json!({
                                        "omml": omml,
                                    }),
                                );
                                let _ = poll_handle.emit("office-show-app", ());
                            }
                            Err(e) => println!("[Bridge] UTF-16 decode failed: {}", e),
                        }
                    }
                    let _ = fs::remove_file(&selection_16);
                }
            } else {
                utf16_seen = false;
            }

            // Fallback: binary UTF-8
            if let Ok(meta) = fs::metadata(&selection_bin) {
                if meta.len() > 0 && !bin_seen {
                    bin_seen = true;
                    if let Ok(bytes) = fs::read(&selection_bin) {
                        let data = if bytes.len() >= 3
                            && bytes[0] == 0xEF
                            && bytes[1] == 0xBB
                            && bytes[2] == 0xBF
                        {
                            &bytes[3..]
                        } else {
                            &bytes
                        };
                        if let Ok(omml) = String::from_utf8(data.to_vec()) {
                            println!("[Bridge] File poll: binary OMML ({}b)", omml.len());
                            let _ = poll_handle.emit(
                                "office-load-selection-omml",
                                serde_json::json!({
                                    "omml": omml,
                                }),
                            );
                            let _ = poll_handle.emit("office-show-app", ());
                        }
                    }
                    let _ = fs::remove_file(&selection_bin);
                }
            } else {
                bin_seen = false;
            }

            if let Ok(meta) = fs::metadata(&selection_b64) {
                if meta.len() > 0 && !b64_seen {
                    b64_seen = true;
                    if let Ok(b64_str) = fs::read_to_string(&selection_b64) {
                        let b64_clean = b64_str.trim();
                        if !b64_clean.is_empty() {
                            use base64::Engine;
                            if let Ok(bytes) =
                                base64::engine::general_purpose::STANDARD.decode(b64_clean)
                            {
                                if let Ok(omml) = String::from_utf8(bytes) {
                                    println!("[Bridge] File poll: Base64 OMML ({}b)", omml.len());
                                    let _ = poll_handle.emit(
                                        "office-load-selection-omml",
                                        serde_json::json!({
                                            "omml": omml,
                                        }),
                                    );
                                    let _ = poll_handle.emit("office-show-app", ());
                                }
                            }
                        }
                    }
                    let _ = fs::remove_file(&selection_b64);
                }
            } else {
                b64_seen = false;
            }

            if let Ok(meta) = fs::metadata(&selection_xml) {
                if meta.len() > 0 && !xml_seen {
                    xml_seen = true;
                    if let Ok(raw) = fs::read_to_string(&selection_xml) {
                        let omml = raw.trim_start_matches('\u{FEFF}').trim().to_string();
                        if !omml.is_empty() {
                            println!("[Bridge] File poll: raw OMML ({}b)", omml.len());
                            let _ = poll_handle.emit(
                                "office-load-selection-omml",
                                serde_json::json!({
                                    "omml": omml,
                                }),
                            );
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
                            let _ = poll_handle.emit(
                                "office-load-selection",
                                serde_json::json!({
                                    "text": trimmed,
                                }),
                            );
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

    // Start HTTPS server with self-signed certificate.
    // Certificate is auto-generated on first run.
    // Certificate trust is handled separately (by install_office_js_addin / "启用 Word 集成").
    match super::tls_cert::get_or_create_tls_config(&app_handle) {
        Ok(tls_config) => {
            let addr = format!("127.0.0.1:{}", BRIDGE_PORT);
            println!("[Bridge] Listening on https://{}", addr);
            let rustls_config =
                axum_server::tls_rustls::RustlsConfig::from_config(Arc::new(tls_config));
            let parsed_addr: std::net::SocketAddr = match addr.parse() {
                Ok(a) => a,
                Err(e) => {
                    println!("[Bridge] Invalid address {}: {}", addr, e);
                    return;
                }
            };
            if let Err(e) = axum_server::bind_rustls(parsed_addr, rustls_config)
                .serve(app.into_make_service())
                .await
            {
                println!("[Bridge] HTTPS server error: {}", e);
            }
        }
        Err(e) => {
            println!("[Bridge] FATAL: TLS setup failed: {}", e);
            println!("[Bridge] Office.js requires HTTPS. Cannot start without TLS.");
        }
    }
}

async fn handle_convert(
    State(_state): State<Arc<BridgeState>>,
    Json(req): Json<ConvertRequest>,
) -> impl IntoResponse {
    // OMML → LaTeX conversion
    if let Some(ref omml_input) = req.omml {
        let omml_clone = omml_input.clone();
        let latex = tokio::task::spawn_blocking(move || {
            latexsnipper_conversion::omml_parser::parse_omml_to_latex(&omml_clone).ok()
        })
        .await
        .unwrap_or(None);

        return match latex {
            Some(l) => Json(ConvertResponse {
                success: true,
                omml: omml_input.clone(),
                latex: Some(l),
            }),
            None => Json(ConvertResponse {
                success: false,
                omml: String::new(),
                latex: None,
            }),
        };
    }

    // LaTeX → OMML conversion
    println!("[Bridge] Convert: {}", req.latex);
    let latex = req.latex.clone();
    let omml = tokio::task::spawn_blocking(move || latex_to_omml_core(&latex))
        .await
        .unwrap_or(None);

    match &omml {
        Some(o) => {
            let fixed = fix_omml(o);
            println!(
                "[Bridge] OMML generated via core ({}b) → fixed ({}b)",
                o.len(),
                fixed.len()
            );
            return Json(ConvertResponse {
                success: true,
                omml: fixed,
                latex: Some(req.latex),
            });
        }
        None => println!("[Bridge] OMML conversion failed"),
    }

    Json(ConvertResponse {
        success: false,
        omml: String::new(),
        latex: None,
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

    let _ = state.app_handle.emit(
        "office-load-selection",
        serde_json::json!({
            "text": req.text,
        }),
    );

    Json(OfficeResponse {
        success: true,
        message: "ok".into(),
    })
}

async fn handle_load_selection_latex(
    State(state): State<Arc<BridgeState>>,
    Json(req): Json<LoadLatexRequest>,
) -> impl IntoResponse {
    println!("[Bridge] Load selection latex: {}", req.latex);

    let _ = state.app_handle.emit(
        "office-load-selection-latex",
        serde_json::json!({
            "latex": req.latex,
        }),
    );

    Json(OfficeResponse {
        success: true,
        message: "ok".into(),
    })
}

async fn handle_load_selection_omml(
    State(state): State<Arc<BridgeState>>,
    Json(req): Json<LoadOmmlRequest>,
) -> impl IntoResponse {
    println!("[Bridge] Load selection OMML ({}b)", req.omml.len());

    let _ = state.app_handle.emit(
        "office-load-selection-omml",
        serde_json::json!({
            "omml": req.omml,
        }),
    );

    Json(OfficeResponse {
        success: true,
        message: "ok".into(),
    })
}

async fn handle_show_app(State(state): State<Arc<BridgeState>>) -> impl IntoResponse {
    let _ = state.app_handle.emit("office-show-app", ());
    Json(OfficeResponse {
        success: true,
        message: "ok".into(),
    })
}

async fn render_mathml(state: &BridgeState, latex: &str) -> String {
    let (tx, rx) = oneshot::channel::<String>();
    let request_id = format!(
        "rnd_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    );

    {
        let mut pending = state.pending_renders.lock().await;
        pending.insert(request_id.clone(), tx);
    }

    let _ = state.app_handle.emit(
        "office-render-formula",
        serde_json::json!({
            "id": request_id,
            "latex": latex,
        }),
    );

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

async fn handle_delete_formula(
    State(state): State<Arc<BridgeState>>,
    Json(_req): Json<FormulaActionRequest>,
) -> impl IntoResponse {
    println!("[Bridge] Delete formula");
    let _ = state.app_handle.emit("office-delete-formula", ());
    Json(OfficeResponse {
        success: true,
        message: "ok".into(),
    })
}

async fn handle_auto_number(
    State(state): State<Arc<BridgeState>>,
    Json(_req): Json<FormulaActionRequest>,
) -> impl IntoResponse {
    println!("[Bridge] Auto number");
    let _ = state.app_handle.emit("office-auto-number", ());
    Json(OfficeResponse {
        success: true,
        message: "ok".into(),
    })
}

async fn handle_renumber(
    State(state): State<Arc<BridgeState>>,
    Json(_req): Json<FormulaActionRequest>,
) -> impl IntoResponse {
    println!("[Bridge] Renumber");
    let _ = state.app_handle.emit("office-renumber", ());
    Json(OfficeResponse {
        success: true,
        message: "ok".into(),
    })
}

async fn handle_format_selection(
    State(state): State<Arc<BridgeState>>,
    Json(_req): Json<FormulaActionRequest>,
) -> impl IntoResponse {
    println!("[Bridge] Format selection");
    let _ = state.app_handle.emit("office-format-selection", ());
    Json(OfficeResponse {
        success: true,
        message: "ok".into(),
    })
}

async fn handle_format_all(
    State(state): State<Arc<BridgeState>>,
    Json(_req): Json<FormulaActionRequest>,
) -> impl IntoResponse {
    println!("[Bridge] Format all");
    let _ = state.app_handle.emit("office-format-all", ());
    Json(OfficeResponse {
        success: true,
        message: "ok".into(),
    })
}

/// Strongly-typed table data structure.
/// Replaces raw JSON/TSV string for type safety.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableData {
    /// Table rows, each row is a vector of cell values.
    pub rows: Vec<Vec<String>>,
    /// Number of rows.
    pub row_count: u32,
    /// Number of columns.
    pub col_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoadTableResponse {
    pub success: bool,
    #[serde(flatten)]
    pub table: Option<TableData>,
}

async fn handle_load_table(State(state): State<Arc<BridgeState>>) -> impl IntoResponse {
    println!("[Bridge] Load table");
    let _ = state.app_handle.emit("office-load-table", ());
    Json(LoadTableResponse {
        success: true,
        table: None,
    })
}

/// Parse TSV string from C# plugin into strongly-typed TableData.
pub fn parse_tsv_to_table_data(tsv: &str) -> Option<TableData> {
    let lines: Vec<&str> = tsv.lines().collect();
    if lines.is_empty() {
        return None;
    }

    // First line: rows\tcols
    let header: Vec<&str> = lines[0].split('\t').collect();
    if header.len() < 2 {
        return None;
    }

    let row_count: u32 = header[0].parse().ok()?;
    let col_count: u32 = header[1].parse().ok()?;

    let mut rows = Vec::new();
    for line in &lines[1..] {
        if line.trim().is_empty() {
            continue;
        }
        let cells: Vec<String> = line.split('\t').map(|s| s.to_string()).collect();
        rows.push(cells);
    }

    if rows.is_empty() {
        return None;
    }

    Some(TableData {
        rows,
        row_count,
        col_count,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableDataRequest {
    pub latex: String,
}

async fn handle_insert_table(
    State(state): State<Arc<BridgeState>>,
    Json(req): Json<TableDataRequest>,
) -> impl IntoResponse {
    println!("[Bridge] Insert table: {}", req.latex);
    let _ = state.app_handle.emit(
        "office-insert-table",
        serde_json::json!({
            "latex": req.latex,
        }),
    );
    Json(OfficeResponse {
        success: true,
        message: "ok".into(),
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InsertDirectRequest {
    pub latex: String,
    #[serde(default)]
    pub display: bool,
}

async fn handle_insert_direct(
    State(state): State<Arc<BridgeState>>,
    Json(req): Json<InsertDirectRequest>,
) -> impl IntoResponse {
    println!(
        "[Bridge] Insert direct (pushed to action queue): {}",
        req.latex
    );

    let action = OfficeAction::InsertFormula {
        latex: req.latex,
        mode: if req.display {
            "display".into()
        } else {
            "inline".into()
        },
    };

    let counter = state
        .action_counter
        .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let action_id = format!("act_{}", counter);
    {
        let mut queue = state.action_queue.lock().await;
        queue.push_back((action_id.clone(), action));
    }

    Json(OfficeResponse {
        success: true,
        message: "公式已加入等待队列。请在 Word 任务窗格中执行。".into(),
    })
}

async fn handle_heartbeat(State(state): State<Arc<BridgeState>>) -> impl IntoResponse {
    state
        .heartbeat_received
        .store(true, std::sync::atomic::Ordering::Relaxed);
    // Also record in the integrations module so check_office_addin() sees it
    super::integrations::record_taskpane_heartbeat();
    println!("[Bridge] Taskpane heartbeat received");
    Json(OfficeResponse {
        success: true,
        message: "heartbeat acknowledged".into(),
    })
}

async fn handle_actions_next(State(state): State<Arc<BridgeState>>) -> impl IntoResponse {
    let action = {
        let mut queue = state.action_queue.lock().await;
        queue.pop_front()
    };
    match action {
        Some((action_id, action)) => Json(OfficeActionResponse {
            action: Some(action),
            action_id: Some(action_id),
        }),
        None => Json(OfficeActionResponse {
            action: None,
            action_id: None,
        }),
    }
}

async fn handle_actions_complete(
    State(_state): State<Arc<BridgeState>>,
    Json(payload): Json<serde_json::Value>,
) -> impl IntoResponse {
    let action_id = payload["action_id"].as_str().unwrap_or("unknown");
    println!("[Bridge] Action completed: {}", action_id);
    Json(OfficeResponse {
        success: true,
        message: "action acknowledged".into(),
    })
}
