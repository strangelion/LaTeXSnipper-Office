# Word 复制公式身份与精确读入

更新：2026-10-09。关闭已验证的内容控件承载原生公式、PNG 和受管 SVG 的复制身份基础问题。

## 行为

读取选区先绑定实际内容控件和所属文档；多公式/宽泛选区、按重复 ID 读取拒绝，
不悄悄返回第一件。合法复制件使用共享身份/清单事务获得独立 ID，原件和原记录不重写。
同 ID 的其他对象必须有匹配来源，空控件或错误标记不当作正常复制件。

实际载体、源码、图片字节或 SVG 来源绑定、控件 ID/标签、范围、锁定、标题和内容快照参与验证。
Word 的 `auto`/空原生模式按实际 OMML 载体读取，不误判为格式冲突。
对象计数使用文档 Tag 查询，不在每个唯一公式读取中重复遍历整篇故事范围。
失败的标签写入只在已知状态下恢复；不能证明恢复时保留数据并返回不确定状态。
选区/按 ID 读入的身份错误绑定原请求返回，不吞错冒充“未找到”。

Word 连续导出行内 PNG 会重建 `wp14:anchorId/editId`，已有前后差异证据。
内容指纹仅忽略这两个行内导出戳和已有生成修订戳；仍比较 docPr 对象标识、几何、
图片二进制和实际格式。浮动锚点不因此放宽。
本机 SVG 的 InlineShape.Type 为 17，旧 PIA 未命名；受管 SVG 仍要求原有来源绑定验证。
无绑定的旧 SVG 来源保留为未验证读取，不借此修复身份或制造可信绑定。

## 验证

隐藏 x64 Word 16.0 的自编 XML 复制（不是 OS 剪贴板 Copy/Paste）：

- 原生 OMML、`auto` 原生入口、PNG、受管 SVG 四组复制件取得独立 ID，原件内容和元数据不变。
- 生产选区/按 ID 读取、保存后只读重开、单独删除复制件通过；原件及周围文字保留。
- 多公式选区和重复 ID 读取不修改文档；标签写后注入异常恢复旧标签及原清单。
- 受管 SVG 插入/更新/回滚、旧来源、错误来源/载体/重复空控件拒绝回归通过。
- Shared.Tests warnings-as-errors 全套、433 项前端、源码卫生通过；Word 删除回归及 25 项批次通过（24 成功、1 保留、0 失败）。

专项入口：Word.HostTests `--copied-identity`。证据均在忽略的 `src-tauri/target/` 下：

| 文件 | SHA-256 |
| --- | --- |
| `word-copied-identity-final-37375b9c2cca4d969a5f039448a1f7a2/word-copied-identity-evidence.json` | `888fa6848796453e541349796740582d82f5e3b09986569ce3dc8a8b3fd820db` |
| `word-copy-svg-regression-final-72237ae7ea074fdaacf26e30406366bd/managed-svg-evidence.json` | `3d32c61252c29943728c85b03b01bfddce1c729fa9344bf7f73907739033b309` |
| `word-copy-delete-regression-2a21164a1e4144489ad439aab631b19c/manifest-delete-evidence.json` | `2114df5bc8108fddb549b55826c62688a7327e4ad6db361da7be9048cd7d45f7` |
| `word-copy-batch-regression-2b5da7add96347beacc9808a03934b7a/batch-evidence.json` | `02b0f9388675f5ac17dffdd11f1751df7c515d55a2297e58f64a80be611384e0` |

`pipeVerified=false`，剪贴板序列未改变。OLE 内部身份写回、编号/书签引用迁移、
跨文档/全部故事范围复制、宏重入、安装版加载项和通用格式/性能准确率仍开放。
上述复制基础不关闭 O-02/O-06 整项，也不证明任意 LaTeX 与图片视觉一致。
