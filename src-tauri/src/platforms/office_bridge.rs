use axum::{extract::State, response::IntoResponse, routing::post, Json, Router};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoadLatexRequest {
    pub latex: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoadOmmlRequest {
    pub omml: String,
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
        // These are likely double-encoded bytes
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
            // Try to interpret the collected bytes as valid UTF-8
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
    };

    let app = Router::new()
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
    State(_state): State<Arc<BridgeState>>,
    Json(req): Json<ConvertRequest>,
) -> impl IntoResponse {
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
            });
        }
        None => println!("[Bridge] OMML conversion failed"),
    }

    Json(ConvertResponse {
        success: false,
        omml: String::new(),
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
