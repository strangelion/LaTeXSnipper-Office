//! Recognition settings persisted to disk.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Persistent recognition settings stored as JSON.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecognitionSettings {
    /// Default recognition mode: "auto", "formula", "text", "table", "full-document"
    pub default_mode: String,

    /// Document parsing mode: "full", "formula-only", etc.
    pub parse_mode: String,

    /// Execution policy: "sync", "async"
    pub execution_policy: String,

    /// Maximum threads for inference.
    pub max_threads: usize,

    /// Per-category default model variant.
    pub default_models: HashMap<String, String>,

    /// Liquid glass UI effect preference.
    pub liquid_glass: String,
}

impl Default for RecognitionSettings {
    fn default() -> Self {
        let mut default_models = HashMap::new();
        default_models.insert("formula-detection".to_string(), "auto".to_string());
        default_models.insert("formula-recognition".to_string(), "auto".to_string());
        default_models.insert("text-detection".to_string(), "auto".to_string());
        default_models.insert("text-recognition".to_string(), "auto".to_string());
        default_models.insert("table-detection".to_string(), "auto".to_string());
        default_models.insert("table-structure".to_string(), "auto".to_string());

        Self {
            default_mode: "auto".to_string(),
            parse_mode: "full".to_string(),
            execution_policy: "async".to_string(),
            max_threads: 4,
            default_models,
            liquid_glass: "toolbar-only".to_string(),
        }
    }
}

impl RecognitionSettings {
    /// Load settings from path, falling back to defaults.
    pub fn load(path: &std::path::Path) -> Result<Self, String> {
        if !path.exists() {
            let defaults = Self::default();
            defaults.save(path)?;
            return Ok(defaults);
        }

        let content = std::fs::read_to_string(path)
            .map_err(|e| format!("Cannot read settings: {e}"))?;

        serde_json::from_str(&content)
            .map_err(|e| format!("Cannot parse settings: {e}"))
    }

    /// Save settings to path.
    pub fn save(&self, path: &std::path::Path) -> Result<(), String> {
        let content = serde_json::to_string_pretty(self)
            .map_err(|e| format!("Cannot serialize settings: {e}"))?;

        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Cannot create settings directory: {e}"))?;
        }

        std::fs::write(path, &content)
            .map_err(|e| format!("Cannot write settings: {e}"))
    }
}
