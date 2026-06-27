# 开发困境记录

## 1. VBA HTTP 通信不可靠

### 问题
VBA 使用 `MSXML2.XMLHTTP` COM 对象向 Bridge 服务发送 HTTP POST 请求，但在某些 Windows 配置下连接失败，返回空响应，导致 `Failed to send to app. Is LaTeXSnipper running?` 错误。

### 已尝试的方案
- `MSXML2.XMLHTTP` → 连接不稳定
- `MSXML2.ServerXMLHTTP.6.0` → 同样失败
- `localhost` → `127.0.0.1` → 未解决根本问题

### 当前方案
改用**文件轮询**：VBA 写文件 → Bridge 定时检测 → 读取并 emit 事件。绕过 COM HTTP 的兼容性问题。

---

## 2. Word `Range.Xml` 返回完整文档而非纯 OMML

### 问题
VBA 的 `Application.Selection.OMaths(1).Range.Xml` 返回的不是纯 `<m:oMath>` 元素，而是完整的 Word 文档 XML（约 40KB），其中数学公式被嵌入在 `<w:wordDocument>` 根元素中。

### 解决方案
在 JS 和 Rust 端都实现了 `extractMathElement` 函数，从完整 XML 中提取 `<m:oMath>` 或 `<m:oMathPara>` 片段。

---

## 3. Word XML 使用 HTML 实体编码

### 问题
`Range.Xml` 输出的 XML 中，所有 `<`、`>` 和 Unicode 字符都被 HTML 实体编码：
- `<m:oMath>` → `&lt;m:oMath&gt;`
- 积分符号 ∫ → `&#x222B;`
- 不等号 ≠ → `&#x2260;`

直接作为 XML 解析会失败。

### 解决方案
在提取前先解码所有 HTML 实体：
```javascript
decoded = xml
  .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
  .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"');
```

---

## 4. 积分符号 ∫ 编码损坏

### 问题
解码 `&#x222B;` 后的积分符号 ∫（U+222B）在文件读写过程中被损坏为乱码 `鈭?`，导致 XML 解析失败（`</m:t>` 标签被截断）。

### 疑似原因
VBA 的 `ADODB.Stream` UTF-8 写入与 Rust 的 `fs::read_to_string` 之间存在编码不一致，或文件 BOM 处理问题。

### 状态
**未完全解决**。单公式（如 `E=mc^2`）工作正常，但包含特殊 Unicode 字符的公式（如 `∫`）会失败。

---

## 5. 命名空间缺失导致 XML 解析失败

### 问题
提取的 `<m:oMathPara>` 片段缺少命名空间声明，quick-xml 解析器报错：
```
Namespace prefix m on oMathPara is not defined
Namespace prefix w on rPr is not defined
```

### 解决方案
在提取时动态补上缺失的命名空间：
```xml
<m:oMathPara xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
             xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
```

---

## 6. Word `w:` 前缀格式标签干扰解析

### 问题
OMML 元素内部嵌套了 Word 格式标签（`w:rPr`、`w:rFonts`、`w:i`、`wx:font` 等），这些标签不在 OMML 规范中，导致解析器无法正确提取数学内容。

### 解决方案
在 AST 解析器中，对 `w:` 和 `wx:` 前缀的标签直接跳过，返回空文本节点。

---

## 7. OMML 属性节点（`sSupPr` 等）干扰子元素提取

### 问题
`<m:sSup>` 等元素的子节点包括属性节点（如 `<m:sSupPr>`），这些属性节点在 `build_node` 中被包装为 `Row` 节点，干扰了 `extract_sup_sub_parts` 等函数对内容节点的定位。

### 解决方案
所有提取函数统一跳过 `Row`、`Prop` 和空 `Text` 节点：
```rust
let content: Vec<&MathNode> = children.iter()
    .filter(|c| !matches!(c, MathNode::Row(_) | MathNode::Prop(_, _)))
    .filter(|c| !matches!(c, MathNode::Text(t) if t.is_empty()))
    .collect();
```

---

## 8. 公式块边界判断错误

### 问题
使用 `lastIndexOf` 查找闭标签时，匹配到文档中**最后一个** `</m:oMathPara>`，导致跨越两个公式块的边界，将两个独立公式错误合并。

### 解决方案
改用 `indexOf(..., start)` 查找第一个闭标签，确保只提取当前公式块。

---

## 9. 文件轮询重复触发

### 问题
Bridge 文件轮询检测到文件后，立即将 `xml_seen` 标志重置为 `false`，导致 500ms 后再次触发，同一文件被处理多次。

### 解决方案
`xml_seen` 标志只在 `fs::metadata` 失败（文件确实不存在）时才重置，删除文件后保持 `true` 状态。

---

## 10. VBA `.dotm` 部署路径问题

### 问题
`replace-vba.ps1` 更新的是 `scripts/out/LaTeXSnipper.dotm`，但 Word 实际加载的是 `%APPDATA%\Microsoft\Word\STARTUP\LaTeXSnipper.dotm`。两个文件不同步，导致 VBA 代码更新不生效。

### 解决方案
每次部署后，自动将 `.dotm` 复制到 Word STARTUP 文件夹。

---

## 11. replace-vba.ps1 无法重复运行

### 问题
脚本只删除名为 `Zotero`/`ZoteroRibbon` 的 VBA 模块，首次运行后模块名改为 `LaTeXSnipper`，后续运行无法找到旧模块进行替换。

### 解决方案
同时删除 `Zotero`、`ZoteroRibbon`、`LaTeXSnipper`、`LaTeXSnipperRibbon` 四种名称。

---

## 待解决问题

### A. 积分符号编码损坏
`&#x222B;` → ∫ 的解码在文件 I/O 过程中被损坏。需要排查是 VBA 写入编码问题还是 Rust 读取编码问题。

### B. 反向转换（LaTeX → OMML）
当前只有 OMML → LaTeX 方向。LaTeX → OMML 需要实现 LaTeX Parser → AST → OMML XML 的完整管道。

### C. 插入路径仍依赖 Python
MathML → OMML 的转换仍使用 Python lxml + XSLT。虽然对打包有影响，但作为 Phase 1 可接受。后续可用纯 Rust XSLT 替代。
