use super::ast::MathNode;

/// Convert MathNode AST to LaTeX string.
pub fn node_to_latex(node: &MathNode) -> String {
    match node {
        MathNode::Row(children) => {
            children.iter().map(node_to_latex).collect()
        }
        MathNode::Text(t) => escape_latex(t),
        MathNode::Fraction { num, den } => {
            format!("\\frac{{{}}}{{{}}}", node_to_latex(num), node_to_latex(den))
        }
        MathNode::Sup { base, sup } => {
            format!("{{{}}}^{{{}}}", node_to_latex(base), node_to_latex(sup))
        }
        MathNode::Sub { base, sub } => {
            format!("{{{}}}_{{{}}}", node_to_latex(base), node_to_latex(sub))
        }
        MathNode::SubSup { base, sub, sup } => {
            format!(
                "{{{}}}_{{{}}}^{{{}}}",
                node_to_latex(base),
                node_to_latex(sub),
                node_to_latex(sup)
            )
        }
        MathNode::PreSubSup { sub, sup, body } => {
            format!(
                "_{{{}}}^{{{}}}{}",
                node_to_latex(sub),
                node_to_latex(sup),
                node_to_latex(body)
            )
        }
        MathNode::Radical { degree, body } => {
            match degree {
                Some(d) => {
                    let deg_text = node_to_latex(d);
                    if deg_text == "2" || deg_text.is_empty() {
                        format!("\\sqrt{{{}}}", node_to_latex(body))
                    } else {
                        format!("\\sqrt[{}]{{{}}}", deg_text, node_to_latex(body))
                    }
                }
                None => format!("\\sqrt{{{}}}", node_to_latex(body)),
            }
        }
        MathNode::Nary { op, from, to, body } => {
            let op_cmd = nary_op_to_latex(op);
            let mut result = op_cmd;
            if let Some(f) = from {
                let f_text = node_to_latex(f);
                if !f_text.is_empty() {
                    result.push_str(&format!("_{{{}}}", f_text));
                }
            }
            if let Some(t) = to {
                let t_text = node_to_latex(t);
                if !t_text.is_empty() {
                    result.push_str(&format!("^{{{}}}", t_text));
                }
            }
            let body_text = node_to_latex(body);
            if !body_text.is_empty() {
                result.push(' ');
                result.push_str(&body_text);
            }
            result
        }
        MathNode::Delimiter { beg, end, children } => {
            let inner: Vec<String> = children.iter().map(node_to_latex).collect();
            let delim_map = [
                ("(", ")"), ("[", "]"), ("{", "}"), ("|", "|"),
                ("\u{27E8}", "\u{27E9}"), // angle brackets
                ("\u{230A}", "\u{230B}"), // floor
                ("\u{2308}", "\u{2309}"), // ceil
            ];
            let close = delim_map.iter()
                .find(|(b, _)| b == beg)
                .map(|(_, e)| e.to_string())
                .unwrap_or_else(|| end.clone());
            format!("{}{}{}", beg, inner.join(", "), close)
        }
        MathNode::Func { name, body } => {
            let func_cmd = func_to_latex(name);
            format!("{}{{{}}}", func_cmd, node_to_latex(body))
        }
        MathNode::Accent { chr, body } => {
            let cmd = accent_to_latex(chr);
            format!("{}{{{}}}", cmd, node_to_latex(body))
        }
        MathNode::Bar { pos, body } => {
            if pos == "bot" || pos == "bottom" {
                format!("\\underline{{{}}}", node_to_latex(body))
            } else {
                format!("\\overline{{{}}}", node_to_latex(body))
            }
        }
        MathNode::EqArray(rows) => {
            let row_strs: Vec<String> = rows.iter().map(node_to_latex).collect();
            format!("\\begin{{aligned}}{}\\end{{aligned}}", row_strs.join("\\\\"))
        }
        MathNode::Matrix { rows } => {
            let row_strs: Vec<String> = rows.iter()
                .map(|row| {
                    let cells: Vec<String> = row.iter().map(node_to_latex).collect();
                    cells.join(" & ")
                })
                .collect();
            format!("\\begin{{matrix}}{}\\end{{matrix}}", row_strs.join("\\\\"))
        }
        MathNode::Limit { name: _, below, body } => {
            format!(
                "\\lim_{{{}}}{{{}}}",
                node_to_latex(below),
                node_to_latex(body)
            )
        }
        MathNode::Overset { above, body } => {
            format!(
                "\\overset{{{}}}{{{}}}",
                node_to_latex(above),
                node_to_latex(body)
            )
        }
        MathNode::GroupChr { body, .. } => {
            node_to_latex(body)
        }
        MathNode::Phantom { body } => {
            node_to_latex(body)
        }
        MathNode::Prop(_, _) => String::new(),
    }
}

fn escape_latex(s: &str) -> String {
    let mut result = String::with_capacity(s.len() * 2);
    for ch in s.chars() {
        match ch {
            '\\' => result.push_str("\\textbackslash{}"),
            '&' => result.push_str("\\&"),
            '%' => result.push_str("\\%"),
            '$' => result.push_str("\\$"),
            '#' => result.push_str("\\#"),
            '_' => result.push_str("\\_"),
            '{' => result.push_str("\\{"),
            '}' => result.push_str("\\}"),
            '~' => result.push_str("\\textasciitilde{}"),
            '^' => result.push_str("\\textasciicircum{}"),
            _ => result.push(ch),
        }
    }
    result
}

fn nary_op_to_latex(op: &str) -> String {
    match op {
        "\u{222B}" => "\\int".to_string(),
        "\u{222C}" => "\\iint".to_string(),
        "\u{222D}" => "\\iiint".to_string(),
        "\u{222E}" => "\\oint".to_string(),
        "\u{2211}" => "\\sum".to_string(),
        "\u{220F}" => "\\prod".to_string(),
        "\u{2210}" => "\\coprod".to_string(),
        "\u{222F}" => "\\oiint".to_string(),
        "\u{2230}" => "\\oiiint".to_string(),
        _ => {
            // Try to use the character directly if it's a valid LaTeX symbol
            if op.len() == 1 {
                format!("\\operatorname{{{}}}", op)
            } else {
                op.to_string()
            }
        }
    }
}

fn func_to_latex(name: &str) -> String {
    match name.to_lowercase().as_str() {
        "sin" => "\\sin".to_string(),
        "cos" => "\\cos".to_string(),
        "tan" => "\\tan".to_string(),
        "sec" => "\\sec".to_string(),
        "csc" => "\\csc".to_string(),
        "cot" => "\\cot".to_string(),
        "arcsin" => "\\arcsin".to_string(),
        "arccos" => "\\arccos".to_string(),
        "arctan" => "\\arctan".to_string(),
        "sinh" => "\\sinh".to_string(),
        "cosh" => "\\cosh".to_string(),
        "tanh" => "\\tanh".to_string(),
        "log" => "\\log".to_string(),
        "ln" => "\\ln".to_string(),
        "exp" => "\\exp".to_string(),
        "det" => "\\det".to_string(),
        "gcd" => "\\gcd".to_string(),
        "max" => "\\max".to_string(),
        "min" => "\\min".to_string(),
        "sup" => "\\sup".to_string(),
        "inf" => "\\inf".to_string(),
        "lim" => "\\lim".to_string(),
        _ => format!("\\mathrm{{{}}}", name),
    }
}

fn accent_to_latex(chr: &str) -> String {
    match chr {
        "\u{0302}" | "^" => "\\hat".to_string(),
        "\u{0303}" | "~" => "\\tilde".to_string(),
        "\u{0304}" | "-" => "\\bar".to_string(),
        "\u{0305}" => "\\overrightarrow".to_string(),
        "\u{0307}" | "." => "\\dot".to_string(),
        "\u{0308}" | "\"" => "\\ddot".to_string(),
        "\u{20D7}" => "\\vec".to_string(),
        "\u{030C}" | "v" => "\\check".to_string(),
        "\u{0060}" => "\\grave".to_string(),
        "\u{00B4}" => "\\acute".to_string(),
        _ => format!("\\hat{{{}}}", chr),
    }
}
