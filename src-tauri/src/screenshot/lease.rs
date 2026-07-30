use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

pub const SCREENSHOT_JOB_TTL: Duration = Duration::from_secs(24 * 60 * 60);
pub const SCREENSHOT_IN_USE_STALE_TTL: Duration = Duration::from_secs(2 * 60 * 60);
pub const SCREENSHOT_JOB_MAX_BYTES: u64 = 512 * 1024 * 1024;
const LEASE_FILE: &str = "lease.json";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum JobOwner {
    Desktop,
    Office,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ScreenshotJobState {
    Created,
    InUse,
    Completed,
    Failed,
    Cancelled,
}

impl ScreenshotJobState {
    const fn is_terminal(self) -> bool {
        matches!(self, Self::Completed | Self::Failed | Self::Cancelled)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotJobLease {
    pub job_id: String,
    pub path: PathBuf,
    pub created_at_unix_ms: u64,
    pub last_transition_at_unix_ms: u64,
    pub owner: JobOwner,
    pub state: ScreenshotJobState,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CleanupReport {
    pub removed_jobs: usize,
    pub removed_bytes: u64,
    pub retained_bytes: u64,
}

pub fn jobs_root() -> PathBuf {
    std::env::temp_dir().join("latexsnipper").join("jobs")
}

pub fn register_job(
    job_id: &str,
    source_path: &Path,
    owner: JobOwner,
) -> Result<ScreenshotJobLease, String> {
    let now = unix_ms(SystemTime::now());
    let lease = ScreenshotJobLease {
        job_id: job_id.to_string(),
        path: source_path.to_path_buf(),
        created_at_unix_ms: now,
        last_transition_at_unix_ms: now,
        owner,
        state: ScreenshotJobState::Created,
    };
    write_lease(&lease)?;
    Ok(lease)
}

pub fn mark_in_use(source_path: &Path) -> Result<bool, String> {
    transition_job(source_path, ScreenshotJobState::InUse)
}

pub fn transition_job(source_path: &Path, next: ScreenshotJobState) -> Result<bool, String> {
    let Some(mut lease) = read_owned_lease(source_path)? else {
        return Ok(false);
    };
    let valid = matches!(
        (lease.state, next),
        (ScreenshotJobState::Created, ScreenshotJobState::InUse)
            | (
                ScreenshotJobState::Created | ScreenshotJobState::InUse,
                ScreenshotJobState::Completed
                    | ScreenshotJobState::Failed
                    | ScreenshotJobState::Cancelled
            )
    );
    if !valid {
        return Err(format!(
            "SCREENSHOT_JOB_INVALID_TRANSITION: {:?} -> {:?}",
            lease.state, next
        ));
    }
    lease.state = next;
    lease.last_transition_at_unix_ms = unix_ms(SystemTime::now());
    write_lease(&lease)?;
    Ok(true)
}

pub fn release_job_path(source_path: &Path) -> Result<bool, String> {
    let Some(job_dir) = owned_job_dir(source_path) else {
        return Ok(false);
    };
    if !job_dir.exists() {
        return Ok(false);
    }
    fs::remove_dir_all(&job_dir)
        .map_err(|error| format!("SCREENSHOT_JOB_CLEANUP_FAILED: {error}"))?;
    Ok(true)
}

pub fn cleanup_default_root() -> Result<CleanupReport, String> {
    cleanup_job_root(&jobs_root(), SystemTime::now())
}

pub fn cleanup_job_root(root: &Path, now: SystemTime) -> Result<CleanupReport, String> {
    if !root.exists() {
        return Ok(CleanupReport::default());
    }
    let mut entries = Vec::new();
    for entry in fs::read_dir(root)
        .map_err(|error| format!("SCREENSHOT_JOB_SCAN_FAILED: {error}"))?
        .flatten()
    {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let modified = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .unwrap_or(UNIX_EPOCH);
        let lease = read_lease_file(&path.join(LEASE_FILE)).ok();
        let created = lease
            .as_ref()
            .map(|value| UNIX_EPOCH + Duration::from_millis(value.created_at_unix_ms))
            .unwrap_or(modified);
        entries.push((path, created, lease));
    }
    entries.sort_by_key(|(_, created, _)| *created);

    let mut report = CleanupReport::default();
    let mut retained = Vec::new();
    for (path, created, lease) in entries {
        let size = directory_size(&path);
        let created_expired = now.duration_since(created).unwrap_or_default() >= SCREENSHOT_JOB_TTL;
        let transition_age = lease
            .as_ref()
            .map(|value| {
                now.duration_since(
                    UNIX_EPOCH + Duration::from_millis(value.last_transition_at_unix_ms),
                )
                .unwrap_or_default()
            })
            .unwrap_or_default();
        let terminal = lease
            .as_ref()
            .is_some_and(|value| value.state.is_terminal());
        let stale_in_use = lease.as_ref().is_some_and(|value| {
            value.state == ScreenshotJobState::InUse
                && transition_age >= SCREENSHOT_IN_USE_STALE_TTL
        });
        let active_in_use = lease
            .as_ref()
            .is_some_and(|value| value.state == ScreenshotJobState::InUse && !stale_in_use);
        let expired = terminal || stale_in_use || (created_expired && !active_in_use);
        if expired {
            fs::remove_dir_all(&path)
                .map_err(|error| format!("SCREENSHOT_JOB_CLEANUP_FAILED: {error}"))?;
            report.removed_jobs += 1;
            report.removed_bytes = report.removed_bytes.saturating_add(size);
        } else {
            retained.push((path, created, size, active_in_use));
            report.retained_bytes = report.retained_bytes.saturating_add(size);
        }
    }

    for (path, _, size, active_in_use) in retained {
        if report.retained_bytes <= SCREENSHOT_JOB_MAX_BYTES {
            break;
        }
        if active_in_use {
            continue;
        }
        fs::remove_dir_all(&path)
            .map_err(|error| format!("SCREENSHOT_JOB_CLEANUP_FAILED: {error}"))?;
        report.removed_jobs += 1;
        report.removed_bytes = report.removed_bytes.saturating_add(size);
        report.retained_bytes = report.retained_bytes.saturating_sub(size);
    }
    Ok(report)
}

pub struct ScreenshotJobLeaseGuard {
    source_path: Option<PathBuf>,
}

impl ScreenshotJobLeaseGuard {
    #[cfg(any(test, target_os = "windows"))]
    pub fn register(job_id: &str, source_path: &Path, owner: JobOwner) -> Result<Self, String> {
        if let Err(error) = register_job(job_id, source_path, owner) {
            let _ = release_job_path(source_path);
            return Err(error);
        }
        Ok(Self {
            source_path: Some(source_path.to_path_buf()),
        })
    }

    pub fn acquire(source_path: &Path) -> Self {
        let owned = mark_in_use(source_path).ok() == Some(true);
        Self {
            source_path: owned.then(|| source_path.to_path_buf()),
        }
    }

    pub fn complete(&mut self) -> Result<(), String> {
        self.finish(ScreenshotJobState::Completed)
    }

    pub fn fail(&mut self) -> Result<(), String> {
        self.finish(ScreenshotJobState::Failed)
    }

    pub fn cancel(&mut self) -> Result<(), String> {
        self.finish(ScreenshotJobState::Cancelled)
    }

    fn finish(&mut self, state: ScreenshotJobState) -> Result<(), String> {
        let Some(path) = self.source_path.take() else {
            return Ok(());
        };
        let transition_result = transition_job(&path, state);
        let release_result = release_job_path(&path);
        transition_result?;
        release_result?;
        Ok(())
    }
}

impl Drop for ScreenshotJobLeaseGuard {
    fn drop(&mut self) {
        if let Some(path) = self.source_path.take() {
            let _ = transition_job(&path, ScreenshotJobState::Failed);
            let _ = release_job_path(&path);
        }
    }
}

fn owned_job_dir(source_path: &Path) -> Option<PathBuf> {
    let root = jobs_root();
    let parent = source_path.parent()?;
    if source_path.file_name()? != "source.png" || parent.parent()? != root {
        return None;
    }
    Some(parent.to_path_buf())
}

fn read_owned_lease(source_path: &Path) -> Result<Option<ScreenshotJobLease>, String> {
    let Some(job_dir) = owned_job_dir(source_path) else {
        return Ok(None);
    };
    let lease_path = job_dir.join(LEASE_FILE);
    if !lease_path.is_file() {
        return Ok(None);
    }
    read_lease_file(&lease_path).map(Some)
}

fn write_lease(lease: &ScreenshotJobLease) -> Result<(), String> {
    let job_dir = lease
        .path
        .parent()
        .ok_or_else(|| "SCREENSHOT_JOB_LEASE_INVALID_PATH".to_string())?;
    let bytes = serde_json::to_vec_pretty(lease)
        .map_err(|error| format!("SCREENSHOT_JOB_LEASE_SERIALIZE_FAILED: {error}"))?;
    fs::write(job_dir.join(LEASE_FILE), bytes)
        .map_err(|error| format!("SCREENSHOT_JOB_LEASE_WRITE_FAILED: {error}"))
}

fn read_lease_file(path: &Path) -> Result<ScreenshotJobLease, String> {
    let bytes =
        fs::read(path).map_err(|error| format!("SCREENSHOT_JOB_LEASE_READ_FAILED: {error}"))?;
    serde_json::from_slice(&bytes).map_err(|error| format!("SCREENSHOT_JOB_LEASE_INVALID: {error}"))
}

fn directory_size(path: &Path) -> u64 {
    fs::read_dir(path)
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| {
            let path = entry.path();
            if path.is_dir() {
                directory_size(&path)
            } else {
                entry.metadata().map(|meta| meta.len()).unwrap_or(0)
            }
        })
        .sum()
}

fn unix_ms(value: SystemTime) -> u64 {
    value
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}
