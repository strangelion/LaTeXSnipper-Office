//! Document context tracking for Office integration.
//!
//! Tracks the active document identity per session so commands
//! can validate they are operating on the expected document.

/// Placeholder for document context tracking.
///
/// In the current architecture this is handled by `SessionManager.OfficeSession.document_id`.
/// This module provides extension points for more granular context tracking
/// (e.g., tracking the cursor position within a specific document part).
#[allow(dead_code)]
pub struct DocumentContext {
    /// The document's unique context identifier.
    pub context_id: String,

    /// Display title (if available).
    pub title: Option<String>,

    /// Host application.
    pub host: String,
}
