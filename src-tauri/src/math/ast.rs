/// Canonical Math IR — 语义层，不绑定任何输出格式。
/// 设计原则：语义完备、layout-aware、可双向、可验证。

/// 字体样式
#[derive(Debug, Clone, Copy, PartialEq, Default)]
#[allow(dead_code)]
pub enum FontStyle {
    #[default]
    Normal,
    Bold,
    Italic,
    BoldItalic,
    /// \mathrm, \mathsf, \mathtt, etc.
    BlackboardBold,
    Script,
    Fraktur,
    Monospace,
}

/// 运算符间距
#[derive(Debug, Clone, Copy, PartialEq, Default)]
#[allow(dead_code)]
pub enum Spacing {
    #[default]
    Normal,
    Thin,
    Medium,
    Thick,
    NoSpace,
}

/// 二元/关系运算符
#[derive(Debug, Clone, Copy, PartialEq)]
#[allow(dead_code)]
pub enum OperatorKind {
    // Arithmetic
    Plus,
    Minus,
    Times,
    Divide,
    PlusMinus,
    MinusPlus,
    Dot,
    Cross,
    Asterisk,
    // Relations
    Equal,
    NotEqual,
    Less,
    Greater,
    LessEqual,
    GreaterEqual,
    Approx,
    Equiv,
    Sim,
    Propto,
    // Set
    Union,
    Intersection,
    SetMinus,
    Subset,
    Superset,
    SubsetEqual,
    SupersetEqual,
    ElementOf,
    NotElementOf,
    // Logic
    And,
    Or,
    Not,
    ForAll,
    Exists,
    // Misc
    Dagger,
    DoubleDagger,
    Ellipsis,
    CDots,
    VDots,
    DDots,
    Colon,
    Semicolon,
    Comma,
    Space,
}

#[allow(dead_code)]
impl OperatorKind {
    pub fn from_char(ch: char) -> Option<Self> {
        match ch {
            '+' => Some(Self::Plus),
            '-' | '\u{2212}' => Some(Self::Minus),
            '\u{00D7}' | '\u{22C5}' => Some(Self::Times),
            '/' | '\u{00F7}' => Some(Self::Divide),
            '=' => Some(Self::Equal),
            '<' => Some(Self::Less),
            '>' => Some(Self::Greater),
            ',' => Some(Self::Comma),
            ':' => Some(Self::Colon),
            ';' => Some(Self::Semicolon),
            '.' => Some(Self::Dot),
            '!' => Some(Self::Not),
            _ => None,
        }
    }
}

/// N-ary 运算符（求和、积分、乘积等）
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum NaryOp {
    Sum,
    Prod,
    Coprod,
    Int,
    Iint,
    Iiiint,
    Oint,
   Oiint,
    Oiiint,
}

impl NaryOp {
    pub fn from_char(ch: char) -> Option<Self> {
        match ch {
            '\u{2211}' => Some(Self::Sum),
            '\u{220F}' => Some(Self::Prod),
            '\u{2210}' => Some(Self::Coprod),
            '\u{222B}' => Some(Self::Int),
            '\u{222C}' => Some(Self::Iint),
            '\u{222D}' => Some(Self::Iiiint),
            '\u{222E}' => Some(Self::Oint),
            '\u{222F}' => Some(Self::Oiint),
            '\u{2230}' => Some(Self::Oiiint),
            _ => None,
        }
    }
}

/// 重音/修饰符类型
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum AccentKind {
    Hat,
    Tilde,
    Bar,
    Overrightarrow,
    Dot,
    Ddot,
    Vec,
    Check,
    Grave,
    Acute,
}

impl AccentKind {
    pub fn from_char(ch: char) -> Option<Self> {
        match ch {
            '\u{0302}' | '^' => Some(Self::Hat),
            '\u{0303}' | '~' => Some(Self::Tilde),
            '\u{0304}' | '-' => Some(Self::Bar),
            '\u{0305}' => Some(Self::Overrightarrow),
            '\u{0307}' | '.' => Some(Self::Dot),
            '\u{0308}' | '\u{00A8}' => Some(Self::Ddot),
            '\u{20D7}' => Some(Self::Vec),
            '\u{030C}' => Some(Self::Check),
            '\u{0060}' => Some(Self::Grave),
            '\u{00B4}' => Some(Self::Acute),
            _ => None,
        }
    }
}

/// 上划线/下划线类型
#[derive(Debug, Clone, Copy, PartialEq)]
#[allow(dead_code)]
pub enum OverUnderKind {
    Overline,
    Underline,
    Overbrace,
    Underbrace,
}

/// 矩阵类型
#[derive(Debug, Clone, Copy, PartialEq, Default)]
#[allow(dead_code)]
pub enum MatrixKind {
    #[default]
    Plain,
    Paren,
    Bracket,
    Brace,
    Bar,
    DoubleBar,
}

/// Canonical Math IR 节点
#[derive(Debug, Clone, PartialEq)]
#[allow(dead_code)]
pub enum MathIR {
    /// 标识符（变量、字母、数字）
    Identifier {
        name: String,
        style: FontStyle,
    },
    /// 独立运算符（+、=、< 等）
    Operator {
        kind: OperatorKind,
        spacing: Spacing,
    },
    /// 布局序列（行内多个节点）
    Row(Vec<MathIR>),
    /// 分数
    Fraction {
        num: Box<MathIR>,
        den: Box<MathIR>,
    },
    /// 上标
    Sup {
        base: Box<MathIR>,
        exp: Box<MathIR>,
    },
    /// 下标
    Sub {
        base: Box<MathIR>,
        index: Box<MathIR>,
    },
    /// 上下标组合
    SubSup {
        base: Box<MathIR>,
        sub: Box<MathIR>,
        sup: Box<MathIR>,
    },
    /// 前置上下标
    PreSubSup {
        sub: Box<MathIR>,
        sup: Box<MathIR>,
        body: Box<MathIR>,
    },
    /// 根号
    Radical {
        degree: Option<Box<MathIR>>,
        radicand: Box<MathIR>,
    },
    /// N-ary 运算（求和、积分、乘积等）
    Nary {
        op: NaryOp,
        lower: Option<Box<MathIR>>,
        upper: Option<Box<MathIR>>,
        body: Box<MathIR>,
    },
    /// 定界符
    Delimiter {
        open: char,
        close: char,
        children: Vec<MathIR>,
    },
    /// 函数（\sin, \log 等）
    Function {
        name: String,
        body: Box<MathIR>,
    },
    /// 重音/修饰符
    Accent {
        kind: AccentKind,
        body: Box<MathIR>,
    },
    /// 上划线/下划线
    OverUnder {
        kind: OverUnderKind,
        body: Box<MathIR>,
    },
    /// 方程组
    EqArray {
        rows: Vec<Vec<MathIR>>,
    },
    /// 矩阵
    Matrix {
        rows: Vec<Vec<MathIR>>,
        kind: MatrixKind,
    },
    /// 极限
    Limit {
        name: String,
        below: Box<MathIR>,
        body: Box<MathIR>,
    },
    /// Overset（上方标注）
    Overset {
        above: Box<MathIR>,
        body: Box<MathIR>,
    },
    /// Phantom/box（透传）
    Phantom {
        body: Box<MathIR>,
    },

    // ── Internal types (used during OMML parsing, not part of public IR) ──

    /// XML attribute key-value pair（内部使用）
    #[doc(hidden)]
    Prop(String, String),
    /// Plain text（内部使用，解析器中间产物）
    #[doc(hidden)]
    Text(String),
}

// ── Convenience constructors ──

#[allow(dead_code)]
impl MathIR {
    pub fn ident(name: &str) -> Self {
        MathIR::Identifier {
            name: name.to_string(),
            style: FontStyle::Normal,
        }
    }

    pub fn ident_italic(name: &str) -> Self {
        MathIR::Identifier {
            name: name.to_string(),
            style: FontStyle::Italic,
        }
    }

    pub fn row(nodes: Vec<MathIR>) -> Self {
        MathIR::Row(nodes)
    }

    pub fn is_empty(&self) -> bool {
        match self {
            MathIR::Row(children) => children.is_empty(),
            MathIR::Identifier { name, .. } => name.is_empty(),
            _ => false,
        }
    }

    pub fn text_content(&self) -> String {
        match self {
            MathIR::Identifier { name, .. } => name.clone(),
            MathIR::Row(children) => children.iter().map(|c| c.text_content()).collect(),
            MathIR::Operator { kind, .. } => format!("{:?}", kind),
            MathIR::Phantom { body } => body.text_content(),
            _ => String::new(),
        }
    }
}
