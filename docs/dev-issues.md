# 开发困境记录与工程级改造方案

---

# 一、项目评价

## 1. 项目定位：Office OMML ⇄ LaTeX 双向桥

本质上不是"插件"，而是一个：

> **Word OMML（Office Math Markup Language） ↔ LaTeX AST 转换 + 多进程桥接系统**

技术链路是典型三层：
- Word VBA（采集 OMML）
- Bridge（文件/IPC 通信层）
- Rust/Tauri（解析 + AST + 转换 + 渲染）

定位正确，但复杂度已进入**"文档系统级工程"**。

## 2. 架构优点

- **模块化成型**：formula-editor / formula-renderer / tauri commands / vba scripts，标准 host app + bridge + plugin 结构
- **OMML 处理意识正确**：已识别 Word 返回完整 document XML、OMML 混杂 w:/wx/ namespace、XML 实际是"半脏结构"
- **AST 思路正确**：Rust 侧已在做 node tree、sup/sub 结构解析、filtering non-OMML nodes，不是字符串转换器而是语义级转换器

## 3. 核心问题：卡在 Office 生态不可信层

> 不是在写转换器，而是在对抗 Word + VBA + XML 生态的不一致行为

- 编码系统混乱（UTF-8 / UTF-16 / ADODB / XML entity）
- IPC 不可靠（HTTP/COM 被 Windows 环境污染）
- Word XML 非规范（OMML + WordML 混合）

---

# 二、已遇问题诊断与根因归类

## 1. IPC 层（VBA ↔ Bridge）

| 现象 | 根因 |
|------|------|
| MSXML HTTP 不稳定 | COM HTTP 在企业策略/代理/权限下极不稳定，localhost loopback 经常被杀 |
| fallback 到 file polling | VBA runtime 不适合做网络客户端 |

👉 **本质：用 VBA 做"网络客户端"是天然不可靠路径**

## 2. XML/OMML 层（最复杂）

| 现象 | 根因 |
|------|------|
| Range.Xml = 完整 WordDocument | Word 输出的是 WordprocessingML + OMML 混合 + entity escape + runtime serialization |
| HTML entity 混入 | |
| namespace 缺失 | |
| w:/wx 干扰 | 不是标准 XML pipeline |
| AST 误解析 | |

## 3. 编码问题（最大隐患）

| 现象 | 根因 |
|------|------|
| `∫ → &#x222B; → UTF-8 decode → 乱码` | multi-layer encoding + implicit conversion + BOM inconsistency |
| ADODB Stream vs Rust fs mismatch | pipeline: `VBA string → file → Rust read_to_string → XML parse` |

## 4. 解析层（AST 设计）

| 现象 | 根因 |
|------|------|
| Row/Prop 干扰 tree | 用"HTML DOM 思维"处理"Word XML graph" |
| namespace missing | |
| tag boundary 错误（lastIndexOf bug） | |

---

# 三、已实现的修复

## P0 已完成

### IPC 层：文件轮询替代 HTTP COM
- VBA 写 UTF-8 文件（ADODB.Stream）
- Bridge 500ms 轮询检测
- xml_seen 标志防止重复触发

### OMML 提取
- `extractMathElement` 从完整 Word XML 中定位 `<m:oMathPara>`
- HTML 实体解码（`&#xHEX;` / `&#DEC;` / `&lt;` 等）
- 动态补 `xmlns:m` / `xmlns:w` 命名空间

### AST 解析
- quick-xml 解析 OMML → MathNode 树
- `w:` / `wx:` 前缀标签静默跳过
- 属性节点（sSupPr 等）统一过滤
- 公式块边界：`indexOf` 替代 `lastIndexOf`

---

# 四、待解决问题与改造方案

## 【P0-1】IPC 层升级（长期稳定性）

### ❌ 不建议继续 file polling（长期灾难源）

**推荐方案 A（最佳）：Named Pipe（Windows native IPC）**
```
VBA → NamedPipe → Rust Bridge
```
优点：无 HTTP 问题、无权限问题、零延迟、Rust/Tauri 支持好

**推荐方案 B（次优但简单）：WebSocket localhost daemon**
```
127.0.0.1:port websocket
```

**推荐方案 C（保底）：atomic rename file polling**
```
write → .tmp → rename → .ready
Rust only reads .ready
```

## 【P0-2】编码系统重构（最高风险）

### ❌ 禁止路径：`string ↔ file ↔ string`

**推荐：Base64 payload**
- VBA 侧：Base64 encode XML
- Rust 侧：decode Base64 → UTF-8 XML

消灭：BOM 问题、encoding drift、ADODB Stream bug

### Rust 侧关键改动
```rust
// ❌ 现在
let raw = fs::read_to_string(&path)?;

// ✔ 改成
let bytes = fs::read(&path)?;
let decoded = base64::decode(&bytes)?;
let xml = String::from_utf8(decoded)?;
```

## 【P1-1】OMML 提取优化

### 当前问题
Range.Xml = full document，需要从 40KB XML 中切出 <1KB 的 OMML。

### 推荐：OMML Sanitizer Layer
职责：
- strip w:/wx namespace nodes
- normalize namespace declarations
- extract only m:oMath / m:oMathPara
- validate XML well-formedness

## 【P1-2】AST 设计升级

### 当前：OMML → LaTeX（直接映射）
### 目标：OMML → Canonical Math IR → LaTeX

```json
{
  "type": "fraction",
  "numerator": { "type": "identifier", "name": "a" },
  "denominator": { "type": "identifier", "name": "b" }
}
```

好处：
- 解耦 Word 结构污染
- 支持 LaTeX → OMML（未来）
- 可扩展 MathML

## 【P2】VBA 层精简

VBA 只做：**capture selection + emit raw payload**
不要承担：HTTP、encoding、parsing

---

# 五、风险总结

> **当前系统最大风险不是"功能"，而是"数据在 pipeline 中不可预测变化"**

| 风险 | 等级 | 影响 |
|------|------|------|
| encoding drift | ❌ 最高 | 随机解析失败、∫ 等符号破坏 |
| IPC race condition | ❌ 高 | file polling 重复触发、状态错乱 |
| XML 非规范污染 | ⚠️ 中 | w:/wx 混入、namespace 缺失 |

---

# 六、升级路线图

## Phase 1（稳定性）
- [ ] Base64 payload（消灭编码问题）
- [ ] Named Pipe 或 WebSocket（替代 file polling）
- [ ] 禁用 `read_to_string`，改用 binary read

## Phase 2（结构）
- [ ] OMML Sanitizer Layer
- [ ] Canonical Math IR 定义
- [ ] 单元测试覆盖核心转换路径

## Phase 3（能力扩展）
- [ ] LaTeX → MathNode Parser
- [ ] MathNode → OMML Writer
- [ ] Full bidirectional pipeline

---

# 七、积分符号 ∫ 编码问题（专项追踪）

## 现象
`&#x222B;` 解码后的 ∫（U+222B）在文件读写中被损坏为 `鈭?`，导致 `</m:t>` 标签被截断。

## Pipeline 追踪
```
VBA Range.Xml → "&#x222B;" → ADODB.Stream UTF-8 write → file bytes
→ Rust fs::read_to_string → "∫" (or garbled?) → Bridge emit → JS decode → Rust parse
```

## 待排查
1. VBA ADODB.Stream 是否正确写入 UTF-8 bytes
2. Rust `fs::read_to_string` 是否正确解码
3. BOM (EF BB BF) 是否干扰
4. 是否改用 `fs::read` + manual UTF-8 decode

## 临时方案
单公式（不含特殊 Unicode）正常工作。含 ∫/∑/∏ 等符号的公式需 Phase 1 编码重构后解决。

---

# 八、基础渲染链路结构性分析

## 1. 当前渲染链路

```
OMML XML → MathNode AST → LaTeX string → Temml renderer → HTML/SVG
```

### 核心风险：LaTeX 被当成中间 IR

> LaTeX ≠ 语义表达，只是 presentation DSL

后果：
- OMML → LaTeX 丢结构信息
- 再渲染时无法 recover semantics
- 特殊结构（matrix / cases / accent）容易崩

## 2. 已遇到的渲染层问题

| 问题 | 现象 | 根因 |
|------|------|------|
| inline/block 不一致 | Word 行内公式渲染成 block | 缺少 layout context（display vs inline） |
| sup/sub 嵌套 | `x^a^b` 优先级错误 | AST flatten 时丢层级 |
| fraction 错位 | `\frac{a}{b+c}` 被拆分 | AST 不是 tree，是 semi-linear stream |
| operator spacing | 数学正确但视觉丑 | 未处理 OMML 的 spacing hint / italic style |
| Unicode 符号丢失 | ∫/∑ 等损坏 | 编码管道问题（已用 Base64 修复） |

## 3. 当前 AST 设计评价

### ✔ 优点
- 已有 AST 概念（关键起点）
- 已从 XML 脱离到结构层
- 有 renderer 分层意识

### ❌ 问题
- AST 偏"语法树"，不是"数学语义树"
- renderer 承担过多语义判断职责
- 缺少 layout model（baseline / font metrics / inline box model）

---

# 九、缺失的关键设计

## 1. Canonical Math IR（最关键缺口）

> 没有一个稳定"中间语义层"，导致渲染逻辑混乱、转换链路耦合、debug 困难

### IR Schema 设计

```rust
/// Canonical Math IR — 语义层，不绑定任何输出格式
pub enum MathIR {
    /// 文本节点（标识符、数字、普通文字）
    Identifier { name: String, style: fontStyle },
    /// 运算符
    Operator { op: OperatorKind, spacing: Spacing },
    /// 分数
    Fraction { num: Box<MathIR>, den: Box<MathIR> },
    /// 上标
    Sup { base: Box<MathIR>, exp: Box<MathIR> },
    /// 下标
    Sub { base: Box<MathIR>, index: Box<MathIR> },
    /// 上下标组合
    SubSup { base: Box<MathIR>, sub: Box<MathIR>, sup: Box<MathIR> },
    /// 根号
    Radical { degree: Option<Box<MathIR>>, radicand: Box<MathIR> },
    /// N-ary 运算（求和、积分、乘积）
    Nary { op: NaryOp, lower: Option<Box<MathIR>>, upper: Option<Box<MathIR>>, body: Box<MathIR> },
    /// 定界符
    Delimiter { open: char, close: char, children: Vec<MathIR> },
    /// 函数
    Function { name: String, body: Box<MathIR> },
    /// 重音/修饰
    Accent { kind: AccentKind, body: Box<MathIR> },
    /// 上划线/下划线
    OverUnder { kind: OverUnderKind, body: Box<MathIR> },
    /// 方程组
    EqArray { rows: Vec<Vec<MathIR>> },
    /// 矩阵
    Matrix { rows: Vec<Vec<MathIR>>, kind: MatrixKind },
    /// 极限
    Limit { name: String, below: Box<MathIR>, body: Box<MathIR> },
    /// 布局序列（行内多个节点）
    Row(Vec<MathIR>),
}

#[derive(Clone, Copy)]
pub enum fontStyle { Normal, Bold, Italic, BoldItalic }

#[derive(Clone, Copy)]
pub enum Spacing { Normal, Thin, Medium, Thick, NoSpace }

#[derive(Clone, Copy)]
pub enum OperatorKind {
    Plus, Minus, Times, Divide, Equal, NotEqual,
    Less, Greater, Leq, Geq, Approx, Equiv, Sim, Propto,
    Union, Intersection, SetMinus, Subset, Supset,
    Dot, Cross, Asterisk, dagger,
    // ... more
}

#[derive(Clone, Copy)]
pub enum NaryOp { Sum, Prod, Coprod, Int, Iint, Iiiint, Oint }

#[derive(Clone, Copy)]
pub enum AccentKind { Hat, Tilde, Bar, Vec, Dot, Ddot, Check, Grave, Acute }

#[derive(Clone, Copy)]
pub enum OverUnderKind { Overline, Underline, Overbrace, Underbrace }

#[derive(Clone, Copy)]
pub enum MatrixKind { Plain, Paren, Bracket, Brace, Bar, DoubleBar }
```

### 设计原则
- **语义完备**：每个节点有明确数学含义，不依赖输出格式
- **layout-aware**：style / spacing 嵌入 IR，不丢信息
- **可双向**：IR → LaTeX 和 IR → OMML 都是"渲染"，不是"转换"
- **可验证**：IR 可以做 round-trip 测试（IR → LaTeX → IR ≈ 原 IR）

## 2. Normalization Layer（OMML → IR 前必须有）

```
Raw OMML XML
    ↓
Sanitizer: strip w:/wx, normalize namespace, decode entities
    ↓
Flattener: run flatten, extract text content
    ↓
Structure Repair: fix nested sup/sub, handle implicit groups
    ↓
Canonical Math IR
```

职责：
- namespace cleanup（`w:rPr`, `wx:font` → skip）
- run flatten（`m:r` + `m:t` → text content）
- entity decode（`&#x222B;` → ∫）
- structure repair（fix malformed nesting）

## 3. Renderer Contract（渲染器输入契约）

```
IR must be:
  ✓ acyclic tree
  ✓ sup/sub explicitly represented (no implicit precedence)
  ✓ fraction fully nested (no flat stream)
  ✓ delimiter paired (open/close match)
  ✓ no raw XML fragments

Renderer must:
  ✓ handle any valid IR node
  ✓ not do semantic analysis (that's IR's job)
  ✓ produce layout-only output
```

## 4. Error Tolerance Strategy

Office XML 是"不可靠输入源"，必须定义：

| 策略 | 实现 |
|------|------|
| Fallback rendering | 无法解析的节点 → 渲染原始文本 |
| Partial AST recovery | 坏节点 → 跳过，保留兄弟节点 |
| Graceful degradation | 渲染失败 → 显示 LaTeX 源码 |
| Error boundary | 单个公式失败不 crash 编辑器 |

---

# 十、docs 计划评价

## ✔ 正确方向（应坚持）

| 方向 | 评价 |
|------|------|
| 双向转换 OMML ⇄ LaTeX | 项目核心价值，但注意"双向 ≠ symmetric" |
| Rust 作为 core engine | XML parsing + AST transform + deterministic pipeline，正确选择 |
| Tauri 做 UI shell | math rendering 在 frontend，core logic 在 backend，合理 |

## ⚠️ 过度设计风险

| 方向 | 风险 | 建议 |
|------|------|------|
| 多平台 Office 插件统一架构 | Office 生态碎片化（COM / Office.js / VSTO） | 先做 Windows stable pipeline，再扩平台 |
| 统一渲染引擎多端复用 | layout engine / font metrics 各端不同 | shared IR yes, renderer must be per-platform |
| 对标 MathJax/KaTeX 替代 | 20年生态，TeX parsing 极其复杂 | 定位为 Office-native math bridge tool |

## ❗ 缺失但关键的设计

| 设计 | 优先级 | 说明 |
|------|--------|------|
| Canonical Math IR | P0 | 当前最大结构缺口 |
| Normalization layer | P0 | OMML → IR 前必须清洗 |
| Rendering contract | P1 | 定义 renderer 输入契约 |
| Error tolerance | P1 | 坏输入不 crash |

---

# 十一、升级路线图（修订版）

## Phase 1（稳定性）— 当前
- [x] Base64 payload（消灭编码问题）
- [ ] Named Pipe IPC（替代 file polling）
- [ ] 积分符号 ∫ 等 Unicode 验证

## Phase 2（语义层）— 下一步
- [ ] Canonical Math IR 定义（见上方 Schema）
- [ ] OMML Sanitizer（strip w:/wx, normalize namespace）
- [ ] OMML → IR parser（替代当前 MathNode 直接映射）
- [ ] IR → LaTeX writer（从 IR 生成，不从 AST 直接生成）
- [ ] IR → OMML writer（反向转换的基础）

## Phase 3（渲染层）
- [ ] Renderer contract 定义
- [ ] IR 可验证测试（round-trip: IR → LaTeX → IR ≈ 原 IR）
- [ ] Error tolerance 实现

## Phase 4（能力扩展）
- [ ] LaTeX → IR Parser（反向转换）
- [ ] MathML ↔ IR 双向
- [ ] Per-platform renderer（Office / Web / Mobile 各自实现）
