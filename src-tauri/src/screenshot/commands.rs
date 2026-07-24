use std::{
    collections::HashMap,
    time::Duration,
};

use base64::Engine;
use image::{
    codecs::jpeg::JpegEncoder,
    imageops::crop_imm,
    DynamicImage,
};
use tauri::{
    AppHandle,
    Emitter,
    Manager,
    State,
    WebviewUrl,
    WebviewWindowBuilder,
};
use xcap::Monitor;

use super::{
    dto::{
        ScreenshotBeginRequest,
        ScreenshotBeginResult,
        ScreenshotCaptured,
        ScreenshotCommitRequest,
        ScreenshotOverlayInit,
    },
    state::{
        ScreenshotFrame,
        ScreenshotSession,
        ScreenshotState,
    },
};

fn new_session_id() -> String {
    format!("{:032x}", rand::random::<u128>())
}

pub(crate) fn parse_window_label(label: &str) -> Result<(&str, &str), String> {
    let value = label
        .strip_prefix("capture-")
        .ok_or_else(|| "Invalid capture window label".to_string())?;

    value
        .split_once('-')
        .ok_or_else(|| "Invalid capture window label".to_string())
}

#[tauri::command]
pub async fn screenshot_begin(
    app: AppHandle,
    state: State<'_, ScreenshotState>,
    request: ScreenshotBeginRequest,
) -> Result<ScreenshotBeginResult, String> {
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;

    main.hide().map_err(|e| e.to_string())?;

    // Wait for window manager to finish repaint, avoid capturing ourselves
    tokio::time::sleep(Duration::from_millis(180)).await;

    let tauri_monitors = app
        .available_monitors()
        .map_err(|e| format!("Cannot enumerate monitors: {e}"))?;

    if tauri_monitors.is_empty() {
        let _ = main.show();
        return Err("No monitor found".to_string());
    }

    let session_id = new_session_id();

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

            let monitor = Monitor::from_point(center_x, center_y)
                .map_err(|e| format!("Cannot resolve monitor {monitor_id}: {e}"))?;

            let image = monitor
                .capture_image()
                .map_err(|e| format!("Cannot capture monitor {monitor_id}: {e}"))?;

            frames.push((
                monitor_id,
                x,
                y,
                width,
                height,
                scale_factor,
                image,
            ));
        }

        Ok::<_, String>(frames)
    })
    .await
    .map_err(|e| format!("Screenshot worker failed: {e}"))??;

    let mut frames = HashMap::new();

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

        let logical_x = physical_x as f64 / scale_factor;
        let logical_y = physical_y as f64 / scale_factor;
        let logical_width = physical_width as f64 / scale_factor;
        let logical_height = physical_height as f64 / scale_factor;

        WebviewWindowBuilder::new(
            &app,
            &label,
            WebviewUrl::App("capture.html".into()),
        )
        .title("LaTeXSnipper Capture")
        .position(logical_x, logical_y)
        .inner_size(logical_width, logical_height)
        .decorations(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(true)
        .build()
        .map_err(|e| format!("Cannot create capture window: {e}"))?;

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

    state.insert(ScreenshotSession {
        id: session_id.clone(),
        created_at: std::time::Instant::now(),
        request,
        frames,
    })?;

    Ok(ScreenshotBeginResult {
        session_id,
        monitor_count: tauri_monitors.len(),
    })
}

#[tauri::command]
pub fn screenshot_overlay_init(
    window_label: String,
    state: State<'_, ScreenshotState>,
) -> Result<ScreenshotOverlayInit, String> {
    let (session_id, monitor_id) = parse_window_label(&window_label)?;

    state.with_session(session_id, |session| {
        let frame = session
            .frames
            .get(monitor_id)
            .ok_or_else(|| "Monitor frame not found".to_string())?;

        let mut jpeg = Vec::new();
        let image = DynamicImage::ImageRgba8(frame.image.clone());

        JpegEncoder::new_with_quality(&mut jpeg, 88)
            .encode_image(&image)
            .map_err(|e| format!("Preview encoding failed: {e}"))?;

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
pub async fn screenshot_commit(
    app: AppHandle,
    state: State<'_, ScreenshotState>,
    request: ScreenshotCommitRequest,
) -> Result<ScreenshotCaptured, String> {
    let (session_id, monitor_id) = parse_window_label(&request.window_label)?;
    let session_id = session_id.to_string();
    let monitor_id = monitor_id.to_string();

    let (cropped, target) = state.with_session(&session_id, |session| {
        let frame = session
            .frames
            .get(&monitor_id)
            .ok_or_else(|| "Monitor frame not found".to_string())?;

        if request.width < 8 || request.height < 8 {
            return Err("Selected region is too small".to_string());
        }

        let max_x = request
            .x
            .checked_add(request.width)
            .ok_or_else(|| "Invalid selection width".to_string())?;
        let max_y = request
            .y
            .checked_add(request.height)
            .ok_or_else(|| "Invalid selection height".to_string())?;

        if max_x > frame.image.width() || max_y > frame.image.height() {
            return Err("Selected region exceeds monitor bounds".to_string());
        }

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
        .map_err(|e| format!("Cannot create screenshot job directory: {e}"))?;

    let path = job_dir.join("source.png");

    cropped
        .save(&path)
        .map_err(|e| format!("Cannot save screenshot: {e}"))?;

    close_capture_session(&app, &state, &session_id)?;

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
        .map_err(|e| e.to_string())?;

    Ok(result)
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
    if let Some(session) = state.remove(session_id)? {
        for frame in session.frames.values() {
            if let Some(window) = app.get_webview_window(&frame.window_label) {
                let _ = window.close();
            }
        }
    }

    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.set_focus();
    }

    Ok(())
}
