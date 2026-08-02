use std::{env, fs, path::PathBuf};

use latexsnipper_conversion::{DocumentConverter, OutputFormat};
use serde_json::Value;

fn main() -> Result<(), String> {
    let mut arguments = env::args_os().skip(1);
    let source = arguments.next().map(PathBuf::from).ok_or_else(|| {
        "usage: generate_word_host_fixture <source.json> <output.json>".to_string()
    })?;
    let output = arguments.next().map(PathBuf::from).ok_or_else(|| {
        "usage: generate_word_host_fixture <source.json> <output.json>".to_string()
    })?;
    if arguments.next().is_some() {
        return Err("usage: generate_word_host_fixture <source.json> <output.json>".to_string());
    }

    let bytes =
        fs::read(&source).map_err(|error| format!("WORD_HOST_FIXTURE_READ_FAILED: {error}"))?;
    let mut contract: Value = serde_json::from_slice(&bytes)
        .map_err(|error| format!("WORD_HOST_FIXTURE_JSON_INVALID: {error}"))?;
    let cases = contract
        .get_mut("cases")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| "WORD_HOST_FIXTURE_CASES_MISSING".to_string())?;

    for (index, case) in cases.iter_mut().enumerate() {
        let latex = case
            .get("latex")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| format!("WORD_HOST_FIXTURE_LATEX_MISSING: cases[{index}]"))?;
        let omml = DocumentConverter::convert_latex_string(latex, OutputFormat::OMML)
            .map_err(|error| format!("WORD_HOST_FIXTURE_OMML_FAILED: cases[{index}]: {error}"))?;
        if !omml.contains("<m:oMath") {
            return Err(format!(
                "WORD_HOST_FIXTURE_OMML_INVALID: cases[{index}] produced no m:oMath"
            ));
        }
        case.as_object_mut()
            .ok_or_else(|| format!("WORD_HOST_FIXTURE_CASE_INVALID: cases[{index}]"))?
            .insert("omml".to_string(), Value::String(omml));
    }
    let case_count = cases.len();

    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("WORD_HOST_FIXTURE_OUTPUT_CREATE_FAILED: {error}"))?;
    }
    let encoded = serde_json::to_vec_pretty(&contract)
        .map_err(|error| format!("WORD_HOST_FIXTURE_ENCODE_FAILED: {error}"))?;
    fs::write(&output, encoded)
        .map_err(|error| format!("WORD_HOST_FIXTURE_WRITE_FAILED: {error}"))?;
    println!(
        "generated {} Core OMML Word host cases at {}",
        case_count,
        output.display()
    );
    Ok(())
}
