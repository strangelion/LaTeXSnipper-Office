// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod engine;
mod math;
mod platforms;

use tauri::{
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_os::init())
        .setup(|app| {
            // System tray
            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("LaTeXSnipper Office")
                .on_tray_icon_event(|tray_icon, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray_icon.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            // Exit app when main window is closed
            let handle = app.handle().clone();
            if let Some(window) = app.get_webview_window("main") {
                let h = handle.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::Destroyed = event {
                        h.exit(0);
                    }
                });
            }

            // Global shortcut
            let handle = app.handle().clone();
            let shortcut = if cfg!(target_os = "macos") {
                "Command+Shift+L"
            } else {
                "Control+Shift+L"
            };

            app.global_shortcut()
                .on_shortcut(shortcut, move |_app, _shortcut, event| {
                    if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        if let Some(window) = handle.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })?;

            // Start HTTP bridge server for VBA communication
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                platforms::office_bridge::start_bridge_server(app_handle).await;
            });

            // Auto-register COM add-in on first run
            let app_handle2 = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                platforms::integrations::auto_register_office_addin(&app_handle2).await;
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::formula::render_formula,
            commands::formula::apply_font_style,
            commands::formula::apply_color,
            commands::metadata::validate_metadata,
            commands::metadata::create_metadata,
            commands::export::export_formula,
            commands::export::copy_to_clipboard,
            commands::ocr::screenshot_capture,
            commands::ocr::ocr_recognize,
            commands::office::insert_formula,
            commands::office::load_selection,
            commands::office::delete_selection,
            commands::office::convert_to_ole,
            commands::office::convert_to_word,
            commands::office::insert_reference,
            commands::office::add_number,
            commands::office::renumber,
            commands::office::insert_chapter_separator,
            commands::office::insert_section_separator,
            commands::office::format_selection,
            commands::office::format_all,
            commands::office::load_table,
            commands::office::toggle_status_pane,
            commands::office::open_settings,
            commands::office::show_help,
            platforms::office::detect_office,
            platforms::office::register_office,
            platforms::office::unregister_office,
            platforms::office::check_office_registration,
            platforms::office::write_pending_formula,
            platforms::integrations::install_platform_integration,
            platforms::integrations::uninstall_platform_integration,
            platforms::integrations::check_platform_integration,
            math::omml_to_latex,
            math::latex_to_omml,
            math::mathml_to_latex,
            math::convert_formula,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
