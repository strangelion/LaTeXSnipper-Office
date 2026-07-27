use std::{
    collections::{HashMap, HashSet},
    time::{Duration, Instant},
};

use image::{
    codecs::jpeg::JpegEncoder,
    imageops::{crop_imm, resize, FilterType},
    DynamicImage,
};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use xcap::Monitor;

use super::{
    dto::{
        ScreenPosition, ScreenshotBeginRequest, ScreenshotBeginResult, ScreenshotCaptured,
        ScreenshotCommitRequest, ScreenshotFailure, ScreenshotOverlayInit,
    },
    lease::{register_job, release_job_path, JobOwner},
    state::{ScreenshotFrame, ScreenshotSession, ScreenshotState},
};

const PREVIEW_MAX_EDGE: u32 = 2560;

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

    let preview_root = std::env::temp_dir()
        .join("latexsnipper")
        .join("previews")
        .join(session_id);
    std::fs::create_dir_all(&preview_root)
        .map_err(|error| format!("SCREENSHOT_PREVIEW_DIRECTORY_FAILED: {error}"))?;
    let capture_started = Instant::now();
    let preview_root_worker = preview_root.clone();
    let captured = tauri::async_runtime::spawn_blocking(move || {
        let mut frames = Vec::new();
        let mut capture_ms = 0u128;
        let mut encode_ms = 0u128;
        let mut peak_memory_estimate = 0u64;
        for (monitor_id, x, y, width, height, scale_factor) in monitor_specs {
            let center_x = x + i32::try_from(width / 2).unwrap_or(0);
            let center_y = y + i32::try_from(height / 2).unwrap_or(0);
            let monitor = Monitor::from_point(center_x, center_y).map_err(|error| {
                format!("SCREENSHOT_MONITOR_MAPPING_FAILED: {monitor_id}: {error}")
            })?;
            let monitor_capture_started = Instant::now();
            let image = monitor
                .capture_image()
                .map_err(|error| format!("SCREENSHOT_CAPTURE_FAILED: {monitor_id}: {error}"))?;
            capture_ms = capture_ms.saturating_add(monitor_capture_started.elapsed().as_millis());
            let (preview_width, preview_height) = preview_dimensions(image.width(), image.height());
            let encode_started = Instant::now();
            let preview = resize(&image, preview_width, preview_height, FilterType::Triangle);
            let mut jpeg = Vec::new();
            JpegEncoder::new_with_quality(&mut jpeg, 84)
                .encode_image(&DynamicImage::ImageRgba8(preview))
                .map_err(|error| format!("SCREENSHOT_PREVIEW_ENCODING_FAILED: {error}"))?;
            let preview_path = preview_root_worker.join(format!("{monitor_id}.jpg"));
            std::fs::write(&preview_path, &jpeg)
                .map_err(|error| format!("SCREENSHOT_PREVIEW_WRITE_FAILED: {error}"))?;
            encode_ms = encode_ms.saturating_add(encode_started.elapsed().as_millis());
            peak_memory_estimate = peak_memory_estimate.saturating_add(
                u64::from(image.width())
                    .saturating_mul(u64::from(image.height()))
                    .saturating_mul(4)
                    .saturating_add(jpeg.len() as u64),
            );
            frames.push((
                monitor_id,
                x,
                y,
                width,
                height,
                scale_factor,
                image,
                preview_width,
                preview_height,
                preview_path,
            ));
        }
        Ok::<_, String>((frames, capture_ms, encode_ms, peak_memory_estimate))
    })
    .await
    .map_err(|error| format!("SCREENSHOT_WORKER_FAILED: {error}"))??;
    let (captured, capture_ms, encode_ms, peak_memory_estimate) = captured;
    debug_assert!(capture_started.elapsed().as_millis() >= capture_ms);

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
        preview_width,
        preview_height,
        preview_path,
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
                logical_x: physical_x as f64 / scale_factor,
                logical_y: physical_y as f64 / scale_factor,
                physical_x: f64::from(physical_x),
                physical_y: f64::from(physical_y),
                preview_width,
                preview_height,
                preview_path,
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
        preview_decode_ms: 0,
    })?;

    let webview_started = Instant::now();
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
    let webview_build_ms = webview_started.elapsed().as_millis();

    let ready_timeout = overlay_ready_timeout(
        monitor_count,
        state
            .with_session(session_id, |session| {
                Ok(session
                    .frames
                    .values()
                    .map(|frame| (frame.image.width(), frame.image.height()))
                    .collect::<Vec<_>>())
            })?
            .as_slice(),
    );
    let ready_started = Instant::now();
    let deadline = Instant::now() + ready_timeout;
    while !state.all_ready(session_id)? {
        if Instant::now() >= deadline {
            return Err(format!(
                "SCREENSHOT_OVERLAY_READY_TIMEOUT: overlays did not initialize within {}ms",
                ready_timeout.as_millis()
            ));
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    let ready_wait_ms = ready_started.elapsed().as_millis();

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

    log::info!(
        "captureMs={} encodeMs={} webviewBuildMs={} previewDecodeMs={} readyWaitMs={} peakMemoryEstimate={}",
        capture_ms,
        encode_ms,
        webview_build_ms,
        state.with_session(session_id, |session| Ok(session.preview_decode_ms))?,
        ready_wait_ms,
        peak_memory_estimate
    );
    Ok(ScreenshotBeginResult {
        session_id: session_id.to_string(),
        monitor_count,
        capture_ms,
        encode_ms,
        webview_build_ms,
        ready_wait_ms,
        peak_memory_estimate,
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
        Ok(ScreenshotOverlayInit {
            session_id: session_id.to_string(),
            monitor_id: monitor_id.to_string(),
            physical_width: frame.image.width(),
            physical_height: frame.image.height(),
            preview_width: frame.preview_width,
            preview_height: frame.preview_height,
            scale_factor: frame.scale_factor,
            logical_position: ScreenPosition {
                x: frame.logical_x,
                y: frame.logical_y,
            },
            physical_position: ScreenPosition {
                x: frame.physical_x,
                y: frame.physical_y,
            },
            preview_path: frame.preview_path.to_string_lossy().to_string(),
        })
    })
}

#[tauri::command]
pub fn screenshot_overlay_ready(
    window_label: String,
    preview_decode_ms: Option<u64>,
    state: State<'_, ScreenshotState>,
) -> Result<bool, String> {
    let (session_id, _) = parse_window_label(&window_label)?;
    state.mark_ready(session_id, &window_label, preview_decode_ms.unwrap_or(0))
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
    let owner = if target.target_session_id.is_some() {
        JobOwner::Office
    } else {
        JobOwner::Desktop
    };
    if let Err(error) = register_job(&job_id, &path, owner) {
        let _ = release_job_path(&path);
        return Err(error);
    }

    let result = ScreenshotCaptured {
        path: path.to_string_lossy().to_string(),
        width: cropped.width(),
        height: cropped.height(),
        target_session_id: target.target_session_id,
        target_host: target.target_host,
        document_context: target.document_context,
        auto_insert: target.auto_insert,
    };
    if let Err(error) = app.emit("screenshot://captured", &result) {
        let _ = release_job_path(&path);
        return Err(format!("SCREENSHOT_CAPTURED_EMIT_FAILED: {error}"));
    }
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
        if let Some(preview_root) = session
            .frames
            .values()
            .next()
            .and_then(|frame| frame.preview_path.parent())
        {
            let _ = std::fs::remove_dir_all(preview_root);
        }
    }
    restore_main_window(app);
    removed.map(|_| ())
}

pub(crate) fn preview_dimensions(width: u32, height: u32) -> (u32, u32) {
    let longest = width.max(height);
    if longest <= PREVIEW_MAX_EDGE || longest == 0 {
        return (width, height);
    }
    let scale = f64::from(PREVIEW_MAX_EDGE) / f64::from(longest);
    (
        (f64::from(width) * scale).round().max(1.0) as u32,
        (f64::from(height) * scale).round().max(1.0) as u32,
    )
}

pub(crate) fn overlay_ready_timeout(
    monitor_count: usize,
    physical_sizes: &[(u32, u32)],
) -> Duration {
    let pixels = physical_sizes.iter().fold(0u64, |total, (width, height)| {
        total.saturating_add(u64::from(*width).saturating_mul(u64::from(*height)))
    });
    let megapixels = pixels.div_ceil(1_000_000);
    let millis = 2_000u64
        .saturating_add((monitor_count as u64).saturating_mul(500))
        .saturating_add(megapixels.saturating_mul(75))
        .clamp(3_000, 8_000);
    Duration::from_millis(millis)
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
    let preview_root = std::env::temp_dir()
        .join("latexsnipper")
        .join("previews")
        .join(session_id);
    let _ = std::fs::remove_dir_all(preview_root);
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
        "SCREENSHOT_PREVIEW_DIRECTORY_FAILED" | "SCREENSHOT_PREVIEW_WRITE_FAILED" => {
            "preview-write"
        }
        "SCREENSHOT_WEBVIEW_BUILD_FAILED" => "webview-build",
        "SCREENSHOT_OVERLAY_READY_TIMEOUT" | "SESSION_NOT_READY" => "overlay-ready",
        "SCREENSHOT_PNG_SAVE_FAILED" | "SCREENSHOT_JOB_DIRECTORY_FAILED" => "png-save",
        "SCREENSHOT_CAPTURED_EMIT_FAILED" => "event-emit",
        _ => "transaction",
    }
}
