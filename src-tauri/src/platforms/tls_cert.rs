use std::fs;
use std::path::PathBuf;
use std::sync::OnceLock;

use rustls::pki_types::CertificateDer;
use rustls::ServerConfig;
use tauri::Manager;

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

    println!("[TLS] Using cert: {} ({} certs)", cert_path.display(), cert_count);
    Ok(config)
}

/// Try to trust the self-signed certificate by finding it in standard app data paths.
/// On Windows, this runs certutil (UAC prompt will appear).
pub fn try_trust_cert_from_appdata() -> Result<bool, String> {
    // Try standard app data paths
    let candidates = [
        dirs_next::data_dir().map(|d| d.join("com.latexsnipper.office").join("localhost-certs").join("localhost.crt")),
        dirs_next::data_dir().map(|d| d.join("latexsnipper-office").join("localhost-certs").join("localhost.crt")),
        Some(std::env::temp_dir().join("LaTeXSnipper").join("localhost-certs").join("localhost.crt")),
    ];
    for candidate in candidates.into_iter().flatten() {
        if candidate.exists() {
            return try_trust_cert(&candidate);
        }
    }
    Err("No certificate found to trust. Start the app first to generate one.".to_string())
}

/// Try to trust the certificate by path.
pub fn try_trust_cert(cert_path: &std::path::Path) -> Result<bool, String> {
    if !cert_path.exists() {
        return Err("Certificate does not exist, generate first".to_string());
    }

    // Check if already trusted
    if is_cert_trusted()? {
        println!("[TLS] Certificate already trusted");
        return Ok(true);
    }

    #[cfg(target_os = "windows")]
    {
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
        fs::write(&script_path, ps_script)
            .map_err(|e| format!("Failed to write trust script: {e}"))?;

        trust_cert_with_script(&script_path)
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = cert_path;
        println!("[TLS] Cert trust not implemented for non-Windows");
        Err("Not supported on this platform".to_string())
    }
}

#[cfg(target_os = "windows")]
fn trust_cert_with_script(script_path: &std::path::Path) -> Result<bool, String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    // First try non-elevated
    let output = std::process::Command::new("powershell")
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", &script_path.to_string_lossy()])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("Failed to run cert trust: {e}"))?;

    if output.status.success() {
        let _ = fs::remove_file(script_path);
        println!("[TLS] Certificate trusted successfully");
        return Ok(true);
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    // If non-elevated failed (likely access denied), try elevated with UAC prompt
    if stderr.contains("Access denied") || stdout.contains("exit code") || !output.status.success() {
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
fn is_cert_trusted() -> Result<bool, String> {
    // On Windows, we try to find our cert in the store
    #[cfg(target_os = "windows")]
    {
        let output = std::process::Command::new("certutil")
            .args(["-store", "-user", "Root", "localhost"])
            .output()
            .map_err(|e| format!("Failed to query cert store: {e}"))?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        Ok(stdout.contains("localhost") && output.status.success())
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(false)
    }
}

pub fn get_cert_path(app_handle: &tauri::AppHandle) -> PathBuf {
    get_cert_dir(app_handle).join("localhost.crt")
}

fn get_cert_dir(app_handle: &tauri::AppHandle) -> PathBuf {
    if let Ok(dir) = app_handle.path().app_data_dir() {
        dir.join("localhost-certs")
    } else {
        std::env::temp_dir().join("LaTeXSnipper").join("localhost-certs")
    }
}

fn generate_self_signed_cert(cert_path: &PathBuf, key_path: &PathBuf) -> Result<(), String> {
    let cert = rcgen::generate_simple_self_signed(vec!["localhost".into()])
        .map_err(|e| format!("Failed to generate cert: {e}"))?;

    let cert_pem = cert.cert.pem();
    let key_pem = cert.key_pair.serialize_pem();

    fs::write(cert_path, cert_pem.as_bytes())
        .map_err(|e| format!("Failed to write cert: {e}"))?;
    fs::write(key_path, key_pem.as_bytes())
        .map_err(|e| format!("Failed to write key: {e}"))?;

    println!("[TLS] Generated self-signed cert at: {}", cert_path.display());
    Ok(())
}
