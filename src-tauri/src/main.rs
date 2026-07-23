// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod engine;
mod math;
mod office_integration;
mod platforms;
mod recognition;

use std::sync::Arc;
use tauri::{
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

#[cfg(target_os = "windows")]
use platforms::session::SessionManager;

fn main() {
    // Set up panic hook to write crash info to a file
    let log_dir = dirs_next::data_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("LaTeXSnipper");

    // In release builds, capture all log output to a persistent file.
    // env_logger still runs for console output in debug builds.
    #[cfg(not(debug_assertions))]
    platforms::logging::init_file_logging(&log_dir);

    std::fs::create_dir_all(&log_dir).ok();
    let log_path = log_dir.join("crash.log");
    let prev_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let msg = format!(
            "[{}] PANIC: {}\n",
            chrono::Local::now().format("%Y-%m-%d %H:%M:%S"),
            info
        );
        let _ = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
            .map(|mut f| std::io::Write::write_all(&mut f, msg.as_bytes()));
        prev_hook(info);
    }));

    // Collect args before Tauri consumes them
    #[cfg(target_os = "windows")]
    let args: Vec<String> = std::env::args().collect();

    // Extract OLE edit pipe name early so closure can own it
    #[cfg(target_os = "windows")]
    let ole_pipe_name: Option<String> = args
        .iter()
        .position(|a| a == "--ole-edit")
        .and_then(|i| args.get(i + 1).cloned());

    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .try_init()
        .ok();
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let transaction_store = Arc::new(
                platforms::office_transactions::OfficeEditTransactionStore::new()
                    .map_err(std::io::Error::other)?,
            );
            app.manage(transaction_store);
            let conversation_import_store = Arc::new(
                platforms::conversation_import::ConversationImportStore::new()
                    .map_err(std::io::Error::other)?,
            );
            app.manage(conversation_import_store.clone());

            // Shared Office.js session registry (Bridge + Coordinator)
            let js_registry =
                Arc::new(office_integration::office_js_registry::OfficeJsSessionRegistry::new());

            let bridge_runtime = Arc::new(platforms::office_bridge::BridgeRuntimeState::new(
                app.handle().clone(),
                conversation_import_store,
                js_registry.clone(),
            ));
            app.manage(bridge_runtime.clone());

            // Live editing session store (volatile in-memory layer)
            let live_edit_store = platforms::office_live_edit::LiveOfficeEditSessionStore::new();
            app.manage(live_edit_store);

            // Commit coordinator for requestId<->transactionId correlation
            let commit_coordinator = platforms::office_commit::CommitCoordinator::new();
            app.manage(commit_coordinator);

            // Unified request waiter for pipe command results
            let request_waiter = platforms::office_commit::RequestWaiter::new();
            app.manage(request_waiter);

            // Recognition subsystem state (lazy — no runtime init at startup)
            let recognition_paths = recognition::paths::RecognitionPaths::resolve(app.handle())
                .map_err(std::io::Error::other)?;
            app.manage(recognition::state::RecognitionState::new(recognition_paths));

            #[cfg(target_os = "windows")]
            let is_ole_edit = ole_pipe_name.is_some();
            #[cfg(not(target_os = "windows"))]
            let is_ole_edit = false;

            // Skip heavy initialization in OLE edit mode (P1-2).
            // --ole-edit should only open a minimal editor window without
            // tray, global shortcuts, or VSTO named pipe server.
            //
            // The office bridge is still needed for formula rendering.
            if !is_ole_edit {
                // System tray
                let _tray = TrayIconBuilder::new()
                    .icon(app.default_window_icon().unwrap().clone())
                    .tooltip("LaTeXSnipper Office")
                    .icon_as_template(true)
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
                    let _h = handle.clone();
                    window.on_window_event(move |event| {
                        if let tauri::WindowEvent::CloseRequested { .. } = event {
                            std::process::exit(0);
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
            } else {
                // In OLE edit mode, we still need a minimal window setup
                let _handle = app.handle().clone();
                if let Some(window) = app.get_webview_window("main") {
                    window.on_window_event(move |event| {
                        if let tauri::WindowEvent::CloseRequested { .. } = event {
                            std::process::exit(0);
                        }
                    });
                }
            }

            // Create SessionManager and start Named Pipe server (Windows only, skip in OLE edit)
            #[cfg(target_os = "windows")]
            if !is_ole_edit {
                let app_handle = app.handle().clone();
                let session_manager = Arc::new(SessionManager::new(app_handle.clone()));
                app.manage(session_manager.clone());

                // Coordinator needs SessionManager already managed
                let coordinator = office_integration::OfficeCoordinator::new(
                    session_manager.clone(),
                    js_registry.clone(),
                );
                app.manage(coordinator);

                tauri::async_runtime::spawn(async move {
                    platforms::pipe_server::start_pipe_server(app_handle, session_manager).await;
                });

                let dispatcher_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    platforms::ole_edit::start_ole_edit_dispatcher(dispatcher_handle).await;
                });

                // Write InstallPath so OLE DLL can find the Desktop exe
                platforms::integrations::register_install_path();
            }

            // Start Office Bridge (HTTPS, port 19876) — always needed for rendering
            let bridge_handle = app.handle().clone();
            let bridge_state = bridge_runtime.clone();
            tauri::async_runtime::spawn(async move {
                platforms::office_bridge::start_bridge_server(bridge_handle, bridge_state).await;
            });

            // Handle OLE edit session (--ole-edit flag) within Tauri runtime
            #[cfg(target_os = "windows")]
            {
                if let Some(pipe_name) = ole_pipe_name {
                    let app_handle = app.handle().clone();
                    tauri::async_runtime::spawn(async move {
                        match platforms::ole_edit::handle_ole_edit_session_with_app(
                            app_handle, &pipe_name,
                        )
                        .await
                        {
                            Ok(()) => std::process::exit(0),
                            Err(e) => {
                                log::error!("OLE edit session failed: {}", e);
                                std::process::exit(1);
                            }
                        }
                    });
                }
            }

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
            #[allow(deprecated)]
            commands::ocr::ocr_recognize,
            commands::recognition_cmd::recognition_get_capabilities,
            commands::recognition_cmd::recognition_start,
            commands::recognition_cmd::recognition_get_job,
            commands::recognition_cmd::recognition_list_jobs,
            commands::recognition_cmd::recognition_cancel,
            commands::recognition_cmd::recognition_get_output,
            commands::recognition_export::recognition_export,
            commands::models::model_list,
            commands::models::model_inspect_package,
            commands::models::model_import_package,
            commands::models::model_remove,
            commands::models::model_refresh,
            commands::runtimes::runtime_list,
            commands::runtimes::runtime_probe,
            commands::runtimes::runtime_open_directory,
            #[cfg(target_os = "windows")]
            commands::office_batch::office_batch_scan_latex,
            commands::office_batch::office_batch_convert_plan,
            #[cfg(target_os = "windows")]
            commands::office_batch::office_batch_execute,
            commands::office_artifact::office_resolve_route,
            #[cfg(target_os = "windows")]
            commands::office_artifact::office_insert_artifact,
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
            platforms::office_bridge::get_bridge_runtime_diagnostics,
            platforms::office_bridge::list_ecosystem_clients_internal,
            platforms::office_bridge::get_ecosystem_action_status_internal,
            platforms::office_bridge::submit_office_render_asset_result,
            platforms::office_bridge::push_ecosystem_action_internal,
            platforms::office_transactions::begin_office_edit_transaction,
            platforms::office_transactions::get_office_edit_transaction,
            platforms::office_transactions::update_office_edit_draft,
            platforms::office_transactions::prepare_office_edit_commit,
            platforms::office_transactions::mark_office_edit_committing,
            platforms::office_transactions::complete_office_edit_transaction,
            platforms::office_transactions::cancel_office_edit_transaction,
            platforms::office_transactions::list_recoverable_office_transactions,
            platforms::office_transactions::discard_stale_office_transaction,
            platforms::office_live_edit::start_live_office_edit,
            platforms::office_live_edit::update_live_office_draft,
            platforms::office_live_edit::submit_live_office_render,
            platforms::office_live_edit::get_live_office_snapshot,
            platforms::office_live_edit::close_live_office_edit,
            platforms::office_live_edit::list_active_live_office_sessions,
            platforms::office_live_edit::checkpoint_live_office_dirty,
            platforms::office_live_edit::needs_live_office_checkpoint,
            platforms::office_render::render_live_preview,
            platforms::office_render::render_live_preview_batch,
            platforms::office_commit::register_pending_commit,
            platforms::conversation_import::list_browser_imports,
            platforms::conversation_import::get_browser_import,
            platforms::conversation_import::update_browser_import_preview,
            platforms::conversation_import::build_browser_word_import_plan,
            platforms::conversation_import::cancel_browser_import,
            platforms::conversation_import::complete_browser_import,
            platforms::integrations::install_platform_integration,
            platforms::integrations::install_obsidian_to_vault,
            platforms::integrations::uninstall_platform_integration,
            platforms::integrations::check_platform_integration,
            platforms::integrations::get_office_web_diagnostics,
            platforms::office::invalidate_office_cache,
            math::omml_to_latex,
            math::latex_to_omml,
            math::mathml_to_latex,
            math::convert_formula,
            #[cfg(target_os = "windows")]
            commands::native_office::native_office_sessions,
            #[cfg(target_os = "windows")]
            commands::native_office::native_office_insert_formula,
            #[cfg(target_os = "windows")]
            commands::native_office::native_office_replace_formula,
            #[cfg(target_os = "windows")]
            commands::native_office::native_office_read_formula_by_id,
            #[cfg(target_os = "windows")]
            commands::native_office::native_office_insert_table,
            #[cfg(target_os = "windows")]
            commands::native_office::native_office_delete_current,
            #[cfg(target_os = "windows")]
            commands::native_office::native_office_format_selection,
            #[cfg(target_os = "windows")]
            commands::native_office::native_office_format_all,
            #[cfg(target_os = "windows")]
            commands::native_office::native_office_renumber_word,
            #[cfg(target_os = "windows")]
            commands::native_office::native_office_insert_reference,
            #[cfg(target_os = "windows")]
            commands::native_office::native_office_request_read_selection,
            #[cfg(target_os = "windows")]
            commands::native_office::native_office_request_read_table,
            #[cfg(target_os = "windows")]
            commands::native_office::native_office_import_conversation,
            #[cfg(target_os = "windows")]
            commands::native_office::native_office_generate_and_insert,
            #[cfg(target_os = "windows")]
            commands::native_office::native_office_generate_and_import,
            #[cfg(target_os = "windows")]
            commands::native_office::native_office_ai_test_connection,
            #[cfg(target_os = "windows")]
            commands::native_office::native_office_status,
            #[cfg(target_os = "windows")]
            commands::native_office::native_office_install,
            #[cfg(target_os = "windows")]
            commands::native_office::native_office_repair,
            #[cfg(target_os = "windows")]
            commands::native_office::native_office_uninstall,
            #[cfg(target_os = "windows")]
            commands::native_office::native_office_vsto_trust_status,
            #[cfg(target_os = "windows")]
            commands::native_office::native_office_ole_status,
            #[cfg(target_os = "windows")]
            commands::native_office::native_office_install_ole,
            #[cfg(target_os = "windows")]
            commands::native_office::native_office_uninstall_ole,
            #[cfg(target_os = "windows")]
            commands::native_office::native_office_validate_ole,
            #[cfg(target_os = "windows")]
            commands::native_office::native_office_repair_vsto,
            #[cfg(target_os = "windows")]
            commands::native_office::export_diagnostics,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
