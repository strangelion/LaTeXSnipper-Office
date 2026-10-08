# Word SVG 原始公式源的读取限制

更新：2026-10-08。本应用 SVG 的原始资产保存与校验读回已有；通用第三方 SVG 选区入口仍待接入。PNG 入口不会读取 SVG 的回退图。

本机 x64 Word `16.0.18526` 的受控样例表明：通过 `InlineShapes.AddPicture`
插入 SVG 后，Word 会重写 SVG，而非完整保留输入文件。输入的顶层 `metadata`
中有明确 LaTeX 字段与 MathML `math`，插入后的范围 Flat OPC、保存的 DOCX 中
关联 SVG part，以及保存重开后的范围均不再包含这些字段。保存包中的 SVG
字节也不同于输入文件。这里只验证一个作者样例，不推断所有 Word 版本或生产软件。

范围中的 DrawingML `a:blip/r:embed` 关联 PNG 回退图；其扩展
`asvg:svgBlip/r:embed` 才关联 SVG。关联 SVG 在此样例的 Flat OPC 中使用
`pkg:xmlData`，不是 PNG 的 `pkg:binaryData`。不能用 PNG 回退图或重新序列化的
XML 冒充原 SVG 文件或其字节位置。
SVG 扩展的定义见 Microsoft [SVGBlip API](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.office2019.drawing.svg.svgblip?view=openxml-3.0.1)。

共享 PNG 读取器现拒绝包含 `svgBlip` 的图片，包括链接与未知 namespace 的
扩展，不猜测或转读回退图。Word 原生适配器仍只允许精确选中的行内 PNG；
此样例中的 SVG 类型为 `17`，不会进入该路径。Core 的 standalone SVG metadata
提取器不受影响，它接收的必须是实际保留的输入 SVG。

## 本应用 SVG 来源绑定

新插入的 SVG 图片复用原有文档清单中的完整 `render.svg`、LaTeX、OMML 和
`editorState`，不额外复制原始资产。新增可选 `source.wordSvgBinding` v1，分别
记录原 SVG UTF-8 哈希、明确关联的 Word SVG part 的物化 XML 哈希，以及
LaTeX/OMML/内容类型/编辑状态的 JSON 指纹。Word 图形不是原文件，两个哈希不可混用。

关联提取只接受一个 DrawingML blip、一个已知 SVG 扩展、唯一内部 image 关系
和对应 SVG part；拒绝 OLE、链接、重复关系、路径跳转、DTD、未知扩展、歧义数据
和超限。支持 Flat OPC 的 XML 或 UTF-8 binary SVG，绝不改读 PNG 回退图。
原 SVG 最多 4 MiB；每个源码字段/编辑状态最多 256 Ki 字符；范围 XML 延用
16 Mi 字符、深度 64、100,000 事件、128 parts，并限制每个 XML 元素 64 属性。

选区与按 ID 读取均核对当前文档的唯一控件、故事范围和当前载体。替换图形、
修改保留源码或重复对象 ID 会拒绝读回；过期图片更新在写入前拒绝。哈希只是
关联/漂移检测，不认证文档作者，也不证明源码与图形语义一致。物化 XML 的
序列化发生变化也可能触发拒绝，不是图形语义等价或跨版本 canonicalization。
旧条目没有这个字段，保留原有未验证读取，不自动升级为已验证来源；C#/Rust
消息均保留该可选字段，部署时应更新同源载荷。

新 SVG 读回已验证，不代表原位图片更新完成。Word 的相邻富文本控件重叠会
导致 COM 长时间等待；当前绑定 SVG 的同图片/auto 更新在修改前返回
`SVG_UPDATE_BOUNDARY_UNSUPPORTED`，保留原对象。直接在已有公式内部插图片
也会拒绝。解除这项限制须另行完成候选位置、控件边界、失败恢复与正文顺序验证。
OMML/OLE 目标不走这个同图片更新门禁，但本批未验证 SVG→OMML/OLE 的真实闭环。

## 后续路线

继续完善本应用图片更新与其他宿主的原资产/源绑定。第三方图片若没有明确保留的源，应提示
不可恢复，可由用户提供原文件或使用可选 OCR；不能根据绘图内容猜测原公式。
如果另行读取 DOCX 中的原 part，应先解决未保存修订与旧磁盘副本的绑定问题；
这也不能恢复 Word 已经丢弃的元数据。通用 SVG 宿主入口仍是待办，不据此宣称
任意 SVG→LaTeX 或安装版工作流完成。

## 验证与证据

Word HostTests `--svg-source` 在隐藏的自有 Word 实例生成 SVG/DOCX，以及
`svg-source-evidence.json`。它记录插入、保存包和重开状态，验证 PNG 回退图拒绝、
原输入文件/剪贴板不变，以及读取前后正文、选区、尺寸和保存状态不变。
元数据是否保留是观测结果，不将当前 Word 的丢弃行为写成未来版本必须满足的断言。
PNG 的 `--png-source` 也默认隐藏；可见候选窗口测试仍需显式指定 `--png-viewer`。
`--managed-svg-source` 生成两个独立段落中的本应用 SVG，验证原始 SVG/源码
保存重开、两条读取路径、旧条目兼容、重复 ID/源码/载体漂移拒绝及不支持更新
时保留原对象；报告为 `managed-svg-evidence.json`。这是适配器验证，安装版
Ribbon/管道闭环、多 DPI、其他 Word 版本与第三方生产软件尚未验收。
详细生成文件保留在本地证据目录，计划只记录能力状态和下一步。
