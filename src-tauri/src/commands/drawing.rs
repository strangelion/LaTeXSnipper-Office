use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::path::PathBuf;

use latexsnipper_drawing::{
    drawing_readiness, DrawingCompileService, DrawingDocument, DrawingFailureCandidate,
    DrawingFailureSink, DrawingOfficePayload, DrawingPackageProfile, DrawingReadiness,
    DrawingSecurityPolicy, DrawingSourceLanguage, ExecutableIdentity,
};
use serde::{Deserialize, Serialize};
use tauri::Manager;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompileDrawingRequest {
    pub drawing_id: String,
    pub language: DrawingSourceLanguage,
    pub source: String,
    #[serde(default)]
    pub package_profiles: Vec<DrawingPackageProfile>,
    pub package_lock_sha256: Option<String>,
    pub renderer_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompileDrawingResponse {
    pub success: bool,
    pub payload: Option<DrawingOfficePayload>,
    pub svg: Option<String>,
    pub readiness: DrawingReadiness,
    pub error: Option<String>,
    pub failure_candidate: Option<DrawingFailureCandidate>,
}

#[derive(Default)]
struct FailureCollector(Option<DrawingFailureCandidate>);

impl DrawingFailureSink for FailureCollector {
    fn record(&mut self, candidate: DrawingFailureCandidate) {
        self.0 = Some(candidate);
    }
}

fn configured_identity(name: &str) -> Option<ExecutableIdentity> {
    let prefix = format!("LATEXSNIPPER_DRAWING_{}", name.to_ascii_uppercase());
    let path = env::var(format!("{prefix}_PATH")).ok()?;
    let version = env::var(format!("{prefix}_VERSION")).ok()?;
    let sha256 = env::var(format!("{prefix}_SHA256")).ok()?;
    Some(ExecutableIdentity {
        path: PathBuf::from(path),
        version,
        sha256,
    })
}

fn drawing_policy() -> DrawingSecurityPolicy {
    let mut policy = DrawingSecurityPolicy::default();
    for name in ["tectonic", "dvisvgm", "graphviz"] {
        if let Some(identity) = configured_identity(name) {
            policy.allowed_executables.insert(name.to_owned(), identity);
        }
    }
    policy.allow_external_processes = !policy.allowed_executables.is_empty();
    if policy.allowed_executables.contains_key("graphviz") {
        policy.available_graphviz_outputs.insert("svg".to_owned());
    }
    policy
}

fn package_locks(
    profiles: &[DrawingPackageProfile],
    package_lock_sha256: Option<&String>,
) -> BTreeMap<DrawingPackageProfile, String> {
    let Some(digest) = package_lock_sha256 else {
        return BTreeMap::new();
    };
    profiles
        .iter()
        .copied()
        .map(|profile| (profile, digest.clone()))
        .collect()
}

fn view_box_size(view_box: &str) -> Result<(f64, f64), String> {
    let values = view_box
        .split(|character: char| character.is_ascii_whitespace() || character == ',')
        .filter(|part| !part.is_empty())
        .map(str::parse::<f64>)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("DRAWING_VIEWBOX_INVALID: {error}"))?;
    match values.as_slice() {
        [_, _, width, height] if *width > 0.0 && *height > 0.0 => Ok((*width, *height)),
        _ => Err("DRAWING_VIEWBOX_INVALID: expected four values with positive size".to_owned()),
    }
}

fn compiler_fingerprint(language: DrawingSourceLanguage, policy: &DrawingSecurityPolicy) -> String {
    let key = match language {
        DrawingSourceLanguage::Tikz => Some("tectonic"),
        DrawingSourceLanguage::GraphvizDot => Some("graphviz"),
        DrawingSourceLanguage::SvgSource => None,
        _ => None,
    };
    key.and_then(|key| policy.allowed_executables.get(key))
        .map(|identity| {
            format!(
                "{}@{}+sha256:{}",
                key.unwrap(),
                identity.version,
                identity.sha256
            )
        })
        .unwrap_or_else(|| "latexsnipper-svg-sanitizer@1".to_owned())
}

fn persist_failure_candidate(
    app: &tauri::AppHandle,
    candidate: &DrawingFailureCandidate,
) -> Result<(), String> {
    if candidate.contains_raw_user_data || candidate.redistributable {
        return Err("DRAWING_FAILURE_PRIVACY_GATE_INVALID".to_owned());
    }
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("DRAWING_FAILURE_INBOX_PATH: {error}"))?
        .join("failure-corpus")
        .join("drawing-inbox");
    fs::create_dir_all(&directory)
        .map_err(|error| format!("DRAWING_FAILURE_INBOX_CREATE: {error}"))?;
    let destination = directory.join(format!("{}.json", candidate.input_hash));
    if destination.is_file() {
        return Ok(());
    }
    let staging = directory.join(format!("{}.json.staging", candidate.input_hash));
    let bytes = serde_json::to_vec_pretty(candidate)
        .map_err(|error| format!("DRAWING_FAILURE_INBOX_SERIALIZE: {error}"))?;
    fs::write(&staging, bytes).map_err(|error| format!("DRAWING_FAILURE_INBOX_WRITE: {error}"))?;
    fs::rename(&staging, &destination)
        .map_err(|error| format!("DRAWING_FAILURE_INBOX_COMMIT: {error}"))?;
    Ok(())
}

#[tauri::command]
pub async fn get_drawing_readiness() -> Result<DrawingReadiness, String> {
    Ok(drawing_readiness(&drawing_policy(), &BTreeMap::new()))
}

#[tauri::command]
pub async fn compile_drawing_svg(
    app: tauri::AppHandle,
    request: CompileDrawingRequest,
) -> Result<CompileDrawingResponse, String> {
    let policy = drawing_policy();
    let response = compile_drawing_with_policy(request, &policy)?;
    if let Some(candidate) = response.failure_candidate.as_ref() {
        if let Err(inbox_error) = persist_failure_candidate(&app, candidate) {
            log::warn!("Could not persist Drawing failure candidate: {inbox_error}");
        }
    }
    Ok(response)
}

fn compile_drawing_with_policy(
    request: CompileDrawingRequest,
    policy: &DrawingSecurityPolicy,
) -> Result<CompileDrawingResponse, String> {
    let locks = package_locks(
        &request.package_profiles,
        request.package_lock_sha256.as_ref(),
    );
    let readiness = drawing_readiness(policy, &locks);
    let mut document =
        DrawingDocument::source_only(request.drawing_id, request.language, request.source);
    document.package_profiles = request.package_profiles;
    let renderer_id = request
        .renderer_id
        .unwrap_or_else(|| compiler_fingerprint(request.language, policy));
    let mut failures = FailureCollector::default();
    let result = DrawingCompileService.compile_svg_with_failure_sink(
        &document,
        renderer_id.clone(),
        request.package_lock_sha256.clone(),
        policy,
        &mut failures,
    );
    let artifact = match result {
        Ok(artifact) => artifact,
        Err(error) => {
            return Ok(CompileDrawingResponse {
                success: false,
                payload: None,
                svg: None,
                readiness,
                error: Some(error.to_string()),
                failure_candidate: failures.0,
            });
        }
    };
    let (width, height) = view_box_size(&artifact.sanitizer_report.view_box)?;
    let svg = String::from_utf8(artifact.bytes.clone())
        .map_err(|error| format!("DRAWING_OUTPUT_UTF8_INVALID: {error}"))?;
    let payload = DrawingOfficePayload::new(
        document,
        artifact.artifact,
        Vec::new(),
        width,
        height,
        renderer_id,
        request.package_lock_sha256,
    )
    .map_err(|error| format!("DRAWING_PAYLOAD_SERIALIZATION_FAILED: {error}"))?;
    Ok(CompileDrawingResponse {
        success: true,
        payload: Some(payload),
        svg: Some(svg),
        readiness,
        error: None,
        failure_candidate: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_policy_only_claims_in_process_svg_ready() {
        let readiness = drawing_readiness(&DrawingSecurityPolicy::default(), &BTreeMap::new());
        let svg = readiness
            .adapters
            .iter()
            .find(|adapter| adapter.language == DrawingSourceLanguage::SvgSource)
            .unwrap();
        assert!(!svg.blocked);
        assert!(!svg.requires_setup);
        let tikz = readiness
            .adapters
            .iter()
            .find(|adapter| adapter.language == DrawingSourceLanguage::Tikz)
            .unwrap();
        assert!(tikz.requires_setup);
    }

    #[test]
    fn view_box_size_rejects_non_positive_dimensions() {
        assert_eq!(view_box_size("0 0 160 90").unwrap(), (160.0, 90.0));
        assert!(view_box_size("0 0 -1 90").is_err());
    }

    #[test]
    fn svg_compile_builds_the_core_owned_office_payload() {
        let response = compile_drawing_with_policy(
            CompileDrawingRequest {
                drawing_id: "office-svg".to_owned(),
                language: DrawingSourceLanguage::SvgSource,
                source: r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90"><rect width="160" height="90"/></svg>"#.to_owned(),
                package_profiles: Vec::new(),
                package_lock_sha256: None,
                renderer_id: None,
            },
            &DrawingSecurityPolicy::default(),
        )
        .unwrap();
        assert!(response.success, "{:?}", response.error);
        let payload = response.payload.unwrap();
        assert_eq!(payload.drawing_id, "office-svg");
        assert_eq!(payload.width_points, 160.0);
        assert_eq!(payload.height_points, 90.0);
        assert_eq!(payload.preferred_artifact.sha256, payload.render_sha256);
        assert!(response.svg.unwrap().contains("viewBox=\"0 0 160 90\""));
    }

    #[test]
    fn unsafe_svg_returns_a_hash_only_failure_candidate() {
        let response = compile_drawing_with_policy(
            CompileDrawingRequest {
                drawing_id: "unsafe-svg".to_owned(),
                language: DrawingSourceLanguage::SvgSource,
                source: r#"<svg viewBox="0 0 1 1"><script>alert(1)</script></svg>"#.to_owned(),
                package_profiles: Vec::new(),
                package_lock_sha256: None,
                renderer_id: None,
            },
            &DrawingSecurityPolicy::default(),
        )
        .unwrap();
        assert!(!response.success);
        let candidate = response.failure_candidate.unwrap();
        assert!(!candidate.contains_raw_user_data);
        assert!(!candidate.redistributable);
        assert_eq!(candidate.input_hash.len(), 64);
    }
}
