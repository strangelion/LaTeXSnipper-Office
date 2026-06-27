use quick_xml::events::Event;
use quick_xml::Reader;

use super::ast::MathNode;

/// Parse OMML XML string into a MathNode tree.
/// Handles both raw OMML and full Word document XML (extracts oMath/oMathPara).
pub fn parse_omml(xml: &str) -> Result<MathNode, String> {
    let math_xml = extract_math_element(xml).unwrap_or_else(|| xml.to_string());
    println!("[Math] Extracted math element ({}b): {}...", math_xml.len(), &math_xml[..math_xml.len().min(200)]);
    parse_omml_inner(&math_xml)
}

fn decode_html_entities(xml: &str) -> String {
    let mut result = xml.to_string();
    // Decode numeric character references: &#xHEX; and &#DEC;
    if let Ok(re_hex) = regex::Regex::new(r"&#x([0-9a-fA-F]+);") {
        result = re_hex.replace_all(&result, |caps: &regex::Captures| {
            if let Some(hex) = caps.get(1) {
                if let Ok(code) = u32::from_str_radix(hex.as_str(), 16) {
                    if let Some(ch) = char::from_u32(code) {
                        return ch.to_string();
                    }
                }
            }
            String::new()
        }).to_string();
    }
    if let Ok(re_dec) = regex::Regex::new(r"&#(\d+);") {
        result = re_dec.replace_all(&result, |caps: &regex::Captures| {
            if let Some(dec) = caps.get(1) {
                if let Ok(code) = dec.as_str().parse::<u32>() {
                    if let Some(ch) = char::from_u32(code) {
                        return ch.to_string();
                    }
                }
            }
            String::new()
        }).to_string();
    }
    // Named entities
    result = result.replace("&lt;", "<").replace("&gt;", ">")
        .replace("&amp;", "&").replace("&quot;", "\"").replace("&apos;", "'");
    result
}

fn extract_math_element(xml: &str) -> Option<String> {
    // Decode HTML entities - Word Range.Xml encodes < > and Unicode chars
    let decoded = if xml.contains("&lt;") || xml.contains("&#") {
        decode_html_entities(xml)
    } else {
        xml.to_string()
    };

    println!("[Math] After decode: {}b", decoded.len());

    // Try regex patterns
    let patterns = [
        r"<m:oMathPara[\s>]",
        r"<m:oMath[\s>]",
        r"<\w+:oMathPara[\s>]",
        r"<\w+:oMath[\s>]",
        r"<oMathPara[\s>]",
        r"<oMath[\s>]",
    ];

    for pat in &patterns {
        if let Ok(re) = regex::Regex::new(pat) {
            if let Some(m) = re.find(&decoded) {
                let start = m.start();
                let tag_name = m.as_str().trim().trim_end_matches('>').trim_end_matches(' ');
                let close_tag = format!("</{}>", &tag_name[1..]);
                // Find the FIRST closing tag after start, not the last in document
                if let Some(end) = decoded[start..].find(&close_tag) {
                    let end = start + end + close_tag.len();
                    let mut result = decoded[start..end].to_string();
                    // Add namespaces if missing
                    if !result.contains("xmlns:m=") || !result.contains("xmlns:w=") {
                        if let Some(gt_pos) = result.find('>') {
                            let mut ns = String::new();
                            if !result.contains("xmlns:m=") {
                                ns.push_str(r#" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math""#);
                            }
                            if !result.contains("xmlns:w=") {
                                ns.push_str(r#" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main""#);
                            }
                            result.insert_str(gt_pos, &ns);
                        }
                    }
                    println!("[Math] Matched '{}': at {}..{} ({}b)", tag_name, start, end, result.len());
                    return Some(result);
                }
            }
        }
    }

    println!("[Math] No oMath tag pattern matched");
    None
}

fn parse_omml_inner(xml: &str) -> Result<MathNode, String> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    let mut buf = Vec::new();
    let mut stack: Vec<(String, Vec<MathNode>)> = Vec::new();
    let mut current_text = String::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let tag = bytes_start_tag(&e);
                let mut children = Vec::new();
                // Extract XML attributes as Prop nodes
                for attr in e.attributes().flatten() {
                    let key = String::from_utf8_lossy(attr.key.as_ref()).to_string();
                    let val = String::from_utf8_lossy(&attr.value).to_string();
                    // Strip namespace prefix from key
                    let local_key = if let Some(idx) = key.find(':') {
                        key[idx + 1..].to_string()
                    } else {
                        key
                    };
                    children.push(MathNode::Prop(local_key, val));
                }
                stack.push((tag, children));
                current_text.clear();
            }
            Ok(Event::Text(e)) => {
                let t = e.unescape().unwrap_or_default();
                current_text.push_str(&t);
            }
            Ok(Event::Empty(e)) => {
                let tag = bytes_start_tag(&e);
                let mut children = Vec::new();
                for attr in e.attributes().flatten() {
                    let key = String::from_utf8_lossy(attr.key.as_ref()).to_string();
                    let val = String::from_utf8_lossy(&attr.value).to_string();
                    let local_key = if let Some(idx) = key.find(':') {
                        key[idx + 1..].to_string()
                    } else {
                        key
                    };
                    children.push(MathNode::Prop(local_key, val));
                }
                let node = build_node(&tag, children, "");
                if let Some((_, ref mut parent_children)) = stack.last_mut() {
                    parent_children.push(node);
                } else {
                    return Ok(node);
                }
            }
            Ok(Event::End(_e)) => {
                if let Some((open_tag, children)) = stack.pop() {
                    let text_content = if current_text.is_empty() {
                        extract_text_from_children(&children)
                    } else {
                        let t = current_text.clone();
                        current_text.clear();
                        t
                    };

                    let node = build_node(&open_tag, children, &text_content);

                    if let Some((_, ref mut parent_children)) = stack.last_mut() {
                        parent_children.push(node);
                    } else {
                        return Ok(node);
                    }
                }
                current_text.clear();
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(format!("XML parse error: {}", e)),
            _ => {}
        }
        buf.clear();
    }

    if let Some((tag, children)) = stack.pop() {
        let text_content = extract_text_from_children(&children);
        return Ok(build_node(&tag, children, &text_content));
    }

    Err("Empty OMML document".to_string())
}

fn bytes_start_tag(e: &quick_xml::events::BytesStart) -> String {
    let raw = String::from_utf8_lossy(e.name().as_ref()).to_string();
    tag_local(&raw)
}

fn tag_local(tag: &str) -> String {
    if let Some(idx) = tag.find(':') {
        tag[idx + 1..].to_string()
    } else {
        tag.to_string()
    }
}

fn extract_text_from_children(children: &[MathNode]) -> String {
    let mut result = String::new();
    for c in children {
        if let MathNode::Text(t) = c {
            result.push_str(t);
        }
    }
    result
}

fn build_node(tag: &str, children: Vec<MathNode>, text: &str) -> MathNode {
    match tag {
        "oMathPara" | "oMath" => {
            if children.len() == 1 {
                children.into_iter().next().unwrap_or(MathNode::Row(vec![]))
            } else {
                MathNode::Row(children)
            }
        }
        "r" => {
            let t = extract_text_from_children(&children);
            MathNode::Text(t)
        }
        "t" => MathNode::Text(text.to_string()),
        "f" => {
            let (num, den) = extract_fraction_parts(&children);
            MathNode::Fraction {
                num: Box::new(num),
                den: Box::new(den),
            }
        }
        "sSup" => {
            let (base, sup) = extract_sup_sub_parts(&children);
            MathNode::Sup {
                base: Box::new(base),
                sup: Box::new(sup),
            }
        }
        "sSub" => {
            let (base, sub) = extract_sup_sub_parts(&children);
            MathNode::Sub {
                base: Box::new(base),
                sub: Box::new(sub),
            }
        }
        "sSubSup" => {
            let (base, sub, sup) = extract_subsup_parts(&children);
            MathNode::SubSup {
                base: Box::new(base),
                sub: Box::new(sub),
                sup: Box::new(sup),
            }
        }
        "sPre" => {
            let (sub, sup, body) = extract_presub_parts(&children);
            MathNode::PreSubSup {
                sub: Box::new(sub),
                sup: Box::new(sup),
                body: Box::new(body),
            }
        }
        "rad" => {
            let (degree, body) = extract_radical_parts(&children);
            MathNode::Radical {
                degree: degree.map(|d| Box::new(d)),
                body: Box::new(body),
            }
        }
        "nary" => {
            let (op, from, to, body) = extract_nary_parts(&children);
            MathNode::Nary {
                op,
                from: from.map(|f| Box::new(f)),
                to: to.map(|t| Box::new(t)),
                body: Box::new(body),
            }
        }
        "d" => {
            let (beg, end, inner) = extract_delimiter_parts(&children);
            MathNode::Delimiter {
                beg,
                end,
                children: inner,
            }
        }
        "func" => {
            let (name, body) = extract_func_parts(&children);
            MathNode::Func { name, body: Box::new(body) }
        }
        "acc" => {
            let (chr, body) = extract_accent_parts(&children);
            MathNode::Accent {
                chr,
                body: Box::new(body),
            }
        }
        "bar" => {
            let (pos, body) = extract_bar_parts(&children);
            MathNode::Bar {
                pos,
                body: Box::new(body),
            }
        }
        "eqArr" => {
            let elems: Vec<MathNode> = children.into_iter().filter(|c| !is_property(c)).collect();
            MathNode::EqArray(elems)
        }
        "m" => {
            let rows = extract_matrix_rows(&children);
            MathNode::Matrix { rows }
        }
        "limLow" => {
            let (body, below) = extract_lim_parts(&children);
            MathNode::Limit {
                name: "lim".to_string(),
                below: Box::new(below),
                body: Box::new(body),
            }
        }
        "limUpp" => {
            let (body, above) = extract_lim_parts(&children);
            MathNode::Overset {
                above: Box::new(above),
                body: Box::new(body),
            }
        }
        "groupChr" => {
            let body = extract_e_child(&children);
            MathNode::GroupChr {
                chr: String::new(),
                body: Box::new(body),
            }
        }
        "box" | "borderBox" => {
            let body = extract_e_child(&children);
            MathNode::Phantom { body: Box::new(body) }
        }
        "mr" => {
            if children.len() == 1 {
                children.into_iter().next().unwrap()
            } else {
                MathNode::Row(children)
            }
        }
        "chr" => {
            // chr element carries attributes (e.g., val="∑"), preserve them
            MathNode::Row(children)
        }
        "ctrlPr" | "rPr" | "dPr" | "fPr" | "radPr" | "funcPr" |
        "limLowPr" | "limUppPr" | "accPr" | "barPr" | "groupChrPr" |
        "sSupPr" | "sSubPr" | "sSubSupPr" | "sPrePr" |
        "deg" | "num" | "den" | "e" | "sub" | "sup" | "lim" | "fName" |
        "degHide" => {
            let non_prop: Vec<MathNode> = children.into_iter()
                .filter(|c| !matches!(c, MathNode::Row(_) | MathNode::Prop(_, _)))
                .filter(|c| !matches!(c, MathNode::Text(t) if t.is_empty()))
                .collect();
            if non_prop.len() == 1 {
                non_prop.into_iter().next().unwrap()
            } else if non_prop.is_empty() {
                MathNode::Text(String::new())
            } else {
                MathNode::Row(non_prop)
            }
        }
        // naryPr preserves all children (including chr with attributes)
        "naryPr" => MathNode::Row(children),
        // Word formatting tags - skip silently
        t if t.starts_with("w:") || t.starts_with("wx:") => MathNode::Text(String::new()),
        _ => {
            let non_prop: Vec<MathNode> = children.into_iter().filter(|c| !is_property(c)).collect();
            if non_prop.len() == 1 {
                non_prop.into_iter().next().unwrap()
            } else if non_prop.is_empty() {
                MathNode::Text(String::new())
            } else {
                MathNode::Row(non_prop)
            }
        }
    }
}

fn is_property(node: &MathNode) -> bool {
    matches!(node, MathNode::Row(_) | MathNode::Prop(_, _))
}

fn get_text(node: &MathNode) -> String {
    match node {
        MathNode::Text(t) => t.clone(),
        MathNode::Row(children) => {
            children.iter().map(get_text).collect()
        }
        _ => String::new(),
    }
}

fn extract_e_child(children: &[MathNode]) -> MathNode {
    children.iter().find(|c| !is_property(c)).cloned().unwrap_or(MathNode::Text(String::new()))
}

fn extract_fraction_parts(children: &[MathNode]) -> (MathNode, MathNode) {
    let content: Vec<&MathNode> = children.iter()
        .filter(|c| !matches!(c, MathNode::Row(_) | MathNode::Prop(_, _)))
        .filter(|c| !matches!(c, MathNode::Text(t) if t.is_empty()))
        .collect();
    let num = content.first().cloned().unwrap_or(&MathNode::Text(String::new())).clone();
    let den = content.get(1).cloned().unwrap_or(&MathNode::Text(String::new())).clone();
    (num, den)
}

fn extract_sup_sub_parts(children: &[MathNode]) -> (MathNode, MathNode) {
    let content: Vec<&MathNode> = children.iter()
        .filter(|c| !matches!(c, MathNode::Row(_) | MathNode::Prop(_, _)))
        .filter(|c| !matches!(c, MathNode::Text(t) if t.is_empty()))
        .collect();
    let base = content.first().cloned().unwrap_or(&MathNode::Text(String::new())).clone();
    let sub_sup = content.get(1).cloned().unwrap_or(&MathNode::Text(String::new())).clone();
    (base, sub_sup)
}

fn extract_subsup_parts(children: &[MathNode]) -> (MathNode, MathNode, MathNode) {
    let content: Vec<&MathNode> = children.iter()
        .filter(|c| !matches!(c, MathNode::Row(_) | MathNode::Prop(_, _)))
        .filter(|c| !matches!(c, MathNode::Text(t) if t.is_empty()))
        .collect();
    let base = content.first().cloned().unwrap_or(&MathNode::Text(String::new())).clone();
    let sub = content.get(1).cloned().unwrap_or(&MathNode::Text(String::new())).clone();
    let sup = content.get(2).cloned().unwrap_or(&MathNode::Text(String::new())).clone();
    (base, sub, sup)
}

fn extract_presub_parts(children: &[MathNode]) -> (MathNode, MathNode, MathNode) {
    let content: Vec<&MathNode> = children.iter()
        .filter(|c| !matches!(c, MathNode::Row(_) | MathNode::Prop(_, _)))
        .filter(|c| !matches!(c, MathNode::Text(t) if t.is_empty()))
        .collect();
    let sub = content.first().cloned().unwrap_or(&MathNode::Text(String::new())).clone();
    let sup = content.get(1).cloned().unwrap_or(&MathNode::Text(String::new())).clone();
    let body = content.get(2).cloned().unwrap_or(&MathNode::Text(String::new())).clone();
    (sub, sup, body)
}

fn extract_radical_parts(children: &[MathNode]) -> (Option<MathNode>, MathNode) {
    // OMML rad structure: radPr, deg, e
    // After property unwrapping, empty Text nodes represent radPr and empty deg.
    let content: Vec<&MathNode> = children.iter()
        .filter(|c| !matches!(c, MathNode::Row(_)))
        .filter(|c| !matches!(c, MathNode::Text(t) if t.is_empty()))
        .collect();
    if content.len() <= 1 {
        // Only body remains (deg was empty/hidden)
        let body = content.first().cloned().unwrap_or(&MathNode::Text(String::new())).clone();
        (None, body)
    } else {
        // First is degree, rest forms body
        let degree = Some(content[0].clone());
        let body = if content.len() == 2 {
            content[1].clone()
        } else {
            MathNode::Row(content[1..].iter().map(|n| (*n).clone()).collect())
        };
        (degree, body)
    }
}

fn extract_nary_parts(children: &[MathNode]) -> (String, Option<MathNode>, Option<MathNode>, MathNode) {
    let mut op = "\u{222B}".to_string();
    let mut from = None;
    let mut to = None;
    let mut body = MathNode::Text(String::new());
    let mut seen_sub = false;
    let mut seen_sup = false;

    // Recursively search for chr val attribute
    fn find_chr_val(nodes: &[MathNode]) -> Option<String> {
        for node in nodes {
            match node {
                MathNode::Prop(key, val) if key == "val" && !val.is_empty() => {
                    return Some(val.clone());
                }
                MathNode::Row(children) => {
                    if let Some(v) = find_chr_val(children) {
                        return Some(v);
                    }
                }
                _ => {}
            }
        }
        None
    }

    if let Some(val) = find_chr_val(children) {
        op = val;
    }

    // Extract sub/sup/e (skip property-like nodes)
    for child in children {
        match child {
            MathNode::Row(_) | MathNode::Prop(_, _) => {}
            MathNode::Text(t) if t.is_empty() => {}
            _ => {
                if !seen_sub {
                    from = Some(child.clone());
                    seen_sub = true;
                } else if !seen_sup {
                    to = Some(child.clone());
                    seen_sup = true;
                } else {
                    body = child.clone();
                }
            }
        }
    }

    (op, from, to, body)
}

fn extract_delimiter_parts(children: &[MathNode]) -> (String, String, Vec<MathNode>) {
    let beg = "(".to_string();
    let end = ")".to_string();
    let mut inner = Vec::new();

    for child in children {
        match child {
            MathNode::Row(_) => {}
            _ => {
                let text = get_text(child);
                if !text.is_empty() {
                    inner.push(child.clone());
                }
            }
        }
    }

    (beg, end, inner)
}

fn extract_func_parts(children: &[MathNode]) -> (String, MathNode) {
    let content: Vec<&MathNode> = children.iter()
        .filter(|c| !matches!(c, MathNode::Row(_) | MathNode::Prop(_, _)))
        .filter(|c| !matches!(c, MathNode::Text(t) if t.is_empty()))
        .collect();
    let name = content.first().map(|n| get_text(n)).unwrap_or_default();
    let body = content.get(1).cloned().unwrap_or(&MathNode::Text(String::new())).clone();
    (name, body)
}

fn extract_accent_parts(children: &[MathNode]) -> (String, MathNode) {
    let mut chr = "\u{0302}".to_string();
    let mut body = MathNode::Text(String::new());

    for child in children {
        match child {
            MathNode::Row(_) => {
                let text = get_text(child);
                if !text.is_empty() && chr == "\u{0302}" {
                    chr = text;
                }
            }
            _ => {
                let text = get_text(child);
                if !text.is_empty() {
                    body = child.clone();
                }
            }
        }
    }

    (chr, body)
}

fn extract_bar_parts(children: &[MathNode]) -> (String, MathNode) {
    let pos = "top".to_string();
    let mut body = MathNode::Text(String::new());

    for child in children {
        match child {
            MathNode::Row(_) => {}
            _ => {
                let text = get_text(child);
                if !text.is_empty() {
                    body = child.clone();
                }
            }
        }
    }

    (pos, body)
}

fn extract_lim_parts(children: &[MathNode]) -> (MathNode, MathNode) {
    let content: Vec<&MathNode> = children.iter()
        .filter(|c| !matches!(c, MathNode::Row(_) | MathNode::Prop(_, _)))
        .filter(|c| !matches!(c, MathNode::Text(t) if t.is_empty()))
        .collect();
    let body = content.first().cloned().unwrap_or(&MathNode::Text(String::new())).clone();
    let limit = content.get(1).cloned().unwrap_or(&MathNode::Text(String::new())).clone();
    (body, limit)
}

fn extract_matrix_rows(children: &[MathNode]) -> Vec<Vec<MathNode>> {
    let mut rows = Vec::new();
    for child in children {
        if let MathNode::Row(cells) = child {
            rows.push(cells.clone());
        } else {
            rows.push(vec![child.clone()]);
        }
    }
    rows
}
