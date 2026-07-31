//! Deployment of the versioned provider smoke fixture embedded from Core.

use sha2::{Digest, Sha256};
use std::{fs, path::Path};

const MODEL_BYTES: &[u8] =
    include_bytes!("../../latexsnipper-core/crates/wasm/tests/fixtures/tiny-text-rec.onnx");
const MODEL_SHA256: &str = "ec6ecac6a32e663f67bd3967a6579171783c7185042cc61bb7ca84a92fdc5daa";

pub fn deploy_embedded(fixture_path: &Path) -> Result<(), String> {
    if sha256(MODEL_BYTES) != MODEL_SHA256 {
        return Err("PROVIDER_SMOKE_EMBEDDED_MODEL_HASH_MISMATCH".to_owned());
    }
    let directory = fixture_path
        .parent()
        .ok_or_else(|| "PROVIDER_SMOKE_TARGET_INVALID".to_owned())?;
    fs::create_dir_all(directory)
        .map_err(|error| format!("PROVIDER_SMOKE_TARGET_CREATE_FAILED: {error}"))?;

    write_if_changed(&directory.join("tiny-text-rec.onnx"), MODEL_BYTES)?;
    let fixture = format!(
        r#"{{
  "schemaVersion": 1,
  "model": {{
    "path": "tiny-text-rec.onnx",
    "sha256": "{MODEL_SHA256}"
  }},
  "inputs": [
    {{
      "name": "x",
      "dtype": "f32",
      "shape": [1, 3, 48, 320],
      "generator": {{
        "kind": "moduloRamp",
        "modulus": 17,
        "divisor": 17.0
      }}
    }}
  ],
  "inputSha256": "f4e0ec8e493d64ecab6aaa12e8407e758d871fb5f34cc372690f3a7bac3ac120",
  "expectedOutputs": [
    {{
      "name": "output",
      "dtype": "f32",
      "shape": [1, 3, 4]
    }}
  ],
  "expectedOutputSha256": "1c14430eb3db02ad9f9bf1c3a8d8f9018c69a18623cbefc014e831472d54a193",
  "tolerance": 0.000001
}}
"#
    );
    write_if_changed(fixture_path, fixture.as_bytes())
}

fn write_if_changed(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if fs::read(path).ok().as_deref() == Some(bytes) {
        return Ok(());
    }
    let temporary = path.with_extension(format!("tmp-{:032x}", rand::random::<u128>()));
    fs::write(&temporary, bytes)
        .map_err(|error| format!("PROVIDER_SMOKE_STAGE_FAILED: {error}"))?;
    if path.exists() {
        fs::remove_file(path).map_err(|error| format!("PROVIDER_SMOKE_REPLACE_FAILED: {error}"))?;
    }
    fs::rename(&temporary, path).map_err(|error| format!("PROVIDER_SMOKE_COMMIT_FAILED: {error}"))
}

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_fixture_is_hash_bound_and_idempotent() {
        let root = std::env::temp_dir().join(format!(
            "latexsnipper-provider-smoke-{:032x}",
            rand::random::<u128>()
        ));
        let fixture = root.join("provider-smoke-v1.json");
        deploy_embedded(&fixture).unwrap();
        let first = fs::read(&fixture).unwrap();
        deploy_embedded(&fixture).unwrap();
        assert_eq!(fs::read(&fixture).unwrap(), first);
        assert_eq!(
            sha256(&fs::read(root.join("tiny-text-rec.onnx")).unwrap()),
            MODEL_SHA256
        );
        let _ = fs::remove_dir_all(root);
    }
}
