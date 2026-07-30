use latexsnipper_conversion::omml::latex_to_omml;
use serde_json::Value;

const CONTRACT: &str = include_str!(
    "../../../apps/native-office/LaTeXSnipper.Word.HostTests/fixtures/word-nary-acceptance-v1.json"
);
const MATH_NAMESPACE: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/math";

fn main() {
    let mut contract: Value =
        serde_json::from_str(CONTRACT).expect("Word n-ary acceptance contract must be valid");
    let cases = contract["cases"]
        .as_array_mut()
        .expect("acceptance contract must contain cases");
    for case in cases {
        let latex = case["latex"]
            .as_str()
            .expect("each acceptance case must contain LaTeX");
        let body = latex_to_omml(latex);
        case["omml"] = Value::String(format!(
            "<m:oMath xmlns:m=\"{MATH_NAMESPACE}\">{body}</m:oMath>"
        ));
    }
    let output =
        serde_json::to_string_pretty(&contract).expect("generated fixtures must serialize");
    if let Some(path) = std::env::args_os().nth(1) {
        let path = std::path::PathBuf::from(path);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("fixture output directory must be creatable");
        }
        std::fs::write(path, output).expect("generated fixture file must be writable");
    } else {
        println!("{output}");
    }
}
