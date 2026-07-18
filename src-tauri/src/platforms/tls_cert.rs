use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use rustls::pki_types::CertificateDer;
use rustls::ServerConfig;
use tauri::Manager;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TlsCertificateStatus {
    pub present: bool,
    pub trusted: bool,
    pub path: Option<String>,
    pub error: Option<String>,
}

fn default_cert_dir() -> PathBuf {
    dirs_next::data_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("com.latexsnipper.office")
        .join("localhost-certs")
}

fn default_cert_path() -> PathBuf {
    default_cert_dir().join("localhost.crt")
}

fn default_key_path() -> PathBuf {
    default_cert_dir().join("localhost.key")
}

/// Install the rustls crypto provider (ring) exactly once.
fn ensure_crypto_provider() {
    static INIT: OnceLock<()> = OnceLock::new();
    INIT.get_or_init(|| {
        rustls::crypto::ring::default_provider()
            .install_default()
            .expect("Failed to install rustls ring crypto provider");
    });
}

/// Get or create a self-signed TLS certificate for localhost.
/// The certificate is cached in the app data directory so it persists across restarts.
pub fn get_or_create_tls_config(app_handle: &tauri::AppHandle) -> Result<ServerConfig, String> {
    ensure_crypto_provider();
    let cert_dir = get_cert_dir(app_handle);
    fs::create_dir_all(&cert_dir).map_err(|e| format!("Failed to create cert dir: {e}"))?;

    let cert_path = cert_dir.join("localhost.crt");
    let key_path = cert_dir.join("localhost.key");

    // Generate cert + key if missing
    if !cert_path.exists() || !key_path.exists() {
        generate_self_signed_cert(&cert_path, &key_path)?;
    }

    // Load PEM files into rustls config
    let cert_pem = fs::read(&cert_path).map_err(|e| format!("Failed to read cert: {e}"))?;
    let key_pem = fs::read(&key_path).map_err(|e| format!("Failed to read key: {e}"))?;

    let certs: Vec<CertificateDer> = rustls_pemfile::certs(&mut cert_pem.as_slice())
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to parse cert: {e}"))?;

    let cert_count = certs.len();
    let key = rustls_pemfile::private_key(&mut key_pem.as_slice())
        .map_err(|e| format!("Failed to parse key: {e}"))?
        .ok_or_else(|| "No private key found".to_string())?;

    let config = ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(certs, key)
        .map_err(|e| format!("Failed to build TLS config: {e}"))?;

    println!(
        "[TLS] Using cert: {} ({} certs)",
        cert_path.display(),
        cert_count
    );
    Ok(config)
}

/// Ensure the canonical application certificate exists before Office.js setup starts.
pub fn ensure_default_tls_certificate() -> Result<PathBuf, String> {
    let cert_dir = default_cert_dir();
    fs::create_dir_all(&cert_dir)
        .map_err(|error| format!("Failed to create TLS certificate directory: {error}"))?;

    let cert_path = default_cert_path();
    let key_path = default_key_path();
    if !cert_path.is_file() || !key_path.is_file() {
        generate_self_signed_cert(&cert_path, &key_path)?;
    }

    if !cert_path.is_file() {
        return Err("TLS certificate was not created.".to_string());
    }
    if !key_path.is_file() {
        return Err("TLS private key was not created.".to_string());
    }

    Ok(cert_path)
}

/// Try to trust the self-signed certificate by finding it in standard app data paths.
/// On Windows, this runs certutil (UAC prompt will appear).
pub fn try_trust_cert_from_appdata() -> Result<bool, String> {
    let primary = ensure_default_tls_certificate()?;
    match try_trust_cert(&primary) {
        Ok(true) => return Ok(true),
        Ok(false) => {}
        Err(primary_error) => {
            log::warn!("[TLS] Primary certificate trust failed: {}", primary_error);
        }
    }

    let legacy_candidates = [
        dirs_next::data_dir().map(|d| {
            d.join("latexsnipper-office")
                .join("localhost-certs")
                .join("localhost.crt")
        }),
        Some(
            std::env::temp_dir()
                .join("LaTeXSnipper")
                .join("localhost-certs")
                .join("localhost.crt"),
        ),
    ];
    for candidate in legacy_candidates.into_iter().flatten() {
        if candidate.is_file() && try_trust_cert(&candidate)? {
            return Ok(true);
        }
    }

    Err("Unable to establish trust for the LaTeXSnipper local HTTPS certificate.".to_string())
}

/// Try to trust the certificate by path.
pub fn try_trust_cert(cert_path: &std::path::Path) -> Result<bool, String> {
    if !cert_path.is_file() {
        return Err("Certificate does not exist.".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        trust_cert_windows(cert_path)
    }

    #[cfg(target_os = "macos")]
    {
        trust_cert_macos(cert_path)
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = cert_path;
        Err("Office.js TLS certificate trust is unsupported on this platform.".to_string())
    }
}

#[cfg(target_os = "windows")]
fn trust_cert_windows(cert_path: &Path) -> Result<bool, String> {
    if is_windows_cert_trusted()? {
        println!("[TLS] Certificate already trusted");
        return Ok(true);
    }

    let ps_script = format!(
        r#"$certPath = '{path}'
certutil -addstore -user Root $certPath | Out-Null
if ($LASTEXITCODE -eq 0) {{
    Write-Host "Certificate trusted successfully"
}} else {{
    try {{
        $startInfo = New-Object System.Diagnostics.ProcessStartInfo
        $startInfo.FileName = "certutil"
        $startInfo.Arguments = "-addstore -user Root `"$certPath`""
        $startInfo.Verb = "runas"
        $startInfo.UseShellExecute = $true
        $startInfo.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
        $proc = [System.Diagnostics.Process]::Start($startInfo)
        $proc.WaitForExit()
        if ($proc.ExitCode -eq 0) {{
            Write-Host "Certificate trusted (elevated)"
        }} else {{
            Write-Host "Failed to trust cert: exit code $($proc.ExitCode)"
            exit 1
        }}
    }} catch {{
        Write-Host "Elevation failed or cancelled: $_"
        exit 1
    }}
}}
"#,
        path = cert_path.to_string_lossy()
    );

    let script_path = std::env::temp_dir().join("latexsnipper_trust_cert.ps1");
    fs::write(&script_path, ps_script).map_err(|e| format!("Failed to write trust script: {e}"))?;

    trust_cert_with_script(&script_path)
}

#[cfg(target_os = "macos")]
fn macos_login_keychain() -> Result<PathBuf, String> {
    let home = dirs_next::home_dir()
        .ok_or_else(|| "Cannot determine macOS home directory.".to_string())?;
    let modern = home
        .join("Library")
        .join("Keychains")
        .join("login.keychain-db");
    if modern.is_file() {
        return Ok(modern);
    }

    let legacy = home
        .join("Library")
        .join("Keychains")
        .join("login.keychain");
    if legacy.is_file() {
        return Ok(legacy);
    }

    Err("Cannot locate the user's login keychain.".to_string())
}

#[cfg(target_os = "macos")]
fn is_macos_cert_trusted(cert_path: &Path) -> Result<bool, String> {
    if !cert_path.is_file() {
        return Ok(false);
    }

    let mut command = std::process::Command::new("/usr/bin/security");
    command
        .arg("verify-cert")
        .arg("-c")
        .arg(cert_path)
        .arg("-p")
        .arg("ssl")
        .arg("-s")
        .arg("127.0.0.1");
    let output = crate::platforms::process::run_with_timeout(
        &mut command,
        std::time::Duration::from_secs(15),
    )
    .map_err(|error| format!("Failed to verify macOS TLS certificate trust: {error}"))?;
    Ok(output.status.success())
}

#[cfg(target_os = "macos")]
fn macos_trust_command_args(cert: &Path, keychain: &Path) -> Vec<String> {
    vec![
        "add-trusted-cert".into(),
        "-r".into(),
        "trustRoot".into(),
        "-p".into(),
        "ssl".into(),
        "-k".into(),
        keychain.to_string_lossy().into_owned(),
        cert.to_string_lossy().into_owned(),
    ]
}

#[cfg(target_os = "macos")]
fn trust_cert_macos(cert_path: &Path) -> Result<bool, String> {
    if !cert_path.is_file() {
        return Err(format!(
            "TLS certificate does not exist: {}",
            cert_path.display()
        ));
    }
    if is_macos_cert_trusted(cert_path)? {
        return Ok(true);
    }

    let keychain = macos_login_keychain()?;
    let mut command = std::process::Command::new("/usr/bin/security");
    command.args(macos_trust_command_args(cert_path, &keychain));
    let output = crate::platforms::process::run_with_timeout(
        &mut command,
        std::time::Duration::from_secs(30),
    )
    .map_err(|error| format!("Failed to execute macOS certificate trust command: {error}"))?;

    if !output.status.success() {
        return Err(format!(
            "macOS certificate trust failed: {}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr),
        ));
    }
    if !is_macos_cert_trusted(cert_path)? {
        return Err("Certificate was imported into the macOS keychain but TLS trust verification still failed.".to_string());
    }
    Ok(true)
}

#[cfg(target_os = "windows")]
fn trust_cert_with_script(script_path: &std::path::Path) -> Result<bool, String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    // First try non-elevated
    let mut cmd = std::process::Command::new("powershell");
    cmd.args([
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        &script_path.to_string_lossy(),
    ])
    .creation_flags(CREATE_NO_WINDOW);
    let output =
        crate::platforms::process::run_with_timeout(&mut cmd, std::time::Duration::from_secs(30))
            .map_err(|e| format!("Failed to run cert trust: {e}"))?;

    if output.status.success() {
        let _ = fs::remove_file(script_path);
        println!("[TLS] Certificate trusted successfully");
        return Ok(true);
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    // If non-elevated failed (likely access denied), try elevated with UAC prompt
    if stderr.contains("Access denied") || stdout.contains("exit code") || !output.status.success()
    {
        println!("[TLS] Non-elevated trust failed, trying UAC elevation...");
        let elevated = std::process::Command::new("powershell")
            .args([
                "-NoProfile",
                "-ExecutionPolicy", "Bypass",
                "-WindowStyle", "Hidden",
                "-Command",
                &format!(
                    "Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File \"{}\"' -WindowStyle Hidden",
                    script_path.to_string_lossy()
                ),
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn();

        let _ = fs::remove_file(script_path);
        match elevated {
            Ok(_) => {
                println!("[TLS] UAC elevation requested. Please accept the UAC prompt.");
                Ok(true)
            }
            Err(e) => Err(format!("Failed to start elevated trust: {e}")),
        }
    } else {
        let _ = fs::remove_file(script_path);
        Err(format!("Cert trust failed: {}{}", stdout, stderr))
    }
}

/// Check if we can verify the cert (basic check — not a full trust verification).
#[cfg(target_os = "windows")]
fn is_windows_cert_trusted() -> Result<bool, String> {
    let mut cmd = std::process::Command::new("certutil");
    cmd.args(["-store", "-user", "Root", "localhost"]);
    let output =
        crate::platforms::process::run_with_timeout(&mut cmd, std::time::Duration::from_secs(15))
            .map_err(|e| format!("Failed to query cert store: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout.contains("localhost") && output.status.success())
}

pub fn get_tls_certificate_status() -> TlsCertificateStatus {
    let path = default_cert_path();
    if !path.is_file() {
        return TlsCertificateStatus {
            present: false,
            trusted: false,
            path: Some(path.to_string_lossy().to_string()),
            error: Some("TLS certificate does not exist.".to_string()),
        };
    }

    #[cfg(target_os = "macos")]
    let trusted_result = is_macos_cert_trusted(&path);
    #[cfg(target_os = "windows")]
    let trusted_result = is_windows_cert_trusted();
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let trusted_result: Result<bool, String> = Ok(false);

    match trusted_result {
        Ok(trusted) => TlsCertificateStatus {
            present: true,
            trusted,
            path: Some(path.to_string_lossy().to_string()),
            error: None,
        },
        Err(error) => TlsCertificateStatus {
            present: true,
            trusted: false,
            path: Some(path.to_string_lossy().to_string()),
            error: Some(error),
        },
    }
}

#[allow(dead_code, reason = "Public certificate diagnostic helper")]
pub fn get_cert_path(app_handle: &tauri::AppHandle) -> PathBuf {
    get_cert_dir(app_handle).join("localhost.crt")
}

fn get_cert_dir(app_handle: &tauri::AppHandle) -> PathBuf {
    app_handle
        .path()
        .app_data_dir()
        .map(|dir| dir.join("localhost-certs"))
        .unwrap_or_else(|_| default_cert_dir())
}

fn generate_self_signed_cert(cert_path: &Path, key_path: &Path) -> Result<(), String> {
    let cert = rcgen::generate_simple_self_signed(vec!["localhost".into(), "127.0.0.1".into()])
        .map_err(|e| format!("Failed to generate cert: {e}"))?;

    let cert_pem = cert.cert.pem();
    let key_pem = cert.key_pair.serialize_pem();

    fs::write(cert_path, cert_pem.as_bytes()).map_err(|e| format!("Failed to write cert: {e}"))?;
    fs::write(key_path, key_pem.as_bytes()).map_err(|e| format!("Failed to write key: {e}"))?;

    println!(
        "[TLS] Generated self-signed cert at: {}",
        cert_path.display()
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_certificate_path_uses_app_identifier() {
        let path = default_cert_path().to_string_lossy().to_string();
        assert!(path.contains("com.latexsnipper.office"));
        assert!(
            path.ends_with("localhost-certs/localhost.crt")
                || path.ends_with(r"localhost-certs\localhost.crt")
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_trust_command_targets_login_keychain() {
        let args = macos_trust_command_args(
            Path::new("/tmp/localhost.crt"),
            Path::new("/Users/test/Library/Keychains/login.keychain-db"),
        );
        assert_eq!(args[0], "add-trusted-cert");
        assert!(args.contains(&"trustRoot".to_string()));
        assert!(args.contains(&"ssl".to_string()));
    }
}
