# Word SVG 原始公式源的读取限制

更新：2026-10-08。SVG 选区读取仍未接通；PNG 入口不会读取 SVG 的回退图。

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

## 后续路线

本应用插入时应在应用元数据/原始资产中保留源文件及 SHA-256，读取时绑定
文档、对象/关系、修订和源码来源。第三方图片若没有明确保留的源，应提示
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
详细生成文件保留在本地证据目录，计划只记录能力状态和下一步。
