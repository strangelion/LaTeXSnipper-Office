//! Shared secret for Named Pipe handshake verification.
//!
//! On first launch the Desktop generates a random 32-byte secret,
//! stores it in app data. Both Desktop and VSTO must present this secret during HELLO.
//!
//! TODO: Add DPAPI encryption for the secret file.
//! For now, the secret is stored in plain JSON. In production,
//! use Windows DPAPI (CryptProtectData/CryptUnprotectData) to encrypt the file.

use std::path::PathBuf;

use base64::Engine;
use rand::RngCore;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
struct StoredSecret {
    /// Base64-encoded 32-byte random key.
    #[serde(rename = "secretB64")]
    secret_b64: String,
}

/// Resolve the path where the secret is stored.
fn secret_path() -> PathBuf {
    let data_dir = dirs_next::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("LaTeXSnipper");
    std::fs::create_dir_all(&data_dir).ok();
    data_dir.join("native-office-secret.json")
}

/// Get or create the shared secret. Returns base64-encoded bytes.
pub fn get_or_create_secret() -> Result<String, String> {
    let path = secret_path();

    // Try to load existing
    if let Ok(data) = std::fs::read_to_string(&path) {
        if let Ok(stored) = serde_json::from_str::<StoredSecret>(&data) {
            // Verify it decodes
            if base64::engine::general_purpose::STANDARD
                .decode(&stored.secret_b64)
                .is_ok()
            {
                return Ok(stored.secret_b64);
            }
        }
    }

    // Generate new secret using CSPRNG
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    let secret_b64 = base64::engine::general_purpose::STANDARD.encode(bytes);

    let stored = StoredSecret {
        secret_b64: secret_b64.clone(),
    };
    let json = serde_json::to_string_pretty(&stored).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| format!("failed to write secret: {}", e))?;

    Ok(secret_b64)
}

/// Verify that a client-provided secret matches ours.
pub fn verify_secret(client_secret_b64: &str) -> bool {
    match get_or_create_secret() {
        Ok(our_secret) => our_secret == client_secret_b64,
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_secret_roundtrip() {
        // Clean up any existing test secret
        let _ = std::fs::remove_file(secret_path());

        let secret1 = get_or_create_secret().unwrap();
        let secret2 = get_or_create_secret().unwrap();
        assert_eq!(secret1, secret2);
        assert!(verify_secret(&secret1));
        assert!(!verify_secret("wrong-secret"));

        // Cleanup
        let _ = std::fs::remove_file(secret_path());
    }
}
