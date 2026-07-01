use super::ast::*;

pub fn node_to_latex(node: &MathIR) -> String {
    match node {
        MathIR::Row(children) => children.iter().map(node_to_latex).collect(),
        MathIR::Text(t) => escape_latex(t),
        MathIR::Identifier { name, style } => {
            let s = escape_latex(name);
            match style {
                FontStyle::Bold => format!("\\mathbf{{{}}}", s),
                FontStyle::Italic => s,
                FontStyle::BoldItalic => format!("\\mathbf{{{}}}", s),
                FontStyle::BlackboardBold => format!("\\mathbb{{{}}}", s),
                FontStyle::Script => format!("\\mathcal{{{}}}", s),
                FontStyle::Fraktur => format!("\\mathfrak{{{}}}", s),
                FontStyle::Monospace => format!("\\mathtt{{{}}}", s),
                FontStyle::Normal => s,
            }
        }
        MathIR::Operator { kind, .. } => operator_to_latex(*kind),
        MathIR::Fraction { num, den } => {
            format!("\\frac{{{}}}{{{}}}", node_to_latex(num), node_to_latex(den))
        }
        MathIR::Sup { base, exp } => {
            format!("{{{}}}^{{{}}}", node_to_latex(base), node_to_latex(exp))
        }
        MathIR::Sub { base, index } => {
            format!("{{{}}}_{{{}}}", node_to_latex(base), node_to_latex(index))
        }
        MathIR::SubSup { base, sub, sup } => {
            format!("{{{}}}_{{{}}}^{{{}}}", node_to_latex(base), node_to_latex(sub), node_to_latex(sup))
        }
        MathIR::PreSubSup { sub, sup, body } => {
            format!("_{{{}}}^{{{}}}{}", node_to_latex(sub), node_to_latex(sup), node_to_latex(body))
        }
        MathIR::Radical { degree, radicand } => {
            match degree {
                Some(d) => {
                    let dt = node_to_latex(d);
                    if dt == "2" || dt.is_empty() {
                        format!("\\sqrt{{{}}}", node_to_latex(radicand))
                    } else {
                        format!("\\sqrt[{}]{{{}}}", dt, node_to_latex(radicand))
                    }
                }
                None => format!("\\sqrt{{{}}}", node_to_latex(radicand)),
            }
        }
        MathIR::Nary { op, lower, upper, body } => {
            let mut result = nary_op_to_latex(*op);
            if let Some(l) = lower {
                let t = node_to_latex(l);
                if !t.is_empty() { result.push_str(&format!("_{{{}}}", t)); }
            }
            if let Some(u) = upper {
                let t = node_to_latex(u);
                if !t.is_empty() { result.push_str(&format!("^{{{}}}", t)); }
            }
            let bt = node_to_latex(body);
            if !bt.is_empty() { result.push(' '); result.push_str(&bt); }
            result
        }
        MathIR::Delimiter { open, close, children } => {
            let inner: Vec<String> = children.iter().map(node_to_latex).collect();
            format!("{}{}{}", open, inner.join(", "), close)
        }
        MathIR::Function { name, body } => {
            format!("{}{{{}}}", func_to_latex(name), node_to_latex(body))
        }
        MathIR::Accent { kind, body } => {
            format!("{}{{{}}}", accent_to_latex(*kind), node_to_latex(body))
        }
        MathIR::OverUnder { kind, body } => {
            match kind {
                OverUnderKind::Underline => format!("\\underline{{{}}}", node_to_latex(body)),
                OverUnderKind::Overline => format!("\\overline{{{}}}", node_to_latex(body)),
                OverUnderKind::Overbrace => format!("\\overbrace{{{}}}", node_to_latex(body)),
                OverUnderKind::Underbrace => format!("\\underbrace{{{}}}", node_to_latex(body)),
            }
        }
        MathIR::EqArray { rows } => {
            let row_strs: Vec<String> = rows.iter()
                .map(|cells| cells.iter().map(node_to_latex).collect::<Vec<_>>().join(" & "))
                .collect();
            format!("\\begin{{aligned}}{}\\end{{aligned}}", row_strs.join("\\\\"))
        }
        MathIR::Matrix { rows, kind } => {
            let env = matrix_env(*kind);
            let row_strs: Vec<String> = rows.iter()
                .map(|cells| cells.iter().map(node_to_latex).collect::<Vec<_>>().join(" & "))
                .collect();
            format!("\\begin{{{}}}{}\\end{{{}}}", env, row_strs.join("\\\\"), env)
        }
        MathIR::Limit { name, below, body } => {
            format!("\\{}_{{{}}}{{{}}}", func_to_latex(name), node_to_latex(below), node_to_latex(body))
        }
        MathIR::Overset { above, body } => {
            format!("\\overset{{{}}}{{{}}}", node_to_latex(above), node_to_latex(body))
        }
        MathIR::Phantom { body } => node_to_latex(body),
        MathIR::Prop(_, _) => String::new(),
    }
}

fn escape_latex(s: &str) -> String {
    let mut result = String::with_capacity(s.len() * 2);
    let chars: Vec<char> = s.chars().collect();
    for (i, &ch) in chars.iter().enumerate() {
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
            _ => {
                if let Some(cmd) = unicode_to_latex_cmd(ch) {
                    result.push_str(cmd);
                    // Add space after command if next char is a letter
                    if let Some(&next) = chars.get(i + 1) {
                        if next.is_ascii_alphabetic() {
                            result.push(' ');
                        }
                    }
                } else {
                    result.push(ch);
                }
            }
        }
    }
    result
}

fn unicode_to_latex_cmd(ch: char) -> Option<&'static str> {
    match ch {
        '\u{0391}' => Some("\\Alpha"),
        '\u{0392}' => Some("\\Beta"),
        '\u{0393}' => Some("\\Gamma"),
        '\u{0394}' => Some("\\Delta"),
        '\u{0395}' => Some("\\Epsilon"),
        '\u{0396}' => Some("\\Zeta"),
        '\u{0397}' => Some("\\Eta"),
        '\u{0398}' => Some("\\Theta"),
        '\u{0399}' => Some("\\Iota"),
        '\u{039A}' => Some("\\Kappa"),
        '\u{039B}' => Some("\\Lambda"),
        '\u{039C}' => Some("\\Mu"),
        '\u{039D}' => Some("\\Nu"),
        '\u{039E}' => Some("\\Xi"),
        '\u{039F}' => Some("\\Omicron"),
        '\u{03A0}' => Some("\\Pi"),
        '\u{03A1}' => Some("\\Rho"),
        '\u{03A3}' => Some("\\Sigma"),
        '\u{03A4}' => Some("\\Tau"),
        '\u{03A5}' => Some("\\Upsilon"),
        '\u{03A6}' => Some("\\Phi"),
        '\u{03A7}' => Some("\\Chi"),
        '\u{03A8}' => Some("\\Psi"),
        '\u{03A9}' => Some("\\Omega"),
        '\u{03B1}' => Some("\\alpha"),
        '\u{03B2}' => Some("\\beta"),
        '\u{03B3}' => Some("\\gamma"),
        '\u{03B4}' => Some("\\delta"),
        '\u{03B5}' => Some("\\epsilon"),
        '\u{03B6}' => Some("\\zeta"),
        '\u{03B7}' => Some("\\eta"),
        '\u{03B8}' => Some("\\theta"),
        '\u{03B9}' => Some("\\iota"),
        '\u{03BA}' => Some("\\kappa"),
        '\u{03BB}' => Some("\\lambda"),
        '\u{03BC}' => Some("\\mu"),
        '\u{03BD}' => Some("\\nu"),
        '\u{03BE}' => Some("\\xi"),
        '\u{03BF}' => Some("\\omicron"),
        '\u{03C0}' => Some("\\pi"),
        '\u{03C1}' => Some("\\rho"),
        '\u{03C3}' => Some("\\sigma"),
        '\u{03C4}' => Some("\\tau"),
        '\u{03C5}' => Some("\\upsilon"),
        '\u{03C6}' => Some("\\phi"),
        '\u{03C7}' => Some("\\chi"),
        '\u{03C8}' => Some("\\psi"),
        '\u{03C9}' => Some("\\omega"),
        '\u{03D1}' => Some("\\vartheta"),
        '\u{03D5}' => Some("\\varphi"),
        '\u{03D6}' => Some("\\varpi"),
        '\u{03F0}' => Some("\\varkappa"),
        '\u{03F1}' => Some("\\varrho"),
        '\u{03F5}' => Some("\\varepsilon"),
        '\u{2202}' => Some("\\partial"),
        '\u{2207}' => Some("\\nabla"),
        '\u{221E}' => Some("\\infty"),
        '\u{2200}' => Some("\\forall"),
        '\u{2203}' => Some("\\exists"),
        '\u{2205}' => Some("\\emptyset"),
        '\u{2208}' => Some("\\in"),
        '\u{2209}' => Some("\\notin"),
        '\u{2282}' => Some("\\subset"),
        '\u{2283}' => Some("\\supset"),
        '\u{2286}' => Some("\\subseteq"),
        '\u{2287}' => Some("\\supseteq"),
        '\u{2229}' => Some("\\cap"),
        '\u{222A}' => Some("\\cup"),
        '\u{2216}' => Some("\\setminus"),
        '\u{2261}' => Some("\\equiv"),
        '\u{2248}' => Some("\\approx"),
        '\u{223C}' => Some("\\sim"),
        '\u{221D}' => Some("\\propto"),
        '\u{2264}' => Some("\\leq"),
        '\u{2265}' => Some("\\geq"),
        '\u{2260}' => Some("\\neq"),
        '\u{00D7}' => Some("\\times"),
        '\u{00F7}' => Some("\\div"),
        '\u{00B1}' => Some("\\pm"),
        '\u{2213}' => Some("\\mp"),
        '\u{22C5}' => Some("\\cdot"),
        '\u{2211}' => Some("\\sum"),
        '\u{220F}' => Some("\\prod"),
        '\u{222B}' => Some("\\int"),
        '\u{222C}' => Some("\\iint"),
        '\u{222D}' => Some("\\iiint"),
        '\u{222E}' => Some("\\oint"),
        '\u{2210}' => Some("\\coprod"),
        '\u{2192}' => Some("\\rightarrow"),
        '\u{2190}' => Some("\\leftarrow"),
        '\u{2194}' => Some("\\leftrightarrow"),
        '\u{21D2}' => Some("\\Rightarrow"),
        '\u{21D0}' => Some("\\Leftarrow"),
        '\u{00AC}' => Some("\\neg"),
        '\u{2227}' => Some("\\wedge"),
        '\u{2228}' => Some("\\vee"),
        '\u{27E8}' => Some("\\langle"),
        '\u{27E9}' => Some("\\rangle"),
        '\u{230A}' => Some("\\lfloor"),
        '\u{230B}' => Some("\\rfloor"),
        '\u{2308}' => Some("\\lceil"),
        '\u{2309}' => Some("\\rceil"),
        '\u{2026}' => Some("\\ldots"),
        '\u{22EF}' => Some("\\cdots"),
        '\u{22EE}' => Some("\\vdots"),
        '\u{22F1}' => Some("\\ddots"),
        '\u{8796}' => Some("\\Delta"),
        '\u{8797}' => Some("\\Theta"),
        '\u{8798}' => Some("\\Lambda"),
        '\u{8799}' => Some("\\Xi"),
        '\u{879A}' => Some("\\Pi"),
        '\u{879B}' => Some("\\Sigma"),
        '\u{879C}' => Some("\\Phi"),
        '\u{879D}' => Some("\\Psi"),
        '\u{879E}' => Some("\\Omega"),
        '\u{879F}' => Some("\\alpha"),
        '\u{87A0}' => Some("\\beta"),
        '\u{87A1}' => Some("\\gamma"),
        '\u{87A2}' => Some("\\delta"),
        '\u{87A3}' => Some("\\epsilon"),
        '\u{87A4}' => Some("\\zeta"),
        '\u{87A5}' => Some("\\eta"),
        '\u{87A6}' => Some("\\theta"),
        '\u{87A7}' => Some("\\iota"),
        '\u{87A8}' => Some("\\kappa"),
        '\u{87A9}' => Some("\\lambda"),
        '\u{87AA}' => Some("\\mu"),
        '\u{87AB}' => Some("\\nu"),
        '\u{87AC}' => Some("\\xi"),
        '\u{87AD}' => Some("\\omicron"),
        '\u{87AE}' => Some("\\pi"),
        '\u{87AF}' => Some("\\rho"),
        '\u{87B0}' => Some("\\sigma"),
        '\u{87B1}' => Some("\\tau"),
        '\u{87B2}' => Some("\\upsilon"),
        '\u{87B3}' => Some("\\phi"),
        '\u{87B4}' => Some("\\chi"),
        '\u{87B5}' => Some("\\psi"),
        '\u{87B6}' => Some("\\omega"),
        _ => None,
    }
}

fn operator_to_latex(op: OperatorKind) -> String {
    match op {
        OperatorKind::Plus => "+".into(),
        OperatorKind::Minus => "-".into(),
        OperatorKind::Times => "\\times".into(),
        OperatorKind::Divide => "\\div".into(),
        OperatorKind::PlusMinus => "\\pm".into(),
        OperatorKind::MinusPlus => "\\mp".into(),
        OperatorKind::Dot => "\\cdot".into(),
        OperatorKind::Cross => "\\times".into(),
        OperatorKind::Equal => "=".into(),
        OperatorKind::NotEqual => "\\neq".into(),
        OperatorKind::Less => "<".into(),
        OperatorKind::Greater => ">".into(),
        OperatorKind::LessEqual => "\\leq".into(),
        OperatorKind::GreaterEqual => "\\geq".into(),
        OperatorKind::Approx => "\\approx".into(),
        OperatorKind::Equiv => "\\equiv".into(),
        OperatorKind::Sim => "\\sim".into(),
        OperatorKind::Propto => "\\propto".into(),
        OperatorKind::Union => "\\cup".into(),
        OperatorKind::Intersection => "\\cap".into(),
        OperatorKind::SetMinus => "\\setminus".into(),
        OperatorKind::Subset => "\\subset".into(),
        OperatorKind::Superset => "\\supset".into(),
        OperatorKind::SubsetEqual => "\\subseteq".into(),
        OperatorKind::SupersetEqual => "\\supseteq".into(),
        OperatorKind::ElementOf => "\\in".into(),
        OperatorKind::NotElementOf => "\\notin".into(),
        OperatorKind::And => "\\wedge".into(),
        OperatorKind::Or => "\\vee".into(),
        OperatorKind::Not => "\\neg".into(),
        OperatorKind::ForAll => "\\forall".into(),
        OperatorKind::Exists => "\\exists".into(),
        OperatorKind::Ellipsis => "\\ldots".into(),
        OperatorKind::CDots => "\\cdots".into(),
        OperatorKind::VDots => "\\vdots".into(),
        OperatorKind::DDots => "\\ddots".into(),
        OperatorKind::Dagger => "\\dagger".into(),
        OperatorKind::DoubleDagger => "\\ddagger".into(),
        OperatorKind::Colon => ":".into(),
        OperatorKind::Semicolon => ";".into(),
        OperatorKind::Comma => ",".into(),
        OperatorKind::Space => " ".into(),
        OperatorKind::Asterisk => "*".into(),
    }
}

fn nary_op_to_latex(op: NaryOp) -> String {
    match op {
        NaryOp::Sum => "\\sum".into(),
        NaryOp::Prod => "\\prod".into(),
        NaryOp::Coprod => "\\coprod".into(),
        NaryOp::Int => "\\int".into(),
        NaryOp::Iint => "\\iint".into(),
        NaryOp::Iiiint => "\\iiint".into(),
        NaryOp::Oint => "\\oint".into(),
        NaryOp::Oiint => "\\oiint".into(),
        NaryOp::Oiiint => "\\oiiint".into(),
    }
}

fn func_to_latex(name: &str) -> String {
    match name.to_lowercase().as_str() {
        "sin" => "\\sin".into(),
        "cos" => "\\cos".into(),
        "tan" => "\\tan".into(),
        "sec" => "\\sec".into(),
        "csc" => "\\csc".into(),
        "cot" => "\\cot".into(),
        "arcsin" => "\\arcsin".into(),
        "arccos" => "\\arccos".into(),
        "arctan" => "\\arctan".into(),
        "sinh" => "\\sinh".into(),
        "cosh" => "\\cosh".into(),
        "tanh" => "\\tanh".into(),
        "log" => "\\log".into(),
        "ln" => "\\ln".into(),
        "exp" => "\\exp".into(),
        "det" => "\\det".into(),
        "gcd" => "\\gcd".into(),
        "max" => "\\max".into(),
        "min" => "\\min".into(),
        "sup" => "\\sup".into(),
        "inf" => "\\inf".into(),
        "lim" => "\\lim".into(),
        _ => format!("\\mathrm{{{}}}", name),
    }
}

fn accent_to_latex(kind: AccentKind) -> String {
    match kind {
        AccentKind::Hat => "\\hat".into(),
        AccentKind::Tilde => "\\tilde".into(),
        AccentKind::Bar => "\\bar".into(),
        AccentKind::Overrightarrow => "\\overrightarrow".into(),
        AccentKind::Dot => "\\dot".into(),
        AccentKind::Ddot => "\\ddot".into(),
        AccentKind::Vec => "\\vec".into(),
        AccentKind::Check => "\\check".into(),
        AccentKind::Grave => "\\grave".into(),
        AccentKind::Acute => "\\acute".into(),
    }
}

fn matrix_env(kind: MatrixKind) -> &'static str {
    match kind {
        MatrixKind::Plain => "matrix",
        MatrixKind::Paren => "pmatrix",
        MatrixKind::Bracket => "bmatrix",
        MatrixKind::Brace => "Bmatrix",
        MatrixKind::Bar => "vmatrix",
        MatrixKind::DoubleBar => "Vmatrix",
    }
}
