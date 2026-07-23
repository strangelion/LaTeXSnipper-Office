//! Recognition module — lazy-loaded OCR/document recognition subsystem.
//!
//! Design principles:
//! - No runtime/engine initialization at application start.
//! - Paths are resolved via `tauri::AppHandle` (no hard-coded directories).
//! - Service is lazily created on first recognition request.
//! - Hot-swap: installing models rebuilds the service without affecting in-flight jobs.
//! - Old jobs keep using their Arc<Service>, new jobs use the latest service.

pub mod dto;
pub mod jobs;
pub mod paths;
pub mod settings;
pub mod state;
pub mod validation;

#[cfg(test)]
mod tests;
