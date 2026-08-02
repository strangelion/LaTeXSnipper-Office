//! Deployment of trusted, release-owned Core model quality baselines.
//!
//! The bundle is verified before any installed baseline is touched. Deployment
//! copies into a sibling staging directory, verifies the staged copy, then
//! swaps directories with rollback support.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};

const INDEX_FILE: &str = "index.json";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BaselineTrustIndex {
    schema_version: u32,
    files: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BaselineDeploymentReport {
    pub status: &'static str,
    pub source_digest: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BaselineDeploymentState {
    pub status: String,
    pub source_digest: Option<String>,
    pub target: String,
    pub error: Option<String>,
}

impl BaselineDeploymentState {
    pub fn completed(report: BaselineDeploymentReport, target: &Path) -> Self {
        Self {
            status: report.status.to_string(),
            source_digest: report.source_digest,
            target: target.display().to_string(),
            error: None,
        }
    }

    pub fn failed(error: String, target: &Path) -> Self {
        Self {
            status: "failed".to_string(),
            source_digest: None,
            target: target.display().to_string(),
            error: Some(error),
        }
    }
}

#[tauri::command]
pub fn quality_baseline_deployment_status(
    state: tauri::State<'_, BaselineDeploymentState>,
) -> BaselineDeploymentState {
    state.inner().clone()
}

pub fn deploy_bundled(
    app: &AppHandle,
    target_baselines: &Path,
) -> Result<BaselineDeploymentReport, String> {
    let resource_root = app
        .path()
        .resource_dir()
        .map_err(|error| format!("QUALITY_BASELINE_RESOURCE_DIR_FAILED: {error}"))?;
    let source = [
        resource_root
            .join("resources")
            .join("RecognitionQuality")
            .join("baselines"),
        resource_root.join("RecognitionQuality").join("baselines"),
    ]
    .into_iter()
    .find(|candidate| candidate.join(INDEX_FILE).is_file());

    let Some(source) = source else {
        return Ok(BaselineDeploymentReport {
            status: "bundleMissing",
            source_digest: None,
        });
    };
    deploy_verified_directory(&source, target_baselines)
}

pub(crate) fn deploy_verified_directory(
    source: &Path,
    target: &Path,
) -> Result<BaselineDeploymentReport, String> {
    let source_digest = verify_baseline_directory(source)?;
    if target.exists()
        && verify_baseline_directory(target)
            .ok()
            .as_deref()
            .is_some_and(|digest| digest == source_digest)
    {
        return Ok(BaselineDeploymentReport {
            status: "unchanged",
            source_digest: Some(source_digest),
        });
    }

    let parent = target
        .parent()
        .ok_or_else(|| "QUALITY_BASELINE_TARGET_INVALID".to_string())?;
    fs::create_dir_all(parent).map_err(|error| {
        format!(
            "QUALITY_BASELINE_TARGET_CREATE_FAILED: '{}': {error}",
            parent.display()
        )
    })?;
    let nonce = format!("{:032x}", rand::random::<u128>());
    let staging = parent.join(format!(".baselines.staging-{nonce}"));
    let backup = parent.join(format!(".baselines.rollback-{nonce}"));

    copy_directory(source, &staging)?;
    let staged_digest = verify_baseline_directory(&staging)?;
    if staged_digest != source_digest {
        let _ = fs::remove_dir_all(&staging);
        return Err("QUALITY_BASELINE_STAGING_DIGEST_MISMATCH".to_string());
    }

    let had_target = target.exists();
    if had_target {
        fs::rename(target, &backup).map_err(|error| {
            let _ = fs::remove_dir_all(&staging);
            format!("QUALITY_BASELINE_BACKUP_FAILED: {error}")
        })?;
    }

    if let Err(error) = fs::rename(&staging, target) {
        if had_target {
            let _ = fs::rename(&backup, target);
        }
        let _ = fs::remove_dir_all(&staging);
        return Err(format!("QUALITY_BASELINE_ATOMIC_REPLACE_FAILED: {error}"));
    }

    if let Err(error) = verify_baseline_directory(target) {
        let _ = fs::remove_dir_all(target);
        if had_target {
            let _ = fs::rename(&backup, target);
        }
        return Err(format!("QUALITY_BASELINE_POST_INSTALL_INVALID: {error}"));
    }
    if had_target {
        fs::remove_dir_all(&backup)
            .map_err(|error| format!("QUALITY_BASELINE_BACKUP_CLEANUP_FAILED: {error}"))?;
    }

    Ok(BaselineDeploymentReport {
        status: if had_target { "replaced" } else { "installed" },
        source_digest: Some(source_digest),
    })
}

fn verify_baseline_directory(root: &Path) -> Result<String, String> {
    let index_path = root.join(INDEX_FILE);
    let index_bytes = fs::read(&index_path).map_err(|error| {
        format!(
            "QUALITY_BASELINE_INDEX_MISSING: '{}': {error}",
            index_path.display()
        )
    })?;
    let index: BaselineTrustIndex = serde_json::from_slice(&index_bytes)
        .map_err(|error| format!("QUALITY_BASELINE_INDEX_INVALID: {error}"))?;
    if index.schema_version != 1 {
        return Err(format!(
            "QUALITY_BASELINE_INDEX_SCHEMA_UNSUPPORTED: {}",
            index.schema_version
        ));
    }

    let mut actual = BTreeSet::new();
    collect_json_files(root, root, &mut actual)?;
    let expected = index.files.keys().cloned().collect::<BTreeSet<_>>();
    if actual != expected {
        return Err(format!(
            "QUALITY_BASELINE_INDEX_FILE_SET_MISMATCH: expected={expected:?} actual={actual:?}"
        ));
    }

    for (relative, expected_hash) in &index.files {
        validate_sha256(expected_hash)?;
        let path = safe_join(root, relative)?;
        let bytes = fs::read(&path).map_err(|error| {
            format!(
                "QUALITY_BASELINE_FILE_READ_FAILED: '{}': {error}",
                path.display()
            )
        })?;
        let actual_hash = sha256(&bytes);
        if !actual_hash.eq_ignore_ascii_case(expected_hash) {
            return Err(format!("QUALITY_BASELINE_HASH_MISMATCH: '{relative}'"));
        }
    }

    Ok(sha256(&index_bytes))
}

fn collect_json_files(
    root: &Path,
    directory: &Path,
    files: &mut BTreeSet<String>,
) -> Result<(), String> {
    for entry in
        fs::read_dir(directory).map_err(|error| format!("QUALITY_BASELINE_SCAN_FAILED: {error}"))?
    {
        let path = entry
            .map_err(|error| format!("QUALITY_BASELINE_SCAN_FAILED: {error}"))?
            .path();
        if path.is_dir() {
            collect_json_files(root, &path, files)?;
        } else if path
            .extension()
            .is_some_and(|extension| extension == "json")
            && path.file_name().is_some_and(|name| name != INDEX_FILE)
        {
            files.insert(
                path.strip_prefix(root)
                    .map_err(|error| format!("QUALITY_BASELINE_PATH_FAILED: {error}"))?
                    .to_string_lossy()
                    .replace('\\', "/"),
            );
        }
    }
    Ok(())
}

fn safe_join(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let relative_path = Path::new(relative);
    if relative_path.is_absolute()
        || relative_path
            .components()
            .any(|component| !matches!(component, std::path::Component::Normal(_)))
    {
        return Err(format!("QUALITY_BASELINE_INDEX_PATH_UNSAFE: '{relative}'"));
    }
    Ok(root.join(relative_path))
}

fn copy_directory(source: &Path, target: &Path) -> Result<(), String> {
    fs::create_dir_all(target)
        .map_err(|error| format!("QUALITY_BASELINE_STAGING_CREATE_FAILED: {error}"))?;
    for entry in fs::read_dir(source)
        .map_err(|error| format!("QUALITY_BASELINE_SOURCE_SCAN_FAILED: {error}"))?
    {
        let entry =
            entry.map_err(|error| format!("QUALITY_BASELINE_SOURCE_SCAN_FAILED: {error}"))?;
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());
        if source_path.is_dir() {
            copy_directory(&source_path, &target_path)?;
        } else {
            fs::copy(&source_path, &target_path)
                .map_err(|error| format!("QUALITY_BASELINE_STAGING_COPY_FAILED: {error}"))?;
        }
    }
    Ok(())
}

fn validate_sha256(value: &str) -> Result<(), String> {
    if value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err("QUALITY_BASELINE_INDEX_HASH_INVALID".to_string())
    }
}

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(root: &Path, version: &str, content: &[u8]) {
        let relative = format!("formula/model/{version}.json");
        let path = root.join(&relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, content).unwrap();
        let mut files = BTreeMap::new();
        files.insert(relative, sha256(content));
        let index = serde_json::json!({
            "schemaVersion": 1,
            "files": files
        });
        fs::write(
            root.join(INDEX_FILE),
            serde_json::to_vec_pretty(&index).unwrap(),
        )
        .unwrap();
    }

    #[test]
    fn installs_upgrades_and_rolls_back_verified_directories() {
        let root = std::env::temp_dir().join(format!(
            "latexsnipper-quality-deploy-{:032x}",
            rand::random::<u128>()
        ));
        let old = root.join("old");
        let new = root.join("new");
        let target = root.join("installed").join("baselines");
        fixture(&old, "v1", br#"{"version":"old"}"#);
        fixture(&new, "v2", br#"{"version":"new"}"#);

        assert_eq!(
            deploy_verified_directory(&old, &target).unwrap().status,
            "installed"
        );
        assert_eq!(
            deploy_verified_directory(&new, &target).unwrap().status,
            "replaced"
        );
        assert!(target.join("formula/model/v2.json").is_file());
        assert_eq!(
            deploy_verified_directory(&old, &target).unwrap().status,
            "replaced"
        );
        assert!(target.join("formula/model/v1.json").is_file());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn corrupt_bundle_never_replaces_valid_target() {
        let root = std::env::temp_dir().join(format!(
            "latexsnipper-quality-corrupt-{:032x}",
            rand::random::<u128>()
        ));
        let valid = root.join("valid");
        let corrupt = root.join("corrupt");
        let target = root.join("installed").join("baselines");
        fixture(&valid, "v1", br#"{"version":"valid"}"#);
        fixture(&corrupt, "v2", br#"{"version":"corrupt"}"#);
        deploy_verified_directory(&valid, &target).unwrap();
        fs::write(corrupt.join("formula/model/v2.json"), b"tampered").unwrap();

        assert!(deploy_verified_directory(&corrupt, &target).is_err());
        assert!(target.join("formula/model/v1.json").is_file());
        assert!(!target.join("formula/model/v2.json").exists());
        let _ = fs::remove_dir_all(root);
    }
}
