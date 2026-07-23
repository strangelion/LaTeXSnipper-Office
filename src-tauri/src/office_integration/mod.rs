//! Office integration — unified insertion/coordination service.
//!
//! This module replaces ad-hoc insertion logic scattered across the
//! editor, OCR, history, and AI modules with a single unified API.
//!
//! Design:
//! - `OfficeIntegrationService` is the single entry point for all insertion.
//! - `OfficeCoordinator` handles host/session/document routing.
//! - `BatchConversionService` handles batch LaTeX→OMML workflows.

pub mod batch_conversion;
pub mod coordinator;
pub mod document_context;
pub mod dto;
pub mod office_js_registry;
pub mod sessions;

pub use coordinator::{OfficeCoordinator, ResolvedRoute};
