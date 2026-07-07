//! DPAPI-based shared secret for Named Pipe handshake verification.
//!
//! On first launch the Desktop generates a random 32-byte secret,
//! encrypts it with Windows DPAPI, and stores it in app data.
//! Both Desktop and VSTO must present this secret during HELLO.
//!
//! Security model:
//! - Secret is generated using cryptographically secure random (OsRng)
//! - Secret is encrypted with DPAPI before writing to disk
//! - Only the same Windows user can decrypt the secret
//! - VSTO reads and decrypts the secret during startup

use std::path::PathBuf;

use base64::Engine;
use rand::RngCore;
use serde::{Deserialize, Serialize};

#[cfg(target_os = "windows")]
use windows::Win32::{
    Foundation::{LocalFree, HLOCAL},
    Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    },
};

#[derive(Debug, Serialize, Deserialize)]
struct StoredSecret {
    /// Base64-encoded 32-byte random key.
    #[serde(rename = "secretB64")]
    secret_b64: String,
}

/// Resolve the path where the DPAPI-encrypted secret is stored.
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
    if let Ok(data) = std::fs::read(&path) {
        // Try to decrypt with DPAPI first
        if let Ok(decrypted) = dpapi_decrypt(&data) {
            if let Ok(stored) = serde_json::from_slice::<StoredSecret>(&decrypted) {
                if base64::engine::general_purpose::STANDARD
                    .decode(&stored.secret_b64)
                    .is_ok()
                {
                    return Ok(stored.secret_b64);
                }
            }
        }

        // Fallback: try reading as plain JSON (for migration from old format)
        if let Ok(text) = std::str::from_utf8(&data) {
            if let Ok(stored) = serde_json::from_str::<StoredSecret>(text) {
                if base64::engine::general_purpose::STANDARD
                    .decode(&stored.secret_b64)
                    .is_ok()
                {
                    // Re-encrypt with DPAPI
                    let json = serde_json::to_vec(&stored).map_err(|e| e.to_string())?;
                    if let Ok(encrypted) = dpapi_encrypt(&json) {
                        let _ = std::fs::write(&path, encrypted);
                    }
                    return Ok(stored.secret_b64);
                }
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
    let json = serde_json::to_vec(&stored).map_err(|e| e.to_string())?;

    // Encrypt with DPAPI before writing
    let encrypted = dpapi_encrypt(&json).map_err(|e| e.to_string())?;
    std::fs::write(&path, encrypted).map_err(|e| format!("failed to write secret: {}", e))?;

    Ok(secret_b64)
}

/// Verify that a client-provided secret matches ours.
pub fn verify_secret(client_secret_b64: &str) -> bool {
    match get_or_create_secret() {
        Ok(our_secret) => our_secret == client_secret_b64,
        Err(_) => false,
    }
}

/// Encrypt data using Windows DPAPI (CryptProtectData).
#[cfg(target_os = "windows")]
fn dpapi_encrypt(data: &[u8]) -> Result<Vec<u8>, String> {
    use std::{ptr, slice};

    let mut input = data.to_vec();

    let mut input_blob = CRYPT_INTEGER_BLOB {
        cbData: input.len() as u32,
        pbData: input.as_mut_ptr(),
    };

    let mut output_blob = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: ptr::null_mut(),
    };

    unsafe {
        CryptProtectData(
            &input_blob,
            None,
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output_blob,
        )
        .map_err(|e| format!("CryptProtectData failed: {e}"))?;

        let encrypted =
            slice::from_raw_parts(output_blob.pbData, output_blob.cbData as usize).to_vec();

        if !output_blob.pbData.is_null() {
            let _ = LocalFree(HLOCAL(output_blob.pbData as *mut _));
        }

        Ok(encrypted)
    }
}

/// Decrypt data using Windows DPAPI (CryptUnprotectData).
#[cfg(target_os = "windows")]
fn dpapi_decrypt(data: &[u8]) -> Result<Vec<u8>, String> {
    use std::{ptr, slice};

    let mut input = data.to_vec();

    let mut input_blob = CRYPT_INTEGER_BLOB {
        cbData: input.len() as u32,
        pbData: input.as_mut_ptr(),
    };

    let mut output_blob = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: ptr::null_mut(),
    };

    unsafe {
        CryptUnprotectData(
            &input_blob,
            None,
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output_blob,
        )
        .map_err(|e| format!("CryptUnprotectData failed: {e}"))?;

        let decrypted =
            slice::from_raw_parts(output_blob.pbData, output_blob.cbData as usize).to_vec();

        if !output_blob.pbData.is_null() {
            let _ = LocalFree(HLOCAL(output_blob.pbData as *mut _));
        }

        Ok(decrypted)
    }
}

// Non-Windows stubs
#[cfg(not(target_os = "windows"))]
fn dpapi_encrypt(data: &[u8]) -> Result<Vec<u8>, String> {
    Ok(data.to_vec())
}

#[cfg(not(target_os = "windows"))]
fn dpapi_decrypt(data: &[u8]) -> Result<Vec<u8>, String> {
    Ok(data.to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_secret_roundtrip() {
        let _ = std::fs::remove_file(secret_path());

        let secret1 = get_or_create_secret().unwrap();
        let secret2 = get_or_create_secret().unwrap();
        assert_eq!(secret1, secret2);
        assert!(verify_secret(&secret1));
        assert!(!verify_secret("wrong-secret"));

        let _ = std::fs::remove_file(secret_path());
    }
}
