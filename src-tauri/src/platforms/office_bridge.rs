use axum::{
    extract::State,
    http::{header, HeaderValue, Method},
    response::IntoResponse,
    routing::get,
    routing::post,
    Json, Router,
};
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OfficeConvertV1Request {
    pub source_format: String,
    pub target_format: String,
    pub content: String,
    pub display_mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OfficeConvertV1Response {
    pub success: bool,
    pub content: String,
    pub format: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width_pt: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height_pt: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fallback_format: Option<String>,
    pub diagnostic: Option<String>,
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
    /// Ecosystem action queue for cross-app plugin communication (VS Code, Obsidian, etc.)
    ecosystem_queue: super::ecosystem::EcosystemActionQueue,
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
        if (0x80..=0xFF).contains(&cp) {
            let mut raw_bytes = Vec::new();
            let mut j = i;
            while j < chars.len() {
                let c = chars[j] as u32;
                if (0x80..=0xFF).contains(&c) {
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
        ecosystem_queue: super::ecosystem::EcosystemActionQueue::new(),
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
        .route("/api/office/convert/v1", post(handle_convert_v1))
        // Compatible routes for Obsidian and WPS plugins that call /convert/latex and /convert/omml
        .route("/convert/latex", post(handle_convert))
        .route("/convert/omml", post(handle_convert))
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
        // ── Ecosystem Bridge API ──
        .route("/api/ecosystem/ping", get(handle_ecosystem_ping))
        .route(
            "/api/ecosystem/clients/register",
            post(handle_ecosystem_client_register),
        )
        .route(
            "/api/ecosystem/clients/heartbeat",
            post(handle_ecosystem_client_heartbeat),
        )
        .route("/api/ecosystem/clients", get(handle_ecosystem_clients))
        .route(
            "/api/ecosystem/actions/enqueue",
            post(handle_ecosystem_enqueue),
        )
        .route(
            "/api/ecosystem/actions/next",
            get(handle_ecosystem_actions_next),
        )
        .route("/api/ecosystem/actions/ack", post(handle_ecosystem_ack))
        .route(
            "/api/ecosystem/actions/complete",
            post(handle_ecosystem_actions_complete),
        )
        .route(
            "/api/ecosystem/actions/push",
            post(handle_ecosystem_actions_push),
        )
        .route(
            "/api/ecosystem/actions/status/{action_id}",
            get(handle_ecosystem_action_status),
        )
        .route(
            "/api/ecosystem/formula/edit",
            post(handle_ecosystem_formula_edit),
        )
        .route(
            "/api/ecosystem/clipboard/write",
            post(handle_ecosystem_clipboard_write),
        )
        // ── WPS / cross-platform compatibility ──
        .route("/config", get(handle_config))
        // Serve static files at root so `/taskpane.html` and `/assets/*.js` resolve
        .fallback_service(ServeDir::new(&dist_path))
        .layer(
            tower_http::cors::CorsLayer::new()
                .allow_origin([
                    HeaderValue::from_static("https://127.0.0.1:19876"),
                    HeaderValue::from_static("https://localhost:19876"),
                    HeaderValue::from_static("http://127.0.0.1:19877"),
                    HeaderValue::from_static("https://latexsnipper.interknot.dpdns.org"),
                ])
                .allow_methods([Method::GET, Method::POST])
                .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION]),
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

    // Start both HTTP (ecosystem API / dev) and HTTPS (Office.js) servers.
    // Office.js requires TLS, but ecosystem plugins (VS Code, Obsidian, etc.)
    // and development frontends (Vite) work better with plain HTTP.
    //
    // Certificate is auto-generated on first run.
    // Certificate trust is handled separately (by install_office_js_addin / "启用 Word 集成").

    // ── HTTP server (ecosystem API / dev) ──
    let http_port = BRIDGE_PORT + 1; // 19877
    let http_addr: std::net::SocketAddr = match format!("127.0.0.1:{}", http_port).parse() {
        Ok(a) => a,
        Err(e) => {
            println!("[Bridge] Invalid HTTP address: {}", e);
            return;
        }
    };
    let http_app = app.clone();
    let http_server = tokio::spawn(async move {
        println!(
            "[Bridge] Also listening on http://{} (ecosystem API)",
            http_addr
        );
        if let Err(e) = axum_server::bind(http_addr)
            .serve(http_app.into_make_service())
            .await
        {
            println!("[Bridge] HTTP server error: {}", e);
        }
    });

    // ── HTTPS server (Office.js) ──
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

    // Keep HTTP server running even if HTTPS stops
    let _ = http_server.await;
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

async fn handle_convert_v1(
    State(state): State<Arc<BridgeState>>,
    Json(req): Json<OfficeConvertV1Request>,
) -> Json<OfficeConvertV1Response> {
    const MAX_CONTENT_BYTES: usize = 256 * 1024;
    if req.content.trim().is_empty() || req.content.len() > MAX_CONTENT_BYTES {
        return Json(OfficeConvertV1Response {
            success: false,
            content: String::new(),
            format: req.target_format,
            width_pt: None,
            height_pt: None,
            fallback_format: None,
            diagnostic: Some("Conversion content is empty or exceeds 256 KiB.".into()),
        });
    }

    let result = match (req.source_format.as_str(), req.target_format.as_str()) {
        ("latex", "omml") => {
            let latex = req.content.clone();
            tokio::task::spawn_blocking(move || latex_to_omml_core(&latex))
                .await
                .ok()
                .flatten()
                .map(|value| (fix_omml(&value), None, None))
        }
        ("omml", "latex") => {
            let omml = req.content.clone();
            tokio::task::spawn_blocking(move || {
                latexsnipper_conversion::omml_parser::parse_omml_to_latex(&omml).ok()
            })
            .await
            .ok()
            .flatten()
            .map(|value| (value, None, None))
        }
        ("latex", "svg") | ("latex", "png") => {
            render_office_asset(&state, &req.content, &req.display_mode, &req.target_format).await
        }
        _ => None,
    };

    match result {
        Some((content, width_pt, height_pt)) if !content.is_empty() => {
            Json(OfficeConvertV1Response {
                success: true,
                content,
                format: req.target_format,
                width_pt,
                height_pt,
                fallback_format: None,
                diagnostic: None,
            })
        }
        _ => Json(OfficeConvertV1Response {
            success: false,
            content: String::new(),
            format: req.target_format.clone(),
            width_pt: None,
            height_pt: None,
            fallback_format: None,
            diagnostic: Some(format!(
                "Bridge could not convert {} to {}.",
                req.source_format, req.target_format
            )),
        }),
    }
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
    let result = if let Some(mathml) = req["mathml"].as_str() {
        mathml.to_string()
    } else {
        serde_json::to_string(&req).unwrap_or_default()
    };
    let mut pending = state.pending_renders.lock().await;
    if let Some(tx) = pending.remove(id) {
        let _ = tx.send(result);
    }
    Json(serde_json::json!({"success": true}))
}

async fn render_office_asset(
    state: &BridgeState,
    latex: &str,
    display_mode: &str,
    target_format: &str,
) -> Option<(String, Option<f64>, Option<f64>)> {
    let (tx, rx) = oneshot::channel::<String>();
    let request_id = format!(
        "asset_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    );
    state
        .pending_renders
        .lock()
        .await
        .insert(request_id.clone(), tx);
    if state
        .app_handle
        .emit(
            "office-render-asset",
            serde_json::json!({
                "id": request_id,
                "latex": latex,
                "display": display_mode != "inline",
                "format": target_format,
            }),
        )
        .is_err()
    {
        state.pending_renders.lock().await.remove(&request_id);
        return None;
    }
    let raw = match tokio::time::timeout(std::time::Duration::from_secs(15), rx).await {
        Ok(Ok(value)) => value,
        _ => {
            state.pending_renders.lock().await.remove(&request_id);
            return None;
        }
    };
    let value: serde_json::Value = serde_json::from_str(&raw).ok()?;
    if value["success"].as_bool() != Some(true) {
        return None;
    }
    Some((
        value["content"].as_str()?.to_string(),
        value["widthPt"].as_f64(),
        value["heightPt"].as_f64(),
    ))
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
#[allow(
    dead_code,
    reason = "Public bridge helper covered by integration tests"
)]
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

async fn handle_heartbeat() -> impl IntoResponse {
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

// ═══════════════════════════════════════════════════════════════
// Ecosystem Bridge Handlers
// ═══════════════════════════════════════════════════════════════

use super::ecosystem::{
    ActionError, EcosystemActionEnvelope, EcosystemActionQueue, EcosystemClient,
};

fn _extract_queue(state: &BridgeState) -> &EcosystemActionQueue {
    &state.ecosystem_queue
}

#[derive(Serialize)]
#[allow(dead_code, reason = "Kept as the typed ecosystem response contract")]
struct EcoOkResponse {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

#[allow(dead_code, reason = "Kept as the typed ecosystem response contract")]
impl EcoOkResponse {
    fn ok() -> Self {
        Self {
            ok: true,
            message: None,
        }
    }
    fn with_msg(msg: impl Into<String>) -> Self {
        Self {
            ok: true,
            message: Some(msg.into()),
        }
    }
}

async fn handle_ecosystem_ping(State(_state): State<Arc<BridgeState>>) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "ok": true,
        "service": "latexsnipper-ecosystem-bridge",
        "protocolVersion": 1,
        "serverVersion": env!("CARGO_PKG_VERSION"),
    }))
}

async fn handle_ecosystem_client_register(
    State(state): State<Arc<BridgeState>>,
    Json(client): Json<EcosystemClient>,
) -> Json<serde_json::Value> {
    state.ecosystem_queue.register_client(client).await;
    Json(serde_json::json!({
        "ok": true,
        "protocolVersion": 1,
        "serverVersion": env!("CARGO_PKG_VERSION"),
        "heartbeatIntervalMs": 10000,
    }))
}

async fn handle_ecosystem_client_heartbeat(
    State(state): State<Arc<BridgeState>>,
    Json(payload): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    if let Some(client_id) = payload["clientId"].as_str() {
        state.ecosystem_queue.client_heartbeat(client_id).await;
    }
    Json(serde_json::json!({ "ok": true }))
}

async fn handle_ecosystem_clients(
    State(state): State<Arc<BridgeState>>,
) -> Json<serde_json::Value> {
    let clients = state.ecosystem_queue.list_clients().await;
    Json(serde_json::json!({ "ok": true, "clients": clients }))
}

async fn handle_ecosystem_enqueue(
    State(state): State<Arc<BridgeState>>,
    Json(payload): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    // Accept both full EcosystemActionEnvelope and simplified format from plugins.
    // If action_id is missing, treat as simplified and fill in defaults.
    let has_action_id = payload
        .get("actionId")
        .and_then(|v| v.as_str())
        .is_some_and(|s| !s.is_empty())
        || payload
            .get("action_id")
            .and_then(|v| v.as_str())
            .is_some_and(|s| !s.is_empty());

    let action = if has_action_id {
        // Full envelope — try to deserialize directly
        match serde_json::from_value::<EcosystemActionEnvelope>(payload) {
            Ok(a) => a,
            Err(e) => {
                return Json(serde_json::json!({
                    "ok": false,
                    "error": format!("Invalid envelope: {}", e),
                }));
            }
        }
    } else {
        // Simplified format — wrap into envelope
        let action_id = format!("act_{}", uuid_simple());
        let now = chrono::Utc::now();
        let expires = now + chrono::Duration::seconds(300);
        let action_type = payload["actionType"]
            .as_str()
            .or_else(|| payload["action_type"].as_str())
            .unwrap_or("unknown")
            .to_string();
        let origin = payload["origin"].as_str().unwrap_or("plugin").to_string();
        let target = payload["target"].as_str().unwrap_or("desktop").to_string();
        let inner_payload = payload
            .get("payload")
            .cloned()
            .unwrap_or(serde_json::json!({}));
        let timeout_ms = payload["timeoutMs"]
            .as_u64()
            .or_else(|| payload["timeout_ms"].as_u64())
            .unwrap_or(300_000);

        EcosystemActionEnvelope {
            action_id,
            action_type,
            origin,
            target,
            target_client_id: None,
            created_at: now.to_rfc3339(),
            expires_at: expires.to_rfc3339(),
            timeout_ms,
            nonce: uuid_simple(),
            require_ack: false,
            allow_fallback: true,
            priority: "normal".to_string(),
            reply_to: None,
            payload: inner_payload,
            trace_id: uuid_simple(),
            app_version: Some(env!("CARGO_PKG_VERSION").to_string()),
            protocol_version: 1,
        }
    };

    match state.ecosystem_queue.enqueue(action.clone()).await {
        Ok(()) => Json(serde_json::json!({
            "ok": true,
            "actionId": action.action_id,
        })),
        Err(e) => Json(serde_json::json!({
            "ok": false,
            "error": e,
        })),
    }
}

async fn handle_ecosystem_actions_next(
    State(state): State<Arc<BridgeState>>,
    axum::extract::Query(params): axum::extract::Query<HashMap<String, String>>,
) -> Json<serde_json::Value> {
    let client_id = params.get("clientId").map(|s| s.as_str()).unwrap_or("");
    let target = params.get("target").map(|s| s.as_str()).unwrap_or("");
    match state.ecosystem_queue.next(client_id, target).await {
        Some(action) => Json(serde_json::json!({
            "found": true,
            "action": action,
        })),
        None => Json(serde_json::json!({
            "found": false,
            "action": null,
        })),
    }
}

async fn handle_ecosystem_ack(
    State(state): State<Arc<BridgeState>>,
    Json(payload): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    let action_id = payload["actionId"].as_str().unwrap_or("");
    match state.ecosystem_queue.ack(action_id).await {
        Ok(()) => Json(serde_json::json!({ "ok": true })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

async fn handle_ecosystem_actions_complete(
    State(state): State<Arc<BridgeState>>,
    Json(payload): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    let action_id = payload["actionId"].as_str().unwrap_or("");
    let ok = payload["ok"].as_bool().unwrap_or(false);
    let result = payload.get("result").cloned();
    let error = payload.get("error").map(|e| ActionError {
        code: e["code"].as_str().unwrap_or("UNKNOWN").to_string(),
        message: e["message"].as_str().unwrap_or("").to_string(),
    });
    match state
        .ecosystem_queue
        .complete(action_id, ok, result, error)
        .await
    {
        Ok(()) => Json(serde_json::json!({ "ok": true })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

async fn handle_ecosystem_action_status(
    State(state): State<Arc<BridgeState>>,
    axum::extract::Path(action_id): axum::extract::Path<String>,
) -> Json<serde_json::Value> {
    match state.ecosystem_queue.status(&action_id).await {
        Some(record) => Json(serde_json::json!({
            "actionId": action_id,
            "status": record.status,
            "updatedAt": record.updated_at,
            "result": record.result,
            "error": record.error,
        })),
        None => Json(serde_json::json!({
            "actionId": action_id,
            "status": "not_found",
        })),
    }
}

#[derive(Deserialize)]
struct PushActionPayload {
    #[serde(rename = "type")]
    action_type: String,
    latex: String,
    display: Option<bool>,
    format: Option<String>,
}

#[derive(Deserialize)]
struct PushRequest {
    target: String,
    action: PushActionPayload,
}

/// Simplified push endpoint — wraps action into envelope automatically.
/// Request: { target: "vscode", action: { type: "InsertFormula", latex: "...", display: true } }
async fn handle_ecosystem_actions_push(
    State(state): State<Arc<BridgeState>>,
    Json(push): Json<PushRequest>,
) -> Json<serde_json::Value> {
    let action_id = format!("act_{}", uuid_simple());
    let now = chrono::Utc::now();
    let expires = now + chrono::Duration::seconds(300);

    let envelope = EcosystemActionEnvelope {
        action_id: action_id.clone(),
        action_type: push.action.action_type,
        origin: "desktop".to_string(),
        target: push.target.clone(),
        target_client_id: None,
        created_at: now.to_rfc3339(),
        expires_at: expires.to_rfc3339(),
        timeout_ms: 300_000,
        nonce: uuid_simple(),
        require_ack: false,
        allow_fallback: true,
        priority: "normal".to_string(),
        reply_to: None,
        payload: serde_json::json!({
            "latex": push.action.latex,
            "display": push.action.display.unwrap_or(false),
            "format": push.action.format.unwrap_or_else(|| "markdown".to_string()),
        }),
        trace_id: uuid_simple(),
        app_version: Some(env!("CARGO_PKG_VERSION").to_string()),
        protocol_version: 1,
    };

    match state.ecosystem_queue.enqueue(envelope).await {
        Ok(()) => Json(serde_json::json!({
            "ok": true,
            "actionId": action_id,
        })),
        Err(e) => Json(serde_json::json!({
            "ok": false,
            "error": e,
        })),
    }
}

/// WPS-compatible /config endpoint.
async fn handle_config() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "ok": true,
        "result": {
            "bridgeVersion": env!("CARGO_PKG_VERSION"),
            "baseUrl": "https://127.0.0.1:19876",
            "httpUrl": "http://127.0.0.1:19877",
            "capabilities": [
                "latex_to_markdown",
                "latex_to_svg",
                "latex_to_png",
                "insert_formula_action"
            ]
        }
    }))
}

async fn handle_ecosystem_formula_edit(
    State(state): State<Arc<BridgeState>>,
    Json(payload): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    // Parse the edit request into an action and forward it to the desktop
    let latex = payload["latex"].as_str().unwrap_or("").to_string();
    let display = payload["display"].as_bool().unwrap_or(false);
    let origin = payload["origin"].as_str().unwrap_or("plugin").to_string();

    let action_id = format!("act_{}", uuid_simple());
    let now = chrono::Utc::now();
    let expires = now + chrono::Duration::seconds(300);

    let action = EcosystemActionEnvelope {
        action_id: action_id.clone(),
        action_type: "EditFormula".to_string(),
        origin: origin.clone(),
        target: "desktop".to_string(),
        target_client_id: None,
        created_at: now.to_rfc3339(),
        expires_at: expires.to_rfc3339(),
        timeout_ms: 300_000,
        nonce: uuid_simple(),
        require_ack: false,
        allow_fallback: true,
        priority: "normal".to_string(),
        reply_to: None,
        payload: serde_json::json!({
            "latex": latex,
            "display": display,
            "source": format!("{}-edit", origin),
        }),
        trace_id: uuid_simple(),
        app_version: Some(env!("CARGO_PKG_VERSION").to_string()),
        protocol_version: 1,
    };

    state
        .ecosystem_queue
        .enqueue(action)
        .await
        .unwrap_or_default();

    // Notify the desktop app via Tauri event
    let _ = state.app_handle.emit(
        "ecosystem-action-open",
        &serde_json::json!({
            "actionId": action_id,
            "origin": origin,
            "latex": latex,
            "display": display,
        }),
    );

    Json(serde_json::json!({
        "ok": true,
        "actionId": action_id,
        "message": "Formula edit requested. LaTeXSnipper should open the editor.",
    }))
}

fn uuid_simple() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let t = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{:x}", t)
}

async fn handle_ecosystem_clipboard_write(
    State(state): State<Arc<BridgeState>>,
    Json(payload): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    let text = payload["text"].as_str().unwrap_or("").to_string();
    if text.is_empty() {
        return Json(serde_json::json!({ "ok": false, "error": "empty text" }));
    }

    // Write to clipboard via Tauri API
    if let Some(window) = state.app_handle.get_webview_window("main") {
        let _ = window.eval(format!("navigator.clipboard.writeText({:?})", text));
    }

    Json(serde_json::json!({ "ok": true }))
}
