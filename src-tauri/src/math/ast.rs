/// Unified AST for OMML <-> LaTeX bidirectional conversion.
#[derive(Debug, Clone, PartialEq)]
pub enum MathNode {
    /// Sequence of nodes (root container).
    Row(Vec<MathNode>),
    /// Plain text run.
    Text(String),
    /// \frac{num}{den}
    Fraction {
        num: Box<MathNode>,
        den: Box<MathNode>,
    },
    /// base^{sup}
    Sup {
        base: Box<MathNode>,
        sup: Box<MathNode>,
    },
    /// base_{sub}
    Sub {
        base: Box<MathNode>,
        sub: Box<MathNode>,
    },
    /// base_{sub}^{sup}
    SubSup {
        base: Box<MathNode>,
        sub: Box<MathNode>,
        sup: Box<MathNode>,
    },
    /// _{sub}^{sup}base (pre-sub-superscript)
    PreSubSup {
        sub: Box<MathNode>,
        sup: Box<MathNode>,
        body: Box<MathNode>,
    },
    /// \sqrt[degree]{body} or \sqrt{body}
    Radical {
        degree: Option<Box<MathNode>>,
        body: Box<MathNode>,
    },
    /// \sum, \int, \prod, etc.
    Nary {
        op: String,
        from: Option<Box<MathNode>>,
        to: Option<Box<MathNode>>,
        body: Box<MathNode>,
    },
    /// Delimiters: (), [], {}, ||
    Delimiter {
        beg: String,
        end: String,
        children: Vec<MathNode>,
    },
    /// \sin(x), \log(x), etc.
    Func {
        name: String,
        body: Box<MathNode>,
    },
    /// \hat{x}, \vec{x}, \dot{x}, etc.
    Accent {
        chr: String,
        body: Box<MathNode>,
    },
    /// \overline{x} or \underline{x}
    Bar {
        pos: String,
        body: Box<MathNode>,
    },
    /// \begin{aligned} ... \end{aligned}
    EqArray(Vec<MathNode>),
    /// \begin{matrix} ... \end{matrix}
    Matrix {
        rows: Vec<Vec<MathNode>>,
    },
    /// \lim_{below} body
    Limit {
        name: String,
        below: Box<MathNode>,
        body: Box<MathNode>,
    },
    /// \overset{above}{body}
    Overset {
        above: Box<MathNode>,
        body: Box<MathNode>,
    },
    /// Group character (e.g., underbrace)
    GroupChr {
        chr: String,
        body: Box<MathNode>,
    },
    /// Phantom/box (passthrough)
    Phantom {
        body: Box<MathNode>,
    },
    /// XML attribute key-value pair (e.g., chr val="∑")
    Prop(String, String),
}
