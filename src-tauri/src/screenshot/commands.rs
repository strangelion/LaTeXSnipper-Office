use std::{
    collections::{HashMap, HashSet},
    time::{Duration, Instant},
};

use base64::Engine;
use image::{codecs::jpeg::JpegEncoder, imageops::crop_imm, DynamicImage};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use xcap::Monitor;

use super::{
    dto::{
        ScreenshotBeginRequest, ScreenshotBeginResult, ScreenshotCaptured, ScreenshotCommitRequest,
        ScreenshotFailure, ScreenshotOverlayInit,
    },
    state::{ScreenshotFrame, ScreenshotSession, ScreenshotState},
};

const OVERLAY_READY_TIMEOUT: Duration = Duration::from_secs(3);

fn new_session_id() -> String {
    format!("{:032x}", rand::random::<u128>())
}

pub(crate) fn parse_window_label(label: &str) -> Result<(&str, &str), String> {
    let value = label
        .strip_prefix("capture-")
        .ok_or_else(|| "SCREENSHOT_INVALID_WINDOW_LABEL: missing capture prefix".to_string())?;
    value
        .split_once('-')
        .ok_or_else(|| "SCREENSHOT_INVALID_WINDOW_LABEL: missing monitor suffix".to_string())
}

#[tauri::command]
pub async fn screenshot_begin(
    app: AppHandle,
    state: State<'_, ScreenshotState>,
    request: ScreenshotBeginRequest,
) -> Result<ScreenshotBeginResult, String> {
    let session_id = new_session_id();
    let started = Instant::now();
    state.reserve(&session_id)?;

    let result = screenshot_begin_transaction(&app, &state, &session_id, request.clone()).await;
    match result {
        Ok(value) => {
            log::info!(
                "operationId={} stage=overlay-show host={} sessionId={} documentContextPresent={} elapsedMs={} success=true",
                session_id,
                request.target_host.as_deref().unwrap_or("desktop"),
                session_id,
                request.document_context.is_some(),
                started.elapsed().as_millis(),
            );
            Ok(value)
        }
        Err(error) => {
            rollback_capture(
                &app,
                &state,
                &session_id,
                &request,
                error_stage(&error),
                &error,
                started.elapsed(),
            );
            Err(error)
        }
    }
}

async fn screenshot_begin_transaction(
    app: &AppHandle,
    state: &ScreenshotState,
    session_id: &str,
    request: ScreenshotBeginRequest,
) -> Result<ScreenshotBeginResult, String> {
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "SCREENSHOT_MAIN_WINDOW_MISSING: main window not found".to_string())?;
    main.hide()
        .map_err(|error| format!("SCREENSHOT_HIDE_MAIN_FAILED: {error}"))?;

    tokio::time::sleep(Duration::from_millis(180)).await;

    let tauri_monitors = app
        .available_monitors()
        .map_err(|error| format!("SCREENSHOT_MONITOR_ENUMERATION_FAILED: {error}"))?;
    if tauri_monitors.is_empty() {
        return Err("SCREENSHOT_NO_MONITORS: no monitor found".to_string());
    }
    let monitor_count = tauri_monitors.len();
    let monitor_specs = tauri_monitors
        .iter()
        .enumerate()
        .map(|(index, monitor)| {
            let position = monitor.position();
            let size = monitor.size();
            (
                format!("m{index}"),
                position.x,
                position.y,
                size.width,
                size.height,
                monitor.scale_factor(),
            )
        })
        .collect::<Vec<_>>();

    let captured = tauri::async_runtime::spawn_blocking(move || {
        let mut frames = Vec::new();
        for (monitor_id, x, y, width, height, scale_factor) in monitor_specs {
            let center_x = x + i32::try_from(width / 2).unwrap_or(0);
            let center_y = y + i32::try_from(height / 2).unwrap_or(0);
            let monitor = Monitor::from_point(center_x, center_y).map_err(|error| {
                format!("SCREENSHOT_MONITOR_MAPPING_FAILED: {monitor_id}: {error}")
            })?;
            let image = monitor
                .capture_image()
                .map_err(|error| format!("SCREENSHOT_CAPTURE_FAILED: {monitor_id}: {error}"))?;
            frames.push((monitor_id, x, y, width, height, scale_factor, image));
        }
        Ok::<_, String>(frames)
    })
    .await
    .map_err(|error| format!("SCREENSHOT_WORKER_FAILED: {error}"))??;

    let mut frames = HashMap::new();
    let mut geometries = Vec::new();
    for (
        monitor_id,
        physical_x,
        physical_y,
        physical_width,
        physical_height,
        scale_factor,
        image,
    ) in captured
    {
        let label = format!("capture-{session_id}-{monitor_id}");
        geometries.push((
            label.clone(),
            physical_x as f64 / scale_factor,
            physical_y as f64 / scale_factor,
            physical_width as f64 / scale_factor,
            physical_height as f64 / scale_factor,
        ));
        frames.insert(
            monitor_id.clone(),
            ScreenshotFrame {
                monitor_id,
                window_label: label,
                scale_factor,
                image,
            },
        );
    }

    // The session must exist before any WebView can execute capture.js.
    state.insert(ScreenshotSession {
        id: session_id.to_string(),
        created_at: Instant::now(),
        request,
        frames,
        ready_windows: HashSet::new(),
    })?;

    for (label, x, y, width, height) in geometries {
        WebviewWindowBuilder::new(app, &label, WebviewUrl::App("capture.html".into()))
            .title("LaTeXSnipper Capture")
            .position(x, y)
            .inner_size(width, height)
            .decorations(false)
            .resizable(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .focused(false)
            .visible(false)
            .build()
            .map_err(|error| format!("SCREENSHOT_WEBVIEW_BUILD_FAILED: {label}: {error}"))?;
    }

    let deadline = Instant::now() + OVERLAY_READY_TIMEOUT;
    while !state.all_ready(session_id)? {
        if Instant::now() >= deadline {
            return Err(
                "SCREENSHOT_OVERLAY_READY_TIMEOUT: overlays did not initialize within 3000ms"
                    .to_string(),
            );
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }

    let labels = state.with_session(session_id, |session| {
        Ok(session
            .frames
            .values()
            .map(|frame| frame.window_label.clone())
            .collect::<Vec<_>>())
    })?;
    for label in &labels {
        let window = app.get_webview_window(label).ok_or_else(|| {
            format!("SCREENSHOT_OVERLAY_WINDOW_MISSING: overlay disappeared: {label}")
        })?;
        window
            .show()
            .map_err(|error| format!("SCREENSHOT_OVERLAY_SHOW_FAILED: {label}: {error}"))?;
    }
    if let Some(first) = labels
        .first()
        .and_then(|label| app.get_webview_window(label))
    {
        first
            .set_focus()
            .map_err(|error| format!("SCREENSHOT_OVERLAY_FOCUS_FAILED: {error}"))?;
    }

    Ok(ScreenshotBeginResult {
        session_id: session_id.to_string(),
        monitor_count,
    })
}

#[tauri::command]
pub fn screenshot_overlay_init(
    window_label: String,
    state: State<'_, ScreenshotState>,
) -> Result<ScreenshotOverlayInit, String> {
    let (session_id, monitor_id) = parse_window_label(&window_label)?;
    state.with_session(session_id, |session| {
        let frame = session.frames.get(monitor_id).ok_or_else(|| {
            "SCREENSHOT_MONITOR_FRAME_MISSING: monitor frame not found".to_string()
        })?;
        let mut jpeg = Vec::new();
        let image = DynamicImage::ImageRgba8(frame.image.clone());
        JpegEncoder::new_with_quality(&mut jpeg, 88)
            .encode_image(&image)
            .map_err(|error| format!("SCREENSHOT_PREVIEW_ENCODING_FAILED: {error}"))?;
        Ok(ScreenshotOverlayInit {
            session_id: session_id.to_string(),
            monitor_id: monitor_id.to_string(),
            physical_width: frame.image.width(),
            physical_height: frame.image.height(),
            scale_factor: frame.scale_factor,
            preview_data_url: format!(
                "data:image/jpeg;base64,{}",
                base64::engine::general_purpose::STANDARD.encode(jpeg)
            ),
        })
    })
}

#[tauri::command]
pub fn screenshot_overlay_ready(
    window_label: String,
    state: State<'_, ScreenshotState>,
) -> Result<bool, String> {
    let (session_id, _) = parse_window_label(&window_label)?;
    state.mark_ready(session_id, &window_label)
}

#[tauri::command]
pub async fn screenshot_commit(
    app: AppHandle,
    state: State<'_, ScreenshotState>,
    request: ScreenshotCommitRequest,
) -> Result<ScreenshotCaptured, String> {
    let (session_id, _) = parse_window_label(&request.window_label)?;
    let session_id = session_id.to_string();
    let started = Instant::now();
    let target = state.with_session(&session_id, |session| Ok(session.request.clone()))?;
    let result = screenshot_commit_transaction(&app, &state, request).await;
    if let Err(error) = &result {
        rollback_capture(
            &app,
            &state,
            &session_id,
            &target,
            error_stage(error),
            error,
            started.elapsed(),
        );
    }
    result
}

async fn screenshot_commit_transaction(
    app: &AppHandle,
    state: &ScreenshotState,
    request: ScreenshotCommitRequest,
) -> Result<ScreenshotCaptured, String> {
    let (session_id, monitor_id) = parse_window_label(&request.window_label)?;
    let session_id = session_id.to_string();
    let monitor_id = monitor_id.to_string();
    let (cropped, target) = state.with_session(&session_id, |session| {
        let frame = session.frames.get(&monitor_id).ok_or_else(|| {
            "SCREENSHOT_MONITOR_FRAME_MISSING: monitor frame not found".to_string()
        })?;
        validate_selection(
            request.x,
            request.y,
            request.width,
            request.height,
            frame.image.width(),
            frame.image.height(),
        )?;
        let crop = crop_imm(
            &frame.image,
            request.x,
            request.y,
            request.width,
            request.height,
        )
        .to_image();
        Ok((crop, session.request.clone()))
    })?;

    let job_id = new_session_id();
    let job_dir = std::env::temp_dir()
        .join("latexsnipper")
        .join("jobs")
        .join(&job_id);
    std::fs::create_dir_all(&job_dir)
        .map_err(|error| format!("SCREENSHOT_JOB_DIRECTORY_FAILED: {error}"))?;
    let path = job_dir.join("source.png");
    cropped
        .save(&path)
        .map_err(|error| format!("SCREENSHOT_PNG_SAVE_FAILED: {error}"))?;

    let result = ScreenshotCaptured {
        path: path.to_string_lossy().to_string(),
        width: cropped.width(),
        height: cropped.height(),
        target_session_id: target.target_session_id,
        target_host: target.target_host,
        document_context: target.document_context,
        auto_insert: target.auto_insert,
    };
    app.emit("screenshot://captured", &result)
        .map_err(|error| format!("SCREENSHOT_CAPTURED_EMIT_FAILED: {error}"))?;
    close_capture_session(app, state, &session_id)?;
    Ok(result)
}

pub(crate) fn validate_selection(
    x: u32,
    y: u32,
    width: u32,
    height: u32,
    monitor_width: u32,
    monitor_height: u32,
) -> Result<(), String> {
    if width < 8 || height < 8 {
        return Err("SCREENSHOT_SELECTION_TOO_SMALL: minimum is 8x8 pixels".to_string());
    }
    let max_x = x
        .checked_add(width)
        .ok_or_else(|| "SCREENSHOT_SELECTION_INVALID: width overflow".to_string())?;
    let max_y = y
        .checked_add(height)
        .ok_or_else(|| "SCREENSHOT_SELECTION_INVALID: height overflow".to_string())?;
    if max_x > monitor_width || max_y > monitor_height {
        return Err(
            "SCREENSHOT_SELECTION_OUT_OF_BOUNDS: selection exceeds monitor bounds".to_string(),
        );
    }
    Ok(())
}

#[tauri::command]
pub fn screenshot_cancel(
    app: AppHandle,
    state: State<'_, ScreenshotState>,
    window_label: String,
) -> Result<(), String> {
    let (session_id, _) = parse_window_label(&window_label)?;
    close_capture_session(&app, &state, session_id)
}

fn close_capture_session(
    app: &AppHandle,
    state: &ScreenshotState,
    session_id: &str,
) -> Result<(), String> {
    let removed = state.remove(session_id);
    if let Ok(Some(session)) = &removed {
        for frame in session.frames.values() {
            if let Some(window) = app.get_webview_window(&frame.window_label) {
                let _ = window.close();
            }
        }
    }
    restore_main_window(app);
    removed.map(|_| ())
}

fn rollback_capture(
    app: &AppHandle,
    state: &ScreenshotState,
    session_id: &str,
    request: &ScreenshotBeginRequest,
    stage: &str,
    error: &str,
    elapsed: Duration,
) {
    let _ = close_capture_session(app, state, session_id);
    let failure = ScreenshotFailure {
        operation_id: session_id.to_string(),
        stage: stage.to_string(),
        host: request
            .target_host
            .clone()
            .unwrap_or_else(|| "desktop".to_string()),
        session_id: session_id.to_string(),
        document_context: request.document_context.clone(),
        elapsed_ms: elapsed.as_millis(),
        success: false,
        error_code: error_code(error).to_string(),
        error_message: error.to_string(),
    };
    let _ = app.emit("screenshot://failed", &failure);
    log::error!(
        "operationId={} stage={} host={} sessionId={} documentContextPresent={} elapsedMs={} success=false errorCode={} errorMessage={}",
        failure.operation_id,
        failure.stage,
        failure.host,
        failure.session_id,
        failure.document_context.is_some(),
        failure.elapsed_ms,
        failure.error_code,
        failure.error_message,
    );
}

fn restore_main_window(app: &AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.set_focus();
    }
}

fn error_code(error: &str) -> &str {
    error.split(':').next().unwrap_or("SCREENSHOT_FAILED")
}

fn error_stage(error: &str) -> &str {
    match error_code(error) {
        "SCREENSHOT_MONITOR_ENUMERATION_FAILED" | "SCREENSHOT_NO_MONITORS" => "monitor-enumeration",
        "SCREENSHOT_MONITOR_MAPPING_FAILED" => "monitor-mapping",
        "SCREENSHOT_CAPTURE_FAILED" | "SCREENSHOT_WORKER_FAILED" => "capture",
        "SCREENSHOT_PREVIEW_ENCODING_FAILED" => "preview-encoding",
        "SCREENSHOT_WEBVIEW_BUILD_FAILED" => "webview-build",
        "SCREENSHOT_OVERLAY_READY_TIMEOUT" | "SESSION_NOT_READY" => "overlay-ready",
        "SCREENSHOT_PNG_SAVE_FAILED" | "SCREENSHOT_JOB_DIRECTORY_FAILED" => "png-save",
        "SCREENSHOT_CAPTURED_EMIT_FAILED" => "event-emit",
        _ => "transaction",
    }
}
