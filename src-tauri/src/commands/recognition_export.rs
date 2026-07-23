//! Recognition export commands.
//!
//! Commands:
//! - `recognition_export` — Export recognition result to a file.

use tauri::State;

use crate::recognition::dto::GetOutputRequest;
use crate::recognition::state::RecognitionState;

/// Export a completed recognition job's output to a file.
#[tauri::command]
pub async fn recognition_export(
    state: State<'_, RecognitionState>,
    job_id: String,
    format: String,
    output_path: String,
) -> Result<String, String> {
    // Re-use recognition_get_output logic
    let request = GetOutputRequest {
        job_id: job_id.clone(),
        format: format.clone(),
    };

    let output = super::recognition_cmd::recognition_get_output(
        state,
        request,
    )
    .await?;

    if !output.success {
        return Err(output.error.unwrap_or_else(|| "Unknown error".to_string()));
    }

    let content = output.content.unwrap_or_default();

    std::fs::write(&output_path, &content)
        .map_err(|e| format!("Cannot write output file: {e}"))?;

    Ok(format!("Exported to {output_path}"))
}
